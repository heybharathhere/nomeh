/* Endurance: live GPS tracking, activity history, GPX import and export.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE
 *
 * A browser cannot track GPS in the background on iOS. When the screen locks,
 * WebKit suspends JavaScript, `watchPosition` stops firing, and the recording
 * has a hole in it. Wake Lock keeps the screen on where it is supported
 * (Chromium) and is absent on iOS. There is no workaround. Anything that
 * presents itself as background tracking in a PWA is either wrong or is quietly
 * losing data.
 *
 * So this screen does three things instead of pretending otherwise:
 *   1. states the constraint up front, before you start a run rather than after
 *   2. requests a wake lock where it exists and says so when it does not
 *   3. treats GPX import as a first-class path, because a watch does not have
 *      this problem and importing from one is the honest answer for long efforts
 *
 * Every fix is written to the database as it arrives. Same reasoning as the
 * training screen: a crash, an eviction or a locked screen must not cost you
 * the run you already did.
 */

import { el, card, callout, fmt, tint, colourVar, emptyState, sheet, field, toast, clear } from '../core/ui.js';
import { db, getSetting, setSetting } from '../db/database.js';
import { Activities, RoutePoints, dateKeyOf } from '../db/repos.js';
import { acceptPoint, processTrack, splits, paceSecPerKm, speedKmh,
         movingTime, routePath, parseGpx, buildGpx, estimatePower } from '../engines/geo.js';
import { capabilities } from '../core/capabilities.js';
import { GPS, FEATURES } from '../config/app.config.js';
import { refresh } from '../core/router.js';

const ACTIVE_KEY = 'endurance.activeActivityId';
const SPORTS = [
  { key: 'run', label: 'Run', colour: 'performance' },
  { key: 'walk', label: 'Walk', colour: 'recovery' },
  { key: 'cycle', label: 'Cycle', colour: 'strength' },
  { key: 'hike', label: 'Hike', colour: 'nutrition' },
];

/* --------------------------------------------------------- live recorder -- */

/* One recorder instance per page. Held at module scope so navigating away and
   back does not orphan a running geolocation watch — an orphaned watch keeps
   the GPS radio awake and flattens the battery for nothing. */
let recorder = null;
let hudTicker = null;

/* Clearing this on every render is what stops a stale interval from repainting
   a detached node forever after you navigate away mid-activity. */
function stopHudTicker() {
  if (hudTicker) { clearInterval(hudTicker); hudTicker = null; }
}

