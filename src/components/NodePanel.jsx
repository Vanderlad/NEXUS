import React, { useCallback, useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api } from '../api.js';
import { typeMeta, statusColor, STATUSES, TYPE_META, LINK_KINDS, fmtDate, confidenceColor } from '../meta.js';

const md = (text) => ({ __html: DOMPurify.sanitize(marked.parse(text ?? '')) });

const LINK_ICON = { file: '📄', folder: '📁', repo: '⎇', url: '🔗' };

const hostOf = (url) => {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return ''; }
};

// Evidence-based confidence meter with its signal breakdown.
function ConfidenceMeter({ confidence }) {
  const color = confidenceColor(confidence.score);
  return (
    <div className="np-field">
      <label>Completion confidence</label>
      <div className="conf-box">
        <div className="conf-head">
          <span className="conf-score" style={{ color }}>{confidence.score}%</span>
          <span className="conf-tier" style={{ color }}>{confidence.tier}</span>
        </div>
        <div className="conf-track">
          <div style={{ width: `${confidence.score}%`, background: color, color }} />
        </div>
        {confidence.signals.length > 0 && (
          <ul className="conf-signals">
            {confidence.signals.map((s, i) => (
              <li key={i}>{s.label} <b>+{s.points}</b></li>
            ))}
          </ul>
        )}
        <div className="conf-hint">
          Raise confidence by linking files, repos and projects, writing notes,
          and completing connected work — evidence, not vibes.
        </div>
      </div>
    </div>
  );
}

