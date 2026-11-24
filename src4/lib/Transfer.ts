import type { Plan, Range, Side } from '../types';
import {
  type Cover,
  type Node,
  climbN,
  coverFlat,
  coverRange,
  depthOf,
  extendComments,
  insertPos,
  lowerBound,
  nodeName,
  parseSql,
  seqChain,
  seqSig,
} from './Blocks';
import { analyzeVars } from './Vars';

export interface PlanInput {
  src: string;
  dst: string;
  srcSel: Range | null; // lines in the source that should be moved
  dstSel: Range | null; // the lines the diff pairs with them in the destination (null = pure addition)
  dstAfter: number; // last destination line before the change (insertion anchor)
  s2d: Map<number, number>; // source line -> destination line, from the diff alignment
  level: number; // -1 exact lines, 0 smart (complete units), n widen n steps
  target: Side; // which side's text changes
  srcName: string;
  dstName: string;
}

const TRIVIAL = new Set(['begin', 'end', 'else', 'go', 'return', 'commit', 'rollback', 'beginandtry', 'endtry', 'begincatch', 'endcatch']);
const trivialLine = (s: string) => {
  const k = s.trim().toLowerCase().replace(/[;\s]/g, '');
  return k.length < 4 || TRIVIAL.has(k);
};
const indentOf = (s: string) => /^[ \t]*/.exec(s)![0];
const rng = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

function pickSeq(chain: Node[], want: Node, warnings: string[], dstName: string): Node {
  const d = depthOf(want);
  const sig = seqSig(want);
  const order = chain.map((_, i) => i).sort((a, b) => Math.abs(a - d) - Math.abs(b - d));
  for (const i of order) if (seqSig(chain[i]) === sig) return chain[i];
  if (chain.length - 1 < d) warnings.push(`${dstName} has no matching enclosing block (${want.parent?.head ?? 'block'}); placed at the nearest level.`);
  return chain[Math.min(d, chain.length - 1)];
}

function describe(c: Cover): string {
  if (c.gap) return `${c.to - c.from + 1} line${c.to === c.from ? '' : 's'}`;
  const ks = c.seq.kids.slice(c.i0, c.i1 + 1);
  if (c.headOnly) return `${ks[0].kind === 'while' ? 'WHILE' : 'IF'} condition`;
  if (ks.length === 1) return nodeName(ks[0]);
  return `${ks.length} statements`;
}

function reindent(block: string[], to: string): string[] {
  const first = block.find((l) => l.trim() !== '');
  if (first === undefined) return block;
  const from = indentOf(first);
  if (from === to) return block;
  return block.map((l) => {
    if (l.trim() === '') return l;
    return to + (l.startsWith(from) ? l.slice(from.length) : l.trimStart());
  });
}

function insertIndent(seq: Node, at: number, lines: string[]): string {
  const prev = [...seq.kids].reverse().find((k) => k.to < at);
  if (prev) return indentOf(lines[prev.from - 1] ?? '');
  const next = seq.kids.find((k) => k.from >= at);
  if (next) return indentOf(lines[next.from - 1] ?? '');
  if (seq.kind === 'root') return '';
  const h = lines[seq.from - 1] ?? '';
  return indentOf(h) + (h.startsWith('\t') ? '\t' : '    ');
}

/**
 * Works out what a transfer should really do:
 *  - the source lines are widened to complete statements / blocks,
 *  - the destination is the matching complete unit (or the right insertion point inside the
 *    matching enclosing block when there is nothing to replace),
 *  - the code is re-indented to its new surroundings,
 *  - the result is checked for unbalanced BEGIN/END and for variables the destination never declares.
 */
