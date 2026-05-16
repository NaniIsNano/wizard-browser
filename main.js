const { app, BrowserWindow, ipcMain, session, Menu, clipboard, shell, webContents, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { SUPABASE_URL, SUPABASE_ANON } = require('./config');

// Built-in adblocker (uBO / EasyList / EasyPrivacy / Peter Lowe's filter
// engine) — same matching engine that powers Ghostery, used by many
// Electron apps. We keep the static trackerList around as a fallback for
// the first launch when the network isn't available.
let ElectronBlocker, fetchFn;
try {
  ElectronBlocker = require('@ghostery/adblocker-electron').ElectronBlocker;
  fetchFn = require('cross-fetch').fetch;
} catch (e) {
  console.warn('[adblocker] package not available, falling back to static blocklist:', e.message);
}

const trackerList = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'tracker-list.json'), 'utf-8')
).trackers;

const PARTITION = 'persist:wizard';

let mainWindow;
let blockedCount = 0;
let downloads = [];

// Ring buffer of recently blocked requests — populated from the Ghostery
// engine's request-blocked event AND from session-level onErrorOccurred
// (catches ERR_BLOCKED_BY_CLIENT from uBO/extensions). Read by the
// Wizard-native uBO dashboard for the live "recent blocks" log.
const RECENT_BLOCKS_MAX = 200;
let recentBlocks = [];   // [{ url, host, ts, source }] — newest first

function pushRecentBlock(url, source) {
  if (typeof url !== 'string' || !url) return;
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  // Suppress duplicate hits from the same URL within 250ms (chromium fires
  // both onBeforeRequest+onErrorOccurred for some cancelled requests)
  const head = recentBlocks[0];
  if (head && head.url === url && (Date.now() - head.ts) < 250) return;
  const entry = { url: url.slice(0, 500), host, ts: Date.now(), source: source || 'unknown' };
  recentBlocks.unshift(entry);
  if (recentBlocks.length > RECENT_BLOCKS_MAX) recentBlocks.length = RECENT_BLOCKS_MAX;
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('recent-block', entry); } catch {}
    });
  } catch {}
}

// Adblocker state — populated by initAdblocker() after Electron is ready
let adblockerEngine = null;
let adblockerReady = false;
let adblockerStatus = {
  enabled: false,
  ready: false,
  source: 'static',     // 'static' | 'cache' | 'network'
  lastUpdated: null,    // ms epoch when filter lists were fetched
  totalFilters: 0,
  message: null
};

// --- Persisted state ---
const settingsPath  = path.join(app.getPath('userData'), 'wizard-settings.json');
const bookmarksPath = path.join(app.getPath('userData'), 'wizard-bookmarks.json');
const pinPath       = path.join(app.getPath('userData'), 'wizard-pin.json');
const siteSettingsPath = path.join(app.getPath('userData'), 'wizard-site-settings.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function saveJSON(p, data) {
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

let settings = loadJSON(settingsPath, {
  // Appearance v4 — Chrome-style: theme (color scheme) and background are
  // independent axes. You can pair any color scheme with any background.
  layout: 'default',             // 'default' | 'win7'
  theme: 'default',              // color scheme: 'default' | 'frutiger' | 'canola' | 'mountains' | 'fortress' | 'retrowave' | 'rose' | 'emerald' | 'sunset' | 'monochrome'
  background: 'none',            // 'none' | 'frutiger' | 'canola' | 'mountains' | 'fortress' | 'custom'
  customBg: '',                  // data URL — used when background === 'custom'
  sharpEdges: false,             // applies to every layout/theme
  glossyUI: false,               // applies to every layout/theme
  // Legacy keys (kept for migration; ignored once layout/theme/background set)
  themeMode: 'default',
  aeroBackground: 'fruiter',
  doNotTrack: true,
  canvasSpoofing: true,
  webrtcProtection: true,
  referrerStripping: true,
  trackerBlocking: true,
  clearOnExit: true,
  autoUpdate: true,              // user can opt out from Settings → Updates
  speedDial: [
    { name: 'YouTube',   url: 'https://youtube.com',   icon: 'Y' },
    { name: 'GitHub',    url: 'https://github.com',    icon: 'G' },
    { name: 'Reddit',    url: 'https://reddit.com',    icon: 'R' },
    { name: 'Wikipedia', url: 'https://wikipedia.org', icon: 'W' }
  ]
});

// Migrate older settings shapes onto the new (theme, background) split.
(function migrateAppearance() {
  // Stage 1: themeMode/aeroBackground → unified `theme`
  if (!settings.theme || settings.theme === 'default-needs-migration') {
    const tm = settings.themeMode || 'default';
    const ab = settings.aeroBackground || 'fruiter';
    if (tm === 'aero')           settings.theme = ab === 'fruiter' ? 'frutiger' : ab;
    else if (tm === 'retrowave') settings.theme = 'retrowave';
    else                         settings.theme = 'default';
  }
  settings.layout = settings.layout || 'default';

  // Stage 2: split combined `theme` into (color scheme, background) IF
  // `background` hasn't been set yet (i.e. user hasn't seen the new picker).
  if (settings.background == null) {
    const t = settings.theme;
    if (t === 'frutiger' || t === 'canola' || t === 'mountains' || t === 'fortress') {
      // Old combined: keep colour scheme matching the theme + same-name bg
      settings.background = t;
    } else if (t === 'custom') {
      // Old "custom" theme had no real colour palette (neutral gray) — move
      // it to the default scheme over the user's image.
      settings.background = 'custom';
      settings.theme = 'default';
    } else {
      settings.background = 'none';
    }
  }
  saveJSON(settingsPath, settings);
})();
let bookmarks = loadJSON(bookmarksPath, []);
let pinData   = loadJSON(pinPath, { enabled: false, pin: null, asked: false });

// --- Per-site settings (the padlock) ---
// { "<origin>": { javascript:'on'|'off', geolocation:'allow'|'block',
//                 media:'allow'|'block', notifications:'allow'|'block' } }
// Privacy-first defaults: JS on (don't break the web by default), but
// camera / mic / location / notifications are blocked until the user
// flips them from the padlock.
let siteSettings = loadJSON(siteSettingsPath, {});
const SITE_DEFAULTS = { javascript: 'on', geolocation: 'block', media: 'block', notifications: 'block' };

function originOf(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null; // internal pages have no site settings
    return url.origin;
  } catch { return null; }
}
function siteSettingsFor(origin) {
  if (!origin) return { ...SITE_DEFAULTS };
  return { ...SITE_DEFAULTS, ...(siteSettings[origin] || {}) };
}
function isJsDisabled(url) {
  const o = originOf(url);
  if (!o) return false;
  return (siteSettings[o] && siteSettings[o].javascript) === 'off';
}
function broadcastSiteSettings(origin) {
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('site-settings-changed', { origin, settings: siteSettingsFor(origin) }); } catch {}
    });
  } catch {}
}

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

  // The Ghostery/uBO blocker is enabled async after boot via
  // initAdblocker(). Until it's ready (or if it never loads — e.g. first
  // launch with no network), fall back to the static trackerList.
  if (settings.trackerBlocking) {
    ses.webRequest.onBeforeRequest((details, callback) => {
      // If the Ghostery engine has been installed it will have hooked the
      // session itself; this static check only fires when the engine isn't
      // up yet (first boot, offline, disabled).
      if (adblockerReady) { callback({}); return; }
      const url = details.url.toLowerCase();
      if (trackerList.some(t => url.includes(t))) {
        blockedCount++;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('blocked-update', blockedCount);
        }
        pushRecentBlock(details.url, 'static');
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  }

  // Catch blocks from whatever engine is in front of us (Ghostery or uBO).
  // When uBO is active it owns onBeforeRequest, so this is the only way to
  // see what it cancels at the session level. ERR_BLOCKED_BY_CLIENT is the
  // Chromium error code for "an extension cancelled this request".
  ses.webRequest.onErrorOccurred((details) => {
    if (!details || !details.error) return;
    const err = details.error;
    if (err === 'net::ERR_BLOCKED_BY_CLIENT'
     || err === 'net::ERR_BLOCKED_BY_RESPONSE'
     || err === 'net::ERR_BLOCKED_BY_ADMINISTRATOR') {
      // Source label: prefer the active engine if known
      const src = (uboState && uboState.state === 'active') ? 'ublock-origin'
                : adblockerReady ? 'ghostery'
                : 'static';
      pushRecentBlock(details.url, src);
    }
  });

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

  // --- Per-site JavaScript (the padlock toggle) ---
  // When a site's JS is set to 'off', append a strict CSP to its document
  // responses so inline + external scripts can't run. Appending an extra
  // CSP header is safe — browsers enforce the intersection of all CSP
  // headers, so we only ever tighten, never weaken, a site's own policy.
  ses.webRequest.onHeadersReceived((details, callback) => {
    try {
      const rt = details.resourceType;
      if ((rt === 'mainFrame' || rt === 'subFrame') && isJsDisabled(details.url)) {
        const h = details.responseHeaders || {};
        // Drop any existing CSP keys (any casing) then set our own.
        for (const k of Object.keys(h)) {
          if (k.toLowerCase() === 'content-security-policy') delete h[k];
        }
        h['Content-Security-Policy'] = ["script-src 'none'; script-src-elem 'none'; script-src-attr 'none'"];
        callback({ responseHeaders: h });
        return;
      }
    } catch {}
    callback({});
  });

  // --- Per-site permissions (the padlock) ---
  // Map Chromium permission strings onto the three user-facing buckets.
  // Anything sensitive that isn't user-exposed is hard-denied; benign
  // UX permissions (fullscreen, pointer lock, sanitized clipboard write)
  // keep working.
  const PERM_MAP = {
    geolocation: 'geolocation',
    notifications: 'notifications',
    media: 'media', mediaKeySystem: 'media',
    audioCapture: 'media', videoCapture: 'media'
  };
  const HARD_DENY = new Set([
    'hid', 'serial', 'usb', 'bluetooth', 'midiSysex',
    'idle-detection', 'clipboard-read', 'window-management',
    'local-fonts', 'storage-access', 'speaker-selection'
  ]);
  function permVerdict(permission, requestUrl) {
    const key = PERM_MAP[permission];
    if (key) {
      const o = originOf(requestUrl);
      return siteSettingsFor(o)[key] === 'allow';
    }
    if (HARD_DENY.has(permission)) return false;
    return true; // fullscreen, pointerLock, clipboard-sanitized-write, etc.
  }
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const reqUrl = (details && (details.requestingUrl || details.url))
      || (wc && !wc.isDestroyed() && wc.getURL()) || '';
    callback(permVerdict(permission, reqUrl));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const reqUrl = requestingOrigin
      || (details && details.requestingUrl)
      || (wc && !wc.isDestroyed() && wc.getURL()) || '';
    return permVerdict(permission, reqUrl);
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

// =====================================================================
// Adblocker — Ghostery / uBO filter engine on the content session
// =====================================================================
const ADBLOCK_CACHE_DIR  = path.join(app.getPath('userData'), 'adblocker');
const ADBLOCK_CACHE_FILE = path.join(ADBLOCK_CACHE_DIR, 'engine.bin');
const ADBLOCK_META_FILE  = path.join(ADBLOCK_CACHE_DIR, 'engine.meta.json');
const ADBLOCK_TTL_MS     = 7 * 24 * 60 * 60 * 1000; // refresh after 7 days

function broadcastAdblockerStatus() {
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('adblocker-status', adblockerStatus); } catch {}
    });
  } catch {}
}

