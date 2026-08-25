/* Tests for every pure engine.
 *
 * The build prompt names what must be tested: BMR, BMI, TDEE, macros, nutrition
 * maths, training load, recovery, GPS filtering, pace, distance, CRUD,
 * migrations, backup restore, import/export, duplicate detection.
 *
 * What is covered here is the part that exists in this build and is pure:
 * bio-math, unit conversion, the quick-log parser, and the analytics reducers.
 * The database, migration and backup tests need a real IndexedDB and belong in
 * a browser-driver suite — that gap is stated in the README rather than papered
 * over with tests that only appear to cover them.
 */

import { describe, assert } from './harness.js';
import {
  bmi, bmiContext, bmr, tdee, calorieTarget, macroTargets, waterTarget,
  computeTargets, sweatRate, convert, CALORIE_FLOOR, ACTIVITY_FACTORS
} from '../engines/biomath.js';
import { parseQuickLog, parseDuration, parseDistance, candidateToRecord } from '../engines/logparser.js';
import {
  dailyTotals, rollingAverage, currentStreak, sufficiency, seriesByDay, adaptiveTdee, daysBetween
} from '../engines/analytics.js';

/* ------------------------------------------------------------- bio-math -- */

describe('BMI', ({ it }) => {
  it('computes a known value', () => {
    assert.close(bmi(70, 175), 22.9, 0.05);
  });
  it('rejects impossible inputs instead of returning NaN', () => {
    assert.isNull(bmi(0, 175));
    assert.isNull(bmi(70, 0));
    assert.isNull(bmi(undefined, undefined));
  });
  it('describes bands without judgemental language', () => {
    const ctx = bmiContext(31);
    assert.ok(ctx.band.includes('above'));
    assert.notOk(/obese|overweight|fat/i.test(ctx.band), 'band text must stay neutral');
    assert.ok(ctx.caveat.length > 20, 'the muscle-mass caveat must travel with the value');
  });
});

