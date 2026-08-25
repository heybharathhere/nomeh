/* Appearance and vault settings.
 *
 * The appearance section is the runtime half of the parameterisation: presets
 * and per-colour overrides, stored in the database. The file half lives in
 * src/config/theme.js, and either is sufficient on its own — edit the file to
 * change the defaults for everyone, or use this screen to change it on one
 * device without touching code.
 */

import { el, card, callout, sheet, field, toast, clear, confirmDestructive } from '../core/ui.js';
import { presetList, setPreset, setColourOverride, clearOverrides,
         currentPresetKey, currentOverrides } from '../core/appearance.js';
import { resolveTheme } from '../config/theme.js';
import { encryptJson, decryptJson, isEncrypted, assessPassphrase,
         cryptoAvailable, benchmarkKdf } from '../core/cryptobox.js';
import { installSeeds } from '../db/seeds.js';
import { db, ACTIVE_TABLES } from '../db/database.js';
import { clearFoodCache, cacheStats } from './foods.js';
import { APP, SECURITY, FEATURES } from '../config/app.config.js';
import { refresh } from '../core/router.js';

/* ---------------------------------------------------------- theme picker -- */

export async function appearanceCard() {
  const active = await currentPresetKey();
  const overrides = await currentOverrides();

  const grid = el('div', { class: 'theme-grid' });
  for (const preset of presetList()) {
    grid.append(el('button', {
      class: 'theme-card',
      dataset: { on: String(preset.key === active) },
      onclick: async () => {
        await setPreset(preset.key);
        toast(`${preset.label} applied.`);
        refresh();
      },
    },
      el('strong', {}, preset.label),
      el('div', { class: 'swatches' },
        ...preset.swatches.map((c) => el('span', { class: 'swatch', style: { background: c } }))),
      el('span', { class: 'muted-sm' }, preset.base === 'light' ? 'light' : 'dark'),
    ));
  }

  return card('Appearance', { note: overrides?.palette ? 'customised' : null },
    grid,
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-sm', onclick: () => openColourEditor(active) }, 'Edit colours'),
      overrides?.palette
        ? el('button', {
            class: 'btn btn-sm btn-ghost',
            onclick: async () => { await clearOverrides(); toast('Custom colours cleared.'); refresh(); },
          }, 'Reset colours')
        : null,
    ),
    el('p', { class: 'muted-sm' },
      'Presets and colours also live in src/config/theme.js — edit DEFAULT_THEME there to change ' +
      'the built-in defaults, or add your own preset and it appears here automatically.'),
  );
}

/* Per-colour override. The five functional colours are listed first because
   they carry meaning; the surfaces and text follow. */
const EDITABLE = [
  { key: 'performance', label: 'Performance', hint: 'activity, streaks, on-track states' },
  { key: 'nutrition', label: 'Nutrition', hint: 'food, calories, macros' },
  { key: 'strength', label: 'Strength', hint: 'lifting, PRs' },
  { key: 'recovery', label: 'Recovery', hint: 'hydration, sleep, readiness' },
  { key: 'alert', label: 'Alert', hint: 'warnings, peak zones' },
  { key: 'void', label: 'Page background', hint: null },
  { key: 'surface1', label: 'Surface 1', hint: 'cards' },
  { key: 'surface2', label: 'Surface 2', hint: 'inputs, raised elements' },
  { key: 'line', label: 'Borders', hint: null },
  { key: 'text', label: 'Text', hint: null },
  { key: 'textDim', label: 'Secondary text', hint: null },
];

function openColourEditor(presetKey) {
  const base = resolveTheme(presetKey);
  const body = el('div', {});

  body.append(el('p', { class: 'muted-sm' },
    'Changes apply immediately so you can see them behind this panel. ' +
    'Only the colours you touch are overridden; everything else follows the preset.'));

  for (const item of EDITABLE) {
    const current = base.palette[item.key] ?? '#000000';
    /* <input type="color"> only accepts 6-digit hex. A palette entry using
       rgba() or a CSS function cannot be edited here, so it is shown as
       read-only rather than silently mangled. */
    const editable = /^#[0-9a-f]{6}$/i.test(String(current));

    const picker = editable
      ? el('input', { type: 'color', value: current })
      : el('span', { class: 'muted-sm' }, current);

    if (editable) {
      picker.oninput = async () => {
        await setColourOverride(item.key, picker.value);
      };
    }

    body.append(el('div', { class: 'colour-row' },
      picker,
      el('div', { style: { flex: '1' } },
        el('strong', {}, item.label),
        item.hint ? el('div', { class: 'muted-sm' }, item.hint) : null,
      ),
    ));
  }

  sheet({ title: 'Colours', body });
}

/* ---------------------------------------------------------------- vault --- */

export async function vaultCard() {
  if (!FEATURES.vault) return null;

  if (!cryptoAvailable()) {
    return card('Encrypted backup', {},
      callout('This browser does not expose WebCrypto, so encrypted backups are unavailable. ' +
              'Plain backups still work.', { tone: 'alert' }));
  }

  return card('Encrypted backup', { note: 'passphrase protected' },
    el('p', { class: 'muted-sm' },
      'Exports everything into a single encrypted file. Useful if the backup will sit in cloud ' +
      'storage or on a shared machine.'),
    el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-sm', onclick: openVaultExport }, 'Export encrypted'),
      el('button', { class: 'btn btn-sm', onclick: openVaultImport }, 'Restore encrypted'),
    ),
    callout('This protects the exported file, not the live app. The database on this device is ' +
            'not encrypted — it cannot be, since the app has to read it. Anyone with your ' +
            'unlocked phone can see your data.', { tone: 'recovery', strongText: 'What this does: ' }),
  );
}