function persistAdblockerCache(engine) {
  try {
    fs.mkdirSync(ADBLOCK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(ADBLOCK_CACHE_FILE, Buffer.from(engine.serialize()));
    fs.writeFileSync(ADBLOCK_META_FILE, JSON.stringify({
      lastUpdated: Date.now(),
      version: 1
    }, null, 2));
  } catch (e) {
    console.warn('[adblocker] cache write failed:', e.message);
  }
}

function readAdblockerCache() {
  try {
    if (!fs.existsSync(ADBLOCK_CACHE_FILE) || !fs.existsSync(ADBLOCK_META_FILE)) return null;
    const meta = JSON.parse(fs.readFileSync(ADBLOCK_META_FILE, 'utf-8'));
    if (typeof meta.lastUpdated !== 'number') return null;
    const buf = fs.readFileSync(ADBLOCK_CACHE_FILE);
    return { meta, buf };
  } catch { return null; }
}

async function initAdblocker({ forceRefresh = false } = {}) {
  if (!ElectronBlocker || !fetchFn) {
    adblockerStatus = { ...adblockerStatus, enabled: false, ready: false, source: 'static',
      message: 'Adblocker package not installed; using static blocklist.' };
    broadcastAdblockerStatus();
    return;
  }
  if (settings.trackerBlocking === false) {
    adblockerStatus = { ...adblockerStatus, enabled: false, ready: false,
      message: 'Tracker blocking is off in Settings.' };
    broadcastAdblockerStatus();
    return;
  }

  const ses = session.fromPartition(PARTITION);
  let engine = null;
  let source = 'cache';

  // Try disk cache first (fast path) unless caller asked for a refresh
  if (!forceRefresh) {
    const cached = readAdblockerCache();
    if (cached && (Date.now() - cached.meta.lastUpdated) < ADBLOCK_TTL_MS) {
      try {
        engine = ElectronBlocker.deserialize(new Uint8Array(cached.buf));
        adblockerStatus.lastUpdated = cached.meta.lastUpdated;
      } catch (e) {
        console.warn('[adblocker] cache deserialize failed, refetching:', e.message);
        engine = null;
      }
    }
  }

  // Fetch the prebuilt EasyList + EasyPrivacy + uBO unbreak + Peter Lowe's
  // bundle from Ghostery's mirror, then cache to disk for next time.
  if (!engine) {
    try {
      engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchFn);
      source = 'network';
      adblockerStatus.lastUpdated = Date.now();
      persistAdblockerCache(engine);
    } catch (e) {
      adblockerStatus = { ...adblockerStatus, enabled: false, ready: false, source: 'static',
        message: 'Filter list fetch failed (' + (e && e.message || 'unknown') + '). Using static blocklist for this session.' };
      broadcastAdblockerStatus();
      return;
    }
  }

  // Replace any prior install — disable old, enable new
  if (adblockerEngine) {
    try { adblockerEngine.disableBlockingInSession(ses); } catch {}
  }
  adblockerEngine = engine;
  try {
    engine.enableBlockingInSession(ses);
  } catch (e) {
    adblockerStatus = { ...adblockerStatus, enabled: false, ready: false,
      message: 'Could not install blocker: ' + (e && e.message || 'unknown') };
    broadcastAdblockerStatus();
    return;
  }

  // Count blocks. Ghostery emits 'request-blocked' / 'request-redirected' /
  // 'request-whitelisted' events on the engine. The first arg is a Request
  // object with .url / .tabId / .sourceUrl — we use it to populate the
  // recent-blocks ring buffer for the Wizard-native dashboard.
  engine.on('request-blocked', (req) => {
    blockedCount++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('blocked-update', blockedCount);
    }
    if (req && req.url) pushRecentBlock(req.url, 'ghostery');
  });
  engine.on('request-redirected', (req) => {
    blockedCount++;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('blocked-update', blockedCount);
    }
    if (req && req.url) pushRecentBlock(req.url, 'ghostery');
  });

  // Engine stats — totalFilters across network + cosmetic buckets
  let totalFilters = 0;
  try {
    if (engine.lists)             totalFilters += engine.lists.size || 0;
    if (engine.networkFilters)    totalFilters += engine.networkFilters.length || engine.networkFilters.size || 0;
    if (engine.cosmeticFilters)   totalFilters += engine.cosmeticFilters.length || engine.cosmeticFilters.size || 0;
  } catch {}

  adblockerReady = true;
  adblockerStatus = {
    enabled: true,
    ready: true,
    source,
    lastUpdated: adblockerStatus.lastUpdated,
    totalFilters,
    message: null
  };
  broadcastAdblockerStatus();
}

