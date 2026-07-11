# NEXUS — Developer Life OS

A **local-first, gamified second brain** for developers and CS students. Courses,
assignments, projects, skills, files, notes and learning roadmaps live as connected
nodes on an interactive skill-tree map — with XP, levels, streaks, badges and
evidence-based skill confidence to keep you moving.

Everything runs on your machine. No account, no cloud, one SQLite file.
**Starts as a clean slate** — your data, your map. A demo workspace is one click away
(and one click to remove).

![NEXUS](docs/screenshot.png)

## Features

- **Boot greeting** — tell NEXUS your name once and it greets you Jarvis-style on every launch
- **Configurable themes** — six full-interface themes (Hologrid, Crimson Protocol, Terminal,
  Sunset Drive, Midas Circuit, Cryostasis), each with its own ambient animations: aurora drift,
  grid density and scanline speed. Switch live from Settings
- **Neural Map** — an interactive knowledge graph (pan / zoom / drag / connect / collapse)
  with glowing HUD-style nodes for courses, coursework, projects, skills, goals, notes and roadmaps
- **Locked / unlocked progression** — roadmap topics with unmet prerequisites render locked,
  skill-tree style, and unlock as you complete what comes before
- **Skill confidence scoring** — a transparent heuristic estimates how likely you've actually
  *demonstrated* each skill from linked evidence (files, repos, projects, notes, completed work):
  `0–25 Not enough evidence · 26–50 Some exposure · 51–75 Practiced · 76–100 Demonstrated`
- **Node detail panel** — status, progress, due date, XP value, markdown notes, next actions,
  structured learning guide, confidence breakdown, linked files/folders/repos/URLs, connected nodes
- **Learning roadmaps** — 11 curated roadmap.sh-style paths (CS, DSA, Backend, Frontend,
  Full Stack, DevOps, Cybersecurity, Linux, Databases, Networking, Operating Systems).
  Every topic ships with *why it matters*, *what to learn*, real resource links,
  prerequisites and completion criteria — or import your own JSON
- **Mission Control dashboard** — overdue / today / week / month deadlines, weekly XP strip,
  overall completion, course & project progress, goals
- **Operator Profile (Stats)** — level ring, XP-per-week chart, 14-day activity, records,
  confidence distribution, strongest skills, badge gallery, activity feed
- **Deadline Tracker** — all coursework grouped by course with one-click status changes
- **Gamification** — XP per completion, levels, daily streaks, 9 badges, toasts
- **Search** — `Ctrl/⌘+K` palette across titles, descriptions, notes and linked files
- **Deep links** — `/?view=stats`, `/?node=<id>` jump straight to a view or node
- **GitHub sync** — connect your GitHub account and keep your workspace in a **private repo
  you own**; push from one machine, pull from another. Plus one-click local backup
  download/restore (JSON)
- **Local-first** — one SQLite database per machine in your OS user-data folder; copy it to
  back up, or use GitHub sync to move it between machines

## Quick start

Requires **Node.js 18+** (tested on 20).

```bash
npm install
npm run dev        # dev mode: API on :4000, UI on http://localhost:5173
```

or production mode (single port):

```bash
npm start          # builds the UI, serves everything on http://localhost:4000
```

The app starts **empty**. From the onboarding screen you can create your first node,
import a learning roadmap, or load the demo workspace to explore.

## How should I run it?

NEXUS is a Node + SQLite app with a web UI, so it runs the same on **Windows, macOS, and
Linux** — no OS-specific version. Pick whichever fits you:

- **Everyday (recommended):** `npm start`, then open `http://localhost:4000`. Zero packaging,
  identical on all three OSes.
