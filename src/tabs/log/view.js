/* Universal LOG (spec §5).
 *
 * This is the connective tissue of the whole app: one entry point, many record
 * types, everything timestamped and zoned, everything reversible.
 *
 * The signature interaction is the quick bar. You type "500ml water; slept 7h30;
 * 5km run in 31 min" and the app shows you the three structured records it would
 * create — with a confidence mark on each — and writes nothing until you say so.
 * Parsing is a suggestion engine, never an authority.
 */

import { el, field, card, sheet, toast, tint, fmt, emptyState, clear } from '../../core/ui.js';
import { Logs, dateKeyOf } from '../../db/repos.js';
import { getSetting, setSetting } from '../../db/database.js';
import { parseQuickLog, candidateToRecord, LOG_TYPES } from '../../engines/logparser.js';
import { refresh } from '../../core/router.js';
import { openFoodPicker } from '../nutrition/view.js';
import { NUTRITION } from '../../config/app.config.js';

/* Type ordering is contextual. Full session awareness ("you are 20 minutes into
   a workout, show sets first") arrives with the workout and outdoor engines;
   until those exist, ordering uses time of day and what you actually use, which
   is honest about what it knows. */
const TYPE_ORDER = {
  morning:   ['weight', 'sleep', 'water', 'food', 'heartrate', 'mood', 'energy'],
  midday:    ['food', 'water', 'exercise', 'run', 'walk', 'mood', 'energy'],
  afternoon: ['water', 'exercise', 'run', 'cycle', 'food', 'soreness'],
  evening:   ['food', 'water', 'exercise', 'measurement', 'mood', 'stress', 'note'],
  night:     ['sleep', 'water', 'note', 'mood', 'stress']
};

function timeBand(d = new Date()) {
  const h = d.getHours();
  if (h < 10) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}

const GLYPH = {
  water: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
  electrolytes: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11zM9 12h6M12 9v6',
  weight: 'M4 8h16l-2 12H6L4 8zm4 0a4 4 0 0 1 8 0',
  measurement: 'M3 8h18v8H3zM7 8v3M11 8v3M15 8v3M19 8v3',
  food: 'M6 3v8a3 3 0 0 0 6 0V3M9 11v10M17 3c-1.5 2-1.5 5 0 7v11',
  run: 'M13 4a1.6 1.6 0 1 0 0-.1M11 8l-3 4 2 3-1 5M13 9l3 2 1 4',
  walk: 'M13 4a1.6 1.6 0 1 0 0-.1M12 8l-2 5 1 3-1 4M12 10l3 2v4',
  cycle: 'M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 15l3-6 3 6M12 9h4',
  exercise: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  workout: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  sleep: 'M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z',
  heartrate: 'M3 12h4l2 5 3-10 2 5h7',
  mood: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 10h.01M15 10h.01M8.5 14a4.5 4.5 0 0 0 7 0',
  energy: 'M13 2 4 14h6l-1 8 9-12h-6l1-8z',
  stress: 'M3 17c2-6 4 4 6-2s4 6 6 0 2 4 6-2',
  soreness: 'M12 3v18M7 8l10 8M17 8 7 16',
  note: 'M5 4h11l3 3v13H5zM9 10h6M9 14h4'
};

function glyph(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'glyph');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', GLYPH[type] || GLYPH.note);
  svg.append(p);
  return svg;
}

/* ------------------------------------------------------------ view ------- */

export async function logView() {
  const host = el('div', { class: 'stack' });
  const clock = await getSetting('clock', '24h');

  host.append(
    el('p', { class: 'eyebrow' }, 'Universal log'),
    el('h1', { class: 'page-title' }, 'Log something'),
    quickBar(),
    typeGrid(),
    await presetSection(),
    await recentSection(clock)
  );
  return host;
}

/* ---- the quick bar: parse, preview, confirm ----------------------------- */

