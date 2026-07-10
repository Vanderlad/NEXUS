import crypto from 'node:crypto';
import { db, setMeta } from './db.js';
import { checkBadges } from './gamification.js';
import { readRoadmap, importRoadmap } from './roadmaps.js';

// ---------------------------------------------------------------------------
// Optional demo workspace. NEXUS starts EMPTY by design — this file is only
// used when the user explicitly loads the demo (POST /api/workspace/demo or
// `npm run demo`). All content here is generic sample data; nothing personal.
// Remove it any time with "Reset workspace" in the app or `npm run demo:reset`.
// ---------------------------------------------------------------------------

// Demo dates are relative to "now" so the dashboard always looks alive.
function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const N = (id, title, type, extra = {}) => ({
  id, title, type,
  description: '', notes: '', next_actions: '', status: 'Not Started',
  progress: 0, due_date: null, category: '', xp: 0,
  pos_x: 0, pos_y: 0, github_repo: '', url: '',
  guide: '', instructor: '', semester: '',
  ...extra
});

export function workspaceCounts() {
  const nodes = db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
  return {
    nodes,
    // If every node was deleted by hand the flag is moot — don't report demo.
    demo: nodes > 0 && db.prepare(`SELECT value FROM meta WHERE key = 'demo_loaded'`).get()?.value === '1'
  };
}

export function wipeWorkspace() {
  // Wipe all data but keep personal settings (operator name, theme) — resetting
  // your map shouldn't log you out of your own preferences.
  db.exec(`
    DELETE FROM edges; DELETE FROM links; DELETE FROM xp_events;
    DELETE FROM badges; DELETE FROM nodes;
    DELETE FROM meta WHERE key NOT IN ('user_name', 'theme');
  `);
}

