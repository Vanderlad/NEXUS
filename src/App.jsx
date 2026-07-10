import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { applyTheme, DEFAULT_THEME, isTheme } from './themes.js';
import GraphView from './components/GraphView.jsx';
import Dashboard from './components/Dashboard.jsx';
import Tracker from './components/Tracker.jsx';
import Roadmaps from './components/Roadmaps.jsx';
import StatsView from './components/StatsView.jsx';
import SettingsView from './components/SettingsView.jsx';
import SearchPalette from './components/SearchPalette.jsx';
import NewNodeModal from './components/NewNodeModal.jsx';

const NAV = [
  { id: 'graph', icon: '🕸️', label: 'Neural Map' },
  { id: 'dashboard', icon: '📡', label: 'Dashboard' },
  { id: 'tracker', icon: '🗓️', label: 'Tracker' },
  { id: 'roadmaps', icon: '🗺️', label: 'Roadmaps' },
  { id: 'stats', icon: '🏆', label: 'Stats' },
  { id: 'settings', icon: '⚙️', label: 'Settings' }
];

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Full-screen boot greeting; auto-dismisses, click to skip.
function Greeting({ name, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2750);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="greet" onClick={onDone}>
      <div className="greet-inner">
        <div className="greet-orb" />
        <div className="greet-line">◈ nexus online</div>
        <h1>{timeGreeting()}, <span className="greet-name">{name || 'operator'}</span>.</h1>
        <div className="greet-sub">All systems nominal. Let&apos;s level up.</div>
        <div className="greet-bar"><div /></div>
      </div>
    </div>
  );
}