function quickBar() {
  const input = el('input', {
    type: 'text', placeholder: '500ml water; slept 7h30; 5km run in 31 min',
    'aria-label': 'Quick log — type in plain language',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false'
  });

  const preview = el('div', { class: 'parse' });
  const saveBtn = el('button', { class: 'btn btn-primary btn-sm', disabled: true, onclick: commit }, 'Save');
  let candidates = [];

  function renderPreview() {
    clear(preview);
    if (!candidates.length) {
      preview.append(el('p', { class: 'parse-empty' },
        'Nothing parsed yet. Separate several entries with a semicolon.'));
      saveBtn.disabled = true;
      return;
    }
    for (const [i, c] of candidates.entries()) {
      preview.append(el('div', { class: 'parse-row', style: tint(c.meta?.colour || 'emerald') },
        el('span', { class: 'what' }, LOG_TYPES[c.type]?.label || c.type),
        el('span', { class: 'detail' }, c.detail || '—'),
        el('span', { class: 'row', style: { gap: '6px' } },
          el('span', { class: 'conf', title: 'How confident the parser is' },
            c.confidence === 'high' ? '●●●' : c.confidence === 'medium' ? '●●○' : '●○○'),
          el('button', {
            class: 'btn btn-sm btn-ghost', 'aria-label': `Discard ${c.type} entry`,
            onclick: () => { candidates.splice(i, 1); renderPreview(); }
          }, '✕')
        )
      ));
    }
    if (candidates.some((c) => c.confidence === 'low')) {
      preview.append(el('p', { class: 'parse-empty' },
        'Low-confidence rows will be saved as plain notes. Tap a type below to enter them precisely.'));
    }
    saveBtn.disabled = false;
  }

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { candidates = parseQuickLog(input.value); renderPreview(); }, 140);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && candidates.length) { e.preventDefault(); commit(); }
  });

  async function commit() {
    if (!candidates.length) return;
    const records = candidates.map(candidateToRecord);
    try {
      const saved = await Logs.createMany(records);
      const ids = saved.map((r) => r.id);
      input.value = ''; candidates = []; renderPreview();
      toast(`${saved.length} ${saved.length === 1 ? 'entry' : 'entries'} logged.`, {
        action: 'Undo',
        onAction: async () => {
          for (const id of ids) await Logs.remove(id);
          toast('Reverted.', { tone: 'violet' });
          refresh();
        }
      });
      refresh();
    } catch (err) {
      console.error(err);
      toast('Save failed — nothing was written.', { tone: 'crimson' });
    }
  }

  renderPreview();

  return card('Quick log', { note: 'Nothing saves until you confirm' },
    el('div', { class: 'qlog' },
      el('div', { class: 'qlog-input' }, input, saveBtn),
      preview
    )
  );
}

/* ---- type grid ---------------------------------------------------------- */

/* Swipe-select rather than a tile grid: one horizontally-snapping row, the
   centred card is "selected", a second tap (or the button below) opens its
   form. Scroll position drives selection so it works the same whether you
   swipe, drag a scrollbar, or arrow-key through it. */
function typeGrid() {
  const band = timeBand();
  const primary = TYPE_ORDER[band];
  const rest = Object.keys(LOG_TYPES).filter((t) => !primary.includes(t));
  const ordered = [...primary, ...rest];

  let selected = ordered[0];
  const track = el('div', { class: 'type-slider', role: 'listbox', 'aria-label': 'Log type — swipe to choose' });

  const select = (type) => {
    selected = type;
    for (const c of track.children) {
      const isSel = c.dataset.type === type;
      c.classList.toggle('is-selected', isSel);
      c.setAttribute('aria-selected', String(isSel));
    }
    openBtn.textContent = `Log ${LOG_TYPES[type].label.toLowerCase()}`;
  };

  const cards = ordered.map((type) => el('button', {
    class: 'type-slide',
    style: tint(LOG_TYPES[type].colour),
    role: 'option',
    dataset: { type },
    onclick: () => {
      if (selected === type) { openForm(type); return; }
      select(type);
      track.children[ordered.indexOf(type)]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  },
    glyph(type),
    el('span', { class: 'lbl' }, LOG_TYPES[type].label),
    LOG_TYPES[type].unit ? el('span', { class: 'sub' }, LOG_TYPES[type].unit) : null
  ));
  track.append(...cards);

  /* Debounced via rAF so a fast swipe doesn't fire this on every scroll tick —
     only settles once per frame, checking whichever card is nearest centre. */
  let raf = null;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      const mid = track.getBoundingClientRect().left + track.getBoundingClientRect().width / 2;
      let closest = null, closestDist = Infinity;
      for (const c of track.children) {
        const r = c.getBoundingClientRect();
        const d = Math.abs((r.left + r.width / 2) - mid);
        if (d < closestDist) { closestDist = d; closest = c; }
      }
      if (closest && closest.dataset.type !== selected) select(closest.dataset.type);
    });
  }, { passive: true });

  const openBtn = el('button', {
    class: 'btn btn-primary', style: { marginTop: 'var(--s3)', width: '100%' },
    onclick: () => openForm(selected)
  }, `Log ${LOG_TYPES[selected].label.toLowerCase()}`);

  select(selected);

  return card('By type', { note: `Ordered for ${band} — swipe to choose` },
    el('div', { class: 'stack' }, track, openBtn));
}

