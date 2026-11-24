import { diffArrays, diffWords, diffWordsWithSpace } from 'diff';
import type { Cell, DiffOptions, Entry, Row, Seg, Stats } from '../types';
import { buildEntries, comparableTokens, lineBreaksIgnored, tokenKey, type KeyTok } from './normalize';
import { tokenize } from './SqlTokens';


function tokenSignature(text: string, o: DiffOptions): string {
  // The tokenizer intentionally splits multiline tokens for line-aware diagnostics. Do not use
  // that split representation for equality: newlines inside SQL string literals are data.
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "'") {
      if (inString && text[i + 1] === "'") { i++; continue; }
      inString = !inString;
    } else if (inString && (text[i] === '\n' || text[i] === '\r')) {
      return `multiline-string:${text}`;
    }
  }
  const toks = tokenize(text).filter((t) => !o.ignoreComments || t.type !== 'comment');
  return toks.map((t) => tokenKey(t, o)).join('\u001f');
}

/**
 * If both files have the exact same SQL token stream, line wrapping/indentation is presentation,
 * not a code change. Keep physical lines visible but don't manufacture changed hunks from them.
 */
function formattingOnlyRows(leftText: string, rightText: string, o: DiffOptions): Row[] {
  const a = buildEntries(leftText, o);
  const b = buildEntries(rightText, o);
  const n = Math.max(a.length, b.length);
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ kind: 'equal', left: a[i], right: b[i] });
  }
  return rows;
}

function withSegs(l: Entry, r: Entry, ignoreWs: boolean): [Cell, Cell] {
  const parts = ignoreWs ? diffWords(l.text, r.text) : diffWordsWithSpace(l.text, r.text);
  const ls: Seg[] = [];
  const rs: Seg[] = [];
  for (const p of parts) {
    if (p.added) rs.push({ text: p.value, type: 'add' });
    else if (p.removed) ls.push({ text: p.value, type: 'del' });
    else {
      ls.push({ text: p.value, type: 'same' });
      rs.push({ text: p.value, type: 'same' });
    }
  }
  return [
    { ...l, segs: ls },
    { ...r, segs: rs },
  ];
}

/* ---------- ignore line breaks: compare SQL tokens, not lines ---------- */

/** Non-equal row runs closer than this many equal rows are refined together. */
const MERGE_GAP = 3;

function byLine(toks: KeyTok[]): Map<number, KeyTok[]> {
  const m = new Map<number, KeyTok[]>();
  for (const t of toks) {
    const a = m.get(t.line);
    if (a) a.push(t);
    else m.set(t.line, [t]);
  }
  return m;
}

/** Segments for one line where only the tokens that really differ are highlighted. */
function tokenSegs(text: string, toks: KeyTok[], dirty: Set<KeyTok>, type: 'add' | 'del'): Seg[] {
  const segs: Seg[] = [];
  const push = (t: string, ty: Seg['type']) => {
    if (!t) return;
    const last = segs[segs.length - 1];
    if (last && last.type === ty) last.text += t;
    else segs.push({ text: t, type: ty });
  };
  let pos = 0;
  toks.forEach((t, i) => {
    const gap = text.slice(pos, t.col);
    // Whitespace between two changed tokens is part of the change, so the highlight is one piece.
    const joins = dirty.has(t) && i > 0 && dirty.has(toks[i - 1]) && gap.trim() === '';
    push(gap, joins ? type : 'same');
    push(text.slice(t.col, t.col + t.len), dirty.has(t) ? type : 'same');
    pos = t.col + t.len;
  });
  push(text.slice(pos), 'same');
  return segs;
}

/** Rough lower bound of the edit distance, used to skip hopeless (very slow) token diffs. */
function minEdits(a: string[], b: string[]): number {
  const m = new Map<string, number>();
  for (const k of a) m.set(k, (m.get(k) ?? 0) + 1);
  for (const k of b) m.set(k, (m.get(k) ?? 0) - 1);
  let d = 0;
  m.forEach((v) => (d += Math.abs(v)));
  return d;
}

/**
 * The line diff only knows whole lines, so the same code written with a different layout
 * (one column per line vs. several columns on one line) shows up as changed. For every block of
 * changed rows this diffs the SQL tokens instead and keeps only the rows that hold a token which
 * really differs. Rows whose tokens all match become equal, changed rows highlight only the
 * tokens that differ.
 */
