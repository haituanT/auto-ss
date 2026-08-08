const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('autoCompareDesktop', {
  isDesktop: true,
  update: {
    check: () => ipcRenderer.invoke('app-update:check'),
    apply: () => ipcRenderer.invoke('app-update:apply'),
  },
});
