/* =====================================================================================
 * SP Repo: a small git for stored procedures.
 *
 *  - Your copy ("local") lives in the browser (IndexedDB): working files, commits,
 *    branches, merges. Works offline.
 *  - The team copy ("remote", like GitHub) is a folder: a local folder, a network share
 *    or a synced Google Drive / OneDrive folder. Push / fetch / pull copy commits between them.
 *
 * Layout (the same in both stores):
 *   sprepo.json                       repository marker
 *   objects/ab/cdef...                file contents and commits, named by their SHA-256
 *                                     (never change, so two people syncing never clash)
 *   refs/heads/<branch>               {"commit","at","by"}  branch tips
 * Local only:
 *   HEAD                              current branch name
 *   work/<sp name>                    your working copy of each procedure
 *   refs/remotes/origin/<branch>      what the remote looked like at the last fetch
 *   MERGE_STATE                       an unfinished merge with conflicts
 * Remote only:
 *   pushes/<time>_<user>.json         push log (one file per push: no sync clashes)
 *   pulls/<id>/pr.json                pull requests, pulls/<id>/c_<time>.json comments
 * ===================================================================================== */

export interface Store {
  readonly label: string;
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** File names directly inside a folder (no sub folders). */
  list(dir: string): Promise<string[]>;
  /** Sub folder names directly inside a folder. */
  dirs(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

/** Map of procedure name -> content id. */
export type Tree = Record<string, string>;

export interface Commit {
  id: string;
  tree: Tree;
  parents: string[];
  author: string;
  message: string;
  time: string; // ISO
}

export interface RefInfo {
  commit: string;
  at: string;
  by: string;
}

export type FileState = 'added' | 'modified' | 'deleted';

export interface StatusEntry {
  name: string;
  state: FileState;
}

export interface PushRecord {
  id: string;
  branch: string;
  from: string | null;
  to: string;
  commits: number;
  by: string;
  at: string;
  forced?: boolean;
  deleted?: boolean;
}

export interface PullRequest {
  id: string;
  title: string;
  body: string;
  from: string;
  to: string;
  author: string;
  createdAt: string;
  status: 'open' | 'merged' | 'closed';
  mergedAt?: string;
  mergedBy?: string;
  mergeCommit?: string;
  closedAt?: string;
  closedBy?: string;
}

export interface PrComment {
  id: string;
  by: string;
  at: string;
  text: string;
}

export interface Conflict {
  name: string;
  base: string | null; // text, null = did not exist
  ours: string | null;
  theirs: string | null;
}

export interface MergeState {
  theirs: string; // commit id
  label: string; // what was merged, e.g. "origin/main" or "feature/x"
  ours: string | null;
  tree: Tree; // merged tree without the conflicted files
  conflicts: Conflict[];
}

export type MergeResult =
  | { kind: 'up-to-date' }
  | { kind: 'fast-forward'; commit: string }
  | { kind: 'merged'; commit: string }
  | { kind: 'conflict'; conflicts: Conflict[] };

export class RepoError extends Error {}

/* ------------------------------------------------------------------ helpers ---- */

export const BRANCH_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const encName = (s: string) => encodeURIComponent(s).replace(/\./g, '%2E');
const decName = (s: string) => decodeURIComponent(s);
const objPath = (id: string) => `objects/${id.slice(0, 2)}/${id.slice(2)}`;
const now = () => new Date().toISOString();
const rand = () => Math.random().toString(36).slice(2, 8);
const fileStamp = (iso: string) => iso.replace(/[:.]/g, '-');

function cyrb(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** SHA-256 (first 40 hex chars, like a git id). Falls back to a JS hash outside secure pages. */
export async function hashText(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 40);
  }
  return (cyrb(text, 1) + cyrb(text, 2) + cyrb(text, 3)).slice(0, 40);
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 7) : '-------');

