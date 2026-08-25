/* Browser capability matrix (spec §37, §40).
 *
 * The build prompt is blunt about this: do not fabricate unsupported browser
 * capabilities, and do not pretend iOS Safari supports APIs it does not
 * reliably support. So every entry here reports what the browser actually
 * exposes, and the `note` field carries the caveat a user needs BEFORE they
 * build a habit on top of a feature that will let them down.
 *
 * Presence of an API is not the same as it working well. Where those differ,
 * the note says so.
 */

const ua = navigator.userAgent || '';
export const platform = {
  iOS: /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1),
  safari: /^((?!chrome|android|crios|fxios).)*safari/i.test(ua),
  android: /Android/.test(ua),
  firefox: /Firefox/.test(ua),
  standalone: window.matchMedia?.('(display-mode: standalone)').matches ||
              window.navigator.standalone === true
};

function entry(id, label, supported, note = null, essential = false) {
  return { id, label, supported: !!supported, note, essential };
}

export function detectCapabilities() {
  const caps = [
    entry('indexedDB', 'Local database', 'indexedDB' in window,
      platform.iOS
        ? 'Works. But iOS can evict site storage after about 7 days of no use unless the app ' +
          'is installed to the Home Screen. Install it, and export a backup regularly.'
        : null,
      true),

    entry('serviceWorker', 'Offline support', 'serviceWorker' in navigator,
      window.isSecureContext ? null : 'Needs HTTPS. GitHub Pages provides it; plain http does not.',
      true),

    entry('webCrypto', 'Encryption', !!(window.crypto && window.crypto.subtle),
      window.isSecureContext ? null : 'Only available over HTTPS.'),

    entry('geolocation', 'Location', 'geolocation' in navigator,
      platform.iOS
        ? 'Available, but iOS suspends background JavaScript when the screen locks, so a ' +
          'browser app cannot reliably record a route with the phone in your pocket. ' +
          'Keep the screen on, or import a GPX file from a watch afterwards.'
        : 'Background tracking depends on the screen staying awake. Wake Lock helps where supported.'),

    entry('wakeLock', 'Keep screen awake', 'wakeLock' in navigator,
      'wakeLock' in navigator ? null : 'Not available here. Long sessions will need the screen-timeout setting raised manually.'),

    entry('camera', 'Camera', !!(navigator.mediaDevices?.getUserMedia),
      'Photos are compressed and stored on this device only. Nothing is uploaded.'),

    entry('barcodeDetector', 'Barcode scanning', 'BarcodeDetector' in window,
      'BarcodeDetector' in window
        ? null
        : 'Native barcode scanning is Chromium-only. On other browsers, food will be searched or entered by hand.'),

    entry('bluetooth', 'Heart-rate & sensors', 'bluetooth' in navigator,
      'bluetooth' in navigator
        ? 'Supports BLE heart-rate, cadence and power straps.'
        : (platform.iOS
            ? 'Web Bluetooth is not implemented in any iOS browser, including Chrome for iOS. Heart rate must be entered manually or imported.'
            : 'Web Bluetooth is unavailable in this browser. Heart rate can still be entered manually.')),

    entry('notifications', 'Reminders', 'Notification' in window,
      platform.iOS
        ? 'On iOS, notifications only work once the app is installed to the Home Screen (iOS 16.4+).'
        : null),

    entry('webauthn', 'Passkey lock', !!(window.PublicKeyCredential),
      window.PublicKeyCredential
        ? 'A passkey can gate access to the app. It does not by itself encrypt the database — ' +
          'encryption uses a passphrase you choose.'
        : 'No passkey support. A PIN or passphrase is the fallback.'),

    entry('vibration', 'Haptics', 'vibrate' in navigator,
      'vibrate' in navigator ? null : 'Timer and interval cues will be audible and visual instead.'),

    entry('webAudio', 'Audio cues', !!(window.AudioContext || window.webkitAudioContext),
      'Used for the cadence metronome and interval beeps.'),

    entry('storageEstimate', 'Storage reporting', !!(navigator.storage?.estimate),
      navigator.storage?.estimate ? null : 'This browser will not report how much space the app is using.'),

    entry('persistentStorage', 'Protected storage', !!(navigator.storage?.persist),
      navigator.storage?.persist
        ? 'Can ask the browser not to evict your data under storage pressure.'
        : 'Cannot request eviction protection here. Regular backups are the safeguard.'),

    entry('battery', 'Battery awareness', 'getBattery' in navigator,
      'getBattery' in navigator
        ? null
        : 'The Battery Status API is unavailable in Safari and Firefox, so low-battery warnings ' +
          'during long sessions will not be possible on this browser.'),

    entry('healthImport', 'Health app data', false,
      'No browser can read Apple Health or Google Fit directly — no such web API exists. ' +
      'Health data enters NoMeh! by importing an export file, never by live sync.')
  ];

  const map = Object.fromEntries(caps.map((c) => [c.id, c]));
  return {
    list: caps,
    map,
    has: (id) => !!map[id]?.supported,
    missingEssentials: caps.filter((c) => c.essential && !c.supported)
  };
}

let cached = null;
export function capabilities() {
  if (!cached) cached = detectCapabilities();
  return cached;
}

/* Storage figures for the dashboard (spec §27). */
export async function storageReport() {
  const out = { usage: null, quota: null, percent: null, persisted: null, supported: false };
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      out.usage = est.usage ?? null;
      out.quota = est.quota ?? null;
      out.percent = est.quota ? (est.usage / est.quota) * 100 : null;
      out.supported = true;
      /* Chromium reports a per-bucket breakdown; other engines do not. */
      out.breakdown = est.usageDetails || null;
    } catch { /* leave nulls; the UI renders "unknown" rather than a guess */ }
  }
  if (navigator.storage?.persisted) {
    try { out.persisted = await navigator.storage.persisted(); } catch { /* ignore */ }
  }
  return out;
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return { granted: false, reason: 'unsupported' };
  try {
    const granted = await navigator.storage.persist();
    return { granted, reason: granted ? 'granted' : 'denied' };
  } catch (err) {
    return { granted: false, reason: err?.message || 'failed' };
  }
}

/* Read-only permission states. Deliberately never triggers a prompt — the
   Privacy screen should be safe to look at. */
export async function permissionStates() {
  const wanted = [
    { name: 'geolocation', label: 'Location' },
    { name: 'camera', label: 'Camera' },
    { name: 'notifications', label: 'Notifications' },
    { name: 'persistent-storage', label: 'Protected storage' }
  ];
  if (!navigator.permissions?.query) {
    return wanted.map((w) => ({ ...w, state: 'unknown' }));
  }
  return Promise.all(wanted.map(async (w) => {
    try {
      const status = await navigator.permissions.query({ name: w.name });
      return { ...w, state: status.state };
    } catch {
      return { ...w, state: 'unknown' };
    }
  }));
}
