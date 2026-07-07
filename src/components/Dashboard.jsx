import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { typeMeta, statusColor, fmtDate, dueLabel } from '../meta.js';

function DeadlineCol({ title, items, className, onOpenNode }) {
  return (
    <div className={`deadline-col glass ${className ?? ''}`}>
      <h3>{title} <span className="count">{items.length}</span></h3>
      {items.length === 0 && <div className="deadline-empty">Clear ✓</div>}
      {items.map(n => (
        <div className="deadline-item" key={n.id} onClick={() => onOpenNode(n.id)}>
          <span>{typeMeta(n.type).icon}</span>
          <span className="title">{n.title}</span>
          <span className="status-dot" style={{ color: statusColor(n.status), background: statusColor(n.status) }} title={n.status} />
          <span className="date">{dueLabel(n.due_date)}</span>
        </div>
      ))}
    </div>
  );
}

function EntityCards({ items, onOpenNode, emptyText }) {
  if (items.length === 0) return <div className="deadline-empty">{emptyText}</div>;
  return (
    <div className="card-row">
      {items.map(n => {
        const meta = typeMeta(n.type);
        return (
          <div className="entity-card glass" key={n.id} onClick={() => onOpenNode(n.id)}>
            <div className="head">
              <span>{meta.icon}</span>
              <span className="title">{n.title}</span>
              <span className="pct">{n.progress}%</span>
            </div>
            <div className="progress-track">
              <div style={{ width: `${n.progress}%`, background: `linear-gradient(90deg, ${meta.color}88, ${meta.color})`, boxShadow: `0 0 8px ${meta.color}66` }} />
            </div>
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 7 }}>
              <span className="status-dot" style={{ color: statusColor(n.status), background: statusColor(n.status) }} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{n.status}</span>
              {n.due_date && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>due {fmtDate(n.due_date)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({ onOpenNode }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="view-scroll"><div className="page-sub">Loading…</div></div>;

  const g = data.gamification;
  const d = data.deadlines;
  const earned = g.badges.filter(b => b.earned);

  return (
    <div className="view-scroll">
      <h1 className="page-title">Mission Control</h1>
      <p className="page-sub">
        {d.overdue.length > 0
          ? `⚠ ${d.overdue.length} overdue item${d.overdue.length > 1 ? 's' : ''} need${d.overdue.length > 1 ? '' : 's'} attention.`
          : d.today.length > 0
            ? `${d.today.length} item${d.today.length > 1 ? 's' : ''} due today. Lock in.`
            : 'No fires to put out. Build something.'}
      </p>

      <div className="stat-grid">
        <div className="stat-tile glass">
          <div className="stat-value">LVL {g.level}</div>
          <div className="stat-label">Operator level</div>
          <div className="xpbar" style={{ marginTop: 10 }}>
            <div style={{ width: `${Math.min(100, Math.round((g.xpIntoLevel / g.xpForNext) * 100))}%` }} />
          </div>
          <div className="stat-extra">{g.xpIntoLevel}/{g.xpForNext} XP · {g.totalXp} total</div>
        </div>
        <div className="stat-tile glass">
          <div className="stat-value">🔥 {g.streak}</div>
          <div className="stat-label">Day streak</div>
          <div className="stat-extra">Complete anything today to keep it alive</div>
        </div>
        <div className="stat-tile glass">
          <div className="stat-value">{g.completions}</div>
          <div className="stat-label">Tasks completed</div>
          <div className="stat-extra">🏅 {earned.length}/{g.badges.length} badges earned</div>
        </div>
        <div className="stat-tile glass">
          <div className="stat-value">{data.overall.pct}%</div>
          <div className="stat-label">Overall completion</div>
          <div className="stat-extra">{data.overall.done}/{data.overall.total} nodes · School {data.domains.school}% · Skills {data.domains.skills}%</div>
        </div>
        <div className="stat-tile glass">
          <div className="stat-value">{data.week.reduce((s, d) => s + d.xp, 0)} XP</div>
          <div className="stat-label">This week</div>
          <div className="week-strip">
            {data.week.map(d => {
              const max = Math.max(1, ...data.week.map(x => x.xp));
              return (
                <div className="wbar" key={d.day} title={`${d.day}: ${d.xp} XP`}>
                  <i style={{ height: `${Math.max(4, Math.round((d.xp / max) * 100))}%`, opacity: d.xp ? 1 : 0.25 }} />
                  <span>{new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="section-label">Deadlines</div>
      <div className="deadline-grid">
        <DeadlineCol title="Overdue" className="overdue" items={d.overdue} onOpenNode={onOpenNode} />
        <DeadlineCol title="Today" className="today" items={d.today} onOpenNode={onOpenNode} />
        <DeadlineCol title="This week" items={d.thisWeek} onOpenNode={onOpenNode} />
        <DeadlineCol title="This month" items={d.thisMonth} onOpenNode={onOpenNode} />
      </div>

      <div className="section-label">Courses</div>
      <EntityCards items={data.courses} onOpenNode={onOpenNode} emptyText="No courses yet — add one from the map." />

      <div className="section-label">Active projects</div>
      <EntityCards items={data.projects} onOpenNode={onOpenNode} emptyText="No active projects." />

      <div className="section-label">Goals</div>
      <EntityCards items={data.goals} onOpenNode={onOpenNode} emptyText="No goals set." />

      <div className="section-label">Badges</div>
      <div className="badge-strip">
        {g.badges.map(b => (
          <div className={`badge-chip ${b.earned ? 'earned' : 'locked'}`} key={b.key} title={b.description}>
            <span className="icon">{b.icon}</span>
            <div>
              <div className="name">{b.name}</div>
              <div className="desc">{b.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
