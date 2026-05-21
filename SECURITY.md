# Security Policy

Wizard Browser is an Electron-based privacy browser that renders untrusted web content. Security reports are taken seriously.

## Reporting a vulnerability

**Please do not file public issues for security bugs.** Coordinated disclosure protects users.

Use one of these channels:

- **GitHub Security Advisories** (preferred): open a private report at
  <https://github.com/NaniIsNano/wizard-browser/security/advisories/new>
- **Email**: `naniis@nano.dev`

Please include:

- The Wizard Browser version (`Settings → About`)
- Operating system and OS version
- A clear description of the issue, including a reproduction or proof of concept if you have one
- Whether you have already disclosed this to anyone else

We'll acknowledge receipt within **72 hours** and aim to ship a patch within **7 days** for critical issues. You'll be credited in the release notes unless you ask not to be.

## Scope

In scope:

- The Wizard Browser desktop application (main process, renderer, preload, IPC surface)
- The bundled WizardScript extension runtime and the extension-install hardening path
- The auto-updater
- The `wizardbrowser.netlify.app` and `privacywizard.net` websites
- The Wizard Extension Store backend

Out of scope:

- Vulnerabilities in upstream Chromium / Electron itself — please report those directly to the Electron project. We'll bump our Electron version as soon as a patched release is published.
- Vulnerabilities in third-party extensions hosted in the Extension Store (please report those to the extension author).
- Social-engineering, phishing, or denial-of-service attacks that don't involve a code-level bug.
- Issues in self-hosted Tor (please report those to the Tor Project).

## Threat model summary

For context, here's what Wizard Browser explicitly defends against and where the trust boundaries are:

| Threat | Defense |
|---|---|
| Trackers, ads, fingerprinting on the open web | uBlock Origin (real) + Ghostery's filter engine fallback + static blocklist. Canvas / WebGL spoofing, WebRTC IP leak prevention, generic UA, referrer stripping, DNT + GPC headers. |
| Cookie persistence across sessions | All cookies stripped from responses; `clear-on-exit` wipes session data on quit. |
| Malicious or compromised websites attempting JS-driven attacks against the user | Per-site `javascript: off` toggle enforced via injected strict CSP. Hard-deny on sensitive Web APIs (HID, Serial, USB, Bluetooth, MIDI sysex, idle detection, clipboard read, window management, local fonts, storage access). |
| Malicious extension uploaded to the store | Install path size/file-count capped, zip-slip-validated, manifest-checked, privilege flags stripped before write. Extensions cannot grant themselves permissions they didn't declare. |
| XSS in an internal page escalating to IPC abuse | All internal pages ship a Content-Security-Policy that blocks remote `<script src>` loads, `<object>` / `<embed>` elements, and `<base>` tag hijacking. |
| Navigation to privileged schemes via `window.open` or `location.href` | URL scheme allowlist (`http`, `https`, `about`) on the webview-popup and `will-navigate` handlers. |
| Supply-chain compromise of npm dependencies | Dependabot weekly PRs; `npm audit --audit-level=high` runs on every dependency PR + weekly via CI. Electron bumps tracked on the same cadence. |

For context Wizard does **not** currently sign its Windows or macOS binaries (no Apple Developer / Windows EV cert). Update authenticity therefore rests on GitHub's TLS not being compromised. This is documented in the README and is a known gap; getting code signing in place is on the roadmap.

## Languages

Reports in English get the fastest response.
