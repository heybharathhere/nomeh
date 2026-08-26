/* Bootstrap.
 *
 * Order matters here. The database must open before any view renders, because
 * every screen reads from it, and the failure mode if it does not open is a
 * white page with no explanation. So the boot sequence is explicit and every
 * step has a visible failure state.
 */

import { openDatabase, ensureDefaults, db } from './db/database.js';
import { Profile } from './db/repos.js';
import { loadPrefs } from './core/prefs.js';
import { route, setNotFound, startRouter } from './core/router.js';
import { el, toast, card, callout } from './core/ui.js';
import { capabilities } from './core/capabilities.js';

import { applyBaseTheme, loadAppearance } from './core/appearance.js';
import { installSeeds } from './db/seeds.js';
import { UI, FEATURES, enabled } from './config/app.config.js';

import { onboardingView } from './features/onboarding.js';
import { todayView } from './features/today.js';
import { logView } from './features/log.js';
import { timelineView } from './features/timeline.js';
import { bodyView } from './features/body.js';
import { settingsView } from './features/settings.js';
import { diaryView } from './features/diary.js';
import { trainView } from './features/train.js';
import { enduranceView } from './features/endurance.js';
import { recoveryView } from './features/recovery.js';
import { analyticsView } from './features/analytics.js';
import { photosView } from './features/photos.js';
import { healthImportView } from './features/healthimport.js';

boot();

async function boot() {
  /* Theme first, before any view renders. tokens.css already holds the same
     defaults so the first paint is correct either way, but applying here means
     a changed ACTIVE_PRESET takes effect immediately rather than flashing. */
  applyBaseTheme();

  const caps = capabilities();

  if (caps.missingEssentials.length) {
    return fatal(
      'This browser cannot run NoMeh!',
      caps.missingEssentials.map((c) => c.label).join(', ') + ' unavailable.',
      caps.missingEssentials.map((c) => c.note).filter(Boolean).join(' ') ||
      'A current version of Chrome, Edge, Firefox or Safari over HTTPS is needed.'
    );
  }

  try {
    await openDatabase();
    await ensureDefaults();
    /* Seeds only populate empty tables, so this is safe on every boot and is
       what makes the app usable offline from the first second. */
    await installSeeds(db());
  } catch (err) {
    console.error('[boot] database failed', err);
    return fatal(
      'Could not open the local database',
      err?.name === 'QuotaExceededError'
        ? 'The browser has no room left for this app.'
        : (err?.message || String(err)),
      'Private browsing blocks IndexedDB in some browsers. If this is a private window, ' +
      'try a normal one. If storage is full, free space and reload.'
    );
  }

  await loadAppearance();
  await loadPrefs();
  buildDock();
  wireNetworkStatus();
  wireDatabaseGuard();
  registerRoutes();
  startRouter();
  registerServiceWorker();
}

/* ------------------------------------------------------------ routes ----- */

function registerRoutes() {
  /* Onboarding gate. Every route checks for a profile rather than trusting a
     flag, so a partially completed setup cannot leave the app in a state where
     the calculations have no inputs. */
  const guard = (view) => async (ctx) => {
    if (!(await Profile.exists())) return onboardingView();
    return view(ctx);
  };

  route('/today', guard(todayView));
  route('/log', guard(logView));
  route('/timeline', guard(timelineView));
  route('/body', guard(bodyView));
  route('/settings', guard(settingsView));
  route('/welcome', () => onboardingView());

  /* Feature-gated screens. A disabled feature renders an explanation naming the
     flag rather than 404ing, so a bookmarked link stays comprehensible. */
  const gated = (feature, view) => guard(async (ctx) => {
    if (!enabled(feature)) {
      return card(`${feature} is switched off`, {},
        el('p', { style: { color: 'var(--text-dim)', fontSize: '.9rem' } },
          `FEATURES.${feature} is false in src/config/app.config.js. Set it to true to enable this screen.`),
        el('a', { class: 'btn btn-sm', href: '#/today' }, 'Back to Today'));
    }
    return view(ctx);
  });

  route('/diary', gated('nutrition', diaryView));
  route('/train', gated('strength', trainView));
  route('/endurance', gated('endurance', enduranceView));
  route('/recovery', gated('recovery', recoveryView));
  route('/analytics', gated('analytics', analyticsView));
  route('/photos', gated('photos', photosView));
  route('/import', gated('healthImport', healthImportView));

  setNotFound(async () => {
    if (!(await Profile.exists())) return onboardingView();
    return card('Nothing here', {},
      el('p', { style: { color: 'var(--text-dim)', fontSize: '.9rem' } },
        'That address does not match a screen in this build.'),
      el('a', { class: 'btn btn-primary btn-sm', href: '#/today' }, 'Back to Today')
    );
  });
}

