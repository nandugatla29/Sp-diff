// import type { Hunk, HunkAssistRequest, HunkSide, Range, Risk, Row, Side } from '../types';

// const CTX = 12;
// const ORDER: Risk[] = ['info', 'low', 'medium', 'high'];
// const worst = (a: Risk, b: Risk): Risk => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

// const RULES: { re: RegExp; label: string; risk: Risk; hint: string }[] = [
//   { re: /\b(insert|update|delete|merge|truncate|drop)\b/i, label: 'Data modification', risk: 'high', hint: 'Changes what gets written to or removed from tables.' },
//   { re: /\b(begin\s+tran(saction)?|commit|rollback|try|catch|throw|raiserror)\b/i, label: 'Transaction / error handling', risk: 'high', hint: 'Changes how failures and rollbacks behave.' },
//   { re: /\bexec(ute)?\b|sp_executesql/i, label: 'Procedure call', risk: 'high', hint: 'Calls another procedure or runs dynamic SQL.' },
//   { re: /\b[a-z_]\w*\.[a-z_]\w*\.[a-z_]\w*\.[a-z_]\w*\b/i, label: 'Linked server reference', risk: 'medium', hint: 'Four-part names are usually environment-specific. Check before copying.' },
//   { re: /\b(where|having|exists|between|like|and|or)\b|is\s+(not\s+)?null/i, label: 'Filter condition', risk: 'medium', hint: 'Changes which rows are included.' },
//   { re: /\bjoin\b/i, label: 'Join logic', risk: 'medium', hint: 'Changes how tables are related, which can add or drop rows.' },
//   { re: /\b(group\s+by|order\s+by|distinct|top|row_number|over)\b/i, label: 'Grouping / ordering / limit', risk: 'medium', hint: 'Changes aggregation, sort order or row limit.' },
//   { re: /\bnolock\b|\bwith\s*\(/i, label: 'Table hint', risk: 'medium', hint: 'Changes locking behaviour.' },
//   { re: /\bdeclare\b|\bset\s+@|^\s*@\w+\s+\w+/i, label: 'Variable / parameter', risk: 'low', hint: 'Changes a variable or parameter definition.' },
//   { re: /\b(select|from|as|case|when|then|else|end)\b/i, label: 'Select logic', risk: 'low', hint: 'Changes what is selected or how a value is computed.' },
// ];

// function hash(s: string): string {
//   let h = 5381;
//   for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
//   return (h >>> 0).toString(36);
// }

// const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// const lines = (t: string) => t.split(/\r\n|\r|\n/);
// const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// const span = (r: Range | null, p: string) => (r ? `${p}${r.from}${r.to > r.from ? '–' + r.to : ''}` : '');
// export const lineLabel = (h: Hunk) => [span(h.left, 'L'), span(h.right, 'R')].filter(Boolean).join(' · ');

// function valueChanges(rows: Row[], L: string, R: string): string[] {
//   const out: string[] = [];
//   for (const r of rows) {
//     if (r.kind !== 'changed' || !r.left?.segs || !r.right?.segs) continue;
//     const del = r.left.segs.filter((s) => s.type === 'del').map((s) => s.text.trim()).filter(Boolean).join(' ');
//     const add = r.right.segs.filter((s) => s.type === 'add').map((s) => s.text.trim()).filter(Boolean).join(' ');
//     if ((!del && !add) || del.length > 50 || add.length > 50) continue;
//     out.push(`${L} has \`${del || '(nothing)'}\`, ${R} has \`${add || '(nothing)'}\``);
//   }
//   return out;
// }

// export function buildHunks(rows: Row[], leftName: string, rightName: string): Hunk[] {
//   const L = leftName || 'Left';
//   const R = rightName || 'Right';
//   const hunks: Hunk[] = [];
//   const seen = new Map<string, number>();
//   let lastL = 0;
//   let lastR = 0;
//   let i = 0;

//   while (i < rows.length) {
//     const row = rows[i];
//     if (row.kind === 'equal') {
//       lastL = row.left?.no ?? lastL;
//       lastR = row.right?.no ?? lastR;
//       i++;
//       continue;
//     }

//     const start = i;
//     let left: Range | null = null;
//     let right: Range | null = null;
//     let added = 0;
//     let removed = 0;
//     let changed = 0;

//     while (i < rows.length && rows[i].kind !== 'equal') {
//       const x = rows[i];
//       if (x.left) left = left ? { from: left.from, to: x.left.no } : { from: x.left.no, to: x.left.no };
//       if (x.right) right = right ? { from: right.from, to: x.right.no } : { from: x.right.no, to: x.right.no };
//       if (x.kind === 'added') added++;
//       else if (x.kind === 'removed') removed++;
//       else changed++;
//       i++;
//     }

