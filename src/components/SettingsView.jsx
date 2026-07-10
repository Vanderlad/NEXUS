import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { THEMES } from '../themes.js';

function fmtWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'never' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// GitHub sync panel: connect (PAT or device flow), pick a private repo,
// push/pull the workspace snapshot. Conflicts surface as confirm dialogs.
function SyncPanel({ onToast, onWorkspaceChanged }) {
  const [status, setStatus] = useState(null);
  const [pat, setPat] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(null); // 'connect' | 'push' | 'pull' | 'device' | null
  const [device, setDevice] = useState(null); // { userCode, verificationUri }
  const pollRef = useRef(null);
  const fileRef = useRef(null);

  const refresh = useCallback(() => {
    api.syncStatus().then(s => { setStatus(s); setRepo(s.repo); }).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return () => clearInterval(pollRef.current);
  }, [refresh]);

  const fail = (title, e) => onToast?.('error', title, e.message, '⚠️');

  const connect = async () => {
    if (!pat.trim()) return;
    setBusy('connect');
    try {
      const { user } = await api.syncConnect(pat.trim());
      setPat('');
      onToast?.('xp', `Connected as @${user}`, 'Your workspace can now sync through GitHub.', '🔗');
      refresh();
    } catch (e) {
      fail('Could not connect', e);
    } finally {
      setBusy(null);
    }
  };

  const startDevice = async () => {
    setBusy('device');
    try {
      const d = await api.deviceStart();
      setDevice(d);
      pollRef.current = setInterval(async () => {
        try {
          const r = await api.devicePoll();
          if (!r.pending) {
            clearInterval(pollRef.current);
            setDevice(null);
            setBusy(null);
            onToast?.('xp', `Connected as @${r.user}`, 'Authorized via GitHub device flow.', '🔗');
            refresh();
          }
        } catch (e) {
          clearInterval(pollRef.current);
          setDevice(null);
          setBusy(null);
          fail('Authorization failed', e);
        }
      }, 5500);
    } catch (e) {
      setBusy(null);
      fail('Could not start device flow', e);
    }
  };

  const disconnectGh = async () => {
    if (!confirm('Disconnect GitHub? The token is removed from this machine; the backup repo is untouched.')) return;
    await api.syncDisconnect().catch(() => {});
    refresh();
  };

  const saveRepo = async () => {
    try {
      await api.syncRepo(repo.trim());
      onToast?.('xp', 'Backup repository set', `Syncing to ${status?.user}/${repo.trim()} (private).`, '📦');
      refresh();
    } catch (e) {
      fail('Invalid repository name', e);
    }
  };

  // push/pull with a confirm-and-retry pass when the server reports a conflict
  const run = async (kind) => {
    setBusy(kind);
    const call = kind === 'push' ? api.syncPush : api.syncPull;
    try {
      let result;
      try {
        result = await call(false);
      } catch (e) {
        if (!e.data?.needsForce) throw e;
        const msg = kind === 'push'
          ? `The backup on GitHub changed since this machine last synced (remote snapshot: ${fmtWhen(e.data.remoteExportedAt)}).\n\nOverwrite it with THIS machine's workspace?`
          : `This machine has local changes that a pull will overwrite (remote snapshot: ${fmtWhen(e.data.remoteExportedAt)}).\n\nReplace local data with the GitHub backup?`;
        if (!confirm(msg)) return;
        result = await call(true);
      }
      if (kind === 'push') {
        onToast?.('xp', 'Pushed to GitHub', `${result.nodes} nodes → ${result.repo}`, '☁️');
      } else {
        onToast?.('levelup', 'Workspace pulled', `${result.nodes} nodes restored from GitHub.`, '☁️');
        onWorkspaceChanged?.();
      }
      refresh();
    } catch (e) {
      fail(kind === 'push' ? 'Push failed' : 'Pull failed', e);
    } finally {
      setBusy(null);
    }
  };

  const restoreFile = async (file) => {
    try {
      const snap = JSON.parse(await file.text());
      if (!confirm('Restore this backup? It replaces ALL current workspace data.')) return;
      const { nodes } = await api.importBackup(snap);
      onToast?.('levelup', 'Backup restored', `${nodes} nodes imported.`, '📦');
      onWorkspaceChanged?.();
      refresh();
    } catch (e) {
      fail('Restore failed', e);
    }
  };

  if (!status) return <div className="settings-card glass"><div className="settings-hint">Loading sync status…</div></div>;

  return (
    <>
      {!status.connected && (
        <div className="settings-card glass corners">
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            Connect GitHub to keep your workspace in a <b>private repo you own</b> and pull it
            from any machine running NEXUS. Create a{' '}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-b)' }}>
              fine-grained token
            </a>{' '}
            with <b>Contents: read &amp; write</b> (+ Administration: write to auto-create the repo),
            or grant the classic <code style={{ fontFamily: 'var(--mono)' }}>repo</code> scope.
          </p>
          <div className="row">
            <input
              type="password"
              placeholder="GitHub personal access token"
              value={pat}
              onChange={e => setPat(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connect()}
            />
            <button className="btn primary" disabled={busy === 'connect' || !pat.trim()} onClick={connect}>
              {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {status.deviceFlow && !device && (
            <div style={{ marginTop: 10 }}>
              <button className="btn" disabled={busy === 'device'} onClick={startDevice}>
                🔑 Connect with GitHub (device flow)
              </button>
            </div>
          )}
          {device && (
            <div className="device-code-box">
              Enter code <b className="device-code">{device.userCode}</b> at{' '}
              <a href={device.verificationUri} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-b)' }}>
                {device.verificationUri}
              </a>
              <span className="settings-hint" style={{ display: 'block', marginTop: 6 }}>Waiting for authorization…</span>
            </div>
          )}
          <div className="settings-hint">
            The token is stored only in your local database and is never included in backups.
          </div>
        </div>
      )}

      {status.connected && (
        <div className="settings-card glass corners">
          <div className="sync-head">
            <span className="sync-user">🔗 @{status.user}</span>
            <span className="sync-state">
              {status.remote?.error
                ? `⚠ ${status.remote.error}`
                : status.remote?.hasBackup
                  ? status.dirty || !status.remote.inSync ? '● local and remote differ' : '✓ in sync'
                  : 'no backup pushed yet'}
            </span>
            <button className="btn small danger" onClick={disconnectGh}>Disconnect</button>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: 12 }}>{status.user}/</span>
            <input value={repo} onChange={e => setRepo(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            {repo.trim() !== status.repo && <button className="btn small" onClick={saveRepo}>Set repo</button>}
          </div>
          <div className="np-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!!busy} onClick={() => run('push')}>
              {busy === 'push' ? 'Pushing…' : '⬆ Push to GitHub'}
            </button>
            <button className="btn" disabled={!!busy} onClick={() => run('pull')}>
              {busy === 'pull' ? 'Pulling…' : '⬇ Pull from GitHub'}
            </button>
          </div>
          <div className="settings-hint">
            Last push: {fmtWhen(status.lastPushedAt)} · last pull: {fmtWhen(status.lastPulledAt)}.
            Sync is last-write-wins — you'll be warned before anything is overwritten.
          </div>
        </div>
      )}

      <div className="settings-card glass" style={{ marginTop: 14 }}>
        <div className="np-actions">
          <a className="btn small" href="/api/export" download>💾 Download backup (.json)</a>
          <button className="btn small" onClick={() => fileRef.current?.click()}>📂 Restore from file…</button>
          <input
            ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { if (e.target.files[0]) restoreFile(e.target.files[0]); e.target.value = ''; }}
          />
        </div>
        <div className="settings-hint">Backups hold your whole workspace (nodes, XP, badges, settings) — no tokens.</div>
      </div>
    </>
  );
}

// Operator identity + theme gallery. Theme changes apply instantly (and are
// persisted); the name is saved on demand and drives the boot greeting.
export default function SettingsView({ settings, onSaveName, onSetTheme, onToast, onWorkspaceChanged }) {
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

      <div className="section-label">GitHub sync &amp; backups</div>
      <SyncPanel onToast={onToast} onWorkspaceChanged={onWorkspaceChanged} />

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