// =====================================================================
// uBlock Origin (real, gorhill's code) loaded as a Chrome MV2 extension
// =====================================================================
// Strategy: download the latest MV2 build from gorhill/uBlock GitHub
// Releases on first launch, extract to userData/chrome-extensions/uBO/,
// then session.loadExtension() it into the persist:wizard partition.
// While uBO is live, we DISABLE the Ghostery engine so they don't
// double-block. If uBO fails to install / load, Ghostery remains the
// active engine (safety net).

const UBO_DIR        = path.join(app.getPath('userData'), 'chrome-extensions', 'ublock-origin');
const UBO_META_FILE  = path.join(UBO_DIR, '.wizard-meta.json');
let uboExtension = null;            // electron Extension handle if loaded
let uboState = {
  state: 'idle',                    // 'idle'|'downloading'|'extracting'|'loading'|'active'|'failed'|'unsupported'
  version: null,
  popupUrl: null,                   // chrome-extension://<id>/<popup>
  optionsUrl: null,
  message: null,
  lastTried: null,
  lastChecked: null,                // ms epoch — last GitHub Releases poll
  latestAvailable: null             // most recent tag observed on GitHub
};
function setUboState(patch) {
  uboState = { ...uboState, ...patch };
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('ubo-status', uboState); } catch {}
    });
  } catch {}
}

function httpGetJson(url) {
  return httpGet(url).then(buf => JSON.parse(buf.toString('utf-8')));
}
function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let lib, parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('bad url')); }
    lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const req = lib.get(url, {
      headers: { 'User-Agent': 'WizardBrowser/1.0 (uBO-installer)', 'Accept': 'application/octet-stream, application/json' },
      timeout: 30000
    }, (res) => {
      // Follow GitHub redirect to actual asset
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(httpGet(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' on ' + url));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// CRX → ZIP: strips the CRX wrapper (CRX2 or CRX3) so we can use adm-zip.
function stripCrxHeader(buf) {
  if (buf.length < 16 || buf.slice(0, 4).toString('ascii') !== 'Cr24') return buf;
  const version = buf.readUInt32LE(4);
  if (version === 2) {
    const pubkeyLen = buf.readUInt32LE(8);
    const sigLen    = buf.readUInt32LE(12);
    return buf.slice(16 + pubkeyLen + sigLen);
  }
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8);
    return buf.slice(12 + headerLen);
  }
  return buf;
}

function rmrfDir(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} }

function unzipBufferToDir(buf, dest) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buf);
  fs.mkdirSync(dest, { recursive: true });
  zip.extractAllTo(dest, /* overwrite */ true);
}

// uBO MV2 sometimes nests its files inside a top-level folder. Locate the
// directory that actually contains manifest.json.
function findManifestRoot(dir) {
  if (fs.existsSync(path.join(dir, 'manifest.json'))) return dir;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    if (fs.existsSync(path.join(sub, 'manifest.json'))) return sub;
  }
  return null;
}

async function downloadUBOAsset() {
  setUboState({ state: 'downloading', message: 'Fetching latest release info…' });
  // Try latest release first; if the asset list doesn't include a usable
  // MV2 build we fall through to a known-good legacy chromium release.
  const candidates = [
    'https://api.github.com/repos/gorhill/uBlock/releases/latest',
    'https://api.github.com/repos/gorhill/uBlock/releases'
  ];
  for (const apiUrl of candidates) {
    try {
      const data = await httpGetJson(apiUrl);
      const releases = Array.isArray(data) ? data : [data];
      for (const release of releases) {
        const assets = (release && release.assets) || [];
        // Preference order: chromium.zip > edge.crx > firefox.signed.xpi > firefox.xpi
        const pick = assets.find(a => /^uBlock0_.*\.chromium\.zip$/i.test(a.name))
                  || assets.find(a => /^uBlock0_.*\.chromium\.crx$/i.test(a.name))
                  || assets.find(a => /^uBlock0_.*\.edge\.crx$/i.test(a.name))
                  || assets.find(a => /^uBlock0_.*\.firefox\.signed\.xpi$/i.test(a.name))
                  || assets.find(a => /^uBlock0_.*\.firefox\.xpi$/i.test(a.name));
        if (!pick) continue;
        setUboState({ state: 'downloading', message: 'Downloading ' + pick.name + ' (v' + (release.tag_name || '?') + ')…' });
        const buf = await httpGet(pick.browser_download_url);
        return { buf, name: pick.name, version: release.tag_name || release.name || '' };
      }
    } catch (e) {
      // Try next candidate
    }
  }
  throw new Error('No suitable uBO MV2 build found in releases');
}

async function installUBO() {
  if (!ses_canLoadExtension()) {
    setUboState({ state: 'unsupported', message: 'This Electron build does not support session.loadExtension.' });
    return false;
  }
  try {
    rmrfDir(UBO_DIR);
    const { buf, name, version } = await downloadUBOAsset();
    setUboState({ state: 'extracting', message: 'Extracting ' + name + '…' });
    const zipBuf = name.endsWith('.crx') ? stripCrxHeader(buf) : buf;
    unzipBufferToDir(zipBuf, UBO_DIR);
    fs.writeFileSync(UBO_META_FILE, JSON.stringify({ version, source: name, installedAt: Date.now() }, null, 2));
    setUboState({ state: 'loading', version, message: 'Loading extension…' });
    return await loadUBOFromDisk();
  } catch (e) {
    setUboState({ state: 'failed', message: 'Install failed: ' + (e && e.message || 'unknown'), lastTried: Date.now() });
    return false;
  }
}

function ses_canLoadExtension() {
  try { return typeof session.fromPartition(PARTITION).loadExtension === 'function'; } catch { return false; }
}

