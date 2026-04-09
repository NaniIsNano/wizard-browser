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
  // Navigation
  openSettings: () => ipcRenderer.send('open-settings'),
  openIRC: () => ipcRenderer.send('open-irc')
});
