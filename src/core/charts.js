/* SVG charts, hand-rolled.
 *
 * WHY NOT A LIBRARY
 *   The app ships with no build step, so a charting library means either a CDN
 *   dependency on every page load or a vendored bundle larger than the entire
 *   rest of the app. These four chart types cover everything the spec asks for,
 *   and they inherit theme colours automatically because they draw with CSS
 *   variables — a recolour needs no chart changes.
 *
 * GAPS ARE NOT ZEROS
 *   A day with no weight logged is not a day you weighed zero. Every function
 *   here takes null to mean absent and breaks the line rather than plunging it
 *   to the axis. That single distinction is the difference between a chart that
 *   informs and one that lies.
 */

import { colourVar } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  return node;
};

const nice = (v) => {
  /* Round an axis bound to something a human would choose. */
  if (!Number.isFinite(v) || v === 0) return 0;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(v)));
  return Math.ceil(v / mag) * mag;
};

/* --------------------------------------------------------------- line ----- */

/* series: [{ label, colour, points: [{ x, y|null }] }]
   x is treated as an ordinal index, which is right for daily data. */
export function lineChart({
  series = [], width = 320, height = 160, pad = { t: 10, r: 8, b: 20, l: 34 },
  yMin = null, yMax = null, showAxis = true, ariaLabel = 'Chart',
} = {}) {
  const all = series.flatMap((s) => s.points.filter((p) => p.y != null).map((p) => p.y));
  if (!all.length) return null;

  const lo = yMin ?? Math.min(...all);
  const hi = yMax ?? Math.max(...all);
  /* A flat series would give a zero-height plot area and divide by zero. */
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;
  const padded = { lo: lo - span * 0.08, hi: hi + span * 0.08 };

  const count = Math.max(...series.map((s) => s.points.length), 1);
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const xAt = (i) => pad.l + (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const yAt = (v) => pad.t + plotH - ((v - padded.lo) / (padded.hi - padded.lo)) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart',
    role: 'img', 'aria-label': ariaLabel,
  });

  if (showAxis) {
    for (const frac of [0, 0.5, 1]) {
      const value = padded.lo + (padded.hi - padded.lo) * (1 - frac);
      const y = pad.t + plotH * frac;
      svg.appendChild(svgEl('line', {
        x1: pad.l, y1: y, x2: width - pad.r, y2: y,
        stroke: 'var(--line)', 'stroke-width': 1,
      }));
      const text = svgEl('text', {
        x: pad.l - 5, y: y + 3, fill: 'var(--text-faint)',
        'font-size': '9', 'text-anchor': 'end',
      });
      text.textContent = Math.abs(value) >= 100 ? Math.round(value) : value.toFixed(1);
      svg.appendChild(text);
    }
  }

  for (const s of series) {
    const colour = colourVar(s.colour ?? 'performance');

    /* Split into contiguous runs so a missing day breaks the line instead of
       being interpolated through. */
    const runs = [];
    let run = [];
    s.points.forEach((p, i) => {
      if (p.y == null) { if (run.length) runs.push(run); run = []; return; }
      run.push({ x: xAt(i), y: yAt(p.y) });
    });
    if (run.length) runs.push(run);

    for (const r of runs) {
      if (r.length === 1) {
        svg.appendChild(svgEl('circle', { cx: r[0].x, cy: r[0].y, r: 2.5, fill: colour }));
        continue;
      }
      svg.appendChild(svgEl('path', {
        d: r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
        fill: 'none', stroke: colour, 'stroke-width': s.width ?? 2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'stroke-dasharray': s.dashed ? '4 3' : null,
      }));
    }

    /* Mark the latest actual reading — the one the user came to see. */
    const last = [...s.points].reverse().find((p) => p.y != null);
    if (last) {
      const idx = s.points.lastIndexOf(last);
      svg.appendChild(svgEl('circle', { cx: xAt(idx), cy: yAt(last.y), r: 3, fill: colour }));
    }
  }

  return svg;
}

/* ---------------------------------------------------------------- bar ----- */

