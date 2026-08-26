/* Body progression (spec §19) and goals (spec §6).
 *
 * The spec's instruction here is a design constraint, not a nicety: "the system
 * must avoid judging appearance. It presents objective trends." So this screen
 * has no ideal ranges, no traffic lights, no "you're on track" verdicts. It
 * shows what changed, over what window, and how much of that is likely to be
 * noise.
 */

import { el, card, callout, fmt, tint, emptyState, sheet, field, toast } from '../core/ui.js';
import { Logs, Goals, Profile, dateKeyOf, dateKeyOffset } from '../db/repos.js';
import { seriesByDay, rollingAverage } from '../engines/analytics.js';
import { ACTIVITY_FACTORS, GOALS as GOAL_DEFS } from '../engines/biomath.js';
import { refresh } from '../core/router.js';

const SITES = ['waist', 'chest', 'hip', 'neck', 'arm', 'thigh', 'calf', 'shoulders', 'forearm'];

export async function bodyView() {
  const from = dateKeyOffset(-89);
  const to = dateKeyOf();
  const [rows, goals, profile] = await Promise.all([
    Logs.between(from, to),
    Goals.list({ limit: 20 }),
    Profile.get()
  ]);

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Progression'),
    el('h1', { class: 'page-title' }, 'Body'),
    profileCard(profile),
    weightCard(rows.filter((r) => r.type === 'weight'), from, to),
    measurementCard(rows.filter((r) => r.type === 'measurement')),
    goalsCard(goals),
    photosCard(),
    profile ? targetsCard(profile) : null
  );
}

/* What onboarding collected, shown as-is — the same facts computeTargets()
   already uses, just visible now instead of only feeding a formula. */
function profileCard(profile) {
  if (!profile) {
    return card('Profile', {}, emptyState({
      title: 'No profile yet',
      message: 'Run setup from Settings to fill this in.'
    }));
  }

  const activity = ACTIVITY_FACTORS[profile.activity]?.label ?? profile.activity;
  const goal = GOAL_DEFS[profile.primaryGoal]?.label ?? profile.primaryGoal;
  const sex = profile.sex ? profile.sex[0].toUpperCase() + profile.sex.slice(1) : null;

  return card('Profile', { note: 'From setup' },
    el('div', { class: 'stack' },
      el('dl', { class: 'kv' },
        sex ? el('dt', {}, 'Sex') : null,
        sex ? el('dd', {}, sex) : null,
        profile.ageYears ? el('dt', {}, 'Age') : null,
        profile.ageYears ? el('dd', {}, `${profile.ageYears}`) : null,
        profile.heightCm ? el('dt', {}, 'Height') : null,
        profile.heightCm ? el('dd', {}, `${fmt.dec(profile.heightCm, 0)} cm`) : null,
        profile.weightKg ? el('dt', {}, 'Starting weight') : null,
        profile.weightKg ? el('dd', {}, `${fmt.dec(profile.weightKg, 1)} kg`) : null,
        activity ? el('dt', {}, 'Activity') : null,
        activity ? el('dd', {}, activity) : null,
        goal ? el('dt', {}, 'Goal') : null,
        goal ? el('dd', {}, goal) : null,
      ),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/settings' }, 'Edit in Settings')
    )
  );
}

function weightCard(weights, from, to) {
  if (weights.length < 2) {
    return card('Weight', {}, emptyState({
      title: 'Not enough readings',
      message: 'Log weight on two separate days and the trend line starts. ' +
               'Same time of day, same conditions, makes the comparison worth something.'
    }));
  }

  const daily = seriesByDay(weights, { type: 'weight', from, to }).filter((p) => p.value != null);
  const smoothed = rollingAverage(daily, 7);
  const latest = smoothed[smoothed.length - 1];
  const oldest = smoothed[0];
  const trendDelta = latest.average - oldest.average;
  const rawSpread = Math.max(...daily.map((p) => p.value)) - Math.min(...daily.map((p) => p.value));

  return card('Weight', { note: `${weights.length} readings over ${daily.length} days` },
    el('div', { class: 'stack' },
      el('div', { class: 'grid-2' },
        stat('Latest reading', `${fmt.dec(daily[daily.length - 1].value, 1)} kg`, 'Single measurement'),
        stat('7-day average', `${fmt.dec(latest.average, 1)} kg`, `${latest.samples} samples`)
      ),
      el('div', { class: 'grid-2' },
        stat('Trend change', `${trendDelta > 0 ? '+' : ''}${fmt.dec(trendDelta, 1)} kg`, 'Average to average'),
        stat('Day-to-day spread', `${fmt.dec(rawSpread, 1)} kg`, 'Range of raw readings')
      ),
      rawSpread > Math.abs(trendDelta)
        ? callout('Your day-to-day variation is larger than the underlying change, which is normal — ' +
                  'food, salt, glycogen and hydration all move the scale. Judge direction from the ' +
                  'average, never from a single morning.', { tone: 'cyan' })
        : null
    )
  );
}

