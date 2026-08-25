/* Recovery screen: sleep, readiness, training load.
 *
 * The interesting part of this screen is what it does when it has nothing to
 * say. Readiness refuses to produce a score below three inputs, and that refusal
 * is rendered as a first-class state with a list of what is missing — not as an
 * error, and not as a placeholder number. A fitness app that shows "readiness
 * 72" on your first day is guessing, and you would have no way to know.
 */

import { el, card, callout, fmt, tint, colourVar, emptyState, sheet, field, toast } from '../core/ui.js';
import { db } from '../db/database.js';
import { Sleep, Recovery, Health, dateKeyOf } from '../db/repos.js';
import { readiness, analyseSleep, recoverySummary, correlate } from '../engines/recovery.js';
import { trainingLoad } from '../engines/training.js';
import { lineChart, barChart, legend } from '../core/charts.js';
import { READINESS, FEATURES, ANALYTICS } from '../config/app.config.js';
import { refresh } from '../core/router.js';

/* --------------------------------------------------------------- loading -- */

function lastNDateKeys(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i);
    out.push(dateKeyOf(x));
  }
  return out;
}

async function loadRecovery(days = 30) {
  const keys = lastNDateKeys(days);
  const from = keys[0];

  const [sleepRows, recoveryRows, healthRows, loadRows] = await Promise.all([
    db().sleep.filter((s) => !s.deletedAt && s.dateKey >= from).toArray(),
    db().recovery.filter((r) => r.dateKey >= from).toArray(),
    db().health.filter((h) => h.dateKey >= from).toArray(),
    db().trainingLoad.filter((t) => t.dateKey >= from).toArray(),
  ]);

  /* Sleep and heart-rate figures may also arrive through the universal log bar,
     so both sources are merged or the two screens disagree. */
  const logRows = await db().logs
    .filter((l) => !l.deletedAt && l.dateKey >= from &&
      ['sleep', 'heartrate', 'mood', 'soreness', 'energy', 'stress'].includes(l.type))
    .toArray();

  return { keys, sleepRows, recoveryRows, healthRows, loadRows, logRows };
}

/* Builds the per-day picture the engines consume. */
function assemble({ keys, sleepRows, recoveryRows, healthRows, loadRows, logRows }) {
  const byKey = new Map(keys.map((k) => [k, {
    dateKey: k, sleepMinutes: null, restingHr: null, hrv: null,
    soreness: null, mood: null, load: 0,
  }]));

  for (const s of sleepRows) {
    const row = byKey.get(s.dateKey);
    if (row) row.sleepMinutes = Number(s.minutes) || row.sleepMinutes;
  }
  for (const l of logRows) {
    const row = byKey.get(l.dateKey);
    if (!row) continue;
    if (l.type === 'sleep' && row.sleepMinutes == null) row.sleepMinutes = Number(l.value) || null;
    if (l.type === 'heartrate' && row.restingHr == null) row.restingHr = Number(l.value) || null;
    if (l.type === 'mood' && row.mood == null) row.mood = Number(l.value) || null;
    if (l.type === 'soreness' && row.soreness == null) row.soreness = Number(l.value) || null;
  }
  for (const r of recoveryRows) {
    const row = byKey.get(r.dateKey);
    if (!row) continue;
    if (r.restingHr != null) row.restingHr = Number(r.restingHr);
    if (r.hrv != null) row.hrv = Number(r.hrv);
    if (r.soreness != null) row.soreness = Number(r.soreness);
    if (r.mood != null) row.mood = Number(r.mood);
  }
  for (const h of healthRows) {
    const row = byKey.get(h.dateKey);
    if (!row) continue;
    if (h.metric === 'restingHr' && row.restingHr == null) row.restingHr = Number(h.value);
    if (h.metric === 'hrv' && row.hrv == null) row.hrv = Number(h.value);
  }
  for (const t of loadRows) {
    const row = byKey.get(t.dateKey);
    if (row) row.load = Number(t.load) || 0;
  }

  return [...byKey.values()];
}

/* ------------------------------------------------------------- readiness -- */

function readinessCard(result, onLog) {
  if (!result.ready) {
    /* The refusal state. Named inputs, so it is obvious what to do next. */
    return card('Readiness', { note: 'Not enough data' },
      callout(result.reason, { tone: 'recovery' }),
      result.missing.length
        ? el('div', {},
            el('p', { class: 'muted-sm' }, 'Add any of these and a score becomes meaningful:'),
            el('div', { class: 'chip-row' },
              ...result.missing.map((m) => el('span', { class: 'chip' }, m.label))),
          )
        : null,
      el('button', { class: 'btn btn-primary', onclick: onLog }, 'Log recovery data'),
    );
  }

  const bars = result.inputs.map((i) => el('div', { class: 'entry' },
    el('div', { class: 'entry-main' },
      el('span', { class: 'entry-label' }, i.label),
      el('span', { class: 'muted-sm' }, i.value ?? '—'),
    ),
    el('span', {
      class: 'entry-value',
      style: { color: colourVar(i.score >= 0.66 ? 'performance' : i.score >= 0.4 ? 'nutrition' : 'alert') },
    }, `${Math.round(i.score * 100)}`),
  ));

  return card('Readiness', { note: `${result.inputCount} inputs`, actions:
      el('button', { class: 'btn btn-sm', onclick: onLog }, 'Log') },
    el('div', { class: 'hud', style: tint(result.colour) },
      el('div', { class: 'hud-cell' },
        el('strong', { class: 'hud-value' }, String(result.score)),
        el('span', { class: 'muted-sm' }, result.band),
      ),
    ),
    result.guidance ? el('p', { class: 'muted-sm' }, result.guidance) : null,
    ...bars,
    el('p', { class: 'muted-sm' }, result.caveat),
  );
}