/* ---- per-type forms ----------------------------------------------------- */

const NUMERIC = {
  water:        { label: 'Amount', unit: 'ml',  step: '10',  quick: [250, 500, 750, 1000] },
  electrolytes: { label: 'Amount', unit: 'ml',  step: '10',  quick: [250, 500, 750] },
  weight:       { label: 'Weight', unit: 'kg',  step: '0.1' },
  food:         { label: 'Energy', unit: 'kcal', step: '10' },
  heartrate:    { label: 'Heart rate', unit: 'bpm', step: '1' }
};

const SCALES = ['mood', 'energy', 'stress', 'soreness'];

/* Same meal windows Nutrition uses (config/app.config.js NUTRITION.meals) —
   so "food" logged from Quick Log lands in the meal slot Nutrition would
   have put it in anyway, not a separate "quick" bucket only this tab knows. */
function currentMealSlot() {
  const h = new Date().getHours();
  const hit = NUTRITION.meals.find((m) => m.from < m.to ? (h >= m.from && h < m.to) : (h >= m.from || h < m.to));
  return hit?.key ?? 'snack';
}

function openForm(type, existing = null) {
  /* Food is not a bare number — it is the same food-database entry Nutrition
     uses (search, portion, macros), reached through the exact same function.
     One code path writes food, called from two tabs; that is what makes the
     entry actually show up correctly in both, rather than a copy of it. New
     entries only — editing an existing quick-logged figure keeps the plain
     number field below, since old entries may have no linked food. */
  if (type === 'food' && !existing) {
    openFoodPicker({ dateKey: dateKeyOf(), slot: currentMealSlot(), onChange: refresh });
    return;
  }

  const meta = LOG_TYPES[type];
  const body = el('div', { class: 'stack' });
  const state = { at: existing?.at ?? Date.now() };

  const timeInput = el('input', {
    class: 'input', type: 'datetime-local',
    value: toLocalInput(state.at)
  });

  let collect;

  if (NUMERIC[type]) {
    const cfg = NUMERIC[type];
    const num = el('input', {
      class: 'input', type: 'number', inputmode: 'decimal', step: cfg.step,
      value: existing?.value ?? '', placeholder: '0'
    });
    body.append(field(`${cfg.label} (${cfg.unit})`, num));
    if (cfg.quick) {
      body.append(el('div', { class: 'row-wrap' },
        ...cfg.quick.map((v) => el('button', {
          class: 'chip', style: tint(meta.colour),
          onclick: () => { num.value = v; num.focus(); }
        }, `${v} ${cfg.unit}`))
      ));
    }
    collect = () => {
      const v = parseFloat(num.value);
      if (!(v > 0)) throw new Error(`Enter a ${cfg.label.toLowerCase()}.`);
      return { value: v, unit: cfg.unit };
    };

  } else if (SCALES.includes(type)) {
    let picked = existing?.value ?? 3;
    const row = el('div', { class: 'row-wrap' });
    const paint = () => row.replaceChildren(...[1, 2, 3, 4, 5].map((v) => el('button', {
      class: 'chip', style: tint(meta.colour), 'aria-pressed': String(picked === v),
      onclick: () => { picked = v; paint(); }
    }, String(v))));
    paint();
    body.append(el('div', { class: 'field' },
      el('label', {}, `${meta.label} — 1 low, 5 high`), row));
    collect = () => ({ value: picked, unit: '/5' });

  } else if (type === 'sleep') {
    const h = el('input', { class: 'input', type: 'number', min: '0', max: '18', step: '1', placeholder: '7' });
    const m = el('input', { class: 'input', type: 'number', min: '0', max: '59', step: '5', placeholder: '30' });
    let quality = existing?.quality ?? null;
    const qRow = el('div', { class: 'row-wrap' });
    const paintQ = () => qRow.replaceChildren(...[1, 2, 3, 4, 5].map((v) => el('button', {
      class: 'chip', style: tint('cyan'), 'aria-pressed': String(quality === v),
      onclick: () => { quality = v; paintQ(); }
    }, String(v))));
    paintQ();
    if (existing?.minutes) { h.value = Math.floor(existing.minutes / 60); m.value = existing.minutes % 60; }
    body.append(
      el('div', { class: 'field' }, el('label', {}, 'Duration'),
        el('div', { class: 'inline-units' }, h, m),
        el('span', { class: 'hint' }, 'Hours and minutes')),
      el('div', { class: 'field' }, el('label', {}, 'Quality (optional)'), qRow)
    );
    collect = () => {
      const mins = (parseFloat(h.value) || 0) * 60 + (parseFloat(m.value) || 0);
      if (!(mins > 0)) throw new Error('Enter how long you slept.');
      return { minutes: Math.round(mins), quality };
    };

  } else if (type === 'measurement') {
    const site = el('select', { class: 'select' },
      ...['waist', 'chest', 'hip', 'neck', 'arm', 'thigh', 'calf', 'shoulders', 'forearm']
        .map((s) => el('option', { value: s, selected: existing?.site === s }, s[0].toUpperCase() + s.slice(1))));
    const num = el('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1', value: existing?.value ?? '' });
    body.append(field('Site', site), field('Measurement (cm)', num));
    collect = () => {
      const v = parseFloat(num.value);
      if (!(v > 0)) throw new Error('Enter a measurement.');
      return { value: v, unit: 'cm', site: site.value };
    };

  } else if (['run', 'walk', 'cycle'].includes(type)) {
    const km = el('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.01', placeholder: '5', value: existing?.value ?? '' });
    const mins = el('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '1', placeholder: '31', value: existing?.minutes ?? '' });
    const paceOut = el('p', { class: 'hint' }, 'Pace appears once both are filled.');
    const syncPace = () => {
      const d = parseFloat(km.value), t = parseFloat(mins.value);
      paceOut.textContent = (d > 0 && t > 0)
        ? `${fmt.pace(t / d)} per km · ${(d / (t / 60)).toFixed(1)} km/h`
        : 'Pace appears once both are filled.';
    };
    km.addEventListener('input', syncPace); mins.addEventListener('input', syncPace);
    body.append(field('Distance (km)', km), field('Moving time (minutes)', mins), paceOut);
    collect = () => {
      const d = parseFloat(km.value), t = parseFloat(mins.value);
      if (!(d > 0) && !(t > 0)) throw new Error('Enter a distance or a time.');
      return { value: d > 0 ? d : null, unit: d > 0 ? 'km' : null, minutes: t > 0 ? t : null };
    };

  } else if (type === 'exercise' || type === 'workout') {
    const name = el('input', { class: 'input', placeholder: 'Pull-up', value: existing?.exercise ?? '' });
    const sets = el('input', { class: 'input', type: 'number', min: '1', step: '1', placeholder: '3', value: existing?.sets ?? '' });
    const reps = el('input', { class: 'input', type: 'number', min: '1', step: '1', placeholder: '10', value: existing?.reps ?? '' });
    const load = el('input', { class: 'input', type: 'number', min: '0', step: '0.5', placeholder: 'Bodyweight', value: existing?.loadKg ?? '' });
    const rpe = el('input', { class: 'input', type: 'number', min: '1', max: '10', step: '0.5', placeholder: '7', value: existing?.rpe ?? '' });
    body.append(
      field('Exercise', name),
      el('div', { class: 'grid-2' }, field('Sets', sets), field('Reps', reps)),
      el('div', { class: 'grid-2' }, field('Added load (kg)', load, 'Leave blank for bodyweight'), field('RPE', rpe, '1–10'))
    );
    collect = () => {
      if (!name.value.trim()) throw new Error('Name the exercise.');
      const s = parseInt(sets.value, 10), r = parseInt(reps.value, 10);
      if (!(s > 0) || !(r > 0)) throw new Error('Sets and reps are both needed.');
      return {
        exercise: name.value.trim(), sets: s, reps: r,
        loadKg: parseFloat(load.value) || null,
        rpe: parseFloat(rpe.value) || null
      };
    };

  } else {
    const note = el('textarea', { class: 'textarea', placeholder: 'Anything worth remembering.' }, existing?.note ?? '');
    body.append(field('Note', note));
    collect = () => {
      if (!note.value.trim()) throw new Error('Write something first.');
      return { note: note.value.trim() };
    };
  }

  const noteExtra = el('input', { class: 'input', placeholder: 'Optional note', value: existing?.note ?? '' });
  if (type !== 'note') body.append(field('Note', noteExtra));
  body.append(field('When', timeInput));

  const ref = sheet({
    title: existing ? `Edit ${meta.label.toLowerCase()}` : meta.label,
    body,
    footer: el('div', { class: 'row', style: { width: '100%' } },
      el('button', { class: 'btn btn-ghost', onclick: () => ref.close() }, 'Cancel'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: save }, existing ? 'Update' : 'Log it')
    )
  });

  async function save() {
    let payload;
    try { payload = collect(); }
    catch (err) { toast(err.message, { tone: 'crimson' }); return; }

    const at = fromLocalInput(timeInput.value) ?? Date.now();
    if (at > Date.now() + 60_000) { toast('That time is in the future.', { tone: 'crimson' }); return; }

    const record = { type, at, source: 'manual', ...payload };
    if (type !== 'note' && noteExtra.value.trim()) record.note = noteExtra.value.trim();

    try {
      if (existing) {
        await Logs.update(existing.id, record);
        toast('Entry updated.');
      } else {
        const saved = await Logs.create(record);
        toast(`${meta.label} logged.`, {
          action: 'Undo',
          onAction: async () => { await Logs.remove(saved.id); toast('Reverted.', { tone: 'violet' }); refresh(); }
        });
      }
      ref.close();
      refresh();
    } catch (err) {
      console.error(err);
      toast('Save failed — nothing was written.', { tone: 'crimson' });
    }
  }
}

