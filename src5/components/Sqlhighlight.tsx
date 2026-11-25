
// import type { ReactNode } from 'react';
// import type { VarMarks } from '../types';

// const KEYWORDS = new Set(
//   `ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FULLTEXT FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NOCOUNT NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SEMANTICKEYPHRASETABLE SEMANTICSIMILARITYDETAILSTABLE SEMANTICSIMILARITYTABLE SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT TRY CATCH THROW IIF APPLY PERCENTILE_CONT PERCENTILE_DISC STRING_AGG STRING_ESCAPE STRING_SPLIT OPENJSON JSON_VALUE JSON_QUERY JSON_MODIFY DATEADD DATEDIFF DATEPART DATENAME GETDATE GETUTCDATE SYSDATETIME SYSUTCDATETIME ISNULL CAST TRY_CAST COUNT COUNT_BIG SUM AVG MIN MAX ABS ROUND CEILING FLOOR LEN SUBSTRING CHARINDEX PATINDEX REPLACE STUFF CONCAT CONCAT_WS UPPER LOWER LTRIM RTRIM TRIM REPLICATE REVERSE FORMAT ROW_NUMBER RANK DENSE_RANK NTILE PARTITION LAG LEAD FIRST_VALUE LAST_VALUE GO`
//     .split(/\s+/)
//     .map((word) => word.toUpperCase())
// );

// const TOKEN_RE =
//   /--[^\r\n]*|\/\*[\s\S]*?\*\/|N?'(?:''|[^'])*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"|@@?[A-Za-z_][\w$#@]*|(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|[A-Za-z_][\w$#@]*|<>|!=|<=|>=|!<|!>|::|:=|[-+*/%=<>~^&|]+|[^\s]/g;

// interface Props {
//   text: string;
//   marks?: VarMarks;
// }

// export default function SqlHighlight({ text, marks }: Props) {
//   const nodes: ReactNode[] = [];
//   let last = 0;
//   let match: RegExpExecArray | null;

//   TOKEN_RE.lastIndex = 0;

//   while ((match = TOKEN_RE.exec(text)) !== null) {
//     const token = match[0];
//     const start = match.index;

//     if (start > last) {
//       nodes.push(text.slice(last, start));
//     }

//     let cls = '';
//     let title: string | undefined;
//     const upper = token.toUpperCase();
//     const lower = token.toLowerCase();

//     if (token.startsWith('--') || token.startsWith('/*')) {
//       cls = 'sql-comment';
//     } else if (/^N?'/.test(token)) {
//       cls = 'sql-string';
//     } else if (token.startsWith('[') || token.startsWith('"')) {
//       cls = 'sql-identifier';
//     } else if (/^@@?[A-Za-z_]/.test(token)) {
//       const varName = lower;

//       if (marks?.bad.has(varName)) {
//         cls = 'sql-var-bad';
//         title = 'Variable is used but not declared on this side';
//       } else if (marks?.only.has(varName)) {
//         cls = 'sql-var-only';
//         title = 'Variable exists only on one side';
//       } else {
//         cls = token.startsWith('@@')
//           ? 'sql-system-variable'
//           : 'sql-variable';
//       }
//     } else if (/^(?:0x[\da-f]+|\d)/i.test(token)) {
//       cls = 'sql-number';
//     } else if (KEYWORDS.has(upper)) {
//       cls = 'sql-keyword';
//     } else if (/^[A-Za-z_][\w$#@]*$/.test(token)) {
//       const next = text.slice(TOKEN_RE.lastIndex);
//       cls = /^\s*\(/.test(next) ? 'sql-function' : 'sql-identifier';
//     } else if (
//       /^(?:<>|!=|<=|>=|!<|!>|::|:=|[-+*/%=<>~^&|]+)$/.test(token)
//     ) {
//       cls = 'sql-operator';
//     }

//     nodes.push(
//       cls ? (
//         <span
//           key={`${start}-${token}`}
//           className={cls}
//           title={title}
//         >
//           {token}
//         </span>
//       ) : (
//         token
//       )
//     );

//     last = start + token.length;
//   }

//   if (last < text.length) {
//     nodes.push(text.slice(last));
//   }

//   return <>{nodes}</>;
// }



import type { ReactNode } from 'react';
import type { VarMarks } from '../types';

