/* Analytics: trends over time.
 *
 * The rule this screen follows is that it never draws a confident line through
 * thin data. Every chart is paired with its sample count, and below the
 * sufficiency threshold the card says so instead of showing a trend that is
 * really just noise. Bodyweight is the clearest case — daily scale readings
 * swing a kilo on hydration alone, so the raw series is drawn faintly and the
 * rolling average is the line that actually means something.
 */

import { el, card, callout, fmt, colourVar, emptyState, roadmapCard } from '../core/ui.js';
import { db } from '../db/database.js';
import { dateKeyOf } from '../db/repos.js';
import { rollingAverage, sufficiency, adaptiveTdee } from '../engines/analytics.js';
import { sumNutrients } from '../engines/nutrition.js';
import { lineChart, barChart, stackedBarChart, legend } from '../core/charts.js';
import { ANALYTICS, PHYSIOLOGY, FEATURES } from '../config/app.config.js';
import { computeTargets } from '../engines/biomath.js';
import { Profile } from '../db/repos.js';
import { getSetting } from '../db/database.js';

function dateKeys(days) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(dateKeyOf(d));
  }
  return out;
}

async function load(days) {
  const keys = dateKeys(days);
  const from = keys[0];

  const [logs, meals, workouts, activities, health] = await Promise.all([
    db().logs.filter((l) => !l.deletedAt && l.dateKey >= from).toArray(),
    db().meals.filter((m) => !m.deletedAt && m.dateKey >= from).toArray(),
    db().workouts.filter((w) => !w.deletedAt && w.dateKey >= from && w.endedAt).toArray(),
    db().activities.filter((a) => !a.deletedAt && a.dateKey >= from && a.endedAt).toArray(),
    db().health.filter((h) => h.dateKey >= from).toArray(),
  ]);

  const mealIds = meals.map((m) => m.id);
  const items = mealIds.length ? await db().mealItems.where('mealId').anyOf(mealIds).toArray() : [];
  const mealDate = new Map(meals.map((m) => [m.id, m.dateKey]));

  /* Nutrition arrives from two places: the diary (meals + items) and the quick
     log bar (a bare calorie figure). Both count, so both are merged per day. */
  const nutritionByDay = new Map(keys.map((k) => [k, []]));
  for (const it of items) {
    const k = mealDate.get(it.mealId);
    if (nutritionByDay.has(k)) nutritionByDay.get(k).push(it);
  }
  for (const l of logs) {
    if (l.type === 'food' && nutritionByDay.has(l.dateKey)) {
      nutritionByDay.get(l.dateKey).push({ kcal: Number(l.value) || 0 });
    }
  }

  return { keys, logs, workouts, activities, health, nutritionByDay };
}

/* ------------------------------------------------------------- weight ----- */

function weightCard(keys, logs) {
  const byKey = new Map();
  for (const l of logs) {
    if (l.type !== 'weight') continue;
    /* Last reading of the day wins — a morning and an evening weigh-in are not
       two data points, they are one noisy one. */
    const prev = byKey.get(l.dateKey);
    if (!prev || l.at > prev.at) byKey.set(l.dateKey, l);
  }

  const series = keys.map((k) => (byKey.has(k) ? Number(byKey.get(k).value) : null));
  const present = series.filter((v) => v != null);
  if (!present.length) return null;

  const suff = sufficiency(present.length, ANALYTICS.sufficiency);
  const smoothed = rollingAverage(series, ANALYTICS.trendWindowDays);

  const first = present[0], last = present[present.length - 1];
  const change = last - first;

  const chart = lineChart({
    series: [
      { label: 'Daily', colour: 'recovery', points: series.map((y) => ({ y })), width: 1, dashed: true },
      { label: `${ANALYTICS.trendWindowDays}-day average`, colour: 'performance',
        points: smoothed.map((y) => ({ y })) },
    ],
    height: 160,
    ariaLabel: `Bodyweight over ${keys.length} days`,
  });

  return card('Bodyweight', { note: `${present.length} readings` },
    chart,
    legend([
      { label: 'Daily reading', colour: 'recovery' },
      { label: `${ANALYTICS.trendWindowDays}-day average`, colour: 'performance' },
    ]),
    el('p', { class: 'muted-sm' },
      `${change >= 0 ? '+' : ''}${change.toFixed(1)} kg across the period. ` +
      (suff.level === 'good'
        ? 'Enough readings for the trend to be meaningful.'
        : `Only ${present.length} readings — the trend line is indicative, not reliable.`)),
  );
}

/* -------------------------------------------------------------- energy ---- */

