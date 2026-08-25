/* Hash router.
 *
 * Hash routing is a deliberate architectural choice, not a shortcut. GitHub
 * Pages serves static files with no rewrite rules, so with History API routing
 * a refresh on /REPO/today returns a 404 from GitHub, not the app. Hash routes
 * are the only form that survives a hard refresh, a shared link and a
 * cold start from the home screen with no server configuration at all.
 */

const routes = new Map();
let currentPath = null;
let notFound = null;

export function route(path, handler) { routes.set(path, handler); }
export function setNotFound(handler) { notFound = handler; }

export function currentRoute() { return currentPath; }

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (replace) history.replaceState(null, '', target);
  else location.hash = path;
  if (replace) render();
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/today';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  return { path, params: new URLSearchParams(queryPart || '') };
}

async function render() {
  const { path, params } = parseHash();
  const view = document.getElementById('view');
  if (!view) return;

  const handler = routes.get(path) || notFound;
  if (!handler) return;

  currentPath = path;
  syncDock(path);

  try {
    const output = await handler({ path, params });
    view.replaceChildren();
    view.className = 'view';
    if (output) view.append(output);
  } catch (err) {
    /* A failing screen must not take the shell down with it (spec: never let
       one subsystem crash the app). The dock stays usable. */
    console.error('[router] view failed:', path, err);
    view.replaceChildren();
    view.append(errorView(path, err));
  }

  /* Move focus to the top of the new view so screen-reader and keyboard users
     are not left at the bottom of the previous page. */
  const main = document.getElementById('main');
  if (main) { main.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

function errorView(path, err) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML =
    '<p class="eyebrow">This screen failed to open</p>' +
    '<p style="color:var(--text-dim);font-size:.9rem">Your data is untouched — the failure is in ' +
    'rendering, not storage. Try another tab, or reload the app.</p>';
  const pre = document.createElement('pre');
  pre.style.cssText = 'overflow:auto;font-size:.72rem;color:var(--text-faint);margin-top:12px';
  pre.textContent = `${path}\n${err?.message || err}`;
  div.append(pre);
  return div;
}

function syncDock(path) {
  const top = `/${path.split('/')[1] || 'today'}`;
  for (const link of document.querySelectorAll('#dock a')) {
    const isCurrent = `/${link.dataset.route}` === top;
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export function refresh() { return render(); }
