import { buildEntries, comparableTokens, lineBreaksIgnored } from './normalize';
import { readSqlFile } from './readFile';
import type {
  Baseline,
  DiffOptions,
  FileStatus,
  FolderEntry,
  FolderFile,
  FolderSide,
  FolderState,
  Side,
} from '../types';

export const DEFAULT_EXTS = '.sql, .txt';
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const EMPTY_FOLDERS: FolderState = {
  left: { name: 'Source', files: {} },
  right: { name: 'Target', files: {} },
};

export function parseExts(s: string): string[] {
  return s
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x.startsWith('.') ? x : `.${x}`));
}

export interface LoadResult {
  side: FolderSide;
  skipped: number;
}

/** Reads a folder picked with <input webkitdirectory>. Handles SSMS UTF-16 files. */
export async function readFolder(
  files: File[],
  exts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<LoadResult> {
  const rel = (f: File) =>
    ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/');
  const first = files.length ? rel(files[0]) : '';
  const name = first.includes('/') ? first.split('/')[0] : 'Folder';

  const keep = files.filter(
    (f) => f.size <= MAX_FILE_BYTES && (exts.length === 0 || exts.some((x) => f.name.toLowerCase().endsWith(x))),
  );

  const out: Record<string, FolderFile> = {};
  let done = 0;
  for (let i = 0; i < keep.length; i += 16) {
    const chunk = keep.slice(i, i + 16);
    const texts = await Promise.all(chunk.map((f) => readSqlFile(f)));
    chunk.forEach((f, j) => {
      const r = rel(f);
      const path = r.includes('/') ? r.split('/').slice(1).join('/') : r;
      out[path.toLowerCase()] = { path, text: texts[j] };
    });
    done += chunk.length;
    onProgress?.(done, keep.length);
  }
  return { side: { name, files: out }, skipped: files.length - keep.length };
}

/* ---------- comparing ---------- */

function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const optSig = (o: DiffOptions) =>
  (Object.keys(o) as (keyof DiffOptions)[])
    .sort()
    .map((k) => (o[k] ? '1' : '0'))
    .join('');

const hashCache = new Map<string, number>();

/** Hash of the text after the ignore rules are applied. Equal hashes = no real difference. */
function normHash(text: string, o: DiffOptions): number {
  const k = `${optSig(o)}|${text.length}|${cyrb53(text)}`;
  const hit = hashCache.get(k);
  if (hit !== undefined) return hit;
  if (hashCache.size > 3000) hashCache.clear();
  // With line breaks ignored, hash the token stream so layout-only differences count as "format".
  const v = cyrb53(
    lineBreaksIgnored(o)
      ? comparableTokens(text, o)
          .map((t) => t.key)
          .join('\u001f')
      : buildEntries(text, o)
          .map((e) => e.key)
          .join('\n'),
  );
  hashCache.set(k, v);
  return v;
}

export function compareFolders(f: FolderState, o: DiffOptions): FolderEntry[] {
  const keys = Array.from(new Set([...Object.keys(f.left.files), ...Object.keys(f.right.files)]));
  const out: FolderEntry[] = keys.map((key) => {
    const l = f.left.files[key];
    const r = f.right.files[key];
    let status: FileStatus;
    if (l && !r) status = 'left-only';
    else if (!l && r) status = 'right-only';
    else if (l.text === r.text) status = 'same';
    else status = normHash(l.text, o) === normHash(r.text, o) ? 'format' : 'modified';
    return { key, path: (l ?? r).path, status, left: l, right: r };
  });
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/* ---------- keeping the open pair and the folder state in sync ---------- */

function overlaySide(side: FolderSide, key: string, display: string, text: string, base: string): FolderSide {
  const f = side.files[key];

  if (!f) {
    if (text === '' && base === '') return side;
    return { ...side, files: { ...side.files, [key]: { path: display, text, orig: base, created: true } } };
  }

  if (f.created && text === '') {
    const files = { ...side.files };
    delete files[key];
    return { ...side, files };
  }

  const orig = text === base ? undefined : base;
  if (f.text === text && f.orig === orig) return side;
  return { ...side, files: { ...side.files, [key]: { ...f, text, orig } } };
}

/** Writes the live text of the open pair into the folder state (returns the same object if nothing changed). */
export function overlayPair(
  f: FolderState | null,
  key: string | null,
  display: string | null,
  left: string,
  right: string,
  base: Baseline | null,
): FolderState | null {
  if (!f || !key || !base) return f;
  const l = overlaySide(f.left, key, display ?? key, left, base.left);
  const r = overlaySide(f.right, key, display ?? key, right, base.right);
  return l === f.left && r === f.right ? f : { left: l, right: r };
}

export function revertFile(f: FolderState, side: Side, key: string): FolderState {
  const s = f[side];
  const file = s.files[key];
  if (!file) return f;
  const files = { ...s.files };
  if (file.created) delete files[key];
  else files[key] = { path: file.path, text: file.orig ?? file.text };
  return { ...f, [side]: { ...s, files } };
}

/** Copies a whole file to the other side (in memory only). */
export function copyFile(f: FolderState, key: string, from: Side): FolderState {
  const to: Side = from === 'left' ? 'right' : 'left';
  const src = f[from].files[key];
  if (!src) return f;
  const dst = f[to].files[key];

  let next: FolderFile;
  if (dst) {
    const orig = dst.orig ?? dst.text;
    next = { path: dst.path, text: src.text, orig: src.text === orig ? undefined : orig, created: dst.created };
  } else {
    next = { path: src.path, text: src.text, orig: '', created: true };
  }
  return { ...f, [to]: { ...f[to], files: { ...f[to].files, [key]: next } } };
}

export function collectChanges(f: FolderState): { side: Side; key: string; file: FolderFile }[] {
  const out: { side: Side; key: string; file: FolderFile }[] = [];
  (['left', 'right'] as Side[]).forEach((side) => {
    for (const [key, file] of Object.entries(f[side].files)) {
      if (file.orig !== undefined && file.orig !== file.text) out.push({ side, key, file });
    }
  });
  return out.sort((a, b) => a.file.path.localeCompare(b.file.path, undefined, { numeric: true, sensitivity: 'base' }));
}

export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}