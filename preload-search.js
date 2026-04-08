const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardBrowser', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  serverSearch: (term) => ipcRenderer.invoke('server-search', term)
});
