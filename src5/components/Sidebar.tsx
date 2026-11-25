import type { ChangeItem, Side } from '../types';

export interface SidebarFile {
  side: Side;
  role: string; // "Source" / "Target"
  env: string;
  path: string;
  modified: boolean;
  lines: number;
}

interface Props {
  files: SidebarFile[];
  reviewSide: Side | null; // side currently shown in the review view
  compareActive: boolean;
  others: ChangeItem[];
  activeOther: string | null;
  totalChanges: number;
  onCompare: () => void;
  onOpenFile: (s: Side) => void;
  onRevertFile: (s: Side) => void;
  onDownloadFile: (s: Side) => void;
  onOpenOther: (c: ChangeItem) => void;
  onRevertOther: (c: ChangeItem) => void;
  onDownloadOther: (c: ChangeItem) => void;
  onRevertAll: () => void;
}

const base = (p: string) => p.split('/').pop() || p;
const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

export default function Sidebar(p: Props) {
  return (
    <aside className="sidebar" aria-label="Files and changes">
      <div className="sb-section">
        <div className="sb-title">
          <span>Open files</span>
          {p.totalChanges > 0 && (
            <button type="button" className="icon" title="Revert every changed file to how it was loaded" onClick={p.onRevertAll}>
              Revert all
            </button>
          )}
        </div>

        <button type="button" className={`sb-item compare${p.compareActive ? ' on' : ''}`} onClick={p.onCompare}>
          <span className="sb-glyph">⇄</span>
          <span className="sb-name">Compare both side by side</span>
        </button>

        {p.files.map((f) => (
          <div key={f.side} className={`sb-row${p.reviewSide === f.side ? ' on' : ''}`}>
            <button
              type="button"
              className="sb-item"
              onClick={() => p.onOpenFile(f.side)}
              title={f.modified ? 'Show what changed since it was loaded' : 'No changes yet. Click to open the review view'}
            >
              <span className={`sb-letter ${f.side}`}>{f.side === 'left' ? 'S' : 'T'}</span>
              <span className="sb-name">
                <strong>{base(f.path)}</strong>
                <span className="muted small">
                  {dir(f.path)} {f.role} · {f.env} · {f.lines} lines
                </span>
              </span>
              {f.modified && <span className="sb-flag" title="Modified">M</span>}
            </button>
            {f.modified && (
              <span className="sb-actions">
                <button type="button" className="icon" title="Revert this file to how it was loaded" aria-label="Revert file" onClick={() => p.onRevertFile(f.side)}>
                  ↶
                </button>
                <button type="button" className="icon" title="Download this file" aria-label="Download file" onClick={() => p.onDownloadFile(f.side)}>
                  ⤓
                </button>
              </span>
            )}
          </div>
        ))}
      </div>

      {p.others.length > 0 && (
        <div className="sb-section">
          <div className="sb-title">
            <span>Other changed files</span>
            <span className="count">{p.others.length}</span>
          </div>
          {p.others.map((c) => (
            <div key={c.id} className={`sb-row${p.activeOther === c.id ? ' on' : ''}`}>
              <button type="button" className="sb-item" onClick={() => p.onOpenOther(c)} title={`${c.env} · ${c.path}`}>
                <span className={`sb-letter ${c.side}`}>{c.side === 'left' ? 'S' : 'T'}</span>
                <span className="sb-name">
                  <strong>{base(c.path)}</strong>
                  <span className="muted small">
                    {dir(c.path)} {c.env}
                  </span>
                </span>
                <span className="sb-flag">{c.status}</span>
              </button>
              <span className="sb-actions">
                <button type="button" className="icon" title="Revert this file" aria-label="Revert file" onClick={() => p.onRevertOther(c)}>
                  ↶
                </button>
                <button type="button" className="icon" title="Download this file" aria-label="Download file" onClick={() => p.onDownloadOther(c)}>
                  ⤓
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="muted small sb-help">
        Click a file to see what changed since it was loaded. Inside that view, use the line arrows or “Revert this change” to
        undo only part of it.
      </p>
    </aside>
  );
}   