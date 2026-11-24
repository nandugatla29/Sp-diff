// // 
// import { useDeferredValue, useEffect, useMemo, useState } from 'react';
// import type { ChangeEvent } from 'react';
// import AssistPanel from './components/AssistPanel';
// import DiffView from './components/DiffView';
// import FolderCompare from "./components/FolderCompare";
// import IgnoreOptions from './components/IgnoreOptions';

// import { hunkAssist } from './lib/api';
// import { computeRows, computeStats, summarizeForAi } from './lib/diff';
// import {
//   collectChanges,
//   copyFile,
//   DEFAULT_EXTS,
//   downloadText,
//   EMPTY_FOLDERS,
//   overlayPair,
//   revertFile,
// } from './lib/Folder';
// import {
//   buildHunkRequest,
//   buildHunks,
//   deleteRows,
//   replaceHunk,
//   replaceLine,
//   takeFromSide,
//   transferRows,
// } from './lib/hunks';
// import { defaultOptions } from './lib/normalize';
// import { makePlan } from './lib/Transfer';
// import type { PlanInput } from './lib/Transfer';
// import { readSqlFile } from './lib/readFile';
// import { clearSession, loadSession, saveSession, subscribeWarning, usePersistentState } from './lib/Session';
// import type {
//   Baseline,
//   ChangeItem,
//   DiffOptions,
//   FolderSide,
//   FolderState,
//   Hunk,
//   Plan,
//   Range,
//   Side,
//   Tab,
//   ViewMode,
// } from './types';
// import Sidebar, { SidebarFile } from './components/Sidebar';

// /** Review view compares exactly: every ignore rule off, so even a whitespace edit shows up. */
// const EXACT: DiffOptions = {
//   ignoreWhitespace: false,
//   ignoreCase: false,
//   ignoreComments: false,
//   ignoreBlankLines: false,
//   ignoreBrackets: false,
//   ignoreCreateAlter: false,
//   ignoreBoilerplate: false,
// };

// interface Snapshot {
//   left: string;
//   right: string;
// }

// interface RecentTransfer {
//   side: Side;
//   from: number;
//   to: number;
//   summary: string;
// }

// /** Find the smallest changed line range in the destination after a transfer. */
// function changedLineRange(before: string, after: string): { from: number; to: number } | null {
//   const a = before.split(/\r\n|\r|\n/);
//   const b = after.split(/\r\n|\r|\n/);
//   let prefix = 0;
//   while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
//   if (prefix === a.length && prefix === b.length) return null;
//   let suffix = 0;
//   while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
//   return { from: prefix + 1, to: Math.max(prefix + 1, b.length - suffix) };
// }

// const HISTORY_CHARS = 1_500_000;
// function trimHistory(h: Snapshot[]): Snapshot[] {
//   let total = 0;
//   const out: Snapshot[] = [];
//   for (let i = h.length - 1; i >= 0 && out.length < 15; i--) {
//     total += h[i].left.length + h[i].right.length;
//     if (total > HISTORY_CHARS) break;
//     out.unshift(h[i]);
//   }
//   return out;
// }

// const countLines = (t: string) => (t ? t.split(/\r\n|\r|\n/).length : 0);
// const fileNameOf = (path: string, fallback: string) => path.split('/').pop() || fallback;

// interface EditorProps {
//   title: string;
//   hint: string;
//   name: string;
//   text: string;
//   onName: (v: string) => void;
//   onText: (v: string) => void;
// }

// function Editor({ title, hint, name, text, onName, onText }: EditorProps) {
//   const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
//     const file = e.target.files?.[0];
//     e.target.value = '';
//     if (file) onText(await readSqlFile(file));
//   };

//   return (
//     <section className="editor">
//       <header>
//         <div>
//           <h2>{title}</h2>
//           <p className="muted small">{hint}</p>
//         </div>
//         <input
//           className="env-name"
//           value={name}
//           maxLength={60}
//           aria-label={`${title} environment name`}
//           onChange={(e) => onName(e.target.value)}
//         />
//       </header>
//       <textarea
//         spellCheck={false}
//         value={text}
//         placeholder="Paste the stored procedure from SSMS, or load a .sql file"
//         onChange={(e) => onText(e.target.value)}
//       />
//       <footer>
//         <label className="file-btn">
//           Load .sql file
//           <input type="file" accept=".sql,.txt" onChange={onFile} hidden />
//         </label>
//         <button type="button" onClick={() => onText('')} disabled={!text}>
//           Clear
//         </button>
//         <button type="button" onClick={() => downloadText(`${name || title}.sql`, text)} disabled={!text}>
//           Download
//         </button>
//         <span className="muted small">{text ? `${countLines(text)} lines` : ''}</span>
//       </footer>
//     </section>
//   );
// }

// export default function App() {
//   /* ---------- everything below is restored from sessionStorage after a refresh ---------- */
//   const [left, setLeft] = usePersistentState<string>('left', '');
//   const [right, setRight] = usePersistentState<string>('right', '');
//   const [leftName, setLeftName] = usePersistentState<string>('leftName', 'UAT2');
//   const [rightName, setRightName] = usePersistentState<string>('rightName', 'UAT');
//   const [opts, setOpts] = usePersistentState<DiffOptions>('opts', defaultOptions);
//   const [tab, setTab] = usePersistentState<Tab>('tab', 'input');
//   const [view, setView] = usePersistentState<ViewMode>('view', { kind: 'compare' });
//   const [collapse, setCollapse] = usePersistentState<boolean>('collapse', true);
//   const [wrap, setWrap] = usePersistentState<boolean>('wrap', true);
//   const [fontSize, setFontSize] = usePersistentState<number>('fontSize', 13);
//   const [showList, setShowList] = usePersistentState<boolean>('showList', true);
//   const [showAssist, setShowAssist] = usePersistentState<boolean>('showAssist', true);
//   const [sidebarOpen, setSidebarOpen] = usePersistentState<boolean>('sidebar', true);
//   const [updateSide, setUpdateSide] = usePersistentState<Side>('updateSide', 'right');
//   const [baseline, setBaseline] = usePersistentState<Baseline | null>('baseline', null);
//   const [dirty, setDirty] = usePersistentState<boolean>('dirty', false);
//   const [folders, setFolders] = usePersistentState<FolderState | null>('folders', null);
//   const [openPath, setOpenPath] = usePersistentState<string | null>('openPath', null);
//   const [exts, setExts] = usePersistentState<string>('exts', DEFAULT_EXTS);
//   const [reviewedMap, setReviewedMap] = usePersistentState<Record<string, string[]>>('reviewed', {});

//   const [history, setHistory] = useState<Snapshot[]>(() => loadSession<Snapshot[]>('history', []));
//   useEffect(() => {
//     saveSession('history', trimHistory(history));
//   }, [history]);

//   const [warning, setWarning] = useState<string | null>(null);
//   const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
//   const [transferMessage, setTransferMessage] = useState<string | null>(null);
//   const [recentTransfer, setRecentTransfer] = useState<RecentTransfer | null>(null);
//   useEffect(() => subscribeWarning(setWarning), []);

//   /* ---------- derived state ---------- */
//   const openKey = openPath ? openPath.toLowerCase() : null;
//   const effView: ViewMode = view.kind === 'review' && baseline ? view : { kind: 'compare' };
//   const reviewSide: Side | null = effView.kind === 'review' ? effView.side : null;

//   /** Folder state with the live text of the open pair written into it. */
//   const foldersLive = useMemo(
//     () => overlayPair(folders, openKey, openPath, left, right, baseline),
//     [folders, openKey, openPath, left, right, baseline],
//   );

//   const dLeft = useDeferredValue(left);
//   const dRight = useDeferredValue(right);
//   const dOpts = useDeferredValue(opts);

//   const ready = left.trim() !== '' || right.trim() !== '';
//   const stale = dLeft !== left || dRight !== right; // diff is catching up; line numbers not safe yet
//   const rows = useMemo(() => (tab === 'folders' ? [] : computeRows(dLeft, dRight, dOpts)), [tab, dLeft, dRight, dOpts]);
//   const stats = useMemo(() => computeStats(rows), [rows]);
//   const hunks = useMemo(() => buildHunks(rows, leftName, rightName), [rows, leftName, rightName]);
//   const diffSummary = useMemo(() => summarizeForAi(rows), [rows]);

