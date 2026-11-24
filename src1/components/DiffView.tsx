// // // import { memo, useEffect, useMemo, useState } from 'react';
// // // import type { Cell, Hunk, HunkAiResult, Row, Side } from '../types';
// // // import ChangeList from './ChangeList';
// // // import HunkBar from './HunkBar';
// // // const CTX = 3;

// // // type Item =
// // //   | { type: 'row'; row: Row; key: string; h: number }
// // //   | { type: 'hunk'; n: number }
// // //   | { type: 'fold'; runStart: number; count: number };

// // // function renderCell(cell?: Cell) {
// // //   if (!cell) return '\u00a0';
// // //   if (cell.segs) {
// // //     return cell.segs.map((s, i) => (
// // //       <span key={i} className={s.type === 'same' ? undefined : s.type}>
// // //         {s.text}
// // //       </span>
// // //     ));
// // //   }
// // //   return cell.text === '' ? '\u00a0' : cell.text;
// // // }

// // // const DiffRow = memo(function DiffRow({ row, current, reviewed }: { row: Row; current: boolean; reviewed: boolean }) {
// // //   return (
// // //     <div className={`row ${row.kind}${current ? ' current' : ''}${reviewed ? ' reviewed' : ''}`}>
// // //       <span className="no">{row.left?.no ?? ''}</span>
// // //       <code className="code">{renderCell(row.left)}</code>
// // //       <span className="no">{row.right?.no ?? ''}</span>
// // //       <code className="code">{renderCell(row.right)}</code>
// // //     </div>
// // //   );
// // // });

// // // interface Props {
// // //   rows: Row[];
// // //   hunks: Hunk[];
// // //   leftName: string;
// // //   rightName: string;
// // //   collapse: boolean;
// // //   target: Side;
// // //   busy: boolean;
// // //   onTake: (h: Hunk) => void;
// // //   onAsk: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
// // //   onApplyAi: (h: Hunk, replacement: string) => void;
// // // }

// // // export default function DiffView(p: Props) {
// // //   const { rows, hunks, collapse } = p;
// // //   const [expanded, setExpanded] = useState<Set<number>>(new Set());
// // //   const [current, setCurrent] = useState(-1);
// // //   const [reviewed, setReviewed] = useState<Set<string>>(new Set());

// // //   useEffect(() => {
// // //     setExpanded(new Set());
// // //     setCurrent((c) => Math.min(c, hunks.length - 1));
// // //   }, [rows, hunks.length]);

// // //   const items = useMemo(() => {
// // //     const startAt = new Map<number, number>();
// // //     const hunkOfRow = new Int32Array(rows.length).fill(-1);
// // //     hunks.forEach((h, n) => {
// // //       startAt.set(h.rowStart, n);
// // //       for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
// // //     });

// // //     const out: Item[] = [];
// // //     const pushRow = (idx: number) => {
// // //       const n = startAt.get(idx);
// // //       if (n !== undefined) out.push({ type: 'hunk', n });
// // //       out.push({ type: 'row', row: rows[idx], key: `r${idx}`, h: hunkOfRow[idx] });
// // //     };

// // //     let i = 0;
// // //     while (i < rows.length) {
// // //       if (rows[i].kind !== 'equal') {
// // //         pushRow(i);
// // //         i++;
// // //         continue;
// // //       }
// // //       let j = i;
// // //       while (j < rows.length && rows[j].kind === 'equal') j++;
// // //       const len = j - i;
// // //       const head = i === 0 ? 0 : CTX;
// // //       const tail = j === rows.length ? 0 : CTX;

// // //       if (!collapse || expanded.has(i) || len <= head + tail + 1) {
// // //         for (let k = i; k < j; k++) pushRow(k);
// // //       } else {
// // //         for (let k = i; k < i + head; k++) pushRow(k);
// // //         out.push({ type: 'fold', runStart: i, count: len - head - tail });
// // //         for (let k = j - tail; k < j; k++) pushRow(k);
// // //       }
// // //       i = j;
// // //     }
// // //     return out;
// // //   }, [rows, hunks, collapse, expanded]);

// // //   const goTo = (n: number) => {
// // //     if (hunks.length === 0) return;
// // //     const next = ((n % hunks.length) + hunks.length) % hunks.length;
// // //     setCurrent(next);
// // //     document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
// // //   };

// // //   const nextUnreviewed = () => {
// // //     for (let k = 1; k <= hunks.length; k++) {
// // //       const n = (current + k + hunks.length) % hunks.length;
// // //       if (!reviewed.has(hunks[n].sig)) return goTo(n);
// // //     }
// // //   };

// // //   const toggleReview = (sig: string) =>
// // //     setReviewed((s) => {
// // //       const n = new Set(s);
// // //       if (n.has(sig)) n.delete(sig);
// // //       else n.add(sig);
// // //       return n;
// // //     });

// // //   if (hunks.length === 0) {
// // //     return (
// // //       <div className="empty">
// // //         <strong>No differences.</strong>
// // //         <span>With the current ignore rules both procedures match.</span>
// // //       </div>
// // //     );
// // //   }

// // //   const doneCount = hunks.filter((h) => reviewed.has(h.sig)).length;

// // //   return (
// // //     <div className="diff-wrap">
// // //       <ChangeList hunks={hunks} current={current} reviewed={reviewed} onGo={goTo} />

// // //       <div className="diff">
// // //         <div className="diff-nav">
// // //           <button type="button" onClick={() => goTo(current - 1)}>
// // //             Previous
// // //           </button>
// // //           <button type="button" onClick={() => goTo(current + 1)}>
// // //             Next
// // //           </button>
// // //           <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
// // //             Next unreviewed
// // //           </button>
// // //           <span className="muted">
// // //             {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
// // //           </span>
// // //         </div>

// // //         <div className="diff-head">
// // //           <span />
// // //           <span className="name">{p.leftName || 'Left'}</span>
// // //           <span />
// // //           <span className="name">{p.rightName || 'Right'}</span>
// // //         </div>

// // //         <div className="diff-body">
// // //           {items.map((it) => {
// // //             if (it.type === 'fold') {
// // //               return (
// // //                 <button
// // //                   key={`f${it.runStart}`}
// // //                   type="button"
// // //                   className="fold"
// // //                   onClick={() => setExpanded((s) => new Set(s).add(it.runStart))}
// // //                 >
// // //                   Show {it.count} unchanged lines
// // //                 </button>
// // //               );
// // //             }
// // //             if (it.type === 'hunk') {
// // //               const h = hunks[it.n];
// // //               return (
// // //                 <HunkBar
// // //                   key={h.sig}
// // //                   id={`chg-${it.n}`}
// // //                   hunk={h}
// // //                   index={it.n}
// // //                   total={hunks.length}
// // //                   leftName={p.leftName}
// // //                   rightName={p.rightName}
// // //                   target={p.target}
// // //                   busy={p.busy}
// // //                   current={it.n === current}
// // //                   reviewed={reviewed.has(h.sig)}
// // //                   onReview={() => toggleReview(h.sig)}
// // //                   onTake={() => p.onTake(h)}
// // //                   onAsk={(mode, ins) => p.onAsk(h, mode, ins)}
// // //                   onApplyAi={(rep) => p.onApplyAi(h, rep)}
// // //                 />
// // //               );
// // //             }
// // //             return (
// // //               <DiffRow
// // //                 key={it.key}
// // //                 row={it.row}
// // //                 current={it.h === current}
// // //                 reviewed={it.h >= 0 && reviewed.has(hunks[it.h].sig)}
// // //               />
// // //             );
// // //           })}
// // //         </div>
// // //       </div>
// // //     </div>
// // //   );
// // // }



// // import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// // import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
// // import type { Cell, Editable, Hunk, HunkAiResult, Row, Side } from '../types';
// // import ChangeList from './ChangeList';
// // import HunkBar from './HunkBar';
// // import { diffVars } from '../lib/Vars';
// // import type { VarMarks } from '../types';

// // const CTX = 3;

// // type Selection = { side: Side; set: Set<number> };

// // type Item =
// //   | { type: 'row'; idx: number; row: Row; h: number }
// //   | { type: 'hunk'; n: number }
// //   | { type: 'fold'; key: string; count: number };

// // const foldKey = (r: Row) => `${r.left?.no ?? 0}:${r.right?.no ?? 0}`;

// // function highlightVariables(text: string, marks: VarMarks) {
// //   const re = /@@?[A-Za-z_][\w$#@]*/g;
// //   const out: ReactNode[] = [];
// //   let last = 0;
// //   let m: RegExpExecArray | null;
// //   while ((m = re.exec(text))) {
// //     if (m.index > last) out.push(text.slice(last, m.index));
// //     const name = m[0].toLowerCase();
// //     const cls = marks.bad.has(name) ? 'sql-var-bad' : marks.only.has(name) ? 'sql-var-only' : '';
// //     out.push(cls ? <span key={`${m.index}-${name}`} className={cls} title={marks.bad.has(name) ? 'Variable is used but not declared on this side' : 'Variable exists only on one side'}>{m[0]}</span> : m[0]);
// //     last = m.index + m[0].length;
// //   }
// //   if (last < text.length) out.push(text.slice(last));
// //   return out;
// // }

// // function renderCell(cell: Cell | undefined, marks: VarMarks) {
// //   if (!cell) return '\u00a0';
// //   if (cell.segs) {
// //     return cell.segs.map((s, i) => (
// //       <span key={i} className={s.type === 'same' ? undefined : s.type}>
// //         {highlightVariables(s.text, marks)}
// //       </span>
// //     ));
// //   }
// //   return cell.text === '' ? '\u00a0' : highlightVariables(cell.text, marks);
// // }

// // function LineEditor({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
// //   const done = useRef(false);
// //   const finish = (v: string | null) => {
// //     if (done.current) return;
// //     done.current = true;
// //     if (v === null) onCancel();
// //     else onCommit(v);
// //   };
// //   return (
// //     <input
// //       className="line-edit"
// //       autoFocus
// //       spellCheck={false}
// //       defaultValue={value}
// //       onFocus={(e) => e.currentTarget.select()}
// //       onKeyDown={(e) => {
// //         if (e.key === 'Enter') finish(e.currentTarget.value);
// //         else if (e.key === 'Escape') finish(null);
// //       }}
// //       onBlur={(e) => finish(e.currentTarget.value)}
// //     />
// //   );
// // }

// // interface RowProps {
// //   idx: number;
// //   row: Row;
// //   current: boolean;
// //   reviewed: boolean;
// //   selL: boolean;
// //   selR: boolean;
// //   hit: boolean;
// //   match: boolean;
// //   editing: Side | null;
// //   canL: boolean;
// //   canR: boolean;
// //   popup: ReactNode;
// //   varMarks: { left: VarMarks; right: VarMarks };
// //   onPick: (idx: number, side: Side, e: ReactMouseEvent) => void;
// //   onEnter: (idx: number) => void;
// //   onEdit: (idx: number, side: Side) => void;
// //   onCommit: (side: Side, no: number, value: string, original: string) => void;
// //   onCancel: () => void;
// // }