function createRecorder({ activityId, sport }) {
  /* onUpdate is a mutable property on the returned object rather than a captured
     parameter. The HUD is built after the recorder starts and needs to attach
     its own painter; a destructured callback would have been frozen at
     construction and the live display would only ever have updated on the
     one-second ticker, not on each GPS fix. */
  const api = { onUpdate: () => {} };
  const onUpdate = (st) => api.onUpdate(st);
  const state = {
    activityId, sport,
    points: [],
    rejected: { accuracy: 0, speed: 0, stationary: 0, invalid: 0, 'out-of-range': 0 },
    distanceM: 0,
    startedAt: Date.now(),
    pausedMs: 0,
    paused: false,
    lastPauseAt: null,
    watchId: null,
    wakeLock: null,
    lastWriteAt: 0,
    error: null,
  };

  const handleFix = async (pos) => {
    if (state.paused) return;
    const c = pos.coords;
    const candidate = {
      lat: c.latitude, lon: c.longitude,
      accuracy: c.accuracy,
      altitude: Number.isFinite(c.altitude) ? c.altitude : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      at: pos.timestamp ?? Date.now(),
    };

    const verdict = acceptPoint(candidate, state.points[state.points.length - 1]);
    if (!verdict.accept) {
      if (verdict.reason in state.rejected) state.rejected[verdict.reason]++;
      onUpdate(state);
      return;
    }

    state.points.push(candidate);
    state.distanceM += verdict.distance ?? 0;

    /* Throttle writes to the configured sample interval. Writing every fix at
       1 Hz is fine; writing every fix when the device reports at 10 Hz is a lot
       of transactions for no extra information. */
    if (candidate.at - state.lastWriteAt >= GPS.sampleIntervalMs) {
      state.lastWriteAt = candidate.at;
      try {
        await RoutePoints.create({
          activityId, t: candidate.at,
          lat: candidate.lat, lon: candidate.lon,
          altitude: candidate.altitude, accuracy: candidate.accuracy,
          speed: candidate.speed,
        });
      } catch (err) {
        /* A failed write must not kill the recording — the in-memory track is
           still intact and the next write may well succeed. */
        console.warn('[gps] point write failed', err);
        state.error = 'Some points could not be saved. Storage may be full.';
      }
    }
    onUpdate(state);
  };

  const handleError = (err) => {
    state.error = err?.code === 1
      ? 'Location permission denied. Grant it in the browser site settings.'
      : err?.code === 3 ? 'No GPS fix yet. Open sky helps.'
      : (err?.message || 'Location unavailable.');
    onUpdate(state);
  };

  Object.assign(api, {
    state,

    async start() {
      if (!navigator.geolocation) throw new Error('This browser has no Geolocation API.');
      state.watchId = navigator.geolocation.watchPosition(handleFix, handleError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      });

      /* Wake Lock is the difference between a complete track and a truncated
         one, and it does not exist on iOS. Report the outcome either way. */
      if (GPS.requestWakeLock && 'wakeLock' in navigator) {
        try {
          state.wakeLock = await navigator.wakeLock.request('screen');
          state.wakeLock.addEventListener?.('release', () => { state.wakeLock = null; });
        } catch {
          state.wakeLock = null;
        }
      }
      onUpdate(state);
    },

    pause() {
      state.paused = true;
      state.lastPauseAt = Date.now();
      onUpdate(state);
    },

    resume() {
      if (state.lastPauseAt) state.pausedMs += Date.now() - state.lastPauseAt;
      state.lastPauseAt = null;
      state.paused = false;
      onUpdate(state);
    },

    async stop() {
      stopHudTicker();
      if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      try { await state.wakeLock?.release(); } catch { /* already gone */ }
      state.wakeLock = null;
      if (state.lastPauseAt) state.pausedMs += Date.now() - state.lastPauseAt;
      return state;
    },

    elapsedS() {
      const now = state.paused && state.lastPauseAt ? state.lastPauseAt : Date.now();
      return Math.max(0, Math.round((now - state.startedAt - state.pausedMs) / 1000));
    },
  });

  return api;
}

/* -------------------------------------------------------------- live HUD -- */

