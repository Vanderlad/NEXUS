import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../server/db.js';
import { scoreConfidence, bulkConfidence, tierFor, CONFIDENCE_TYPES } from '../server/confidence.js';

// Minimal node row with the fields scoreConfidence reads.
const node = (extra = {}) => ({
  id: 'skill-x', type: 'skill', title: 'X',
  notes: '', status: 'Not Started', progress: 0,
  ...extra
});

const link = (kind) => ({ node_id: 'skill-x', kind });

const points = (result, labelPart) =>
  result.signals.find(s => s.label.includes(labelPart))?.points;

describe('tierFor', () => {
  it('maps scores to the documented tier boundaries', () => {
    expect(tierFor(0)).toBe('Not enough evidence');
    expect(tierFor(25)).toBe('Not enough evidence');
    expect(tierFor(26)).toBe('Some exposure');
    expect(tierFor(50)).toBe('Some exposure');
    expect(tierFor(51)).toBe('Practiced');
    expect(tierFor(75)).toBe('Practiced');
    expect(tierFor(76)).toBe('Demonstrated');
    expect(tierFor(100)).toBe('Demonstrated');
  });
});

describe('scoreConfidence — individual signals', () => {
  it('scores zero with no evidence at all', () => {
    const r = scoreConfidence(node(), [], []);
    expect(r.score).toBe(0);
    expect(r.tier).toBe('Not enough evidence');
    expect(r.signals).toEqual([]);
  });

  it('awards link points by kind: repo 15, folder 10, file 8, url 4, unknown 4', () => {
    expect(scoreConfidence(node(), [link('repo')], []).score).toBe(15);
    expect(scoreConfidence(node(), [link('folder')], []).score).toBe(10);
    expect(scoreConfidence(node(), [link('file')], []).score).toBe(8);
    expect(scoreConfidence(node(), [link('url')], []).score).toBe(4);
    expect(scoreConfidence(node(), [link('mystery')], []).score).toBe(4);
  });

  it('caps linked evidence at 30 no matter how many links', () => {
    const r = scoreConfidence(node(), [link('repo'), link('repo'), link('repo'), link('repo')], []);
    expect(points(r, 'Linked evidence')).toBe(30);
    expect(r.score).toBe(30);
  });

  it('scores notes by length: <40 nothing, ≥40 +6, ≥250 +12 (not both)', () => {
    expect(scoreConfidence(node({ notes: 'x'.repeat(39) }), [], []).score).toBe(0);
    expect(scoreConfidence(node({ notes: 'x'.repeat(40) }), [], []).score).toBe(6);
    expect(scoreConfidence(node({ notes: 'x'.repeat(249) }), [], []).score).toBe(6); // just under the detailed tier
    const detailed = scoreConfidence(node({ notes: 'x'.repeat(250) }), [], []);
    expect(detailed.score).toBe(12);
    expect(detailed.signals).toHaveLength(1);
  });

  it('ignores whitespace-only notes', () => {
    expect(scoreConfidence(node({ notes: ' '.repeat(300) }), [], []).score).toBe(0);
  });

  it('awards +20 for own completion (Completed or Submitted), suppressing the progress signal', () => {
    for (const status of ['Completed', 'Submitted']) {
      const r = scoreConfidence(node({ status, progress: 60 }), [], []);
      expect(r.score).toBe(20);
      expect(r.signals).toHaveLength(1);
      expect(points(r, 'Marked complete')).toBe(20);
    }
  });

  it('scores self-reported progress at 0.15 pts per percent when not done', () => {
    expect(scoreConfidence(node({ progress: 50 }), [], []).score).toBe(8);  // round(7.5)
    expect(scoreConfidence(node({ progress: 100 }), [], []).score).toBe(15);
    expect(scoreConfidence(node({ progress: 0 }), [], []).signals).toEqual([]);
  });

  it('emits no zero-point signal for tiny progress (1-3%) and 1 point at 7%', () => {
    expect(scoreConfidence(node({ progress: 3 }), [], []).signals).toEqual([]); // round(0.45) = 0
    const r = scoreConfidence(node({ progress: 7 }), [], []);
    expect(r.score).toBe(1);
    expect(points(r, 'Self-reported progress')).toBe(1);
  });

  it('deduplicates neighbors by id and ignores the node itself', () => {
    const work = { id: 'w', type: 'assignment', status: 'Completed', progress: 100 };
    const self = node({ status: 'Completed', progress: 100 }); // same id as the scored node
    // w appears twice (reciprocal edges produce this shape) + a self-reference:
    const r = scoreConfidence(node(), [], [work, { ...work }, self]);
    expect(points(r, 'Completed connected work')).toBe(10); // counted once, self excluded
    expect(r.score).toBe(10);
  });

  it('counts completed connected work at 10 each, capped at 30', () => {
    const done = (type, i) => ({ id: `w${i}`, type, status: 'Completed', progress: 100 });
    const two = scoreConfidence(node(), [], [done('assignment', 1), done('lab', 2)]);
    expect(points(two, 'Completed connected work')).toBe(20);
    const five = scoreConfidence(node(), [], ['assignment', 'exam', 'quiz', 'task', 'topic'].map(done));
    expect(points(five, 'Completed connected work')).toBe(30);
  });

  it('recognizes every WORK type individually (below the cap)', () => {
    for (const type of ['assignment', 'exam', 'quiz', 'lab', 'task', 'topic', 'section']) {
      const r = scoreConfidence(node(), [], [{ id: 'w', type, status: 'Completed', progress: 100 }]);
      expect(r.score, `type ${type} should count as work`).toBe(10);
    }
  });

  it('ignores incomplete work and completed non-work neighbors', () => {
    const neighbors = [
      { id: 'a', type: 'assignment', status: 'In Progress', progress: 90 },
      { id: 'c', type: 'course', status: 'Completed', progress: 100 },   // not a WORK type
      { id: 'n', type: 'note', status: 'Completed', progress: 100 }      // not a WORK type
    ];
    expect(scoreConfidence(node(), [], neighbors).score).toBe(0);
  });

  it('scores connected projects: done 15, in-progress ≥40% 10, otherwise 5, capped at 25', () => {
    const proj = (status, progress, i) => ({ id: `p${i}`, type: 'project', status, progress });
    expect(scoreConfidence(node(), [], [proj('Completed', 100, 1)]).score).toBe(15);
    expect(scoreConfidence(node(), [], [proj('In Progress', 40, 1)]).score).toBe(10);
    expect(scoreConfidence(node(), [], [proj('In Progress', 39, 1)]).score).toBe(5);
    expect(scoreConfidence(node(), [], [proj('Not Started', 0, 1)]).score).toBe(5);
    const capped = scoreConfidence(node(), [], [proj('Completed', 100, 1), proj('Completed', 100, 2)]);
    expect(points(capped, 'Applied in projects')).toBe(25);
  });
});

