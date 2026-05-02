<div align="center">
  <img src="logo.png" width="140" alt="Wizard Browser Logo" />

  # Wizard Browser

  **A libre, privacy-focused browser with a built-in search engine that doesn't track you.**

  [![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-7c3aed?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)
  [![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-a855f7?style=flat-square)](#install)
  [![Built with Electron](https://img.shields.io/badge/Built%20with-Electron-47848f?style=flat-square&logo=electron)](https://www.electronjs.org/)
  [![Free Software](https://img.shields.io/badge/Free%20Software-Free%20as%20in%20Freedom-22c55e?style=flat-square)](#license)
  [![Website](https://img.shields.io/badge/Website-wizardbrowser.netlify.app-7c3aed?style=flat-square&logo=netlify)](https://wizardbrowser.netlify.app/)

  *No tracking. No cookies. No logs.*

  **[🌐 wizardbrowser.netlify.app](https://wizardbrowser.netlify.app/)**

  <br/>

  <img src="thumbnail.png" width="860" alt="Wizard Browser — interface screenshot" />

</div>

---

## Features

### 🛡️ Privacy

| Feature | Details |
|---|---|
| **Tracker blocking** | 85+ known tracker & ad domains cancelled at the network level |
| **No cookies** | All cookies stripped from responses — nothing persists between sessions |
| **WebRTC leak prevention** | Real IP stays hidden even during video/voice |
| **Canvas & WebGL spoofing** | Fingerprinting via GPU/rendering blocked |
| **Referrer stripping** | Cross-origin referrer headers removed |
| **Generic user agent** | Spoofs a common Chrome UA to blend in |
| **Clear on exit** | All browsing data wiped automatically when you close the browser |

### 🔍 Wizard Search Engine

Built-in private search that aggregates results from multiple independent sources — no single company controls what you see.

**Sources:** SearXNG · Wikipedia · YouTube (via Piped) · Hacker News · Reddit · Archive.org · Stack Overflow · GitHub

- Google-style knowledge panels powered by Wikipedia & Wikidata
- Full image viewer with copy, download, and navigation
- SafeSearch toggle
- **Zero search history stored**

### 🌐 Browser

- Clean dark UI with purple accents — 9 built-in themes
- Back / Forward / Reload / Home navigation
- URL bar with smart navigation (URL detection, search fallback)
- Live tracker block counter
- Bookmarks manager
- Download manager
- One-click **Tor** routing via SOCKS5 (auto-suggests `.onion` versions of major sites)
- Built-in **IRC** client (#wizard-support)
- **PIN lock** — require a code on every launch
- Manual **CLEAR** button to wipe all data on demand
- Keyboard shortcuts: `Ctrl+L` (URL bar) · `Alt+←/→` (back/forward) · `F5` (reload) · `Ctrl+D` (bookmark) · `Ctrl+B` (bookmarks panel) · `Ctrl+J` (downloads)

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

**Linux**
```bash
npm run build:linux
```

Built executables are output to `dist/`.

---

## ⚠️ Windows SmartScreen Warning

When running the `.exe` for the first time, Windows may show a *"Windows protected your PC"* warning. This is expected for unsigned open-source software — the app is not code-signed.

Click **"More info"** → **"Run anyway"** to proceed. The full source code is open and auditable on GitHub.

---

## Credits

- **MrBlight** — Project contributor
- Search powered by [SearXNG](https://searxng.org/), [Wikipedia](https://wikipedia.org/), [Wikidata](https://www.wikidata.org/), [Piped](https://github.com/TeamPiped/Piped), and other open APIs
- Built with [Electron](https://www.electronjs.org/)

---

## License

**GPL-3.0** — Free software, free as in freedom.