//     const slice = rows.slice(start, i);
//     const kind: Hunk['kind'] = changed === 0 && removed === 0 ? 'added' : changed === 0 && added === 0 ? 'removed' : 'changed';

//     // Explanation (local, instant)
//     const text = slice.flatMap((r) => [r.left?.text, r.right?.text]).join('\n').replace(/[[\]]/g, '');
//     const matched = RULES.filter((r) => r.re.test(text));
//     const label = matched[0]?.label ?? 'Code';
//     let risk: Risk = matched.length ? 'low' : 'info';
//     for (const m of matched) risk = worst(risk, m.risk);

//     const notes: string[] = [];
//     if (kind === 'added') notes.push(`${R} has ${plural(added, 'extra line')} that ${L} does not.`);
//     else if (kind === 'removed') notes.push(`${L} has ${plural(removed, 'line')} that ${R} does not.`);
//     else {
//       let s = `${plural(changed, 'line')} differ between ${L} and ${R}`;
//       if (added) s += `, plus ${plural(added, 'extra line')} in ${R}`;
//       if (removed) s += `, plus ${plural(removed, 'extra line')} in ${L}`;
//       notes.push(s + '.');
//     }
//     const vc = valueChanges(slice, L, R);
//     vc.slice(0, 4).forEach((v) => notes.push(v));
//     if (vc.length > 4) notes.push(`…and ${vc.length - 4} more edited lines.`);
//     matched.slice(0, 3).forEach((m) => notes.push(`${m.label}: ${m.hint}`));

//     const kindText = kind === 'added' ? `only in ${R}` : kind === 'removed' ? `only in ${L}` : 'modified';
//     const first = (slice[0].left ?? slice[0].right)!;
//     const sigBase = hash(slice.map((r) => `${r.left?.key ?? ''}\u0001${r.right?.key ?? ''}`).join('\u0002'));
//     const n = seen.get(sigBase) ?? 0;
//     seen.set(sigBase, n + 1);

//     hunks.push({
//       id: hunks.length,
//       sig: `${sigBase}-${n}`,
//       rowStart: start,
//       rowEnd: i - 1,
//       kind,
//       left,
//       right,
//       leftAfter: lastL,
//       rightAfter: lastR,
//       added,
//       removed,
//       changed,
//       title: `${label} · ${kindText}`,
//       notes,
//       risk,
//       preview: clip(first.text.trim(), 80),
//     });

//     if (left) lastL = left.to;
//     if (right) lastR = right.to;
//   }
//   return hunks;
// }

// /* ---------- applying a change (pure text, no AI) ---------- */

// function splice(text: string, range: Range | null, after: number, repl: string[]): string {
//   const eol = text.includes('\r\n') ? '\r\n' : '\n';
//   const all = lines(text);
//   if (range) all.splice(range.from - 1, range.to - range.from + 1, ...repl);
//   else all.splice(after, 0, ...repl);
//   return all.join(eol);
// }

// /** New text for `target` after copying this change over from the other side. */
// export function takeFromSide(h: Hunk, target: Side, left: string, right: string): string {
//   const srcText = target === 'left' ? right : left;
//   const srcRange = target === 'left' ? h.right : h.left;
//   const dstText = target === 'left' ? left : right;
//   const dstRange = target === 'left' ? h.left : h.right;
//   const dstAfter = target === 'left' ? h.leftAfter : h.rightAfter;
//   const repl = srcRange ? lines(srcText).slice(srcRange.from - 1, srcRange.to) : [];
//   return splice(dstText, dstRange, dstAfter, repl);
// }

// /** New text for `target` after replacing this change's lines with `replacement` (AI fix). */
// export function replaceHunk(h: Hunk, target: Side, text: string, replacement: string): string {
//   const range = target === 'left' ? h.left : h.right;
//   const after = target === 'left' ? h.leftAfter : h.rightAfter;
//   const clean = replacement.replace(/\r?\n$/, '');
//   return splice(text, range, after, clean === '' ? [] : lines(clean));
// }

// /* ---------- small AI payload ---------- */

// function context(all: string[], r: Range | null, after: number): HunkSide {
//   const s = r ? r.from - 1 : after;
//   const e = r ? r.to : after;
//   return {
//     before: all.slice(Math.max(0, s - CTX), s).join('\n'),
//     body: r ? all.slice(r.from - 1, r.to).join('\n') : '',
//     after: all.slice(e, e + CTX).join('\n'),
//   };
// }