async function loadUBOFromDisk() {
  const ses = session.fromPartition(PARTITION);
  const root = findManifestRoot(UBO_DIR);
  if (!root) {
    setUboState({ state: 'failed', message: 'No manifest.json in extracted bundle' });
    return false;
  }
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(UBO_META_FILE, 'utf-8')); } catch {}
  try {
    if (uboExtension) {
      try { ses.removeExtension(uboExtension.id); } catch {}
      uboExtension = null;
    }
    const ext = await ses.loadExtension(root, { allowFileAccess: true });
    uboExtension = ext;
    // Pick popup URL if the manifest declares one. Field name differs
    // between MV2 ("browser_action") and MV3 ("action"); try both.
    let popupRel = null;
    let optionsRel = null;
    try {
      const m = ext.manifest || {};
      popupRel   = (m.browser_action && m.browser_action.default_popup)
                || (m.action && m.action.default_popup)
                || null;
      optionsRel = (m.options_ui && m.options_ui.page) || m.options_page || null;
    } catch {}
    const popupUrl   = popupRel   ? `chrome-extension://${ext.id}/${popupRel.replace(/^\/+/, '')}`   : null;
    const optionsUrl = optionsRel ? `chrome-extension://${ext.id}/${optionsRel.replace(/^\/+/, '')}` : null;

    // uBO is now blocking via its own webRequest hooks. Suspend Ghostery to
    // avoid double-blocking and let uBO own the request stream.
    if (adblockerEngine) {
      try { adblockerEngine.disableBlockingInSession(ses); } catch {}
      adblockerReady = false;
    }

    setUboState({
      state: 'active',
      version: meta.version || ext.version || null,
      popupUrl,
      optionsUrl,
      message: null,
      lastTried: Date.now()
    });
    // Reflect in adblocker status so Settings shows the right engine label
    adblockerStatus = {
      ...adblockerStatus,
      enabled: true,
      ready: true,
      source: 'ublock-origin',
      lastUpdated: meta.installedAt || adblockerStatus.lastUpdated,
      message: null
    };
    broadcastAdblockerStatus();
    return true;
  } catch (e) {
    setUboState({ state: 'failed', message: 'loadExtension failed: ' + (e && e.message || 'unknown'), lastTried: Date.now() });
    return false;
  }
}

async function ensureUBO({ download = true } = {}) {
  // Already loaded?
  if (uboExtension) return true;
  // Already extracted to disk? Just reload.
  if (fs.existsSync(path.join(UBO_DIR, 'manifest.json')) || findManifestRoot(UBO_DIR)) {
    return loadUBOFromDisk();
  }
  // Need to download.
  if (!download) return false;
  return installUBO();
}

async function removeUBO() {
  const ses = session.fromPartition(PARTITION);
  if (uboExtension) {
    try { ses.removeExtension(uboExtension.id); } catch {}
    uboExtension = null;
  }
  rmrfDir(UBO_DIR);
  setUboState({ state: 'idle', version: null, popupUrl: null, optionsUrl: null, message: null });
  // Re-arm Ghostery as the active engine
  initAdblocker().catch(() => {});
}

// Periodic uBO version check. Compares the installed tag with the latest
// release on github.com/gorhill/uBlock and silently re-installs if newer.
// Mirrors how Chrome polls for extension updates roughly every 5 hours.
function normaliseTag(t) { return String(t || '').replace(/^v/, '').trim(); }

async function checkUBOForUpdate() {
  // Skip if uBO isn't installed (no version baseline to compare against).
  if (!uboExtension) return { updated: false, reason: 'not-installed' };
  const now = Date.now();
  setUboState({ lastChecked: now });
  try {
    const release = await httpGetJson('https://api.github.com/repos/gorhill/uBlock/releases/latest');
    const latest    = normaliseTag(release && release.tag_name);
    const installed = normaliseTag(uboState.version);
    setUboState({ latestAvailable: latest, lastChecked: now });
    if (latest && installed && latest !== installed) {
      // Run install in the background. installUBO() walks through the
      // download → extract → loadExtension flow, broadcasting status the
      // whole way, so the Settings panel reflects each stage.
      console.log('[uBO] update available: ' + installed + ' → ' + latest);
      await installUBO();
      return { updated: true, from: installed, to: latest };
    }
    return { updated: false, version: installed };
  } catch (e) {
    // Network blip — try again next interval. Don't surface as an error
    // because the previous version is still running and still blocking.
    setUboState({ lastChecked: now });
    return { updated: false, reason: 'check-failed', message: e && e.message };
  }
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

  // A .onion main-frame load that fails is almost always "Tor isn't
  // running locally" — surface a clear hint instead of a blank error.
  contents.on('did-fail-load', (_, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 /* ERR_ABORTED */) return;
    let host = '';
    try { host = new URL(validatedURL).hostname.toLowerCase(); } catch { return; }
    if (host === 'onion' || host.endsWith('.onion')) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('onion-error', { host, error: errorDesc || 'load failed' });
      }
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

// Tor / .onion routing.
//   torEnabled = true  -> ALL traffic through the Tor SOCKS5 proxy
//   torEnabled = false -> only *.onion goes through Tor (via PAC),
//                         everything else stays DIRECT
// This means .onion sites work as soon as Tor is running locally,
// without the user having to flip the global Tor toggle first.
let torEnabled = false;
const TOR_SOCKS = '127.0.0.1:9050';

async function applyTorProxy() {
  const ses = session.fromPartition(PARTITION);
  if (torEnabled) {
    await ses.setProxy({ proxyRules: 'socks5://' + TOR_SOCKS });
    return;
  }
  const pac =
    'function FindProxyForURL(url, host){' +
    'if(host){var h=(""+host).toLowerCase();' +
    'if(h==="onion"||h.substr(-6)===".onion")' +
    'return "SOCKS5 ' + TOR_SOCKS + '";}' +
    'return "DIRECT";}';
  const dataUrl = 'data:application/x-ns-proxy-autoconfig;base64,' +
    Buffer.from(pac, 'utf-8').toString('base64');
  await ses.setProxy({ mode: 'pac_script', pacScript: dataUrl });
}

ipcMain.handle('toggle-tor', async (_, enable) => {
  try {
    torEnabled = !!enable;
    await applyTorProxy();
    return true;
  } catch { return false; }
});

// --- Per-site settings (the padlock) IPC ---
ipcMain.handle('site-settings:get', (_, url) => {
  const origin = originOf(url);
  return { origin, settings: siteSettingsFor(origin) };
});
ipcMain.handle('site-settings:set', (_, url, key, value) => {
  const origin = originOf(url);
  if (!origin) return { ok: false, error: 'internal page' };
  if (!(key in SITE_DEFAULTS)) return { ok: false, error: 'unknown key' };
  const allowed = key === 'javascript' ? ['on', 'off'] : ['allow', 'block'];
  if (!allowed.includes(value)) return { ok: false, error: 'bad value' };
  const cur = { ...(siteSettings[origin] || {}) };
  cur[key] = value;
  // Drop entries that are all-default so the store stays tidy.
  const merged = { ...SITE_DEFAULTS, ...cur };
  const isAllDefault = Object.keys(SITE_DEFAULTS).every(k => merged[k] === SITE_DEFAULTS[k]);
  if (isAllDefault) delete siteSettings[origin];
  else siteSettings[origin] = cur;
  saveJSON(siteSettingsPath, siteSettings);
  broadcastSiteSettings(origin);
  return { ok: true, origin, settings: siteSettingsFor(origin) };
});
ipcMain.handle('site-settings:clear', (_, url) => {
  const origin = originOf(url);
  if (origin && siteSettings[origin]) {
    delete siteSettings[origin];
    saveJSON(siteSettingsPath, siteSettings);
    broadcastSiteSettings(origin);
  }
  return { ok: true, origin, settings: siteSettingsFor(origin) };
});

ipcMain.handle('get-downloads', () => downloads);
ipcMain.on('open-download', (_, p) => shell.openPath(p));
ipcMain.on('show-download', (_, p) => shell.showItemInFolder(p));

ipcMain.handle('get-settings',     () => settings);
ipcMain.handle('save-settings',    (_, partial) => {
  const prev = settings;
  settings = { ...settings, ...partial };
  saveJSON(settingsPath, settings);
  // Broadcast to every renderer (shell + every webview tab) so the chrome,
  // search.html homepage, and settings.html itself all re-skin live.
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('settings-changed', settings); } catch {}
    });
  } catch {}
  // If the user just toggled tracker blocking on/off, install or uninstall
  // the adblocker engine on the live session.
  if ('trackerBlocking' in (partial || {}) && prev.trackerBlocking !== settings.trackerBlocking) {
    if (settings.trackerBlocking) {
      initAdblocker().catch(() => {});
    } else if (adblockerEngine) {
      try { adblockerEngine.disableBlockingInSession(session.fromPartition(PARTITION)); } catch {}
      adblockerEngine = null;
      adblockerReady = false;
      adblockerStatus = { ...adblockerStatus, enabled: false, ready: false, message: 'Tracker blocking is off in Settings.' };
      broadcastAdblockerStatus();
    }
  }
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
ipcMain.on('open-settings',      () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'settings'); });
ipcMain.on('open-home',          () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'home'); });
ipcMain.on('open-newtab',        () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'newtab'); });
ipcMain.on('open-ubo-dashboard', () => { if (mainWindow) mainWindow.webContents.send('navigate-shell', 'ubo'); });

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
// WizardScript — extension subsystem
// =====================================================================
const extensionsDir = path.join(app.getPath('userData'), 'extensions');
try { fs.mkdirSync(extensionsDir, { recursive: true }); } catch {}