/* ---- presets ------------------------------------------------------------ */

async function presetSection() {
  const presets = await getSetting('presets', []);
  const wrap = el('div', { class: 'row-wrap' });

  const paint = () => {
    clear(wrap);
    if (!presets.length) {
      wrap.append(el('p', { class: 'parse-empty', style: { margin: 0 } },
        'No presets yet. Save any quick-log line you type often.'));
    }
    for (const [i, p] of presets.entries()) {
      wrap.append(el('span', { class: 'row', style: { gap: '2px' } },
        el('button', {
          class: 'chip', style: tint('emerald'),
          onclick: async () => {
            const records = parseQuickLog(p.text).map(candidateToRecord);
            const saved = await Logs.createMany(records);
            toast(`${p.text} logged.`, {
              action: 'Undo',
              onAction: async () => { for (const r of saved) await Logs.remove(r.id); refresh(); }
            });
            refresh();
          }
        }, p.text),
        el('button', {
          class: 'btn btn-sm btn-ghost', 'aria-label': `Remove preset ${p.text}`,
          onclick: async () => { presets.splice(i, 1); await setSetting('presets', presets); paint(); }
        }, '✕')
      ));
    }
  };
  paint();

  const addBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    onclick: () => {
      const input = el('input', { class: 'input', placeholder: '500ml water' });
      const ref = sheet({
        title: 'Save a preset',
        body: el('div', { class: 'stack' },
          field('Quick-log text', input, 'Parsed the same way as the quick bar, every time you tap it.')),
        footer: el('div', { class: 'row', style: { width: '100%' } },
          el('button', { class: 'btn btn-ghost', onclick: () => ref.close() }, 'Cancel'),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'btn btn-primary',
            onclick: async () => {
              const text = input.value.trim();
              if (!text) { toast('Type the entry first.', { tone: 'crimson' }); return; }
              if (!parseQuickLog(text).some((c) => c.type !== 'note')) {
                toast('That would only save as a note — try including a number and a unit.', { tone: 'amber', timeout: 7000 });
              }
              presets.push({ text, at: Date.now() });
              await setSetting('presets', presets);
              paint(); ref.close();
            }
          }, 'Save preset')
        )
      });
    }
  }, '+ Add');

  return card('Presets', { actions: addBtn }, wrap);
}

