const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { autoUpdater } = require('electron-updater');

// Load tracker blocklist
const trackerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tracker-list.json'), 'utf-8')
).trackers;

let mainWindow;
let browserView;
let blockedCount = 0;
let downloads = []; // Download manager state

// --- Settings persistence ---
const settingsPath = path.join(app.getPath('userData'), 'wizard-settings.json');
const bookmarksPath = path.join(app.getPath('userData'), 'wizard-bookmarks.json');
const pinPath = path.join(app.getPath('userData'), 'wizard-pin.json');

function loadJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch { return fallback; }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

let settings = loadJSON(settingsPath, {
  theme: 'dark',
  doNotTrack: true,
  canvasSpoofing: true,
  webrtcProtection: true,
  referrerStripping: true,
  trackerBlocking: true,
  clearOnExit: true,
  speedDial: [
    { name: 'YouTube', url: 'https://youtube.com', icon: 'Y' },
    { name: 'GitHub', url: 'https://github.com', icon: 'G' },
    { name: 'Reddit', url: 'https://reddit.com', icon: 'R' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', icon: 'W' }
  ]
});

let bookmarks = loadJSON(bookmarksPath, []);
let pinData = loadJSON(pinPath, { enabled: false, pin: null, asked: false });

// Privacy: disable canvas fingerprinting (WebGL left enabled for video playback)
if (settings.canvasSpoofing) {
  app.commandLine.appendSwitch('disable-reading-from-canvas');
}
// Disable WebRTC IP leak
if (settings.webrtcProtection) {
  app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
}
// Disable background networking
app.commandLine.appendSwitch('disable-background-networking');
// Disable various Chrome features that phone home
app.commandLine.appendSwitch('disable-client-side-phishing-detection');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');

// Known .onion alternatives
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
  'www.propublica.org': 'https://p53lf57qovyuvwsc6xnrppyply3vtqm7l6pcobkmyqsiofyeznfu5uqd.onion',
  'archive.org': 'https://archiveiya74codqgiixo33q62qlrqtkgmcitqx5u2oeqnmber5c2lmaid.onion',
  'searx.be': 'http://searxspbitokayvkhzhsnljde7rqmn7rvoga6e4oyez3o4h2v6zqd.onion'
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Wizard Browser',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Remove the default menu bar entirely
  Menu.setApplicationMenu(null);

  // Load the browser UI shell
  mainWindow.loadFile('browser.html');

  // Create a WebContentsView for web content (replaces deprecated BrowserView)
  browserView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-search.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Privacy settings
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.contentView.addChildView(browserView);

  // Position the BrowserView below the toolbar (48px), or fullscreen
  let isFullscreen = false;
  const TOOLBAR_HEIGHT = 48;
  const updateBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const [w, h] = mainWindow.getContentSize();
    // Both getContentSize and setBounds use DIPs — no scaling needed
    const bvBounds = isFullscreen
      ? { x: 0, y: 0, width: w, height: h }
      : { x: 0, y: TOOLBAR_HEIGHT, width: w, height: h - TOOLBAR_HEIGHT };
    browserView.setBounds(bvBounds);
  };
  updateBounds();
  mainWindow.on('resize', updateBounds);
  mainWindow.on('show', updateBounds);
  mainWindow.on('maximize', updateBounds);
  mainWindow.on('unmaximize', updateBounds);
  mainWindow.on('restore', updateBounds);
  mainWindow.webContents.on('did-finish-load', updateBounds);
  browserView.webContents.on('did-finish-load', updateBounds);

  // Handle HTML5 fullscreen (e.g. YouTube video player)
  browserView.webContents.on('enter-html-full-screen', () => {
    isFullscreen = true;
    mainWindow.setFullScreen(true);
    updateBounds();
  });
  browserView.webContents.on('leave-html-full-screen', () => {
    isFullscreen = false;
    mainWindow.setFullScreen(false);
    updateBounds();
  });

  // --- ANTI-BOT: Hide Electron/automation signals before any page loads ---
  browserView.webContents.on('dom-ready', () => {
    browserView.webContents.executeJavaScript(`
      // Hide navigator.webdriver (Electron sets this to true)
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      // Ensure plugins array looks normal (empty in headless = bot signal)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });
      // Ensure languages look normal
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
      // Chrome runtime stub (missing in Electron = bot signal)
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) window.chrome.runtime = {};
    `, true).catch(() => {});
  });

  // --- PRIVACY: Block trackers & ads at network level ---
  const ses = browserView.webContents.session;

  // Override user agent at session level — use a current, realistic Chrome UA
  // Derive the real Chromium version from Electron's UA so headers stay consistent
  const realUA = ses.getUserAgent();
  const chromiumMatch = realUA.match(/Chrome\/([\d.]+)/);
  const chromiumVer = chromiumMatch ? chromiumMatch[1] : '134.0.0.0';
  const majorVer = chromiumVer.split('.')[0];
  // Build a UA that looks like stock Chrome but keeps the real Chromium version
  const spoofedUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVer} Safari/537.36`;
  ses.setUserAgent(spoofedUA);

  // Tracker blocking
  if (settings.trackerBlocking) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url.toLowerCase();
      const blocked = trackerList.some(tracker => url.includes(tracker));
      if (blocked) {
        blockedCount++;
        mainWindow.webContents.send('blocked-update', blockedCount);
        callback({ cancel: true });
      } else {
        callback({});
      }
    });
  }

  // Strip tracking cookies from third-party responses only
  // First-party cookies are allowed so users can log into sites
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    callback({ responseHeaders: headers });
  });

  // Strip referrer and tracking headers from outgoing requests
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;

    // Referrer stripping
    if (settings.referrerStripping && headers['Referer']) {
      try {
        const refUrl = new URL(headers['Referer']);
        const reqUrl = new URL(details.url);
        // Only send referrer to same origin
        if (refUrl.origin !== reqUrl.origin) {
          delete headers['Referer'];
        }
      } catch {
        delete headers['Referer'];
      }
    }

    // DNT header — send if user opted in, otherwise remove (sending DNT=1 actually helps fingerprinting when few do it)
    if (settings.doNotTrack) {
      headers['DNT'] = '1';
      headers['Sec-GPC'] = '1'; // Global Privacy Control
    } else {
      delete headers['DNT'];
    }

    // Set Accept-Language to a common value to reduce fingerprinting
    headers['Accept-Language'] = 'en-US,en;q=0.9';

    // Set Sec-CH-UA headers to match spoofed UA (use real Chromium version)
    // Must include "Google Chrome" brand — omitting it is a bot fingerprint
    headers['Sec-CH-UA'] = `"Chromium";v="${majorVer}", "Google Chrome";v="${majorVer}", "Not_A Brand";v="24"`;
    headers['Sec-CH-UA-Mobile'] = '?0';
    headers['Sec-CH-UA-Platform'] = '"Windows"';
    headers['Sec-CH-UA-Full-Version-List'] = `"Chromium";v="${chromiumVer}", "Google Chrome";v="${chromiumVer}", "Not_A Brand";v="24.0.0.0"`;

    // Ensure Sec-Fetch headers are present (Akamai checks these)
    if (!headers['Sec-Fetch-Site']) headers['Sec-Fetch-Site'] = 'none';
    if (!headers['Sec-Fetch-Mode']) headers['Sec-Fetch-Mode'] = 'navigate';
    if (!headers['Sec-Fetch-User']) headers['Sec-Fetch-User'] = '?1';
    if (!headers['Sec-Fetch-Dest']) headers['Sec-Fetch-Dest'] = 'document';

    callback({ requestHeaders: headers });
  });

  // Block dialog spam (alert/confirm/prompt) — auto-dismiss after 1st dialog per page
  let dialogCount = 0;
  browserView.webContents.on('did-navigate', () => { dialogCount = 0; });
  browserView.webContents.on('did-navigate-in-page', () => { dialogCount = 0; });

  // Forward navigation events to the UI
  browserView.webContents.on('did-navigate', (_, url) => {
    mainWindow.webContents.send('url-changed', url);
    // Check for .onion alternative
    checkOnionAvailable(url);
  });
  browserView.webContents.on('did-navigate-in-page', (_, url) => {
    mainWindow.webContents.send('url-changed', url);
  });
  browserView.webContents.on('page-title-updated', (_, title) => {
    mainWindow.webContents.send('title-changed', title);
    mainWindow.setTitle(`${title} - Wizard Browser`);
  });
  browserView.webContents.on('did-start-loading', () => {
    mainWindow.webContents.send('loading-changed', true);
  });
  browserView.webContents.on('did-stop-loading', () => {
    mainWindow.webContents.send('loading-changed', false);
  });

  // Block dialog spam from malicious sites
  browserView.webContents.on('will-prevent-unload', (event) => {
    // Always allow leaving the page (blocks "are you sure you want to leave?" traps)
    event.preventDefault();
  });

  // Open new-window requests in the same view instead of spawning popups
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    browserView.webContents.loadURL(url);
    return { action: 'deny' };
  });

  // --- Right-click Context Menu ---
  browserView.webContents.on('context-menu', (event, params) => {
    const menuTemplate = [];

    // Navigation
    if (browserView.webContents.canGoBack()) {
      menuTemplate.push({ label: 'Back', click: () => browserView.webContents.goBack() });
    }
    if (browserView.webContents.canGoForward()) {
      menuTemplate.push({ label: 'Forward', click: () => browserView.webContents.goForward() });
    }
    menuTemplate.push({ label: 'Reload', click: () => browserView.webContents.reload() });
    menuTemplate.push({ type: 'separator' });

    // Text selection actions
    if (params.selectionText) {
      menuTemplate.push({
        label: 'Copy',
        click: () => browserView.webContents.copy()
      });
      menuTemplate.push({
        label: `Search Wizard for "${params.selectionText.slice(0, 30)}${params.selectionText.length > 30 ? '...' : ''}"`,
        click: () => {
          const searchFileUrl = `file://${path.join(__dirname, 'search.html').replace(/\\/g, '/')}`;
          browserView.webContents.loadURL(searchFileUrl).then(() => {
            browserView.webContents.executeJavaScript(
              `document.getElementById('searchbar').value = ${JSON.stringify(params.selectionText)}; search(${JSON.stringify(params.selectionText)});`
            );
          });
        }
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Editable field actions
    if (params.isEditable) {
      menuTemplate.push({ label: 'Cut', click: () => browserView.webContents.cut() });
      menuTemplate.push({ label: 'Copy', click: () => browserView.webContents.copy() });
      menuTemplate.push({ label: 'Paste', click: () => browserView.webContents.paste() });
      menuTemplate.push({ label: 'Select All', click: () => browserView.webContents.selectAll() });
      menuTemplate.push({ type: 'separator' });
    }

    // Link actions
    if (params.linkURL) {
      menuTemplate.push({
        label: 'Copy Link Address',
        click: () => clipboard.writeText(params.linkURL)
      });
      menuTemplate.push({
        label: 'Bookmark This Link',
        click: () => {
          const title = params.linkText || params.linkURL;
          addBookmark(title, params.linkURL);
          mainWindow.webContents.send('bookmark-added', { title, url: params.linkURL });
        }
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Image actions
    if (params.hasImageContents) {
      menuTemplate.push({
        label: 'Copy Image',
        click: () => browserView.webContents.copyImageAt(params.x, params.y)
      });
      menuTemplate.push({
        label: 'Copy Image Address',
        click: () => clipboard.writeText(params.srcURL)
      });
      menuTemplate.push({ type: 'separator' });
    }

    // Bookmark current page
    menuTemplate.push({
      label: 'Bookmark This Page',
      click: () => {
        const title = params.titleText || browserView.webContents.getTitle();
        const url = browserView.webContents.getURL();
        addBookmark(title, url);
        mainWindow.webContents.send('bookmark-added', { title, url });
      }
    });

    menuTemplate.push({ type: 'separator' });

    // View source
    menuTemplate.push({
      label: 'View Page Source',
      click: () => {
        const url = browserView.webContents.getURL();
        browserView.webContents.loadURL('view-source:' + url);
      }
    });

    // Inspect Element
    menuTemplate.push({
      label: 'Inspect Element',
      click: () => {
        browserView.webContents.inspectElement(params.x, params.y);
      }
    });

    const contextMenu = Menu.buildFromTemplate(menuTemplate);
    contextMenu.popup({ window: mainWindow });
  });

  // --- Download Manager ---
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
    mainWindow.webContents.send('download-started', dl);

    item.on('updated', (_, state) => {
      dl.receivedBytes = item.getReceivedBytes();
      dl.totalBytes = item.getTotalBytes();
      dl.state = state;
      dl.path = item.getSavePath();
      mainWindow.webContents.send('download-updated', dl);
    });

    item.once('done', (_, state) => {
      dl.state = state;
      dl.path = item.getSavePath();
      dl.receivedBytes = dl.totalBytes;
      mainWindow.webContents.send('download-done', dl);
    });
  });

  // Load the search engine as homepage
  browserView.webContents.loadFile('search.html');

  // Clear all browsing data on window close
  if (settings.clearOnExit) {
    mainWindow.on('close', async () => {
      try {
        await ses.clearStorageData();
        await ses.clearCache();
        await ses.clearAuthCache();
      } catch {}
    });
  }
}

