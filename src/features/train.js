/* Training screen: an active session, the exercise library, and history.
 *
 * The core design decision is that a session is a *live* database record, not
 * a form you fill in and submit. Sets are written the moment they happen. If
 * the phone dies mid-workout, or the browser evicts the tab, or you switch apps
 * to answer a message and iOS discards the page, the sets you already did are
 * already saved. A "save workout" button at the end would lose the whole
 * session to any of those, which on a phone are not edge cases.
 */

import { el, card, fmt, tint, colourVar, emptyState, sheet, field, toast, clear, roadmapCard } from '../core/ui.js';
import { db, getSetting, setSetting } from '../db/database.js';
import { Workouts, WorkoutSets, Exercises, PRs, Logs, dateKeyOf } from '../db/repos.js';
import { oneRepMaxRange, volumeLoad, detectPRs, suggestProgression,
         sessionLoad, setKind, restFor } from '../engines/training.js';
import { FEATURES, TRAINING, enabled } from '../config/app.config.js';
import { refresh } from '../core/router.js';

const ACTIVE_KEY = 'training.activeWorkoutId';

/* --------------------------------------------------------------- session -- */

async function activeWorkout() {
  const id = await getSetting(ACTIVE_KEY, null);
  if (id == null) return null;
  const w = await db().workouts.get(id);
  /* A stale pointer — the workout was deleted, or this is a fresh restore.
     Clear it rather than rendering a broken session. */
  if (!w || w.deletedAt || w.endedAt) { await setSetting(ACTIVE_KEY, null); return null; }
  return w;
}

async function startWorkout(mode = 'free', programId = null) {
  const at = Date.now();
  const created = await Workouts.create({ at, dateKey: dateKeyOf(at), mode, programId, startedAt: at });
  const id = created.id ?? created;
  await setSetting(ACTIVE_KEY, id);
  return id;
}

async function finishWorkout(id) {
  const sets = await db().workoutSets.where('workoutId').equals(id).toArray();
  const workout = await db().workouts.get(id);
  const endedAt = Date.now();
  const minutes = workout?.startedAt ? Math.round((endedAt - workout.startedAt) / 60000) : null;

  const rpes = sets.map((s) => Number(s.rpe)).filter((n) => n > 0);
  const avgRpe = rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null;
  const load = sessionLoad({ minutes, rpe: avgRpe });

  await db().workouts.update(id, {
    endedAt, minutes,
    setCount: sets.length,
    volumeLoad: volumeLoad(sets),
    avgRpe: avgRpe != null ? Math.round(avgRpe * 10) / 10 : null,
    load,
  });
  await setSetting(ACTIVE_KEY, null);

  /* Training load is stored per day so the model does not have to re-derive it
     from every set on every read. */
  if (load != null) {
    const dateKey = workout?.dateKey ?? dateKeyOf(endedAt);
    const existing = await db().trainingLoad.where('dateKey').equals(dateKey).first();
    await db().trainingLoad.put({
      ...(existing ?? {}), dateKey,
      load: (existing?.load ?? 0) + load,
      sessions: (existing?.sessions ?? 0) + 1,
    });
  }

  /* Same universal-feed copy pattern as Nutrition — one summary log so the
     session shows up on NoMeh/streak/Analytics without duplicating every
     individual set. Totals are back-computed from the real sets so
     sets × reps × loadKg reproduces the actual volume, not an approximation. */
  if (sets.length > 0) {
    const totalReps = sets.reduce((sum, s) => sum + (Number(s.reps) || 0), 0);
    const totalVolumeKg = volumeLoad(sets);
    const avgReps = totalReps / sets.length;
    const avgLoadKg = totalReps > 0 ? totalVolumeKg / totalReps : 0;
    const dateKey = workout?.dateKey ?? dateKeyOf(endedAt);
    await Logs.create({
      type: 'exercise', exercise: 'Workout', sets: sets.length, reps: avgReps, loadKg: avgLoadKg,
      dateKey, at: endedAt,
    });
  }

  return { sets, minutes, load };
}

