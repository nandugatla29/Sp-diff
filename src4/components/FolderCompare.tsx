import { useDeferredValue, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { compareFolders, EMPTY_FOLDERS, parseExts, readFolder } from '../lib/Folder';
import { usePersistentState } from '../lib/Session';
import type { DiffOptions, FileStatus, FolderFile, FolderSide, FolderState, Side } from '../types';
import IgnoreOptions from './IgnoreOptions';

type Filter = 'all' | 'diff' | 'modified' | 'format' | 'left-only' | 'right-only' | 'same';

const DIR_ATTRS = { webkitdirectory: '', directory: '' } as Record<string, string>;

const STATUS_GLYPH: Record<FileStatus, string> = {
  same: '=',
  format: '≈',
  modified: '≠',
  'left-only': '◀',
  'right-only': '▶',
};

interface Props {
  folders: FolderState | null;
  opts: DiffOptions;
  onOpts: (o: DiffOptions) => void;
  openKey: string | null;
  exts: string;
  onExts: (v: string) => void;
  onLoad: (side: Side, res: FolderSide) => void;
  onOpen: (key: string) => void;
  onCopy: (key: string, from: Side) => void;
  onClear: () => void;
}

const kb = (t: string) => `${(t.length / 1024).toFixed(1)} KB`;

function FileLabel({ file }: { file: FolderFile }) {
  const i = file.path.lastIndexOf('/');
  const dir = i >= 0 ? file.path.slice(0, i + 1) : '';
  const name = i >= 0 ? file.path.slice(i + 1) : file.path;
  const edited = file.orig !== undefined && file.orig !== file.text;
  return (
    <span className="flabel" title={file.path}>
      {dir && <span className="fdir">{dir}</span>}
      <strong>{name}</strong>
      {edited && <span className="sb-flag">{file.created ? 'A' : 'M'}</span>}
      <span className="muted small">{kb(file.text)}</span>
    </span>
  );
}

export default function FolderCompare(p: Props) {
  const f = p.folders ?? EMPTY_FOLDERS;
  const dOpts = useDeferredValue(p.opts);
  const entries = useMemo(() => compareFolders(f, dOpts), [f, dOpts]);

  const [filter, setFilter] = usePersistentState<Filter>('folderFilter', 'diff');
  const [q, setQ] = usePersistentState('folderQuery', '');
  const [busy, setBusy] = useState<Side | null>(null);
  const [progress, setProgress] = useState('');
  const [note, setNote] = useState('');

  const counts = useMemo(() => {
    const c: Record<FileStatus, number> = { same: 0, format: 0, modified: 0, 'left-only': 0, 'right-only': 0 };
    entries.forEach((e) => c[e.status]++);
    return c;
  }, [entries]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      entries.filter((e) => {
        if (needle && !e.path.toLowerCase().includes(needle)) return false;
        if (filter === 'all') return true;
        if (filter === 'diff') return e.status !== 'same';
        return e.status === filter;
      }),
    [entries, filter, needle],
  );

  const pick = async (side: Side, e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!files.length) return;
    setBusy(side);
    setNote('');
    try {
      const res = await readFolder(files, parseExts(p.exts), (d, t) => setProgress(`${d}/${t}`));
      p.onLoad(side, res.side);
      const n = Object.keys(res.side.files).length;
      setNote(`${side === 'left' ? 'Source' : 'Target'}: ${n} file${n === 1 ? '' : 's'} loaded${res.skipped ? `, ${res.skipped} skipped (extension filter or over 2 MB)` : ''}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not read that folder.');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const leftCount = Object.keys(f.left.files).length;
  const rightCount = Object.keys(f.right.files).length;
  const hasAny = leftCount + rightCount > 0;

  const statusText = (s: FileStatus) =>
    s === 'same'
      ? 'Identical'
      : s === 'format'
        ? 'Only whitespace, comments or formatting differ (with the current ignore rules)'
        : s === 'modified'
          ? 'Different'
          : s === 'left-only'
            ? `Only in ${f.left.name}`
            : `Only in ${f.right.name}`;

  return (
    <main className="folders">
      <div className="folder-bar">
        <div className="chips" aria-label="Folder summary">
          <span className="chip chg">{counts.modified} different</span>
          <span className="chip">{counts.format} formatting only</span>
          <span className="chip del">{counts['left-only']} only in {f.left.name}</span>
          <span className="chip add">{counts['right-only']} only in {f.right.name}</span>
          <span className="chip">{counts.same} identical</span>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter files">
          <option value="diff">Show differences</option>
          <option value="all">Show all files</option>
          <option value="modified">Different only</option>
          <option value="format">Formatting only</option>
          <option value="left-only">Only in source</option>
          <option value="right-only">Only in target</option>
          <option value="same">Identical only</option>
        </select>
        <input className="search" value={q} placeholder="Search file names" onChange={(e) => setQ(e.target.value)} />
        <label className="small" title="Comma separated. Leave empty to read every file.">
          Extensions
          <input className="exts" value={p.exts} onChange={(e) => p.onExts(e.target.value)} />
        </label>
        <IgnoreOptions opts={p.opts} onChange={p.onOpts} />
        <button type="button" onClick={p.onClear} disabled={!hasAny}>
          Clear folders
        </button>
      </div>

      {note && <p className="muted small folder-note">{note}</p>}

      <div className="folder-grid">
        <div className="fhead">
          <div className="fpanel">
            <div>
              <h2>{f.left.name}</h2>
              <span className="muted small">Source · {leftCount} files</span>
            </div>
            <label className="file-btn primary">
              {busy === 'left' ? `Reading ${progress}` : 'Choose source folder'}
              <input type="file" hidden multiple {...DIR_ATTRS} onChange={(e) => pick('left', e)} />
            </label>
          </div>
          <div className="fmid-head" aria-hidden>
            copy
          </div>
          <div className="fpanel">
            <div>
              <h2>{f.right.name}</h2>
              <span className="muted small">Target · {rightCount} files</span>
            </div>
            <label className="file-btn primary">
              {busy === 'right' ? `Reading ${progress}` : 'Choose target folder'}
              <input type="file" hidden multiple {...DIR_ATTRS} onChange={(e) => pick('right', e)} />
            </label>
          </div>
        </div>

        {!hasAny && (
          <div className="empty">
            <strong>Pick a folder for each side.</strong>
            <span>The files are listed in two windows. Click a file that differs to open it in the code compare view.</span>
          </div>
        )}

        {hasAny && shown.length === 0 && (
          <div className="empty">
            <strong>No files match.</strong>
            <span>Change the filter or the search text.</span>
          </div>
        )}

        {shown.map((e) => (
          <div
            key={e.key}
            className={`frow ${e.status}${e.key === p.openKey ? ' open' : ''}`}
            role="button"
            tabIndex={0}
            title={`${statusText(e.status)}. Click to open in the code compare view`}
            onClick={() => p.onOpen(e.key)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') p.onOpen(e.key);
            }}
          >
            <div className="fcell">{e.left ? <FileLabel file={e.left} /> : <span className="ghost">not in {f.left.name}</span>}</div>
            <div className="fmid">
              <button
                type="button"
                className="icon"
                disabled={!e.left}
                title={`Replace the ${f.right.name} file with the ${f.left.name} file`}
                aria-label="Copy file to the right"
                onClick={(ev) => {
                  ev.stopPropagation();
                  p.onCopy(e.key, 'left');
                }}
              >
                →
              </button>
              <span className={`status ${e.status}`} title={statusText(e.status)}>
                {STATUS_GLYPH[e.status]}
              </span>
              <button
                type="button"
                className="icon"
                disabled={!e.right}
                title={`Replace the ${f.left.name} file with the ${f.right.name} file`}
                aria-label="Copy file to the left"
                onClick={(ev) => {
                  ev.stopPropagation();
                  p.onCopy(e.key, 'right');
                }}
              >
                ←
              </button>
            </div>
            <div className="fcell">{e.right ? <FileLabel file={e.right} /> : <span className="ghost">not in {f.right.name}</span>}</div>
          </div>
        ))}
      </div>
    </main>
  );
}