function measurementCard(rows) {
  if (!rows.length) {
    return card('Measurements', {}, emptyState({
      title: 'No measurements yet',
      message: 'Waist, chest, arms and thighs often move when scale weight refuses to.'
    }));
  }

  const bySite = new Map();
  for (const r of rows) {
    if (!bySite.has(r.site)) bySite.set(r.site, []);
    bySite.get(r.site).push(r);
  }

  return card('Measurements', { note: `${bySite.size} sites` },
    el('div', { class: 'list-rows' },
      ...[...bySite.entries()]
        .sort((a, b) => SITES.indexOf(a[0]) - SITES.indexOf(b[0]))
        .map(([site, list]) => {
          const sorted = [...list].sort((a, b) => a.at - b.at);
          const first = sorted[0], last = sorted[sorted.length - 1];
          const delta = last.value - first.value;
          const single = sorted.length === 1;
          return el('div', { class: 'row' },
            el('div', {},
              el('div', { style: { fontWeight: 600, textTransform: 'capitalize' } }, site),
              el('div', { class: 'hint' },
                single ? 'One reading' : `${sorted.length} readings over ${daysApart(first.at, last.at)} days`)
            ),
            el('div', { class: 'spacer', style: { textAlign: 'right' } },
              el('div', { style: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 } }, `${fmt.dec(last.value, 1)} cm`),
              single ? null : el('div', { class: 'hint' }, `${delta > 0 ? '+' : ''}${fmt.dec(delta, 1)} cm`)
            )
          );
        })
    )
  );
}

function goalsCard(goals) {
  const active = goals.filter((g) => g.status === 'active');
  const addBtn = el('button', { class: 'btn btn-sm btn-ghost', onclick: () => goalSheet() }, '+ Goal');

  if (!active.length) {
    return card('Goals', { actions: addBtn }, emptyState({
      title: 'No active goals',
      message: 'A goal with a number and a date is easier to act on than an intention.'
    }));
  }

  return card('Goals', { actions: addBtn },
    el('div', { class: 'list-rows' },
      ...active.map((g) => {
        const pct = (g.target != null && g.current != null && g.target !== 0)
          ? Math.max(0, Math.min(100, (g.current / g.target) * 100))
          : null;
        return el('div', { class: 'stack', style: { gap: 'var(--s2)' } },
          el('div', { class: 'row' },
            el('span', { style: { fontWeight: 600 } }, g.title),
            el('span', { class: 'tag spacer', style: tint(domainColour(g.domain)) }, g.domain || 'general')
          ),
          pct != null
            ? el('div', { class: 'bar', style: tint(domainColour(g.domain)) }, el('i', { style: { width: `${pct}%` } }))
            : el('p', { class: 'hint', style: { margin: 0 } }, 'No target set — add one to track progress.'),
          el('div', { class: 'row' },
            el('span', { class: 'hint' },
              g.target != null ? `${fmt.dec(g.current ?? 0, 1)} of ${fmt.dec(g.target, 1)}` : 'Open-ended'),
            el('span', { class: 'hint spacer' }, g.deadline ? `by ${g.deadline}` : 'no deadline'),
            el('button', {
              class: 'btn btn-sm btn-ghost',
              onclick: () => goalSheet(g)
            }, 'Edit')
          )
        );
      })
    )
  );
}

function domainColour(domain) {
  return { nutrition: 'amber', strength: 'violet', endurance: 'emerald', general: 'cyan' }[domain] || 'cyan';
}

