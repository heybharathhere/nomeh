/* Diary: the nutrition screen.
 *
 * Structure: a day's totals against target, then meals in slot order, then a
 * hydration strip. Everything is one tap from adding food, because the whole
 * value of a food diary is whether logging is fast enough that you keep doing
 * it three weeks in.
 */

import { el, card, callout, fmt, colourVar, metricBar, emptyState, sheet, field, toast, clear, roadmapCard } from '../core/ui.js';
import { Profile, Meals, Logs, dateKeyOf, dateKeyOffset } from '../db/repos.js';
import { db, getSetting } from '../db/database.js';
import { computeTargets } from '../engines/biomath.js';
import { portion, sumNutrients, groupByMeal, macroSplit, targetStatus, macroSanity } from '../engines/nutrition.js';
import { localSearch, recent, remoteSearch, remoteBarcode, saveFood, touchFood,
         barcodeSupported, scanBarcode, remoteAvailable } from './foods.js';
import { NUTRITION, FEATURES, SAFETY } from '../config/app.config.js';
import { refresh } from '../core/router.js';

/* ------------------------------------------------------------- data load -- */

async function loadDay(dateKey) {
  const [profile, meals, hydration] = await Promise.all([
    Profile.get(),
    db().meals.where('dateKey').equals(dateKey).filter((m) => !m.deletedAt).toArray(),
    db().hydration.where('dateKey').equals(dateKey).toArray(),
  ]);

  const mealIds = meals.map((m) => m.id);
  const items = mealIds.length
    ? await db().mealItems.where('mealId').anyOf(mealIds).toArray()
    : [];

  /* Items store their resolved nutrients at log time rather than recomputing
     from the food row. If you correct a food's macros next month, last week's
     diary must not silently change — a log is a record of what you recorded. */
  const byMeal = new Map(meals.map((m) => [m.id, m]));
  const entries = items.map((it) => ({ ...it, meal: byMeal.get(it.mealId)?.slot ?? 'snack' }));

  /* Water logged through the quick-log bar lands in `logs`, not `hydration`, so
     both are counted or the totals disagree with the Today screen. */
  const waterLogs = await db().logs
    .where('[dateKey+type]').equals([dateKey, 'water'])
    .filter((l) => !l.deletedAt).toArray();

  const waterMl = hydration.reduce((s, h) => s + (Number(h.ml) || 0), 0)
                + waterLogs.reduce((s, l) => s + (Number(l.value) || 0), 0);

  return { profile, meals, entries, waterMl, hydration, waterLogs };
}

/* --------------------------------------------------------------- summary -- */

function summaryCard(totals, targets, split) {
  const status = targetStatus(totals, targets);
  if (!status) return null;

  const bars = [
    metricBar({ name: 'Energy', value: totals.kcal, target: targets?.calories, unit: 'kcal', colour: 'nutrition' }),
    metricBar({ name: 'Protein', value: totals.protein, target: targets?.protein, unit: 'g', colour: 'strength' }),
    metricBar({ name: 'Carbs', value: totals.carbs, target: targets?.carbs, unit: 'g', colour: 'performance' }),
    metricBar({ name: 'Fat', value: totals.fat, target: targets?.fat, unit: 'g', colour: 'recovery' }),
  ];

  const remaining = status.kcal.target ? status.kcal.target - status.kcal.value : null;

  return card('Today', {
    note: remaining == null ? null
      : remaining > 0 ? `${fmt.int(remaining)} kcal left`
      : `${fmt.int(-remaining)} kcal over target`,
  },
    ...bars,
    split ? el('div', { class: 'split-row' },
      el('span', { class: 'chip', style: { color: colourVar('strength') } }, `P ${split.protein}%`),
      el('span', { class: 'chip', style: { color: colourVar('performance') } }, `C ${split.carbs}%`),
      el('span', { class: 'chip', style: { color: colourVar('recovery') } }, `F ${split.fat}%`),
      el('span', { class: 'muted-sm' }, 'of energy'),
    ) : null,
    /* Under-eating warning. Reports the pattern factually and does not
       moralise — the guardrail is that this fires on a multi-day trend rather
       than on one light day, which is normal. */
    status.kcal.target && status.logged && status.kcal.pct < SAFETY.underEatingWarnRatio * 100
      ? el('p', { class: 'muted-sm' }, 'Well below target so far today.')
      : null,
  );
}