//   /* review (original vs current) */
//   const origText = baseline && reviewSide ? baseline[reviewSide] : '';
//   const curText = reviewSide === 'left' ? left : reviewSide === 'right' ? right : '';
//   const visibleRecentTransfer = reviewSide
//     ? (recentTransfer && recentTransfer.side === reviewSide
//         ? { ...recentTransfer, side: 'right' as Side, summary: `Transferred code in ${openPath ?? (reviewSide === 'left' ? leftName : rightName)} (Current) · lines ${recentTransfer.from}${recentTransfer.to === recentTransfer.from ? '' : `–${recentTransfer.to}`}` }
//         : null)
//     : recentTransfer;
//   const dOrig = useDeferredValue(origText);
//   const dCur = useDeferredValue(curText);
//   const reviewStale = dOrig !== origText || dCur !== curText;
//   const reviewRows = useMemo(
//     () => (reviewSide ? computeRows(dOrig, dCur, EXACT) : []),
//     [reviewSide, dOrig, dCur],
//   );
//   const reviewStats = useMemo(() => computeStats(reviewRows), [reviewRows]);
//   const reviewHunks = useMemo(() => (reviewSide ? buildHunks(reviewRows, 'Original', 'Current') : []), [reviewSide, reviewRows]);

//   /* reviewed checkboxes, kept per view and per file */
//   const reviewKey = `${reviewSide ? `rv-${reviewSide}` : 'cmp'}:${openPath ?? ''}`;
//   const reviewedSet = useMemo(() => new Set(reviewedMap[reviewKey] ?? []), [reviewedMap, reviewKey]);
//   const setReviewed = (next: Set<string>) => setReviewedMap((m) => ({ ...m, [reviewKey]: Array.from(next) }));

//   /* sidebar data */
//   const lineCounts = useMemo(() => ({ left: countLines(left), right: countLines(right) }), [left, right]);
//   const files: SidebarFile[] = (['left', 'right'] as Side[]).map((side) => {
//     const env = side === 'left' ? leftName : rightName;
//     return {
//       side,
//       role: side === 'left' ? 'Source' : 'Target',
//       env,
//       path: openPath ?? env,
//       modified: baseline ? (side === 'left' ? left !== baseline.left : right !== baseline.right) : false,
//       lines: lineCounts[side],
//     };
//   });

//   const others: ChangeItem[] = useMemo(() => {
//     if (!foldersLive) return [];
//     return collectChanges(foldersLive)
//       .filter((c) => c.key !== openKey)
//       .map((c) => ({
//         id: `${c.side}:${c.key}`,
//         side: c.side,
//         key: c.key,
//         env: foldersLive[c.side].name,
//         path: c.file.path,
//         status: c.file.created ? ('A' as const) : ('M' as const),
//       }));
//   }, [foldersLive, openKey]);

//   const totalChanges = others.length + files.filter((f) => f.modified).length;

//   /* ---------- editing the open pair ---------- */
//   const commit = (nl: string, nr: string) => {
//     setRecentTransfer(null);
//     setHistory((h) => [...h.slice(-29), { left, right }]);
//     setLeft(nl);
//     setRight(nr);
//   };

//   const undo = () => {
//     const last = history[history.length - 1];
//     if (!last) return;
//     setHistory((h) => h.slice(0, -1));
//     setLeft(last.left);
//     setRight(last.right);
//   };

//   const swap = () => {
//     setLeft(right);
//     setRight(left);
//     setLeftName(rightName);
//     setRightName(leftName);
//     setBaseline((b) => (b ? { left: b.right, right: b.left } : b));
//     if (foldersLive) setFolders({ left: foldersLive.right, right: foldersLive.left });
//     setHistory((h) => h.map((s) => ({ left: s.right, right: s.left })));
//     setUpdateSide((s) => (s === 'left' ? 'right' : 'left'));
//     setView((v) => (v.kind === 'review' ? { kind: 'review', side: v.side === 'left' ? 'right' : 'left' } : v));
//   };

//   const apply = (side: Side, sql: string) => {
//     if (side === 'left') commit(sql, right);
//     else commit(left, sql);
//     setView({ kind: 'compare' });
//     setTab('diff');
//   };

//   const editLeft = (v: string) => {
//     setRecentTransfer(null);
//     setLeft(v);
//     setDirty(true);
//   };
//   const editRight = (v: string) => {
//     setRecentTransfer(null);
//     setRight(v);
//     setDirty(true);
//   };

//   /** Moves to the compare view. A new baseline is taken only for pasted text that was edited. */
//   const goCompare = () => {
//     if (!baseline || (dirty && !openPath)) {
//       setBaseline({ left, right });
//       setHistory([]);
//       setReviewedMap({});
//     }
//     setDirty(false);
//     setView({ kind: 'compare' });
//     setTab('diff');
//   };

//   /* ---------- compare view actions ---------- */
//   const takeHunk = (h: Hunk) => {
//     if (stale) return;
//     const next = takeFromSide(h, updateSide, left, right);
//     if (updateSide === 'left') commit(next, right);
//     else commit(left, next);
//   };

//   const askHunk = (h: Hunk, mode: 'explain' | 'fix', instruction?: string) =>
//     hunkAssist(buildHunkRequest(h, mode, updateSide, left, right, leftName, rightName, instruction));

//   const applyAi = (h: Hunk, replacement: string) => {
//     if (stale) return;
//     const next = replaceHunk(h, updateSide, updateSide === 'left' ? left : right, replacement);
//     if (updateSide === 'left') commit(next, right);
//     else commit(left, next);
//   };

//   const proposeTransfer = (
//     sourceRows: typeof rows,
//     from: Side,
//     sel: number[],
//     level: number,
//     leftText: string,
//     rightText: string,
//     leftLabel: string,
//     rightLabel: string,
//   ) => {
//     if (!sel.length) return;
//     const target: Side = from === 'left' ? 'right' : 'left';
//     const srcText = from === 'left' ? leftText : rightText;
//     const dstText = target === 'left' ? leftText : rightText;
//     const srcName = from === 'left' ? leftLabel : rightLabel;
//     const dstName = target === 'left' ? leftLabel : rightLabel;

//     // Exact mode deliberately preserves the user's line selection, including disjoint Ctrl-clicks.
//     if (level < 0) {
//       const text = transferRows(sourceRows, sel, from, leftText, rightText);
//       const previewText = [...new Set(sel)]
//         .sort((a, b) => a - b)
//         .map((rowIndex) => sourceRows[rowIndex]?.[from]?.text)
//         .filter((line): line is string => typeof line === 'string')
//         .join('\n');
//       setTransferMessage(null);
//       setPendingPlan({
//         op: 'replace', target, srcFrom: 0, srcTo: 0, dstFrom: 0, dstTo: 0,
//         label: `Transfer ${sel.length} selected diff row${sel.length === 1 ? '' : 's'} exactly to ${dstName}`,
//         level: -1, minLevel: -1, maxLevel: 0, warnings: [], previewText: previewText || '', text,
//       });
//       return;
//     }

//     const sorted = [...new Set(sel)].sort((a, b) => a - b);
//     if (sorted.some((v, i) => i > 0 && v !== sorted[i - 1] + 1)) {
//       setPendingPlan(null);
//       setTransferMessage('Smart transfer needs one contiguous selection. Choose “Exact lines” for Ctrl/Cmd-clicked disjoint rows, or select one continuous range.');
//       return;
//     }

//     const rangeFor = (side: Side): Range | null => {
//       const nums = sorted.map((idx) => sourceRows[idx]?.[side]?.no).filter((n): n is number => typeof n === 'number');
//       return nums.length ? { from: Math.min(...nums), to: Math.max(...nums) } : null;
//     };
//     const srcSel = rangeFor(from);
//     const dstSel = rangeFor(target);
//     let dstAfter = 0;
//     for (let i = sorted[0] - 1; i >= 0; i--) {
//       const no = sourceRows[i]?.[target]?.no;
//       if (no !== undefined) { dstAfter = no; break; }
//     }
//     const s2d = new Map<number, number>();
//     for (const row of sourceRows) {
//       const a = row[from];
//       const b = row[target];
//       if (a && b) s2d.set(a.no, b.no);
//     }
//     const inp: PlanInput = {
//       src: srcText, dst: dstText, srcSel, dstSel, dstAfter, s2d, level, target, srcName, dstName,
//     };
//     try {
//       const plan = makePlan(inp);
//       if (!plan) {
//         setTransferMessage('No complete SQL unit could be identified for this selection. Try Exact lines or select a larger range.');
//         setPendingPlan(null);
//         return;
//       }
//       const plannedSourceLines = srcText.split(/\r\n|\r|\n/);
//       const previewText = plan.op === 'delete'
//         ? ''
//         : plan.srcFrom > 0 && plan.srcTo >= plan.srcFrom
//           ? plannedSourceLines.slice(plan.srcFrom - 1, plan.srcTo).join('\n')
//           : '';
//       setTransferMessage(null);
//       setPendingPlan({ ...plan, previewText });
//     } catch (e) {
//       setPendingPlan(null);
//       setTransferMessage(`The SQL structure could not be planned safely: ${e instanceof Error ? e.message : 'unknown parser error'}. Try Exact lines and review the result carefully.`);
//     }
//   };

