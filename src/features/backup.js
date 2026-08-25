/* Backup and restore (spec §31).
 *
 * This is the most important non-negotiable in a local-first app. There is no
 * cloud copy, no support team with a snapshot, no password reset. If the browser
 * clears its storage, the export file is the only thing between the user and
 * total loss. So restore is written defensively:
 *
 *   - the file is fully validated BEFORE the database is touched
 *   - merge is the default; overwrite requires typing a confirmation phrase
 *   - duplicates are detected by content signature, not by id, because ids are
 *     reassigned by autoincrement on import and would collide by chance
 */

import { db, DB_NAME, setSetting, getSetting } from '../db/database.js';

export const BACKUP_FORMAT = 'nomeh-backup';
export const BACKUP_VERSION = 1;

/* Tables included in a full export. Photos will need special handling when they
   arrive (blobs are not JSON), which is why the list is explicit rather than
   "everything Dexie knows about". */
const EXPORT_TABLES = [
  'profile', 'goals', 'logs', 'settings',
  'foods', 'meals', 'mealItems', 'recipes', 'recipeItems', 'grocery',
  'hydration', 'workouts', 'workoutSets', 'exercises', 'programs', 'programDays',
  'activities', 'laps', 'bikes', 'maintenance',
  'sleep', 'recovery', 'health', 'trainingLoad',
  'measurements', 'prs', 'achievements'
];

export async function buildBackup() {
  const d = db();
  const data = {};
  let records = 0;

  for (const name of EXPORT_TABLES) {
    try {
      const rows = await d.table(name).toArray();
      data[name] = rows;
      records += rows.length;
    } catch {
      /* Table absent in this schema version — skip rather than fail the export. */
    }
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    dbName: DB_NAME,
    schemaVersion: d.verno,
    exportedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    app: 'NoMeh!',
    recordCount: records,
    tables: Object.keys(data),
    data
  };
}

export async function exportJson() {
  const backup = await buildBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  download(blob, `nomeh-backup-${stamp()}.json`);
  await setSetting('lastBackupAt', Date.now());
  return backup.recordCount;
}

/* Logs as CSV, for spreadsheets. Deliberately one flat table with a union of
   columns — a normalised multi-file CSV export is worse than useless to anyone
   who just wants to pivot their water intake. */