// export function buildHunkRequest(
//   h: Hunk,
//   mode: 'explain' | 'fix',
//   target: Side,
//   left: string,
//   right: string,
//   leftName: string,
//   rightName: string,
//   instruction?: string,
// ): HunkAssistRequest {
//   return {
//     mode,
//     target,
//     leftName,
//     rightName,
//     instruction: instruction?.trim() || undefined,
//     left: context(lines(left), h.left, h.leftAfter),
//     right: context(lines(right), h.right, h.rightAfter),
//   };
// }


import type { Hunk, HunkAssistRequest, HunkSide, Range, Risk, Row, Side } from '../types';

const CTX = 12;
const ORDER: Risk[] = ['info', 'low', 'medium', 'high'];
const worst = (a: Risk, b: Risk): Risk => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

const RULES: { re: RegExp; label: string; risk: Risk; hint: string }[] = [
  { re: /\b(insert|update|delete|merge|truncate|drop)\b/i, label: 'Data modification', risk: 'high', hint: 'Changes what gets written to or removed from tables.' },
  { re: /\b(begin\s+tran(saction)?|commit|rollback|try|catch|throw|raiserror)\b/i, label: 'Transaction / error handling', risk: 'high', hint: 'Changes how failures and rollbacks behave.' },
  { re: /\bexec(ute)?\b|sp_executesql/i, label: 'Procedure call', risk: 'high', hint: 'Calls another procedure or runs dynamic SQL.' },
  { re: /\b[a-z_]\w*\.[a-z_]\w*\.[a-z_]\w*\.[a-z_]\w*\b/i, label: 'Linked server reference', risk: 'medium', hint: 'Four-part names are usually environment-specific. Check before copying.' },
  { re: /\b(where|having|exists|between|like|and|or)\b|is\s+(not\s+)?null/i, label: 'Filter condition', risk: 'medium', hint: 'Changes which rows are included.' },
  { re: /\bjoin\b/i, label: 'Join logic', risk: 'medium', hint: 'Changes how tables are related, which can add or drop rows.' },
  { re: /\b(group\s+by|order\s+by|distinct|top|row_number|over)\b/i, label: 'Grouping / ordering / limit', risk: 'medium', hint: 'Changes aggregation, sort order or row limit.' },
  { re: /\bnolock\b|\bwith\s*\(/i, label: 'Table hint', risk: 'medium', hint: 'Changes locking behaviour.' },
  { re: /\bdeclare\b|\bset\s+@|^\s*@\w+\s+\w+/i, label: 'Variable / parameter', risk: 'low', hint: 'Changes a variable or parameter definition.' },
  { re: /\b(select|from|as|case|when|then|else|end)\b/i, label: 'Select logic', risk: 'low', hint: 'Changes what is selected or how a value is computed.' },
];

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const lines = (t: string) => t.split(/\r\n|\r|\n/);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const span = (r: Range | null, p: string) => (r ? `${p}${r.from}${r.to > r.from ? '–' + r.to : ''}` : '');
export const lineLabel = (h: Hunk) => [span(h.left, 'L'), span(h.right, 'R')].filter(Boolean).join(' · ');

function valueChanges(rows: Row[], L: string, R: string): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.kind !== 'changed' || !r.left?.segs || !r.right?.segs) continue;
    const del = r.left.segs.filter((s) => s.type === 'del').map((s) => s.text.trim()).filter(Boolean).join(' ');
    const add = r.right.segs.filter((s) => s.type === 'add').map((s) => s.text.trim()).filter(Boolean).join(' ');
    if ((!del && !add) || del.length > 50 || add.length > 50) continue;
    out.push(`${L} has \`${del || '(nothing)'}\`, ${R} has \`${add || '(nothing)'}\``);
  }
  return out;
}

