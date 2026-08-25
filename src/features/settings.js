/* Settings, and everything that belongs beside it: the storage dashboard
 * (§27), the privacy and capability dashboard (§30, §37), backup (§31),
 * trash (§28) and the destructive operations (§27).
 *
 * These sit on one screen on purpose. They are all answers to the same
 * question — "what does this app know, where does it live, and how do I get it
 * out or get rid of it?" — and splitting them across tabs is how apps end up
 * hiding the answer.
 */

import {
  el, card, callout, field, fmt, tint, sheet, toast, clear,
  confirmDestructive, emptyState
} from '../core/ui.js';
import { Profile, trashContents, restoreFromTrash, emptyTrash } from '../db/repos.js';
import { allSettings, setSetting, db, DB_NAME } from '../db/database.js';
import { capabilities, storageReport, requestPersistentStorage, permissionStates, platform } from '../core/capabilities.js';
import { savePref } from '../core/prefs.js';
import { computeTargets, ACTIVITY_FACTORS, GOALS } from '../engines/biomath.js';
import {
  exportJson, exportLogsCsv, readBackupFile, restoreBackup, backupStatus
} from './backup.js';
import { refresh } from '../core/router.js';
import { LOG_TYPES } from '../engines/logparser.js';

import { appearanceCard, vaultCard, dataMaintenanceCard } from './appearance-settings.js';
import { UI, enabled } from '../config/app.config.js';

export async function settingsView() {
  const [profile, settings, storage, perms, backup] = await Promise.all([
    Profile.get(), allSettings(), storageReport(), permissionStates(), backupStatus()
  ]);
  const caps = capabilities();

  return el('div', { class: 'stack' },
    el('p', { class: 'eyebrow' }, 'Your device, your data'),
    el('h1', { class: 'page-title' }, 'Settings'),
    backup.overdue ? backupNudge(backup) : null,
    screensCard(),
    profileCard(profile),
    await appearanceCard(),
    unitsCard(settings),
    accessibilityCard(settings),
    backupCard(backup),
    await vaultCard(),
    await dataMaintenanceCard(),
    storageCard(storage),
    privacyCard(perms, caps),
    capabilityCard(caps),
    installCard(),
    trashCard(),
    dangerCard()
  );
}

/* ----------------------------------------------------------- screens ----- */

/* The dock holds five tabs; the app has more screens than that. Rather than
   cramming them in or hiding them, everything else is listed here and on Today.
   Entries whose feature flag is off are omitted entirely. */
const SECONDARY = [
  { route: 'endurance', label: 'Runs & rides', hint: 'GPS tracking, GPX import', feature: 'endurance' },
  { route: 'recovery', label: 'Recovery', hint: 'Sleep, readiness, training load', feature: 'recovery' },
  { route: 'analytics', label: 'Analytics', hint: 'Trends and correlations', feature: 'analytics' },
  { route: 'photos', label: 'Progress photos', hint: 'Stored on this device only', feature: 'photos' },
  { route: 'timeline', label: 'Timeline', hint: 'Everything you have logged' },
  { route: 'diary', label: 'Food diary', hint: 'Meals, macros, hydration', feature: 'nutrition' },
  { route: 'train', label: 'Training', hint: 'Sessions, PRs, programmes', feature: 'strength' },
  { route: 'import', label: 'Import health data', hint: 'Apple Health, Strava, Google Fit files', feature: 'healthImport' },
];

export function screensCard() {
  const available = SECONDARY.filter((s) => enabled(s.feature));
  const inDock = new Set(UI.nav.map((n) => n.route));
  const rows = available.filter((s) => !inDock.has(s.route));
  if (!rows.length) return null;

  return card('All screens', { note: `${rows.length} more` },
    ...rows.map((r) => el('a', { class: 'entry entry-btn', href: `#/${r.route}` },
      el('div', { class: 'entry-main' },
        el('span', { class: 'entry-label' }, r.label),
        el('span', { class: 'muted-sm' }, r.hint),
      ),
      el('span', { class: 'entry-value' }, '\u203a'),
    )),
  );
}

/* ------------------------------------------------------------ nudge ------ */