function goalSheet(existing = null) {
  const title = el('input', { class: 'input', value: existing?.title ?? '', placeholder: 'Run 10K without stopping' });
  const domain = el('select', { class: 'select' },
    ...['general', 'nutrition', 'strength', 'endurance'].map((d) =>
      el('option', { value: d, selected: existing?.domain === d }, d[0].toUpperCase() + d.slice(1))));
  const target = el('input', { class: 'input', type: 'number', step: '0.1', value: existing?.target ?? '', placeholder: '10' });
  const current = el('input', { class: 'input', type: 'number', step: '0.1', value: existing?.current ?? '', placeholder: '5' });
  const deadline = el('input', { class: 'input', type: 'date', value: existing?.deadline ?? '' });
  const note = el('textarea', { class: 'textarea', placeholder: 'Why this matters' }, existing?.note ?? '');

  const ref = sheet({
    title: existing ? 'Edit goal' : 'New goal',
    body: el('div', { class: 'stack' },
      field('Goal', title),
      field('Area', domain),
      el('div', { class: 'grid-2' }, field('Target', target), field('Current', current)),
      field('Deadline (optional)', deadline),
      field('Note', note)
    ),
    footer: el('div', { class: 'row', style: { width: '100%' } },
      existing
        ? el('button', {
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              await Goals.update(existing.id, { status: 'abandoned' });
              ref.close(); toast('Goal archived.', { tone: 'violet' }); refresh();
            }
          }, 'Archive')
        : el('button', { class: 'btn btn-ghost', onclick: () => ref.close() }, 'Cancel'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          if (!title.value.trim()) { toast('Give the goal a name.', { tone: 'crimson' }); return; }
          const payload = {
            title: title.value.trim(),
            domain: domain.value,
            target: parseFloat(target.value) || null,
            current: parseFloat(current.value) || null,
            deadline: deadline.value || null,
            note: note.value.trim() || null,
            status: 'active',
            priority: existing?.priority ?? 1
          };
          if (existing) await Goals.update(existing.id, payload);
          else await Goals.create({ ...payload, milestones: [] });
          ref.close(); toast('Goal saved.'); refresh();
        }
      }, 'Save')
    )
  });
}

function photosCard() {
  return card('Progress photos', { note: 'Arriving with the camera pipeline' },
    callout(
      'Photos are a Phase 6 feature and are deliberately not stubbed here. When they land, capture ' +
      'compresses to roughly 1080p WebP on-device, stores the blob in IndexedDB, and never touches ' +
      'a network — including the Ghost Viewfinder overlay and the Day 1 / Day N slider.',
      { tone: 'violet', strongText: 'Not built yet. ' })
  );
}

function targetsCard(profile) {
  const t = profile.targets;
  if (!t) return null;
  const history = profile.targetHistory || [];
  return card('Current targets', { note: t.method },
    el('div', { class: 'stack' },
      el('dl', { class: 'kv' },
        el('dt', {}, 'Energy'),  el('dd', {}, `${fmt.int(t.calories)} kcal`),
        el('dt', {}, 'Protein'), el('dd', {}, `${fmt.int(t.protein)} g`),
        el('dt', {}, 'Carbs'),   el('dd', {}, `${fmt.int(t.carbs)} g`),
        el('dt', {}, 'Fat'),     el('dd', {}, `${fmt.int(t.fat)} g`),
        el('dt', {}, 'Fibre'),   el('dd', {}, `${fmt.int(t.fiber)} g`),
        el('dt', {}, 'Water'),   el('dd', {}, fmt.ml(t.water))
      ),
      history.length > 1
        ? el('p', { class: 'card-note' }, `${history.length} target revisions kept, oldest ${fmt.ago(history[0].at)}.`)
        : null,
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/settings' }, 'Adjust in Settings')
    )
  );
}

function stat(label, value, hint) {
  return el('div', {},
    el('p', { class: 'eyebrow' }, label),
    el('p', { class: 'big-number', style: { fontSize: '1.5rem' } }, value),
    hint ? el('p', { class: 'hint', style: { margin: 0 } }, hint) : null
  );
}

function daysApart(a, b) {
  return Math.max(1, Math.round((b - a) / 86400000));
}