function liveView(activity) {
  const distance = el('strong', { class: 'hud-value' }, '0.00');
  const duration = el('strong', { class: 'hud-value' }, '0:00');
  const pace = el('strong', { class: 'hud-value' }, '—');
  const detail = el('p', { class: 'muted-sm' });
  const routeHost = el('div', { class: 'route-host' });
  const errorHost = el('div', {});

  const sport = SPORTS.find((s) => s.key === activity.sport) ?? SPORTS[0];

  const paint = (state) => {
    const secs = recorder?.elapsedS() ?? 0;
    distance.textContent = (state.distanceM / 1000).toFixed(2);
    duration.textContent = fmt.duration(Math.round(secs / 60)) || `${secs}s`;

    if (activity.sport === 'cycle') {
      const kmh = speedKmh(state.distanceM, secs);
      pace.textContent = kmh != null ? `${kmh}` : '—';
    } else {
      const p = paceSecPerKm(state.distanceM, secs);
      pace.textContent = p != null ? `${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}` : '—';
    }

    const dropped = Object.values(state.rejected).reduce((a, b) => a + b, 0);
    detail.textContent = [
      `${state.points.length} points`,
      dropped ? `${dropped} filtered` : null,
      state.wakeLock ? 'screen locked on' : 'screen may sleep',
      state.paused ? 'PAUSED' : null,
    ].filter(Boolean).join(' · ');

    clear(errorHost);
    if (state.error) errorHost.append(callout(state.error, { tone: 'alert' }));

    /* Redraw the route sparingly — every 5 points is plenty at walking or
       running speed and keeps the main thread free. */
    if (state.points.length >= 2 && state.points.length % 5 === 0) {
      drawRoute(routeHost, state.points, sport.colour);
    }
  };

  if (recorder) recorder.onUpdate = paint;

  const controls = el('div', { class: 'row-actions' },
    el('button', {
      class: 'btn',
      onclick: (e) => {
        if (!recorder) return;
        if (recorder.state.paused) { recorder.resume(); e.currentTarget.textContent = 'Pause'; }
        else { recorder.pause(); e.currentTarget.textContent = 'Resume'; }
      },
    }, 'Pause'),
    el('button', {
      class: 'btn btn-primary',
      onclick: async () => { await finishActivity(activity); },
    }, 'Finish'),
  );

  const node = card(`${sport.label} in progress`, { note: 'Recording' },
    el('div', { class: 'hud', style: tint(sport.colour) },
      el('div', { class: 'hud-cell' }, distance, el('span', { class: 'muted-sm' }, 'km')),
      el('div', { class: 'hud-cell' }, duration, el('span', { class: 'muted-sm' }, 'elapsed')),
      el('div', { class: 'hud-cell' }, pace,
        el('span', { class: 'muted-sm' }, activity.sport === 'cycle' ? 'km/h' : 'min/km')),
    ),
    routeHost, detail, errorHost, controls,
  );

  /* Repaint on a timer as well as on each fix, so the clock keeps moving while
     standing still waiting for a fix. */
  stopHudTicker();
  hudTicker = setInterval(() => {
    if (!recorder) { stopHudTicker(); return; }
    /* If the node is no longer in the document the user navigated away; stop
       rather than painting into a detached tree forever. */
    if (!node.isConnected) { stopHudTicker(); return; }
    paint(recorder.state);
  }, 1000);
  if (recorder) paint(recorder.state);

  return node;
}

