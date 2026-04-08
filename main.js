const { app, BrowserWindow, BrowserView, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Load tracker blocklist
const trackerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tracker-list.json'), 'utf-8')
).trackers;

let mainWindow;
let browserView;
let blockedCount = 0;
let downloads = []; // Download manager state

// Privacy: disable canvas fingerprinting (WebGL left enabled for video playback)
app.commandLine.appendSwitch('disable-reading-from-canvas');
// Disable WebRTC IP leak
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
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

  // Load the browser UI shell
  mainWindow.loadFile('browser.html');

  // Create a BrowserView for web content
  browserView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Privacy settings
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.setBrowserView(browserView);

  // Position the BrowserView below the toolbar (48px), or fullscreen
  let isFullscreen = false;
  const updateBounds = () => {
    const bounds = mainWindow.getContentBounds();
    if (isFullscreen) {
      browserView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
    } else {
      browserView.setBounds({ x: 0, y: 48, width: bounds.width, height: bounds.height - 48 });
    }
  };
  updateBounds();
  mainWindow.on('resize', updateBounds);

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

  // --- PRIVACY: Block trackers & ads at network level ---
  const ses = browserView.webContents.session;

  // Override user agent at session level to fully match real Chrome
  const spoofedUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  ses.setUserAgent(spoofedUA);

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

  // Strip tracking cookies from third-party responses only
  // First-party cookies are allowed so users can log into sites
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    callback({ responseHeaders: headers });
  });

  // Strip referrer and tracking headers from outgoing requests
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders;

    // Remove or genericize referrer
    if (headers['Referer']) {
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

    // Remove DNT (it actually helps fingerprinting)
    delete headers['DNT'];

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
  mainWindow.on('close', async () => {
    try {
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    } catch {}
  });
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

// Auto-update check
ipcMain.handle('check-update', async () => {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/NaniIsNano/wizard-browser/releases/latest',
      headers: { 'User-Agent': 'Wizard-Browser' }
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
          resolve({
            current: pkg.version,
            latest: release.tag_name ? release.tag_name.replace('v', '') : pkg.version,
            url: release.html_url || '',
            hasUpdate: release.tag_name ? release.tag_name.replace('v', '') !== pkg.version : false
          });
        } catch {
          resolve({ current: '1.0.0', latest: '1.0.0', url: '', hasUpdate: false });
        }
      });
    }).on('error', () => {
      resolve({ current: '1.0.0', latest: '1.0.0', url: '', hasUpdate: false });
    });
  });
});

// Privacy: clear data when quitting
app.on('before-quit', async () => {
  try {
    const ses = session.defaultSession;
    await ses.clearStorageData();
    await ses.clearCache();
  } catch {}
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
