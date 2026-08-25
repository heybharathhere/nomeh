/* Tests for the Phase 2–7 engines: training, geo, nutrition, recovery.
 *
 * Several of these exist because the bug they check for was real and shipped in
 * a draft of this build. Those are marked REGRESSION, and they are the most
 * valuable tests in the file — each one is a mistake that produced a plausible,
 * confident, wrong number rather than an obvious crash:
 *
 *   - a missing recovery input scored as perfect, because Number(null) is 0
 *   - high-fibre foods failed a sanity check that was itself miscalculating
 *   - a training-load model reporting a ratio from two days of data
 *   - a GPS filter that let a tower-handoff teleport inflate distance
 *
 * The database, migration and backup-restore paths still are not covered here.
 * They need a real IndexedDB, which means a browser driver. That gap is stated
 * in the README rather than hidden behind tests that only look like coverage.
 */

import { describe, assert } from './harness.js';

import {
  oneRepMax, oneRepMaxRange, volumeLoad, totalReps, detectPRs, suggestProgression,
  sessionLoad, maxHeartRate, heartRateZone, zoneBoundaries, trainingLoad, restFor, setKind,
} from '../engines/training.js';

import {
  haversine, bearing, acceptPoint, smoothTrack, processTrack, elevationProfile,
  splits, paceSecPerKm, speedKmh, movingTime, estimatePower, ftpFrom20min,
  parseGpx, buildGpx, routePath,
} from '../engines/geo.js';

import {
  energyFromMacros, macroSanity, normaliseFood, fromOpenFoodFacts, portion,
  sumNutrients, mealForTime, groupByMeal, macroSplit, resolveRecipe, targetStatus, searchFoods,
} from '../engines/nutrition.js';

import {
  baseline, sleepScore, analyseSleep, readiness, recoverySummary, correlate,
} from '../engines/recovery.js';

import { EXERCISES, FOODS, PROGRAMS } from '../db/seeds.js';
import { parseCsv, parseHealthDate } from '../features/healthimport.js';

/* ============================================================== TRAINING == */

describe('One-rep max', ({ it }) => {
  it('returns the load itself for a single', () => {
    assert.equal(oneRepMax(100, 1), 100);
  });

  it('estimates a five-rep set with Epley', () => {
    assert.close(oneRepMax(100, 5), 116.7, 0.1);
  });

  it('refuses beyond the reliable rep ceiling instead of guessing', () => {
    /* REGRESSION-ADJACENT: the whole point is that a set of 20 produces no
       number at all rather than a confident 167 kg. */
    assert.isNull(oneRepMax(100, 20));
    assert.isNull(oneRepMax(100, 13));
    assert.ok(oneRepMax(100, 12) != null, '12 reps is the configured limit and should work');
  });

  it('rejects nonsense inputs', () => {
    assert.isNull(oneRepMax(0, 5));
    assert.isNull(oneRepMax(100, 0));
    assert.isNull(oneRepMax(-50, 5));
    assert.isNull(oneRepMax('abc', 5));
  });

  it('reports the spread between formulas rather than implying precision', () => {
    const r = oneRepMaxRange(100, 8);
    assert.ok(r.spread > 0, 'formulas should disagree at 8 reps');
    assert.ok(r.low < r.high);
    assert.ok(r.chosen >= r.low && r.chosen <= r.high);
  });
});

describe('Volume', ({ it }) => {
  it('multiplies reps by load across sets', () => {
    assert.equal(volumeLoad([{ reps: 10, loadKg: 50 }, { reps: 8, loadKg: 60 }]), 980);
  });

  it('treats bodyweight sets as zero volume but counts the reps', () => {
    const sets = [{ reps: 12, loadKg: 0 }, { reps: 10 }];
    assert.equal(volumeLoad(sets), 0);
    assert.equal(totalReps(sets), 22);
  });

  it('survives missing fields', () => {
    assert.equal(volumeLoad([{}, { reps: 5 }, { loadKg: 20 }]), 0);
  });
});

describe('PR detection', ({ it }) => {
  it('flags a first-ever entry as a first, not as an improvement', () => {
    const prs = detectPRs({ exercise: 'Bench Press', sets: [{ reps: 5, loadKg: 80 }], history: [] });
    assert.ok(prs.length > 0);
    assert.ok(prs.every((p) => p.first === true));
    assert.isNull(prs[0].delta);
  });

  it('does not report a PR when the previous best stands', () => {
    const history = [{ exercise: 'Bench Press', kind: 'weight', value: 100 }];
    const prs = detectPRs({ exercise: 'Bench Press', sets: [{ reps: 5, loadKg: 80 }], history });
    assert.notOk(prs.some((p) => p.kind === 'weight'), 'an 80 kg set is not a PR over 100 kg');
  });

  it('reports the delta when a record is beaten', () => {
    const history = [{ exercise: 'Squat', kind: 'weight', value: 100 }];
    const prs = detectPRs({ exercise: 'Squat', sets: [{ reps: 3, loadKg: 110 }], history });
    const weight = prs.find((p) => p.kind === 'weight');
    assert.equal(weight.value, 110);
    assert.equal(weight.delta, 10);
  });
});

