/* Appearance: the bridge between the theme configuration and the running app.
 *
 * Kept separate from prefs.js because the two answer different questions.
 * prefs.js handles accessibility settings that must work before the database
 * opens (reduced motion, contrast, text size). This handles the palette, which
 * is a stored user choice and can wait for the database.
 */

import { resolveTheme, applyTheme, applyFontLoading, presetList, ACTIVE_PRESET } from '../config/theme.js';
import { getSetting, setSetting } from '../db/database.js';

const SETTING_PRESET   = 'theme.preset';
const SETTING_OVERRIDE = 'theme.overrides';

let current = null;

/* Applies the theme with no database read. Called first so a slow or failed
   database open still leaves a correctly coloured app rather than a half-styled
   one. */
export function applyBaseTheme() {
  current = applyTheme(resolveTheme(ACTIVE_PRESET));
  applyFontLoading(current);
  return current;
}

/* Applies the user's stored choice, if any. Safe to call before a profile
   exists. Failure here is cosmetic, so it never throws into the boot path. */
export async function loadAppearance() {
  try {
    const preset = await getSetting(SETTING_PRESET, ACTIVE_PRESET);
    const overrides = await getSetting(SETTING_OVERRIDE, null);
    current = applyTheme(resolveTheme(preset, overrides));
    applyFontLoading(current);
  } catch (err) {
    console.warn('[appearance] falling back to the default theme', err);
  }
  return current;
}

export async function setPreset(key) {
  const overrides = await getSetting(SETTING_OVERRIDE, null);
  current = applyTheme(resolveTheme(key, overrides));
  applyFontLoading(current);
  await setSetting(SETTING_PRESET, key);
  return current;
}

/* Per-colour override on top of a preset, so someone can keep the Void theme
   but change one hue without editing a file. */
export async function setColourOverride(paletteKey, value) {
  const existing = (await getSetting(SETTING_OVERRIDE, null)) ?? {};
  const next = { ...existing, palette: { ...(existing.palette ?? {}), [paletteKey]: value } };
  const preset = await getSetting(SETTING_PRESET, ACTIVE_PRESET);
  current = applyTheme(resolveTheme(preset, next));
  await setSetting(SETTING_OVERRIDE, next);
  return current;
}

export async function clearOverrides() {
  await setSetting(SETTING_OVERRIDE, null);
  const preset = await getSetting(SETTING_PRESET, ACTIVE_PRESET);
  current = applyTheme(resolveTheme(preset, null));
  return current;
}

export async function currentPresetKey() {
  return getSetting(SETTING_PRESET, ACTIVE_PRESET);
}

export async function currentOverrides() {
  return getSetting(SETTING_OVERRIDE, null);
}

export function activeTheme() {
  return current ?? resolveTheme(ACTIVE_PRESET);
}

export { presetList };
