import React, { useState } from 'react';
import { THEMES } from '../themes.js';

// Operator identity + theme gallery. Theme changes apply instantly (and are
// persisted); the name is saved on demand and drives the boot greeting.
export default function SettingsView({ settings, onSaveName, onSetTheme }) {
  const [name, setName] = useState(settings?.name ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSaveName(name); } finally { setSaving(false); }
  };

  return (
    <div className="view-scroll">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Identity and appearance. Both survive a workspace reset — they're yours, not the map's.</p>

      <div className="section-label">Operator identity</div>
      <div className="settings-card glass corners">
        <div className="row">
          <input
            value={name}
            maxLength={40}
            placeholder="Your name"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
          />
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div className="settings-hint">
          NEXUS greets you by name on boot. Leave empty to be addressed as “operator”.
        </div>
      </div>

      <div className="section-label">Theme</div>
      <div className="theme-grid">
        {THEMES.map(t => {
          const active = settings?.theme === t.id;
          return (
            <button
              key={t.id}
              className={`theme-card glass ${active ? 'active' : ''}`}
              style={{ '--p1': t.rgb[0], '--p2': t.rgb[1], '--p3': t.rgb[2] }}
              onClick={() => onSetTheme(t.id)}
            >
              <div className="tc-preview">
                <span className="tc-orb" />
                <span className="tc-bars"><i /><i /><i /></span>
              </div>
              <div className="tc-meta">
                <div className="top">
                  <span className="name">{t.name}</span>
                  {active && <span className="tc-active-chip">active</span>}
                </div>
                <div className="desc">{t.tagline}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="settings-hint" style={{ marginTop: 12 }}>
        Themes restyle the interface and its ambient animations (auroras, grid, scanline speed).
        Node-type and status colors stay fixed — they encode data, not vibes.
      </div>
    </div>
  );
}
