/* Natural-language quick-log parser.
 *
 * Contract, and the reason this file is pure with no database access:
 * parsing NEVER writes. It returns candidate records with a confidence score,
 * the UI shows exactly what would be saved, and the user confirms. Silent
 * misparsing of health data is worse than no parsing at all — a phantom 8 km
 * run corrupts training load, personal records and every trend built on them.
 */

import { convert } from './biomath.js';

export const LOG_TYPES = {
  water:        { label: 'Water',        colour: 'cyan',    unit: 'ml'  },
  electrolytes: { label: 'Electrolytes', colour: 'cyan',    unit: 'ml'  },
  weight:       { label: 'Weight',       colour: 'amber',   unit: 'kg'  },
  measurement:  { label: 'Measurement',  colour: 'amber',   unit: 'cm'  },
  food:         { label: 'Food',         colour: 'amber',   unit: 'kcal' },
  run:          { label: 'Run',          colour: 'emerald', unit: 'km'  },
  walk:         { label: 'Walk',         colour: 'emerald', unit: 'km'  },
  cycle:        { label: 'Cycling',      colour: 'emerald', unit: 'km'  },
  workout:      { label: 'Workout',      colour: 'violet',  unit: null  },
  exercise:     { label: 'Exercise',     colour: 'violet',  unit: null  },
  sleep:        { label: 'Sleep',        colour: 'cyan',    unit: 'h'   },
  heartrate:    { label: 'Heart rate',   colour: 'crimson', unit: 'bpm' },
  mood:         { label: 'Mood',         colour: 'cyan',    unit: '/5'  },
  energy:       { label: 'Energy',       colour: 'cyan',    unit: '/5'  },
  stress:       { label: 'Stress',       colour: 'crimson', unit: '/5'  },
  soreness:     { label: 'Soreness',     colour: 'crimson', unit: '/5'  },
  note:         { label: 'Note',         colour: 'violet',  unit: null  }
};

const NUM = '(\\d+(?:[.,]\\d+)?)';
const n = (s) => parseFloat(String(s).replace(',', '.'));

/* ------------------------------------------------------------ helpers ---- */

/* Accepts 31min, 31 minutes, 31:00, 1h05, 1:05:30, 90s. Returns minutes. */
export function parseDuration(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  let m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m) return +m[1] * 60 + +m[2] + +m[3] / 60;

  m = t.match(/^(\d{1,3}):(\d{2})$/);
  if (m) return +m[1] + +m[2] / 60;

  m = t.match(new RegExp(`^${NUM}\\s*h(?:ours?|rs?)?\\s*${NUM}?\\s*m?(?:in(?:ute)?s?)?$`));
  if (m && m[1]) return n(m[1]) * 60 + (m[2] ? n(m[2]) : 0);

  m = t.match(new RegExp(`^${NUM}\\s*m(?:in(?:ute)?s?)?$`));
  if (m) return n(m[1]);

  m = t.match(new RegExp(`^${NUM}\\s*s(?:ec(?:ond)?s?)?$`));
  if (m) return n(m[1]) / 60;

  return null;
}

/* Returns kilometres. "5k" is treated as 5 km, which is the near-universal
   convention in running, rather than 5000 of anything. */
export function parseDistance(text) {
  if (!text) return null;
  const t = text.toLowerCase().trim();

  let m = t.match(new RegExp(`^${NUM}\\s*(?:km|k|kms|kilometre?s?|kilometer?s?)$`));
  if (m) return n(m[1]);

  m = t.match(new RegExp(`^${NUM}\\s*(?:mi|mile|miles)$`));
  if (m) return convert.miToKm(n(m[1]));

  m = t.match(new RegExp(`^${NUM}\\s*(?:m|metre?s?|meter?s?)$`));
  if (m) return n(m[1]) / 1000;

  return null;
}

/* The trailing `\d{1,2}(?!\d)` alternative is what makes the compact "7h30"
   form work. Without it the match stops at "7h" and thirty minutes of sleep
   quietly disappear — which is exactly the class of silent corruption the
   confirm-before-save rule exists to catch, but better not to produce at all. */