function drawRoute(host, points, colour = 'performance') {
  const path = routePath(points, 320, 180);
  clear(host);
  if (!path) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${path.width} ${path.height}`);
  svg.setAttribute('class', 'route-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Route shape so far');

  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', path.d);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', colourVar(colour));
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);

  for (const [pt, fill, r] of [[path.start, 'var(--text-dim)', 3], [path.end, colourVar(colour), 4]]) {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
    dot.setAttribute('r', r); dot.setAttribute('fill', fill);
    svg.appendChild(dot);
  }
  host.appendChild(svg);
}

/* ----------------------------------------------------------- lifecycle --- */

async function startActivity(sport) {
  const caps = capabilities();
  if (!caps.map.geolocation?.supported) {
    toast('This browser has no geolocation.', { tone: 'crimson' });
    return;
  }

  const at = Date.now();
  const created = await Activities.create({ at, dateKey: dateKeyOf(at), sport, source: 'gps', startedAt: at });
  const id = created.id ?? created;
  await setSetting(ACTIVE_KEY, id);

  recorder = createRecorder({ activityId: id, sport });
  try {
    await recorder.start();
  } catch (err) {
    toast(err?.message ?? 'Could not start tracking.', { tone: 'crimson' });
    await Activities.remove(id);
    await setSetting(ACTIVE_KEY, null);
    recorder = null;
  }
  refresh();
}

async function finishActivity(activity) {
  const state = recorder ? await recorder.stop() : null;
  const stored = await db().routePoints.where('activityId').equals(activity.id).sortBy('t');
  const raw = stored.map((p) => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, accuracy: p.accuracy, at: p.t }));

  /* Discard an activity with nothing in it rather than leaving an empty record
     cluttering history. */
  if (raw.length < 2) {
    await Activities.remove(activity.id);
    await setSetting(ACTIVE_KEY, null);
    recorder = null;
    toast('No usable GPS points — activity discarded.', { tone: 'crimson' });
    refresh();
    return;
  }

  const processed = processTrack(raw);
  const timing = movingTime(processed.points);
  const lapList = splits(processed.points);

  await db().activities.update(activity.id, {
    endedAt: Date.now(),
    distanceM: processed.distanceM,
    durationS: timing.totalS,
    movingS: timing.movingS,
    elevationGainM: processed.elevation.gainM,
    elevationLossM: processed.elevation.lossM,
    pointCount: processed.keptCount,
    rejectedCount: Object.values(processed.rejected).reduce((a, b) => a + b, 0),
    paceSecPerKm: paceSecPerKm(processed.distanceM, timing.movingS),
    speedKmh: speedKmh(processed.distanceM, timing.movingS),
    wakeLockHeld: !!state?.wakeLock,
  });

  if (lapList.length) {
    await db().laps.bulkAdd(lapList.map((l) => ({ ...l, activityId: activity.id })));
  }

  await setSetting(ACTIVE_KEY, null);
  recorder = null;
  toast(`${(processed.distanceM / 1000).toFixed(2)} km saved.`);
  refresh();
}

/* -------------------------------------------------------------- history --- */

async function historyCard() {
  const rows = await db().activities.orderBy('at').reverse()
    .filter((a) => !a.deletedAt && a.endedAt).limit(12).toArray();

  if (!rows.length) {
    return card('Activities', {}, el('p', { class: 'muted-sm' }, 'Nothing recorded yet.'));
  }

  return card('Recent activities', { note: `${rows.length} shown` },
    ...rows.map((a) => {
      const sport = SPORTS.find((s) => s.key === a.sport) ?? SPORTS[0];
      return el('button', { class: 'entry entry-btn', onclick: () => openActivity(a) },
        el('div', { class: 'entry-main' },
          el('span', { class: 'entry-label' }, `${sport.label} · ${fmt.dayLabel(a.dateKey)}`),
          el('span', { class: 'muted-sm' }, [
            a.distanceM ? `${(a.distanceM / 1000).toFixed(2)} km` : null,
            a.movingS ? fmt.duration(Math.round(a.movingS / 60)) : null,
            a.paceSecPerKm ? `${Math.floor(a.paceSecPerKm / 60)}:${String(a.paceSecPerKm % 60).padStart(2, '0')} /km` : null,
            a.elevationGainM ? `↑${a.elevationGainM} m` : null,
            a.source === 'gpx' ? 'imported' : null,
          ].filter(Boolean).join(' · ')),
        ),
        el('span', { class: 'entry-value', style: { color: colourVar(sport.colour) } }, '›'),
      );
    }),
  );
}

async function openActivity(activity) {
  const stored = await db().routePoints.where('activityId').equals(activity.id).sortBy('t');
  const points = stored.map((p) => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, at: p.t }));
  const lapRows = await db().laps.where('activityId').equals(activity.id).sortBy('index');
  const routeHost = el('div', { class: 'route-host' });
  const sport = SPORTS.find((s) => s.key === activity.sport) ?? SPORTS[0];
  if (points.length >= 2) drawRoute(routeHost, points, sport.colour);

  const power = activity.sport === 'cycle' && activity.movingS && activity.distanceM
    ? estimatePower({ speedMps: activity.distanceM / activity.movingS })
    : null;

  sheet({
    title: `${sport.label} · ${fmt.dayLabel(activity.dateKey)}`,
    body: el('div', {},
      routeHost,
      el('div', { class: 'stat-grid' },
        ...[
          ['Distance', activity.distanceM ? `${(activity.distanceM / 1000).toFixed(2)} km` : '—'],
          ['Moving time', activity.movingS ? fmt.duration(Math.round(activity.movingS / 60)) : '—'],
          ['Total time', activity.durationS ? fmt.duration(Math.round(activity.durationS / 60)) : '—'],
          ['Climb', activity.elevationGainM != null ? `${activity.elevationGainM} m` : 'no altitude data'],
        ].map(([k, v]) => el('div', { class: 'stat-cell' },
          el('span', { class: 'muted-sm' }, k), el('strong', {}, v))),
      ),
      power ? callout(`Estimated average power ${power.watts} W. ${power.caveat}`, { tone: 'strength' }) : null,
      activity.rejectedCount
        ? el('p', { class: 'muted-sm' }, `${activity.rejectedCount} GPS points filtered out as noise.`)
        : null,
      activity.source === 'gps' && activity.wakeLockHeld === false
        ? callout('The screen was allowed to sleep during this activity, so the track may have gaps.',
                  { tone: 'nutrition' })
        : null,
      lapRows.length ? el('div', {},
        el('h3', { class: 'sub-head' }, 'Splits'),
        ...lapRows.map((l) => el('div', { class: 'entry' },
          el('div', { class: 'entry-main' },
            el('span', { class: 'entry-label' }, `km ${l.index}${l.partial ? ' (partial)' : ''}`),
            el('span', { class: 'muted-sm' }, `${(l.distanceM / 1000).toFixed(2)} km`),
          ),
          el('span', { class: 'entry-value' },
            l.paceSecPerKm ? `${Math.floor(l.paceSecPerKm / 60)}:${String(l.paceSecPerKm % 60).padStart(2, '0')}` : '—'),
        )),
      ) : null,
    ),
    footer: el('div', { class: 'row-actions' },
      el('button', {
        class: 'btn btn-sm',
        onclick: () => exportGpxFile(activity, points),
      }, 'Export GPX'),
      el('button', {
        class: 'btn btn-danger btn-sm',
        onclick: async () => {
          await Activities.remove(activity.id);
          toast('Activity deleted.', {
            action: { label: 'Undo', fn: async () => { await Activities.restore(activity.id); refresh(); } },
          });
          refresh();
        },
      }, 'Delete'),
    ),
  });
}

function exportGpxFile(activity, points) {
  if (points.length < 2) { toast('Not enough points to export.'); return; }
  const xml = buildGpx({
    name: `NoMeh ${activity.sport} ${activity.dateKey}`,
    points: points.map((p) => ({ ...p, at: p.at })),
  });
  const blob = new Blob([xml], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `nomeh-${activity.sport}-${activity.dateKey}.gpx` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('GPX exported.');
}

/* ---------------------------------------------------------- GPX import --- */

function openImport() {
  const input = el('input', { class: 'input', type: 'file', accept: '.gpx,application/gpx+xml,text/xml' });
  const sportSel = el('select', { class: 'input' }, ...SPORTS.map((s) => el('option', { value: s.key }, s.label)));
  const report = el('div', {});

  sheet({
    title: 'Import GPX',
    body: el('div', {},
      el('p', { class: 'muted-sm' },
        'A watch or another app can record what a browser cannot — background GPS with the screen off. ' +
        'Export a GPX from it and bring the route in here.'),
      field('File', input),
      field('Sport', sportSel),
      report,
    ),
    confirmLabel: 'Import',
    onConfirm: async () => {
      const file = input.files?.[0];
      if (!file) { toast('Choose a file.'); return false; }

      const text = await file.text();
      const parsed = parseGpx(text);
      if (!parsed.ok) {
        clear(report).append(callout(parsed.error, { tone: 'alert' }));
        return false;
      }

      const processed = processTrack(parsed.points.map((p) => ({ ...p, at: p.at ?? null })));
      const usable = parsed.points.filter((p) => Number.isFinite(p.at));
      const at = usable.length ? usable[0].at : Date.now();
      const timing = usable.length >= 2 ? movingTime(processed.points) : { totalS: 0, movingS: 0 };

      const created = await Activities.create({
        at, dateKey: dateKeyOf(at), sport: sportSel.value, source: 'gpx',
        name: parsed.name ?? file.name,
        startedAt: at, endedAt: usable.length ? usable[usable.length - 1].at : Date.now(),
        distanceM: processed.distanceM,
        durationS: timing.totalS, movingS: timing.movingS,
        elevationGainM: processed.elevation.gainM,
        elevationLossM: processed.elevation.lossM,
        pointCount: processed.keptCount,
        rejectedCount: Object.values(processed.rejected).reduce((a, b) => a + b, 0),
        paceSecPerKm: paceSecPerKm(processed.distanceM, timing.movingS),
        speedKmh: speedKmh(processed.distanceM, timing.movingS),
      });
      const activityId = created.id ?? created;

      /* bulkAdd in one call — a thousand individual adds inside a loop is the
         difference between instant and a visible freeze on a long ride. */
      await db().routePoints.bulkAdd(processed.points.map((p) => ({
        activityId, t: p.at ?? at, lat: p.lat, lon: p.lon,
        altitude: p.altitude ?? null, accuracy: null, speed: null,
      })));

      const lapList = splits(processed.points);
      if (lapList.length) await db().laps.bulkAdd(lapList.map((l) => ({ ...l, activityId })));

      toast(`Imported ${(processed.distanceM / 1000).toFixed(2)} km` +
            (parsed.warning ? ' (with gaps)' : '.'));
      refresh();
      return true;
    },
  });
}

/* ---------------------------------------------------------------- view --- */

export async function enduranceView() {
  stopHudTicker();

  if (!FEATURES.endurance) {
    return card('Endurance is switched off', {},
      el('p', { class: 'muted-sm' },
        'FEATURES.endurance is false in src/config/app.config.js.'));
  }

  const activeId = await getSetting(ACTIVE_KEY, null);
  if (activeId != null) {
    const activity = await db().activities.get(activeId);
    if (activity && !activity.endedAt) {
      /* Reload after a navigation away: the recorder is gone but the activity is
         still open, so offer to resume or close it rather than silently
         recording nothing. */
      if (!recorder) {
        return el('div', { class: 'stack' },
          card('Activity left open', { note: 'Not currently recording' },
            callout('This activity was still open when the page reloaded. GPS is not running. ' +
                    'Points recorded before the reload are safe.', { tone: 'nutrition' }),
            el('div', { class: 'row-actions' },
              el('button', {
                class: 'btn btn-primary',
                onclick: async () => {
                  recorder = createRecorder({ activityId: activity.id, sport: activity.sport });
                  await recorder.start();
                  refresh();
                },
              }, 'Resume recording'),
              el('button', {
                class: 'btn',
                onclick: () => finishActivity(activity),
              }, 'Close and save'),
            ),
          ),
          await historyCard(),
        );
      }
      return el('div', { class: 'stack' }, liveView(activity));
    }
    await setSetting(ACTIVE_KEY, null);
  }

  const caps = capabilities();
  const gpsCap = caps.map.geolocation;
  const wakeCap = caps.map.wakeLock;

  return el('div', { class: 'stack' },
    card('Record an activity', { note: gpsCap?.supported ? 'GPS ready' : 'GPS unavailable' },
      el('div', { class: 'chip-row' },
        ...SPORTS.map((s) => el('button', {
          class: 'chip chip-btn',
          disabled: !gpsCap?.supported,
          onclick: () => startActivity(s.key),
        }, s.label)),
      ),
      /* The honest warning, before the run rather than after it. */
      !wakeCap?.supported
        ? callout('Your browser cannot keep the screen awake, and GPS stops when the screen locks. ' +
                  'Keep the display on for the whole activity, or record on a watch and import the GPX.',
                  { tone: 'alert', strongText: 'Important: ' })
        : callout('Keep this screen open while recording. Browsers suspend GPS when the page is hidden.',
                  { tone: 'recovery' }),
      el('button', { class: 'btn btn-sm', onclick: openImport }, 'Import a GPX file'),
    ),
    await historyCard(),
    !gpsCap?.supported ? emptyState({
      title: 'No geolocation in this browser',
      message: gpsCap?.note ?? 'GPS needs a secure (HTTPS) origin and a browser that supports it. GPX import still works.',
    }) : null,
  );
}