function backupNudge(backup) {
  return el('div', { class: 'callout', style: tint('amber') },
    el('strong', {}, backup.last ? `Last backup ${fmt.ago(backup.last)}. ` : 'No backup yet. '),
    el('span', {}, 'Nothing here is stored anywhere but this browser. A browser reset, a cleared ' +
      'site-data setting, or an iOS storage eviction takes it with no way back.'),
    el('button', {
      class: 'btn btn-sm btn-primary', style: { marginTop: 'var(--s2)', justifySelf: 'start' },
      onclick: async () => { const n = await exportJson(); toast(`${n} records exported.`); refresh(); }
    }, 'Export now')
  );
}

/* ------------------------------------------------------------ profile ---- */

function profileCard(profile) {
  if (!profile) {
    return card('Profile', {}, emptyState({
      title: 'No profile yet',
      message: 'Run setup to create one.',
      action: el('a', { class: 'btn btn-primary btn-sm', href: '#/welcome' }, 'Run setup')
    }));
  }

  const t = profile.targets || {};
  return card('Profile', { note: profile.targetsOverridden ? 'Targets overridden' : 'Targets calculated' },
    el('div', { class: 'stack' },
      el('dl', { class: 'kv' },
        el('dt', {}, 'Name'),     el('dd', {}, profile.name || '—'),
        el('dt', {}, 'Age'),      el('dd', {}, profile.ageYears ?? '—'),
        el('dt', {}, 'Weight'),   el('dd', {}, `${fmt.dec(profile.weightKg, 1)} kg`),
        el('dt', {}, 'Height'),   el('dd', {}, `${fmt.dec(profile.heightCm, 1)} cm`),
        el('dt', {}, 'Activity'), el('dd', {}, ACTIVITY_FACTORS[profile.activity]?.label ?? '—'),
        el('dt', {}, 'Goal'),     el('dd', {}, GOALS[profile.primaryGoal]?.label ?? '—'),
        el('dt', {}, 'Energy target'), el('dd', {}, `${fmt.int(t.calories)} kcal`)
      ),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn-sm', onclick: () => editProfile(profile) }, 'Edit profile'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => editTargets(profile) }, 'Override targets')
      )
    )
  );
}

function editProfile(profile) {
  const weight = el('input', { class: 'input', type: 'number', step: '0.1', value: profile.weightKg ?? '' });
  const height = el('input', { class: 'input', type: 'number', step: '0.1', value: profile.heightCm ?? '' });
  const age = el('input', { class: 'input', type: 'number', step: '1', value: profile.ageYears ?? '' });
  const name = el('input', { class: 'input', value: profile.name ?? '' });
  const activity = el('select', { class: 'select' },
    ...Object.entries(ACTIVITY_FACTORS).map(([k, a]) =>
      el('option', { value: k, selected: profile.activity === k }, `${a.label} (×${a.factor})`)));
  const goal = el('select', { class: 'select' },
    ...Object.entries(GOALS).map(([k, g]) =>
      el('option', { value: k, selected: profile.primaryGoal === k }, g.label)));

  const ref = sheet({
    title: 'Edit profile',
    body: el('div', { class: 'stack' },
      field('Name', name),
      el('div', { class: 'grid-2' }, field('Weight (kg)', weight), field('Height (cm)', height)),
      field('Age', age),
      field('Activity level', activity),
      field('Primary goal', goal),
      callout('Changing these recalculates every target unless you have overridden them by hand. ' +
              'The previous target set is kept in history.', { tone: 'cyan' })
    ),
    footer: el('div', { class: 'row', style: { width: '100%' } },
      el('button', { class: 'btn btn-ghost', onclick: () => ref.close() }, 'Cancel'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const next = {
            name: name.value.trim() || 'You',
            weightKg: parseFloat(weight.value) || profile.weightKg,
            heightCm: parseFloat(height.value) || profile.heightCm,
            ageYears: parseFloat(age.value) || profile.ageYears,
            activity: activity.value,
            primaryGoal: goal.value
          };
          if (!profile.targetsOverridden) {
            next.targets = computeTargets({ ...profile, ...next });
            next.targetReason = 'profile changed';
          }
          await Profile.save(next);
          ref.close(); toast('Profile updated.'); refresh();
        }
      }, 'Save')
    )
  });
}

