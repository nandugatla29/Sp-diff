import { lex, parse } from './sqlparse';
import type { LTok as Tok } from './sqlparse';

/* =====================================================================================
 * Table scripts: turns the noisy output of SSMS "Generate Scripts" into a clean CREATE TABLE
 * (defaults inline with the column, no USE / GO / SET / ON [PRIMARY] / WITH (...) noise),
 * and compares two table definitions to produce ALTER scripts.
 * ===================================================================================== */

export interface DefaultDef {
  name?: string;
  expr: string; // already cleaned, e.g. "0", "GETDATE()", "('a' + 'b')"
}

export interface Col {
  name: string;
  type: string; // e.g. "nvarchar(50)"
  identity?: string; // "IDENTITY(1,1)"
  nullable: '' | 'NULL' | 'NOT NULL';
  collate?: string;
  computed?: string; // "AS (expr) PERSISTED"
  def?: DefaultDef;
  tail: string[]; // anything else that was attached to the column (ROWGUIDCOL, SPARSE ...)
}

export type ConKind = 'pk' | 'unique' | 'check' | 'fk';

export interface Con {
  kind: ConKind;
  name?: string;
  clustered?: 'CLUSTERED' | 'NONCLUSTERED';
  cols: string[]; // "Id", "Name DESC"
  expr?: string; // CHECK expression
  refTable?: string;
  refCols?: string[];
  actions?: string; // "ON DELETE CASCADE ON UPDATE NO ACTION"
}

export interface Idx {
  name: string;
  unique: boolean;
  clustered: '' | 'CLUSTERED' | 'NONCLUSTERED';
  cols: string[];
  include: string[];
  where?: string;
}

export interface TableDef {
  schema: string;
  name: string;
  cols: Col[];
  cons: Con[];
  idx: Idx[];
  ext: string[]; // extended property statements (descriptions)
}

export interface ParsedDdl {
  tables: TableDef[];
  others: string[]; // statements that were not recognised, kept as they are
  skipped: number; // SET / USE / GO / CHECK CONSTRAINT statements that were dropped
}

export interface DdlOptions {
  brackets: 'smart' | 'keep'; // smart = only where needed
  upper: boolean; // upper-case keywords and data types
  fk: 'inline' | 'after';
  namedDefaults: boolean; // keep CONSTRAINT DF_... names
  indexes: boolean;
  descriptions: boolean; // keep extended properties
  guard: boolean; // IF OBJECT_ID(...) IS NULL / IF NOT EXISTS ... so the script can be re-run
  go: boolean; // GO between statements
  align: boolean; // align column names and types
  indent: string;
  keepSchema: boolean; // dbo.T vs T
}

export const defaultDdlOptions: DdlOptions = {
  brackets: 'smart',
  upper: true,
  fk: 'after',
  namedDefaults: true,
  indexes: true,
  descriptions: false,
  guard: false,
  go: false,
  align: true,
  indent: '    ',
  keepSchema: true,
};

const SIMPLE = /^[A-Za-z_][\w$#@]*$/;
const RESERVED_NAMES = new Set(
  'ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FROM FULL FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENQUERY OPENROWSET OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SELECT SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WRITETEXT DATE TIME'.split(' '),
);

const unbracket = (s: string) =>
  s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1).replace(/\]\]/g, ']') : s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;

/** Identifier as it should be written. */
export function ident(raw: string, o: Pick<DdlOptions, 'brackets'>): string {
  const n = unbracket(raw);
  if (o.brackets === 'keep') return `[${n.replace(/]/g, ']]')}]`;
  return SIMPLE.test(n) && !RESERVED_NAMES.has(n.toUpperCase()) ? n : `[${n.replace(/]/g, ']]')}]`;
}

function objName(schema: string, name: string, o: DdlOptions): string {
  return o.keepSchema || schema.toLowerCase() !== 'dbo' ? `${ident(schema, o)}.${ident(name, o)}` : ident(name, o);
}

