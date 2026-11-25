import type { DiffOptions } from '../types';
import { defaultOptions } from '../lib/normalize';

const OPTION_LABELS: { key: keyof DiffOptions; label: string; hint: string }[] = [
  { key: 'ignoreWhitespace', label: 'Whitespace', hint: 'Indentation, tabs, double spaces, spaces around commas and operators' },
  { key: 'ignoreLineBreaks', label: 'Line breaks', hint: 'Same code split or joined across lines (e.g. one column per line vs. all columns on one line). Only real differences are marked as modified. Needs Whitespace.' },
  { key: 'ignoreBlankLines', label: 'Blank lines', hint: 'Empty lines and lines that are only comments' },
  { key: 'ignoreComments', label: 'Comments', hint: '-- and /* */ comments' },
  { key: 'ignoreCase', label: 'Letter case', hint: 'select = SELECT. Also applies inside string literals' },
  { key: 'ignoreBrackets', label: '[Brackets]', hint: '[dbo].[Orders] = dbo.Orders' },
  { key: 'ignoreCreateAlter', label: 'CREATE / ALTER', hint: 'CREATE PROC, ALTER PROCEDURE and CREATE OR ALTER match' },
  { key: 'ignoreTableHints', label: '(NOLOCK)', hint: '(NOLOCK) and WITH (NOLOCK) table hints. They do change locking, so this is off by default' },
  { key: 'ignoreBoilerplate', label: 'GO, SET, USE', hint: 'GO, SET ANSI_NULLS, SET QUOTED_IDENTIFIER, USE lines and the SSMS "Completion time" footer' },
];

interface Props {
  opts: DiffOptions;
  onChange: (o: DiffOptions) => void;
}

export default function IgnoreOptions({ opts, onChange }: Props) {
  return (
    <fieldset className="ignore">
      <legend>Ignore</legend>
      {OPTION_LABELS.map((o) => (
        <label key={o.key} title={o.hint}>
          <input
            type="checkbox"
            checked={opts[o.key] ?? defaultOptions[o.key]}
            disabled={o.key === 'ignoreLineBreaks' && !opts.ignoreWhitespace}
            onChange={(e) => onChange({ ...opts, [o.key]: e.target.checked })}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}