function energyCard(keys, nutritionByDay, targets) {
  const bars = keys.map((k) => {
    const totals = sumNutrients(nutritionByDay.get(k) ?? []);
    return { value: totals.kcal, label: k, colour: 'nutrition', faded: totals.kcal === 0 };
  });
  const logged = bars.filter((b) => b.value > 0);
  if (!logged.length) return null;

  const avg = Math.round(logged.reduce((s, b) => s + b.value, 0) / logged.length);

  return card('Energy intake', { note: `${logged.length} days logged` },
    barChart({
      bars, target: targets?.calories, height: 150,
      ariaLabel: 'Daily energy intake against target',
    }),
    el('p', { class: 'muted-sm' },
      `${fmt.int(avg)} kcal average on days you logged` +
      (targets?.calories ? `, against a ${fmt.int(targets.calories)} kcal target.` : '.') +
      (logged.length < keys.length
        ? ` ${keys.length - logged.length} days had nothing logged and are shown empty rather than as zero.`
        : '')),
  );
}

function macroCard(keys, nutritionByDay) {
  const rows = keys.map((k) => {
    const t = sumNutrients(nutritionByDay.get(k) ?? []);
    return { protein: t.protein, carbs: t.carbs, fat: t.fat };
  });
  if (!rows.some((r) => r.protein || r.carbs || r.fat)) return null;

  return card('Macro composition', { note: 'grams per day' },
    stackedBarChart({
      rows, keys: ['protein', 'carbs', 'fat'],
      colours: { protein: 'strength', carbs: 'performance', fat: 'recovery' },
      height: 150, ariaLabel: 'Daily macronutrients',
    }),
    legend([
      { label: 'Protein', colour: 'strength' },
      { label: 'Carbs', colour: 'performance' },
      { label: 'Fat', colour: 'recovery' },
    ]),
  );
}

/* ------------------------------------------------------------- training --- */

function volumeCard(keys, workouts, activities) {
  const volByDay = new Map(keys.map((k) => [k, 0]));
  for (const w of workouts) {
    if (volByDay.has(w.dateKey)) volByDay.set(w.dateKey, volByDay.get(w.dateKey) + (w.volumeLoad ?? 0));
  }
  const distByDay = new Map(keys.map((k) => [k, 0]));
  for (const a of activities) {
    if (distByDay.has(a.dateKey)) distByDay.set(a.dateKey, distByDay.get(a.dateKey) + (a.distanceM ?? 0) / 1000);
  }

  const hasVolume = [...volByDay.values()].some((v) => v > 0);
  const hasDistance = [...distByDay.values()].some((v) => v > 0);
  if (!hasVolume && !hasDistance) return null;

  const totalVol = [...volByDay.values()].reduce((a, b) => a + b, 0);
  const totalDist = [...distByDay.values()].reduce((a, b) => a + b, 0);

  return card('Training volume', {
    note: [hasVolume ? `${fmt.int(totalVol)} kg lifted` : null,
           hasDistance ? `${totalDist.toFixed(1)} km` : null].filter(Boolean).join(' · '),
  },
    hasVolume ? barChart({
      bars: keys.map((k) => ({ value: volByDay.get(k), label: k, colour: 'strength' })),
      height: 130, ariaLabel: 'Daily lifting volume',
    }) : null,
    hasDistance ? barChart({
      bars: keys.map((k) => ({ value: distByDay.get(k), label: k, colour: 'performance' })),
      height: 110, ariaLabel: 'Daily distance covered',
    }) : null,
    legend([
      hasVolume ? { label: 'Volume load (kg)', colour: 'strength' } : null,
      hasDistance ? { label: 'Distance (km)', colour: 'performance' } : null,
    ].filter(Boolean)),
  );
}

/* ------------------------------------------------------ adaptive expenditure */

function expenditureCard(keys, logs, nutritionByDay) {
  const weightByKey = new Map();
  for (const l of logs) {
    if (l.type !== 'weight') continue;
    const prev = weightByKey.get(l.dateKey);
    if (!prev || l.at > prev.at) weightByKey.set(l.dateKey, l);
  }

  /* adaptiveTdee needs {dateKey, value} pairs, not bare numbers — it derives the
     elapsed period from the first and last dateKey, so stripping the keys would
     leave it dividing by a day count it cannot see. */
  const weightSeries = keys
    .filter((k) => weightByKey.has(k))
    .map((k) => ({ dateKey: k, value: Number(weightByKey.get(k).value) }));
  const calorieSeries = keys
    .map((k) => ({ dateKey: k, value: sumNutrients(nutritionByDay.get(k) ?? []).kcal }))
    .filter((p) => p.value > 0);

  /* Both series are needed, and enough of both. Below the threshold this returns
     null and the card is not rendered at all — an expenditure estimate from four
     days of data would be actively misleading. */
  if (weightSeries.length < ANALYTICS.adaptiveTdeeMinDays ||
      calorieSeries.length < ANALYTICS.adaptiveTdeeMinDays) {
    return card('Adaptive expenditure', { note: 'Not enough data' },
      el('p', { class: 'muted-sm' },
        `Needs ${ANALYTICS.adaptiveTdeeMinDays} days with both a weight and a food log. ` +
        `Currently ${Math.min(weightSeries.length, calorieSeries.length)}. ` +
        'This is the one figure worth waiting for: measured from your own data, it beats any formula.'),
    );
  }

  const result = adaptiveTdee({ weightSeries, calorieSeries, kcalPerKg: PHYSIOLOGY.kcalPerKg });
  if (!result || result.value == null) {
    return card('Adaptive expenditure', { note: result?.confidence?.label ?? 'Not enough data' },
      el('p', { class: 'muted-sm' }, result?.confidence?.note ?? 'Not enough paired data yet.'));
  }

  return card('Adaptive expenditure', { note: 'from your own data' },
    el('div', { class: 'stat-grid' },
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Estimated maintenance'),
        el('strong', { style: { color: colourVar('performance') } },
          `${fmt.int(result.value)} kcal`)),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Measured over'),
        el('strong', {}, `${result.basis.days} days`)),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Weight change'),
        el('strong', {}, `${result.basis.deltaKg >= 0 ? '+' : ''}${result.basis.deltaKg} kg`)),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Average intake'),
        el('strong', {}, `${fmt.int(result.basis.avgIntake)} kcal`)),
    ),
    el('p', { class: 'muted-sm' },
      'Derived from actual weight change against actual intake, so it accounts for ' +
      'whatever your metabolism and activity really are rather than what a formula predicts.'),
  );
}

