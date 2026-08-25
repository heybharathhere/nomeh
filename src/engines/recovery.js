/* Recovery engine. Pure functions — no DOM, no database.
 *
 * This is the file most likely to mislead someone if it is written carelessly,
 * so two rules are enforced in code rather than left to good intentions:
 *
 *   1. It refuses to produce a score from too little data. A "readiness: 84"
 *      built from one night of sleep is noise wearing a badge, and someone will
 *      reasonably train hard on the strength of it.
 *   2. It never tells you to train harder. A recovery metric that says "you are
 *      primed, add load" is exactly how a fatigue signal becomes an injury.
 *      Good readiness is reported as good readiness, and what to do with it is
 *      left to the person.
 *
 * Scores are relative to your own baseline, not a population norm — a resting
 * heart rate of 48 means nothing until we know yours is usually 52.
 */

import { READINESS, TRAINING, SAFETY } from '../config/app.config.js';

const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
/* Strict on purpose. Number(null) is 0 and Number('') is 0, both of which are
   finite — so a lenient version of this helper turns a MISSING input into a
   present input with value zero. In this file that is not a rounding nuisance,
   it is a fabricated reading: an unlogged soreness score would arrive as 0 and
   be graded as perfect, and readiness would report a confident number built
   from nothing. Absence has to stay absent. */
const num = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

const stdev = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

/* -------------------------------------------------------------- baselines -- */

/* A baseline is the mean and spread of your own recent history. `ready` is false
   until there is enough of it, which is what lets the caller explain itself
   instead of inventing a comparison. */
export function baseline(values = [], days = READINESS.baselineDays) {
  const nums = values.map(num).filter((v) => v != null);
  if (nums.length < 3) {
    return { ready: false, samples: nums.length, needed: 3, mean: null, sd: null };
  }
  const recent = nums.slice(-days);
  return {
    ready: recent.length >= Math.min(days, 7),
    samples: recent.length,
    needed: Math.min(days, 7),
    mean: round(mean(recent), 2),
    sd: round(stdev(recent) ?? 0, 2),
  };
}

/* Where today sits against your baseline, as a 0–1 score.
   `higherIsBetter` flips the direction: more HRV is good, higher resting heart
   rate is not. */
function scoreAgainstBaseline(value, base, { higherIsBetter = true, sdSpan = 2 } = {}) {
  const v = num(value);
  if (v == null || !base?.ready || base.mean == null) return null;
  const sd = base.sd && base.sd > 0.01 ? base.sd : Math.abs(base.mean) * 0.05 || 1;
  const z = (v - base.mean) / sd;
  const directed = higherIsBetter ? z : -z;
  /* Map ±sdSpan standard deviations onto 0–1, centred at 0.5. */
  return clamp01(0.5 + directed / (2 * sdSpan));
}

/* --------------------------------------------------------------- sleep ----- */

export function sleepScore(minutes, target = READINESS.sleepTargetMinutes) {
  const m = num(minutes);
  if (m == null || m <= 0) return null;
  /* Ratio to target, capped — twelve hours is not twice as good as seven, and
     may itself be a signal worth noticing. */
  const ratio = m / target;
  if (ratio >= 1) return clamp01(1 - (ratio - 1) * 0.3);
  return clamp01(ratio ** 1.2);
}

