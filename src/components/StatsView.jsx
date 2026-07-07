import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { CONFIDENCE_RAMP, confidenceColor, fmtDate } from '../meta.js';

// SVG progress ring with a value in the center. Single-value radial gauge.
function Ring({ size = 84, stroke = 8, pct, color = 'url(#ringGrad)', children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--accent-a)" />
            <stop offset="60%" stopColor="var(--accent-b)" />
            <stop offset="100%" stopColor="var(--accent-c)" />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-fill" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke}
          stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, pct) / 100)}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

const TIER_ORDER = ['Not enough evidence', 'Some exposure', 'Practiced', 'Demonstrated'];

function dayLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - new Date(ts + 'Z').getTime()) / 60000);
  if (Number.isNaN(mins)) return '';
  if (mins < 60) return `${Math.max(0, mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export default function StatsView({ onOpenNode, onToast, onWorkspaceChanged }) {
  const [data, setData] = useState(null);
  const [ws, setWs] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.stats().then(setData).catch(() => {});
    api.workspace().then(setWs).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadDemo = async () => {
    setBusy(true);
    try {
      await api.loadDemo();
      onToast?.('xp', 'Demo workspace loaded', 'Explore, then reset any time.', '▶');
      load();
      onWorkspaceChanged?.();
    } catch (e) {
      onToast?.('error', 'Could not load demo', e.message, '⚠️');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!confirm('Reset the workspace? This permanently deletes ALL nodes, links, XP and badges.')) return;
    setBusy(true);
    try {
      await api.resetWorkspace();
      onToast?.('levelup', 'Workspace reset', 'Clean slate. Build your own map.', '◈');
      load();
      onWorkspaceChanged?.();
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="view-scroll"><div className="page-sub">Loading…</div></div>;

  const g = data.gamification;
  const levelPct = Math.min(100, Math.round((g.xpIntoLevel / g.xpForNext) * 100));
  const earned = g.badges.filter(b => b.earned);
  const maxWeek = Math.max(1, ...data.weekly.map(w => w.xp));
  const maxDay = Math.max(1, ...data.daily.map(d => d.xp));
  const thisWeek = data.weekly[7]?.xp ?? 0;
  const lastWeek = data.weekly[6]?.xp ?? 0;
  const tierTotal = Math.max(1, ...Object.values(data.confidenceTiers).length ? [TIER_ORDER.reduce((s, t) => s + (data.confidenceTiers[t] ?? 0), 0)] : [1]);

  const counters = [
    { v: `${data.counts.courses.total}`, l: 'Courses' },
    { v: `${data.counts.coursework.done}/${data.counts.coursework.total}`, l: 'Coursework done' },
    { v: `${data.counts.projects.done}/${data.counts.projects.total}`, l: 'Projects shipped' },
    { v: `${data.counts.goals.done}/${data.counts.goals.total}`, l: 'Goals reached' },
    { v: `${data.counts.skills.total}`, l: 'Skills tracked' },
    { v: `${data.counts.roadmaps.total}`, l: 'Roadmaps active' },
    { v: `${data.counts.filesLinked}`, l: 'Files linked' },
    { v: `${data.counts.connections}`, l: 'Connections' }
  ];

  return (
    <div className="view-scroll">
      <h1 className="page-title">Operator Profile</h1>
      <p className="page-sub">Your accomplishments, XP history and skill evidence — the numbers behind the map.</p>

      <div className="hero-row">
        <div className="hero-tile glass corners">
          <Ring pct={levelPct}>
            <span style={{ fontSize: 20 }}>{g.level}</span>
            <span style={{ fontSize: 8.5, color: 'var(--muted)', letterSpacing: '0.1em' }}>LEVEL</span>
          </Ring>
          <div>
            <div className="big">{g.totalXp.toLocaleString()} <span style={{ fontSize: 13, color: 'var(--muted)' }}>XP</span></div>
            <div className="sub">Total experience</div>
            <div className="fine">{g.xpIntoLevel}/{g.xpForNext} into level {g.level + 1}</div>
          </div>
        </div>

        <div className="hero-tile glass corners">
          <Ring pct={data.overall.pct} color="var(--ok)">
            <span style={{ fontSize: 17 }}>{data.overall.pct}%</span>
          </Ring>
          <div>
            <div className="big">{data.overall.done}<span style={{ fontSize: 13, color: 'var(--muted)' }}>/{data.overall.total}</span></div>
            <div className="sub">Nodes completed</div>
            <div className="fine">across every course, skill & project</div>
          </div>
        </div>

        <div className="hero-tile glass corners">
          <div style={{ fontSize: 38 }}>🔥</div>
          <div>
            <div className="big">{g.streak} <span style={{ fontSize: 13, color: 'var(--muted)' }}>day{g.streak === 1 ? '' : 's'}</span></div>
            <div className="sub">Momentum streak</div>
            <div className="fine">complete anything today to keep it alive</div>
          </div>
        </div>

        <div className="hero-tile glass corners">
          <div style={{ fontSize: 38 }}>{thisWeek >= lastWeek ? '📈' : '📉'}</div>
          <div>
            <div className="big">{thisWeek} <span style={{ fontSize: 13, color: 'var(--muted)' }}>XP</span></div>
            <div className="sub">This week</div>
            <div className="fine">{lastWeek} XP last week</div>
          </div>
        </div>
      </div>

      <div className="section-label">Activity</div>
      <div className="stats-columns">
        <div className="chart-card glass">
          <h3>XP per week</h3>
          <div className="chart-sub">last 8 weeks</div>
          <div className="xp-bars">
            {data.weekly.map(w => (
              <div className="xbar" key={w.weeksAgo} title={`${w.xp} XP`}>
                <span className="val">{w.xp}</span>
                <i style={{ height: `${Math.round((w.xp / maxWeek) * 92)}%` }} />
                <span className="lbl">{w.weeksAgo === 0 ? 'now' : `-${w.weeksAgo}w`}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="chart-card glass">
          <h3>Daily activity</h3>
          <div className="chart-sub">last 14 days · XP earned per day</div>
          <div className="day-strip">
            {data.daily.map(d => (
              <div className="dbar" key={d.day} title={`${d.day}: ${d.xp} XP · ${d.completions} completion${d.completions === 1 ? '' : 's'}`}>
                <i style={{ height: `${Math.max(3, Math.round((d.xp / maxDay) * 88))}%`, opacity: d.xp ? 1 : 0.25 }} />
                <span className="lbl">{dayLabel(d.day)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-label">Records</div>
      <div className="stat-grid">
        {counters.map(c => (
          <div className="stat-tile glass" key={c.l}>
            <div className="stat-value">{c.v}</div>
            <div className="stat-label">{c.l}</div>
          </div>
        ))}
      </div>

      <div className="section-label">Skill evidence</div>
      <div className="stats-columns">
        <div className="chart-card glass">
          <h3>Confidence distribution</h3>
          <div className="chart-sub">{data.counts.skills.total} skills & topics, scored by linked evidence</div>
          <div className="tier-rows">
            {TIER_ORDER.map((t, i) => {
              const n = data.confidenceTiers[t] ?? 0;
              return (
                <div className="tier-row" key={t}>
                  <span className="lbl">{t}</span>
                  <div className="bar"><i style={{ width: `${Math.round((n / tierTotal) * 100)}%`, background: CONFIDENCE_RAMP[i] }} /></div>
                  <span className="num">{n}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="chart-card glass">
          <h3>Strongest evidence</h3>
          <div className="chart-sub">top skills by completion confidence</div>
          {data.topSkills.length === 0 && <div className="deadline-empty">No skills tracked yet.</div>}
          {data.topSkills.map(s => (
            <div className="skill-conf-row" key={s.id}>
              <span className="name" onClick={() => onOpenNode?.(s.id)}>{s.title}</span>
              <div className="bar"><i style={{ width: `${s.score}%`, background: confidenceColor(s.score) }} /></div>
              <span className="pct">{s.score}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-label">Badges · {earned.length}/{g.badges.length}</div>
      <div className="badge-strip">
        {g.badges.map(b => (
          <div className={`badge-chip ${b.earned ? 'earned' : 'locked'}`} key={b.key} title={b.description}>
            <span className="icon">{b.icon}</span>
            <div>
              <div className="name">{b.name}</div>
              <div className="desc">{b.earned && b.earnedAt ? `Earned ${fmtDate(b.earnedAt.slice(0, 10))}` : b.description}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="section-label">Recent activity</div>
      <div className="chart-card glass" style={{ maxWidth: 640 }}>
        {g.recentXp.length === 0 && <div className="deadline-empty">Nothing yet — complete something on the map.</div>}
        {g.recentXp.map((e, i) => (
          <div className="feed-row" key={i}>
            <span className="xp">+{e.amount}</span>
            <span className="reason">{e.reason}</span>
            <span className="when">{timeAgo(e.created_at)}</span>
          </div>
        ))}
      </div>

      <div className="section-label">Workspace</div>
      <div className="workspace-box glass">
        <div className="desc">
          {ws?.demo
            ? 'This workspace contains demo data. Reset to wipe everything and start your own map from zero.'
            : ws?.nodes === 0
              ? 'Workspace is empty. Load the demo to explore NEXUS with sample data, or head to the map and create your first node.'
              : `Local-first: everything lives in data/nexus.db on this machine (${ws?.nodes ?? '…'} nodes). Reset wipes all of it.`}
        </div>
        {ws?.nodes === 0 && (
          <button className="btn primary" disabled={busy} onClick={loadDemo}>▶ Load demo workspace</button>
        )}
        {ws?.nodes > 0 && (
          <button className="btn danger" disabled={busy} onClick={reset}>⟲ Reset workspace</button>
        )}
      </div>
    </div>
  );
}