export function loadDemo() {
  if (workspaceCounts().nodes > 0) {
    throw new Error('Workspace is not empty — reset it before loading the demo.');
  }

  const insertNode = db.prepare(`
    INSERT INTO nodes (id, title, type, description, notes, next_actions, status, progress,
                       due_date, category, xp, pos_x, pos_y, github_repo, url,
                       guide, instructor, semester, completed_at)
    VALUES (@id, @title, @type, @description, @notes, @next_actions, @status, @progress,
            @due_date, @category, @xp, @pos_x, @pos_y, @github_repo, @url,
            @guide, @instructor, @semester, @completed_at)
  `);
  const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind) VALUES (?, ?, ?, ?)');
  const insertLink = db.prepare('INSERT INTO links (id, node_id, kind, label, target) VALUES (?, ?, ?, ?, ?)');
  const insertXp = db.prepare('INSERT INTO xp_events (node_id, amount, reason) VALUES (?, ?, ?)');
  const eid = () => crypto.randomUUID();
  const edge = (s, t, k = 'contains') => insertEdge.run(eid(), s, t, k);
  const link = (nodeId, kind, label, target) => insertLink.run(eid(), nodeId, kind, label, target);

  const nodes = [
    // ---- core map -----------------------------------------------------------
    N('hub', 'Command Center', 'hub', {
      description: 'The center of your map. Everything — school, skills, projects, goals — radiates from here.',
      pos_x: 0, pos_y: 0
    }),
    N('domain-school', 'School', 'domain', { description: 'Courses, assignments, exams, labs.', pos_x: -700, pos_y: -120 }),
    N('domain-skills', 'Skill Forge', 'domain', { description: 'Programming languages, tools and CS fundamentals.', pos_x: 660, pos_y: -120 }),
    N('domain-projects', 'Projects', 'domain', { description: 'Things you are building.', pos_x: 0, pos_y: 470 }),
    N('domain-goals', 'Goals', 'domain', { description: 'Career and personal targets.', pos_x: 0, pos_y: -540 }),

    // ---- sample courses --------------------------------------------------------
    N('course-cs101', 'CS 101 · Intro to Programming', 'course', {
      description: 'Sample course: variables, control flow, functions, basic data structures.',
      category: 'school', instructor: 'Prof. Example', semester: 'Demo Term',
      pos_x: -1150, pos_y: -420,
      notes: '## Course info\n- This is demo data — replace with your real courses\n- Weekly quiz every Friday\n- Final worth 40%'
    }),
    N('course-math150', 'MATH 150 · Discrete Mathematics', 'course', {
      description: 'Logic, sets, proofs, combinatorics, graph theory.',
      category: 'school', semester: 'Demo Term', pos_x: -1220, pos_y: -60
    }),
    N('course-cs201', 'CS 201 · Computer Systems', 'course', {
      description: 'How computers actually work: memory, assembly basics, C programming.',
      category: 'school', semester: 'Demo Term', pos_x: -1100, pos_y: 280
    }),

    // ---- sample coursework -------------------------------------------------------
    N('a-cs101-a1', 'A1 · Functions & Loops', 'assignment', {
      status: 'Completed', progress: 100, due_date: day(-12), category: 'school',
      pos_x: -1600, pos_y: -560, completed_at: new Date(Date.now() - 13 * 86400000).toISOString()
    }),
    N('a-cs101-a2', 'A2 · Lists & Dictionaries', 'assignment', {
      status: 'In Progress', progress: 60, due_date: day(1), category: 'school',
      description: 'Build a small contact-book program using lists and dictionaries.',
      next_actions: '- [ ] Finish search feature\n- [ ] Write edge-case tests\n- [ ] Submit',
      pos_x: -1620, pos_y: -430
    }),
    N('a-cs101-quiz3', 'Quiz 3 · String Methods', 'quiz', {
      due_date: day(3), category: 'school', pos_x: -1600, pos_y: -300
    }),
    N('a-cs101-mid', 'Midterm Exam', 'exam', {
      due_date: day(16), category: 'school',
      description: 'Covers weeks 1–6: variables, control flow, functions, lists.',
      pos_x: -1560, pos_y: -170
    }),
    N('a-math-ps4', 'Problem Set 4 · Induction', 'assignment', {
      status: 'In Progress', progress: 25, due_date: day(4), category: 'school',
      pos_x: -1660, pos_y: -40
    }),
    N('a-math-quiz2', 'Quiz 2 · Set Theory', 'quiz', {
      due_date: day(9), category: 'school', pos_x: -1620, pos_y: 80
    }),
    N('a-cs201-lab2', 'Lab 2 · Pointers in C', 'lab', {
      status: 'In Progress', progress: 40, due_date: day(-3), category: 'school',
      description: 'Pointer arithmetic exercises. Was due already — finish and submit ASAP.',
      pos_x: -1560, pos_y: 210
    }),
    N('a-cs201-a1', 'A1 · Binary & Hex Worksheet', 'assignment', {
      due_date: day(6), category: 'school', pos_x: -1600, pos_y: 340
    }),
    N('a-cs201-proj', 'Course Project · Memory Allocator', 'project', {
      due_date: day(24), category: 'school',
      description: 'Implement a simple malloc/free in C.',
      pos_x: -1520, pos_y: 470
    }),

    // ---- sample skills -------------------------------------------------------------
    N('skill-python', 'Python', 'skill', { progress: 75, category: 'skills', pos_x: 980, pos_y: -420 }),
    N('skill-java', 'Java', 'skill', { progress: 60, category: 'skills', pos_x: 1240, pos_y: -420 }),
    N('skill-c', 'C', 'skill', { progress: 40, category: 'skills', pos_x: 980, pos_y: -270 }),
    N('skill-git', 'Git & GitHub', 'skill', { progress: 70, category: 'skills', pos_x: 1240, pos_y: -270 }),
    N('skill-linux', 'Linux', 'skill', { progress: 55, category: 'skills', pos_x: 980, pos_y: -120 }),
    N('skill-sql', 'SQL', 'skill', { progress: 45, category: 'skills', pos_x: 1240, pos_y: -120 }),
    N('skill-react', 'React', 'skill', { progress: 30, category: 'skills', pos_x: 980, pos_y: 30 }),
    N('skill-docker', 'Docker', 'skill', { progress: 20, category: 'skills', pos_x: 1240, pos_y: 30 }),
    N('topic-bigo', 'Big-O Analysis', 'topic', {
      status: 'Completed', progress: 100, category: 'skills', pos_x: 900, pos_y: 180,
      completed_at: new Date(Date.now() - 20 * 86400000).toISOString()
    }),
    N('topic-recursion', 'Recursion', 'topic', {
      status: 'Completed', progress: 100, category: 'skills', pos_x: 1160, pos_y: 180,
      completed_at: new Date(Date.now() - 9 * 86400000).toISOString()
    }),

    // ---- sample projects ------------------------------------------------------------
    N('proj-tracker', 'Task Tracker CLI', 'project', {
      status: 'In Progress', progress: 45, category: 'projects',
      description: 'A command-line to-do app with local JSON storage.',
      github_repo: 'https://github.com/example/task-tracker',
      pos_x: -420, pos_y: 700
    }),
    N('proj-studybot', 'Study Timer Bot', 'project', {
      status: 'In Progress', progress: 20, category: 'projects',
      description: 'Chat bot that tracks study sessions and posts leaderboards.',
      next_actions: '- [ ] Set up commands\n- [ ] Add SQLite session log',
      pos_x: 0, pos_y: 780
    }),
    N('proj-portfolio', 'Portfolio Website', 'project', {
      status: 'Not Started', progress: 0, category: 'projects',
      description: 'Personal site with project showcases and a blog.',
      pos_x: 420, pos_y: 700
    }),

    // ---- sample goals ----------------------------------------------------------------
    N('goal-internship', 'Land a Summer Internship', 'goal', {
      status: 'In Progress', progress: 15, category: 'goals',
      description: 'Target: backend or full-stack internship.',
      next_actions: '- [ ] Polish resume\n- [ ] Finish 2 portfolio projects\n- [ ] Practice 50 coding problems',
      pos_x: -420, pos_y: -760
    }),
    N('goal-dsa', 'Master DSA Fundamentals', 'goal', {
      status: 'In Progress', progress: 35, category: 'goals',
      pos_x: 0, pos_y: -830
    }),
    N('goal-organize', 'Organize All Course Files', 'goal', {
      status: 'In Progress', progress: 50, category: 'goals',
      description: 'One folder per course, everything linked into NEXUS.',
      pos_x: 420, pos_y: -760
    }),

    // ---- sample note -----------------------------------------------------------------
    N('note-dsa-cheatsheet', 'DSA Cheat Sheet', 'note', {
      category: 'skills', pos_x: 1030, pos_y: 330,
      notes: [
        '# DSA quick reference',
        '',
        '| Structure | Access | Search | Insert |',
        '|---|---|---|---|',
        '| Array | O(1) | O(n) | O(n) |',
        '| Hash map | — | O(1)* | O(1)* |',
        '| BST (balanced) | O(log n) | O(log n) | O(log n) |',
        '',
        '```python',
        'def dfs(node, seen=set()):',
        '    if node in seen: return',
        '    seen.add(node)',
        '    for n in node.neighbors: dfs(n, seen)',
        '```'
      ].join('\n')
    })
  ];

  const tx = db.transaction(() => {
    for (const n of nodes) insertNode.run({ completed_at: null, ...n });

    // map structure
    edge('hub', 'domain-school');
    edge('hub', 'domain-skills');
    edge('hub', 'domain-projects');
    edge('hub', 'domain-goals');

    edge('domain-school', 'course-cs101');
    edge('domain-school', 'course-math150');
    edge('domain-school', 'course-cs201');

    edge('course-cs101', 'a-cs101-a1');
    edge('course-cs101', 'a-cs101-a2');
    edge('course-cs101', 'a-cs101-quiz3');
    edge('course-cs101', 'a-cs101-mid');
    edge('course-math150', 'a-math-ps4');
    edge('course-math150', 'a-math-quiz2');
    edge('course-cs201', 'a-cs201-lab2');
    edge('course-cs201', 'a-cs201-a1');
    edge('course-cs201', 'a-cs201-proj');

    for (const s of ['python', 'java', 'c', 'git', 'linux', 'sql', 'react', 'docker']) {
      edge('domain-skills', `skill-${s}`);
    }
    edge('skill-python', 'topic-bigo', 'related');
    edge('skill-python', 'topic-recursion', 'related');
    edge('domain-skills', 'note-dsa-cheatsheet');

    edge('domain-projects', 'proj-tracker');
    edge('domain-projects', 'proj-studybot');
    edge('domain-projects', 'proj-portfolio');

    edge('domain-goals', 'goal-internship');
    edge('domain-goals', 'goal-dsa');
    edge('domain-goals', 'goal-organize');

    // cross-links: the "second brain" part
    edge('course-cs101', 'goal-dsa', 'related');
    edge('goal-internship', 'proj-portfolio', 'related');
    edge('skill-react', 'proj-portfolio', 'related');
    edge('skill-python', 'proj-studybot', 'related');
    edge('course-cs201', 'skill-c', 'related');
    edge('note-dsa-cheatsheet', 'course-cs101', 'related');

    // sample file/folder/repo links (evidence for confidence scoring)
    link('course-cs101', 'folder', 'Course folder', '~/school/cs101');
    link('a-cs101-a2', 'file', 'Assignment spec', '~/school/cs101/a2/spec.pdf');
    link('a-cs101-a2', 'folder', 'Code', '~/school/cs101/a2/src');
    link('skill-python', 'repo', 'Practice repo', 'https://github.com/example/python-practice');
    link('proj-tracker', 'repo', 'GitHub', 'https://github.com/example/task-tracker');
    link('proj-tracker', 'folder', 'Local repo', '~/src/task-tracker');
    link('course-cs201', 'folder', 'Course folder', '~/school/cs201');

    // XP history so the demo starts mid-journey
    insertXp.run('a-cs101-a1', 50, 'Completed: A1 · Functions & Loops');
    insertXp.run('topic-bigo', 40, 'Completed: Big-O Analysis');
    insertXp.run('topic-recursion', 40, 'Completed: Recursion');
    insertXp.run(null, 120, 'Loaded demo workspace');

    setMeta('streak_count', 3);
    setMeta('streak_last', day(-1)); // complete something today to make it 4
    setMeta('demo_loaded', '1');
  });
  tx();

  // Pre-import one roadmap so the skill-tree side is populated.
  const cs = readRoadmap('computer-science');
  if (cs) {
    const rootId = importRoadmap(cs, { x: 1750, y: -500 });
    edge('domain-skills', rootId, 'related');
    // mark a bit of progress on the first topics
    const first = db.prepare(
      `SELECT id FROM nodes WHERE id LIKE ? AND type = 'topic' ORDER BY pos_y LIMIT 2`
    ).all(`${rootId}-%`);
    for (const t of first) {
      db.prepare(`UPDATE nodes SET status = 'Completed', progress = 100, completed_at = datetime('now') WHERE id = ?`)
        .run(t.id);
      insertXp.run(t.id, 40, 'Completed roadmap topic');
    }
  }

  checkBadges();
  return db.prepare('SELECT COUNT(*) AS n FROM nodes').get().n;
}

// CLI: node server/demo.js [--reset]
if (process.argv[1] && process.argv[1].endsWith('demo.js')) {
  if (process.argv.includes('--reset')) {
    wipeWorkspace();
    console.log('Cleared existing data.');
  }
  try {
    const n = loadDemo();
    console.log(`Demo workspace loaded: ${n} nodes.`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
