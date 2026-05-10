// Wizard Adblocker — built-in extension
// Draws a shield button on the toolbar with a live blocked-request badge.
// The blocking engine itself is native (Ghostery / uBO filter engine);
// this extension is the user-facing surface.

let cachedStatus = null;
let lastRendered = -1;

const btn = wizard.ui.addButton({
  icon: '🛡',
  tooltip: 'Wizard Adblocker',
  onClick: async () => {
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
    wizard.ui.notify(
      `Wizard Adblocker · ${filters} rules · ${blocked.toLocaleString()} blocked this session`,
      { type: 'success', duration: 4000 }
    );
  }
});

function tooltipFor(s) {
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
    btn.setTooltip(tooltipFor(cachedStatus));
  } catch {}
}

if (wizard.adblock.onStatus) {
  wizard.adblock.onStatus((s) => {
    cachedStatus = s;
    btn.setTooltip(tooltipFor(s));
  });
}

syncStatus();
refreshBadge();
setInterval(refreshBadge, 1500);

if (wizard.page && wizard.page.onNavigate) {
  wizard.page.onNavigate(() => refreshBadge());
}