const KEYWORDS = new Set(`
ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FULLTEXT FUNCTION GOTO GRANT GROUP HAVING HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK NOCOUNT NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WITHIN WRITETEXT TRY CATCH THROW IIF APPLY PERCENTILE_CONT PERCENTILE_DISC STRING_AGG STRING_ESCAPE STRING_SPLIT OPENJSON JSON_VALUE JSON_QUERY JSON_MODIFY DATEADD DATEDIFF DATEPART DATENAME GETDATE GETUTCDATE SYSDATETIME SYSUTCDATETIME ISNULL CAST TRY_CAST COUNT COUNT_BIG SUM AVG MIN MAX ABS ROUND CEILING FLOOR LEN SUBSTRING CHARINDEX PATINDEX REPLACE STUFF CONCAT CONCAT_WS UPPER LOWER LTRIM RTRIM TRIM REPLICATE REVERSE FORMAT ROW_NUMBER RANK DENSE_RANK NTILE LAG LEAD FIRST_VALUE LAST_VALUE PARTITION GO
`.trim().split(/\s+/));

// Match one SQL token at a time so the original whitespace is preserved exactly.
const TOKEN_PATTERN = /(?:--[^\r\n]*|\/\*[\s\S]*?\*\/|N?'(?:''|[^'])*'|\[(?:[^\]]|\]\])*\]|"(?:""|[^"])*"|@@?[A-Za-z_][\w$#@]*|0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][\w$#@]*|<>|!=|<=|>=|!<|!>|::|:=|[-+*/%=<>~^&|]+|[^\s])/;

interface Props {
  text: string;
  marks?: VarMarks;
}

export interface SqlPiece {
  text: string;
  cls?: string;
  title?: string;
}

/** Splits SQL into coloured pieces (plain text between tokens has no class). Shared by the
 *  read-only code views and the editable text boxes. */
export function sqlPieces(text: string, marks?: VarMarks): SqlPiece[] {
  const out: SqlPiece[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const tokenRe = new RegExp(TOKEN_PATTERN.source, 'g');
  const fnRe = /\s*\(/y;

  while ((match = tokenRe.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    if (start > last) out.push({ text: text.slice(last, start) });

    let cls = '';
    let title: string | undefined;
    const upper = token.toUpperCase();
    const lower = token.toLowerCase();

    if (token.startsWith('--') || token.startsWith('/*')) {
      cls = 'sql-comment';
    } else if (/^N?'/i.test(token)) {
      cls = 'sql-string';
    } else if (token.startsWith('[') || token.startsWith('"')) {
      cls = 'sql-identifier';
    } else if (/^@@?[A-Za-z_]/.test(token)) {
      if (token.startsWith('@@')) {
        cls = 'sql-system-variable';
      } else if (marks?.bad.has(lower)) {
        cls = 'sql-var-bad';
        title = 'Variable is used but not declared on this side';
      } else if (marks?.only.has(lower)) {
        cls = 'sql-var-only';
        title = 'Variable exists only on one side';
      } else {
        cls = 'sql-variable';
      }
    } else if (/^(?:0x[\da-f]+|\d)/i.test(token)) {
      cls = 'sql-number';
    } else if (KEYWORDS.has(upper)) {
      cls = 'sql-keyword';
    } else if (/^[A-Za-z_][\w$#@]*$/.test(token)) {
      // a name followed by "(" is a function; checked in place (no copy of the rest of the text)
      fnRe.lastIndex = tokenRe.lastIndex;
      if (fnRe.test(text)) cls = 'sql-function';
    } else if (/^(?:<>|!=|<=|>=|!<|!>|::|:=|[-+*/%=<>~^&|]+)$/.test(token)) {
      cls = 'sql-operator';
    }

    out.push(cls ? { text: token, cls, title } : { text: token });
    last = start + token.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export default function SqlHighlight({ text, marks }: Props) {
  let pos = 0;
  const nodes: ReactNode[] = sqlPieces(text, marks).map((p) => {
    const start = pos;
    pos += p.text.length;
    return p.cls ? (
      <span key={`${start}-${p.text}`} className={p.cls} title={p.title}>
        {p.text}
      </span>
    ) : (
      p.text
    );
  });
  return <>{nodes}</>;
}
