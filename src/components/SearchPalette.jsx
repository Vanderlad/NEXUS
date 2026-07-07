import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { typeMeta, statusColor, dueLabel } from '../meta.js';

export default function SearchPalette({ onClose, onSelect }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounce = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    let stale = false; // ignore responses that arrive after the query changed
    debounce.current = setTimeout(() => {
      api.search(q).then(d => {
        if (stale) return;
        setResults(d.results);
        setActive(0);
      }).catch(() => {});
    }, 140);
    return () => { stale = true; clearTimeout(debounce.current); };
  }, [q]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) onSelect(results[active].id);
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette glass">
        <input
          ref={inputRef}
          placeholder="Search nodes, notes, deadlines, files…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette-results">
          {q.trim() && results.length === 0 && <div className="palette-empty">No matches for “{q}”</div>}
          {!q.trim() && <div className="palette-empty">Type to search your second brain</div>}
          {results.map((r, i) => (
            <div
              key={r.id}
              className={`palette-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onSelect(r.id)}
            >
              <span>{typeMeta(r.type).icon}</span>
              <div>
                <div className="title">{r.title}</div>
                {r.snippet && <div className="snippet">{r.snippet}</div>}
              </div>
              <div className="right">
                {r.due_date && <span>{dueLabel(r.due_date)} · </span>}
                <span style={{ color: statusColor(r.status) }}>{r.status}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="palette-hint">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open on map</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
