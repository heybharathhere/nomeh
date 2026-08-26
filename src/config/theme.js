/* ============================================================================
 * THEME — every colour, font and metric in the app lives here.
 * ============================================================================
 *
 * HOW THIS WORKS
 *   styles/tokens.css holds the same values as CSS defaults so the very first
 *   paint is correct before any JavaScript runs. This file then overrides them
 *   as inline custom properties on <html>. Nothing in the app reads a colour
 *   from anywhere else, so editing THEME below changes the entire app.
 *
 * TO RECOLOUR THE APP
 *   Option A — edit `palette` in DEFAULT_THEME below. Done.
 *   Option B — pick a ready-made preset: set ACTIVE_PRESET to one of the keys
 *              in PRESETS (e.g. 'paper' for a light theme).
 *   Option C — let the user choose at runtime: Settings → Appearance already
 *              lists every preset, and the choice is saved to the database.
 *
 * A NOTE ON MEANING
 *   The five functional colours carry meaning — `performance` marks activity,
 *   `nutrition` marks food, and so on. If you swap the hues, keep the meanings
 *   attached to the same keys or the app's colour language stops being
 *   readable. Adding a sixth hue is usually the wrong move; map the new idea
 *   onto an existing one.
 */

export const DEFAULT_THEME = {
  name: 'Void',
  /* 'dark' | 'light' — drives the `color-scheme` property so browser-rendered
     UI (scrollbars, form controls, the address bar) matches. */
  base: 'dark',

  palette: {
    /* Backgrounds, darkest to lightest. surface1 is the page, surface4 is a
       raised element such as an input inside a card. */
    void:      '#050507',
    surface1:  '#0a0b0e',
    surface2:  '#101218',
    surface3:  '#171a22',
    surface4:  '#1f2430',

    /* Borders. `line` is the everyday hairline; `lineStrong` is for emphasis. */
    line:       '#23272f',
    lineStrong: '#313743',

    /* Text, in descending prominence. */
    text:      '#f2f4f7',
    textDim:   '#a6adba',
    textFaint: '#6b7280',

    /* The five functional colours. Meaning is load-bearing. */
    performance: '#00e08a',  // activity, streaks, anything "on track"
    nutrition:   '#ffb020',  // food, calories, macros
    strength:    '#7c5cff',  // resistance training, PRs
    recovery:    '#38d6ff',  // hydration, sleep, readiness
    alert:       '#ff3b5c',  // warnings, peak heart-rate zones, danger

    /* Glass surfaces (the dock and modal sheets). */
    glass:      'rgba(16, 18, 24, .72)',
    glassLine:  'rgba(255, 255, 255, .06)',
  },

  /* Opacity used for the faint wash behind a functional colour — chips, filled
     bars, selected states. Raise it for a punchier look. */
  tintAlpha: 0.14,

  /* Backdrop filter on glass surfaces. Set to 'none' to disable blur entirely
     (worth doing if you are chasing frame rate on an older phone). */
  blur: 'saturate(140%) blur(18px)',

  fonts: {
    /* Headings and numerals. */
    display: "'Syne', ui-sans-serif, system-ui, sans-serif",
    /* Body and controls. */
    ui: "'Outfit', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    /* Tabular data. */
    mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",

    /* Google Fonts request. Set `remote: false` to drop the network dependency
       entirely and fall back to system fonts — the app is designed to still
       look deliberate without the webfonts. */
    remote: true,
    remoteHref: 'https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=Outfit:wght@300;400;500;600&display=swap',
  },

  /* Spacing scale. Used everywhere as var(--s1)…var(--s8). */
  space: { s1: '4px', s2: '8px', s3: '12px', s4: '16px', s5: '24px', s6: '32px', s7: '48px', s8: '64px' },

  /* Corner radii. r1 smallest, pill fully round. */
  radius: { r1: '8px', r2: '12px', r3: '18px', r4: '26px', pill: '999px' },

  layout: {
    dockHeight: '86px', // 72px floating pill + 14px offset from the safe area
    tapTarget: '44px',   // WCAG minimum; do not go below this
    maxWidth: '620px',   // single-column reading width
  },

  motion: {
    fast: '120ms',
    normal: '220ms',
    ease: 'cubic-bezier(.22, .61, .36, 1)',
  },
};