/** Name of the object a script creates: CREATE/ALTER PROCEDURE|VIEW|FUNCTION|TRIGGER [schema].[name]. */
export function detectName(sql: string): string | null {
  const m = /\b(?:create|alter)\s+(?:or\s+alter\s+)?(?:proc(?:edure)?|view|function|trigger)\s+((?:\[[^\]]+\]|[\w#@$]+)(?:\s*\.\s*(?:\[[^\]]+\]|[\w#@$]+))?)/i.exec(stripComments(sql));
  if (!m) return null;
  const parts = m[1].split('.').map((p) => p.trim().replace(/^\[|\]$/g, ''));
  return parts.length === 1 ? `dbo.${parts[0]}` : `${parts[0]}.${parts[1]}`;
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/* ------------------------------------------------------------------ memory store (tests) ---- */

export class MemStore implements Store {
  readonly label: string;
  readonly files = new Map<string, string>();
  constructor(label = 'memory') {
    this.label = label;
  }
  async read(p: string) {
    return this.files.get(p) ?? null;
  }
  async write(p: string, t: string) {
    this.files.set(p, t);
  }
  async remove(p: string) {
    this.files.delete(p);
  }
  async exists(p: string) {
    return this.files.has(p);
  }
  async list(dir: string) {
    const pre = dir ? `${dir}/` : '';
    return [...this.files.keys()].filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length));
  }
  async dirs(dir: string) {
    const pre = dir ? `${dir}/` : '';
    const out = new Set<string>();
    for (const k of this.files.keys()) if (k.startsWith(pre) && k.slice(pre.length).includes('/')) out.add(k.slice(pre.length).split('/')[0]);
    return [...out];
  }
}

/* ------------------------------------------------------------------ repository ---- */

export class Repo {
  local: Store;
  remote: Store | null;
  user: string;
  private commits = new Map<string, Commit>();
  private blobs = new Map<string, string>();

  constructor(local: Store, remote: Store | null, user: string) {
    this.local = local;
    this.remote = remote;
    this.user = user || 'unknown';
  }

  /* ---------- objects ---------- */

  async putBlob(text: string, store: Store = this.local): Promise<string> {
    const id = await hashText(`blob\0${text}`);
    if (!(await store.exists(objPath(id)))) await store.write(objPath(id), text);
    this.blobs.set(id, text);
    return id;
  }

  async blob(id: string, store?: Store): Promise<string> {
    const hit = this.blobs.get(id);
    if (hit !== undefined) return hit;
    const t = (await (store ?? this.local).read(objPath(id))) ?? (store ? null : await this.remote?.read(objPath(id)));
    if (t === null || t === undefined) throw new RepoError(`Missing file content ${shortId(id)}. Fetch from the remote to get it.`);
    this.blobs.set(id, t);
    return t;
  }

  private async writeCommit(c: Omit<Commit, 'id'>, store: Store = this.local): Promise<Commit> {
    const body = JSON.stringify({ tree: sortTree(c.tree), parents: c.parents, author: c.author, message: c.message, time: c.time });
    const id = await hashText(`commit\0${body}`);
    if (!(await store.exists(objPath(id)))) await store.write(objPath(id), body);
    const commit = { ...c, id };
    this.commits.set(id, commit);
    return commit;
  }

  async commit(id: string, store?: Store): Promise<Commit> {
    const hit = this.commits.get(id);
    if (hit) return hit;
    let raw = await (store ?? this.local).read(objPath(id));
    if (raw === null && !store && this.remote) raw = await this.remote.read(objPath(id));
    if (raw === null) throw new RepoError(`Missing commit ${shortId(id)}. Fetch from the remote to get it.`);
    const c = { ...(JSON.parse(raw) as Omit<Commit, 'id'>), id };
    this.commits.set(id, c);
    return c;
  }

  /* ---------- refs ---------- */

  async currentBranch(): Promise<string> {
    return ((await this.local.read('HEAD')) ?? 'main').trim() || 'main';
  }

  async ref(name: string, store: Store = this.local, ns = 'refs/heads'): Promise<RefInfo | null> {
    const raw = await store.read(`${ns}/${encName(name)}`);
    return raw ? (JSON.parse(raw) as RefInfo) : null;
  }

  private async setRef(name: string, commit: string, store: Store = this.local, ns = 'refs/heads') {
    const info: RefInfo = { commit, at: now(), by: this.user };
    await store.write(`${ns}/${encName(name)}`, JSON.stringify(info));
  }

  async branches(store: Store = this.local, ns = 'refs/heads'): Promise<{ name: string; ref: RefInfo }[]> {
    const names = await store.list(ns);
    const out: { name: string; ref: RefInfo }[] = [];
    for (const n of names) {
      const raw = await store.read(`${ns}/${n}`);
      if (raw) out.push({ name: decName(n), ref: JSON.parse(raw) as RefInfo });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async headCommit(): Promise<Commit | null> {
    const r = await this.ref(await this.currentBranch());
    return r ? this.commit(r.commit) : null;
  }

  /** A branch name, "origin/<branch>" or a commit id -> commit id. */
  async resolve(spec: string): Promise<string | null> {
    if (spec.startsWith('origin/')) return (await this.ref(spec.slice(7), this.local, 'refs/remotes/origin'))?.commit ?? null;
    const r = await this.ref(spec);
    if (r) return r.commit;
    if (/^[0-9a-f]{7,40}$/.test(spec)) {
      if (spec.length === 40) return spec;
      for (const id of this.commits.keys()) if (id.startsWith(spec)) return id;
    }
    return null;
  }

  /* ---------- working copy ---------- */

  async work(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const n of await this.local.list('work')) {
      const t = await this.local.read(`work/${n}`);
      if (t !== null) out[decName(n)] = t;
    }
    return out;
  }

  async saveWork(name: string, text: string) {
    await this.local.write(`work/${encName(name)}`, text);
  }

  async deleteWork(name: string) {
    await this.local.remove(`work/${encName(name)}`);
  }

  private async writeTreeToWork(tree: Tree) {
    const cur = await this.local.list('work');
    for (const n of cur) if (!(decName(n) in tree)) await this.local.remove(`work/${n}`);
    for (const [name, id] of Object.entries(tree)) await this.saveWork(name, await this.blob(id));
  }

  async status(): Promise<StatusEntry[]> {
    const head = await this.headCommit();
    const tree = head?.tree ?? {};
    const work = await this.work();
    const out: StatusEntry[] = [];
    for (const [name, text] of Object.entries(work)) {
      const id = await hashText(`blob\0${text}`);
      if (!(name in tree)) out.push({ name, state: 'added' });
      else if (tree[name] !== id) out.push({ name, state: 'modified' });
    }
    for (const name of Object.keys(tree)) if (!(name in work)) out.push({ name, state: 'deleted' });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Throws when there are uncommitted changes (checkout, merge and pull need a clean copy). */
  async requireClean(what: string) {
    if (await this.local.exists('MERGE_STATE')) throw new RepoError('Finish or abort the merge in progress first.');
    const st = await this.status();
    if (st.length) throw new RepoError(`You have ${st.length} uncommitted change(s). Commit or discard them before you ${what}.`);
  }

  /** Commit the given files (all changes when names is empty). */
  async commitChanges(message: string, names?: string[]): Promise<Commit> {
    if (!message.trim()) throw new RepoError('Write a commit message.');
    if (await this.local.exists('MERGE_STATE')) throw new RepoError('A merge is in progress: resolve the conflicts and use "Commit merge".');
    const branch = await this.currentBranch();
    const head = await this.headCommit();
    const st = await this.status();
    const pick = names?.length ? st.filter((s) => names.includes(s.name)) : st;
    if (!pick.length) throw new RepoError('Nothing to commit.');
    const work = await this.work();
    const tree: Tree = { ...(head?.tree ?? {}) };
    for (const s of pick) {
      if (s.state === 'deleted') delete tree[s.name];
      else tree[s.name] = await this.putBlob(work[s.name]);
    }
    const c = await this.writeCommit({ tree, parents: head ? [head.id] : [], author: this.user, message: message.trim(), time: now() });
    await this.setRef(branch, c.id);
    return c;
  }

  async discard(names?: string[]) {
    const head = await this.headCommit();
    const tree = head?.tree ?? {};
    const st = await this.status();
    for (const s of st) {
      if (names?.length && !names.includes(s.name)) continue;
      if (s.state === 'added') await this.deleteWork(s.name);
      else await this.saveWork(s.name, await this.blob(tree[s.name]));
    }
  }

  /* ---------- branches ---------- */

  async createBranch(name: string, from?: string, switchTo = true) {
    if (!BRANCH_RE.test(name)) throw new RepoError('Branch names may use letters, digits, . _ - and / (e.g. feature/report-fix).');
    if (await this.ref(name)) throw new RepoError(`Branch "${name}" already exists.`);
    const start = from ? await this.resolve(from) : (await this.headCommit())?.id ?? null;
    if (!start) throw new RepoError('Make a first commit before creating branches.');
    await this.setRef(name, start);
    if (switchTo) await this.local.write('HEAD', name);
  }

  async checkout(name: string) {
    if (name === (await this.currentBranch()) && (await this.ref(name))) return;
    await this.requireClean('switch branch');
    let ref = await this.ref(name);
    if (!ref) {
      // a branch that so far only exists on the remote: start tracking it
      const remote = await this.ref(name, this.local, 'refs/remotes/origin');
      if (!remote) throw new RepoError(`Branch "${name}" does not exist.`);
      await this.setRef(name, remote.commit);
      ref = await this.ref(name);
    }
    const c = await this.commit(ref!.commit);
    await this.writeTreeToWork(c.tree);
    await this.local.write('HEAD', name);
  }

  async deleteBranch(name: string) {
    if (name === (await this.currentBranch())) throw new RepoError('Switch to another branch before deleting this one.');
    await this.local.remove(`refs/heads/${encName(name)}`);
  }

  /* ---------- history ---------- */

  async log(from: string | null, limit = 200): Promise<Commit[]> {
    if (!from) return [];
    const out: Commit[] = [];
    const seen = new Set<string>();
    let frontier: Commit[] = [await this.commit(from)];
    while (frontier.length && out.length < limit) {
      frontier.sort((a, b) => b.time.localeCompare(a.time));
      const c = frontier.shift()!;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      for (const p of c.parents) if (!seen.has(p)) frontier.push(await this.commit(p));
    }
    return out;
  }

  async ancestors(id: string | null): Promise<Set<string>> {
    const seen = new Set<string>();
    if (!id) return seen;
    const stack = [id];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      const c = await this.commit(x);
      stack.push(...c.parents);
    }
    return seen;
  }

  /** How many commits a has that b has not (ahead), and the other way round (behind). */
  async aheadBehind(a: string | null, b: string | null): Promise<{ ahead: number; behind: number }> {
    const A = await this.ancestors(a);
    const B = await this.ancestors(b);
    let ahead = 0;
    let behind = 0;
    A.forEach((x) => !B.has(x) && ahead++);
    B.forEach((x) => !A.has(x) && behind++);
    return { ahead, behind };
  }

  async isAncestor(maybe: string, of: string): Promise<boolean> {
    return (await this.ancestors(of)).has(maybe);
  }

  async mergeBase(a: string, b: string): Promise<string | null> {
    const A = await this.ancestors(a);
    const order = await this.log(b, 100000);
    return order.find((c) => A.has(c.id))?.id ?? null;
  }

  /** Files that differ between two commits (null = empty tree). */
  async changes(from: string | null, to: string | null): Promise<StatusEntry[]> {
    const a = from ? (await this.commit(from)).tree : {};
    const b = to ? (await this.commit(to)).tree : {};
    const out: StatusEntry[] = [];
    for (const n of Object.keys(b)) {
      if (!(n in a)) out.push({ name: n, state: 'added' });
      else if (a[n] !== b[n]) out.push({ name: n, state: 'modified' });
    }
    for (const n of Object.keys(a)) if (!(n in b)) out.push({ name: n, state: 'deleted' });
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  async fileAt(commit: string | null, name: string): Promise<string | null> {
    if (!commit) return null;
    const c = await this.commit(commit);
    return c.tree[name] ? this.blob(c.tree[name]) : null;
  }

  /* ---------- merge ---------- */

  private async mergeTrees(base: Tree, ours: Tree, theirs: Tree): Promise<{ tree: Tree; conflicts: Conflict[] }> {
    const tree: Tree = {};
    const conflicts: Conflict[] = [];
    const names = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
    for (const n of names) {
      const b = base[n];
      const o = ours[n];
      const t = theirs[n];
      let pick: string | undefined;
      if (o === t) pick = o;
      else if (o === b) pick = t;
      else if (t === b) pick = o;
      else {
        conflicts.push({
          name: n,
          base: b ? await this.blob(b) : null,
          ours: o ? await this.blob(o) : null,
          theirs: t ? await this.blob(t) : null,
        });
        continue;
      }
      if (pick) tree[n] = pick;
    }
    return { tree, conflicts };
  }

  /** Merge a branch / origin/<branch> / commit into the current branch. */
  async merge(spec: string, label = spec): Promise<MergeResult> {
    await this.requireClean('merge');
    const theirs = await this.resolve(spec);
    if (!theirs) throw new RepoError(`Nothing to merge: "${spec}" was not found.`);
    const branch = await this.currentBranch();
    const head = await this.headCommit();
    if (!head) {
      await this.setRef(branch, theirs);
      await this.writeTreeToWork((await this.commit(theirs)).tree);
      return { kind: 'fast-forward', commit: theirs };
    }
    if (head.id === theirs || (await this.isAncestor(theirs, head.id))) return { kind: 'up-to-date' };
    if (await this.isAncestor(head.id, theirs)) {
      await this.setRef(branch, theirs);
      await this.writeTreeToWork((await this.commit(theirs)).tree);
      return { kind: 'fast-forward', commit: theirs };
    }
    const baseId = await this.mergeBase(head.id, theirs);
    const base = baseId ? (await this.commit(baseId)).tree : {};
    const { tree, conflicts } = await this.mergeTrees(base, head.tree, (await this.commit(theirs)).tree);
    if (!conflicts.length) {
      const c = await this.writeCommit({ tree, parents: [head.id, theirs], author: this.user, message: `Merge ${label} into ${branch}`, time: now() });
      await this.setRef(branch, c.id);
      await this.writeTreeToWork(tree);
      return { kind: 'merged', commit: c.id };
    }
    // Leave the merge open: write the clean files, keep "ours" for conflicted ones until resolved.
    const state: MergeState = { theirs, label, ours: head.id, tree, conflicts };
    await this.local.write('MERGE_STATE', JSON.stringify(state));
    const work: Tree = { ...tree };
    for (const c of conflicts) if (head.tree[c.name]) work[c.name] = head.tree[c.name];
    await this.writeTreeToWork(work);
    return { kind: 'conflict', conflicts };
  }

  async mergeState(): Promise<MergeState | null> {
    const raw = await this.local.read('MERGE_STATE');
    return raw ? (JSON.parse(raw) as MergeState) : null;
  }

  /** resolution: name -> final text (null = delete the file). */
  async finishMerge(resolution: Record<string, string | null>, message?: string): Promise<Commit> {
    const st = await this.mergeState();
    if (!st) throw new RepoError('No merge in progress.');
    const missing = st.conflicts.filter((c) => !(c.name in resolution));
    if (missing.length) throw new RepoError(`Resolve every conflict first: ${missing.map((m) => m.name).join(', ')}`);
    const tree: Tree = { ...st.tree };
    for (const [name, text] of Object.entries(resolution)) {
      if (text === null) delete tree[name];
      else tree[name] = await this.putBlob(text);
    }
    const branch = await this.currentBranch();
    const c = await this.writeCommit({
      tree,
      parents: st.ours ? [st.ours, st.theirs] : [st.theirs],
      author: this.user,
      message: message?.trim() || `Merge ${st.label} into ${branch} (conflicts resolved)`,
      time: now(),
    });
    await this.setRef(branch, c.id);
    await this.local.remove('MERGE_STATE');
    await this.writeTreeToWork(tree);
    return c;
  }

  async abortMerge() {
    const st = await this.mergeState();
    if (!st) return;
    await this.local.remove('MERGE_STATE');
    const head = await this.headCommit();
    await this.writeTreeToWork(head?.tree ?? {});
  }

  /** Put an old version of one procedure back into the working copy (commit it to keep it). */
  async restoreFile(commit: string, name: string) {
    const text = await this.fileAt(commit, name);
    if (text === null) await this.deleteWork(name);
    else await this.saveWork(name, text);
  }

  /* ---------- copying between stores ---------- */

  /** Copies every commit (and its files) reachable from `tip` that `to` does not have yet. Oldest first. */
  private async copyHistory(from: Store, to: Store, tip: string): Promise<number> {
    const missing: Commit[] = [];
    const seen = new Set<string>();
    const stack = [tip];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (await to.exists(objPath(id))) continue; // everything older is there too
      const c = await this.commit(id, from);
      missing.push(c);
      stack.push(...c.parents);
    }
    missing.sort((a, b) => a.time.localeCompare(b.time));
    for (const c of missing) {
      for (const id of Object.values(c.tree)) {
        if (await to.exists(objPath(id))) continue;
        const t = await from.read(objPath(id));
        if (t === null) throw new RepoError(`File content ${shortId(id)} is missing in ${from.label}.`);
        await to.write(objPath(id), t);
      }
      const raw = await from.read(objPath(c.id));
      if (raw === null) throw new RepoError(`Commit ${shortId(c.id)} is missing in ${from.label}.`);
      await to.write(objPath(c.id), raw);
    }
    return missing.length;
  }

  private needRemote(): Store {
    if (!this.remote) throw new RepoError('Connect a shared folder first (Settings).');
    return this.remote;
  }

  async initRemote(name: string) {
    const r = this.needRemote();
    if (!(await r.exists('sprepo.json'))) await r.write('sprepo.json', JSON.stringify({ format: 1, name, createdAt: now(), createdBy: this.user }, null, 2));
  }

  /** Download new commits and branch tips from the shared folder. Never changes your branches. */
  async fetch(): Promise<{ branches: number; commits: number }> {
    const r = this.needRemote();
    const remoteBranches = await this.branches(r);
    let commits = 0;
    for (const b of remoteBranches) {
      commits += await this.copyHistory(r, this.local, b.ref.commit);
      await this.local.write(`refs/remotes/origin/${encName(b.name)}`, JSON.stringify(b.ref));
    }
    // branches deleted on the remote
    for (const n of await this.local.list('refs/remotes/origin')) {
      if (!remoteBranches.some((b) => encName(b.name) === n)) await this.local.remove(`refs/remotes/origin/${n}`);
    }
    await this.local.write('FETCH_AT', now());
    return { branches: remoteBranches.length, commits };
  }

  /** Upload a branch. Refuses when the remote has commits you do not have (pull first), unless forced. */
  async push(branch?: string, force = false): Promise<PushRecord> {
    const r = this.needRemote();
    const name = branch ?? (await this.currentBranch());
    const local = await this.ref(name);
    if (!local) throw new RepoError(`Branch "${name}" has no commits to push.`);
    const remote = await this.ref(name, r);
    if (remote && remote.commit === local.commit) throw new RepoError(`Everything is already pushed: origin/${name} is up to date.`);
    if (remote && !force) {
      const known = await this.local.exists(objPath(remote.commit));
      if (!known || !(await this.isAncestor(remote.commit, local.commit)))
        throw new RepoError(`Push rejected: origin/${name} has commits you do not have (pushed by ${remote.by} at ${new Date(remote.at).toLocaleString()}). Pull first, then push again.`);
    }
    // New commits = not reachable from any branch already on the shared folder.
    const before = new Set<string>();
    for (const b of await this.branches(r)) {
      if (await this.local.exists(objPath(b.ref.commit))) (await this.ancestors(b.ref.commit)).forEach((x) => before.add(x));
    }
    const count = [...(await this.ancestors(local.commit))].filter((x) => !before.has(x)).length;
    await this.copyHistory(this.local, r, local.commit);
    // last check right before moving the branch: someone may have pushed meanwhile
    const again = await this.ref(name, r);
    if (!force && (again?.commit ?? null) !== (remote?.commit ?? null)) throw new RepoError(`Push rejected: ${again?.by ?? 'someone'} pushed to origin/${name} a moment ago. Pull and try again.`);
    const info: RefInfo = { commit: local.commit, at: now(), by: this.user };
    await r.write(`refs/heads/${encName(name)}`, JSON.stringify(info));
    await this.local.write(`refs/remotes/origin/${encName(name)}`, JSON.stringify(info));
    const rec: PushRecord = { id: `${fileStamp(info.at)}_${rand()}`, branch: name, from: remote?.commit ?? null, to: local.commit, commits: count, by: this.user, at: info.at, forced: force && !!remote };
    await r.write(`pushes/${rec.id}.json`, JSON.stringify(rec));
    return rec;
  }

  async deleteRemoteBranch(name: string) {
    const r = this.needRemote();
    const ref = await this.ref(name, r);
    if (!ref) return;
    await r.remove(`refs/heads/${encName(name)}`);
    await this.local.remove(`refs/remotes/origin/${encName(name)}`);
    const at = now();
    const rec: PushRecord = { id: `${fileStamp(at)}_${rand()}`, branch: name, from: ref.commit, to: ref.commit, commits: 0, by: this.user, at, deleted: true };
    await r.write(`pushes/${rec.id}.json`, JSON.stringify(rec));
  }

  /** fetch + merge origin/<current branch>. */
  async pull(): Promise<MergeResult & { fetched: number }> {
    await this.requireClean('pull');
    const f = await this.fetch();
    const branch = await this.currentBranch();
    if (!(await this.ref(branch, this.local, 'refs/remotes/origin'))) return { kind: 'up-to-date', fetched: f.commits };
    const res = await this.merge(`origin/${branch}`, `origin/${branch}`);
    return { ...res, fetched: f.commits };
  }

  async pushes(limit = 300): Promise<PushRecord[]> {
    const r = this.needRemote();
    const names = (await r.list('pushes')).filter((n) => n.endsWith('.json')).sort().reverse().slice(0, limit);
    // (file names start with the push time, so this is newest first)
    const out: PushRecord[] = [];
    for (const n of names) {
      const raw = await r.read(`pushes/${n}`);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as PushRecord);
        } catch {
          /* half-synced file: skip */
        }
      }
    }
    return out;
  }

  /* ---------- pull requests (stored on the remote) ---------- */

  async pullRequests(): Promise<PullRequest[]> {
    const r = this.needRemote();
    const out: PullRequest[] = [];
    for (const d of await r.dirs('pulls')) {
      const raw = await r.read(`pulls/${d}/pr.json`);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as PullRequest);
        } catch {
          /* skip */
        }
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async createPullRequest(title: string, body: string, from: string, to: string): Promise<PullRequest> {
    const r = this.needRemote();
    if (!title.trim()) throw new RepoError('Give the pull request a title.');
    if (from === to) throw new RepoError('Pick two different branches.');
    if (!(await this.ref(from, r))) throw new RepoError(`Push "${from}" first: the pull request needs it on the shared folder.`);
    if (!(await this.ref(to, r))) throw new RepoError(`Branch "${to}" is not on the shared folder.`);
    const at = now();
    const pr: PullRequest = { id: `${fileStamp(at)}_${rand()}`, title: title.trim(), body, from, to, author: this.user, createdAt: at, status: 'open' };
    await r.write(`pulls/${pr.id}/pr.json`, JSON.stringify(pr, null, 2));
    return pr;
  }

  async comments(prId: string): Promise<PrComment[]> {
    const r = this.needRemote();
    const out: PrComment[] = [];
    for (const n of (await r.list(`pulls/${prId}`)).filter((x) => x.startsWith('c_')).sort()) {
      const raw = await r.read(`pulls/${prId}/${n}`);
      if (raw) {
        try {
          out.push(JSON.parse(raw) as PrComment);
        } catch {
          /* skip */
        }
      }
    }
    return out;
  }

  async addComment(prId: string, text: string) {
    const r = this.needRemote();
    if (!text.trim()) return;
    const at = now();
    const c: PrComment = { id: `${fileStamp(at)}_${rand()}`, by: this.user, at, text: text.trim() };
    await r.write(`pulls/${prId}/c_${c.id}.json`, JSON.stringify(c));
  }

  private async savePr(pr: PullRequest) {
    await this.needRemote().write(`pulls/${pr.id}/pr.json`, JSON.stringify(pr, null, 2));
  }

  async closePullRequest(pr: PullRequest) {
    await this.savePr({ ...pr, status: 'closed', closedAt: now(), closedBy: this.user });
  }

  async reopenPullRequest(pr: PullRequest) {
    await this.savePr({ ...pr, status: 'open', closedAt: undefined, closedBy: undefined });
  }

  /** Can the PR be merged on the shared folder without conflicts? */
  async prCheck(pr: PullRequest): Promise<{ state: 'merged' | 'ff' | 'clean' | 'conflict' | 'missing'; conflicts: string[]; ahead: number; behind: number }> {
    await this.fetch();
    const from = await this.resolve(`origin/${pr.from}`);
    const to = await this.resolve(`origin/${pr.to}`);
    if (!from || !to) return { state: 'missing', conflicts: [], ahead: 0, behind: 0 };
    const { ahead, behind } = await this.aheadBehind(from, to);
    if (await this.isAncestor(from, to)) return { state: 'merged', conflicts: [], ahead, behind };
    if (await this.isAncestor(to, from)) return { state: 'ff', conflicts: [], ahead, behind };
    const base = await this.mergeBase(from, to);
    const { conflicts } = await this.mergeTrees(base ? (await this.commit(base)).tree : {}, (await this.commit(to)).tree, (await this.commit(from)).tree);
    return { state: conflicts.length ? 'conflict' : 'clean', conflicts: conflicts.map((c) => c.name), ahead, behind };
  }

  /** Merge a PR straight on the shared folder (like the GitHub "Merge" button). */
  async mergePullRequest(pr: PullRequest): Promise<string> {
    const r = this.needRemote();
    const check = await this.prCheck(pr);
    const from = (await this.resolve(`origin/${pr.from}`))!;
    const toRef = await this.ref(pr.to, r);
    if (check.state === 'missing' || !toRef) throw new RepoError('One of the branches is gone from the shared folder.');
    if (check.state === 'conflict')
      throw new RepoError(`Conflicts in ${check.conflicts.join(', ')}. Merge locally: switch to ${pr.to}, pull, merge ${pr.from}, resolve, push.`);
    let result = from;
    if (check.state === 'clean') {
      const to = toRef.commit;
      const base = await this.mergeBase(from, to);
      const { tree } = await this.mergeTrees(base ? (await this.commit(base)).tree : {}, (await this.commit(to)).tree, (await this.commit(from)).tree);
      const c = await this.writeCommit({ tree, parents: [to, from], author: this.user, message: `Merge pull request "${pr.title}" from ${pr.from} into ${pr.to}`, time: now() });
      await this.copyHistory(this.local, r, c.id);
      result = c.id;
    }
    if (check.state !== 'merged') {
      const again = await this.ref(pr.to, r);
      if (again?.commit !== toRef.commit) throw new RepoError(`${again?.by ?? 'Someone'} pushed to ${pr.to} a moment ago. Try the merge again.`);
      const info: RefInfo = { commit: result, at: now(), by: this.user };
      await r.write(`refs/heads/${encName(pr.to)}`, JSON.stringify(info));
      await this.local.write(`refs/remotes/origin/${encName(pr.to)}`, JSON.stringify(info));
      const rec: PushRecord = { id: `${fileStamp(info.at)}_${rand()}`, branch: pr.to, from: toRef.commit, to: result, commits: check.ahead + (check.state === 'clean' ? 1 : 0), by: this.user, at: info.at };
      await r.write(`pushes/${rec.id}.json`, JSON.stringify(rec));
    }
    await this.savePr({ ...pr, status: 'merged', mergedAt: now(), mergedBy: this.user, mergeCommit: result });
    return result;
  }
}

function sortTree(t: Tree): Tree {
  const out: Tree = {};
  for (const k of Object.keys(t).sort()) out[k] = t[k];
  return out;
}
