/* Food data access: the local database first, the network only as a fallback.
 *
 * That order is deliberate and it is the whole design. The app has to work on a
 * flight, so a search always returns local results immediately and any network
 * lookup is an additive, clearly-labelled extra that the user asks for. Nothing
 * blocks on a request that may never come back.
 *
 * On Open Food Facts: keyless and CORS-friendly, which is why it is the only
 * viable option for a static app with no server to proxy through. Two real
 * constraints shape the code — they ask clients to identify themselves with a
 * User-Agent header, which browsers do not allow us to set, and they rate-limit.
 * So every response is cached for a month and lookups are never speculative.
 */

import { db } from '../db/database.js';
import { Foods, Cache, RecentFoods } from '../db/repos.js';
import { normaliseFood, fromOpenFoodFacts, searchFoods } from '../engines/nutrition.js';
import { NUTRITION, ENDPOINTS, FEATURES } from '../config/app.config.js';

const CACHE_MS = NUTRITION.offCacheDays * 86400000;

/* ---------------------------------------------------------------- local --- */

export async function localSearch(query) {
  const all = await db().foods.filter((f) => !f.deletedAt).toArray();
  return searchFoods(all, query);
}

export async function recent(limit = 20) {
  return RecentFoods.list(limit);
}

export async function byBarcodeLocal(barcode) {
  const code = String(barcode ?? '').replace(/\s/g, '');
  if (!code) return null;
  const hit = await db().foods.where('barcode').equals(code).first();
  return hit && !hit.deletedAt ? hit : null;
}

export async function saveFood(input) {
  const food = normaliseFood(input);
  if (!food.name) throw new Error('A food needs a name.');

  /* Barcode is a unique index, so a re-scan updates rather than colliding. */
  if (food.barcode) {
    const existing = await db().foods.where('barcode').equals(food.barcode).first();
    if (existing) {
      await db().foods.update(existing.id, { ...food, at: Date.now(), deletedAt: null });
      return { ...existing, ...food, id: existing.id };
    }
  }
  const id = await db().foods.add({ ...food, at: Date.now() });
  return { ...food, id };
}

/* Called whenever a food is logged, so the picker learns what you actually eat. */
export async function touchFood(id) {
  try { await db().foods.update(id, { at: Date.now() }); } catch { /* ordering only */ }
}

export async function deleteFood(id) {
  return Foods.remove(id);
}

/* --------------------------------------------------------------- remote --- */

/* AbortController-backed fetch. A hanging request on a bad connection is worse
   than a failed one, because the user has no idea whether to wait. */
async function fetchJson(url, timeoutMs) {
  if (typeof fetch !== 'function') throw new Error('This browser cannot make network requests.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}.`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function remoteAvailable() {
  return FEATURES.offFoodApi && typeof fetch === 'function' &&
         (typeof navigator === 'undefined' || navigator.onLine !== false);
}

/* Returns a result object rather than throwing, because "the network is down"
   is an ordinary state for this app and not an exception. */
export async function remoteSearch(query) {
  const q = String(query ?? '').trim();
  if (q.length < NUTRITION.searchMinChars) return { ok: false, reason: 'too-short', foods: [] };
  if (!FEATURES.offFoodApi) return { ok: false, reason: 'disabled', foods: [] };

  const key = `search:${q.toLowerCase()}`;
  const cached = await Cache.get('foodCache', key, CACHE_MS);
  if (cached) return { ok: true, cached: true, foods: cached };

  if (!remoteAvailable()) return { ok: false, reason: 'offline', foods: [] };

  try {
    const url = `${ENDPOINTS.openFoodFacts.search}?search_terms=${encodeURIComponent(q)}` +
                '&search_simple=1&action=process&json=1&page_size=25' +
                '&fields=code,product_name,generic_name,brands,quantity,serving_size,nutriments';
    const data = await fetchJson(url, ENDPOINTS.openFoodFacts.timeoutMs);
    const foods = (data?.products ?? [])
      .map(fromOpenFoodFacts)
      /* Anything without an energy value is unusable, and anything whose macros
         contradict its calories is a units error we refuse to import silently. */
      .filter((f) => f.name && f.kcal > 0 && f.sanity.ok);

    await Cache.set('foodCache', key, foods);
    return { ok: true, cached: false, foods, discarded: (data?.products?.length ?? 0) - foods.length };
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : 'error',
      message: err?.message ?? String(err),
      foods: [],
    };
  }
}