/* ------------------------------------------------------------ rest timer -- */

/* Deliberately not a background timer. A setTimeout in a page the OS may
   suspend is unreliable, so the remaining time is computed from a stored
   deadline on every tick — which means it stays correct across a screen lock
   even though the interval itself stopped running. */
function restTimer(seconds, onDone) {
  /* Mutable so the +30s button can extend it. Recomputing remaining time from
     this deadline on every tick is what keeps the timer honest across a screen
     lock, when the interval itself stops firing. */
  let deadline = Date.now() + seconds * 1000;
  let total = seconds;
  const label = el('strong', { class: 'timer-value' }, '');
  const bar = el('div', { class: 'timer-bar' }, el('i', {}));
  let handle = null;

  const tick = () => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    label.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const fill = bar.firstChild;
    if (fill) fill.style.width = `${Math.max(0, (left / total) * 100)}%`;
    if (left <= 0) {
      clearInterval(handle); handle = null;
      label.textContent = 'Rest done';
      if (navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch { /* ignore */ } }
      onDone?.();
    }
  };

  handle = setInterval(tick, 250);
  tick();

  const node = el('div', { class: 'timer', style: tint('recovery') },
    el('div', { class: 'timer-row' },
      el('span', { class: 'muted-sm' }, 'Rest'), label,
      el('button', { class: 'btn btn-ghost btn-xs', onclick: () => { if (handle) clearInterval(handle); node.remove(); } }, 'Skip'),
      el('button', {
        class: 'btn btn-ghost btn-xs',
        onclick: () => {
          /* Extend by moving the deadline rather than restarting the interval,
             so the countdown never jumps. */
          deadline += 30000;
          total += 30;
          if (!handle) { handle = setInterval(tick, 250); }
          tick();
        },
      }, '+30s'),
    ), bar);

  node.stop = () => { if (handle) clearInterval(handle); handle = null; };
  return node;
}

/* --------------------------------------------------------- set entry ------ */

function openSetEntry({ workoutId, exercise, lastSet, onLogged }) {
  const isTime = exercise.metric === 'time';
  const isDistance = exercise.metric === 'distance';

  const reps = el('input', {
    class: 'input', type: 'number', min: '0', inputmode: 'numeric',
    value: lastSet?.reps != null ? String(lastSet.reps) : '',
    placeholder: isTime ? 'seconds' : isDistance ? 'metres' : 'reps',
  });
  const load = el('input', {
    class: 'input', type: 'number', min: '0', step: '0.5', inputmode: 'decimal',
    value: lastSet?.loadKg != null ? String(lastSet.loadKg) : '',
    placeholder: 'kg (leave blank for bodyweight)',
  });
  const rpe = el('input', { class: 'input', type: 'number', min: '1', max: '10', step: '0.5', placeholder: '1–10' });
  const estimate = el('p', { class: 'muted-sm' });

  const draw = () => {
    const r = Number(reps.value), w = Number(load.value);
    if (isTime || isDistance || !(r > 0) || !(w > 0)) { estimate.textContent = ''; return; }
    const range = oneRepMaxRange(w, r);
    estimate.textContent = range
      ? `Estimated 1RM ${range.chosen} kg (formulas span ${range.low}–${range.high})`
      : `Too many reps for a reliable 1RM estimate (over ${TRAINING.oneRmMaxReps}).`;
  };
  reps.oninput = draw; load.oninput = draw;
  draw();

  sheet({
    title: exercise.name,
    body: el('div', {},
      lastSet ? el('p', { class: 'muted-sm' },
        `Last: ${lastSet.reps ?? '—'}${lastSet.loadKg ? ` × ${lastSet.loadKg} kg` : ''}` +
        `${lastSet.rpe ? ` @ RPE ${lastSet.rpe}` : ''}`) : null,
      field(isTime ? 'Duration' : isDistance ? 'Distance' : 'Reps', reps),
      !isTime && !isDistance ? field('Load', load, 'kilograms') : null,
      field('RPE', rpe, 'How hard it felt, 1–10. Optional but it drives progression.'),
      estimate,
    ),
    confirmLabel: 'Log set',
    onConfirm: async () => {
      const r = Number(reps.value);
      if (!(r > 0)) { toast('Enter a value.'); return false; }
      const at = Date.now();
      await WorkoutSets.create({
        workoutId, exerciseId: exercise.id, exerciseName: exercise.name,
        reps: r,
        loadKg: Number(load.value) || 0,
        rpe: Number(rpe.value) || null,
        metric: exercise.metric ?? 'reps',
        at,
      });
      onLogged({ reps: r, loadKg: Number(load.value) || 0, rpe: Number(rpe.value) || null });
      return true;
    },
  });
}