/* ----------------------------------------------------------------- meals -- */

function mealSection(group, dateKey, onChange) {
  const rows = group.entries.length
    ? group.entries.map((it) => el('div', { class: 'entry' },
        el('div', { class: 'entry-main' },
          el('span', { class: 'entry-label' }, it.name),
          el('span', { class: 'muted-sm' },
            `${fmt.dec(it.grams, 0)} ${it.unit === 'ml' ? 'ml' : 'g'} · ` +
            `P ${fmt.dec(it.protein, 1)} C ${fmt.dec(it.carbs, 1)} F ${fmt.dec(it.fat, 1)}`),
        ),
        el('span', { class: 'entry-value', style: { color: colourVar('nutrition') } }, `${fmt.int(it.kcal)}`),
        el('button', {
          class: 'btn btn-ghost btn-xs',
          'aria-label': `Remove ${it.name}`,
          onclick: async () => {
            await db().mealItems.delete(it.id);
            toast(`Removed ${it.name}`, {
              action: { label: 'Undo', fn: async () => { await db().mealItems.add({ ...it }); onChange(); } },
            });
            onChange();
          },
        }, '×'),
      ))
    : [el('p', { class: 'muted-sm' }, 'Nothing logged.')];

  return card(group.label, {
    note: group.totals.kcal ? `${fmt.int(group.totals.kcal)} kcal` : null,
    actions: el('button', {
      class: 'btn btn-sm',
      onclick: () => openFoodPicker({ dateKey, slot: group.key, onChange }),
    }, '+ Add'),
  }, ...rows);
}

/* ----------------------------------------------------------- food picker -- */

/* One sheet handles local search, the network fallback, recents and barcode.
   Splitting these into separate screens sounds tidier but adds a decision
   before every single food entry, which is exactly the friction that kills a
   diary habit. */
export function openFoodPicker({ dateKey, slot, onChange }) {
  const input = el('input', { class: 'input', type: 'search', placeholder: 'Search foods…', autocomplete: 'off' });
  const results = el('div', { class: 'result-list' });
  const status = el('p', { class: 'muted-sm' });

  let token = 0;

  const render = (foods, { source } = {}) => {
    clear(results);
    if (!foods.length) {
      results.append(el('p', { class: 'muted-sm' }, 'No matches.'));
      return;
    }
    for (const food of foods) {
      results.append(el('button', {
        class: 'result-row',
        onclick: () => openPortion({ food, dateKey, slot, onChange, fromRemote: source === 'remote' }),
      },
        el('div', {},
          el('span', { class: 'entry-label' }, food.name),
          el('span', { class: 'muted-sm' },
            [food.brand, `${fmt.int(food.kcal)} kcal / 100${food.unit === 'ml' ? 'ml' : 'g'}`]
              .filter(Boolean).join(' · ')),
        ),
        source === 'remote' ? el('span', { class: 'chip chip-xs' }, 'online') : null,
      ));
    }
  };

  const runSearch = async () => {
    const q = input.value.trim();
    const mine = ++token;
    if (q.length < NUTRITION.searchMinChars) {
      status.textContent = '';
      const r = await recent(20);
      if (mine === token) {
        clear(results);
        if (r.length) { status.textContent = 'Recently logged'; render(r); }
        else status.textContent = 'Type to search your food database.';
      }
      return;
    }

    /* Local first, always, and rendered before any network call starts. */
    const local = await localSearch(q);
    if (mine !== token) return;
    status.textContent = `${local.length} in your database`;
    render(local);

    if (!FEATURES.offFoodApi) return;
    if (!remoteAvailable()) {
      if (!local.length) status.textContent = 'No local matches. Open Food Facts needs a connection.';
      return;
    }

    const searchBtn = el('button', { class: 'btn btn-sm btn-ghost' }, 'Search Open Food Facts');
    searchBtn.onclick = async () => {
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching…';
      const res = await remoteSearch(q);
      if (mine !== token) return;
      searchBtn.remove();
      if (!res.ok) {
        status.textContent = res.reason === 'timeout'
          ? 'Open Food Facts did not respond in time.'
          : res.reason === 'offline' ? 'Offline — local results only.'
          : 'Open Food Facts could not be reached.';
        return;
      }
      status.textContent = `${local.length} local, ${res.foods.length} online` +
        (res.cached ? ' (cached)' : '') +
        (res.discarded ? ` · ${res.discarded} skipped for inconsistent data` : '');
      for (const f of res.foods) {
        results.append(el('button', {
          class: 'result-row',
          onclick: () => openPortion({ food: f, dateKey, slot, onChange, fromRemote: true }),
        },
          el('div', {},
            el('span', { class: 'entry-label' }, f.name),
            el('span', { class: 'muted-sm' }, [f.brand, `${fmt.int(f.kcal)} kcal / 100g`].filter(Boolean).join(' · ')),
          ),
          el('span', { class: 'chip chip-xs' }, 'online'),
        ));
      }
    };
    results.append(searchBtn);
  };

  let debounce = null;
  input.oninput = () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 220); };

  const actions = el('div', { class: 'row-actions' },
    barcodeSupported()
      ? el('button', { class: 'btn btn-sm', onclick: () => openScanner({ dateKey, slot, onChange }) }, 'Scan barcode')
      : null,
    el('button', { class: 'btn btn-sm', onclick: () => openCustomFood({ dateKey, slot, onChange }) }, 'Add custom food'),
  );

  sheet({
    title: NUTRITION.meals.find((m) => m.key === slot)?.label ?? 'Add food',
    body: el('div', {}, input, actions, status, results),
  });

  runSearch();
}