// // const DiffRow = memo(function DiffRow(p: RowProps) {
// //   const { row } = p;
// //   const cls = [
// //     'row',
// //     row.kind,
// //     p.current ? 'current' : '',
// //     p.reviewed ? 'reviewed' : '',
// //     p.match ? 'match' : '',
// //     p.hit ? 'hit' : '',
// //     p.popup ? 'has-popup' : '',
// //   ]
// //     .filter(Boolean)
// //     .join(' ');

// //   const cell = (side: Side) => {
// //     const c = row[side];
// //     const selected = side === 'left' ? p.selL : p.selR;
// //     const can = side === 'left' ? p.canL : p.canR;
// //     return (
// //       <>
// //         <span
// //           className={`no${selected ? ' sel' : ''}`}
// //           title="Click to select this line. Shift+click selects a range, Ctrl/Cmd+click adds a line"
// //           onMouseDown={(e) => p.onPick(p.idx, side, e)}
// //         >
// //           {c?.no ?? ''}
// //         </span>
// //         {p.editing === side && c ? (
// //           <div className={`code c-${side}`}>
// //             <LineEditor value={c.text} onCommit={(v) => p.onCommit(side, c.no, v, c.text)} onCancel={p.onCancel} />
// //           </div>
// //         ) : (
// //           <code
// //             className={`code c-${side}${selected ? ' sel' : ''}${c ? '' : ' ghost'}`}
// //             title={can && c ? 'Double-click to edit this line' : undefined}
// //             onClick={(e) => {
// //               if (window.getSelection()?.toString()) return; // user is selecting text to copy
// //               p.onPick(p.idx, side, e);
// //             }}
// //             onDoubleClick={() => {
// //               if (can && c) p.onEdit(p.idx, side);
// //             }}
// //           >
// //             {renderCell(c, p.varMarks[side])}
// //           </code>
// //         )}
// //       </>
// //     );
// //   };

// //   return (
// //     <div id={`row-${p.idx}`} className={cls} onMouseEnter={() => p.onEnter(p.idx)}>
// //       {cell('left')}
// //       {cell('right')}
// //       {p.popup}
// //     </div>
// //   );
// // });

// // interface Props {
// //   mode: 'compare' | 'review';
// //   rows: Row[];
// //   leftText: string;
// //   rightText: string;
// //   hunks: Hunk[];
// //   leftName: string;
// //   rightName: string;
// //   collapse: boolean;
// //   wrap: boolean;
// //   fontSize: number;
// //   showList: boolean;
// //   target: Side;
// //   busy: boolean;
// //   editable: Editable;
// //   reviewed: Set<string>;
// //   onReviewedChange: (next: Set<string>) => void;
// //   onTake: (h: Hunk) => void;
// //   onTransfer: (from: Side, rows: number[], level: number) => void;
// //   onDeleteRows: (side: Side, rows: number[]) => void;
// //   onEditLine: (side: Side, no: number, text: string) => void;
// //   onAsk?: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
// //   onApplyAi?: (h: Hunk, replacement: string) => void;
// //   emptyTitle?: string;
// //   emptyHint?: string;
// // }

// // export default function DiffView(p: Props) {
// //   const { rows, hunks, collapse } = p;
// //   const [expanded, setExpanded] = useState<Set<string>>(new Set());
// //   const [current, setCurrent] = useState(-1);
// //   const [sel, setSel] = useState<Selection | null>(null);
// //   const [editing, setEditing] = useState<{ idx: number; side: Side } | null>(null);
// //   const [query, setQuery] = useState('');
// //   const [matchPos, setMatchPos] = useState(-1);
// //   const [transferLevel, setTransferLevel] = useState(0);
// //   const variableMarks = useMemo(() => diffVars(p.leftText, p.rightText), [p.leftText, p.rightText]);

// //   const anchor = useRef<number | null>(null);
// //   const drag = useRef<Side | null>(null);
// //   const lastEnter = useRef<number>(-1);
// //   const bodyRef = useRef<HTMLDivElement>(null);
// //   const pr = useRef(p);
// //   pr.current = p;

// //   const lName = p.leftName || 'Left';
// //   const rName = p.rightName || 'Right';

// //   /* ---- reset transient state when the rows change (after any edit) ---- */
// //   useEffect(() => {
// //     setSel(null);
// //     setEditing(null);
// //     anchor.current = null;
// //   }, [rows]);

// //   useEffect(() => {
// //     setCurrent((c) => Math.min(c, hunks.length - 1));
// //   }, [hunks.length]);

// //   useEffect(() => {
// //     const up = () => {
// //       drag.current = null;
// //       lastEnter.current = -1;
// //     };
// //     window.addEventListener('mouseup', up);
// //     return () => window.removeEventListener('mouseup', up);
// //   }, []);

// //   /* ---- items (rows, hunk bars, folds) ---- */
// //   const items = useMemo(() => {
// //     const startAt = new Map<number, number>();
// //     const hunkOfRow = new Int32Array(rows.length).fill(-1);
// //     hunks.forEach((h, n) => {
// //       startAt.set(h.rowStart, n);
// //       for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
// //     });

// //     const out: Item[] = [];
// //     const pushRow = (idx: number) => {
// //       const n = startAt.get(idx);
// //       if (n !== undefined) out.push({ type: 'hunk', n });
// //       out.push({ type: 'row', idx, row: rows[idx], h: hunkOfRow[idx] });
// //     };

// //     let i = 0;
// //     while (i < rows.length) {
// //       if (rows[i].kind !== 'equal') {
// //         pushRow(i);
// //         i++;
// //         continue;
// //       }
// //       let j = i;
// //       while (j < rows.length && rows[j].kind === 'equal') j++;
// //       const len = j - i;
// //       const head = i === 0 ? 0 : CTX;
// //       const tail = j === rows.length ? 0 : CTX;
// //       const key = foldKey(rows[i]);

// //       if (!collapse || expanded.has(key) || len <= head + tail + 1) {
// //         for (let k = i; k < j; k++) pushRow(k);
// //       } else {
// //         for (let k = i; k < i + head; k++) pushRow(k);
// //         out.push({ type: 'fold', key, count: len - head - tail });
// //         for (let k = j - tail; k < j; k++) pushRow(k);
// //       }
// //       i = j;
// //     }
// //     return out;
// //   }, [rows, hunks, collapse, expanded]);

// //   /* ---- width for "no wrap" mode so every row lines up ---- */
// //   const maxCols = useMemo(() => {
// //     let m = 20;
// //     for (const r of rows) {
// //       const a = r.left?.text.length ?? 0;
// //       const b = r.right?.text.length ?? 0;
// //       if (a > m) m = a;
// //       if (b > m) m = b;
// //     }
// //     return Math.min(m, 3000);
// //   }, [rows]);

// //   /* ---- search ---- */
// //   const needle = query.trim().toLowerCase();
// //   const matches = useMemo(() => {
// //     if (needle.length < 2) return [] as number[];
// //     const out: number[] = [];
// //     rows.forEach((r, i) => {
// //       if (r.left?.text.toLowerCase().includes(needle) || r.right?.text.toLowerCase().includes(needle)) out.push(i);
// //     });
// //     return out;
// //   }, [rows, needle]);
// //   const matchSet = useMemo(() => new Set(matches), [matches]);

// //   useEffect(() => {
// //     setMatchPos(-1);
// //   }, [needle]);

// //   const revealRow = (idx: number) => {
// //     const r = rows[idx];
// //     if (!r) return;
// //     if (r.kind === 'equal') {
// //       let s = idx;
// //       while (s > 0 && rows[s - 1].kind === 'equal') s--;
// //       const key = foldKey(rows[s]);
// //       setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
// //     }
// //     window.setTimeout(() => document.getElementById(`row-${idx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
// //   };

// //   const stepMatch = (d: number) => {
// //     if (matches.length === 0) return;
// //     const from = matchPos < 0 ? (d > 0 ? -1 : 0) : matchPos;
// //     const n = (((from + d) % matches.length) + matches.length) % matches.length;
// //     setMatchPos(n);
// //     revealRow(matches[n]);
// //   };

// //   /* ---- change navigation ---- */
// //   const goTo = (n: number) => {
// //     if (hunks.length === 0) return;
// //     const next = ((n % hunks.length) + hunks.length) % hunks.length;
// //     setCurrent(next);
// //     document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
// //   };

// //   const nextUnreviewed = () => {
// //     for (let k = 1; k <= hunks.length; k++) {
// //       const n = (current + k + hunks.length) % hunks.length;
// //       if (!p.reviewed.has(hunks[n].sig)) return goTo(n);
// //     }
// //   };

// //   const toggleReview = (sig: string) => {
// //     const n = new Set(p.reviewed);
// //     if (n.has(sig)) n.delete(sig);
// //     else n.add(sig);
// //     p.onReviewedChange(n);
// //   };

// //   /* ---- line selection ---- */
// //   const pick = useCallback((idx: number, side: Side, e: ReactMouseEvent) => {
// //     if (e.type === 'mousedown') {
// //       if (e.button !== 0) return;
// //       e.preventDefault();
// //       drag.current = side;
// //       lastEnter.current = idx;
// //     }
// //     const additive = e.ctrlKey || e.metaKey;
// //     const shift = e.shiftKey;
// //     setEditing(null);
// //     setSel((prev) => {
// //       const same = prev !== null && prev.side === side;
// //       const set = same && (additive || shift) ? new Set(prev.set) : new Set<number>();
// //       if (shift && same && anchor.current !== null) {
// //         const a = Math.min(anchor.current, idx);
// //         const b = Math.max(anchor.current, idx);
// //         for (let k = a; k <= b; k++) set.add(k);
// //         return { side, set };
// //       }
// //       anchor.current = idx;
// //       if (additive && same) {
// //         if (set.has(idx)) set.delete(idx);
// //         else set.add(idx);
// //         return set.size ? { side, set } : null;
// //       }
// //       set.add(idx);
// //       return { side, set };
// //     });
// //   }, []);

// //   const enter = useCallback((idx: number) => {
// //     const side = drag.current;
// //     if (!side || anchor.current === null || lastEnter.current === idx) return;
// //     lastEnter.current = idx;
// //     const a = Math.min(anchor.current, idx);
// //     const b = Math.max(anchor.current, idx);
// //     const set = new Set<number>();
// //     for (let k = a; k <= b; k++) set.add(k);
// //     setSel({ side, set });
// //   }, []);

// //   const startEdit = useCallback((idx: number, side: Side) => {
// //     setSel(null);
// //     setEditing({ idx, side });
// //   }, []);

// //   const commitEdit = useCallback((side: Side, no: number, value: string, original: string) => {
// //     setEditing(null);
// //     if (value !== original) pr.current.onEditLine(side, no, value);
// //   }, []);

// //   const cancelEdit = useCallback(() => setEditing(null), []);

// //   const sortedSel = () => (sel ? Array.from(sel.set).sort((a, b) => a - b) : []);

// //   const doTransfer = () => {
// //     if (!sel || p.busy) return;
// //     p.onTransfer(sel.side, sortedSel(), transferLevel);
// //     setSel(null);
// //   };

// //   const doDelete = () => {
// //     if (!sel || p.busy) return;
// //     p.onDeleteRows(sel.side, sortedSel());
// //     setSel(null);
// //   };

