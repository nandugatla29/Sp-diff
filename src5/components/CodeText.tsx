import type { Seg, VarMarks } from '../types';
import { lex } from '../lib/sqlparse';

type KSeg = Seg & { kind?: string };

/** Turns plain text into highlight segments (keywords, strings, comments, variables ...). */
export function tokenSegs(text: string): KSeg[] {
  return lex(text, true).toks.map((t) => ({ text: t.text, type: 'same' as const, kind: t.kind }));
}

function segClass(s: KSeg, vars?: VarMarks): string | undefined {
  const parts: string[] = [];
  if (s.type !== 'same') parts.push(s.type);
  if (s.kind && s.kind !== 'ws' && s.kind !== 'id' && s.kind !== 'punct' && s.kind !== 'op') parts.push(`t-${s.kind}`);
  if (s.kind === 'var' && vars) {
    const name = s.text.toLowerCase();
    if (vars.only.has(name)) parts.push('newvar');
    if (vars.bad.has(name)) parts.push('undecl');
  }
  return parts.length ? parts.join(' ') : undefined;
}

function segTitle(s: KSeg, vars?: VarMarks): string | undefined {
  if (s.kind !== 'var' || !vars) return undefined;
  const name = s.text.toLowerCase();
  if (vars.only.has(name) && vars.bad.has(name)) return `${s.text}: new variable that is not declared on this side`;
  if (vars.only.has(name)) return `${s.text}: new variable, only exists on this side`;
  if (vars.bad.has(name)) return `${s.text}: used but never declared on this side`;
  return undefined;
}

export function renderSegs(segs: KSeg[], vars?: VarMarks) {
  return segs.map((s, i) => (
    <span key={i} className={segClass(s, vars)} title={segTitle(s, vars)}>
      {s.text}
    </span>
  ));
}

export function CodeText({ text, vars }: { text: string; vars?: VarMarks }) {
  return <>{text === '' ? '\u00a0' : renderSegs(tokenSegs(text), vars)}</>;
}