/* --------------------------------------------------------------- portion -- */

function openPortion({ food, dateKey, slot, onChange, fromRemote = false }) {
  const servings = food.servings?.length ? food.servings : [{ label: '100 g', grams: 100 }];
  let selected = servings[0];
  let count = 1;

  const grams = el('input', { class: 'input', type: 'number', min: '1', step: '1', value: String(selected.grams) });
  const preview = el('div', { class: 'preview-grid' });

  const draw = () => {
    const p = portion(food, { grams: Number(grams.value) || 0 });
    clear(preview);
    if (!p) return;
    for (const [label, value, unit] of [
      ['Energy', p.kcal, 'kcal'], ['Protein', p.protein, 'g'],
      ['Carbs', p.carbs, 'g'], ['Fat', p.fat, 'g'],
    ]) {
      preview.append(el('div', { class: 'preview-cell' },
        el('span', { class: 'muted-sm' }, label),
        el('strong', {}, `${value} ${unit}`),
      ));
    }
  };

  grams.oninput = draw;

  const servingRow = el('div', { class: 'chip-row' },
    ...servings.map((s) => el('button', {
      class: 'chip chip-btn',
      onclick: () => { selected = s; count = 1; grams.value = String(s.grams); draw(); },
    }, s.label)),
    el('button', {
      class: 'chip chip-btn',
      onclick: () => { count += 1; grams.value = String(Math.round(selected.grams * count)); draw(); },
    }, '+1 serving'),
  );

  draw();

  const warn = !food.sanity?.ok && food.sanity?.checked
    ? callout(food.sanity.note, { tone: 'alert', strongText: 'Check this: ' })
    : null;

  sheet({
    title: food.name,
    body: el('div', {},
      food.brand ? el('p', { class: 'muted-sm' }, food.brand) : null,
      warn,
      servingRow,
      field('Amount', grams, food.unit === 'ml' ? 'millilitres' : 'grams'),
      preview,
      fromRemote ? el('p', { class: 'muted-sm' }, 'From Open Food Facts. Saved to your database when logged.') : null,
    ),
    confirmLabel: 'Log it',
    onConfirm: async () => {
      const g = Number(grams.value);
      if (!(g > 0)) { toast('Enter an amount.'); return false; }

      /* A remote food is persisted on first use, not on first sight — so
         browsing Open Food Facts does not fill your database with things you
         looked at once. */
      let stored = food;
      if (!food.id) stored = await saveFood(food);
      else await touchFood(food.id);

      const p = portion(stored, { grams: g });
      const mealId = await ensureMeal(dateKey, slot);
      await db().mealItems.add({
        mealId, foodId: stored.id ?? null,
        name: stored.name, unit: stored.unit,
        ...p,
        at: Date.now(),
      });
      /* Also written to the shared Logs table — this is what makes it show
         up on the NoMeh tab, streak, and Analytics, same as every other
         log type. mealItems stays the source of truth for the diary's own
         meal breakdown; this is just the universal-feed copy. */
      await Logs.create({ type: 'food', value: p.kcal, label: stored.name, dateKey, at: Date.now() });
      toast(`${stored.name} · ${p.kcal} kcal`);
      onChange();
      return true;
    },
  });
}

