/* Training engine. Pure functions — no DOM, no database.
 *
 * The rule that shapes this file: refuse rather than guess. A one-rep max
 * extrapolated from a set of twenty is not an estimate, it is a number-shaped
 * opinion, so `oneRepMax` returns null past the configured rep ceiling. Same
 * for the load model, which stays silent until it has enough history to say
 * something true.
 */

import { TRAINING, PHYSIOLOGY, SAFETY } from '../config/app.config.js';

const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };

/* ------------------------------------------------------------ one-rep max -- */

const FORMULAS = {
  /* Epley: the common default. Diverges upward at high reps. */
  epley:    (w, r) => w * (1 + r / 30),
  /* Brzycki: slightly more conservative in the 6–10 range. */
  brzycki:  (w, r) => w * (36 / (37 - r)),
  /* Lombardi: a power curve, most forgiving at low reps. */
  lombardi: (w, r) => w * r ** 0.10,
};

export function oneRepMax(weight, reps, formula = TRAINING.oneRmFormula) {
  if (!(weight > 0) || !(reps > 0)) return null;
  if (reps === 1) return round(weight, 1);
  /* Past this many reps the formulas disagree with each other by more than the
     answer is worth, so no number is offered. */
  if (reps > TRAINING.oneRmMaxReps) return null;
  const fn = FORMULAS[formula] ?? FORMULAS.epley;
  const value = fn(weight, reps);
  if (!Number.isFinite(value) || value <= 0) return null;
  return round(value, 1);
}

/* All three formulas, so the UI can show the spread rather than implying a
   precision that does not exist. */
export function oneRepMaxRange(weight, reps) {
  if (!(weight > 0) || !(reps > 0) || reps > TRAINING.oneRmMaxReps) return null;
  const values = Object.entries(FORMULAS)
    .map(([name, fn]) => ({ name, value: round(fn(weight, reps), 1) }))
    .filter((v) => Number.isFinite(v.value));
  if (!values.length) return null;
  const nums = values.map((v) => v.value);
  return {
    values,
    low: Math.min(...nums),
    high: Math.max(...nums),
    chosen: oneRepMax(weight, reps),
    spread: round(Math.max(...nums) - Math.min(...nums), 1),
  };
}

/* Volume load: the honest workhorse metric. Sets × reps × load. */
export function volumeLoad(sets = []) {
  return round(sets.reduce((sum, s) => {
    const reps = Number(s.reps) || 0;
    const load = Number(s.loadKg) || 0;
    return sum + reps * load;
  }, 0), 1);
}

/* Total reps, useful for bodyweight work where load is zero. */
export function totalReps(sets = []) {
  return sets.reduce((sum, s) => sum + (Number(s.reps) || 0), 0);
}

/* ------------------------------------------------------------------- PRs --- */

/* A personal record is only interesting per exercise and per kind. Three kinds
   matter: heaviest single, best estimated max, and biggest session volume. */
export function detectPRs({ exercise, sets = [], history = [] }) {
  if (!exercise || !sets.length) return [];

  const best = (rows, pick) => rows.reduce((m, r) => {
    const v = pick(r);
    return v != null && (m == null || v > m) ? v : m;
  }, null);

  const prev = {
    weight: best(history, (h) => h.kind === 'weight' ? h.value : null),
    e1rm:   best(history, (h) => h.kind === 'e1rm'   ? h.value : null),
    volume: best(history, (h) => h.kind === 'volume' ? h.value : null),
    reps:   best(history, (h) => h.kind === 'reps'   ? h.value : null),
  };

  const heaviest = best(sets, (s) => Number(s.loadKg) > 0 ? Number(s.loadKg) : null);
  const bestE1rm = best(sets, (s) => oneRepMax(Number(s.loadKg), Number(s.reps)));
  const volume   = volumeLoad(sets);
  const mostReps = best(sets, (s) => Number(s.loadKg) ? null : Number(s.reps) || null);

  const found = [];
  const add = (kind, value, unit, label) => {
    if (value == null || !(value > 0)) return;
    if (prev[kind] != null && value <= prev[kind]) return;
    found.push({
      exercise, kind, value: round(value, 1), unit, label,
      previous: prev[kind] ?? null,
      delta: prev[kind] != null ? round(value - prev[kind], 1) : null,
      first: prev[kind] == null,
    });
  };

  add('weight', heaviest, 'kg', 'Heaviest set');
  add('e1rm',   bestE1rm, 'kg', 'Estimated 1RM');
  add('volume', volume,   'kg', 'Session volume');
  add('reps',   mostReps, 'reps', 'Most reps');

  return found;
}

