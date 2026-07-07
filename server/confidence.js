import { db } from './db.js';
import { DONE_STATUSES } from './gamification.js';

// ---------------------------------------------------------------------------
// Skill completion confidence — a transparent heuristic (no AI) estimating how
// likely it is that a skill/topic has actually been practiced or demonstrated,
// based on linked evidence. Every signal is capped so no single kind of
// evidence can max the score alone; the breakdown is shown in the UI.
// ---------------------------------------------------------------------------

export const CONFIDENCE_TYPES = ['skill', 'topic'];

const TIERS = [
  { max: 25, label: 'Not enough evidence' },
  { max: 50, label: 'Some exposure' },
  { max: 75, label: 'Practiced' },
  { max: 100, label: 'Demonstrated' }
];
export const tierFor = (score) => TIERS.find(t => score <= t.max).label;

const LINK_POINTS = { repo: 15, folder: 10, file: 8, url: 4 };
const WORK_TYPES = new Set(['assignment', 'exam', 'quiz', 'lab', 'task', 'topic', 'section']);

// node: the skill/topic row · links: its attachment rows · neighbors: nodes
// connected by any edge (either direction), used as indirect evidence.
export function scoreConfidence(node, links, neighbors) {
  const signals = [];

  let linkPts = 0;
  for (const l of links) linkPts += LINK_POINTS[l.kind] ?? 4;
  if (linkPts > 0) {
    signals.push({ label: `Linked evidence — ${links.length} file/folder/repo/url`, points: Math.min(30, linkPts) });
  }

  const noteLen = (node.notes ?? '').trim().length;
  if (noteLen >= 250) signals.push({ label: 'Detailed personal notes', points: 12 });
  else if (noteLen >= 40) signals.push({ label: 'Personal notes', points: 6 });

  if (DONE_STATUSES.includes(node.status)) {
    signals.push({ label: 'Marked complete', points: 20 });
  } else if (node.progress > 0) {
    signals.push({ label: `Self-reported progress (${node.progress}%)`, points: Math.round(node.progress * 0.15) });
  }

  const doneWork = neighbors.filter(n => WORK_TYPES.has(n.type) && DONE_STATUSES.includes(n.status));
  if (doneWork.length > 0) {
    signals.push({ label: `Completed connected work (${doneWork.length})`, points: Math.min(30, doneWork.length * 10) });
  }

  const projects = neighbors.filter(n => n.type === 'project');
  let projPts = 0;
  for (const p of projects) {
    projPts += DONE_STATUSES.includes(p.status) ? 15 : p.progress >= 40 ? 10 : 5;
  }
  if (projPts > 0) {
    signals.push({ label: `Applied in projects (${projects.length})`, points: Math.min(25, projPts) });
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  return { score, tier: tierFor(score), signals };
}

// Confidence for every skill/topic node in one pass (used by /api/graph and /api/stats).
export function bulkConfidence(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const neighborIds = new Map();
  const addNeighbor = (a, b) => {
    if (!neighborIds.has(a)) neighborIds.set(a, []);
    neighborIds.get(a).push(b);
  };
  for (const e of edges) {
    addNeighbor(e.source, e.target);
    addNeighbor(e.target, e.source);
  }

  const linksBy = new Map();
  for (const l of db.prepare('SELECT node_id, kind FROM links').all()) {
    if (!linksBy.has(l.node_id)) linksBy.set(l.node_id, []);
    linksBy.get(l.node_id).push(l);
  }

  const out = new Map();
  for (const n of nodes) {
    if (!CONFIDENCE_TYPES.includes(n.type)) continue;
    const neighbors = (neighborIds.get(n.id) ?? []).map(id => byId.get(id)).filter(Boolean);
    out.set(n.id, scoreConfidence(n, linksBy.get(n.id) ?? [], neighbors));
  }
  return out;
}
