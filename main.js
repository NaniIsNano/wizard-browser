const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const trackerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tracker-list.json'), 'utf-8')
).trackers;

const PARTITION = 'persist:wizard';

let mainWindow;
let blockedCount = 0;
let downloads = [];

// --- Persisted state ---
const settingsPath  = path.join(app.getPath('userData'), 'wizard-settings.json');
const bookmarksPath = path.join(app.getPath('userData'), 'wizard-bookmarks.json');
const pinPath       = path.join(app.getPath('userData'), 'wizard-pin.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function saveJSON(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

let settings = loadJSON(settingsPath, {
  // Theme system v3: layout + theme + modifiers all independent
  layout: 'default',             // 'default' | 'win7'
  theme: 'default',              // 'default' | 'frutiger' | 'canola' | 'mountains' | 'fortress' | 'retrowave' | 'custom'
  sharpEdges: false,             // applies to every layout/theme
  glossyUI: false,               // applies to every layout/theme
  customBg: '',                  // data URL — used by 'custom' theme, available under any layout
  // Legacy keys (kept for migration; ignored once layout/theme set)
  themeMode: 'default',
  aeroBackground: 'fruiter',
  doNotTrack: true,
  canvasSpoofing: true,
  webrtcProtection: true,
  referrerStripping: true,
  trackerBlocking: true,
  clearOnExit: true,
  speedDial: [
    { name: 'YouTube',   url: 'https://youtube.com',   icon: 'Y' },
    { name: 'GitHub',    url: 'https://github.com',    icon: 'G' },
    { name: 'Reddit',    url: 'https://reddit.com',    icon: 'R' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', icon: 'W' }
  ]
});

// Migrate previous theme system to layout + theme
(function migrateTheme() {
  // If new keys missing, derive from old themeMode/aeroBackground
  if (settings.layout && settings.theme && settings.theme !== 'default-needs-migration') return;
  const tm = settings.themeMode || 'default';
  const ab = settings.aeroBackground || 'fruiter';
  if (tm === 'aero') {
    settings.layout = settings.layout || 'default';
    settings.theme  = ab === 'fruiter' ? 'frutiger' : ab; // canola | mountains | fortress | custom
  } else if (tm === 'retrowave') {
    settings.layout = settings.layout || 'default';
    settings.theme  = 'retrowave';
  } else {
    settings.layout = settings.layout || 'default';
    settings.theme  = settings.theme  || 'default';
  }
  saveJSON(settingsPath, settings);
})();
let bookmarks = loadJSON(bookmarksPath, []);
let pinData   = loadJSON(pinPath, { enabled: false, pin: null, asked: false });

// --- Privacy command-line switches (must be set before app.ready) ---
if (settings.canvasSpoofing) app.commandLine.appendSwitch('disable-reading-from-canvas');
if (settings.webrtcProtection) app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');

const onionMap = {
  'duckduckgo.com': 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion',
  'www.duckduckgo.com': 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion',
  'protonmail.com': 'https://protonmailrmez3lotccipshtkleegetolb73fuirgj7r4o4vfu7ozyd.onion',
  'mail.proton.me': 'https://protonmailrmez3lotccipshtkleegetolb73fuirgj7r4o4vfu7ozyd.onion',
  'www.facebook.com': 'https://www.facebookwkhpilnemxj7asber7ihyozr6e3c4zylql2dmheq626r4sbi3ad.onion',
  'facebook.com': 'https://www.facebookwkhpilnemxj7asber7ihyozr6e3c4zylql2dmheq626r4sbi3ad.onion',
  'twitter.com': 'https://twitter3e4tixl4xyajtrzo62zg5vztmjuricljdp2c5kshju4avyoid.onion',
  'x.com': 'https://twitter3e4tixl4xyajtrzo62zg5vztmjuricljdp2c5kshju4avyoid.onion',
  'www.nytimes.com': 'https://nytimesn7cgmftshazwhfgzm37qxb44r64ytbb2dj3x62d2lbd7i2ad.onion',
  'www.bbc.com': 'https://www.bbcnewsd73hkzno2ini43t4gblnltkjuni6ep7buber2ber7ryzqfid.onion',
  'www.reddit.com': 'https://www.reddittorjg6rue252oqsxryoxengawnmo46qy4kyii5wtqnwfj4ooad.onion',
  'reddit.com': 'https://www.reddittorjg6rue252oqsxryoxengawnmo46qy4kyii5wtqnwfj4ooad.onion',
  'github.com': 'https://githubfbnd3hp6vnuypjm5nq5cqehvr3v3mhfbpxs7syrsa2gx5cjnbad.onion',
  'archive.org': 'https://archiveiya74codqgiixo33q62qlrqtkgmcitqx5u2oeqnmber5c2lmaid.onion'
};

function configureContentSession() {
  const ses = session.fromPartition(PARTITION);

  // Inject preload-search.js into every page rendered inside the webview
  if (typeof ses.registerPreloadScript === 'function') {
    ses.registerPreloadScript({
      type: 'frame',
      filePath: path.join(__dirname, 'preload-search.js')
    });
  } else {
    ses.setPreloads([path.join(__dirname, 'preload-search.js')]);
  }

  ses.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  if (settings.trackerBlocking) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url.toLowerCase();
      if (trackerList.some(t => url.includes(t))) {
        blockedCount++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('blocked-update', blockedCount);
        }
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  }

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;

    if (settings.referrerStripping && headers['Referer']) {
      try {
        const ref = new URL(headers['Referer']);
        const req = new URL(details.url);
        if (ref.origin !== req.origin) delete headers['Referer'];
      } catch { delete headers['Referer']; }
    }

    if (settings.doNotTrack) {
      headers['DNT'] = '1';
      headers['Sec-GPC'] = '1';
    } else {
      delete headers['DNT'];
    }

    headers['Accept-Language']    = 'en-US,en;q=0.9';
    headers['Sec-CH-UA']          = '"Chromium";v="131", "Not_A Brand";v="24"';
    headers['Sec-CH-UA-Mobile']   = '?0';
    headers['Sec-CH-UA-Platform'] = '"Windows"';

    callback({ requestHeaders: headers });
  });

  ses.on('will-download', (event, item) => {
    const id = Date.now();
    const dl = {
      id,
      filename: item.getFilename(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      path: ''
    };
    downloads.push(dl);
    if (mainWindow) mainWindow.webContents.send('download-started', dl);

    item.on('updated', (_, state) => {
      dl.receivedBytes = item.getReceivedBytes();
      dl.totalBytes    = item.getTotalBytes();
      dl.state         = state;
      dl.path          = item.getSavePath();
      if (mainWindow) mainWindow.webContents.send('download-updated', dl);
    });
    item.once('done', (_, state) => {
      dl.state         = state;
      dl.path          = item.getSavePath();
      dl.receivedBytes = dl.totalBytes;
      if (mainWindow) mainWindow.webContents.send('download-done', dl);
    });
  });

  return ses;
}

