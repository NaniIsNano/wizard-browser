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
  // Download manager
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  openDownload: (path) => ipcRenderer.send('open-download', path),
  showDownload: (path) => ipcRenderer.send('show-download', path),
  onDownloadStarted: (cb) => ipcRenderer.on('download-started', (_, dl) => cb(dl)),
  onDownloadUpdated: (cb) => ipcRenderer.on('download-updated', (_, dl) => cb(dl)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_, dl) => cb(dl)),
  // Onion detection
  navigateOnion: (url) => ipcRenderer.send('navigate-onion', url),
  onOnionAvailable: (cb) => ipcRenderer.on('onion-available', (_, data) => cb(data)),
  // Auto-update
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  // Events
  onUrlChange: (cb) => ipcRenderer.on('url-changed', (_, url) => cb(url)),
  onTitleChange: (cb) => ipcRenderer.on('title-changed', (_, title) => cb(title)),
  onLoadingChange: (cb) => ipcRenderer.on('loading-changed', (_, loading) => cb(loading)),
  onBlockedUpdate: (cb) => ipcRenderer.on('blocked-update', (_, count) => cb(count))
});
