const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('autoCompareDesktop', {
  isDesktop: true,
});
