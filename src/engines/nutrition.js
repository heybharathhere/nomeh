/* Nutrition engine. Pure functions — no DOM, no database, no network.
 *
 * Foods are stored normalised to per-100 g (or per-100 ml) because that is the
 * only way portions, recipes and barcode data can be compared without a units
 * bug somewhere. Every serving figure is derived at read time from that base.
 *
 * The sanity check matters more than it looks. Open Food Facts is crowd-sourced,
 * and a meaningful fraction of entries have calories in kJ, macros per serving
 * against calories per 100 g, or a decimal point in the wrong place. Importing
 * those silently corrupts every total downstream, so anything whose macros do
 * not reconcile with its stated energy is flagged before it can be saved.
 */

import { NUTRITION } from '../config/app.config.js';

const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const K = NUTRITION.kcalPerGram;

/* ------------------------------------------------------------- energy ----- */

export function energyFromMacros({ protein = 0, carbs = 0, fat = 0, alcohol = 0, fibre = 0 }) {
  /* Fibre is conventionally counted inside the carbohydrate figure but is not
     metabolised at 4 kcal/g. Ignoring that overestimates the energy of any
     high-fibre, low-calorie food badly enough to fail the sanity check on
     genuinely correct data — raw spinach reconciles at 30 kcal instead of its
     real 23 — so fibre is split out and charged at its own rate. */
  const totalCarbs = num(carbs);
  const fib = Math.min(num(fibre), totalCarbs);
  const netCarbs = totalCarbs - fib;
  return round(num(protein) * K.protein + netCarbs * K.carbs + fib * K.fibre +
               num(fat) * K.fat + num(alcohol) * K.alcohol);
}

/* Does the stated energy agree with the stated macros? A food whose numbers
   disagree by more than the tolerance is almost always a units error. */
export function macroSanity(food) {
  const stated = num(food?.kcal);
  const derived = energyFromMacros(food ?? {});
  if (!stated && !derived) return { ok: true, checked: false };
  if (!stated || !derived) {
    return { ok: true, checked: false, note: 'Not enough information to cross-check.' };
  }
  const ratio = Math.abs(derived - stated) / stated;
  const ok = ratio <= NUTRITION.macroSanityTolerance;
  return {
    ok, checked: true, stated, derived: round(derived), driftRatio: round(ratio, 2),
    note: ok ? null :
      `Stated ${Math.round(stated)} kcal but the macros imply ${Math.round(derived)}. ` +
      'Usually a kJ/kcal mix-up or a per-serving figure against a per-100 g one.',
    /* The most common single cause, offered as a one-tap fix in the UI. */
    suggestion: ok ? null
      : Math.abs(derived - stated / 4.184) / Math.max(1, derived) < 0.15
        ? 'kj-to-kcal' : null,
  };
}

/* ------------------------------------------------------------ normalise --- */

/* Everything the app stores as a food goes through here first. */
export function normaliseFood(input = {}) {
  const basis = num(input.basisG) || 100;
  const factor = 100 / basis;
  const scale = (v) => round(num(v) * factor, 2);

  const food = {
    name: String(input.name ?? '').trim(),
    brand: input.brand ? String(input.brand).trim() : null,
    barcode: input.barcode ? String(input.barcode).replace(/\s/g, '') : null,
    /* Per 100 g or 100 ml. */
    unit: input.unit === 'ml' ? 'ml' : 'g',
    kcal: scale(input.kcal),
    protein: scale(input.protein),
    carbs: scale(input.carbs),
    fat: scale(input.fat),
    fibre: scale(input.fibre),
    sugar: scale(input.sugar),
    saturated: scale(input.saturated),
    sodiumMg: scale(input.sodiumMg),
    /* Common portions, so a user picks "1 slice" instead of guessing grams. */
    servings: Array.isArray(input.servings)
      ? input.servings
          .filter((s) => s && s.label && num(s.grams) > 0)
          .map((s) => ({ label: String(s.label), grams: round(num(s.grams), 1) }))
      : [],
    source: input.source ?? 'manual',
    verified: input.verified === true,
    createdAt: input.createdAt ?? Date.now(),
  };

  if (!food.servings.length) {
    food.servings = [{ label: food.unit === 'ml' ? '100 ml' : '100 g', grams: 100 }];
  }
  food.sanity = macroSanity(food);
  return food;
}