/* ---- recent entries ----------------------------------------------------- */

async function recentSection(clock) {
  const rows = await Logs.list({ limit: 12 });
  if (!rows.length) {
    return card('Recent', {}, emptyState({
      title: 'Nothing logged yet',
      message: 'Use the quick bar above, or pick a type. The first entry is the hard one.'
    }));
  }

  return card('Recent', { note: `${rows.length} shown` },
    el('div', { class: 'list-rows' },
      ...rows.map((r) => el('div', { class: 'entry', style: tint(LOG_TYPES[r.type]?.colour || 'emerald') },
        el('span', { class: 't' }, fmt.time(r.at, clock)),
        el('div', { class: 'body' },
          el('div', { class: 'head' },
            el('span', { class: 'swatch', 'aria-hidden': 'true' }),
            el('span', {}, LOG_TYPES[r.type]?.label || r.type)),
          el('span', { class: 'meta' }, describe(r)),
          r.note ? el('span', { class: 'note' }, r.note) : null
        ),
        el('span', { class: 'row', style: { gap: '2px' } },
          el('button', {
            class: 'btn btn-sm btn-ghost', 'aria-label': `Edit ${r.type}`,
            onclick: () => openForm(r.type, r)
          }, '✎'),
          el('button', {
            class: 'btn btn-sm btn-ghost', 'aria-label': `Duplicate ${r.type}`,
            onclick: async () => {
              const { id, createdAt, updatedAt, ...rest } = r;
              const copy = await Logs.create({ ...rest, at: Date.now() });
              toast('Duplicated.', {
                action: 'Undo',
                onAction: async () => { await Logs.remove(copy.id); refresh(); }
              });
              refresh();
            }
          }, '⧉'),
          el('button', {
            class: 'btn btn-sm btn-ghost', 'aria-label': `Delete ${r.type}`,
            onclick: async () => {
              await Logs.remove(r.id);
              toast('Moved to trash.', {
                tone: 'violet', action: 'Undo',
                onAction: async () => { await Logs.restore(r.id); refresh(); }
              });
              refresh();
            }
          }, '🗑')
        )
      ))
    )
  );
}

