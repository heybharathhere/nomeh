/* Progress photos.
 *
 * WHERE THE IMAGES LIVE
 *   In IndexedDB, as Blobs, on this device. They are never uploaded anywhere —
 *   there is no server to upload them to. That is the entire privacy model, and
 *   it is why the backup file has an option to exclude them: a JSON export with
 *   200 MB of base64 images in it is not a file anyone can actually use.
 *
 * TWO REAL CONSTRAINTS
 *   1. Safari has a long history of bugs storing Blobs in IndexedDB. Writes are
 *      verified by reading back immediately, so a silent failure surfaces at
 *      capture time rather than being discovered when the photo is gone.
 *   2. iOS evicts IndexedDB for sites unused for seven days unless the app is
 *      installed to the Home Screen. For photos specifically this means real
 *      loss, so the storage card says so plainly.
 *
 * THE GHOST OVERLAY
 *   The previous photo is drawn over the live camera at low opacity so you can
 *   line up the same distance and angle. Without it, month-to-month comparison
 *   photos differ more by camera position than by body composition, which makes
 *   the whole exercise worthless.
 */

import { el, card, callout, fmt, emptyState, sheet, field, toast, confirmDestructive } from '../core/ui.js';
import { db } from '../db/database.js';
import { Photos, PhotoBlobs, dateKeyOf } from '../db/repos.js';
import { PHOTOS, FEATURES } from '../config/app.config.js';
import { refresh } from '../core/router.js';

/* ------------------------------------------------------------- encoding --- */

/* Resize and re-encode before storing. A modern phone camera produces 4–8 MB
   per shot; at these settings the same image is 80–200 KB, which is the
   difference between a year of photos fitting in a browser quota and not. */
async function processImage(source) {
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(source)
    : await loadViaImg(source);

  const scale = Math.min(1, PHOTOS.maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  /* WebP where available, JPEG where not — Safari only gained WebP encoding
     recently, and toBlob silently falls back to PNG if the type is unsupported,
     which would be far larger than either. */
  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), PHOTOS.format, PHOTOS.quality);
  });

  if (blob && blob.type === PHOTOS.format) return { blob, width: w, height: h };

  const jpeg = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', PHOTOS.quality);
  });
  return { blob: jpeg ?? blob, width: w, height: h };
}

function loadViaImg(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = source instanceof Blob ? URL.createObjectURL(source) : source;
  });
}

/* ---------------------------------------------------------------- store --- */

async function storePhoto({ blob, width, height, pose, note }) {
  const at = Date.now();
  const created = await Photos.create({
    at, dateKey: dateKeyOf(at), pose, note: note || null,
    width, height, bytes: blob.size, format: blob.type,
  });
  const photoId = created.id ?? created;

  await PhotoBlobs.put(photoId, blob);

  /* Read it straight back. Safari has shipped versions where a Blob write to
     IndexedDB succeeded and returned an unreadable blob; failing loudly here is
     far better than discovering it when the photo is needed. */
  const check = await PhotoBlobs.get(photoId);
  if (!check?.blob || !(check.blob.size > 0)) {
    await Photos.remove(photoId);
    await PhotoBlobs.remove(photoId);
    throw new Error('The image could not be stored reliably in this browser. Nothing was saved.');
  }

  return photoId;
}

/* -------------------------------------------------------------- capture --- */

