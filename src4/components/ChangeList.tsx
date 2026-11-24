import { useState } from 'react';
import { lineLabel } from '../lib/hunks';
import type { Hunk, Risk } from '../types';

interface Props {
  hunks: Hunk[];
  current: number;
  reviewed: Set<string>;
  onGo: (n: number) => void;
}

export default function ChangeList({ hunks, current, reviewed, onGo }: Props) {
  const [risk, setRisk] = useState<'all' | Risk>('all');
  const [hideDone, setHideDone] = useState(false);
  const [q, setQ] = useState('');

  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  hunks.forEach((h) => counts[h.risk]++);
  const needle = q.trim().toLowerCase();

  const shown = hunks
    .map((h, n) => ({ h, n }))
    .filter(
      ({ h }) =>
        (risk === 'all' || h.risk === risk) &&
        !(hideDone && reviewed.has(h.sig)) &&
        (!needle || h.title.toLowerCase().includes(needle) || h.preview.toLowerCase().includes(needle)),
    );

  return (
    <nav className="change-list" aria-label="Changes">
      <div className="cl-filters">
        <input value={q} placeholder="Search changes" onChange={(e) => setQ(e.target.value)} />
        <select value={risk} onChange={(e) => setRisk(e.target.value as 'all' | Risk)} aria-label="Risk filter">
          <option value="all">All risks ({hunks.length})</option>
          <option value="high">High ({counts.high})</option>
          <option value="medium">Medium ({counts.medium})</option>
          <option value="low">Low ({counts.low})</option>
          <option value="info">Info ({counts.info})</option>
        </select>
        <label className="small">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide reviewed
        </label>
      </div>
      <div className="cl-items">
        {shown.map(({ h, n }) => (
          <button
            key={h.sig}
            type="button"
            className={`cl-item ${h.risk}${n === current ? ' on' : ''}${reviewed.has(h.sig) ? ' done' : ''}`}
            onClick={() => onGo(n)}
          >
            <span className={`badge ${h.risk}`}>{h.risk}</span>
            <span className="cl-title">
              {n + 1}. {h.title}
            </span>
            <span className="muted small">{lineLabel(h)}</span>
            <code>{h.preview}</code>
          </button>
        ))}
        {shown.length === 0 && <p className="muted small">No changes match.</p>}
      </div>
    </nav>
  );
}