import { ident } from './Ddl';

/* =====================================================================================
 * Data scripts: turns rows copied from the SSMS results grid ("Copy with Headers") into
 * INSERT / re-runnable INSERT / MERGE / UPDATE scripts, and compares two copies of a table
 * so that only the new and the changed rows are scripted.
 * ===================================================================================== */

export interface Grid {
  headers: string[];
  rows: (string | null)[][];
  delimiter: string;
  warnings: string[];
}

export interface GridOptions {
  nullText: string; // text that stands for NULL in the pasted data (SSMS writes NULL)
  emptyAsNull: boolean;
  trim: boolean;
}

export const defaultGridOptions: GridOptions = { nullText: 'NULL', emptyAsNull: false, trim: false };

/** Reads tab separated (SSMS) or comma / semicolon / pipe separated text. First line = headers. */
export function parseGrid(text: string, o: GridOptions = defaultGridOptions): Grid {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') && !firstLine.includes(',') ? '|' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

  const records: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = src.length;
  let field = '';
  let atStart = true;

  const endField = () => {
    row.push(field);
    field = '';
    atStart = true;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0] !== '') records.push(row);
    row = [];
  };

  while (i < n) {
    const c = src[i];
    if (atStart && c === '"') {
      // quoted field (Excel / CSV style) only when it is properly closed
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            val += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        val += src[j++];
      }
      const after = src[j];
      if (closed && (j >= n || after === delimiter || after === '\n' || after === '\r')) {
        field = val;
        atStart = false;
        i = j;
        continue;
      }
    }
    if (c === delimiter) {
      endField();
      i++;
    } else if (c === '\r' || c === '\n') {
      endRow();
      if (c === '\r' && src[i + 1] === '\n') i++;
      i++;
    } else {
      field += c;
      atStart = false;
      i++;
    }
  }
  if (field !== '' || row.length) endRow();

  const warnings: string[] = [];
  if (!records.length) return { headers: [], rows: [], delimiter, warnings: ['Nothing to read. Paste the rows with their headers.'] };

  const headers = records[0].map((h) => h.trim());
  const dup = headers.filter((h, ix) => headers.indexOf(h) !== ix);
  if (dup.length) warnings.push(`Duplicate column name(s): ${[...new Set(dup)].join(', ')}.`);

  let bad = 0;
  const rows = records.slice(1).map((r) => {
    if (r.length !== headers.length) bad++;
    const fixed = headers.map((_, k) => (k < r.length ? r[k] : ''));
    return fixed.map((v) => {
      const t = o.trim ? v.trim() : v;
      if (t === o.nullText) return null;
      if (o.emptyAsNull && t === '') return null;
      return t;
    });
  });
  if (bad) warnings.push(`${bad} row(s) have a different number of columns than the header. A value that contains a tab or a line break can cause this. Check those rows.`);
  return { headers, rows, delimiter, warnings };
}

/* ---------------------------------------------------------------- column kinds ---- */

export type Kind = 'number' | 'string' | 'nstring' | 'date' | 'bit' | 'guid' | 'binary';

export const KIND_LABEL: Record<Kind, string> = {
  number: 'Number',
  string: 'Text',
  nstring: 'Unicode text N\'\'',
  date: 'Date / time',
  bit: 'Bit (0/1)',
  guid: 'GUID',
  binary: 'Binary 0x..',
};

export function kindFromSqlType(type: string): Kind {
  const t = type.toLowerCase().replace(/\(.*\)/, '').trim();
  if (/^(bigint|int|smallint|tinyint|decimal|numeric|float|real|money|smallmoney)$/.test(t)) return 'number';
  if (t === 'bit') return 'bit';
  if (/^(nchar|nvarchar|ntext|sysname)$/.test(t)) return 'nstring';
  if (/^(date|datetime|datetime2|smalldatetime|time|datetimeoffset)$/.test(t)) return 'date';
  if (t === 'uniqueidentifier') return 'guid';
  if (/^(varbinary|binary|image|timestamp|rowversion)$/.test(t)) return 'binary';
  return 'string';
}