function editTargets(profile) {
  const t = profile.targets || {};
  const inputs = {
    calories: el('input', { class: 'input', type: 'number', step: '10', value: t.calories ?? '' }),
    protein:  el('input', { class: 'input', type: 'number', step: '1', value: t.protein ?? '' }),
    carbs:    el('input', { class: 'input', type: 'number', step: '1', value: t.carbs ?? '' }),
    fat:      el('input', { class: 'input', type: 'number', step: '1', value: t.fat ?? '' }),
    water:    el('input', { class: 'input', type: 'number', step: '50', value: t.water ?? '' })
  };

  const ref = sheet({
    title: 'Override targets',
    body: el('div', { class: 'stack' },
      callout('Manual targets stop tracking your profile. If your weight or activity changes, ' +
              'these numbers will not follow — revert to calculated any time.',
              { tone: 'amber', strongText: 'Taking manual control. ' }),
      field('Energy (kcal)', inputs.calories),
      el('div', { class: 'grid-2' }, field('Protein (g)', inputs.protein), field('Carbs (g)', inputs.carbs)),
      el('div', { class: 'grid-2' }, field('Fat (g)', inputs.fat), field('Water (ml)', inputs.water))
    ),
    footer: el('div', { class: 'row', style: { width: '100%' } },
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          await Profile.save({
            targets: computeTargets(profile), targetsOverridden: false, targetReason: 'reverted to calculated'
          });
          ref.close(); toast('Back to calculated targets.'); refresh();
        }
      }, 'Revert to calculated'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          const targets = { ...t, method: 'manual override' };
          for (const [k, input] of Object.entries(inputs)) {
            const v = parseFloat(input.value);
            if (v > 0) targets[k] = v;
          }
          if (targets.calories < 1000) {
            toast('Below 1000 kcal is not something this app will store as a target.', { tone: 'crimson', timeout: 8000 });
            return;
          }
          await Profile.save({ targets, targetsOverridden: true, targetReason: 'manual override' });
          ref.close(); toast('Targets overridden.'); refresh();
        }
      }, 'Save overrides')
    )
  });
}

/* ------------------------------------------------------------ units ------ */

function unitsCard(settings) {
  const optionRow = (label, key, options) => {
    const row = el('div', { class: 'row-wrap' });
    const paint = () => clear(row).append(...options.map(([v, l]) => el('button', {
      class: 'chip', 'aria-pressed': String(settings[key] === v),
      onclick: async () => { settings[key] = v; await setSetting(key, v); paint(); toast(`${label}: ${l}`); }
    }, l)));
    paint();
    return el('div', { class: 'field' }, el('label', {}, label), row);
  };

  return card('Units & display', {},
    el('div', { class: 'stack' },
      optionRow('Measurement system', 'units', [['metric', 'Metric'], ['imperial', 'Imperial']]),
      optionRow('Energy', 'energyUnit', [['kcal', 'kcal'], ['kJ', 'kJ']]),
      optionRow('Clock', 'clock', [['24h', '24-hour'], ['12h', '12-hour']]),
      el('p', { class: 'card-note' },
        'Stored values never change — everything is kept in kilograms, centimetres, millilitres and ' +
        'kilocalories internally, and converted only for display. Switching units cannot corrupt history.')
    )
  );
}

/* ------------------------------------------------------ accessibility ---- */

function accessibilityCard(settings) {
  const optionRow = (label, key, options, hint) => {
    const row = el('div', { class: 'row-wrap' });
    const paint = () => clear(row).append(...options.map(([v, l]) => el('button', {
      class: 'chip', 'aria-pressed': String((settings[key] ?? options[0][0]) === v),
      onclick: async () => { settings[key] = v; await savePref(key, v); paint(); }
    }, l)));
    paint();
    return el('div', { class: 'field' }, el('label', {}, label), row, hint ? el('span', { class: 'hint' }, hint) : null);
  };

  return card('Accessibility', {},
    el('div', { class: 'stack' },
      optionRow('Motion', 'motion',
        [['auto', 'Follow system'], ['reduced', 'Reduce'], ['full', 'Full']],
        'Auto respects your operating system setting.'),
      optionRow('Contrast', 'contrast',
        [['normal', 'Normal'], ['high', 'High']],
        'High contrast also removes the glass blur, which some screens render poorly.'),
      optionRow('Text size', 'textSize',
        [['normal', 'Normal'], ['large', 'Large']]),
      el('p', { class: 'card-note' },
        'Nothing in NoMeh! is communicated by colour alone — every coloured marker is paired with a label.')
    )
  );
}

/* ------------------------------------------------------------ backup ----- */