/* Human-readable one-liner for any log row. Kept here so Timeline and Log
   never drift apart in how they describe the same record. */
export function describe(r) {
  switch (r.type) {
    case 'water':
    case 'electrolytes': return fmt.ml(r.value);
    case 'weight':       return `${fmt.dec(r.value, 1)} kg`;
    case 'measurement':  return `${r.site} · ${fmt.dec(r.value, 1)} cm`;
    case 'food':         return `${r.label ? r.label + ' · ' : ''}${fmt.int(r.value)} kcal`;
    case 'heartrate':    return `${fmt.int(r.value)} bpm${r.kind === 'resting' ? ' · resting' : ''}`;
    case 'sleep':        return `${fmt.duration(r.minutes)}${r.quality ? ` · quality ${r.quality}/5` : ''}`;
    case 'run':
    case 'walk':
    case 'cycle': {
      const bits = [];
      if (r.value) bits.push(`${fmt.dec(r.value, 2)} km`);
      if (r.minutes) bits.push(fmt.duration(r.minutes));
      if (r.value && r.minutes) bits.push(`${fmt.pace(r.minutes / r.value)} /km`);
      return bits.join(' · ') || '—';
    }
    case 'exercise':
    case 'workout': {
      const bits = [`${r.sets} × ${r.reps}`];
      if (r.loadKg) bits.push(`${fmt.dec(r.loadKg, 1)} kg`);
      if (r.rpe) bits.push(`RPE ${r.rpe}`);
      return `${r.exercise || 'Exercise'} — ${bits.join(' · ')}`;
    }
    case 'mood':
    case 'energy':
    case 'stress':
    case 'soreness':     return `${r.value}/5`;
    case 'note':         return r.note || '—';
    default:             return r.value != null ? `${r.value} ${r.unit || ''}`.trim() : '—';
  }
}

/* datetime-local works in local time with no zone, so conversion has to be
   explicit in both directions or entries land an offset away from reality. */
function toLocalInput(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}
