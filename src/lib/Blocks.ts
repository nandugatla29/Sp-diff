import { splitLines, tokenize, type Tok } from './SqlTokens';

/* A light T-SQL structure parser. It does not validate SQL; it only finds where statements and
   BEGIN..END / IF / ELSE / WHILE / TRY..CATCH blocks start and end, so code can be moved as
   complete units. */

export type NodeKind = 'root' | 'stmt' | 'create' | 'if' | 'while' | 'else' | 'block' | 'try';

export interface Node {
  kind: NodeKind;
  from: number; // first line (1-based)
  to: number; // last line
  headEnd: number; // last line of the header (IF condition, WHILE condition); = from otherwise
  head: string; // normalised header text, used to match containers between two versions
  verb: string;
  kids: Node[];
  parent: Node | null;
}

export interface Tree {
  root: Node;
  lines: string[];
  issues: number; // unbalanced BEGIN/END found while parsing
}

const START = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'SET', 'DECLARE', 'EXEC', 'EXECUTE', 'IF', 'WHILE',
  'RETURN', 'PRINT', 'RAISERROR', 'THROW', 'COMMIT', 'ROLLBACK', 'SAVE', 'TRUNCATE', 'DROP', 'CREATE',
  'ALTER', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE', 'GOTO', 'BREAK', 'CONTINUE', 'WAITFOR', 'USE', 'GO',
  'BEGIN', 'WITH', 'GRANT', 'REVOKE', 'DENY', 'BACKUP', 'RESTORE', 'DBCC', 'KILL',
]);
const TRAN_WORDS = new Set(['TRAN', 'TRANSACTION', 'DISTRIBUTED', 'DIALOG', 'CONVERSATION']);
const CREATE_OBJ = new Set(['PROC', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'VIEW']);

interface SState {
  set: boolean; // UPDATE ... SET already seen
  src: boolean; // INSERT already has its SELECT / EXEC / VALUES
  withP: boolean; // WITH cte AS (...) still waiting for its main statement
}

