# AGENTS.md — Project handoff & continuity

This file lets any AI coding agent (Claude, Codex, ChatGPT, …) or human pick up the
project without conversation history. Keep it updated when you change architecture,
schema, or feature status.

## What this app is

**NEXUS** is a local-first, gamified "Developer Life OS" / second brain. It models
school (courses/assignments/exams), software-development learning (skills, roadmap.sh-style
learning paths), projects, goals, notes and file locations as **nodes on an interactive
graph** (React Flow), with XP/levels/streaks/badges and **evidence-based skill confidence**.
Design brief: *futuristic developer command center* (Jarvis/HUD, dark glassmorphism,
neon accents, skill-tree feel) — not a CRUD dashboard.

**Clean-slate policy:** the app starts EMPTY. Demo data lives only in `server/demo.js`,
loads only into an empty DB (in-app button or `npm run demo`), and is fully removed by
"Reset workspace" / `POST /api/workspace/reset`. Never auto-seed. Never hardcode
personal data.

## Tech stack

- **Frontend:** React 18 + Vite, [React Flow 11](https://reactflow.dev) for the graph,
  `marked` + `dompurify` for markdown notes. Plain CSS design system in `src/theme.css`
  (CSS variables, glass panels, HUD corner brackets, per-type accent colors). No router —
  views are component state; deep links via `?view=` and `?node=` query params.
- **Backend:** Express (ESM) + `better-sqlite3`. Single process, serves the built UI in production.
- **Storage:** one SQLite DB per machine (WAL mode, FK cascades), created automatically empty.
  Location is resolved in `server/db.js` by `defaultDataDir()` → the OS user-data folder
  (`~/.config/NEXUS` Linux, `~/Library/Application Support/NEXUS` macOS, `%APPDATA%\NEXUS`
  Windows), mirroring Electron's `app.getPath('userData')` so **web and Electron share one
  DB**. `NEXUS_DB_PATH` overrides it (Docker/tests). On first run with the default path, an
  existing legacy repo-local `data/nexus.db` is auto-migrated (copy, once, never clobbers).
- **Dev:** `npm run dev` runs API (:4000) and Vite (:5173, proxies `/api`). Prod: `npm start` → :4000.
- **Docker:** `docker compose up --build`; sets `NEXUS_DB_PATH=/app/data/nexus.db` on the
  `nexus-data` volume (needed because the default is now the per-user dir, not the repo).
- **Tests:** Vitest (`npm test`), server-side only, in `tests/`. `NEXUS_DB_PATH=:memory:`
  (set in vitest.config.js) gives each worker an isolated in-memory SQLite DB — the same
  env var relocates the DB anywhere (e.g. Docker volumes).
- No TypeScript. Plain JS, ESM, 2-space indent.

## Folder structure

```
server/
  db.js            DB open + schema + additive column migrations (ensureColumn) + meta k/v
  index.js         All API routes + static serving (NO auto-seed)
  gamification.js  XP defaults, level curve, streaks, badge definitions & checks
  confidence.js    Evidence-based skill confidence heuristic (scoreConfidence, bulkConfidence)
  roadmaps.js      Roadmap JSON format docs, list/read/import (JSON → nodes+edges+guides)
  demo.js          OPTIONAL generic demo workspace; loadDemo/wipeWorkspace/workspaceCounts; CLI
  sync.js          GitHub sync + backups: JSON snapshot export/import, GitHub REST client
                   (fetch, no deps), device flow, push/pull with conflict guards
electron/
  main.cjs         Desktop shell (CJS): free port, DB → app.getPath('userData'), boots the
                   SAME server via dynamic import, single-instance lock, native-open IPC
  preload.cjs      contextBridge → window.nexusDesktop { openPath, showItemInFolder, openExternal }
build/icon.png     1024² app icon; electron-builder derives per-platform icons from it
src/
  main.jsx, App.jsx        Shell: bg FX layers, sidebar nav, player card, toasts, palette, modal
  api.js                   fetch wrapper for all endpoints
  meta.js                  TYPE_META (icons/colors), statuses, confidence ramp, date helpers
  theme.css                Entire design system (tokens at top; validated chart colors)
  components/
    GraphView.jsx          React Flow canvas; collapse, connect, drag, focus/jump, locked
                           derivation, empty-state onboarding
    NexusNode.jsx          Custom node card (accent, progress, lock, done chip, confidence ring)
    NodePanel.jsx          Right panel: edit everything, guide renderer, confidence meter, links
    Dashboard.jsx          Mission Control: stats, weekly XP strip, deadlines, courses, goals
    StatsView.jsx          Operator Profile: rings, XP charts, records, confidence dist, badges,
                           workspace demo/reset controls
    SettingsView.jsx       Operator name + theme gallery (previews driven by src/themes.js)
    Tracker.jsx            Coursework table grouped by course, inline status changes
    Roadmaps.jsx           Roadmap cards + custom JSON import
    SearchPalette.jsx      Ctrl/⌘+K search
    NewNodeModal.jsx       Create node (+optional parent 'contains' edge)
roadmaps/*.json    11 curated learning paths (see format below) — all schema-validated,
                   resource links live-checked
docs/              Screenshots for the README
```

The SQLite DB is NOT in the repo — it lives in the OS user-data folder (see Storage above).
`data/nexus.db` only appears if migrating from an older version (it's git-ignored either way).

## Database schema (see server/db.js)

- **nodes**: `id` (text pk), `title`, `type`, `description`, `notes` (markdown),
  `next_actions`, `status` ('Not Started' | 'In Progress' | 'Submitted' | 'Completed'),
  `progress` (0-100), `due_date` (YYYY-MM-DD or null), `category`, `xp` (override, 0 = type
  default), `pos_x/pos_y`, `collapsed` (0/1), `github_repo`, `url`,
  `guide` (JSON string: `{why, learn[], resources[{label,url}], prerequisites[titles], criteria[]}`),
  `instructor`, `semester` (courses), timestamps, `completed_at`.
  - Node types: `hub, domain, course, assignment, exam, quiz, lab, task, project, skill,
    topic, goal, note, file, roadmap, section`.
  - **'Overdue' is derived, never stored** — `effective_status` when `due_date < today`
    and status isn't done.
  - **Container progress is derived** — for `CONTAINER_TYPES`
    (course/project/roadmap/section/domain/goal/hub) with `contains` children, `/api/graph`
    returns the recursive average of children.
  - New columns are added via `ensureColumn()` in db.js — additive migrations only.
- **edges**: `id`, `source`, `target`, `kind` (whitelisted:
  `contains` (hierarchy → collapse + derived progress; server rejects containment cycles),
  `related` (cross-link), `next` (sequence, animated), `prereq` (drives **locked** display:
  a 'Not Started' node with an incomplete prereq source renders locked — soft lock, visual
  only, computed client-side in GraphView.computeLocked)).
- **links**: file/folder/repo/url attachments per node (evidence for confidence).
- **xp_events**: append-only XP log. **badges**: earned keys. **meta**: k/v
  (streak_count, streak_last, demo_loaded).

## Skill confidence (server/confidence.js)

Transparent heuristic for `skill` and `topic` nodes; every signal capped, breakdown shown in UI:

| Signal | Points |
|---|---|
| Links on the node (repo 15 / folder 10 / file 8 / url 4) | cap 30 |
| Notes ≥40 chars +6, ≥250 chars +12 | cap 12 |
| Own status done +20, else progress × 0.15 | cap 20 |
| Completed connected work (assignment/exam/quiz/lab/task/topic/section) ×10 | cap 30 |
| Connected projects (done 15 / ≥40% 10 / else 5) | cap 25 |

Tiers: ≤25 Not enough evidence · ≤50 Some exposure · ≤75 Practiced · ≤100 Demonstrated.
`bulkConfidence(nodes, edges)` powers `/api/graph` + `/api/stats`; `scoreConfidence` powers
node detail. Shown as ring on nodes, meter+breakdown in panel, distribution in Stats.

## Roadmap JSON format (roadmaps/*.json, importer in server/roadmaps.js)

```jsonc
{
  "slug": "networking", "title": "Networking", "source": "roadmap.sh|custom",
  "url": "https://roadmap.sh/…", "description": "…",
  "sections": [{
    "title": "…", "description": "…",
    "topics": [{
      "id": "kebab-id", "title": "…", "description": "what it is",
      "why": "why it matters", "learn": ["step 1", "step 2"],
      "resources": [{"label": "MDN — HTTP", "url": "https://…"}],
      "prerequisites": ["earlier-topic-id"],   // → 'prereq' edges → locked states
      "criteria": ["You can explain…", "You built…"]
    }]
  }]
}
```

Import: root roadmap node → section nodes ('contains', chained 'next') → topic nodes
('contains', guide JSON stored on node, prereq edges). Legacy string resources still accepted.
This is the seam for a future live roadmap.sh sync or LMS import: produce this JSON, POST it.

## API (all JSON, no auth)

All node-returning endpoints return COMPUTED nodes (derived progress + effective_status),
never raw rows. Body values are coerced/clamped server-side (progress 0-100, due_date
YYYY-MM-DD or null, free text stringified) so malformed input yields 4xx, not 500.
**Date policy:** due dates, streaks and chart buckets all use the server's LOCAL calendar
day (local-first ⇒ server tz = user tz); `xp_events.created_at` is stored UTC and bucketed
with `date(…, 'localtime')`.

```
GET  /api/graph                    → { nodes (+progress/effective_status/confidence), edges }
POST /api/nodes                    → create (optional parent_id → contains edge); dup id → 409
PATCH /api/nodes/:id               → partial update; status→done awards XP, returns
                                     { node, gamification: {xpAwarded, levelUp, newBadges, streak} };
                                     un-completing clears completed_at (XP kept);
                                     notes edits re-check badges (Scribe)
DELETE /api/nodes/:id              GET /api/nodes/:id → { node, links, related, guide,
                                                          confidence, xp_value }
POST /api/edges  DELETE /api/edges/:id     (duplicate edges rejected 409)
POST /api/nodes/:id/links  DELETE /api/links/:id
GET  /api/dashboard                → deadlines, courses/projects/goals, domain %s, overall,
                                     week (7-day XP), gamification
GET  /api/stats                    → gamification, counts, overall, confidenceTiers, topSkills,
                                     daily (14d), weekly (8w)
GET  /api/search?q=                GET /api/gamification
GET  /api/roadmaps                 POST /api/roadmaps/:slug/import
POST /api/roadmaps/import          ← custom roadmap JSON body
GET  /api/workspace                → { nodes, demo }
POST /api/workspace/demo           → load demo (409 if not empty)
POST /api/workspace/reset          → wipe ALL data (settings below survive)
GET  /api/settings                 → { name, theme }  (name null = never asked, '' = skipped)
PUT  /api/settings                 ← { name?, theme? } (meta keys user_name/theme; theme
                                     slug-validated; both preserved by workspace reset)
GET  /api/export                   → full workspace snapshot JSON (download)
POST /api/import                   ← snapshot body; replaces ALL workspace data (validated)
GET  /api/sync/status              POST /api/sync/connect {token}   POST /api/sync/disconnect
POST /api/sync/repo {repo}         POST /api/sync/push {force?}     POST /api/sync/pull {force?}
POST /api/sync/device/start        POST /api/sync/device/poll       (needs NEXUS_GITHUB_CLIENT_ID)
```

## GitHub sync (server/sync.js)

- Workspace travels as ONE JSON snapshot (`{app:'nexus', version:1, exported_at, data:{…}}`)
  pushed to `nexus-backup.json` in a private repo the user owns (meta key `sync_repo`,
  default `nexus-data`; repo auto-created private on first push).
- **Secrets never sync:** meta keys matching `github_*`/`sync_*` are excluded from snapshots,
  preserved across imports AND workspace resets. Everything else (incl. name/theme/streaks)
  comes from the snapshot — a pull fully moves the workspace.
- **Conflicts (last-write-wins, guarded):** push 409s if the remote sha ≠ last-synced sha
  (`sync_remote_sha`); pull 409s if `isDirtySince(sync_last_at)` — both return
  `{needsForce, reason, remoteExportedAt}`, client confirms then retries with force.
  Caveats: edges carry no timestamp so edge-only changes don't trip the dirty check;
  GitHub's contents API caches directory listings, so reads are cache-busted (`?_=Date.now()`)
  and a stale-sha PUT 409 is treated as the same conflict (force refetches sha and retries).
- Device flow needs a registered OAuth app (enable Device Flow) + `NEXUS_GITHUB_CLIENT_ID`
  env; PAT paste works with zero setup. Tokens live in the local `meta` table only.

## Desktop app (Electron)

- Purely additive — the web/`npm start` path is untouched. `electron/main.cjs` sets
  `NEXUS_DB_PATH` (→ `app.getPath('userData')/nexus.db`) and `PORT` (a free port), then
  dynamic-imports `server/index.js` (the identical server) and points a BrowserWindow at
  `http://127.0.0.1:<port>`. Single-instance lock prevents two processes on one WAL DB.
- **Native file access** (the browser's blind spot): preload exposes `window.nexusDesktop`;
  NodePanel uses it to `shell.openPath` / `showItemInFolder` linked files/folders (expanding
  `~`), and routes external http links through `shell.openExternal`. Web build keeps the
  copy-path fallback. Detect via `window.nexusDesktop?.isElectron`.
- **electron-builder** config is the `build` block in package.json. Output → `release/`
  (NOT `dist/`, which is Vite's). `asarUnpack`s better-sqlite3 (native, must be on disk),
  `dist/` and `roadmaps/` (robust static serving from `app.asar.unpacked`, transparent to
  `fs`). `files` whitelists electron/server/dist/roadmaps — `data/`, `src/`, `tests/` excluded.
- **Native-ABI gotcha:** better-sqlite3 is compiled for Node's ABI by default (needed for
  tests/`npm start`). `npm run electron`/`dist` rebuild it for Electron's ABI (via
  @electron/rebuild / electron-builder); `postdist` auto-restores Node ABI. If a native-module
  error appears running tests after Electron work, run `npm rebuild better-sqlite3`.
- Verify without a display: `ELECTRON_RUN_AS_NODE` or just replicate `startServer()` on Node
  (set NEXUS_DB_PATH + PORT, import the server, poll `/api/workspace`). GUI rendering needs a
  real desktop.

## Gamification rules

- XP on transition into Completed/Submitted (once — no clawback on revert, by design).
  Defaults per type in `gamification.js` (`DEFAULT_XP`), node.xp overrides.
- Level thresholds: level 2 at 100 XP, each next level costs +50 more (`levelThreshold`).
- Streak: consecutive days with ≥1 completion. Badges: 9 in `BADGES`, checked after
  completions/links/imports.

## Design system notes (src/theme.css)

- Tokens at the top (`--bg-*, --panel, --accent-a/b/c, --gradient`). Glass = `.glass`,
  HUD frame = `.corners`. Ambient background = `.bg-fx` (grid/aurora/scanline) rendered
  once in App.jsx; respects `prefers-reduced-motion`.
- **Themes:** accents are RGB triplets (`--aa-rgb` etc.) so glows derive any alpha via
  `rgb(var(--aa-rgb) / .4)`. A theme = one `[data-theme='x']` block overriding accents +
  ambient params (nebula colors, grid alpha, scan speed, aurora durations). Registry/UI
  metadata in `src/themes.js` (`applyTheme` sets `data-theme` on `<html>`); persisted via
  /api/settings. To add a theme: CSS block + one registry entry. Boot flow in App.jsx:
  load settings → applyTheme → NamePrompt (first run) or Greeting overlay.
- Chart colors are contrast-validated against the panel surface: single-series bars use
  `--accent-b` (#818cf8, 6.2:1) / `--accent-a`; the confidence ramp
  `#0e7490 → #06b6d4 → #22d3ee → #67e8f9` is monotonic in lightness, min 3.45:1.
  If you change chart colors, re-check contrast (≥3:1 vs #0d1324).
- Per-type node colors live in `src/meta.js` `TYPE_META`.

## Completed features

Clean-slate onboarding (empty graph → create/import/demo), simulated-workspace banner
(persistent amber pill while demo data is loaded → one-click exit), graph view (custom nodes,
connect, drag-persist, collapse, legend, minimap, locked states, confidence rings),
node panel (all fields, guide renderer, confidence breakdown, XP chip, course
instructor/semester, markdown notes, links, related jumping), dashboard (+weekly XP strip,
overall %), Operator Profile stats view (rings, charts, records, badges, activity feed,
demo/reset), tracker, 11 rich roadmaps + custom import, prereq edges + locking,
gamification, search, deep links (`?view=`, `?node=`), Docker, production static serving.

## Known issues / limitations

- Tests cover `confidence.js`, the roadmap importer and sync snapshots — no API-route or
  UI tests yet; GitHub client calls (network) are exercised manually, not in the suite.
- Sync is single-file last-write-wins — no merging; simultaneous edits on two machines
  lose one side (with a warning). Edge-only changes don't trip the dirty check.
- XP is not reverted if you un-complete a node (intentional; revisit).
- Local file/folder links copy the path to clipboard in the WEB build (browsers can't open
  `file://`); the Electron desktop build opens/reveals them natively.
- electron-builder emits a cosmetic Linux warning about `desktopName`/WM_CLASS window
  association — harmless (affects taskbar icon grouping on some DEs), not yet configured.
- Graph initial camera is a static `defaultViewport` centered on the hub (0,0);
  for an empty workspace the onboarding overlay covers this.
- Minor a11y lint warnings (labels without htmlFor, clickable divs) — pre-existing pattern.
- Roadmap import positions are static columns; a force layout could be nicer.
- Confidence recomputes on every /api/graph call — fine locally (<1k nodes), revisit if slow.

## Next recommended steps

1. **More tests** — `gamification.js` (level curve, streak day math) and API routes
   (supertest against the express app) are the next cheapest wins; `tests/` shows the
   in-memory-DB pattern to follow.
2. **LMS import** — an importer producing nodes/edges like `roadmaps.js` does;
   iCal feed → assignment nodes under a course is the cheapest win.
3. Tauri wrapper for a real desktop app + opening local files natively.
4. Spaced-repetition review queue on topic nodes.
5. Edge-kind editing UI; XP history view; weekly review screen.
6. Optional GitHub integration: link a repo to a project and count commits as evidence
   for connected skills (raises confidence automatically).

## How to continue as an AI agent

- Run `npm install && npm run dev`, open http://localhost:5173.
- DB is disposable: `npm run demo:reset` gives a populated demo state;
  `curl -X POST localhost:4000/api/workspace/reset` wipes it.
- Verify UI changes headlessly (build first: `npm run build`, run `npm run server`):
  `google-chrome --headless=new --screenshot=x.png --window-size=1600,950 --virtual-time-budget=8000 "http://localhost:4000/?view=graph"`
  — views: graph | dashboard | tracker | roadmaps | stats; `&node=<id>` opens a node panel.
- Validate roadmap JSONs after editing: every topic id unique + kebab-case, prerequisites
  reference EARLIER ids only, resources are `{label, url}` with https URLs.
- Style: plain JS (no TS), ESM everywhere, 2-space indent, keep the design language in
  `theme.css` (CSS vars, glass, per-type accents from `src/meta.js`). Match existing idiom.
- Keep the clean-slate policy: nothing personal in code or seed data; demo stays optional.
- **Update this file** when you add features, change the schema, or discover issues.