//   const cmpTransfer = (from: Side, sel: number[], level: number) => {
//     if (stale) return;
//     proposeTransfer(rows, from, sel, level, left, right, leftName, rightName);
//   };

//   const cmpDelete = (side: Side, sel: number[]) => {
//     if (stale) return;
//     if (side === 'left') commit(deleteRows(rows, sel, 'left', left), right);
//     else commit(left, deleteRows(rows, sel, 'right', right));
//   };

//   const cmpEdit = (side: Side, no: number, text: string) => {
//     if (stale) return;
//     if (side === 'left') commit(replaceLine(left, no, text), right);
//     else commit(left, replaceLine(right, no, text));
//   };

//   /* ---------- review view actions (original -> current) ---------- */
//   const setWorking = (text: string) => {
//     if (reviewSide === 'left') commit(text, right);
//     else if (reviewSide === 'right') commit(left, text);
//   };

//   const confirmTransfer = () => {
//     if (!pendingPlan) return;
//     // In review mode the selected file can be either left or right, even though
//     // the Current version is always rendered in DiffView's right-hand column.
//     const actualSide: Side = reviewSide ?? pendingPlan.target;
//     const beforeText = reviewSide ? curText : (pendingPlan.target === 'left' ? left : right);
//     const changed = changedLineRange(beforeText, pendingPlan.text);
//     const destinationName = reviewSide
//       ? `${openPath ?? (reviewSide === 'left' ? leftName : rightName)} (Current)`
//       : (openPath ?? (pendingPlan.target === 'left' ? leftName : rightName));

//     if (reviewSide) setWorking(pendingPlan.text);
//     else if (pendingPlan.target === 'left') commit(pendingPlan.text, right);
//     else commit(left, pendingPlan.text);

//     if (changed) {
//       const lineCount = changed.to - changed.from + 1;
//       setRecentTransfer({
//         side: actualSide,
//         from: changed.from,
//         to: changed.to,
//         summary: `Transferred ${lineCount} line${lineCount === 1 ? '' : 's'} to ${destinationName} · lines ${changed.from}${changed.to === changed.from ? '' : `–${changed.to}`}`,
//       });
//     } else {
//       setRecentTransfer(null);
//     }
//     setTab('diff');
//     setPendingPlan(null);
//     setTransferMessage(null);
//   };

//   const revTake = (h: Hunk) => {
//     if (reviewStale) return;
//     setWorking(takeFromSide(h, 'right', origText, curText));
//   };

//   const revTransfer = (from: Side, sel: number[], level: number) => {
//     if (reviewStale || from !== 'left') return; // only Original -> Current is allowed
//     proposeTransfer(reviewRows, from, sel, level, origText, curText, 'Original', 'Current');
//   };

//   const revDelete = (side: Side, sel: number[]) => {
//     if (reviewStale || side !== 'right') return;
//     setWorking(deleteRows(reviewRows, sel, 'right', curText));
//   };

//   const revEdit = (side: Side, no: number, text: string) => {
//     if (reviewStale || side !== 'right') return;
//     setWorking(replaceLine(curText, no, text));
//   };

//   /* ---------- sidebar actions ---------- */
//   const reviewFile = (side: Side) => {
//     if (!baseline) setBaseline({ left, right });
//     setView({ kind: 'review', side });
//     setTab('diff');
//   };

//   const revertOpen = (side: Side) => {
//     if (!baseline) return;
//     if (side === 'left') commit(baseline.left, right);
//     else commit(left, baseline.right);
//   };

//   const downloadOpen = (side: Side) => {
//     const env = side === 'left' ? leftName : rightName;
//     downloadText(fileNameOf(openPath ?? '', `${env}.sql`), side === 'left' ? left : right);
//   };

//   const openPair = (key: string) => {
//     const f = foldersLive;
//     if (!f) return;
//     const lf = f.left.files[key];
//     const rf = f.right.files[key];
//     const path = (lf ?? rf)?.path;
//     if (!path) return;
//     setFolders(f);
//     setOpenPath(path);
//     setLeft(lf?.text ?? '');
//     setRight(rf?.text ?? '');
//     setLeftName(f.left.name);
//     setRightName(f.right.name);
//     setBaseline({ left: lf ? (lf.orig ?? lf.text) : '', right: rf ? (rf.orig ?? rf.text) : '' });
//     setHistory([]);
//     setDirty(false);
//     setView({ kind: 'compare' });
//     setTab('diff');
//   };

//   const openOther = (c: ChangeItem) => {
//     if (!c.key) return;
//     openPair(c.key);
//     setView({ kind: 'review', side: c.side });
//   };

//   const revertOther = (c: ChangeItem) => {
//     if (c.key && foldersLive) setFolders(revertFile(foldersLive, c.side, c.key));
//   };

//   const downloadOther = (c: ChangeItem) => {
//     const file = c.key && foldersLive ? foldersLive[c.side].files[c.key] : undefined;
//     if (file) downloadText(fileNameOf(file.path, `${c.env}.sql`), file.text);
//   };

//   const revertAll = () => {
//     if (!window.confirm('Revert every changed file to how it was when loaded?')) return;
//     let f = foldersLive;
//     if (f) {
//       for (const c of others) if (c.key) f = revertFile(f, c.side, c.key);
//       if (f !== foldersLive) setFolders(f);
//     }
//     if (baseline && (left !== baseline.left || right !== baseline.right)) commit(baseline.left, baseline.right);
//   };

//   /* ---------- folder actions ---------- */
//   const loadFolder = (side: Side, res: FolderSide) => {
//     const base = foldersLive ?? EMPTY_FOLDERS;
//     setFolders({ ...base, [side]: res });
//     if (openPath) setOpenPath(null); // the open file may no longer exist in the new folder
//   };

//   const copyFolderFile = (key: string, from: Side) => {
//     if (key === openKey) {
//       if (from === 'left') commit(left, left);
//       else commit(right, right);
//       return;
//     }
//     if (foldersLive) setFolders(copyFile(foldersLive, key, from));
//   };

//   const clearFolders = () => {
//     if (!window.confirm('Clear both folders? Edits made to files that are not open are lost.')) return;
//     setFolders(null);
//     setOpenPath(null);
//   };

//   const detach = () => {
//     if (foldersLive) setFolders(foldersLive);
//     setOpenPath(null);
//   };

//   const resetSession = () => {
//     if (!window.confirm('Clear everything stored for this browser tab and start over?')) return;
//     clearSession();
//     window.location.reload();
//   };

//   const focusMode = !sidebarOpen && !showList && !showAssist;
//   const toggleFocus = () => {
//     const on = focusMode;
//     setSidebarOpen(on);
//     setShowList(on);
//     setShowAssist(on);
//   };

//   const viewControls = (
//     <div className="view-controls">
//       <label>
//         <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} />
//         Fold unchanged
//       </label>
//       <label>
//         <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
//         Wrap lines
//       </label>
//       <label>
//         <input type="checkbox" checked={showList} onChange={(e) => setShowList(e.target.checked)} />
//         Change list
//       </label>
//       {!reviewSide && (
//         <label>
//           <input type="checkbox" checked={showAssist} onChange={(e) => setShowAssist(e.target.checked)} />
//           AI panel
//         </label>
//       )}
//       <span className="font-ctl" aria-label="Text size">
//         <button type="button" onClick={() => setFontSize((s) => Math.max(10, s - 1))} aria-label="Smaller text">
//           A−
//         </button>
//         <span className="small">{fontSize}px</span>
//         <button type="button" onClick={() => setFontSize((s) => Math.min(22, s + 1))} aria-label="Larger text">
//           A+
//         </button>
//       </span>
//     </div>
//   );