// //   /* ---- keyboard: Alt+Up/Down = previous/next change, Esc = clear selection, Ctrl+Enter = transfer ---- */
// //   useEffect(() => {
// //     const onKey = (e: KeyboardEvent) => {
// //       const t = e.target as HTMLElement | null;
// //       const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
// //       if (e.altKey && e.key === 'ArrowDown') {
// //         e.preventDefault();
// //         goTo(current + 1);
// //       } else if (e.altKey && e.key === 'ArrowUp') {
// //         e.preventDefault();
// //         goTo(current - 1);
// //       } else if (e.key === 'Escape' && !typing) {
// //         setSel(null);
// //       } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !typing && sel) {
// //         e.preventDefault();
// //         doTransfer();
// //       }
// //     };
// //     window.addEventListener('keydown', onKey);
// //     return () => window.removeEventListener('keydown', onKey);
// //   });

// //   /* ---- floating arrow ---- */
// //   let popupRow = -1;
// //   if (sel) sel.set.forEach((i) => (popupRow = Math.max(popupRow, i)));

// //   const to: Side = sel?.side === 'left' ? 'right' : 'left';
// //   const canTo = !!sel && (to === 'left' ? p.editable.left : p.editable.right);
// //   const canFrom = !!sel && (sel.side === 'left' ? p.editable.left : p.editable.right);
// //   const toName = to === 'left' ? lName : rName;

// //   const popup: ReactNode = sel ? (
// //     <div className="xfer" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
// //       <span className="xfer-count">
// //         {sel.set.size} line{sel.set.size === 1 ? '' : 's'}
// //       </span>
// //       {canTo && (
// //         <label className="xfer-scope">
// //           Scope
// //           <select value={transferLevel} onChange={(e) => setTransferLevel(Number(e.target.value))} disabled={p.busy}>
// //             <option value={-1}>Exact lines</option>
// //             <option value={0}>Smart unit</option>
// //             <option value={1}>Expand 1 level</option>
// //             <option value={2}>Expand 2 levels</option>
// //           </select>
// //         </label>
// //       )}
// //       {canTo && (
// //         <button
// //           type="button"
// //           className="xfer-go"
// //           disabled={p.busy}
// //           onClick={doTransfer}
// //           title={`Transfer using the selected scope to ${toName} (Ctrl+Enter). Review the proposed change before applying.`}
// //         >
// //           {sel.side === 'left' ? `${toName} →` : `← ${toName}`}
// //         </button>
// //       )}
// //       {canFrom && (
// //         <button type="button" className="xfer-del" disabled={p.busy} onClick={doDelete} title="Remove the selected lines from this side">
// //           Delete
// //         </button>
// //       )}
// //       <button type="button" className="xfer-x" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSel(null)}>
// //         ✕
// //       </button>
// //     </div>
// //   ) : null;

// //   /* ---- render ---- */
// //   if (hunks.length === 0) {
// //     return (
// //       <div className="empty">
// //         <strong>{p.emptyTitle ?? 'No differences.'}</strong>
// //         <span>{p.emptyHint ?? 'With the current ignore rules both procedures match.'}</span>
// //       </div>
// //     );
// //   }

// //   const doneCount = hunks.filter((h) => p.reviewed.has(h.sig)).length;
// //   const bodyStyle = { '--fs': `${p.fontSize}px`, '--cols': String(maxCols + 2) } as CSSProperties;

// //   return (
// //     <div className={`diff-wrap${p.showList ? '' : ' no-list'}`}>
// //       {p.showList && <ChangeList hunks={hunks} current={current} reviewed={p.reviewed} onGo={goTo} />}

// //       <div className="diff">
// //         <div className="diff-nav">
// //           <button type="button" onClick={() => goTo(current - 1)} title="Alt+Up">
// //             Previous
// //           </button>
// //           <button type="button" onClick={() => goTo(current + 1)} title="Alt+Down">
// //             Next
// //           </button>
// //           <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
// //             Next unreviewed
// //           </button>
// //           <span className="muted">
// //             {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
// //           </span>
// //           <span className="variable-legend" title="SQL variable diagnostics">
// //             <span className="sql-var-only">@var one-sided</span>
// //             <span className="sql-var-bad">@var undeclared</span>
// //           </span>
// //           <span className="spacer" />
// //           <input
// //             className="find"
// //             value={query}
// //             placeholder="Find in code"
// //             aria-label="Find in code"
// //             onChange={(e) => setQuery(e.target.value)}
// //             onKeyDown={(e) => {
// //               if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
// //             }}
// //           />
// //           <button type="button" onClick={() => stepMatch(-1)} disabled={matches.length === 0} aria-label="Previous match">
// //             ↑
// //           </button>
// //           <button type="button" onClick={() => stepMatch(1)} disabled={matches.length === 0} aria-label="Next match">
// //             ↓
// //           </button>
// //           <span className="muted small">{needle.length >= 2 ? `${matchPos >= 0 ? matchPos + 1 : 0}/${matches.length}` : ''}</span>
// //         </div>

// //         <div className="diff-main">
// //           <div
// //             ref={bodyRef}
// //             className={`diff-body ${p.wrap ? 'wrap' : 'nowrap'}`}
// //             style={bodyStyle}
// //             onMouseDown={(e) => {
// //               const code = (e.target as HTMLElement).closest('.code');
// //               if (code && bodyRef.current) bodyRef.current.dataset.side = code.classList.contains('c-left') ? 'left' : 'right';
// //             }}
// //           >
// //             <div className="diff-head">
// //               <span />
// //               <span className="name">{lName}</span>
// //               <span />
// //               <span className="name">{rName}</span>
// //             </div>

// //             {items.map((it) => {
// //               if (it.type === 'fold') {
// //                 return (
// //                   <button
// //                     key={`f${it.key}`}
// //                     type="button"
// //                     className="fold"
// //                     onClick={() => setExpanded((s) => new Set(s).add(it.key))}
// //                   >
// //                     Show {it.count} unchanged lines
// //                   </button>
// //                 );
// //               }
// //               if (it.type === 'hunk') {
// //                 const h = hunks[it.n];
// //                 return (
// //                   <HunkBar
// //                     key={h.sig}
// //                     id={`chg-${it.n}`}
// //                     mode={p.mode}
// //                     hunk={h}
// //                     index={it.n}
// //                     total={hunks.length}
// //                     leftName={p.leftName}
// //                     rightName={p.rightName}
// //                     target={p.target}
// //                     busy={p.busy}
// //                     current={it.n === current}
// //                     reviewed={p.reviewed.has(h.sig)}
// //                     onReview={() => toggleReview(h.sig)}
// //                     onTake={() => p.onTake(h)}
// //                     onSelect={(side) => {
// //                       const set = new Set<number>();
// //                       for (let k = h.rowStart; k <= h.rowEnd; k++) set.add(k);
// //                       anchor.current = h.rowStart;
// //                       setEditing(null);
// //                       setSel({ side, set });
// //                     }}
// //                     onAsk={p.onAsk ? (mode, ins) => p.onAsk!(h, mode, ins) : undefined}
// //                     onApplyAi={p.onApplyAi ? (rep) => p.onApplyAi!(h, rep) : undefined}
// //                   />
// //                 );
// //               }
// //               const i = it.idx;
// //               return (
// //                 <DiffRow
// //                   key={`r${i}`}
// //                   idx={i}
// //                   row={it.row}
// //                   current={it.h === current}
// //                   reviewed={it.h >= 0 && p.reviewed.has(hunks[it.h].sig)}
// //                   selL={!!sel && sel.side === 'left' && sel.set.has(i)}
// //                   selR={!!sel && sel.side === 'right' && sel.set.has(i)}
// //                   hit={matchPos >= 0 && matches[matchPos] === i}
// //                   match={matchSet.has(i)}
// //                   editing={editing && editing.idx === i ? editing.side : null}
// //                   canL={p.editable.left}
// //                   canR={p.editable.right}
// //                   popup={sel && i === popupRow ? popup : null}
// //                   varMarks={variableMarks}
// //                   onPick={pick}
// //                   onEnter={enter}
// //                   onEdit={startEdit}
// //                   onCommit={commitEdit}
// //                   onCancel={cancelEdit}
// //                 />
// //               );
// //             })}
// //           </div>

// //           <div className="ruler" aria-hidden>
// //             {hunks.map((h, n) => (
// //               <button
// //                 key={h.sig}
// //                 type="button"
// //                 tabIndex={-1}
// //                 className={`mark ${h.kind}${n === current ? ' on' : ''}`}
// //                 style={{ top: `${(h.rowStart / Math.max(1, rows.length)) * 100}%` }}
// //                 title={`${n + 1}. ${h.title}`}
// //                 onClick={() => goTo(n)}
// //               />
// //             ))}
// //           </div>
// //         </div>
// //       </div>
// //     </div>
// //   );
// // }


// // import { memo, useEffect, useMemo, useState } from 'react';
// // import type { Cell, Hunk, HunkAiResult, Row, Side } from '../types';
// // import ChangeList from './ChangeList';
// // import HunkBar from './HunkBar';
// // const CTX = 3;

// // type Item =
// //   | { type: 'row'; row: Row; key: string; h: number }
// //   | { type: 'hunk'; n: number }
// //   | { type: 'fold'; runStart: number; count: number };

// // function renderCell(cell?: Cell) {
// //   if (!cell) return '\u00a0';
// //   if (cell.segs) {
// //     return cell.segs.map((s, i) => (
// //       <span key={i} className={s.type === 'same' ? undefined : s.type}>
// //         {s.text}
// //       </span>
// //     ));
// //   }
// //   return cell.text === '' ? '\u00a0' : cell.text;
// // }

// // const DiffRow = memo(function DiffRow({ row, current, reviewed }: { row: Row; current: boolean; reviewed: boolean }) {
// //   return (
// //     <div className={`row ${row.kind}${current ? ' current' : ''}${reviewed ? ' reviewed' : ''}`}>
// //       <span className="no">{row.left?.no ?? ''}</span>
// //       <code className="code">{renderCell(row.left)}</code>
// //       <span className="no">{row.right?.no ?? ''}</span>
// //       <code className="code">{renderCell(row.right)}</code>
// //     </div>
// //   );
// // });

// // interface Props {
// //   rows: Row[];
// //   hunks: Hunk[];
// //   leftName: string;
// //   rightName: string;
// //   collapse: boolean;
// //   target: Side;
// //   busy: boolean;
// //   onTake: (h: Hunk) => void;
// //   onAsk: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
// //   onApplyAi: (h: Hunk, replacement: string) => void;
// // }

// // export default function DiffView(p: Props) {
// //   const { rows, hunks, collapse } = p;
// //   const [expanded, setExpanded] = useState<Set<number>>(new Set());
// //   const [current, setCurrent] = useState(-1);
// //   const [reviewed, setReviewed] = useState<Set<string>>(new Set());

// //   useEffect(() => {
// //     setExpanded(new Set());
// //     setCurrent((c) => Math.min(c, hunks.length - 1));
// //   }, [rows, hunks.length]);

// //   const items = useMemo(() => {
// //     const startAt = new Map<number, number>();
// //     const hunkOfRow = new Int32Array(rows.length).fill(-1);
// //     hunks.forEach((h, n) => {
// //       startAt.set(h.rowStart, n);
// //       for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
// //     });