describe('Progression', ({ it }) => {
  const easy = (at) => ({ at, sets: [{ reps: 8, targetReps: 8, rpe: 6, loadKg: 60 }] });

  it('suggests adding load after enough comfortable sessions', () => {
    const s = suggestProgression({ exercise: 'Row', recentSessions: [easy(3), easy(2), easy(1)] });
    assert.equal(s.action, 'increase');
    assert.ok(s.load > 60, 'the suggested load should exceed the current one');
  });

  it('never suggests more work after a session at failure', () => {
    /* This is a safety guardrail, not a preference. A fatigue signal must not
       produce an instruction to add load. */
    const s = suggestProgression({
      exercise: 'Deadlift',
      recentSessions: [{ at: 1, sets: [{ reps: 3, targetReps: 5, rpe: 10, loadKg: 140 }] }],
    });
    assert.equal(s.action, 'hold');
    /* Assert on the number rather than on the prose. An earlier version of this
       test pattern-matched the word "add" and failed on the message "repeat the
       same load before adding any" — which is correct advice. What actually
       matters is that the prescribed load did not go up. */
    assert.equal(s.load, 140, 'the load must not increase after a set to failure');
    assert.notOk(s.action === 'increase' || s.action === 'increase-reps');
  });

  it('repeats the load when prescribed reps were missed', () => {
    const s = suggestProgression({
      exercise: 'Press',
      recentSessions: [{ at: 1, sets: [{ reps: 6, targetReps: 8, rpe: 8, loadKg: 40 }] }],
    });
    assert.equal(s.action, 'repeat');
  });

  it('asks for a baseline when there is no history', () => {
    assert.equal(suggestProgression({ exercise: 'X', recentSessions: [] }).action, 'baseline');
  });
});

describe('Heart-rate zones', ({ it }) => {
  it('uses Tanaka rather than 220 minus age by default', () => {
    assert.equal(maxHeartRate(40), 180);          // 208 - 0.7*40
    assert.equal(maxHeartRate(40, 'simple'), 180);
    assert.equal(maxHeartRate(25), 191);          // 208 - 17.5 -> 190.5 -> 191
  });

  it('places a heart rate in the right zone', () => {
    assert.equal(heartRateZone(160, 190).zone, 4);
    assert.equal(heartRateZone(120, 190).zone, 2);
    assert.equal(heartRateZone(185, 190).zone, 5);
  });

  it('reports below-zone rather than pretending zone 1', () => {
    assert.equal(heartRateZone(70, 190).zone, 0);
  });

  it('produces ascending, non-overlapping boundaries', () => {
    const b = zoneBoundaries(190);
    assert.equal(b.length, 5);
    for (let i = 1; i < b.length; i++) {
      assert.ok(b[i].fromBpm >= b[i - 1].fromBpm, 'zone floors must ascend');
    }
  });

  it('returns null without an age or max', () => {
    assert.isNull(maxHeartRate(0));
    assert.isNull(heartRateZone(150, 0));
  });
});

describe('Training load', ({ it }) => {
  const days = (n, load) => Array.from({ length: n }, (_, i) => ({
    dateKey: `2026-01-${String(i + 1).padStart(2, '0')}`, load,
  }));

  it('REGRESSION: stays silent below the minimum history', () => {
    /* A ratio computed from three days is noise. It must refuse, not round. */
    const r = trainingLoad(days(3, 100));
    assert.notOk(r.ready);
    assert.isNull(r.ratio ?? null);
    assert.ok(r.reason.includes('14'), 'should name the requirement');
  });

  it('computes a ratio once there is enough history', () => {
    const r = trainingLoad(days(30, 100));
    assert.ok(r.ready);
    assert.close(r.ratio, 1.0, 0.15, 'steady load should sit near a ratio of 1');
    assert.equal(r.status, 'steady');
  });

  it('flags a spike when recent load jumps', () => {
    const rows = [...days(23, 50), ...days(7, 400).map((d, i) => ({
      dateKey: `2026-02-${String(i + 1).padStart(2, '0')}`, load: 400,
    }))];
    const r = trainingLoad(rows);
    assert.ok(r.ready);
    assert.equal(r.status, 'spike');
    assert.ok(r.ratio > 1.5);
    assert.ok(/injury|easier/i.test(r.note), 'a spike should carry a caution');
  });

  it('flags detraining when load falls away', () => {
    const rows = [...days(23, 300), ...Array.from({ length: 7 }, (_, i) => ({
      dateKey: `2026-02-${String(i + 1).padStart(2, '0')}`, load: 10,
    }))];
    assert.equal(trainingLoad(rows).status, 'detraining');
  });

  it('is order-independent', () => {
    const forward = trainingLoad(days(20, 100));
    const shuffled = trainingLoad([...days(20, 100)].reverse());
    assert.close(shuffled.acute, forward.acute, 0.01, 'input order must not matter');
  });
});

describe('Set classification', ({ it }) => {
  it('maps rep ranges to a kind and a rest period', () => {
    assert.equal(setKind(3), 'strength');
    assert.equal(setKind(5), 'power');
    assert.equal(setKind(10), 'hypertrophy');
    assert.equal(setKind(20), 'endurance');
    assert.ok(restFor('strength') > restFor('hypertrophy'), 'heavy sets need longer rest');
  });
});

describe('Session load', ({ it }) => {
  it('uses duration times RPE when RPE is present', () => {
    assert.equal(sessionLoad({ minutes: 60, rpe: 7 }), 420);
  });

  it('falls back to heart-rate reserve without an RPE', () => {
    const l = sessionLoad({ minutes: 60, avgHr: 150, maxHr: 190, restingHr: 50 });
    assert.ok(l > 0, 'should produce a figure from heart rate alone');
  });

  it('returns null when neither is available', () => {
    assert.isNull(sessionLoad({ minutes: 60 }));
  });
});

/* =================================================================== GEO == */

describe('Distance', ({ it }) => {
  it('matches a known separation', () => {
    /* One degree of latitude is about 111 km anywhere on the globe. */
    assert.close(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 111195, 200);
  });

  it('is zero for the same point and symmetric between two', () => {
    const a = { lat: 13.08, lon: 80.27 }, b = { lat: 13.09, lon: 80.28 };
    assert.equal(haversine(a, a), 0);
    assert.close(haversine(a, b), haversine(b, a), 0.001);
  });

  it('computes a bearing', () => {
    assert.close(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1, 'due north');
    assert.close(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1, 'due east');
  });
});