/* ---------------------------------------------------------------- view --- */

export async function analyticsView({ params } = {}) {
  if (!FEATURES.analytics) {
    return card('Analytics is switched off', {},
      el('p', { class: 'muted-sm' }, 'FEATURES.analytics is false in src/config/app.config.js.'));
  }

  const days = Number(params?.get?.('range')) || ANALYTICS.defaultRange;
  const { keys, logs, workouts, activities, health, nutritionByDay } = await load(days);

  const profile = await Profile.get();
  const override = await getSetting('targets.override', null);
  const targets = override ?? computeTargets(profile);

  const ranges = el('div', { class: 'chip-row' },
    ...ANALYTICS.ranges.map((r) => el('a', {
      class: 'chip chip-btn', href: `#/analytics?range=${r}`,
      dataset: { on: String(r === days) },
    }, `${r}d`)),
  );

  const cards = [
    weightCard(keys, logs),
    energyCard(keys, nutritionByDay, targets),
    macroCard(keys, nutritionByDay),
    volumeCard(keys, workouts, activities),
    expenditureCard(keys, logs, nutritionByDay),
    hrCard(keys, health),
  ].filter(Boolean);

  return el('div', { class: 'stack' },
    ranges,
    ...cards,
    cards.length === 0 ? emptyState({
      title: 'Nothing to chart yet',
      message: 'Charts appear as data accumulates. A week of weight and food logs is enough for the first trends.',
    }) : null,
    cards.length ? callout(
      'Every chart here is built only from what you logged. Missing days are drawn as gaps, ' +
      'never as zeros — a day you did not weigh yourself is not a day you weighed nothing.',
      { tone: 'recovery' }) : null,
    roadmapCard('Analytics', [
      'Consistency heatmap — a GitHub-style daily grid across nutrition, workouts and hydration.',
      'RPG character stat tree — logged volume translated into Strength, Endurance and Vitality attributes.',
      'Streak shields — spend a rest-day shield to protect a streak, plus an automated weekly retrospective of splits, adherence and volume.',
      'Ghost Viewfinder photo comparison — split-slider and timelapse against your Day 1 photo (Photos already captures and stores photos; the overlay guide and comparison views are still coming).',
    ]),
  );
}

function hrCard(keys, health) {
  const byMetric = (metric) => {
    const m = new Map();
    for (const h of health) {
      if (h.metric !== metric) continue;
      const prev = m.get(h.dateKey);
      if (!prev || h.at > prev.at) m.set(h.dateKey, h);
    }
    return keys.map((k) => (m.has(k) ? Number(m.get(k).value) : null));
  };

  const rhr = byMetric('restingHr');
  const hrv = byMetric('hrv');
  const hasRhr = rhr.some((v) => v != null);
  const hasHrv = hrv.some((v) => v != null);
  if (!hasRhr && !hasHrv) return null;

  return card('Heart rate trends', {
    note: [hasRhr ? 'resting HR' : null, hasHrv ? 'HRV' : null].filter(Boolean).join(' · '),
  },
    hasRhr ? lineChart({
      series: [{ label: 'Resting HR', colour: 'alert', points: rhr.map((y) => ({ y })) }],
      height: 120, ariaLabel: 'Resting heart rate trend',
    }) : null,
    hasHrv ? lineChart({
      series: [{ label: 'HRV', colour: 'recovery', points: hrv.map((y) => ({ y })) }],
      height: 120, ariaLabel: 'Heart rate variability trend',
    }) : null,
    el('p', { class: 'muted-sm' },
      'Both are most useful as a change against your own baseline, not against anyone else\u2019s numbers.'),
  );
}