// //     const out: Item[] = [];
// //     const pushRow = (idx: number) => {
// //       const n = startAt.get(idx);
// //       if (n !== undefined) out.push({ type: 'hunk', n });
// //       out.push({ type: 'row', row: rows[idx], key: `r${idx}`, h: hunkOfRow[idx] });
// //     };

// //     let i = 0;
// //     while (i < rows.length) {
// //       if (rows[i].kind !== 'equal') {
// //         pushRow(i);
// //         i++;
// //         continue;
// //       }
// //       let j = i;
// //       while (j < rows.length && rows[j].kind === 'equal') j++;
// //       const len = j - i;
// //       const head = i === 0 ? 0 : CTX;
// //       const tail = j === rows.length ? 0 : CTX;

// //       if (!collapse || expanded.has(i) || len <= head + tail + 1) {
// //         for (let k = i; k < j; k++) pushRow(k);
// //       } else {
// //         for (let k = i; k < i + head; k++) pushRow(k);
// //         out.push({ type: 'fold', runStart: i, count: len - head - tail });
// //         for (let k = j - tail; k < j; k++) pushRow(k);
// //       }
// //       i = j;
// //     }
// //     return out;
// //   }, [rows, hunks, collapse, expanded]);

// //   const goTo = (n: number) => {
// //     if (hunks.length === 0) return;
// //     const next = ((n % hunks.length) + hunks.length) % hunks.length;
// //     setCurrent(next);
// //     document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
// //   };

// //   const nextUnreviewed = () => {
// //     for (let k = 1; k <= hunks.length; k++) {
// //       const n = (current + k + hunks.length) % hunks.length;
// //       if (!reviewed.has(hunks[n].sig)) return goTo(n);
// //     }
// //   };

// //   const toggleReview = (sig: string) =>
// //     setReviewed((s) => {
// //       const n = new Set(s);
// //       if (n.has(sig)) n.delete(sig);
// //       else n.add(sig);
// //       return n;
// //     });

// //   if (hunks.length === 0) {
// //     return (
// //       <div className="empty">
// //         <strong>No differences.</strong>
// //         <span>With the current ignore rules both procedures match.</span>
// //       </div>
// //     );
// //   }

// //   const doneCount = hunks.filter((h) => reviewed.has(h.sig)).length;

// //   return (
// //     <div className="diff-wrap">
// //       <ChangeList hunks={hunks} current={current} reviewed={reviewed} onGo={goTo} />

// //       <div className="diff">
// //         <div className="diff-nav">
// //           <button type="button" onClick={() => goTo(current - 1)}>
// //             Previous
// //           </button>
// //           <button type="button" onClick={() => goTo(current + 1)}>
// //             Next
// //           </button>
// //           <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
// //             Next unreviewed
// //           </button>
// //           <span className="muted">
// //             {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
// //           </span>
// //         </div>

// //         <div className="diff-head">
// //           <span />
// //           <span className="name">{p.leftName || 'Left'}</span>
// //           <span />
// //           <span className="name">{p.rightName || 'Right'}</span>
// //         </div>

// //         <div className="diff-body">
// //           {items.map((it) => {
// //             if (it.type === 'fold') {
// //               return (
// //                 <button
// //                   key={`f${it.runStart}`}
// //                   type="button"
// //                   className="fold"
// //                   onClick={() => setExpanded((s) => new Set(s).add(it.runStart))}
// //                 >
// //                   Show {it.count} unchanged lines
// //                 </button>
// //               );
// //             }
// //             if (it.type === 'hunk') {
// //               const h = hunks[it.n];
// //               return (
// //                 <HunkBar
// //                   key={h.sig}
// //                   id={`chg-${it.n}`}
// //                   hunk={h}
// //                   index={it.n}
// //                   total={hunks.length}
// //                   leftName={p.leftName}
// //                   rightName={p.rightName}
// //                   target={p.target}
// //                   busy={p.busy}
// //                   current={it.n === current}
// //                   reviewed={reviewed.has(h.sig)}
// //                   onReview={() => toggleReview(h.sig)}
// //                   onTake={() => p.onTake(h)}
// //                   onAsk={(mode, ins) => p.onAsk(h, mode, ins)}
// //                   onApplyAi={(rep) => p.onApplyAi(h, rep)}
// //                 />
// //               );
// //             }
// //             return (
// //               <DiffRow
// //                 key={it.key}
// //                 row={it.row}
// //                 current={it.h === current}
// //                 reviewed={it.h >= 0 && reviewed.has(hunks[it.h].sig)}
// //               />
// //             );
// //           })}
// //         </div>
// //       </div>
// //     </div>
// //   );
// // }



// import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
// import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
// import type { Cell, Editable, Hunk, HunkAiResult, Row, Side } from '../types';
// import ChangeList from './ChangeList';
// import HunkBar from './HunkBar';
// import { diffVars } from '../lib/Vars';
// import type { VarMarks } from '../types';

// const CTX = 3;

// type Selection = { side: Side; set: Set<number> };

// interface RecentTransferMark {
//   side: Side;
//   from: number;
//   to: number;
//   summary: string;
// }

// type Item =
//   | { type: 'row'; idx: number; row: Row; h: number }
//   | { type: 'hunk'; n: number }
//   | { type: 'fold'; key: string; count: number };

// const foldKey = (r: Row) => `${r.left?.no ?? 0}:${r.right?.no ?? 0}`;

// function highlightVariables(text: string, marks: VarMarks) {
//   const re = /@@?[A-Za-z_][\w$#@]*/g;
//   const out: ReactNode[] = [];
//   let last = 0;
//   let m: RegExpExecArray | null;
//   while ((m = re.exec(text))) {
//     if (m.index > last) out.push(text.slice(last, m.index));
//     const name = m[0].toLowerCase();
//     const cls = marks.bad.has(name) ? 'sql-var-bad' : marks.only.has(name) ? 'sql-var-only' : '';
//     out.push(cls ? <span key={`${m.index}-${name}`} className={cls} title={marks.bad.has(name) ? 'Variable is used but not declared on this side' : 'Variable exists only on one side'}>{m[0]}</span> : m[0]);
//     last = m.index + m[0].length;
//   }
//   if (last < text.length) out.push(text.slice(last));
//   return out;
// }

// function renderCell(cell: Cell | undefined, marks: VarMarks) {
//   if (!cell) return '\u00a0';
//   if (cell.segs) {
//     return cell.segs.map((s, i) => (
//       <span key={i} className={s.type === 'same' ? undefined : s.type}>
//         {highlightVariables(s.text, marks)}
//       </span>
//     ));
//   }
//   return cell.text === '' ? '\u00a0' : highlightVariables(cell.text, marks);
// }

// function LineEditor({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
//   const done = useRef(false);
//   const finish = (v: string | null) => {
//     if (done.current) return;
//     done.current = true;
//     if (v === null) onCancel();
//     else onCommit(v);
//   };
//   return (
//     <input
//       className="line-edit"
//       autoFocus
//       spellCheck={false}
//       defaultValue={value}
//       onFocus={(e) => e.currentTarget.select()}
//       onKeyDown={(e) => {
//         if (e.key === 'Enter') finish(e.currentTarget.value);
//         else if (e.key === 'Escape') finish(null);
//       }}
//       onBlur={(e) => finish(e.currentTarget.value)}
//     />
//   );
// }

// interface RowProps {
//   idx: number;
//   row: Row;
//   current: boolean;
//   reviewed: boolean;
//   selL: boolean;
//   selR: boolean;
//   hit: boolean;
//   match: boolean;
//   transferredSide: Side | null;
//   editing: Side | null;
//   canL: boolean;
//   canR: boolean;
//   popup: ReactNode;
//   varMarks: { left: VarMarks; right: VarMarks };
//   onPick: (idx: number, side: Side, e: ReactMouseEvent) => void;
//   onEnter: (idx: number) => void;
//   onEdit: (idx: number, side: Side) => void;
//   onCommit: (side: Side, no: number, value: string, original: string) => void;
//   onCancel: () => void;
// }

// const DiffRow = memo(function DiffRow(p: RowProps) {
//   const { row } = p;
//   const cls = [
//     'row',
//     row.kind,
//     p.current ? 'current' : '',
//     p.reviewed ? 'reviewed' : '',
//     p.match ? 'match' : '',
//     p.hit ? 'hit' : '',
//     p.transferredSide ? `transferred transferred-${p.transferredSide}` : '',
//     p.popup ? 'has-popup' : '',
//   ]
//     .filter(Boolean)
//     .join(' ');

//   const cell = (side: Side) => {
//     const c = row[side];
//     const selected = side === 'left' ? p.selL : p.selR;
//     const can = side === 'left' ? p.canL : p.canR;
//     return (
//       <>
//         <span
//           className={`no no-${side}${selected ? ' sel' : ''}`}
//           title="Click to select this line. Shift+click selects a range, Ctrl/Cmd+click adds a line"
//           onMouseDown={(e) => p.onPick(p.idx, side, e)}
//         >
//           {c?.no ?? ''}
//         </span>
//         {p.editing === side && c ? (
//           <div className={`code c-${side}`}>
//             <LineEditor value={c.text} onCommit={(v) => p.onCommit(side, c.no, v, c.text)} onCancel={p.onCancel} />
//           </div>
//         ) : (
//           <code
//             className={`code c-${side}${selected ? ' sel' : ''}${c ? '' : ' ghost'}`}
//             title={can && c ? 'Double-click to edit this line' : undefined}
//             onClick={(e) => {
//               if (window.getSelection()?.toString()) return; // user is selecting text to copy
//               p.onPick(p.idx, side, e);
//             }}
//             onDoubleClick={() => {
//               if (can && c) p.onEdit(p.idx, side);
//             }}
//           >
//             {renderCell(c, p.varMarks[side])}
//           </code>
//         )}
//       </>
//     );
//   };

//   return (
//     <div id={`row-${p.idx}`} className={cls} onMouseEnter={() => p.onEnter(p.idx)}>
//       {cell('left')}
//       {cell('right')}
//       {p.popup}
//     </div>
//   );
// });

// interface Props {
//   mode: 'compare' | 'review';
//   rows: Row[];
//   leftText: string;
//   rightText: string;
//   hunks: Hunk[];
//   leftName: string;
//   rightName: string;
//   collapse: boolean;
//   wrap: boolean;
//   fontSize: number;
//   showList: boolean;
//   target: Side;
//   busy: boolean;
//   recentTransfer?: RecentTransferMark | null;
//   onDismissTransfer?: () => void;
//   editable: Editable;
//   reviewed: Set<string>;
//   onReviewedChange: (next: Set<string>) => void;
//   onTake: (h: Hunk) => void;
//   onTransfer: (from: Side, rows: number[], level: number) => void;
//   onDeleteRows: (side: Side, rows: number[]) => void;
//   onEditLine: (side: Side, no: number, text: string) => void;
//   onAsk?: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
//   onApplyAi?: (h: Hunk, replacement: string) => void;
//   emptyTitle?: string;
//   emptyHint?: string;
// }

