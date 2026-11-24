import { useEffect, useMemo, useState } from 'react';
import '../deploy.css';
import { cleanTables, columnTypes, defaultDdlOptions, firstTable, tableDelta } from '../lib/Ddl';
import type { DdlOptions } from '../lib/Ddl';
import { KIND_LABEL, buildDeletes, buildDml, dataDelta, defaultDmlOptions, defaultGridOptions, parseGrid } from '../lib/Dml';
import type { DmlMode, DmlOptions, Grid, GridOptions, Kind } from '../lib/Dml';
import { KIND_NAME, KIND_ORDER, buildRelease, lintScript, prepareScript } from '../lib/Release';
import type { ItemKind, PrepOptions, ReleaseItem } from '../lib/Release';
import { downloadText } from '../lib/Folder';
import { usePersistentState } from '../lib/Session';

type Tab = 'tables' | 'alter' | 'data' | 'release';
const DEFAULT_PREP: PrepOptions = { createOrAlter: true, stripUse: true, stripBanner: true };
const EMPTY_GRID: Grid = { headers: [], rows: [], delimiter: '\t', warnings: [] };
const MODES: { id: DmlMode; label: string }[] = [
  { id: 'insert', label: 'INSERT' },
  { id: 'insert-missing', label: 'INSERT only missing rows (safe to run twice)' },
  { id: 'merge', label: 'MERGE (insert new + update existing)' },
  { id: 'update', label: 'UPDATE existing rows' },
];

function safe<T>(fn: () => T, fallback: T): { v: T; err: string } {
  try {
    return { v: fn(), err: '' };
  } catch (e) {
    return { v: fallback, err: e instanceof Error ? e.message : String(e) };
  }
}

