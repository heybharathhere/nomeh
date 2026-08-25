/* Geo engine. Pure functions — no DOM, no geolocation calls, no database.
 *
 * The actual `watchPosition` plumbing lives in features/endurance.js. Keeping
 * the mathematics separate is what makes it testable: a GPS trace is exactly
 * the kind of noisy input where an untested filter quietly produces a route
 * that is 8% too long and nobody notices for a year.
 *
 * Every filter here exists because of a specific real failure:
 *   - accuracy gate    → a cold fix reporting ±2 km as if it were a position
 *   - minimum movement → a phone on a table accumulating "distance" while still
 *   - speed gate       → a tower handoff teleporting you 400 m sideways
 *   - elevation gate   → barometric noise turning a flat run into 300 m of climb
 */

import { GPS } from '../config/app.config.js';

const round = (n, dp = 0) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const EARTH_R = 6371008.8;   // metres, IUGG mean radius
const rad = (d) => (d * Math.PI) / 180;

/* ------------------------------------------------------------- distance --- */

export function haversine(a, b) {
  if (!a || !b) return 0;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  if (!a || !b) return null;
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

/* ----------------------------------------------------------- filtering --- */

/* Decides whether to keep a new fix. Returns a reason when rejecting, because
   "GPS is bad today" is not debuggable but "37 points dropped for accuracy" is.
   The live HUD shows the rejection count. */
export function acceptPoint(candidate, previous, opts = {}) {
  const cfg = { ...GPS, ...opts };
  if (!candidate || !Number.isFinite(candidate.lat) || !Number.isFinite(candidate.lon)) {
    return { accept: false, reason: 'invalid' };
  }
  if (Math.abs(candidate.lat) > 90 || Math.abs(candidate.lon) > 180) {
    return { accept: false, reason: 'out-of-range' };
  }
  if (candidate.accuracy != null && candidate.accuracy > cfg.accuracyLimitM) {
    return { accept: false, reason: 'accuracy' };
  }
  if (!previous) return { accept: true, distance: 0 };

  const distance = haversine(previous, candidate);
  const dt = ((candidate.at ?? 0) - (previous.at ?? 0)) / 1000;

  if (dt > 0) {
    const speed = distance / dt;
    if (speed > cfg.maxSpeedMps) return { accept: false, reason: 'speed', speed: round(speed, 2) };
  }
  /* Below the movement threshold the point is real but adds only noise, so it
     is dropped from the distance total without being counted as an error. */
  if (distance < cfg.minMoveM) return { accept: false, reason: 'stationary', distance: round(distance, 2) };

  return { accept: true, distance: round(distance, 2), speed: dt > 0 ? round(distance / dt, 2) : null };
}

/* Exponential smoothing on latitude and longitude. Cheap, stable, and good
   enough — a full Kalman filter needs a motion model the browser cannot give
   us reliably, and would be false precision here. */
export function smoothTrack(points = [], alpha = GPS.smoothing) {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const prev = out[i - 1], cur = points[i];
    out.push({
      ...cur,
      lat: prev.lat + alpha * (cur.lat - prev.lat),
      lon: prev.lon + alpha * (cur.lon - prev.lon),
    });
  }
  return out;
}

/* Runs a raw fix list through the whole pipeline and reports what it did. */
export function processTrack(raw = [], opts = {}) {
  const cfg = { ...GPS, ...opts };
  const kept = [];
  const rejected = { accuracy: 0, speed: 0, stationary: 0, invalid: 0, 'out-of-range': 0 };
  let distance = 0;

  for (const p of raw) {
    const verdict = acceptPoint(p, kept[kept.length - 1], cfg);
    if (verdict.accept) {
      kept.push({ ...p });
      distance += verdict.distance ?? 0;
    } else if (verdict.reason in rejected) {
      rejected[verdict.reason]++;
    }
  }

  const smoothed = smoothTrack(kept, cfg.smoothing);
  return {
    points: smoothed,
    rawCount: raw.length,
    keptCount: kept.length,
    rejected,
    distanceM: round(distance, 1),
    elevation: elevationProfile(smoothed, cfg.elevationThresholdM),
    duration: kept.length >= 2 ? Math.round(((kept[kept.length - 1].at ?? 0) - (kept[0].at ?? 0)) / 1000) : 0,
  };
}

/* -------------------------------------------------------------- climbing --- */

