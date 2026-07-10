import { describe, it, expect, beforeEach } from 'vitest';
import { db, setMeta, getMeta } from '../server/db.js';
import { exportSnapshot, importSnapshot, validateSnapshot, isDirtySince } from '../server/sync.js';

const wipeAll = () => db.exec('DELETE FROM edges; DELETE FROM links; DELETE FROM xp_events; DELETE FROM badges; DELETE FROM nodes; DELETE FROM meta;');

function seedWorkspace() {
  db.prepare(`INSERT INTO nodes (id, title, type, status, progress, notes, due_date, guide)
              VALUES ('s1', 'Python', 'skill', 'In Progress', 60, 'my notes', '2027-01-15', '{"why":"x"}')`).run();
  db.prepare(`INSERT INTO nodes (id, title, type, status, progress) VALUES ('p1', 'Project', 'project', 'Completed', 100)`).run();
  db.prepare(`INSERT INTO edges (id, source, target, kind) VALUES ('e1', 's1', 'p1', 'related')`).run();
  db.prepare(`INSERT INTO links (id, node_id, kind, label, target) VALUES ('l1', 's1', 'repo', 'GH', 'https://example.com')`).run();
  db.prepare(`INSERT INTO xp_events (id, node_id, amount, reason) VALUES (7, 'p1', 150, 'Completed: Project')`).run();
  db.prepare(`INSERT INTO badges (key) VALUES ('first-steps')`).run();
  setMeta('user_name', 'Vlad');
  setMeta('theme', 'crimson');
  setMeta('streak_count', '3');
}

beforeEach(wipeAll);

describe('exportSnapshot', () => {
  it('captures every table and stamps app/version/exported_at', () => {
    seedWorkspace();
    const snap = exportSnapshot();
    expect(snap.app).toBe('nexus');
    expect(snap.version).toBe(1);
    expect(new Date(snap.exported_at).getTime()).not.toBeNaN();
    expect(snap.data.nodes).toHaveLength(2);
    expect(snap.data.edges).toHaveLength(1);
    expect(snap.data.links).toHaveLength(1);
    expect(snap.data.xp_events).toHaveLength(1);
    expect(snap.data.badges).toHaveLength(1);
  });

  it('NEVER includes github_/sync_ secrets in the snapshot', () => {
    seedWorkspace();
    setMeta('github_token', 'ghp_supersecret');
    setMeta('github_user', 'someone');
    setMeta('sync_remote_sha', 'abc123');
    const text = JSON.stringify(exportSnapshot());
    expect(text).not.toContain('supersecret');
    expect(text).not.toContain('github_token');
    expect(text).not.toContain('sync_remote_sha');
    // …but personal prefs ARE included
    expect(exportSnapshot().data.meta).toContainEqual({ key: 'user_name', value: 'Vlad' });
  });
});

describe('importSnapshot', () => {
  it('round-trips: export → wipe → import restores identical data', () => {
    seedWorkspace();
    const snap = exportSnapshot();
    wipeAll();
    const n = importSnapshot(snap);
    expect(n).toBe(2);
    expect(exportSnapshot().data).toEqual(snap.data);
    expect(getMeta('theme')).toBe('crimson');
  });

  it('replaces existing workspace data entirely', () => {
    seedWorkspace();
    const snap = exportSnapshot();
    wipeAll();
    db.prepare(`INSERT INTO nodes (id, title, type) VALUES ('old', 'Old Node', 'note')`).run();
    importSnapshot(snap);
    expect(db.prepare(`SELECT id FROM nodes WHERE id = 'old'`).get()).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n).toBe(2);
  });

  it('preserves the local GitHub connection across an import', () => {
    seedWorkspace();
    const snap = exportSnapshot();
    setMeta('github_token', 'ghp_localtoken');
    setMeta('sync_repo', 'my-backup');
    importSnapshot(snap);
    expect(getMeta('github_token')).toBe('ghp_localtoken');
    expect(getMeta('sync_repo')).toBe('my-backup');
  });

  it('drops edges/links that reference nodes missing from the snapshot', () => {
    seedWorkspace();
    const snap = exportSnapshot();
    snap.data.edges.push({ id: 'ghost-e', source: 's1', target: 'nope', kind: 'related' });
    snap.data.links.push({ id: 'ghost-l', node_id: 'nope', kind: 'url', label: '', target: 'x' });
    importSnapshot(snap);
    expect(db.prepare('SELECT COUNT(*) AS n FROM edges').get().n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM links').get().n).toBe(1);
  });

  it('rejects malformed snapshots without touching existing data', () => {
    seedWorkspace();
    for (const bad of [
      null,
      {},
      { app: 'other', version: 1, data: { nodes: [], edges: [], links: [], xp_events: [], badges: [], meta: [] } },
      { app: 'nexus', version: 99, data: { nodes: [], edges: [], links: [], xp_events: [], badges: [], meta: [] } },
      { app: 'nexus', version: 1, data: { nodes: 'nope' } },
      { app: 'nexus', version: 1, data: { nodes: [{ id: 'x' }], edges: [], links: [], xp_events: [], badges: [], meta: [] } }
    ]) {
      expect(() => importSnapshot(bad)).toThrow(/Invalid snapshot/);
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n).toBe(2);
  });

  it('validateSnapshot returns null for a fresh export', () => {
    seedWorkspace();
    expect(validateSnapshot(exportSnapshot())).toBeNull();
  });
});

describe('isDirtySince', () => {
  it('is dirty with no sync timestamp, clean right after one, dirty after changes', () => {
    seedWorkspace();
    expect(isDirtySince(null)).toBe(true);

    const now = db.prepare(`SELECT datetime('now', '+1 second') AS t`).get().t;
    expect(isDirtySince(now)).toBe(false);

    db.prepare(`INSERT INTO xp_events (node_id, amount, reason, created_at)
                VALUES ('s1', 10, 'later', datetime('now', '+2 seconds'))`).run();
    expect(isDirtySince(now)).toBe(true);
  });
});
