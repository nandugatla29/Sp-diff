import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diffArrays } from 'diff';
import { sqlPieces } from './Sqlhighlight';
import type { SqlPiece } from './Sqlhighlight';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

/* =====================================================================================
 * TextArea with a Find / Replace bar (Ctrl+F / Ctrl+H), like a code editor:
 * every match is highlighted, Enter / Shift+Enter jump between them, Replace and
 * Replace all keep Ctrl+Z working. Used for every paste box and script box.
 * ===================================================================================== */

interface FindOpts {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

interface Match {
  start: number;
  end: number;
}

const MAX_MATCHES = 20000;

function buildRegex(q: string, o: FindOpts): RegExp {
  let src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\w@#$])(?:${src})(?![\\w@#$])`;
  return new RegExp(src, o.matchCase ? 'gm' : 'gim');
}

function findAll(text: string, q: string, o: FindOpts): { matches: Match[]; error: string } {
  if (!q) return { matches: [], error: '' };
  let re: RegExp;
  try {
    re = buildRegex(q, o);
  } catch (e) {
    return { matches: [], error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid pattern' };
  }
  const matches: Match[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && matches.length < MAX_MATCHES) {
    if (m[0] === '') {
      re.lastIndex++; // an empty match (e.g. regex "^") would loop for ever
      continue;
    }
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  return { matches, error: '' };
}

/** Replacement text for one match; with regex on, $1 / $& work like in String.replace. */
function replacementFor(matched: string, q: string, rep: string, o: FindOpts): string {
  if (!o.regex) return rep;
  const re = buildRegex(q, o);
  return matched.replace(new RegExp(re.source, re.flags.replace('g', '')), rep);
}

const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'tabSize',
  'whiteSpace',
  'overflowWrap',
  'wordBreak',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'boxSizing',
] as const;

/** Above this size the box stays plain text (colouring very large pastes would slow typing). */
const HIGHLIGHT_MAX = 400_000;

/** SQL coloured exactly like Compare, split into lines so only edited lines re-render. */
function toLines(text: string): SqlPiece[][] {
  const lines: SqlPiece[][] = [[]];
  for (const p of sqlPieces(text)) {
    const parts = p.text.split('\n');
    parts.forEach((t, i) => {
      if (i > 0) lines.push([]);
      if (t) lines[lines.length - 1].push(p.cls ? { text: t, cls: p.cls } : { text: t });
    });
  }
  return lines;
}

const sameLine = (a: { parts: SqlPiece[] }, b: { parts: SqlPiece[] }) =>
  a.parts.length === b.parts.length && a.parts.every((p, i) => p.text === b.parts[i].text && p.cls === b.parts[i].cls);

type LineMark = 'add' | 'mod';

const HlLine = memo(
  function HlLine({ parts, mark }: { parts: SqlPiece[]; mark?: LineMark }) {
    return (
      <div className={mark ? `ca-line ${mark}` : 'ca-line'}>
        {parts.length ? parts.map((p, i) => (p.cls ? <span key={i} className={p.cls}>{p.text}</span> : p.text)) : '\u200b'}
      </div>
    );
  },
  (a, b) => a.mark === b.mark && sameLine(a, b),
);

/* ---------- what changed compared with a baseline (e.g. the last commit) ---------- */

interface LineChanges {
  marks: (LineMark | undefined)[];
  /** Lines deleted just before line index k (k = number of lines: at the very end). */
  removed: Map<number, string[]>;
  added: number;
  changed: number;
  deleted: number;
}

const MAX_CHANGE_LINES = 20000;

function lineChanges(base: string, text: string): LineChanges {
  const a = base.replace(/\r\n?/g, '\n').split('\n');
  const b = text.split('\n');
  const out: LineChanges = { marks: new Array(b.length), removed: new Map(), added: 0, changed: 0, deleted: 0 };
  if (a.length > MAX_CHANGE_LINES || b.length > MAX_CHANGE_LINES) return out;
  // trailing spaces are not a change worth marking
  const parts = diffArrays(a, b, { comparator: (x: string, y: string) => x.trimEnd() === y.trimEnd() } as never);
  let i = 0;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const n = p.count ?? p.value.length;
    if (p.removed) {
      const next = parts[k + 1];
      if (next?.added) {
        const add = next.count ?? next.value.length;
        const paired = Math.min(n, add);
        for (let j = 0; j < add; j++) out.marks[i + j] = j < paired ? 'mod' : 'add';
        out.changed += paired;
        out.added += add - paired;
        if (n > paired) {
          out.removed.set(i + paired, p.value.slice(paired));
          out.deleted += n - paired;
        }
        i += add;
        k++;
      } else {
        out.removed.set(i, p.value);
        out.deleted += n;
      }
    } else if (p.added) {
      for (let j = 0; j < n; j++) out.marks[i + j] = 'add';
      out.added += n;
      i += n;
    } else i += n;
  }
  return out;
}

export interface CodeAreaProps {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  wrap?: 'off' | 'soft';
  ariaLabel?: string;
  onFocus?: () => void;
  /** Colour the SQL like the Compare screen (default on). Turn off for pasted data grids. */
  highlight?: boolean;
  /** Show line numbers (default: on when the SQL is coloured). */
  lineNumbers?: boolean;
  /** Mark lines added / changed / deleted compared with this text (e.g. the last commit). */
  baseline?: string | null;
  /** Words after the change summary, e.g. "vs. last commit". */
  baselineLabel?: string;
  /** Called while scrolling with the first visible line (1-based). */
  onTopLine?: (line: number) => void;
  /** Scroll so this line (1-based) is at the top when the box opens. */
  startLine?: number;
}

export default function CodeArea({
  value,
  onChange,
  readOnly,
  placeholder,
  className = '',
  wrap = 'off',
  ariaLabel,
  onFocus,
  highlight = true,
  lineNumbers,
  baseline,
  baselineLabel = 'compared with the original',
  onTopLine,
  startLine,
}: CodeAreaProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLPreElement>(null);
  const hlInner = useRef<HTMLDivElement>(null);
  const gutInner = useRef<HTMLDivElement>(null);
  const colour = highlight && wrap === 'off' && value.length > 0 && value.length <= HIGHLIGHT_MAX;
  const lines = useMemo(() => (colour ? toLines(value) : null), [colour, value]);
  const showNums = (lineNumbers ?? highlight) && !!lines;
  // Change marks follow a moment behind typing so they never slow the keys down.
  const lazyValue = useDeferredValue(value);
  const changes = useMemo(() => (colour && baseline !== undefined && baseline !== null ? lineChanges(baseline, lazyValue) : null), [colour, baseline, lazyValue]);
  const onTopRef = useRef(onTopLine);
  onTopRef.current = onTopLine;
  // Only the lines on screen (plus a buffer) are coloured; the layer moves with the scroll.
  const lineH = useRef(19.5);
  const winRef = useRef({ from: 0, to: 120 });
  const [win, setWin] = useState(winRef.current);
  /** Moves the coloured layer, snapped to real screen pixels (half pixels make text blurry). */
  const moveLayer = (inner: HTMLDivElement, x: number, y: number) => {
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    inner.style.transform = `translate(${snap(x)}px, ${snap(y)}px)`;
  };
  const placeLayer = useCallback(() => {
    const ta = taRef.current;
    const inner = hlInner.current;
    if (!ta || !inner) return;
    const lh = lineH.current;
    const first = Math.floor(ta.scrollTop / lh);
    const visible = Math.ceil(ta.clientHeight / lh) + 1;
    const w = winRef.current;
    if (first < w.from || first + visible > w.to) {
      winRef.current = { from: Math.max(0, first - 60), to: first + visible + 60 };
      setWin(winRef.current); // the layout effect below moves the layer once the new lines exist
      return;
    }
    moveLayer(inner, -ta.scrollLeft, w.from * lh - ta.scrollTop);
    if (gutInner.current) moveLayer(gutInner.current, 0, w.from * lh - ta.scrollTop);
    onTopRef.current?.(first + 1);
  }, []);
  const findRef = useRef<HTMLInputElement>(null);
  const repRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [q, setQ] = useState('');
  const [rep, setRep] = useState('');
  const [opts, setOpts] = useState<FindOpts>({ matchCase: false, wholeWord: false, regex: false });
  const [cur, setCur] = useState(-1);
  const [mirrorStyle, setMirrorStyle] = useState<CSSProperties>({});
  const [flash, setFlash] = useState('');

  const canReplace = !readOnly && !!onChange;
  const { matches, error } = useMemo(() => (open ? findAll(value, q, opts) : { matches: [], error: '' }), [open, value, q, opts]);

  // Keep the current match inside the list when the text or the query changes.
  useEffect(() => {
    if (!matches.length) setCur(-1);
    else if (cur >= matches.length) setCur(matches.length - 1);
  }, [matches, cur]);

  // The highlight layer must use exactly the same box and font as the textarea.
  useLayoutEffect(() => {
    if ((!open && !colour) || !taRef.current) return;
    const cs = window.getComputedStyle(taRef.current);
    const st: Record<string, string> = {};
    for (const p of MIRROR_PROPS) st[p] = cs[p];
    lineH.current = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    setMirrorStyle({ ...(st as CSSProperties), borderStyle: 'solid', borderColor: 'transparent' });
  }, [open, colour, wrap, className]);

  const syncScroll = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const m = mirrorRef.current;
    if (m) {
      m.scrollTop = ta.scrollTop;
      m.scrollLeft = ta.scrollLeft;
    }
    placeLayer();
  }, [placeLayer]);
  useLayoutEffect(syncScroll, [syncScroll, matches, cur, value, lines, mirrorStyle]);
  useLayoutEffect(() => {
    const ta = taRef.current;
    const inner = hlInner.current;
    if (ta && inner) moveLayer(inner, -ta.scrollLeft, win.from * lineH.current - ta.scrollTop);
    if (ta && gutInner.current) moveLayer(gutInner.current, 0, win.from * lineH.current - ta.scrollTop);
  }, [win, lines, showNums]);

  // Open at a given line (e.g. where you were in the other view).
  const started = useRef(false);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (started.current || !ta || !value) return;
    started.current = true;
    if (startLine && startLine > 1) {
      const cs = window.getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      ta.scrollTop = (startLine - 1) * lh;
    }
  }, [value, startLine]);
  // a resized box shows more lines
  useEffect(() => {
    const ta = taRef.current;
    if (!ta || !colour || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => placeLayer());
    ro.observe(ta);
    return () => ro.disconnect();
  }, [colour, placeLayer]);

  /** Scrolls the textarea so the match is in view (without stealing focus from the find box). */
  const reveal = useCallback(
    (m: Match) => {
      const ta = taRef.current;
      if (!ta) return;
      const cs = window.getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      const before = value.slice(0, m.start);
      const line = before.split('\n').length - 1;
      const top = line * lh;
      if (top < ta.scrollTop || top > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
      if (wrap === 'off') {
        const col = m.start - (before.lastIndexOf('\n') + 1);
        const ctx = document.createElement('canvas').getContext('2d');
        let cw = parseFloat(cs.fontSize) * 0.6;
        if (ctx) {
          ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
          cw = ctx.measureText('M').width;
        }
        const left = col * cw;
        if (left < ta.scrollLeft || left > ta.scrollLeft + ta.clientWidth - cw * 8) ta.scrollLeft = Math.max(0, left - ta.clientWidth / 3);
      }
      ta.setSelectionRange(m.start, m.end);
      syncScroll();
    },
    [value, wrap, syncScroll],
  );

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!matches.length) return;
      let i: number;
      if (cur < 0) {
        const caret = taRef.current?.selectionStart ?? 0;
        i = dir === 1 ? matches.findIndex((m) => m.start >= caret) : findLastIndex(matches, (m) => m.start < caret);
        if (i < 0) i = dir === 1 ? 0 : matches.length - 1;
      } else i = (cur + dir + matches.length) % matches.length;
      setCur(i);
      reveal(matches[i]);
    },
    [matches, cur, reveal],
  );

  const openBar = useCallback((withReplace: boolean) => {
    const ta = taRef.current;
    const sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
    if (sel && !sel.includes('\n') && sel.length < 200) setQ(sel);
    setOpen(true);
    setShowReplace(withReplace);
    setCur(-1);
    window.setTimeout(() => (withReplace && sel ? repRef.current : findRef.current)?.select(), 0);
  }, []);

  const close = () => {
    setOpen(false);
    taRef.current?.focus();
  };

  /** Replace a range so that Ctrl+Z still works (execCommand keeps the browser undo stack). */
  const applyEdit = (start: number, end: number, text: string, keepFocus: HTMLElement | null) => {
    const ta = taRef.current;
    if (!ta || !onChange) return;
    ta.focus();
    ta.setSelectionRange(start, end);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch {
      ok = false;
    }
    if (!ok || ta.value === value) onChange(value.slice(0, start) + text + value.slice(end));
    keepFocus?.focus();
  };

  const replaceOne = () => {
    if (!canReplace || !matches.length) return;
    const i = cur < 0 ? 0 : cur;
    const m = matches[i];
    const r = replacementFor(value.slice(m.start, m.end), q, rep, opts);
    applyEdit(m.start, m.end, r, repRef.current);
    // The next match now sits at the same index (or wraps to the first one).
    setCur(i);
    window.setTimeout(() => {
      const { matches: after } = findAll(taRef.current?.value ?? '', q, opts);
      if (after.length) reveal(after[Math.min(i, after.length - 1)]);
    }, 0);
  };

  const replaceAll = () => {
    if (!canReplace || !matches.length) return;
    let out = '';
    let pos = 0;
    for (const m of matches) {
      out += value.slice(pos, m.start) + replacementFor(value.slice(m.start, m.end), q, rep, opts);
      pos = m.end;
    }
    out += value.slice(pos);
    const n = matches.length;
    applyEdit(0, value.length, out, repRef.current);
    taRef.current?.setSelectionRange(0, 0); // don't leave the whole text selected
    setCur(-1);
    setFlash(`Replaced ${n}`);
    window.setTimeout(() => setFlash(''), 2000);
  };

  const onAreaKey = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      openBar(false);
    } else if (mod && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      openBar(canReplace);
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (!open) openBar(false);
      else go(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const onFindKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      if (canReplace) setShowReplace(true);
      window.setTimeout(() => repRef.current?.focus(), 0);
    } else if (e.altKey && (e.key === 'c' || e.key === 'w' || e.key === 'r')) {
      e.preventDefault();
      const k = e.key === 'c' ? 'matchCase' : e.key === 'w' ? 'wholeWord' : 'regex';
      setOpts((o) => ({ ...o, [k]: !o[k] }));
    }
  };

  const onRepKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && e.altKey) replaceAll();
      else replaceOne();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  // Highlight layer: the text with every match wrapped in <mark>.
  const highlighted = useMemo(() => {
    if (!open || !matches.length) return null;
    const parts: ReactNode[] = [];
    let pos = 0;
    matches.forEach((m, i) => {
      if (m.start > pos) parts.push(value.slice(pos, m.start));
      parts.push(
        <mark key={i} className={i === cur ? 'cur' : undefined}>
          {value.slice(m.start, m.end)}
        </mark>,
      );
      pos = m.end;
    });
    parts.push(value.slice(pos) + '\n');
    return parts;
  }, [open, matches, cur, value]);

  const toggle = (k: keyof FindOpts, label: string, title: string) => (
    <button type="button" className={`fr-opt${opts[k] ? ' on' : ''}`} aria-pressed={opts[k]} title={title} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>
      {label}
    </button>
  );

  const count = error ? 'Bad pattern' : !q ? '' : matches.length ? `${cur < 0 ? '?' : cur + 1} of ${matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : matches.length}` : 'No results';

  return (
    <div className={`code-area ${className}${open && matches.length ? ' finding' : ''}${lines ? ' coloured' : ''}`} onKeyDown={onAreaKey}>
      {open && (
        <div className="fr-bar" role="search">
          {canReplace && (
            <button type="button" className="fr-twist" title={showReplace ? 'Hide replace' : 'Show replace (Ctrl+H)'} aria-expanded={showReplace} onClick={() => setShowReplace((v) => !v)}>
              {showReplace ? '▾' : '▸'}
            </button>
          )}
          <div className="fr-rows">
            <div className="fr-row">
              <input
                ref={findRef}
                type="text"
                className={error || (q && !matches.length) ? 'fr-miss' : ''}
                placeholder="Find"
                aria-label="Find"
                value={q}
                spellCheck={false}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCur(-1);
                }}
                onKeyDown={onFindKey}
                title={error || 'Enter: next · Shift+Enter: previous · Esc: close'}
              />
              {toggle('matchCase', 'Aa', 'Match case (Alt+C)')}
              {toggle('wholeWord', 'ab', 'Whole word (Alt+W)')}
              {toggle('regex', '.*', 'Regular expression (Alt+R). Use $1 in the replacement for groups')}
              <span className="fr-count" aria-live="polite">
                {flash || count}
              </span>
              <button type="button" className="icon" title="Previous (Shift+Enter)" disabled={!matches.length} onClick={() => go(-1)}>
                ↑
              </button>
              <button type="button" className="icon" title="Next (Enter)" disabled={!matches.length} onClick={() => go(1)}>
                ↓
              </button>
              <button type="button" className="icon" title="Close (Esc)" onClick={close}>
                ✕
              </button>
            </div>
            {canReplace && showReplace && (
              <div className="fr-row">
                <input
                  ref={repRef}
                  type="text"
                  placeholder="Replace"
                  aria-label="Replace with"
                  value={rep}
                  spellCheck={false}
                  onChange={(e) => setRep(e.target.value)}
                  onKeyDown={onRepKey}
                  title="Enter: replace · Ctrl+Alt+Enter: replace all"
                />
                <button type="button" disabled={!matches.length} onClick={replaceOne} title="Replace this match (Enter)">
                  Replace
                </button>
                <button type="button" disabled={!matches.length} onClick={replaceAll} title="Replace every match (Ctrl+Alt+Enter). Ctrl+Z undoes it">
                  Replace all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div className={`code-area-box${showNums ? ' with-gutter' : ''}`}>
        {showNums && lines && (
          <div className="ca-gutter" aria-hidden="true" style={{ width: `calc(${String(lines.length).length}ch + 20px)` }}>
            <div ref={gutInner} className="ca-gutter-inner" style={{ paddingTop: `calc(${mirrorStyle.paddingTop ?? '0px'} + ${mirrorStyle.borderTopWidth ?? '0px'})` }}>
              {Array.from({ length: Math.max(0, Math.min(win.to, lines.length) - win.from) }, (_, k) => {
                const i = win.from + k;
                const mark = changes?.marks[i];
                const delAbove = changes?.removed.get(i);
                const delEnd = i === lines.length - 1 ? changes?.removed.get(lines.length) : undefined;
                const gone = delAbove ?? delEnd;
                return (
                  <div
                    key={i}
                    className={`ca-num${mark ? ` ${mark}` : ''}${delAbove ? ' del-above' : ''}${delEnd ? ' del-below' : ''}`}
                    title={
                      gone
                        ? `${gone.length} line(s) deleted here:\n${gone.slice(0, 12).join('\n')}${gone.length > 12 ? '\n…' : ''}`
                        : mark === 'add'
                          ? 'New line'
                          : mark === 'mod'
                            ? 'Changed line'
                            : undefined
                    }
                  >
                    {i + 1}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="ca-main">
        {highlighted && (
          <div ref={mirrorRef} className="fr-mirror" style={mirrorStyle} aria-hidden="true">
            {highlighted}
          </div>
        )}
        {lines && (
          <pre ref={hlRef} className="ca-hl" style={mirrorStyle} aria-hidden="true">
            <div ref={hlInner} className="ca-hl-inner">
              {lines.slice(win.from, win.to).map((parts, i) => (
                <HlLine key={win.from + i} parts={parts} mark={changes?.marks[win.from + i]} />
              ))}
            </div>
          </pre>
        )}
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          wrap={wrap}
          aria-label={ariaLabel}
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={syncScroll}
          onFocus={onFocus}
        />
        {!open && (
          <button type="button" className="fr-open icon" title={canReplace ? 'Find / replace (Ctrl+F, Ctrl+H)' : 'Find (Ctrl+F)'} onClick={() => openBar(canReplace)}>
            🔍
          </button>
        )}
        </div>
      </div>
      {changes && (changes.added || changes.changed || changes.deleted) ? (
        <div className="ca-summary" aria-live="polite">
          {changes.added > 0 && <span className="add">+{changes.added} new</span>}
          {changes.changed > 0 && <span className="mod">~{changes.changed} changed</span>}
          {changes.deleted > 0 && <span className="del">−{changes.deleted} deleted</span>}
          <span className="muted">lines {baselineLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function findLastIndex<T>(a: T[], fn: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (fn(a[i])) return i;
  return -1;
}