export function elevationProfile(points = [], thresholdM = GPS.elevationThresholdM) {
  const withAlt = points.filter((p) => Number.isFinite(p.altitude));
  if (withAlt.length < 2) return { gainM: null, lossM: null, minM: null, maxM: null, samples: withAlt.length };

  let gain = 0, loss = 0, anchor = withAlt[0].altitude;
  for (const p of withAlt.slice(1)) {
    const delta = p.altitude - anchor;
    /* Only commit a change once it exceeds the noise floor. Accumulating every
       jitter is what produces a 300 m climb on a flat park loop. */
    if (Math.abs(delta) >= thresholdM) {
      if (delta > 0) gain += delta; else loss += -delta;
      anchor = p.altitude;
    }
  }
  const alts = withAlt.map((p) => p.altitude);
  return {
    gainM: round(gain), lossM: round(loss),
    minM: round(Math.min(...alts)), maxM: round(Math.max(...alts)),
    samples: withAlt.length,
  };
}

/* ---------------------------------------------------------------- splits --- */

export function splits(points = [], everyM = GPS.splitDistanceM) {
  if (points.length < 2 || !(everyM > 0)) return [];
  const out = [];
  let acc = 0, startAt = points[0].at, index = 1, lastAt = points[0].at;
  let altStart = points[0].altitude ?? null;

  for (let i = 1; i < points.length; i++) {
    acc += haversine(points[i - 1], points[i]);
    lastAt = points[i].at;
    if (acc >= everyM) {
      const seconds = Math.round((lastAt - startAt) / 1000);
      out.push({
        index: index++,
        distanceM: round(acc),
        seconds,
        paceSecPerKm: acc > 0 ? Math.round(seconds / (acc / 1000)) : null,
        elevationDeltaM: altStart != null && points[i].altitude != null
          ? round(points[i].altitude - altStart) : null,
      });
      acc = 0; startAt = lastAt; altStart = points[i].altitude ?? null;
    }
  }
  /* The trailing partial split is reported, flagged, so a 5.3 km run does not
     silently lose 300 m. */
  if (acc > 0) {
    const seconds = Math.round((lastAt - startAt) / 1000);
    out.push({
      index, distanceM: round(acc), seconds, partial: true,
      paceSecPerKm: acc > 0 ? Math.round(seconds / (acc / 1000)) : null,
      elevationDeltaM: null,
    });
  }
  return out;
}

export function paceSecPerKm(distanceM, seconds) {
  if (!(distanceM > 0) || !(seconds > 0)) return null;
  return Math.round(seconds / (distanceM / 1000));
}

export function speedKmh(distanceM, seconds) {
  if (!(distanceM > 0) || !(seconds > 0)) return null;
  return round((distanceM / 1000) / (seconds / 3600), 2);
}

/* Moving time excludes auto-detected stops, which is what makes a pace figure
   comparable between a park run and a city run full of traffic lights. */
export function movingTime(points = [], opts = {}) {
  const cfg = { ...GPS, ...opts };
  if (points.length < 2) return { totalS: 0, movingS: 0, stoppedS: 0 };
  let total = 0, stopped = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = ((points[i].at ?? 0) - (points[i - 1].at ?? 0)) / 1000;
    if (dt <= 0 || dt > 300) continue;   // gap: phone slept, do not count it either way
    total += dt;
    const speed = haversine(points[i - 1], points[i]) / dt;
    if (speed < cfg.autoPauseBelowMps) stopped += dt;
  }
  return { totalS: Math.round(total), movingS: Math.round(total - stopped), stoppedS: Math.round(stopped) };
}

/* --------------------------------------------------------- cycling power --- */

/* A physics estimate, not a power meter. Every term is an assumption and the UI
   says so — but for tracking your own progress on the same hill it is far
   better than nothing, and it costs no hardware. */
export function estimatePower({ speedMps, gradient = 0, riderKg = 75, bikeKg = 9,
                                crr = 0.005, cda = 0.32, airDensity = 1.225, drivetrain = 0.975 }) {
  if (!(speedMps > 0)) return null;
  const g = 9.80665;
  const mass = riderKg + bikeKg;
  const rolling = crr * mass * g * Math.cos(Math.atan(gradient)) * speedMps;
  const climbing = mass * g * Math.sin(Math.atan(gradient)) * speedMps;
  const aero = 0.5 * airDensity * cda * speedMps ** 3;
  const total = (rolling + climbing + aero) / drivetrain;
  if (!Number.isFinite(total)) return null;
  return {
    watts: round(Math.max(0, total)),
    breakdown: { rolling: round(Math.max(0, rolling)), climbing: round(climbing), aero: round(aero) },
    caveat: 'Physics estimate from speed and gradient. Assumes no wind and typical drag — ' +
            'useful for comparing your own efforts, not for comparing against anyone else.',
  };
}

/* Functional threshold power from a 20-minute effort — the standard 95% rule. */
export function ftpFrom20min(watts) {
  if (!(watts > 0)) return null;
  return round(watts * 0.95);
}

/* ------------------------------------------------------------------- GPX --- */

