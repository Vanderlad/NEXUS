import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT_DIR } from './db.js';
import {
  DONE_STATUSES, onNodeCompleted, gamificationState, checkBadges, xpForNode
} from './gamification.js';
import { listRoadmaps, readRoadmap, importRoadmap } from './roadmaps.js';
import { loadDemo, wipeWorkspace, workspaceCounts } from './demo.js';
import { bulkConfidence, scoreConfidence, CONFIDENCE_TYPES } from './confidence.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = process.env.PORT || 4000;

// --- helpers ---------------------------------------------------------------

const STATUSES = ['Not Started', 'In Progress', 'Submitted', 'Completed'];
const CONTAINER_TYPES = ['course', 'project', 'roadmap', 'section', 'domain', 'goal', 'hub'];
const EDGE_KINDS = ['contains', 'related', 'next', 'prereq'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date (NOT UTC) — due dates come from <input type="date"> and the
// client renders them against local midnight, so the server must agree. Local-first:
// the server's timezone is the user's timezone.
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  return localDateStr();
}

// A node reads as "Overdue" if its deadline passed and it isn't done.
function effectiveStatus(node) {
  if (
    node.due_date &&
    node.due_date < todayStr() &&
    !DONE_STATUSES.includes(node.status)
  ) return 'Overdue';
  return node.status;
}

// Container progress = average of children (via 'contains' edges), recursively.
// Leaf progress = 100 if done, else stored progress.
function computeProgress(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const children = new Map();
  for (const e of edges) {
    if (e.kind !== 'contains') continue;
    if (!children.has(e.source)) children.set(e.source, []);
    children.get(e.source).push(e.target);
  }
  const memo = new Map();
  const progressOf = (id, stack = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (stack.has(id)) return 0; // cycle guard
    stack.add(id);
    const node = byId.get(id);
    if (!node) return 0;
    let value;
    const kids = children.get(id) ?? [];
    if (CONTAINER_TYPES.includes(node.type) && kids.length > 0) {
      value = Math.round(kids.reduce((s, k) => s + progressOf(k, stack), 0) / kids.length);
    } else {
      value = DONE_STATUSES.includes(node.status) ? 100 : node.progress;
    }
    stack.delete(id);
    memo.set(id, value);
    return value;
  };
  return nodes.map(n => ({
    ...n,
    progress: progressOf(n.id),
    effective_status: effectiveStatus(n)
  }));
}

function allNodesComputed() {
  const nodes = db.prepare('SELECT * FROM nodes').all();
  const edges = db.prepare('SELECT * FROM edges').all();
  return { nodes: computeProgress(nodes, edges), edges };
}

function getNode(id) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
}

// A node with derived progress + effective_status — what clients should render.
// Containers store progress=0 but display the recursive child average, so raw
// rows must never be returned to the UI.
function getNodeComputed(id) {
  return allNodesComputed().nodes.find(n => n.id === id) ?? null;
}

// --- graph -------------------------------------------------------------------

app.get('/api/graph', (req, res) => {
  const { nodes, edges } = allNodesComputed();
  const confidence = bulkConfidence(nodes, edges);
  res.json({
    nodes: nodes.map(n => {
      const c = confidence.get(n.id);
      return c ? { ...n, confidence: { score: c.score, tier: c.tier } } : n;
    }),
    edges
  });
});

// Body values arrive untyped from JSON — coerce/clamp everything before it
// touches SQLite so bad input yields a 400, never a 500.
const str = (v) => (v == null ? '' : String(v));
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const dateOrNull = (v) => (v && DATE_RE.test(String(v)) ? String(v) : null);

