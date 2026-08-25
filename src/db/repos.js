/* Repositories.
 *
 * The rule this file exists to enforce: no feature module ever touches a Dexie
 * table directly. Every read and write goes through a repository, which means
 * soft delete, audit trail, timezone stamping and dateKey derivation happen in
 * exactly one place and cannot be forgotten at a call site.
 */

import { db, SOFT_DELETE_TABLES } from './database.js';

export function localTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}

/* Local calendar day for a timestamp, as YYYY-MM-DD. Uses local getters
   deliberately — toISOString() would shift the day for anyone east or west of
   UTC, which is nearly everyone. */
export function dateKeyOf(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dateKeyOffset(days, from = Date.now()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return dateKeyOf(d.getTime());
}

async function audit(entity, action, detail) {
  try {
    await db().audit.add({ at: Date.now(), entity, action, detail: detail ?? null });
  } catch {
    /* The audit trail is a convenience, not a correctness requirement. If it
       fails (quota, for instance) the user's actual write must still stand. */
  }
}

export function makeRepo(tableName, options = {}) {
  const {
    softDelete = SOFT_DELETE_TABLES.includes(tableName),
    stampDate  = true,
    timeField  = 'at'
  } = options;

  const table = () => db().table(tableName);

  const repo = {
    name: tableName,
    softDelete,

    async create(record) {
      const now = Date.now();
      const row = { ...record };
      if (stampDate) {
        if (row[timeField] == null) row[timeField] = now;
        row.dateKey = row.dateKey ?? dateKeyOf(row[timeField]);
        row.tz = row.tz ?? localTimezone();
      }
      row.createdAt = row.createdAt ?? now;
      row.updatedAt = now;
      if (softDelete) row.deletedAt = row.deletedAt ?? null;

      const id = await table().add(row);
      await audit(tableName, 'create', { id });
      return { ...row, id };
    },

    /* One transaction for the whole batch: a half-saved batch is worse than a
       rejected one, because the user cannot tell which half landed. */
    async createMany(records) {
      const d = db();
      const out = await d.transaction('rw', d.table(tableName), async () => {
        const created = [];
        for (const r of records) created.push(await repo.create(r));
        return created;
      });
      await audit(tableName, 'create-many', { count: out.length });
      return out;
    },

    get(id) { return table().get(id); },

    async update(id, patch) {
      const row = await table().get(id);
      if (!row) throw new Error(`${tableName}#${id} not found`);
      const next = { ...row, ...patch, updatedAt: Date.now() };
      if (stampDate && patch[timeField] != null) {
        next.dateKey = dateKeyOf(patch[timeField]);
      }
      await table().put(next);
      await audit(tableName, 'update', { id, fields: Object.keys(patch) });
      return next;
    },

    /* Soft delete by default. The undo path in the UI depends on this being
       reversible without reconstructing the record. */
    async remove(id) {
      if (!softDelete) return repo.destroy(id);
      const row = await repo.update(id, { deletedAt: Date.now() });
      await audit(tableName, 'soft-delete', { id });
      return row;
    },

    async restore(id) {
      if (!softDelete) throw new Error(`${tableName} does not support restore`);
      const row = await repo.update(id, { deletedAt: null });
      await audit(tableName, 'restore', { id });
      return row;
    },

    async destroy(id) {
      await table().delete(id);
      await audit(tableName, 'hard-delete', { id });
    },

    async destroyMany(ids) {
      await table().bulkDelete(ids);
      await audit(tableName, 'hard-delete-many', { count: ids.length });
    },

    /* Paged, newest-first, live rows only unless asked otherwise. Reverse-order
       reads come off the index so a long history never loads into memory. */
    async list({ limit = 50, offset = 0, includeDeleted = false, order = 'desc' } = {}) {
      /* orderBy throws if timeField is not indexed. Falling back to primary-key
         order keeps a screen rendering instead of showing an error boundary. */
      let coll;
      try { coll = table().orderBy(timeField); }
      catch { coll = table().toCollection(); }
      if (order === 'desc') coll = coll.reverse();
      if (softDelete && !includeDeleted) coll = coll.filter((r) => !r.deletedAt);
      return coll.offset(offset).limit(limit).toArray();
    },

    async between(fromKey, toKey, { includeDeleted = false } = {}) {
      let coll = table().where('dateKey').between(fromKey, toKey, true, true);
      const rows = await coll.toArray();
      const live = (softDelete && !includeDeleted) ? rows.filter((r) => !r.deletedAt) : rows;
      return live.sort((a, b) => a[timeField] - b[timeField]);
    },

    async forDay(dateKey, { includeDeleted = false } = {}) {
      const rows = await table().where('dateKey').equals(dateKey).toArray();
      const live = (softDelete && !includeDeleted) ? rows.filter((r) => !r.deletedAt) : rows;
      return live.sort((a, b) => a[timeField] - b[timeField]);
    },

    async count({ includeDeleted = false } = {}) {
      if (!softDelete || includeDeleted) return table().count();
      return table().filter((r) => !r.deletedAt).count();
    },

    async deleted({ limit = 100 } = {}) {
      if (!softDelete) return [];
      return table()
        .filter((r) => !!r.deletedAt)
        .reverse()
        .limit(limit)
        .toArray();
    },

    /* Substring search over chosen fields. Deliberately not fuzzy: fuzzy search
       arrives with Fuse.js in the nutrition phase, where it earns its weight.
       Streaming with .each keeps a large table off the heap. */
    async search(term, { fields = ['name', 'note', 'label'], limit = 30 } = {}) {
      const needle = String(term || '').trim().toLowerCase();
      if (!needle) return [];
      const out = [];
      await table().each((row) => {
        if (out.length >= limit) return;
        if (softDelete && row.deletedAt) return;
        for (const f of fields) {
          const v = row[f];
          if (typeof v === 'string' && v.toLowerCase().includes(needle)) { out.push(row); return; }
        }
      });
      return out;
    },

    async clear() {
      await table().clear();
      await audit(tableName, 'clear', null);
    }
  };

  return repo;
}

/* ---------------------------------------------------------------------- */

export const Logs         = makeRepo('logs');
export const Goals        = makeRepo('goals', { timeField: 'createdAt' });
export const Measurements = makeRepo('measurements');
export const Photos       = makeRepo('photos');
export const Foods        = makeRepo('foods', { stampDate: false, timeField: 'name' });
export const Meals        = makeRepo('meals');
export const Workouts     = makeRepo('workouts');
export const Activities   = makeRepo('activities');
export const Sleep        = makeRepo('sleep');
export const PRs          = makeRepo('prs', { softDelete: false });
export const Achievements = makeRepo('achievements', { softDelete: false });
export const Audit        = makeRepo('audit', { softDelete: false });

/* Phase 2–7 tables. Foods orders by recency now that `at` is indexed (v3), so
   the food picker shows what you actually eat rather than an alphabet. */
export const Exercises    = makeRepo('exercises', { timeField: 'name', stampDate: false });
export const Programs     = makeRepo('programs', { timeField: 'createdAt' });
export const ProgramDays  = makeRepo('programDays', { softDelete: false, stampDate: false, timeField: 'day' });
export const WorkoutSets  = makeRepo('workoutSets', { softDelete: false });
export const MealItems    = makeRepo('mealItems', { softDelete: false, stampDate: false, timeField: 'mealId' });
export const Recipes      = makeRepo('recipes', { timeField: 'createdAt' });
export const RecipeItems  = makeRepo('recipeItems', { softDelete: false, stampDate: false, timeField: 'recipeId' });
export const Hydration    = makeRepo('hydration', { softDelete: false });
export const RoutePoints  = makeRepo('routePoints', { softDelete: false, stampDate: false, timeField: 't' });
export const Laps         = makeRepo('laps', { softDelete: false, stampDate: false, timeField: 'index' });
export const Bikes        = makeRepo('bikes', { timeField: 'name', stampDate: false });
export const Recovery     = makeRepo('recovery', { softDelete: false });
export const Health       = makeRepo('health', { softDelete: false });
export const TrainingLoad = makeRepo('trainingLoad', { softDelete: false, stampDate: false, timeField: 'dateKey' });
export const Recommendations = makeRepo('recommendations', { softDelete: false });

/* Foods needs recency ordering, which v3 made possible. */
export const RecentFoods = {
  async list(limit = 30) {
    return db().foods.orderBy('at').reverse()
      .filter((f) => !f.deletedAt).limit(limit).toArray();
  },
};

/* Photo blobs are keyed by photoId rather than an autoincrement, so they get a
   hand-written accessor instead of makeRepo. Kept in a separate table so the
   storage dashboard can size images independently of everything else, and so
   deleting a photo's image never risks touching its metadata row. */
export const PhotoBlobs = {
  async put(photoId, blob) { return db().photoBlobs.put({ photoId, blob, bytes: blob?.size ?? 0, at: Date.now() }); },
  async get(photoId) { return db().photoBlobs.get(photoId); },
  async remove(photoId) { return db().photoBlobs.delete(photoId); },
  async totalBytes() {
    let total = 0;
    await db().photoBlobs.each((r) => { total += r.bytes ?? r.blob?.size ?? 0; });
    return total;
  },
  async count() { return db().photoBlobs.count(); },
};

/* Network caches. Kept out of backups (see CACHE_TABLES) since they are
   rebuildable, and expiry is checked on read rather than swept on a timer —
   a background sweep in a page that may be closed at any moment is a job that
   silently never runs. */
export const Cache = {
  async get(table, key, maxAgeMs) {
    const row = await db()[table].get(key);
    if (!row) return null;
    if (maxAgeMs && Date.now() - (row.at ?? 0) > maxAgeMs) {
      await db()[table].delete(key);
      return null;
    }
    return row.value;
  },
  async set(table, key, value) { return db()[table].put({ key, value, at: Date.now() }); },
  async clear(table) { return db()[table].clear(); },
  async size(table) { return db()[table].count(); },
};

/* Profile is a single row, so it gets a purpose-built accessor rather than the
   generic repo — pretending it is a collection only invites bugs. */
export const Profile = {
  ID: 'me',
  async get() { return db().profile.get(Profile.ID); },
  async exists() { return !!(await Profile.get()); },
  async save(patch) {
    const current = (await Profile.get()) || { id: Profile.ID, createdAt: Date.now() };
    const next = { ...current, ...patch, id: Profile.ID, updatedAt: Date.now() };
    /* Target changes are kept historically (spec §6, §7) so a chart can show
       when the plan changed, not just what the plan is now. */
    if (patch.targets) {
      next.targetHistory = [
        ...(current.targetHistory || []),
        { at: Date.now(), targets: patch.targets, reason: patch.targetReason || 'recalculated' }
      ].slice(-60);
    }
    await db().profile.put(next);
    await audit('profile', 'save', { fields: Object.keys(patch) });
    window.dispatchEvent(new CustomEvent('nomeh:profile', { detail: next }));
    return next;
  }
};

/* Trash spans tables, so it is assembled here rather than owned by one repo. */
export async function trashContents({ limit = 40 } = {}) {
  const out = [];
  for (const name of SOFT_DELETE_TABLES) {
    let rows = [];
    try { rows = await db().table(name).filter((r) => !!r.deletedAt).limit(limit).toArray(); }
    catch { continue; }
    for (const r of rows) out.push({ table: name, row: r });
  }
  return out.sort((a, b) => (b.row.deletedAt || 0) - (a.row.deletedAt || 0)).slice(0, limit);
}

export async function restoreFromTrash(tableName, id) {
  await makeRepo(tableName).restore(id);
}

export async function emptyTrash() {
  let removed = 0;
  for (const name of SOFT_DELETE_TABLES) {
    try {
      const ids = (await db().table(name).filter((r) => !!r.deletedAt).toArray()).map((r) => r.id);
      if (ids.length) { await db().table(name).bulkDelete(ids); removed += ids.length; }
    } catch { /* table may not exist in an older schema; skip it */ }
  }
  await audit('trash', 'empty', { removed });
  return removed;
}