// export default function DiffView(p: Props) {
//   const { rows, hunks, collapse } = p;
//   const [expanded, setExpanded] = useState<Set<string>>(new Set());
//   const [current, setCurrent] = useState(-1);
//   const [sel, setSel] = useState<Selection | null>(null);
//   const [editing, setEditing] = useState<{ idx: number; side: Side } | null>(null);
//   const [query, setQuery] = useState('');
//   const [matchPos, setMatchPos] = useState(-1);
//   const [transferLevel, setTransferLevel] = useState(0);
//   const variableMarks = useMemo(() => diffVars(p.leftText, p.rightText), [p.leftText, p.rightText]);

//   const anchor = useRef<number | null>(null);
//   const drag = useRef<Side | null>(null);
//   const lastEnter = useRef<number>(-1);
//   const bodyRef = useRef<HTMLDivElement>(null);
//   const pr = useRef(p);
//   pr.current = p;

//   const lName = p.leftName || 'Left';
//   const rName = p.rightName || 'Right';

//   /* ---- reset transient state when the rows change (after any edit) ---- */
//   useEffect(() => {
//     setSel(null);
//     setEditing(null);
//     anchor.current = null;
//   }, [rows]);

//   useEffect(() => {
//     setCurrent((c) => Math.min(c, hunks.length - 1));
//   }, [hunks.length]);

//   // After a transfer, take the user directly to the changed destination lines and
//   // keep a strong visual marker on those lines until another edit or dismissal.
//   useEffect(() => {
//     const mark = p.recentTransfer;
//     if (!mark || p.busy) return;
//     const idx = rows.findIndex((row) => {
//       const cell = row[mark.side];
//       return !!cell && cell.no >= mark.from && cell.no <= mark.to;
//     });
//     if (idx < 0) return;
//     const hunkIndex = hunks.findIndex((h) => idx >= h.rowStart && idx <= h.rowEnd);
//     if (hunkIndex >= 0) setCurrent(hunkIndex);
//     if (rows[idx]?.kind === 'equal') {
//       let start = idx;
//       while (start > 0 && rows[start - 1].kind === 'equal') start--;
//       const key = foldKey(rows[start]);
//       setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
//     }
//     window.setTimeout(() => {
//       document.getElementById(`row-${idx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
//     }, 80);
//   }, [p.recentTransfer?.side, p.recentTransfer?.from, p.recentTransfer?.to, p.busy, rows, hunks]);

//   useEffect(() => {
//     const up = () => {
//       drag.current = null;
//       lastEnter.current = -1;
//     };
//     window.addEventListener('mouseup', up);
//     return () => window.removeEventListener('mouseup', up);
//   }, []);

//   /* ---- items (rows, hunk bars, folds) ---- */
//   const items = useMemo(() => {
//     const startAt = new Map<number, number>();
//     const hunkOfRow = new Int32Array(rows.length).fill(-1);
//     hunks.forEach((h, n) => {
//       startAt.set(h.rowStart, n);
//       for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
//     });

//     const out: Item[] = [];
//     const pushRow = (idx: number) => {
//       const n = startAt.get(idx);
//       if (n !== undefined) out.push({ type: 'hunk', n });
//       out.push({ type: 'row', idx, row: rows[idx], h: hunkOfRow[idx] });
//     };

//     let i = 0;
//     while (i < rows.length) {
//       if (rows[i].kind !== 'equal') {
//         pushRow(i);
//         i++;
//         continue;
//       }
//       let j = i;
//       while (j < rows.length && rows[j].kind === 'equal') j++;
//       const len = j - i;
//       const head = i === 0 ? 0 : CTX;
//       const tail = j === rows.length ? 0 : CTX;
//       const key = foldKey(rows[i]);

//       if (!collapse || expanded.has(key) || len <= head + tail + 1) {
//         for (let k = i; k < j; k++) pushRow(k);
//       } else {
//         for (let k = i; k < i + head; k++) pushRow(k);
//         out.push({ type: 'fold', key, count: len - head - tail });
//         for (let k = j - tail; k < j; k++) pushRow(k);
//       }
//       i = j;
//     }
//     return out;
//   }, [rows, hunks, collapse, expanded]);

//   /* ---- width for "no wrap" mode so every row lines up ---- */
//   const maxCols = useMemo(() => {
//     let m = 20;
//     for (const r of rows) {
//       const a = r.left?.text.length ?? 0;
//       const b = r.right?.text.length ?? 0;
//       if (a > m) m = a;
//       if (b > m) m = b;
//     }
//     return Math.min(m, 3000);
//   }, [rows]);

//   /* ---- search ---- */
//   const needle = query.trim().toLowerCase();
//   const matches = useMemo(() => {
//     if (needle.length < 2) return [] as number[];
//     const out: number[] = [];
//     rows.forEach((r, i) => {
//       if (r.left?.text.toLowerCase().includes(needle) || r.right?.text.toLowerCase().includes(needle)) out.push(i);
//     });
//     return out;
//   }, [rows, needle]);
//   const matchSet = useMemo(() => new Set(matches), [matches]);

//   useEffect(() => {
//     setMatchPos(-1);
//   }, [needle]);

//   const revealRow = (idx: number) => {
//     const r = rows[idx];
//     if (!r) return;
//     if (r.kind === 'equal') {
//       let s = idx;
//       while (s > 0 && rows[s - 1].kind === 'equal') s--;
//       const key = foldKey(rows[s]);
//       setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
//     }
//     window.setTimeout(() => document.getElementById(`row-${idx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
//   };

//   const stepMatch = (d: number) => {
//     if (matches.length === 0) return;
//     const from = matchPos < 0 ? (d > 0 ? -1 : 0) : matchPos;
//     const n = (((from + d) % matches.length) + matches.length) % matches.length;
//     setMatchPos(n);
//     revealRow(matches[n]);
//   };

//   /* ---- change navigation ---- */
//   const goTo = (n: number) => {
//     if (hunks.length === 0) return;
//     const next = ((n % hunks.length) + hunks.length) % hunks.length;
//     setCurrent(next);
//     document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
//   };

//   const nextUnreviewed = () => {
//     for (let k = 1; k <= hunks.length; k++) {
//       const n = (current + k + hunks.length) % hunks.length;
//       if (!p.reviewed.has(hunks[n].sig)) return goTo(n);
//     }
//   };

//   const toggleReview = (sig: string) => {
//     const n = new Set(p.reviewed);
//     if (n.has(sig)) n.delete(sig);
//     else n.add(sig);
//     p.onReviewedChange(n);
//   };

//   /* ---- line selection ---- */
//   const pick = useCallback((idx: number, side: Side, e: ReactMouseEvent) => {
//     if (e.type === 'mousedown') {
//       if (e.button !== 0) return;
//       e.preventDefault();
//       drag.current = side;
//       lastEnter.current = idx;
//     }
//     const additive = e.ctrlKey || e.metaKey;
//     const shift = e.shiftKey;
//     setEditing(null);
//     setSel((prev) => {
//       const same = prev !== null && prev.side === side;
//       const set = same && (additive || shift) ? new Set(prev.set) : new Set<number>();
//       if (shift && same && anchor.current !== null) {
//         const a = Math.min(anchor.current, idx);
//         const b = Math.max(anchor.current, idx);
//         for (let k = a; k <= b; k++) set.add(k);
//         return { side, set };
//       }
//       anchor.current = idx;
//       if (additive && same) {
//         if (set.has(idx)) set.delete(idx);
//         else set.add(idx);
//         return set.size ? { side, set } : null;
//       }
//       set.add(idx);
//       return { side, set };
//     });
//   }, []);

//   const enter = useCallback((idx: number) => {
//     const side = drag.current;
//     if (!side || anchor.current === null || lastEnter.current === idx) return;
//     lastEnter.current = idx;
//     const a = Math.min(anchor.current, idx);
//     const b = Math.max(anchor.current, idx);
//     const set = new Set<number>();
//     for (let k = a; k <= b; k++) set.add(k);
//     setSel({ side, set });
//   }, []);

//   const startEdit = useCallback((idx: number, side: Side) => {
//     setSel(null);
//     setEditing({ idx, side });
//   }, []);

//   const commitEdit = useCallback((side: Side, no: number, value: string, original: string) => {
//     setEditing(null);
//     if (value !== original) pr.current.onEditLine(side, no, value);
//   }, []);

//   const cancelEdit = useCallback(() => setEditing(null), []);

//   const sortedSel = () => (sel ? Array.from(sel.set).sort((a, b) => a - b) : []);

//   const doTransfer = () => {
//     if (!sel || p.busy) return;
//     p.onTransfer(sel.side, sortedSel(), transferLevel);
//     setSel(null);
//   };

//   const doDelete = () => {
//     if (!sel || p.busy) return;
//     p.onDeleteRows(sel.side, sortedSel());
//     setSel(null);
//   };

//   /* ---- keyboard: Alt+Up/Down = previous/next change, Esc = clear selection, Ctrl+Enter = transfer ---- */
//   useEffect(() => {
//     const onKey = (e: KeyboardEvent) => {
//       const t = e.target as HTMLElement | null;
//       const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
//       if (e.altKey && e.key === 'ArrowDown') {
//         e.preventDefault();
//         goTo(current + 1);
//       } else if (e.altKey && e.key === 'ArrowUp') {
//         e.preventDefault();
//         goTo(current - 1);
//       } else if (e.key === 'Escape' && !typing) {
//         setSel(null);
//       } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !typing && sel) {
//         e.preventDefault();
//         doTransfer();
//       }
//     };
//     window.addEventListener('keydown', onKey);
//     return () => window.removeEventListener('keydown', onKey);
//   });

//   /* ---- floating arrow ---- */
//   let popupRow = -1;
//   if (sel) sel.set.forEach((i) => (popupRow = Math.max(popupRow, i)));

//   const to: Side = sel?.side === 'left' ? 'right' : 'left';
//   const canTo = !!sel && (to === 'left' ? p.editable.left : p.editable.right);
//   const canFrom = !!sel && (sel.side === 'left' ? p.editable.left : p.editable.right);
//   const toName = to === 'left' ? lName : rName;

//   const popup: ReactNode = sel ? (
//     <div className="xfer" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
//       <span className="xfer-count">
//         {sel.set.size} line{sel.set.size === 1 ? '' : 's'}
//       </span>
//       {canTo && (
//         <label className="xfer-scope">
//           Scope
//           <select value={transferLevel} onChange={(e) => setTransferLevel(Number(e.target.value))} disabled={p.busy}>
//             <option value={-1}>Exact lines</option>
//             <option value={0}>Smart unit</option>
//             <option value={1}>Expand 1 level</option>
//             <option value={2}>Expand 2 levels</option>
//           </select>
//         </label>
//       )}
//       {canTo && (
//         <button
//           type="button"
//           className="xfer-go"
//           disabled={p.busy}
//           onClick={doTransfer}
//           title={`Transfer using the selected scope to ${toName} (Ctrl+Enter). Review the proposed change before applying.`}
//         >
//           {sel.side === 'left' ? `${toName} →` : `← ${toName}`}
//         </button>
//       )}
//       {canFrom && (
//         <button type="button" className="xfer-del" disabled={p.busy} onClick={doDelete} title="Remove the selected lines from this side">
//           Delete
//         </button>
//       )}
//       <button type="button" className="xfer-x" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSel(null)}>
//         ✕
//       </button>
//     </div>
//   ) : null;

