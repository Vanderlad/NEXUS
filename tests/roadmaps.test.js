import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/db.js';
import { importRoadmap, readRoadmap, listRoadmaps } from '../server/roadmaps.js';

const ORIGIN = { x: 0, y: 0 };

// Exercises every importer feature: rich guides, legacy string resources,
// generated topic ids, valid and dangling prerequisites.
const fixture = () => ({
  slug: 'test-path',
  title: 'Test Path',
  source: 'custom',
  description: 'A tiny roadmap for tests.',
  sections: [
    {
      title: 'Basics',
      description: 'Start here.',
      topics: [
        {
          id: 'alpha', title: 'Alpha', description: 'First topic.',
          why: 'Because it is first.',
          learn: ['Read the intro', 'Do the exercise'],
          resources: [{ label: 'Alpha docs', url: 'https://example.com/alpha' }],
          prerequisites: [],
          criteria: ['You can explain alpha']
        },
        {
          id: 'beta', title: 'Beta',
          resources: ['https://example.com/beta'],   // legacy bare-string resource
          prerequisites: ['alpha']
        }
      ]
    },
    {
      title: 'Advanced',
      topics: [
        { id: 'gamma', title: 'Gamma', prerequisites: ['beta', 'does-not-exist'] },
        { title: 'No Id Topic' }                      // id must be generated
      ]
    }
  ]
});

const getNode = (id) => db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
const edgesOf = (kind) => db.prepare('SELECT source, target FROM edges WHERE kind = ?').all(kind);
const guideOf = (id) => JSON.parse(getNode(id).guide);

beforeEach(() => {
  db.exec('DELETE FROM edges; DELETE FROM links; DELETE FROM nodes; DELETE FROM meta;');
});

describe('importRoadmap — structure', () => {
  it('creates the root, section and topic nodes with type-correct XP', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    expect(rootId).toBe('roadmap-test-path');

    const root = getNode(rootId);
    expect(root.type).toBe('roadmap');
    expect(root.xp).toBe(250);
    expect(root.description).toBe('A tiny roadmap for tests.');

    const s0 = getNode(`${rootId}-s0`);
    const s1 = getNode(`${rootId}-s1`);
    expect(s0.type).toBe('section');
    expect(s0.title).toBe('Basics');
    expect(s0.xp).toBe(60);
    expect(s1.title).toBe('Advanced');

    const alpha = getNode(`${rootId}-alpha`);
    expect(alpha.type).toBe('topic');
    expect(alpha.xp).toBe(40);
    expect(alpha.status).toBe('Not Started');
  });

  it('generates ids for topics without one', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    const generated = getNode(`${rootId}-t1-1`); // section 1, topic 1
    expect(generated).toBeTruthy();
    expect(generated.title).toBe('No Id Topic');
  });

  it('wires contains edges (root→sections, section→topics) and next edges between sections', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);

    const contains = edgesOf('contains');
    expect(contains).toContainEqual({ source: rootId, target: `${rootId}-s0` });
    expect(contains).toContainEqual({ source: rootId, target: `${rootId}-s1` });
    expect(contains).toContainEqual({ source: `${rootId}-s0`, target: `${rootId}-alpha` });
    expect(contains).toContainEqual({ source: `${rootId}-s1`, target: `${rootId}-gamma` });
    expect(contains).toHaveLength(6); // 2 sections + 4 topics

    expect(edgesOf('next')).toEqual([{ source: `${rootId}-s0`, target: `${rootId}-s1` }]);
  });

  it('creates prereq edges only for prerequisites that exist', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    const prereq = edgesOf('prereq');
    expect(prereq).toContainEqual({ source: `${rootId}-alpha`, target: `${rootId}-beta` });
    expect(prereq).toContainEqual({ source: `${rootId}-beta`, target: `${rootId}-gamma` });
    expect(prereq).toHaveLength(2); // 'does-not-exist' produced no edge
  });
});