/* -------------------------------------------------------------- dock ----- */

const ICONS = {
  pulse: 'M3 12h4l2-6 3 12 3-9 2 3h4',
  plate: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  plus: 'M12 5v14M5 12h14',
  dumbbell: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  body: 'M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-3 6h6l-1 5 1 5h-2l-1-4-1 4H9l1-5-1-5z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17c6 0 8-2 8-6',
  moon: 'M20 14a8 8 0 1 1-9-11 7 7 0 0 0 9 11z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};

/* The dock is generated rather than written into index.html, so turning a
   feature off in config genuinely removes its tab instead of leaving a link to
   a screen that explains it is disabled. */
function buildDock() {
  const dock = document.getElementById('dock');
  if (!dock) return;

  const items = UI.nav.filter((item) => enabled(item.feature));
  const inner = el('div', { class: 'dock-inner' });

  for (const item of items) {
    const path = ICONS[item.icon] ?? ICONS.pulse;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.8');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);

    inner.append(el('a', {
      href: `#/${item.route}`,
      dataset: { route: item.route },
      class: item.primary ? 'log-action' : '',
      'aria-label': item.label,
    }, svg, item.primary ? null : el('span', {}, item.label)));
  }

  dock.replaceChildren(inner);
}

/* ------------------------------------------------------------ status ----- */

function wireNetworkStatus() {
  const pill = document.getElementById('net');
  const label = document.getElementById('net-label');
  if (!pill || !label) return;

  const sync = () => {
    const online = navigator.onLine;
    pill.dataset.state = online ? 'online' : 'offline';
    label.textContent = online ? 'Online' : 'Offline';
    pill.title = online
      ? 'Connected. NoMeh! still stores everything locally.'
      : 'No connection. Everything continues to work.';
  };

  window.addEventListener('online', () => { sync(); toast('Back online. Nothing was waiting to sync — there is no sync.', { tone: 'cyan' }); });
  window.addEventListener('offline', () => { sync(); toast('Offline. Carry on.', { tone: 'cyan' }); });
  sync();
}

/* Another tab upgraded the schema. Running against a closed handle would throw
   on the next read, so ask for a reload instead of failing silently. */
function wireDatabaseGuard() {
  window.addEventListener('nomeh:db-superseded', () => {
    toast('Another tab updated the database. Reload to continue.', {
      tone: 'amber', timeout: 0, action: 'Reload', onAction: () => location.reload()
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || String(e.reason || '');
    if (/QuotaExceeded|quota/i.test(msg)) {
      toast('Storage is full. Export a backup and clear space before logging more.',
        { tone: 'crimson', timeout: 0 });
    }
    console.error('[unhandled]', e.reason);
  });
}

/* ------------------------------------------------------ service worker --- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  /* Relative registration keeps the scope at the repository subdirectory, which
     is what GitHub Pages serves from. An absolute '/sw.js' would 404 there. */
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const incoming = reg.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        /* An update is only worth announcing if a worker is already in control;
           otherwise this is the very first install and there is nothing to
           interrupt. */
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of NoMeh! is ready.', {
            tone: 'violet', timeout: 0, action: 'Update now',
            onAction: () => { reg.waiting?.postMessage('skip-waiting'); }
          });
        }
      });
    });
  }).catch((err) => {
    console.warn('[sw] registration failed', err);
    toast('Offline support could not be enabled. The app works, but needs a connection to load.',
      { tone: 'amber', timeout: 9000 });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/* ------------------------------------------------------------ fatal ------ */

function fatal(title, detail, advice) {
  const view = document.getElementById('view');
  if (!view) return;
  view.className = 'boot';
  view.replaceChildren(
    el('div', { class: 'stack', style: { maxWidth: '480px' } },
      el('p', { class: 'eyebrow' }, 'Cannot start'),
      el('h1', { style: { fontSize: '1.5rem' } }, title),
      el('p', { style: { color: 'var(--text-dim)', fontSize: '.9rem' } }, detail),
      callout(advice, { tone: 'amber' }),
      el('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Try again')
    )
  );
  document.getElementById('dock')?.setAttribute('hidden', '');
}
