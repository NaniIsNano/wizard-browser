const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardBrowser', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  reload: () => ipcRenderer.send('reload-page'),
  goHome: () => ipcRenderer.send('go-home'),
  getBlockedCount: () => ipcRenderer.invoke('get-blocked-count'),
  clearAllData: () => ipcRenderer.invoke('clear-all-data'),
  toggleTor: (enable) => ipcRenderer.invoke('toggle-tor', enable),
  onUrlChange: (cb) => ipcRenderer.on('url-changed', (_, url) => cb(url)),
  onTitleChange: (cb) => ipcRenderer.on('title-changed', (_, title) => cb(title)),
  onLoadingChange: (cb) => ipcRenderer.on('loading-changed', (_, loading) => cb(loading)),
  onBlockedUpdate: (cb) => ipcRenderer.on('blocked-update', (_, count) => cb(count))
});