/* ---------------------------------------------------------------- reading -------- */

interface Ctx {
  text: string;
  toks: Tok[];
}

const slice = (c: Ctx, a: number, b: number) => (a > b || !c.toks[a] || !c.toks[b] ? '' : c.text.slice(c.toks[a].from, c.toks[b].to));

/** Index of the token that closes the parenthesis opened at `i`. */
function closeOf(toks: Tok[], i: number): number {
  let d = 0;
  for (let k = i; k < toks.length; k++) {
    if (toks[k].text === '(') d++;
    else if (toks[k].text === ')' && --d === 0) return k;
  }
  return toks.length - 1;
}

/** Splits toks[a..b] at depth-0 commas. */
function splitCommas(toks: Tok[], a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let d = 0;
  let s = a;
  for (let k = a; k <= b; k++) {
    const t = toks[k].text;
    if (t === '(') d++;
    else if (t === ')') d--;
    else if (t === ',' && d === 0) {
      out.push([s, k - 1]);
      s = k + 1;
    }
  }
  if (s <= b) out.push([s, b]);
  return out;
}

function readName(toks: Tok[], i: number): { schema: string; name: string; next: number } {
  const parts: string[] = [];
  let k = i;
  while (k < toks.length) {
    if (toks[k].kind !== 'id' && toks[k].kind !== 'kw') break;
    parts.push(unbracket(toks[k].text));
    k++;
    if (toks[k]?.text === '.') k++;
    else break;
  }
  const name = parts.pop() ?? '';
  const schema = parts.pop() ?? 'dbo';
  return { schema, name, next: k };
}

function bracketsOut(s: string, o: Pick<DdlOptions, 'brackets'>): string {
  const toks = lex(s).toks;
  let out = s;
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i];
    if (t.kind === 'id' && t.text.startsWith('[')) out = out.slice(0, t.from) + ident(t.text, o) + out.slice(t.to);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function unwrap(expr: string): string {
  let s = expr.trim();
  for (;;) {
    const toks = lex(s).toks;
    if (toks.length >= 2 && toks[0].text === '(' && closeOf(toks, 0) === toks.length - 1) s = s.slice(toks[0].to, toks[toks.length - 1].from).trim();
    else return s;
  }
}

const FUNCS = ['GETDATE', 'GETUTCDATE', 'SYSDATETIME', 'SYSUTCDATETIME', 'SYSDATETIMEOFFSET', 'NEWID', 'NEWSEQUENTIALID', 'SUSER_SNAME', 'SYSTEM_USER', 'USER_NAME', 'CURRENT_TIMESTAMP', 'HOST_NAME', 'APP_NAME'];

/** DEFAULT ((0)) -> 0, DEFAULT (getdate()) -> GETDATE(), DEFAULT ('') -> '' */
function cleanDefault(raw: string, o: DdlOptions): string {
  let s = bracketsOut(unwrap(raw), o);
  if (o.upper) s = s.replace(new RegExp(`\\b(${FUNCS.join('|')})\\b`, 'gi'), (m) => m.toUpperCase());
  const toks = lex(s).toks;
  const single = toks.length === 1;
  const call = toks.length >= 3 && (toks[0].kind === 'id' || toks[0].kind === 'kw') && toks[1].text === '(' && closeOf(toks, 1) === toks.length - 1;
  const neg = toks.length === 2 && toks[0].text === '-' && toks[1].kind === 'num';
  return single || call || neg ? s : `(${s})`;
}

function readColList(c: Ctx, a: number, b: number, o: DdlOptions): string[] {
  return splitCommas(c.toks, a, b).map(([x, y]) => {
    const name = ident(c.toks[x].text, o);
    const dir = c.toks[y].up === 'DESC' ? ' DESC' : '';
    return name + dir;
  });
}