app.post('/api/nodes', (req, res) => {
  const b = req.body ?? {};
  if (!b.title || !String(b.title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  const id = b.id ? String(b.id) : crypto.randomUUID();
  if (getNode(id)) {
    return res.status(409).json({ error: `node "${id}" already exists` });
  }
  db.prepare(`
    INSERT INTO nodes (id, title, type, description, notes, next_actions, status, progress,
                       due_date, category, xp, pos_x, pos_y, github_repo, url,
                       guide, instructor, semester)
    VALUES (@id, @title, @type, @description, @notes, @next_actions, @status, @progress,
            @due_date, @category, @xp, @pos_x, @pos_y, @github_repo, @url,
            @guide, @instructor, @semester)
  `).run({
    id,
    title: String(b.title).trim(),
    type: str(b.type) || 'topic',
    description: str(b.description),
    notes: str(b.notes),
    next_actions: str(b.next_actions),
    status: STATUSES.includes(b.status) ? b.status : 'Not Started',
    progress: clampPct(b.progress),
    due_date: dateOrNull(b.due_date),
    category: str(b.category),
    xp: Math.max(0, Number(b.xp) || 0),
    pos_x: Number(b.pos_x) || 0,
    pos_y: Number(b.pos_y) || 0,
    github_repo: str(b.github_repo),
    url: str(b.url),
    guide: typeof b.guide === 'object' && b.guide !== null ? JSON.stringify(b.guide) : str(b.guide),
    instructor: str(b.instructor),
    semester: str(b.semester)
  });
  if (b.parent_id && getNode(b.parent_id)) {
    db.prepare('INSERT INTO edges (id, source, target, kind) VALUES (?, ?, ?, ?)')
      .run(crypto.randomUUID(), String(b.parent_id), id, 'contains');
  }
  res.json({ node: getNodeComputed(id) });
});

const PATCHABLE = [
  'title', 'type', 'description', 'notes', 'next_actions', 'status', 'progress',
  'due_date', 'category', 'xp', 'pos_x', 'pos_y', 'collapsed', 'github_repo', 'url',
  'instructor', 'semester'
];

const NUMERIC_PATCH = { progress: clampPct, xp: (v) => Math.max(0, Number(v) || 0), pos_x: (v) => Number(v) || 0, pos_y: (v) => Number(v) || 0 };

app.patch('/api/nodes/:id', (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'node not found' });

  const b = req.body ?? {};
  const updates = {};
  for (const key of PATCHABLE) {
    if (!(key in b)) continue;
    let v = b[key];
    if (key === 'collapsed') v = v ? 1 : 0;
    else if (key in NUMERIC_PATCH) v = NUMERIC_PATCH[key](v);
    else if (key === 'due_date') v = dateOrNull(v);
    else if (key === 'status') { if (!STATUSES.includes(v)) continue; }
    else v = str(v); // free-text columns: coerce so SQLite never sees bools/objects
    updates[key] = v;
  }
  if (Object.keys(updates).length === 0) {
    return res.json({ node: getNodeComputed(node.id), gamification: null });
  }

  const wasDone = DONE_STATUSES.includes(node.status);
  const nowDone = 'status' in updates && DONE_STATUSES.includes(updates.status);
  if (nowDone && !wasDone) {
    updates.progress = 100;
    updates.completed_at = new Date().toISOString();
  } else if (wasDone && 'status' in updates && !DONE_STATUSES.includes(updates.status)) {
    updates.completed_at = null; // un-completing clears the stale completion date (XP stays)
  }

  const cols = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE nodes SET ${cols}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...updates, id: node.id });

  let gamification = null;
  if (nowDone && !wasDone) {
    gamification = onNodeCompleted(getNode(node.id));
  } else if ('notes' in updates) {
    const newBadges = checkBadges(); // e.g. Scribe: write notes on 5 nodes
    if (newBadges.length) gamification = { newBadges };
  }
  res.json({ node: getNodeComputed(node.id), gamification });
});

app.delete('/api/nodes/:id', (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'node not found' });
  db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id); // edges/links cascade
  res.json({ ok: true });
});