- **Native desktop app:** `npm run electron` (own window, dock icon, opens linked files in
  your file manager). Optional — see [Desktop app](#desktop-app-electron) below.
- **Container:** `docker compose up --build`.

**Where your data lives:** a stable per-user folder, independent of where you cloned the repo,
so moving or re-cloning never loses it (and every run mode above shares the same database):

| OS | Database location |
|---|---|
| Linux | `~/.config/NEXUS/nexus.db` |
| macOS | `~/Library/Application Support/NEXUS/nexus.db` |
| Windows | `%APPDATA%\NEXUS\nexus.db` |

Set `NEXUS_DB_PATH` to override it. Upgrading from an older version auto-migrates an existing
`data/nexus.db` on first run. **To use NEXUS on several machines, connect GitHub sync** (below)
— that's how your workspace travels between them.

### Desktop app (Electron)

Run NEXUS as a native desktop app — its own window, dock/taskbar icon, no browser tab.
It reuses the same server; the database lives in your OS user-data folder
(`~/.config/NEXUS`, `~/Library/Application Support/NEXUS`, or `%APPDATA%\NEXUS`).

```bash
npm run electron      # build UI, rebuild native SQLite for Electron, launch the app
```

Build distributable installers (output in `release/`):

```bash
npm run dist:linux    # → NEXUS-<ver>-linux-x86_64.AppImage
npm run dist          # installer for the OS you run it on (.AppImage / .dmg / .exe)
```

macOS `.dmg` and Windows `.exe` must be built **on** those platforms (or in CI).
In the desktop app, files/folders linked to a node **open in your OS file manager**
(the web build can only copy the path). Packaging rebuilds the native SQLite module for
Electron; if you then want to run `npm test`/`npm start` again, run `npm rebuild better-sqlite3`.

### Docker (optional)

```bash
docker compose up --build   # http://localhost:4000, data persisted in a named volume
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev servers with hot reload (Vite + API) |
| `npm run build` | Build the UI into `dist/` |
| `npm start` | Build UI + serve app on :4000 |
| `npm run server` | API only (serves `dist/` if present) |
| `npm run electron` | Launch the desktop app (Electron) |
| `npm run dist` / `dist:linux` | Build desktop installers into `release/` |
| `npm run demo` | Load the sample workspace (only into an empty DB) |
| `npm run demo:reset` | **Wipe everything** and load the sample workspace |
| `npm test` | Run the Vitest suite (confidence, roadmap importer, sync snapshots) |

## Keyboard & mouse

- `Ctrl/⌘ + K` — search palette
- Drag from a node's right handle to another node — create a connection
- Click an edge, press `Delete` — remove a connection
- `−` button on a node — collapse its subtree
- Click any node — open the detail panel

## Sync across machines (GitHub)

**Settings → GitHub sync**: paste a GitHub token and NEXUS keeps your whole workspace as
`nexus-backup.json` in a private repo it creates for you (default `nexus-data`). Push from
one machine, pull from another — it's your data, in your account, no third-party server.

- **Token:** a [fine-grained PAT](https://github.com/settings/personal-access-tokens/new)
  with **Contents: read & write** (plus **Administration: write** if NEXUS should create
  the repo for you), or a classic token with the `repo` scope. It's stored only in your
  local database and never included in backups.
- **One-click OAuth (optional):** register a GitHub OAuth app with *Device Flow* enabled
  and start NEXUS with `NEXUS_GITHUB_CLIENT_ID=<client id>` — Settings then offers
  "Connect with GitHub" (enter a code, no token pasting).
- **Conflicts:** sync is last-write-wins. NEXUS warns before overwriting anything —
  a push warns if the remote changed since you last synced; a pull warns if you have
  unsynced local changes.
- A private repo is access-controlled but **not encrypted** — treat it accordingly.

## Add your own roadmap

Drop a JSON file into `roadmaps/` (format documented in `server/roadmaps.js`) or use
**Roadmaps → Import JSON file**. Topics support `why`, `learn[]`, `resources[]`,
`prerequisites[]` and `criteria[]` — prerequisites become locked/unlocked states on the map.

## Where things live

```
server/     Express API + SQLite (better-sqlite3): schema, gamification, confidence
            scoring, roadmap importer, GitHub sync, optional demo data
electron/   Desktop shell (optional) — boots the same server in a native window
src/        React UI (Vite + React Flow): map, dashboard, tracker, roadmaps, stats
roadmaps/   Learning-path JSON files — add your own here
```

Your database is **not** in the repo — it lives in your OS user-data folder (see
[How should I run it?](#how-should-i-run-it)). A legacy `data/nexus.db` is auto-migrated on
first run.

## Screenshots


## License

MIT — see [LICENSE](LICENSE).

---

For architecture, schema, API reference and how to continue development (human or AI),
see **[AGENTS.md](AGENTS.md)**.
