const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardBrowser', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  serverSearch: (term) => ipcRenderer.invoke('server-search', term),
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  getSpeedDial: () => ipcRenderer.invoke('get-speed-dial'),
  saveSpeedDial: (sd) => ipcRenderer.invoke('save-speed-dial', sd),
  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (data) => ipcRenderer.invoke('add-bookmark', data),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  // PIN lock
  getPinState: () => ipcRenderer.invoke('get-pin-state'),
  setPin: (data) => ipcRenderer.invoke('set-pin', data),
  verifyPin: (pin) => ipcRenderer.invoke('verify-pin', pin),
  skipPinSetup: () => ipcRenderer.invoke('skip-pin-setup'),
  // Shell navigation (asks browser.html shell to drive the active webview)
  openSettings: () => ipcRenderer.send('open-settings'),
  openHome: () => ipcRenderer.send('open-home'),
  openNewTab: () => ipcRenderer.send('open-newtab'),
  openInNewTab: (url) => ipcRenderer.send('open-newtab-url', url),
  // Open in the user's default OS browser (for chat widgets / docs that
  // refuse to load inside an embedded webview)
  openExternal: (url) => ipcRenderer.send('open-external', url),
  // Settings live-change (so search/settings can re-render when changed elsewhere)
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_, s) => cb(s)),

  // ─── WizardScript management (used by extensions.html) ───
  extList:                () => ipcRenderer.invoke('ext-list'),
  extToggle:              (id) => ipcRenderer.invoke('ext-toggle', id),
  extUninstall:           (id) => ipcRenderer.invoke('ext-uninstall', id),
  extInstallFromFolder:   () => ipcRenderer.invoke('ext-install-from-folder'),
  onExtensionsChanged:    (cb) => ipcRenderer.on('extensions-changed', () => cb())
});
