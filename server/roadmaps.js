import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, ROOT_DIR } from './db.js';

const ROADMAP_DIR = path.join(ROOT_DIR, 'roadmaps');

// ---------------------------------------------------------------------------
// Roadmap JSON format (see roadmaps/*.json):
// {
//   "slug": "backend-developer",          // unique id, becomes node id "roadmap-<slug>"
//   "title": "Backend Developer",
//   "source": "roadmap.sh",               // provenance label ("custom" for your own)
//   "url": "https://roadmap.sh/backend",  // optional
//   "description": "...",
//   "sections": [
//     {
//       "title": "Internet & Networking",
//       "description": "...",
//       "topics": [
//         {
//           "id": "http", "title": "HTTP",
//           "description": "What the topic is.",
//           "why": "Why it matters.",
//           "learn": ["First learn…", "Then…"],
//           "resources": [{ "label": "MDN — HTTP", "url": "https://…" }],
//           "prerequisites": ["earlier-topic-id"],
//           "criteria": ["You can explain…", "You built…"]
//         }
//       ]
//     }
//   ]
// }
//
// Guidance fields (why/learn/resources/prerequisites/criteria) are stored as
// JSON in nodes.guide and rendered as a structured guide in the detail panel.
// Prerequisites also become 'prereq' edges, which drive locked/unlocked states
// on the map. This is the seam for a future live roadmap.sh integration:
// anything that can produce this JSON plugs in here.
// ---------------------------------------------------------------------------

export function listRoadmaps() {
  if (!fs.existsSync(ROADMAP_DIR)) return [];
  return fs.readdirSync(ROADMAP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(ROADMAP_DIR, f), 'utf8'));
        const topicCount = (data.sections ?? []).reduce((n, s) => n + (s.topics?.length ?? 0), 0);
        const rootId = `roadmap-${data.slug}`;
        const imported = !!db.prepare('SELECT id FROM nodes WHERE id = ?').get(rootId);
        return {
          slug: data.slug,
          title: data.title,
          source: data.source ?? 'custom',
          url: data.url ?? '',
          description: data.description ?? '',
          sections: (data.sections ?? []).length,
          topics: topicCount,
          imported
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function readRoadmap(slug) {
  // Slug comes from the URL — allow only bare names, never paths.
  if (!/^[a-z0-9-]+$/i.test(String(slug))) return null;
  const file = path.join(ROADMAP_DIR, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function nextImportOrigin() {
  const row = db.prepare('SELECT COALESCE(MAX(pos_x), 0) AS mx FROM nodes').get();
  return { x: Math.max(row.mx + 500, 1500), y: -400 };
}

// Accepts both { label, url } objects and bare "https://…" strings.
function normalizeResources(resources) {
  return (resources ?? []).map(r =>
    typeof r === 'string' ? { label: r, url: r } : { label: r.label ?? r.url, url: r.url }
  ).filter(r => r.url);
}

// Converts a roadmap JSON document into skill-tree nodes + edges.
// Returns the created root node id.
export function importRoadmap(data, origin = null) {
  if (!data || !data.slug || !data.title || !Array.isArray(data.sections)) {
    throw new Error('Invalid roadmap format: expected { slug, title, sections: [...] }');
  }
  const rootId = `roadmap-${data.slug}`;
  // Check the root AND leftover section/topic nodes (e.g. the root was deleted
  // but children remain) — otherwise re-import dies on an id collision mid-insert.
  const existing = db.prepare(`SELECT id FROM nodes WHERE id = ? OR id LIKE ? ESCAPE '\\'`)
    .get(rootId, `${rootId.replace(/[\\%_]/g, '\\$&')}-%`);
  if (existing) {
    throw new Error(`Roadmap "${data.title}" is already (or partially) on your map — delete its nodes first to re-import.`);
  }

  const o = origin ?? nextImportOrigin();
  const insertNode = db.prepare(`
    INSERT INTO nodes (id, title, type, description, status, xp, category, pos_x, pos_y, url, guide)
    VALUES (@id, @title, @type, @description, 'Not Started', @xp, @category, @pos_x, @pos_y, @url, @guide)
  `);
  const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind) VALUES (?, ?, ?, ?)');
  const eid = () => crypto.randomUUID();

  const tx = db.transaction(() => {
    // Vertical placement: sections stack, each section's topics fan out beside it.
    const TOPIC_DY = 110;
    const SECTION_GAP = 140;
    let yCursor = o.y;

    insertNode.run({
      id: rootId, title: data.title, type: 'roadmap',
      description: data.description ?? `Learning path (${data.source ?? 'custom'})`,
      xp: 250, category: 'learning', pos_x: o.x, pos_y: o.y, url: data.url ?? '', guide: ''
    });

    // Topic titles by local id, for rendering prerequisite names in the guide.
    const titleByLocalId = new Map();
    for (const section of data.sections) {
      for (const t of section.topics ?? []) {
        if (t.id) titleByLocalId.set(t.id, t.title);
      }
    }

    const prereqEdges = []; // [fromTopicNodeId, toTopicNodeId]
    let prevSectionId = null;

    data.sections.forEach((section, si) => {
      const topics = section.topics ?? [];
      const blockHeight = Math.max(TOPIC_DY, topics.length * TOPIC_DY);
      const sectionId = `${rootId}-s${si}`;
      const sectionY = yCursor + blockHeight / 2 - TOPIC_DY / 2;

      insertNode.run({
        id: sectionId, title: section.title, type: 'section',
        description: section.description ?? '', xp: 60, category: 'learning',
        pos_x: o.x + 340, pos_y: sectionY, url: '', guide: ''
      });
      insertEdge.run(eid(), rootId, sectionId, 'contains');
      if (prevSectionId) insertEdge.run(eid(), prevSectionId, sectionId, 'next');
      prevSectionId = sectionId;

      topics.forEach((topic, ti) => {
        const topicId = `${rootId}-${topic.id ?? `t${si}-${ti}`}`;
        const prereqIds = (topic.prerequisites ?? []).filter(p => titleByLocalId.has(p));
        const guide = {
          why: topic.why ?? '',
          learn: topic.learn ?? [],
          resources: normalizeResources(topic.resources),
          prerequisites: prereqIds.map(p => titleByLocalId.get(p)),
          criteria: topic.criteria ?? []
        };
        const hasGuide = guide.why || guide.learn.length || guide.resources.length
          || guide.prerequisites.length || guide.criteria.length;

        insertNode.run({
          id: topicId, title: topic.title, type: 'topic',
          description: topic.description ?? '', xp: 40, category: 'learning',
          pos_x: o.x + 700, pos_y: yCursor + ti * TOPIC_DY, url: topic.url ?? '',
          guide: hasGuide ? JSON.stringify(guide) : ''
        });
        insertEdge.run(eid(), sectionId, topicId, 'contains');
        for (const p of prereqIds) prereqEdges.push([`${rootId}-${p}`, topicId]);
      });

      yCursor += blockHeight + SECTION_GAP;
    });

    // Prerequisite edges drive locked/unlocked display on the map.
    const nodeExists = db.prepare('SELECT 1 FROM nodes WHERE id = ?');
    for (const [from, to] of prereqEdges) {
      if (nodeExists.get(from)) insertEdge.run(eid(), from, to, 'prereq');
    }
  });
  tx();
  return rootId;
}
