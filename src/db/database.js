/* NoMeh! local database — IndexedDB via Dexie.
 *
 * Design decisions, and why:
 *
 * 1. The FULL domain schema is declared at v1, including tables that Phase 1
 *    does not write to yet. Declaring an empty store costs nothing at runtime
 *    and means later phases ship features instead of migrations. The build
 *    prompt is explicit: build the data model first.
 *
 * 2. Soft delete everywhere it matters. Every user-authored table carries
 *    `deletedAt` and is indexed on it, so Trash is a query rather than a second
 *    copy of the data. Restore is a field update, not a re-insert.
 *
 * 3. `dateKey` (YYYY-MM-DD, in the user's local timezone at write time) is
 *    stored alongside the UTC `at` timestamp on anything day-shaped. Deriving
 *    local days from UTC at read time is wrong the moment a user travels, and
 *    IndexedDB cannot index a computed value.
 *
 * 4. `tz` is stored on every timestamped record. A run logged at 06:00 in
 *    Chennai and one logged at 06:00 in Berlin are different events, and
 *    without the zone you can never reconstruct which was which.
 */

import { loadDexie } from './dexie.js';

export const DB_NAME = 'nomeh';

/* Tables active in Phase 1. The rest are declared and reserved. */
/* Tables that carry user data and therefore belong in a backup. Adding a table
   here is all that is needed for export and restore to pick it up. */
export const ACTIVE_TABLES = [
  'profile', 'goals', 'logs', 'settings', 'audit',
  'foods', 'meals', 'mealItems', 'recipes', 'recipeItems', 'hydration',
  'workouts', 'workoutSets', 'exercises', 'programs', 'programDays',
  'activities', 'routePoints', 'laps', 'bikes',
  'sleep', 'recovery', 'health', 'trainingLoad',
  'measurements', 'photos', 'prs', 'achievements',
];

/* Caches are rebuildable from the network, so they are deliberately excluded
   from backups — there is no reason to carry megabytes of cached food data
   around in an export. */
export const CACHE_TABLES = ['foodCache', 'weatherCache'];

/* Photo blobs are handled separately: they are large, and a user restoring on a
   new phone may reasonably want the data without 120 MB of images. */
export const BLOB_TABLES = ['photoBlobs'];

/* Tables that participate in Trash / soft delete. */
export const SOFT_DELETE_TABLES = [
  'goals', 'logs', 'foods', 'meals', 'recipes', 'workouts', 'exercises',
  'programs', 'activities', 'bikes', 'sleep', 'measurements', 'photos',
];

let dbInstance;

