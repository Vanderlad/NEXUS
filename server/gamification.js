import { db, getMeta, setMeta } from './db.js';

// XP awarded when a node of this type is completed and no explicit xp is set.
export const DEFAULT_XP = {
  assignment: 50,
  exam: 80,
  quiz: 30,
  lab: 40,
  project: 150,
  course: 200,
  skill: 60,
  topic: 40,
  task: 30,
  goal: 100,
  roadmap: 250,
  section: 60,
  file: 10,
  note: 10
};

export const DONE_STATUSES = ['Completed', 'Submitted'];

export function xpForNode(node) {
  if (node.xp && node.xp > 0) return node.xp;
  return DEFAULT_XP[node.type] ?? 25;
}

// Cumulative XP needed to *reach* a level. Level 1 = 0, level 2 = 100,
// each next level costs 50 more than the previous one.
export function levelThreshold(level) {
  let total = 0;
  for (let l = 2; l <= level; l++) total += 100 + (l - 2) * 50;
  return total;
}

export function levelFromXp(xp) {
  let level = 1;
  while (levelThreshold(level + 1) <= xp) level++;
  const current = levelThreshold(level);
  const next = levelThreshold(level + 1);
  return {
    level,
    xpIntoLevel: xp - current,
    xpForNext: next - current,
    nextLevelAt: next
  };
}

export function totalXp() {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM xp_events').get();
  return row.total;
}

// Local calendar date — streaks must roll over at the user's midnight, not UTC's,
// or an evening completion lands on "tomorrow" and breaks consecutive-day counting.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

export function currentStreak() {
  const count = parseInt(getMeta('streak_count', '0'), 10);
  const last = getMeta('streak_last', null);
  if (!last) return 0;
  const gap = daysBetween(last, todayStr());
  return gap <= 1 ? count : 0;
}

function bumpStreak() {
  const today = todayStr();
  const last = getMeta('streak_last', null);
  let count = parseInt(getMeta('streak_count', '0'), 10);
  if (last === today) {
    // already counted today
  } else if (last && daysBetween(last, today) === 1) {
    count += 1;
  } else {
    count = 1;
  }
  setMeta('streak_count', count);
  setMeta('streak_last', today);
  return count;
}

export const BADGES = [
  { key: 'first-steps', name: 'First Steps', icon: '✦', description: 'Complete your first task.' },
  { key: 'on-a-roll', name: 'On a Roll', icon: '⚡', description: 'Complete 5 tasks.' },
  { key: 'centurion', name: 'Centurion', icon: '⚔', description: 'Complete 25 tasks.' },
  { key: 'pathfinder', name: 'Pathfinder', icon: '🗺', description: 'Import a learning roadmap.' },
  { key: 'archivist', name: 'Archivist', icon: '📁', description: 'Link 5 files, folders or repos to nodes.' },
  { key: 'scribe', name: 'Scribe', icon: '✎', description: 'Write notes on 5 different nodes.' },
  { key: 'week-streak', name: 'Momentum', icon: '🔥', description: 'Keep a 7-day completion streak.' },
  { key: 'level-5', name: 'Ascendant', icon: '◆', description: 'Reach level 5.' },
  { key: 'level-10', name: 'Archmage', icon: '❖', description: 'Reach level 10.' }
];

function completionCount() {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM nodes WHERE status IN ('Completed', 'Submitted')`
  ).get();
  return row.n;
}

export function checkBadges() {
  const earned = new Set(db.prepare('SELECT key FROM badges').all().map(r => r.key));
  const newly = [];
  const award = (key) => {
    if (earned.has(key)) return;
    db.prepare('INSERT INTO badges (key) VALUES (?)').run(key);
    earned.add(key);
    newly.push(BADGES.find(b => b.key === key));
  };

  const done = completionCount();
  if (done >= 1) award('first-steps');
  if (done >= 5) award('on-a-roll');
  if (done >= 25) award('centurion');

  const roadmaps = db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE type = 'roadmap'`).get().n;
  if (roadmaps >= 1) award('pathfinder');

  const links = db.prepare(`SELECT COUNT(*) AS n FROM links WHERE kind IN ('file', 'folder', 'repo')`).get().n;
  if (links >= 5) award('archivist');

  const noted = db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE length(trim(notes)) > 0`).get().n;
  if (noted >= 5) award('scribe');

  if (currentStreak() >= 7) award('week-streak');

  const { level } = levelFromXp(totalXp());
  if (level >= 5) award('level-5');
  if (level >= 10) award('level-10');

  return newly;
}

// Called when a node transitions into a done status. Returns a summary the
// client can toast about.
export function onNodeCompleted(node) {
  const before = levelFromXp(totalXp());
  const amount = xpForNode(node);
  db.prepare('INSERT INTO xp_events (node_id, amount, reason) VALUES (?, ?, ?)')
    .run(node.id, amount, `Completed: ${node.title}`);
  const streak = bumpStreak();
  const newBadges = checkBadges();
  const xp = totalXp();
  const after = levelFromXp(xp);
  return {
    xpAwarded: amount,
    totalXp: xp,
    level: after.level,
    levelUp: after.level > before.level,
    streak,
    newBadges
  };
}

export function gamificationState() {
  const xp = totalXp();
  const lvl = levelFromXp(xp);
  const earnedRows = db.prepare('SELECT key, earned_at FROM badges').all();
  const earnedMap = new Map(earnedRows.map(r => [r.key, r.earned_at]));
  return {
    totalXp: xp,
    level: lvl.level,
    xpIntoLevel: lvl.xpIntoLevel,
    xpForNext: lvl.xpForNext,
    streak: currentStreak(),
    completions: completionCount(),
    badges: BADGES.map(b => ({ ...b, earned: earnedMap.has(b.key), earnedAt: earnedMap.get(b.key) ?? null })),
    recentXp: db.prepare('SELECT amount, reason, created_at FROM xp_events ORDER BY id DESC LIMIT 8').all()
  };
}
