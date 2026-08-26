/* NoMeh tab — Pulse + Analytics combined (Tab0).
 *
 * Minimalist on purpose: a number should not need a paragraph next to it.
 * Where earlier drafts explained a design decision inline ("why this shows
 * a 7-day average", "why protein reads 0"), that reasoning now lives only
 * as a code comment — the user reads a screen, not documentation.
 */

import { el, card, metricBar, emptyState } from '../../core/ui.js';
import { Logs, Profile, dateKeyOf, dateKeyOffset } from '../../db/repos.js';
import { getSetting } from '../../db/database.js';
import { dailyTotals, currentStreak, seriesByDay, rollingAverage, sufficiency, adaptiveTdee } from '../../engines/analytics.js';
import { computeTargets } from '../../engines/biomath.js';
import { describe } from '../log/view.js';
import { LOG_TYPES } from '../../engines/logparser.js';
import { enabled } from '../../config/app.config.js';
import { fmt, tint } from '../../core/ui.js';
import { quoteOfTheDay } from './quotes.js';

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
      headline(totals, streak, todayKey),
      fuel(totals, targets),
      movement(totals),
      readiness(todayLogs, recent),
      weightTrend(recent),
      analyticsPeek(recent),
      todayLog(todayLogs, clock),
      quickLinks(),
    ].filter(Boolean)
  );

  return host;
}

/* Direct routes to the screens that do not fit in the five-tab dock. */
function quickLinks() {
  const links = [
    { route: 'endurance', label: 'Runs & rides', feature: 'endurance' },
    { route: 'recovery', label: 'Recovery', feature: 'recovery' },
    { route: 'photos', label: 'Photos', feature: 'photos' },
    { route: 'body', label: 'Body', feature: 'measurements' },
    { route: 'timeline', label: 'Timeline' },
  ].filter((l) => enabled(l.feature));

  return el('div', { class: 'chip-row' },
    ...links.map((l) => el('a', { class: 'chip chip-btn', href: `#/${l.route}` }, l.label)));
}

/* Real analytics, embedded — not just a link out. Adaptive TDEE and a
   30-day consistency read, both built on the same engines the full
   Analytics screen uses. Still links out to that screen for the deeper
   charts (correlations, RPG tree, etc.) which stay their own page. */
function analyticsPeek(recent) {
  if (!enabled('analytics')) return null;

  const weightSeries = seriesByDay(recent.filter((r) => r.type === 'weight'), {
    type: 'weight', from: recent[0]?.dateKey, to: recent[recent.length - 1]?.dateKey
  });
  const calorieSeries = seriesByDay(recent.filter((r) => r.type === 'food' || r.type === 'calories'), {
    type: recent.some((r) => r.type === 'calories') ? 'calories' : 'food',
    from: recent[0]?.dateKey, to: recent[recent.length - 1]?.dateKey
  });
  const tdee = adaptiveTdee({ weightSeries, calorieSeries });

  const loggedDays = new Set(recent.map((r) => r.dateKey)).size;
  const consistency = sufficiency(loggedDays, { good: 21, fair: 10 });

  return card('Analytics', { note: consistency.label },
    el('div', { class: 'stack' },
      el('div', { class: 'row' },
        el('div', {},
          el('p', { class: 'eyebrow' }, 'Adaptive TDEE'),
          el('p', { class: 'big-number' },
            tdee.value != null ? String(tdee.value) : '—',
            el('span', {}, tdee.value != null ? ' kcal' : ''))
        ),
        el('div', { class: 'spacer', style: { textAlign: 'right' } },
          el('p', { class: 'eyebrow' }, '30-day'),
          el('p', { class: 'big-number' }, String(loggedDays), el('span', {}, ' days logged'))
        )
      ),
      el('a', { class: 'btn btn-sm', href: '#/analytics' }, 'Open full Analytics')
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

function headline(totals, streak, todayKey) {
  const entries = Object.values(totals.counts).reduce((a, b) => a + b, 0);
  return el('section', { class: 'card', style: tint('emerald') },
    el('div', { class: 'row' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Streak'),
        el('p', { class: 'big-number' }, String(streak),
          el('span', {}, streak === 1 ? ' day' : ' days'))
      ),
      el('div', { class: 'spacer', style: { textAlign: 'right' } },
        el('p', { class: 'eyebrow' }, 'Today'),
        el('p', { class: 'big-number' }, String(entries),
          el('span', {}, entries === 1 ? ' entry' : ' entries'))
      )
    ),
    el('p', { class: 'card-note', style: { marginTop: 'var(--s3)' } }, quoteOfTheDay(todayKey))
  );
}

function fuel(totals, targets) {
  if (!targets) return null;
  return card('Fuel', {},
    el('div', { class: 'stack' },
      metricBar({ name: 'Energy', value: totals.calories, target: targets.calories, unit: 'kcal', colour: 'amber' }),
      metricBar({ name: 'Protein', value: 0, target: targets.protein, unit: 'g', colour: 'amber' }),
      metricBar({ name: 'Water', value: totals.water, target: targets.water, unit: 'ml', colour: 'cyan' }),
    )
  );
}

function movement(totals) {
  const hasMovement = totals.distanceKm > 0 || totals.sets > 0 || totals.activeMinutes > 0;
  if (!hasMovement) {
    return card('Movement', {}, emptyState({ title: 'Nothing moved yet' }));
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

/* Readiness deliberately shows no score yet — a green "Ready" badge from a
   couple of data points would be theatre. Minimalist here means "say what's
   missing in one line", not "explain the whole design decision on screen". */
function readiness(todayLogs, recent) {
  const inputs = ['sleep', 'heartrate', 'soreness', 'energy', 'stress'];
  const present = new Set(todayLogs.map((l) => l.type));
  const have = inputs.filter((k) => present.has(k)).length;
  if (have >= 3) return null; // enough signal — nothing to nudge about today

  return card('Readiness', { note: `${have}/5 today` },
    el('p', { class: 'card-note' }, 'Not enough signal yet.'));
}

function weightTrend(recent) {
  const weights = recent.filter((r) => r.type === 'weight');
  if (weights.length < 2) {
    return card('Weight', {}, emptyState({ title: 'Two logs make a trend' }));
  }

  const series = seriesByDay(weights, {
    type: 'weight', from: recent[0].dateKey, to: recent[recent.length - 1].dateKey
  }).filter((p) => p.value != null);

  const smoothed = rollingAverage(series, 7);
  const latest = smoothed[smoothed.length - 1];
  const first = smoothed[0];
  const delta = latest.average - first.average;

  return card('Weight', { note: '7-day avg' },
    el('div', { class: 'stack' },
      el('div', { class: 'row' },
        el('div', {},
          el('p', { class: 'big-number' }, fmt.dec(latest.average, 1), el('span', {}, ' kg'))),
        el('div', { class: 'spacer', style: { textAlign: 'right' } },
          el('p', { class: 'big-number', style: { color: Math.abs(delta) < 0.15 ? 'var(--text-dim)' : 'var(--text)' } },
            `${delta > 0 ? '+' : ''}${fmt.dec(delta, 1)}`, el('span', {}, ' kg')))
      ),
      sparkline(smoothed.map((p) => p.average))
    )
  );
}

/* A tiny inline SVG chart — no charting library needed for one polyline. */
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
  return card("Today's entries", { note: `${logs.length}` },
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
