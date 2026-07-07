import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import GraphView from './components/GraphView.jsx';
import Dashboard from './components/Dashboard.jsx';
import Tracker from './components/Tracker.jsx';
import Roadmaps from './components/Roadmaps.jsx';
import StatsView from './components/StatsView.jsx';
import SearchPalette from './components/SearchPalette.jsx';
import NewNodeModal from './components/NewNodeModal.jsx';

const NAV = [
  { id: 'graph', icon: '🕸️', label: 'Neural Map' },
  { id: 'dashboard', icon: '📡', label: 'Dashboard' },
  { id: 'tracker', icon: '🗓️', label: 'Tracker' },
  { id: 'roadmaps', icon: '🗺️', label: 'Roadmaps' },
  { id: 'stats', icon: '🏆', label: 'Stats' }
];

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
  const toastId = useRef(0);

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
      toast('xp', 'Demo workspace loaded', 'Explore, then reset any time from Stats → Workspace.', '▶');
      reload();
      refreshGami();
    } catch (e) {
      toast('error', 'Could not load demo', e.message, '⚠️');
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
    </>
  );
}
