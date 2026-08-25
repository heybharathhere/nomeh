/* Bio-math engine.
 *
 * Every function here is pure: same inputs, same outputs, no database, no DOM.
 * That is what makes the test suite in src/tests meaningful — these are the
 * numbers a user will act on, so they are the numbers most worth testing.
 *
 * Two standing rules, both from the spec and both non-negotiable:
 *   - every output is an ESTIMATE and is labelled as one in the UI
 *   - targets have floors. A calculator that will happily recommend 900 kcal
 *     because the arithmetic said so is a hazard, not a feature.
 */

import { PHYSIOLOGY, SAFETY, NUTRITION } from '../config/app.config.js';

const NUTRITION_KCAL = NUTRITION.kcalPerGram;

/* Constants are not defined here. They live in src/config/app.config.js so that
   every tunable number in the app is editable from one place. These re-exports
   keep the engine's public surface stable for callers and tests. */
export const ACTIVITY_FACTORS = PHYSIOLOGY.activityFactors;
export const GOALS            = PHYSIOLOGY.goals;
export const CALORIE_FLOOR    = PHYSIOLOGY.calorieFloor;

const round = (n, dp = 0) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function bmi(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm > 0)) return null;
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

/* Neutral, factual framing. No category is described in judgemental language,
   and the caveat travels with the value rather than being buried in a footnote. */
export function bmiContext(value) {
  if (value == null) return null;
  const band = (PHYSIOLOGY.bmiBands.find((b) => value < b.under)
             ?? PHYSIOLOGY.bmiBands[PHYSIOLOGY.bmiBands.length - 1]).band;
  return {
    band,
    caveat: 'BMI is a population screening ratio. It cannot distinguish muscle from fat, ' +
            'so for anyone training regularly it says very little on its own.'
  };
}

/* Mifflin-St Jeor. Mandated by the spec, and the better-validated of the
   common predictive equations for a general population. */
export function bmr({ weightKg, heightCm, ageYears, sex }) {
  if (!(weightKg > 0) || !(heightCm > 0) || !(ageYears > 0)) return null;
  const shared = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  let constant;
  if (sex === 'male') constant = 5;
  else if (sex === 'female') constant = -161;
  /* The equation was only ever fitted on two groups. Averaging the constants is
     an approximation, not a derivation, and the UI says so. */
  else constant = (5 + -161) / 2;
  return round(shared + constant);
}

export function tdee(bmrValue, activityKey) {
  if (!bmrValue) return null;
  const entry = ACTIVITY_FACTORS[activityKey] || ACTIVITY_FACTORS.moderate;
  return round(bmrValue * entry.factor);
}

export function calorieTarget({ tdeeValue, goalKey, sex, bmrValue }) {
  if (!tdeeValue) return null;
  const goal = GOALS[goalKey] || GOALS.general;
  const raw = tdeeValue * (1 + goal.calorieDelta);

  const floors = [];
  if (SAFETY.enforceCalorieFloor) {
    floors.push(CALORIE_FLOOR[sex] ?? CALORIE_FLOOR.unspecified);
    /* Never prescribe below resting expenditure either — for a large person the
       fixed floor is not the binding constraint. */
    if (bmrValue && PHYSIOLOGY.neverBelowBmr) floors.push(bmrValue);
  }
  const floor = floors.length ? Math.max(...floors) : 0;

  const value = Math.max(raw, floor);
  return {
    value: round(value),
    uncapped: round(raw),
    floored: value > raw + 0.5,
    floor: round(floor)
  };
}