describe('scoreConfidence — composition', () => {
  it('sums independent signals', () => {
    const r = scoreConfidence(
      node({ notes: 'x'.repeat(40), progress: 50 }),
      [link('repo')],
      [{ id: 'w', type: 'assignment', status: 'Completed', progress: 100 }]
    );
    // 15 (repo) + 6 (notes) + 8 (progress) + 10 (work) = 39
    expect(r.score).toBe(39);
    expect(r.tier).toBe('Some exposure');
    expect(r.signals).toHaveLength(4);
  });

  it('caps the total at 100 even when raw signals exceed it (max 117)', () => {
    const neighbors = [
      ...['a1', 'a2', 'a3', 'a4'].map(id => ({ id, type: 'assignment', status: 'Completed', progress: 100 })),
      ...['p1', 'p2'].map(id => ({ id, type: 'project', status: 'Completed', progress: 100 }))
    ];
    const r = scoreConfidence(
      node({ notes: 'x'.repeat(300), status: 'Completed', progress: 100 }),
      [link('repo'), link('repo'), link('repo')],
      neighbors
    );
    expect(r.score).toBe(100);
    expect(r.tier).toBe('Demonstrated');
  });
});

describe('bulkConfidence', () => {
  beforeEach(() => {
    db.exec('DELETE FROM edges; DELETE FROM links; DELETE FROM nodes;');
  });

  const insertNode = (n) => db.prepare(`
    INSERT INTO nodes (id, title, type, status, progress, notes)
    VALUES (@id, @title, @type, @status, @progress, @notes)
  `).run({ title: n.id, status: 'Not Started', progress: 0, notes: '', ...n });

  it('only scores skill and topic nodes', () => {
    expect(CONFIDENCE_TYPES).toEqual(['skill', 'topic']);
    const nodes = [
      { id: 's', type: 'skill', status: 'Not Started', progress: 0, notes: '' },
      { id: 't', type: 'topic', status: 'Not Started', progress: 0, notes: '' },
      { id: 'c', type: 'course', status: 'Not Started', progress: 0, notes: '' }
    ];
    const out = bulkConfidence(nodes, []);
    expect([...out.keys()].sort()).toEqual(['s', 't']);
  });

  it('attributes links to their own node only', () => {
    const s1 = { id: 's1', type: 'skill', status: 'Not Started', progress: 0, notes: '' };
    const s2 = { id: 's2', type: 'skill', status: 'Not Started', progress: 0, notes: '' };
    const course = { id: 'c', type: 'course', status: 'Not Started', progress: 0, notes: '' };
    for (const n of [s1, s2, course]) insertNode(n);
    db.prepare(`INSERT INTO links (id, node_id, kind, target) VALUES ('l1', 's1', 'repo', 'r')`).run();  // 15
    db.prepare(`INSERT INTO links (id, node_id, kind, target) VALUES ('l2', 's2', 'url', 'u')`).run();   // 4
    db.prepare(`INSERT INTO links (id, node_id, kind, target) VALUES ('l3', 'c', 'folder', 'f')`).run(); // not scored

    const out = bulkConfidence([s1, s2, course], []);
    expect(out.get('s1').score).toBe(15);
    expect(out.get('s2').score).toBe(4);
  });

  it('does not double-count a neighbor connected by reciprocal edges', () => {
    const skill = { id: 's', type: 'skill', status: 'Not Started', progress: 0, notes: '' };
    const work = { id: 'w', type: 'assignment', status: 'Completed', progress: 100, notes: '' };
    for (const n of [skill, work]) insertNode(n);
    const edges = [
      { source: 's', target: 'w', kind: 'related' },
      { source: 'w', target: 's', kind: 'prereq' } // second edge, same pair
    ];
    expect(bulkConfidence([skill, work], edges).get('s').score).toBe(10);
  });

  it('tolerates edges pointing at nodes absent from the input set', () => {
    const skill = { id: 's', type: 'skill', status: 'Not Started', progress: 0, notes: '' };
    insertNode(skill);
    const edges = [{ source: 's', target: 'ghost', kind: 'related' }];
    expect(() => bulkConfidence([skill], edges)).not.toThrow();
    expect(bulkConfidence([skill], edges).get('s').score).toBe(0);
  });

  it('treats edges in BOTH directions as neighbors and reads links from the DB', () => {
    const skill = { id: 's', type: 'skill', status: 'Not Started', progress: 0, notes: '' };
    const workIn = { id: 'win', type: 'assignment', status: 'Completed', progress: 100, notes: '' };
    const workOut = { id: 'wout', type: 'lab', status: 'Submitted', progress: 100, notes: '' };
    for (const n of [skill, workIn, workOut]) insertNode(n);
    db.prepare(`INSERT INTO links (id, node_id, kind, target) VALUES ('l1', 's', 'repo', 'https://example.com')`).run();

    const edges = [
      { source: 'win', target: 's', kind: 'related' },  // incoming
      { source: 's', target: 'wout', kind: 'related' }  // outgoing
    ];
    const out = bulkConfidence([skill, workIn, workOut], edges);
    // repo 15 + two completed work neighbors 20 = 35
    expect(out.get('s').score).toBe(35);
    expect(out.get('s').tier).toBe('Some exposure');
  });

  it('matches scoreConfidence for identical inputs', () => {
    const skill = { id: 's', type: 'skill', status: 'In Progress', progress: 60, notes: 'x'.repeat(60) };
    const proj = { id: 'p', type: 'project', status: 'In Progress', progress: 50, notes: '' };
    for (const n of [skill, proj]) insertNode(n);
    db.prepare(`INSERT INTO links (id, node_id, kind, target) VALUES ('l1', 's', 'file', 'notes.pdf')`).run();

    const viaBulk = bulkConfidence([skill, proj], [{ source: 's', target: 'p', kind: 'related' }]).get('s');
    const direct = scoreConfidence(skill, [{ node_id: 's', kind: 'file' }], [proj]);
    expect(viaBulk.score).toBe(direct.score);
    expect(viaBulk.signals).toEqual(direct.signals);
  });
});