function refineByTokens(rows: Row[], leftText: string, rightText: string, o: DiffOptions): Row[] {
  if (!rows.some((r) => r.kind !== 'equal')) return rows;
  const lt = byLine(comparableTokens(leftText, o));
  const rt = byLine(comparableTokens(rightText, o));
  const out = rows.slice();

  // Blocks of non-equal rows, merged when only a few equal rows sit between them
  // (an accidental match like "END" or ")" should not split one reformatted block in two).
  const blocks: [number, number][] = [];
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind === 'equal') { i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].kind !== 'equal') j++;
    const last = blocks[blocks.length - 1];
    if (last && i - last[1] - 1 <= MERGE_GAP) last[1] = j - 1;
    else blocks.push([i, j - 1]);
    i = j;
  }

  for (const [a, b] of blocks) {
    const lLines: number[] = [];
    const rLines: number[] = [];
    for (let k = a; k <= b; k++) {
      const l = rows[k].left?.no;
      const r = rows[k].right?.no;
      if (l !== undefined && lLines[lLines.length - 1] !== l) lLines.push(l);
      if (r !== undefined && rLines[rLines.length - 1] !== r) rLines.push(r);
    }
    const lToks = lLines.flatMap((n) => lt.get(n) ?? []);
    const rToks = rLines.flatMap((n) => rt.get(n) ?? []);
    const lKeys = lToks.map((t) => t.key);
    const rKeys = rToks.map((t) => t.key);
    if ((lKeys.length + rKeys.length) * minEdits(lKeys, rKeys) > 50_000_000) continue; // too different, keep line diff

    const dirty = new Set<KeyTok>();
    let li = 0;
    let ri = 0;
    for (const ch of diffArrays(lKeys, rKeys)) {
      const n = ch.count ?? ch.value.length;
      if (ch.removed) for (let k = 0; k < n; k++) dirty.add(lToks[li++]);
      else if (ch.added) for (let k = 0; k < n; k++) dirty.add(rToks[ri++]);
      else { li += n; ri += n; }
    }

    for (let k = a; k <= b; k++) {
      const row = rows[k];
      const lTokLine = row.left ? lt.get(row.left.no) ?? [] : [];
      const rTokLine = row.right ? rt.get(row.right.no) ?? [] : [];
      const lDirty = lTokLine.some((t) => dirty.has(t));
      const rDirty = rTokLine.some((t) => dirty.has(t));
      const plain = (c?: Cell): Cell | undefined => (c ? { no: c.no, text: c.text, key: c.key } : undefined);

      if (!lDirty && !rDirty) {
        out[k] = { kind: 'equal', left: plain(row.left), right: plain(row.right) };
        continue;
      }
      const left = row.left ? { ...plain(row.left)!, segs: tokenSegs(row.left.text, lTokLine, dirty, 'del') } : undefined;
      const right = row.right ? { ...plain(row.right)!, segs: tokenSegs(row.right.text, rTokLine, dirty, 'add') } : undefined;
      const kind = left && right ? 'changed' : left ? 'removed' : 'added';
      out[k] = { kind, left, right };
    }
  }
  return out;
}

export function computeRows(leftText: string, rightText: string, o: DiffOptions): Row[] {
  const tokenMode = lineBreaksIgnored(o);
  if (tokenMode) {
    const same = (x: KeyTok[], y: KeyTok[]) => x.length === y.length && x.every((t, i) => t.key === y[i].key);
    if (
      tokenSignature(leftText, o) === tokenSignature(rightText, o) ||
      same(comparableTokens(leftText, o), comparableTokens(rightText, o))
    ) {
      return formattingOnlyRows(leftText, rightText, o);
    }
  }
  const a = buildEntries(leftText, o);
  const b = buildEntries(rightText, o);
  const changes = diffArrays(
    a.map((e) => e.key),
    b.map((e) => e.key),
  );

  const rows: Row[] = [];
  let i = 0;
  let j = 0;

  for (let c = 0; c < changes.length; c++) {
    const ch = changes[c];

    if (!ch.added && !ch.removed) {
      for (let k = 0; k < ch.count; k++) {
        rows.push({ kind: 'equal', left: a[i++], right: b[j++] });
      }
      continue;
    }

    if (ch.removed) {
      const next = changes[c + 1];
      const delCount = ch.count;
      const addCount = next && next.added ? next.count : 0;
      const n = Math.max(delCount, addCount);

      for (let k = 0; k < n; k++) {
        const l = k < delCount ? a[i + k] : undefined;
        const r = k < addCount ? b[j + k] : undefined;
        if (l && r) {
          const [lc, rc] = withSegs(l, r, o.ignoreWhitespace);
          rows.push({ kind: 'changed', left: lc, right: rc });
        } else if (l) {
          rows.push({ kind: 'removed', left: l });
        } else if (r) {
          rows.push({ kind: 'added', right: r });
        }
      }
      i += delCount;
      j += addCount;
      if (addCount) c++;
      continue;
    }

    // added only
    for (let k = 0; k < ch.count; k++) rows.push({ kind: 'added', right: b[j + k] });
    j += ch.count;
  }

  if (!tokenMode) return rows;
  return refineByTokens(rows, leftText, rightText, o);
}

export function computeStats(rows: Row[]): Stats {
  const s: Stats = { added: 0, removed: 0, changed: 0, blocks: 0 };
  let prevEqual = true;
  for (const r of rows) {
    if (r.kind === 'added') s.added++;
    else if (r.kind === 'removed') s.removed++;
    else if (r.kind === 'changed') s.changed++;
    if (r.kind !== 'equal' && prevEqual) s.blocks++;
    prevEqual = r.kind === 'equal';
  }
  return s;
}

/** Compact list of real changes, sent to the model so it focuses on what differs. */
export function summarizeForAi(rows: Row[], max = 18000): string {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind === 'equal') continue;
    if (r.left) out.push(`- [L${r.left.no}] ${r.left.text.trim()}`);
    if (r.right) out.push(`+ [R${r.right.no}] ${r.right.text.trim()}`);
  }
  const text = out.join('\n');
  return text.length > max ? text.slice(0, max) + '\n... (truncated)' : text;
}
