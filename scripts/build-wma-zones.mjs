// Digitizes a WMA's internal hunt zones (Zone A gray / Zone B tan) from the official 2026-27 permit map, because
// ADCNR publishes no zone GIS. The permit PDF is rendered with macOS `sips`, georeferenced from the map's lat/long
// ticks, then the georeference is refined by fitting the map's zone-coloured area to the ADCNR WMA boundary
// polygon (IoU is printed — the fit is the check). Inside the WMA, every cell takes the zone colour under it;
// cells hidden by roads, labels or symbols take their neighbours' zone. Output: <region>/wma-zones.geojson with one
// MultiPolygon per zone. Derived, not official — the app shows an uncertainty band along the A/B line.
// Usage: REGION=choccolocco node scripts/build-wma-zones.mjs
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PNG } from 'pngjs';
import * as turf from '@turf/turf';
import { contours as d3contours } from 'd3-contour';
import { BBOX, RAW, OUT, REGION_ID } from './config.mjs';

// Initial georeference read off the printed ticks, in pixels of a 5000-px-wide render: lon = a + (x - x0) / kx, lat = b - (y - y0) / ky (degrees).
const GEOREF = {
  // ticks: −85°41′ at x 1972 … −85°35′ at x 3188 (202.7 px/′); 33°49′ at y 417 … 33°44′ at y 1628 (242.2 px/′)
  choccolocco: { x0: 1972, lon0: -(85 + 41 / 60), kx: 202.7 * 60, y0: 417, lat0: 33 + 49 / 60, ky: 242.2 * 60 },
  // ticks (1959-px render ×2.552): −86°13′ at x 83, −86°2′ at x 1345; 33°16′ at y 88, 33°8′ at y 1170
  hollins: { x0: 83 * 2.552, lon0: -(86 + 13 / 60), kx: ((1345 - 83) / 11) * 2.552 * 60, y0: 88 * 2.552, lat0: 33 + 16 / 60, ky: ((1170 - 88) / 8) * 2.552 * 60 },
}[REGION_ID];
if (!GEOREF) throw new Error(`No zone map for ${REGION_ID}`);

const pdf = path.join(RAW, 'permit-2026-27.pdf');
const pngPath = path.join(RAW, 'permit-2026-27.png');
try { await fs.access(pngPath); } catch { execFileSync('sips', ['-s', 'format', 'png', '-Z', '5000', pdf, '--out', pngPath]); }
const png = PNG.sync.read(await fs.readFile(pngPath));

// pixel class: 1 = Zone A (gray), 2 = Zone B (tan), 0 = anything else (hatching, symbols and roads get filled from neighbours)
function classAt(x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 0;
  const i = (y * png.width + x) * 4, r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
  if (r - b > 50 && r > 150 && g > 140 && r - g < 45) return 2;
  if (Math.abs(r - b) < 16 && Math.abs(r - g) < 10 && r > 120 && r < 200) return 1;
  return 0;
}

const CELL = 0.0004;
const W = Math.round((BBOX[2] - BBOX[0]) / CELL), H = Math.round((BBOX[3] - BBOX[1]) / CELL);
const lonOf = (x) => BBOX[0] + (x + 0.5) * CELL, latOf = (y) => BBOX[3] - (y + 0.5) * CELL;
const wma = JSON.parse(await fs.readFile(path.join(OUT, 'wma.geojson'), 'utf8'));
const inWma = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wma.features.some((f) => turf.booleanPointInPolygon([lonOf(x), latOf(y)], f))) inWma[y * W + x] = 1;

function classify(g, step = 1) {
  const cls = new Uint8Array(W * H);
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
    const px = g.x0 + (lonOf(x) - g.lon0) * g.kx, py = g.y0 + (g.lat0 - latOf(y)) * g.ky;
    const votes = [0, 0, 0];
    for (const [dx, dy] of [[0, 0], [-3, 0], [3, 0], [0, -3], [0, 3]]) votes[classAt(px + dx, py + dy)]++;
    cls[y * W + x] = votes[2] >= 2 && votes[2] >= votes[1] ? 2 : votes[1] >= 2 ? 1 : 0;
  }
  return cls;
}
function iou(g, step) {
  const cls = classify(g, step);
  let both = 0, either = 0;
  for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) { const i = y * W + x, a = cls[i] > 0, b = inWma[i] === 1; if (a && b) both++; if (a || b) either++; }
  return both / either;
}

