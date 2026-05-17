; Custom NSIS hooks for the Wizard Browser installer.
;
; electron-builder lets us drop in named macros that its template calls at the
; right moments. We use this to suppress the default "Installing, please wait…"
; progress dialog entirely — the branded experience lives in splash.html
; (which the app shows the moment it launches), not in a 1990s GDI dialog.
;
; Flow with this hook:
;   user double-clicks WizardBrowser-Setup-x.y.z.exe
;       ↓
;   NSIS extracts + installs silently (no window, no progress bar)
;       ↓
;   runAfterFinish (set in package.json) launches the app
;       ↓
;   Electron paints splash.html — first thing the user actually sees
;
; This is the same UX Discord/Slack/Notion/VSCode use on Windows.

!macro customInit
  ; Force the installer into silent mode. Equivalent to passing /S on the
  ; command line, but applied to user-double-click launches too.
  SetSilent silent
!macroend

!macro customUnInit
  ; Same treatment for uninstall — no UI flash when removing the app.
  SetSilent silent
!macroend