// First-run prompt: asked once; skipping stores '' so we never nag again.
function NamePrompt({ onSubmit }) {
  const [value, setValue] = useState('');
  return (
    <div className="overlay">
      <div className="modal glass corners" style={{ width: 420, textAlign: 'center' }}>
        <div className="onboard-orb" />
        <div className="onboard-panel-heading">
          <div className="status-line" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent-a)', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10 }}>
            ◈ identify operator
          </div>
          <h2 style={{ margin: '0 0 6px' }}>What should NEXUS call you?</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 18px' }}>
            Used for your boot greeting. Stored locally, changeable in Settings.
          </p>
        </div>
        <input
          autoFocus
          value={value}
          maxLength={40}
          placeholder="Your name"
          style={{ width: '100%', textAlign: 'center', fontSize: 15 }}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSubmit(value)}
        />
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn" onClick={() => onSubmit('')}>Skip</button>
          <button className="btn primary" onClick={() => onSubmit(value)}>Engage</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('view');
    return NAV.some(n => n.id === v) ? v : 'graph';
  });
  const [gami, setGami] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modal, setModal] = useState(null); // { parentId } | null
  // ?node=<id> deep-links straight to a node on the map
  const [focusNodeId, setFocusNodeId] = useState(() => new URLSearchParams(window.location.search).get('node'));
  const [reloadToken, setReloadToken] = useState(0);
  const [settings, setSettings] = useState(null);   // { name, theme } | null while loading
  const [greeting, setGreeting] = useState(null);   // name to greet with | null
  const [askName, setAskName] = useState(false);
  const [themeFlash, setThemeFlash] = useState(0);  // >0 renders one flash sweep
  const [workspace, setWorkspace] = useState(null); // { nodes, demo }
  const toastId = useRef(0);

  // Demo state drives the "simulated workspace" banner. Any mutation path that
  // can change it (demo load, reset, pull, import) bumps reloadToken.
  useEffect(() => {
    api.workspace().then(setWorkspace).catch(() => {});
  }, [reloadToken]);

  // Boot: load settings, apply theme, then greet (or ask for a name first).
  useEffect(() => {
    api.settings().then(s => {
      setSettings(s);
      applyTheme(s.theme);
      if (s.name === null) setAskName(true);
      else setGreeting(s.name);
    }).catch(() => {
      setSettings({ name: '', theme: DEFAULT_THEME });
      applyTheme(DEFAULT_THEME);
    });
  }, []);

  const submitName = useCallback(async (name) => {
    setAskName(false);
    try {
      const s = await api.saveSettings({ name });
      setSettings(s);
      setGreeting(s.name);
    } catch {
      setGreeting(name);
    }
  }, []);

  const saveName = useCallback(async (name) => {
    const s = await api.saveSettings({ name });
    setSettings(s);
  }, []);

  const setTheme = useCallback(async (theme) => {
    if (!isTheme(theme)) return;
    applyTheme(theme);
    setSettings(s => ({ ...s, theme }));
    setThemeFlash(f => f + 1);
    api.saveSettings({ theme }).catch(() => {});
  }, []);

  const refreshGami = useCallback(() => {
    api.gamification().then(setGami).catch(() => {});
  }, []);

  useEffect(() => { refreshGami(); }, [refreshGami]);

  const toast = useCallback((kind, title, sub, icon) => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, kind, title, sub, icon }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  // Handles the gamification payload returned by mutations: XP, level-ups, badges.
  const onGami = useCallback((g) => {
    if (!g) return;
    if (g.xpAwarded) toast('xp', `+${g.xpAwarded} XP`, `Streak: ${g.streak} day${g.streak === 1 ? '' : 's'} 🔥`, '✨');
    if (g.levelUp) toast('levelup', `LEVEL UP — Level ${g.level}`, 'Keep the momentum going.', '🏆');
    for (const b of g.newBadges ?? []) {
      toast('levelup', `Badge unlocked: ${b.name}`, b.description, b.icon);
    }
    refreshGami();
  }, [toast, refreshGami]);

  const openNode = useCallback((id) => {
    setView('graph');
    setFocusNodeId(id);
  }, []);

  const reload = useCallback(() => setReloadToken(t => t + 1), []);

  // Load the demo workspace (from onboarding or the Stats view).
  const loadDemo = useCallback(async () => {
    try {
      await api.loadDemo();
      toast('xp', 'Simulation loaded', 'Explore freely — exit any time from the banner up top.', '▶');
      reload();
      refreshGami();
    } catch (e) {
      toast('error', 'Could not load demo', e.message, '⚠️');
    }
  }, [toast, reload, refreshGami]);

  // Exit the simulated (demo) workspace from the banner: wipes demo data,
  // returns to the clean-slate onboarding. Settings/GitHub connection survive.
  const exitDemo = useCallback(async () => {
    if (!confirm('Exit the simulation? Demo data is wiped and you start with a clean workspace.')) return;
    try {
      await api.resetWorkspace();
      toast('levelup', 'Simulation ended', 'Clean slate — build your own map.', '◈');
      reload();
      refreshGami();
    } catch (e) {
      toast('error', 'Could not exit demo', e.message, '⚠️');
    }
  }, [toast, reload, refreshGami]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const xpPct = gami ? Math.min(100, Math.round((gami.xpIntoLevel / gami.xpForNext) * 100)) : 0;

  return (
    <>
      <div className="bg-fx" aria-hidden="true">
        <div className="bg-grid" />
        <div className="bg-aurora" />
        <div className="bg-scan" />
      </div>
      <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-orb" />
          <div>
            NEXUS
            <div className="brand-sub">COMMAND CENTER</div>
          </div>
        </div>

        {NAV.map(n => (
          <button
            key={n.id}
            className={`nav-item ${view === n.id ? 'active' : ''}`}
            onClick={() => setView(n.id)}
          >
            <span className="icon">{n.icon}</span> {n.label}
          </button>
        ))}

        <button className="nav-item" onClick={() => setPaletteOpen(true)}>
          <span className="icon">🔍</span> Search <kbd>⌘K</kbd>
        </button>
        <button className="nav-item" onClick={() => setModal({ parentId: null })}>
          <span className="icon">✚</span> New Node
        </button>

        <div className="sidebar-spacer" />

        {gami && (
          <div className="player-card">
            <div className="player-row">
              <span className="player-level">LVL {gami.level}</span>
              <span className="player-streak">🔥 {gami.streak}d streak</span>
            </div>
            <div className="player-xp-label">
              <span>{gami.xpIntoLevel} / {gami.xpForNext} XP</span>
              <span>{gami.totalXp} total</span>
            </div>
            <div className="xpbar"><div style={{ width: `${xpPct}%` }} /></div>
            <div className="player-xp-label" style={{ marginTop: 9 }}>
              <span>🏅 {gami.badges.filter(b => b.earned).length}/{gami.badges.length} badges</span>
              <span>✓ {gami.completions} done</span>
            </div>
          </div>
        )}
      </aside>

      <main className="main">
        {workspace?.demo && (
          <div className="sim-banner glass">
            <span className="sim-dot" />
            <span className="sim-label">simulated workspace — demo data</span>
            <button className="sim-exit" onClick={exitDemo}>✕ Exit simulation</button>
          </div>
        )}
        {view === 'graph' && (
          <GraphView
            reloadToken={reloadToken}
            focusNodeId={focusNodeId}
            onFocusHandled={() => setFocusNodeId(null)}
            onGami={onGami}
            onAddChild={(parentId) => setModal({ parentId })}
            onError={(msg) => toast('error', 'Error', msg, '⚠️')}
            onLoadDemo={loadDemo}
            onGoRoadmaps={() => setView('roadmaps')}
          />
        )}
        {view === 'dashboard' && <Dashboard onOpenNode={openNode} />}
        {view === 'stats' && (
          <StatsView
            onOpenNode={openNode}
            onToast={toast}
            onWorkspaceChanged={() => { reload(); refreshGami(); }}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            key={settings?.name ?? ''}
            settings={settings}
            onSetTheme={setTheme}
            onToast={toast}
            onWorkspaceChanged={() => {
              reload();
              refreshGami();
              // a pull may bring a different name/theme from another machine
              api.settings().then(s => { setSettings(s); applyTheme(s.theme); }).catch(() => {});
            }}
            onSaveName={async (name) => {
              await saveName(name);
              toast('xp', name.trim() ? `Identity updated, ${name.trim()}` : 'Name cleared', 'Greeting updates on next boot.', '◈');
            }}
          />
        )}
        {view === 'tracker' && (
          <Tracker
            onOpenNode={openNode}
            onGami={onGami}
            onAdd={(parentId) => setModal({ parentId })}
            reloadToken={reloadToken}
          />
        )}
        {view === 'roadmaps' && (
          <Roadmaps
            onImported={(rootId, badges) => {
              onGami({ newBadges: badges });
              reload();
              openNode(rootId);
            }}
            onError={(msg) => toast('error', 'Import failed', msg, '⚠️')}
          />
        )}
      </main>

      {paletteOpen && (
        <SearchPalette
          onClose={() => setPaletteOpen(false)}
          onSelect={(id) => { setPaletteOpen(false); openNode(id); }}
        />
      )}

      {modal && (
        <NewNodeModal
          parentId={modal.parentId}
          onClose={() => setModal(null)}
          onCreated={(id) => {
            setModal(null);
            reload();
            openNode(id);
          }}
        />
      )}

      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="icon">{t.icon}</span>
            <div>
              <div className="title">{t.title}</div>
              {t.sub && <div className="sub">{t.sub}</div>}
            </div>
          </div>
        ))}
      </div>
      </div>

      {askName && <NamePrompt onSubmit={submitName} />}
      {greeting !== null && <Greeting name={greeting} onDone={() => setGreeting(null)} />}
      {themeFlash > 0 && <div className="theme-flash" key={themeFlash} />}
    </>
  );
}