async function ensureMeal(dateKey, slot) {
  const existing = await db().meals
    .where('dateKey').equals(dateKey)
    .filter((m) => m.slot === slot && !m.deletedAt).first();
  if (existing) return existing.id;
  return Meals.create({ slot, dateKey, at: Date.now() }).then((r) => r.id ?? r);
}

/* ---------------------------------------------------------- custom food -- */

function openCustomFood({ dateKey, slot, onChange }) {
  const name = el('input', { class: 'input', placeholder: 'e.g. Amma\u2019s sambar' });
  const kcal = el('input', { class: 'input', type: 'number', min: '0', placeholder: 'per 100 g' });
  const protein = el('input', { class: 'input', type: 'number', min: '0', step: '0.1' });
  const carbs = el('input', { class: 'input', type: 'number', min: '0', step: '0.1' });
  const fat = el('input', { class: 'input', type: 'number', min: '0', step: '0.1' });
  const fibre = el('input', { class: 'input', type: 'number', min: '0', step: '0.1' });
  const check = el('p', { class: 'muted-sm' });

  /* Live reconciliation, so a units mistake is visible while typing rather than
     discovered a month later in a wrong total. */
  const validate = () => {
    const s = macroSanity({
      kcal: Number(kcal.value), protein: Number(protein.value),
      carbs: Number(carbs.value), fat: Number(fat.value), fibre: Number(fibre.value),
    });
    check.textContent = !s.checked ? '' : s.ok
      ? `Macros reconcile with ${kcal.value} kcal.`
      : s.note;
    check.style.color = s.checked && !s.ok ? 'var(--crimson)' : 'var(--text-faint)';
  };
  for (const i of [kcal, protein, carbs, fat, fibre]) i.oninput = validate;

  sheet({
    title: 'Custom food',
    body: el('div', {},
      el('p', { class: 'muted-sm' }, 'Values per 100 g. Saved to your database for next time.'),
      field('Name', name),
      field('Energy', kcal, 'kcal per 100 g'),
      el('div', { class: 'field-grid' },
        field('Protein', protein, 'g'), field('Carbs', carbs, 'g'),
        field('Fat', fat, 'g'), field('Fibre', fibre, 'g'),
      ),
      check,
    ),
    confirmLabel: 'Save & log',
    onConfirm: async () => {
      if (!name.value.trim()) { toast('Give it a name.'); return false; }
      if (!(Number(kcal.value) > 0)) { toast('Energy is needed.'); return false; }
      const food = await saveFood({
        name: name.value.trim(), kcal: Number(kcal.value),
        protein: Number(protein.value), carbs: Number(carbs.value),
        fat: Number(fat.value), fibre: Number(fibre.value),
        source: 'manual',
      });
      openPortion({ food, dateKey, slot, onChange });
      return true;
    },
  });
}

/* ------------------------------------------------------------- scanner --- */