async function openCapture(previousBlob) {
  const cameraOk = !!navigator.mediaDevices?.getUserMedia;
  const video = el('video', { class: 'viewfinder-video', playsinline: true, muted: true, autoplay: true });
  const ghost = previousBlob
    ? el('img', {
        class: 'ghost', alt: '',
        src: URL.createObjectURL(previousBlob),
        style: { opacity: String(PHOTOS.ghostOpacity) },
      })
    : null;
  const fileInput = el('input', {
    class: 'input', type: 'file', accept: 'image/*', capture: 'environment',
  });
  const poseSel = el('select', { class: 'input' },
    ...PHOTOS.poses.map((p) => el('option', { value: p }, p)));
  const note = el('input', { class: 'input', placeholder: 'optional note' });
  const status = el('p', { class: 'muted-sm' });

  let stream = null;
  let pendingBlob = null;

  const viewfinder = el('div', { class: 'viewfinder' }, video, ghost);

  const cleanup = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (ghost?.src) URL.revokeObjectURL(ghost.src);
  };

  const ref = sheet({
    title: 'Progress photo',
    body: el('div', {},
      cameraOk ? viewfinder : null,
      cameraOk ? el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            const raw = await new Promise((r) => canvas.toBlob(r, 'image/png'));
            const processed = await processImage(raw);
            pendingBlob = processed;
            status.textContent = `Captured · ${Math.round(processed.blob.size / 1024)} KB`;
          } catch (err) {
            status.textContent = err?.message ?? 'Capture failed.';
          }
        },
      }, 'Capture') : null,
      el('p', { class: 'muted-sm' },
        cameraOk
          ? 'Or choose an existing photo:'
          : 'Live camera is unavailable here. Choose a photo from your library:'),
      field('Photo file', fileInput),
      ghost ? el('p', { class: 'muted-sm' },
        'Your previous photo is overlaid faintly. Line up the same distance and angle — ' +
        'otherwise the difference between photos is mostly camera position.') : null,
      field('Pose', poseSel),
      field('Note', note),
      status,
    ),
    confirmLabel: 'Save photo',
    onClose: cleanup,
    onConfirm: async () => {
      let payload = pendingBlob;
      if (!payload && fileInput.files?.[0]) {
        try { payload = await processImage(fileInput.files[0]); }
        catch (err) { toast(err?.message ?? 'Could not read that image.'); return false; }
      }
      if (!payload) { toast('Capture or choose a photo first.'); return false; }

      await storePhoto({ ...payload, pose: poseSel.value, note: note.value.trim() });
      toast('Photo saved on this device.');
      refresh();
      return true;
    },
  });

  if (cameraOk) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false,
      });
      video.srcObject = stream;
    } catch {
      status.textContent = 'Camera permission denied — use the file picker instead.';
      viewfinder.remove();
    }
  }

  return ref;
}

/* ----------------------------------------------------------------- grid --- */

async function photoGrid(photos) {
  const grid = el('div', { class: 'photo-grid' });
  const urls = [];

  for (const p of photos) {
    const rec = await PhotoBlobs.get(p.id);
    if (!rec?.blob) {
      grid.append(el('div', { class: 'photo-cell' },
        el('figcaption', {}, 'image missing')));
      continue;
    }
    const url = URL.createObjectURL(rec.blob);
    urls.push(url);
    grid.append(el('button', {
      class: 'photo-cell',
      onclick: () => openPhoto(p, rec.blob),
      'aria-label': `${p.pose} photo from ${p.dateKey}`,
    },
      el('img', { src: url, alt: '', loading: 'lazy' }),
      el('figcaption', {}, `${p.dateKey.slice(5)} · ${p.pose}`),
    ));
  }

  /* Object URLs are a real leak if never revoked. Released when the grid leaves
     the document, checked on a slow interval that stops itself. */
  const watcher = setInterval(() => {
    if (!grid.isConnected) {
      urls.forEach((u) => URL.revokeObjectURL(u));
      clearInterval(watcher);
    }
  }, 5000);

  return grid;
}

function openPhoto(photo, blob) {
  const url = URL.createObjectURL(blob);
  sheet({
    title: `${photo.pose} · ${fmt.dayLabel(photo.dateKey)}`,
    body: el('div', {},
      el('img', { class: 'photo-full', src: url, alt: `${photo.pose} photo` }),
      photo.note ? el('p', { class: 'muted-sm' }, photo.note) : null,
      el('p', { class: 'muted-sm' },
        `${photo.width}×${photo.height} · ${Math.round((photo.bytes ?? 0) / 1024)} KB · stored on this device only`),
    ),
    onClose: () => URL.revokeObjectURL(url),
    footer: el('button', {
      class: 'btn btn-danger btn-sm',
      onclick: () => confirmDestructive({
        title: 'Delete this photo?',
        message: 'The image is removed from this device. This cannot be undone.',
        confirmLabel: 'Delete photo',
        onConfirm: async () => {
          await Photos.remove(photo.id);
          await PhotoBlobs.remove(photo.id);
          toast('Photo deleted.');
          refresh();
        },
      }),
    }, 'Delete'),
  });
}

