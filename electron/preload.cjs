// The only bridge between the page and the desktop shell. Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onOpenFile: (cb) => {
    const h = (_e, f) => cb(f.name, new Uint8Array(f.data));
    ipcRenderer.on('open-file', h);
    return () => ipcRenderer.off('open-file', h);
  },
  onMenu: (cb) => {
    const h = (_e, cmd) => cb(cmd);
    ipcRenderer.on('menu', h);
    return () => ipcRenderer.off('menu', h);
  },
});