function backupCard(backup) {
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'sr' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (file) await openImportSheet(file);
    fileInput.value = '';
  });

  return card('Backup', { note: backup.last ? `Last: ${fmt.ago(backup.last)}` : 'Never' },
    el('div', { class: 'stack' },
      el('div', { class: 'row-wrap' },
        el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async () => {
            try { const n = await exportJson(); toast(`${n} records exported.`); refresh(); }
            catch (err) { toast(`Export failed: ${err.message}`, { tone: 'crimson' }); }
          }
        }, 'Export full backup'),
        el('button', {
          class: 'btn btn-sm',
          onclick: async () => {
            try { const n = await exportLogsCsv(); toast(`${n} log rows exported as CSV.`); }
            catch (err) { toast(`Export failed: ${err.message}`, { tone: 'crimson' }); }
          }
        }, 'Export logs as CSV'),
        el('button', { class: 'btn btn-sm btn-ghost', onclick: () => fileInput.click() }, 'Restore from file')
      ),
      fileInput,
      el('p', { class: 'card-note' },
        'The full backup is a plain JSON file containing everything. Keep it somewhere you actually ' +
        'back up — a cloud drive, or two places. Restore always shows you what is in the file first.')
    )
  );
}

async function openImportSheet(file) {
  const report = await readBackupFile(file);
  const body = el('div', { class: 'stack' });

  if (!report.ok) {
    body.append(callout(report.problems.join(' '), { tone: 'crimson', strongText: 'Cannot restore this file. ' }));
    sheet({ title: 'Restore', body });
    return;
  }

  const counts = Object.entries(report.counts).filter(([, n]) => n > 0);
  body.append(
    el('dl', { class: 'kv' },
      el('dt', {}, 'Exported'), el('dd', {}, new Date(report.meta.exportedAt).toLocaleString()),
      el('dt', {}, 'Records'),  el('dd', {}, fmt.int(report.total)),
      el('dt', {}, 'Format'),   el('dd', {}, `v${report.meta.formatVersion}`)
    ),
    el('div', { class: 'row-wrap' },
      ...counts.map(([name, n]) => el('span', { class: 'tag' }, `${name} ${n}`))
    ),
    ...report.warnings.map((w) => callout(w, { tone: 'amber' }))
  );

  const ref = sheet({
    title: 'Restore from backup',
    body,
    footer: el('div', { class: 'row', style: { width: '100%', flexWrap: 'wrap', gap: 'var(--s2)' } },
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => ref.close() }, 'Cancel'),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'btn btn-sm btn-primary',
        onclick: async () => {
          ref.close();
          try {
            const r = await restoreBackup(report, { mode: 'merge' });
            toast(`Merged ${r.inserted} records, skipped ${r.skipped} duplicates.`, { timeout: 8000 });
            refresh();
          } catch (err) { toast(`Restore failed: ${err.message}`, { tone: 'crimson', timeout: 9000 }); }
        }
      }, 'Merge into current data'),
      el('button', {
        class: 'btn btn-sm btn-danger',
        onclick: () => {
          ref.close();
          confirmDestructive({
            title: 'Replace everything?',
            message: 'This clears every table present in the backup file and writes the file\'s ' +
                     'contents in their place. Anything logged since that backup was taken is gone. ' +
                     'Merge is almost always what you want instead.',
            confirmLabel: 'Replace all data',
            phrase: 'REPLACE',
            onConfirm: async () => {
              try {
                const r = await restoreBackup(report, { mode: 'replace' });
                toast(`Replaced: ${r.cleared} removed, ${r.inserted} written.`, { timeout: 8000 });
                refresh();
              } catch (err) { toast(`Restore failed: ${err.message}`, { tone: 'crimson', timeout: 9000 }); }
            }
          });
        }
      }, 'Replace all')
    )
  });
}

/* ------------------------------------------------------------ storage ---- */