export function buildHunks(rows: Row[], leftName: string, rightName: string): Hunk[] {
  const L = leftName || 'Left';
  const R = rightName || 'Right';
  const hunks: Hunk[] = [];
  const seen = new Map<string, number>();
  let lastL = 0;
  let lastR = 0;
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === 'equal') {
      lastL = row.left?.no ?? lastL;
      lastR = row.right?.no ?? lastR;
      i++;
      continue;
    }

    const start = i;
    let left: Range | null = null;
    let right: Range | null = null;
    let added = 0;
    let removed = 0;
    let changed = 0;

    while (i < rows.length && rows[i].kind !== 'equal') {
      const x = rows[i];
      if (x.left) left = left ? { from: left.from, to: x.left.no } : { from: x.left.no, to: x.left.no };
      if (x.right) right = right ? { from: right.from, to: x.right.no } : { from: x.right.no, to: x.right.no };
      if (x.kind === 'added') added++;
      else if (x.kind === 'removed') removed++;
      else changed++;
      i++;
    }

    const slice = rows.slice(start, i);
    const kind: Hunk['kind'] = changed === 0 && removed === 0 ? 'added' : changed === 0 && added === 0 ? 'removed' : 'changed';

    // Explanation (local, instant). Classify by what actually changed (highlighted segments),
    // not by the whole line, so "FROM t(NOLOCK) WHERE ..." with only NOLOCK changed is a table hint.
    const changedText = slice
      .flatMap((r) => [r.left, r.right])
      .map((c) => (c?.segs ? c.segs.filter((s) => s.type !== 'same').map((s) => s.text).join(' ') : c?.text ?? ''))
      .join('\n');
    const text = (changedText.trim() ? changedText : slice.flatMap((r) => [r.left?.text, r.right?.text]).join('\n')).replace(/[[\]]/g, '');
    // Words inside 'string literals' are data, not SQL: don't let a changed message look like a JOIN or SELECT.
    const STR = /N?'(?:[^']|'')*'?/g;
    const codeText = text.replace(STR, ' ');
    const stringOnly = !codeText.trim().replace(/[,;()+]/g, '') && STR.test(text);
    const matched = stringOnly ? [] : RULES.filter((r) => r.re.test(codeText));
    const label = stringOnly ? 'Message / string text' : matched[0]?.label ?? 'Code';
    let risk: Risk = matched.length || stringOnly ? 'low' : 'info';
    for (const m of matched) risk = worst(risk, m.risk);

    const notes: string[] = [];
    if (kind === 'added') notes.push(`${R} has ${plural(added, 'extra line')} that ${L} does not.`);
    else if (kind === 'removed') notes.push(`${L} has ${plural(removed, 'line')} that ${R} does not.`);
    else {
      let s = `${plural(changed, 'line')} differ between ${L} and ${R}`;
      if (added) s += `, plus ${plural(added, 'extra line')} in ${R}`;
      if (removed) s += `, plus ${plural(removed, 'extra line')} in ${L}`;
      notes.push(s + '.');
    }
    const vc = valueChanges(slice, L, R);
    vc.slice(0, 4).forEach((v) => notes.push(v));
    if (vc.length > 4) notes.push(`…and ${vc.length - 4} more edited lines.`);
    matched.slice(0, 3).forEach((m) => notes.push(`${m.label}: ${m.hint}`));

    const kindText = kind === 'added' ? `only in ${R}` : kind === 'removed' ? `only in ${L}` : 'modified';
    const first = (slice[0].left ?? slice[0].right)!;
    const sigBase = hash(slice.map((r) => `${r.left?.key ?? ''}\u0001${r.right?.key ?? ''}`).join('\u0002'));
    const n = seen.get(sigBase) ?? 0;
    seen.set(sigBase, n + 1);

    hunks.push({
      id: hunks.length,
      sig: `${sigBase}-${n}`,
      rowStart: start,
      rowEnd: i - 1,
      kind,
      left,
      right,
      leftAfter: lastL,
      rightAfter: lastR,
      added,
      removed,
      changed,
      title: `${label} · ${kindText}`,
      notes,
      risk,
      preview: clip(first.text.trim(), 80),
    });

    if (left) lastL = left.to;
    if (right) lastR = right.to;
  }
  return hunks;
}

/* ---------- applying changes (pure text, no AI) ---------- */

interface Edit {
  from: number; // 1-based first line to replace
  to: number; // inclusive; to < from means "insert before line `from`"
  repl: string[];
  seq: number; // order of the edit in the selection, keeps inserts at the same spot in order
}

