// Wizard Adblocker — built-in extension
// Draws a 🛡 button on the toolbar with the live blocked-request badge.
// The blocking engine itself is native — either gorhill's real uBlock
// Origin (when installed) or the Ghostery filter engine (always-on
// safety net). This extension is the user-facing surface for whichever
// is currently active.

let cachedStatus = null;
let cachedUbo    = null;
let lastRendered = -1;

const btn = wizard.ui.addButton({
  icon: '🛡',
  tooltip: 'Wizard Adblocker',
  onClick: async () => {
    const ubo = cachedUbo || (wizard.adblock.getUboStatus
      ? await wizard.adblock.getUboStatus()
      : { state: 'idle' });
    // If the real uBO is loaded, jump straight to its popup so the user
    // gets gorhill's actual UI (per-site rules, logger, etc.)
    if (ubo && ubo.state === 'active' && wizard.adblock.openUboPopup) {
      const opened = await wizard.adblock.openUboPopup();
      if (opened) return;
    }
    const s = cachedStatus || await wizard.adblock.getStatus();
    if (!s.enabled) {
      wizard.ui.notify('Tracker blocking is OFF. Turn it on in Settings → Privacy.', { type: 'warn', duration: 4000 });
      return;
    }
    if (!s.ready) {
      wizard.ui.notify('Wizard Adblocker is loading filter lists…', { duration: 3000 });
      return;
    }
    const blocked = await wizard.adblock.getBlockedCount();
    const filters = s.totalFilters ? s.totalFilters.toLocaleString() : '—';
    const engineName = s.source === 'ublock-origin'
      ? "uBlock Origin"
      : 'Wizard Adblocker (Ghostery engine)';
    wizard.ui.notify(
      `${engineName} · ${filters} rules · ${blocked.toLocaleString()} blocked this session`,
      { type: 'success', duration: 4000 }
    );
  }
});

function tooltipFor(s, ubo) {
  if (ubo && ubo.state === 'active') {
    return 'uBlock Origin — click to open popup' + (ubo.version ? ' (v' + ubo.version + ')' : '');
  }
  if (!s || !s.enabled) return 'Wizard Adblocker — disabled';
  if (!s.ready)         return 'Wizard Adblocker — loading filter lists…';
  const filters = s.totalFilters ? s.totalFilters.toLocaleString() : '—';
  return `Wizard Adblocker — ${filters} rules · ${s.source || 'static'}`;
}

async function refreshBadge() {
  try {
    const n = await wizard.adblock.getBlockedCount();
    if (n === lastRendered) return;
    lastRendered = n;
    if (typeof n === 'number' && n > 0) {
      const label = n < 1000  ? String(n)
                  : n < 10000 ? (Math.floor(n / 100) / 10).toFixed(1) + 'k'
                  : Math.floor(n / 1000) + 'k';
      btn.setBadge(label);
    } else {
      btn.setBadge('');
    }
  } catch {}
}

async function syncStatus() {
  try {
    cachedStatus = await wizard.adblock.getStatus();
    if (wizard.adblock.getUboStatus) cachedUbo = await wizard.adblock.getUboStatus();
    btn.setTooltip(tooltipFor(cachedStatus, cachedUbo));
  } catch {}
}

if (wizard.adblock.onStatus) {
  wizard.adblock.onStatus((s) => {
    cachedStatus = s;
    btn.setTooltip(tooltipFor(s, cachedUbo));
  });
}
if (wizard.adblock.onUboStatus) {
  wizard.adblock.onUboStatus((u) => {
    cachedUbo = u;
    btn.setTooltip(tooltipFor(cachedStatus, u));
  });
}

syncStatus();
refreshBadge();
setInterval(refreshBadge, 1500);

if (wizard.page && wizard.page.onNavigate) {
  wizard.page.onNavigate(() => refreshBadge());
}