function Chk({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="dk-chk" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

interface OutProps {
  title: string;
  text: string;
  file: string;
  notes?: string[];
  err?: string;
  defaultName?: string;
  onAdd?: (name: string) => void;
}

function Out({ title, text, file, notes = [], err, defaultName = '', onAdd }: OutProps) {
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const lines = text ? text.split('\n').length - 1 : 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: select the text by hand */
    }
  };
  return (
    <section className="dk-out">
      <div className="dk-bar">
        <h3>{title}</h3>
        <span className="muted small">{lines} line(s)</span>
        <span className="spacer" />
        <button type="button" disabled={!text} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" disabled={!text} onClick={() => downloadText(file, text)}>
          Download .sql
        </button>
        {onAdd && (
          <>
            <input type="text" className="dk-name" placeholder={defaultName || 'Name in release'} value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="primary" disabled={!text} onClick={() => onAdd(name.trim() || defaultName || title)}>
              Add to release
            </button>
          </>
        )}
      </div>
      {err && (
        <div className="dk-err" role="alert">
          {err}
        </div>
      )}
      <textarea readOnly spellCheck={false} value={text} placeholder="The script appears here" onFocus={(e) => e.currentTarget.select()} />
      {notes.length > 0 && (
        <ul className="dk-notes">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Paste({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="dk-paste">
      <span className="dk-cap">{label}</span>
      <textarea spellCheck={false} wrap="off" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function DeployKit({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = usePersistentState<Tab>('dk-tab', 'tables');
  const [items, setItems] = usePersistentState<ReleaseItem[]>('dk-items', []);
  const [ddlRaw, setDdlRaw] = usePersistentState<DdlOptions>('dk-ddl', defaultDdlOptions);
  const [dmlRaw, setDmlRaw] = usePersistentState<DmlOptions>('dk-dml', defaultDmlOptions);
  const [gridRaw, setGridRaw] = usePersistentState<GridOptions>('dk-grid', defaultGridOptions);
  const [prepRaw, setPrepRaw] = usePersistentState<PrepOptions>('dk-prep', DEFAULT_PREP);
  const [rel, setRel] = usePersistentState('dk-rel', { title: '', database: '', go: true });

  const dopt = useMemo(() => ({ ...defaultDdlOptions, ...ddlRaw }), [ddlRaw]);
  const mopt = useMemo(() => ({ ...defaultDmlOptions, ...dmlRaw }), [dmlRaw]);
  const gopt = useMemo(() => ({ ...defaultGridOptions, ...gridRaw }), [gridRaw]);
  const setD = <K extends keyof DdlOptions>(k: K, v: DdlOptions[K]) => setDdlRaw({ ...dopt, [k]: v });
  const setM = <K extends keyof DmlOptions>(k: K, v: DmlOptions[K]) => setDmlRaw({ ...mopt, [k]: v });

  const add = (kind: ItemKind, name: string, sql: string) => setItems((v) => [...v, { id: `${Date.now()}-${v.length}`, name, kind, sql }]);

  /* ----------------------------------------------------------------- tables ---- */
  const [ddlIn, setDdlIn] = useState('');
  const tables = useMemo(() => safe(() => cleanTables(ddlIn, dopt), { sql: '', tables: 0, notes: [] as string[] }), [ddlIn, dopt]);

  /* ------------------------------------------------------------------ alter ---- */
  const [uatIn, setUatIn] = useState('');
  const [prodIn, setProdIn] = useState('');
  const alter = useMemo(() => safe(() => tableDelta(uatIn, prodIn, dopt), { sql: '', tables: 0, notes: [] as string[] }), [uatIn, prodIn, dopt]);

  /* ------------------------------------------------------------------- data ---- */
  const [gridIn, setGridIn] = useState('');
  const [prodRows, setProdRows] = useState('');
  const [hint, setHint] = useState('');
  const grid = useMemo(() => safe(() => parseGrid(gridIn, gopt), EMPTY_GRID), [gridIn, gopt]);
  const prodGrid = useMemo(() => safe(() => parseGrid(prodRows, gopt), EMPTY_GRID).v, [prodRows, gopt]);
  const sqlTypes = useMemo(() => (hint.trim() ? safe(() => columnTypes(hint), new Map<string, { type: string; identity: boolean }>()).v : undefined), [hint]);
  const compare = prodRows.trim() !== '';

  useEffect(() => {
    if (!hint.trim()) return;
    const t = safe(() => firstTable(hint), null).v;
    if (t) setDmlRaw((o) => ({ ...defaultDmlOptions, ...o, table: `${t.schema}.${t.name}`, keys: t.pk }));
  }, [hint, setDmlRaw]);

  const data = useMemo(
    () =>
      safe(
        () => {
          if (!grid.v.headers.length) return { sql: '', notes: [] as string[], stat: '' };
          if (compare) {
            const r = dataDelta(grid.v, prodGrid, mopt, sqlTypes);
            return { sql: r.sql, notes: r.warnings, stat: `${r.added} new, ${r.changed} changed, ${r.same} unchanged, ${r.targetOnly} only in production (left alone)` };
          }
          const r = buildDml(grid.v, mopt, sqlTypes);
          return { sql: r.sql, notes: r.warnings, stat: `${r.rows} row(s) in ${r.statements} statement(s)` };
        },
        { sql: '', notes: [] as string[], stat: '' },
      ),
    [grid, prodGrid, compare, mopt, sqlTypes],
  );
  const rollback = useMemo(
    () => (!compare && mopt.mode === 'insert' && mopt.keys.length && grid.v.headers.length ? safe(() => buildDeletes(grid.v, mopt, sqlTypes), '').v : ''),
    [grid, compare, mopt, sqlTypes],
  );

  const toggleList = (k: 'keys' | 'skip', h: string, on: boolean) => {
    const cur = mopt[k].filter((x) => x.toLowerCase() !== h.toLowerCase());
    setM(k, on ? [...cur, h] : cur);
  };
  const setKind = (h: string, kind: string) => {
    const next = { ...mopt.kinds };
    if (kind) next[h.toLowerCase()] = kind as Kind;
    else delete next[h.toLowerCase()];
    setM('kinds', next);
  };

  /* ---------------------------------------------------------------- release ---- */
  const [pasteName, setPasteName] = useState('');
  const [pasteKind, setPasteKind] = useState<ItemKind>('proc');
  const [pasteText, setPasteText] = useState('');
  const prep = { ...DEFAULT_PREP, ...prepRaw };
  const release = useMemo(() => buildRelease(items, rel), [items, rel]);
  const findings = useMemo(() => (items.length ? safe(() => lintScript(release), []).v : []), [items, release]);

  const move = (i: number, d: number) =>
    setItems((v) => {
      const j = i + d;
      if (j < 0 || j >= v.length) return v;
      const c = [...v];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const rename = (id: string, name: string) => setItems((v) => v.map((x) => (x.id === id ? { ...x, name } : x)));
  const tabBtn = (id: Tab, label: string, count?: number) => (
    <button type="button" className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
      {label}
      {!!count && <span className="count">{count}</span>}
    </button>
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>Deploy Kit</h1>
        <nav aria-label="Deploy tools">
          {tabBtn('tables', 'Clean tables')}
          {tabBtn('alter', 'Table changes')}
          {tabBtn('data', 'Data scripts')}
          {tabBtn('release', 'Release pack', items.length)}
        </nav>
        <div className="spacer" />
        <button type="button" onClick={onBack}>
          Back to compare
        </button>
      </header>

      <div className="dk-body">
        {tab === 'tables' && (
          <div className="dk-cols">
            <div className="dk-side">
              <Paste label="Paste the SSMS “Generate Scripts” output (one or many tables)" value={ddlIn} onChange={setDdlIn} placeholder="USE [..] GO SET ANSI_NULLS ON ... CREATE TABLE ..." />
              <DdlOptionsBox o={dopt} set={setD} />
            </div>
            <Out
              title="Clean CREATE TABLE"
              text={tables.v.sql}
              err={tables.err}
              notes={tables.v.notes}
              file="tables.sql"
              defaultName={tables.v.tables === 1 ? 'Table' : `${tables.v.tables} tables`}
              onAdd={(n) => add('table', n, tables.v.sql)}
            />
          </div>
        )}

        {tab === 'alter' && (
          <div className="dk-cols">
            <div className="dk-side">
              <Paste label="Table script from UAT (the new version)" value={uatIn} onChange={setUatIn} placeholder="CREATE TABLE ... from UAT" />
              <Paste label="Table script from Production (the current version)" value={prodIn} onChange={setProdIn} placeholder="CREATE TABLE ... from production. Tables missing here are created in full." />
              <DdlOptionsBox o={dopt} set={setD} />
            </div>
            <Out title="ALTER script (Production → UAT)" text={alter.v.sql} err={alter.err} notes={alter.v.notes} file="table-changes.sql" defaultName="Table changes" onAdd={(n) => add('alter', n, alter.v.sql)} />
          </div>
        )}

        {tab === 'data' && (
          <div className="dk-cols">
            <div className="dk-side">
              <Paste label="Rows from UAT: select the table in SSMS, Copy with Headers, paste here" value={gridIn} onChange={setGridIn} placeholder={'Id\tName\tIsActive\n1\tAlpha\t1'} />
              <Paste label="Optional: CREATE TABLE script (picks the table name, key and exact column types)" value={hint} onChange={setHint} placeholder="Paste the table script so values are quoted by their real types" />
              <Paste label="Optional: the same rows from Production (only new and changed rows are scripted)" value={prodRows} onChange={setProdRows} placeholder="Leave empty to script every row" />
              <fieldset className="dk-opts">
                <legend>Script</legend>
                <label className="dk-row">
                  Table <input type="text" value={mopt.table} onChange={(e) => setM('table', e.target.value)} />
                </label>
                <label className="dk-row">
                  Type{' '}
                  <select value={mopt.mode} onChange={(e) => setM('mode', e.target.value as DmlMode)}>
                    {MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="dk-row">
                  Rows per INSERT <input type="number" min={1} max={1000} value={mopt.rowsPerInsert} onChange={(e) => setM('rowsPerInsert', Math.min(1000, Math.max(1, Number(e.target.value) || 1)))} />
                </label>
                <label className="dk-row">
                  GO after every N statements (0 = never) <input type="number" min={0} value={mopt.goEvery} onChange={(e) => setM('goEvery', Math.max(0, Number(e.target.value) || 0))} />
                </label>
                <Chk label="SET IDENTITY_INSERT ON" checked={mopt.identityInsert} onChange={(v) => setM('identityInsert', v)} title="Needed when the key column is an IDENTITY column and you keep the same ids as UAT" />
                <Chk label="Wrap in a transaction" checked={mopt.transaction} onChange={(v) => setM('transaction', v)} />
                <Chk label="PRINT a summary" checked={mopt.printSummary} onChange={(v) => setM('printSummary', v)} />
                <Chk label="Header comment" checked={mopt.header} onChange={(v) => setM('header', v)} />
                <Chk label="Use N'' for every text column" checked={mopt.allUnicode} onChange={(v) => setM('allUnicode', v)} />
              </fieldset>
              <fieldset className="dk-opts">
                <legend>Pasted data</legend>
                <label className="dk-row">
                  Text that means NULL <input type="text" value={gopt.nullText} onChange={(e) => setGridRaw({ ...gopt, nullText: e.target.value })} />
                </label>
                <Chk label="Empty cell = NULL" checked={gopt.emptyAsNull} onChange={(v) => setGridRaw({ ...gopt, emptyAsNull: v })} />
                <Chk label="Trim spaces" checked={gopt.trim} onChange={(v) => setGridRaw({ ...gopt, trim: v })} />
              </fieldset>
              {grid.v.headers.length > 0 && (
                <table className="dk-cols-table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th title="Used to match rows (MERGE / UPDATE / compare / rollback)">Key</th>
                      <th>Skip</th>
                      <th>Value type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.v.headers.map((h) => (
                      <tr key={h}>
                        <td>{h}</td>
                        <td>
                          <input type="checkbox" checked={mopt.keys.some((k) => k.toLowerCase() === h.toLowerCase())} onChange={(e) => toggleList('keys', h, e.target.checked)} aria-label={`${h} is a key`} />
                        </td>
                        <td>
                          <input type="checkbox" checked={mopt.skip.some((k) => k.toLowerCase() === h.toLowerCase())} onChange={(e) => toggleList('skip', h, e.target.checked)} aria-label={`skip ${h}`} />
                        </td>
                        <td>
                          <select value={mopt.kinds[h.toLowerCase()] ?? ''} onChange={(e) => setKind(h, e.target.value)}>
                            <option value="">auto</option>
                            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABEL[k]}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="dk-stack">
              <Out
                title={compare ? 'Delta script (new + changed rows)' : 'Data script'}
                text={data.v.sql}
                err={data.err || grid.err}
                notes={[...(data.v.stat ? [data.v.stat] : []), ...grid.v.warnings, ...data.v.notes]}
                file={`${mopt.table.replace(/[^\w.-]/g, '_')}-data.sql`}
                defaultName={mopt.table}
                onAdd={(n) => add('data', n, data.v.sql)}
              />
              {rollback && <Out title="Rollback (deletes exactly these rows, only safe if they are new in production)" text={rollback} file={`${mopt.table.replace(/[^\w.-]/g, '_')}-rollback.sql`} />}
            </div>
          </div>
        )}

        {tab === 'release' && (
          <div className="dk-cols">
            <div className="dk-side">
              <fieldset className="dk-opts">
                <legend>Add a procedure, view, function or any script</legend>
                <label className="dk-row">
                  Name <input type="text" value={pasteName} placeholder="usp_GetOrders" onChange={(e) => setPasteName(e.target.value)} />
                </label>
                <label className="dk-row">
                  Type{' '}
                  <select value={pasteKind} onChange={(e) => setPasteKind(e.target.value as ItemKind)}>
                    {(Object.keys(KIND_NAME) as ItemKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_NAME[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <Paste label="Script" value={pasteText} onChange={setPasteText} placeholder="Paste the script generated by SSMS" />
                <Chk label="CREATE → CREATE OR ALTER" checked={prep.createOrAlter} onChange={(v) => setPrepRaw({ ...prep, createOrAlter: v })} title="So the procedure can be deployed whether or not it already exists" />
                <Chk label="Remove USE [database] lines" checked={prep.stripUse} onChange={(v) => setPrepRaw({ ...prep, stripUse: v })} />
                <Chk label="Remove SSMS “Script Date” comment" checked={prep.stripBanner} onChange={(v) => setPrepRaw({ ...prep, stripBanner: v })} />
                <button
                  type="button"
                  className="primary"
                  disabled={!pasteText.trim()}
                  onClick={() => {
                    add(pasteKind, pasteName.trim() || KIND_NAME[pasteKind], prepareScript(pasteText, prep));
                    setPasteText('');
                    setPasteName('');
                  }}
                >
                  Add to release
                </button>
              </fieldset>

              <fieldset className="dk-opts">
                <legend>Release file</legend>
                <label className="dk-row">
                  Title <input type="text" value={rel.title} placeholder="Vendor Payment module" onChange={(e) => setRel({ ...rel, title: e.target.value })} />
                </label>
                <label className="dk-row">
                  Production database (optional) <input type="text" value={rel.database} placeholder="adds USE [..]" onChange={(e) => setRel({ ...rel, database: e.target.value })} />
                </label>
                <Chk label="GO after each item" checked={rel.go} onChange={(v) => setRel({ ...rel, go: v })} />
              </fieldset>

              <ol className="dk-items">
                {items.map((it, i) => (
                  <li key={it.id}>
                    <span className="dk-tag">{KIND_NAME[it.kind].split(' ')[0]}</span>
                    <input type="text" value={it.name} onChange={(e) => rename(it.id, e.target.value)} aria-label="Item name" />
                    <span className="muted small">{it.sql.split('\n').length} lines</span>
                    <button type="button" className="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button type="button" className="icon" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                      ↓
                    </button>
                    <button type="button" className="icon" onClick={() => setItems((v) => v.filter((x) => x.id !== it.id))} aria-label="Remove">
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
              {items.length > 1 && (
                <div className="dk-row">
                  <button type="button" onClick={() => setItems((v) => [...v].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]))} title="Tables, table changes, data, then procedures">
                    Sort: tables → data → procedures
                  </button>
                  <button type="button" onClick={() => setItems([])}>
                    Clear all
                  </button>
                </div>
              )}
            </div>
            <div className="dk-stack">
              {findings.length > 0 && (
                <ul className="dk-find" role="status">
                  {findings.map((f, i) => (
                    <li key={i} className={f.level}>
                      {f.text}
                    </li>
                  ))}
                </ul>
              )}
              <Out title="Release script" text={items.length ? release : ''} file={`${(rel.title || 'release').replace(/[^\w.-]+/g, '_')}.sql`} notes={items.length ? [] : ['Add tables, data and procedures from the other tabs. Each “Add to release” button puts the script into this list.']} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DdlOptionsBox({ o, set }: { o: DdlOptions; set: <K extends keyof DdlOptions>(k: K, v: DdlOptions[K]) => void }) {
  return (
    <fieldset className="dk-opts">
      <legend>Table options</legend>
      <Chk label="Upper-case keywords and types" checked={o.upper} onChange={(v) => set('upper', v)} />
      <Chk label="Keep CONSTRAINT names of defaults" checked={o.namedDefaults} onChange={(v) => set('namedDefaults', v)} />
      <Chk label="Include indexes" checked={o.indexes} onChange={(v) => set('indexes', v)} />
      <Chk label="Keep descriptions (extended properties)" checked={o.descriptions} onChange={(v) => set('descriptions', v)} />
      <Chk label="Re-runnable (skip if it already exists)" checked={o.guard} onChange={(v) => set('guard', v)} />
      <Chk label="GO between statements" checked={o.go} onChange={(v) => set('go', v)} />
      <Chk label="Align columns" checked={o.align} onChange={(v) => set('align', v)} />
      <Chk label="Always write dbo." checked={o.keepSchema} onChange={(v) => set('keepSchema', v)} />
      <label className="dk-row">
        Foreign keys{' '}
        <select value={o.fk} onChange={(e) => set('fk', e.target.value as DdlOptions['fk'])}>
          <option value="after">separate ALTER TABLE (safe order)</option>
          <option value="inline">inside CREATE TABLE</option>
        </select>
      </label>
      <label className="dk-row">
        Brackets{' '}
        <select value={o.brackets} onChange={(e) => set('brackets', e.target.value as DdlOptions['brackets'])}>
          <option value="smart">only where needed</option>
          <option value="keep">always [..]</option>
        </select>
      </label>
    </fieldset>
  );
}