//   return (
//     <div className="app">
//       <header className="topbar">
//         <h1>SP Diff</h1>
//         <nav aria-label="Views">
//           <button type="button" className={tab === 'folders' ? 'on' : ''} onClick={() => setTab('folders')}>
//             Folders
//           </button>
//           <button type="button" className={tab === 'input' ? 'on' : ''} onClick={() => setTab('input')}>
//             Procedures
//           </button>
//           <button type="button" className={tab === 'diff' ? 'on' : ''} onClick={goCompare} disabled={!ready}>
//             Differences
//             {ready && stats.blocks > 0 && <span className="count">{stats.blocks}</span>}
//           </button>
//         </nav>
//         {openPath && (
//           <span className="crumb" title={openPath}>
//             {openPath}
//           </span>
//         )}
//         {openPath && folders && (
//           <button type="button" onClick={() => setTab('folders')}>
//             Back to folders
//           </button>
//         )}
//         <div className="spacer" />
//         <button type="button" onClick={() => setSidebarOpen((v) => !v)} aria-pressed={sidebarOpen}>
//           Files{totalChanges ? ` (${totalChanges})` : ''}
//         </button>
//         <button type="button" onClick={toggleFocus} aria-pressed={focusMode} title="Hide the side panels for a wider code view">
//           Focus
//         </button>
//         <button type="button" onClick={undo} disabled={history.length === 0}>
//           Undo{history.length ? ` (${history.length})` : ''}
//         </button>
//         <button type="button" onClick={swap}>
//           Swap sides
//         </button>
//         <button type="button" onClick={resetSession} title="Forget everything stored in this browser tab">
//           Reset
//         </button>
//         {tab === 'input' && (
//           <button type="button" className="primary" disabled={!ready} onClick={goCompare}>
//             Compare
//           </button>
//         )}
//       </header>

//       {warning && (
//         <div className="banner" role="status">
//           {warning}
//         </div>
//       )}

//       <div className="shell">
//         {sidebarOpen && (
//           <Sidebar
//             files={files}
//             reviewSide={tab === 'diff' ? reviewSide : null}
//             compareActive={tab === 'diff' && !reviewSide}
//             others={others}
//             activeOther={null}
//             totalChanges={totalChanges}
//             onCompare={goCompare}
//             onOpenFile={reviewFile}
//             onRevertFile={revertOpen}
//             onDownloadFile={downloadOpen}
//             onOpenOther={openOther}
//             onRevertOther={revertOther}
//             onDownloadOther={downloadOther}
//             onRevertAll={revertAll}
//           />
//         )}

//         <div className="main">
//           {tab === 'folders' && (
//             <FolderCompare
//               folders={foldersLive}
//               opts={opts}
//               onOpts={setOpts}
//               openKey={openKey}
//               exts={exts}
//               onExts={setExts}
//               onLoad={loadFolder}
//               onOpen={openPair}
//               onCopy={copyFolderFile}
//               onClear={clearFolders}
//             />
//           )}

//           {tab === 'input' && (
//             <div className="input-wrap">
//               {openPath && (
//                 <div className="notice">
//                   <span>
//                     You are editing the folder file <strong>{openPath}</strong>. Changes are kept in the folders.
//                   </span>
//                   <button type="button" onClick={detach}>
//                     Detach from folder
//                   </button>
//                 </div>
//               )}
//               <main className="inputs">
//                 <Editor title="Source" hint="The version with the changes you want" name={leftName} text={left} onName={setLeftName} onText={editLeft} />
//                 <Editor title="Target" hint="The version you are updating" name={rightName} text={right} onName={setRightName} onText={editRight} />
//               </main>
//             </div>
//           )}

//           {tab === 'diff' && !reviewSide && (
//             <main className={`workspace${showAssist && ready ? '' : ' no-assist'}`}>
//               <div className="diff-col">
//                 <div className="options">
//                   <div className="chips" aria-label="Summary">
//                     <span className="chip add">{stats.added} added</span>
//                     <span className="chip del">{stats.removed} removed</span>
//                     <span className="chip chg">{stats.changed} changed</span>
//                   </div>
//                   <IgnoreOptions opts={opts} onChange={setOpts} />
//                   {viewControls}
//                 </div>

//                 {ready ? (
//                   <DiffView
//                     mode="compare"
//                     rows={rows}
//                     leftText={left}
//                     rightText={right}
//                     hunks={hunks}
//                     leftName={leftName}
//                     rightName={rightName}
//                     collapse={collapse}
//                     wrap={wrap}
//                     fontSize={fontSize}
//                     showList={showList}
//                     target={updateSide}
//                     busy={stale}
//                     recentTransfer={visibleRecentTransfer}
//                     onDismissTransfer={() => setRecentTransfer(null)}
//                     editable={{ left: true, right: true }}
//                     reviewed={reviewedSet}
//                     onReviewedChange={setReviewed}
//                     onTake={takeHunk}
//                     onTransfer={cmpTransfer}
//                     onDeleteRows={cmpDelete}
//                     onEditLine={cmpEdit}
//                     onAsk={askHunk}
//                     onApplyAi={applyAi}
//                   />
//                 ) : (
//                   <div className="empty">
//                     <strong>Add a procedure first.</strong>
//                     <span>Use the Procedures tab, or pick a file in the Folders tab.</span>
//                   </div>
//                 )}
//               </div>

//               {ready && showAssist && (
//                 <AssistPanel
//                   left={left}
//                   right={right}
//                   leftName={leftName}
//                   rightName={rightName}
//                   diffSummary={diffSummary}
//                   target={updateSide}
//                   onTarget={setUpdateSide}
//                   onApply={apply}
//                 />
//               )}
//             </main>
//           )}

//           {tab === 'diff' && reviewSide && (
//             <main className="workspace no-assist">
//               <div className="diff-col">
//                 <div className="review-head">
//                   <div>
//                     <strong>{reviewSide === 'left' ? leftName : rightName}</strong>
//                     <span className="muted small"> · {openPath ?? 'pasted procedure'} · Original ↔ Current</span>
//                   </div>
//                   <div className="chips" aria-label="Changes since loaded">
//                     <span className="chip add">{reviewStats.added} added</span>
//                     <span className="chip del">{reviewStats.removed} removed</span>
//                     <span className="chip chg">{reviewStats.changed} changed</span>
//                   </div>
//                   <span className="spacer" />
//                   {viewControls}
//                   <button type="button" onClick={goCompare}>
//                     Back to compare
//                   </button>
//                   <button type="button" onClick={() => revertOpen(reviewSide)} disabled={origText === curText}>
//                     Revert file
//                   </button>
//                   <button type="button" onClick={() => downloadOpen(reviewSide)}>
//                     Download
//                   </button>
//                 </div>

//                 <DiffView
//                   mode="review"
//                   rows={reviewRows}
//                   leftText={origText}
//                   rightText={curText}
//                   hunks={reviewHunks}
//                   leftName="Original"
//                   rightName="Current"
//                   collapse={collapse}
//                   wrap={wrap}
//                   fontSize={fontSize}
//                   showList={showList}
//                   target="right"
//                   busy={reviewStale}
//                   recentTransfer={visibleRecentTransfer}
//                   onDismissTransfer={() => setRecentTransfer(null)}
//                   editable={{ left: false, right: true }}
//                   reviewed={reviewedSet}
//                   onReviewedChange={setReviewed}
//                   onTake={revTake}
//                   onTransfer={revTransfer}
//                   onDeleteRows={revDelete}
//                   onEditLine={revEdit}
//                   emptyTitle="No changes since this file was loaded."
//                   emptyHint="Edits, transfers and AI fixes you apply will show up here with a revert option."
//                 />
//               </div>
//             </main>
//           )}
//         </div>
//       </div>

