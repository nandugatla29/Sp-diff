// import { useState } from 'react';
// import { lineLabel } from '../lib/hunks';
// import type { Hunk, HunkAiResult, Side } from '../types';

// interface Props {
//   id: string;
//   hunk: Hunk;
//   index: number;
//   total: number;
//   leftName: string;
//   rightName: string;
//   target: Side;
//   busy: boolean;
//   current: boolean;
//   reviewed: boolean;
//   onReview: () => void;
//   onTake: () => void;
//   onAsk: (mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
//   onApplyAi: (replacement: string) => void;
// }

// export default function HunkBar(p: Props) {
//   const { hunk: h } = p;
//   const [ai, setAi] = useState<(HunkAiResult & { mode: 'explain' | 'fix' }) | null>(null);
//   const [working, setWorking] = useState<'explain' | 'fix' | null>(null);
//   const [err, setErr] = useState<string | null>(null);
//   const [fixOpen, setFixOpen] = useState(false);
//   const [instruction, setInstruction] = useState('');

//   const tName = (p.target === 'left' ? p.leftName : p.rightName) || (p.target === 'left' ? 'Left' : 'Right');
//   const sName = (p.target === 'left' ? p.rightName : p.leftName) || (p.target === 'left' ? 'Right' : 'Left');
//   const srcRange = p.target === 'left' ? h.right : h.left;
//   const dstRange = p.target === 'left' ? h.left : h.right;
//   const takeLabel = !srcRange
//     ? `Remove these lines from ${tName}`
//     : !dstRange
//       ? `Add these lines to ${tName}`
//       : `Use ${sName} version`;

//   const ask = async (mode: 'explain' | 'fix') => {
//     setWorking(mode);
//     setErr(null);
//     try {
//       const r = await p.onAsk(mode, mode === 'fix' ? instruction : undefined);
//       setAi({ ...r, mode });
//     } catch (e) {
//       setErr(e instanceof Error ? e.message : 'Something went wrong.');
//     } finally {
//       setWorking(null);
//     }
//   };

//   return (
//     <div id={p.id} className={`hunk-bar ${h.risk}${p.current ? ' current' : ''}${p.reviewed ? ' done' : ''}`}>
//       <div className="hunk-head">
//         <span className={`badge ${h.risk}`}>{h.risk}</span>
//         <strong>
//           {p.index + 1}/{p.total} · {h.title}
//         </strong>
//         <span className="muted small">{lineLabel(h)}</span>
//         <span className="spacer" />
//         <label className="small">
//           <input type="checkbox" checked={p.reviewed} onChange={p.onReview} /> Reviewed
//         </label>
//       </div>

//       <ul className="hunk-notes">
//         {h.notes.map((n, i) => (
//           <li key={i}>{n}</li>
//         ))}
//       </ul>

//       <div className="hunk-actions">
//         <button type="button" className="primary" disabled={p.busy} onClick={p.onTake} title={`Edits ${tName} only. Use Undo to revert.`}>
//           {takeLabel}
//         </button>
//         <button type="button" disabled={working !== null} onClick={() => ask('explain')}>
//           {working === 'explain' ? 'Working' : 'Explain with AI'}
//         </button>
//         <button type="button" disabled={working !== null} onClick={() => setFixOpen((v) => !v)}>
//           Fix with AI
//         </button>
//       </div>

//       {fixOpen && (
//         <div className="hunk-fix">
//           <input
//             value={instruction}
//             maxLength={300}
//             placeholder={`Optional, e.g. keep ${tName}'s linked server name`}
//             onChange={(e) => setInstruction(e.target.value)}
//             onKeyDown={(e) => e.key === 'Enter' && working === null && ask('fix')}
//           />
//           <button type="button" disabled={working !== null} onClick={() => ask('fix')}>
//             {working === 'fix' ? 'Working' : 'Run'}
//           </button>
//         </div>
//       )}

//       {err && (
//         <p className="error" role="alert">
//           {err}
//         </p>
//       )}

//       {ai && (
//         <div className="hunk-ai">
//           <p>{ai.explanation}</p>
//           {ai.notes.length > 0 && (
//             <ul>
//               {ai.notes.map((n, i) => (
//                 <li key={i}>{n}</li>
//               ))}
//             </ul>
//           )}
//           {ai.mode === 'fix' && ai.replacement !== null && (
//             <>
//               <pre>{ai.replacement || '(remove these lines)'}</pre>
//               <button type="button" className="primary" disabled={p.busy} onClick={() => p.onApplyAi(ai.replacement as string)}>
//                 Apply to {tName}
//               </button>
//             </>
//           )}
//           {ai.mode === 'fix' && ai.replacement === null && <p className="muted small">AI suggests no change to {tName}.</p>}
//         </div>
//       )}
//     </div>
//   );
// }

