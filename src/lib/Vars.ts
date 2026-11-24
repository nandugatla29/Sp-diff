import type { VarMarks } from '../types';
import { splitLines, tokenize, type Tok } from './SqlTokens';

export interface VarInfo {
  declared: Map<string, { line: number; text: string }>;
  used: Set<string>;
}

const STOP = new Set([
  'SELECT', 'SET', 'INSERT', 'UPDATE', 'DELETE', 'EXEC', 'EXECUTE', 'IF', 'WHILE', 'BEGIN', 'PRINT',
  'RETURN', 'FETCH', 'OPEN', 'CLOSE', 'WITH', 'MERGE', 'RAISERROR', 'THROW', 'COMMIT', 'ROLLBACK',
]);
const HEADER_OBJ = new Set(['PROC', 'PROCEDURE', 'FUNCTION', 'TRIGGER']);

const isVar = (t?: Tok): t is Tok => !!t && t.type === 'var' && !t.t.startsWith('@@') && t.t.length > 1;

/** Finds @variables, where they are declared (DECLARE or procedure parameter) and where they are used. */
export function analyzeVars(text: string): VarInfo {
  const toks = tokenize(text).filter((t) => t.type !== 'comment');
  const lines = splitLines(text);
  const declared: VarInfo['declared'] = new Map();
  const used = new Set<string>();
  const declare = (t: Tok) => {
    const k = t.t.toLowerCase();
    if (!declared.has(k)) declared.set(k, { line: t.line, text: (lines[t.line - 1] ?? '').trim() });
  };

  // procedure / function parameters: everything before the first top-level AS
  const hi = toks.findIndex(
    (t, i) =>
      t.type === 'word' &&
      (t.k === 'CREATE' || t.k === 'ALTER') &&
      [1, 2, 3].some((o) => toks[i + o]?.type === 'word' && HEADER_OBJ.has(toks[i + o].k)),
  );
  if (hi >= 0) {
    let depth = 0;
    for (let i = hi + 1; i < toks.length; i++) {
      const t = toks[i];
      if (t.type === 'op') {
        if (t.t === '(') depth++;
        else if (t.t === ')') depth--;
        continue;
      }
      if (t.type === 'word' && t.k === 'AS' && depth <= 0 && toks[i - 1]?.k !== 'EXECUTE') break;
      if (isVar(t)) declare(t);
    }
  }

  // DECLARE @a INT, @b INT = 1
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type !== 'word' || toks[i].k !== 'DECLARE' || !isVar(toks[i + 1])) continue;
    let depth = 0;
    let expect = true;
    for (let j = i + 1; j < toks.length; j++) {
      const t = toks[j];
      if (t.type === 'op') {
        if (t.t === '(') depth++;
        else if (t.t === ')') depth--;
        else if (t.t === ';' && depth <= 0) break;
        else if (t.t === ',' && depth <= 0) expect = true;
        continue;
      }
      if (t.type === 'word' && depth <= 0 && STOP.has(t.k)) break;
      if (t.type === 'word' && t.k === 'DECLARE' && j > i) break;
      if (expect && isVar(t)) {
        declare(t);
        expect = false;
      }
    }
  }

  for (const t of toks) if (isVar(t)) used.add(t.t.toLowerCase());
  return { declared, used };
}

export interface VarDiff {
  left: VarMarks;
  right: VarMarks;
}

/** `only`: used on this side but nowhere on the other. `bad`: used here but never declared here. */
export function diffVars(left: string, right: string): VarDiff {
  const a = analyzeVars(left);
  const b = analyzeVars(right);
  const mk = (x: VarInfo, y: VarInfo): VarMarks => {
    const only = new Set<string>();
    for (const n of x.used) if (!y.used.has(n)) only.add(n);
    // Also flag declarations that exist on only one side, even if the variable is not used yet.
    for (const n of x.declared.keys()) if (!y.declared.has(n)) only.add(n);
    return {
      only,
      bad: new Set(Array.from(x.used).filter((n) => !x.declared.has(n))),
    };
  };
  return { left: mk(a, b), right: mk(b, a) };
}