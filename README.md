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
| Ad & tracker blocking | Real uBlock Origin (gorhill MV2, auto-installed from GitHub Releases and silently kept up to date) with Ghostery's filter engine (EasyList, EasyPrivacy, uBO unbreak, Peter Lowe's) as the always-on fallback. Static blocklist used until the engine is ready on first / offline launch. |
| Ad blocker dashboard | Native dashboard from the toolbar shield: engine status, filter-list toggles, custom user filters, live log of blocked requests. |
| No cookies | All cookies stripped from responses. Nothing persists between sessions. |
| WebRTC leak prevention | Real IP stays hidden during video/voice (`disable_non_proxied_udp`). |
| Canvas & WebGL spoofing | GPU/rendering fingerprinting blocked. |
| Referrer stripping | Cross-origin `Referer` headers removed. |
| Generic user agent | Spoofs a common Chrome UA and sanitises client hints. |
| DNT + GPC headers | Sends `DNT: 1` and `Sec-GPC: 1` on every request. |
| Per-site padlock | Per-origin toggles for JavaScript (enforced by an injected strict CSP), camera/mic, geolocation and notifications. Sensitive Web APIs (HID, Serial, USB, Bluetooth, MIDI sysex, idle detection, clipboard read, window management, local fonts, storage access) are hard-denied. |
| Clear on exit | All browsing data wiped when the browser closes. |
| Hardened defaults | Background networking, sync, component updates, default apps and Chromium extensions disabled at the command line. |

### Wizard Search

Built-in search aggregated from multiple independent sources. Queries route through a randomised pool of nine SearXNG instances (DuckDuckGo Lite as fallback) **server-side**, so the search request never carries your browser fingerprint and never hits a CORS wall.

Sources: SearXNG, Wikipedia, Wikidata, YouTube (via Piped), Hacker News, Reddit, Archive.org, Stack Overflow, GitHub.

- Knowledge panels from Wikipedia and Wikidata
- Image viewer with copy, download, navigation
- SafeSearch toggle
- No search history kept

### Browser

- Multi-tab: drag to reorder, middle-click to close, `Ctrl+T` / `Ctrl+W`, right-click tab menu
- 10 colour schemes × 6 backgrounds (none, the Frutiger Aero gradient, 3 built-in wallpapers, or your own image), plus sharp-edges / glossy-UI modifiers and a Win7 layout
- Animated splash screen on boot
- Back / Forward / Reload / Home
- Smart URL bar (auto-detects URLs vs. search queries)
- Block counter on the toolbar shield
- Bookmarks (`Ctrl+B`)
- Downloads (`Ctrl+J`)
- Customisable speed dial
- PIN lock on launch
- Manual CLEAR button to wipe session data
- Right-click context menu: copy, paste, **"Search Wizard for…"** the selection, bookmark page / link, copy image, **view page source**, inspect element
- Auto-updater (checks GitHub Releases on startup, installs on quit; opt-out in Settings → Updates)

### Tor

Wizard detects an existing Tor daemon at `127.0.0.1:9050` (your own Tor service, or the standalone Tor Browser-less daemon). If one isn't running it falls back to a **bundled `tor` binary** — the official Tor Expert Bundle is fetched at CI build time and shipped inside every Windows and Linux release — spawned on port `9151` with its own data directory and `torrc`.

Two routing modes:

- **`.onion`-only (default)** — a PAC script sends only `*.onion` hosts through Tor. Everything else stays DIRECT.
- **Full traffic** — flip the toggle and *all* traffic routes through `socks5://127.0.0.1:<port>`.

A built-in `onionMap` for DuckDuckGo, Proton Mail, Facebook, Twitter/X, NYT, BBC, Reddit, GitHub and Archive.org auto-surfaces the `.onion` version of the site you're on. If a `.onion` load fails the UI tells you Tor isn't reachable instead of showing a blank error.

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
- Hardened install path: size / file-count capped, zip-slip-validated, manifest-checked, privilege flags stripped before write.

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

> macOS code paths exist in the source (hidden-inset title bar, etc.) so `npm start` runs on a Mac, but no signed `.dmg` is built — Windows and Linux are the only shipped targets.

## Build

Windows:

```bash
npm run build:win
```

Outputs `dist/WizardBrowser-Setup-x.x.x.exe` (NSIS installer; the bundled Tor binary lives under `resources/tor/` in the installed app, fetched into `./tor/` at build time by CI).

Linux:

```bash
npm run build:linux
```

Outputs `dist/Wizard-Browser-x.x.x.AppImage` and `.deb`.

Both targets are also built automatically on tag push via the `.github/workflows/build.yml` GitHub Action, which is what feeds the auto-updater.

## Windows SmartScreen

On first run, Windows may show "Windows protected your PC". This is expected for unsigned open-source software. Click "More info" → "Run anyway".

## Project layout

```
wizard-browser/
├── main.js                 Electron main (privacy, sessions, adblock, Tor, store, IPC, updater)
├── config.js               Supabase URL + publishable key for the Extension Store
├── preload.js              Preload bridge for the browser shell
├── preload-search.js       Preload injected into every inner page + every webview
├── browser.html            Browser shell (tab bar, toolbar, padlock)
├── search.html             Wizard Search homepage
├── settings.html           Settings panel
├── extensions.html         Extension manager + store
├── ubo-dashboard.html      Native ad blocker dashboard
├── splash.html             Boot splash
├── built-in-extensions/    Extensions auto-extracted on first run
├── tracker-list.json       Static fallback blocklist
├── backgrounds/            Built-in wallpapers
├── .github/                CI workflow + Tor-fetch script
├── build/                  Installer icons + art-generation script
├── package.json
└── logo.png / thumbnail.png
```

## Credits

- MrBlight — contributor
- [SearXNG](https://searxng.org/), [Wikipedia](https://wikipedia.org/), [Wikidata](https://www.wikidata.org/), [Piped](https://github.com/TeamPiped/Piped) for search
- [gorhill/uBlock](https://github.com/gorhill/uBlock) and [Ghostery's adblocker engine](https://github.com/ghostery/adblocker)
- [The Tor Project](https://www.torproject.org/)
- [Electron](https://www.electronjs.org/)

## License

[WPL-1.0](./LICENSE) — free as in freedom, not free for profit. Originally by NaniIsNano.
