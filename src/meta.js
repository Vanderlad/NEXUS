// Shared visual metadata for node types and statuses.

export const TYPE_META = {
  hub:        { icon: '◉',  color: '#e2e8f0', label: 'Core' },
  domain:     { icon: '⬢',  color: '#c084fc', label: 'Domain' },
  course:     { icon: '🎓', color: '#38bdf8', label: 'Course' },
  assignment: { icon: '📄', color: '#fbbf24', label: 'Assignment' },
  exam:       { icon: '🧠', color: '#f97316', label: 'Exam' },
  quiz:       { icon: '❓', color: '#eab308', label: 'Quiz' },
  lab:        { icon: '🧪', color: '#2dd4bf', label: 'Lab' },
  project:    { icon: '🚀', color: '#a78bfa', label: 'Project' },
  task:       { icon: '☑️', color: '#f472b6', label: 'Task' },
  skill:      { icon: '⚡', color: '#34d399', label: 'Skill' },
  topic:      { icon: '📚', color: '#a3e635', label: 'Topic' },
  goal:       { icon: '🎯', color: '#fb7185', label: 'Goal' },
  note:       { icon: '🗒️', color: '#cbd5e1', label: 'Note' },
  file:       { icon: '📁', color: '#94a3b8', label: 'File' },
  roadmap:    { icon: '🗺️', color: '#818cf8', label: 'Roadmap' },
  section:    { icon: '🧭', color: '#6366f1', label: 'Section' }
};

export const typeMeta = (type) => TYPE_META[type] ?? TYPE_META.topic;

export const STATUS_META = {
  'Not Started': { color: '#64748b' },
  'In Progress': { color: '#38bdf8' },
  'Submitted':   { color: '#2dd4bf' },
  'Completed':   { color: '#4ade80' },
  'Overdue':     { color: '#f87171' }
};

export const STATUSES = ['Not Started', 'In Progress', 'Submitted', 'Completed'];

export const statusColor = (s) => (STATUS_META[s] ?? STATUS_META['Not Started']).color;

// Types the "new node" modal offers.
export const CREATABLE_TYPES = [
  'course', 'assignment', 'exam', 'quiz', 'lab', 'task', 'project',
  'skill', 'topic', 'goal', 'note', 'file'
];

export const DUE_DATE_TYPES = ['assignment', 'exam', 'quiz', 'lab', 'task', 'project', 'goal'];

// Sequential ramp for confidence (validated ≥3.4:1 vs panel surface, monotonic lightness).
export const CONFIDENCE_RAMP = ['#0e7490', '#06b6d4', '#22d3ee', '#67e8f9'];

export function confidenceColor(score) {
  if (score <= 25) return CONFIDENCE_RAMP[0];
  if (score <= 50) return CONFIDENCE_RAMP[1];
  if (score <= 75) return CONFIDENCE_RAMP[2];
  return CONFIDENCE_RAMP[3];
}

// Container types whose progress is derived from children.
export const CONTAINER_TYPES = ['course', 'project', 'roadmap', 'section', 'domain', 'goal', 'hub'];

export const LINK_KINDS = [
  { value: 'file', label: '📄 File' },
  { value: 'folder', label: '📁 Folder' },
  { value: 'repo', label: '⎇ Repo' },
  { value: 'url', label: '🔗 URL' }
];

export function fmtDate(d) {
  if (!d) return '';
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function daysUntil(d) {
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(d + 'T00:00:00') - today) / 86400000);
}

export function dueLabel(d) {
  const n = daysUntil(d);
  if (n === null) return '';
  if (n < -1) return `${-n}d late`;
  if (n === -1) return '1d late';
  if (n === 0) return 'today';
  if (n === 1) return 'tmrw';
  if (n <= 14) return `${n}d`;
  return fmtDate(d);
}