function readType(c: Ctx, i: number, o: DdlOptions): { type: string; next: number } {
  const t = c.toks;
  let k = i;
  const nm: string[] = [];
  while (k < t.length && (t[k].kind === 'id' || t[k].kind === 'kw')) {
    nm.push(unbracket(t[k].text));
    k++;
    if (t[k]?.text === '.') k++;
    else break;
  }
  let type = nm.length === 1 ? (o.upper ? nm[0].toUpperCase() : nm[0].toLowerCase()) : nm.map((p, ix) => (ix === nm.length - 1 ? p : p)).join('.');
  if (nm.length === 1 && t[k]?.up === 'VARYING') {
    type += ' VARYING';
    k++;
  }
  if (t[k]?.text === '(') {
    const e = closeOf(t, k);
    const args = splitCommas(t, k + 1, e - 1)
      .map(([x, y]) => {
        const s = slice(c, x, y).trim();
        return /^max$/i.test(s) ? (o.upper ? 'MAX' : 'max') : s;
      })
      .join(', ');
    type += `(${args})`;
    k = e + 1;
  }
  return { type, next: k };
}

const COL_STOP = new Set(['NOT', 'NULL', 'CONSTRAINT', 'COLLATE', 'IDENTITY', 'ROWGUIDCOL', 'SPARSE', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK', 'DEFAULT', 'FOR']);

function readColumn(c: Ctx, a: number, b: number, o: DdlOptions): Col {
  const t = c.toks;
  const col: Col = { name: unbracket(t[a].text), type: '', nullable: '', tail: [] };
  let k = a + 1;

  if (t[k]?.up === 'AS') {
    col.computed = bracketsOut(slice(c, k, b), o);
    if (o.upper) col.computed = col.computed.replace(/\bpersisted\b/gi, 'PERSISTED');
    return col;
  }
  const ty = readType(c, k, o);
  col.type = ty.type;
  k = ty.next;

  while (k <= b) {
    const up = t[k].up;
    if (up === 'IDENTITY') {
      if (t[k + 1]?.text === '(') {
        const e = closeOf(t, k + 1);
        col.identity = `IDENTITY(${splitCommas(t, k + 2, e - 1).map(([x, y]) => slice(c, x, y).trim()).join(', ')})`;
        k = e + 1;
      } else {
        col.identity = 'IDENTITY';
        k++;
      }
    } else if (up === 'NOT' && t[k + 1]?.up === 'NULL') {
      col.nullable = 'NOT NULL';
      k += 2;
    } else if (up === 'NULL') {
      col.nullable = 'NULL';
      k++;
    } else if (up === 'COLLATE') {
      col.collate = t[k + 1]?.text;
      k += 2;
    } else if (up === 'CONSTRAINT' || up === 'DEFAULT') {
      let name: string | undefined;
      let j = k;
      if (up === 'CONSTRAINT') {
        name = unbracket(t[k + 1].text);
        j = k + 2;
      }
      if (t[j]?.up === 'DEFAULT') {
        j++;
        let e = j;
        let d = 0;
        while (e <= b) {
          if (t[e].text === '(') d++;
          else if (t[e].text === ')') d--;
          else if (d === 0 && COL_STOP.has(t[e].up) && e > j) break;
          e++;
        }
        col.def = { name, expr: cleanDefault(slice(c, j, e - 1), o) };
        k = e;
      } else {
        col.tail.push(bracketsOut(slice(c, k, b), o)); // inline PRIMARY KEY / CHECK etc.
        k = b + 1;
      }
    } else {
      col.tail.push(t[k].text);
      k++;
    }
  }
  return col;
}

function readConstraint(c: Ctx, a: number, b: number, o: DdlOptions): Con | null {
  const t = c.toks;
  let k = a;
  let name: string | undefined;
  if (t[k]?.up === 'CONSTRAINT') {
    name = unbracket(t[k + 1].text);
    k += 2;
  }
  const up = t[k]?.up;
  if (up === 'PRIMARY' || up === 'UNIQUE') {
    k += up === 'PRIMARY' ? 2 : 1;
    let clustered: Con['clustered'];
    if (t[k]?.up === 'CLUSTERED' || t[k]?.up === 'NONCLUSTERED') {
      clustered = t[k].up as Con['clustered'];
      k++;
    }
    const open = t.findIndex((x, i) => i >= k && i <= b && x.text === '(');
    if (open < 0) return null;
    return { kind: up === 'PRIMARY' ? 'pk' : 'unique', name, clustered, cols: readColList(c, open + 1, closeOf(t, open) - 1, o) };
  }
  if (up === 'CHECK') {
    const open = k + 1;
    return { kind: 'check', name, cols: [], expr: bracketsOut(slice(c, open, closeOf(t, open)), o) };
  }
  if (up === 'FOREIGN') {
    const open = t.findIndex((x, i) => i >= k && x.text === '(');
    const ce = closeOf(t, open);
    const cols = readColList(c, open + 1, ce - 1, o);
    const r = t.findIndex((x, i) => i > ce && x.up === 'REFERENCES');
    const rn = readName(t, r + 1);
    let refCols: string[] = [];
    let after = rn.next;
    if (t[after]?.text === '(') {
      const re = closeOf(t, after);
      refCols = readColList(c, after + 1, re - 1, o);
      after = re + 1;
    }
    const acts: string[] = [];
    for (let j = after; j <= b; j++) {
      if (t[j].up === 'ON' && (t[j + 1]?.up === 'DELETE' || t[j + 1]?.up === 'UPDATE')) {
        let e = j + 2;
        const words: string[] = [];
        while (e <= b && t[e].up !== 'ON' && t[e].up !== 'NOT') words.push(t[e].up), e++;
        acts.push(`ON ${t[j + 1].up} ${words.join(' ')}`);
        j = e - 1;
      }
    }
    return { kind: 'fk', name, cols, refTable: `${rn.schema}.${rn.name}`, refCols, actions: acts.join(' ') };
  }
  return null;
}

/** Reads every statement of an SSMS-generated script. */
export function parseDdl(text: string, o: DdlOptions = defaultDdlOptions): ParsedDdl {
  const P = parse(text);
  const out: ParsedDdl = { tables: [], others: [], skipped: 0 };
  const byKey = new Map<string, TableDef>();
  const key = (s: string, n: string) => `${s}.${n}`.toLowerCase();
  const find = (s: string, n: string) => byKey.get(key(s, n));

  for (const u of P.units) {
    const toks = P.code.slice(u.t0, u.t1 + 1).filter((x) => x.text !== ';');
    if (!toks.length) continue;
    const c: Ctx = { text, toks };
    const first = toks[0].up;
    const raw = () => text.slice(toks[0].from, toks[toks.length - 1].to).trim();

    if (first === 'GO' || first === 'USE' || (first === 'SET' && /^(ANSI_|QUOTED_IDENTIFIER|NOCOUNT|ARITHABORT)/.test(toks[1]?.up ?? ''))) {
      out.skipped++;
      continue;
    }

    if (first === 'CREATE' && toks[1]?.up === 'TABLE') {
      const nm = readName(toks, 2);
      const open = toks.findIndex((x, i) => i >= nm.next && x.text === '(');
      if (open < 0) {
        out.others.push(raw());
        continue;
      }
      const end = closeOf(toks, open);
      const def: TableDef = { schema: nm.schema, name: nm.name, cols: [], cons: [], idx: [], ext: [] };
      for (const [a, b] of splitCommas(toks, open + 1, end - 1)) {
        const up = toks[a].up;
        if (up === 'CONSTRAINT' || up === 'PRIMARY' || up === 'UNIQUE' || up === 'FOREIGN' || up === 'CHECK') {
          const con = readConstraint(c, a, b, o);
          if (con) def.cons.push(con);
          else out.others.push(slice(c, a, b));
        } else def.cols.push(readColumn(c, a, b, o));
      }
      byKey.set(key(def.schema, def.name), def);
      out.tables.push(def);
      continue;
    }

    if (first === 'ALTER' && toks[1]?.up === 'TABLE') {
      const nm = readName(toks, 2);
      const tbl = find(nm.schema, nm.name);
      let k = nm.next;
      if (toks[k]?.up === 'WITH') k += 2; // WITH CHECK / WITH NOCHECK
      if (toks[k]?.up === 'CHECK' && toks[k + 1]?.up === 'CONSTRAINT') {
        out.skipped++; // ALTER TABLE ... CHECK CONSTRAINT (SSMS noise)
        continue;
      }
      if (toks[k]?.up === 'ADD' && toks[k + 1]?.up === 'DEFAULT' && tbl) {
        const f = toks.findIndex((x, i) => i > k + 1 && x.up === 'FOR');
        const col = f > 0 ? tbl.cols.find((x) => x.name.toLowerCase() === unbracket(toks[f + 1].text).toLowerCase()) : undefined;
        if (col) {
          col.def = { expr: cleanDefault(slice(c, k + 2, f - 1), o) };
          continue;
        }
      }
      if (toks[k]?.up === 'ADD' && toks[k + 1]?.up === 'CONSTRAINT' && tbl) {
        const cname = unbracket(toks[k + 2].text);
        if (toks[k + 3]?.up === 'DEFAULT') {
          const f = toks.findIndex((x, i) => i > k + 3 && x.up === 'FOR' && toks[i + 1]);
          const colName = unbracket(toks[f + 1].text);
          const col = tbl.cols.find((x) => x.name.toLowerCase() === colName.toLowerCase());
          if (col) {
            col.def = { name: cname, expr: cleanDefault(slice(c, k + 4, f - 1), o) };
            continue;
          }
        } else {
          const con = readConstraint(c, k + 1, toks.length - 1, o);
          if (con) {
            tbl.cons.push(con);
            continue;
          }
        }
      }
      out.others.push(raw());
      continue;
    }

    if (first === 'CREATE' && toks.some((x) => x.up === 'INDEX') && !toks.some((x) => x.up === 'COLUMNSTORE' || x.up === 'FULLTEXT' || x.up === 'XML' || x.up === 'SPATIAL')) {
      let k = 1;
      const idx: Idx = { name: '', unique: false, clustered: '', cols: [], include: [] };
      if (toks[k].up === 'UNIQUE') (idx.unique = true), k++;
      if (toks[k].up === 'CLUSTERED' || toks[k].up === 'NONCLUSTERED') (idx.clustered = toks[k].up as Idx['clustered']), k++;
      k++; // INDEX
      idx.name = unbracket(toks[k].text);
      k += 2; // name ON
      const nm = readName(toks, k);
      const tbl = find(nm.schema, nm.name);
      const open = toks.findIndex((x, i) => i >= nm.next && x.text === '(');
      const ce = closeOf(toks, open);
      idx.cols = readColList(c, open + 1, ce - 1, o);
      let j = ce + 1;
      if (toks[j]?.up === 'INCLUDE') {
        const ie = closeOf(toks, j + 1);
        idx.include = readColList(c, j + 2, ie - 1, o);
        j = ie + 1;
      }
      if (toks[j]?.up === 'WHERE') {
        let e = j + 1;
        while (e < toks.length && toks[e].up !== 'WITH' && toks[e].up !== 'ON') e++;
        idx.where = bracketsOut(slice(c, j + 1, e - 1), o);
      }
      if (tbl) {
        tbl.idx.push(idx);
        continue;
      }
      out.others.push(raw());
      continue;
    }

    if ((first === 'EXEC' || first === 'EXECUTE') && /sp_addextendedproperty/i.test(raw())) {
      const lvl = raw();
      const m = /@level1name\s*=\s*N?'([^']+)'/i.exec(lvl);
      const tbl = m ? out.tables.find((t) => t.name.toLowerCase() === m[1].toLowerCase()) : undefined;
      if (tbl) tbl.ext.push(raw());
      else out.others.push(raw());
      continue;
    }

    out.others.push(raw());
  }
  return out;
}

