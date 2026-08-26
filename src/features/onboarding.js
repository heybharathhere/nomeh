/* First-launch onboarding (spec §6).
 *
 * Four steps, no account, no email, no network. The last step shows the numbers
 * that were derived and states plainly that they are estimates, because the
 * moment a user treats a predicted TDEE as a measured fact, every decision they
 * make downstream inherits a false precision.
 */

import { el, field, card, callout, toast, tint } from '../core/ui.js';
import { Profile, Goals } from '../db/repos.js';
import { setSetting } from '../db/database.js';
import { ACTIVITY_FACTORS, GOALS, computeTargets, convert } from '../engines/biomath.js';
import { navigate } from '../core/router.js';

const draft = {
  name: '', sex: 'unspecified', ageYears: null,
  weightKg: null, heightCm: null,
  activity: 'moderate', primaryGoal: 'general',
  units: 'metric'
};

export function onboardingView() {
  const host = el('div', { class: 'stack', dataset: { chrome: 'bare' } });
  let step = 0;

  const steps = [intro, basics, body, goal, review];

  function paint() {
    const dots = el('div', { class: 'steps', role: 'group', 'aria-label': `Step ${step + 1} of ${steps.length}` },
      ...steps.map((_, i) => el('i', { class: i <= step ? 'on' : '' })));
    const wrap = el('div', { class: 'onboard-step' }, steps[step]({ next, back }));

    const old = host.querySelector('.onboard-step');
    if (!old) {
      host.replaceChildren(dots, wrap);
      document.getElementById('main')?.focus({ preventScroll: true });
      return;
    }

    /* Liquid exit, then swap, then the new step's own liquidIn animation
       (declared on .onboard-step itself) plays automatically. */
    old.classList.add('leaving');
    old.addEventListener('animationend', () => {
      host.replaceChildren(dots, wrap);
      document.getElementById('main')?.focus({ preventScroll: true });
    }, { once: true });
  }
  function next() { step = Math.min(steps.length - 1, step + 1); paint(); }
  function back() { step = Math.max(0, step - 1); paint(); }

  paint();
  return host;
}

/* ------------------------------------------------------------ step 1 ----- */

function intro({ next }) {
  return el('div', { class: 'onboard-splash' },
    el('h1', { class: 'onboard-wordmark' }, 'NoMeh', el('em', {}, '!')),
    el('button', { class: 'btn btn-primary btn-block', onclick: next }, 'Set up')
  );
}

/* ------------------------------------------------------------ step 2 ----- */

function basics({ next, back }) {
  const name = el('input', { class: 'input', value: draft.name, placeholder: 'What should I call you?', autocomplete: 'off' });
  const age  = el('input', { class: 'input', type: 'number', inputmode: 'numeric', min: '13', max: '110', value: draft.ageYears ?? '' });

  const sexes = [
    { v: 'female', l: 'Female' },
    { v: 'male', l: 'Male' },
    { v: 'unspecified', l: 'Prefer not to say' }
  ];
  const sexRow = el('div', { class: 'row-wrap', role: 'radiogroup', 'aria-label': 'Used for the metabolic estimate' },
    ...sexes.map((s) => el('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(draft.sex === s.v),
      'aria-pressed': String(draft.sex === s.v),
      onclick: (e) => {
        draft.sex = s.v;
        for (const c of sexRow.children) { c.setAttribute('aria-pressed', 'false'); c.setAttribute('aria-checked', 'false'); }
        e.currentTarget.setAttribute('aria-pressed', 'true');
        e.currentTarget.setAttribute('aria-checked', 'true');
      }
    }, s.l))
  );

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Step 1 of 4'),
    el('h1', { class: 'page-title' }, 'About you'),
    field('Name', name),
    field('Age', age),
    el('div', { class: 'field' },
      el('label', {}, 'Sex'),
      sexRow,
      el('span', { class: 'hint' }, 'Used for the estimate — override anytime.')
    ),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-ghost', onclick: back }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => {
          draft.name = name.value.trim();
          draft.ageYears = parseFloat(age.value) || null;
          if (!draft.ageYears || draft.ageYears < 13 || draft.ageYears > 110) {
            toast('Enter an age between 13 and 110.', { tone: 'crimson' }); age.focus(); return;
          }
          next();
        }
      }, 'Continue')
    )
  );
}

/* ------------------------------------------------------------ step 3 ----- */

function body({ next, back }) {
  const unitRow = el('div', { class: 'row-wrap' });
  const weight = el('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1' });
  const height = el('input', { class: 'input', type: 'number', inputmode: 'decimal', step: '0.1' });
  const wUnit = el('span', { class: 'hint' });
  const hUnit = el('span', { class: 'hint' });

  function syncUnits() {
    const metric = draft.units === 'metric';
    wUnit.textContent = metric ? 'Kilograms' : 'Pounds';
    hUnit.textContent = metric ? 'Centimetres' : 'Inches';
    weight.placeholder = metric ? '72.5' : '160';
    height.placeholder = metric ? '175' : '69';
    unitRow.replaceChildren(
      ...[['metric', 'Metric · kg / cm'], ['imperial', 'Imperial · lb / in']].map(([v, l]) =>
        el('button', {
          class: 'chip', 'aria-pressed': String(draft.units === v),
          onclick: () => { draft.units = v; syncUnits(); }
        }, l))
    );
  }
  syncUnits();

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Step 2 of 4'),
    el('h1', { class: 'page-title' }, 'Measurements'),
    el('div', { class: 'field' }, el('label', {}, 'Units'), unitRow),
    field('Weight', weight, wUnit.textContent),
    field('Height', height, hUnit.textContent),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-ghost', onclick: back }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: () => {
          const w = parseFloat(weight.value), h = parseFloat(height.value);
          if (!(w > 0) || !(h > 0)) { toast('Weight and height are both needed.', { tone: 'crimson' }); return; }
          draft.weightKg = draft.units === 'metric' ? w : convert.lbToKg(w);
          draft.heightCm = draft.units === 'metric' ? h : convert.inToCm(h);
          if (draft.weightKg < 25 || draft.weightKg > 350 || draft.heightCm < 90 || draft.heightCm > 250) {
            toast('Those values look out of range — check the units.', { tone: 'crimson' }); return;
          }
          next();
        }
      }, 'Continue')
    )
  );
}