//   /* ---- render ---- */
//   if (hunks.length === 0 && !p.recentTransfer) {
//     return (
//       <div className="empty">
//         <strong>{p.emptyTitle ?? 'No differences.'}</strong>
//         <span>{p.emptyHint ?? 'With the current ignore rules both procedures match.'}</span>
//       </div>
//     );
//   }

//   const doneCount = hunks.filter((h) => p.reviewed.has(h.sig)).length;
//   const bodyStyle = { '--fs': `${p.fontSize}px`, '--cols': String(maxCols + 2) } as CSSProperties;

//   return (
//     <div className={`diff-wrap${p.showList ? '' : ' no-list'}`}>
//       {p.showList && <ChangeList hunks={hunks} current={current} reviewed={p.reviewed} onGo={goTo} />}

//       <div className="diff">
//         <div className="diff-nav">
//           {p.recentTransfer && (
//             <div className="transfer-result-banner" role="status">
//               <span className="transfer-result-icon" aria-hidden="true">✓</span>
//               <span>{p.recentTransfer.summary}</span>
//               <button type="button" className="transfer-result-dismiss" onClick={p.onDismissTransfer} aria-label="Dismiss transfer highlight" title="Dismiss transfer highlight">×</button>
//             </div>
//           )}
//           <button type="button" onClick={() => goTo(current - 1)} title="Alt+Up">
//             Previous
//           </button>
//           <button type="button" onClick={() => goTo(current + 1)} title="Alt+Down">
//             Next
//           </button>
//           <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
//             Next unreviewed
//           </button>
//           <span className="muted">
//             {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
//           </span>
//           <span className="variable-legend" title="SQL variable diagnostics">
//             <span className="sql-var-only">@var one-sided</span>
//             <span className="sql-var-bad">@var undeclared</span>
//           </span>
//           <span className="spacer" />
//           <input
//             className="find"
//             value={query}
//             placeholder="Find in code"
//             aria-label="Find in code"
//             onChange={(e) => setQuery(e.target.value)}
//             onKeyDown={(e) => {
//               if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
//             }}
//           />
//           <button type="button" onClick={() => stepMatch(-1)} disabled={matches.length === 0} aria-label="Previous match">
//             ↑
//           </button>
//           <button type="button" onClick={() => stepMatch(1)} disabled={matches.length === 0} aria-label="Next match">
//             ↓
//           </button>
//           <span className="muted small">{needle.length >= 2 ? `${matchPos >= 0 ? matchPos + 1 : 0}/${matches.length}` : ''}</span>
//         </div>

//         <div className="diff-main">
//           <div
//             ref={bodyRef}
//             className={`diff-body ${p.wrap ? 'wrap' : 'nowrap'}`}
//             style={bodyStyle}
//             onMouseDown={(e) => {
//               const code = (e.target as HTMLElement).closest('.code');
//               if (code && bodyRef.current) bodyRef.current.dataset.side = code.classList.contains('c-left') ? 'left' : 'right';
//             }}
//           >
//             <div className="diff-head">
//               <span />
//               <span className="name">{lName}</span>
//               <span />
//               <span className="name">{rName}</span>
//             </div>

//             {items.map((it) => {
//               if (it.type === 'fold') {
//                 return (
//                   <button
//                     key={`f${it.key}`}
//                     type="button"
//                     className="fold"
//                     onClick={() => setExpanded((s) => new Set(s).add(it.key))}
//                   >
//                     Show {it.count} unchanged lines
//                   </button>
//                 );
//               }
//               if (it.type === 'hunk') {
//                 const h = hunks[it.n];
//                 return (
//                   <HunkBar
//                     key={h.sig}
//                     id={`chg-${it.n}`}
//                     mode={p.mode}
//                     hunk={h}
//                     index={it.n}
//                     total={hunks.length}
//                     leftName={p.leftName}
//                     rightName={p.rightName}
//                     target={p.target}
//                     busy={p.busy}
//                     current={it.n === current}
//                     reviewed={p.reviewed.has(h.sig)}
//                     onReview={() => toggleReview(h.sig)}
//                     onTake={() => p.onTake(h)}
//                     onSelect={(side) => {
//                       const set = new Set<number>();
//                       for (let k = h.rowStart; k <= h.rowEnd; k++) set.add(k);
//                       anchor.current = h.rowStart;
//                       setEditing(null);
//                       setSel({ side, set });
//                     }}
//                     onAsk={p.onAsk ? (mode, ins) => p.onAsk!(h, mode, ins) : undefined}
//                     onApplyAi={p.onApplyAi ? (rep) => p.onApplyAi!(h, rep) : undefined}
//                   />
//                 );
//               }
//               const i = it.idx;
//               return (
//                 <DiffRow
//                   key={`r${i}`}
//                   idx={i}
//                   row={it.row}
//                   current={it.h === current}
//                   reviewed={it.h >= 0 && p.reviewed.has(hunks[it.h].sig)}
//                   selL={!!sel && sel.side === 'left' && sel.set.has(i)}
//                   selR={!!sel && sel.side === 'right' && sel.set.has(i)}
//                   hit={matchPos >= 0 && matches[matchPos] === i}
//                   match={matchSet.has(i)}
//                   transferredSide={p.recentTransfer && it.row[p.recentTransfer.side]?.no !== undefined && it.row[p.recentTransfer.side]!.no >= p.recentTransfer.from && it.row[p.recentTransfer.side]!.no <= p.recentTransfer.to ? p.recentTransfer.side : null}
//                   editing={editing && editing.idx === i ? editing.side : null}
//                   canL={p.editable.left}
//                   canR={p.editable.right}
//                   popup={sel && i === popupRow ? popup : null}
//                   varMarks={variableMarks}
//                   onPick={pick}
//                   onEnter={enter}
//                   onEdit={startEdit}
//                   onCommit={commitEdit}
//                   onCancel={cancelEdit}
//                 />
//               );
//             })}
//           </div>

//           <div className="ruler" aria-hidden>
//             {hunks.map((h, n) => (
//               <button
//                 key={h.sig}
//                 type="button"
//                 tabIndex={-1}
//                 className={`mark ${h.kind}${n === current ? ' on' : ''}`}
//                 style={{ top: `${(h.rowStart / Math.max(1, rows.length)) * 100}%` }}
//                 title={`${n + 1}. ${h.title}`}
//                 onClick={() => goTo(n)}
//               />
//             ))}
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// }

// import { memo, useEffect, useMemo, useState } from 'react';
// import type { Cell, Hunk, HunkAiResult, Row, Side } from '../types';
// import ChangeList from './ChangeList';
// import HunkBar from './HunkBar';
// const CTX = 3;

// type Item =
//   | { type: 'row'; row: Row; key: string; h: number }
//   | { type: 'hunk'; n: number }
//   | { type: 'fold'; runStart: number; count: number };

// function renderCell(cell?: Cell) {
//   if (!cell) return '\u00a0';
//   if (cell.segs) {
//     return cell.segs.map((s, i) => (
//       <span key={i} className={s.type === 'same' ? undefined : s.type}>
//         {s.text}
//       </span>
//     ));
//   }
//   return cell.text === '' ? '\u00a0' : cell.text;
// }

// const DiffRow = memo(function DiffRow({ row, current, reviewed }: { row: Row; current: boolean; reviewed: boolean }) {
//   return (
//     <div className={`row ${row.kind}${current ? ' current' : ''}${reviewed ? ' reviewed' : ''}`}>
//       <span className="no">{row.left?.no ?? ''}</span>
//       <code className="code">{renderCell(row.left)}</code>
//       <span className="no">{row.right?.no ?? ''}</span>
//       <code className="code">{renderCell(row.right)}</code>
//     </div>
//   );
// });

// interface Props {
//   rows: Row[];
//   hunks: Hunk[];
//   leftName: string;
//   rightName: string;
//   collapse: boolean;
//   target: Side;
//   busy: boolean;
//   onTake: (h: Hunk) => void;
//   onAsk: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
//   onApplyAi: (h: Hunk, replacement: string) => void;
// }

// export default function DiffView(p: Props) {
//   const { rows, hunks, collapse } = p;
//   const [expanded, setExpanded] = useState<Set<number>>(new Set());
//   const [current, setCurrent] = useState(-1);
//   const [reviewed, setReviewed] = useState<Set<string>>(new Set());

//   useEffect(() => {
//     setExpanded(new Set());
//     setCurrent((c) => Math.min(c, hunks.length - 1));
//   }, [rows, hunks.length]);

//   const items = useMemo(() => {
//     const startAt = new Map<number, number>();
//     const hunkOfRow = new Int32Array(rows.length).fill(-1);
//     hunks.forEach((h, n) => {
//       startAt.set(h.rowStart, n);
//       for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
//     });

//     const out: Item[] = [];
//     const pushRow = (idx: number) => {
//       const n = startAt.get(idx);
//       if (n !== undefined) out.push({ type: 'hunk', n });
//       out.push({ type: 'row', row: rows[idx], key: `r${idx}`, h: hunkOfRow[idx] });
//     };

//     let i = 0;
//     while (i < rows.length) {
//       if (rows[i].kind !== 'equal') {
//         pushRow(i);
//         i++;
//         continue;
//       }
//       let j = i;
//       while (j < rows.length && rows[j].kind === 'equal') j++;
//       const len = j - i;
//       const head = i === 0 ? 0 : CTX;
//       const tail = j === rows.length ? 0 : CTX;

//       if (!collapse || expanded.has(i) || len <= head + tail + 1) {
//         for (let k = i; k < j; k++) pushRow(k);
//       } else {
//         for (let k = i; k < i + head; k++) pushRow(k);
//         out.push({ type: 'fold', runStart: i, count: len - head - tail });
//         for (let k = j - tail; k < j; k++) pushRow(k);
//       }
//       i = j;
//     }
//     return out;
//   }, [rows, hunks, collapse, expanded]);

//   const goTo = (n: number) => {
//     if (hunks.length === 0) return;
//     const next = ((n % hunks.length) + hunks.length) % hunks.length;
//     setCurrent(next);
//     document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
//   };

//   const nextUnreviewed = () => {
//     for (let k = 1; k <= hunks.length; k++) {
//       const n = (current + k + hunks.length) % hunks.length;
//       if (!reviewed.has(hunks[n].sig)) return goTo(n);
//     }
//   };

//   const toggleReview = (sig: string) =>
//     setReviewed((s) => {
//       const n = new Set(s);
//       if (n.has(sig)) n.delete(sig);
//       else n.add(sig);
//       return n;
//     });

//   if (hunks.length === 0) {
//     return (
//       <div className="empty">
//         <strong>No differences.</strong>
//         <span>With the current ignore rules both procedures match.</span>
//       </div>
//     );
//   }

//   const doneCount = hunks.filter((h) => reviewed.has(h.sig)).length;

//   return (
//     <div className="diff-wrap">
//       <ChangeList hunks={hunks} current={current} reviewed={reviewed} onGo={goTo} />