app.get('/api/nodes/:id', (req, res) => {
  const node = getNodeComputed(req.params.id);
  if (!node) return res.status(404).json({ error: 'node not found' });
  const links = db.prepare('SELECT * FROM links WHERE node_id = ? ORDER BY created_at').all(node.id);
  const related = db.prepare(`
    SELECT n.id, n.title, n.type, n.status, n.progress, e.kind,
           CASE WHEN e.source = @id THEN 'out' ELSE 'in' END AS direction
    FROM edges e
    JOIN nodes n ON n.id = CASE WHEN e.source = @id THEN e.target ELSE e.source END
    WHERE e.source = @id OR e.target = @id
  `).all({ id: node.id });

  let guide = null;
  if (node.guide) {
    try { guide = JSON.parse(node.guide); } catch { guide = null; }
  }
  const confidence = CONFIDENCE_TYPES.includes(node.type)
    ? scoreConfidence(node, links, related)
    : null;

  res.json({
    node: { ...node, effective_status: effectiveStatus(node) },
    links,
    related,
    guide,
    confidence,
    xp_value: xpForNode(node)
  });
});

// --- edges -------------------------------------------------------------------

// Would adding source→target as 'contains' create a cycle? BFS up from source
// through ALL containment parents; if we reach target, the new edge closes a loop.
function containsCycle(source, target) {
  const parents = new Map(); // node -> [its parents]
  for (const e of db.prepare(`SELECT source, target FROM edges WHERE kind = 'contains'`).all()) {
    if (!parents.has(e.target)) parents.set(e.target, []);
    parents.get(e.target).push(e.source);
  }
  const seen = new Set([source]);
  const queue = [source];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === target) return true;
    for (const p of parents.get(cur) ?? []) {
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  }
  return false;
}