/* ---------------------------------------------------------------- writing -------- */

const kw = (s: string, o: DdlOptions) => (o.upper ? s.toUpperCase() : s.toLowerCase());

function colParts(col: Col, o: DdlOptions): { name: string; type: string; rest: string } {
  const name = ident(col.name, o);
  if (col.computed) return { name, type: '', rest: col.computed };
  const rest: string[] = [];
  if (col.identity) rest.push(kw(col.identity, o));
  if (col.collate) rest.push(`${kw('COLLATE', o)} ${col.collate}`);
  if (col.nullable) rest.push(kw(col.nullable, o));
  if (col.def) {
    const named = o.namedDefaults && col.def.name ? `${kw('CONSTRAINT', o)} ${ident(col.def.name, o)} ` : '';
    rest.push(`${named}${kw('DEFAULT', o)} ${col.def.expr}`);
  }
  col.tail.forEach((t) => rest.push(/^[A-Za-z_]+$/.test(t) && o.upper ? t.toUpperCase() : t));
  return { name, type: col.type, rest: rest.join(' ') };
}

const colList = (cols: string[]) => cols.map((c) => c.replace(/ ASC$/i, '')).join(', ');

function conSql(con: Con, o: DdlOptions): string {
  const nm = con.name ? `${kw('CONSTRAINT', o)} ${ident(con.name, o)} ` : '';
  if (con.kind === 'pk' || con.kind === 'unique') {
    const t = con.kind === 'pk' ? kw('PRIMARY KEY', o) : kw('UNIQUE', o);
    return `${nm}${t}${con.clustered ? ' ' + kw(con.clustered, o) : ''} (${colList(con.cols)})`;
  }
  if (con.kind === 'check') return `${nm}${kw('CHECK', o)} (${con.expr!.replace(/^\((.*)\)$/, '$1')})`;
  const [rs, rn] = (con.refTable ?? '.').split('.');
  const ref = objName(rs, rn, o);
  return `${nm}${kw('FOREIGN KEY', o)} (${colList(con.cols)}) ${kw('REFERENCES', o)} ${ref} (${colList(con.refCols ?? [])})${con.actions ? ' ' + kw(con.actions, o) : ''}`;
}