function createWindow() {
  configureContentSession();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Wizard Browser',
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile('browser.html');
}

// Per-webview wiring
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    contents.loadURL(url);
    return { action: 'deny' };
  });

  contents.on('will-prevent-unload', (e) => e.preventDefault());

  contents.on('did-navigate', (_, url) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const host = new URL(url).hostname;
        if (onionMap[host]) {
          mainWindow.webContents.send('onion-available', { clearnet: host, onion: onionMap[host] });
        }
      } catch {}
    }
  });

  contents.on('context-menu', (_, params) => {
    const tmpl = [];
    if (contents.canGoBack())    tmpl.push({ label: 'Back',    click: () => contents.goBack() });
    if (contents.canGoForward()) tmpl.push({ label: 'Forward', click: () => contents.goForward() });
    tmpl.push({ label: 'Reload', click: () => contents.reload() });
    tmpl.push({ type: 'separator' });

    if (params.selectionText) {
      tmpl.push({ label: 'Copy', click: () => contents.copy() });
      const trimmed = params.selectionText.slice(0, 30);
      tmpl.push({
        label: `Search Wizard for "${trimmed}${params.selectionText.length > 30 ? '...' : ''}"`,
        click: () => mainWindow.webContents.send('search-selection', params.selectionText)
      });
      tmpl.push({ type: 'separator' });
    }

    if (params.isEditable) {
      tmpl.push({ label: 'Cut',        click: () => contents.cut() });
      tmpl.push({ label: 'Copy',       click: () => contents.copy() });
      tmpl.push({ label: 'Paste',      click: () => contents.paste() });
      tmpl.push({ label: 'Select All', click: () => contents.selectAll() });
      tmpl.push({ type: 'separator' });
    }

    if (params.linkURL) {
      tmpl.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
      tmpl.push({
        label: 'Bookmark This Link',
        click: () => {
          const title = params.linkText || params.linkURL;
          addBookmark(title, params.linkURL);
          mainWindow.webContents.send('bookmark-added', { title, url: params.linkURL });
        }
      });
      tmpl.push({ type: 'separator' });
    }

    if (params.hasImageContents) {
      tmpl.push({ label: 'Copy Image',         click: () => contents.copyImageAt(params.x, params.y) });
      tmpl.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
      tmpl.push({ type: 'separator' });
    }

    tmpl.push({
      label: 'Bookmark This Page',
      click: () => {
        const title = contents.getTitle();
        const url   = contents.getURL();
        addBookmark(title, url);
        mainWindow.webContents.send('bookmark-added', { title, url });
      }
    });
    tmpl.push({ type: 'separator' });
    tmpl.push({ label: 'View Page Source', click: () => contents.loadURL('view-source:' + contents.getURL()) });
    tmpl.push({ label: 'Inspect Element',  click: () => contents.inspectElement(params.x, params.y) });

    Menu.buildFromTemplate(tmpl).popup({ window: mainWindow });
  });
});