export function barChart({
  bars = [], width = 320, height = 140, pad = { t: 10, r: 8, b: 22, l: 34 },
  target = null, ariaLabel = 'Chart',
} = {}) {
  const values = bars.map((b) => Number(b.value) || 0);
  if (!values.length) return null;
  const hi = nice(Math.max(...values, target ?? 0)) || 1;

  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const gap = bars.length > 40 ? 0.5 : 2;
  const bw = Math.max(1, plotW / bars.length - gap);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': ariaLabel,
  });

  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: pad.t + plotH, x2: width - pad.r, y2: pad.t + plotH,
    stroke: 'var(--line)', 'stroke-width': 1,
  }));

  if (target > 0 && target <= hi) {
    const y = pad.t + plotH - (target / hi) * plotH;
    svg.appendChild(svgEl('line', {
      x1: pad.l, y1: y, x2: width - pad.r, y2: y,
      stroke: 'var(--text-faint)', 'stroke-width': 1, 'stroke-dasharray': '3 3',
    }));
  }

  const label = svgEl('text', {
    x: pad.l - 5, y: pad.t + 8, fill: 'var(--text-faint)', 'font-size': '9', 'text-anchor': 'end',
  });
  label.textContent = hi >= 1000 ? `${Math.round(hi / 1000)}k` : String(Math.round(hi));
  svg.appendChild(label);

  bars.forEach((b, i) => {
    const v = Number(b.value) || 0;
    const h = Math.max(v > 0 ? 1 : 0, (v / hi) * plotH);
    const x = pad.l + i * (bw + gap);
    const rect = svgEl('rect', {
      x: x.toFixed(1), y: (pad.t + plotH - h).toFixed(1),
      width: bw.toFixed(1), height: h.toFixed(1), rx: Math.min(2, bw / 3),
      fill: colourVar(b.colour ?? 'performance'),
      opacity: b.faded ? 0.45 : 1,
    });
    if (b.label) {
      const title = svgEl('title');
      title.textContent = `${b.label}: ${v}`;
      rect.appendChild(title);
    }
    svg.appendChild(rect);
  });

  return svg;
}

/* ------------------------------------------------------------- stacked ---- */

/* For macro composition over time: each bar is split into segments. */
export function stackedBarChart({
  rows = [], keys = [], colours = {}, width = 320, height = 150,
  pad = { t: 10, r: 8, b: 22, l: 34 }, ariaLabel = 'Chart',
} = {}) {
  if (!rows.length || !keys.length) return null;
  const totals = rows.map((r) => keys.reduce((s, k) => s + (Number(r[k]) || 0), 0));
  const hi = nice(Math.max(...totals)) || 1;

  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const gap = rows.length > 40 ? 0.5 : 2;
  const bw = Math.max(1, plotW / rows.length - gap);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': ariaLabel,
  });
  svg.appendChild(svgEl('line', {
    x1: pad.l, y1: pad.t + plotH, x2: width - pad.r, y2: pad.t + plotH,
    stroke: 'var(--line)', 'stroke-width': 1,
  }));

  rows.forEach((row, i) => {
    let yCursor = pad.t + plotH;
    const x = pad.l + i * (bw + gap);
    for (const k of keys) {
      const v = Number(row[k]) || 0;
      if (v <= 0) continue;
      const h = (v / hi) * plotH;
      yCursor -= h;
      svg.appendChild(svgEl('rect', {
        x: x.toFixed(1), y: yCursor.toFixed(1),
        width: bw.toFixed(1), height: h.toFixed(1),
        fill: colourVar(colours[k] ?? 'performance'),
      }));
    }
  });

  return svg;
}

/* -------------------------------------------------------------- legend ---- */

export function legend(items = []) {
  const host = document.createElement('div');
  host.className = 'chart-legend';
  for (const it of items) {
    const row = document.createElement('span');
    row.className = 'legend-item';
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = colourVar(it.colour ?? 'performance');
    const label = document.createElement('span');
    label.textContent = it.label;
    row.append(sw, label);
    host.append(row);
  }
  return host;
}

/* ------------------------------------------------------------ sparkline --- */

/* Minimal, axis-free, for inline use inside a card. */
export function sparkline(values = [], { width = 120, height = 32, colour = 'performance' } = {}) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (nums.length < 2) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi - lo || 1;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'chart', 'aria-hidden': 'true',
  });
  const pts = values.map((v, i) => {
    if (v == null) return null;
    return {
      x: (i / Math.max(1, values.length - 1)) * width,
      y: height - ((v - lo) / span) * (height - 4) - 2,
    };
  });

  let run = [];
  const runs = [];
  for (const p of pts) { if (!p) { if (run.length) runs.push(run); run = []; } else run.push(p); }
  if (run.length) runs.push(run);

  for (const r of runs) {
    if (r.length < 2) continue;
    svg.appendChild(svgEl('path', {
      d: r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
      fill: 'none', stroke: colourVar(colour), 'stroke-width': 1.8, 'stroke-linecap': 'round',
    }));
  }
  return svg;
}