// Built-in extensions ship inside the app bundle. On every boot we copy
// them into userData/extensions/ if missing OR if our shipped version is
// newer than what's on disk (so updates land automatically). Their manifests
// declare `"builtIn": true`, which the UI uses to hide Uninstall.
const builtInsDir = path.join(__dirname, 'built-in-extensions');
function installBuiltInExtensions() {
  let entries = [];
  try { entries = fs.readdirSync(builtInsDir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const src = path.join(builtInsDir, ent.name);
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(src, 'wizard.json'), 'utf-8')); } catch { continue; }
    manifest.builtIn = true;
    const id  = ent.name;                    // keep folder name stable for built-ins
    const dst = path.join(extensionsDir, id);
    let needsCopy = true;
    try {
      const installed = JSON.parse(fs.readFileSync(path.join(dst, 'wizard.json'), 'utf-8'));
      // Same version already installed — leave alone (preserve _disabled state)
      if (installed.version === manifest.version) needsCopy = false;
    } catch {}
    if (!needsCopy) continue;

    // Preserve the user's _disabled flag across updates
    let disabled = false;
    try {
      const old = JSON.parse(fs.readFileSync(path.join(dst, 'wizard.json'), 'utf-8'));
      disabled = !!old._disabled;
    } catch {}

    try {
      fs.mkdirSync(dst, { recursive: true });
      // Copy script + icon if present (manifest is rewritten with builtIn flag)
      if (manifest.script) {
        const scriptSrc = path.join(src, manifest.script);
        if (fs.existsSync(scriptSrc)) fs.copyFileSync(scriptSrc, path.join(dst, manifest.script));
      }
      if (manifest.icon) {
        const iconSrc = path.join(src, manifest.icon);
        if (fs.existsSync(iconSrc)) fs.copyFileSync(iconSrc, path.join(dst, manifest.icon));
      }
      manifest._disabled = disabled;
      fs.writeFileSync(path.join(dst, 'wizard.json'), JSON.stringify(manifest, null, 2));
    } catch (e) {
      console.warn('[built-in ext]', id, 'install failed:', e.message);
    }
  }
}
installBuiltInExtensions();

function slugifyId(name, version) {
  return ((name || 'unnamed') + '-' + (version || '0.0.0'))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function loadExtensions() {
  const list = [];
  let entries = [];
  try { entries = fs.readdirSync(extensionsDir, { withFileTypes: true }); } catch {}
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(extensionsDir, ent.name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'wizard.json'), 'utf-8'));
      if (!manifest.script) continue;
      const codePath = path.join(dir, manifest.script);
      const code = fs.readFileSync(codePath, 'utf-8');
      list.push({
        id: ent.name,
        manifest,
        code,
        enabled: !manifest._disabled,
        dir
      });
    } catch (e) {
      // Skip invalid extensions silently — they'll show up missing in UI.
    }
  }
  return list;
}
let extensions = loadExtensions();

function broadcastExtensionsChanged() {
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('extensions-changed'); } catch {}
    });
  } catch {}
}

// List installed extensions (manifest + enabled flag, no code)
ipcMain.handle('ext-list', () => extensions.map(e => ({
  id: e.id, manifest: e.manifest, enabled: e.enabled
})));

// List enabled extensions WITH code — used by the shell runtime
ipcMain.handle('ext-list-runtime', () => extensions
  .filter(e => e.enabled)
  .map(e => ({ id: e.id, manifest: e.manifest, code: e.code })));

ipcMain.handle('ext-toggle', (_, id) => {
  const ext = extensions.find(e => e.id === id);
  if (!ext) return false;
  ext.enabled = !ext.enabled;
  ext.manifest._disabled = !ext.enabled;
  try { fs.writeFileSync(path.join(ext.dir, 'wizard.json'), JSON.stringify(ext.manifest, null, 2)); } catch {}
  broadcastExtensionsChanged();
  return true;
});

ipcMain.handle('ext-uninstall', (_, id) => {
  const ext = extensions.find(e => e.id === id);
  if (!ext) return false;
  // Built-in extensions can be disabled but not uninstalled — they'd just
  // get re-extracted on next boot anyway. UI also hides the button.
  if (ext.manifest && ext.manifest.builtIn) return false;
  try { fs.rmSync(ext.dir, { recursive: true, force: true }); } catch {}
  extensions = loadExtensions();
  broadcastExtensionsChanged();
  return true;
});

ipcMain.handle('ext-install-from-folder', async () => {
  if (!mainWindow) return { ok: false, error: 'no window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick an extension folder (containing wizard.json + script)'
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, error: 'cancelled' };
  const src = result.filePaths[0];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(src, 'wizard.json'), 'utf-8'));
  } catch {
    return { ok: false, error: 'No valid wizard.json in that folder' };
  }
  if (!manifest.name || !manifest.version || !manifest.script) {
    return { ok: false, error: 'wizard.json missing required fields (name, version, script)' };
  }
  const scriptSrc = path.join(src, manifest.script);
  if (!fs.existsSync(scriptSrc)) {
    return { ok: false, error: `Script file "${manifest.script}" not found` };
  }
  const id = slugifyId(manifest.name, manifest.version);
  const dest = path.join(extensionsDir, id);
  try {
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, 'wizard.json'), path.join(dest, 'wizard.json'));
    fs.copyFileSync(scriptSrc, path.join(dest, manifest.script));
    if (manifest.icon) {
      try { fs.copyFileSync(path.join(src, manifest.icon), path.join(dest, manifest.icon)); } catch {}
    }
  } catch (e) {
    return { ok: false, error: 'Copy failed: ' + e.message };
  }
  extensions = loadExtensions();
  broadcastExtensionsChanged();
  return { ok: true, id };
});