describe('importRoadmap — guide payload', () => {
  it('stores the full guide as JSON on rich topics', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    expect(guideOf(`${rootId}-alpha`)).toEqual({
      why: 'Because it is first.',
      learn: ['Read the intro', 'Do the exercise'],
      resources: [{ label: 'Alpha docs', url: 'https://example.com/alpha' }],
      prerequisites: [],
      criteria: ['You can explain alpha']
    });
  });

  it('normalizes legacy bare-string resources into {label, url}', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    expect(guideOf(`${rootId}-beta`).resources).toEqual([
      { label: 'https://example.com/beta', url: 'https://example.com/beta' }
    ]);
  });

  it('renders prerequisite ids as topic titles and drops dangling ones', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    expect(guideOf(`${rootId}-beta`).prerequisites).toEqual(['Alpha']);
    expect(guideOf(`${rootId}-gamma`).prerequisites).toEqual(['Beta']);
  });

  it('stores an empty guide string when a topic has no guidance fields', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    expect(getNode(`${rootId}-t1-1`).guide).toBe('');
  });
});

describe('importRoadmap — guards', () => {
  it('rejects invalid documents', () => {
    expect(() => importRoadmap(null, ORIGIN)).toThrow(/Invalid roadmap format/);
    expect(() => importRoadmap({ slug: 'x', title: 'X' }, ORIGIN)).toThrow(/Invalid roadmap format/);
    expect(() => importRoadmap({ slug: 'x', sections: [] }, ORIGIN)).toThrow(/Invalid roadmap format/);
  });

  it('refuses to import the same roadmap twice', () => {
    importRoadmap(fixture(), ORIGIN);
    expect(() => importRoadmap(fixture(), ORIGIN)).toThrow(/already/);
  });

  it('refuses to re-import when leftover child nodes remain after the root was deleted', () => {
    const rootId = importRoadmap(fixture(), ORIGIN);
    db.prepare('DELETE FROM nodes WHERE id = ?').run(rootId); // children survive
    expect(getNode(`${rootId}-alpha`)).toBeTruthy();
    expect(() => importRoadmap(fixture(), ORIGIN)).toThrow(/already|partially/);
  });

  it('rolls back everything when an import fails mid-way (transactional)', () => {
    const bad = fixture();
    bad.sections[1].topics.push({ id: 'alpha', title: 'Duplicate id' }); // collides
    expect(() => importRoadmap(bad, ORIGIN)).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM edges').get().n).toBe(0);
  });
});

describe('readRoadmap', () => {
  it('rejects slugs that are not bare names (path traversal)', () => {
    expect(readRoadmap('../package')).toBeNull();
    expect(readRoadmap('a/b')).toBeNull();
    expect(readRoadmap('..%2Fetc')).toBeNull();
    expect(readRoadmap('')).toBeNull();
  });

  it('returns null for unknown slugs and parsed JSON for real ones', () => {
    expect(readRoadmap('no-such-roadmap')).toBeNull();
    const linux = readRoadmap('linux');
    expect(linux.slug).toBe('linux');
    expect(linux.sections.length).toBeGreaterThan(0);
  });
});

describe('listRoadmaps', () => {
  it('lists the bundled roadmaps sorted by title with topic counts', () => {
    const list = listRoadmaps();
    expect(list.length).toBe(11);
    expect(list.map(r => r.title)).toEqual([...list.map(r => r.title)].sort((a, b) => a.localeCompare(b)));
    for (const r of list) {
      expect(r.slug).toMatch(/^[a-z0-9-]+$/);
      expect(r.topics).toBeGreaterThan(0);
      expect(r.imported).toBe(false);
    }
  });

  it('flips the imported flag once a roadmap is on the map', () => {
    importRoadmap(readRoadmap('linux'), ORIGIN);
    expect(listRoadmaps().find(r => r.slug === 'linux').imported).toBe(true);
  });

  it('every bundled roadmap imports cleanly end-to-end', () => {
    for (const r of listRoadmaps()) {
      const rootId = importRoadmap(readRoadmap(r.slug), ORIGIN);
      const topics = db.prepare(
        `SELECT COUNT(*) AS n FROM nodes WHERE type = 'topic' AND id LIKE ? ESCAPE '\\'`
      ).get(`${rootId.replace(/[\\%_]/g, '\\$&')}-%`).n;
      expect(topics).toBe(r.topics);
    }
  });
});