describe('GPS filtering', ({ it }) => {
  it('rejects a fix that is too inaccurate to use', () => {
    const v = acceptPoint({ lat: 13, lon: 80, accuracy: 500, at: 1000 }, null);
    assert.notOk(v.accept);
    assert.equal(v.reason, 'accuracy');
  });

  it('REGRESSION: rejects an implausible jump rather than adding fake distance', () => {
    /* A tower handoff can teleport a fix hundreds of metres. Accepting it adds
       distance that was never run, and a whole route quietly measures long. */
    const prev = { lat: 13.0000, lon: 80.0000, at: 1000, accuracy: 5 };
    const jump = { lat: 13.0100, lon: 80.0000, at: 2000, accuracy: 5 };  // ~1.1 km in 1 s
    const v = acceptPoint(jump, prev);
    assert.notOk(v.accept);
    assert.equal(v.reason, 'speed');
  });

  it('drops sub-threshold movement so a stationary phone gains no distance', () => {
    const prev = { lat: 13.0, lon: 80.0, at: 1000, accuracy: 5 };
    const nudge = { lat: 13.000001, lon: 80.0, at: 3000, accuracy: 5 };
    const v = acceptPoint(nudge, prev);
    assert.notOk(v.accept);
    assert.equal(v.reason, 'stationary');
  });

  it('rejects coordinates outside the possible range', () => {
    assert.equal(acceptPoint({ lat: 200, lon: 0, at: 1 }, null).reason, 'out-of-range');
    assert.equal(acceptPoint({ lat: NaN, lon: 0, at: 1 }, null).reason, 'invalid');
  });

  it('accepts the first valid fix with zero distance', () => {
    const v = acceptPoint({ lat: 13, lon: 80, accuracy: 8, at: 1 }, null);
    assert.ok(v.accept);
    assert.equal(v.distance, 0);
  });

  it('reports what it discarded and why', () => {
    const raw = [
      { lat: 13.0000, lon: 80.0, at: 0, accuracy: 5 },
      { lat: 13.0010, lon: 80.0, at: 60000, accuracy: 5 },
      { lat: 13.0020, lon: 80.0, at: 120000, accuracy: 900 },   // accuracy
      { lat: 99, lon: 400, at: 130000 },                        // out of range
      { lat: 13.0030, lon: 80.0, at: 180000, accuracy: 5 },
    ];
    const r = processTrack(raw);
    assert.equal(r.rawCount, 5);
    assert.equal(r.keptCount, 3);
    assert.equal(r.rejected.accuracy, 1);
    assert.equal(r.rejected['out-of-range'], 1);
    assert.ok(r.distanceM > 0);
  });
});

describe('Smoothing', ({ it }) => {
  it('leaves very short tracks untouched', () => {
    const pts = [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }];
    assert.equal(smoothTrack(pts).length, 2);
  });

  it('pulls an outlier toward its neighbours', () => {
    const pts = [
      { lat: 13.000, lon: 80.0 },
      { lat: 13.050, lon: 80.0 },   // spike
      { lat: 13.002, lon: 80.0 },
    ];
    const smoothed = smoothTrack(pts, 0.35);
    assert.ok(smoothed[1].lat < 13.05, 'the spike should be damped');
    assert.ok(smoothed[1].lat > 13.0, 'but not erased entirely');
  });
});

describe('Elevation', ({ it }) => {
  it('REGRESSION: ignores jitter below the noise threshold', () => {
    /* Barometric noise of a metre either way, sampled hundreds of times, is
       what turns a flat park loop into 300 m of climb. */
    const flat = Array.from({ length: 100 }, (_, i) => ({
      lat: 13 + i * 0.0001, lon: 80, altitude: 10 + (i % 2 ? 0.4 : -0.4), at: i * 1000,
    }));
    const p = elevationProfile(flat);
    assert.equal(p.gainM, 0, 'sub-metre oscillation is not climbing');

    /* And a change of exactly the threshold IS committed — the rule is "ignore
       changes smaller than this", so 2 m counts. Pinning both sides stops a
       future tweak from silently turning the gate into a no-op. */
    const stepped = [
      { lat: 13, lon: 80, altitude: 10, at: 0 },
      { lat: 13.001, lon: 80, altitude: 12, at: 1000 },
    ];
    assert.equal(elevationProfile(stepped).gainM, 2);
  });

  it('accumulates a genuine climb', () => {
    const hill = [0, 10, 20, 30, 40].map((alt, i) => ({ lat: 13 + i * 0.001, lon: 80, altitude: alt, at: i * 1000 }));
    assert.equal(elevationProfile(hill).gainM, 40);
    assert.equal(elevationProfile(hill).lossM, 0);
  });

  it('reports null rather than zero when there is no altitude data', () => {
    const p = elevationProfile([{ lat: 13, lon: 80, at: 1 }, { lat: 13.1, lon: 80, at: 2 }]);
    assert.isNull(p.gainM, 'no data must not read as flat ground');
  });
});

describe('Splits and pace', ({ it }) => {
  /* A straight north line, one point every 100 m, at a steady 5:00 /km. */
  const track = Array.from({ length: 51 }, (_, i) => ({
    lat: 13 + (i * 100) / 111195, lon: 80, at: i * 30000, altitude: 10,
  }));

  it('marks a split each kilometre', () => {
    const s = splits(track, 1000);
    assert.ok(s.length >= 5, `expected at least 5 splits, got ${s.length}`);
    assert.close(s[0].distanceM, 1000, 30);
  });

  it('reports the trailing partial split rather than losing the distance', () => {
    const short = track.slice(0, 34);   // ~3.3 km
    const s = splits(short, 1000);
    const partial = s[s.length - 1];
    assert.ok(partial.partial, 'the final incomplete kilometre should be flagged');
    assert.ok(partial.distanceM < 1000);
  });

  it('computes pace and speed consistently', () => {
    assert.equal(paceSecPerKm(1000, 300), 300);
    assert.equal(speedKmh(1000, 360), 10);
    assert.isNull(paceSecPerKm(0, 300));
    assert.isNull(speedKmh(1000, 0));
  });

  it('separates moving time from stopped time', () => {
    const withStop = [
      { lat: 13.000, lon: 80, at: 0 },
      { lat: 13.001, lon: 80, at: 30000 },
      { lat: 13.001, lon: 80, at: 90000 },    // stationary for a minute
      { lat: 13.002, lon: 80, at: 120000 },
    ];
    const t = movingTime(withStop);
    assert.ok(t.stoppedS > 0, 'a stationary period should be detected');
    assert.ok(t.movingS < t.totalS);
  });

  it('does not count a long gap as either moving or stopped', () => {
    /* A phone that slept for an hour did not walk and did not rest. */
    const gap = [{ lat: 13, lon: 80, at: 0 }, { lat: 13.001, lon: 80, at: 3600000 }];
    const t = movingTime(gap);
    assert.equal(t.totalS, 0);
  });
});

