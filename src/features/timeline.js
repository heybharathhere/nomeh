/* Universal timeline (spec §33).
 *
 * One chronological stream across every domain, because the point of logging
 * once and reusing everywhere is that a single day reads as a single story:
 * slept badly, weighed in low, ran slow. Three separate screens would hide
 * exactly the connection that matters.
 */

import { el, card, fmt, tint, emptyState, toast, clear } from '../core/ui.js';
import { Logs, dateKeyOf, dateKeyOffset } from '../db/repos.js';
import { getSetting } from '../db/database.js';
import { LOG_TYPES } from '../engines/logparser.js';
import { describe } from '../tabs/log/view.js';
import { refresh } from '../core/router.js';
import { dailyTotals } from '../engines/analytics.js';

const RANGES = [
  { key: 7,  label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' }
];

let activeRange = 30;
let activeFilter = null;

export async function timelineView() {
  const clock = await getSetting('clock', '24h');
  const host = el('div', { class: 'stack' });
  const listHost = el('div', { class: 'stack' });

  const rangeRow = el('div', { class: 'row-wrap' });
  const filterRow = el('div', { class: 'row-wrap' });

  const paintControls = () => {
    clear(rangeRow);
    for (const r of RANGES) {
      rangeRow.append(el('button', {
        class: 'chip', 'aria-pressed': String(activeRange === r.key),
        onclick: () => { activeRange = r.key; paintControls(); load(); }
      }, r.label));
    }

    clear(filterRow);
    filterRow.append(el('button', {
      class: 'chip', 'aria-pressed': String(activeFilter === null),
      onclick: () => { activeFilter = null; paintControls(); load(); }
    }, 'Everything'));
    for (const [type, meta] of Object.entries(LOG_TYPES)) {
      filterRow.append(el('button', {
        class: 'chip', style: tint(meta.colour), 'aria-pressed': String(activeFilter === type),
        onclick: () => { activeFilter = activeFilter === type ? null : type; paintControls(); load(); }
      }, meta.label));
    }
  };

  async function load() {
    clear(listHost);
    listHost.append(el('p', { class: 'card-note' }, 'Loading…'));

    const from = dateKeyOffset(-(activeRange - 1));
    const to = dateKeyOf();
    let rows = await Logs.between(from, to);
    if (activeFilter) rows = rows.filter((r) => r.type === activeFilter);

    clear(listHost);
    if (!rows.length) {
      listHost.append(emptyState({
        title: activeFilter ? `No ${LOG_TYPES[activeFilter].label.toLowerCase()} entries` : 'Nothing in this window',
        message: activeFilter
          ? 'Try a wider range, or clear the filter.'
          : 'Log something and it appears here immediately.'
      }));
      return;
    }

    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.dateKey)) byDay.set(r.dateKey, []);
      byDay.get(r.dateKey).push(r);
    }

    for (const [dateKey, entries] of [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      listHost.append(dayBlock(dateKey, entries, clock));
    }
  }

  paintControls();
  host.append(
    el('p', { class: 'eyebrow' }, 'History'),
    el('h1', { class: 'page-title' }, 'Timeline'),
    card('View', {}, el('div', { class: 'stack' }, rangeRow, filterRow)),
    listHost
  );
  load();
  return host;
}

function dayBlock(dateKey, entries, clock) {
  const t = dailyTotals(entries);
  const summary = [];
  if (t.calories) summary.push(`${fmt.int(t.calories)} kcal`);
  if (t.water) summary.push(fmt.ml(t.water));
  if (t.distanceKm) summary.push(`${fmt.dec(t.distanceKm, 2)} km`);
  if (t.sets) summary.push(`${t.sets} sets`);
  if (t.sleepMinutes) summary.push(`${fmt.duration(t.sleepMinutes)} sleep`);
  if (t.weight != null) summary.push(`${fmt.dec(t.weight, 1)} kg`);

  return el('section', { class: 'card day' },
    el('div', { class: 'day-head' },
      el('span', { class: 'd' }, fmt.dayLabel(dateKey)),
      el('span', { class: 'n' }, summary.length ? summary.join(' · ') : `${entries.length} entries`)
    ),
    el('div', {},
      ...[...entries].reverse().map((r) => entryRow(r, clock))
    )
  );
}

function entryRow(r, clock) {
  return el('div', { class: 'entry', style: tint(LOG_TYPES[r.type]?.colour || 'emerald') },
    el('span', { class: 't' }, fmt.time(r.at, clock)),
    el('div', { class: 'body' },
      el('div', { class: 'head' },
        el('span', { class: 'swatch', 'aria-hidden': 'true' }),
        el('span', {}, LOG_TYPES[r.type]?.label || r.type),
        r.source === 'parsed' ? el('span', { class: 'conf', title: 'Entered via quick log' }, '⌨') : null
      ),
      el('span', { class: 'meta' }, describe(r)),
      r.note && r.type !== 'note' ? el('span', { class: 'note' }, r.note) : null
    ),
    el('button', {
      class: 'btn btn-sm btn-ghost',
      'aria-label': `Delete ${LOG_TYPES[r.type]?.label || r.type} from ${fmt.time(r.at, clock)}`,
      onclick: async () => {
        await Logs.remove(r.id);
        toast('Moved to trash.', {
          tone: 'violet', action: 'Undo',
          onAction: async () => { await Logs.restore(r.id); refresh(); }
        });
        refresh();
      }
    }, '🗑')
  );
}