//       <div className="diff">
//         <div className="diff-nav">
//           <button type="button" onClick={() => goTo(current - 1)}>
//             Previous
//           </button>
//           <button type="button" onClick={() => goTo(current + 1)}>
//             Next
//           </button>
//           <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
//             Next unreviewed
//           </button>
//           <span className="muted">
//             {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
//           </span>
//         </div>

//         <div className="diff-head">
//           <span />
//           <span className="name">{p.leftName || 'Left'}</span>
//           <span />
//           <span className="name">{p.rightName || 'Right'}</span>
//         </div>

//         <div className="diff-body">
//           {items.map((it) => {
//             if (it.type === 'fold') {
//               return (
//                 <button
//                   key={`f${it.runStart}`}
//                   type="button"
//                   className="fold"
//                   onClick={() => setExpanded((s) => new Set(s).add(it.runStart))}
//                 >
//                   Show {it.count} unchanged lines
//                 </button>
//               );
//             }
//             if (it.type === 'hunk') {
//               const h = hunks[it.n];
//               return (
//                 <HunkBar
//                   key={h.sig}
//                   id={`chg-${it.n}`}
//                   hunk={h}
//                   index={it.n}
//                   total={hunks.length}
//                   leftName={p.leftName}
//                   rightName={p.rightName}
//                   target={p.target}
//                   busy={p.busy}
//                   current={it.n === current}
//                   reviewed={reviewed.has(h.sig)}
//                   onReview={() => toggleReview(h.sig)}
//                   onTake={() => p.onTake(h)}
//                   onAsk={(mode, ins) => p.onAsk(h, mode, ins)}
//                   onApplyAi={(rep) => p.onApplyAi(h, rep)}
//                 />
//               );
//             }
//             return (
//               <DiffRow
//                 key={it.key}
//                 row={it.row}
//                 current={it.h === current}
//                 reviewed={it.h >= 0 && reviewed.has(hunks[it.h].sig)}
//               />
//             );
//           })}
//         </div>
//       </div>
//     </div>
//   );
// }



import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { Cell, Editable, Hunk, HunkAiResult, Row, Side } from '../types';
import ChangeList from './ChangeList';
import HunkBar from './HunkBar';
import { diffVars } from '../lib/Vars';
import type { VarMarks } from '../types';
import SqlHighlight from './Sqlhighlight';

const CTX = 3;

type Selection = { side: Side; set: Set<number> };

interface RecentTransferMark {
  side: Side;
  from: number;
  to: number;
  summary: string;
}

type Item =
  | { type: 'row'; idx: number; row: Row; h: number }
  | { type: 'hunk'; n: number }
  | { type: 'fold'; key: string; count: number };

const foldKey = (r: Row) => `${r.left?.no ?? 0}:${r.right?.no ?? 0}`;

function renderCell(cell: Cell | undefined, marks: VarMarks) {
  if (!cell) return '\u00a0';
  if (cell.segs) {
    return cell.segs.map((s, i) => (
      <span key={i} className={s.type === 'same' ? undefined : s.type}>
        <SqlHighlight text={s.text} marks={marks} />
      </span>
    ));
  }
  return cell.text === '' ? '\u00a0' : <SqlHighlight text={cell.text} marks={marks} />;
}