/* Maps an Open Food Facts product to our shape. Their field naming is
   inconsistent across entries, hence the fallback chains. */
export function fromOpenFoodFacts(product = {}) {
  const n = product.nutriments ?? {};
  const pick = (...keys) => {
    for (const k of keys) if (n[k] != null && n[k] !== '') return num(n[k]);
    return 0;
  };

  /* Their energy field is sometimes only present in kJ. */
  let kcal = pick('energy-kcal_100g', 'energy-kcal');
  if (!kcal) {
    const kj = pick('energy-kj_100g', 'energy_100g', 'energy');
    if (kj) kcal = kj / 4.184;
  }

  const servingG = num(String(product.serving_size ?? '').match(/([\d.]+)\s*(g|ml)/i)?.[1]);
  const servings = servingG > 0
    ? [{ label: String(product.serving_size).trim(), grams: servingG }]
    : [];

  return normaliseFood({
    name: product.product_name || product.generic_name || 'Unnamed product',
    brand: product.brands?.split(',')[0]?.trim() || null,
    barcode: product.code || product._id || null,
    unit: /ml|l\b/i.test(product.quantity ?? '') ? 'ml' : 'g',
    basisG: 100,
    kcal,
    protein: pick('proteins_100g', 'proteins'),
    carbs: pick('carbohydrates_100g', 'carbohydrates'),
    fat: pick('fat_100g', 'fat'),
    fibre: pick('fiber_100g', 'fiber'),
    sugar: pick('sugars_100g', 'sugars'),
    saturated: pick('saturated-fat_100g', 'saturated-fat'),
    sodiumMg: pick('sodium_100g', 'sodium') * 1000,
    servings,
    source: 'openfoodfacts',
    verified: false,
  });
}

/* ------------------------------------------------------------- portions --- */

/* A logged entry is a food plus a quantity. This resolves it to actual numbers. */
export function portion(food, { grams = null, servingLabel = null, count = 1 } = {}) {
  if (!food) return null;
  let g = num(grams);
  if (!g && servingLabel) {
    g = num(food.servings?.find((s) => s.label === servingLabel)?.grams) * num(count || 1);
  }
  if (!g) g = NUTRITION.defaultServingG * num(count || 1);

  const f = g / 100;
  return {
    grams: round(g, 1),
    kcal: round(num(food.kcal) * f),
    protein: round(num(food.protein) * f, 1),
    carbs: round(num(food.carbs) * f, 1),
    fat: round(num(food.fat) * f, 1),
    fibre: round(num(food.fibre) * f, 1),
    sugar: round(num(food.sugar) * f, 1),
    saturated: round(num(food.saturated) * f, 1),
    sodiumMg: round(num(food.sodiumMg) * f),
  };
}

/* Sums any list of resolved portions or diary entries. */
export function sumNutrients(entries = []) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sugar: 0, saturated: 0, sodiumMg: 0 };
  for (const e of entries) {
    for (const k of Object.keys(total)) total[k] += num(e?.[k]);
  }
  for (const k of Object.keys(total)) total[k] = round(total[k], k === 'kcal' || k === 'sodiumMg' ? 0 : 1);
  return total;
}

/* Which meal slot a timestamp falls into. Handles the slot that wraps midnight. */
export function mealForTime(date = new Date()) {
  const h = date.getHours();
  for (const m of NUTRITION.meals) {
    const wraps = m.from > m.to;
    if (wraps ? (h >= m.from || h < m.to) : (h >= m.from && h < m.to)) return m.key;
  }
  return NUTRITION.meals[0].key;
}