describe('Cycling power', ({ it }) => {
  it('increases with speed and with gradient', () => {
    const flat = estimatePower({ speedMps: 8 }).watts;
    const faster = estimatePower({ speedMps: 10 }).watts;
    const uphill = estimatePower({ speedMps: 8, gradient: 0.05 }).watts;
    assert.ok(faster > flat);
    assert.ok(uphill > flat);
  });

  it('produces a plausible figure for a steady effort', () => {
    const w = estimatePower({ speedMps: 8.33 }).watts;   // 30 km/h
    assert.ok(w > 100 && w < 350, `expected a realistic wattage, got ${w}`);
  });

  it('carries its caveat rather than presenting itself as measured', () => {
    assert.ok(/estimate/i.test(estimatePower({ speedMps: 8 }).caveat));
  });

  it('applies the standard 95 percent rule for FTP', () => {
    assert.equal(ftpFrom20min(300), 285);
    assert.isNull(ftpFrom20min(0));
  });
});

describe('GPX', ({ it }) => {
  const points = [
    { lat: 13.0827, lon: 80.2707, altitude: 10, at: Date.parse('2026-01-01T06:00:00Z'), heartRate: 130 },
    { lat: 13.0837, lon: 80.2707, altitude: 14, at: Date.parse('2026-01-01T06:01:00Z'), heartRate: 142 },
    { lat: 13.0847, lon: 80.2707, altitude: 12, at: Date.parse('2026-01-01T06:02:00Z'), heartRate: 148 },
  ];

  it('round-trips through build and parse without losing coordinates', () => {
    const parsed = parseGpx(buildGpx({ name: 'Test', points }));
    assert.ok(parsed.ok);
    assert.equal(parsed.points.length, 3);
    assert.close(parsed.points[0].lat, 13.0827, 0.00001);
    assert.close(parsed.points[2].lon, 80.2707, 0.00001);
  });

  it('preserves altitude and timestamps', () => {
    const parsed = parseGpx(buildGpx({ name: 'Test', points }));
    assert.equal(parsed.points[1].altitude, 14);
    assert.ok(parsed.hasTime);
    assert.equal(parsed.points[0].at, points[0].at);
  });

  it('rejects a file with no track points, with a readable reason', () => {
    const r = parseGpx('<?xml version="1.0"?><gpx></gpx>');
    assert.notOk(r.ok);
    assert.ok(r.error.length > 0);
  });

  it('rejects non-GPX input rather than throwing', () => {
    assert.notOk(parseGpx('not xml at all').ok);
    assert.notOk(parseGpx(null).ok);
  });

  it('accepts a route with no timestamps but says what is missing', () => {
    const noTime = '<?xml version="1.0"?><gpx><trk><trkseg>' +
      '<trkpt lat="13.1" lon="80.2"><ele>5</ele></trkpt>' +
      '<trkpt lat="13.2" lon="80.2"><ele>6</ele></trkpt>' +
      '</trkseg></trk></gpx>';
    const r = parseGpx(noTime);
    assert.ok(r.ok, 'a route without times is still a valid route');
    assert.notOk(r.hasTime);
    assert.ok(r.warning, 'the limitation should be stated');
  });

  it('escapes special characters in a name', () => {
    const xml = buildGpx({ name: 'Run & <fun>', points });
    assert.ok(xml.includes('&amp;'), 'ampersand must be escaped');
    assert.notOk(xml.includes('<fun>'), 'raw angle brackets would break the XML');
  });
});

describe('Route projection', ({ it }) => {
  it('produces a path within the requested box', () => {
    const p = routePath([
      { lat: 13.00, lon: 80.00 }, { lat: 13.01, lon: 80.01 }, { lat: 13.02, lon: 80.00 },
    ], 320, 200);
    assert.ok(p != null);
    const coords = p.d.match(/[\d.]+/g).map(Number);
    assert.ok(coords.every((c) => c >= 0 && c <= 320), 'all coordinates inside the viewport');
  });

  it('returns null for a track too short to draw', () => {
    assert.isNull(routePath([{ lat: 13, lon: 80 }], 320, 200));
  });

  it('preserves aspect ratio rather than stretching to fill', () => {
    /* A long thin out-and-back must not be squashed into a square. */
    const thin = Array.from({ length: 10 }, (_, i) => ({ lat: 13 + i * 0.01, lon: 80 }));
    const p = routePath(thin, 320, 200);
    const xs = [], ys = [];
    p.d.replace(/([ML])([\d.]+) ([\d.]+)/g, (_, __, x, y) => { xs.push(+x); ys.push(+y); return ''; });
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    assert.ok(spanY > spanX, 'a north-south line should render taller than it is wide');
  });
});

/* ============================================================= NUTRITION == */