function openScanner({ dateKey, slot, onChange }) {
  const video = el('video', { class: 'scanner', playsinline: true, muted: true });
  const status = el('p', { class: 'muted-sm' }, 'Starting camera…');
  const controller = new AbortController();

  const ref = sheet({
    title: 'Scan barcode',
    body: el('div', {}, video, status),
    onClose: () => controller.abort(),
  });

  (async () => {
    try {
      const code = await scanBarcode({
        video, signal: controller.signal,
        onStatus: (t) => { status.textContent = t; },
      });
      if (!code) return;
      status.textContent = `Found ${code}. Looking it up…`;

      const res = await remoteBarcode(code);
      ref?.close?.();
      if (res.ok) {
        openPortion({ food: res.food, dateKey, slot, onChange, fromRemote: true });
      } else {
        toast(res.reason === 'not-found'
          ? 'Not in Open Food Facts. Add it manually and it is yours forever.'
          : res.reason === 'offline' ? 'Offline — cannot look up a barcode.'
          : 'Lookup failed.');
        openCustomFood({ dateKey, slot, onChange });
      }
    } catch (err) {
      status.textContent = err?.message ?? 'Camera unavailable.';
      status.style.color = 'var(--crimson)';
    }
  })();
}

/* ------------------------------------------------------------ hydration -- */

function hydrationCard(waterMl, target, dateKey, onChange) {
  const add = async (ml) => {
    /* Single-sourced: this only writes to `logs`. loadDay() above already
       unions logs(type=water) with the legacy `hydration` table, so writing
       to both here would double-count today's total. */
    await Logs.create({ type: 'water', value: ml, dateKey, at: Date.now() });
    toast(`+${ml} ml`);
    onChange();
  };

  return card('Hydration', { note: target ? `${fmt.ml(waterMl)} of ${fmt.ml(target)}` : fmt.ml(waterMl) },
    metricBar({ name: 'Water', value: waterMl, target, unit: 'ml', colour: 'recovery' }),
    el('div', { class: 'chip-row' },
      ...[250, 500, 750, 1000].map((ml) =>
        el('button', { class: 'chip chip-btn', onclick: () => add(ml) }, `+${ml}`)),
    ),
  );
}

/* ---------------------------------------------------------------- view --- */

export async function diaryView({ params } = {}) {
  if (!FEATURES.nutrition) {
    return card('Nutrition is switched off', {},
      el('p', { class: 'muted-sm' },
        'FEATURES.nutrition is false in src/config/app.config.js. Set it to true to use the diary.'));
  }

  const offset = Number(params?.get?.('d') ?? 0) || 0;
  const dateKey = offset ? dateKeyOffset(offset) : dateKeyOf(new Date());
  const { profile, entries, waterMl } = await loadDay(dateKey);

  const override = await getSetting('targets.override', null);
  const targets = override ?? computeTargets(profile);
  const totals = sumNutrients(entries);
  const split = macroSplit(totals);
  const groups = groupByMeal(entries);
  const onChange = () => refresh();

  const nav = el('div', { class: 'day-nav' },
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go(offset - 1) }, '‹ Prev'),
    el('strong', {}, offset === 0 ? 'Today' : fmt.dayLabel(dateKey)),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      disabled: offset >= 0,
      onclick: () => go(offset + 1),
    }, 'Next ›'),
  );

  return el('div', { class: 'stack' },
    nav,
    summaryCard(totals, targets, split),
    ...groups.map((g) => mealSection(g, dateKey, onChange)),
    FEATURES.hydration ? hydrationCard(waterMl, targets?.water, dateKey, onChange) : null,
    !entries.length ? emptyState({
      title: 'Nothing logged yet',
      message: 'Add a food to any meal above. The first few entries build your database; after that logging is a couple of taps.',
    }) : null,
    roadmapCard('Nutrition', [
      'Custom recipe builder — combine raw ingredients into meals, with cooking-yield/moisture-loss and fermentation sugar-to-alcohol modifiers for accurate cooked macros.',
      'Smart grocery checklist — 1-tap aggregation of ingredients from planned recipes into a categorized shopping list.',
      'Smart leftover & expiry tracker — batch-dates your meal prep and alerts you before it spoils.',
      'Electrolyte & deficiency alerts — post-workout sodium/fluid loss estimates and weekly iron/calcium/fibre shortfall flags.',
    ]),
  );

  function go(next) {
    if (next > 0) return;
    location.hash = next === 0 ? '#/diary' : `#/diary?d=${next}`;
  }
}
