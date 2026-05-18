<div align="center">
  <img src="logo.png" width="120" alt="Wizard Browser" />

  # Wizard Browser

  A libre browser with a built-in private search engine.

  [![License](https://img.shields.io/badge/license-WPL--1.0-555?style=flat-square)](./LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-555?style=flat-square)](#install)
  [![Electron](https://img.shields.io/badge/electron-35-555?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)

  [Website](https://wizardbrowser.netlify.app/) · [Extension Store](https://wizardextensionstore.netlify.app/)

  <br/>

  <img src="thumbnail.png" width="860" alt="Wizard Browser interface" />
</div>

---

## Features

### Privacy

| Feature | Details |
|---|---|
| Ad & tracker blocking | Real uBlock Origin (gorhill MV2, auto-installed and auto-updated) plus Ghostery's filter engine (EasyList, EasyPrivacy, uBO unbreak, Peter Lowe's) as a fallback. Static blocklist for first/offline launch. |
| Ad blocker dashboard | Native dashboard from the toolbar shield: engine status, filter-list toggles, custom rules, live log of blocked requests. |
| No cookies | All cookies stripped from responses. Nothing persists between sessions. |
| WebRTC leak prevention | Real IP stays hidden during video/voice. |
| Canvas & WebGL spoofing | GPU/rendering fingerprinting blocked. |
| Referrer stripping | Cross-origin referrer headers removed. |
| Generic user agent | Spoofs a common Chrome UA. |
| DNT + GPC headers | Sends `DNT: 1` and `Sec-GPC: 1` on every request. |
| Clear on exit | All browsing data wiped when the browser closes. |

### Wizard Search

Built-in search aggregated from multiple independent sources. Queries route through a pool of SearXNG instances (randomly selected, DuckDuckGo Lite as fallback) server-side to avoid CORS and fingerprinting.

Sources: SearXNG, Wikipedia, YouTube (via Piped), Hacker News, Reddit, Archive.org, Stack Overflow, GitHub.

- Knowledge panels from Wikipedia and Wikidata
- Image viewer with copy, download, navigation
- SafeSearch toggle
- No search history kept

### Browser

- Multi-tab: drag to reorder, middle-click to close, `Ctrl+T` / `Ctrl+W`, right-click tab menu
- 10 colour schemes × 6 backgrounds (4 built-in wallpapers or your own), plus sharp-edges / glossy-UI modifiers and a Win7 layout
- Back / Forward / Reload / Home
- Smart URL bar (auto-detects URLs vs. search queries)
- Block counter on the toolbar shield
- Bookmarks (`Ctrl+B`)
- Downloads (`Ctrl+J`)
- Speed dial
- Tor routing via SOCKS5 (auto-suggests `.onion` versions)
- PIN lock on launch
- Manual CLEAR button to wipe session data
- Right-click context menu: copy, paste, search selection, bookmark, inspect
- Auto-updater (checks GitHub Releases on startup, installs on quit)

### WizardScript extension API

Build extensions in plain JavaScript using the `wizard.*` namespace. No build step, no MV3 manifest. A `wizard.json` and a single JS file. Drop a folder into the Extensions panel and it loads without a restart.

- `wizard.page` — `getURL`, `getTitle`, `injectCSS`, `injectScript`, `onNavigate`, `onLoad`
- `wizard.storage` — `get`, `set`, `remove`, `clear` (per-extension scope)
- `wizard.ui` — `notify`, `getTheme`, `addButton` (toolbar button with badge/icon/tooltip)
- `wizard.privacy` — `getSettings`, `isTrackerBlocked`, `getBlockedCount`
- `wizard.adblock` — `getStatus`, `refresh`, `getBlockedCount`, `onStatus`, `getUboStatus`, `openDashboard`
- `wizard.net` — `fetch`, `post` (CORS-bypassing main-process proxy)
- Per-extension permission gating via the manifest's `permissions` array
- `match` patterns for URL targeting (`"*"`, `"https://github.com/*"`)
- Extensions run in the shell renderer (callbacks persist across navigations)

### Extension store

Community store backed by Supabase, with in-app install. No sideloading.

- In-browser: open Extensions → Store. One-click install, no restart.
- Web: browse, review, publish at [wizardextensionstore.netlify.app](https://wizardextensionstore.netlify.app/). Paste a `wizard.json` and script, the site packages a `.wizext`.
- Hardened install path: size/file-count capped, zip-slip-validated, manifest-checked, privilege flags stripped before write.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+L` | Focus URL bar |
| `Alt+←` / `Alt+→` | Back / Forward |
| `F5` | Reload |
| `Ctrl+D` | Bookmark page |
| `Ctrl+B` | Toggle bookmarks |
| `Ctrl+J` | Toggle downloads |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |

---

## Install

Requires [Node.js](https://nodejs.org/) and npm.

```bash
git clone https://github.com/NaniIsNano/wizard-browser.git
cd wizard-browser
npm install
npm start
```

## Build

Windows:

```bash
npm run build:win
```

Outputs `dist/WizardBrowser-Setup-x.x.x.exe` (NSIS installer).

Linux:

```bash
npm run build:linux
```

Outputs `dist/Wizard-Browser-x.x.x.AppImage` and `.deb`.

## Windows SmartScreen

On first run, Windows may show "Windows protected your PC". This is expected for unsigned open-source software. Click "More info" → "Run anyway".

## Project layout

```
wizard-browser/
├── main.js                 Electron main (privacy, sessions, adblock, store, IPC, updater)
├── config.js               Supabase URL + publishable key for the Extension Store
├── preload.js              Preload bridge for the browser shell
├── preload-search.js       Preload injected into every inner page
├── browser.html            Browser shell (tab bar, toolbar)
├── search.html             Wizard Search homepage
├── settings.html           Settings panel
├── extensions.html         Extension manager + store
├── ubo-dashboard.html      Ad blocker dashboard
├── built-in-extensions/    Extensions auto-extracted on first run
├── tracker-list.json       Static fallback blocklist
├── backgrounds/            Built-in wallpapers
├── package.json
└── logo.png / thumbnail.png
```

## Credits

- MrBlight — contributor
- [SearXNG](https://searxng.org/), [Wikipedia](https://wikipedia.org/), [Wikidata](https://www.wikidata.org/), [Piped](https://github.com/TeamPiped/Piped) for search
- [Electron](https://www.electronjs.org/)

## License

[WPL-1.0](./LICENSE) — free as in freedom, not free for profit. Originally by NaniIsNano.