function addBookmark(title, url) {
  if (!url || url.startsWith('file://') || url.startsWith('about:')) return;
  if (bookmarks.some(b => b.url === url)) return;
  bookmarks.push({ title, url, date: Date.now() });
  saveJSON(bookmarksPath, bookmarks);
}
function removeBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveJSON(bookmarksPath, bookmarks);
}

// =====================================================================
// IPC handlers
// =====================================================================

// Server-side search (no CORS issues)
ipcMain.handle('server-search', async (_, term) => {
  const http = require('https');

  const searxInstances = [
    'https://searx.be', 'https://priv.au', 'https://baresearch.org',
    'https://opnxng.com', 'https://paulgo.io', 'https://etsi.me',
    'https://search.ononoki.org', 'https://northboot.xyz', 'https://s.mble.dk'
  ];
  const shuffled = searxInstances.sort(() => Math.random() - 0.5);

  for (const instance of shuffled) {
    try {
      const results = await new Promise((resolve, reject) => {
        const url = `${instance}/search?q=${encodeURIComponent(term)}&format=json&categories=general`;
        const req = http.get(url, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' }
        }, (res) => {
          if (res.statusCode !== 200) { reject(); return; }
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (json.results && json.results.length > 0) {
                resolve(json.results.slice(0, 20).map((r, i) => ({
                  title: r.title || '',
                  url: r.url,
                  snippet: (r.content || '').slice(0, 250),
                  relevance: 100 - i,
                  source: 'web'
                })));
              } else reject();
            } catch { reject(); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(); });
      });
      if (results && results.length > 0) return results;
    } catch { continue; }
  }

  // DuckDuckGo lite fallback
  try {
    const results = await new Promise((resolve) => {
      const postData = `q=${encodeURIComponent(term)}`;
      const req = http.request({
        hostname: 'lite.duckduckgo.com',
        path: '/lite/',
        method: 'POST',
        timeout: 6000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
        }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const out = [];
          const linkRe = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]*)<\/a>/gi;
          const snipRe = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
          const urls = [], titles = [], snippets = [];
          let m;
          while ((m = linkRe.exec(data)) !== null) {
            urls.push(m[1]);
            titles.push(m[2].replace(/<[^>]*>/g, '').trim());
          }
          while ((m = snipRe.exec(data)) !== null) {
            snippets.push(m[1].replace(/<[^>]*>/g, '').trim());
          }
          for (let i = 0; i < Math.min(urls.length, 20); i++) {
            if (urls[i] && !urls[i].includes('duckduckgo.com')) {
              out.push({
                title: titles[i] || '',
                url: urls[i],
                snippet: (snippets[i] || '').slice(0, 250),
                relevance: 100 - i,
                source: 'web'
              });
            }
          }
          resolve(out);
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.write(postData);
      req.end();
    });
    if (results.length > 0) return results;
  } catch {}

  return [];
});