// =====================================================================
// Extension Store — browse + install from the live store at
// wizardextensionstore.netlify.app (Supabase-backed). Config (URL +
// publishable anon key) lives in ./config.js, not hardcoded here.
//
// SECURITY: everything below the network boundary is treated as hostile.
// The store does moderation, but the install path is defense-in-depth:
//   - http(s)-only file URLs
//   - compressed + uncompressed size caps (zip-bomb guard)
//   - file-count cap
//   - per-entry zip-slip validation (no abs paths / .. / backslashes /
//     drive letters; every target must resolve inside the ext dir)
//   - manifest required-field validation
//   - builtIn / _disabled stripped from any submitted manifest
//   - manifest.script must be a safe relative path that actually exists
// =====================================================================

const STORE_MAX_BYTES = 10 * 1024 * 1024;  // 10 MB (compressed + uncompressed)
const STORE_MAX_FILES = 100;

// List live extensions from the store. RLS only returns status='live'.
ipcMain.handle('store-list', async () => {
  try {
    const res = await new Promise((resolve, reject) => {
      const https = require('https');
      const url = `${SUPABASE_URL}/rest/v1/extensions`
        + `?status=eq.live&order=created_at.desc`
        + `&select=id,name,version,description,permissions,file_url,installs,icon_url,profiles(username,verified)`;
      const req = https.get(url, {
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
          'Accept':        'application/json'
        },
        timeout: 10000
      }, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve([]); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    return Array.isArray(res) ? res : [];
  } catch (e) {
    return [];
  }
});

// Download + install an extension package (.wizext = zip) by file_url.
ipcMain.handle('store-install', async (_, fileUrl, manifestData) => {
  let dest = null;
  try {
    if (!fileUrl || typeof fileUrl !== 'string') {
      return { ok: false, error: 'Missing file URL' };
    }
    let parsed;
    try { parsed = new URL(fileUrl); }
    catch { return { ok: false, error: 'Malformed file URL' }; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'Refusing non-http(s) file URL' };
    }
    if (!manifestData || !manifestData.name || !manifestData.version) {
      return { ok: false, error: 'Invalid extension metadata' };
    }

    const buf = await httpGet(fileUrl);
    if (!buf || !buf.length) return { ok: false, error: 'Empty download' };
    if (buf.length > STORE_MAX_BYTES) {
      return { ok: false, error: 'Package exceeds 10MB' };
    }

    const AdmZip = require('adm-zip');
    let zip, entries;
    try {
      zip = new AdmZip(buf);
      entries = zip.getEntries();
    } catch {
      return { ok: false, error: 'Not a valid .wizext archive' };
    }
    if (!entries.length) return { ok: false, error: 'Empty archive' };

    const id = slugifyId(manifestData.name, manifestData.version);
    if (!id) return { ok: false, error: 'Could not derive a safe extension id' };
    dest = path.join(extensionsDir, id);
    const destResolved = path.resolve(dest);

    // ── Validation pass: zip-slip + size + count. No writes yet. ──
    let fileCount = 0;
    let totalBytes = 0;
    for (const e of entries) {
      const name = e.entryName;
      if (typeof name !== 'string' || !name) {
        return { ok: false, error: 'Archive contains an unnamed entry' };
      }
      // Reject absolute paths, drive letters, backslashes, parent refs.
      if (path.isAbsolute(name)
       || /^[a-zA-Z]:/.test(name)
       || name.includes('\\')
       || name.split('/').includes('..')) {
        return { ok: false, error: 'Unsafe path in archive: ' + name };
      }
      const target = path.resolve(destResolved, name);
      if (target !== destResolved && !target.startsWith(destResolved + path.sep)) {
        return { ok: false, error: 'Archive entry escapes extension dir: ' + name };
      }
      if (!e.isDirectory) {
        fileCount++;
        if (fileCount > STORE_MAX_FILES) {
          return { ok: false, error: 'Archive has too many files (>' + STORE_MAX_FILES + ')' };
        }
        totalBytes += (e.header && e.header.size) || 0;
        if (totalBytes > STORE_MAX_BYTES) {
          return { ok: false, error: 'Extracted size exceeds 10MB (zip bomb?)' };
        }
      }
    }

    // ── Safe to extract: write entry-by-entry into dest ──
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    for (const e of entries) {
      const target = path.join(dest, e.entryName);
      if (e.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.getData());
    }

    // ── Manifest validation ──
    const manifestPath = path.join(dest, 'wizard.json');
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'No wizard.json in extension package' };
    }
    let m;
    try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
    catch {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'wizard.json is not valid JSON' };
    }

    // Strip privilege-escalation flags from anything off the wire. A
    // store package must never masquerade as a built-in extension
    // (built-ins can't be uninstalled and get auto-re-extracted).
    delete m.builtIn;
    delete m._disabled;

    const missing = ['name', 'version', 'script', 'permissions']
      .filter(k => m[k] === undefined || m[k] === null || m[k] === '');
    if (missing.length) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'Manifest missing required field(s): ' + missing.join(', ') };
    }
    if (!Array.isArray(m.permissions)) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'Manifest "permissions" must be an array' };
    }
    if (typeof m.script !== 'string'
     || path.isAbsolute(m.script)
     || m.script.includes('\\')
     || m.script.split('/').includes('..')) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'Manifest "script" path is unsafe' };
    }
    const scriptPath = path.resolve(dest, m.script);
    if (!scriptPath.startsWith(destResolved + path.sep) || !fs.existsSync(scriptPath)) {
      fs.rmSync(dest, { recursive: true, force: true });
      return { ok: false, error: 'Manifest "script" file not found in package: ' + m.script };
    }

    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));

    extensions = loadExtensions();
    broadcastExtensionsChanged();
    return { ok: true, id };
  } catch (e) {
    if (dest) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} }
    return { ok: false, error: 'Install failed: ' + (e && e.message || 'unknown') };
  }
});

// Per-extension scoped key/value storage on disk.
function extStoragePath(id) { return path.join(extensionsDir, id, 'storage.json'); }
function readExtStorage(id) {
  try { return JSON.parse(fs.readFileSync(extStoragePath(id), 'utf-8')); } catch { return {}; }
}
function writeExtStorage(id, data) {
  try { fs.writeFileSync(extStoragePath(id), JSON.stringify(data, null, 2)); } catch {}
}

ipcMain.handle('ext-storage-get',    (_, id, key)        => { const d = readExtStorage(id); return d[key] ?? null; });
ipcMain.handle('ext-storage-set',    (_, id, key, value) => { const d = readExtStorage(id); d[key] = value; writeExtStorage(id, d); return true; });
ipcMain.handle('ext-storage-remove', (_, id, key)        => { const d = readExtStorage(id); delete d[key]; writeExtStorage(id, d); return true; });
ipcMain.handle('ext-storage-clear',  (_, id)             => { writeExtStorage(id, {}); return true; });

// CORS-bypassing fetch for extensions. Returns { ok, status, body }.
function extHttpRequest(url, { method = 'GET', headers = {}, body = null, timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    let lib, parsed;
    try { parsed = new URL(url); } catch { return resolve({ ok: false, status: 0, body: '' }); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return resolve({ ok: false, status: 0, body: '' });
    lib = parsed.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request(url, {
      method,
      headers: { 'User-Agent': 'WizardBrowser/1.0 WizardScript', ...headers },
      timeout
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode || 0,
        body: data
      }));
    });
    req.on('error',   () => resolve({ ok: false, status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: '' }); });
    if (body != null) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(payload);
    }
    req.end();
  });
}

