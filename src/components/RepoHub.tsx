import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import '../deploy.css';
import '../repo.css';
import { computeRows, computeStats } from '../lib/diff';
import { defaultOptions } from '../lib/normalize';
import { BRANCH_RE, Repo, RepoError, detectName, shortId } from '../lib/repo/git';
import type { Commit, Conflict, MergeState, PrComment, PullRequest, PushRecord, RefInfo, StatusEntry } from '../lib/repo/git';
import { FolderStore, IdbStore, folderPermission, folderSupported, loadFolder, pickFolder, saveFolder } from '../lib/repo/stores';
import { downloadText } from '../lib/Folder';
import { usePersistentState } from '../lib/Session';
import type { Row } from '../types';
import CodeArea from './FindReplace';
import Panes from './Panes';
import SqlHighlight from './Sqlhighlight';

/* =====================================================================================
 * SP Repo: git + a GitHub-like hub for stored procedures, inside SP Diff.
 *   Code       edit procedures, see what changed, commit (pick files), resolve merges
 *   History    commits of any branch, what each commit changed, compare any two points
 *   Branches   create / switch / merge / push / delete, ahead-behind vs main and vs remote
 *   Pull requests  open, review the diff, comment, merge on the shared folder
 *   Activity   every push to the shared folder with who and when
 *   Settings   your name and the shared folder (local, network share, Google Drive, OneDrive)
 * ===================================================================================== */

type Tab = 'code' | 'history' | 'branches' | 'pulls' | 'activity' | 'settings';
type RemoteState = 'none' | 'prompt' | 'ready' | 'unsupported';

interface BranchRow {
  name: string;
  local: RefInfo | null;
  origin: RefInfo | null;
  head: Commit | null;
  vsOrigin: { ahead: number; behind: number } | null;
  vsMain: { ahead: number; behind: number } | null;
}

interface View {
  branch: string;
  head: Commit | null;
  status: StatusEntry[];
  work: Record<string, string>;
  branches: BranchRow[];
  merge: MergeState | null;
  fetchAt: string | null;
  vsOrigin: { ahead: number; behind: number } | null;
  originExists: boolean;
}

const EMPTY_VIEW: View = { branch: 'main', head: null, status: [], work: {}, branches: [], merge: null, fetchAt: null, vsOrigin: null, originExists: false };

/* ---------------------------------------------------------------- small helpers ---- */

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '');

function Time({ iso }: { iso?: string | null }) {
  return iso ? (
    <time dateTime={iso} title={when(iso)}>
      {ago(iso)}
    </time>
  ) : (
    <span className="muted">never</span>
  );
}

const STATE_MARK: Record<string, string> = { added: 'A', modified: 'M', deleted: 'D' };

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`rp-state ${state}`} title={state}>
      {STATE_MARK[state] ?? '?'}
    </span>
  );
}