/* --------------------------------------------------- active session view -- */

async function activeSessionCard(workout) {
  const sets = await db().workoutSets.where('workoutId').equals(workout.id).sortBy('at');
  const byExercise = new Map();
  for (const s of sets) {
    if (!byExercise.has(s.exerciseId)) byExercise.set(s.exerciseId, { name: s.exerciseName, sets: [] });
    byExercise.get(s.exerciseId).sets.push(s);
  }

  const timerHost = el('div', {});
  const elapsed = workout.startedAt ? Math.round((Date.now() - workout.startedAt) / 60000) : 0;

  const groups = [...byExercise.entries()].map(([exerciseId, g]) =>
    el('div', { class: 'exercise-block' },
      el('div', { class: 'exercise-head' },
        el('strong', {}, g.name),
        el('span', { class: 'muted-sm spacer' },
          `${g.sets.length} set${g.sets.length === 1 ? '' : 's'} · ${volumeLoad(g.sets)} kg volume`),
      ),
      el('div', { class: 'set-row' }, ...g.sets.map((s, i) =>
        el('span', {
          class: 'set-pill',
          title: `Set ${i + 1}${s.rpe ? ` · RPE ${s.rpe}` : ''}`,
        }, s.loadKg ? `${s.reps}×${s.loadKg}` : `${s.reps}`),
      )),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: async () => {
          const ex = await db().exercises.get(exerciseId);
          if (ex) addSet(ex, g.sets[g.sets.length - 1]);
        },
      }, '+ Another set'),
    ));

  function addSet(exercise, lastSet) {
    openSetEntry({
      workoutId: workout.id, exercise, lastSet,
      onLogged: (logged) => {
        const secs = restFor(setKind(logged.reps));
        clear(timerHost).append(restTimer(secs, () => toast('Rest complete.', { tone: 'cyan' })));
        refresh();
      },
    });
  }

  return card('Session in progress', {
    note: `${elapsed} min · ${sets.length} sets`,
    actions: el('button', {
      class: 'btn btn-sm btn-primary',
      onclick: async () => {
        const { sets: finalSets, minutes, load } = await finishWorkout(workout.id);
        const prs = await recordPRs(finalSets);
        toast(prs.length
          ? `Session saved. ${prs.length} personal record${prs.length === 1 ? '' : 's'}.`
          : `Session saved${minutes ? ` · ${minutes} min` : ''}${load ? ` · load ${load}` : ''}.`,
          { tone: prs.length ? 'emerald' : 'cyan' });
        refresh();
      },
    }, 'Finish'),
  },
    timerHost,
    groups.length ? el('div', {}, ...groups) : el('p', { class: 'muted-sm' }, 'No sets yet. Pick an exercise below.'),
    el('button', {
      class: 'btn btn-primary',
      onclick: () => openExercisePicker((ex) => addSet(ex, null)),
    }, '+ Add exercise'),
  );
}