describe('Energy from macros', ({ it }) => {
  it('applies the standard Atwater factors', () => {
    assert.equal(energyFromMacros({ protein: 10, carbs: 10, fat: 10 }), 170);
  });

  it('REGRESSION: charges fibre at its own rate, not as carbohydrate', () => {
    /* Fibre sits inside the carbohydrate figure but is not metabolised at
       4 kcal/g. Counting it as ordinary carbohydrate made every high-fibre
       vegetable fail the sanity check on data that was perfectly correct. */
    const withFibre = energyFromMacros({ protein: 2.9, carbs: 3.6, fat: 0.4, fibre: 2.2 });
    const withoutSplit = 2.9 * 4 + 3.6 * 4 + 0.4 * 9;
    assert.ok(withFibre < withoutSplit, 'fibre must reduce the derived energy');
    assert.close(withFibre, 25, 1.5, 'raw spinach should reconcile near its real 23 kcal');
  });

  it('never lets fibre exceed the carbohydrate it belongs to', () => {
    const r = energyFromMacros({ carbs: 2, fibre: 10 });
    assert.ok(r >= 0 && r <= 8, 'over-stated fibre must not produce a negative figure');
  });
});

describe('Macro sanity', ({ it }) => {
  it('passes a food whose numbers agree', () => {
    assert.ok(macroSanity({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 }).ok);
  });

  it('flags a food whose macros contradict its calories', () => {
    const s = macroSanity({ kcal: 100, protein: 50, carbs: 50, fat: 50 });
    assert.notOk(s.ok);
    assert.ok(s.note.length > 0, 'should explain the likely cause');
  });

  it('spots a kJ/kcal mix-up specifically', () => {
    /* 1600 kJ is 382 kcal. A food stating 1600 with macros for 382 is the
       single most common error in crowd-sourced food data. */
    const s = macroSanity({ kcal: 1600, protein: 13, carbs: 60, fat: 8, fibre: 10 });
    assert.notOk(s.ok);
    assert.equal(s.suggestion, 'kj-to-kcal');
  });

  it('declines to judge when there is nothing to compare', () => {
    assert.notOk(macroSanity({ kcal: 200 }).checked);
    assert.ok(macroSanity({ kcal: 200 }).ok, 'unknown must not mean invalid');
  });

  it('REGRESSION: passes every seeded food', () => {
    /* The starter database must not ship anything the app would reject. */
    const failing = FOODS.filter((f) => {
      const s = macroSanity({
        kcal: f.kcal, protein: f.protein ?? 0, carbs: f.carbs ?? 0,
        fat: f.fat ?? 0, fibre: f.fibre ?? 0,
      });
      return s.checked && !s.ok;
    });
    assert.equal(failing.length, 0, `these seeded foods fail: ${failing.map((f) => f.name).join(', ')}`);
  });
});

describe('Food normalisation', ({ it }) => {
  it('rescales to a per-100g basis', () => {
    const f = normaliseFood({ name: 'X', basisG: 50, kcal: 100, protein: 10 });
    assert.equal(f.kcal, 200);
    assert.equal(f.protein, 20);
  });

  it('always provides at least one serving option', () => {
    assert.equal(normaliseFood({ name: 'X', kcal: 100 }).servings.length, 1);
  });

  it('discards malformed servings instead of storing them', () => {
    const f = normaliseFood({
      name: 'X', kcal: 100,
      servings: [{ label: 'good', grams: 30 }, { label: 'bad', grams: 0 }, { grams: 50 }],
    });
    assert.equal(f.servings.length, 1);
    assert.equal(f.servings[0].label, 'good');
  });

  it('strips whitespace from a barcode so scans and typing agree', () => {
    assert.equal(normaliseFood({ name: 'X', barcode: ' 123 456 ' }).barcode, '123456');
  });
});

describe('Open Food Facts mapping', ({ it }) => {
  it('converts kJ to kcal when only kJ is present', () => {
    const f = fromOpenFoodFacts({
      product_name: 'Oats', nutriments: { 'energy-kj_100g': 1600, proteins_100g: 13 },
    });
    assert.close(f.kcal, 382, 2);
  });

  it('prefers an explicit kcal field over kJ', () => {
    const f = fromOpenFoodFacts({
      product_name: 'X', nutriments: { 'energy-kcal_100g': 250, 'energy-kj_100g': 1600 },
    });
    assert.equal(f.kcal, 250);
  });

  it('converts sodium from grams to milligrams', () => {
    const f = fromOpenFoodFacts({ product_name: 'X', nutriments: { sodium_100g: 0.5 } });
    assert.equal(f.sodiumMg, 500);
  });

  it('extracts a numeric serving size from free text', () => {
    const f = fromOpenFoodFacts({
      product_name: 'X', serving_size: '40 g (1 sachet)',
      nutriments: { 'energy-kcal_100g': 300 },
    });
    assert.equal(f.servings[0].grams, 40);
  });

  it('survives a product with no nutriments at all', () => {
    const f = fromOpenFoodFacts({ product_name: 'Empty' });
    assert.equal(f.kcal, 0);
    assert.equal(f.name, 'Empty');
  });
});

describe('Portions', ({ it }) => {
  const food = { kcal: 400, protein: 20, carbs: 50, fat: 12, fibre: 6, unit: 'g',
                 servings: [{ label: '1 scoop', grams: 30 }] };

  it('scales linearly by grams', () => {
    const p = portion(food, { grams: 50 });
    assert.equal(p.kcal, 200);
    assert.equal(p.protein, 10);
  });

  it('resolves a named serving', () => {
    assert.equal(portion(food, { servingLabel: '1 scoop' }).grams, 30);
  });

  it('multiplies a named serving by a count', () => {
    assert.equal(portion(food, { servingLabel: '1 scoop', count: 3 }).grams, 90);
  });

  it('falls back to a default rather than returning nothing', () => {
    assert.equal(portion(food, {}).grams, 100);
  });

  it('sums a set of portions', () => {
    const t = sumNutrients([portion(food, { grams: 100 }), portion(food, { grams: 100 })]);
    assert.equal(t.kcal, 800);
    assert.equal(t.protein, 40);
  });

  it('ignores non-numeric junk when summing', () => {
    assert.equal(sumNutrients([{ kcal: 'abc' }, { kcal: 100 }, null, undefined]).kcal, 100);
  });
});