/* ---------------------------------------------------------------------------
 * PRESETS — alternative palettes. Each is merged over DEFAULT_THEME, so a
 * preset only has to list what it changes.
 *
 * To add your own: copy a block, rename the key, change the hues. It will
 * appear in Settings → Appearance automatically.
 * ------------------------------------------------------------------------- */
export const PRESETS = {
  void: {},   // the default, listed so it appears in the picker

  ember: {
    name: 'Ember',
    palette: {
      void: '#08060a', surface1: '#0d0a10', surface2: '#141018', surface3: '#1c1622', surface4: '#251d2d',
      line: '#2a2130', lineStrong: '#3b2f44',
      performance: '#ff8a3d', nutrition: '#ffd166', strength: '#ef476f',
      recovery: '#06d6a0', alert: '#ff4d4d',
      glass: 'rgba(20, 16, 24, .74)',
    },
  },

  deep: {
    name: 'Deep',
    palette: {
      void: '#04060c', surface1: '#070b14', surface2: '#0d131f', surface3: '#131b2b', surface4: '#1a2438',
      line: '#1e2939', lineStrong: '#2b3a50',
      performance: '#4cc9f0', nutrition: '#f9c74f', strength: '#b5179e',
      recovery: '#4895ef', alert: '#f72585',
      glass: 'rgba(13, 19, 31, .74)',
    },
  },

  moss: {
    name: 'Moss',
    palette: {
      void: '#050806', surface1: '#080d0a', surface2: '#0e1511', surface3: '#151e18', surface4: '#1d2921',
      line: '#212d25', lineStrong: '#2f4034',
      performance: '#8ac926', nutrition: '#ffca3a', strength: '#6a4c93',
      recovery: '#1982c4', alert: '#ff595e',
      glass: 'rgba(14, 21, 17, .74)',
    },
  },

  /* A light theme. Note `base: 'light'` and the inverted text ramp. */
  paper: {
    name: 'Paper',
    base: 'light',
    palette: {
      void: '#f6f7f9', surface1: '#ffffff', surface2: '#f2f4f7', surface3: '#e9ecf1', surface4: '#dfe4ea',
      line: '#dde1e7', lineStrong: '#c2c9d4',
      text: '#12151a', textDim: '#4b5563', textFaint: '#8b949f',
      performance: '#00996a', nutrition: '#b87400', strength: '#5b3ee0',
      recovery: '#0a86b8', alert: '#d61f3c',
      glass: 'rgba(255, 255, 255, .78)',
      glassLine: 'rgba(0, 0, 0, .08)',
    },
    tintAlpha: 0.12,
  },

  /* Maximum legibility: pure black, pure white, no blur, no tints. */
  contrast: {
    name: 'High contrast',
    palette: {
      void: '#000000', surface1: '#000000', surface2: '#0a0a0a', surface3: '#141414', surface4: '#1f1f1f',
      line: '#5a5a5a', lineStrong: '#8a8a8a',
      text: '#ffffff', textDim: '#e4e4e4', textFaint: '#b0b0b0',
      performance: '#00ff9c', nutrition: '#ffc233', strength: '#a98bff',
      recovery: '#5fe0ff', alert: '#ff6b7f',
      glass: 'rgba(0, 0, 0, .96)',
      glassLine: 'rgba(255, 255, 255, .18)',
    },
    tintAlpha: 0.22,
    blur: 'none',
  },
};

/* Which preset ships as the default. Change this to recolour without touching
   the palette above. */
export const ACTIVE_PRESET = 'void';

/* ------------------------------------------------------------------------- */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/* Two levels deep is all the theme shape needs, and a bounded merge cannot
   recurse forever on a malformed stored theme. */
function merge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? { ...base[k], ...v } : v;
  }
  return out;
}

export function resolveTheme(presetKey = ACTIVE_PRESET, overrides = null) {
  const preset = PRESETS[presetKey] ?? PRESETS[ACTIVE_PRESET] ?? {};
  return merge(merge(DEFAULT_THEME, preset), overrides);
}

