import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Roadmaps({ onImported, onError }) {
  const [roadmaps, setRoadmaps] = useState(null);
  const [busy, setBusy] = useState(null);
  const fileRef = useRef(null);

  const load = () => api.roadmaps().then(d => setRoadmaps(d.roadmaps)).catch(() => setRoadmaps([]));
  useEffect(() => { load(); }, []);

  const importOne = async (slug) => {
    setBusy(slug);
    try {
      const { rootId, newBadges } = await api.importRoadmap(slug);
      onImported?.(rootId, newBadges);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  const importCustom = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      const { rootId, newBadges } = await api.importCustomRoadmap(data);
      onImported?.(rootId, newBadges);
    } catch (e) {
      onError?.(e.message);
    }
  };

  if (!roadmaps) return <div className="view-scroll"><div className="page-sub">Loading…</div></div>;

  return (
    <div className="view-scroll">
      <h1 className="page-title">Learning Roadmaps</h1>
      <p className="page-sub">
        Import a learning path as a skill tree on your map. Paths are modeled on{' '}
        <a href="https://roadmap.sh" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-b)' }}>roadmap.sh</a>{' '}
        and stored as JSON in <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>roadmaps/</code> — drop in your own to extend.
      </p>

      <div className="roadmap-grid">
        {roadmaps.map(r => (
          <div className="roadmap-card glass" key={r.slug}>
            <div className="head">
              <span style={{ fontSize: 20 }}>🗺️</span>
              <span className="title">{r.title}</span>
              <span className="roadmap-source">{r.source}</span>
            </div>
            <div className="desc">{r.description}</div>
            <div className="meta">{r.sections} sections · {r.topics} topics · ~{r.topics * 40 + 250} XP</div>
            <button
              className={`btn ${r.imported ? '' : 'primary'}`}
              disabled={r.imported || busy === r.slug}
              onClick={() => importOne(r.slug)}
            >
              {r.imported ? '✓ On your map' : busy === r.slug ? 'Importing…' : '⤓ Import to map'}
            </button>
          </div>
        ))}
      </div>

      <div className="section-label">Custom import</div>
      <div className="glass" style={{ padding: 20, maxWidth: 640 }}>
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
          Import any roadmap JSON matching the format{' '}
          <code style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>
            {'{ slug, title, sections: [{ title, topics: [{ id, title }] }] }'}
          </code>.
          This is the integration seam for a future live roadmap.sh sync or an LMS course import.
        </p>
        <input
          ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
          onChange={e => { if (e.target.files[0]) importCustom(e.target.files[0]); e.target.value = ''; }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>📂 Import JSON file…</button>
      </div>
    </div>
  );
}