import { useState } from 'react';
import { lineLabel } from '../lib/hunks';
import type { Hunk, HunkAiResult, Side } from '../types';

interface Props {
  id: string;
  mode: 'compare' | 'review';
  hunk: Hunk;
  index: number;
  total: number;
  leftName: string;
  rightName: string;
  target: Side;
  busy: boolean;
  current: boolean;
  reviewed: boolean;
  onReview: () => void;
  onTake: () => void;
  onSelect: (side: Side) => void;
  onAsk?: (mode: 'explain' | 'fix', instruction?: string) => Promise<HunkAiResult>;
  onApplyAi?: (replacement: string) => void;
}

export default function HunkBar(p: Props) {
  const { hunk: h } = p;
  const [ai, setAi] = useState<(HunkAiResult & { mode: 'explain' | 'fix' }) | null>(null);
  const [working, setWorking] = useState<'explain' | 'fix' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fixOpen, setFixOpen] = useState(false);
  const [instruction, setInstruction] = useState('');

  const review = p.mode === 'review';
  const lName = p.leftName || 'Left';
  const rName = p.rightName || 'Right';
  const tName = p.target === 'left' ? lName : rName;
  const sName = p.target === 'left' ? rName : lName;
  const srcRange = p.target === 'left' ? h.right : h.left;
  const dstRange = p.target === 'left' ? h.left : h.right;
  const takeLabel = review
    ? 'Revert this change'
    : !srcRange
      ? `Remove these lines from ${tName}`
      : !dstRange
        ? `Add these lines to ${tName}`
        : `Use ${sName} version`;

  const ask = async (mode: 'explain' | 'fix') => {
    if (!p.onAsk) return;
    setWorking(mode);
    setErr(null);
    try {
      const r = await p.onAsk(mode, mode === 'fix' ? instruction : undefined);
      setAi({ ...r, mode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div id={p.id} className={`hunk-bar ${h.risk}${p.current ? ' current' : ''}${p.reviewed ? ' done' : ''}`}>
      <div className="hunk-head">
        <span className={`badge ${h.risk}`}>{h.risk}</span>
        <strong>
          {p.index + 1}/{p.total} · {h.title}
        </strong>
        <span className="muted small">{lineLabel(h)}</span>
        <span className="spacer" />
        <label className="small">
          <input type="checkbox" checked={p.reviewed} onChange={p.onReview} /> Reviewed
        </label>
      </div>

      <ul className="hunk-notes">
        {h.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <div className="hunk-actions">
        <button
          type="button"
          className="primary"
          disabled={p.busy}
          onClick={p.onTake}
          title={review ? 'Puts the original lines back into the current file. Use Undo to redo.' : `Edits ${tName} only. Use Undo to revert.`}
        >
          {takeLabel}
        </button>
        <button type="button" className="ghost" onClick={() => p.onSelect('left')} title={`Select these lines in ${lName} to transfer or delete them`}>
          Select in {lName}
        </button>
        <button type="button" className="ghost" onClick={() => p.onSelect('right')} title={`Select these lines in ${rName} to transfer or delete them`}>
          Select in {rName}
        </button>
        {!review && p.onAsk && (
          <>
            <button type="button" disabled={working !== null} onClick={() => ask('explain')}>
              {working === 'explain' ? 'Working' : 'Explain with AI'}
            </button>
            <button type="button" disabled={working !== null} onClick={() => setFixOpen((v) => !v)}>
              Fix with AI
            </button>
          </>
        )}
      </div>

      {!review && fixOpen && (
        <div className="hunk-fix">
          <input
            value={instruction}
            maxLength={300}
            placeholder={`Optional, e.g. keep ${tName}'s linked server name`}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && working === null && ask('fix')}
          />
          <button type="button" disabled={working !== null} onClick={() => ask('fix')}>
            {working === 'fix' ? 'Working' : 'Run'}
          </button>
        </div>
      )}

      {err && (
        <p className="error" role="alert">
          {err}
        </p>
      )}

      {ai && (
        <div className="hunk-ai">
          <p>{ai.explanation}</p>
          {ai.notes.length > 0 && (
            <ul>
              {ai.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {ai.mode === 'fix' && ai.replacement !== null && p.onApplyAi && (
            <>
              <pre>{ai.replacement || '(remove these lines)'}</pre>
              <button type="button" className="primary" disabled={p.busy} onClick={() => p.onApplyAi?.(ai.replacement as string)}>
                Apply to {tName}
              </button>
            </>
          )}
          {ai.mode === 'fix' && ai.replacement === null && <p className="muted small">AI suggests no change to {tName}.</p>}
        </div>
      )}
    </div>
  );
}