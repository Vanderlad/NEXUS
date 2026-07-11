import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, '..');

// Stable per-user data directory, mirroring Electron's app.getPath('userData')
// convention so every run mode (npm start, dev, Electron) shares one DB per
// machine and the data survives moving/re-cloning the repo.
function defaultDataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'NEXUS');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'NEXUS');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'NEXUS');
}

// NEXUS_DB_PATH overrides the database location (Docker sets it; tests use ':memory:').
const usingDefault = !process.env.NEXUS_DB_PATH;
const DB_PATH = process.env.NEXUS_DB_PATH || path.join(defaultDataDir(), 'nexus.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  // One-time migration: earlier versions kept the DB repo-local at data/nexus.db.
  // If we're on the default path and it's empty but a legacy DB exists, move the
  // data over so nobody "loses" their workspace on upgrade. Runs once (target
  // already existing means it's skipped, so newer data is never clobbered).
  const legacy = path.join(ROOT_DIR, 'data', 'nexus.db');
  if (usingDefault && !fs.existsSync(DB_PATH) && fs.existsSync(legacy)) {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(legacy + suffix)) fs.copyFileSync(legacy + suffix, DB_PATH + suffix);
    }
    console.log(`Migrated existing workspace from ${legacy} to ${DB_PATH}`);
  }
}

export const db = new Database(DB_PATH);
export { DB_PATH };
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'topic',
  description  TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  next_actions TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'Not Started',
  progress     INTEGER NOT NULL DEFAULT 0,
  due_date     TEXT,
  category     TEXT NOT NULL DEFAULT '',
  xp           INTEGER NOT NULL DEFAULT 0,
  pos_x        REAL NOT NULL DEFAULT 0,
  pos_y        REAL NOT NULL DEFAULT 0,
  collapsed    INTEGER NOT NULL DEFAULT 0,
  github_repo  TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id     TEXT PRIMARY KEY,
  source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind   TEXT NOT NULL DEFAULT 'related'
);

CREATE TABLE IF NOT EXISTS links (
  id         TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'url',
  label      TEXT NOT NULL DEFAULT '',
  target     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS xp_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    TEXT,
  amount     INTEGER NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS badges (
  key       TEXT PRIMARY KEY,
  earned_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_links_node ON links(node_id);
`);

// Additive migrations for databases created before these columns existed.
function ensureColumn(table, column, ddl) {
  const has = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
ensureColumn('nodes', 'guide', `TEXT NOT NULL DEFAULT ''`);      // JSON: { why, learn[], resources[], prerequisites[], criteria[] }
ensureColumn('nodes', 'instructor', `TEXT NOT NULL DEFAULT ''`); // courses
ensureColumn('nodes', 'semester', `TEXT NOT NULL DEFAULT ''`);   // courses

export function getMeta(key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}