describe('Meal slots', ({ it }) => {
  it('assigns a time to the right slot', () => {
    assert.equal(mealForTime(new Date('2026-01-01T08:00:00')), 'breakfast');
    assert.equal(mealForTime(new Date('2026-01-01T13:00:00')), 'lunch');
    assert.equal(mealForTime(new Date('2026-01-01T19:00:00')), 'dinner');
  });

  it('handles the slot that wraps past midnight', () => {
    assert.equal(mealForTime(new Date('2026-01-01T23:30:00')), 'snack');
    assert.equal(mealForTime(new Date('2026-01-01T02:00:00')), 'snack');
  });

  it('groups entries into every slot, including empty ones', () => {
    const groups = groupByMeal([{ meal: 'lunch', kcal: 500 }]);
    assert.equal(groups.length, 4);
    assert.equal(groups.find((g) => g.key === 'lunch').totals.kcal, 500);
    assert.equal(groups.find((g) => g.key === 'breakfast').totals.kcal, 0);
  });

  it('puts an unrecognised slot somewhere rather than dropping the food', () => {
    const groups = groupByMeal([{ meal: 'brunch', kcal: 300 }]);
    assert.equal(groups.reduce((s, g) => s + g.totals.kcal, 0), 300);
  });
});

describe('Macro split', ({ it }) => {
  it('expresses macros as a share of energy', () => {
    const s = macroSplit({ protein: 150, carbs: 200, fat: 70 });
    assert.close(s.protein + s.carbs + s.fat, 100, 1.5);
    assert.ok(s.carbs > s.protein, '800 kcal of carbs beats 600 of protein');
  });

  it('returns null on an empty day rather than three zeros', () => {
    assert.isNull(macroSplit({ protein: 0, carbs: 0, fat: 0 }));
    assert.isNull(macroSplit(null));
  });
});

describe('Recipes', ({ it }) => {
  const foods = new Map([
    [1, { kcal: 400, protein: 20, carbs: 50, fat: 12, unit: 'g', servings: [] }],
    [2, { kcal: 100, protein: 5, carbs: 10, fat: 4, unit: 'g', servings: [] }],
  ]);

  it('sums ingredients and divides by yield', () => {
    const r = resolveRecipe({
      name: 'Test', servings: 2, foodsById: foods,
      items: [{ foodId: 1, grams: 100 }, { foodId: 2, grams: 100 }],
    });
    assert.equal(r.total.kcal, 500);
    assert.equal(r.perServing.kcal, 250);
  });

  it('reports missing ingredients instead of silently under-counting', () => {
    const r = resolveRecipe({
      name: 'Test', servings: 1, foodsById: foods,
      items: [{ foodId: 1, grams: 100 }, { foodId: 99, grams: 100 }],
    });
    assert.equal(r.missing, 1);
    assert.equal(r.itemCount, 1);
  });

  it('produces something loggable as an ordinary food', () => {
    const r = resolveRecipe({
      name: 'Test', servings: 4, foodsById: foods, items: [{ foodId: 1, grams: 200 }],
    });
    assert.ok(r.asFood != null);
    assert.close(r.asFood.kcal, 400, 5, 'per-100g energy should match the ingredient');
  });

  it('returns null when nothing resolves', () => {
    assert.isNull(resolveRecipe({ name: 'X', items: [{ foodId: 99 }], foodsById: foods }));
  });
});

describe('Target status', ({ it }) => {
  it('reports progress and what remains', () => {
    const s = targetStatus({ kcal: 1500, protein: 100 }, { calories: 2000, protein: 150 });
    assert.equal(s.protein.pct, 67);
    assert.equal(s.protein.remaining, 50);
  });

  it('flags going over', () => {
    assert.ok(targetStatus({ protein: 200 }, { protein: 150 }).protein.over);
  });

  it('distinguishes an unlogged day from a zero day', () => {
    assert.notOk(targetStatus({ kcal: 0 }, { calories: 2000 }).logged);
    assert.ok(targetStatus({ kcal: 10 }, { calories: 2000 }).logged);
  });
});

describe('Food search', ({ it }) => {
  const foods = [
    { name: 'Chicken breast, cooked', source: 'seed', verified: true },
    { name: 'Grilled chicken salad', source: 'seed' },
    { name: 'Rice, white', brand: 'Chicken Brand', source: 'seed' },
    { name: 'My chicken curry', source: 'manual' },
  ];

  it('ranks a prefix match above a mid-string one', () => {
    const r = searchFoods(foods, 'chicken');
    assert.ok(r[0].name.startsWith('Chicken'), `got ${r[0].name} first`);
  });

  it('ranks your own entries above a brand-only match', () => {
    const r = searchFoods(foods, 'chicken');
    const mine = r.findIndex((f) => f.source === 'manual');
    const brandOnly = r.findIndex((f) => f.brand === 'Chicken Brand');
    assert.ok(mine < brandOnly, 'your own foods should come first');
  });

  it('ignores a query below the minimum length', () => {
    assert.equal(searchFoods(foods, 'c').length, 0);
  });

  it('returns nothing rather than everything on no match', () => {
    assert.equal(searchFoods(foods, 'zzzzz').length, 0);
  });
});

/* ============================================================== RECOVERY == */