function storageCard(storage) {
  const pct = storage.percent;
  return card('Storage', { note: storage.supported ? 'Reported by the browser' : 'Not reported here' },
    el('div', { class: 'stack' },
      storage.supported
        ? el('div', { class: 'stack', style: { gap: 'var(--s2)' } },
            el('div', { class: 'row' },
              el('span', { class: 'metric-name' }, 'Used'),
              el('span', { class: 'metric-val spacer' }, `${fmt.bytes(storage.usage)} of ${fmt.bytes(storage.quota)}`)),
            el('div', { class: 'bar', style: tint(pct > 85 ? 'crimson' : 'cyan') },
              el('i', { style: { width: `${Math.min(100, pct || 0)}%` } })),
            pct > 85 ? callout('Storage is nearly full. Export a backup before the browser starts evicting.',
              { tone: 'crimson' }) : null
          )
        : el('p', { class: 'card-note' }, 'This browser does not expose storage figures. Backups are the safety net.'),

      el('dl', { class: 'kv' },
        el('dt', {}, 'Database'), el('dd', {}, DB_NAME),
        el('dt', {}, 'Schema version'), el('dd', {}, String(db().verno)),
        el('dt', {}, 'Eviction protection'), el('dd', {}, storage.persisted === true ? 'Granted' : storage.persisted === false ? 'Not granted' : 'Unknown')
      ),

      storage.persisted === true ? null : el('button', {
        class: 'btn btn-sm',
        onclick: async () => {
          const r = await requestPersistentStorage();
          toast(r.granted
            ? 'The browser agreed to protect this data from automatic eviction.'
            : `Not granted (${r.reason}). Regular exports are the fallback.`,
            { tone: r.granted ? 'emerald' : 'amber', timeout: 8000 });
          refresh();
        }
      }, 'Ask for eviction protection'),

      el('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => confirmDestructive({
          title: 'Clear the app cache?',
          message: 'This removes the cached copies of the app\'s own files — HTML, CSS, JavaScript, ' +
                   'icons. Your logs, profile and history are in a separate database and are NOT ' +
                   'touched. The app will re-download itself next time you open it online.',
          confirmLabel: 'Clear cache only',
          onConfirm: async () => {
            const names = await caches.keys();
            await Promise.all(names.filter((n) => n.startsWith('nomeh-')).map((n) => caches.delete(n)));
            toast('App cache cleared. Your data is untouched.', { tone: 'violet', timeout: 7000 });
          }
        })
      }, 'Clear app cache (keeps data)')
    )
  );
}

/* ------------------------------------------------------------ privacy ---- */

function privacyCard(perms, caps) {
  return card('Privacy & permissions', {},
    el('div', { class: 'stack' },
      callout('NoMeh! makes no network requests to send your data anywhere. There is no analytics, ' +
              'no crash reporting and no telemetry. The only outbound requests the app makes are for ' +
              'its own files and the fonts, and after the first load even those come from cache.',
              { tone: 'emerald', strongText: 'Nothing leaves this device. ' }),
      el('div', { class: 'list-rows' },
        ...perms.map((p) => el('div', { class: 'cap' },
          el('span', {}, p.label),
          el('span', { class: 'state spacer', dataset: { ok: p.state === 'granted' ? 'yes' : 'no' } },
            p.state)
        ))
      ),
      el('p', { class: 'card-note' },
        'Nothing on this screen triggers a permission prompt. Permissions are requested at the moment ' +
        'a feature needs them, with the reason on screen.'),
      caps.map.healthImport ? el('p', { class: 'card-note' }, caps.map.healthImport.note) : null
    )
  );
}

function capabilityCard(caps) {
  return card('What this browser supports', { note: platform.iOS ? 'iOS detected' : platform.android ? 'Android detected' : null },
    el('div', { class: 'list-rows' },
      ...caps.list.map((c) => el('div', { class: 'cap', style: { flexWrap: 'wrap' } },
        el('span', {}, c.label, c.essential ? el('span', { class: 'hint' }, ' · required') : null),
        el('span', { class: 'state spacer', dataset: { ok: c.supported ? 'yes' : 'no' } },
          c.supported ? 'Available' : 'Unavailable'),
        c.note ? el('span', { class: 'why' }, c.note) : null
      ))
    )
  );
}