export function macroTargets({ calories, weightKg, goalKey }) {
  if (!calories || !(weightKg > 0)) return null;
  const goal = GOALS[goalKey] || GOALS.general;

  const kpg      = NUTRITION_KCAL;
  const proteinG = round(weightKg * goal.proteinPerKg);
  const fatG     = round((calories * PHYSIOLOGY.fatFractionOfCalories) / kpg.fat);
  const carbKcal = calories - proteinG * kpg.protein - fatG * kpg.fat;
  /* If protein and fat alone exceed the calorie budget, carbohydrate cannot go
     negative — clamp and let the UI surface the conflict instead of printing a
     nonsense number. */
  const carbsG   = round(Math.max(0, carbKcal) / kpg.carbs);
  const fiberG   = round((calories / 1000) * PHYSIOLOGY.fibrePer1000Kcal);

  return {
    protein: proteinG,
    fat: fatG,
    carbs: carbsG,
    fiber: fiberG,
    conflict: carbKcal < 0
  };
}

/* Bodyweight baseline plus an activity allowance, both from config. A starting point to adjust
   from, not a prescription — thirst and climate beat any formula. */
export function waterTarget({ weightKg, activityKey }) {
  if (!(weightKg > 0)) return null;
  const extra = PHYSIOLOGY.waterMlByActivity;
  return round(weightKg * PHYSIOLOGY.waterMlPerKg + (extra[activityKey] ?? extra.moderate));
}

export function computeTargets(profile) {
  if (!profile) return null;
  const { weightKg, heightCm, ageYears, sex, activity, primaryGoal } = profile;

  const bmrValue  = bmr({ weightKg, heightCm, ageYears, sex });
  const tdeeValue = tdee(bmrValue, activity);
  const cal       = calorieTarget({ tdeeValue, goalKey: primaryGoal, sex, bmrValue });
  const macros    = cal ? macroTargets({ calories: cal.value, weightKg, goalKey: primaryGoal }) : null;

  return {
    bmi: bmi(weightKg, heightCm),
    bmr: bmrValue,
    tdee: tdeeValue,
    calories: cal?.value ?? null,
    calorieFloorApplied: cal?.floored ?? false,
    calorieFloor: cal?.floor ?? null,
    protein: macros?.protein ?? null,
    carbs: macros?.carbs ?? null,
    fat: macros?.fat ?? null,
    fiber: macros?.fiber ?? null,
    water: waterTarget({ weightKg, activityKey: activity }),
    macroConflict: macros?.conflict ?? false,
    method: 'Mifflin-St Jeor + activity factor',
    estimatedAt: Date.now()
  };
}

/* Sweat rate (spec §18). Pre/post weight in kg, fluid in ml, duration in min.
   Returned per hour because that is the only form in which it is useful when
   planning a long session. */
export function sweatRate({ preKg, postKg, fluidMl = 0, minutes }) {
  if (!(preKg > 0) || !(postKg > 0) || !(minutes > 0)) return null;
  const lostMl = (preKg - postKg) * 1000 + fluidMl;
  if (lostMl <= 0) return { ratePerHourMl: 0, totalMl: 0, note: 'No net fluid loss recorded.' };
  return {
    totalMl: round(lostMl),
    ratePerHourMl: round((lostMl / minutes) * 60),
    note: 'Estimate. Scale weight also moves with food, glycogen and bathroom breaks.'
  };
}

/* Unit conversion lives with the maths, not the views, so the same rounding is
   used whether a value is displayed, exported or tested. */
export const convert = {
  kgToLb: (kg) => round(kg * 2.2046226218, 1),
  lbToKg: (lb) => round(lb / 2.2046226218, 2),
  cmToIn: (cm) => round(cm / 2.54, 1),
  inToCm: (inch) => round(inch * 2.54, 1),
  kmToMi: (km) => round(km * 0.621371, 2),
  miToKm: (mi) => round(mi / 0.621371, 2),
  kcalToKj: (kcal) => round(kcal * 4.184),
  kjToKcal: (kj) => round(kj / 4.184),
  cmToFtIn: (cm) => {
    const totalIn = cm / 2.54;
    return { ft: Math.floor(totalIn / 12), in: round(totalIn % 12, 1) };
  }
};