describe('Baselines', ({ it }) => {
  it('refuses to establish a baseline from too few samples', () => {
    assert.notOk(baseline([50, 52]).ready);
  });

  it('computes a mean and spread once there is enough', () => {
    const b = baseline(Array.from({ length: 14 }, () => 52));
    assert.ok(b.ready);
    assert.equal(b.mean, 52);
    assert.equal(b.sd, 0);
  });

  it('ignores non-numeric entries without counting them toward the minimum', () => {
    /* Nine entries, but only seven are real numbers — exactly the minimum. If the
       junk were being coerced to zero (the bug this guards against) the mean
       would collapse toward zero instead of sitting near 52. */
    const b = baseline([52, null, 'x', 54, undefined, 53, 52, 51, 53, 52]);
    assert.ok(b.ready, 'seven valid readings should be enough');
    assert.close(b.mean, 52.4, 1);
  });

  it('does not reach readiness on junk padded out to length', () => {
    const b = baseline([52, null, null, null, undefined, '', 'x', 53, 51]);
    assert.notOk(b.ready, 'four real readings is not a baseline');
  });
});

describe('Sleep scoring', ({ it }) => {
  it('scores a full night near the top', () => {
    assert.ok(sleepScore(450) >= 0.95);
  });

  it('penalises a short night', () => {
    assert.ok(sleepScore(240) < sleepScore(450));
  });

  it('does not reward oversleeping as though more is always better', () => {
    assert.ok(sleepScore(720) < sleepScore(450));
  });

  it('returns null for no data rather than zero', () => {
    assert.isNull(sleepScore(null));
    assert.isNull(sleepScore(0));
  });
});

describe('Sleep analysis', ({ it }) => {
  it('describes consistency as well as duration', () => {
    const steady = analyseSleep([420, 425, 415, 430].map((m, i) => ({ dateKey: `d${i}`, minutes: m })));
    const erratic = analyseSleep([300, 540, 360, 600].map((m, i) => ({ dateKey: `d${i}`, minutes: m })));
    assert.ok(steady.ready);
    assert.equal(steady.consistency, 'very consistent');
    assert.equal(erratic.consistency, 'highly variable');
  });

  it('accumulates a shortfall against the reference', () => {
    const a = analyseSleep([{ dateKey: 'a', minutes: 360 }, { dateKey: 'b', minutes: 360 }]);
    assert.equal(a.debtMinutes, 180);
  });

  it('says so when there is nothing logged', () => {
    assert.notOk(analyseSleep([]).ready);
  });

  it('carries a note that this is logged, not measured', () => {
    const a = analyseSleep([{ dateKey: 'a', minutes: 420 }]);
    assert.ok(/logged|not a clinical/i.test(a.note ?? ''));
  });
});

describe('Readiness', ({ it }) => {
  const history = {
    restingHr: Array.from({ length: 20 }, () => 52),
    hrv: Array.from({ length: 20 }, () => 60),
  };

  it('REGRESSION: refuses a score from a single input', () => {
    /* The original bug: Number(null) is 0 and 0 is finite, so absent soreness
       and mood arrived as present readings of zero, soreness scored as perfect,
       and readiness returned a confident number built from one real input. */
    const r = readiness({ sleepMinutes: 420 });
    assert.notOk(r.ready);
    assert.equal(r.inputCount, 1);
    assert.isNull(r.score);
  });

  it('REGRESSION: still refuses at two inputs', () => {
    const r = readiness({ sleepMinutes: 420, mood: 4 });
    assert.notOk(r.ready);
    assert.equal(r.inputCount, 2);
  });

  it('scores once the minimum is met', () => {
    const r = readiness({ sleepMinutes: 450, mood: 4, soreness: 2 });
    assert.ok(r.ready);
    assert.ok(r.score > 0 && r.score <= 100);
    assert.ok(r.band.length > 0);
  });

  it('REGRESSION: treats an explicit zero as a real reading', () => {
    /* The fix must not swing the other way: soreness: 0 is data, not absence. */
    const r = readiness({ sleepMinutes: 420, mood: 4, soreness: 0 });
    assert.equal(r.inputCount, 3);
    assert.ok(r.ready);
  });

  it('names what is missing so the refusal is actionable', () => {
    const r = readiness({ sleepMinutes: 420 });
    assert.ok(r.missing.length > 0);
    assert.ok(r.missing.every((m) => m.label && m.key));
  });

  it('scores a good day above a bad one', () => {
    const good = readiness({ sleepMinutes: 460, restingHr: 49, hrv: 66, mood: 5, soreness: 1, loadRatio: 1.0, history });
    const bad = readiness({ sleepMinutes: 280, restingHr: 62, hrv: 44, mood: 2, soreness: 5, loadRatio: 1.9, history });
    assert.ok(good.score > bad.score, `${good.score} should exceed ${bad.score}`);
  });

  it('NEVER encourages harder training, even at peak readiness', () => {
    /* A safety guardrail, asserted rather than documented. */
    const r = readiness({ sleepMinutes: 480, restingHr: 46, hrv: 75, mood: 5, soreness: 1, loadRatio: 0.9, history });
    assert.ok(r.ready);
    assert.notOk(/harder|push|more load|increase intensity/i.test(r.guidance ?? ''),
      `guidance must not escalate: "${r.guidance}"`);
  });

  it('advises backing off when signals are poor', () => {
    const r = readiness({ sleepMinutes: 240, restingHr: 65, hrv: 40, mood: 1, soreness: 5, loadRatio: 2.0, history });
    assert.ok(/rest|back|moderate/i.test(r.guidance ?? ''));
  });

  it('states that it is not a medical assessment', () => {
    const r = readiness({ sleepMinutes: 450, mood: 4, soreness: 2 });
    assert.ok(/not a medical/i.test(r.caveat));
  });

  it('handles a resting heart rate with no baseline yet', () => {
    const r = readiness({ sleepMinutes: 450, restingHr: 52, mood: 4, soreness: 2 });
    /* Without history, the heart-rate input contributes nothing and is not
       counted — but the other three still produce a score. */
    assert.ok(r.ready);
    assert.notOk(r.inputs.some((i) => i.key === 'restingHr'),
      'an unbaselined reading should not be scored');
  });
});

