/* Core UI primitives.
 *
 * No framework. `el` is a 30-line hyperscript that covers everything this app
 * needs, which keeps the production bundle at zero dependencies beyond Dexie
 * and means there is no build step between editing a file and seeing it run.
 */

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;                 // only ever used with literals below
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }

  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const frag = (...children) => {
  const f = document.createDocumentFragment();
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    f.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return f;
};

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* Named colour → CSS custom properties, so a component can be tinted by
   meaning ("this is hydration") rather than by hex. */
export function tint(name) {
  const known = ['emerald', 'amber', 'violet', 'cyan', 'crimson'];
  const c = known.includes(name) ? name : 'emerald';
  return `--c: var(--${c}); --c-dim: var(--${c}-dim);`;
}

/* ------------------------------------------------------------ format ----- */

export const fmt = {
  int: (v) => (v == null ? '—' : Math.round(v).toLocaleString()),
  dec: (v, dp = 1) => (v == null ? '—' : Number(v).toFixed(dp)),

  ml: (v) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} L` : `${Math.round(v)} ml`),

  duration: (mins) => {
    if (mins == null) return '—';
    const h = Math.floor(mins / 60), m = Math.round(mins % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  },

  pace: (minsPerKm) => {
    if (minsPerKm == null || !isFinite(minsPerKm)) return '—';
    const m = Math.floor(minsPerKm), s = Math.round((minsPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  time: (ts, clock = '24h') => new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', hour12: clock === '12h'
  }),

  dayLabel: (dateKey) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(`${dateKey}T00:00:00`);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === -1) return 'Yesterday';
    if (diff > -7 && diff < 0) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  },

  bytes: (b) => {
    if (b == null) return 'unknown';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  },

  ago: (ts) => {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
};

/* ------------------------------------------------------------ toast ------ */

export function toast(message, { tone = 'emerald', action, onAction, timeout = 5200 } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;

  const node = el('div', { class: 'toast', style: tint(tone), role: 'status' },
    el('span', { class: 'msg' }, message)
  );

  const dismiss = () => { node.style.opacity = '0'; setTimeout(() => node.remove(), 180); };

  if (action && onAction) {
    node.append(el('button', {
      class: 'btn btn-sm btn-ghost',
      onclick: () => { onAction(); dismiss(); }
    }, action));
  }
  node.append(el('button', {
    class: 'btn btn-sm btn-ghost', 'aria-label': 'Dismiss', onclick: dismiss
  }, '✕'));

  host.append(node);
  if (timeout) setTimeout(dismiss, timeout);
  return dismiss;
}

/* ------------------------------------------------------------ sheet ------ */
/* Modal with focus trapping, Escape to close, and focus returned to whatever
   opened it. Built by hand because a11y is the whole point of the component. */

export function sheet({ title, body, footer, onClose } = {}) {
  const opener = document.activeElement;
  const scrim = el('div', { class: 'sheet-scrim' });
  const panel = el('div', {
    class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog'
  });

  const close = () => {
    scrim.remove(); panel.remove();
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
    if (opener instanceof HTMLElement) opener.focus();
    onClose?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  panel.append(
    el('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
    el('div', { class: 'sheet-head' },
      el('h2', {}, title || ''),
      el('button', { class: 'btn btn-sm btn-ghost spacer', 'aria-label': 'Close', onclick: close }, '✕')
    ),
    body || '',
    footer ? el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, footer) : null
  );

  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  document.body.append(scrim, panel);

  const focusable = panel.querySelector('input, select, textarea, button.btn-primary, button');
  focusable?.focus();

  return { close, panel };
}

/* Destructive confirmation. `phrase` forces the user to type a word for the
   irreversible cases — spec §27 asks for exactly this distinction between
   clearing a cache and deleting a life's worth of records. */
export function confirmDestructive({ title, message, confirmLabel = 'Delete', phrase = null, onConfirm }) {
  const input = phrase
    ? el('input', { class: 'input', placeholder: `Type ${phrase}`, 'aria-label': `Type ${phrase} to confirm` })
    : null;

  const go = el('button', {
    class: 'btn btn-danger', disabled: !!phrase,
    onclick: () => { ref.close(); onConfirm(); }
  }, confirmLabel);

  if (input) {
    input.addEventListener('input', () => {
      go.disabled = input.value.trim().toUpperCase() !== phrase.toUpperCase();
    });
  }

  const ref = sheet({
    title,
    body: el('div', { class: 'stack' },
      el('p', { style: { margin: 0, color: 'var(--text-dim)', fontSize: '.9rem' } }, message),
      input
    ),
    footer: frag(
      el('button', { class: 'btn btn-ghost', onclick: () => ref.close() }, 'Cancel'),
      el('span', { class: 'spacer' }),
      go
    )
  });
  return ref;
}

/* ------------------------------------------------------------ pieces ----- */

export function metricBar({ name, value, target, unit = '', colour = 'emerald', decimals = 0 }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target * 1.05;
  return el('div', { class: 'metric', style: tint(colour) },
    el('div', { class: 'metric-top' },
      el('span', { class: 'metric-name' }, name),
      el('span', { class: 'metric-val' },
        decimals ? fmt.dec(value, decimals) : fmt.int(value),
        target ? el('small', {}, ` / ${decimals ? fmt.dec(target, decimals) : fmt.int(target)} ${unit}`)
               : el('small', {}, ` ${unit}`)
      )
    ),
    el('div', {
      class: 'bar', dataset: { over: String(over) },
      role: 'progressbar', 'aria-label': `${name}: ${Math.round(value)} of ${Math.round(target || 0)} ${unit}`,
      'aria-valuenow': Math.round(value), 'aria-valuemin': '0', 'aria-valuemax': Math.round(target || 100)
    }, el('i', { style: { width: `${pct}%` } }))
  );
}

export function card(titleText, { note, actions } = {}, ...children) {
  const head = titleText
    ? el('div', { class: 'card-head' },
        el('h2', {}, titleText),
        note ? el('span', { class: 'card-note spacer' }, note) : null,
        actions ? el('span', { class: note ? '' : 'spacer' }, actions) : null)
    : null;
  return el('section', { class: 'card' }, head, ...children);
}

export function callout(text, { tone = 'cyan', strongText } = {}) {
  return el('div', { class: 'callout', style: tint(tone) },
    strongText ? el('strong', {}, strongText) : null,
    el('span', {}, text)
  );
}

export function field(label, control, hint) {
  const id = control.id || `f${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return el('div', { class: 'field' },
    el('label', { for: id }, label),
    control,
    hint ? el('span', { class: 'hint' }, hint) : null
  );
}

export function emptyState({ title, message, action }) {
  return el('div', { class: 'empty' },
    el('h3', {}, title),
    el('p', {}, message),
    action || null
  );
}
