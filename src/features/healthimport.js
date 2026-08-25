/* Health data import, from files only.
 *
 * WHY FILES AND NOT AN API
 *   There is no web API for Apple Health. None. HealthKit is available to native
 *   iOS apps and nothing else; a web page cannot read it under any circumstances,
 *   and anything claiming otherwise is either a native wrapper or wrong. Google
 *   Fit's REST API was deprecated in 2024 and in any case would need an OAuth
 *   client secret, which a static site cannot hold — a key shipped in client
 *   JavaScript is a published key.
 *
 *   So the honest path is the export file, which every one of these services
 *   does provide:
 *     - Apple Health  → Health app → profile → Export All Health Data → export.xml
 *     - Google Takeout → Fit → CSV files per metric
 *     - Strava        → Settings → My Account → Download Request → activities.csv
 *
 * PARSING APPLE'S XML WITHOUT EXPLODING
 *   An export.xml from a few years of an Apple Watch is routinely 300 MB to over
 *   a gigabyte. DOMParser on that string will run the tab out of memory. So the
 *   file is streamed in chunks and matched with a regex over each chunk, keeping
 *   only the record types we actually want. It is not elegant, but it is the only
 *   approach that works on a phone, and it degrades gracefully: a malformed
 *   record is skipped rather than aborting the import.
 */

import { el, card, callout, sheet, field, toast, clear } from '../core/ui.js';
import { db } from '../db/database.js';
import { Health, Sleep, Activities, Logs, dateKeyOf } from '../db/repos.js';
import { FEATURES } from '../config/app.config.js';
import { refresh } from '../core/router.js';

/* Apple record types we understand, mapped onto our own metric names. Anything
   not listed here is ignored — an export contains dozens of types and importing
   all of them would bury the data that matters. */
const APPLE_TYPES = {
  HKQuantityTypeIdentifierBodyMass:               { kind: 'log', type: 'weight', unitFactor: 1 },
  HKQuantityTypeIdentifierRestingHeartRate:       { kind: 'health', metric: 'restingHr' },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { kind: 'health', metric: 'hrv' },
  HKQuantityTypeIdentifierVO2Max:                 { kind: 'health', metric: 'vo2max' },
  HKQuantityTypeIdentifierStepCount:              { kind: 'health', metric: 'steps', aggregate: 'sum' },
  HKQuantityTypeIdentifierBodyFatPercentage:      { kind: 'health', metric: 'bodyFat', unitFactor: 100 },
  HKQuantityTypeIdentifierLeanBodyMass:           { kind: 'health', metric: 'leanMass' },
  HKCategoryTypeIdentifierSleepAnalysis:          { kind: 'sleep' },
};

const CHUNK = 4 * 1024 * 1024;   // 4 MB slices

/* Apple writes dates as "2026-01-05 07:12:00 +0530". V8 parses that; Safari's
   Date.parse is stricter about non-ISO forms and returns NaN, which would make
   the import silently discard every single record on an iPhone — the one device
   the file most likely came from. So the string is normalised to ISO first, and
   only then handed to Date.parse. */
export function parseHealthDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return NaN;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})?$/);
  if (m) {
    const [, date, time, tzHour, tzMin = '00'] = m;
    const seconds = time.length === 5 ? `${time}:00` : time;
    return Date.parse(`${date}T${seconds}${tzHour}:${tzMin}`);
  }

  /* No offset given — treat it as local time, which is what Apple means when it
     omits one. */
  const bare = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (bare) {
    const seconds = bare[2].length === 5 ? `${bare[2]}:00` : bare[2];
    return Date.parse(`${bare[1]}T${seconds}`);
  }

  return Date.parse(s);
}

/* ---------------------------------------------------------------- Apple --- */