//       {(pendingPlan || transferMessage) && (
//         <div className="transfer-modal-backdrop" role="presentation" onMouseDown={(e) => {
//           if (e.target === e.currentTarget) { setPendingPlan(null); setTransferMessage(null); }
//         }}>
//           <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
//             <header>
//               <h2 id="transfer-modal-title">{pendingPlan ? 'Review SQL transfer' : 'Transfer needs attention'}</h2>
//               <button type="button" className="ghost" onClick={() => { setPendingPlan(null); setTransferMessage(null); }}>Close</button>
//             </header>
//             {transferMessage && <p className="error" role="alert">{transferMessage}</p>}
//             {pendingPlan && (
//               <>
//                 <p className="transfer-plan-label">{pendingPlan.label}</p>
//                 <p className="muted small">Destination: <strong>{pendingPlan.target === 'left' ? (reviewSide ? 'Original / selected file' : leftName) : (reviewSide ? 'Current / selected file' : rightName)}</strong>. Nothing changes until you confirm.</p>
//                 {pendingPlan.warnings.length > 0 && (
//                   <div className="transfer-warnings">
//                     <strong>Review warnings</strong>
//                     <ul>{pendingPlan.warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
//                   </div>
//                 )}
//                 <label className="small" htmlFor="transfer-preview">Code that will be transferred</label>
//                 {pendingPlan.op === 'delete' ? (
//                   <div className="transfer-preview transfer-preview-empty">This operation removes code; no code will be added.</div>
//                 ) : (
//                   <pre id="transfer-preview" className="transfer-preview" aria-label="Code that will be transferred">
//                     {pendingPlan.previewText?.trimEnd() || 'No source code was found in the selected rows.'}
//                   </pre>
//                 )}
//                 <p className="muted small">After applying, the transferred lines will appear highlighted as added or changed code in the comparison view.</p>
//                 <footer>
//                   <button type="button" onClick={() => { setPendingPlan(null); setTransferMessage(null); }}>Cancel</button>
//                   <button type="button" className="primary" onClick={confirmTransfer}>Apply transfer</button>
//                 </footer>
//               </>
//             )}
//           </section>
//         </div>
//       )}
//     </div>
//   );
// }

// 
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import DeployKit from './components/DeployKit';
import AssistPanel from './components/AssistPanel';
import DiffView from './components/DiffView';
import SqlHighlight from './components/Sqlhighlight';
import FolderCompare from "./components/FolderCompare";
import IgnoreOptions from './components/IgnoreOptions';

import { hunkAssist } from './lib/api';
import { computeRows, computeStats, summarizeForAi } from './lib/diff';
import {
  collectChanges,
  copyFile,
  DEFAULT_EXTS,
  downloadText,
  EMPTY_FOLDERS,
  overlayPair,
  revertFile,
} from './lib/Folder';
import {
  buildHunkRequest,
  buildHunks,
  deleteRows,
  replaceHunk,
  replaceLine,
  takeFromSide,
  transferRows,
} from './lib/hunks';
import { defaultOptions } from './lib/normalize';
import { makePlan } from './lib/Transfer';
import type { PlanInput } from './lib/Transfer';
import { readSqlFile } from './lib/readFile';
import { clearSession, loadSession, saveSession, subscribeWarning, usePersistentState } from './lib/Session';
import type {
  Baseline,
  ChangeItem,
  DiffOptions,
  FolderSide,
  FolderState,
  Hunk,
  Plan,
  Range,
  Side,
  Tab,
  ViewMode,
} from './types';
import Sidebar, { SidebarFile } from './components/Sidebar';

/** Review view compares exactly: every ignore rule off, so even a whitespace edit shows up. */
const EXACT: DiffOptions = {
  ignoreWhitespace: false,
  ignoreLineBreaks: false,
  ignoreCase: false,
  ignoreComments: false,
  ignoreBlankLines: false,
  ignoreBrackets: false,
  ignoreCreateAlter: false,
  ignoreBoilerplate: false,
  ignoreTableHints: false,
};

interface Snapshot {
  left: string;
  right: string;
}

interface RecentTransfer {
  side: Side;
  from: number;
  to: number;
  summary: string;
}

/** Find the smallest changed line range in the destination after a transfer. */
function changedLineRange(before: string, after: string): { from: number; to: number } | null {
  const a = before.split(/\r\n|\r|\n/);
  const b = after.split(/\r\n|\r|\n/);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  if (prefix === a.length && prefix === b.length) return null;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { from: prefix + 1, to: Math.max(prefix + 1, b.length - suffix) };
}

const HISTORY_CHARS = 1_500_000;
function trimHistory(h: Snapshot[]): Snapshot[] {
  let total = 0;
  const out: Snapshot[] = [];
  for (let i = h.length - 1; i >= 0 && out.length < 15; i--) {
    total += h[i].left.length + h[i].right.length;
    if (total > HISTORY_CHARS) break;
    out.unshift(h[i]);
  }
  return out;
}

const countLines = (t: string) => (t ? t.split(/\r\n|\r|\n/).length : 0);
const fileNameOf = (path: string, fallback: string) => path.split('/').pop() || fallback;

interface EditorProps {
  title: string;
  hint: string;
  name: string;
  text: string;
  onName: (v: string) => void;
  onText: (v: string) => void;
}

function Editor({ title, hint, name, text, onName, onText }: EditorProps) {
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onText(await readSqlFile(file));
  };

  return (
    <section className="editor">
      <header>
        <div>
          <h2>{title}</h2>
          <p className="muted small">{hint}</p>
        </div>
        <input
          className="env-name"
          value={name}
          maxLength={60}
          aria-label={`${title} environment name`}
          onChange={(e) => onName(e.target.value)}
        />
      </header>
      <textarea
        spellCheck={false}
        value={text}
        placeholder="Paste the stored procedure from SSMS, or load a .sql file"
        onChange={(e) => onText(e.target.value)}
      />
      <footer>
        <label className="file-btn">
          Load .sql file
          <input type="file" accept=".sql,.txt" onChange={onFile} hidden />
        </label>
        <button type="button" onClick={() => onText('')} disabled={!text}>
          Clear
        </button>
        <button type="button" onClick={() => downloadText(`${name || title}.sql`, text)} disabled={!text}>
          Download
        </button>
        <span className="muted small">{text ? `${countLines(text)} lines` : ''}</span>
      </footer>
    </section>
  );
}

