/* The one and only place Dexie enters the app.
 *
 * Dexie is loaded from a pinned CDN URL and precached by the service worker, so
 * after the first successful load the app is fully offline. The first load does
 * need the network — that is the single honest deviation from "offline from the
 * very first byte".
 *
 * To remove that deviation entirely (recommended for a long-lived install):
 *   1. download https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/modern/dexie.mjs
 *   2. commit it as ./vendor/dexie.mjs
 *   3. change DEXIE_URL below to './../../vendor/dexie.mjs'
 *   4. add './vendor/dexie.mjs' to the SHELL array in sw.js and bump CACHE_VERSION
 * Nothing else in the codebase needs to change.
 */

export const DEXIE_URL = 'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/modern/dexie.mjs';

let cached = null;

export async function loadDexie() {
  if (cached) return cached;
  const mod = await import(/* @vite-ignore */ DEXIE_URL);
  cached = mod.default ?? mod.Dexie;
  if (!cached) throw new Error('Dexie module loaded but no export found');
  return cached;
}