/* ------------------------------------------------------------------- PRs -- */

async function recordPRs(sets) {
  const byExercise = new Map();
  for (const s of sets) {
    if (!byExercise.has(s.exerciseName)) byExercise.set(s.exerciseName, []);
    byExercise.get(s.exerciseName).push(s);
  }

  const recorded = [];
  for (const [exercise, exSets] of byExercise) {
    const history = await db().prs.filter((p) => p.exercise === exercise).toArray();
    const found = detectPRs({ exercise, sets: exSets, history });
    for (const pr of found) {
      await PRs.create({ ...pr, at: Date.now() });
      recorded.push(pr);
    }
  }
  return recorded;
}

/* -------------------------------------------------------- exercise picker -- */

export function openExercisePicker(onPick) {
  const search = el('input', { class: 'input', type: 'search', placeholder: 'Search exercises…' });
  const filters = el('div', { class: 'chip-row' });
  const list = el('div', { class: 'result-list' });
  let category = null;

  const CATEGORIES = ['push', 'pull', 'squat', 'hinge', 'core', 'carry', 'cardio', 'mobility'];

  const draw = async () => {
    const q = search.value.trim().toLowerCase();
    let rows = await db().exercises.filter((e) => !e.deletedAt).toArray();
    if (category) rows = rows.filter((e) => e.category === category);
    if (q) rows = rows.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.primaryMuscles ?? []).some((m) => m.toLowerCase().includes(q)) ||
      (e.tags ?? []).some((t) => t.toLowerCase().includes(q)));

    rows.sort((a, b) => a.name.localeCompare(b.name));
    clear(list);
    if (!rows.length) {
      list.append(el('p', { class: 'muted-sm' }, 'No matches.'),
        el('button', { class: 'btn btn-sm', onclick: () => openCustomExercise(onPick) }, 'Create it'));
      return;
    }
    for (const ex of rows.slice(0, 80)) {
      list.append(el('button', { class: 'result-row', onclick: () => { ref.close(); onPick(ex); } },
        el('div', {},
          el('span', { class: 'entry-label' }, ex.name),
          el('span', { class: 'muted-sm' },
            [(ex.primaryMuscles ?? []).slice(0, 3).join(', '), (ex.equipment ?? []).join('/')]
              .filter(Boolean).join(' · ')),
        ),
        ex.tags?.includes('advanced') ? el('span', { class: 'chip chip-xs' }, 'advanced') : null,
      ));
    }
  };

  for (const c of CATEGORIES) {
    filters.append(el('button', {
      class: 'chip chip-btn',
      onclick: (e) => {
        category = category === c ? null : c;
        [...filters.children].forEach((n) => n.dataset.on = 'false');
        if (category) e.currentTarget.dataset.on = 'true';
        draw();
      },
    }, c));
  }

  let deb = null;
  search.oninput = () => { clearTimeout(deb); deb = setTimeout(draw, 180); };

  const ref = sheet({
    title: 'Choose an exercise',
    body: el('div', {}, search, filters, list),
  });
  draw();
  return ref;
}

function openCustomExercise(onPick) {
  const name = el('input', { class: 'input' });
  const category = el('select', { class: 'input' },
    ...['push', 'pull', 'squat', 'hinge', 'core', 'carry', 'cardio', 'mobility']
      .map((c) => el('option', { value: c }, c)));
  const metric = el('select', { class: 'input' },
    el('option', { value: 'reps' }, 'Reps'),
    el('option', { value: 'time' }, 'Time'),
    el('option', { value: 'distance' }, 'Distance'));

  sheet({
    title: 'New exercise',
    body: el('div', {}, field('Name', name), field('Category', category), field('Measured in', metric)),
    confirmLabel: 'Create',
    onConfirm: async () => {
      if (!name.value.trim()) { toast('Give it a name.'); return false; }
      const created = await Exercises.create({
        name: name.value.trim(), category: category.value, pattern: category.value,
        primaryMuscles: [], equipment: [], tags: [], metric: metric.value,
        unilateral: false, source: 'manual',
      });
      const ex = { ...created, id: created.id ?? created };
      onPick(ex);
      return true;
    },
  });
}

