/* Display preferences.
 *
 * These live on the <html> element as data attributes, which is why the CSS in
 * tokens.css can express "user asked for reduced motion" and "the OS asked for
 * reduced motion" as separate rules. The OS preference wins unless the user has
 * explicitly overridden it here — an override the OS cannot express.
 */

import { allSettings, setSetting } from '../db/database.js';

const ATTR = {
  motion:   'data-motion',
  contrast: 'data-contrast',
  textSize: 'data-text'
};

export function applyPref(key, value) {
  const attr = ATTR[key];
  if (!attr) return;
  document.documentElement.setAttribute(attr, value);
}

export async function loadPrefs() {
  const s = await allSettings();
  applyPref('motion', s.motion ?? 'auto');
  applyPref('contrast', s.contrast ?? 'normal');
  applyPref('textSize', s.textSize ?? 'normal');
  return s;
}

export async function savePref(key, value) {
  applyPref(key, value);
  await setSetting(key, value);
}

export function prefersReducedMotion() {
  const explicit = document.documentElement.getAttribute('data-motion');
  if (explicit === 'reduced') return true;
  if (explicit === 'full') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