ipcMain.handle('ext-net-fetch', (_, url, options)        => extHttpRequest(url, options || {}));
ipcMain.handle('ext-net-post',  (_, url, body, options)  => extHttpRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...((options && options.headers) || {}) },
  body,
  ...((options && { timeout: options.timeout }) || {})
}));

// Read-only privacy + theme bridges for extensions
ipcMain.handle('ext-privacy-getSettings', () => ({
  trackerBlocking:    !!settings.trackerBlocking,
  doNotTrack:         !!settings.doNotTrack,
  canvasSpoofing:     !!settings.canvasSpoofing,
  webrtcProtection:   !!settings.webrtcProtection,
  referrerStripping:  !!settings.referrerStripping,
  clearOnExit:        !!settings.clearOnExit
}));
ipcMain.handle('ext-privacy-isTrackerBlocked', (_, domain) => {
  if (typeof domain !== 'string') return false;
  const d = domain.toLowerCase();
  return trackerList.some(t => d.includes(t));
});
ipcMain.handle('ext-privacy-getBlockedCount', () => blockedCount);
ipcMain.handle('ext-ui-getTheme', () => settings.theme || 'default');

// =====================================================================
// Auto-updater (with periodic re-check, status state, opt-out)
// =====================================================================
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Centralised status used by Settings → Update panel + the toolbar dot.
let updateState = {
  status: 'idle',          // 'idle' | 'checking' | 'downloading' | 'ready' | 'up-to-date' | 'error' | 'disabled'
  currentVersion: app.getVersion(),
  availableVersion: null,
  lastChecked: null,       // ms epoch
  message: null
};

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  // Broadcast to every renderer (shell + every webview tab) so Settings,
  // homepage, and toolbar all stay in sync.
  try {
    webContents.getAllWebContents().forEach(wc => {
      try { wc.send('update-status', updateState); } catch {}
    });
  } catch {}
}

autoUpdater.on('checking-for-update', () => {
  setUpdateState({ status: 'checking', message: null });
});
autoUpdater.on('update-available', (info) => {
  setUpdateState({ status: 'downloading', availableVersion: info && info.version, message: null });
});
autoUpdater.on('update-downloaded', (info) => {
  setUpdateState({ status: 'ready', availableVersion: info && info.version, message: null });
});
autoUpdater.on('update-not-available', () => {
  setUpdateState({ status: 'up-to-date', availableVersion: null, message: null, lastChecked: Date.now() });
});
autoUpdater.on('error', (err) => {
  setUpdateState({ status: 'error', message: err ? err.message : 'Unknown error', lastChecked: Date.now() });
});

async function runUpdateCheck(reason = 'manual') {
  if (settings.autoUpdate === false && reason !== 'manual') {
    setUpdateState({ status: 'disabled', message: 'Auto-update is disabled in Settings.' });
    return false;
  }
  // 'checking' state already fired by the autoUpdater event; mark lastChecked
  // when we get a terminal event (up-to-date / ready / error).
  try {
    await autoUpdater.checkForUpdates();
    return true;
  } catch (e) {
    setUpdateState({ status: 'error', message: e ? e.message : 'Check failed', lastChecked: Date.now() });
    return false;
  }
}

ipcMain.handle('get-update-status', () => updateState);

// Adblocker IPC
ipcMain.handle('get-adblocker-status', () => adblockerStatus);
ipcMain.handle('get-ubo-status', () => uboState);
ipcMain.handle('install-ubo', async () => { await installUBO(); return uboState; });
ipcMain.handle('remove-ubo',  async () => { await removeUBO(); return uboState; });
ipcMain.handle('check-ubo-update', async () => { await checkUBOForUpdate(); return uboState; });

// Open one of uBO's own UI pages (dashboard / popup / logger) in a real
// BrowserWindow tied to the persist:wizard session. Extension chrome.* APIs
// only work fully in BrowserWindow contexts — webview tabs don't have
// chrome.runtime.sendMessage wired through to the extension's background
// page, which is why uBO's dashboard renders blank when loaded in a tab.
let uboWindows = new Map();   // url -> BrowserWindow
ipcMain.handle('open-ubo-window', async (_, which = 'dashboard') => {
  if (!uboExtension) return false;
  let url;
  if (which === 'popup' && uboState.popupUrl)        url = uboState.popupUrl;
  else if (which === 'options' && uboState.optionsUrl) url = uboState.optionsUrl;
  else if (which === 'logger' && uboState.optionsUrl) {
    url = uboState.optionsUrl.replace(/[^/]*$/, '') + 'logger-ui.html';
  }
  else url = uboState.optionsUrl || uboState.popupUrl;
  if (!url) return false;

  // If a window for this URL is already open, just focus it
  const existing = uboWindows.get(url);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }

  const isPopup = which === 'popup' || (url && url.includes('popup'));
  const win = new BrowserWindow({
    width:  isPopup ? 420 : 980,
    height: isPopup ? 560 : 720,
    minWidth: 320,
    minHeight: 320,
    parent: mainWindow,
    title: 'uBlock Origin',
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1b',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      session: session.fromPartition(PARTITION),
      // contextIsolation MUST be off for uBO's UI pages. With isolation on,
      // Electron injects the chrome.* extension APIs into the isolated
      // preload world only — uBO's scripts run in the main world and find
      // chrome.* undefined, then crash silently, leaving the page black.
      // Safe to disable here because the window strictly loads
      // chrome-extension:// URLs we control (uBO's own pages) and
      // nodeIntegration stays off, so no Node access is exposed.
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false,
      // No preload — let the extension's chrome.* APIs run unhindered
    }
  });
  try { Menu.setApplicationMenu(null); } catch {}
  win.removeMenu();
  win.loadURL(url);
  uboWindows.set(url, win);
  win.on('closed', () => { uboWindows.delete(url); });
  return true;
});
ipcMain.handle('refresh-adblocker', async () => {
  // Force a network re-fetch of EasyList / EasyPrivacy / uBO unbreak / etc.
  await initAdblocker({ forceRefresh: true });
  return adblockerStatus;
});

// =====================================================================
// Wizard-native uBO Dashboard — talks to uBO's background script via
// executeJavaScript and exposes a tidy state object the dashboard
// HTML can render. Falls back gracefully when uBO's internal API
// shape changes or the background page isn't loaded yet.
// =====================================================================

function findUboBackground() {
  if (!uboExtension) return null;
  const idPrefix = 'chrome-extension://' + uboExtension.id + '/';
  try {
    for (const wc of webContents.getAllWebContents()) {
      try {
        const u = wc.getURL();
        if (!u || !u.startsWith(idPrefix)) continue;
        const t = wc.getType();
        // Electron exposes background pages as 'backgroundPage'. Some
        // builds also return 'remote' / 'window'. Filter to anything
        // that looks like the background context (not a popup/options page).
        if (t === 'backgroundPage') return wc;
        if (/background|_generated_background_page/.test(u)) return wc;
      } catch {}
    }
  } catch {}
  return null;
}

async function uboExec(code, timeoutMs = 4000) {
  const wc = findUboBackground();
  if (!wc) throw new Error('uBO background page not loaded');
  return await Promise.race([
    wc.executeJavaScript(code, true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('uBO exec timed out')), timeoutMs))
  ]);
}