/* ----------------------------------------------------------------- sleep -- */

function sleepCard(analysis, series, onLog) {
  if (!analysis.ready) {
    return card('Sleep', {},
      el('p', { class: 'muted-sm' }, analysis.reason),
      el('button', { class: 'btn btn-primary', onclick: onLog }, 'Log a night'),
    );
  }

  const chart = lineChart({
    series: [{
      label: 'Sleep',
      colour: 'recovery',
      points: series.map((d) => ({ y: d.sleepMinutes != null ? d.sleepMinutes / 60 : null })),
    }],
    height: 130,
    ariaLabel: `Sleep hours over the last ${series.length} days`,
  });

  return card('Sleep', {
    note: `${fmt.duration(analysis.averageMinutes)} average`,
    actions: el('button', { class: 'btn btn-sm', onclick: onLog }, 'Log'),
  },
    chart,
    el('div', { class: 'stat-grid' },
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Consistency'),
        el('strong', {}, analysis.consistency ?? '—')),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Short nights'),
        el('strong', {}, `${analysis.shortNights} of ${analysis.nights}`)),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Shortest'),
        el('strong', {}, fmt.duration(analysis.shortest))),
      el('div', { class: 'stat-cell' },
        el('span', { class: 'muted-sm' }, 'Longest'),
        el('strong', {}, fmt.duration(analysis.longestGap))),
    ),
    analysis.debtMinutes > 240
      ? el('p', { class: 'muted-sm' },
          `Cumulative shortfall against a ${Math.round(READINESS.sleepTargetMinutes / 60)}h reference: ` +
          `${fmt.duration(analysis.debtMinutes)} over ${analysis.nights} nights.`)
      : null,
    analysis.note ? el('p', { class: 'muted-sm' }, analysis.note) : null,
  );
}

/* ------------------------------------------------------------------ load -- */

function loadCard(result, series) {
  if (!result.ready) {
    return card('Training load', { note: `${result.days} of ${result.needed} days` },
      el('p', { class: 'muted-sm' }, result.reason),
      series.some((d) => d.load > 0)
        ? barChart({
            bars: series.map((d) => ({ value: d.load, label: d.dateKey, colour: 'strength' })),
            height: 110, ariaLabel: 'Daily training load',
          })
        : null,
    );
  }

  const acuteSeries = result.series.map((s) => ({ y: s.acute }));
  const chronicSeries = result.series.map((s) => ({ y: s.chronic }));

  return card('Training load', {
    note: `ratio ${result.ratio ?? '—'}`,
  },
    lineChart({
      series: [
        { label: 'Acute (7d)', colour: 'alert', points: acuteSeries },
        { label: 'Chronic (28d)', colour: 'recovery', points: chronicSeries, dashed: true },
      ],
      height: 140,
      ariaLabel: 'Acute and chronic training load',
    }),
    legend([
      { label: `Acute ${result.acute}`, colour: 'alert' },
      { label: `Chronic ${result.chronic}`, colour: 'recovery' },
    ]),
    result.status === 'spike'
      ? callout(result.note, { tone: 'alert', strongText: 'Load spike: ' })
      : el('p', { class: 'muted-sm' }, result.note),
  );
}

/* --------------------------------------------------------------- logging -- */

