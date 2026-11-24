import type { VarMarks } from '../types';

/**
 * Character-offset tokenizer + statement splitter for T-SQL.
 * Used by Ddl.ts (clean CREATE TABLE / ALTER scripts), Release.ts (lint) and CodeText.tsx (highlighting).
 * Independent from SqlTokens.ts, which stays as it is for the diff engine.
 */

export type LKind = 'ws' | 'comment' | 'str' | 'num' | 'var' | 'id' | 'kw' | 'punct' | 'op';

export interface LTok {
  text: string;
  kind: LKind;
  up: string; // upper-case text
  from: number;
  to: number;
}

export interface Unit {
  t0: number; // first / last index into `code`
  t1: number;
}

export const NO_VARS: VarMarks = { only: new Set(), bad: new Set() };

const KEYWORDS = new Set(
  `ADD ALL ALTER AND AS ASC AUTHORIZATION BEGIN BETWEEN BY CASCADE CASE CHECK CLUSTERED COLLATE COLUMN COMMIT CONSTRAINT CREATE CROSS CURSOR DECLARE DEFAULT DELETE DESC DISTINCT DROP ELSE END EXEC EXECUTE EXISTS FOR FOREIGN FROM FULL FUNCTION GO GRANT GROUP HAVING IDENTITY IF IN INCLUDE INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE MERGE NOCHECK NONCLUSTERED NOT NULL OFF ON OR ORDER OUTER PRIMARY PROC PROCEDURE REFERENCES RETURN RIGHT ROLLBACK SELECT SET TABLE THEN TOP TRIGGER TRUNCATE UNION UNIQUE UPDATE USE VALUES VIEW WHEN WHERE WHILE WITH`.split(
    ' ',
  ),
);

const OPS2 = new Set(['<=', '>=', '<>', '!=', '+=', '-=', '*=', '/=', '||']);

export function lex(text: string, keepTrivia = false): { toks: LTok[] } {
  const toks: LTok[] = [];
  const n = text.length;
  let i = 0;
  const push = (kind: LKind, from: number, to: number) => {
    if (!keepTrivia && (kind === 'ws' || kind === 'comment')) return;
    const t = text.slice(from, to);
    toks.push({ text: t, kind, up: t.toUpperCase(), from, to });
  };

  while (i < n) {
    const c = text[i];
    const s = i;

    if (/\s/.test(c)) {
      while (i < n && /\s/.test(text[i])) i++;
      push('ws', s, i);
    } else if (c === '-' && text[i + 1] === '-') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i++;
      push('comment', s, i);
    } else if (c === '/' && text[i + 1] === '*') {
      let depth = 0;
      while (i < n) {
        if (text[i] === '/' && text[i + 1] === '*') (depth++, (i += 2));
        else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
      push('comment', s, Math.min(i, n));
    } else if (c === "'" || ((c === 'N' || c === 'n') && text[i + 1] === "'")) {
      i += c === "'" ? 1 : 2;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      push('str', s, i);
    } else if (c === '[') {
      i++;
      while (i < n) {
        if (text[i] === ']') {
          if (text[i + 1] === ']') i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      push('id', s, i);
    } else if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') i++;
      i = Math.min(i + 1, n);
      push('id', s, i);
    } else if (/[0-9]/.test(c)) {
      if (c === '0' && /[xX]/.test(text[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(text[i])) i++;
      } else {
        while (i < n && /[0-9]/.test(text[i])) i++;
        if (text[i] === '.' && /[0-9]/.test(text[i + 1] ?? '')) {
          i++;
          while (i < n && /[0-9]/.test(text[i])) i++;
        }
        if (/[eE]/.test(text[i] ?? '') && /[0-9+-]/.test(text[i + 1] ?? '')) {
          i += 2;
          while (i < n && /[0-9]/.test(text[i])) i++;
        }
      }
      push('num', s, i);
    } else if (c === '@') {
      i++;
      if (text[i] === '@') i++;
      while (i < n && /[\w$#@\u0080-\uFFFF]/.test(text[i])) i++;
      push('var', s, i);
    } else if (/[A-Za-z_#\u0080-\uFFFF]/.test(c)) {
      i++;
      while (i < n && /[\w$#@\u0080-\uFFFF]/.test(text[i])) i++;
      push(KEYWORDS.has(text.slice(s, i).toUpperCase()) ? 'kw' : 'id', s, i);
    } else if ('(),;.'.includes(c)) {
      i++;
      push('punct', s, i);
    } else {
      i += OPS2.has(text.slice(i, i + 2)) ? 2 : 1;
      push('op', s, i);
    }
  }
  return { toks };
}

const STARTERS = new Set(['CREATE', 'ALTER', 'DROP', 'INSERT', 'DELETE', 'USE', 'EXEC', 'EXECUTE', 'GRANT', 'TRUNCATE', 'MERGE']);
const SET_OPTIONS = /^(ANSI_|QUOTED_IDENTIFIER|NOCOUNT|ARITHABORT|IDENTITY_INSERT|XACT_ABORT|NUMERIC_ROUNDABORT|CONCAT_NULL)/;

/** Splits a script into statements. GO lines are units of their own, `;` ends a unit. */
export function parse(text: string): { code: LTok[]; units: Unit[] } {
  const code = lex(text).toks;
  const units: Unit[] = [];
  const lineStart = (k: number) => k === 0 || /[\r\n]/.test(text.slice(code[k - 1].to, code[k].from));
  const lineEnd = (k: number) => k === code.length - 1 || /[\r\n]/.test(text.slice(code[k].to, code[k + 1].from));

  let start = -1;
  let depth = 0;
  const close = (end: number) => {
    if (start >= 0 && end >= start) units.push({ t0: start, t1: end });
    start = -1;
    depth = 0;
  };

  for (let k = 0; k < code.length; k++) {
    const t = code[k];
    if (t.up === 'GO' && lineStart(k) && (lineEnd(k) || (code[k + 1]?.kind === 'num' && lineEnd(k + 1)))) {
      close(k - 1);
      const last = lineEnd(k) ? k : k + 1;
      units.push({ t0: k, t1: last });
      k = last;
      continue;
    }
    const starts =
      depth === 0 &&
      start >= 0 &&
      lineStart(k) &&
      (STARTERS.has(t.up) || (t.up === 'SET' && SET_OPTIONS.test(code[k + 1]?.up ?? '')));
    if (starts) close(k - 1);
    if (start < 0) start = k;
    if (t.text === '(') depth++;
    else if (t.text === ')') depth = Math.max(0, depth - 1);
    else if (t.text === ';' && depth === 0) close(k);
  }
  close(code.length - 1);
  return { code, units };
}