describe('BMR — Mifflin-St Jeor', ({ it }) => {
  /* 10(80) + 6.25(180) - 5(30) + 5 = 800 + 1125 - 150 + 5 = 1780 */
  it('matches the published male equation', () => {
    assert.equal(bmr({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' }), 1780);
  });
  /* 10(60) + 6.25(165) - 5(28) - 161 = 600 + 1031.25 - 140 - 161 = 1330.25 */
  it('matches the published female equation', () => {
    assert.close(bmr({ weightKg: 60, heightCm: 165, ageYears: 28, sex: 'female' }), 1330, 1);
  });
  it('sits an unspecified sex between the two constants', () => {
    const m = bmr({ weightKg: 70, heightCm: 170, ageYears: 30, sex: 'male' });
    const f = bmr({ weightKg: 70, heightCm: 170, ageYears: 30, sex: 'female' });
    const u = bmr({ weightKg: 70, heightCm: 170, ageYears: 30, sex: 'unspecified' });
    assert.ok(u < m && u > f, 'unspecified must fall between, not default to one');
  });
  it('returns null on missing inputs', () => {
    assert.isNull(bmr({ weightKg: 70, heightCm: 170 }));
  });
});

describe('TDEE', ({ it }) => {
  it('applies the activity factor', () => {
    assert.equal(tdee(1780, 'moderate'), Math.round(1780 * 1.55));
  });
  it('falls back to moderate for an unknown key', () => {
    assert.equal(tdee(1780, 'nonsense'), tdee(1780, 'moderate'));
  });
  it('has a monotonic factor ladder', () => {
    const factors = Object.values(ACTIVITY_FACTORS).map((a) => a.factor);
    for (let i = 1; i < factors.length; i++) {
      assert.ok(factors[i] > factors[i - 1], 'activity factors must increase in order');
    }
  });
});

describe('Calorie target safety floors', ({ it }) => {
  it('applies the goal adjustment when it is safe to', () => {
    const r = calorieTarget({ tdeeValue: 2800, goalKey: 'fat_loss', sex: 'male', bmrValue: 1800 });
    assert.close(r.value, 2296, 1);
    assert.notOk(r.floored);
  });

  /* The case this floor exists for: a small person on an aggressive goal. */
  it('refuses to go below the floor for a small female profile', () => {
    const r = calorieTarget({ tdeeValue: 1400, goalKey: 'fat_loss', sex: 'female', bmrValue: 1150 });
    assert.ok(r.floored, 'the floor must engage');
    assert.ok(r.value >= CALORIE_FLOOR.female, 'result must not fall below the published floor');
    assert.ok(r.uncapped < r.value, 'the uncapped figure must be reported for transparency');
  });

  it('never prescribes below resting expenditure', () => {
    const r = calorieTarget({ tdeeValue: 2000, goalKey: 'fat_loss', sex: 'male', bmrValue: 1900 });
    assert.ok(r.value >= 1900);
  });

  it('adds calories for a growth goal', () => {
    const gain = calorieTarget({ tdeeValue: 2500, goalKey: 'hypertrophy', sex: 'male', bmrValue: 1700 });
    assert.ok(gain.value > 2500);
  });
});

describe('Macro targets', ({ it }) => {
  it('splits a budget into protein, fat, carbs and fibre', () => {
    const m = macroTargets({ calories: 2400, weightKg: 80, goalKey: 'general' });
    assert.equal(m.protein, 128);            // 80 × 1.6
    assert.close(m.fat, 67, 1);              // 2400 × 0.25 / 9
    assert.ok(m.carbs > 0);
    assert.close(m.fiber, 34, 1);            // 2.4 × 14
    assert.notOk(m.conflict);
  });

  it('keeps macro energy within the calorie budget', () => {
    const cal = 2200;
    const m = macroTargets({ calories: cal, weightKg: 75, goalKey: 'fat_loss' });
    const fromMacros = m.protein * 4 + m.carbs * 4 + m.fat * 9;
    assert.close(fromMacros, cal, 12, 'macro energy must reconcile with the target');
  });

  it('clamps carbohydrate at zero and flags the conflict', () => {
    const m = macroTargets({ calories: 900, weightKg: 120, goalKey: 'fat_loss' });
    assert.ok(m.carbs >= 0, 'carbohydrate must never go negative');
    assert.ok(m.conflict, 'an impossible split must be reported, not hidden');
  });
});

describe('Water target', ({ it }) => {
  it('scales with weight and activity', () => {
    assert.equal(waterTarget({ weightKg: 70, activityKey: 'sedentary' }), 2450);
    assert.equal(waterTarget({ weightKg: 70, activityKey: 'athlete' }), 3450);
  });
  it('returns null without a weight', () => {
    assert.isNull(waterTarget({ weightKg: 0, activityKey: 'moderate' }));
  });
});

describe('computeTargets', ({ it }) => {
  const profile = {
    weightKg: 82, heightCm: 178, ageYears: 34,
    sex: 'male', activity: 'moderate', primaryGoal: 'fat_loss'
  };

  it('produces a complete, internally consistent target set', () => {
    const t = computeTargets(profile);
    for (const key of ['bmi', 'bmr', 'tdee', 'calories', 'protein', 'carbs', 'fat', 'fiber', 'water']) {
      assert.ok(t[key] > 0, `${key} must be a positive number`);
    }
    assert.ok(t.tdee > t.bmr, 'TDEE must exceed BMR');
    assert.ok(t.calories < t.tdee, 'a fat-loss target must sit below TDEE');
    assert.ok(t.method.includes('Mifflin'), 'the method must be stated');
  });

  it('returns null rather than guessing when handed nothing', () => {
    assert.isNull(computeTargets(null));
  });
});

describe('Sweat rate', ({ it }) => {
  it('accounts for fluid drunk during the session', () => {
    const r = sweatRate({ preKg: 80, postKg: 79, fluidMl: 500, minutes: 60 });
    assert.equal(r.totalMl, 1500);
    assert.equal(r.ratePerHourMl, 1500);
  });
  it('halves the rate when the same loss takes twice as long', () => {
    const r = sweatRate({ preKg: 80, postKg: 79, fluidMl: 500, minutes: 120 });
    assert.equal(r.ratePerHourMl, 750);
  });
  it('handles a weight gain without producing a negative rate', () => {
    const r = sweatRate({ preKg: 79, postKg: 80, fluidMl: 0, minutes: 60 });
    assert.equal(r.ratePerHourMl, 0);
  });
});

describe('Unit conversion', ({ it }) => {
  it('round-trips weight without drift', () => {
    assert.close(convert.lbToKg(convert.kgToLb(82.5)), 82.5, 0.05);
  });
  it('converts distance and energy', () => {
    assert.close(convert.kmToMi(10), 6.21, 0.01);
    assert.close(convert.miToKm(3.1), 4.99, 0.02);
    assert.equal(convert.kcalToKj(100), 418);
  });
  it('splits centimetres into feet and inches', () => {
    const r = convert.cmToFtIn(180);
    assert.equal(r.ft, 5);
    assert.close(r.in, 10.9, 0.1);
  });
});

/* --------------------------------------------------------------- parser -- */

describe('Duration parsing', ({ it }) => {
  it('reads the formats people actually type', () => {
    assert.equal(parseDuration('31min'), 31);
    assert.equal(parseDuration('31 minutes'), 31);
    assert.equal(parseDuration('45:30'), 45.5);
    assert.equal(parseDuration('1:05:30'), 65.5);
    assert.close(parseDuration('7h30'), 450, 0.01);
    assert.close(parseDuration('90s'), 1.5, 0.01);
  });
  it('returns null on nonsense', () => {
    assert.isNull(parseDuration('soon'));
    assert.isNull(parseDuration(''));
  });
});

describe('Distance parsing', ({ it }) => {
  it('treats 5k as five kilometres', () => {
    assert.equal(parseDistance('5k'), 5);
    assert.equal(parseDistance('5 km'), 5);
  });
  it('converts miles and metres', () => {
    assert.close(parseDistance('3 miles'), 4.83, 0.02);
    assert.equal(parseDistance('800 m'), 0.8);
  });
});

describe('Quick-log parser', ({ it }) => {
  it('parses hydration with the unit spelled several ways', () => {
    const [a] = parseQuickLog('500ml water');
    assert.equal(a.type, 'water');
    assert.equal(a.value, 500);

    const [b] = parseQuickLog('1.5 L water');
    assert.equal(b.value, 1500);

    const [c] = parseQuickLog('2 glasses water');
    assert.equal(c.value, 500);
  });

  it('separates electrolytes from plain water', () => {
    const [a] = parseQuickLog('500ml electrolyte drink');
    assert.equal(a.type, 'electrolytes');
  });

  it('parses body weight and converts pounds', () => {
    const [a] = parseQuickLog('83.5 kg');
    assert.equal(a.type, 'weight');
    assert.equal(a.value, 83.5);

    const [b] = parseQuickLog('184 lb');
    assert.equal(b.type, 'weight');
    assert.close(b.value, 83.46, 0.05);
  });

  it('parses a run with distance, time and derived pace', () => {
    const [a] = parseQuickLog('5 km run in 31 minutes');
    assert.equal(a.type, 'run');
    assert.equal(a.value, 5);
    assert.equal(a.minutes, 31);
    assert.ok(a.detail.includes('/km'), 'pace should be shown back to the user');
    assert.equal(a.confidence, 'high');
  });

  it('distinguishes walking and cycling from running', () => {
    assert.equal(parseQuickLog('walked 3km')[0].type, 'walk');
    assert.equal(parseQuickLog('cycled 20km in 45 min')[0].type, 'cycle');
  });

  it('parses a resistance set with load and RPE', () => {
    const [a] = parseQuickLog('bench press 5x5 80kg rpe 8');
    assert.equal(a.type, 'exercise');
    assert.equal(a.sets, 5);
    assert.equal(a.reps, 5);
    assert.equal(a.loadKg, 80);
    assert.equal(a.rpe, 8);
    assert.ok(a.exercise.toLowerCase().includes('bench'));
  });

  it('does not mistake a set for a body weight', () => {
    const [a] = parseQuickLog('squat 3x8 100kg');
    assert.equal(a.type, 'exercise', 'the 100kg here is load, not the user');
  });

  it('parses sleep in hours and minutes', () => {
    const [a] = parseQuickLog('slept 7h30');
    assert.equal(a.type, 'sleep');
    assert.equal(a.minutes, 450);
  });

  it('parses subjective scales', () => {
    assert.equal(parseQuickLog('mood 4')[0].value, 4);
    assert.equal(parseQuickLog('stress 2')[0].type, 'stress');
    assert.equal(parseQuickLog('energy 5/5')[0].value, 5);
  });

  it('clamps an out-of-range scale rather than storing it', () => {
    assert.equal(parseQuickLog('mood 9')[0].value, 5);
  });

  it('parses heart rate and marks resting readings', () => {
    const [a] = parseQuickLog('resting hr 54');
    assert.equal(a.type, 'heartrate');
    assert.equal(a.value, 54);
    assert.equal(a.kind, 'resting');
  });

  it('splits multiple entries on a semicolon', () => {
    const out = parseQuickLog('500ml water; slept 7h30; 5km run in 31 min');
    assert.equal(out.length, 3);
    assert.deep(out.map((c) => c.type), ['water', 'sleep', 'run']);
  });

  it('falls back to a note rather than inventing a record', () => {
    const [a] = parseQuickLog('felt sluggish on the hills today');
    assert.equal(a.type, 'note');
    assert.equal(a.confidence, 'low');
  });

  it('rejects an implausible body weight instead of storing it', () => {
    const [a] = parseQuickLog('900 kg');
    assert.equal(a.type, 'note', 'a 900 kg human is a typo, not a measurement');
  });

  it('returns nothing for empty input', () => {
    assert.equal(parseQuickLog('').length, 0);
    assert.equal(parseQuickLog('   ').length, 0);
  });

  it('never returns a record without a type', () => {
    const inputs = ['500ml water', 'blah', '5x5', '83kg', 'slept 8h', 'hr 60', 'mood 3'];
    for (const i of inputs) {
      for (const c of parseQuickLog(i)) assert.ok(c.type, `"${i}" produced a typeless candidate`);
    }
  });

  it('converts a candidate into a storable record', () => {
    const [c] = parseQuickLog('500ml water');
    const rec = candidateToRecord(c);
    assert.equal(rec.type, 'water');
    assert.equal(rec.value, 500);
    assert.ok(rec.at > 0, 'a record must carry a timestamp');
  });
});

/* ------------------------------------------------------------ analytics -- */

describe('Daily totals', ({ it }) => {
  const logs = [
    { type: 'water', value: 500, dateKey: '2026-01-01' },
    { type: 'water', value: 750, dateKey: '2026-01-01' },
    { type: 'electrolytes', value: 250, dateKey: '2026-01-01' },
    { type: 'food', value: 640, dateKey: '2026-01-01' },
    { type: 'run', value: 5, minutes: 31, dateKey: '2026-01-01' },
    { type: 'exercise', sets: 3, reps: 10, loadKg: 20, dateKey: '2026-01-01' },
    { type: 'weight', value: 82.4, dateKey: '2026-01-01' },
    { type: 'sleep', minutes: 430, dateKey: '2026-01-01' }
  ];

  it('sums each domain independently', () => {
    const t = dailyTotals(logs);
    assert.equal(t.water, 1500, 'electrolyte volume counts toward total fluid');
    assert.equal(t.electrolytes, 250);
    assert.equal(t.calories, 640);
    assert.equal(t.runKm, 5);
    assert.equal(t.activeMinutes, 31);
    assert.equal(t.sets, 3);
    assert.equal(t.reps, 30);
    assert.equal(t.volumeKg, 600);
    assert.equal(t.weight, 82.4);
    assert.equal(t.sleepMinutes, 430);
  });

  it('handles an empty day without throwing', () => {
    const t = dailyTotals([]);
    assert.equal(t.water, 0);
    assert.isNull(t.weight);
  });

  it('takes the last weight reading of the day', () => {
    const t = dailyTotals([
      { type: 'weight', value: 82.0 },
      { type: 'weight', value: 81.6 }
    ]);
    assert.equal(t.weight, 81.6);
  });
});

describe('Rolling average', ({ it }) => {
  it('averages over the window once enough samples exist', () => {
    const out = rollingAverage([1, 2, 3, 4, 5, 6, 7, 8], 3);
    assert.equal(out.length, 8);
    assert.equal(out[7].average, 7);          // (6+7+8)/3
    assert.equal(out[7].samples, 3);
  });
  it('averages over fewer samples at the start rather than dropping them', () => {
    const out = rollingAverage([10, 20], 7);
    assert.equal(out[0].average, 10);
    assert.equal(out[1].average, 15);
    assert.equal(out[1].samples, 2);
  });
  it('returns an empty array for no input', () => {
    assert.equal(rollingAverage([], 7).length, 0);
  });
});

describe('Series by day', ({ it }) => {
  it('inserts nulls for missing days instead of closing the gap', () => {
    const logs = [
      { type: 'weight', dateKey: '2026-01-01', value: 80 },
      { type: 'weight', dateKey: '2026-01-04', value: 79 }
    ];
    const s = seriesByDay(logs, { type: 'weight', from: '2026-01-01', to: '2026-01-04' });
    assert.equal(s.length, 4);
    assert.equal(s[0].value, 80);
    assert.isNull(s[1].value);
    assert.isNull(s[2].value);
    assert.equal(s[3].value, 79);
  });
});

describe('Streak', ({ it }) => {
  it('counts consecutive logged days', () => {
    assert.equal(currentStreak(['2026-03-10', '2026-03-09', '2026-03-08'], '2026-03-10'), 3);
  });
  it('does not break the streak just because today is not logged yet', () => {
    assert.equal(currentStreak(['2026-03-09', '2026-03-08'], '2026-03-10'), 2);
  });
  it('returns zero once a full day has been missed', () => {
    assert.equal(currentStreak(['2026-03-07', '2026-03-06'], '2026-03-10'), 0);
  });
  it('handles no history', () => {
    assert.equal(currentStreak([], '2026-03-10'), 0);
  });
});

describe('Data sufficiency', ({ it }) => {
  it('grades the amount of data honestly', () => {
    assert.equal(sufficiency(20).level, 'good');
    assert.equal(sufficiency(9).level, 'fair');
    assert.equal(sufficiency(2).level, 'low');
  });
});

describe('Adaptive TDEE', ({ it }) => {
  const days = (n) => Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });

  it('refuses to produce a figure from too little data', () => {
    const r = adaptiveTdee({
      weightSeries: days(4).map((k, i) => ({ dateKey: k, value: 80 - i * 0.1 })),
      calorieSeries: days(4).map((k) => ({ dateKey: k, value: 2200 }))
    });
    assert.isNull(r.value);
    assert.equal(r.confidence.level, 'low');
  });

  it('estimates above intake when weight is falling', () => {
    const keys = days(14);
    const r = adaptiveTdee({
      weightSeries: keys.map((k, i) => ({ dateKey: k, value: 80 - i * 0.05 })),
      calorieSeries: keys.map((k) => ({ dateKey: k, value: 2200 }))
    });
    assert.ok(r.value > 2200, 'losing weight on 2200 kcal implies expenditure above 2200');
    assert.equal(r.basis.days, 13);
  });

  it('estimates below intake when weight is rising', () => {
    const keys = days(14);
    const r = adaptiveTdee({
      weightSeries: keys.map((k, i) => ({ dateKey: k, value: 80 + i * 0.05 })),
      calorieSeries: keys.map((k) => ({ dateKey: k, value: 3000 }))
    });
    assert.ok(r.value < 3000);
  });
});

describe('Date maths', ({ it }) => {
  it('counts whole days between keys', () => {
    assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
    assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1, '2026 is not a leap year');
  });
});
