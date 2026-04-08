# Wizard Browser

A libre, privacy-focused browser with a built-in search engine that doesn't track you.

**Free software, free as in freedom.**

## Features

**Privacy**
- No cookies persisted (all stripped from responses)
- No tracking — 85+ known trackers blocked at network level
- WebRTC leak prevention
- Canvas/WebGL fingerprinting disabled
- Referrer stripped on cross-origin requests
- Generic user agent spoofing
- All browsing data cleared on exit

**Search Engine (Wizard Search)**
- Aggregates results from SearXNG (private metasearch), Wikipedia, YouTube (via Piped), Hacker News, Reddit, Archive.org, Stack Overflow, and GitHub
- Google-style knowledge panels with bio info from Wikipedia + Wikidata
- Image search with full viewer (copy, download, navigate)
- SafeSearch toggle
- No search history stored

**Browser**
- Clean dark UI with purple accents
- Back/Forward/Reload/Home navigation
- URL bar with direct navigation
- Live tracker block counter
- Manual "Clear Data" button
- Keyboard shortcuts: `Ctrl+L` (URL bar), `Alt+Left/Right` (back/forward), `F5` (reload)

## Install

```bash
git clone https://github.com/NaniIsNano/wizard-browser.git
cd wizard-browser
npm install
npm start
```

## Build

**Windows:**
```bash
npm run build:win
```

**Linux:**
```bash
npm run build:linux
```

Built executables will be in `dist/`.

## Windows SmartScreen Warning

When running the `.exe` for the first time, Windows may show you a "Windows protected your PC" warning. This is normal for unsigned open-source software — the app is not code-signed. Click **"More info"** then **"Run anyway"** to proceed. The source code is fully open and auditable.

## Credits

- [MrBlight](https://github.com/MrBlight) - Project contributor
- Search powered by SearXNG, Wikipedia, Wikidata, Piped, and other open APIs
- Built with Electron

## License

GPL-3.0