/* Parsing uses DOMParser where available and a regex fallback in Node, so the
   test suite can exercise it headlessly. GPX is simple enough that the fallback
   is honest rather than a shortcut. */
export function parseGpx(xml) {
  if (typeof xml !== 'string' || !xml.includes('<trkpt') && !xml.includes('<rtept')) {
    return { ok: false, error: 'No track points found. Is this a GPX file?', points: [] };
  }

  const points = [];
  let name = null;

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) return { ok: false, error: 'Malformed XML.', points: [] };
    name = doc.querySelector('trk > name, metadata > name')?.textContent?.trim() || null;
    for (const pt of doc.querySelectorAll('trkpt, rtept')) {
      const lat = parseFloat(pt.getAttribute('lat'));
      const lon = parseFloat(pt.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const time = pt.querySelector('time')?.textContent;
      const ele = pt.querySelector('ele')?.textContent;
      const hr = pt.querySelector('hr, gpxtpx\\:hr')?.textContent
              ?? pt.getElementsByTagName('gpxtpx:hr')[0]?.textContent;
      points.push({
        lat, lon,
        at: time ? Date.parse(time) : null,
        altitude: ele != null ? parseFloat(ele) : null,
        heartRate: hr != null ? parseInt(hr, 10) : null,
      });
    }
  } else {
    name = xml.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() || null;
    const re = /<(?:trkpt|rtept)[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/(?:trkpt|rtept)>|<(?:trkpt|rtept)[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"[^>]*\/>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const lat = parseFloat(m[1] ?? m[4]);
      const lon = parseFloat(m[2] ?? m[5]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const inner = m[3] ?? '';
      const time = inner.match(/<time>([^<]+)<\/time>/)?.[1];
      const ele = inner.match(/<ele>([^<]+)<\/ele>/)?.[1];
      const hr = inner.match(/<(?:gpxtpx:)?hr>(\d+)<\/(?:gpxtpx:)?hr>/)?.[1];
      points.push({
        lat, lon,
        at: time ? Date.parse(time) : null,
        altitude: ele != null ? parseFloat(ele) : null,
        heartRate: hr != null ? parseInt(hr, 10) : null,
      });
    }
  }

  if (!points.length) return { ok: false, error: 'No usable coordinates in the file.', points: [] };

  /* A file with no timestamps still has a valid route, so it is accepted with
     the limitation stated rather than rejected. */
  const timed = points.filter((p) => Number.isFinite(p.at));
  return {
    ok: true, name, points,
    hasTime: timed.length === points.length,
    warning: timed.length !== points.length
      ? 'Some points have no timestamp, so pace and duration cannot be computed for the whole route.'
      : null,
  };
}

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function buildGpx({ name = 'NoMeh! activity', points = [], creator = 'NoMeh!' }) {
  const rows = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => {
      const parts = [`      <trkpt lat="${p.lat}" lon="${p.lon}">`];
      if (Number.isFinite(p.altitude)) parts.push(`        <ele>${round(p.altitude, 1)}</ele>`);
      if (Number.isFinite(p.at)) parts.push(`        <time>${new Date(p.at).toISOString()}</time>`);
      if (Number.isFinite(p.heartRate)) {
        parts.push('        <extensions><gpxtpx:TrackPointExtension>' +
                   `<gpxtpx:hr>${Math.round(p.heartRate)}</gpxtpx:hr>` +
                   '</gpxtpx:TrackPointExtension></extensions>');
      }
      parts.push('      </trkpt>');
      return parts.join('\n');
    }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${esc(creator)}"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${rows}
    </trkseg>
  </trk>
</gpx>
`;
}

/* ------------------------------------------------------- route rendering --- */

/* Projects a track into an SVG path. Equirectangular with a cosine correction —
   accurate enough at the scale of a single activity, and it needs no map tiles,
   no API key and no network. */
export function routePath(points = [], width = 320, height = 200, pad = 12) {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length < 2) return null;

  const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const midLat = (minLat + maxLat) / 2;
  const kx = Math.cos(rad(midLat));

  const spanX = Math.max((maxLon - minLon) * kx, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  /* One scale for both axes, so the route keeps its real shape instead of being
     stretched to fill the box. */
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;

  const project = (p) => [
    round(offX + (p.lon - minLon) * kx * scale, 2),
    round(offY + (maxLat - p.lat) * scale, 2),
  ];

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${project(p).join(' ')}`).join(' ');
  const [sx, sy] = project(pts[0]);
  const [ex, ey] = project(pts[pts.length - 1]);
  return {
    d, start: { x: sx, y: sy }, end: { x: ex, y: ey },
    bounds: { minLat, maxLat, minLon, maxLon },
    width, height,
  };
}