function idxSql(t: TableDef, ix: Idx, o: DdlOptions): string {
  const head = `${kw('CREATE', o)} ${ix.unique ? kw('UNIQUE', o) + ' ' : ''}${ix.clustered ? kw(ix.clustered, o) + ' ' : ''}${kw('INDEX', o)} ${ident(ix.name, o)}`;
  let s = `${head} ${kw('ON', o)} ${objName(t.schema, t.name, o)} (${colList(ix.cols)})`;
  if (ix.include.length) s += ` ${kw('INCLUDE', o)} (${colList(ix.include)})`;
  if (ix.where) s += ` ${kw('WHERE', o)} ${ix.where}`;
  return s + ';';
}

const q = (s: string) => s.replace(/'/g, "''");

export function tableSql(t: TableDef, o: DdlOptions): string {
  const rows = t.cols.map((c) => colParts(c, o));
  const wName = o.align ? Math.max(0, ...rows.map((r) => r.name.length)) : 0;
  const wType = o.align ? Math.max(0, ...rows.map((r) => r.type.length)) : 0;
  const lines: string[] = rows.map((r) => {
    const parts = r.type ? [r.name.padEnd(wName), r.type.padEnd(wType), r.rest] : [r.name.padEnd(wName), r.rest];
    return parts.join(' ').trimEnd();
  });
  const inline = t.cons.filter((c) => c.kind !== 'fk' || o.fk === 'inline').map((c) => conSql(c, o));
  const all = [...lines, ...inline];
  const body = all.map((l, i) => `${o.indent}${l}${i < all.length - 1 ? ',' : ''}`).join('\n');
  const create = `${kw('CREATE TABLE', o)} ${objName(t.schema, t.name, o)} (\n${body}\n);`;
  if (!o.guard) return create;
  const inner = create.split('\n').map((l) => o.indent + l).join('\n');
  return `${kw('IF', o)} OBJECT_ID(N'${q(objName(t.schema, t.name, { ...o, brackets: 'keep' }).replace(/[[\]]/g, ''))}', N'U') ${kw('IS NULL', o)}\n${kw('BEGIN', o)}\n${inner}\n${kw('END', o)};`;
}

const plain = (t: TableDef) => `${t.schema}.${t.name}`;

function guardedIndex(t: TableDef, ix: Idx, o: DdlOptions): string {
  const sql = idxSql(t, ix, o);
  if (!o.guard) return sql;
  return `${kw('IF NOT EXISTS', o)} (SELECT 1 FROM sys.indexes WHERE name = N'${q(ix.name)}' AND object_id = OBJECT_ID(N'${q(plain(t))}'))\n${o.indent}${sql}`;
}

function fkAlter(t: TableDef, con: Con, o: DdlOptions): string {
  const sql = `${kw('ALTER TABLE', o)} ${objName(t.schema, t.name, o)} ${kw('ADD', o)} ${conSql(con, o)};`;
  if (!o.guard || !con.name) return sql;
  return `${kw('IF NOT EXISTS', o)} (SELECT 1 FROM sys.foreign_keys WHERE name = N'${q(con.name)}' AND parent_object_id = OBJECT_ID(N'${q(plain(t))}'))\n${o.indent}${sql}`;
}

export interface TableScript {
  sql: string;
  tables: number;
  notes: string[];
}

/** Clean script for every table found in the pasted text. */
export function cleanTables(text: string, o: DdlOptions = defaultDdlOptions): TableScript {
  const p = parseDdl(text, o);
  const sep = o.go ? '\nGO\n\n' : '\n\n';
  const blocks: string[] = [];
  const notes: string[] = [];

  for (const t of p.tables) {
    blocks.push(tableSql(t, o));
    if (o.indexes) t.idx.forEach((ix) => blocks.push(guardedIndex(t, ix, o)));
    if (o.descriptions) t.ext.forEach((e) => blocks.push(e.endsWith(';') ? e : e + ';'));
  }
  if (o.fk === 'after') for (const t of p.tables) for (const c of t.cons) if (c.kind === 'fk') blocks.push(fkAlter(t, c, o));

  const droppedDesc = p.tables.reduce((n, t) => n + t.ext.length, 0);
  if (droppedDesc && !o.descriptions) notes.push(`${droppedDesc} description(s) (extended properties) were left out. Turn on "Keep descriptions" to include them.`);
  if (p.others.length) {
    notes.push(`${p.others.length} statement(s) were not recognised and are kept at the end.`);
    p.others.forEach((s) => blocks.push(s.endsWith(';') ? s : s + ';'));
  }
  if (!p.tables.length) notes.push('No CREATE TABLE statement found in the pasted text.');
  notes.push(`${p.skipped} line(s) of SSMS noise removed (USE, GO, SET ..., CHECK CONSTRAINT).`);

  return { sql: blocks.length ? blocks.join(sep) + (o.go ? '\nGO\n' : '\n') : '', tables: p.tables.length, notes };
}

/* ---------------------------------------------------------------- delta ---------- */

function colSql(col: Col, o: DdlOptions): string {
  const p = colParts(col, o);
  return [p.name, p.type, p.rest].filter(Boolean).join(' ');
}

const sameType = (a: Col, b: Col) => a.type.toLowerCase() === b.type.toLowerCase() && a.nullable === b.nullable;

/** ALTER script that brings `target` (for example production) up to `source` (for example UAT). */
export function tableDelta(sourceText: string, targetText: string, o: DdlOptions = defaultDdlOptions): TableScript {
  const src = parseDdl(sourceText, o).tables;
  const tgt = parseDdl(targetText, o).tables;
  const out: string[] = [];
  const notes: string[] = [];
  let changes = 0;

  for (const s of src) {
    const t = tgt.find((x) => plain(x).toLowerCase() === plain(s).toLowerCase());
    if (!t) {
      out.push(`-- ${plain(s)} does not exist in the target: full script\n${tableSql(s, o)}`);
      s.idx.forEach((ix) => out.push(guardedIndex(s, ix, o)));
      changes++;
      continue;
    }
    const name = objName(s.schema, s.name, o);
    const lines: string[] = [];

    for (const c of s.cols) {
      const tc = t.cols.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
      if (!tc) {
        const risky = c.nullable === 'NOT NULL' && !c.def && !c.identity;
        lines.push(
          `${risky ? `-- NOTE: NOT NULL column without a default fails when the table already has rows. Add a DEFAULT or make it NULL first.\n` : ''}${kw('IF', o)} COL_LENGTH(N'${q(plain(s))}', N'${q(c.name)}') ${kw('IS NULL', o)}\n${o.indent}${kw('ALTER TABLE', o)} ${name} ${kw('ADD', o)} ${colSql(c, o)};`,
        );
      } else {
        if (!sameType(c, tc) && !c.computed)
          lines.push(`-- ${c.name}: target has ${tc.type} ${tc.nullable}, source has ${c.type} ${c.nullable}. Check the data before running.\n${kw('ALTER TABLE', o)} ${name} ${kw('ALTER COLUMN', o)} ${ident(c.name, o)} ${c.type} ${c.nullable};`);
        if (c.def && !tc.def)
          lines.push(`${kw('ALTER TABLE', o)} ${name} ${kw('ADD', o)} ${c.def.name ? `${kw('CONSTRAINT', o)} ${ident(c.def.name, o)} ` : ''}${kw('DEFAULT', o)} ${c.def.expr} ${kw('FOR', o)} ${ident(c.name, o)};`);
      }
    }
    for (const tc of t.cols) if (!s.cols.some((x) => x.name.toLowerCase() === tc.name.toLowerCase())) lines.push(`-- ${tc.name} exists only in the target. Nothing is dropped automatically.`);

    for (const con of s.cons) {
      if (con.name && !t.cons.some((x) => x.name?.toLowerCase() === con.name!.toLowerCase())) {
        lines.push(con.kind === 'fk' ? fkAlter(s, con, { ...o, guard: true }) : `${kw('ALTER TABLE', o)} ${name} ${kw('ADD', o)} ${conSql(con, o)};`);
      }
    }
    for (const ix of s.idx) if (!t.idx.some((x) => x.name.toLowerCase() === ix.name.toLowerCase())) lines.push(guardedIndex(s, ix, { ...o, guard: true }));

    if (lines.length) {
      out.push(`-- ${plain(s)}\n${lines.join('\n')}`);
      changes += lines.length;
    }
  }
  for (const t of tgt) if (!src.some((x) => plain(x).toLowerCase() === plain(t).toLowerCase())) notes.push(`${plain(t)} exists only in the target and was ignored.`);
  if (!changes) notes.push('No differences found between the two table definitions.');
  return { sql: out.join('\n\n') + (out.length ? '\n' : ''), tables: src.length, notes };
}

/** Column names and types of every table, used to quote INSERT values correctly. */
export function columnTypes(text: string): Map<string, { type: string; identity: boolean }> {
  const map = new Map<string, { type: string; identity: boolean }>();
  for (const t of parseDdl(text).tables) for (const c of t.cols) map.set(c.name.toLowerCase(), { type: c.type.toLowerCase(), identity: !!c.identity });
  return map;
}

export function firstTable(text: string): { schema: string; name: string; pk: string[] } | null {
  const t = parseDdl(text).tables[0];
  if (!t) return null;
  const pk = t.cons.find((c) => c.kind === 'pk');
  return { schema: t.schema, name: t.name, pk: pk ? pk.cols.map((c) => c.replace(/ DESC$/i, '')) : [] };
}
