const { app, BrowserWindow, BrowserView, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Load tracker blocklist
const trackerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tracker-list.json'), 'utf-8')
).trackers;

let mainWindow;
let browserView;
let blockedCount = 0;

// Privacy: disable hardware acceleration fingerprinting
app.commandLine.appendSwitch('disable-webgl');
app.commandLine.appendSwitch('disable-reading-from-canvas');
// Disable remote fonts fingerprinting
app.commandLine.appendSwitch('disable-remote-fonts');
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
      allowRunningInsecureContent: false,
      // Spoof a generic user agent
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    }
  });

  mainWindow.setBrowserView(browserView);

  // Position the BrowserView below the toolbar (48px)
  const updateBounds = () => {
    const bounds = mainWindow.getContentBounds();
    browserView.setBounds({ x: 0, y: 48, width: bounds.width, height: bounds.height - 48 });
  };
  updateBounds();
  mainWindow.on('resize', updateBounds);

  // Load the search engine as homepage
  browserView.webContents.loadFile('search.html');

  // --- PRIVACY: Block trackers & ads at network level ---
  const ses = browserView.webContents.session;

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

  // Block third-party cookies
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};

    // Remove tracking headers
    delete headers['set-cookie'];
    delete headers['Set-Cookie'];

    // Add security headers
    headers['X-Content-Type-Options'] = ['nosniff'];
    headers['X-Frame-Options'] = ['SAMEORIGIN'];

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

  // Forward navigation events to the UI
  browserView.webContents.on('did-navigate', (_, url) => {
    mainWindow.webContents.send('url-changed', url);
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

  // Open new-window requests in the same view instead of spawning popups
  browserView.webContents.setWindowOpenHandler(({ url }) => {
    browserView.webContents.loadURL(url);
    return { action: 'deny' };
  });

  // Clear all browsing data on window close
  mainWindow.on('close', async () => {
    try {
      await ses.clearStorageData();
      await ses.clearCache();
      await ses.clearAuthCache();
    } catch {}
  });
}

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