export function makePlan(inp: PlanInput): Plan | null {
  const { srcSel, dstSel, level } = inp;
  if (!srcSel && !dstSel) return null;
  const st = parseSql(inp.src);
  const dt = parseSql(inp.dst);
  const dLines = dt.lines;
  const warnings: string[] = [];

  let op: Plan['op'];
  let sFrom = 0;
  let sTo = 0;
  let dFrom = 0;
  let dTo = 0;
  let what = '';
  let maxLevel = 0;
  let indent: string | null = null; // destination indentation for inserted code

  const S = srcSel && level >= 0 ? coverRange(st, srcSel.from, srcSel.to, level) : null;
  const exact = level < 0 || (S?.gap ?? false);

  if (exact) {
    if (srcSel) {
      sFrom = srcSel.from;
      sTo = srcSel.to;
    }
    if (srcSel && dstSel) {
      op = 'replace';
      dFrom = dstSel.from;
      dTo = dstSel.to;
    } else if (srcSel) {
      op = 'insert';
      dFrom = Math.min(inp.dstAfter, dLines.length) + 1;
      dTo = dFrom - 1;
      indent = indentOf(dLines[dFrom - 2] ?? '');
    } else {
      op = 'delete';
      dFrom = dstSel!.from;
      dTo = dstSel!.to;
    }
    const cnt = (srcSel ? sTo - sFrom : dTo - dFrom) + 1;
    what = `${cnt} line${cnt === 1 ? '' : 's'} (exact)`;
    maxLevel = coverRange(srcSel ? st : dt, (srcSel ?? dstSel)!.from, (srcSel ?? dstSel)!.to, 0).maxLevel;
  } else if (S && dstSel) {
    // ---- replace: find the destination unit that corresponds to the source unit
    let sc: Cover & { maxLevel: number } = S;
    maxLevel = S.maxLevel;
    const win = S.to - S.from + 11;
    let tmin = dstSel.from;
    let tmax = dstSel.to;
    for (let l = S.from; l <= S.to; l++) {
      const d = inp.s2d.get(l);
      if (d === undefined || trivialLine(st.lines[l - 1] ?? '')) continue;
      if (d < dstSel.from - win || d > dstSel.to + win) continue;
      tmin = Math.min(tmin, d);
      tmax = Math.max(tmax, d);
    }
    const container = pickSeq(seqChain(dt, dstSel.from, 'line'), S.seq, warnings, inp.dstName);
    const lo = container.kind === 'root' ? 1 : container.from + 1;
    const hi = container.kind === 'root' ? dLines.length : container.to - 1;
    const a = Math.max(lo, Math.min(tmin, hi));
    const b = Math.max(a, Math.min(tmax, hi));
    let D = coverFlat(container, a, b);
    if (D.gap) {
      op = 'insert';
      dFrom = insertPos(container, a - 1);
      dTo = dFrom - 1;
      indent = insertIndent(container, dFrom, dLines);
      sFrom = extendComments(st.lines, S.from, lowerBound(S));
      sTo = S.to;
      what = describe(S);
    } else {
      D = climbN(D, S.climbed);
      sFrom = S.from;
      sTo = S.to;
      if (S.headOnly) {
        const sk = S.seq.kids[S.i0];
        const dk = D.i0 === D.i1 ? D.seq.kids[D.i0] : null;
        if (dk && dk.kind === sk.kind) {
          D = { ...D, to: dk.headEnd, headOnly: true };
        } else {
          sc = { ...S, to: sk.to, headOnly: false };
          sTo = sk.to;
        }
      }
      if (!sc.headOnly) sFrom = extendComments(st.lines, sc.from, lowerBound(sc));
      dFrom = D.headOnly ? D.from : extendComments(dLines, D.from, lowerBound(D));
      dTo = D.to;
      op = 'replace';
      what = describe(sc);
    }
  } else if (S) {
    // ---- insert: put the unit inside the matching container, right after the aligned neighbour
    maxLevel = S.maxLevel;
    const p = inp.dstAfter;
    const container = pickSeq(seqChain(dt, p, 'after'), S.seq, warnings, inp.dstName);
    dFrom = Math.min(insertPos(container, p), dLines.length + 1);
    dTo = dFrom - 1;
    indent = insertIndent(container, dFrom, dLines);
    const sc = S.headOnly ? { ...S, to: S.seq.kids[S.i0].to, headOnly: false } : S;
    sFrom = extendComments(st.lines, sc.from, lowerBound(sc));
    sTo = sc.to;
    op = 'insert';
    what = describe(sc);
  } else {
    // ---- delete: remove whole units, never half a statement
    const D = coverRange(dt, dstSel!.from, dstSel!.to, level);
    maxLevel = D.maxLevel;
    dFrom = D.gap || D.headOnly ? D.from : extendComments(dLines, D.from, lowerBound(D));
    dTo = D.to;
    op = 'delete';
    what = describe(D);
  }

  // ---- build the new destination text
  const eol = inp.dst.includes('\r\n') ? '\r\n' : '\n';
  let block: string[] = [];
  if (op !== 'delete') {
    block = st.lines.slice(sFrom - 1, sTo);
    const to = indent ?? indentOf(dLines[dFrom - 1] ?? '');
    block = reindent(block, to);
  }
  const head = dLines.slice(0, dFrom - 1);
  const tail = op === 'insert' ? dLines.slice(dFrom - 1) : dLines.slice(dTo);
  const text = [...head, ...block, ...tail].join(eol);

  // ---- safety checks on the result
  const nt = parseSql(text);
  if (nt.issues > dt.issues) warnings.push(`Result has unbalanced BEGIN/END (${nt.issues} vs ${dt.issues} before). Check the edges of the moved code.`);
  const before = analyzeVars(inp.dst);
  const after = analyzeVars(text);
  const srcVars = analyzeVars(inp.src);
  after.used.forEach((v) => {
    // warn only for problems this transfer introduces, not ones the destination already had
    if (!after.declared.has(v) && !(before.used.has(v) && !before.declared.has(v))) {
      const d = srcVars.declared.get(v);
      warnings.push(`${v} is used but not declared in ${inp.dstName}${d ? `. Declared in ${inp.srcName} as: ${d.text}` : ''}`);
    }
  });

  const where =
    op === 'insert' ? `into ${inp.dstName} after line ${dFrom - 1}` : op === 'delete' ? `from ${inp.dstName}` : `in ${inp.dstName}`;
  const label =
    op === 'delete'
      ? `Remove ${what} ${where} (lines ${rng(dFrom, dTo)})`
      : op === 'insert'
        ? `Insert ${what} ${where}`
        : `Replace ${inp.dstName} lines ${rng(dFrom, dTo)} with ${what}`;

  return {
    op,
    target: inp.target,
    srcFrom: op === 'delete' ? 0 : sFrom,
    srcTo: op === 'delete' ? 0 : sTo,
    dstFrom: dFrom,
    dstTo: dTo,
    label,
    level: Math.min(level, maxLevel),
    minLevel: -1,
    maxLevel,
    warnings,
    text,
  };
}