ipcMain.handle('get-blocked-count', () => blockedCount);
ipcMain.handle('get-version',       () => app.getVersion());
ipcMain.handle('reset-blocked',     () => { blockedCount = 0; });

ipcMain.handle('clear-all-data', async () => {
  try {
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    blockedCount = 0;
    if (mainWindow) mainWindow.webContents.send('blocked-update', 0);
    return true;
  } catch { return false; }
});

ipcMain.handle('toggle-tor', async (_, enable) => {
  try {
    const ses = session.fromPartition(PARTITION);
    await ses.setProxy({ proxyRules: enable ? 'socks5://127.0.0.1:9050' : '' });
    return true;
  } catch { return false; }
});

ipcMain.handle('get-downloads', () => downloads);
ipcMain.on('open-download', (_, p) => shell.openPath(p));
ipcMain.on('show-download', (_, p) => shell.showItemInFolder(p));

ipcMain.handle('get-settings',     () => settings);
ipcMain.handle('save-settings',    (_, partial) => {
  settings = { ...settings, ...partial };
  saveJSON(settingsPath, settings);
  // Broadcast to every renderer (shell + every webview tab) so the chrome,
  // search.html homepage, and settings.html itself all re-skin live.
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('settings-changed', settings); } catch {}
    });
  } catch {}
  return true;
});
ipcMain.handle('get-speed-dial',   () => settings.speedDial || []);
ipcMain.handle('save-speed-dial',  (_, sd) => {
  settings.speedDial = sd;
  saveJSON(settingsPath, settings);
  return true;
});

ipcMain.handle('get-bookmarks',    () => bookmarks);
ipcMain.handle('add-bookmark',     (_, { title, url }) => { addBookmark(title, url); return bookmarks; });
ipcMain.handle('remove-bookmark',  (_, url) => { removeBookmark(url); return bookmarks; });

ipcMain.handle('get-pin-state',    () => ({ enabled: pinData.enabled, asked: pinData.asked }));
ipcMain.handle('set-pin',          (_, { pin, enabled }) => {
  pinData.pin = pin; pinData.enabled = enabled; pinData.asked = true;
  saveJSON(pinPath, pinData);
  return true;
});
ipcMain.handle('verify-pin',       (_, pin) => pinData.pin === pin);
ipcMain.handle('skip-pin-setup',   () => { pinData.asked = true; saveJSON(pinPath, pinData); return true; });

// Webview navigation requested from inside the inner page (search/settings).
// Forward to the shell so it can drive `<webview>.loadURL(...)`.
ipcMain.on('open-settings', () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'settings'); });
ipcMain.on('open-home',     () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'home'); });
ipcMain.on('open-newtab',   () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'newtab'); });

// Open a URL in a new browser tab (used by inner pages e.g. Support button).
ipcMain.on('open-newtab-url', (_, url) => {
  if (typeof url !== 'string' || !mainWindow) return;
  mainWindow.webContents.send('open-newtab-url', url);
});

// Open a URL in the user's default OS browser (used for Tawk.to support chat —
// Tawk's CSP blocks iframe/webview embeds, so we hand off to the OS).
ipcMain.on('open-external', (_, url) => {
  if (typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  try { shell.openExternal(url); } catch {}
});
ipcMain.on('open-url',      (_, url) => {
  if (mainWindow && typeof url === 'string') mainWindow.webContents.send('navigate-shell-url', url);
});

// =====================================================================
// Auto-updater
// =====================================================================
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'downloading', version: info.version });
});
autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'ready', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  if (mainWindow) mainWindow.webContents.send('update-status', { status: 'up-to-date' });
});
autoUpdater.on('error', (err) => {
  if (mainWindow) mainWindow.webContents.send('update-status', {
    status: 'error', message: err ? err.message : 'Unknown error'
  });
});

ipcMain.handle('check-update', async () => {
  try { await autoUpdater.checkForUpdates(); return { checking: true }; }
  catch { return { checking: false }; }
});
ipcMain.on('install-update', () => autoUpdater.quitAndInstall(false, true));

// =====================================================================
// Lifecycle
// =====================================================================
app.on('before-quit', async () => {
  if (settings.clearOnExit) {
    try {
      const ses = session.fromPartition(PARTITION);
      await ses.clearStorageData();
      await ses.clearCache();
    } catch {}
  }
});

app.whenReady().then(() => {
  createWindow();
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 3000);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