// Structured learning guide rendered for roadmap topics (nodes.guide JSON).
function Guide({ guide }) {
  const has = (arr) => Array.isArray(arr) && arr.length > 0;
  if (!guide.why && !has(guide.learn) && !has(guide.resources) && !has(guide.criteria)) return null;
  return (
    <div className="np-field">
      <label>Learning guide</label>
      <div className="guide-box">
        {guide.why && (
          <div className="guide-sec">
            <h4>Why it matters</h4>
            <p>{guide.why}</p>
          </div>
        )}
        {has(guide.learn) && (
          <div className="guide-sec">
            <h4>What to learn</h4>
            <ol>{guide.learn.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
        )}
        {has(guide.prerequisites) && (
          <div className="guide-sec">
            <h4>Prerequisites</h4>
            <p style={{ color: 'var(--muted)' }}>{guide.prerequisites.join(' · ')}</p>
          </div>
        )}
        {has(guide.resources) && (
          <div className="guide-sec">
            <h4>Resources</h4>
            <div className="guide-res">
              {guide.resources.map((r, i) => (
                <a key={i} href={r.url} target="_blank" rel="noreferrer">
                  <span>↗</span> {r.label} <span className="host">{hostOf(r.url)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
        {has(guide.criteria) && (
          <div className="guide-sec">
            <h4>Completion criteria</h4>
            <ul className="criteria">{guide.criteria.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NodePanel({ nodeId, onClose, onPatched, onDeleted, onAddChild, onJump, onGami, onError }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const [notesPreview, setNotesPreview] = useState(true);
  const [notesEditRequested, setNotesEditRequested] = useState(false); // gate autofocus to explicit edits
  const [newLink, setNewLink] = useState({ kind: 'file', label: '', target: '' });

  const load = useCallback(() => {
    api.node(nodeId)
      .then(d => {
        setDetail(d);
        setForm(d.node);
        setNotesPreview(!!d.node.notes?.trim());
      })
      .catch(e => onError?.(e.message));
  }, [nodeId, onError]);

  useEffect(() => { load(); }, [load]);

  const patch = useCallback(async (updates) => {
    try {
      const { node, gamification } = await api.patchNode(nodeId, updates);
      setForm(node);
      setDetail(d => d ? { ...d, node } : d);
      onPatched?.(node, gamification);
    } catch (e) {
      onError?.(e.message);
    }
  }, [nodeId, onPatched, onError]);

  if (!detail || !form) return null;

  const meta = typeMeta(form.type);
  const children = detail.related.filter(r => r.direction === 'out' && r.kind === 'contains');
  const isContainer = children.length > 0;
  const overdue = detail.node.effective_status === 'Overdue';

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const commit = (key) => {
    if (form[key] !== detail.node[key]) patch({ [key]: form[key] });
  };

  const addLink = async () => {
    if (!newLink.target.trim()) return;
    try {
      const { newBadges } = await api.addLink(nodeId, newLink);
      if (newBadges?.length) onGami?.({ newBadges });
      setNewLink({ kind: 'file', label: '', target: '' });
      load();
    } catch (e) {
      onError?.(e.message);
    }
  };

  const removeLink = async (id) => {
    await api.deleteLink(id).catch(() => {});
    load();
  };

  const del = async () => {
    if (!confirm(`Delete "${form.title}"? Its connections will be removed too.`)) return;
    try {
      await api.deleteNode(nodeId);
      onDeleted?.(nodeId);
    } catch (e) {
      onError?.(e.message);
    }
  };

  // Desktop (Electron) can truly open files/folders and reveal them in the OS
  // file manager; the browser build falls back to opening links / copying paths.
  const desktop = typeof window !== 'undefined' ? window.nexusDesktop : null;
  const openExternal = (target) => {
    const isUrl = /^https?:\/\//.test(target);
    if (desktop?.isElectron) {
      if (isUrl) {
        return <button title="Open in browser" onClick={() => desktop.openExternal(target)}>↗</button>;
      }
      return (
        <>
          <button title="Open file/folder" onClick={() => desktop.openPath(target)}>↗</button>
          <button title="Reveal in file manager" onClick={() => desktop.showItemInFolder(target)}>⧉</button>
        </>
      );
    }
    return isUrl ? (
      <a href={target} target="_blank" rel="noreferrer" title="Open">↗</a>
    ) : (
      <button title="Copy path" onClick={() => navigator.clipboard?.writeText(target)}>⧉</button>
    );
  };

  return (
    <div className="node-panel glass">
      <div className="np-scroll">
        <div className="np-head">
          <span className="nn-icon">{meta.icon}</span>
          <input
            className="np-title-input"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            onBlur={() => commit('title')}
          />
          <button className="np-close" onClick={onClose}>✕</button>
        </div>

        <div className="np-chips">
          <span className="np-chip">{meta.label}</span>
          <span className="np-chip xp">◆ {detail.xp_value ?? 0} XP</span>
          {detail.node.effective_status && (
            <span className="np-chip" style={{ color: statusColor(detail.node.effective_status), borderColor: statusColor(detail.node.effective_status) + '55' }}>
              {detail.node.effective_status}
            </span>
          )}
        </div>

        <div className="np-row">
          <div className="np-field">
            <label>Type</label>
            <select value={form.type} onChange={e => patch({ type: e.target.value })}>
              {Object.keys(TYPE_META).map(t => (
                <option key={t} value={t}>{TYPE_META[t].label}</option>
              ))}
            </select>
          </div>
          <div className="np-field">
            <label>Due date {overdue && <span style={{ color: 'var(--danger)' }}>· OVERDUE</span>}</label>
            <input
              type="date"
              value={form.due_date ?? ''}
              onChange={e => patch({ due_date: e.target.value || null })}
            />
          </div>
        </div>

        <div className="np-field">
          <label>Status</label>
          <div className="status-seg">
            {STATUSES.map(s => (
              <button
                key={s}
                className={form.status === s ? 'active' : ''}
                style={form.status === s ? { background: statusColor(s) } : {}}
                onClick={() => patch({ status: s })}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {form.type === 'course' && (
          <div className="np-row">
            <div className="np-field">
              <label>Instructor</label>
              <input
                value={form.instructor ?? ''}
                onChange={e => set('instructor', e.target.value)}
                onBlur={() => commit('instructor')}
                placeholder="Prof. …"
              />
            </div>
            <div className="np-field">
              <label>Semester</label>
              <input
                value={form.semester ?? ''}
                onChange={e => set('semester', e.target.value)}
                onBlur={() => commit('semester')}
                placeholder="Fall 2026"
              />
            </div>
          </div>
        )}

        <div className="np-field">
          <label>Progress · {form.progress}%{isContainer ? ' (auto from children on map)' : ''}</label>
          <input
            type="range" min="0" max="100" value={form.progress}
            onChange={e => set('progress', Number(e.target.value))}
            onMouseUp={() => commit('progress')}
            onTouchEnd={() => commit('progress')}
            disabled={isContainer}
          />
        </div>

        {detail.confidence && <ConfidenceMeter confidence={detail.confidence} />}

        <div className="np-field">
          <label>Description</label>
          <textarea
            value={form.description}
            onChange={e => set('description', e.target.value)}
            onBlur={() => commit('description')}
            placeholder="What is this node about?"
          />
        </div>

        {detail.guide && <Guide guide={detail.guide} />}

        <div className="np-field">
          <label>Next actions</label>
          <textarea
            value={form.next_actions}
            onChange={e => set('next_actions', e.target.value)}
            onBlur={() => commit('next_actions')}
            placeholder={'- [ ] First step\n- [ ] Second step'}
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          />
        </div>

        <div className="np-field">
          <label>
            Notes (markdown) ·{' '}
            <a style={{ cursor: 'pointer', color: 'var(--accent-b)' }} onClick={() => { setNotesEditRequested(true); setNotesPreview(p => !p); }}>
              {notesPreview ? 'edit' : 'preview'}
            </a>
          </label>
          {notesPreview ? (
            <div
              className="md-preview glass"
              style={{ padding: '10px 14px', minHeight: 50, cursor: 'text' }}
              onDoubleClick={() => { setNotesEditRequested(true); setNotesPreview(false); }}
              dangerouslySetInnerHTML={form.notes?.trim() ? md(form.notes) : { __html: '<span style="color:var(--faint)">Double-click to add notes…</span>' }}
            />
          ) : (
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              onBlur={() => { commit('notes'); if (form.notes?.trim()) setNotesPreview(true); }}
              rows={7}
              autoFocus={notesEditRequested}
              placeholder={'# Notes\nSupports **markdown**, `code`, lists, tables…'}
              style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
            />
          )}
        </div>

        <div className="np-row">
          <div className="np-field">
            <label>GitHub repo</label>
            <input
              value={form.github_repo}
              onChange={e => set('github_repo', e.target.value)}
              onBlur={() => commit('github_repo')}
              placeholder="https://github.com/…"
            />
          </div>
          <div className="np-field">
            <label>URL</label>
            <input
              value={form.url}
              onChange={e => set('url', e.target.value)}
              onBlur={() => commit('url')}
              placeholder="https://…"
            />
          </div>
        </div>

        <div className="np-field np-links">
          <label>Linked files · folders · repos ({detail.links.length})</label>
          {detail.links.map(l => (
            <div className="link-row" key={l.id}>
              <span>{LINK_ICON[l.kind] ?? '🔗'}</span>
              {l.label && <span className="label">{l.label}</span>}
              <span className="target" title={l.target}>{l.target}</span>
              {openExternal(l.target)}
              <button title="Remove" onClick={() => removeLink(l.id)}>✕</button>
            </div>
          ))}
          <div className="add-link-form">
            <select value={newLink.kind} onChange={e => setNewLink(l => ({ ...l, kind: e.target.value }))}>
              {LINK_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            <input
              placeholder="Path or URL…"
              value={newLink.target}
              onChange={e => setNewLink(l => ({ ...l, target: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addLink()}
            />
            <button className="btn small" onClick={addLink}>Add</button>
          </div>
        </div>

        {detail.related.length > 0 && (
          <div className="np-field">
            <label>Connected nodes ({detail.related.length})</label>
            <div>
              {detail.related.map((r, i) => (
                <button className="related-chip" key={i} onClick={() => onJump?.(r.id)}>
                  <span>{typeMeta(r.type).icon}</span>
                  {r.direction === 'in' ? '←' : '→'} {r.title}
                  {['Completed', 'Submitted'].includes(r.status) && <span className="rc-done">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="np-actions">
          <button className="btn small" onClick={() => onAddChild?.(nodeId)}>✚ Add child node</button>
          {form.due_date && (
            <button className="btn small" onClick={() => patch({ due_date: null })}>Clear due date</button>
          )}
          <button className="btn small danger" onClick={del}>Delete</button>
        </div>

        <div style={{ marginTop: 14, fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--mono)' }}>
          id: {form.id}{form.completed_at ? ` · completed ${fmtDate(form.completed_at.slice(0, 10))}` : ''}
        </div>
      </div>
    </div>
  );
}