// Probe uBO state via its internal globals. uBO MV2 exposes µBlock (Greek
// mu, U+00B5) on the background page; some forks expose it as µb or
// ublock. Try them in order. Returns null on failure.
async function uboReadState() {
  const code = `(function(){
    try {
      var µ = globalThis['\\u00b5Block'] || globalThis['\\u00b5b'] || globalThis.uBlock || globalThis.ublock;
      if (!µ) return { ok: false, reason: 'no-globals' };

      var sel    = Array.isArray(µ.selectedFilterLists) ? µ.selectedFilterLists.slice() : [];
      var avail  = µ.availableFilterLists || (µ.assets && µ.assets.entries) || {};
      var lists  = [];
      try {
        var keys = Object.keys(avail);
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i], v = avail[k] || {};
          lists.push({
            key:        k,
            title:      v.title || k,
            group:      v.group || (v.lang ? 'regions' : 'misc'),
            enabled:    sel.indexOf(k) !== -1,
            entryCount: v.entryCount || v.entryUsedCount || 0,
            off:        !!v.off,
            supportURL: v.supportURL || v.homeURL || ''
          });
        }
      } catch (e) {}

      var blockedTotal = 0;
      try { blockedTotal = (µ.localSettings && µ.localSettings.blockedRequestCount) || 0; } catch (e) {}

      return { ok: true, lists: lists, blockedRequestCount: blockedTotal };
    } catch (err) {
      return { ok: false, reason: 'exception', message: String(err && err.message || err) };
    }
  })()`;
  try { return await uboExec(code); }
  catch (e) { return { ok: false, reason: 'exec-failed', message: e && e.message }; }
}

async function uboGetUserFilters() {
  const code = `(async function(){
    try {
      var µ = globalThis['\\u00b5Block'] || globalThis['\\u00b5b'] || globalThis.uBlock;
      if (!µ) return null;
      if (typeof µ.loadUserFilters === 'function') {
        var r = await µ.loadUserFilters();
        return (r && (r.content || r.userFilters)) || '';
      }
      // Fallback path: some forks expose userFilters as a getter on µ
      if (µ.userFiltersText != null) return µ.userFiltersText;
      return null;
    } catch (e) { return null; }
  })()`;
  try { return await uboExec(code); }
  catch { return null; }
}

async function uboSetUserFilters(text) {
  const safe = JSON.stringify(text == null ? '' : String(text));
  const code = `(async function(){
    try {
      var µ = globalThis['\\u00b5Block'] || globalThis['\\u00b5b'] || globalThis.uBlock;
      if (!µ) return false;
      if (typeof µ.saveUserFilters === 'function') {
        await µ.saveUserFilters(${safe});
        // Re-arm the engine so new rules take effect immediately
        if (typeof µ.loadFilterLists === 'function') { try { await µ.loadFilterLists(); } catch (e) {} }
        return true;
      }
      return false;
    } catch (e) { return false; }
  })()`;
  try { return !!(await uboExec(code)); }
  catch { return false; }
}

async function uboToggleList(key, enable) {
  const safeKey = JSON.stringify(String(key));
  const safeOn  = JSON.stringify(!!enable);
  const code = `(async function(){
    try {
      var µ = globalThis['\\u00b5Block'] || globalThis['\\u00b5b'] || globalThis.uBlock;
      if (!µ) return false;
      var key = ${safeKey};
      var enable = ${safeOn};
      var set = Array.isArray(µ.selectedFilterLists) ? µ.selectedFilterLists.slice() : [];
      var idx = set.indexOf(key);
      if (enable && idx === -1) set.push(key);
      if (!enable && idx !== -1) set.splice(idx, 1);
      µ.selectedFilterLists = set;
      // Try a few persist paths — uBO's API has churned over the years
      if (typeof µ.applyFilterListSelection === 'function') {
        try { await µ.applyFilterListSelection({ toSelect: set }); } catch (e) {}
      }
      if (typeof µ.saveSelectedFilterLists === 'function') {
        try { await µ.saveSelectedFilterLists(); } catch (e) {}
      }
      if (typeof µ.loadFilterLists === 'function') {
        try { await µ.loadFilterLists(); } catch (e) {}
      }
      // Persist via chrome.storage as a final fallback
      try { chrome.storage.local.set({ selectedFilterLists: set }); } catch (e) {}
      return true;
    } catch (e) { return false; }
  })()`;
  try { return !!(await uboExec(code)); }
  catch { return false; }
}

// Aggregated state read by the dashboard. Returns:
//   {
//     engineSource: 'ublock-origin'|'ghostery'|'static'|'off',
//     sessionBlockedCount, uboBlockedCount,
//     adblockerStatus, uboState,
//     lists: [...], listsError: string|null
//   }
ipcMain.handle('ubo-dash-get-state', async () => {
  const out = {
    engineSource:        adblockerStatus.enabled === false ? 'off' : (adblockerStatus.source || 'static'),
    sessionBlockedCount: blockedCount,
    uboBlockedCount:     null,
    adblockerStatus,
    uboState,
    lists:               [],
    listsError:          null
  };
  if (uboState.state === 'active') {
    const probe = await uboReadState();
    if (probe && probe.ok) {
      out.lists = probe.lists || [];
      out.uboBlockedCount = probe.blockedRequestCount != null ? probe.blockedRequestCount : null;
    } else {
      out.listsError = (probe && (probe.reason || probe.message)) || 'unknown';
    }
  }
  return out;
});

ipcMain.handle('ubo-dash-toggle-list',      (_, key, enable) => uboToggleList(key, enable));
ipcMain.handle('ubo-dash-get-user-filters', () => uboGetUserFilters());
ipcMain.handle('ubo-dash-set-user-filters', (_, text) => uboSetUserFilters(text));
ipcMain.handle('ubo-dash-recent-blocks',    () => recentBlocks);
ipcMain.handle('check-update', async () => { await runUpdateCheck('manual'); return updateState; });
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
  // Route *.onion through Tor from boot (no need to toggle Tor first).
  applyTorProxy().catch(() => {});
  // Initial check shortly after boot, then re-check every 2 hours while the
  // app stays open. (Chrome polls every few hours via its background service;
  // we can't run when closed, but periodic in-app keeps users current.)
  setTimeout(() => { runUpdateCheck('startup'); }, 3000);
  setInterval(() => { runUpdateCheck('periodic'); }, 2 * 60 * 60 * 1000);

  // Spin up the Ghostery filter engine first (fast, always-on safety net).
  setTimeout(() => { initAdblocker().catch(e => console.warn('[adblocker]', e)); }, 200);
  // Refresh Ghostery's filter lists weekly
  setInterval(() => { initAdblocker({ forceRefresh: true }).catch(() => {}); }, ADBLOCK_TTL_MS);

  // Then try to load the real uBlock Origin (gorhill MV2 build). If it
  // installs/loads cleanly, ensureUBO() will suspend Ghostery and become
  // the live blocker. If it fails (no network, asset removed, etc.) the
  // Ghostery engine keeps running.
  setTimeout(() => { ensureUBO({ download: true }).catch(e => console.warn('[uBO]', e)); }, 2500);

  // Auto-update uBO ~5 min after boot (catches releases shipped between
  // sessions) and every 6 hours after that. Matches Chrome's extension
  // polling cadence. Silent — just re-installs the new build and reloads
  // the extension. Filter lists update on uBO's own internal schedule.
  setTimeout(() => { checkUBOForUpdate().catch(() => {}); }, 5 * 60 * 1000);
  setInterval(() => { checkUBOForUpdate().catch(() => {}); }, 6 * 60 * 60 * 1000);
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