/* -------------------------------------------------------------- history -- */

async function historyCard() {
  const workouts = await db().workouts
    .orderBy('at').reverse()
    .filter((w) => !w.deletedAt && w.endedAt)
    .limit(10).toArray();

  if (!workouts.length) {
    return card('History', {}, el('p', { class: 'muted-sm' }, 'No completed sessions yet.'));
  }

  return card('Recent sessions', { note: `${workouts.length} shown` },
    ...workouts.map((w) => el('div', { class: 'entry' },
      el('div', { class: 'entry-main' },
        el('span', { class: 'entry-label' }, fmt.dayLabel(w.dateKey)),
        el('span', { class: 'muted-sm' },
          [
            w.setCount ? `${w.setCount} sets` : null,
            w.minutes ? `${w.minutes} min` : null,
            w.volumeLoad ? `${fmt.int(w.volumeLoad)} kg volume` : null,
            w.avgRpe ? `RPE ${w.avgRpe}` : null,
          ].filter(Boolean).join(' · ')),
      ),
      el('button', {
        class: 'btn btn-ghost btn-xs',
        onclick: () => openSessionDetail(w),
      }, 'View'),
    )),
  );
}

async function openSessionDetail(workout) {
  const sets = await db().workoutSets.where('workoutId').equals(workout.id).sortBy('at');
  const byExercise = new Map();
  for (const s of sets) {
    if (!byExercise.has(s.exerciseName)) byExercise.set(s.exerciseName, []);
    byExercise.get(s.exerciseName).push(s);
  }

  sheet({
    title: fmt.dayLabel(workout.dateKey),
    body: el('div', {},
      el('p', { class: 'muted-sm' },
        [`${sets.length} sets`, workout.minutes ? `${workout.minutes} min` : null,
         workout.load ? `load ${workout.load}` : null].filter(Boolean).join(' · ')),
      ...[...byExercise.entries()].map(([name, exSets]) => el('div', { class: 'exercise-block' },
        el('strong', {}, name),
        el('div', { class: 'set-row' }, ...exSets.map((s) =>
          el('span', { class: 'set-pill' }, s.loadKg ? `${s.reps}×${s.loadKg}` : `${s.reps}`))),
        el('span', { class: 'muted-sm' }, `${volumeLoad(exSets)} kg volume`),
      )),
    ),
    footer: el('button', {
      class: 'btn btn-danger btn-sm',
      onclick: async () => {
        await Workouts.remove(workout.id);
        toast('Session deleted.', { action: { label: 'Undo', fn: async () => { await Workouts.restore(workout.id); refresh(); } } });
        refresh();
      },
    }, 'Delete session'),
  });
}

/* ------------------------------------------------------------ next-up ----- */