/* ----------------------------------------------------------- progression --- */

/* Suggests the next step. Deliberately conservative, and it will suggest
   holding or reducing — a progression engine that only ever points upward is
   how people get hurt. */
export function suggestProgression({ exercise, recentSessions = [], bodyPart = 'upper' }) {
  if (!recentSessions.length) {
    return { action: 'baseline', message: 'Log a session to establish a starting point.' };
  }

  const ordered = [...recentSessions].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const last = ordered[0];
  const lastSets = last.sets ?? [];
  if (!lastSets.length) {
    return { action: 'baseline', message: 'Last session recorded no sets.' };
  }

  const rpes = lastSets.map((s) => Number(s.rpe)).filter((n) => n > 0);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const allTargetsMet = lastSets.every((s) => !s.targetReps || (Number(s.reps) || 0) >= Number(s.targetReps));
  const topLoad = Math.max(...lastSets.map((s) => Number(s.loadKg) || 0));

  /* Fatigue signal first. Never respond to a hard session by prescribing more —
     that guardrail is a configuration switch so it is auditable. */
  if (avgRpe != null && avgRpe >= 9.5 && SAFETY.noOvertrainingEncouragement) {
    return {
      action: 'hold',
      message: 'Last session was at or near failure. Repeat the same load before adding any.',
      load: topLoad,
    };
  }

  /* Count consecutive recent sessions that were comfortably completed. */
  let easyStreak = 0;
  for (const s of ordered) {
    const r = (s.sets ?? []).map((x) => Number(x.rpe)).filter((n) => n > 0);
    const a = r.length ? r.reduce((p, c) => p + c, 0) / r.length : null;
    const met = (s.sets ?? []).every((x) => !x.targetReps || (Number(x.reps) || 0) >= Number(x.targetReps));
    if (met && a != null && a <= TRAINING.easyRpe) easyStreak++;
    else break;
  }

  if (easyStreak >= TRAINING.sessionsBeforeIncrease && topLoad > 0) {
    const step = TRAINING.loadIncrement[bodyPart] ?? TRAINING.loadIncrement.upper;
    return {
      action: 'increase',
      message: `${easyStreak} sessions completed at RPE ${TRAINING.easyRpe} or below. Adding ${step} kg is reasonable.`,
      load: round(topLoad + step, 1),
      from: topLoad,
      step,
    };
  }

  if (easyStreak >= TRAINING.sessionsBeforeIncrease && topLoad === 0) {
    return {
      action: 'increase-reps',
      message: 'Bodyweight work is going well. Add a rep per set, or slow the tempo.',
    };
  }

  if (!allTargetsMet) {
    return {
      action: 'repeat',
      message: 'Prescribed reps were not all completed. Repeat this load.',
      load: topLoad,
    };
  }

  return {
    action: 'continue',
    message: `On track. ${TRAINING.sessionsBeforeIncrease - easyStreak} more comfortable session(s) before adding load.`,
    load: topLoad,
  };
}

/* ---------------------------------------------------------- session load --- */

/* Duration × RPE. Crude, robust, and needs no chest strap — which matters when
   Web Bluetooth does not exist on iOS at all. */
export function sessionLoad({ minutes, rpe, avgHr = null, maxHr = null, restingHr = null }) {
  if (minutes > 0 && rpe > 0) return round(minutes * rpe);
  /* Heart-rate fallback: TRIMP-style weighting when RPE was not recorded. */
  if (minutes > 0 && avgHr > 0 && maxHr > 0 && restingHr > 0 && maxHr > restingHr) {
    const reserve = (avgHr - restingHr) / (maxHr - restingHr);
    if (reserve > 0) return round(minutes * reserve * 10);
  }
  return null;
}