export async function openDatabase() {
  if (dbInstance) return dbInstance;

  const Dexie = await loadDexie();
  const db = new Dexie(DB_NAME);

  /* ---------------------------------------------------------------- v1 ----
     Indexes are chosen from the access patterns the app actually has, not
     "index everything". Compound indexes exist where a screen filters on two
     fields at once (e.g. Timeline: one type, ordered by time). */
  db.version(1).stores({
    // identity & intent
    profile:      '&id',                                            // single row, id = 'me'
    goals:        '++id, status, priority, domain, createdAt, deadline, deletedAt',
    settings:     '&key',

    // the universal log — the busiest table in the app
    logs:         '++id, type, at, dateKey, [type+at], [dateKey+type], deletedAt',

    // nutrition
    foods:        '++id, name, &barcode, source, deletedAt',
    meals:        '++id, at, dateKey, slot, deletedAt',
    mealItems:    '++id, mealId, foodId',
    recipes:      '++id, name, deletedAt',
    recipeItems:  '++id, recipeId, foodId',
    grocery:      '++id, category, checked, addedAt',
    leftovers:    '++id, sourceMealId, preparedAt, expiresAt',

    // hydration
    hydration:    '++id, at, dateKey, kind',

    // resistance training
    workouts:     '++id, at, dateKey, mode, programId, deletedAt',
    workoutSets:  '++id, workoutId, exerciseId, at, [workoutId+at]',
    exercises:    '++id, name, category, pattern, *primaryMuscles, *equipment, deletedAt',
    programs:     '++id, name, status, deletedAt',
    programDays:  '++id, programId, week, day',

    // endurance
    activities:   '++id, at, dateKey, sport, deletedAt',            // GPS sessions
    routePoints:  '++id, activityId, t, [activityId+t]',
    laps:         '++id, activityId, index',
    bikes:        '++id, name, deletedAt',
    maintenance:  '++id, bikeId, at, kind',

    // recovery & health
    sleep:        '++id, at, dateKey, deletedAt',
    recovery:     '++id, at, dateKey',
    health:       '++id, metric, at, dateKey, [metric+at]',
    trainingLoad: '++id, dateKey',

    // body
    measurements: '++id, at, dateKey, site, [site+at], deletedAt',
    photos:       '++id, at, dateKey, pose, deletedAt',

    // achievement & guidance
    prs:              '++id, kind, at, [kind+at]',
    achievements:     '++id, code, at',
    recommendations:  '++id, at, domain, dismissed',
    notifications:    '++id, at, read',

    // housekeeping
    audit:        '++id, at, entity, action',
    backups:      '++id, at, kind'
  });

  /* ---------------------------------------------------------------- v2 ----
     MIGRATION TEMPLATE — this is the pattern every future schema change follows.
     It is real, runnable code, kept deliberately small so the shape is obvious:

       - add the new index in .stores() (repeat unchanged stores you touch)
       - backfill existing rows inside .upgrade(), which Dexie runs in a
         transaction, so a thrown error rolls the whole migration back
       - never assume a field exists on old rows

     v2 adds a source index to logs, so Backup/Import can find and re-key
     records that came from a file rather than from the user typing them. */
  db.version(2).stores({
    logs: '++id, type, at, dateKey, [type+at], [dateKey+type], deletedAt, source'
  }).upgrade(async (tx) => {
    await tx.table('logs').toCollection().modify((row) => {
      if (row.source === undefined) row.source = 'manual';
      if (row.tz === undefined) row.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    });
  });

  /* ---------------------------------------------------------------- v3 ----
     Phases 2–7. The full domain was declared at v1, so this adds only what the
     new screens genuinely need: two network caches, richer filtering on the
     exercise library, and recency ordering on foods.

     Note what is NOT here — no table renames, no data reshaping. Declaring the
     whole schema up front is what makes a feature release look like this
     instead of a migration. */
  db.version(3).stores({
    /* *tags lets the library filter by several labels at once (push, beginner,
       unilateral) without a scan. */
    exercises:  '++id, name, category, pattern, *primaryMuscles, *equipment, *tags, deletedAt',
    /* Recently-used foods surface first, so `at` has to be indexed. */
    foods:      '++id, name, &barcode, source, at, deletedAt',
    /* Open Food Facts responses, cached so the app works offline and stays well
       inside their rate limits. Keyed by query or barcode. */
    foodCache:  '&key, at',
    /* Open-Meteo responses, keyed by rounded coordinates and hour. */
    weatherCache: '&key, at',
    /* Photo blobs live in their own table so the storage dashboard can size
       them separately, and so deleting photos never touches log data. */
    photoBlobs: '&photoId',
  }).upgrade(async (tx) => {
    /* Old rows have no tags array. An index on a missing field is fine in
       Dexie, but the library UI filters on it, so backfill for consistency. */
    await tx.table('exercises').toCollection().modify((row) => {
      if (!Array.isArray(row.tags)) row.tags = [];
    });
    await tx.table('foods').toCollection().modify((row) => {
      if (row.at === undefined) row.at = row.createdAt ?? Date.now();
    });
  });

  db.on('versionchange', () => {
    /* Another tab opened a newer schema. Close here so it is not blocked; the
       page will prompt for a reload rather than run against a stale handle. */
    db.close();
    window.dispatchEvent(new CustomEvent('nomeh:db-superseded'));
  });

  await openWithTimeout(db);
  dbInstance = db;
  return db;
}

/* db.open() has no built-in timeout. If another tab (or another instance of
   this PWA, foreground or background) is holding an older schema version
   open, IndexedDB fires 'blocked' and the open call just waits — forever,
   with nothing on screen but "Opening your local database...". That is a
   real failure mode on a phone where old tabs pile up, not a hypothetical
   one, so it gets a specific, actionable error instead of an infinite wait. */
function openWithTimeout(db, ms = 6000) {
  let blocked = false;
  db.on('blocked', () => { blocked = true; });

  const opening = db.open();
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(blocked
      ? 'Another open tab of NoMeh! is holding an older version of the database. Close every other NoMeh! tab — including ones in the background — then reload.'
      : 'The database took too long to respond.')), ms);
  });

  return Promise.race([opening, timeout]);
}

export function db() {
  if (!dbInstance) throw new Error('Database not open. Call openDatabase() first.');
  return dbInstance;
}

/* Seeds only what is missing, so it is safe to run on every launch. */
export async function ensureDefaults() {
  const d = db();
  const defaults = {
    units:        'metric',      // metric | imperial
    energyUnit:   'kcal',        // kcal | kJ
    clock:        '24h',
    firstDayOfWeek: 1,
    motion:       'auto',
    contrast:     'normal',
    textSize:     'normal',
    backupReminderDays: 14,
    lastBackupAt: null,
    schemaTag:    'phase-1'
  };

  await d.transaction('rw', d.settings, async () => {
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await d.settings.get(key);
      if (!existing) await d.settings.put({ key, value });
    }
  });
}

export async function getSetting(key, fallback = null) {
  const row = await db().settings.get(key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await db().settings.put({ key, value });
  window.dispatchEvent(new CustomEvent('nomeh:setting', { detail: { key, value } }));
  return value;
}

export async function allSettings() {
  const rows = await db().settings.toArray();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
