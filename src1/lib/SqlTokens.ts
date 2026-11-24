export type TokType = 'word' | 'ident' | 'var' | 'str' | 'num' | 'op' | 'comment';

export interface Tok {
  t: string; // raw text
  v: string; // value: identifier without [brackets] / "quotes", otherwise same as t
  k: string; // upper-case v, used for keyword tests
  type: TokType;
  line: number; // 1-based line where the token (or this piece of it) sits
  ws: string; // whitespace before the token on its line
}

export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/);

const WORD = /[A-Za-z_\u0080-\uFFFF][\w$#@\u0080-\uFFFF]*/y;
const NUM = /(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)/y;
const VAR = /(?:@@?|##?)[\w$#@\u0080-\uFFFF]*/y;

/**
 * Splits T-SQL into tokens. Comments and strings are respected (including nested block comments
 * and '' escapes). Multi-line comments and strings are split into one piece per physical line so
 * every token knows the line it is on.
 */
export function tokenize(input: string): Tok[] {
  const text = input.replace(/\r\n?/g, '\n');
  const out: Tok[] = [];
  const n = text.length;
  let i = 0;
  let line = 1;
  let ws = '';

  const push = (t: string, type: TokType, ln: number, v = t) => {
    out.push({ t, v, k: v.toUpperCase(), type, line: ln, ws });
    ws = '';
  };
  const piece = (s: string, type: TokType) => {
    const parts = s.split('\n');
    parts.forEach((part, idx) => {
      if (idx > 0) ws = '';
      if (part !== '') push(part, type, line + idx);
    });
    line += parts.length - 1;
    ws = '';
  };

  while (i < n) {
    const c = text[i];
    if (c === '\n') {
      line++;
      ws = '';
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\u00a0') {
      ws += c;
      i++;
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      push(text.slice(i, j), 'comment', line);
      i = j;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      piece(text.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (c === "'" || ((c === 'N' || c === 'n') && text[i + 1] === "'")) {
      let j = c === "'" ? i + 1 : i + 2;
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      piece(text.slice(i, j), 'str');
      i = j;
      continue;
    }
    if (c === '[' || c === '"') {
      const close = c === '[' ? ']' : '"';
      let j = i + 1;
      while (j < n && text[j] !== '\n') {
        if (text[j] === close) {
          if (text[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      const raw = text.slice(i, j + 1);
      push(raw, 'ident', line, raw.slice(1, raw.endsWith(close) ? -1 : undefined).split(close + close).join(close));
      i = j + 1;
      continue;
    }
    if (c === '@' || c === '#') {
      VAR.lastIndex = i;
      const m = VAR.exec(text);
      const raw = m ? m[0] : c;
      push(raw, c === '@' ? 'var' : 'ident', line);
      i += raw.length;
      continue;
    }
    WORD.lastIndex = i;
    let m = WORD.exec(text);
    if (m) {
      push(m[0], 'word', line);
      i += m[0].length;
      continue;
    }
    NUM.lastIndex = i;
    m = NUM.exec(text);
    if (m) {
      push(m[0], 'num', line);
      i += m[0].length;
      continue;
    }
    push(c, 'op', line);
    i++;
  }
  return out;
}