describe('Recovery summary', ({ it }) => {
  it('returns null when there is nothing to say', () => {
    assert.isNull(recoverySummary({ readinessResult: { ready: false }, loadResult: { ready: false } }));
  });

  it('raises a concern on a load spike', () => {
    const s = recoverySummary({
      readinessResult: { ready: true, score: 70, band: 'Ready' },
      loadResult: { ready: true, status: 'spike', note: 'Load is up sharply.' },
    });
    assert.ok(s.concern);
    assert.equal(s.tone, 'alert');
  });
});

describe('Correlation', ({ it }) => {
  const keys = Array.from({ length: 20 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

  it('finds a strong relationship in matched data', () => {
    const a = keys.map((k, i) => ({ dateKey: k, value: 400 + i * 5 }));
    const b = keys.map((k, i) => ({ dateKey: k, value: 50 + i * 2 }));
    const r = correlate(a, b);
    assert.ok(r.ready);
    assert.close(r.r, 1, 0.01);
    assert.equal(r.strength, 'strong');
  });

  it('detects an inverse relationship', () => {
    const a = keys.map((k, i) => ({ dateKey: k, value: i }));
    const b = keys.map((k, i) => ({ dateKey: k, value: 100 - i }));
    assert.equal(correlate(a, b).direction, 'negative');
  });

  it('refuses below the minimum overlapping days', () => {
    const a = keys.slice(0, 5).map((k, i) => ({ dateKey: k, value: i }));
    const b = keys.slice(0, 5).map((k, i) => ({ dateKey: k, value: i }));
    assert.notOk(correlate(a, b).ready);
  });

  it('only pairs days present in both series', () => {
    const a = keys.map((k, i) => ({ dateKey: k, value: i }));
    const b = keys.slice(0, 8).map((k, i) => ({ dateKey: k, value: i }));
    assert.notOk(correlate(a, b).ready, '8 overlapping days is below the threshold');
  });

  it('refuses when one series never varies', () => {
    const a = keys.map((k, i) => ({ dateKey: k, value: i }));
    const b = keys.map((k) => ({ dateKey: k, value: 5 }));
    assert.notOk(correlate(a, b).ready);
  });

  it('always carries the causation caveat', () => {
    const a = keys.map((k, i) => ({ dateKey: k, value: i }));
    const b = keys.map((k, i) => ({ dateKey: k, value: i * 2 }));
    assert.ok(/not cause/i.test(correlate(a, b).caveat));
  });
});

/* ================================================================ SEEDS == */

describe('Seed data integrity', ({ it }) => {
  it('has no duplicate exercise or food names', () => {
    const exNames = EXERCISES.map((e) => e.name);
    const foodNames = FOODS.map((f) => f.name);
    assert.equal(new Set(exNames).size, exNames.length, 'duplicate exercise names');
    assert.equal(new Set(foodNames).size, foodNames.length, 'duplicate food names');
  });

  it('gives every exercise the fields the library UI filters on', () => {
    const bad = EXERCISES.filter((e) =>
      !e.name || !e.category || !e.pattern ||
      !Array.isArray(e.primaryMuscles) || !Array.isArray(e.equipment));
    assert.equal(bad.length, 0, `malformed: ${bad.map((e) => e.name).join(', ')}`);
  });

  it('REGRESSION: every programme exercise exists in the library', () => {
    /* Couch to 10K referenced a "Run" movement that was not in the library, so
       its only exercise could not resolve and the programme was unusable. */
    const names = new Set(EXERCISES.map((e) => e.name));
    const missing = new Set();
    for (const p of PROGRAMS) {
      for (const d of p.days) {
        for (const item of d.items) if (!names.has(item.exercise)) missing.add(item.exercise);
      }
    }
    assert.equal(missing.size, 0, `unresolved: ${[...missing].join(', ')}`);
  });

  it('gives every food a positive energy value', () => {
    assert.equal(FOODS.filter((f) => !(f.kcal >= 0)).length, 0);
  });
});

/* =============================================================== IMPORT == */

describe('CSV parsing', ({ it }) => {
  it('preserves a comma inside a quoted field', () => {
    const r = parseCsv('a,b\n"one, two",3\n');
    assert.equal(r.rows[0].a, 'one, two');
    assert.equal(r.rows[0].b, '3');
  });

  it('handles escaped double quotes', () => {
    assert.equal(parseCsv('a\n"say ""hi"""\n').rows[0].a, 'say "hi"');
  });

  it('skips blank lines', () => {
    assert.equal(parseCsv('a,b\n1,2\n\n\n').rows.length, 1);
  });

  it('returns empty structures for empty input rather than throwing', () => {
    assert.equal(parseCsv('').rows.length, 0);
  });
});

describe('Health date parsing', ({ it }) => {
  it('REGRESSION: parses Apple\u2019s non-ISO format', () => {
    /* V8 accepts "2026-01-05 07:12:00 +0530"; Safari returns NaN for it, which
       would have discarded every record on the very device the export came
       from. The string is normalised to ISO before parsing. */
    const t = parseHealthDate('2026-01-05 07:12:00 +0530');
    assert.ok(Number.isFinite(t));
    assert.equal(new Date(t).toISOString(), '2026-01-05T01:42:00.000Z');
  });

  it('handles a negative offset', () => {
    const t = parseHealthDate('2026-01-05 07:12:00 -0800');
    assert.equal(new Date(t).toISOString(), '2026-01-05T15:12:00.000Z');
  });

  it('handles a missing seconds component', () => {
    assert.ok(Number.isFinite(parseHealthDate('2026-01-05 07:12 +0530')));
  });

  it('still accepts plain ISO', () => {
    assert.ok(Number.isFinite(parseHealthDate('2026-01-05T07:12:00+05:30')));
  });

  it('returns NaN for unparseable input instead of a wrong date', () => {
    assert.ok(Number.isNaN(parseHealthDate('not a date')));
    assert.ok(Number.isNaN(parseHealthDate(null)));
  });
});