export function analyseSleep(nights = []) {
  const rows = nights
    .map((n) => ({ dateKey: n.dateKey, minutes: num(n.minutes), quality: num(n.quality) }))
    .filter((n) => n.minutes != null && n.minutes > 0);

  if (!rows.length) return { ready: false, nights: 0, reason: 'No sleep logged yet.' };

  const mins = rows.map((r) => r.minutes);
  const qualities = rows.map((r) => r.quality).filter((q) => q != null);
  const avg = mean(mins);
  const sd = stdev(mins);
  const debt = rows.reduce((s, r) => s + Math.max(0, READINESS.sleepTargetMinutes - r.minutes), 0);

  /* Consistency matters as much as duration, and is the part people can
     actually change. It is reported plainly, without a verdict. */
  const consistency = sd == null ? null
    : sd < 30 ? 'very consistent'
    : sd < 60 ? 'fairly consistent'
    : sd < 90 ? 'variable'
    : 'highly variable';

  return {
    ready: true,
    nights: rows.length,
    averageMinutes: round(avg),
    sdMinutes: sd == null ? null : round(sd),
    consistency,
    debtMinutes: round(debt),
    averageQuality: qualities.length ? round(mean(qualities), 1) : null,
    shortNights: rows.filter((r) => r.minutes < READINESS.sleepTargetMinutes - 60).length,
    longestGap: Math.max(...mins),
    shortest: Math.min(...mins),
    note: SAFETY.noMedicalClaims
      ? 'Sleep figures here are what you logged, not a clinical measurement.'
      : null,
  };
}

/* ------------------------------------------------------------ readiness --- */

/* Inputs are all optional. Whatever exists is used, weights are renormalised
   over the present inputs, and if fewer than the configured minimum are present
   the function returns a refusal with a list of what is missing. */
export function readiness({
  sleepMinutes = null, restingHr = null, hrv = null, soreness = null, mood = null,
  loadRatio = null,
  history = {},
} = {}) {
  const bases = {
    restingHr: baseline(history.restingHr ?? []),
    hrv: baseline(history.hrv ?? []),
  };

  const inputs = [];
  const add = (key, score, detail) => {
    if (score == null) return;
    inputs.push({ key, score: round(score, 3), weight: READINESS.weights[key] ?? 0.1, ...detail });
  };

  add('sleep', sleepScore(sleepMinutes), {
    label: 'Sleep',
    value: sleepMinutes != null ? `${Math.floor(sleepMinutes / 60)}h ${sleepMinutes % 60}m` : null,
  });

  add('restingHr', scoreAgainstBaseline(restingHr, bases.restingHr, { higherIsBetter: false }), {
    label: 'Resting heart rate', value: restingHr != null ? `${restingHr} bpm` : null,
    baseline: bases.restingHr.mean,
  });

  add('hrv', scoreAgainstBaseline(hrv, bases.hrv, { higherIsBetter: true }), {
    label: 'HRV', value: hrv != null ? `${hrv} ms` : null, baseline: bases.hrv.mean,
  });

  /* Soreness and mood arrive as 1–5 scales. Soreness is inverted. */
  if (num(soreness) != null) {
    add('soreness', clamp01(1 - (num(soreness) - 1) / 4), { label: 'Soreness', value: `${soreness}/5` });
  }
  if (num(mood) != null) {
    add('mood', clamp01((num(mood) - 1) / 4), { label: 'Mood', value: `${mood}/5` });
  }

  /* Training load: a ratio near 1 is neutral; a spike reduces readiness. */
  if (num(loadRatio) != null) {
    const r = num(loadRatio);
    const score = r > TRAINING.loadRatioHigh ? clamp01(1 - (r - TRAINING.loadRatioHigh))
                : r < TRAINING.loadRatioLow ? 0.7
                : 0.85;
    add('load', score, { label: 'Training load', value: `ratio ${r}` });
  }

  const missing = Object.keys(READINESS.weights)
    .filter((k) => !inputs.some((i) => i.key === k))
    .map((k) => ({
      key: k,
      label: { sleep: 'Sleep', restingHr: 'Resting heart rate', hrv: 'HRV',
               load: 'Training load', soreness: 'Soreness', mood: 'Mood' }[k] ?? k,
    }));

  /* The refusal. Not an error state — a legitimate answer that happens to be
     "not enough to say". */
  if (inputs.length < READINESS.minInputs) {
    return {
      ready: false,
      score: null,
      inputCount: inputs.length,
      needed: READINESS.minInputs,
      inputs,
      missing,
      reason: `Readiness needs at least ${READINESS.minInputs} inputs to mean anything. ` +
              `There ${inputs.length === 1 ? 'is' : 'are'} ${inputs.length}.`,
    };
  }

  const totalWeight = inputs.reduce((s, i) => s + i.weight, 0);
  const raw = inputs.reduce((s, i) => s + i.score * i.weight, 0) / (totalWeight || 1);
  const score = Math.round(clamp01(raw) * 100);
  const band = READINESS.bands.find((b) => score >= b.min) ?? READINESS.bands[READINESS.bands.length - 1];

  /* Guidance never points upward. This is the guardrail, in code. */
  const guidance = SAFETY.noOvertrainingEncouragement
    ? (score >= 60
        ? 'Your usual training should feel manageable today.'
        : score >= 40
          ? 'Consider keeping intensity moderate today.'
          : 'Signals suggest backing off. Rest is training too.')
    : null;

  return {
    ready: true,
    score,
    band: band.label,
    colour: band.colour,
    inputs,
    missing,
    inputCount: inputs.length,
    guidance,
    caveat: 'A performance signal built from what you logged. Not a medical assessment.',
  };
}

