/* Today (spec §43: "the user should primarily see what matters now").
 *
 * The discipline here is subtraction. The engines can produce dozens of numbers;
 * this screen shows the handful you can act on before lunch, and everything else
 * lives one tap away in Body or Timeline.
 */

import { el, card, metricBar, callout, fmt, tint, emptyState, roadmapCard } from '../core/ui.js';
import { Logs, Profile, dateKeyOf, dateKeyOffset } from '../db/repos.js';
import { getSetting } from '../db/database.js';
import { dailyTotals, currentStreak, sufficiency, seriesByDay, rollingAverage } from '../engines/analytics.js';
import { computeTargets, bmiContext } from '../engines/biomath.js';
import { describe } from './log.js';
import { LOG_TYPES } from '../engines/logparser.js';
import { enabled } from '../config/app.config.js';

export async function todayView() {
  const profile = await Profile.get();
  const clock = await getSetting('clock', '24h');
  const todayKey = dateKeyOf();

  const [todayLogs, recent] = await Promise.all([
    Logs.forDay(todayKey),
    Logs.between(dateKeyOffset(-29), todayKey)
  ]);

  const totals = dailyTotals(todayLogs);
  const targets = profile?.targetsOverridden ? profile.targets : computeTargets(profile);

  const loggedDays = [...new Set(recent.map((r) => r.dateKey))];
  const streak = currentStreak(loggedDays, todayKey);

  const host = el('div', { class: 'stack' });

  host.append(
    ...[
      el('p', { class: 'eyebrow' }, greeting()),
      el('h1', { class: 'page-title', style: { marginBottom: 'var(--s4)' } },
        profile?.name ? `${profile.name}, here's today` : "Here's today"),
      headline(totals, targets, streak),
      fuel(totals, targets),
      movement(totals),
      readiness(todayLogs, recent),
      weightTrend(recent, profile),
      analyticsPeek(),
      todayLog(todayLogs, clock),
      quickLinks(),
      roadmapCard('NoMeh', [
        'Concentric progress rings — layered SVG gauges for calories, protein, carbs, fats and water, replacing the linear bars above.',
        'Minimum Viable Workout — a 1-tap 5-minute fallback routine for low-energy days that still protects your streak.',
      ])
    ].filter(Boolean)
  );

  return host;
}

/* Direct routes to the screens that do not fit in the five-tab dock. Filtered by
   feature flag, so a slimmed-down build shows only what it actually has. */
function quickLinks() {
  const links = [
    { route: 'endurance', label: 'Runs & rides', feature: 'endurance' },
    { route: 'recovery', label: 'Recovery', feature: 'recovery' },
    { route: 'analytics', label: 'Analytics', feature: 'analytics' },
    { route: 'photos', label: 'Photos', feature: 'photos' },
    { route: 'body', label: 'Body', feature: 'measurements' },
    { route: 'timeline', label: 'Timeline' },
  ].filter((l) => enabled(l.feature));

  return el('div', { class: 'chip-row' },
    ...links.map((l) => el('a', { class: 'chip chip-btn', href: `#/${l.route}` }, l.label)));
}

/* This tab now doubles as "NoMeh" — Pulse and Analytics combined — so a link
   across to the full Analytics screen lives here rather than only in
   Settings. The full screen (trends, correlations, RPG stat tree, etc.) is
   unchanged; this is a doorway to it, not a rebuild of it. */