export function groupByMeal(entries = []) {
  const groups = NUTRITION.meals.map((m) => ({ ...m, entries: [], totals: null }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  for (const e of entries) {
    const g = byKey.get(e.meal) ?? groups[groups.length - 1];
    g.entries.push(e);
  }
  for (const g of groups) g.totals = sumNutrients(g.entries);
  return groups;
}

/* Macro split as percentages of energy — the view that actually tells you
   something, since grams alone hide the balance. */
export function macroSplit(totals) {
  const p = num(totals?.protein) * K.protein;
  const c = num(totals?.carbs) * K.carbs;
  const f = num(totals?.fat) * K.fat;
  const sum = p + c + f;
  if (!sum) return null;
  return {
    protein: round((p / sum) * 100),
    carbs: round((c / sum) * 100),
    fat: round((f / sum) * 100),
    energyFromMacros: round(sum),
  };
}

/* ------------------------------------------------------------- recipes --- */

/* A recipe is a list of foods plus a yield. Resolving it produces a food, so a
   recipe can be logged exactly like anything else. */
export function resolveRecipe({ name, items = [], servings = 1, foodsById = new Map() }) {
  const resolved = items.map((it) => {
    const food = foodsById.get(it.foodId);
    return food ? { ...portion(food, it), name: food.name } : null;
  }).filter(Boolean);

  if (!resolved.length) return null;
  const total = sumNutrients(resolved);
  const perServing = Math.max(1, num(servings) || 1);
  const totalGrams = resolved.reduce((s, r) => s + num(r.grams), 0);

  return {
    name: name || 'Recipe',
    itemCount: resolved.length,
    missing: items.length - resolved.length,
    totalGrams: round(totalGrams, 1),
    total,
    perServing: {
      grams: round(totalGrams / perServing, 1),
      kcal: round(total.kcal / perServing),
      protein: round(total.protein / perServing, 1),
      carbs: round(total.carbs / perServing, 1),
      fat: round(total.fat / perServing, 1),
      fibre: round(total.fibre / perServing, 1),
    },
    /* Expressed per 100 g so it can be stored as a normal food. */
    asFood: totalGrams > 0 ? normaliseFood({
      name: name || 'Recipe',
      basisG: totalGrams,
      kcal: total.kcal, protein: total.protein, carbs: total.carbs,
      fat: total.fat, fibre: total.fibre,
      servings: [{ label: '1 serving', grams: round(totalGrams / perServing, 1) }],
      source: 'recipe',
    }) : null,
  };
}

/* --------------------------------------------------------- target status --- */

/* Progress against target, with honest framing. Deliberately never says "you
   failed" or "you were bad" — it reports a number and how far it is from a
   target, and stays quiet on days with no data. */
export function targetStatus(totals, targets) {
  if (!targets) return null;
  const item = (key, unit) => {
    const value = num(totals?.[key]);
    const target = num(targets?.[key]);
    if (!target) return { key, value, target: null, pct: null, unit };
    return {
      key, value, target, unit,
      pct: round((value / target) * 100),
      remaining: round(Math.max(0, target - value), key === 'kcal' ? 0 : 1),
      over: value > target,
    };
  };
  return {
    kcal: item('kcal', 'kcal'),
    protein: item('protein', 'g'),
    carbs: item('carbs', 'g'),
    fat: item('fat', 'g'),
    fibre: item('fiber', 'g'),
    logged: num(totals?.kcal) > 0,
  };
}

export function searchFoods(foods = [], query = '', limit = NUTRITION.searchLimit) {
  const q = String(query).trim().toLowerCase();
  if (q.length < NUTRITION.searchMinChars) return [];

  /* Rank by where the match falls: a name starting with the query beats one
     mentioning it halfway through, which beats a brand-only match. */
  const scored = [];
  for (const f of foods) {
    const name = String(f.name ?? '').toLowerCase();
    const brand = String(f.brand ?? '').toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (brand.includes(q)) score = 30;
    else if (String(f.barcode ?? '') === q) score = 95;
    if (!score) continue;
    if (f.verified) score += 5;
    if (f.source === 'manual') score += 3;   // your own entries first
    scored.push({ food: f, score });
  }
  return scored.sort((a, b) => b.score - a.score || String(a.food.name).localeCompare(String(b.food.name)))
    .slice(0, limit).map((s) => s.food);
}
