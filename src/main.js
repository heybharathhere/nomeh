/* Bootstrap.
 *
 * Order matters here. The database must open before any view renders, because
 * every screen reads from it, and the failure mode if it does not open is a
 * white page with no explanation. So the boot sequence is explicit and every
 * step has a visible failure state.
 */

import { openDatabase, ensureDefaults } from './db/database.js';
import { Profile } from './db/repos.js';
import { loadPrefs } from './core/prefs.js';
import { route, setNotFound, startRouter } from './core/router.js';
import { el, toast, card, callout } from './core/ui.js';
import { capabilities } from './core/capabilities.js';

import { onboardingView } from './features/onboarding.js';
import { todayView } from './features/today.js';
import { logView } from './features/log.js';
import { timelineView } from './features/timeline.js';
import { bodyView } from './features/body.js';
import { settingsView } from './features/settings.js';

boot();

async function boot() {
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

  await loadPrefs();
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

  setNotFound(async () => {
    if (!(await Profile.exists())) return onboardingView();
    return card('Nothing here', {},
      el('p', { style: { color: 'var(--text-dim)', fontSize: '.9rem' } },
        'That address does not match a screen in this build.'),
      el('a', { class: 'btn btn-primary btn-sm', href: '#/today' }, 'Back to Today')
    );
  });
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