function AheadBehind({ ab, of }: { ab: { ahead: number; behind: number } | null; of: string }) {
  if (!ab) return <span className="muted small">—</span>;
  if (!ab.ahead && !ab.behind) return <span className="rp-sync ok" title={`Same as ${of}`}>✓ in sync</span>;
  return (
    <span className="rp-sync" title={`${ab.ahead} commit(s) ${of} does not have, ${ab.behind} commit(s) only in ${of}`}>
      {ab.ahead > 0 && <span className="ahead">↑{ab.ahead}</span>}
      {ab.behind > 0 && <span className="behind">↓{ab.behind}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- read-only diff ---- */

const CONTEXT = 3;

/** Side-by-side diff of two versions of a procedure (same engine and colours as Compare). */
export function DiffBlock({ a, b, aLabel, bLabel }: { a: string | null; b: string | null; aLabel: string; bLabel: string }) {
  const rows = useMemo(() => computeRows(a ?? '', b ?? '', defaultOptions), [a, b]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  useEffect(() => setOpened(new Set()), [a, b]);

  // Show changed rows with a few lines of context; fold the long unchanged stretches.
  const pieces = useMemo(() => {
    const keep = rows.map((r) => r.kind !== 'equal');
    const show = rows.map((_, i) => {
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(rows.length - 1, i + CONTEXT); k++) if (keep[k]) return true;
      return false;
    });
    const out: ({ row: Row; i: number } | { fold: number; from: number; count: number })[] = [];
    for (let i = 0; i < rows.length; ) {
      if (show[i] || opened.has(i)) {
        out.push({ row: rows[i], i });
        i++;
        continue;
      }
      let j = i;
      while (j < rows.length && !show[j] && !opened.has(j)) j++;
      out.push({ fold: i, from: i, count: j - i });
      i = j;
    }
    return out;
  }, [rows, opened]);

  const cell = (r: Row, side: 'left' | 'right') => {
    const c = r[side];
    return (
      <>
        <span className={`no no-${side}`}>{c?.no ?? ''}</span>
        <code className={`code c-${side}${c ? '' : ' ghost'}`}>
          {!c ? ' ' : c.segs ? c.segs.map((s, k) => <span key={k} className={s.type === 'same' ? undefined : s.type}>{<SqlHighlight text={s.text} />}</span>) : c.text ? <SqlHighlight text={c.text} /> : ' '}
        </code>
      </>
    );
  };

  if (a === b) return <p className="rp-empty">No changes.</p>;
  return (
    <div className="rp-diff">
      <div className="rp-diff-head">
        <span className="del">{aLabel}</span>
        <span className="add">{bLabel}</span>
        <span className="muted small">
          {stats.blocks} change{stats.blocks === 1 ? '' : 's'} · layout-only differences hidden
        </span>
      </div>
      <div className="diff-body wrap" style={{ ['--code' as string]: 'minmax(0, 1fr)' }}>
        {stats.blocks === 0 && <p className="rp-empty">Only spaces / line breaks differ.</p>}
        {pieces.map((p) =>
          'fold' in p ? (
            <button
              key={`f${p.from}`}
              type="button"
              className="rp-fold"
              onClick={() =>
                setOpened((s) => {
                  const n = new Set(s);
                  for (let k = p.from; k < p.from + p.count; k++) n.add(k);
                  return n;
                })
              }
            >
              ⋯ {p.count} unchanged line{p.count === 1 ? '' : 's'}
            </button>
          ) : (
            <div key={p.i} className={`row ${p.row.kind}`}>
              {cell(p.row, 'left')}
              {cell(p.row, 'right')}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** List of changed files + the diff of the selected one, between two commits. */
function ChangeSet({ repo, from, to, fromLabel, toLabel, actions }: { repo: Repo; from: string | null; to: string | null; fromLabel: string; toLabel: string; actions?: (name: string) => ReactNode }) {
  const [files, setFiles] = useState<StatusEntry[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [texts, setTexts] = useState<{ a: string | null; b: string | null } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    setFiles(null);
    setErr('');
    repo
      .changes(from, to)
      .then((f) => {
        if (!live) return;
        setFiles(f);
        setSel(f[0]?.name ?? null);
      })
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [repo, from, to]);

  useEffect(() => {
    let live = true;
    setTexts(null);
    if (!sel) return;
    Promise.all([repo.fileAt(from, sel), repo.fileAt(to, sel)])
      .then(([a, b]) => live && setTexts({ a, b }))
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [repo, from, to, sel]);

  if (err) return <div className="dk-err">{err}</div>;
  if (!files) return <p className="rp-empty">Loading…</p>;
  if (!files.length) return <p className="rp-empty">No file changes.</p>;
  return (
    <div className="rp-changeset">
      <ul className="rp-files">
        {files.map((f) => (
          <li key={f.name}>
            <button type="button" className={sel === f.name ? 'on' : ''} onClick={() => setSel(f.name)}>
              <StateBadge state={f.state} /> {f.name}
            </button>
          </li>
        ))}
      </ul>
      {sel && (
        <div className="rp-filediff">
          <div className="rp-filebar">
            <strong>{sel}</strong>
            <span className="spacer" />
            {actions?.(sel)}
          </div>
          {texts ? <DiffBlock a={texts.a} b={texts.b} aLabel={fromLabel} bLabel={toLabel} /> : <p className="rp-empty">Loading…</p>}
        </div>
      )}
    </div>
  );
}

/* ================================================================== main ================ */

export default function RepoHub({ onBack, onOpenInCompare }: { onBack: () => void; onOpenInCompare?: (left: string, right: string, leftName: string, rightName: string) => void }) {
  const [tab, setTab] = usePersistentState<Tab>('rp-tab', 'code');
  const [user, setUser] = useState(() => localStorage.getItem('sprepo:user') ?? '');
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [remoteState, setRemoteState] = useState<RemoteState>(folderSupported() ? 'none' : 'unsupported');
  const [view, setView] = useState<View>(EMPTY_VIEW);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const local = useMemo(() => new IdbStore('default'), []);
  const remote = useMemo(() => (handle && remoteState === 'ready' ? new FolderStore(handle) : null), [handle, remoteState]);
  const repo = useMemo(() => new Repo(local, remote, user.trim() || 'unknown'), [local, remote, user]);

  const say = useCallback((kind: 'ok' | 'err' | 'info', text: string) => {
    setToast({ kind, text });
    if (kind !== 'err') window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 5000);
  }, []);

  /* ---------- load everything the screen shows ---------- */
  const refresh = useCallback(async () => {
    const branch = await repo.currentBranch();
    const head = await repo.headCommit();
    const [status, work, merge, localB, originB] = await Promise.all([repo.status(), repo.work(), repo.mergeState(), repo.branches(), repo.branches(repo.local, 'refs/remotes/origin')]);
    const names = [...new Set([...localB.map((b) => b.name), ...originB.map((b) => b.name)])].sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)));
    // Like GitHub: branches are compared with the team's main (origin/main) when there is one.
    const mainTip = (originB.find((b) => b.name === 'main') ?? localB.find((b) => b.name === 'main'))?.ref.commit ?? null;
    const branches: BranchRow[] = [];
    for (const n of names) {
      const l = localB.find((b) => b.name === n)?.ref ?? null;
      const o = originB.find((b) => b.name === n)?.ref ?? null;
      const tip = l?.commit ?? o?.commit ?? null;
      let headC: Commit | null = null;
      try {
        headC = tip ? await repo.commit(tip) : null;
      } catch {
        headC = null;
      }
      branches.push({
        name: n,
        local: l,
        origin: o,
        head: headC,
        vsOrigin: l && o ? await repo.aheadBehind(l.commit, o.commit).catch(() => null) : null,
        vsMain: tip && mainTip && n !== 'main' ? await repo.aheadBehind(tip, mainTip).catch(() => null) : null,
      });
    }
    const cur = branches.find((b) => b.name === branch);
    setView({
      branch,
      head,
      status,
      work,
      branches,
      merge,
      fetchAt: await repo.local.read('FETCH_AT'),
      vsOrigin: cur?.vsOrigin ?? null,
      originExists: !!cur?.origin,
    });
    setLoaded(true);
  }, [repo]);

  useEffect(() => {
    refresh().catch((e) => say('err', String(e.message ?? e)));
  }, [refresh, say]);

  /** Run an action with a busy label, show errors, refresh afterwards. */
  const act = useCallback(
    async (label: string, fn: () => Promise<string | void>) => {
      if (busy) return;
      setBusy(label);
      try {
        const msg = await fn();
        if (msg) say('ok', msg);
        else setToast(null);
      } catch (e) {
        say('err', e instanceof RepoError || e instanceof Error ? e.message : String(e));
      } finally {
        setBusy('');
        await refresh().catch(() => undefined);
      }
    },
    [busy, refresh, say],
  );

  /* ---------- shared folder ---------- */
  useEffect(() => {
    if (!folderSupported()) return;
    loadFolder().then(async (h) => {
      if (!h) return;
      setHandle(h);
      setRemoteState((await folderPermission(h, false)) === 'granted' ? 'ready' : 'prompt');
    });
  }, []);

  const connect = () =>
    act('Connecting', async () => {
      const h = await pickFolder();
      if ((await folderPermission(h, true)) !== 'granted') throw new RepoError('Permission to edit the folder was not given.');
      await saveFolder(h);
      setHandle(h);
      setRemoteState('ready');
      const r = new Repo(local, new FolderStore(h), user.trim() || 'unknown');
      const isRepo = await r.remote!.exists('sprepo.json');
      if (!isRepo) await r.initRemote(h.name);
      const f = await r.fetch();
      if (!(await r.headCommit()) && f.branches) {
        const st = await r.status();
        if (!st.length) await r.checkout((await r.branches(r.local, 'refs/remotes/origin')).find((b) => b.name === 'main')?.name ?? (await r.branches(r.local, 'refs/remotes/origin'))[0].name);
      }
      return isRepo ? `Connected to "${h.name}": ${f.branches} branch(es), ${f.commits} new commit(s) downloaded.` : `"${h.name}" is now an empty shared repository. Commit and push to fill it.`;
    });

  const reconnect = () =>
    act('Reconnecting', async () => {
      if (!handle) return;
      if ((await folderPermission(handle, true)) !== 'granted') throw new RepoError('Permission to edit the folder was not given.');
      setRemoteState('ready');
      return `Reconnected to "${handle.name}".`;
    });

  const disconnect = () =>
    act('Disconnecting', async () => {
      await saveFolder(null);
      setHandle(null);
      setRemoteState(folderSupported() ? 'none' : 'unsupported');
      return 'Shared folder disconnected. Your local copy is untouched.';
    });

  // Keep the remote view fresh: fetch when connected and every 2 minutes.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!remote) return;
    let stop = false;
    const tick = async () => {
      if (stop || busyRef.current) return;
      try {
        await repo.fetch();
        await refresh();
      } catch {
        /* offline / sync in progress: try again later */
      }
    };
    tick();
    const t = window.setInterval(tick, 120000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [remote, repo, refresh]);

  const needName = !user.trim();

  /* ---------- top bar ---------- */
  const tabBtn = (id: Tab, label: string, count?: number) => (
    <button type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
      {label}
      {!!count && <span className="count">{count}</span>}
    </button>
  );

  const ab = view.vsOrigin;
  const repoBar = (
    <div className="rp-bar">
      <label className="rp-branch">
        <span aria-hidden="true">⎇</span>
        <select
          value={view.branch}
          aria-label="Current branch"
          onChange={(e) => {
            const b = e.target.value;
            act(`Switching to ${b}`, async () => {
              await repo.checkout(b);
              return `Switched to ${b}.`;
            });
          }}
        >
          {view.branches.length === 0 && <option value={view.branch}>{view.branch}</option>}
          {view.branches.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
              {!b.local ? '  (on shared folder only)' : ''}
            </option>
          ))}
        </select>
      </label>
      <span className="rp-head" title={view.head ? `${view.head.id}\n${view.head.message}` : ''}>
        {view.head ? (
          <>
            <code>{shortId(view.head.id)}</code> {view.head.message.split('\n')[0]} · {view.head.author} · <Time iso={view.head.time} />
          </>
        ) : (
          <span className="muted">no commits yet</span>
        )}
      </span>
      <span className="spacer" />
      {view.status.length > 0 && (
        <button type="button" className="rp-chip warn" onClick={() => setTab('code')}>
          {view.status.length} uncommitted
        </button>
      )}
      {remote ? (
        <>
          <span className="rp-remote" title={`Shared folder: ${handle?.name}\nLast fetch: ${when(view.fetchAt)}`}>
            origin/{view.branch}: {view.originExists ? <AheadBehind ab={ab} of={`origin/${view.branch}`} /> : <span className="muted small">not pushed yet</span>}
          </span>
          <button type="button" disabled={!!busy} title={`Check the shared folder for new commits (last: ${ago(view.fetchAt)})`} onClick={() => act('Fetching', async () => {
            const f = await repo.fetch();
            return f.commits ? `${f.commits} new commit(s) downloaded.` : 'Already up to date with the shared folder.';
          })}>
            ⟳ Fetch
          </button>
          <button type="button" disabled={!!busy} title="Fetch and merge origin into your branch" onClick={() => act('Pulling', async () => {
            const r = await repo.pull();
            if (r.kind === 'conflict') {
              setTab('code');
              return `Pulled with ${r.conflicts.length} conflict(s). Resolve them in Code → Merge.`;
            }
            return r.kind === 'up-to-date' ? 'Already up to date.' : r.kind === 'fast-forward' ? 'Pulled: your branch is now up to date.' : 'Pulled and merged the team changes into your branch.';
          })}>
            ↓ Pull{ab?.behind ? ` (${ab.behind})` : ''}
          </button>
          <button type="button" className="primary" disabled={!!busy || needName} title={needName ? 'Set your name in Settings first' : `Upload ${view.branch} to the shared folder`} onClick={() => act('Pushing', async () => {
            const p = await repo.push();
            return `Pushed ${p.commits} commit(s) to origin/${p.branch} at ${new Date(p.at).toLocaleTimeString()}.`;
          })}>
            ↑ Push{ab?.ahead ? ` (${ab.ahead})` : !view.originExists && view.head ? ' (new)' : ''}
          </button>
        </>
      ) : remoteState === 'prompt' ? (
        <button type="button" className="rp-chip warn" onClick={reconnect}>
          Reconnect shared folder
        </button>
      ) : (
        <button type="button" className="rp-chip" onClick={() => setTab('settings')}>
          No shared folder · connect
        </button>
      )}
    </div>
  );

  return (
    <div className="app rp">
      <header className="topbar">
        <h1>SP Repo</h1>
        <nav aria-label="Repository">
          {tabBtn('code', 'Code', view.status.length + (view.merge ? view.merge.conflicts.length : 0))}
          {tabBtn('history', 'History')}
          {tabBtn('branches', 'Branches', view.branches.length)}
          {tabBtn('pulls', 'Pull requests')}
          {tabBtn('activity', 'Activity')}
          {tabBtn('settings', 'Settings')}
        </nav>
        <div className="spacer" />
        {busy && <span className="rp-busy">{busy}…</span>}
        <button type="button" onClick={onBack}>
          Back to compare
        </button>
      </header>
      {repoBar}
      {toast && (
        <div className={`rp-toast ${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          <button type="button" className="icon" onClick={() => setToast(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {needName && tab !== 'settings' && (
        <div className="rp-toast info">
          <span>Set your name once so commits and pushes show who made them.</span>
          <button type="button" onClick={() => setTab('settings')}>
            Settings
          </button>
        </div>
      )}
      <div className="dk-body">
        {!loaded ? (
          <p className="rp-empty">Opening repository…</p>
        ) : tab === 'code' ? (
          <CodeTab repo={repo} view={view} act={act} busy={!!busy} canPush={!!remote && !needName} onOpenInCompare={onOpenInCompare} onHistory={() => setTab('history')} refresh={refresh} />
        ) : tab === 'history' ? (
          <HistoryTab repo={repo} view={view} act={act} />
        ) : tab === 'branches' ? (
          <BranchesTab repo={repo} view={view} act={act} hasRemote={!!remote} onNewPr={() => setTab('pulls')} />
        ) : tab === 'pulls' ? (
          remote ? <PullsTab repo={repo} view={view} act={act} /> : <NeedRemote state={remoteState} onConnect={connect} onReconnect={reconnect} />
        ) : tab === 'activity' ? (
          remote ? <ActivityTab repo={repo} view={view} /> : <NeedRemote state={remoteState} onConnect={connect} onReconnect={reconnect} />
        ) : (
          <SettingsTab
            user={user}
            setUser={(u) => {
              setUser(u);
              localStorage.setItem('sprepo:user', u);
            }}
            handle={handle}
            remoteState={remoteState}
            onConnect={connect}
            onReconnect={reconnect}
            onDisconnect={disconnect}
            act={act}
            local={local}
            repo={repo}
          />
        )}
      </div>
    </div>
  );
}

type Act = (label: string, fn: () => Promise<string | void>) => Promise<void>;

function NeedRemote({ state, onConnect, onReconnect }: { state: RemoteState; onConnect: () => void; onReconnect: () => void }) {
  return (
    <div className="rp-center">
      <h2>Connect the shared folder</h2>
      <p>Pull requests and the push activity live in the shared folder (the team "remote").</p>
      {state === 'prompt' ? (
        <button type="button" className="primary" onClick={onReconnect}>
          Reconnect shared folder
        </button>
      ) : state === 'unsupported' ? (
        <p className="dk-err">This browser cannot open folders. Use Chrome or Edge.</p>
      ) : (
        <button type="button" className="primary" onClick={onConnect}>
          Choose shared folder…
        </button>
      )}
    </div>
  );
}

/* ================================================================== Code tab ============ */

function CodeTab({ repo, view, act, busy, canPush, onOpenInCompare, onHistory, refresh }: { repo: Repo; view: View; act: Act; busy: boolean; canPush: boolean; onOpenInCompare?: (l: string, r: string, ln: string, rn: string) => void; onHistory: () => void; refresh: () => Promise<void> }) {
  const [sel, setSel] = usePersistentState<string | null>('rp-sel', null);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'edit' | 'changes'>('edit');
  const [draft, setDraft] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [headText, setHeadText] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Record<string, string | null>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number>();

  const names = useMemo(() => {
    const deleted = view.status.filter((s) => s.state === 'deleted').map((s) => s.name);
    return [...new Set([...Object.keys(view.work), ...deleted])].sort((a, b) => a.localeCompare(b));
  }, [view.work, view.status]);
  const stateOf = useMemo(() => new Map(view.status.map((s) => [s.name, s.state])), [view.status]);
  const conflictOf = useMemo(() => new Map((view.merge?.conflicts ?? []).map((c) => [c.name, c])), [view.merge]);

  useEffect(() => {
    if (sel && !names.includes(sel)) setSel(names[0] ?? null);
    if (!sel && names.length) setSel(names[0]);
  }, [names, sel, setSel]);

  // Text of the selected file: the editor keeps a draft so typing never waits on storage.
  useEffect(() => setDraft(null), [sel]);
  const text = draft ?? (sel ? view.work[sel] ?? null : null);

  useEffect(() => {
    let live = true;
    const id = sel ? view.head?.tree[sel] : undefined;
    if (!id || !sel) {
      setHeadText(null);
      return;
    }
    repo.blob(id).then((t) => live && setHeadText(t)).catch(() => live && setHeadText(null));
    return () => {
      live = false;
    };
  }, [repo, sel, view.head]);

  // Typing is saved to the working copy half a second after the last key (and when you leave the file).
  const pending = useRef<{ name: string; text: string } | null>(null);
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    pending.current = null;
    if (p) repo.saveWork(p.name, p.text).then(refresh, refresh);
  }, [repo, refresh]);
  const onEdit = (v: string) => {
    setDraft(v);
    if (!sel) return;
    pending.current = { name: sel, text: v };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 500);
  };
  useEffect(() => flush, [sel, flush]);

  const changed = view.status;
  const chosen = picked ?? new Set(changed.map((c) => c.name));
  useEffect(() => setPicked(null), [view.status.length, view.head?.id]);

  const addFiles = async (files: { name: string; text: string }[]) =>
    act('Adding', async () => {
      const added: string[] = [];
      for (const f of files) {
        const name = detectName(f.text) ?? f.name.replace(/\.sql$/i, '');
        const existing = Object.keys(view.work).find((n) => n.toLowerCase() === name.toLowerCase());
        await repo.saveWork(existing ?? name, f.text);
        added.push(existing ?? name);
      }
      if (added.length) setSel(added[0]);
      return `${added.length} file(s) put in your working copy: ${added.slice(0, 5).join(', ')}${added.length > 5 ? '…' : ''}. Commit to keep them.`;
    });

  const readFiles = async (list: FileList | File[]) => {
    const files = await Promise.all(Array.from(list).filter((f) => /\.(sql|txt)$/i.test(f.name) || !f.name.includes('.')).map(async (f) => ({ name: f.name, text: await f.text() })));
    if (files.length) addFiles(files);
  };

  const merge = view.merge;
  const resolvedAll = merge ? merge.conflicts.every((c) => c.name in resolution) : false;

  const filesPane = (
    <div
      className={`rp-filelist${dragOver ? ' drop' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        readFiles(e.dataTransfer.files);
      }}
    >
      <input type="search" placeholder="Filter procedures" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter procedures" />
      {names.length === 0 && <p className="rp-empty">No procedures yet. Use “+ Add” to paste one, or drop .sql files here.</p>}
      <ul className="rp-files">
        {names
          .filter((n) => !filter.trim() || n.toLowerCase().includes(filter.trim().toLowerCase()))
          .map((n) => {
            const st = stateOf.get(n);
            return (
              <li key={n}>
                <button type="button" className={`${sel === n ? 'on' : ''}${st === 'deleted' ? ' gone' : ''}`} onClick={() => setSel(n)} title={st ? `${n} (${st})` : n}>
                  {conflictOf.has(n) ? <span className="rp-state conflict">!</span> : st ? <StateBadge state={st} /> : <span className="rp-state none" />}
                  <span className="rp-fname">{n}</span>
                </button>
              </li>
            );
          })}
      </ul>
      <p className="muted small rp-drop-hint">Drop .sql files here to add or update them.</p>
    </div>
  );

  const editorPane = adding ? (
    <AddSp
      onCancel={() => setAdding(false)}
      onAdd={(name, t) => {
        setAdding(false);
        addFiles([{ name, text: t }]);
      }}
    />
  ) : !sel ? (
    <p className="rp-empty">Pick a procedure on the left, or add one.</p>
  ) : conflictOf.has(sel) ? (
    <ConflictEditor
      conflict={conflictOf.get(sel)!}
      label={merge!.label}
      branch={view.branch}
      value={resolution[sel]}
      onResolve={(v) => setResolution((r) => ({ ...r, [sel]: v }))}
    />
  ) : stateOf.get(sel) === 'deleted' ? (
    <div className="rp-center">
      <p>
        <strong>{sel}</strong> is deleted in your working copy. Commit to delete it from the branch.
      </p>
      <button type="button" onClick={() => act('Restoring', async () => repo.discard([sel]))}>
        Undo delete
      </button>
    </div>
  ) : mode === 'changes' ? (
    <DiffBlock a={headText} b={text} aLabel={`${view.branch} (last commit)`} bLabel="your working copy" />
  ) : (
    <CodeArea value={text ?? ''} onChange={onEdit} ariaLabel={`Edit ${sel}`} className="rp-editor" />
  );

  const editorActions = sel && !adding && !conflictOf.has(sel) && stateOf.get(sel) !== 'deleted' && (
    <>
      <div className="dk-tabs" role="tablist">
        <button type="button" className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
          Edit
        </button>
        <button type="button" className={mode === 'changes' ? 'on' : ''} onClick={() => setMode('changes')} disabled={!stateOf.get(sel)}>
          Changes
        </button>
      </div>
      {onOpenInCompare && headText !== null && (
        <button type="button" title="Open last commit vs working copy in the full Compare screen" onClick={() => onOpenInCompare(headText, text ?? '', `${sel} @ ${view.branch}`, `${sel} (working copy)`)}>
          Compare
        </button>
      )}
      <button type="button" title="Download this procedure" onClick={() => downloadText(`${sel}.sql`, text ?? '')}>
        ⤓
      </button>
      {stateOf.get(sel) && (
        <button type="button" title="Throw away your changes to this file" onClick={() => confirm(`Discard your changes to ${sel}?`) && act('Discarding', async () => repo.discard([sel]))}>
          Discard
        </button>
      )}
      <button type="button" title="Delete this procedure (commit to make it final)" onClick={() => confirm(`Delete ${sel} from your working copy?`) && act('Deleting', async () => repo.deleteWork(sel))}>
        🗑
      </button>
    </>
  );

  const commitPane = merge ? (
    <div className="rp-commit">
      <div className="rp-merge-box">
        <strong>Merging {merge.label} into {view.branch}</strong>
        <p className="small">
          {merge.conflicts.length} file(s) were changed on both sides. Open each one, pick a version or edit the result, then commit the merge.
        </p>
        <ul className="rp-files">
          {merge.conflicts.map((c) => (
            <li key={c.name}>
              <button type="button" className={sel === c.name ? 'on' : ''} onClick={() => setSel(c.name)}>
                <span className={`rp-state ${c.name in resolution ? 'added' : 'conflict'}`}>{c.name in resolution ? '✓' : '!'}</span> {c.name}
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="primary"
          disabled={!resolvedAll || busy}
          onClick={() =>
            act('Committing merge', async () => {
              const c = await repo.finishMerge(resolution, msg);
              setResolution({});
              setMsg('');
              return `Merge committed (${shortId(c.id)}).${canPush ? ' Push to share it.' : ''}`;
            })
          }
        >
          Commit merge
        </button>
        <button type="button" onClick={() => confirm('Abort the merge and go back to your last commit?') && act('Aborting merge', async () => (setResolution({}), repo.abortMerge()))}>
          Abort merge
        </button>
      </div>
    </div>
  ) : (
    <div className="rp-commit">
      {changed.length === 0 ? (
        <p className="rp-empty">Nothing to commit. Your working copy matches the last commit on {view.branch}.</p>
      ) : (
        <>
          <div className="rp-commit-head">
            <label className="dk-chk">
              <input
                type="checkbox"
                checked={chosen.size === changed.length}
                onChange={(e) => setPicked(e.target.checked ? null : new Set())}
              />
              {chosen.size} of {changed.length} change(s) selected
            </label>
          </div>
          <ul className="rp-files">
            {changed.map((c) => (
              <li key={c.name}>
                <label className={sel === c.name ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={chosen.has(c.name)}
                    onChange={(e) => {
                      const n = new Set(chosen);
                      if (e.target.checked) n.add(c.name);
                      else n.delete(c.name);
                      setPicked(n);
                    }}
                  />
                  <StateBadge state={c.state} />
                  <button type="button" className="link rp-fname" onClick={() => setSel(c.name)}>
                    {c.name}
                  </button>
                </label>
              </li>
            ))}
          </ul>
          <textarea className="rp-msg" placeholder="Commit message (what and why), e.g. “Add IsMultiSelect to report parameters”" value={msg} onChange={(e) => setMsg(e.target.value)} />
          <div className="rp-commit-btns">
            <button
              type="button"
              className="primary"
              disabled={busy || !msg.trim() || chosen.size === 0}
              onClick={() =>
                act('Committing', async () => {
                  const c = await repo.commitChanges(msg, [...chosen]);
                  setMsg('');
                  return `Committed ${shortId(c.id)} to ${view.branch}.`;
                })
              }
            >
              Commit to {view.branch}
            </button>
            {canPush && (
              <button
                type="button"
                disabled={busy || !msg.trim() || chosen.size === 0}
                onClick={() =>
                  act('Committing and pushing', async () => {
                    const c = await repo.commitChanges(msg, [...chosen]);
                    setMsg('');
                    const p = await repo.push();
                    return `Committed ${shortId(c.id)} and pushed ${p.commits} commit(s) to origin/${p.branch}.`;
                  })
                }
              >
                Commit &amp; Push
              </button>
            )}
            <button type="button" className="link" onClick={() => confirm('Discard ALL uncommitted changes?') && act('Discarding', async () => repo.discard())}>
              Discard all
            </button>
          </div>
        </>
      )}
      <button type="button" className="link rp-hist-link" onClick={onHistory}>
        View history of {view.branch} →
      </button>
    </div>
  );

  return (
    <Panes
      id="rp-code"
      panes={[
        {
          id: 'files',
          title: (
            <>
              Procedures <span className="muted small">{names.length || ''}</span>
            </>
          ),
          size: 2,
          minPx: 220,
          fill: true,
          actions: (
            <>
              <button type="button" onClick={() => setAdding(true)} title="Paste a new procedure">
                + Add
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} title="Upload .sql files">
                ⤒ Upload
              </button>
              <input ref={fileRef} type="file" accept=".sql,.txt" multiple hidden onChange={(e) => e.target.files && readFiles(e.target.files)} />
            </>
          ),
          body: filesPane,
        },
        {
          id: 'editor',
          title: adding ? 'Add procedure' : sel ?? 'Editor',
          size: 6,
          minPx: 360,
          fill: true,
          actions: editorActions,
          body: editorPane,
        },
        {
          id: 'commit',
          title: merge ? 'Merge' : 'Commit',
          size: 2.5,
          minPx: 260,
          fill: true,
          body: commitPane,
        },
      ]}
    />
  );
}

function AddSp({ onAdd, onCancel }: { onAdd: (name: string, text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const detected = useMemo(() => detectName(text), [text]);
  const final = name.trim() || detected || '';
  return (
    <div className="rp-add">
      <p className="dk-cap">Paste the procedure (CREATE / ALTER PROCEDURE …). The name is read from the script.</p>
      <CodeArea value={text} onChange={setText} placeholder="CREATE PROCEDURE dbo.usp_Example AS ..." ariaLabel="New procedure" />
      <div className="rp-add-bar">
        <label>
          Name <input type="text" value={name} placeholder={detected ?? 'dbo.usp_Name'} onChange={(e) => setName(e.target.value)} />
        </label>
        <span className="spacer" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!text.trim() || !final} onClick={() => onAdd(final, text)}>
          Add to working copy
        </button>
      </div>
    </div>
  );
}

function ConflictEditor({ conflict, label, branch, value, onResolve }: { conflict: Conflict; label: string; branch: string; value: string | null | undefined; onResolve: (v: string | null) => void }) {
  const [mode, setMode] = useState<'diff' | 'edit'>('diff');
  const resolved = value !== undefined;
  return (
    <div className="rp-conflict">
      <div className="rp-conflict-bar">
        <span className="rp-state conflict">!</span>
        <span>
          Changed in <strong>{branch}</strong> (yours) and in <strong>{label}</strong> (theirs).
        </span>
        <span className="spacer" />
        <button type="button" className={value === conflict.ours && resolved ? 'primary' : ''} onClick={() => onResolve(conflict.ours)}>
          Use mine
        </button>
        <button type="button" className={value === conflict.theirs && resolved ? 'primary' : ''} onClick={() => onResolve(conflict.theirs)}>
          Use theirs
        </button>
        <button
          type="button"
          className={mode === 'edit' ? 'primary' : ''}
          onClick={() => {
            if (!resolved) onResolve(conflict.ours ?? conflict.theirs ?? '');
            setMode('edit');
          }}
        >
          Edit result
        </button>
        {mode === 'edit' && (
          <button type="button" onClick={() => setMode('diff')}>
            Show diff
          </button>
        )}
      </div>
      {resolved && <p className="rp-ok small">✓ Resolved{value === null ? ' (file will be deleted)' : value === conflict.ours ? ' with your version' : value === conflict.theirs ? ' with their version' : ' with your edit'}.</p>}
      {mode === 'edit' ? (
        <CodeArea value={value ?? ''} onChange={(v) => onResolve(v)} ariaLabel="Merged result" className="rp-editor" />
      ) : (
        <DiffBlock a={conflict.ours} b={conflict.theirs} aLabel={`mine (${branch})`} bLabel={`theirs (${label})`} />
      )}
    </div>
  );
}

/* ================================================================== History tab ========= */

function HistoryTab({ repo, view, act }: { repo: Repo; view: View; act: Act }) {
  const [ref, setRef] = useState(view.branch);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [fileFilter, setFileFilter] = useState('');
  const [compare, setCompare] = useState<{ base: string; head: string } | null>(null);
  const [cmpBase, setCmpBase] = useState('main');
  const [cmpHead, setCmpHead] = useState(view.branch);

  const refs = useMemo(() => {
    const out: string[] = [];
    view.branches.forEach((b) => {
      if (b.local) out.push(b.name);
      if (b.origin) out.push(`origin/${b.name}`);
    });
    return out.length ? out : [view.branch];
  }, [view.branches, view.branch]);

  useEffect(() => {
    let live = true;
    setCommits(null);
    repo
      .resolve(ref)
      .then((id) => repo.log(id, 500))
      .then((l) => {
        if (!live) return;
        setCommits(l);
        setSel((s) => (s && l.some((c) => c.id === s) ? s : l[0]?.id ?? null));
      })
      .catch(() => live && setCommits([]));
    return () => {
      live = false;
    };
  }, [repo, ref, view.head?.id]);

  // Commits that touched a file (when filtering by file name)
  const [touching, setTouching] = useState<Set<string> | null>(null);
  useEffect(() => {
    let live = true;
    const f = fileFilter.trim().toLowerCase();
    if (!f || !commits) {
      setTouching(null);
      return;
    }
    (async () => {
      const s = new Set<string>();
      for (const c of commits) {
        const parent = c.parents[0] ?? null;
        const ch = await repo.changes(parent, c.id);
        if (ch.some((x) => x.name.toLowerCase().includes(f))) s.add(c.id);
      }
      if (live) setTouching(s);
    })();
    return () => {
      live = false;
    };
  }, [repo, commits, fileFilter]);

  const current = commits?.find((c) => c.id === sel) ?? null;
  const shown = (commits ?? []).filter((c) => !touching || touching.has(c.id));

  return (
    <Panes
      id="rp-history"
      panes={[
        {
          id: 'log',
          title: 'Commits',
          size: 3,
          minPx: 300,
          fill: true,
          actions: (
            <select value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Branch to show">
              {refs.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ),
          body: (
            <div className="rp-log">
              <input type="search" placeholder="Only commits that changed… (procedure name)" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} aria-label="Filter by procedure" />
              <div className="rp-compare-form">
                <span className="small muted">Compare</span>
                <select value={cmpBase} onChange={(e) => setCmpBase(e.target.value)} aria-label="Base">
                  {refs.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <span>…</span>
                <select value={cmpHead} onChange={(e) => setCmpHead(e.target.value)} aria-label="Compare to">
                  {refs.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    const [b, h] = await Promise.all([repo.resolve(cmpBase), repo.resolve(cmpHead)]);
                    if (b && h) setCompare({ base: b, head: h });
                  }}
                >
                  Go
                </button>
              </div>
              {!commits ? (
                <p className="rp-empty">Loading…</p>
              ) : !shown.length ? (
                <p className="rp-empty">No commits{touching ? ' touching that procedure' : ''}.</p>
              ) : (
                <ol className="rp-commits">
                  {shown.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={sel === c.id && !compare ? 'on' : ''}
                        onClick={() => {
                          setSel(c.id);
                          setCompare(null);
                        }}
                      >
                        <span className="rp-msg1">
                          {c.parents.length > 1 && <span className="rp-tag">merge</span>}
                          {c.message.split('\n')[0]}
                        </span>
                        <span className="rp-meta">
                          <code>{shortId(c.id)}</code> · {c.author} · <Time iso={c.time} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ),
        },
        {
          id: 'detail',
          title: compare ? 'Compare' : 'Commit',
          size: 7,
          minPx: 400,
          fill: true,
          body: compare ? (
            <div className="rp-detail">
              <div className="rp-detail-head">
                <h2>
                  {cmpBase} … {cmpHead}
                </h2>
                <CompareSummary repo={repo} base={compare.base} head={compare.head} />
              </div>
              <ChangeSet repo={repo} from={compare.base} to={compare.head} fromLabel={cmpBase} toLabel={cmpHead} />
            </div>
          ) : current ? (
            <div className="rp-detail">
              <div className="rp-detail-head">
                <h2>{current.message.split('\n')[0]}</h2>
                {current.message.includes('\n') && <pre className="rp-body">{current.message.split('\n').slice(1).join('\n').trim()}</pre>}
                <p className="small">
                  <strong>{current.author}</strong> committed {when(current.time)} · <code title={current.id}>{shortId(current.id)}</code>
                  {current.parents.length > 0 && (
                    <>
                      {' '}
                      · parent{current.parents.length > 1 ? 's' : ''}{' '}
                      {current.parents.map((p) => (
                        <code key={p}>{shortId(p)} </code>
                      ))}
                    </>
                  )}
                </p>
                <div className="rp-row-btns">
                  <button
                    type="button"
                    onClick={() => {
                      const name = prompt('New branch name (starts at this commit):', 'feature/');
                      if (name) act('Creating branch', async () => (await repo.createBranch(name.trim(), current.id), `Branch ${name} created at ${shortId(current.id)} and checked out.`));
                    }}
                  >
                    Branch from here
                  </button>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(current.id)}>
                    Copy id
                  </button>
                </div>
              </div>
              <ChangeSet
                repo={repo}
                from={current.parents[0] ?? null}
                to={current.id}
                fromLabel={current.parents[0] ? `before (${shortId(current.parents[0])})` : 'nothing'}
                toLabel={`after (${shortId(current.id)})`}
                actions={(name) => (
                  <>
                    <button
                      type="button"
                      title="Put this version of the procedure into your working copy"
                      onClick={() => act('Restoring', async () => (await repo.restoreFile(current.id, name), `${name} at ${shortId(current.id)} is now in your working copy. Commit it to make it the latest.`))}
                    >
                      Restore this version
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const t = await repo.fileAt(current.id, name);
                        downloadText(`${name}@${shortId(current.id)}.sql`, t ?? '');
                      }}
                    >
                      ⤓
                    </button>
                  </>
                )}
              />
            </div>
          ) : (
            <p className="rp-empty">No commits yet. Commit something in Code.</p>
          ),
        },
      ]}
    />
  );
}

function CompareSummary({ repo, base, head }: { repo: Repo; base: string; head: string }) {
  const [ab, setAb] = useState<{ ahead: number; behind: number } | null>(null);
  useEffect(() => {
    repo.aheadBehind(head, base).then(setAb).catch(() => setAb(null));
  }, [repo, base, head]);
  return ab ? (
    <p className="small">
      The right side has <strong>{ab.ahead}</strong> commit(s) the left does not, and is missing <strong>{ab.behind}</strong>.
    </p>
  ) : null;
}

/* ================================================================== Branches tab ======== */

function BranchesTab({ repo, view, act, hasRemote, onNewPr }: { repo: Repo; view: View; act: Act; hasRemote: boolean; onNewPr: () => void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(view.branch);
  const valid = BRANCH_RE.test(name.trim());
  return (
    <div className="rp-page">
      <div className="rp-card rp-newbranch">
        <strong>New branch</strong>
        <input type="text" value={name} placeholder="feature/report-multiselect" onChange={(e) => setName(e.target.value)} aria-label="Branch name" />
        <span>from</span>
        <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start from">
          {view.branches.map((b) => (
            <option key={b.name} value={b.local ? b.name : `origin/${b.name}`}>
              {b.local ? b.name : `origin/${b.name}`}
            </option>
          ))}
        </select>
        <button type="button" className="primary" disabled={!valid} onClick={() => act('Creating branch', async () => (await repo.createBranch(name.trim(), from), setName(''), `Branch ${name.trim()} created and checked out.`))}>
          Create &amp; switch
        </button>
        {name && !valid && <span className="small rp-bad">Use letters, digits, . _ - and / only.</span>}
      </div>

      <table className="rp-table">
        <thead>
          <tr>
            <th>Branch</th>
            <th>Last commit</th>
            <th title="Compared with main on the shared folder (origin/main), or your main when nothing is shared yet">vs main</th>
            <th title="Your copy compared with the shared folder">vs shared folder</th>
            <th>Last push</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {view.branches.map((b) => {
            const isCur = b.name === view.branch;
            return (
              <tr key={b.name} className={isCur ? 'cur' : ''}>
                <td>
                  <span className="rp-bname">⎇ {b.name}</span>
                  {isCur && <span className="rp-tag cur">current</span>}
                  {!b.local && <span className="rp-tag">shared only</span>}
                  {b.local && !b.origin && hasRemote && <span className="rp-tag">not pushed</span>}
                </td>
                <td>
                  {b.head ? (
                    <>
                      <span className="rp-msg1">{b.head.message.split('\n')[0]}</span>
                      <span className="rp-meta">
                        <code>{shortId(b.head.id)}</code> · {b.head.author} · <Time iso={b.head.time} />
                      </span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{b.name === 'main' ? <span className="muted small">default</span> : <AheadBehind ab={b.vsMain} of="main" />}</td>
                <td>{b.local && b.origin ? <AheadBehind ab={b.vsOrigin} of={`origin/${b.name}`} /> : <span className="muted small">—</span>}</td>
                <td>{b.origin ? <span className="small">{b.origin.by} · <Time iso={b.origin.at} /></span> : <span className="muted small">never</span>}</td>
                <td>
                  <div className="rp-row-btns">
                  {!isCur && (
                    <button type="button" onClick={() => act(`Switching to ${b.name}`, async () => (await repo.checkout(b.name), `Switched to ${b.name}.`))}>
                      Switch
                    </button>
                  )}
                  {!isCur && (
                    <button
                      type="button"
                      title={`Merge ${b.local ? b.name : `origin/${b.name}`} into ${view.branch}`}
                      onClick={() =>
                        act('Merging', async () => {
                          const spec = b.local ? b.name : `origin/${b.name}`;
                          const r = await repo.merge(spec, spec);
                          return r.kind === 'conflict'
                            ? `${r.conflicts.length} conflict(s). Resolve them in Code.`
                            : r.kind === 'up-to-date'
                              ? `${view.branch} already contains ${spec}.`
                              : `Merged ${spec} into ${view.branch}.`;
                        })
                      }
                    >
                      Merge into {view.branch}
                    </button>
                  )}
                  {hasRemote && b.local && (!b.origin || b.vsOrigin?.ahead) ? (
                    <button type="button" onClick={() => act('Pushing', async () => {
                      const p = await repo.push(b.name);
                      return `Pushed ${p.commits} commit(s) to origin/${p.branch}.`;
                    })}>
                      Push
                    </button>
                  ) : null}
                  {hasRemote && b.origin && b.name !== 'main' && (
                    <button type="button" onClick={onNewPr} title="Open a pull request for this branch">
                      PR
                    </button>
                  )}
                  {b.local && !isCur && b.name !== 'main' && (
                    <button type="button" title="Delete your local branch" onClick={() => confirm(`Delete local branch ${b.name}?`) && act('Deleting', async () => (await repo.deleteBranch(b.name), `Deleted local branch ${b.name}.`))}>
                      🗑
                    </button>
                  )}
                  {hasRemote && b.origin && b.name !== 'main' && (
                    <button type="button" title="Delete the branch from the shared folder for everyone" onClick={() => confirm(`Delete origin/${b.name} from the shared folder for everyone?`) && act('Deleting', async () => (await repo.deleteRemoteBranch(b.name), `Deleted origin/${b.name}.`))}>
                      🗑 shared
                    </button>
                  )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {view.branches.length === 0 && <p className="rp-empty">No branches yet. Your first commit creates “{view.branch}”.</p>}
    </div>
  );
}

/* ================================================================== Pull requests ======= */

function PullsTab({ repo, view, act }: { repo: Repo; view: View; act: Act }) {
  const [prs, setPrs] = useState<PullRequest[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'merged' | 'closed' | 'all'>('open');
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    repo
      .pullRequests()
      .then((p) => live && setPrs(p))
      .catch(() => live && setPrs([]));
    return () => {
      live = false;
    };
  }, [repo, tick, view.fetchAt]);

  const remoteBranches = view.branches.filter((b) => b.origin).map((b) => b.name);
  const list = (prs ?? []).filter((p) => filter === 'all' || p.status === filter);
  const number = (p: PullRequest) => (prs ? prs.length - prs.indexOf(p) : 0);
  const current = prs?.find((p) => p.id === sel) ?? null;
  const reload = () => setTick((t) => t + 1);

  return (
    <Panes
      id="rp-pulls"
      panes={[
        {
          id: 'list',
          title: 'Pull requests',
          size: 3,
          minPx: 300,
          fill: true,
          actions: (
            <button type="button" className="primary" onClick={() => setCreating(true)}>
              New
            </button>
          ),
          body: (
            <div className="rp-log">
              <div className="dk-tabs">
                {(['open', 'merged', 'closed', 'all'] as const).map((f) => (
                  <button key={f} type="button" className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                    {f}
                    <span className="count">{(prs ?? []).filter((p) => f === 'all' || p.status === f).length}</span>
                  </button>
                ))}
              </div>
              {!prs ? (
                <p className="rp-empty">Loading…</p>
              ) : !list.length ? (
                <p className="rp-empty">No {filter === 'all' ? '' : filter} pull requests.</p>
              ) : (
                <ol className="rp-commits">
                  {list.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        className={sel === p.id && !creating ? 'on' : ''}
                        onClick={() => {
                          setSel(p.id);
                          setCreating(false);
                        }}
                      >
                        <span className="rp-msg1">
                          <span className={`rp-pr ${p.status}`}>{p.status}</span> #{number(p)} {p.title}
                        </span>
                        <span className="rp-meta">
                          {p.from} → {p.to} · {p.author} · <Time iso={p.createdAt} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ),
        },
        {
          id: 'pr',
          title: creating ? 'New pull request' : current ? `#${number(current)}` : 'Pull request',
          size: 7,
          minPx: 420,
          fill: true,
          body: creating ? (
            <NewPr
              repo={repo}
              branches={remoteBranches}
              current={view.branch}
              onCancel={() => setCreating(false)}
              onCreate={(title, body, from, to) =>
                act('Creating pull request', async () => {
                  const pr = await repo.createPullRequest(title, body, from, to);
                  setCreating(false);
                  setSel(pr.id);
                  reload();
                  return `Pull request "${pr.title}" opened.`;
                })
              }
            />
          ) : current ? (
            <PrDetail key={current.id} repo={repo} pr={current} n={number(current)} act={act} onChanged={reload} />
          ) : (
            <p className="rp-empty">Pick a pull request, or click New to ask the team to review a branch before it goes into main.</p>
          ),
        },
      ]}
    />
  );
}

function NewPr({ repo, branches, current, onCreate, onCancel }: { repo: Repo; branches: string[]; current: string; onCreate: (t: string, b: string, from: string, to: string) => void; onCancel: () => void }) {
  const [from, setFrom] = useState(branches.includes(current) && current !== 'main' ? current : branches.find((b) => b !== 'main') ?? '');
  const [to, setTo] = useState(branches.includes('main') ? 'main' : branches[0] ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ids, setIds] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  useEffect(() => {
    Promise.all([repo.resolve(`origin/${to}`), repo.resolve(`origin/${from}`)]).then(([a, b]) => setIds({ a, b }));
  }, [repo, from, to]);
  if (branches.length < 2) return <p className="rp-empty">Push at least two branches to the shared folder first (e.g. main and a feature branch).</p>;
  return (
    <div className="rp-detail">
      <div className="rp-card rp-newpr">
        <label>
          Merge <select value={from} onChange={(e) => setFrom(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        <label>
          into <select value={to} onChange={(e) => setTo(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select>
        </label>
        <input type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        <textarea placeholder="What changed and why. Mention the procedures and how you tested them." value={body} onChange={(e) => setBody(e.target.value)} aria-label="Description" />
        <div className="rp-row-btns">
          <button type="button" className="primary" disabled={!title.trim() || from === to} onClick={() => onCreate(title, body, from, to)}>
            Open pull request
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      {ids.a && ids.b && <PrFiles repo={repo} toId={ids.a} fromId={ids.b} from={from} to={to} />}
    </div>
  );
}

/** Files changed by a branch since it split from the target (what the PR would bring in). */
function PrFiles({ repo, toId, fromId, from, to }: { repo: Repo; toId: string; fromId: string; from: string; to: string }) {
  const [base, setBase] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    repo.mergeBase(fromId, toId).then(setBase).catch(() => setBase(null));
  }, [repo, fromId, toId]);
  if (base === undefined) return <p className="rp-empty">Loading…</p>;
  return <ChangeSet repo={repo} from={base} to={fromId} fromLabel={`${to} (where ${from} started)`} toLabel={from} />;
}

function PrDetail({ repo, pr, n, act, onChanged }: { repo: Repo; pr: PullRequest; n: number; act: Act; onChanged: () => void }) {
  const [check, setCheck] = useState<Awaited<ReturnType<Repo['prCheck']>> | null>(null);
  const [comments, setComments] = useState<PrComment[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [ids, setIds] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [text, setText] = useState('');
  const [view, setView] = useState<'conversation' | 'commits' | 'files'>('conversation');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const c = await repo.prCheck(pr).catch(() => null);
      const from = await repo.resolve(`origin/${pr.from}`);
      const to = await repo.resolve(`origin/${pr.to}`);
      const cs = from ? await repo.log(from, 300) : [];
      const toSet = await repo.ancestors(to);
      const cm = await repo.comments(pr.id).catch(() => []);
      if (!live) return;
      setCheck(c);
      setIds({ from, to });
      setCommits(pr.status === 'merged' ? cs.slice(0, 0) : cs.filter((x) => !toSet.has(x.id)));
      setComments(cm);
    })();
    return () => {
      live = false;
    };
  }, [repo, pr, tick]);

  const merge = () =>
    act('Merging pull request', async () => {
      const id = await repo.mergePullRequest(pr);
      onChanged();
      setTick((t) => t + 1);
      return `Merged into ${pr.to} (${shortId(id)}). Everyone gets it on their next pull.`;
    });

  return (
    <div className="rp-detail">
      <div className="rp-detail-head">
        <h2>
          {pr.title} <span className="muted">#{n}</span>
        </h2>
        <p className="small">
          <span className={`rp-pr ${pr.status}`}>{pr.status}</span> <strong>{pr.author}</strong> wants to merge <code>{pr.from}</code> into <code>{pr.to}</code> · opened {when(pr.createdAt)}
          {pr.status === 'merged' && (
            <>
              {' '}
              · merged by <strong>{pr.mergedBy}</strong> {when(pr.mergedAt)}
            </>
          )}
          {pr.status === 'closed' && (
            <>
              {' '}
              · closed by {pr.closedBy} {when(pr.closedAt)}
            </>
          )}
        </p>
        <div className="dk-tabs">
          {(['conversation', 'commits', 'files'] as const).map((v) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'conversation' ? `Conversation (${comments.length})` : v === 'commits' ? `Commits (${commits.length})` : 'Files changed'}
            </button>
          ))}
        </div>
      </div>

      {view === 'conversation' && (
        <div className="rp-convo">
          {pr.body && (
            <div className="rp-comment">
              <div className="rp-comment-head">
                <strong>{pr.author}</strong> <Time iso={pr.createdAt} />
              </div>
              <pre>{pr.body}</pre>
            </div>
          )}
          {comments.map((c) => (
            <div key={c.id} className="rp-comment">
              <div className="rp-comment-head">
                <strong>{c.by}</strong> <Time iso={c.at} />
              </div>
              <pre>{c.text}</pre>
            </div>
          ))}
          {pr.status === 'open' && (
            <div className={`rp-mergebox ${check?.state ?? ''}`}>
              {!check ? (
                <span>Checking…</span>
              ) : check.state === 'conflict' ? (
                <span>⚠ Conflicts in {check.conflicts.join(', ')}. Merge locally (Branches → switch to {pr.to}, merge origin/{pr.from}, resolve, push), then come back.</span>
              ) : check.state === 'merged' ? (
                <span>✓ {pr.to} already contains every commit of {pr.from}.</span>
              ) : check.state === 'missing' ? (
                <span>One of the branches is no longer on the shared folder.</span>
              ) : (
                <span>
                  ✓ No conflicts. {check.ahead} commit(s) will go into {pr.to}
                  {check.state === 'ff' ? ' (fast-forward)' : ' with a merge commit'}.
                </span>
              )}
              <span className="spacer" />
              <button type="button" className="primary" disabled={!check || check.state === 'conflict' || check.state === 'missing'} onClick={merge}>
                {check?.state === 'merged' ? 'Mark as merged' : 'Merge pull request'}
              </button>
              <button type="button" onClick={() => act('Closing', async () => (await repo.closePullRequest(pr), onChanged(), 'Pull request closed.'))}>
                Close
              </button>
            </div>
          )}
          {pr.status === 'closed' && (
            <button type="button" onClick={() => act('Reopening', async () => (await repo.reopenPullRequest(pr), onChanged(), 'Pull request reopened.'))}>
              Reopen
            </button>
          )}
          <div className="rp-newcomment">
            <textarea placeholder="Leave a comment (review notes, questions, approval)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" />
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() =>
                act('Commenting', async () => {
                  await repo.addComment(pr.id, text);
                  setText('');
                  setTick((t) => t + 1);
                })
              }
            >
              Comment
            </button>
          </div>
        </div>
      )}
      {view === 'commits' && (
        <ol className="rp-commits flat">
          {commits.length === 0 && <p className="rp-empty">{pr.status === 'merged' ? 'Merged: the commits are now part of ' + pr.to + '.' : 'No commits that are not already in ' + pr.to + '.'}</p>}
          {commits.map((c) => (
            <li key={c.id}>
              <span className="rp-msg1">{c.message.split('\n')[0]}</span>
              <span className="rp-meta">
                <code>{shortId(c.id)}</code> · {c.author} · <Time iso={c.time} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {view === 'files' &&
        (pr.status === 'merged' && pr.mergeCommit ? (
          <MergedFiles repo={repo} mergeCommit={pr.mergeCommit} to={pr.to} from={pr.from} />
        ) : ids.from && ids.to ? (
          <PrFiles repo={repo} toId={ids.to} fromId={ids.from} from={pr.from} to={pr.to} />
        ) : (
          <p className="rp-empty">Branches not found on the shared folder.</p>
        ))}
    </div>
  );
}

function MergedFiles({ repo, mergeCommit, to, from }: { repo: Repo; mergeCommit: string; to: string; from: string }) {
  const [parent, setParent] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    repo
      .commit(mergeCommit)
      .then((c) => setParent(c.parents.length > 1 ? c.parents[0] : null))
      .catch(() => setParent(null));
  }, [repo, mergeCommit]);
  if (parent === undefined) return <p className="rp-empty">Loading…</p>;
  return <ChangeSet repo={repo} from={parent} to={mergeCommit} fromLabel={`${to} before merge`} toLabel={`after merging ${from}`} />;
}

/* ================================================================== Activity ============ */

function ActivityTab({ repo, view }: { repo: Repo; view: View }) {
  const [pushes, setPushes] = useState<PushRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  useEffect(() => {
    let live = true;
    repo
      .pushes()
      .then((p) => live && setPushes(p))
      .catch(() => live && setPushes([]));
    return () => {
      live = false;
    };
  }, [repo, view.fetchAt, view.head?.id]);
  const list = (pushes ?? []).filter((p) => !branch || p.branch === branch);
  const current = list.find((p) => p.id === sel) ?? null;
  const names = [...new Set((pushes ?? []).map((p) => p.branch))].sort();

  return (
    <Panes
      id="rp-activity"
      panes={[
        {
          id: 'pushes',
          title: 'Pushes to the shared folder',
          size: 4,
          minPx: 320,
          fill: true,
          actions: (
            <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
              <option value="">all branches</option>
              {names.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          ),
          body: !pushes ? (
            <p className="rp-empty">Loading…</p>
          ) : !list.length ? (
            <p className="rp-empty">No pushes yet.</p>
          ) : (
            <ol className="rp-commits rp-timeline">
              {list.map((p) => (
                <li key={p.id}>
                  <button type="button" className={sel === p.id ? 'on' : ''} onClick={() => setSel(p.id)}>
                    <span className="rp-msg1">
                      <strong>{p.by}</strong> {p.deleted ? 'deleted' : p.forced ? 'force-pushed to' : 'pushed to'} <code>{p.branch}</code>
                      {!p.deleted && (
                        <>
                          {' '}
                          · {p.commits} commit{p.commits === 1 ? '' : 's'}
                        </>
                      )}
                    </span>
                    <span className="rp-meta">
                      {when(p.at)} ({ago(p.at)}) · {shortId(p.from)} → {shortId(p.to)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ),
        },
        {
          id: 'push',
          title: 'What was pushed',
          size: 6,
          minPx: 400,
          fill: true,
          body: current && !current.deleted ? (
            <ChangeSet repo={repo} from={current.from} to={current.to} fromLabel={`before (${shortId(current.from)})`} toLabel={`after (${shortId(current.to)})`} />
          ) : (
            <p className="rp-empty">Pick a push to see what it changed.</p>
          ),
        },
      ]}
    />
  );
}

/* ================================================================== Settings ============ */

function SettingsTab({
  user,
  setUser,
  handle,
  remoteState,
  onConnect,
  onReconnect,
  onDisconnect,
  act,
  local,
  repo,
}: {
  user: string;
  setUser: (u: string) => void;
  handle: FileSystemDirectoryHandle | null;
  remoteState: RemoteState;
  onConnect: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  act: Act;
  local: IdbStore;
  repo: Repo;
}) {
  const [name, setName] = useState(user);
  return (
    <div className="rp-page rp-settings">
      <section className="rp-card">
        <h3>Your name</h3>
        <p className="small muted">Shown on your commits, pushes, pull requests and comments.</p>
        <div className="rp-row-btns">
          <input type="text" value={name} placeholder="e.g. Jay" onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          <button type="button" className="primary" disabled={!name.trim() || name.trim() === user} onClick={() => setUser(name.trim())}>
            Save
          </button>
        </div>
      </section>

      <section className="rp-card">
        <h3>Shared folder (the team remote)</h3>
        {remoteState === 'unsupported' ? (
          <p className="dk-err">This browser cannot open folders. Use Chrome or Edge.</p>
        ) : handle ? (
          <>
            <p>
              Connected to <strong>{handle.name}</strong> {remoteState === 'prompt' && <span className="rp-bad">(needs permission again)</span>}
            </p>
            <div className="rp-row-btns">
              {remoteState === 'prompt' && (
                <button type="button" className="primary" onClick={onReconnect}>
                  Reconnect
                </button>
              )}
              <button type="button" onClick={onConnect}>
                Choose another folder…
              </button>
              <button type="button" onClick={onDisconnect}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="primary" onClick={onConnect}>
            Choose shared folder…
          </button>
        )}
        <div className="rp-help small">
          <p>
            <strong>How the team shares one repository:</strong> everyone picks the same folder here.
          </p>
          <ul>
            <li>
              <strong>Google Drive:</strong> install “Google Drive for desktop”, share a folder with the team, then pick it from the <em>G:</em> drive (My Drive or Shared drives).
            </li>
            <li>
              <strong>OneDrive / SharePoint:</strong> sync the shared folder to your PC and pick it.
            </li>
            <li>
              <strong>Network share:</strong> pick the mapped drive, e.g. <em>\\server\sp-repo</em>.
            </li>
          </ul>
          <p>
            Commits and file contents are stored under their fingerprint and never change, so people syncing at the same time do not overwrite each other. Branches are protected like GitHub:
            a push is refused when someone else pushed first, and you pull before pushing again. Pushing from two PCs in the same second over a slow sync can still clash, so pull often.
          </p>
          <p>Works in Chrome and Edge. The browser may ask again for permission to the folder after a restart: click Reconnect.</p>
        </div>
      </section>

      <section className="rp-card">
        <h3>Your local copy</h3>
        <p className="small muted">
          Your working copy, commits and branches live in this browser (IndexedDB) until you push. Clearing this site's data deletes what you did not push.
        </p>
        <div className="rp-row-btns">
          <button
            type="button"
            onClick={() =>
              act('Exporting', async () => {
                const work = await repo.work();
                const all = Object.entries(work)
                  .map(([n, t]) => `-- ===== ${n} =====\n${t.trimEnd()}\nGO\n`)
                  .join('\n');
                downloadText(`working-copy-${new Date().toISOString().slice(0, 10)}.sql`, all);
                return `${Object.keys(work).length} procedure(s) exported.`;
              })
            }
          >
            Export working copy (.sql)
          </button>
          <button
            type="button"
            className="danger"
            onClick={() =>
              confirm('Delete your LOCAL repository (working copy, local commits and branches)? Anything not pushed is lost.') &&
              act('Resetting', async () => {
                await local.clear();
                return 'Local repository deleted. Fetch from the shared folder to start again.';
              })
            }
          >
            Reset local copy…
          </button>
        </div>
      </section>
    </div>
  );
}