app.post('/api/edges', (req, res) => {
  const { source, target } = req.body ?? {};
  const kind = EDGE_KINDS.includes(req.body?.kind) ? req.body.kind : 'related';
  if (source === target) {
    return res.status(400).json({ error: 'a node cannot connect to itself' });
  }
  if (!getNode(source) || !getNode(target)) {
    return res.status(400).json({ error: 'source and target must be existing nodes' });
  }
  const dup = db.prepare(
    'SELECT id FROM edges WHERE (source = ? AND target = ?) OR (source = ? AND target = ?)'
  ).get(source, target, target, source);
  if (dup) return res.status(409).json({ error: 'edge already exists' });
  if (kind === 'contains' && containsCycle(source, target)) {
    return res.status(409).json({ error: 'that connection would create a containment cycle' });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO edges (id, source, target, kind) VALUES (?, ?, ?, ?)')
    .run(id, source, target, kind);
  res.json({ edge: db.prepare('SELECT * FROM edges WHERE id = ?').get(id) });
});

app.delete('/api/edges/:id', (req, res) => {
  db.prepare('DELETE FROM edges WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- links (attached files / folders / repos / urls) --------------------------

app.post('/api/nodes/:id/links', (req, res) => {
  const node = getNode(req.params.id);
  if (!node) return res.status(404).json({ error: 'node not found' });
  const { kind, label, target } = req.body ?? {};
  if (!target || !String(target).trim()) {
    return res.status(400).json({ error: 'target (path or URL) is required' });
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO links (id, node_id, kind, label, target) VALUES (?, ?, ?, ?, ?)')
    .run(id, node.id, kind ?? 'url', label ?? '', String(target).trim());
  const newBadges = checkBadges();
  res.json({ link: db.prepare('SELECT * FROM links WHERE id = ?').get(id), newBadges });
});

app.delete('/api/links/:id', (req, res) => {
  db.prepare('DELETE FROM links WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- dashboard -----------------------------------------------------------------

app.get('/api/dashboard', (req, res) => {
  const { nodes } = allNodesComputed();
  const today = todayStr();
  const week = localDateStr(7);
  const month = localDateStr(30);

  const pending = nodes
    .filter(n => n.due_date && !DONE_STATUSES.includes(n.status))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const slim = n => ({
    id: n.id, title: n.title, type: n.type, due_date: n.due_date,
    status: n.effective_status, progress: n.progress
  });

  const courses = nodes.filter(n => n.type === 'course');
  const projects = nodes.filter(n => n.type === 'project');
  const goals = nodes.filter(n => n.type === 'goal');
  const skills = nodes.filter(n => n.type === 'skill');

  const avg = arr => arr.length
    ? Math.round(arr.reduce((s, n) => s + n.progress, 0) / arr.length)
    : 0;

  // XP earned per day over the past week — the dashboard momentum strip.
  // created_at is stored UTC; bucket by *local* day to match due dates and streaks.
  const last7 = [];
  for (let i = 6; i >= 0; i--) last7.push(localDateStr(-i));
  const xpByDay = new Map(db.prepare(`
    SELECT date(created_at, 'localtime') AS day, SUM(amount) AS xp FROM xp_events
    WHERE created_at >= datetime('now', '-8 days') GROUP BY day
  `).all().map(r => [r.day, r.xp]));

  const leaves = nodes.filter(n => !CONTAINER_TYPES.includes(n.type));
  const leavesDone = leaves.filter(n => DONE_STATUSES.includes(n.status)).length;

  res.json({
    deadlines: {
      overdue: pending.filter(n => n.due_date < today).map(slim),
      today: pending.filter(n => n.due_date === today).map(slim),
      thisWeek: pending.filter(n => n.due_date > today && n.due_date <= week).map(slim),
      thisMonth: pending.filter(n => n.due_date > week && n.due_date <= month).map(slim)
    },
    courses: courses.map(slim),
    projects: projects.filter(n => !DONE_STATUSES.includes(n.status)).map(slim),
    goals: goals.map(slim),
    domains: {
      school: avg(courses),
      skills: avg(skills),
      projects: avg(projects),
      goals: avg(goals)
    },
    overall: {
      done: leavesDone,
      total: leaves.length,
      pct: leaves.length ? Math.round((leavesDone / leaves.length) * 100) : 0
    },
    week: last7.map(day => ({ day, xp: xpByDay.get(day) ?? 0 })),
    gamification: gamificationState()
  });
});

// --- search ---------------------------------------------------------------------

app.get('/api/search', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ results: [] });
  // Escape LIKE wildcards so searching "100%" or "snake_case" matches literally.
  const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = db.prepare(`
    SELECT id, title, type, status, due_date, description, notes
    FROM nodes
    WHERE title LIKE @like ESCAPE '\\' OR description LIKE @like ESCAPE '\\'
       OR notes LIKE @like ESCAPE '\\' OR next_actions LIKE @like ESCAPE '\\'
    ORDER BY
      CASE WHEN title LIKE @like ESCAPE '\\' THEN 0 ELSE 1 END,
      title
    LIMIT 30
  `).all({ like });
  const linkHits = db.prepare(`
    SELECT l.node_id AS id, n.title, n.type, n.status, n.due_date, l.target AS matched_link
    FROM links l JOIN nodes n ON n.id = l.node_id
    WHERE l.target LIKE ? ESCAPE '\\' OR l.label LIKE ? ESCAPE '\\'
    LIMIT 10
  `).all(like, like);
  const seen = new Set(rows.map(r => r.id));
  const results = [
    ...rows.map(r => {
      let snippet = '';
      const lower = q.toLowerCase();
      for (const field of [r.description, r.notes]) {
        const i = (field ?? '').toLowerCase().indexOf(lower);
        if (i >= 0) {
          snippet = field.slice(Math.max(0, i - 30), i + 60).trim();
          break;
        }
      }
      return { id: r.id, title: r.title, type: r.type, status: r.status, due_date: r.due_date, snippet };
    }),
    ...linkHits.filter(r => !seen.has(r.id)).map(r => ({
      id: r.id, title: r.title, type: r.type, status: r.status,
      due_date: r.due_date, snippet: `linked: ${r.matched_link}`
    }))
  ];
  res.json({ results });
});

// --- gamification -----------------------------------------------------------------

app.get('/api/gamification', (req, res) => {
  res.json(gamificationState());
});

// --- stats / accomplishments --------------------------------------------------------

app.get('/api/stats', (req, res) => {
  const { nodes, edges } = allNodesComputed();
  const confidence = bulkConfidence(nodes, edges);

  const isDone = n => DONE_STATUSES.includes(n.status);
  const ofType = (...types) => nodes.filter(n => types.includes(n.type));
  const bucket = (items) => ({ total: items.length, done: items.filter(isDone).length });

  const coursework = ofType('assignment', 'exam', 'quiz', 'lab', 'task');
  const skills = ofType('skill', 'topic');
  const leaves = nodes.filter(n => !CONTAINER_TYPES.includes(n.type));

  const tiers = { 'Not enough evidence': 0, 'Some exposure': 0, 'Practiced': 0, 'Demonstrated': 0 };
  for (const c of confidence.values()) tiers[c.tier]++;

  // Daily activity, last 14 days (XP + completions per *local* day).
  const days = [];
  for (let i = 13; i >= 0; i--) days.push(localDateStr(-i));
  const xpByDay = new Map(db.prepare(`
    SELECT date(created_at, 'localtime') AS day, SUM(amount) AS xp, COUNT(*) AS events
    FROM xp_events WHERE created_at >= datetime('now', '-15 days')
    GROUP BY day
  `).all().map(r => [r.day, r]));
  const daily = days.map(day => ({
    day,
    xp: xpByDay.get(day)?.xp ?? 0,
    completions: xpByDay.get(day)?.events ?? 0
  }));

  // Weekly XP, last 8 weeks (bucket 0 = this week).
  const weekly = Array.from({ length: 8 }, (_, i) => ({ weeksAgo: 7 - i, xp: 0 }));
  for (const r of db.prepare(`
    SELECT CAST(julianday('now') - julianday(created_at) AS INTEGER) / 7 AS weeksAgo, SUM(amount) AS xp
    FROM xp_events WHERE created_at >= datetime('now', '-56 days')
    GROUP BY weeksAgo
  `).all()) {
    const slot = weekly.find(w => w.weeksAgo === r.weeksAgo);
    if (slot) slot.xp = r.xp;
  }

  res.json({
    gamification: gamificationState(),
    counts: {
      courses: bucket(ofType('course')),
      coursework: bucket(coursework),
      projects: bucket(ofType('project')),
      goals: bucket(ofType('goal')),
      skills: bucket(skills),
      roadmaps: bucket(ofType('roadmap')),
      notes: nodes.filter(n => (n.notes ?? '').trim().length > 0).length,
      filesLinked: db.prepare('SELECT COUNT(*) AS n FROM links').get().n,
      connections: edges.length
    },
    overall: {
      done: leaves.filter(isDone).length,
      total: leaves.length,
      pct: leaves.length ? Math.round((leaves.filter(isDone).length / leaves.length) * 100) : 0
    },
    confidenceTiers: tiers,
    topSkills: [...confidence.entries()]
      .map(([id, c]) => {
        const n = nodes.find(x => x.id === id);
        return { id, title: n.title, type: n.type, score: c.score, tier: c.tier };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
    daily,
    weekly
  });
});

// --- workspace lifecycle --------------------------------------------------------------

app.get('/api/workspace', (req, res) => {
  res.json(workspaceCounts());
});

app.post('/api/workspace/demo', (req, res) => {
  try {
    const n = loadDemo();
    res.json({ ok: true, nodes: n });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/workspace/reset', (req, res) => {
  wipeWorkspace();
  res.json({ ok: true });
});

// --- roadmaps ----------------------------------------------------------------------

app.get('/api/roadmaps', (req, res) => {
  res.json({ roadmaps: listRoadmaps() });
});

app.post('/api/roadmaps/:slug/import', (req, res) => {
  const data = readRoadmap(req.params.slug);
  if (!data) return res.status(404).json({ error: 'roadmap not found' });
  try {
    const rootId = importRoadmap(data);
    const newBadges = checkBadges();
    res.json({ rootId, newBadges });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Import a custom roadmap JSON document (same format as roadmaps/*.json).
app.post('/api/roadmaps/import', (req, res) => {
  try {
    const rootId = importRoadmap(req.body);
    const newBadges = checkBadges();
    res.json({ rootId, newBadges });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- static client (production build) ------------------------------------------------

const DIST = path.join(ROOT_DIR, 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`NEXUS api listening on http://localhost:${PORT}${fs.existsSync(DIST) ? ' (serving built UI)' : ''}`);
});