export async function remoteBarcode(barcode) {
  const code = String(barcode ?? '').replace(/\D/g, '');
  if (!code) return { ok: false, reason: 'invalid' };
  if (!FEATURES.offFoodApi) return { ok: false, reason: 'disabled' };

  const key = `barcode:${code}`;
  const cached = await Cache.get('foodCache', key, CACHE_MS);
  if (cached) return { ok: true, cached: true, food: cached };

  if (!remoteAvailable()) return { ok: false, reason: 'offline' };

  try {
    const url = `${ENDPOINTS.openFoodFacts.barcode}${encodeURIComponent(code)}.json` +
                '?fields=code,product_name,generic_name,brands,quantity,serving_size,nutriments';
    const data = await fetchJson(url, ENDPOINTS.openFoodFacts.timeoutMs);
    if (data?.status === 0 || !data?.product) return { ok: false, reason: 'not-found' };

    const food = fromOpenFoodFacts(data.product);
    if (!food.kcal) return { ok: false, reason: 'no-nutrition', food };
    await Cache.set('foodCache', key, food);
    return { ok: true, cached: false, food };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'error', message: err?.message };
  }
}

/* -------------------------------------------------------------- barcode --- */

/* BarcodeDetector is Chromium-only. Rather than shipping a ~300 KB WASM decoder
   in the app shell for a feature most sessions never touch, this reports
   honestly whether scanning is possible and the UI offers manual entry when it
   is not. Adding a lazy-loaded ZXing fallback later is a contained change: it
   only has to satisfy `scanBarcode`'s contract. */
export function barcodeSupported() {
  return FEATURES.barcode && typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export async function barcodeFormats() {
  if (!barcodeSupported()) return [];
  try { return await window.BarcodeDetector.getSupportedFormats(); }
  catch { return []; }
}

/* Opens the camera, scans until it finds a code or is stopped, and always
   releases the camera track. A leaked camera is a genuine privacy problem, so
   teardown runs in a finally block rather than on the success path. */
export async function scanBarcode({ video, onStatus = () => {}, signal } = {}) {
  if (!barcodeSupported()) throw new Error('This browser has no barcode scanner.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('No camera access in this browser.');

  const formats = await barcodeFormats();
  const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'].filter((f) => formats.includes(f));
  const detector = new window.BarcodeDetector(wanted.length ? { formats: wanted } : undefined);

  let stream = null;
  try {
    onStatus('Requesting camera…');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    onStatus('Point the camera at a barcode.');

    /* Poll rather than requestAnimationFrame: detection is far slower than a
       frame, and a rAF loop just queues work that cannot keep up. */
    while (!signal?.aborted) {
      try {
        const codes = await detector.detect(video);
        if (codes?.length) {
          const value = codes[0].rawValue;
          if (value) return value;
        }
      } catch { /* a transient decode failure is normal; keep scanning */ }
      await new Promise((r) => setTimeout(r, 220));
    }
    return null;
  } finally {
    try { video.pause(); video.srcObject = null; } catch { /* already gone */ }
    stream?.getTracks().forEach((t) => t.stop());
    onStatus('Camera released.');
  }
}

/* ---------------------------------------------------------------- admin --- */

export async function cacheStats() {
  const count = await Cache.size('foodCache');
  return { entries: count, ttlDays: NUTRITION.offCacheDays };
}

export async function clearFoodCache() {
  return Cache.clear('foodCache');
}