function grabDuration(segment) {
  const m = segment.match(
    /(?:\bin\b|\bfor\b|@)?\s*(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*h(?:ours?|rs?)?(?:\s*\d{1,2}\s*m(?:in(?:ute)?s?)?|\s*\d{1,2}(?!\d))?|\d+(?:[.,]\d+)?\s*m(?:in(?:ute)?s?)?\b|\d+(?:[.,]\d+)?\s*s(?:ec(?:ond)?s?)?\b)/i
  );
  return m ? parseDuration(m[1]) : null;
}

function grabDistance(segment) {
  const m = segment.match(/(\d+(?:[.,]\d+)?)\s*(km|kms|k|mi|miles?|metres?|meters?|m)\b/i);
  if (!m) return null;
  /* A bare "m" after a small number is far more likely to be minutes than
     metres in this input style, so require a plausible magnitude. */
  if (/^m$/i.test(m[2]) && n(m[1]) < 400) return null;
  return parseDistance(`${m[1]} ${m[2]}`);
}

const MEASUREMENT_SITES = ['waist', 'chest', 'hips', 'hip', 'neck', 'arm', 'arms',
  'bicep', 'biceps', 'thigh', 'thighs', 'calf', 'calves', 'shoulders', 'forearm'];

/* ------------------------------------------------------------ matchers --- */
/* Order matters. The first matcher that claims a segment wins, so the most
   specific patterns are listed first and `note` is the catch-all. */

