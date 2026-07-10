// Bridges a tiny, explicit desktop API into the renderer. contextIsolation is
// on, so the page only sees exactly what's exposed here — no Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusDesktop', {
  isElectron: true,
  platform: process.platform,
  openPath: (target) => ipcRenderer.invoke('open-path', target),
  showItemInFolder: (target) => ipcRenderer.invoke('show-item', target),
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