/** Applies several line edits to a text. Edits are applied bottom-up so line numbers stay valid. */
function applyEdits(text: string, edits: Edit[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const all = lines(text);
  const ordered = [...edits].sort((a, b) => b.from - a.from || b.seq - a.seq);
  for (const e of ordered) all.splice(e.from - 1, Math.max(0, e.to - e.from + 1), ...e.repl);
  return all.join(eol);
}

function splice(text: string, range: Range | null, after: number, repl: string[]): string {
  const edit: Edit = range
    ? { from: range.from, to: range.to, repl, seq: 0 }
    : { from: after + 1, to: after, repl, seq: 0 };
  return applyEdits(text, [edit]);
}

/** New text for `target` after copying this change over from the other side. */
export function takeFromSide(h: Hunk, target: Side, left: string, right: string): string {
  const srcText = target === 'left' ? right : left;
  const srcRange = target === 'left' ? h.right : h.left;
  const dstText = target === 'left' ? left : right;
  const dstRange = target === 'left' ? h.left : h.right;
  const dstAfter = target === 'left' ? h.leftAfter : h.rightAfter;
  const repl = srcRange ? lines(srcText).slice(srcRange.from - 1, srcRange.to) : [];
  return splice(dstText, dstRange, dstAfter, repl);
}

/** New text for `target` after replacing this change's lines with `replacement` (AI fix). */
export function replaceHunk(h: Hunk, target: Side, text: string, replacement: string): string {
  const range = target === 'left' ? h.left : h.right;
  const after = target === 'left' ? h.leftAfter : h.rightAfter;
  const clean = replacement.replace(/\r?\n$/, '');
  return splice(text, range, after, clean === '' ? [] : lines(clean));
}

/* ---------- selection based editing ---------- */

/** Groups sorted row indices into [first, last] runs of consecutive rows. */
function runsOf(sel: number[]): [number, number][] {
  const sorted = Array.from(new Set(sel)).sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const i of sorted) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/** Raw line range a run of rows covers on one side (null when that side has no lines there). */
function sideRange(rows: Row[], a: number, b: number, side: Side): Range | null {
  let r: Range | null = null;
  for (let k = a; k <= b; k++) {
    const c = rows[k]?.[side];
    if (!c) continue;
    r = r ? { from: r.from, to: c.no } : { from: c.no, to: c.no };
  }
  return r;
}

/** Last raw line on `side` that sits above row `idx` (the insertion point). */
function lineBefore(rows: Row[], idx: number, side: Side): number {
  for (let k = idx - 1; k >= 0; k--) {
    const c = rows[k][side];
    if (c) return c.no;
  }
  return 0;
}

/**
 * Copies the selected rows from `from` over to the other side and returns the new text of that other side.
 * Each run of consecutive selected rows replaces the matching lines on the other side
 * (or is inserted at the right place when the other side has nothing there).
 * Selecting only rows that exist on the other side with no lines on `from` removes them.
 */
export function transferRows(rows: Row[], sel: number[], from: Side, left: string, right: string): string {
  const to: Side = from === 'left' ? 'right' : 'left';
  const srcLines = lines(from === 'left' ? left : right);
  const dstText = to === 'left' ? left : right;
  const edits: Edit[] = [];

  runsOf(sel).forEach(([a, b], seq) => {
    const s = sideRange(rows, a, b, from);
    const d = sideRange(rows, a, b, to);
    const repl = s ? srcLines.slice(s.from - 1, s.to) : [];
    if (d) edits.push({ from: d.from, to: d.to, repl, seq });
    else if (repl.length) {
      const after = lineBefore(rows, a, to);
      edits.push({ from: after + 1, to: after, repl, seq });
    }
  });

  return applyEdits(dstText, edits);
}

/** Removes the selected rows from one side and returns that side's new text. */
export function deleteRows(rows: Row[], sel: number[], side: Side, text: string): string {
  const edits: Edit[] = [];
  runsOf(sel).forEach(([a, b], seq) => {
    const d = sideRange(rows, a, b, side);
    if (d) edits.push({ from: d.from, to: d.to, repl: [], seq });
  });
  return applyEdits(text, edits);
}

/** Replaces one raw line (1-based). */
export function replaceLine(text: string, no: number, value: string): string {
  return applyEdits(text, [{ from: no, to: no, repl: [value], seq: 0 }]);
}

/* ---------- small AI payload ---------- */

function context(all: string[], r: Range | null, after: number): HunkSide {
  const s = r ? r.from - 1 : after;
  const e = r ? r.to : after;
  return {
    before: all.slice(Math.max(0, s - CTX), s).join('\n'),
    body: r ? all.slice(r.from - 1, r.to).join('\n') : '',
    after: all.slice(e, e + CTX).join('\n'),
  };
}

export function buildHunkRequest(
  h: Hunk,
  mode: 'explain' | 'fix',
  target: Side,
  left: string,
  right: string,
  leftName: string,
  rightName: string,
  instruction?: string,
): HunkAssistRequest {
  return {
    mode,
    target,
    leftName,
    rightName,
    instruction: instruction?.trim() || undefined,
    left: context(lines(left), h.left, h.leftAfter),
    right: context(lines(right), h.right, h.rightAfter),
  };
}