export async function exportLogsCsv() {
  const rows = await db().logs.filter((r) => !r.deletedAt).toArray();
  const columns = ['id', 'at', 'dateKey', 'tz', 'type', 'value', 'unit', 'minutes',
    'site', 'label', 'exercise', 'sets', 'reps', 'loadKg', 'rpe', 'quality', 'kind', 'source', 'note'];

  const lines = [columns.join(',')];
  for (const r of rows.sort((a, b) => a.at - b.at)) {
    lines.push(columns.map((c) => {
      let v = r[c];
      if (c === 'at') v = new Date(r.at).toISOString();
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  download(blob, `nomeh-logs-${stamp()}.csv`);
  return rows.length;
}

/* GPX export for a single GPS activity. Included now because the exporter is the
   half of GPX portability that can be finished without the outdoor engine, and
   it means route data is never trapped in the app. */
export async function exportGpx(activityId) {
  const activity = await db().activities.get(activityId);
  if (!activity) throw new Error('Activity not found');
  const points = await db().routePoints.where('activityId').equals(activityId).sortBy('t');
  if (!points.length) throw new Error('That activity has no recorded route');

  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  const gpx =
`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="NoMeh!" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(activity.title || activity.sport || 'Activity')}</name>
    <time>${new Date(activity.at).toISOString()}</time></metadata>
  <trk><name>${esc(activity.title || activity.sport || 'Activity')}</name><trkseg>
${points.map((p) =>
`    <trkpt lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`
).join('\n')}
  </trkseg></trk>
</gpx>`;

  download(new Blob([gpx], { type: 'application/gpx+xml' }), `nomeh-activity-${activityId}.gpx`);
  return points.length;
}

/* ------------------------------------------------------------ import ----- */

/* Validation returns a report rather than throwing, so the UI can show the user
   exactly what a file contains and let them decide. Nothing here writes. */
export function validateBackup(parsed) {
  const problems = [];
  const warnings = [];

  if (!parsed || typeof parsed !== 'object') problems.push('The file is not valid JSON object data.');
  if (parsed?.format !== BACKUP_FORMAT) problems.push('This is not a NoMeh! backup file.');
  if (typeof parsed?.formatVersion !== 'number') problems.push('The backup is missing its format version.');
  if (parsed?.formatVersion > BACKUP_VERSION) {
    problems.push(`The backup was written by a newer version of NoMeh! (format ${parsed.formatVersion}). ` +
                  'Update the app before restoring, or the import could silently drop fields.');
  }
  if (!parsed?.data || typeof parsed.data !== 'object') problems.push('The backup contains no data section.');

  const counts = {};
  if (parsed?.data) {
    for (const [name, rows] of Object.entries(parsed.data)) {
      if (!Array.isArray(rows)) { problems.push(`Table "${name}" is malformed.`); continue; }
      counts[name] = rows.length;
      try { db().table(name); }
      catch { warnings.push(`Table "${name}" does not exist in this version and will be skipped.`); }
    }
  }

  if (parsed?.schemaVersion && db().verno && parsed.schemaVersion > db().verno) {
    warnings.push(`The backup came from schema v${parsed.schemaVersion}; this app runs v${db().verno}.`);
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!problems.length && total === 0) warnings.push('The backup is structurally valid but contains no records.');

  return { ok: problems.length === 0, problems, warnings, counts, total, meta: parsed };
}

export async function readBackupFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { return { ok: false, problems: [`The file is not readable JSON: ${err.message}`], warnings: [], counts: {}, total: 0 }; }
  return validateBackup(parsed);
}

/* Content signature for duplicate detection. Deliberately excludes id,
   createdAt and updatedAt: the same run imported twice from two backups is one
   run, even though both copies carry different ids. */
function signature(tableName, row) {
  const keys = {
    logs: ['type', 'at', 'value', 'unit', 'minutes', 'exercise', 'sets', 'reps', 'site', 'note'],
    measurements: ['at', 'site', 'value'],
    goals: ['title', 'domain', 'createdAt'],
    workouts: ['at', 'mode'],
    activities: ['at', 'sport'],
    sleep: ['at', 'minutes'],
    foods: ['name', 'barcode']
  }[tableName];

  if (!keys) return null;                     // no signature → treated as new
  return keys.map((k) => (row[k] ?? '')).join('\u0001');
}

/* mode: 'merge' adds only records that are not already present.
 *       'replace' clears each incoming table first — the destructive path, and
 *       the reason the UI makes the user type a phrase for it.
 *
 * Everything runs inside one Dexie transaction, so a failure halfway through
 * leaves the database exactly as it was. */
export async function restoreBackup(report, { mode = 'merge' } = {}) {
  if (!report.ok) throw new Error('Refusing to restore an invalid backup.');
  const d = db();
  const parsed = report.meta;

  const tables = Object.keys(parsed.data).filter((name) => {
    try { d.table(name); return true; } catch { return false; }
  });

  const result = { inserted: 0, skipped: 0, cleared: 0, perTable: {} };

  await d.transaction('rw', tables.map((t) => d.table(t)), async () => {
    for (const name of tables) {
      const incoming = parsed.data[name];
      const table = d.table(name);
      let inserted = 0, skipped = 0;

      if (mode === 'replace') {
        result.cleared += await table.count();
        await table.clear();
      }

      /* Build the existing-signature set once per table rather than querying
         per row — an import of 20 000 logs otherwise becomes O(n²). */
      const existing = new Set();
      if (mode === 'merge') {
        await table.each((row) => {
          const sig = signature(name, row);
          if (sig) existing.add(sig);
        });
      }

      for (const row of incoming) {
        const sig = signature(name, row);
        if (mode === 'merge' && sig && existing.has(sig)) { skipped++; continue; }

        const copy = { ...row };
        /* Let autoincrement assign fresh ids on merge so an imported record can
           never overwrite an unrelated existing one that happens to share an id.
           Keyed tables (profile, settings) keep their key by design. */
        if (mode === 'merge' && !['profile', 'settings'].includes(name)) delete copy.id;

        await table.put(copy);
        if (sig) existing.add(sig);
        inserted++;
      }

      result.perTable[name] = { inserted, skipped };
      result.inserted += inserted;
      result.skipped += skipped;
    }
  });

  await d.backups.add({
    at: Date.now(), kind: `restore-${mode}`,
    detail: { inserted: result.inserted, skipped: result.skipped, source: parsed.exportedAt }
  });

  return result;
}

/* ------------------------------------------------------------ helpers ---- */

export async function backupStatus() {
  const last = await getSetting('lastBackupAt', null);
  const remindDays = await getSetting('backupReminderDays', 14);
  const overdue = !last || (Date.now() - last) > remindDays * 86400000;
  return { last, remindDays, overdue };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  /* Revoke late: Safari has historically cancelled the download if the URL is
     released in the same tick. */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
