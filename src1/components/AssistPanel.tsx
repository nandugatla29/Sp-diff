import { useState } from 'react';
import { assist } from '../lib/api';
import type { AssistMode, AssistResult, Side } from '../types';

interface Props {
  left: string;
  right: string;
  leftName: string;
  rightName: string;
  diffSummary: string;
  onApply: (side: Side, sql: string) => void;
   target: Side;
  onTarget: (s: Side) => void;
}

const ACTIONS: { mode: AssistMode; label: string; hint: string }[] = [
  { mode: 'explain', label: 'Explain changes', hint: 'Plain-language summary of what differs and what to test' },
  { mode: 'merge', label: 'Merge into target', hint: 'Bring source changes over, keep target-specific values' },
  { mode: 'review', label: 'Review target', hint: 'Find bugs and bad practice in the target' },
  { mode: 'fix', label: 'Fix with instruction', hint: 'Apply the instruction below to the target' },
];

export default function AssistPanel({ left, right, leftName, rightName, diffSummary,target, onTarget, onApply }: Props) {

  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<AssistMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(AssistResult & { mode: AssistMode; target: Side }) | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (mode: AssistMode) => {
    setBusy(mode);
    setError(null);
    try {
      const r = await assist({
        mode,
        left,
        right,
        leftName,
        rightName,
        target,
        instruction: instruction.trim() || undefined,
        diffSummary,
      });
      setResult({ ...r, mode, target });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed. Select the SQL and copy it manually.');
    }
  };

  const resultTargetName = result
    ? (result.target === 'left' ? leftName : rightName) || (result.target === 'left' ? 'Left' : 'Right')
    : '';

  return (
    <aside className="assist">
      <h2>AI assist</h2>

      <div className="seg-control" role="group" aria-label="Procedure to update">
        <span className="muted">Update</span>
        {(['left', 'right'] as Side[]).map((s) => (
          <button
            key={s}
            type="button"
            className={target === s ? 'on' : ''}
            aria-pressed={target === s}
            onClick={() => onTarget(s)}
          >
            {(s === 'left' ? leftName : rightName) || (s === 'left' ? 'Left' : 'Right')}
          </button>
        ))}
      </div>

      <textarea
        className="instruction"
        value={instruction}
        maxLength={1000}
        placeholder="Optional instruction, e.g. add TRY/CATCH with rollback, or keep the UAT linked server name"
        onChange={(e) => setInstruction(e.target.value)}
      />

      <div className="actions">
        {ACTIONS.map((a) => (
          <button
            key={a.mode}
            type="button"
            title={a.hint}
            disabled={busy !== null || (a.mode === 'fix' && !instruction.trim())}
            onClick={() => run(a.mode)}
          >
            {busy === a.mode ? 'Working' : a.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="result">
          <p className="summary">{result.summary}</p>

          {result.findings.map((f, i) => (
            <div key={i} className={`finding ${f.severity}`}>
              <div className="finding-title">
                <span className="badge">{f.severity}</span>
                <strong>{f.title}</strong>
              </div>
              {f.detail && <p>{f.detail}</p>}
              {f.suggestion && <pre className="suggestion">{f.suggestion}</pre>}
            </div>
          ))}

          {result.sql && (
            <div className="sql-out">
              <div className="sql-actions">
                <button type="button" onClick={() => onApply(result.target, result.sql as string)}>
                  Use as {resultTargetName}
                </button>
                <button type="button" onClick={() => copy(result.sql as string)}>
                  {copied ? 'Copied' : 'Copy SQL'}
                </button>
              </div>
              <pre>{result.sql}</pre>
            </div>
          )}
        </div>
      )}

      <p className="muted small">
        Both procedures and the list of real changes are sent to your AI service. Nothing is run on your database.
      </p>
    </aside>
  );
}