function openVaultExport() {
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const confirm = el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const strength = el('p', { class: 'pw-strength' });
  const includePhotos = el('input', { type: 'checkbox' });

  pass.oninput = () => {
    const a = assessPassphrase(pass.value);
    strength.textContent = pass.value ? `${a.strength} — ${a.message}` : '';
    strength.style.color = a.ok ? 'var(--text-faint)' : 'var(--crimson)';
  };

  sheet({
    title: 'Encrypted export',
    body: el('div', {},
      field('Passphrase', pass, `At least ${SECURITY.minPassphrase} characters. A few unrelated words works well.`),
      strength,
      field('Confirm passphrase', confirm),
      el('label', { class: 'colour-row' }, includePhotos,
        el('div', {}, el('strong', {}, 'Include photos'),
          el('div', { class: 'muted-sm' }, 'Much larger file. Leave off for a data-only backup.'))),
      callout('If you lose this passphrase the file cannot be opened. There is no recovery, ' +
              'by design.', { tone: 'alert' }),
    ),
    confirmLabel: 'Encrypt & download',
    onConfirm: async () => {
      const check = assessPassphrase(pass.value);
      if (!check.ok) { toast(check.message); return false; }
      if (pass.value !== confirm.value) { toast('The passphrases do not match.'); return false; }

      const ms = await benchmarkKdf();
      if (ms > 1500) toast(`Key derivation takes about ${Math.round(ms / 1000)}s on this device.`);

      const payload = { app: APP.name, version: APP.version, format: APP.backupFormat,
                        exportedAt: new Date().toISOString(), tables: {} };
      for (const table of ACTIVE_TABLES) {
        try { payload.tables[table] = await db()[table].toArray(); }
        catch { payload.tables[table] = []; }
      }

      if (includePhotos.checked) {
        const blobs = await db().photoBlobs.toArray();
        payload.photoBlobs = [];
        for (const rec of blobs) {
          payload.photoBlobs.push({
            photoId: rec.photoId,
            type: rec.blob?.type ?? 'image/webp',
            data: await blobToBase64(rec.blob),
          });
        }
      }

      const text = await encryptJson(payload, pass.value);
      download(text, `${APP.name.toLowerCase().replace(/\W/g, '')}-vault-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Encrypted backup downloaded.');
      return true;
    },
  });
}

function openVaultImport() {
  const file = el('input', { class: 'input', type: 'file', accept: '.json,application/json' });
  const pass = el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const report = el('div', { class: 'import-report' });

  sheet({
    title: 'Restore encrypted backup',
    body: el('div', {},
      field('Backup file', file),
      field('Passphrase', pass),
      callout('Restoring merges the backup into what is already here. Records with the same ' +
              'id are overwritten.', { tone: 'nutrition' }),
      report,
    ),
    confirmLabel: 'Decrypt & restore',
    onConfirm: async () => {
      const f = file.files?.[0];
      if (!f) { toast('Choose a file.'); return false; }
      const text = await f.text();

      if (!isEncrypted(text)) {
        clear(report).append(el('div', {},
          'That is not an encrypted backup. Use Settings → Data → Import for a plain one.'));
        return false;
      }

      let payload;
      try { payload = await decryptJson(text, pass.value); }
      catch (err) {
        clear(report).append(el('div', { style: { color: 'var(--crimson)' } }, err.message));
        return false;
      }

      const lines = [];
      for (const [table, rows] of Object.entries(payload.tables ?? {})) {
        if (!Array.isArray(rows) || !db()[table]) continue;
        try {
          await db()[table].bulkPut(rows);
          lines.push(`${table}: ${rows.length}`);
        } catch (err) {
          lines.push(`${table}: failed (${err?.name ?? 'error'})`);
        }
      }

      if (Array.isArray(payload.photoBlobs)) {
        let restored = 0;
        for (const p of payload.photoBlobs) {
          try {
            const blob = base64ToBlob(p.data, p.type);
            await db().photoBlobs.put({ photoId: p.photoId, blob, bytes: blob.size, at: Date.now() });
            restored++;
          } catch { /* skip an unreadable image rather than aborting the restore */ }
        }
        lines.push(`photos: ${restored} of ${payload.photoBlobs.length}`);
      }

      clear(report).append(...lines.map((l) => el('div', {}, l)));
      toast('Restore complete. Reload to see everything.');
      return false;   // keep the sheet open so the report stays readable
    },
  });
}

/* ----------------------------------------------------------------- data --- */

export async function dataMaintenanceCard() {
  const stats = await cacheStats();
  const counts = {
    exercises: await db().exercises.count(),
    foods: await db().foods.count(),
    programs: await db().programs.count(),
  };

  return card('Library & cache', {
    note: `${counts.exercises} exercises · ${counts.foods} foods`,
  },
    el('p', { class: 'muted-sm' },
      `Open Food Facts cache: ${stats.entries} entr${stats.entries === 1 ? 'y' : 'ies'}, ` +
      `kept for ${stats.ttlDays} days.`),
    el('div', { class: 'row-actions' },
      el('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          await clearFoodCache();
          toast('Food cache cleared.');
          refresh();
        },
      }, 'Clear food cache'),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => confirmDestructive({
          title: 'Restore the starter library?',
          message: 'Adds back any missing seeded exercises, foods and programmes. ' +
                   'Your own entries and all logged data are untouched.',
          confirmLabel: 'Restore library',
          onConfirm: async () => {
            const report = await installSeeds(db(), { force: true });
            toast(`Restored ${report.exercises} exercises, ${report.foods} foods.`);
            refresh();
          },
        }),
      }, 'Restore starter library'),
    ),
  );
}

/* ---------------------------------------------------------------- utils --- */

function download(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read image data.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type = 'image/webp') {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