function analyticsPeek() {
  if (!enabled('analytics')) return null;
  return card('Analytics', {},
    el('div', { class: 'stack' },
      el('p', { class: 'card-note' }, 'Trends, correlations and your full history live here.'),
      el('a', { class: 'btn btn-sm', href: '#/analytics' }, 'Open Analytics')
    )
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Late one';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 22) return 'Evening';
  return 'Night';
}

/* The one big number is the streak, because consistency is the metric the spec
   puts first in its own priority order (§24) and the only one a user controls
   directly today. */
function headline(totals, targets, streak) {
  const entries = Object.values(totals.counts).reduce((a, b) => a + b, 0);
  return el('section', { class: 'card', style: tint('emerald') },
    el('div', { class: 'row' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Consistency'),
        el('p', { class: 'big-number' }, String(streak),
          el('span', {}, streak === 1 ? ' day' : ' days'))
      ),
      el('div', { class: 'spacer', style: { textAlign: 'right' } },
        el('p', { class: 'eyebrow' }, 'Logged today'),
        el('p', { class: 'big-number' }, String(entries),
          el('span', {}, entries === 1 ? ' entry' : ' entries'))
      )
    ),
    streak === 0
      ? el('p', { class: 'card-note', style: { marginTop: 'var(--s3)' } },
          'Log one thing to start a streak. Anything counts.')
      : el('p', { class: 'card-note', style: { marginTop: 'var(--s3)' } },
          'Days with at least one entry, counting back. Opening the app does not count.')
  );
}

function fuel(totals, targets) {
  if (!targets) return null;
  return card('Fuel', { note: 'Targets are estimates' },
    el('div', { class: 'stack' },
      metricBar({ name: 'Energy', value: totals.calories, target: targets.calories, unit: 'kcal', colour: 'amber' }),
      metricBar({ name: 'Protein', value: 0, target: targets.protein, unit: 'g', colour: 'amber' }),
      metricBar({ name: 'Water', value: totals.water, target: targets.water, unit: 'ml', colour: 'cyan' }),
      el('p', { class: 'card-note' },
        'Protein fills in when the food database arrives — energy logged by hand has no macro breakdown yet.')
    )
  );
}

function movement(totals) {
  const hasMovement = totals.distanceKm > 0 || totals.sets > 0 || totals.activeMinutes > 0;
  if (!hasMovement) {
    return card('Movement', {}, emptyState({
      title: 'Nothing moved yet today',
      message: 'A walk counts. So does one set.'
    }));
  }
  return card('Movement', {},
    el('dl', { class: 'kv' },
      totals.distanceKm > 0 ? el('dt', {}, 'Distance') : null,
      totals.distanceKm > 0 ? el('dd', {}, `${fmt.dec(totals.distanceKm, 2)} km`) : null,
      totals.activeMinutes > 0 ? el('dt', {}, 'Active time') : null,
      totals.activeMinutes > 0 ? el('dd', {}, fmt.duration(totals.activeMinutes)) : null,
      totals.sets > 0 ? el('dt', {}, 'Sets') : null,
      totals.sets > 0 ? el('dd', {}, `${totals.sets} · ${totals.reps} reps`) : null,
      totals.volumeKg > 0 ? el('dt', {}, 'Load volume') : null,
      totals.volumeKg > 0 ? el('dd', {}, `${fmt.int(totals.volumeKg)} kg`) : null
    )
  );
}

/* Readiness is deliberately refusing to produce a score yet.
 *
 * The spec describes a readiness engine over sleep, HRV, resting HR, load, RPE
 * and soreness. Inventing a green "Ready" badge from two data points would be
 * theatre, and a user would reasonably train hard on the strength of it. So the
 * screen shows which inputs exist and what is still missing. */
function readiness(todayLogs, recent) {
  const inputs = [
    { key: 'sleep',     label: 'Sleep' },
    { key: 'heartrate', label: 'Resting heart rate' },
    { key: 'soreness',  label: 'Soreness' },
    { key: 'energy',    label: 'Energy' },
    { key: 'stress',    label: 'Stress' }
  ];
  const present = new Set(todayLogs.map((l) => l.type));
  const have = inputs.filter((i) => present.has(i.key));
  const missing = inputs.filter((i) => !present.has(i.key));
  const history = sufficiency(new Set(recent.map((r) => r.dateKey)).size, { good: 14, fair: 7 });

  return card('Readiness', { note: history.label },
    el('div', { class: 'stack' },
      have.length < 3
        ? callout(
            `Readiness needs a baseline before it means anything. ${have.length} of 5 inputs logged today, ` +
            `and ${history.note.toLowerCase()}. Until then this stays blank rather than showing a number that ` +
            'would only be reflecting noise.',
            { tone: 'cyan', strongText: 'Not enough signal yet. ' })
        : callout(
            'Enough inputs for a rough read. The scoring model lands with the recovery engine, which ' +
            'compares today against your own 14-day baseline rather than a population average.',
            { tone: 'cyan', strongText: 'Baseline forming. ' }),
      el('div', { class: 'row-wrap' },
        ...have.map((i) => el('span', { class: 'tag', style: tint('emerald') }, i.label)),
        ...missing.map((i) => el('span', { class: 'tag' }, i.label))
      ),
      el('p', { class: 'card-note' },
        'Readiness is a training signal, not a medical assessment, and it never will be one.')
    )
  );
}

function weightTrend(recent, profile) {
  const weights = recent.filter((r) => r.type === 'weight');
  if (weights.length < 2) {
    return card('Weight', {}, emptyState({
      title: 'Two readings starts a trend',
      message: 'Daily scale weight swings by a kilo or more on water alone, so NoMeh! ' +
               'charts the seven-day average rather than the raw number.'
    }));
  }

  const series = seriesByDay(weights, {
    type: 'weight', from: recent[0].dateKey, to: recent[recent.length - 1].dateKey
  }).filter((p) => p.value != null);

  const smoothed = rollingAverage(series, 7);
  const latest = smoothed[smoothed.length - 1];
  const first = smoothed[0];
  const delta = latest.average - first.average;
  const bmiNow = profile?.heightCm ? (latest.value / ((profile.heightCm / 100) ** 2)) : null;
  const ctx = bmiNow ? bmiContext(Math.round(bmiNow * 10) / 10) : null;

  return card('Weight', { note: `${weights.length} readings` },
    el('div', { class: 'stack' },
      el('div', { class: 'row' },
        el('div', {},
          el('p', { class: 'eyebrow' }, '7-day average'),
          el('p', { class: 'big-number' }, fmt.dec(latest.average, 1), el('span', {}, ' kg'))),
        el('div', { class: 'spacer', style: { textAlign: 'right' } },
          el('p', { class: 'eyebrow' }, 'Change over window'),
          el('p', { class: 'big-number', style: { color: Math.abs(delta) < 0.15 ? 'var(--text-dim)' : 'var(--text)' } },
            `${delta > 0 ? '+' : ''}${fmt.dec(delta, 1)}`, el('span', {}, ' kg')))
      ),
      sparkline(smoothed.map((p) => p.average)),
      ctx ? el('p', { class: 'card-note' }, `BMI ${fmt.dec(bmiNow, 1)} — ${ctx.band}. ${ctx.caveat}`) : null
    )
  );
}

/* A tiny inline SVG chart. Recharts and friends are not worth 90 KB for this;
   the analytics phase can justify a real charting layer when it needs axes,
   tooltips and brushing. */
function sparkline(values) {
  if (values.length < 2) return null;
  const w = 300, h = 56, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(h));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Seven-day average weight, ${values.length} points, from ${values[0].toFixed(1)} to ${values[values.length - 1].toFixed(1)} kilograms`);

  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', pts.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--amber)');
  line.setAttribute('stroke-width', '2');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');

  const dot = document.createElementNS(ns, 'circle');
  const [lx, ly] = pts[pts.length - 1].split(',');
  dot.setAttribute('cx', lx); dot.setAttribute('cy', ly); dot.setAttribute('r', '3');
  dot.setAttribute('fill', 'var(--amber)');

  svg.append(line, dot);
  return svg;
}

function todayLog(logs, clock) {
  if (!logs.length) return null;
  const reversed = [...logs].reverse();
  return card("Today's entries", { note: `${logs.length} total` },
    el('div', { class: 'list-rows' },
      ...reversed.slice(0, 8).map((r) =>
        el('div', { class: 'entry', style: tint(LOG_TYPES[r.type]?.colour || 'emerald') },
          el('span', { class: 't' }, fmt.time(r.at, clock)),
          el('div', { class: 'body' },
            el('div', { class: 'head' },
              el('span', { class: 'swatch', 'aria-hidden': 'true' }),
              el('span', {}, LOG_TYPES[r.type]?.label || r.type)),
            el('span', { class: 'meta' }, describe(r))),
          el('span', {})
        ))
    ),
    logs.length > 8
      ? el('a', { class: 'btn btn-ghost btn-sm', href: '#/timeline', style: { marginTop: 'var(--s3)' } },
          `See all ${logs.length}`)
      : null
  );
}
