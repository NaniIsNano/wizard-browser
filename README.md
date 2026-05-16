<div align="center">
  <img src="logo.png" width="140" alt="Wizard Browser Logo" />

  # Wizard Browser

  **A libre, privacy-focused browser with a built-in search engine that doesn't track you.**

  [![License: WPL-1.0](https://img.shields.io/badge/License-WPL--1.0-7c3aed?style=flat-square)](./LICENSE)
  [![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-a855f7?style=flat-square)](#install)
  [![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-47848f?style=flat-square&logo=electron)](https://www.electronjs.org/)
  [![Version](https://img.shields.io/badge/Version-2.13.0-22c55e?style=flat-square)](#install)
  [![Website](https://img.shields.io/badge/Website-wizardbrowser.netlify.app-7c3aed?style=flat-square&logo=netlify)](https://wizardbrowser.netlify.app/)

  *No tracking. No cookies. No logs.*

  **[🌐 Wizard Browser](https://wizardbrowser.netlify.app/)**

  **[🧩 Wizard Extension Store](https://wizardextensionstore.netlify.app/)**

  <br/>

  <img src="thumbnail.png" width="860" alt="Wizard Browser — interface screenshot" />

</div>

---

## Features

### 🛡️ Privacy

| Feature | Details |
|---|---|
| **Ad & tracker blocking** | Layered engine — real **uBlock Origin** (gorhill MV2, auto-installed & auto-updated) with **Ghostery's filter engine** (EasyList · EasyPrivacy · uBO unbreak · Peter Lowe's) as an always-on safety net, plus a static blocklist fallback for first/offline launch |
| **Ad Blocker dashboard** | Click the 🛡 shield → a Wizard-native dashboard: live engine status, filter-list toggles, custom rules editor, and a live log of blocked requests |
| **No cookies** | All cookies stripped from responses — nothing persists between sessions |
| **WebRTC leak prevention** | Real IP stays hidden even during video/voice |
| **Canvas & WebGL spoofing** | Fingerprinting via GPU/rendering blocked |
| **Referrer stripping** | Cross-origin referrer headers removed |
| **Generic user agent** | Spoofs a common Chrome UA to blend in |
| **DNT + GPC headers** | Sends `DNT: 1` and `Sec-GPC: 1` on every request |
| **Clear on exit** | All browsing data wiped automatically when you close the browser |

### 🔍 Wizard Search Engine

Built-in private search aggregating results from multiple independent sources — no single company controls what you see. Queries route through a pool of SearXNG instances (randomly selected, with DuckDuckGo Lite as fallback) entirely server-side to avoid CORS and fingerprinting.

**Sources:** SearXNG · Wikipedia · YouTube (via Piped) · Hacker News · Reddit · Archive.org · Stack Overflow · GitHub

- Google-style knowledge panels powered by Wikipedia & Wikidata
- Full image viewer with copy, download, and navigation
- SafeSearch toggle
- **Zero search history stored**

### 🌐 Browser

- Clean dark UI with purple accents
- **Multi-tab** — drag to reorder, middle-click to close, `Ctrl+T` / `Ctrl+W`, right-click tab menu
- **Chrome-style theming** — colour scheme and background are independent: **10 colour schemes** (Default, Frutiger, Canola, Mountains, Fortress, Retrowave, Rose, Emerald, Sunset, Monochrome) × **6 backgrounds** (none, 4 built-in wallpapers, or your own upload), plus sharp-edges / glossy-UI modifiers and a Win7 layout
- Back / Forward / Reload / Home navigation
- URL bar with smart navigation (auto-detects URLs vs. search queries)
- Live **block counter** on the 🛡 shield — click it for the Ad Blocker dashboard
- **Bookmarks** manager with panel (`Ctrl+B`)
- **Download** manager (`Ctrl+J`)
- **Speed dial** — customizable homepage shortcuts
- One-click **Tor** routing via SOCKS5 proxy (auto-suggests `.onion` versions of major sites)
- **PIN lock** — require a PIN code on every launch
- Manual **CLEAR** button to wipe all session data on demand
- Right-click context menu: copy, paste, search selection, bookmark page/link, inspect element
- **Auto-updater** — checks GitHub Releases on startup and installs updates on quit

### 🧩 WizardScript — Native Extension API

Build extensions in plain JavaScript using the `wizard.*` namespace. No build step, no manifest v3 ceremony — a `wizard.json` + a single JS file. Drop a folder into the **Extensions** panel and it goes live without a restart.

- `wizard.page` — `getURL`, `getTitle`, `injectCSS`, `injectScript`, `onNavigate`, `onLoad`
- `wizard.storage` — `get`, `set`, `remove`, `clear` (per-extension scoped)
- `wizard.ui` — `notify`, `getTheme`, `addButton` (inject a toolbar button with badge/icon/tooltip)
- `wizard.privacy` — `getSettings`, `isTrackerBlocked`, `getBlockedCount`
- `wizard.adblock` — `getStatus`, `refresh`, `getBlockedCount`, `onStatus`, `getUboStatus`, `openDashboard` (read-only over the native engines)
- `wizard.net` — `fetch`, `post` (CORS-bypassing main-process proxy)
- Per-extension permission gating via the manifest's `permissions` array
- `match` patterns let extensions target specific URLs (`"*"`, `"https://github.com/*"`, etc.)
- Extensions run in the shell renderer, so callbacks persist across navigations

### 🏪 Extension Store

A community store backed by Supabase, with a built-in install flow — no sideloading required.

- **In-browser:** open **Extensions → Store** for a one-click install of any approved extension straight into Wizard. Installs apply live (no restart) and sit alongside folder-installed ones for the same toggle / uninstall flow.
- **On the web:** browse the full catalogue, read reviews, and **publish your own** at **[wizardextensionstore.netlify.app](https://wizardextensionstore.netlify.app/)** — paste a `wizard.json` + script and the site packages a `.wizext` for you.
- **Hardened install path** — downloads are size/file-count capped, zip-slip-validated, manifest-checked, and stripped of privilege flags before anything is written to disk.

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+L` | Focus URL bar |
| `Alt+←` / `Alt+→` | Back / Forward |
| `F5` | Reload |
| `Ctrl+D` | Bookmark current page |
| `Ctrl+B` | Toggle bookmarks panel |
| `Ctrl+J` | Toggle downloads panel |
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |

---

## Install

> Requires [Node.js](https://nodejs.org/) and npm.

```bash
git clone https://github.com/NaniIsNano/wizard-browser.git
cd wizard-browser
npm install
npm start
```

---

## Build

**Windows**
```bash
npm run build:win
```
Outputs: `dist/Wizard-Browser-Setup-x.x.x.exe` (NSIS installer)

**Linux**
```bash
npm run build:linux
```
Outputs: `dist/Wizard-Browser-x.x.x.AppImage` and `.deb`

> Built executables are output to `dist/`.

---

## Project Structure

```
wizard-browser/
├── main.js                 # Electron main — privacy, sessions, adblock, store, IPC, updater
├── config.js               # Supabase URL + publishable key for the Extension Store
├── preload.js              # Preload bridge for the browser shell
├── preload-search.js       # Preload injected into every inner page via session
├── browser.html            # Browser shell UI (tab bar, toolbar, chrome)
├── search.html             # Wizard Search engine UI (homepage)
├── settings.html           # Settings panel UI (layout / theme / privacy / updates)
├── extensions.html         # WizardScript manager + Extension Store tab
├── ubo-dashboard.html      # Wizard-native Ad Blocker dashboard (the 🛡 shield)
├── built-in-extensions/    # Bundled extensions auto-extracted on first run
├── tracker-list.json       # Static fallback blocklist (first/offline launch)
├── backgrounds/            # Built-in theme background images
├── package.json
└── logo.png / thumbnail.png
```

---

## ⚠️ Windows SmartScreen Warning

When running the `.exe` for the first time, Windows may show a *"Windows protected your PC"* warning. This is expected for unsigned open-source software.

Click **"More info"** → **"Run anyway"** to proceed. The full source code is open and auditable on GitHub.

---

## Credits

- **MrBlight** — Project contributor
- Search powered by [SearXNG](https://searxng.org/), [Wikipedia](https://wikipedia.org/), [Wikidata](https://www.wikidata.org/), [Piped](https://github.com/TeamPiped/Piped), and other open APIs
- Built with [Electron](https://www.electronjs.org/)

---

## License

Licensed under the **[Wizard Public License 1.0 (WPL-1.0)](./LICENSE)** — free as in freedom, not free for profit.

> Based on Wizard Browser — originally created by NaniIsNano.