async function parseAppleHealth(file, onProgress) {
  const found = { records: 0, kept: 0, skipped: 0 };
  const byMetric = new Map();     // metric -> Map(dateKey -> {value, count, at})
  const sleepByDay = new Map();   // dateKey -> minutes asleep

  /* One regex per chunk over Record elements. Attribute order is stable in
     Apple's exporter, but the pattern is written tolerantly anyway. */
  const recordRe = /<Record\s+type="([^"]+)"[^>]*?(?:unit="([^"]*)")?[^>]*?startDate="([^"]+)"[^>]*?endDate="([^"]+)"[^>]*?value="([^"]*)"/g;

  let offset = 0;
  let carry = '';

  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK);
    const text = carry + await slice.text();
    offset += CHUNK;

    /* Keep the tail so a Record split across the slice boundary is not lost. */
    const lastClose = text.lastIndexOf('<Record');
    const scannable = lastClose > 0 ? text.slice(0, lastClose) : text;
    carry = lastClose > 0 ? text.slice(lastClose) : '';

    recordRe.lastIndex = 0;
    let m;
    while ((m = recordRe.exec(scannable)) !== null) {
      found.records++;
      const [, type, , startDate, endDate, rawValue] = m;
      const spec = APPLE_TYPES[type];
      if (!spec) { found.skipped++; continue; }

      const at = parseHealthDate(startDate);
      if (!Number.isFinite(at)) { found.skipped++; continue; }
      const dateKey = dateKeyOf(at);

      if (spec.kind === 'sleep') {
        /* Apple emits a row per sleep stage. Only asleep states count, and the
           duration is the interval, not the value field. */
        if (!/asleep/i.test(rawValue)) continue;
        const end = parseHealthDate(endDate);
        if (!Number.isFinite(end) || end <= at) continue;
        const minutes = Math.round((end - at) / 60000);
        /* Sleep spanning midnight belongs to the morning it ended. */
        const key = dateKeyOf(end);
        sleepByDay.set(key, (sleepByDay.get(key) ?? 0) + minutes);
        found.kept++;
        continue;
      }

      const value = parseFloat(rawValue);
      if (!Number.isFinite(value)) { found.skipped++; continue; }
      const scaled = value * (spec.unitFactor ?? 1);

      const metricKey = spec.metric ?? spec.type;
      if (!byMetric.has(metricKey)) byMetric.set(metricKey, new Map());
      const days = byMetric.get(metricKey);
      const existing = days.get(dateKey);

      if (spec.aggregate === 'sum') {
        days.set(dateKey, { value: (existing?.value ?? 0) + scaled, at, spec });
      } else if (!existing || at > existing.at) {
        /* Latest reading of the day wins, matching how the rest of the app
           treats repeated same-day measurements. */
        days.set(dateKey, { value: scaled, at, spec });
      }
      found.kept++;
    }

    onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)), found);
  }

  return { found, byMetric, sleepByDay };
}

async function writeApple({ byMetric, sleepByDay }) {
  const written = { weight: 0, health: 0, sleep: 0 };

  for (const [metricKey, days] of byMetric) {
    for (const [dateKey, rec] of days) {
      if (rec.spec.kind === 'log') {
        /* Do not duplicate a weight the user already logged that day. */
        const existing = await db().logs
          .where('[dateKey+type]').equals([dateKey, rec.spec.type]).first();
        if (existing) continue;
        await Logs.create({
          type: rec.spec.type, value: Math.round(rec.value * 100) / 100,
          at: rec.at, dateKey, source: 'apple-health',
        });
        written.weight++;
      } else {
        const existing = await db().health
          .where('[metric+at]').between([metricKey, rec.at - 1], [metricKey, rec.at + 1]).first();
        if (existing) continue;
        await Health.create({
          metric: metricKey, value: Math.round(rec.value * 100) / 100,
          at: rec.at, dateKey, source: 'apple-health',
        });
        written.health++;
      }
    }
  }

  for (const [dateKey, minutes] of sleepByDay) {
    if (minutes < 60 || minutes > 1000) continue;   // implausible; likely fragments
    const existing = await db().sleep.filter((s) => s.dateKey === dateKey && !s.deletedAt).first();
    if (existing) continue;
    await Sleep.create({
      at: new Date(`${dateKey}T07:00:00`).getTime(), dateKey,
      minutes, quality: null, source: 'apple-health',
    });
    written.sleep++;
  }

  return written;
}

/* ------------------------------------------------------------------ CSV --- */

