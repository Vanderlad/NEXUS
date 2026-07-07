import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { typeMeta, CREATABLE_TYPES, DUE_DATE_TYPES, CONTAINER_TYPES } from '../meta.js';

export default function NewNodeModal({ parentId, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('assignment');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState(parentId ?? '');
  const [parents, setParents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.graph().then(({ nodes }) => {
      const options = nodes
        .filter(n => CONTAINER_TYPES.includes(n.type))
        .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
      // "Add child" can be invoked from any node — make sure the requested
      // parent is selectable even when it isn't a container type.
      if (parentId && !options.some(n => n.id === parentId)) {
        const requested = nodes.find(n => n.id === parentId);
        if (requested) options.unshift(requested);
      }
      setParents(options);
    }).catch(() => {});
  }, [parentId]);

  const create = async () => {
    if (!title.trim()) { setError('Give it a title.'); return; }
    setBusy(true);
    try {
      const parentNode = parents.find(p => p.id === parent);
      // place near the parent (or near origin) with a little scatter
      const base = parentNode ? { x: parentNode.pos_x, y: parentNode.pos_y } : { x: 0, y: 0 };
      const { node } = await api.createNode({
        title: title.trim(),
        type,
        description,
        due_date: dueDate || null,
        parent_id: parent || null,
        pos_x: base.x + 260 + Math.random() * 80,
        pos_y: base.y - 60 + Math.random() * 160
      });
      onCreated?.(node.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal glass">
        <h2>✚ New node</h2>

        <div className="np-field">
          <label>Title</label>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && create()}
            placeholder="e.g. A3 · Graph Algorithms"
            style={{ width: '100%' }}
          />
        </div>

        <div className="np-row">
          <div className="np-field">
            <label>Type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={{ width: '100%' }}>
              {CREATABLE_TYPES.map(t => (
                <option key={t} value={t}>{typeMeta(t).icon} {typeMeta(t).label}</option>
              ))}
            </select>
          </div>
          {DUE_DATE_TYPES.includes(type) && (
            <div className="np-field">
              <label>Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ width: '100%' }} />
            </div>
          )}
        </div>

        <div className="np-field">
          <label>Attach to (optional)</label>
          <select value={parent} onChange={e => setParent(e.target.value)} style={{ width: '100%' }}>
            <option value="">— floating node —</option>
            {parents.map(p => (
              <option key={p.id} value={p.id}>{typeMeta(p.type).icon} {p.title}</option>
            ))}
          </select>
        </div>

        <div className="np-field">
          <label>Description (optional)</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ width: '100%' }} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 6 }}>{error}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create node'}
          </button>
        </div>
      </div>
    </div>
  );
}
