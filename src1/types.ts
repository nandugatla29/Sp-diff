// export interface DiffOptions {
//   ignoreWhitespace: boolean;
//   ignoreCase: boolean;
//   ignoreComments: boolean;
//   ignoreBlankLines: boolean;
//   ignoreBrackets: boolean;
//   ignoreCreateAlter: boolean;
//   ignoreBoilerplate: boolean;
// }

// export interface Entry {
//   no: number;
//   text: string;
//   key: string;
// }

// export interface Seg {
//   text: string;
//   type: 'same' | 'add' | 'del';
// }

// export interface Cell extends Entry {
//   segs?: Seg[];
// }

// export type RowKind = 'equal' | 'added' | 'removed' | 'changed';

// export interface Row {
//   kind: RowKind;
//   left?: Cell;
//   right?: Cell;
// }

// export interface Stats {
//   added: number;
//   removed: number;
//   changed: number;
//   blocks: number;
// }

// export type AssistMode = 'explain' | 'review' | 'fix' | 'merge';
// export type Side = 'left' | 'right';

// export interface Finding {
//   severity: 'info' | 'low' | 'medium' | 'high';
//   title: string;
//   detail: string;
//   suggestion: string;
// }

// export interface AssistResult {
//   summary: string;
//   findings: Finding[];
//   sql: string | null;
// }

// export interface AssistRequest {
//   mode: AssistMode;
//   left: string;
//   right: string;
//   leftName: string;
//   rightName: string;
//   target: Side;
//   instruction?: string;
//   diffSummary?: string;
// }

// export type Risk = 'info' | 'low' | 'medium' | 'high';

// /** 1-based inclusive raw line numbers. */
// export interface Range {
//   from: number;
//   to: number;
// }

// export interface Hunk {
//   id: number;
//   sig: string; // stable across re-diffs, used for "reviewed"
//   rowStart: number;
//   rowEnd: number; // inclusive
//   kind: 'added' | 'removed' | 'changed';
//   left: Range | null;
//   right: Range | null;
//   leftAfter: number; // last left line before this hunk (insertion point)
//   rightAfter: number;
//   added: number; // lines only in right
//   removed: number; // lines only in left
//   changed: number;
//   title: string;
//   notes: string[];
//   risk: Risk;
//   preview: string;
// }

// export interface HunkSide {
//   before: string;
//   body: string;
//   after: string;
// }

// export interface HunkAssistRequest {
//   mode: 'explain' | 'fix';
//   target: Side;
//   leftName: string;
//   rightName: string;
//   instruction?: string;
//   left: HunkSide;
//   right: HunkSide;
// }

// export interface HunkAiResult {
//   explanation: string;
//   risk: Risk;
//   notes: string[];
//   replacement: string | null;
// }


export interface DiffOptions {
  ignoreWhitespace: boolean;
  /** Same code split or joined across lines counts as equal (needs ignoreWhitespace). */
  ignoreLineBreaks: boolean;
  ignoreCase: boolean;
  ignoreComments: boolean;
  ignoreBlankLines: boolean;
  ignoreBrackets: boolean;
  ignoreCreateAlter: boolean;
  ignoreBoilerplate: boolean;
  /** (NOLOCK) / WITH (NOLOCK) table hints. Off by default: they do change locking behaviour. */
  ignoreTableHints: boolean;
}

export interface Entry {
  no: number;
  text: string;
  key: string;
}

export interface Seg {
  text: string;
  type: 'same' | 'add' | 'del';
}

export interface Cell extends Entry {
  segs?: Seg[];
}

export type RowKind = 'equal' | 'added' | 'removed' | 'changed';

export interface Row {
  kind: RowKind;
  left?: Cell;
  right?: Cell;
}

export interface Stats {
  added: number;
  removed: number;
  changed: number;
  blocks: number;
}

export type AssistMode = 'explain' | 'review' | 'fix' | 'merge';
export type Side = 'left' | 'right';

export interface Finding {
  severity: 'info' | 'low' | 'medium' | 'high';
  title: string;
  detail: string;
  suggestion: string;
}

export interface AssistResult {
  summary: string;
  findings: Finding[];
  sql: string | null;
}

export interface AssistRequest {
  mode: AssistMode;
  left: string;
  right: string;
  leftName: string;
  rightName: string;
  target: Side;
  instruction?: string;
  diffSummary?: string;
}

export type Risk = 'info' | 'low' | 'medium' | 'high';

/** 1-based inclusive raw line numbers. */
export interface Range {
  from: number;
  to: number;
}

export interface Hunk {
  id: number;
  sig: string; // stable across re-diffs, used for "reviewed"
  rowStart: number;
  rowEnd: number; // inclusive
  kind: 'added' | 'removed' | 'changed';
  left: Range | null;
  right: Range | null;
  leftAfter: number; // last left line before this hunk (insertion point)
  rightAfter: number;
  added: number; // lines only in right
  removed: number; // lines only in left
  changed: number;
  title: string;
  notes: string[];
  risk: Risk;
  preview: string;
}

export interface HunkSide {
  before: string;
  body: string;
  after: string;
}

export interface HunkAssistRequest {
  mode: 'explain' | 'fix';
  target: Side;
  leftName: string;
  rightName: string;
  instruction?: string;
  left: HunkSide;
  right: HunkSide;
}

export interface HunkAiResult {
  explanation: string;
  risk: Risk;
  notes: string[];
  replacement: string | null;
}

/* ---------- folder compare ---------- */

export interface FolderFile {
  path: string; // display path, relative to the chosen folder
  text: string; // current (possibly edited) content
  orig?: string; // content when loaded; only present while the file differs from it
  created?: boolean; // file did not exist on this side when loaded
}

export interface FolderSide {
  name: string;
  files: Record<string, FolderFile>; // key = lower-case relative path
}

export interface FolderState {
  left: FolderSide;
  right: FolderSide;
}

export type FileStatus = 'same' | 'format' | 'modified' | 'left-only' | 'right-only';

export interface FolderEntry {
  key: string;
  path: string;
  status: FileStatus;
  left?: FolderFile;
  right?: FolderFile;
}

/* ---------- workspace ---------- */

export type Tab = 'folders' | 'input' | 'diff';
export type ViewMode = { kind: 'compare' } | { kind: 'review'; side: Side };

/** The text of the open pair as it was when it was loaded. Used for "what did I change" and revert. */
export interface Baseline {
  left: string;
  right: string;
}

export interface ChangeItem {
  id: string;
  side: Side;
  key: string | null;
  env: string;
  path: string;
  status: 'M' | 'A';
}

export interface Editable {
  left: boolean;
  right: boolean;
}

/** Variable markers used by the SQL comparison renderer. Names are case-insensitive. */
export interface VarMarks {
  only: Set<string>;
  bad: Set<string>;
}

/** A reviewed structural transfer proposal. `text` is the proposed destination text. */
export interface Plan {
  op: 'insert' | 'replace' | 'delete';
  target: Side;
  srcFrom: number;
  srcTo: number;
  dstFrom: number;
  dstTo: number;
  label: string;
  level: number;
  minLevel: number;
  maxLevel: number;
  warnings: string[];
  /** Only the code block being transferred, for the confirmation preview. */
  previewText?: string;
  text: string;
}
