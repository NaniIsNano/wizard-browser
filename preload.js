const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wizardBrowser', {
  // Browsing-data + privacy
  clearAllData:     () => ipcRenderer.invoke('clear-all-data'),
  toggleTor:        (enable) => ipcRenderer.invoke('toggle-tor', enable),
  getBlockedCount:  () => ipcRenderer.invoke('get-blocked-count'),

  // App version
  getVersion:       () => ipcRenderer.invoke('get-version'),

  // Server-side search (bypasses CORS)
  serverSearch:     (term) => ipcRenderer.invoke('server-search', term),

  // Downloads
  getDownloads:     () => ipcRenderer.invoke('get-downloads'),
  openDownload:     (p) => ipcRenderer.send('open-download', p),
  showDownload:     (p) => ipcRenderer.send('show-download', p),
  onDownloadStarted:(cb) => ipcRenderer.on('download-started', (_, dl) => cb(dl)),
  onDownloadUpdated:(cb) => ipcRenderer.on('download-updated', (_, dl) => cb(dl)),
  onDownloadDone:   (cb) => ipcRenderer.on('download-done',    (_, dl) => cb(dl)),

  // Bookmarks
  getBookmarks:     () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark:      (data) => ipcRenderer.invoke('add-bookmark', data),
  removeBookmark:   (url) => ipcRenderer.invoke('remove-bookmark', url),
  onBookmarkAdded:  (cb) => ipcRenderer.on('bookmark-added', (_, data) => cb(data)),

  // Settings
  getSettings:      () => ipcRenderer.invoke('get-settings'),
  saveSettings:     (s) => ipcRenderer.invoke('save-settings', s),
  getSpeedDial:     () => ipcRenderer.invoke('get-speed-dial'),
  saveSpeedDial:    (sd) => ipcRenderer.invoke('save-speed-dial', sd),

  // PIN lock
  getPinState:      () => ipcRenderer.invoke('get-pin-state'),
  setPin:           (data) => ipcRenderer.invoke('set-pin', data),
  verifyPin:        (pin) => ipcRenderer.invoke('verify-pin', pin),
  skipPinSetup:     () => ipcRenderer.invoke('skip-pin-setup'),

  // Auto-update
  checkUpdate:      () => ipcRenderer.invoke('check-update'),
  installUpdate:    () => ipcRenderer.send('install-update'),
  onUpdateStatus:   (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),

  // Browser-shell events
  onOnionAvailable: (cb) => ipcRenderer.on('onion-available', (_, data) => cb(data)),
  onBlockedUpdate:  (cb) => ipcRenderer.on('blocked-update', (_, count) => cb(count)),
  onSearchSelection:(cb) => ipcRenderer.on('search-selection', (_, text) => cb(text)),
  onNavigateShell:  (cb) => ipcRenderer.on('navigate-shell', (_, where) => cb(where)),
  onNavigateShellUrl:(cb) => ipcRenderer.on('navigate-shell-url', (_, url) => cb(url)),
  onOpenNewTabUrl:  (cb) => ipcRenderer.on('open-newtab-url', (_, url) => cb(url)),
  onSettingsChanged:(cb) => ipcRenderer.on('settings-changed', (_, s) => cb(s)),

  // ─── WizardScript runtime bridges (shell-side) ───
  extListRuntime:        () => ipcRenderer.invoke('ext-list-runtime'),
  extStorageGet:         (id, key)        => ipcRenderer.invoke('ext-storage-get', id, key),
  extStorageSet:         (id, key, value) => ipcRenderer.invoke('ext-storage-set', id, key, value),
  extStorageRemove:      (id, key)        => ipcRenderer.invoke('ext-storage-remove', id, key),
  extStorageClear:       (id)             => ipcRenderer.invoke('ext-storage-clear', id),
  extNetFetch:           (url, options)        => ipcRenderer.invoke('ext-net-fetch', url, options),
  extNetPost:            (url, body, options)  => ipcRenderer.invoke('ext-net-post',  url, body, options),
  extPrivacyGetSettings: ()       => ipcRenderer.invoke('ext-privacy-getSettings'),
  extPrivacyIsTrackerBlocked: (d) => ipcRenderer.invoke('ext-privacy-isTrackerBlocked', d),
  extPrivacyGetBlockedCount: ()   => ipcRenderer.invoke('ext-privacy-getBlockedCount'),
  extUiGetTheme:         ()       => ipcRenderer.invoke('ext-ui-getTheme'),
  onExtensionsChanged:   (cb)     => ipcRenderer.on('extensions-changed', () => cb())
});