export default function App() {
  /* ---------- everything below is restored from sessionStorage after a refresh ---------- */
  const [left, setLeft] = usePersistentState<string>('left', '');
  const [right, setRight] = usePersistentState<string>('right', '');
  const [leftName, setLeftName] = usePersistentState<string>('leftName', 'UAT2');
  const [rightName, setRightName] = usePersistentState<string>('rightName', 'UAT');
  const [opts, setOpts] = usePersistentState<DiffOptions>('opts', defaultOptions);
  const [tab, setTab] = usePersistentState<Tab>('tab', 'input');
  const [view, setView] = usePersistentState<ViewMode>('view', { kind: 'compare' });
  const [collapse, setCollapse] = usePersistentState<boolean>('collapse', true);
  const [wrap, setWrap] = usePersistentState<boolean>('wrap', true);
  const [fontSize, setFontSize] = usePersistentState<number>('fontSize', 13);
  const [showList, setShowList] = usePersistentState<boolean>('showList', true);
  const [showAssist, setShowAssist] = usePersistentState<boolean>('showAssist', true);
  const [sidebarOpen, setSidebarOpen] = usePersistentState<boolean>('sidebar', true);
  const [updateSide, setUpdateSide] = usePersistentState<Side>('updateSide', 'right');
  const [baseline, setBaseline] = usePersistentState<Baseline | null>('baseline', null);
  const [dirty, setDirty] = usePersistentState<boolean>('dirty', false);
  const [folders, setFolders] = usePersistentState<FolderState | null>('folders', null);
  const [openPath, setOpenPath] = usePersistentState<string | null>('openPath', null);
  const [exts, setExts] = usePersistentState<string>('exts', DEFAULT_EXTS);
  const [reviewedMap, setReviewedMap] = usePersistentState<Record<string, string[]>>('reviewed', {});

  const [history, setHistory] = useState<Snapshot[]>(() => loadSession<Snapshot[]>('history', []));
  useEffect(() => {
    saveSession('history', trimHistory(history));
  }, [history]);

  const [warning, setWarning] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [transferMessage, setTransferMessage] = useState<string | null>(null);
  const [recentTransfer, setRecentTransfer] = useState<RecentTransfer | null>(null);
  useEffect(() => subscribeWarning(setWarning), []);

  /* ---------- derived state ---------- */
  const openKey = openPath ? openPath.toLowerCase() : null;
  const effView: ViewMode = view.kind === 'review' && baseline ? view : { kind: 'compare' };
  const reviewSide: Side | null = effView.kind === 'review' ? effView.side : null;

  /** Folder state with the live text of the open pair written into it. */
  const foldersLive = useMemo(
    () => overlayPair(folders, openKey, openPath, left, right, baseline),
    [folders, openKey, openPath, left, right, baseline],
  );

  const dLeft = useDeferredValue(left);
  const dRight = useDeferredValue(right);
  const dOpts = useDeferredValue(opts);

  const ready = left.trim() !== '' || right.trim() !== '';
  const stale = dLeft !== left || dRight !== right; // diff is catching up; line numbers not safe yet
  const rows = useMemo(() => (tab === 'folders' ? [] : computeRows(dLeft, dRight, dOpts)), [tab, dLeft, dRight, dOpts]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const hunks = useMemo(() => buildHunks(rows, leftName, rightName), [rows, leftName, rightName]);
  const diffSummary = useMemo(() => summarizeForAi(rows), [rows]);

  /* review (original vs current) */
  const origText = baseline && reviewSide ? baseline[reviewSide] : '';
  const curText = reviewSide === 'left' ? left : reviewSide === 'right' ? right : '';
  const visibleRecentTransfer = reviewSide
    ? (recentTransfer && recentTransfer.side === reviewSide
        ? { ...recentTransfer, side: 'right' as Side, summary: `Transferred code in ${openPath ?? (reviewSide === 'left' ? leftName : rightName)} (Current) · lines ${recentTransfer.from}${recentTransfer.to === recentTransfer.from ? '' : `–${recentTransfer.to}`}` }
        : null)
    : recentTransfer;
  const dOrig = useDeferredValue(origText);
  const dCur = useDeferredValue(curText);
  const reviewStale = dOrig !== origText || dCur !== curText;
  const reviewRows = useMemo(
    () => (reviewSide ? computeRows(dOrig, dCur, EXACT) : []),
    [reviewSide, dOrig, dCur],
  );
  const reviewStats = useMemo(() => computeStats(reviewRows), [reviewRows]);
  const reviewHunks = useMemo(() => (reviewSide ? buildHunks(reviewRows, 'Original', 'Current') : []), [reviewSide, reviewRows]);

  /* reviewed checkboxes, kept per view and per file */
  const reviewKey = `${reviewSide ? `rv-${reviewSide}` : 'cmp'}:${openPath ?? ''}`;
  const reviewedSet = useMemo(() => new Set(reviewedMap[reviewKey] ?? []), [reviewedMap, reviewKey]);
  const setReviewed = (next: Set<string>) => setReviewedMap((m) => ({ ...m, [reviewKey]: Array.from(next) }));

  /* sidebar data */
  const lineCounts = useMemo(() => ({ left: countLines(left), right: countLines(right) }), [left, right]);
  const files: SidebarFile[] = (['left', 'right'] as Side[]).map((side) => {
    const env = side === 'left' ? leftName : rightName;
    return {
      side,
      role: side === 'left' ? 'Source' : 'Target',
      env,
      path: openPath ?? env,
      modified: baseline ? (side === 'left' ? left !== baseline.left : right !== baseline.right) : false,
      lines: lineCounts[side],
    };
  });

  const others: ChangeItem[] = useMemo(() => {
    if (!foldersLive) return [];
    return collectChanges(foldersLive)
      .filter((c) => c.key !== openKey)
      .map((c) => ({
        id: `${c.side}:${c.key}`,
        side: c.side,
        key: c.key,
        env: foldersLive[c.side].name,
        path: c.file.path,
        status: c.file.created ? ('A' as const) : ('M' as const),
      }));
  }, [foldersLive, openKey]);

  const totalChanges = others.length + files.filter((f) => f.modified).length;

  /* ---------- editing the open pair ---------- */
  const commit = (nl: string, nr: string) => {
    setRecentTransfer(null);
    setHistory((h) => [...h.slice(-29), { left, right }]);
    setLeft(nl);
    setRight(nr);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setLeft(last.left);
    setRight(last.right);
  };

  const swap = () => {
    setLeft(right);
    setRight(left);
    setLeftName(rightName);
    setRightName(leftName);
    setBaseline((b) => (b ? { left: b.right, right: b.left } : b));
    if (foldersLive) setFolders({ left: foldersLive.right, right: foldersLive.left });
    setHistory((h) => h.map((s) => ({ left: s.right, right: s.left })));
    setUpdateSide((s) => (s === 'left' ? 'right' : 'left'));
    setView((v) => (v.kind === 'review' ? { kind: 'review', side: v.side === 'left' ? 'right' : 'left' } : v));
  };

  const apply = (side: Side, sql: string) => {
    if (side === 'left') commit(sql, right);
    else commit(left, sql);
    setView({ kind: 'compare' });
    setTab('diff');
  };

  const editLeft = (v: string) => {
    setRecentTransfer(null);
    setLeft(v);
    setDirty(true);
  };
  const editRight = (v: string) => {
    setRecentTransfer(null);
    setRight(v);
    setDirty(true);
  };

  /** Moves to the compare view. A new baseline is taken only for pasted text that was edited. */
  const goCompare = () => {
    if (!baseline || (dirty && !openPath)) {
      setBaseline({ left, right });
      setHistory([]);
      setReviewedMap({});
    }
    setDirty(false);
    setView({ kind: 'compare' });
    setTab('diff');
  };

  /* ---------- compare view actions ---------- */
  const takeHunk = (h: Hunk) => {
    if (stale) return;
    const next = takeFromSide(h, updateSide, left, right);
    if (updateSide === 'left') commit(next, right);
    else commit(left, next);
  };

  const askHunk = (h: Hunk, mode: 'explain' | 'fix', instruction?: string) =>
    hunkAssist(buildHunkRequest(h, mode, updateSide, left, right, leftName, rightName, instruction));

  const applyAi = (h: Hunk, replacement: string) => {
    if (stale) return;
    const next = replaceHunk(h, updateSide, updateSide === 'left' ? left : right, replacement);
    if (updateSide === 'left') commit(next, right);
    else commit(left, next);
  };

  const proposeTransfer = (
    sourceRows: typeof rows,
    from: Side,
    sel: number[],
    level: number,
    leftText: string,
    rightText: string,
    leftLabel: string,
    rightLabel: string,
  ) => {
    if (!sel.length) return;
    const target: Side = from === 'left' ? 'right' : 'left';
    const srcText = from === 'left' ? leftText : rightText;
    const dstText = target === 'left' ? leftText : rightText;
    const srcName = from === 'left' ? leftLabel : rightLabel;
    const dstName = target === 'left' ? leftLabel : rightLabel;

    // Exact mode deliberately preserves the user's line selection, including disjoint Ctrl-clicks.
    if (level < 0) {
      const text = transferRows(sourceRows, sel, from, leftText, rightText);
      const previewText = [...new Set(sel)]
        .sort((a, b) => a - b)
        .map((rowIndex) => sourceRows[rowIndex]?.[from]?.text)
        .filter((line): line is string => typeof line === 'string')
        .join('\n');
      setTransferMessage(null);
      setPendingPlan({
        op: 'replace', target, srcFrom: 0, srcTo: 0, dstFrom: 0, dstTo: 0,
        label: `Transfer ${sel.length} selected diff row${sel.length === 1 ? '' : 's'} exactly to ${dstName}`,
        level: -1, minLevel: -1, maxLevel: 0, warnings: [], previewText: previewText || '', text,
      });
      return;
    }

    const sorted = [...new Set(sel)].sort((a, b) => a - b);
    if (sorted.some((v, i) => i > 0 && v !== sorted[i - 1] + 1)) {
      setPendingPlan(null);
      setTransferMessage('Smart transfer needs one contiguous selection. Choose “Exact lines” for Ctrl/Cmd-clicked disjoint rows, or select one continuous range.');
      return;
    }

    const rangeFor = (side: Side): Range | null => {
      const nums = sorted.map((idx) => sourceRows[idx]?.[side]?.no).filter((n): n is number => typeof n === 'number');
      return nums.length ? { from: Math.min(...nums), to: Math.max(...nums) } : null;
    };
    const srcSel = rangeFor(from);
    const dstSel = rangeFor(target);
    let dstAfter = 0;
    for (let i = sorted[0] - 1; i >= 0; i--) {
      const no = sourceRows[i]?.[target]?.no;
      if (no !== undefined) { dstAfter = no; break; }
    }
    const s2d = new Map<number, number>();
    for (const row of sourceRows) {
      const a = row[from];
      const b = row[target];
      if (a && b) s2d.set(a.no, b.no);
    }
    const inp: PlanInput = {
      src: srcText, dst: dstText, srcSel, dstSel, dstAfter, s2d, level, target, srcName, dstName,
    };
    try {
      const plan = makePlan(inp);
      if (!plan) {
        setTransferMessage('No complete SQL unit could be identified for this selection. Try Exact lines or select a larger range.');
        setPendingPlan(null);
        return;
      }
      const plannedSourceLines = srcText.split(/\r\n|\r|\n/);
      const previewText = plan.op === 'delete'
        ? ''
        : plan.srcFrom > 0 && plan.srcTo >= plan.srcFrom
          ? plannedSourceLines.slice(plan.srcFrom - 1, plan.srcTo).join('\n')
          : '';
      setTransferMessage(null);
      setPendingPlan({ ...plan, previewText });
    } catch (e) {
      setPendingPlan(null);
      setTransferMessage(`The SQL structure could not be planned safely: ${e instanceof Error ? e.message : 'unknown parser error'}. Try Exact lines and review the result carefully.`);
    }
  };

  const cmpTransfer = (from: Side, sel: number[], level: number) => {
    if (stale) return;
    proposeTransfer(rows, from, sel, level, left, right, leftName, rightName);
  };

  const cmpDelete = (side: Side, sel: number[]) => {
    if (stale) return;
    if (side === 'left') commit(deleteRows(rows, sel, 'left', left), right);
    else commit(left, deleteRows(rows, sel, 'right', right));
  };

  const cmpEdit = (side: Side, no: number, text: string) => {
    if (stale) return;
    if (side === 'left') commit(replaceLine(left, no, text), right);
    else commit(left, replaceLine(right, no, text));
  };

  /* ---------- review view actions (original -> current) ---------- */
  const setWorking = (text: string) => {
    if (reviewSide === 'left') commit(text, right);
    else if (reviewSide === 'right') commit(left, text);
  };

  const confirmTransfer = () => {
    if (!pendingPlan) return;
    // In review mode the selected file can be either left or right, even though
    // the Current version is always rendered in DiffView's right-hand column.
    const actualSide: Side = reviewSide ?? pendingPlan.target;
    const beforeText = reviewSide ? curText : (pendingPlan.target === 'left' ? left : right);
    const changed = changedLineRange(beforeText, pendingPlan.text);
    const destinationName = reviewSide
      ? `${openPath ?? (reviewSide === 'left' ? leftName : rightName)} (Current)`
      : (openPath ?? (pendingPlan.target === 'left' ? leftName : rightName));

    if (reviewSide) setWorking(pendingPlan.text);
    else if (pendingPlan.target === 'left') commit(pendingPlan.text, right);
    else commit(left, pendingPlan.text);

    if (changed) {
      const lineCount = changed.to - changed.from + 1;
      setRecentTransfer({
        side: actualSide,
        from: changed.from,
        to: changed.to,
        summary: `Transferred ${lineCount} line${lineCount === 1 ? '' : 's'} to ${destinationName} · lines ${changed.from}${changed.to === changed.from ? '' : `–${changed.to}`}`,
      });
    } else {
      setRecentTransfer(null);
    }
    setTab('diff');
    setPendingPlan(null);
    setTransferMessage(null);
  };

  const revTake = (h: Hunk) => {
    if (reviewStale) return;
    setWorking(takeFromSide(h, 'right', origText, curText));
  };

  const revTransfer = (from: Side, sel: number[], level: number) => {
    if (reviewStale || from !== 'left') return; // only Original -> Current is allowed
    proposeTransfer(reviewRows, from, sel, level, origText, curText, 'Original', 'Current');
  };

  const revDelete = (side: Side, sel: number[]) => {
    if (reviewStale || side !== 'right') return;
    setWorking(deleteRows(reviewRows, sel, 'right', curText));
  };

  const revEdit = (side: Side, no: number, text: string) => {
    if (reviewStale || side !== 'right') return;
    setWorking(replaceLine(curText, no, text));
  };

  /* ---------- sidebar actions ---------- */
  const reviewFile = (side: Side) => {
    if (!baseline) setBaseline({ left, right });
    setView({ kind: 'review', side });
    setTab('diff');
  };

  const revertOpen = (side: Side) => {
    if (!baseline) return;
    if (side === 'left') commit(baseline.left, right);
    else commit(left, baseline.right);
  };

  const downloadOpen = (side: Side) => {
    const env = side === 'left' ? leftName : rightName;
    downloadText(fileNameOf(openPath ?? '', `${env}.sql`), side === 'left' ? left : right);
  };

  const openPair = (key: string) => {
    const f = foldersLive;
    if (!f) return;
    const lf = f.left.files[key];
    const rf = f.right.files[key];
    const path = (lf ?? rf)?.path;
    if (!path) return;
    setFolders(f);
    setOpenPath(path);
    setLeft(lf?.text ?? '');
    setRight(rf?.text ?? '');
    setLeftName(f.left.name);
    setRightName(f.right.name);
    setBaseline({ left: lf ? (lf.orig ?? lf.text) : '', right: rf ? (rf.orig ?? rf.text) : '' });
    setHistory([]);
    setDirty(false);
    setView({ kind: 'compare' });
    setTab('diff');
  };

  const openOther = (c: ChangeItem) => {
    if (!c.key) return;
    openPair(c.key);
    setView({ kind: 'review', side: c.side });
  };

  const revertOther = (c: ChangeItem) => {
    if (c.key && foldersLive) setFolders(revertFile(foldersLive, c.side, c.key));
  };

  const downloadOther = (c: ChangeItem) => {
    const file = c.key && foldersLive ? foldersLive[c.side].files[c.key] : undefined;
    if (file) downloadText(fileNameOf(file.path, `${c.env}.sql`), file.text);
  };

  const revertAll = () => {
    if (!window.confirm('Revert every changed file to how it was when loaded?')) return;
    let f = foldersLive;
    if (f) {
      for (const c of others) if (c.key) f = revertFile(f, c.side, c.key);
      if (f !== foldersLive) setFolders(f);
    }
    if (baseline && (left !== baseline.left || right !== baseline.right)) commit(baseline.left, baseline.right);
  };

  /* ---------- folder actions ---------- */
  const loadFolder = (side: Side, res: FolderSide) => {
    const base = foldersLive ?? EMPTY_FOLDERS;
    setFolders({ ...base, [side]: res });
    if (openPath) setOpenPath(null); // the open file may no longer exist in the new folder
  };

  const copyFolderFile = (key: string, from: Side) => {
    if (key === openKey) {
      if (from === 'left') commit(left, left);
      else commit(right, right);
      return;
    }
    if (foldersLive) setFolders(copyFile(foldersLive, key, from));
  };

  const clearFolders = () => {
    if (!window.confirm('Clear both folders? Edits made to files that are not open are lost.')) return;
    setFolders(null);
    setOpenPath(null);
  };

  const detach = () => {
    if (foldersLive) setFolders(foldersLive);
    setOpenPath(null);
  };

  const resetSession = () => {
    if (!window.confirm('Clear everything stored for this browser tab and start over?')) return;
    clearSession();
    window.location.reload();
  };

  const focusMode = !sidebarOpen && !showList && !showAssist;
  const toggleFocus = () => {
    const on = focusMode;
    setSidebarOpen(on);
    setShowList(on);
    setShowAssist(on);
  };

  const viewControls = (
    <div className="view-controls">
      <label>
        <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} />
        Fold unchanged
      </label>
      <label>
        <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
        Wrap lines
      </label>
      <label>
        <input type="checkbox" checked={showList} onChange={(e) => setShowList(e.target.checked)} />
        Change list
      </label>
      {!reviewSide && (
        <label>
          <input type="checkbox" checked={showAssist} onChange={(e) => setShowAssist(e.target.checked)} />
          AI panel
        </label>
      )}
      <span className="font-ctl" aria-label="Text size">
        <button type="button" onClick={() => setFontSize((s) => Math.max(10, s - 1))} aria-label="Smaller text">
          A−
        </button>
        <span className="small">{fontSize}px</span>
        <button type="button" onClick={() => setFontSize((s) => Math.min(22, s + 1))} aria-label="Larger text">
          A+
        </button>
      </span>
    </div>
  );

  const [deployOpen, setDeployOpen] = useState(false);
  if (deployOpen) return <DeployKit onBack={() => setDeployOpen(false)} />;

  return (
    <div className="app">
      <header className="topbar">
        <h1>SP Diff</h1>
        <nav aria-label="Views">
          <button type="button" className={tab === 'folders' ? 'on' : ''} onClick={() => setTab('folders')}>
            Folders
          </button>
          <button type="button" className={tab === 'input' ? 'on' : ''} onClick={() => setTab('input')}>
            Procedures
          </button>
          <button type="button" className={tab === 'diff' ? 'on' : ''} onClick={goCompare} disabled={!ready}>
            Differences
            {ready && stats.blocks > 0 && <span className="count">{stats.blocks}</span>}
          </button>
        </nav>
        {openPath && (
          <span className="crumb" title={openPath}>
            {openPath}
          </span>
        )}
        {openPath && folders && (
          <button type="button" onClick={() => setTab('folders')}>
            Back to folders
          </button>
        )}
        <div className="spacer" />
        <button type="button" onClick={() => setDeployOpen(true)} title="Clean table scripts, data scripts and release pack">
          Deploy Kit
        </button>
        <button type="button" onClick={() => setSidebarOpen((v) => !v)} aria-pressed={sidebarOpen}>
          Files{totalChanges ? ` (${totalChanges})` : ''}
        </button>
        <button type="button" onClick={toggleFocus} aria-pressed={focusMode} title="Hide the side panels for a wider code view">
          Focus
        </button>
        <button type="button" onClick={undo} disabled={history.length === 0}>
          Undo{history.length ? ` (${history.length})` : ''}
        </button>
        <button type="button" onClick={swap}>
          Swap sides
        </button>
        <button type="button" onClick={resetSession} title="Forget everything stored in this browser tab">
          Reset
        </button>
        {tab === 'input' && (
          <button type="button" className="primary" disabled={!ready} onClick={goCompare}>
            Compare
          </button>
        )}
      </header>

      {warning && (
        <div className="banner" role="status">
          {warning}
        </div>
      )}

      <div className="shell">
        {sidebarOpen && (
          <Sidebar
            files={files}
            reviewSide={tab === 'diff' ? reviewSide : null}
            compareActive={tab === 'diff' && !reviewSide}
            others={others}
            activeOther={null}
            totalChanges={totalChanges}
            onCompare={goCompare}
            onOpenFile={reviewFile}
            onRevertFile={revertOpen}
            onDownloadFile={downloadOpen}
            onOpenOther={openOther}
            onRevertOther={revertOther}
            onDownloadOther={downloadOther}
            onRevertAll={revertAll}
          />
        )}

        <div className="main">
          {tab === 'folders' && (
            <FolderCompare
              folders={foldersLive}
              opts={opts}
              onOpts={setOpts}
              openKey={openKey}
              exts={exts}
              onExts={setExts}
              onLoad={loadFolder}
              onOpen={openPair}
              onCopy={copyFolderFile}
              onClear={clearFolders}
            />
          )}

          {tab === 'input' && (
            <div className="input-wrap">
              {openPath && (
                <div className="notice">
                  <span>
                    You are editing the folder file <strong>{openPath}</strong>. Changes are kept in the folders.
                  </span>
                  <button type="button" onClick={detach}>
                    Detach from folder
                  </button>
                </div>
              )}
              <main className="inputs">
                <Editor title="Source" hint="The version with the changes you want" name={leftName} text={left} onName={setLeftName} onText={editLeft} />
                <Editor title="Target" hint="The version you are updating" name={rightName} text={right} onName={setRightName} onText={editRight} />
              </main>
            </div>
          )}

          {tab === 'diff' && !reviewSide && (
            <main className={`workspace${showAssist && ready ? '' : ' no-assist'}`}>
              <div className="diff-col">
                <div className="options">
                  <div className="chips" aria-label="Summary">
                    <span className="chip add">{stats.added} added</span>
                    <span className="chip del">{stats.removed} removed</span>
                    <span className="chip chg">{stats.changed} changed</span>
                  </div>
                  <IgnoreOptions opts={opts} onChange={setOpts} />
                  {viewControls}
                </div>

                {ready ? (
                  <DiffView
                    mode="compare"
                    rows={rows}
                    leftText={left}
                    rightText={right}
                    hunks={hunks}
                    leftName={leftName}
                    rightName={rightName}
                    collapse={collapse}
                    wrap={wrap}
                    fontSize={fontSize}
                    showList={showList}
                    target={updateSide}
                    busy={stale}
                    recentTransfer={visibleRecentTransfer}
                    onDismissTransfer={() => setRecentTransfer(null)}
                    editable={{ left: true, right: true }}
                    reviewed={reviewedSet}
                    onReviewedChange={setReviewed}
                    onTake={takeHunk}
                    onTransfer={cmpTransfer}
                    onDeleteRows={cmpDelete}
                    onEditLine={cmpEdit}
                    onAsk={askHunk}
                    onApplyAi={applyAi}
                  />
                ) : (
                  <div className="empty">
                    <strong>Add a procedure first.</strong>
                    <span>Use the Procedures tab, or pick a file in the Folders tab.</span>
                  </div>
                )}
              </div>

              {ready && showAssist && (
                <AssistPanel
                  left={left}
                  right={right}
                  leftName={leftName}
                  rightName={rightName}
                  diffSummary={diffSummary}
                  target={updateSide}
                  onTarget={setUpdateSide}
                  onApply={apply}
                />
              )}
            </main>
          )}

          {tab === 'diff' && reviewSide && (
            <main className="workspace no-assist">
              <div className="diff-col">
                <div className="review-head">
                  <div>
                    <strong>{reviewSide === 'left' ? leftName : rightName}</strong>
                    <span className="muted small"> · {openPath ?? 'pasted procedure'} · Original ↔ Current</span>
                  </div>
                  <div className="chips" aria-label="Changes since loaded">
                    <span className="chip add">{reviewStats.added} added</span>
                    <span className="chip del">{reviewStats.removed} removed</span>
                    <span className="chip chg">{reviewStats.changed} changed</span>
                  </div>
                  <span className="spacer" />
                  {viewControls}
                  <button type="button" onClick={goCompare}>
                    Back to compare
                  </button>
                  <button type="button" onClick={() => revertOpen(reviewSide)} disabled={origText === curText}>
                    Revert file
                  </button>
                  <button type="button" onClick={() => downloadOpen(reviewSide)}>
                    Download
                  </button>
                </div>

                <DiffView
                  mode="review"
                  rows={reviewRows}
                  leftText={origText}
                  rightText={curText}
                  hunks={reviewHunks}
                  leftName="Original"
                  rightName="Current"
                  collapse={collapse}
                  wrap={wrap}
                  fontSize={fontSize}
                  showList={showList}
                  target="right"
                  busy={reviewStale}
                  recentTransfer={visibleRecentTransfer}
                  onDismissTransfer={() => setRecentTransfer(null)}
                  editable={{ left: false, right: true }}
                  reviewed={reviewedSet}
                  onReviewedChange={setReviewed}
                  onTake={revTake}
                  onTransfer={revTransfer}
                  onDeleteRows={revDelete}
                  onEditLine={revEdit}
                  emptyTitle="No changes since this file was loaded."
                  emptyHint="Edits, transfers and AI fixes you apply will show up here with a revert option."
                />
              </div>
            </main>
          )}
        </div>
      </div>

      {(pendingPlan || transferMessage) && (
        <div className="transfer-modal-backdrop" role="presentation" onMouseDown={(e) => {
          if (e.target === e.currentTarget) { setPendingPlan(null); setTransferMessage(null); }
        }}>
          <section className="transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
            <header>
              <h2 id="transfer-modal-title">{pendingPlan ? 'Review SQL transfer' : 'Transfer needs attention'}</h2>
              <button type="button" className="ghost" onClick={() => { setPendingPlan(null); setTransferMessage(null); }}>Close</button>
            </header>
            {transferMessage && <p className="error" role="alert">{transferMessage}</p>}
            {pendingPlan && (
              <>
                <p className="transfer-plan-label">{pendingPlan.label}</p>
                <p className="muted small">Destination: <strong>{pendingPlan.target === 'left' ? (reviewSide ? 'Original / selected file' : leftName) : (reviewSide ? 'Current / selected file' : rightName)}</strong>. Nothing changes until you confirm.</p>
                {pendingPlan.warnings.length > 0 && (
                  <div className="transfer-warnings">
                    <strong>Review warnings</strong>
                    <ul>{pendingPlan.warnings.map((w, i) => <li key={`${i}-${w}`}>{w}</li>)}</ul>
                  </div>
                )}
                <label className="small" htmlFor="transfer-preview">Code that will be transferred</label>
                {pendingPlan.op === 'delete' ? (
                  <div className="transfer-preview transfer-preview-empty">This operation removes code; no code will be added.</div>
                ) : (
                  <pre id="transfer-preview" className="transfer-preview" aria-label="Code that will be transferred">
                    <SqlHighlight text={pendingPlan.previewText?.trimEnd() || 'No source code was found in the selected rows.'} />
                  </pre>
                )}
                <p className="muted small">After applying, the transferred lines will appear highlighted as added or changed code in the comparison view.</p>
                <footer>
                  <button type="button" onClick={() => { setPendingPlan(null); setTransferMessage(null); }}>Cancel</button>
                  <button type="button" className="primary" onClick={confirmTransfer}>Apply transfer</button>
                </footer>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}