// refine: coordinate search over offset and scale
let g = { ...GEOREF }, best = iou(g, 3);
console.log('initial IoU', best.toFixed(3));
for (const [key, steps] of [['x0', [40, 20, 10, 5, 2]], ['y0', [40, 20, 10, 5, 2]], ['kx', [0.02, 0.01, 0.005]], ['ky', [0.02, 0.01, 0.005]], ['x0', [4, 2, 1]], ['y0', [4, 2, 1]]]) {
  for (const s of steps) {
    for (let improved = true; improved;) {
      improved = false;
      for (const sign of [1, -1]) {
        const t = { ...g, [key]: key.startsWith('k') ? g[key] * (1 + sign * s) : g[key] + sign * s };
        const v = iou(t, 3);
        if (v > best + 1e-4) { best = v; g = t; improved = true; }
      }
    }
  }
}
{
  const c = classify(g, 1);
  let tp = 0, fp = 0, fn = 0;
  const dbg = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const a = c[i] > 0, b = inWma[i] === 1;
    if (a && b) tp++; else if (a) fp++; else if (b) fn++;
    dbg.data.set(b ? (c[i] === 2 ? [220, 180, 120, 255] : c[i] === 1 ? [150, 150, 150, 255] : [0, 0, 0, 255]) : a ? [220, 30, 30, 255] : [255, 255, 255, 255], i * 4);
  }
  console.log('precision', (tp / (tp + fp)).toFixed(3), 'recall', (tp / (tp + fn)).toFixed(3));
  if (process.env.DEBUG_PNG) await fs.writeFile(process.env.DEBUG_PNG, PNG.sync.write(dbg));
}
console.log('fitted IoU', iou(g, 1).toFixed(3), 'shift px', (g.x0 - GEOREF.x0).toFixed(1), (g.y0 - GEOREF.y0).toFixed(1), 'scale', (g.kx / GEOREF.kx).toFixed(4), (g.ky / GEOREF.ky).toFixed(4));

// inside the WMA: fill unclassified cells from their neighbours (roads, labels, symbols), then smooth
const cls = classify(g, 1);
const zone = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (inWma[i]) zone[i] = cls[i];
for (let pass = 0, left = 1; left && pass < 200; pass++) {
  left = 0;
  const next = zone.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!inWma[i] || zone[i]) continue;
    const v = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) v[zone[yy * W + xx]]++; }
    if (v[1] || v[2]) next[i] = v[2] > v[1] ? 2 : 1; else left++;
  }
  zone.set(next);
}
for (let pass = 0; pass < 2; pass++) { // majority filter removes speckle (hatching, small symbols)
  const next = zone.slice();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (!zone[i]) continue;
    let a = 0, b = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const z = zone[yy * W + xx]; if (z === 1) a++; else if (z === 2) b++; }
    next[i] = b > a ? 2 : 1;
  }
  zone.set(next);
}
// islands under ~10 ha that touch the other zone are map speckle (a symbol, a label): they join the zone around them
{
  const seen = new Uint8Array(W * H);
  let flipped = 0;
  for (let i0 = 0; i0 < W * H; i0++) {
    if (!zone[i0] || seen[i0]) continue;
    const z = zone[i0], cells = [i0], touches = [0, 0, 0];
    seen[i0] = 1;
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (zone[j] === z) { if (!seen[j]) { seen[j] = 1; cells.push(j); } } else touches[zone[j]]++;
      }
    }
    const other = z === 1 ? 2 : 1;
    if (cells.length < 60 && touches[other] > 0) { for (const c of cells) zone[c] = other; flipped += cells.length; }
  }
  console.log('speckle cells merged', flipped);
}
const counts = [0, 0, 0];
for (let i = 0; i < W * H; i++) counts[zone[i]]++;
console.log('cells A', counts[1], 'B', counts[2]);

const feats = [];
for (const z of [1, 2]) {
  const values = Array.from(zone, (v) => (v === z ? 1 : 0));
  const [c] = d3contours().size([W, H]).thresholds([0.5])(values);
  const coords = c.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [+(BBOX[0] + x * CELL).toFixed(5), +(BBOX[3] - y * CELL).toFixed(5)])));
  const mp = turf.simplify(turf.multiPolygon(coords), { tolerance: 0.00015 });
  feats.push({ ...mp, properties: { zone: z === 1 ? 'A' : 'B', source: `Digitized from the 2026-27 ${REGION_ID} WMA permit map (derived, not official)` } });
}
await fs.writeFile(path.join(OUT, 'wma-zones.geojson'), JSON.stringify(turf.featureCollection(feats)));
console.log('wrote', path.join(OUT, 'wma-zones.geojson'));