/* ------------------------------------------------------------ step 4 ----- */

function goal({ next, back }) {
  const goalGrid = el('div', { class: 'row-wrap' },
    ...Object.entries(GOALS).map(([k, g]) => el('button', {
      class: 'chip', style: tint(g.domain === 'nutrition' ? 'amber' : g.domain === 'strength' ? 'violet' : 'emerald'),
      'aria-pressed': String(draft.primaryGoal === k),
      onclick: (e) => {
        draft.primaryGoal = k;
        for (const c of goalGrid.children) c.setAttribute('aria-pressed', 'false');
        e.currentTarget.setAttribute('aria-pressed', 'true');
      }
    }, g.label))
  );

  const activityWrap = el('div', { class: 'stack' },
    ...Object.entries(ACTIVITY_FACTORS).map(([k, a]) => el('button', {
      class: 'chip', style: { justifyContent: 'flex-start', textAlign: 'left', minHeight: '44px' },
      'aria-pressed': String(draft.activity === k),
      onclick: (e) => {
        draft.activity = k;
        for (const c of activityWrap.children) c.setAttribute('aria-pressed', 'false');
        e.currentTarget.setAttribute('aria-pressed', 'true');
      }
    }, el('span', {}, a.label), el('span', { class: 'k' }, `×${a.factor}`), el('span', { class: 'hint', style: { marginLeft: 'auto' } }, a.hint)))
  );

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Step 3 of 4'),
    el('h1', { class: 'page-title' }, 'Goal and activity'),
    el('div', { class: 'field' }, el('label', {}, 'Primary goal'), goalGrid),
    el('div', { class: 'field' }, el('label', {}, 'Typical week'), activityWrap),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-ghost', onclick: back }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: next }, 'See the numbers')
    )
  );
}

/* ------------------------------------------------------------ step 5 ----- */

function review({ back }) {
  const targets = computeTargets(draft);

  const rows = [
    ['BMR', `${targets.bmr} kcal`, 'Resting energy, Mifflin-St Jeor'],
    ['TDEE', `${targets.tdee} kcal`, `BMR × ${ACTIVITY_FACTORS[draft.activity].factor}`],
    ['Daily calories', `${targets.calories} kcal`, GOALS[draft.primaryGoal].label],
    ['Protein', `${targets.protein} g`, `${GOALS[draft.primaryGoal].proteinPerKg} g per kg`],
    ['Carbohydrate', `${targets.carbs} g`, 'Remainder of the budget'],
    ['Fat', `${targets.fat} g`, '25% of calories'],
    ['Fibre', `${targets.fiber} g`, '14 g per 1000 kcal'],
    ['Water', `${targets.water} ml`, '35 ml per kg plus activity']
  ];

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Step 4 of 4'),
    el('h1', { class: 'page-title' }, 'Your numbers'),

    callout('Estimates — they adjust once you log for a couple of weeks.', { tone: 'amber' }),

    targets.calorieFloorApplied
      ? callout(`The goal-adjusted figure came out below ${targets.calorieFloor} kcal, so the target was ` +
                'raised to that floor. Going lower without professional supervision is not something ' +
                'this app will recommend.', { tone: 'crimson', strongText: 'Floor applied. ' })
      : null,

    card('Derived targets', { note: 'Editable later' },
      el('dl', { class: 'kv' },
        ...rows.flatMap(([k, v, why]) => [
          el('dt', {}, k, el('div', { class: 'hint' }, why)),
          el('dd', {}, v)
        ])
      )
    ),

    el('div', { class: 'row' },
      el('button', { class: 'btn btn-ghost', onclick: back }, 'Back'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: () => finish(targets) }, "Let's log")
    )
  );
}

async function finish(targets) {
  try {
    await Profile.save({
      name: draft.name || 'You',
      sex: draft.sex,
      ageYears: draft.ageYears,
      weightKg: draft.weightKg,
      heightCm: draft.heightCm,
      activity: draft.activity,
      primaryGoal: draft.primaryGoal,
      targets,
      targetsOverridden: false,
      targetReason: 'onboarding'
    });

    await setSetting('units', draft.units);

    const g = GOALS[draft.primaryGoal];
    await Goals.create({
      title: g.label,
      domain: g.domain,
      status: 'active',
      priority: 1,
      target: null,
      current: null,
      deadline: null,
      milestones: [],
      note: 'Created during setup.'
    });

    toast('Profile saved on this device.', { tone: 'emerald' });
    navigate('/today');
  } catch (err) {
    console.error(err);
    toast('Could not save the profile. Storage may be full or blocked.', { tone: 'crimson', timeout: 9000 });
  }
}
