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
  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Server-side search (bypasses CORS)
  serverSearch: (term) => ipcRenderer.invoke('server-search', term),
  // Auto-update
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (data) => ipcRenderer.invoke('add-bookmark', data),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  openBookmark: (url) => ipcRenderer.send('open-bookmark', url),
  onBookmarkAdded: (cb) => ipcRenderer.on('bookmark-added', (_, data) => cb(data)),
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getSpeedDial: () => ipcRenderer.invoke('get-speed-dial'),
  saveSpeedDial: (sd) => ipcRenderer.invoke('save-speed-dial', sd),
  openSettings: () => ipcRenderer.send('open-settings'),
  openIRC: () => ipcRenderer.send('open-irc'),
  // PIN lock
  getPinState: () => ipcRenderer.invoke('get-pin-state'),
  setPin: (data) => ipcRenderer.invoke('set-pin', data),
  verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),
  skipPinSetup: () => ipcRenderer.invoke('skip-pin-setup'),
  // Events
  onUrlChange: (cb) => ipcRenderer.on('url-changed', (_, url) => cb(url)),
  onTitleChange: (cb) => ipcRenderer.on('title-changed', (_, title) => cb(title)),
  onLoadingChange: (cb) => ipcRenderer.on('loading-changed', (_, loading) => cb(loading)),
  onBlockedUpdate: (cb) => ipcRenderer.on('blocked-update', (_, count) => cb(count)),
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getSpeedDial: () => ipcRenderer.invoke('get-speed-dial'),
  saveSpeedDial: (sd) => ipcRenderer.invoke('save-speed-dial', sd),
  // Navigation
  openSettings: () => ipcRenderer.send('open-settings'),
  openIRC: () => ipcRenderer.send('open-irc'),
  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (data) => ipcRenderer.invoke('add-bookmark', data),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  openBookmark: (url) => ipcRenderer.send('open-bookmark', url),
  onBookmarkAdded: (cb) => ipcRenderer.on('bookmark-added', (_, data) => cb(data)),
  // PIN lock
  getPinState: () => ipcRenderer.invoke('get-pin-state'),
  setPin: (data) => ipcRenderer.invoke('set-pin', data),
  verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),
  skipPinSetup: () => ipcRenderer.invoke('skip-pin-setup')
});
