import type { DiffOptions, Entry } from '../types';
import { tokenize, type Tok } from './SqlTokens';

export const defaultOptions: DiffOptions = {
  ignoreWhitespace: true,
  ignoreLineBreaks: true,
  ignoreCase: true,
  ignoreComments: true,
  ignoreBlankLines: true,
  ignoreBrackets: true,
  ignoreCreateAlter: true,
  ignoreBoilerplate: true,
  ignoreTableHints: false,
};

/** Blank out -- and  comments while leaving string literals alone. Keeps line count. */
function stripComments(lines: string[]): string[] {
  let inBlock = false;
  let inStr = false;
  return lines.map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      const n = line[i + 1];
      if (inBlock) {
        if (c === '*' && n === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        out += c;
        if (c === "'") {
          if (n === "'") {
            out += n;
            i++;
          } else inStr = false;
        }
        continue;
      }
      if (c === "'") {
        inStr = true;
        out += c;
        continue;
      }
      if (c === '-' && n === '-') break;
      if (c === '/' && n === '*') {
        inBlock = true;
        i++;
        continue;
      }
      out += c;
    }
    return out;
  });
}

const NOLOCK_RE = /\s*(?:\bwith\s*)?\(\s*nolock\s*\)/gi;

/** Returns the comparison key for a line, or null when the line should be ignored entirely. */
function normalizeLine(raw: string, o: DiffOptions): string | null {
  let s = raw;

  if (o.ignoreWhitespace) s = s.trim();

  if (o.ignoreBoilerplate) {
    const t = s.trim();
    if (/^go$/i.test(t)) return null;
    if (/^set\s+(ansi_nulls|quoted_identifier)\s+(on|off)\s*;?$/i.test(t)) return null;
    if (/^use\s+\[?[\w$#@]+\]?\s*;?$/i.test(t)) return null;
    // Footer SSMS adds when a procedure is copied from "Results to Text".
    if (/^completion time:/i.test(t)) return null;
    if (/^\(\d+ rows? affected\)$/i.test(t)) return null;
  }

  if (o.ignoreTableHints) s = s.replace(NOLOCK_RE, '');

  if (o.ignoreCreateAlter) {
    s = s.replace(/^\s*(create\s+or\s+alter|create|alter)\s+(proc(?:edure)?)\b/i, 'create proc');
  }

  // Token canonicalization is only used when whitespace is ignored. Exact/review mode
  // deliberately retains whitespace differences.
  if (o.ignoreWhitespace) {
    const toks = tokenize(s).filter((t) => t.type !== 'comment');
    if (toks.length) {
      s = toks.map((t) => {
        return tokenKey(t, o);
      }).join('\u001f');
    } else {
      s = s.trim();
    }
  } else {
    if (o.ignoreBrackets) s = s.replace(/[\[\]]/g, '');
    if (o.ignoreCase) s = s.toLowerCase();
  }

  return s;
}

export function buildEntries(text: string, o: DiffOptions): Entry[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cleaned = o.ignoreComments ? stripComments(lines) : lines;
  const entries: Entry[] = [];

  cleaned.forEach((c, idx) => {
    // A line that was only a comment is ignored, not treated as a blank line.
    if (o.ignoreComments && c.trim() === '' && lines[idx].trim() !== '') return;
    const key = normalizeLine(c, o);
    if (key === null) return;
    if (key === '' && o.ignoreBlankLines) return;
    entries.push({ no: idx + 1, text: lines[idx], key });
  });

  return entries;
}

/* ---------- token level comparison (ignores where lines are broken) ---------- */

/** Line breaks are only ignored together with whitespace. Missing (older saved settings) = on. */
export const lineBreaksIgnored = (o: DiffOptions) => o.ignoreWhitespace && o.ignoreLineBreaks !== false;

/** Comparison key of one SQL token under the ignore rules. */
export function tokenKey(t: Tok, o: DiffOptions): string {
  // With [brackets] ignored, [dbo] (ident) and dbo (word) must compare equal, so both become "name".
  const nameLike = o.ignoreBrackets && (t.type === 'ident' || t.type === 'word');
  const type = nameLike ? 'name' : t.type;
  const v = t.type === 'ident' && o.ignoreBrackets ? t.v : t.t;
  return `${type}:${o.ignoreCase && t.type !== 'str' ? v.toLowerCase() : v}`;
}

export interface KeyTok {
  line: number; // 1-based raw line
  col: number; // start column in the raw line
  len: number;
  key: string;
}

/**
 * Every token that takes part in the comparison, in order, with its position.
 * Uses the same rules as buildEntries: lines that are ignored (GO, comment-only, ...) contribute nothing,
 * comments are skipped when ignored, and CREATE / ALTER / CREATE OR ALTER PROC compare equal.
 */
export function comparableTokens(text: string, o: DiffOptions): KeyTok[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept = new Set(buildEntries(text, o).map((e) => e.no));
  const toks = tokenize(text);

  // Column of every token: walk each line left to right.
  const cursor = new Map<number, number>();
  const cols = toks.map((t) => {
    const raw = lines[t.line - 1] ?? '';
    const from = cursor.get(t.line) ?? 0;
    let at = raw.indexOf(t.t, from);
    if (at < 0) at = from;
    cursor.set(t.line, at + t.t.length);
    return at;
  });

  const out: (KeyTok & { k: string })[] = [];
  toks.forEach((t, i) => {
    if (!kept.has(t.line)) return;
    if (t.type === 'comment' && o.ignoreComments) return;
    let key = tokenKey(t, o);
    if (o.ignoreCreateAlter && t.type === 'word' && (t.k === 'PROC' || t.k === 'PROCEDURE')) {
      const prev = (n: number) => out[out.length - n]?.k;
      if (prev(1) === 'CREATE' || prev(1) === 'ALTER') {
        const drop = prev(1) === 'ALTER' && prev(2) === 'OR' && prev(3) === 'CREATE' ? 3 : 1;
        out.splice(out.length - drop, drop);
        key = 'word:proc';
      }
    }
    out.push({ line: t.line, col: cols[i], len: t.t.length, key, k: t.type === 'word' ? t.k : '' });
  });
  const kept2 = o.ignoreTableHints ? dropNolock(out) : out;
  return kept2.map(({ line, col, len, key }) => ({ line, col, len, key }));
}

/** Removes "( NOLOCK )" and "WITH ( NOLOCK )" token runs. */
function dropNolock<T extends { key: string; k: string }>(toks: T[]): T[] {
  const res: T[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].key === 'op:(' && toks[i + 1]?.k === 'NOLOCK' && toks[i + 2]?.key === 'op:)') {
      if (res[res.length - 1]?.k === 'WITH') res.pop();
      i += 2;
      continue;
    }
    res.push(toks[i]);
  }
  return res;
}