const matchers = [
  // ---- hydration
  (s) => {
    const m = s.match(new RegExp(`(?:^|\\b)${NUM}\\s*(ml|l|litre?s?|liter?s?|oz|glass(?:es)?|cups?|bottles?)\\b`, 'i'));
    if (!m) return null;
    const isElectrolyte = /electrolyte|lmnt|ors|salt|nuun|isotonic/i.test(s);
    if (!isElectrolyte && !/water|hydrat|drink|fluid|glass|bottle|cup|\bl\b|ml/i.test(s)) return null;

    const unit = m[2].toLowerCase();
    const per = { glass: 250, glasses: 250, cup: 240, cups: 240, bottle: 500, bottles: 500 };
    let ml;
    if (unit === 'ml') ml = n(m[1]);
    else if (/^(l|litre|litres|liter|liters)$/.test(unit)) ml = n(m[1]) * 1000;
    else if (unit === 'oz') ml = n(m[1]) * 29.5735;
    else ml = n(m[1]) * (per[unit] ?? 250);

    return {
      type: isElectrolyte ? 'electrolytes' : 'water',
      value: Math.round(ml),
      unit: 'ml',
      detail: `${Math.round(ml)} ml`,
      confidence: /water|electrolyte|ml|litre|liter/i.test(s) ? 'high' : 'medium'
    };
  },

  // ---- body weight
  (s) => {
    const m = s.match(new RegExp(`(?:^|\\bweight\\b|\\bweighed\\b|\\bwas\\b)?\\s*${NUM}\\s*(kg|kgs|kilos?|lbs?|pounds?)\\b`, 'i'));
    if (!m) return null;
    if (MEASUREMENT_SITES.some((site) => new RegExp(`\\b${site}\\b`, 'i').test(s))) return null;
    if (/\b\d+\s*[x×]\s*\d+/i.test(s)) return null;         // that is a set, not a body weight

    const imperial = /^(lb|lbs|pound|pounds)$/i.test(m[2]);
    const kg = imperial ? convert.lbToKg(n(m[1])) : n(m[1]);
    if (kg < 20 || kg > 400) return null;                    // implausible; let note handle it

    return {
      type: 'weight', value: kg, unit: 'kg',
      detail: imperial ? `${n(m[1])} lb → ${kg} kg` : `${kg} kg`,
      confidence: /weight|weigh/i.test(s) ? 'high' : 'medium'
    };
  },

  // ---- body measurement
  (s) => {
    const site = MEASUREMENT_SITES.find((x) => new RegExp(`\\b${x}\\b`, 'i').test(s));
    if (!site) return null;
    const m = s.match(new RegExp(`${NUM}\\s*(cm|in|inch(?:es)?|mm)?\\b`, 'i'));
    if (!m) return null;
    let cm = n(m[1]);
    const unit = (m[2] || 'cm').toLowerCase();
    if (/^in/.test(unit)) cm = convert.inToCm(cm);
    if (unit === 'mm') cm = cm / 10;
    return {
      type: 'measurement', value: Math.round(cm * 10) / 10, unit: 'cm',
      site: site.replace(/s$/, ''),
      detail: `${site} ${Math.round(cm * 10) / 10} cm`,
      confidence: 'high'
    };
  },

  // ---- endurance session
  (s) => {
    const sport =
      /\b(ran|run|running|jog)/i.test(s)      ? 'run'   :
      /\b(walk|walked|hike|hiked)/i.test(s)   ? 'walk'  :
      /\b(cycl|bike|biked|rode|ride)/i.test(s)? 'cycle' : null;
    if (!sport) return null;

    const km = grabDistance(s);
    const mins = grabDuration(s);
    if (km == null && mins == null) return null;

    const parts = [];
    if (km != null) parts.push(`${km} km`);
    if (mins != null) parts.push(`${Math.round(mins)} min`);
    if (km != null && mins != null && km > 0) {
      const paceMin = mins / km;
      const mm = Math.floor(paceMin);
      const ss = Math.round((paceMin - mm) * 60);
      parts.push(`${mm}:${String(ss).padStart(2, '0')} /km`);
    }

    return {
      type: sport,
      value: km ?? null, unit: km != null ? 'km' : null,
      minutes: mins ?? null,
      detail: parts.join(' · '),
      confidence: km != null && mins != null ? 'high' : 'medium'
    };
  },

  // ---- resistance set:  3x10 pushups @ 20kg   |   bench 5x5 80kg
  (s) => {
    const m = s.match(new RegExp(`${NUM}\\s*[x×]\\s*${NUM}`, 'i'));
    if (!m) return null;
    const sets = n(m[1]);
    const reps = n(m[2]);
    const loadM = s.match(new RegExp(`(?:@|at)?\\s*${NUM}\\s*(kg|lbs?|pounds?)\\b`, 'i'));
    let loadKg = null;
    if (loadM) {
      loadKg = /^(lb|lbs|pound|pounds)$/i.test(loadM[2]) ? convert.lbToKg(n(loadM[1])) : n(loadM[1]);
    }
    const rpeM = s.match(/\brpe\s*(\d+(?:\.\d)?)/i);

    /* Name = the words that are not numbers, units or connectives. */
    const name = s
      .replace(new RegExp(`${NUM}\\s*[x×]\\s*${NUM}`, 'i'), ' ')
      .replace(new RegExp(`${NUM}\\s*(kg|lbs?|pounds?)`, 'ig'), ' ')
      .replace(/\brpe\s*\d+(?:\.\d)?/ig, ' ')
      .replace(/[@,]|\bat\b|\bfor\b|\bof\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const bits = [`${sets} × ${reps}`];
    if (loadKg != null) bits.push(`${loadKg} kg`);
    if (rpeM) bits.push(`RPE ${rpeM[1]}`);

    return {
      type: 'exercise',
      exercise: name || 'Unnamed exercise',
      sets, reps, loadKg,
      rpe: rpeM ? n(rpeM[1]) : null,
      detail: `${name || 'exercise'} — ${bits.join(' · ')}`,
      confidence: name ? 'high' : 'medium'
    };
  },

  // ---- sleep
  (s) => {
    if (!/\bslept?\b|\bsleep\b|\bbed\b/i.test(s)) return null;
    const mins = grabDuration(s) ?? (() => {
      const m = s.match(new RegExp(`${NUM}\\s*h?`, 'i'));
      return m ? n(m[1]) * 60 : null;
    })();
    if (mins == null) return null;
    const qm = s.match(/\bquality\s*(\d)\b|\b(\d)\s*\/\s*5\b/i);
    return {
      type: 'sleep',
      minutes: Math.round(mins),
      quality: qm ? +(qm[1] || qm[2]) : null,
      detail: `${Math.floor(mins / 60)}h ${String(Math.round(mins % 60)).padStart(2, '0')}m` +
              (qm ? ` · quality ${qm[1] || qm[2]}/5` : ''),
      confidence: 'high'
    };
  },

  // ---- heart rate
  (s) => {
    const m = s.match(new RegExp(`(?:\\bhr\\b|heart\\s*rate|\\bbpm\\b|\\brhr\\b|resting)[^\\d]*${NUM}|${NUM}\\s*bpm`, 'i'));
    if (!m) return null;
    const v = n(m[1] || m[2]);
    if (v < 25 || v > 240) return null;
    const resting = /rest|rhr|morning/i.test(s);
    return {
      type: 'heartrate', value: Math.round(v), unit: 'bpm',
      kind: resting ? 'resting' : 'spot',
      detail: `${Math.round(v)} bpm${resting ? ' · resting' : ''}`,
      confidence: 'high'
    };
  },

  // ---- subjective 1–5 scales
  (s) => {
    const scale = ['mood', 'energy', 'stress', 'soreness'].find((k) => new RegExp(`\\b${k}\\b`, 'i').test(s));
    if (!scale) return null;
    const m = s.match(new RegExp(`${NUM}(?:\\s*/\\s*5)?`));
    if (!m) return null;
    const v = Math.max(1, Math.min(5, Math.round(n(m[1]))));
    return {
      type: scale, value: v, unit: '/5',
      detail: `${scale} ${v}/5`,
      confidence: 'high'
    };
  },

  // ---- food with an explicit energy value
  (s) => {
    const m = s.match(new RegExp(`${NUM}\\s*(kcal|cal|calories|kj)\\b`, 'i'));
    if (!m) return null;
    let kcal = n(m[1]);
    if (/^kj$/i.test(m[2])) kcal = convert.kjToKcal(kcal);
    const name = s.replace(new RegExp(`${NUM}\\s*(kcal|cal|calories|kj)`, 'i'), ' ')
                  .replace(/\s+/g, ' ').trim();
    return {
      type: 'food',
      label: name || 'Food',
      value: Math.round(kcal), unit: 'kcal',
      detail: `${name || 'food'} — ${Math.round(kcal)} kcal`,
      confidence: 'medium'
    };
  }
];

/* ------------------------------------------------------------ public ----- */

export function parseQuickLog(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return [];

  /* Only explicit separators split a line. Splitting on spaces would tear
     "5 km run in 31 minutes" into confetti. */
  const segments = raw.split(/\s*(?:;|\n|\||\s\+\s|\bthen\b|,\s*(?=\d|water|weight|mood|energy|stress|slept))\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  for (const seg of segments) {
    let claimed = null;
    for (const match of matchers) {
      try { claimed = match(seg); } catch { claimed = null; }
      if (claimed) break;
    }

    if (claimed) {
      out.push({ ...claimed, source: 'parsed', text: seg, meta: LOG_TYPES[claimed.type] });
    } else {
      out.push({
        type: 'note', note: seg, detail: seg,
        confidence: 'low', source: 'parsed', text: seg, meta: LOG_TYPES.note
      });
    }
  }
  return out;
}

/* Turns a confirmed candidate into the row shape the logs table expects.
   Kept separate from parsing so the UI can let a user edit a candidate before
   it is committed. */
export function candidateToRecord(c) {
  const base = {
    type: c.type,
    at: c.at ?? Date.now(),
    source: c.source ?? 'manual',
    note: c.note ?? null
  };
  const carry = ['value', 'unit', 'minutes', 'site', 'label', 'quality',
                 'exercise', 'sets', 'reps', 'loadKg', 'rpe', 'kind'];
  for (const k of carry) if (c[k] !== undefined && c[k] !== null) base[k] = c[k];
  return base;
}