export function maxHeartRate(ageYears, formula = PHYSIOLOGY.hrMaxFormula) {
  if (!(ageYears > 0)) return null;
  /* Tanaka is better across the age range than the familiar 220 − age. */
  return round(formula === 'simple' ? 220 - ageYears : 208 - 0.7 * ageYears);
}

export function heartRateZone(bpm, maxHr) {
  if (!(bpm > 0) || !(maxHr > 0)) return null;
  const frac = bpm / maxHr;
  const zone = PHYSIOLOGY.hrZones.find((z) => frac >= z.from && frac < z.to);
  if (!zone) return frac < PHYSIOLOGY.hrZones[0].from
    ? { zone: 0, label: 'Below zones', colour: 'recovery', percentOfMax: round(frac * 100) }
    : { ...PHYSIOLOGY.hrZones[PHYSIOLOGY.hrZones.length - 1], percentOfMax: round(frac * 100) };
  return { ...zone, percentOfMax: round(frac * 100) };
}

export function zoneBoundaries(maxHr) {
  if (!(maxHr > 0)) return [];
  return PHYSIOLOGY.hrZones.map((z) => ({
    ...z, fromBpm: Math.round(z.from * maxHr), toBpm: Math.round(Math.min(z.to, 1) * maxHr),
  }));
}

/* ----------------------------------------------------------- load model --- */

/* Exponentially weighted acute and chronic load, plus their ratio. The standard
   approach, and the one place in the app where a number genuinely warrants a
   caution flag: a sharp jump in acute load is the best available proxy for
   doing too much too quickly. */
export function trainingLoad(dailyLoads = []) {
  const rows = [...dailyLoads].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  if (rows.length < TRAINING.loadMinDays) {
    return {
      ready: false,
      days: rows.length,
      needed: TRAINING.loadMinDays,
      reason: `Training load needs ${TRAINING.loadMinDays} days of history. There are ${rows.length}.`,
    };
  }

  const kA = 2 / (TRAINING.acuteDays + 1);
  const kC = 2 / (TRAINING.chronicDays + 1);
  let acute = 0, chronic = 0;
  const series = [];

  for (const r of rows) {
    const load = Number(r.load) || 0;
    acute = load * kA + acute * (1 - kA);
    chronic = load * kC + chronic * (1 - kC);
    series.push({ dateKey: r.dateKey, acute: round(acute, 1), chronic: round(chronic, 1) });
  }

  const ratio = chronic > 0 ? round(acute / chronic, 2) : null;
  let status = 'steady', note = 'Acute and chronic load are in step.';
  if (ratio == null) {
    status = 'unknown'; note = 'Not enough accumulated load to compare against.';
  } else if (ratio > TRAINING.loadRatioHigh) {
    status = 'spike';
    note = 'Recent load is well above your established base. This is the pattern that precedes injury — ' +
           'consider an easier few days.';
  } else if (ratio < TRAINING.loadRatioLow) {
    status = 'detraining';
    note = 'Recent load is below your established base. That is fine if it is deliberate.';
  }

  return {
    ready: true,
    acute: round(acute, 1),
    chronic: round(chronic, 1),
    ratio,
    /* Training stress balance: chronic minus acute. Positive means fresher. */
    balance: round(chronic - acute, 1),
    status,
    note,
    series,
    days: rows.length,
  };
}

/* Rest suggestion for the timer, from the kind of set just logged. */
export function restFor(kind = 'hypertrophy') {
  return TRAINING.restSeconds[kind] ?? TRAINING.restSeconds.hypertrophy;
}

/* Which rep range a set falls into — used to pick a rest default and to
   describe a session without the user having to categorise it. */
export function setKind(reps) {
  const r = Number(reps) || 0;
  if (r <= 3) return 'strength';
  if (r <= 5) return 'power';
  if (r <= 12) return 'hypertrophy';
  return 'endurance';
}
