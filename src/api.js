async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `${method} ${url} failed (${res.status})`);
    err.status = res.status;
    err.data = data; // e.g. sync conflicts: { needsForce, reason, remoteExportedAt }
    throw err;
  }
  return data;
}

export const api = {
  graph: () => request('GET', '/api/graph'),
  dashboard: () => request('GET', '/api/dashboard'),
  gamification: () => request('GET', '/api/gamification'),
  search: (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`),
  node: (id) => request('GET', `/api/nodes/${id}`),
  createNode: (body) => request('POST', '/api/nodes', body),
  patchNode: (id, body) => request('PATCH', `/api/nodes/${id}`, body),
  deleteNode: (id) => request('DELETE', `/api/nodes/${id}`),
  createEdge: (body) => request('POST', '/api/edges', body),
  deleteEdge: (id) => request('DELETE', `/api/edges/${id}`),
  addLink: (nodeId, body) => request('POST', `/api/nodes/${nodeId}/links`, body),
  deleteLink: (id) => request('DELETE', `/api/links/${id}`),
  roadmaps: () => request('GET', '/api/roadmaps'),
  importRoadmap: (slug) => request('POST', `/api/roadmaps/${slug}/import`),
  importCustomRoadmap: (data) => request('POST', '/api/roadmaps/import', data),
  stats: () => request('GET', '/api/stats'),
  settings: () => request('GET', '/api/settings'),
  saveSettings: (body) => request('PUT', '/api/settings', body),
  syncStatus: () => request('GET', '/api/sync/status'),
  syncConnect: (token) => request('POST', '/api/sync/connect', { token }),
  syncDisconnect: () => request('POST', '/api/sync/disconnect'),
  syncRepo: (repo) => request('POST', '/api/sync/repo', { repo }),
  syncPush: (force = false) => request('POST', '/api/sync/push', { force }),
  syncPull: (force = false) => request('POST', '/api/sync/pull', { force }),
  deviceStart: () => request('POST', '/api/sync/device/start'),
  devicePoll: () => request('POST', '/api/sync/device/poll'),
  importBackup: (snapshot) => request('POST', '/api/import', snapshot),
  workspace: () => request('GET', '/api/workspace'),
  loadDemo: () => request('POST', '/api/workspace/demo'),
  resetWorkspace: () => request('POST', '/api/workspace/reset')
};