function installCard() {
  const body = el('div', { class: 'stack' });
  if (platform.standalone) {
    body.append(callout('NoMeh! is running as an installed app. This is also the state in which iOS is ' +
      'least likely to evict your data and notifications are permitted.',
      { tone: 'emerald', strongText: 'Installed. ' }));
  } else if (platform.iOS) {
    body.append(
      el('p', { style: { margin: 0, fontSize: '.88rem', color: 'var(--text-dim)' } },
        'iOS does not offer an install prompt. Add it by hand:'),
      el('ol', { style: { margin: 0, paddingLeft: '18px', fontSize: '.88rem', color: 'var(--text-dim)' } },
        el('li', {}, 'Tap the Share button in Safari'),
        el('li', {}, 'Choose "Add to Home Screen"'),
        el('li', {}, 'Open NoMeh! from the new icon')),
      callout('On iOS this matters more than convenience: installed sites are far less likely to have ' +
              'their storage cleared after a period of disuse.', { tone: 'amber' })
    );
  } else {
    body.append(
      el('p', { style: { margin: 0, fontSize: '.88rem', color: 'var(--text-dim)' } },
        'Look for the install icon in the address bar, or "Install app" in the browser menu. ' +
        'Installing gives it its own window and its own storage lifecycle.')
    );
  }
  return card('Install', {}, body);
}

/* ------------------------------------------------------------ trash ------ */

function trashCard() {
  const host = el('div', { class: 'stack' });

  const load = async () => {
    clear(host).append(el('p', { class: 'card-note' }, 'Loading…'));
    const items = await trashContents({ limit: 40 });
    clear(host);

    if (!items.length) {
      host.append(emptyState({ title: 'Trash is empty', message: 'Deleted records land here first.' }));
      return;
    }

    host.append(
      el('div', { class: 'list-rows' },
        ...items.map(({ table, row }) => el('div', { class: 'row' },
          el('div', {},
            el('div', { style: { fontWeight: 600, fontSize: '.9rem' } },
              LOG_TYPES[row.type]?.label || row.title || row.name || table),
            el('div', { class: 'hint' }, `${table} · deleted ${fmt.ago(row.deletedAt)}`)),
          el('button', {
            class: 'btn btn-sm btn-ghost spacer',
            onclick: async () => { await restoreFromTrash(table, row.id); toast('Restored.'); load(); }
          }, 'Restore')
        ))
      ),
      el('button', {
        class: 'btn btn-sm btn-danger',
        onclick: () => confirmDestructive({
          title: 'Empty the trash?',
          message: `${items.length} deleted records will be removed permanently. This cannot be undone.`,
          confirmLabel: 'Empty trash',
          onConfirm: async () => { const n = await emptyTrash(); toast(`${n} records permanently removed.`, { tone: 'violet' }); load(); }
        })
      }, 'Empty trash')
    );
  };
  load();

  return card('Trash', { note: 'Soft-deleted records' }, host);
}

/* ------------------------------------------------------------ danger ----- */

function dangerCard() {
  return card('Delete your data', {},
    el('div', { class: 'stack' },
      callout('Clearing the app cache and deleting your data are two completely different things. ' +
              'The cache is the app itself and is always re-downloadable. Your data is not.',
              { tone: 'crimson', strongText: 'Read this once. ' }),
      el('div', { class: 'row-wrap' },
        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDestructive({
            title: 'Delete every log entry?',
            message: 'All logged entries, including anything in the trash. Your profile, goals and ' +
                     'settings are kept. Export a backup first if there is any doubt.',
            confirmLabel: 'Delete all logs',
            phrase: 'DELETE',
            onConfirm: async () => {
              const n = await db().logs.count();
              await db().logs.clear();
              toast(`${n} log entries permanently deleted.`, { tone: 'crimson', timeout: 8000 });
              refresh();
            }
          })
        }, 'Delete all log entries'),

        el('button', {
          class: 'btn btn-sm btn-danger',
          onclick: () => confirmDestructive({
            title: 'Delete everything?',
            message: 'The entire database is destroyed: profile, goals, every log entry, settings, ' +
                     'history. The app returns to a first-launch state. There is no cloud copy and ' +
                     'no way to undo this.',
            confirmLabel: 'Erase everything',
            phrase: 'ERASE',
            onConfirm: async () => {
              try {
                await db().delete();
                toast('Everything deleted. Reloading…', { tone: 'crimson' });
                setTimeout(() => location.reload(), 900);
              } catch (err) {
                toast(`Delete failed: ${err.message}. Close other NoMeh! tabs and retry.`, { tone: 'crimson', timeout: 10000 });
              }
            }
          })
        }, 'Erase all data')
      ),
      el('p', { class: 'card-note' },
        el('a', { href: './tests.html', target: '_blank', rel: 'noopener' }, 'Run the engine test suite'),
        ' — verifies the calculation and parsing logic in this build.')
    )
  );
}