/* ------------------------------------------------------------ timelapse --- */

async function openTimelapse(photos) {
  const ordered = [...photos].sort((a, b) => a.at - b.at);
  if (ordered.length < 2) { toast('Two photos of the same pose are needed.'); return; }

  const img = el('img', { class: 'photo-full', alt: 'Timelapse frame' });
  const label = el('p', { class: 'muted-sm' });
  const urls = [];
  let i = 0, timer = null;

  for (const p of ordered) {
    const rec = await PhotoBlobs.get(p.id);
    urls.push(rec?.blob ? URL.createObjectURL(rec.blob) : null);
  }

  const show = (idx) => {
    const url = urls[idx];
    if (url) img.src = url;
    label.textContent = `${idx + 1} of ${ordered.length} · ${ordered[idx].dateKey}`;
  };

  const play = () => {
    if (timer) { clearInterval(timer); timer = null; return; }
    timer = setInterval(() => {
      i = (i + 1) % ordered.length;
      show(i);
    }, PHOTOS.timelapseFrameMs);
  };

  show(0);

  sheet({
    title: 'Timelapse',
    body: el('div', {}, img, label,
      el('div', { class: 'row-actions' },
        el('button', { class: 'btn', onclick: play }, 'Play / pause'),
        el('button', { class: 'btn btn-ghost', onclick: () => { i = Math.max(0, i - 1); show(i); } }, '‹'),
        el('button', { class: 'btn btn-ghost', onclick: () => { i = Math.min(ordered.length - 1, i + 1); show(i); } }, '›'),
      )),
    onClose: () => {
      if (timer) clearInterval(timer);
      urls.forEach((u) => u && URL.revokeObjectURL(u));
    },
  });
}

/* ---------------------------------------------------------------- view --- */

export async function photosView({ params } = {}) {
  if (!FEATURES.photos) {
    return card('Photos are switched off', {},
      el('p', { class: 'muted-sm' }, 'FEATURES.photos is false in src/config/app.config.js.'));
  }

  const pose = params?.get?.('pose') ?? null;
  const all = await db().photos.orderBy('at').reverse().filter((p) => !p.deletedAt).toArray();
  const shown = pose ? all.filter((p) => p.pose === pose) : all;

  const bytes = await PhotoBlobs.totalBytes();
  const mb = bytes / (1024 * 1024);

  const latestSamePose = pose
    ? all.find((p) => p.pose === pose)
    : all[0];
  const ghostRec = latestSamePose ? await PhotoBlobs.get(latestSamePose.id) : null;

  const poseFilter = el('div', { class: 'chip-row' },
    el('a', { class: 'chip chip-btn', href: '#/photos', dataset: { on: String(!pose) } }, 'all'),
    ...PHOTOS.poses.map((p) => el('a', {
      class: 'chip chip-btn', href: `#/photos?pose=${p}`, dataset: { on: String(pose === p) },
    }, p)),
  );

  return el('div', { class: 'stack' },
    card('Progress photos', {
      note: `${all.length} photo${all.length === 1 ? '' : 's'} · ${mb.toFixed(1)} MB`,
      actions: el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: () => openCapture(ghostRec?.blob ?? null),
      }, 'Add'),
    },
      poseFilter,
      shown.length ? await photoGrid(shown.slice(0, 60)) : null,
      shown.length >= 2 ? el('button', {
        class: 'btn btn-sm',
        onclick: () => openTimelapse(shown),
      }, 'Play timelapse') : null,
      mb > PHOTOS.warnAtMb
        ? callout(`Photos are using ${mb.toFixed(0)} MB. Browsers evict storage when space runs short — ` +
                  'export a backup, or delete some older shots.', { tone: 'alert' })
        : null,
      callout('Photos never leave this device. There is no upload and no account. ' +
              'That also means a browser data wipe removes them permanently, so keep a backup ' +
              'of anything you would be upset to lose.', { tone: 'recovery' }),
    ),
    !all.length ? emptyState({
      title: 'No photos yet',
      message: 'A monthly photo in consistent lighting tells you far more than the scale does. ' +
               'The camera overlays your last shot so you can match the angle.',
    }) : null,
  );
}
