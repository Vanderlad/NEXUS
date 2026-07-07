import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { typeMeta, statusColor, STATUSES, dueLabel, fmtDate } from '../meta.js';

const WORK_TYPES = new Set(['assignment', 'exam', 'quiz', 'lab', 'task', 'project']);

// Flat coursework view: every assignment/exam/quiz/lab grouped by its course.
export default function Tracker({ onOpenNode, onGami, onAdd, reloadToken }) {
  const [groups, setGroups] = useState(null);

  const load = useCallback(async () => {
    const { nodes, edges } = await api.graph();
    const byId = new Map(nodes.map(n => [n.id, n]));
    const parentOf = new Map();
    for (const e of edges) {
      if (e.kind === 'contains') parentOf.set(e.target, e.source);
    }
    const courses = nodes.filter(n => n.type === 'course');
    const work = nodes.filter(n => WORK_TYPES.has(n.type));

    const grouped = courses.map(c => ({
      course: c,
      items: work
        .filter(w => {
          // walk up until we hit a course (handles nesting; guard against cycles)
          const seen = new Set();
          let p = parentOf.get(w.id);
          while (p && !seen.has(p)) {
            if (p === c.id) return true;
            seen.add(p);
            p = parentOf.get(p);
          }
          return false;
        })
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    }));

    const assigned = new Set(grouped.flatMap(g => g.items.map(i => i.id)));
    const other = work
      .filter(w => !assigned.has(w.id) && byId.get(parentOf.get(w.id))?.type !== 'roadmap')
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));

    setGroups({ grouped, other });
  }, []);

  useEffect(() => { load(); }, [load, reloadToken]);

  const setStatus = async (id, status) => {
    try {
      const { gamification } = await api.patchNode(id, { status });
      if (gamification) onGami?.(gamification);
      load();
    } catch { /* noop */ }
  };

  if (!groups) return <div className="view-scroll"><div className="page-sub">Loading…</div></div>;

  const Table = ({ items }) => (
    <table className="tracker-table">
      <tbody>
        {items.map(n => {
          const overdue = n.effective_status === 'Overdue';
          const done = ['Completed', 'Submitted'].includes(n.status);
          let due = '—';
          if (n.due_date) {
            if (done) due = `✓ ${fmtDate(n.due_date)}`;
            else if (overdue) due = `⚠ ${dueLabel(n.due_date)}`;
            else due = dueLabel(n.due_date);
          }
          return (
            <tr key={n.id}>
              <td style={{ width: 26 }}>{typeMeta(n.type).icon}</td>
              <td className="t-title" onClick={() => onOpenNode(n.id)}>{n.title}</td>
              <td className={`t-due ${overdue ? 'overdue' : ''}`} style={{ width: 90 }}>{due}</td>
              <td style={{ width: 110 }}>
                <div className="progress-track" style={{ width: 90 }}>
                  <div style={{ width: `${n.progress}%`, background: statusColor(n.effective_status) }} />
                </div>
              </td>
              <td style={{ width: 130 }}>
                <select
                  value={n.status}
                  onChange={e => setStatus(n.id, e.target.value)}
                  style={{ color: statusColor(n.effective_status) }}
                >
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="view-scroll">
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">Deadline Tracker</h1>
          <p className="page-sub">All coursework across courses. Change a status to log progress and earn XP.</p>
        </div>
        <button className="btn primary" onClick={() => onAdd(null)}>✚ Add work</button>
      </div>

      {groups.grouped.map(({ course, items }) => (
        <div className="tracker-course glass" key={course.id}>
          <div className="tracker-course-head">
            <span>{typeMeta('course').icon}</span>
            <span className="t-title title" style={{ cursor: 'pointer' }} onClick={() => onOpenNode(course.id)}>
              {course.title}
            </span>
            <div className="progress-track" style={{ width: 130 }}>
              <div style={{ width: `${course.progress}%`, background: 'var(--gradient)' }} />
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)' }}>{course.progress}%</span>
            <button className="btn small" onClick={() => onAdd(course.id)}>✚</button>
          </div>
          {items.length > 0
            ? <Table items={items} />
            : <div className="deadline-empty" style={{ padding: '12px 18px' }}>Nothing tracked yet.</div>}
        </div>
      ))}

      {groups.other.length > 0 && (
        <div className="tracker-course glass">
          <div className="tracker-course-head">
            <span>🗂️</span><span className="title">Standalone projects & work</span>
          </div>
          <Table items={groups.other} />
        </div>
      )}

      {groups.grouped.length === 0 && groups.other.length === 0 && (
        <div className="glass" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Nothing tracked yet. Add a course or some work with <b>✚ Add work</b>,
          or create nodes on the Neural Map — anything with a due date shows up here.
        </div>
      )}
    </div>
  );
}