/* ------------------------------------------------------- recovery status --- */

/* Combines readiness with load into one sentence for the dashboard. Returns
   null rather than filler when there is nothing worth saying. */
export function recoverySummary({ readinessResult, loadResult }) {
  if (!readinessResult?.ready && !loadResult?.ready) return null;

  const parts = [];
  if (readinessResult?.ready) parts.push(`Readiness ${readinessResult.score} (${readinessResult.band.toLowerCase()})`);
  if (loadResult?.ready) {
    parts.push(loadResult.status === 'spike' ? 'load is spiking'
             : loadResult.status === 'detraining' ? 'load has dropped off'
             : 'load is steady');
  }

  const concern = loadResult?.status === 'spike' || (readinessResult?.ready && readinessResult.score < 40);
  return {
    text: parts.join(', ') + '.',
    tone: concern ? 'alert' : 'recovery',
    concern,
    detail: concern ? (loadResult?.status === 'spike' ? loadResult.note : readinessResult?.guidance) : null,
  };
}

/* ---------------------------------------------------------- correlations --- */

/* Pearson correlation between two aligned daily series, used for the "does
   sleep affect my training?" question. Reported with its sample size and an
   explicit reminder that it is not causation, because that is exactly the
   inference people draw from a number like this. */
export function correlate(seriesA = [], seriesB = [], { minPairs = 12, weakThreshold = 0.3 } = {}) {
  const mapB = new Map(seriesB.filter((p) => p && p.value != null).map((p) => [p.dateKey, num(p.value)]));
  const pairs = [];
  for (const p of seriesA) {
    if (!p || p.value == null) continue;
    const b = mapB.get(p.dateKey);
    if (b == null) continue;
    const a = num(p.value);
    if (a == null) continue;
    pairs.push([a, b]);
  }

  if (pairs.length < minPairs) {
    return { ready: false, pairs: pairs.length, needed: minPairs,
             reason: `Needs ${minPairs} days where both were logged. There are ${pairs.length}.` };
  }

  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  const mx = mean(xs), my = mean(ys);
  let numer = 0, dx = 0, dy = 0;
  for (let i = 0; i < pairs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    numer += a * b; dx += a * a; dy += b * b;
  }
  const denom = Math.sqrt(dx * dy);
  if (!denom) return { ready: false, pairs: pairs.length, reason: 'One of the series never varies.' };

  const r = numer / denom;
  const abs = Math.abs(r);
  return {
    ready: true,
    r: round(r, 2),
    pairs: pairs.length,
    strength: abs < weakThreshold ? 'weak' : abs < 0.6 ? 'moderate' : 'strong',
    direction: r > 0 ? 'positive' : 'negative',
    meaningful: abs >= weakThreshold,
    caveat: 'Correlation, not cause. Both may follow something else entirely.',
  };
}