/* A small CSV reader that handles quoted fields containing commas — which
   Strava activity names routinely do. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return {
    headers,
    rows: rows.slice(1).filter((r) => r.some((v) => v !== ''))
      .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
  };
}

const SPORT_MAP = {
  run: 'run', ride: 'cycle', walk: 'walk', hike: 'hike', swim: 'swim',
  'trail run': 'run', 'virtual ride': 'cycle', 'e-bike ride': 'cycle',
};

async function importStrava(text) {
  const { headers, rows } = parseCsv(text);

  /* Strava's column names differ by export vintage and locale, so headers are
     matched loosely rather than by exact string. */
  const pick = (...needles) => headers.find((h) =>
    needles.some((n) => h.toLowerCase().includes(n)));

  const cDate = pick('activity date', 'date');
  const cType = pick('activity type', 'type');
  const cName = pick('activity name', 'name');
  const cDist = pick('distance');
  const cTime = pick('moving time', 'elapsed time');
  const cElev = pick('elevation gain');

  if (!cDate || !cType) {
    return { ok: false, error: 'This CSV has no recognisable date and activity-type columns.' };
  }

  let imported = 0, skipped = 0;
  for (const r of rows) {
    const at = parseHealthDate(r[cDate]);
    if (!Number.isFinite(at)) { skipped++; continue; }
    const dateKey = dateKeyOf(at);
    const sport = SPORT_MAP[String(r[cType]).toLowerCase().trim()] ?? 'run';

    const existing = await db().activities
      .filter((a) => a.dateKey === dateKey && a.source === 'strava' && !a.deletedAt).first();
    if (existing) { skipped++; continue; }

    /* Strava exports distance in km in some vintages and metres in others.
       Anything under 500 is almost certainly kilometres. */
    const rawDist = parseFloat(String(r[cDist] ?? '').replace(',', '.'));
    const distanceM = Number.isFinite(rawDist)
      ? (rawDist < 500 ? rawDist * 1000 : rawDist)
      : null;
    const seconds = parseFloat(r[cTime]) || null;

    await Activities.create({
      at, dateKey, sport, source: 'strava',
      name: r[cName] || null,
      startedAt: at, endedAt: seconds ? at + seconds * 1000 : at,
      distanceM: distanceM != null ? Math.round(distanceM) : null,
      durationS: seconds, movingS: seconds,
      elevationGainM: parseFloat(r[cElev]) || null,
      paceSecPerKm: distanceM > 0 && seconds ? Math.round(seconds / (distanceM / 1000)) : null,
    });
    imported++;
  }

  return { ok: true, imported, skipped, total: rows.length };
}

async function importTakeout(text, filename) {
  const { headers, rows } = parseCsv(text);
  const dateCol = headers.find((h) => /date/i.test(h));
  if (!dateCol) return { ok: false, error: 'No date column found in this Takeout file.' };

  /* Google Takeout ships one file per metric, named after it. */
  const metric = /weight/i.test(filename) ? 'weight'
    : /heart/i.test(filename) ? 'restingHr'
    : /step/i.test(filename) ? 'steps'
    : null;
  if (!metric) {
    return { ok: false, error: 'Only weight, heart-rate and step Takeout files are recognised.' };
  }

  const valueCol = headers.find((h) => h !== dateCol && /average|value|count|maximum/i.test(h))
                ?? headers.find((h) => h !== dateCol);

  let imported = 0;
  for (const r of rows) {
    const at = parseHealthDate(r[dateCol]);
    const value = parseFloat(r[valueCol]);
    if (!Number.isFinite(at) || !Number.isFinite(value)) continue;
    const dateKey = dateKeyOf(at);

    if (metric === 'weight') {
      const existing = await db().logs.where('[dateKey+type]').equals([dateKey, 'weight']).first();
      if (existing) continue;
      await Logs.create({ type: 'weight', value, at, dateKey, source: 'google-fit' });
    } else {
      await Health.create({ metric, value, at, dateKey, source: 'google-fit' });
    }
    imported++;
  }

  return { ok: true, imported, metric, total: rows.length };
}

/* --------------------------------------------------------------- the UI --- */

