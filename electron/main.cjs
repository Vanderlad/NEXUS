// Electron shell for NEXUS. It reuses the exact same Express + SQLite server as
// the web build — the main process just boots it on a free local port (with the
// database in the OS user-data dir) and points a window at it. The web flow
// (`npm start`) is untouched; this file is purely additive.
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

app.setName('NEXUS');

// One instance only — two processes on the same SQLite file (WAL) would fight.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Resolve after the server answers on /api/workspace, or reject on timeout.
function waitForServer(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const ping = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/workspace', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('NEXUS server did not start in time'));
      setTimeout(ping, 250);
    };
    ping();
  });
}

async function startServer() {
  const dbPath = path.join(app.getPath('userData'), 'nexus.db');
  const port = await freePort();
  // The server reads both of these at import time.
  process.env.NEXUS_DB_PATH = dbPath;
  process.env.PORT = String(port);
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
  await import(pathToFileURL(serverEntry).href);
  await waitForServer(port);
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#04060c',
    show: false,
    title: 'NEXUS',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // External http(s) links open in the system browser, never a new app window.
  const openExternal = (url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => openExternal(url));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- native file access (the thing a browser can't do) -----------------------

// Demo/user paths may start with ~ — expand to the real home directory.
const expandHome = (p) => (typeof p === 'string' && p.startsWith('~')
  ? path.join(os.homedir(), p.slice(1))
  : p);

ipcMain.handle('open-path', async (_e, target) => {
  const err = await shell.openPath(expandHome(target)); // '' on success
  return { ok: !err, error: err || null };
});

ipcMain.handle('show-item', (_e, target) => {
  shell.showItemInFolder(expandHome(target));
  return { ok: true };
});

ipcMain.handle('open-external', (_e, url) => {
  if (/^(https?|mailto):/i.test(url)) { shell.openExternal(url); return { ok: true }; }
  return { ok: false, error: 'blocked' };
});

// --- lifecycle ---------------------------------------------------------------

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null); // no default Electron menu; the app is the chrome
  try {
    const port = await startServer();
    createWindow(port);
  } catch (err) {
    const { dialog } = require('electron');
    dialog.showErrorBox('NEXUS failed to start', String(err?.stack || err));
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) app.relaunch();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