function LineEditor({ value, onCommit, onCancel }: { value: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    if (v === null) onCancel();
    else onCommit(v);
  };
  return (
    <input
      className="line-edit"
      autoFocus
      spellCheck={false}
      defaultValue={value}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

interface RowProps {
  idx: number;
  row: Row;
  current: boolean;
  reviewed: boolean;
  selL: boolean;
  selR: boolean;
  hit: boolean;
  match: boolean;
  transferredSide: Side | null;
  editing: Side | null;
  canL: boolean;
  canR: boolean;
  popup: ReactNode;
  varMarks: { left: VarMarks; right: VarMarks };
  onPick: (idx: number, side: Side, e: ReactMouseEvent) => void;
  onEnter: (idx: number) => void;
  onEdit: (idx: number, side: Side) => void;
  onCommit: (side: Side, no: number, value: string, original: string) => void;
  onCancel: () => void;
}

const DiffRow = memo(function DiffRow(p: RowProps) {
  const { row } = p;
  const cls = [
    'row',
    row.kind,
    p.current ? 'current' : '',
    p.reviewed ? 'reviewed' : '',
    p.match ? 'match' : '',
    p.hit ? 'hit' : '',
    p.transferredSide ? `transferred transferred-${p.transferredSide}` : '',
    p.popup ? 'has-popup' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const cell = (side: Side) => {
    const c = row[side];
    const selected = side === 'left' ? p.selL : p.selR;
    const can = side === 'left' ? p.canL : p.canR;
    return (
      <>
        <span
          className={`no no-${side}${selected ? ' sel' : ''}`}
          title="Click to select this line. Shift+click selects a range, Ctrl/Cmd+click adds a line"
          onMouseDown={(e) => p.onPick(p.idx, side, e)}
        >
          {c?.no ?? ''}
        </span>
        {p.editing === side && c ? (
          <div className={`code c-${side}`}>
            <LineEditor value={c.text} onCommit={(v) => p.onCommit(side, c.no, v, c.text)} onCancel={p.onCancel} />
          </div>
        ) : (
          <code
            className={`code c-${side}${selected ? ' sel' : ''}${c ? '' : ' ghost'}`}
            title={can && c ? 'Double-click to edit this line' : undefined}
            onClick={(e) => {
              if (window.getSelection()?.toString()) return; // user is selecting text to copy
              p.onPick(p.idx, side, e);
            }}
            onDoubleClick={() => {
              if (can && c) p.onEdit(p.idx, side);
            }}
          >
            {renderCell(c, p.varMarks[side])}
          </code>
        )}
      </>
    );
  };

  return (
    <div id={`row-${p.idx}`} className={cls} onMouseEnter={() => p.onEnter(p.idx)}>
      {cell('left')}
      {cell('right')}
      {p.popup}
    </div>
  );
});

interface Props {
  mode: 'compare' | 'review';
  rows: Row[];
  leftText: string;
  rightText: string;
  hunks: Hunk[];
  leftName: string;
  rightName: string;
  collapse: boolean;
  wrap: boolean;
  fontSize: number;
  showList: boolean;
  target: Side;
  busy: boolean;
  recentTransfer?: RecentTransferMark | null;
  onDismissTransfer?: () => void;
  editable: Editable;
  reviewed: Set<string>;
  onReviewedChange: (next: Set<string>) => void;
  onTake: (h: Hunk) => void;
  onTransfer: (from: Side, rows: number[], level: number) => void;
  onDeleteRows: (side: Side, rows: number[]) => void;
  onEditLine: (side: Side, no: number, text: string) => void;
  onAsk?: (h: Hunk, mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
  onApplyAi?: (h: Hunk, replacement: string) => void;
  emptyTitle?: string;
  emptyHint?: string;
}

export default function DiffView(p: Props) {
  const { rows, hunks, collapse } = p;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(-1);
  const [sel, setSel] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<{ idx: number; side: Side } | null>(null);
  const [query, setQuery] = useState('');
  const [matchPos, setMatchPos] = useState(-1);
  const [transferLevel, setTransferLevel] = useState(0);
  const variableMarks = useMemo(() => diffVars(p.leftText, p.rightText), [p.leftText, p.rightText]);

  const anchor = useRef<number | null>(null);
  const drag = useRef<Side | null>(null);
  const lastEnter = useRef<number>(-1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pr = useRef(p);
  pr.current = p;

  const lName = p.leftName || 'Left';
  const rName = p.rightName || 'Right';

  /* ---- reset transient state when the rows change (after any edit) ---- */
  useEffect(() => {
    setSel(null);
    setEditing(null);
    anchor.current = null;
  }, [rows]);

  useEffect(() => {
    setCurrent((c) => Math.min(c, hunks.length - 1));
  }, [hunks.length]);

  // After a transfer, take the user directly to the changed destination lines and
  // keep a strong visual marker on those lines until another edit or dismissal.
  useEffect(() => {
    const mark = p.recentTransfer;
    if (!mark || p.busy) return;
    const idx = rows.findIndex((row) => {
      const cell = row[mark.side];
      return !!cell && cell.no >= mark.from && cell.no <= mark.to;
    });
    if (idx < 0) return;
    const hunkIndex = hunks.findIndex((h) => idx >= h.rowStart && idx <= h.rowEnd);
    if (hunkIndex >= 0) setCurrent(hunkIndex);
    if (rows[idx]?.kind === 'equal') {
      let start = idx;
      while (start > 0 && rows[start - 1].kind === 'equal') start--;
      const key = foldKey(rows[start]);
      setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }
    window.setTimeout(() => {
      document.getElementById(`row-${idx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  }, [p.recentTransfer?.side, p.recentTransfer?.from, p.recentTransfer?.to, p.busy, rows, hunks]);

  useEffect(() => {
    const up = () => {
      drag.current = null;
      lastEnter.current = -1;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  /* ---- items (rows, hunk bars, folds) ---- */
  const items = useMemo(() => {
    const startAt = new Map<number, number>();
    const hunkOfRow = new Int32Array(rows.length).fill(-1);
    hunks.forEach((h, n) => {
      startAt.set(h.rowStart, n);
      for (let k = h.rowStart; k <= h.rowEnd; k++) hunkOfRow[k] = n;
    });

    const out: Item[] = [];
    const pushRow = (idx: number) => {
      const n = startAt.get(idx);
      if (n !== undefined) out.push({ type: 'hunk', n });
      out.push({ type: 'row', idx, row: rows[idx], h: hunkOfRow[idx] });
    };

    let i = 0;
    while (i < rows.length) {
      if (rows[i].kind !== 'equal') {
        pushRow(i);
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && rows[j].kind === 'equal') j++;
      const len = j - i;
      const head = i === 0 ? 0 : CTX;
      const tail = j === rows.length ? 0 : CTX;
      const key = foldKey(rows[i]);

      if (!collapse || expanded.has(key) || len <= head + tail + 1) {
        for (let k = i; k < j; k++) pushRow(k);
      } else {
        for (let k = i; k < i + head; k++) pushRow(k);
        out.push({ type: 'fold', key, count: len - head - tail });
        for (let k = j - tail; k < j; k++) pushRow(k);
      }
      i = j;
    }
    return out;
  }, [rows, hunks, collapse, expanded]);

  /* ---- width for "no wrap" mode so every row lines up ---- */
  const maxCols = useMemo(() => {
    let m = 20;
    for (const r of rows) {
      const a = r.left?.text.length ?? 0;
      const b = r.right?.text.length ?? 0;
      if (a > m) m = a;
      if (b > m) m = b;
    }
    return Math.min(m, 3000);
  }, [rows]);

  /* ---- search ---- */
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (needle.length < 2) return [] as number[];
    const out: number[] = [];
    rows.forEach((r, i) => {
      if (r.left?.text.toLowerCase().includes(needle) || r.right?.text.toLowerCase().includes(needle)) out.push(i);
    });
    return out;
  }, [rows, needle]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    setMatchPos(-1);
  }, [needle]);

  const revealRow = (idx: number) => {
    const r = rows[idx];
    if (!r) return;
    if (r.kind === 'equal') {
      let s = idx;
      while (s > 0 && rows[s - 1].kind === 'equal') s--;
      const key = foldKey(rows[s]);
      setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }
    window.setTimeout(() => document.getElementById(`row-${idx}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  };

  const stepMatch = (d: number) => {
    if (matches.length === 0) return;
    const from = matchPos < 0 ? (d > 0 ? -1 : 0) : matchPos;
    const n = (((from + d) % matches.length) + matches.length) % matches.length;
    setMatchPos(n);
    revealRow(matches[n]);
  };

  /* ---- change navigation ---- */
  const goTo = (n: number) => {
    if (hunks.length === 0) return;
    const next = ((n % hunks.length) + hunks.length) % hunks.length;
    setCurrent(next);
    document.getElementById(`chg-${next}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const nextUnreviewed = () => {
    for (let k = 1; k <= hunks.length; k++) {
      const n = (current + k + hunks.length) % hunks.length;
      if (!p.reviewed.has(hunks[n].sig)) return goTo(n);
    }
  };

  const toggleReview = (sig: string) => {
    const n = new Set(p.reviewed);
    if (n.has(sig)) n.delete(sig);
    else n.add(sig);
    p.onReviewedChange(n);
  };

  /* ---- line selection ---- */
  const pick = useCallback((idx: number, side: Side, e: ReactMouseEvent) => {
    if (e.type === 'mousedown') {
      if (e.button !== 0) return;
      e.preventDefault();
      drag.current = side;
      lastEnter.current = idx;
    }
    const additive = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    setEditing(null);
    setSel((prev) => {
      const same = prev !== null && prev.side === side;
      const set = same && (additive || shift) ? new Set(prev.set) : new Set<number>();
      if (shift && same && anchor.current !== null) {
        const a = Math.min(anchor.current, idx);
        const b = Math.max(anchor.current, idx);
        for (let k = a; k <= b; k++) set.add(k);
        return { side, set };
      }
      anchor.current = idx;
      if (additive && same) {
        if (set.has(idx)) set.delete(idx);
        else set.add(idx);
        return set.size ? { side, set } : null;
      }
      set.add(idx);
      return { side, set };
    });
  }, []);

  const enter = useCallback((idx: number) => {
    const side = drag.current;
    if (!side || anchor.current === null || lastEnter.current === idx) return;
    lastEnter.current = idx;
    const a = Math.min(anchor.current, idx);
    const b = Math.max(anchor.current, idx);
    const set = new Set<number>();
    for (let k = a; k <= b; k++) set.add(k);
    setSel({ side, set });
  }, []);

  const startEdit = useCallback((idx: number, side: Side) => {
    setSel(null);
    setEditing({ idx, side });
  }, []);

  const commitEdit = useCallback((side: Side, no: number, value: string, original: string) => {
    setEditing(null);
    if (value !== original) pr.current.onEditLine(side, no, value);
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const sortedSel = () => (sel ? Array.from(sel.set).sort((a, b) => a - b) : []);

  const doTransfer = () => {
    if (!sel || p.busy) return;
    p.onTransfer(sel.side, sortedSel(), transferLevel);
    setSel(null);
  };

  const doDelete = () => {
    if (!sel || p.busy) return;
    p.onDeleteRows(sel.side, sortedSel());
    setSel(null);
  };

  /* ---- keyboard: Alt+Up/Down = previous/next change, Esc = clear selection, Ctrl+Enter = transfer ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === 'Escape' && !typing) {
        setSel(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !typing && sel) {
        e.preventDefault();
        doTransfer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---- floating arrow ---- */
  let popupRow = -1;
  if (sel) sel.set.forEach((i) => (popupRow = Math.max(popupRow, i)));

  const to: Side = sel?.side === 'left' ? 'right' : 'left';
  const canTo = !!sel && (to === 'left' ? p.editable.left : p.editable.right);
  const canFrom = !!sel && (sel.side === 'left' ? p.editable.left : p.editable.right);
  const toName = to === 'left' ? lName : rName;

  const popup: ReactNode = sel ? (
    <div className="xfer" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <span className="xfer-count">
        {sel.set.size} line{sel.set.size === 1 ? '' : 's'}
      </span>
      {canTo && (
        <label className="xfer-scope">
          Scope
          <select value={transferLevel} onChange={(e) => setTransferLevel(Number(e.target.value))} disabled={p.busy}>
            <option value={-1}>Exact lines</option>
            <option value={0}>Smart unit</option>
            <option value={1}>Expand 1 level</option>
            <option value={2}>Expand 2 levels</option>
          </select>
        </label>
      )}
      {canTo && (
        <button
          type="button"
          className="xfer-go"
          disabled={p.busy}
          onClick={doTransfer}
          title={`Transfer using the selected scope to ${toName} (Ctrl+Enter). Review the proposed change before applying.`}
        >
          {sel.side === 'left' ? `${toName} →` : `← ${toName}`}
        </button>
      )}
      {canFrom && (
        <button type="button" className="xfer-del" disabled={p.busy} onClick={doDelete} title="Remove the selected lines from this side">
          Delete
        </button>
      )}
      <button type="button" className="xfer-x" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setSel(null)}>
        ✕
      </button>
    </div>
  ) : null;

  /* ---- render ---- */
  if (hunks.length === 0 && !p.recentTransfer) {
    return (
      <div className="empty">
        <strong>{p.emptyTitle ?? 'No differences.'}</strong>
        <span>{p.emptyHint ?? 'With the current ignore rules both procedures match.'}</span>
      </div>
    );
  }

  const doneCount = hunks.filter((h) => p.reviewed.has(h.sig)).length;
  const bodyStyle = { '--fs': `${p.fontSize}px`, '--cols': String(maxCols + 2) } as CSSProperties;

  return (
    <div className={`diff-wrap${p.showList ? '' : ' no-list'}`}>
      {p.showList && <ChangeList hunks={hunks} current={current} reviewed={p.reviewed} onGo={goTo} />}

      <div className="diff">
        <div className="diff-nav">
          {p.recentTransfer && (
            <div className="transfer-result-banner" role="status">
              <span className="transfer-result-icon" aria-hidden="true">✓</span>
              <span>{p.recentTransfer.summary}</span>
              <button type="button" className="transfer-result-dismiss" onClick={p.onDismissTransfer} aria-label="Dismiss transfer highlight" title="Dismiss transfer highlight">×</button>
            </div>
          )}
          <button type="button" onClick={() => goTo(current - 1)} title="Alt+Up">
            Previous
          </button>
          <button type="button" onClick={() => goTo(current + 1)} title="Alt+Down">
            Next
          </button>
          <button type="button" onClick={nextUnreviewed} disabled={doneCount === hunks.length}>
            Next unreviewed
          </button>
          <span className="muted">
            {current < 0 ? `${hunks.length} changes` : `Change ${current + 1} of ${hunks.length}`} · {doneCount} reviewed
          </span>
          <span className="variable-legend" title="SQL variable diagnostics">
            <span className="sql-var-only">@var one-sided</span>
            <span className="sql-var-bad">@var undeclared</span>
          </span>
          <span className="spacer" />
          <input
            className="find"
            value={query}
            placeholder="Find in code"
            aria-label="Find in code"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1);
            }}
          />
          <button type="button" onClick={() => stepMatch(-1)} disabled={matches.length === 0} aria-label="Previous match">
            ↑
          </button>
          <button type="button" onClick={() => stepMatch(1)} disabled={matches.length === 0} aria-label="Next match">
            ↓
          </button>
          <span className="muted small">{needle.length >= 2 ? `${matchPos >= 0 ? matchPos + 1 : 0}/${matches.length}` : ''}</span>
        </div>

        <div className="diff-main">
          <div
            ref={bodyRef}
            className={`diff-body ${p.wrap ? 'wrap' : 'nowrap'}`}
            style={bodyStyle}
            onMouseDown={(e) => {
              const code = (e.target as HTMLElement).closest('.code');
              if (code && bodyRef.current) bodyRef.current.dataset.side = code.classList.contains('c-left') ? 'left' : 'right';
            }}
          >
            <div className="diff-head">
              <span />
              <span className="name">{lName}</span>
              <span />
              <span className="name">{rName}</span>
            </div>

            {items.map((it) => {
              if (it.type === 'fold') {
                return (
                  <button
                    key={`f${it.key}`}
                    type="button"
                    className="fold"
                    onClick={() => setExpanded((s) => new Set(s).add(it.key))}
                  >
                    Show {it.count} unchanged lines
                  </button>
                );
              }
              if (it.type === 'hunk') {
                const h = hunks[it.n];
                return (
                  <HunkBar
                    key={h.sig}
                    id={`chg-${it.n}`}
                    mode={p.mode}
                    hunk={h}
                    index={it.n}
                    total={hunks.length}
                    leftName={p.leftName}
                    rightName={p.rightName}
                    target={p.target}
                    busy={p.busy}
                    current={it.n === current}
                    reviewed={p.reviewed.has(h.sig)}
                    onReview={() => toggleReview(h.sig)}
                    onTake={() => p.onTake(h)}
                    onSelect={(side) => {
                      const set = new Set<number>();
                      for (let k = h.rowStart; k <= h.rowEnd; k++) set.add(k);
                      anchor.current = h.rowStart;
                      setEditing(null);
                      setSel({ side, set });
                    }}
                    onAsk={p.onAsk ? (mode, ins) => p.onAsk!(h, mode, ins) : undefined}
                    onApplyAi={p.onApplyAi ? (rep) => p.onApplyAi!(h, rep) : undefined}
                  />
                );
              }
              const i = it.idx;
              return (
                <DiffRow
                  key={`r${i}`}
                  idx={i}
                  row={it.row}
                  current={it.h === current}
                  reviewed={it.h >= 0 && p.reviewed.has(hunks[it.h].sig)}
                  selL={!!sel && sel.side === 'left' && sel.set.has(i)}
                  selR={!!sel && sel.side === 'right' && sel.set.has(i)}
                  hit={matchPos >= 0 && matches[matchPos] === i}
                  match={matchSet.has(i)}
                  transferredSide={p.recentTransfer && it.row[p.recentTransfer.side]?.no !== undefined && it.row[p.recentTransfer.side]!.no >= p.recentTransfer.from && it.row[p.recentTransfer.side]!.no <= p.recentTransfer.to ? p.recentTransfer.side : null}
                  editing={editing && editing.idx === i ? editing.side : null}
                  canL={p.editable.left}
                  canR={p.editable.right}
                  popup={sel && i === popupRow ? popup : null}
                  varMarks={variableMarks}
                  onPick={pick}
                  onEnter={enter}
                  onEdit={startEdit}
                  onCommit={commitEdit}
                  onCancel={cancelEdit}
                />
              );
            })}
          </div>

          <div className="ruler" aria-hidden>
            {hunks.map((h, n) => (
              <button
                key={h.sig}
                type="button"
                tabIndex={-1}
                className={`mark ${h.kind}${n === current ? ' on' : ''}`}
                style={{ top: `${(h.rowStart / Math.max(1, rows.length)) * 100}%` }}
                title={`${n + 1}. ${h.title}`}
                onClick={() => goTo(n)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}