function startsNew(head: string, t: Tok, prev: Tok, n1: Tok | undefined, n2: Tok | undefined, st: SState): boolean {
  const K = t.k;
  const P = prev.type === 'word' ? prev.k : prev.t;
  if (head === 'MERGE') return false;
  if (K === 'WITH') return !!n1 && (n1.type === 'word' || n1.type === 'ident') && (n2?.k === 'AS' || n2?.t === '(') && P !== ',';
  if (head === 'WITH' && st.withP && (K === 'SELECT' || K === 'INSERT' || K === 'UPDATE' || K === 'DELETE')) {
    st.withP = false;
    return false;
  }
  switch (K) {
    case 'SELECT':
      if (head === 'INSERT' && !st.src) {
        st.src = true;
        return false;
      }
      return !['UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'FOR', 'AS'].includes(P);
    case 'EXEC':
    case 'EXECUTE':
      if (head === 'INSERT' && !st.src) {
        st.src = true;
        return false;
      }
      return P !== 'AS';
    case 'INSERT':
    case 'DELETE':
    case 'UPDATE':
      return !['FOR', 'ON', ',', 'AFTER', 'BEFORE', 'INSTEAD', 'OF', 'OR', 'WHEN', 'THEN', 'AND'].includes(P);
    case 'SET':
      if (head === 'UPDATE' && !st.set) {
        st.set = true;
        return false;
      }
      return !['ALTER', 'CREATE', 'DROP'].includes(head);
    case 'IF':
      return !['DROP', 'CREATE', 'ALTER'].includes(head);
    case 'DROP':
      return head !== 'ALTER';
    case 'CREATE':
    case 'ALTER':
      return head === 'ALTER' ? false : head === 'CREATE' ? P === ')' : true;
    case 'FETCH':
      return P !== 'ROW' && P !== 'ROWS';
    default:
      return true;
  }
}

const cache = new Map<string, Tree>();

export function parseSql(text: string): Tree {
  const hit = cache.get(text);
  if (hit) return hit;
  const tree = build(text);
  cache.set(text, tree);
  if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  return tree;
}

function build(text: string): Tree {
  const lines = splitLines(text);
  const toks = tokenize(text).filter((t) => t.type !== 'comment');
  const n = toks.length;
  let i = 0;
  let issues = 0;

  const W = (k: number) => (toks[k]?.type === 'word' ? toks[k].k : '');
  const lineOf = (k: number) => toks[Math.min(Math.max(k, 0), n - 1)]?.line ?? 1;
  const mk = (kind: NodeKind, from: number, parent: Node | null): Node => ({
    kind, from, to: from, headEnd: from, head: '', verb: '', kids: [], parent,
  });
  const headKey = (a: number, b: number) =>
    lines.slice(a - 1, b).join(' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);

  const parseSeq = (parent: Node, inBlock: boolean) => {
    while (i < n) {
      const k = W(i);
      if (k === 'END') {
        if (inBlock) return;
        issues++;
        i++;
        continue;
      }
      if (toks[i].t === ';') {
        i++;
        continue;
      }
      if (k === 'ELSE') {
        issues++;
        i++;
        continue;
      }
      parent.kids.push(parseStmt(parent));
    }
  };

  const parseBlock = (parent: Node): Node => {
    const node = mk('block', lineOf(i), parent);
    node.head = 'begin';
    node.verb = 'BEGIN';
    i++;
    parseSeq(node, true);
    if (W(i) === 'END') {
      node.to = lineOf(i);
      i++;
    } else {
      issues++;
      node.to = lineOf(i - 1);
    }
    return node;
  };

  const parseTry = (parent: Node): Node => {
    const w = mk('try', lineOf(i), parent);
    w.head = 'begin try';
    w.verb = 'TRY';
    const part = (word: 'TRY' | 'CATCH') => {
      const b = mk('block', lineOf(i), w);
      b.head = `begin ${word.toLowerCase()}`;
      b.verb = word;
      i += 2;
      parseSeq(b, true);
      if (W(i) === 'END' && W(i + 1) === word) {
        b.to = lineOf(i);
        i += 2;
      } else {
        issues++;
        b.to = lineOf(i - 1);
      }
      w.kids.push(b);
    };
    part('TRY');
    if (W(i) === 'BEGIN' && W(i + 1) === 'CATCH') part('CATCH');
    else issues++;
    w.to = Math.max(w.from, ...w.kids.map((k) => k.to));
    return w;
  };

  const parseCond = (kind: 'if' | 'while', parent: Node): Node => {
    const node = mk(kind, lineOf(i), parent);
    node.verb = W(i);
    i++;
    let depth = 0;
    let last = node.from;
    while (i < n) {
      const t = toks[i];
      if (t.type === 'op') {
        if (t.t === '(') depth++;
        else if (t.t === ')') depth--;
        last = t.line;
        i++;
        continue;
      }
      if (depth <= 0 && t.type === 'word') {
        if (t.k === 'ELSE' || t.k === 'END') break;
        if (START.has(t.k) && !(t.k === 'UPDATE' && toks[i + 1]?.t === '(')) break;
      }
      last = t.line;
      i++;
    }
    node.headEnd = last;
    node.head = headKey(node.from, last);
    if (i < n && W(i) !== 'END' && W(i) !== 'ELSE') node.kids.push(parseStmt(node));
    if (kind === 'if' && W(i) === 'ELSE') {
      const e = mk('else', lineOf(i), node);
      e.head = 'else';
      e.verb = 'ELSE';
      i++;
      if (i < n && W(i) !== 'END' && W(i) !== 'ELSE') e.kids.push(parseStmt(e));
      e.to = Math.max(e.from, lineOf(i - 1));
      node.kids.push(e);
    }
    node.to = Math.max(node.headEnd, lineOf(i - 1));
    return node;
  };

  const parseSimple = (parent: Node): Node => {
    const first = toks[i];
    const head = first.k;
    const node = mk('stmt', first.line, parent);
    node.verb = head;

    if (head === 'CREATE' || head === 'ALTER') {
      let j = i + 1;
      if (W(j) === 'OR' && W(j + 1) === 'ALTER') j += 2;
      if (CREATE_OBJ.has(W(j))) {
        node.kind = 'create';
        let depth = 0;
        while (i < n) {
          const t = toks[i];
          if (t.type === 'op') {
            if (t.t === '(') depth++;
            else if (t.t === ')') depth--;
          } else if (depth <= 0 && t.type === 'word' && t.k === 'AS' && i > 0 && toks[i - 1].k !== 'EXECUTE') {
            i++;
            break;
          }
          i++;
        }
        node.to = lineOf(i - 1);
        node.headEnd = node.to;
        node.head = headKey(node.from, node.to);
        return node;
      }
    }

    const st: SState = { set: false, src: false, withP: head === 'WITH' };
    let depth = 0;
    let caseDepth = 0;
    let prev = first;
    i++;
    while (i < n) {
      const t = toks[i];
      if (t.type === 'op') {
        if (t.t === '(') depth++;
        else if (t.t === ')') depth--;
        else if (t.t === ';' && depth <= 0) {
          i++;
          break;
        }
        prev = t;
        i++;
        continue;
      }
      if (t.type === 'word') {
        if (t.k === 'CASE') {
          caseDepth++;
          prev = t;
          i++;
          continue;
        }
        if (t.k === 'END') {
          if (caseDepth > 0) {
            caseDepth--;
            prev = t;
            i++;
            continue;
          }
          break;
        }
        if (t.k === 'VALUES') st.src = true;
        if (depth <= 0 && caseDepth === 0) {
          if (t.k === 'ELSE') break;
          if (START.has(t.k) && startsNew(head, t, prev, toks[i + 1], toks[i + 2], st)) break;
        }
      }
      prev = t;
      i++;
    }
    node.to = Math.max(node.from, lineOf(i - 1));
    node.headEnd = node.to;
    return node;
  };

  function parseStmt(parent: Node): Node {
    const k = W(i);
    if (k === 'IF') return parseCond('if', parent);
    if (k === 'WHILE') return parseCond('while', parent);
    if (k === 'BEGIN') {
      const k2 = W(i + 1);
      if (k2 === 'TRY') return parseTry(parent);
      if (!TRAN_WORDS.has(k2)) return parseBlock(parent);
    }
    if (k === 'GO') {
      const g = mk('stmt', lineOf(i), parent);
      g.verb = 'GO';
      i++;
      return g;
    }
    return parseSimple(parent);
  }

  const root = mk('root', 1, null);
  root.to = lines.length;
  root.headEnd = 0;
  root.head = 'root';
  parseSeq(root, false);
  return { root, lines, issues };
}

/* ---------------------------------------------------------------- navigation */

export const isSeq = (n: Node) => n.kind === 'root' || n.kind === 'block';

export function depthOf(n: Node): number {
  let d = 0;
  for (let c: Node | null = n; c; c = c.parent) if (c.kind === 'block') d++;
  return d;
}

/** Identity of a container that survives edits to its body: "if @x = 1#0" etc. */
export function seqSig(n: Node): string {
  if (n.kind === 'root') return 'root';
  const p = n.parent;
  return p ? `${p.kind}:${p.head}#${p.kids.indexOf(n)}` : 'block';
}

/** Containers (root, then nested BEGIN..END bodies) that hold line p (or the gap right after line p). */
export function seqChain(tree: Tree, p: number, mode: 'line' | 'after'): Node[] {
  const chain: Node[] = [tree.root];
  const walk = (node: Node) => {
    for (const k of node.kids) {
      if (p < k.from) return;
      if (p > k.to) continue;
      if (k.kind === 'block') {
        const inside = mode === 'after' ? p >= k.from && p < k.to : p > k.from && p < k.to;
        if (!inside) return;
        chain.push(k);
      }
      walk(k);
      return;
    }
  };
  walk(tree.root);
  return chain;
}

/** Line number at which new statements should be inserted so they land after line p inside `seq`. */
export function insertPos(seq: Node, p: number): number {
  let idx = -1;
  seq.kids.forEach((k, n) => {
    if (k.from <= p) idx = n;
  });
  if (idx >= 0) return Math.max(seq.kids[idx].to, p) + 1;
  return seq.kind === 'root' ? 1 : seq.from + 1;
}

/* --------------------------------------------------------------------- cover */

export interface Cover {
  seq: Node; // container whose children [i0..i1] make up the unit
  i0: number;
  i1: number;
  from: number;
  to: number;
  headOnly: boolean; // only the IF / WHILE condition lines
  gap: boolean; // range is between statements (comments / blank lines), no unit found
  climbed: number;
}

function innerSeq(k: Node, from: number, to: number): Node | null {
  if (k.kind === 'block') return from > k.from && to < k.to ? k : null;
  if (k.kind === 'stmt' || k.kind === 'create') return null;
  for (const c of k.kids) if (c.from <= from && to <= c.to) return innerSeq(c, from, to);
  return null;
}

function overlap(seq: Node, from: number, to: number) {
  const ks = seq.kids;
  const i0 = ks.findIndex((k) => k.to >= from);
  let i1 = -1;
  for (let i = ks.length - 1; i >= 0; i--)
    if (ks[i].from <= to) {
      i1 = i;
      break;
    }
  return { i0, i1, none: i0 < 0 || i1 < i0 };
}

/** Siblings of `seq` that overlap the range, without descending into inner blocks. */
export function coverFlat(seq: Node, from: number, to: number): Cover {
  const o = overlap(seq, from, to);
  if (o.none) return { seq, i0: -1, i1: -1, from, to, headOnly: false, gap: true, climbed: 0 };
  return { seq, i0: o.i0, i1: o.i1, from: seq.kids[o.i0].from, to: seq.kids[o.i1].to, headOnly: false, gap: false, climbed: 0 };
}

function base(seq: Node, from: number, to: number): Cover {
  const c = coverFlat(seq, from, to);
  if (c.gap || c.i0 !== c.i1) return c;
  const k = seq.kids[c.i0];
  if (k.from <= from && to <= k.to) {
    if ((k.kind === 'if' || k.kind === 'while') && from <= k.headEnd) {
      const ho = to <= k.headEnd && k.headEnd < k.to;
      return { ...c, to: ho ? k.headEnd : k.to, headOnly: ho };
    }
    const inner = innerSeq(k, from, to);
    if (inner) return base(inner, from, to);
  }
  return c;
}

/** Moves a cover one step outwards: condition -> whole IF -> enclosing statement -> ... */
export function climb(c: Cover): Cover | null {
  if (c.gap) return null;
  if (c.headOnly) {
    const k = c.seq.kids[c.i0];
    return { ...c, from: k.from, to: k.to, headOnly: false, climbed: c.climbed + 1 };
  }
  if (c.seq.kind === 'root') return null;
  let s: Node = c.seq;
  while (s.parent && !isSeq(s.parent)) s = s.parent;
  const par = s.parent;
  if (!par) return null;
  const idx = par.kids.indexOf(s);
  return { seq: par, i0: idx, i1: idx, from: s.from, to: s.to, headOnly: false, gap: false, climbed: c.climbed + 1 };
}

export function climbN(c: Cover, n: number): Cover {
  let cur = c;
  for (let l = 0; l < n; l++) {
    const nx = climb(cur);
    if (!nx) break;
    cur = nx;
  }
  return cur;
}

/** Smallest complete unit(s) containing [from,to], widened `level` steps. */
export function coverRange(tree: Tree, from: number, to: number, level: number): Cover & { maxLevel: number } {
  const c0 = base(tree.root, from, to);
  let maxLevel = 0;
  for (let t = climb(c0); t; t = climb(t)) maxLevel++;
  return { ...climbN(c0, level), maxLevel };
}

/** First line a unit may start on once directly attached comment lines are included. */
export function lowerBound(c: Cover): number {
  if (c.i0 > 0) return c.seq.kids[c.i0 - 1].to + 1;
  return c.seq.kind === 'root' ? 1 : c.seq.from + 1;
}

export function extendComments(lines: string[], from: number, lower: number): number {
  let f = from;
  while (f - 1 >= lower && /^\s*(--|\/\*)/.test(lines[f - 2] ?? '')) f--;
  return f;
}

export function nodeName(k: Node): string {
  switch (k.kind) {
    case 'if':
      return k.kids.some((c) => c.kind === 'else') ? 'IF / ELSE block' : 'IF block';
    case 'while':
      return 'WHILE loop';
    case 'try':
      return 'TRY / CATCH block';
    case 'block':
      return 'BEGIN … END block';
    case 'create':
      return 'procedure header';
    default:
      return k.verb ? `${k.verb} statement` : 'statement';
  }
}