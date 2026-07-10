import { db, getMeta, setMeta } from './db.js';

// ---------------------------------------------------------------------------
// GitHub sync: the whole workspace travels as one JSON snapshot pushed to a
// private repo the user owns (file: nexus-backup.json). Auth is a PAT pasted
// in Settings, or GitHub's Device Flow when NEXUS_GITHUB_CLIENT_ID is set.
// Sync is deliberately last-write-wins with a "remote/local is newer" guard —
// no merging. The snapshot format doubles as local backup/restore.
//
// Secrets never leave the machine: github_*/sync_* meta keys are excluded
// from snapshots, survive workspace resets, and are never pushed.
// ---------------------------------------------------------------------------

export const SYNC_FILE = 'nexus-backup.json';
export const SNAPSHOT_VERSION = 1;
const API = 'https://api.github.com';

const isPrivateMetaKey = (key) => key.startsWith('github_') || key.startsWith('sync_');

// --- snapshot ----------------------------------------------------------------

export function exportSnapshot() {
  return {
    app: 'nexus',
    version: SNAPSHOT_VERSION,
    exported_at: new Date().toISOString(),
    data: {
      nodes: db.prepare('SELECT * FROM nodes').all(),
      edges: db.prepare('SELECT * FROM edges').all(),
      links: db.prepare('SELECT * FROM links').all(),
      xp_events: db.prepare('SELECT * FROM xp_events').all(),
      badges: db.prepare('SELECT * FROM badges').all(),
      meta: db.prepare('SELECT key, value FROM meta').all().filter(r => !isPrivateMetaKey(r.key))
    }
  };
}

export function validateSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return 'not an object';
  if (snap.app !== 'nexus') return 'not a NEXUS snapshot';
  if (snap.version !== SNAPSHOT_VERSION) return `unsupported snapshot version ${snap.version}`;
  const d = snap.data;
  if (!d || typeof d !== 'object') return 'missing data';
  for (const key of ['nodes', 'edges', 'links', 'xp_events', 'badges', 'meta']) {
    if (!Array.isArray(d[key])) return `data.${key} is not an array`;
  }
  for (const n of d.nodes) {
    if (!n.id || !n.title || !n.type) return 'node rows need id, title and type';
  }
  return null;
}