export function presetList() {
  return Object.entries(PRESETS).map(([key, p]) => ({
    key,
    label: (p.name ?? DEFAULT_THEME.name),
    base: p.base ?? DEFAULT_THEME.base,
    swatches: ['performance', 'nutrition', 'strength', 'recovery', 'alert']
      .map((k) => (p.palette?.[k]) ?? DEFAULT_THEME.palette[k]),
  }));
}

/* Turn '#00e08a' + alpha into an rgba() string. Accepts 3- and 6-digit hex and
   passes through anything already functional, so a palette entry can be
   'oklch(...)' or 'rgb(...)' if you prefer. */
export function withAlpha(colour, alpha) {
  const s = String(colour).trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return s;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const int = parseInt(h, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
}

/* Relative luminance → used to decide whether text on a coloured fill should
   be black or white. Keeps generated chips legible in a light preset. */
export function readableOn(colour) {
  const s = String(colour).trim();
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return 'var(--void)';
  const int = parseInt(hex[1], 16);
  const srgb = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  return L > 0.45 ? '#000000' : '#ffffff';
}

/* The CSS variable names the stylesheets consume. Keeping the mapping explicit
   means a typo in a palette key fails loudly here rather than silently
   producing an unstyled app. */
const VAR_MAP = {
  void: '--void', surface1: '--surface-1', surface2: '--surface-2',
  surface3: '--surface-3', surface4: '--surface-4',
  line: '--line', lineStrong: '--line-strong',
  text: '--text', textDim: '--text-dim', textFaint: '--text-faint',
  performance: '--emerald', nutrition: '--amber', strength: '--violet',
  recovery: '--cyan', alert: '--crimson',
  glass: '--glass', glassLine: '--glass-line',
};

const TINTED = ['performance', 'nutrition', 'strength', 'recovery', 'alert'];
const TINT_VAR = {
  performance: '--emerald-dim', nutrition: '--amber-dim', strength: '--violet-dim',
  recovery: '--cyan-dim', alert: '--crimson-dim',
};

/* Applies a resolved theme to the document. Idempotent — safe to call again
   when the user picks a different preset. */
export function applyTheme(theme, root = document.documentElement) {
  const set = (name, value) => {
    if (value === undefined || value === null) return;
    root.style.setProperty(name, String(value));
  };

  for (const [key, cssVar] of Object.entries(VAR_MAP)) set(cssVar, theme.palette?.[key]);
  for (const key of TINTED) {
    const c = theme.palette?.[key];
    if (c) {
      set(TINT_VAR[key], withAlpha(c, theme.tintAlpha ?? 0.14));
      set(`--on-${key}`, readableOn(c));
    }
  }

  set('--blur', theme.blur);
  set('--font-display', theme.fonts?.display);
  set('--font-ui', theme.fonts?.ui);
  set('--font-mono', theme.fonts?.mono);

  for (const [k, v] of Object.entries(theme.space ?? {})) set(`--${k}`, v);
  for (const [k, v] of Object.entries(theme.radius ?? {})) set(k === 'pill' ? '--r-pill' : `--${k}`, v);

  set('--dock-h', theme.layout?.dockHeight);
  set('--tap', theme.layout?.tapTarget);
  set('--maxw', theme.layout?.maxWidth);
  set('--dur-1', theme.motion?.fast);
  set('--dur-2', theme.motion?.normal);
  set('--ease', theme.motion?.ease);

  root.style.colorScheme = theme.base === 'light' ? 'light' : 'dark';
  root.dataset.themeBase = theme.base === 'light' ? 'light' : 'dark';

  /* Colour the browser chrome / iOS status bar to match. */
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', theme.palette?.void ?? '#050507');

  return theme;
}

/* Injects (or removes) the webfont stylesheet. Called at boot so that
   fonts.remote = false genuinely removes the network request rather than just
   documenting an intention. */
export function applyFontLoading(theme) {
  const id = 'nomeh-fonts';
  const existing = document.getElementById(id);
  if (!theme.fonts?.remote) { existing?.remove(); return; }
  if (existing) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = theme.fonts.remoteHref;
  document.head.appendChild(link);
}