function openRecoveryLog(onDone) {
  const hours = el('input', { class: 'input', type: 'number', min: '0', max: '24', step: '0.25', placeholder: 'hours' });
  const quality = el('input', { class: 'input', type: 'number', min: '1', max: '5', placeholder: '1–5' });
  const rhr = el('input', { class: 'input', type: 'number', min: '25', max: '140', placeholder: 'bpm' });
  const hrv = el('input', { class: 'input', type: 'number', min: '5', max: '250', placeholder: 'ms' });
  const soreness = el('input', { class: 'input', type: 'number', min: '1', max: '5', placeholder: '1–5' });
  const mood = el('input', { class: 'input', type: 'number', min: '1', max: '5', placeholder: '1–5' });

  sheet({
    title: 'Log recovery',
    body: el('div', {},
      el('p', { class: 'muted-sm' },
        'Fill in whatever you have. Anything left blank stays blank — the score is built ' +
        'only from real readings.'),
      field('Sleep', hours, 'hours, e.g. 7.5'),
      field('Sleep quality', quality, 'optional, 1–5'),
      el('div', { class: 'field-grid' },
        field('Resting HR', rhr, 'bpm'),
        field('HRV', hrv, 'ms'),
        field('Soreness', soreness, '1 none, 5 severe'),
        field('Mood', mood, '1 poor, 5 great'),
      ),
    ),
    confirmLabel: 'Save',
    onConfirm: async () => {
      const at = Date.now();
      const dateKey = dateKeyOf(at);
      const anySleep = Number(hours.value) > 0;
      const num = (input) => (input.value === '' ? null : Number(input.value));

      if (!anySleep && [rhr, hrv, soreness, mood].every((i) => i.value === '')) {
        toast('Nothing to save.');
        return false;
      }

      if (anySleep) {
        await Sleep.create({
          at, dateKey,
          minutes: Math.round(Number(hours.value) * 60),
          quality: num(quality),
        });
      }

      const recoveryFields = { restingHr: num(rhr), hrv: num(hrv), soreness: num(soreness), mood: num(mood) };
      if (Object.values(recoveryFields).some((v) => v != null)) {
        const existing = await db().recovery.filter((r) => r.dateKey === dateKey).first();
        if (existing) await db().recovery.update(existing.id, recoveryFields);
        else await Recovery.create({ at, dateKey, ...recoveryFields });
      }

      /* Resting heart rate is also a long-run health trend, so it is mirrored
         into the health table where the analytics screen looks for it. */
      if (recoveryFields.restingHr != null) {
        await Health.create({ metric: 'restingHr', value: recoveryFields.restingHr, at, dateKey });
      }
      if (recoveryFields.hrv != null) {
        await Health.create({ metric: 'hrv', value: recoveryFields.hrv, at, dateKey });
      }

      toast('Recovery logged.');
      onDone();
      return true;
    },
  });
}

/* ---------------------------------------------------------------- view --- */

export async function recoveryView() {
  if (!FEATURES.recovery && !FEATURES.sleep) {
    return card('Recovery is switched off', {},
      el('p', { class: 'muted-sm' }, 'FEATURES.recovery is false in src/config/app.config.js.'));
  }

  const raw = await loadRecovery(ANALYTICS.defaultRange);
  const series = assemble(raw);
  const onDone = () => refresh();
  const openLog = () => openRecoveryLog(onDone);

  const today = series[series.length - 1] ?? {};
  const load = trainingLoad(series.map((d) => ({ dateKey: d.dateKey, load: d.load })));

  const result = readiness({
    sleepMinutes: today.sleepMinutes,
    restingHr: today.restingHr,
    hrv: today.hrv,
    soreness: today.soreness,
    mood: today.mood,
    loadRatio: load.ready ? load.ratio : null,
    history: {
      restingHr: series.map((d) => d.restingHr).filter((v) => v != null),
      hrv: series.map((d) => d.hrv).filter((v) => v != null),
    },
  });

  const sleepAnalysis = analyseSleep(
    series.filter((d) => d.sleepMinutes != null)
      .map((d) => ({ dateKey: d.dateKey, minutes: d.sleepMinutes })),
  );

  const summary = recoverySummary({ readinessResult: result, loadResult: load });

  /* Does sleep track with training load? Only shown when there is enough
     overlapping data for the answer to mean anything. */
  const sleepVsLoad = correlate(
    series.map((d) => ({ dateKey: d.dateKey, value: d.sleepMinutes })),
    series.map((d) => ({ dateKey: d.dateKey, value: d.load })),
    { minPairs: ANALYTICS.correlationMinPairs, weakThreshold: ANALYTICS.correlationWeak },
  );

  const nothingLogged = !series.some((d) =>
    d.sleepMinutes != null || d.restingHr != null || d.hrv != null || d.load > 0);

  return el('div', { class: 'stack' },
    summary ? callout(summary.detail ? `${summary.text} ${summary.detail}` : summary.text,
                      { tone: summary.tone }) : null,
    readinessCard(result, openLog),
    FEATURES.sleep ? sleepCard(sleepAnalysis, series, openLog) : null,
    loadCard(load, series),
    sleepVsLoad.ready && sleepVsLoad.meaningful
      ? card('Sleep and load', { note: `r = ${sleepVsLoad.r}` },
          el('p', { class: 'muted-sm' },
            `A ${sleepVsLoad.strength} ${sleepVsLoad.direction} relationship across ` +
            `${sleepVsLoad.pairs} days. ${sleepVsLoad.caveat}`))
      : null,
    nothingLogged ? emptyState({
      title: 'No recovery data yet',
      message: 'Log a night of sleep and a resting heart rate. Readiness needs three ' +
               'different inputs before it will show a score, which usually means two or three days.',
    }) : null,
  );
}