// Replaces the entire workspace with the snapshot. Connection/sync meta keys
// are preserved; everything else (including name/theme/streaks) comes from
// the snapshot so a pull really does move your workspace between machines.
export function importSnapshot(snap) {
  const err = validateSnapshot(snap);
  if (err) throw new Error(`Invalid snapshot: ${err}`);
  const d = snap.data;

  const insertNode = db.prepare(`
    INSERT INTO nodes (id, title, type, description, notes, next_actions, status, progress,
                       due_date, category, xp, pos_x, pos_y, collapsed, github_repo, url,
                       created_at, updated_at, completed_at, guide, instructor, semester)
    VALUES (@id, @title, @type, @description, @notes, @next_actions, @status, @progress,
            @due_date, @category, @xp, @pos_x, @pos_y, @collapsed, @github_repo, @url,
            @created_at, @updated_at, @completed_at, @guide, @instructor, @semester)
  `);
  const nodeDefaults = {
    description: '', notes: '', next_actions: '', status: 'Not Started', progress: 0,
    due_date: null, category: '', xp: 0, pos_x: 0, pos_y: 0, collapsed: 0,
    github_repo: '', url: '', created_at: null, updated_at: null, completed_at: null,
    guide: '', instructor: '', semester: ''
  };

  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM edges; DELETE FROM links; DELETE FROM xp_events;
      DELETE FROM badges; DELETE FROM nodes;
    `);
    db.prepare(`DELETE FROM meta WHERE key NOT LIKE 'github\\_%' ESCAPE '\\' AND key NOT LIKE 'sync\\_%' ESCAPE '\\'`).run();

    const now = new Date().toISOString();
    for (const n of d.nodes) {
      insertNode.run({ ...nodeDefaults, created_at: now, updated_at: now, ...n });
    }
    const nodeIds = new Set(d.nodes.map(n => n.id));
    const insertEdge = db.prepare('INSERT INTO edges (id, source, target, kind) VALUES (@id, @source, @target, @kind)');
    for (const e of d.edges) {
      if (nodeIds.has(e.source) && nodeIds.has(e.target)) insertEdge.run({ kind: 'related', ...e });
    }
    const insertLink = db.prepare('INSERT INTO links (id, node_id, kind, label, target, created_at) VALUES (@id, @node_id, @kind, @label, @target, @created_at)');
    for (const l of d.links) {
      if (nodeIds.has(l.node_id)) insertLink.run({ kind: 'url', label: '', created_at: now, ...l });
    }
    const insertXp = db.prepare('INSERT INTO xp_events (id, node_id, amount, reason, created_at) VALUES (@id, @node_id, @amount, @reason, @created_at)');
    for (const x of d.xp_events) insertXp.run({ node_id: null, reason: '', created_at: now, ...x });
    const insertBadge = db.prepare('INSERT INTO badges (key, earned_at) VALUES (@key, @earned_at)');
    for (const b of d.badges) insertBadge.run({ earned_at: now, ...b });
    const upsertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const m of d.meta) {
      if (!isPrivateMetaKey(m.key)) upsertMeta.run(m.key, m.value);
    }
  });
  tx();
  return d.nodes.length;
}

// Anything changed since we last pushed/pulled? Best effort: edges carry no
// timestamp, so edge-only changes are invisible to this check (documented).
export function isDirtySince(sqliteTime) {
  if (!sqliteTime) return true;
  const q = (sql) => db.prepare(sql).get(sqliteTime);
  return !!(
    q('SELECT 1 AS x FROM nodes WHERE updated_at > ? LIMIT 1') ||
    q('SELECT 1 AS x FROM links WHERE created_at > ? LIMIT 1') ||
    q('SELECT 1 AS x FROM xp_events WHERE created_at > ? LIMIT 1') ||
    q('SELECT 1 AS x FROM badges WHERE earned_at > ? LIMIT 1')
  );
}

// --- github client -------------------------------------------------------------

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(token, method, path, body, accept = 'application/vnd.github+json') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) return null;
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const payload = isJson ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    throw new GitHubError(res.status, payload?.message ?? `GitHub ${method} ${path} failed (${res.status})`);
  }
  return payload;
}

const token = () => getMeta('github_token');
const repoName = () => getMeta('sync_repo', 'nexus-data');

export async function connectWithToken(pat) {
  const user = await gh(pat, 'GET', '/user');
  if (!user?.login) throw new GitHubError(401, 'Token is valid but returned no user.');
  setMeta('github_token', pat);
  setMeta('github_user', user.login);
  return { user: user.login };
}

export function disconnect() {
  db.prepare(`DELETE FROM meta WHERE key LIKE 'github\\_%' ESCAPE '\\' OR key LIKE 'sync\\_%' ESCAPE '\\'`).run();
}

// Remote file sha via directory listing (works regardless of file size,
// unlike the JSON contents endpoint which caps at 1 MB). The `_=` param
// busts GitHub's HTTP cache — stale shas here caused missed conflicts.
async function remoteFileSha(t, owner, repo) {
  const listing = await gh(t, 'GET', `/repos/${owner}/${repo}/contents/?_=${Date.now()}`);
  if (listing === null) return { repoExists: false, sha: null };
  const entry = Array.isArray(listing) ? listing.find(f => f.name === SYNC_FILE) : null;
  return { repoExists: true, sha: entry?.sha ?? null };
}

async function readRemoteSnapshot(t, owner, repo) {
  const raw = await gh(t, 'GET', `/repos/${owner}/${repo}/contents/${SYNC_FILE}?_=${Date.now()}`, null, 'application/vnd.github.raw+json');
  if (raw === null) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new GitHubError(422, 'Remote backup file is not valid JSON.');
  }
}

export async function syncStatus() {
  const t = token();
  const status = {
    connected: !!t,
    user: getMeta('github_user'),
    repo: repoName(),
    file: SYNC_FILE,
    deviceFlow: !!process.env.NEXUS_GITHUB_CLIENT_ID,
    lastPushedAt: getMeta('sync_pushed_at'),
    lastPulledAt: getMeta('sync_pulled_at'),
    dirty: isDirtySince(getMeta('sync_last_at')),
    remote: null
  };
  if (!t) return status;
  try {
    const { repoExists, sha } = await remoteFileSha(t, status.user, status.repo);
    status.remote = { repoExists, hasBackup: !!sha, sha, inSync: !!sha && sha === getMeta('sync_remote_sha') };
  } catch (err) {
    status.remote = { error: err.message };
  }
  return status;
}

export async function pushSnapshot({ force = false } = {}) {
  const t = token();
  if (!t) throw new GitHubError(401, 'Not connected to GitHub.');
  const owner = getMeta('github_user');
  const repo = repoName();

  const { repoExists, sha } = await remoteFileSha(t, owner, repo);
  if (!repoExists) {
    await gh(t, 'POST', '/user/repos', {
      name: repo, private: true, description: 'NEXUS workspace backup (synced by the NEXUS app)'
    });
  }
  const conflict = async () => {
    const remote = await readRemoteSnapshot(t, owner, repo).catch(() => null);
    return new GitHubError(409, JSON.stringify({
      needsForce: true,
      reason: 'remote-changed',
      remoteExportedAt: remote?.exported_at ?? null
    }));
  };
  // Someone (another machine) pushed since we last synced → require force.
  if (!force && sha && sha !== getMeta('sync_remote_sha')) throw await conflict();

  const snapshot = exportSnapshot();
  const put = (fileSha) => gh(t, 'PUT', `/repos/${owner}/${repo}/contents/${SYNC_FILE}`, {
    message: `NEXUS sync — ${snapshot.exported_at} (${snapshot.data.nodes.length} nodes)`,
    content: Buffer.from(JSON.stringify(snapshot, null, 1)).toString('base64'),
    ...(fileSha ? { sha: fileSha } : {})
  });

  let result;
  try {
    result = await put(sha);
  } catch (err) {
    // GitHub 409 "does not match": our sha was stale — a real concurrent change
    // the (cacheable) pre-check missed. Same conflict, later signal.
    const mismatch = err.status === 409 || (err.status === 422 && /sha/i.test(err.message));
    if (!mismatch) throw err;
    if (!force) throw await conflict();
    const fresh = await remoteFileSha(t, owner, repo);
    result = await put(fresh.sha);
  }

  setMeta('sync_remote_sha', result.content.sha);
  setMeta('sync_pushed_at', snapshot.exported_at);
  setMeta('sync_last_at', db.prepare(`SELECT datetime('now') AS t`).get().t);
  return { pushedAt: snapshot.exported_at, nodes: snapshot.data.nodes.length, repo: `${owner}/${repo}` };
}

export async function pullSnapshot({ force = false } = {}) {
  const t = token();
  if (!t) throw new GitHubError(401, 'Not connected to GitHub.');
  const owner = getMeta('github_user');
  const repo = repoName();

  const remote = await readRemoteSnapshot(t, owner, repo);
  if (!remote) throw new GitHubError(404, `No ${SYNC_FILE} found in ${owner}/${repo} — push from the machine that has your data first.`);

  // Local changes since last sync would be overwritten → require force.
  if (!force && isDirtySince(getMeta('sync_last_at'))) {
    throw new GitHubError(409, JSON.stringify({
      needsForce: true,
      reason: 'local-changes',
      remoteExportedAt: remote.exported_at ?? null
    }));
  }

  const nodes = importSnapshot(remote);
  const { sha } = await remoteFileSha(t, owner, repo);
  setMeta('sync_remote_sha', sha ?? '');
  setMeta('sync_pulled_at', new Date().toISOString());
  setMeta('sync_last_at', db.prepare(`SELECT datetime('now') AS t`).get().t);
  return { pulledAt: new Date().toISOString(), nodes, exportedAt: remote.exported_at ?? null };
}

// --- device flow (needs a registered OAuth app; PAT works without) ---------------

let pendingDevice = null; // { device_code, interval, expires_at }

export async function startDeviceFlow() {
  const clientId = process.env.NEXUS_GITHUB_CLIENT_ID;
  if (!clientId) throw new GitHubError(501, 'Device flow not configured (set NEXUS_GITHUB_CLIENT_ID).');
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' })
  });
  const d = await res.json();
  if (!d.device_code) throw new GitHubError(502, d.error_description ?? 'Could not start device flow.');
  pendingDevice = {
    device_code: d.device_code,
    interval: (d.interval ?? 5) * 1000,
    expires_at: Date.now() + (d.expires_in ?? 900) * 1000
  };
  return { userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in };
}

export async function pollDeviceFlow() {
  const clientId = process.env.NEXUS_GITHUB_CLIENT_ID;
  if (!clientId || !pendingDevice) throw new GitHubError(400, 'No device authorization in progress.');
  if (Date.now() > pendingDevice.expires_at) {
    pendingDevice = null;
    throw new GitHubError(410, 'Device code expired — start over.');
  }
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      device_code: pendingDevice.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });
  const d = await res.json();
  if (d.error === 'authorization_pending' || d.error === 'slow_down') return { pending: true };
  pendingDevice = null;
  if (!d.access_token) throw new GitHubError(401, d.error_description ?? 'Authorization failed.');
  return { pending: false, ...(await connectWithToken(d.access_token)) };
}

export { GitHubError };
