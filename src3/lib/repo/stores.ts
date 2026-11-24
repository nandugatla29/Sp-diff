import type { Store } from './git';

/* =====================================================================================
 * Where repositories live:
 *  - IdbStore:    your own copy, inside the browser (IndexedDB, hundreds of MB, survives
 *                 restarts; gone only if you clear this site's data).
 *  - FolderStore: a real folder on disk picked with the File System Access API
 *                 (Chrome / Edge). Point it at a Google Drive / OneDrive synced folder or a
 *                 network share and the whole team shares one "remote".
 * ===================================================================================== */

const DB = 'sp-repo';
const FILES = 'files';
const HANDLES = 'handles';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
        if (!d.objectStoreNames.contains(HANDLES)) d.createObjectStore(HANDLES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available in this browser.'));
    });
  }
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export class IdbStore implements Store {
  readonly label = 'your browser';
  private prefix: string;
  constructor(repoKey = 'default') {
    this.prefix = `${repoKey}:`;
  }
  async read(path: string) {
    const v = await run<string | undefined>(FILES, 'readonly', (s) => s.get(this.prefix + path));
    return v ?? null;
  }
  async write(path: string, text: string) {
    await run(FILES, 'readwrite', (s) => s.put(text, this.prefix + path));
  }
  async remove(path: string) {
    await run(FILES, 'readwrite', (s) => s.delete(this.prefix + path));
  }
  async exists(path: string) {
    const k = await run<IDBValidKey | undefined>(FILES, 'readonly', (s) => s.getKey(this.prefix + path));
    return k !== undefined;
  }
  private async keysUnder(dir: string): Promise<string[]> {
    const start = `${this.prefix}${dir ? `${dir}/` : ''}`;
    const keys = await run<IDBValidKey[]>(FILES, 'readonly', (s) => s.getAllKeys(IDBKeyRange.bound(start, `${start}￿`)));
    return keys.map((k) => String(k).slice(start.length));
  }
  async list(dir: string) {
    return (await this.keysUnder(dir)).filter((k) => !k.includes('/'));
  }
  async dirs(dir: string) {
    return [...new Set((await this.keysUnder(dir)).filter((k) => k.includes('/')).map((k) => k.split('/')[0]))];
  }
  /** Deletes the whole local repository. */
  async clear() {
    const keys = await this.keysUnder('');
    for (const k of keys) await this.remove(k);
  }
}

/* ---------------------------------------------------------------- folder store ---- */

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
};

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

export class FolderStore implements Store {
  readonly label: string;
  private root: DirHandle;
  constructor(root: FileSystemDirectoryHandle) {
    this.root = root as DirHandle;
    this.label = `folder "${root.name}"`;
  }
  private async dir(parts: string[], create: boolean): Promise<DirHandle | null> {
    let d: DirHandle = this.root;
    for (const p of parts) {
      try {
        d = (await d.getDirectoryHandle(p, { create })) as DirHandle;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    }
    return d;
  }
  private split(path: string): { parts: string[]; name: string } {
    const all = path.split('/').filter(Boolean);
    return { parts: all.slice(0, -1), name: all[all.length - 1] };
  }
  async read(path: string) {
    const { parts, name } = this.split(path);
    const d = await this.dir(parts, false);
    if (!d) return null;
    try {
      const f = await (await d.getFileHandle(name)).getFile();
      return await f.text();
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  async write(path: string, text: string) {
    const { parts, name } = this.split(path);
    const d = await this.dir(parts, true);
    const fh = await d!.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }
  async remove(path: string) {
    const { parts, name } = this.split(path);
    const d = await this.dir(parts, false);
    if (!d) return;
    try {
      await d.removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }
  async exists(path: string) {
    const { parts, name } = this.split(path);
    const d = await this.dir(parts, false);
    if (!d) return false;
    try {
      await d.getFileHandle(name);
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }
  private async entries(dir: string, kind: 'file' | 'directory'): Promise<string[]> {
    const d = await this.dir(dir.split('/').filter(Boolean), false);
    if (!d) return [];
    const out: string[] = [];
    for await (const h of d.values()) if (h.kind === kind && !h.name.startsWith('.') && h.name !== 'desktop.ini') out.push(h.name);
    return out;
  }
  list(dir: string) {
    return this.entries(dir, 'file');
  }
  dirs(dir: string) {
    return this.entries(dir, 'directory');
  }
}

/* ---------------------------------------------------------------- remembering the folder ---- */

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  return picker({ id: 'sp-repo', mode: 'readwrite' });
}

export async function saveFolder(h: FileSystemDirectoryHandle | null) {
  if (h) await run(HANDLES, 'readwrite', (s) => s.put(h, 'remote'));
  else await run(HANDLES, 'readwrite', (s) => s.delete('remote'));
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return ((await run<FileSystemDirectoryHandle | undefined>(HANDLES, 'readonly', (s) => s.get('remote'))) ?? null) as FileSystemDirectoryHandle | null;
  } catch {
    return null;
  }
}

/** 'granted' | 'prompt' | 'denied'. Asking (request = true) only works from a click. */
export async function folderPermission(h: FileSystemDirectoryHandle, request: boolean): Promise<PermissionState> {
  const d = h as DirHandle;
  const opts = { mode: 'readwrite' as const };
  const cur = d.queryPermission ? await d.queryPermission(opts) : 'granted';
  if (cur === 'granted' || !request) return cur;
  return d.requestPermission ? d.requestPermission(opts) : cur;
}