function openImport() {
  const input = el('input', {
    class: 'input', type: 'file',
    accept: '.xml,.csv,.zip,text/xml,text/csv',
  });
  const progress = el('div', { class: 'timer-bar' }, el('i', { style: { width: '0%' } }));
  const status = el('p', { class: 'muted-sm' });
  const report = el('div', { class: 'import-report' });

  sheet({
    title: 'Import health data',
    body: el('div', {},
      el('p', { class: 'muted-sm' },
        'Choose an Apple Health export.xml, a Strava activities.csv, or a Google Takeout ' +
        'Fit CSV. Existing records are never overwritten — anything already logged for a ' +
        'day is left alone.'),
      field('File', input),
      progress, status, report,
    ),
    confirmLabel: 'Import',
    onConfirm: async () => {
      const file = input.files?.[0];
      if (!file) { toast('Choose a file.'); return false; }

      clear(report);
      const name = file.name.toLowerCase();

      if (name.endsWith('.zip')) {
        clear(report).append(el('div', { style: { color: 'var(--crimson)' } },
          'This is still a zip. Unzip it first and choose export.xml (Apple) or the CSV inside.'));
        return false;
      }

      try {
        if (name.endsWith('.xml')) {
          status.textContent = `Scanning ${(file.size / 1048576).toFixed(0)} MB…`;
          const parsed = await parseAppleHealth(file, (pct, found) => {
            progress.firstChild.style.width = `${pct}%`;
            status.textContent = `${pct}% · ${found.kept.toLocaleString()} usable records found`;
          });
          status.textContent = 'Writing…';
          const written = await writeApple(parsed);
          clear(report).append(
            el('div', {}, `Scanned ${parsed.found.records.toLocaleString()} records.`),
            el('div', {}, `Weight entries added: ${written.weight}`),
            el('div', {}, `Health metrics added: ${written.health}`),
            el('div', {}, `Nights of sleep added: ${written.sleep}`),
            el('div', {}, `Ignored record types: ${parsed.found.skipped.toLocaleString()}`),
          );
          toast('Apple Health import finished.');
        } else if (name.endsWith('.csv')) {
          const text = await file.text();
          const isStrava = /activit/i.test(name) || /activity type/i.test(text.slice(0, 2000));
          const result = isStrava ? await importStrava(text) : await importTakeout(text, name);
          if (!result.ok) {
            clear(report).append(el('div', { style: { color: 'var(--crimson)' } }, result.error));
            return false;
          }
          clear(report).append(
            el('div', {}, `Rows read: ${result.total}`),
            el('div', {}, `Imported: ${result.imported}`),
            result.skipped ? el('div', {}, `Skipped as duplicates or unreadable: ${result.skipped}`) : null,
          );
          toast(`Imported ${result.imported} records.`);
        } else {
          clear(report).append(el('div', { style: { color: 'var(--crimson)' } },
            'Unrecognised file type. Expecting .xml or .csv.'));
          return false;
        }
      } catch (err) {
        console.error('[import] failed', err);
        clear(report).append(el('div', { style: { color: 'var(--crimson)' } },
          err?.name === 'RangeError' || /memory/i.test(err?.message ?? '')
            ? 'The file was too large for this browser to hold. Try on a desktop browser.'
            : (err?.message ?? 'Import failed.')));
        return false;
      }

      refresh();
      return false;   // keep the sheet open so the report stays visible
    },
  });
}

export async function healthImportView() {
  if (!FEATURES.healthImport) {
    return card('Health import is switched off', {},
      el('p', { class: 'muted-sm' }, 'FEATURES.healthImport is false in src/config/app.config.js.'));
  }

  const counts = {
    health: await db().health.count(),
    imported: await db().health.filter((h) => h.source === 'apple-health' || h.source === 'google-fit').count(),
    strava: await db().activities.filter((a) => a.source === 'strava').count(),
  };

  return el('div', { class: 'stack' },
    card('Import from another app', {
      note: counts.imported ? `${counts.imported} imported metrics` : null,
      actions: el('button', { class: 'btn btn-sm btn-primary', onclick: openImport }, 'Import a file'),
    },
      el('p', { class: 'muted-sm' },
        'A one-way import of history you already have elsewhere. Runs once per file; ' +
        'nothing syncs continuously.'),
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat-cell' },
          el('span', { class: 'muted-sm' }, 'Health metrics'), el('strong', {}, String(counts.health))),
        el('div', { class: 'stat-cell' },
          el('span', { class: 'muted-sm' }, 'Strava activities'), el('strong', {}, String(counts.strava))),
      ),
    ),

    card('How to get your file', {},
      ...[
        ['Apple Health', 'Health app → your photo, top right → Export All Health Data. ' +
          'You get a zip; unzip it and choose export.xml. Expect a large file — a few years ' +
          'of Apple Watch data can exceed 500 MB, and it may only import on a desktop browser.'],
        ['Strava', 'strava.com → Settings → My Account → Download or Delete Your Account → ' +
          'Request Archive. Use activities.csv from the archive.'],
        ['Google Fit', 'takeout.google.com → deselect all → select Fit → export. ' +
          'Use the daily-aggregate CSVs for weight, heart rate or steps.'],
      ].map(([title, body]) => el('div', { class: 'exercise-block' },
        el('strong', {}, title), el('p', { class: 'muted-sm' }, body))),
    ),

    callout(
      'There is no live connection to any of these services, and there cannot be. Apple has ' +
      'no web API for Health at all, and Google Fit\u2019s REST API was retired and would need a ' +
      'secret key that a static site cannot keep secret. File import is not a shortcut here — ' +
      'it is the only honest option.',
      { tone: 'recovery', strongText: 'Why files: ' }),
  );
}