const NUM = /^-?(0|[1-9]\d{0,17})(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?)?$/;
const GUID = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

export function inferKind(values: (string | null)[]): Kind {
  const v = values.filter((x): x is string => x !== null && x !== '');
  if (!v.length) return 'string';
  if (v.every((x) => NUM.test(x))) return 'number';
  if (v.every((x) => /^(true|false|0|1)$/i.test(x))) return 'bit';
  if (v.every((x) => DATE.test(x))) return 'date';
  if (v.every((x) => GUID.test(x))) return 'guid';
  if (v.every((x) => /^0x[0-9a-f]*$/i.test(x))) return 'binary';
  return v.some((x) => /[^\x00-\x7f]/.test(x)) ? 'nstring' : 'string';
}

export function literal(v: string | null, kind: Kind): string {
  if (v === null) return 'NULL';
  if (v === '' && kind !== 'string' && kind !== 'nstring') return 'NULL';
  const esc = (s: string) => s.replace(/'/g, "''");
  switch (kind) {
    case 'number':
      return NUM.test(v) || /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(v) ? v : `'${esc(v)}'`;
    case 'bit':
      return /^(true|1)$/i.test(v) ? '1' : /^(false|0)$/i.test(v) ? '0' : `'${esc(v)}'`;
    case 'binary':
      return /^0x[0-9a-f]*$/i.test(v) ? v : `'${esc(v)}'`;
    case 'nstring':
      return `N'${esc(v)}'`;
    default:
      return `'${esc(v)}'`;
  }
}

/* ---------------------------------------------------------------- generating ----- */

export type DmlMode = 'insert' | 'insert-missing' | 'merge' | 'update';

/* ---------------------------------------------------------------- value rules ---- */

/** Ready-made SQL values a column can be set to instead of the pasted value. */
export const VALUE_PRESETS: { expr: string; label: string; title: string }[] = [
  { expr: 'GETDATE()', label: 'GETDATE()', title: 'Current date and time of the server' },
  { expr: 'CAST(GETDATE() AS DATE)', label: 'Today (date only)', title: 'CAST(GETDATE() AS DATE)' },
  { expr: 'GETUTCDATE()', label: 'GETUTCDATE()', title: 'Current UTC date and time' },
  { expr: 'SYSDATETIME()', label: 'SYSDATETIME()', title: 'Current date and time, datetime2 precision' },
  { expr: 'NEWID()', label: 'NEWID()', title: 'A new GUID for every row' },
  { expr: 'SUSER_SNAME()', label: 'SUSER_SNAME()', title: 'Login that runs the script' },
  { expr: 'HOST_NAME()', label: 'HOST_NAME()', title: 'Machine that runs the script' },
  { expr: 'NULL', label: 'NULL', title: 'NULL' },
  { expr: "''", label: "'' empty text", title: "An empty string ''" },
  { expr: '0', label: '0', title: 'The number 0' },
  { expr: '1', label: '1', title: 'The number 1' },
];

/**
 * What to write for a column instead of the pasted value.
 * - type 'expr': raw SQL, written as is (GETDATE(), @UserCode, 0, 'Admin', ISNULL(..)).
 * - type 'text': plain text, quoted for you ('Admin' / N'..').
 * when 'always' replaces every row, 'empty' only fills cells that are NULL or empty.
 */
export interface ValueRule {
  type: 'expr' | 'text';
  value: string;
  when: 'always' | 'empty';
}

/** A column that is not in the pasted data, added to every row (CreatedOn = GETDATE()). */
export interface ExtraColumn {
  name: string;
  rule: ValueRule;
}

export interface DmlOptions {
  table: string; // dbo.Orders
  mode: DmlMode;
  keys: string[];
  rowsPerInsert: number; // 1 .. 1000
  identityInsert: boolean;
  skip: string[]; // columns left out
  kinds: Record<string, Kind>; // per column override (lower-case name)
  goEvery: number; // 0 = no GO
  transaction: boolean;
  printSummary: boolean;
  header: boolean;
  brackets: 'smart' | 'keep';
  allUnicode: boolean;
  indent: string;
  values: Record<string, ValueRule>; // per column value rule (lower-case name)
  extraCols: ExtraColumn[];
}

export const defaultDmlOptions: DmlOptions = {
  table: 'dbo.TableName',
  mode: 'insert',
  keys: [],
  rowsPerInsert: 1,
  identityInsert: false,
  skip: [],
  kinds: {},
  goEvery: 0,
  transaction: false,
  printSummary: true,
  header: true,
  brackets: 'smart',
  allUnicode: false,
  indent: '    ',
  values: {},
  extraCols: [],
};

export function tableIdent(name: string, o: Pick<DmlOptions, 'brackets'>): string {
  return name
    .split('.')
    .map((p) => ident(p.trim().replace(/^\[|\]$/g, ''), o))
    .join('.');
}

export interface ColumnPlan {
  index: number; // -1 = extra column that is not in the pasted data
  name: string;
  sql: string;
  kind: Kind;
  rule?: ValueRule;
}

/** SQL text of a value rule for a column of the given kind. */
export function ruleSql(rule: ValueRule, kind: Kind): string {
  if (rule.type === 'text') return literal(rule.value, kind === 'nstring' ? 'nstring' : kind === 'string' ? 'string' : /[^\x00-\x7f]/.test(rule.value) ? 'nstring' : 'string');
  return rule.value.trim() || 'NULL';
}

/** The SQL value of one cell: the pasted value, or the column's value rule. */
export function cellSql(row: (string | null)[], c: ColumnPlan): string {
  const raw = c.index >= 0 ? row[c.index] ?? null : null;
  if (c.rule && (c.rule.when === 'always' || c.index < 0 || raw === null || raw === '')) return ruleSql(c.rule, c.kind);
  return literal(raw, c.kind);
}

/** True when the column's value comes from a rule for every row (so it is not compared). */
const fixedValue = (c: ColumnPlan) => !!c.rule && (c.rule.when === 'always' || c.index < 0);

export function planColumns(g: Grid, o: DmlOptions, sqlTypes?: Map<string, { type: string; identity: boolean }>): ColumnPlan[] {
  const skip = new Set(o.skip.map((s) => s.toLowerCase()));
  const out: ColumnPlan[] = [];
  g.headers.forEach((h, index) => {
    if (skip.has(h.toLowerCase())) return;
    const lower = h.toLowerCase();
    let kind: Kind = o.kinds[lower] ?? (sqlTypes?.get(lower) ? kindFromSqlType(sqlTypes.get(lower)!.type) : inferKind(g.rows.map((r) => r[index])));
    if (o.allUnicode && kind === 'string') kind = 'nstring';
    if (kind === 'string' && !o.kinds[lower] && g.rows.some((r) => r[index] && /[^\x00-\x7f]/.test(r[index]!))) kind = 'nstring';
    const rule = o.values?.[lower];
    out.push({ index, name: h, sql: ident(h, o), kind, rule: rule && (rule.type === 'text' || rule.value.trim()) ? rule : undefined });
  });
  for (const x of o.extraCols ?? []) {
    const name = x.name.trim();
    if (!name || skip.has(name.toLowerCase()) || out.some((c) => c.name.toLowerCase() === name.toLowerCase())) continue;
    const kind: Kind = sqlTypes?.get(name.toLowerCase()) ? kindFromSqlType(sqlTypes.get(name.toLowerCase())!.type) : o.allUnicode ? 'nstring' : 'string';
    out.push({ index: -1, name, sql: ident(name, o), kind, rule: x.rule });
  }
  return out;
}

const chunk = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export interface DmlResult {
  sql: string;
  rows: number;
  statements: number;
  warnings: string[];
}

function rowValues(row: (string | null)[], cols: ColumnPlan[]): string {
  return `(${cols.map((c) => cellSql(row, c)).join(', ')})`;
}

function keyCols(cols: ColumnPlan[], keys: string[]): ColumnPlan[] {
  return keys.map((k) => cols.find((c) => c.name.toLowerCase() === k.toLowerCase())).filter((c): c is ColumnPlan => !!c);
}

/** One script statement list for the rows of a grid. */
export function buildDml(g: Grid, o: DmlOptions, sqlTypes?: Map<string, { type: string; identity: boolean }>): DmlResult {
  const warnings: string[] = [];
  const cols = planColumns(g, o, sqlTypes);
  const tbl = tableIdent(o.table, o);
  const rows = g.rows;
  const stmts: string[] = [];
  const colNames = cols.map((c) => c.sql).join(', ');
  const keys = keyCols(cols, o.keys);

  if (!cols.length) return { sql: '', rows: 0, statements: 0, warnings: ['No columns left to script.'] };
  if (o.mode !== 'insert' && keys.length === 0) warnings.push('Choose at least one key column for this mode.');
  if (o.mode !== 'insert' && keys.length > 0) {
    const seen = new Set<string>();
    let dup = 0;
    rows.forEach((r) => {
      const k = keys.map((c) => r[c.index]).join('\u0001');
      if (seen.has(k)) dup++;
      seen.add(k);
    });
    if (dup) warnings.push(`${dup} row(s) share a key with another row. The key columns should be unique.`);
  }
  if (o.mode === 'update' && cols.length === keys.length) warnings.push('Every column is a key column, so there is nothing to update.');
  const fixedKeys = keys.filter(fixedValue);
  if (fixedKeys.length && o.mode !== 'insert') warnings.push(`Key column(s) ${fixedKeys.map((c) => c.name).join(', ')} get a fixed value for every row, so rows can no longer be matched one by one.`);

  const per = Math.max(1, Math.min(1000, Math.floor(o.rowsPerInsert) || 1));

  if (o.mode === 'insert') {
    for (const part of chunk(rows, per)) {
      if (part.length === 1) stmts.push(`INSERT INTO ${tbl} (${colNames}) VALUES ${rowValues(part[0], cols)};`);
      else stmts.push(`INSERT INTO ${tbl} (${colNames}) VALUES\n${part.map((r) => o.indent + rowValues(r, cols)).join(',\n')};`);
    }
  } else if (o.mode === 'insert-missing' && keys.length) {
    for (const part of chunk(rows, per)) {
      if (part.length === 1) {
        const where = keys.map((k) => `${k.sql} = ${cellSql(part[0], k)}`).join(' AND ');
        stmts.push(`IF NOT EXISTS (SELECT 1 FROM ${tbl} WHERE ${where})\n${o.indent}INSERT INTO ${tbl} (${colNames}) VALUES ${rowValues(part[0], cols)};`);
      } else {
        const on = keys.map((k) => `t.${k.sql} = v.${k.sql}`).join(' AND ');
        stmts.push(
          `INSERT INTO ${tbl} (${colNames})\nSELECT ${cols.map((c) => `v.${c.sql}`).join(', ')}\nFROM (VALUES\n${part.map((r) => o.indent + rowValues(r, cols)).join(',\n')}\n) AS v (${colNames})\nWHERE NOT EXISTS (SELECT 1 FROM ${tbl} AS t WHERE ${on});`,
        );
      }
    }
  } else if (o.mode === 'merge' && keys.length) {
    const nonKey = cols.filter((c) => !keys.includes(c));
    for (const part of chunk(rows, per)) {
      const on = keys.map((k) => `t.${k.sql} = s.${k.sql}`).join(' AND ');
      const upd = nonKey.length ? `WHEN MATCHED THEN UPDATE SET ${nonKey.map((c) => `t.${c.sql} = s.${c.sql}`).join(', ')}\n` : '';
      stmts.push(
        `MERGE ${tbl} AS t\nUSING (VALUES\n${part.map((r) => o.indent + rowValues(r, cols)).join(',\n')}\n) AS s (${colNames})\nON ${on}\n${upd}WHEN NOT MATCHED THEN INSERT (${colNames}) VALUES (${cols.map((c) => `s.${c.sql}`).join(', ')});`,
      );
    }
  } else if (o.mode === 'update' && keys.length) {
    const nonKey = cols.filter((c) => !keys.includes(c));
    if (nonKey.length) {
      for (const r of rows) {
        stmts.push(`UPDATE ${tbl} SET ${nonKey.map((c) => `${c.sql} = ${cellSql(r, c)}`).join(', ')} WHERE ${keys.map((k) => `${k.sql} = ${cellSql(r, k)}`).join(' AND ')};`);
      }
    }
  }

  return { sql: wrapDml(stmts, tbl, o, rows.length, cols, warnings), rows: rows.length, statements: stmts.length, warnings };
}

function wrapDml(stmts: string[], tbl: string, o: DmlOptions, rowCount: number, cols: ColumnPlan[], warnings: string[]): string {
  if (!stmts.length) return '';
  const lines: string[] = [];
  if (o.header) lines.push(`-- ${tbl}: ${rowCount} row(s), ${o.mode === 'insert' ? 'INSERT' : o.mode === 'insert-missing' ? 'INSERT if missing' : o.mode === 'merge' ? 'MERGE (insert or update)' : 'UPDATE'}`);
  if (o.transaction) lines.push('SET XACT_ABORT ON;', 'BEGIN TRANSACTION;');
  const identity = o.identityInsert && o.mode !== 'update';
  if (identity) lines.push(`SET IDENTITY_INSERT ${tbl} ON;`);

  stmts.forEach((s, i) => {
    lines.push(s);
    if (o.goEvery > 0 && (i + 1) % o.goEvery === 0 && i < stmts.length - 1) lines.push('GO');
  });

  if (identity) lines.push(`SET IDENTITY_INSERT ${tbl} OFF;`);
  if (o.printSummary) lines.push(`PRINT '${tbl.replace(/'/g, "''")}: ${rowCount} row(s) processed';`);
  if (o.transaction) lines.push('COMMIT TRANSACTION;');
  if (o.transaction && o.goEvery > 0) warnings.push('GO inside a transaction is allowed, but a failure in one batch leaves the later batches running. XACT_ABORT ON rolls everything back.');
  if (cols.length > 1000) warnings.push('More than 1000 columns.');
  return lines.join('\n') + '\n';
}

/** DELETE statements that remove exactly the scripted rows (for a rollback script). */
export function buildDeletes(g: Grid, o: DmlOptions, sqlTypes?: Map<string, { type: string; identity: boolean }>): string {
  const cols = planColumns(g, { ...o, skip: [] }, sqlTypes);
  const keys = keyCols(cols, o.keys);
  if (!keys.length) return '';
  const tbl = tableIdent(o.table, o);
  if (keys.length === 1) {
    return (
      chunk(g.rows, 1000)
        .map((part) => `DELETE FROM ${tbl} WHERE ${keys[0].sql} IN (${part.map((r) => cellSql(r, keys[0])).join(', ')});`)
        .join('\n') + '\n'
    );
  }
  return g.rows.map((r) => `DELETE FROM ${tbl} WHERE ${keys.map((k) => `${k.sql} = ${cellSql(r, k)}`).join(' AND ')};`).join('\n') + '\n';
}

/* ---------------------------------------------------------------- comparing ------ */

export interface DataDelta {
  sql: string;
  added: number;
  changed: number;
  same: number;
  targetOnly: number;
  warnings: string[];
}

const same = (a: string | null, b: string | null): boolean => {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (NUM.test(a) && NUM.test(b)) return Number(a) === Number(b);
  return a.trim() === b.trim();
};

/** Rows that exist only in `src` become INSERTs, rows whose values differ become UPDATEs of the changed columns only. */
export function dataDelta(src: Grid, tgt: Grid, o: DmlOptions, sqlTypes?: Map<string, { type: string; identity: boolean }>): DataDelta {
  const warnings: string[] = [];
  const cols = planColumns(src, o, sqlTypes);
  const keys = keyCols(cols, o.keys);
  const empty: DataDelta = { sql: '', added: 0, changed: 0, same: 0, targetOnly: 0, warnings };
  if (!keys.length) return { ...empty, warnings: ['Choose at least one key column to compare the two copies.'] };

  const tIndex = new Map<string, number>();
  tgt.headers.forEach((h, i) => tIndex.set(h.toLowerCase(), i));
  const missingCols = cols.filter((c) => c.index >= 0 && !fixedValue(c) && !tIndex.has(c.name.toLowerCase()));
  if (missingCols.length) warnings.push(`Column(s) ${missingCols.map((c) => c.name).join(', ')} are not in the target data. They are compared as NULL.`);

  const tKey = (r: (string | null)[]) => keys.map((k) => r[tIndex.get(k.name.toLowerCase()) ?? -1] ?? '').join('\u0001');
  const tMap = new Map<string, (string | null)[]>();
  tgt.rows.forEach((r) => tMap.set(tKey(r), r));

  const added: (string | null)[][] = [];
  const updates: string[] = [];
  let same_ = 0;
  const seen = new Set<string>();
  const tbl = tableIdent(o.table, o);

  for (const r of src.rows) {
    const k = keys.map((c) => r[c.index] ?? '').join('\u0001');
    seen.add(k);
    const t = tMap.get(k);
    if (!t) {
      added.push(r);
      continue;
    }
    // Columns set by an "always" rule (UpdatedOn = GETDATE()) are not compared, but they are
    // written on every row that really changed.
    const nonKey = cols.filter((c) => !keys.includes(c));
    const diff = nonKey.filter((c) => !fixedValue(c)).filter((c) => !same(r[c.index], t[tIndex.get(c.name.toLowerCase()) ?? -1] ?? null));
    if (!diff.length) same_++;
    else {
      const set = [...diff, ...nonKey.filter(fixedValue)];
      updates.push(`UPDATE ${tbl} SET ${set.map((c) => `${c.sql} = ${cellSql(r, c)}`).join(', ')} WHERE ${keys.map((c) => `${c.sql} = ${cellSql(r, c)}`).join(' AND ')};`);
    }
  }
  let targetOnly = 0;
  tMap.forEach((_, k) => {
    if (!seen.has(k)) targetOnly++;
  });

  const parts: string[] = [];
  if (added.length) {
    const g: Grid = { headers: src.headers, rows: added, delimiter: src.delimiter, warnings: [] };
    const ins = buildDml(g, { ...o, mode: o.mode === 'insert' || o.mode === 'insert-missing' ? o.mode : 'insert', header: false, printSummary: false, transaction: false, goEvery: 0 }, sqlTypes);
    parts.push(`-- ${added.length} new row(s)\n${ins.sql.trimEnd()}`);
  }
  if (updates.length) parts.push(`-- ${updates.length} changed row(s)\n${updates.join('\n')}`);
  if (targetOnly) parts.push(`-- ${targetOnly} row(s) exist only in the target. They are not touched.`);

  const body = parts.join('\n\n');
  let sql = '';
  if (body) {
    const id = o.identityInsert && added.length;
    sql = [
      o.header ? `-- ${tbl}: ${added.length} insert(s), ${updates.length} update(s)` : '',
      o.transaction ? 'SET XACT_ABORT ON;\nBEGIN TRANSACTION;' : '',
      id ? `SET IDENTITY_INSERT ${tbl} ON;` : '',
      body,
      id ? `SET IDENTITY_INSERT ${tbl} OFF;` : '',
      o.printSummary ? `PRINT '${tbl.replace(/'/g, "''")}: ${added.length} inserted, ${updates.length} updated';` : '',
      o.transaction ? 'COMMIT TRANSACTION;' : '',
    ]
      .filter(Boolean)
      .join('\n') + '\n';
  }
  return { sql, added: added.length, changed: updates.length, same: same_, targetOnly, warnings };
}