async function progressionCard() {
  /* Look at the most-trained exercises and suggest a next step for each. Three
     is the limit on purpose: a screen of twelve suggestions is a screen nobody
     reads. */
  const recent = await db().workoutSets.orderBy('at').reverse().limit(200).toArray();
  if (!recent.length) return null;

  const counts = new Map();
  for (const s of recent) counts.set(s.exerciseName, (counts.get(s.exerciseName) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const rows = [];
  for (const [name] of top) {
    const sets = recent.filter((s) => s.exerciseName === name);
    const byWorkout = new Map();
    for (const s of sets) {
      if (!byWorkout.has(s.workoutId)) byWorkout.set(s.workoutId, { at: s.at, sets: [] });
      byWorkout.get(s.workoutId).sets.push(s);
    }
    const sessions = [...byWorkout.values()];
    const ex = await db().exercises.filter((e) => e.name === name).first();
    const bodyPart = ['squat', 'hinge'].includes(ex?.category) ? 'lower' : 'upper';
    const s = suggestProgression({ exercise: name, recentSessions: sessions, bodyPart });

    rows.push(el('div', { class: 'entry' },
      el('div', { class: 'entry-main' },
        el('span', { class: 'entry-label' }, name),
        el('span', { class: 'muted-sm' }, s.message),
      ),
      s.load ? el('span', {
        class: 'entry-value',
        style: { color: colourVar(s.action === 'increase' ? 'performance' : s.action === 'hold' ? 'alert' : 'strength') },
      }, `${s.load} kg`) : null,
    ));
  }

  return rows.length ? card('Next session', { note: 'Suggestions, not instructions' }, ...rows) : null;
}

/* ----------------------------------------------------------------- view --- */

/* Workout and Outdoor share this tab now (runs/rides are movement same as
   lifting is) — this is the link across to the full GPS/endurance screen,
   which still exists on its own route and keeps all of its functionality. */
function outdoorPeek() {
  if (!enabled('endurance')) return null;
  return el('a', { class: 'chip-row', href: '#/endurance', style: { textDecoration: 'none' } },
    el('span', { class: 'chip chip-btn' }, 'Runs & rides →'));
}

export async function trainView() {
  if (!FEATURES.strength) {
    return card('Training is switched off', {},
      el('p', { class: 'muted-sm' },
        'FEATURES.strength is false in src/config/app.config.js. Set it to true to use this screen.'));
  }

  const active = await activeWorkout();
  const exerciseCount = await db().exercises.filter((e) => !e.deletedAt).count();

  if (active) {
    return el('div', { class: 'stack' },
      outdoorPeek(),
      await activeSessionCard(active),
      await historyCard(),
      workoutRoadmap(),
    );
  }

  const programs = await db().programs.filter((p) => !p.deletedAt).toArray();

  return el('div', { class: 'stack' },
    outdoorPeek(),
    card('Start training', { note: `${exerciseCount} exercises in your library` },
      el('div', { class: 'row-actions' },
        el('button', {
          class: 'btn btn-primary',
          onclick: async () => { await startWorkout('free'); refresh(); },
        }, 'Free session'),
        programs.length ? el('button', {
          class: 'btn',
          onclick: () => openProgramPicker(programs),
        }, 'From a programme') : null,
      ),
      el('p', { class: 'muted-sm' },
        'Sets are saved as you log them, so nothing is lost if the phone sleeps or the app closes.'),
    ),
    await progressionCard(),
    await historyCard(),
    exerciseCount === 0 ? emptyState({
      title: 'No exercises',
      message: 'The library seeds itself on first run. If it is empty, re-seed from Settings → Data.',
    }) : null,
    workoutRoadmap(),
  );
}

function workoutRoadmap() {
  return roadmapCard('Workout', [
    'Interactive dual-gender anatomical muscle selector — tap a muscle group on a front/back body silhouette to filter the exercise library, instead of the text search above.',
    'Recovery heatmap — a 2D muscle-group map of fatigue and readiness, built from your logged volume.',
    'Pre-workout cognitive fatigue slider and eccentric/concentric tempo bars in the set logger.',
  ]);
}

function openProgramPicker(programs) {
  sheet({
    title: 'Programmes',
    body: el('div', {},
      el('p', { class: 'muted-sm' }, 'Templates to start from. Nothing is locked in — you can change any set.'),
      ...programs.map((p) => el('button', {
        class: 'result-row',
        onclick: async () => { await startWorkout('program', p.id); refresh(); },
      },
        el('div', {},
          el('span', { class: 'entry-label' }, p.name),
          el('span', { class: 'muted-sm' }, `${p.daysPerWeek}× per week · ${p.note ?? ''}`),
        ),
      )),
    ),
  });
}