// --- Bookmarks ---
function addBookmark(title, url) {
  // Avoid duplicates
  if (bookmarks.some(b => b.url === url)) return;
  bookmarks.push({ title, url, date: Date.now() });
  saveJSON(bookmarksPath, bookmarks);
}

function removeBookmark(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  saveJSON(bookmarksPath, bookmarks);
}

// Check if an .onion version of the current site exists
function checkOnionAvailable(url) {
  try {
    const hostname = new URL(url).hostname;
    if (onionMap[hostname]) {
      mainWindow.webContents.send('onion-available', {
        clearnet: hostname,
        onion: onionMap[hostname]
      });
    }
  } catch {}
}

// --- Server-side search (no CORS issues) ---
ipcMain.handle('server-search', async (_, term) => {
  const http = require('https');

  // Try SearXNG from server side (no CORS)
  const searxInstances = [
    'https://searx.be',
    'https://priv.au',
    'https://baresearch.org',
    'https://opnxng.com',
    'https://paulgo.io',
    'https://etsi.me',
    'https://search.ononoki.org',
    'https://northboot.xyz',
    'https://s.mble.dk'
  ];

  // Shuffle and try instances
  const shuffled = searxInstances.sort(() => Math.random() - 0.5);

  for (const instance of shuffled) {
    try {
      const results = await new Promise((resolve, reject) => {
        const url = `${instance}/search?q=${encodeURIComponent(term)}&format=json&categories=general`;
        const req = http.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0' } }, (res) => {
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

  // Fallback: DuckDuckGo lite (HTML scraping, always works)
  try {
    const results = await new Promise((resolve, reject) => {
      const postData = `q=${encodeURIComponent(term)}`;
      const options = {
        hostname: 'lite.duckduckgo.com',
        path: '/lite/',
        method: 'POST',
        timeout: 6000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'
        }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const results = [];
          // Parse DDG lite HTML results
          const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]*)<\/a>/gi;
          const snippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;
          let match;
          const urls = [];
          const titles = [];
          while ((match = linkRegex.exec(data)) !== null) {
            urls.push(match[1]);
            titles.push(match[2].replace(/<[^>]*>/g, '').trim());
          }
          const snippets = [];
          while ((match = snippetRegex.exec(data)) !== null) {
            snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
          }
          for (let i = 0; i < Math.min(urls.length, 20); i++) {
            if (urls[i] && !urls[i].includes('duckduckgo.com')) {
              results.push({
                title: titles[i] || '',
                url: urls[i],
                snippet: (snippets[i] || '').slice(0, 250),
                relevance: 100 - i,
                source: 'web'
              });
            }
          }
          resolve(results);
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

// --- IPC Handlers ---
ipcMain.on('navigate', (_, url) => {
  if (!browserView) return;
  let target = url.trim();
  // If it looks like a URL, go directly
  if (/^https?:\/\//i.test(target)) {
    browserView.webContents.loadURL(target);
  } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(target) && !target.includes(' ')) {
    browserView.webContents.loadURL('https://' + target);
  } else {
    // Otherwise, load search.html and trigger a search
    const searchFileUrl = `file://${path.join(__dirname, 'search.html').replace(/\\/g, '/')}`;
    browserView.webContents.loadURL(searchFileUrl).then(() => {
      browserView.webContents.executeJavaScript(
        `document.getElementById('searchbar').value = ${JSON.stringify(target)}; search(${JSON.stringify(target)});`
      );
    });
  }
});

ipcMain.on('go-back', () => {
  if (browserView && browserView.webContents.canGoBack()) {
    browserView.webContents.goBack();
  }
});

ipcMain.on('go-forward', () => {
  if (browserView && browserView.webContents.canGoForward()) {
    browserView.webContents.goForward();
  }
});

ipcMain.on('reload-page', () => {
  if (browserView) browserView.webContents.reload();
});

ipcMain.on('go-home', () => {
  if (browserView) browserView.webContents.loadFile('search.html');
});

ipcMain.handle('get-blocked-count', () => blockedCount);
ipcMain.handle('get-version', () => app.getVersion());

// Debug info for troubleshooting toolbar/layout issues
ipcMain.handle('get-debug-info', () => {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const info = {
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    primaryDisplay: {
      scaleFactor: primaryDisplay.scaleFactor,
      size: primaryDisplay.size,
      workAreaSize: primaryDisplay.workAreaSize,
      rotation: primaryDisplay.rotation,
    },
    window: null,
    browserView: null,
    toolbarHeight: 48,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    info.window = {
      bounds: mainWindow.getBounds(),
      contentBounds: mainWindow.getContentBounds(),
      contentSize: mainWindow.getContentSize(),
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  }
  if (browserView) {
    info.browserView = {
      bounds: browserView.getBounds(),
    };
  }
  return info;
});

ipcMain.handle('clear-all-data', async () => {
  if (!browserView) return;
  const ses = browserView.webContents.session;
  await ses.clearStorageData();
  await ses.clearCache();
  await ses.clearAuthCache();
  blockedCount = 0;
  mainWindow.webContents.send('blocked-update', 0);
  return true;
});

// Tor proxy toggle (SOCKS5 on 127.0.0.1:9050)
ipcMain.handle('toggle-tor', async (_, enable) => {
  if (!browserView) return false;
  const ses = browserView.webContents.session;
  try {
    if (enable) {
      await ses.setProxy({ proxyRules: 'socks5://127.0.0.1:9050' });
    } else {
      await ses.setProxy({ proxyRules: '' });
    }
    return true;
  } catch {
    return false;
  }
});

// Navigate to .onion version
ipcMain.on('navigate-onion', (_, onionUrl) => {
  if (browserView) browserView.webContents.loadURL(onionUrl);
});

// Download manager: open file
ipcMain.on('open-download', (_, filePath) => {
  const { shell } = require('electron');
  shell.openPath(filePath);
});

// Download manager: show in folder
ipcMain.on('show-download', (_, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

// Download manager: get all downloads
ipcMain.handle('get-downloads', () => downloads);

// --- Settings IPC ---
ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (_, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveJSON(settingsPath, settings);
  return true;
});

ipcMain.handle('get-speed-dial', () => settings.speedDial);

ipcMain.handle('save-speed-dial', (_, speedDial) => {
  settings.speedDial = speedDial;
  saveJSON(settingsPath, settings);
  return true;
});

// --- Bookmarks IPC ---
ipcMain.handle('get-bookmarks', () => bookmarks);

ipcMain.handle('add-bookmark', (_, { title, url }) => {
  addBookmark(title, url);
  return bookmarks;
});

ipcMain.handle('remove-bookmark', (_, url) => {
  removeBookmark(url);
  return bookmarks;
});

ipcMain.on('open-bookmark', (_, url) => {
  if (browserView) {
    if (/^https?:\/\//i.test(url)) {
      browserView.webContents.loadURL(url);
    } else {
      browserView.webContents.loadURL('https://' + url);
    }
  }
});

// --- PIN Lock IPC ---
ipcMain.handle('get-pin-state', () => ({
  enabled: pinData.enabled,
  asked: pinData.asked
}));

ipcMain.handle('set-pin', (_, { pin, enabled }) => {
  pinData.pin = pin;
  pinData.enabled = enabled;
  pinData.asked = true;
  saveJSON(pinPath, pinData);
  return true;
});

ipcMain.handle('verify-pin', (_, pin) => {
  return pinData.pin === pin;
});

ipcMain.handle('skip-pin-setup', () => {
  pinData.asked = true;
  saveJSON(pinPath, pinData);
  return true;
});

// --- Settings page navigation ---
ipcMain.on('open-settings', () => {
  if (browserView) {
    browserView.webContents.loadFile('settings.html');
  }
});

// --- IRC page navigation ---
ipcMain.on('open-irc', () => {
  if (browserView) {
    browserView.webContents.loadFile('irc.html');
  }
});

// --- Auto-updater (electron-updater) ---
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'downloading',
      version: info.version
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'ready',
      version: info.version
    });
  }
});

autoUpdater.on('update-not-available', () => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'up-to-date' });
  }
});

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('update-status', {
      status: 'error',
      message: err ? err.message : 'Unknown error'
    });
  }
});

// Manual check + install trigger from UI
ipcMain.handle('check-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { checking: true };
  } catch {
    return { checking: false };
  }
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

// Privacy: clear data when quitting
app.on('before-quit', async () => {
  if (settings.clearOnExit) {
    try {
      const ses = session.defaultSession;
      await ses.clearStorageData();
      await ses.clearCache();
    } catch {}
  }
});

app.whenReady().then(() => {
  createWindow();
  // Check for updates after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 3000);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();

});
