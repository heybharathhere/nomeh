/* Analytics engine.
 *
 * Pure reducers over arrays of log rows. The database layer fetches, this layer
 * summarises, the UI renders. Keeping it in this order means every number on
 * the Today screen can be reproduced in a test without a browser.
 */

export function dailyTotals(logs = []) {
  const t = {
    water: 0, electrolytes: 0, calories: 0,
    runKm: 0, walkKm: 0, cycleKm: 0, activeMinutes: 0,
    sets: 0, reps: 0, volumeKg: 0,
    weight: null, sleepMinutes: 0,
    counts: {}
  };

  for (const l of logs) {
    t.counts[l.type] = (t.counts[l.type] || 0) + 1;
    switch (l.type) {
      case 'water':        t.water += l.value || 0; break;
      case 'electrolytes': t.electrolytes += l.value || 0; t.water += l.value || 0; break;
      case 'food':         t.calories += l.value || 0; break;
      case 'run':          t.runKm += l.value || 0;   t.activeMinutes += l.minutes || 0; break;
      case 'walk':         t.walkKm += l.value || 0;  t.activeMinutes += l.minutes || 0; break;
      case 'cycle':        t.cycleKm += l.value || 0; t.activeMinutes += l.minutes || 0; break;
      case 'sleep':        t.sleepMinutes += l.minutes || 0; break;
      case 'weight':
        /* Last reading of the day wins — morning weight is usually first, and a
           later re-weigh is a correction more often than a second data point. */
        t.weight = l.value ?? t.weight;
        break;
      case 'exercise': {
        const sets = l.sets || 0, reps = l.reps || 0;
        t.sets += sets;
        t.reps += sets * reps;
        if (l.loadKg) t.volumeKg += sets * reps * l.loadKg;
        break;
      }
    }
  }

  t.distanceKm = round(t.runKm + t.walkKm + t.cycleKm, 2);
  t.runKm = round(t.runKm, 2);
  t.walkKm = round(t.walkKm, 2);
  t.cycleKm = round(t.cycleKm, 2);
  t.volumeKg = round(t.volumeKg);
  return t;
}

const round = (v, dp = 0) => { const f = 10 ** dp; return Math.round(v * f) / f; };

/* Trailing simple moving average. Returns one point per input point so the
   series lines up with the raw data on a chart; leading points average over
   fewer samples rather than being dropped. */
export function rollingAverage(series = [], window = 7) {
  if (!series.length) return [];
  const out = [];
  let sum = 0;
  const buf = [];
  for (const point of series) {
    const v = typeof point === 'number' ? point : point.value;
    buf.push(v); sum += v;
    if (buf.length > window) sum -= buf.shift();
    out.push({
      ...(typeof point === 'object' ? point : {}),
      value: v,
      average: round(sum / buf.length, 2),
      samples: buf.length
    });
  }
  return out;
}

/* Fills the gaps. A weight chart with missing days must not draw a straight
   line between two readings a fortnight apart as if it were data. */
export function seriesByDay(logs, { type, from, to, pick = (l) => l.value }) {
  const byKey = new Map();
  for (const l of logs) {
    if (type && l.type !== type) continue;
    const v = pick(l);
    if (v == null) continue;
    byKey.set(l.dateKey, v);          // later entry for a day overwrites
  }
  const out = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cursor <= end) {
    const key = keyOf(cursor);
    out.push({ dateKey: key, value: byKey.has(key) ? byKey.get(key) : null });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function keyOf(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Consecutive days with at least one qualifying log, counting back from today.
   Spec §23: experience comes from logged activity, not from opening the app —
   so an empty day breaks the streak even if the app was launched. */
export function currentStreak(dateKeys = [], todayKey = keyOf(new Date())) {
  const set = new Set(dateKeys);
  let streak = 0;
  const cursor = new Date(`${todayKey}T00:00:00`);
  /* Today not yet logged should not read as a broken streak at 09:00, so start
     from yesterday when today is empty. */
  if (!set.has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(keyOf(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

/* Data sufficiency, shown next to every derived figure. Spec §21 asks the app
   to be explicit about confidence rather than presenting a guess as a fact. */
export function sufficiency(sampleCount, { good = 14, fair = 7 } = {}) {
  if (sampleCount >= good) return { level: 'good', label: 'Good data', note: `${sampleCount} days logged` };
  if (sampleCount >= fair) return { level: 'fair', label: 'Limited data', note: `${sampleCount} days — treat as rough` };
  return { level: 'low', label: 'Not enough data', note: `${sampleCount} of ${fair} days needed` };
}

/* Adaptive TDEE (spec §21). Energy balance implied by observed weight change
   against recorded intake. Returns null rather than a number when the inputs
   cannot support one — an unreliable TDEE silently rewrites every target. */
export function adaptiveTdee({ weightSeries = [], calorieSeries = [], kcalPerKg = 7700 }) {
  const weights = weightSeries.filter((p) => p.value != null);
  const calories = calorieSeries.filter((p) => p.value != null && p.value > 0);
  if (weights.length < 7 || calories.length < 7) {
    return { value: null, confidence: sufficiency(Math.min(weights.length, calories.length)) };
  }
  const first = weights[0], last = weights[weights.length - 1];
  const days = Math.max(1, daysBetween(first.dateKey, last.dateKey));
  const deltaKg = last.value - first.value;
  const avgIntake = calories.reduce((s, p) => s + p.value, 0) / calories.length;
  const value = Math.round(avgIntake - (deltaKg * kcalPerKg) / days);
  return {
    value,
    confidence: sufficiency(Math.min(weights.length, calories.length)),
    basis: { days, deltaKg: round(deltaKg, 2), avgIntake: Math.round(avgIntake) }
  };
}

export function daysBetween(fromKey, toKey) {
  const a = new Date(`${fromKey}T00:00:00`);
  const b = new Date(`${toKey}T00:00:00`);
  return Math.round((b - a) / 86400000);
}
