// Terrain + habitat preprocessing for the private-club study box (scripts/config.mjs CLUB_BBOX).
// Same method and thresholds as scripts/build-terrain.mjs (terrain-1.2.0), with two differences:
//   1. TPI is standardized to this box's own spread (set TPI_REF=bankhead to use the Bankhead DEM statistics from scripts/lib/tpi-ref.mjs).
//   2. No public-land gating and no candidate polygons are written here. Zones are generated in the browser,
//      inside the boundary that only exists on the user's device, so nothing in this output identifies the club.
// Outputs (public/data/club/): grid.bin.gz + grid.json, roads.geojson, streams.geojson, contours.geojson,
//   slope.png, disturbance.png, meta.json
// Usage: node scripts/build-club.mjs   (keep in sync with build-terrain.mjs when the terrain rules change)
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromArrayBuffer } from 'geotiff';
import { PNG } from 'pngjs';
import zlib from 'node:zlib';
import { contours as d3contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { overpass } from './lib/overpass.mjs';
import { tpiReference } from './lib/tpi-ref.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'public', 'data', 'club');
await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(RAW, { recursive: true });
import { CLUB_BBOX as BBOX } from './config.mjs';
const W = Math.round((BBOX[2] - BBOX[0]) * 3600);
const H = Math.round((BBOX[3] - BBOX[1]) * 3600); // 1 arc-second grid
const DEG = 1 / 3600;
export const ALGORITHM_VERSION = 'terrain-1.2.0';
// Only needed for TPI_REF=bankhead (needs the Bankhead DEM from `npm run data`); the default standardizes to this box.
const REF = process.env.TPI_REF === 'bankhead' ? await tpiReference() : null;

const sources = [];

async function download(id, url, file, meta) {
  const dest = path.join(RAW, file);
  try {
    await fs.access(dest);
  } catch {
    const j = await (await fetch(url + '&f=json', { signal: AbortSignal.timeout(120_000) })).json();
    if (!j.href) throw new Error(`${id}: ${JSON.stringify(j).slice(0, 300)}`);
    const buf = Buffer.from(await (await fetch(j.href)).arrayBuffer());
    await fs.writeFile(dest, buf);
  }
  const buf = await fs.readFile(dest);
  sources.push({ id, ...meta, url, retrieved: (await fs.stat(dest)).mtime.toISOString(), checksum: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), quality: 'retrieved', coverage: `bbox ${BBOX.join(',')}` });
  const tiff = await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const img = await tiff.getImage();
  if (img.getWidth() !== W || img.getHeight() !== H) throw new Error(`${id}: unexpected size ${img.getWidth()}x${img.getHeight()}`);
  const [r] = await img.readRasters();
  return r;
}

const bboxQ = `bbox=${BBOX.join(',')}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=tiff`;
const dem = await download(
  'usgs-3dep-dem',
  `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${bboxQ}&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation`,
  'club_dem_1arcsec.tif',
  { agency: 'USGS National Map', title: '3DEP Elevation (resampled to 1 arc-second ≈ 26×31 m)', resolution: '1 arc-second grid (~26 m E-W × 31 m N-S)', usage: 'Public domain' },
);
const evt = await download(
  'landfire-lf2024-evt',
  `https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer/exportImage?${bboxQ}&pixelType=S16&interpolation=RSP_NearestNeighbor`,
  'club_evt_lf2024.tif',
  { agency: 'USGS / USFS LANDFIRE', title: 'LF2024 Existing Vegetation Type (EVT)', resolution: '30 m native, nearest-neighbour resampled. Not suitable for individual trees.', usage: 'Public domain' },
);

const fdist = await download(
  'landfire-lf2024-fdist',
  `https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_FDist_CONUS/ImageServer/exportImage?${bboxQ}&pixelType=S16&interpolation=RSP_NearestNeighbor`,
  'club_fdist_lf2024.tif',
  { agency: 'USGS / USFS LANDFIRE', title: 'LF2024 Fuel Disturbance (FDist): disturbance type, severity and age (1 / 2–5 / 6–10 yr)', resolution: '30 m native, nearest-neighbour resampled', usage: 'Public domain' },
);
// disturbance per cell: type (Fire/Mechanical/Insect…), severity, age class — from the FDist attribute CSV
const fdCsv = (await fs.readFile(path.join(RAW, 'LF2024_FDist.csv'), 'utf8')).split('\n').slice(1);
const fdInfo = new Map();
for (const line of fdCsv) { const c = line.split(','); if (c.length > 4 && Number(c[0]) > 0) fdInfo.set(Number(c[0]), { type: c[1], severity: c[2], age: c[3] }); }
const DIST = new Uint8Array(W * H); // 0 none, 1 fire ≤1y, 2 fire 2–5y, 3 fire 6–10y, 4 cut/thinning ≤1y, 5 cut 2–5y (regrowth = browse), 6 cut 6–10y (thick regrowth = bedding), 7 other
for (let i = 0; i < W * H; i++) {
  const d = fdInfo.get(fdist[i]);
  if (!d) continue;
  const recent = d.age === 'One Year', mid = d.age === 'Two to Five Years';
  if (/Fire/i.test(d.type)) DIST[i] = recent ? 1 : mid ? 2 : 3;
  else if (/Mechanical|Harvest|Clearcut|Thinning|Mastication/i.test(d.type)) DIST[i] = recent ? 4 : mid ? 5 : 6;
  else DIST[i] = 7;
}

// ---------- EVT lookup ----------
const evtCsv = (await fs.readFile(path.join(RAW, 'LF2024_EVT.csv'), 'utf8')).split('\n').slice(1);
const evtInfo = new Map();
for (const line of evtCsv) {
  const c = line.split(',');
  if (c.length > 7) evtInfo.set(Number(c[0]), { name: c[1], phys: c[6] });
}
// habitat class per cell: 1 oak/hardwood, 2 conifer, 3 mixed, 4 early-successional/shrub/grass/open, 5 riparian, 6 developed/ag, 0 other
const HAB = new Uint8Array(W * H);
const oakMask = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  const info = evtInfo.get(evt[i]);
  if (!info) continue;
  const p = info.phys;
  if (/oak/i.test(info.name)) oakMask[i] = 1;
  if (p === 'Hardwood') HAB[i] = 1;
  else if (p === 'Conifer') HAB[i] = 2;
  else if (p === 'Conifer-Hardwood') HAB[i] = 3;
  else if (/Shrubland|Grassland|Sparse/.test(p) || /Ruderal|Early|Successional|Harvested|Disturbed/i.test(info.name)) HAB[i] = 4;
  else if (/Riparian/.test(p)) HAB[i] = 5;
  else if (/Developed|Agricultur/.test(p)) HAB[i] = 6;
}

// ---------- geometry helpers ----------
const lonOf = (x) => BBOX[0] + (x + 0.5) * DEG;
const latOf = (y) => BBOX[3] - (y + 0.5) * DEG;
const xOf = (lon) => Math.floor((lon - BBOX[0]) / DEG);
const yOf = (lat) => Math.floor((BBOX[3] - lat) / DEG);
const DY = DEG * 110574;
const dxAt = (y) => DEG * 111320 * Math.cos((latOf(y) * Math.PI) / 180);
const idx = (x, y) => y * W + x;

// ---------- fill nodata ----------
const z = Float32Array.from(dem);
for (let i = 0; i < z.length; i++) if (!(z[i] > -1000)) z[i] = NaN;
let nanCount = 0;
for (let pass = 0; pass < 50; pass++) {
  nanCount = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (!Number.isNaN(z[i])) continue;
      let s = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const v = z[idx(xx, yy)];
        if (!Number.isNaN(v)) { s += v; n++; }
      }
      if (n) z[i] = s / n; else nanCount++;
    }
  if (!nanCount) break;
}
if (nanCount) throw new Error('DEM has unfillable nodata');

// ---------- box mean via integral image ----------
function boxMean(src, r) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += src[idx(x, y)];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
      const s = I[(y1 + 1) * (W + 1) + x1 + 1] - I[y0 * (W + 1) + x1 + 1] - I[(y1 + 1) * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      out[idx(x, y)] = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

const zs = boxMean(z, 1);

// ---------- slope / aspect (Horn) ----------
const slope = new Float32Array(W * H);
const aspect = new Float32Array(W * H); // degrees, direction the slope faces (0 = north)
for (let y = 1; y < H - 1; y++) {
  const dx = dxAt(y);
  for (let x = 1; x < W - 1; x++) {
    const a = zs[idx(x - 1, y - 1)], b = zs[idx(x, y - 1)], c = zs[idx(x + 1, y - 1)];
    const d = zs[idx(x - 1, y)], f = zs[idx(x + 1, y)];
    const g = zs[idx(x - 1, y + 1)], h = zs[idx(x, y + 1)], k = zs[idx(x + 1, y + 1)];
    const dzdx = (c + 2 * f + k - (a + 2 * d + g)) / (8 * dx); // east positive
    const dzdy = (g + 2 * h + k - (a + 2 * b + c)) / (8 * DY); // south positive
    slope[idx(x, y)] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    // downslope direction: -gradient. east comp = -dzdx, north comp = dzdy
    let asp = (Math.atan2(-dzdx, dzdy) * 180) / Math.PI;
    if (asp < 0) asp += 360;
    aspect[idx(x, y)] = asp;
  }
}

// ---------- TPI ----------
function standardize(a, ref) {
  if (ref && process.env.TPI_REF === 'bankhead') return a.map((v) => (v - ref.mean) / ref.sd);
  // default: relative to this box's own spread, so "upper landscape" and "stands out from its surroundings" mean
  // the same thing here as they do within Bankhead (best relative features of the local terrain)
  let s = 0, s2 = 0;
  for (const v of a) { s += v; s2 += v * v; }
  const m = s / a.length, sd = Math.sqrt(s2 / a.length - m * m);
  return a.map((v) => (v - m) / sd);
}
const meanS = boxMean(z, 5); // ~150 m
const meanL = boxMean(z, 25); // ~750 m
const tpiSm = new Float32Array(W * H), tpiLm = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tpiSm[i] = z[i] - meanS[i]; tpiLm[i] = z[i] - meanL[i]; }
const tS = standardize(tpiSm, REF?.small), tL = standardize(tpiLm, REF?.large);
const meanSlope = boxMean(slope, 4);

// ---------- flow accumulation (priority-flood + D8) ----------
const filled = Float32Array.from(z);
{
  const closed = new Uint8Array(W * H);
  // binary heap
  const heapI = new Int32Array(W * H), heapZ = new Float32Array(W * H);
  let n = 0;
  const push = (i, v) => { let k = n++; while (k > 0) { const p = (k - 1) >> 1; if (heapZ[p] <= v) break; heapI[k] = heapI[p]; heapZ[k] = heapZ[p]; k = p; } heapI[k] = i; heapZ[k] = v; };
  const pop = () => { const top = heapI[0]; const li = heapI[--n], lv = heapZ[n]; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= n) break; if (c + 1 < n && heapZ[c + 1] < heapZ[c]) c++; if (heapZ[c] >= lv) break; heapI[k] = heapI[c]; heapZ[k] = heapZ[c]; k = c; } heapI[k] = li; heapZ[k] = lv; return top; };
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = idx(x, y); if (!closed[i]) { closed[i] = 1; push(i, filled[i]); } }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = idx(x, y); if (!closed[i]) { closed[i] = 1; push(i, filled[i]); } }
  while (n) {
    const i = pop();
    const x = i % W, y = (i / W) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = idx(xx, yy);
      if (closed[j]) continue;
      closed[j] = 1;
      if (filled[j] <= filled[i]) filled[j] = filled[i] + 1e-3;
      push(j, filled[j]);
    }
  }
}
const down = new Int32Array(W * H).fill(-1);
for (let y = 0; y < H; y++) {
  const dx = dxAt(y);
  for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    let best = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = idx(xx, yy);
      const g = (filled[i] - filled[j]) / Math.hypot(ox * dx, oy * DY);
      if (g > best) { best = g; down[i] = j; }
    }
  }
}
const order = Array.from({ length: W * H }, (_, i) => i).sort((a, b) => filled[b] - filled[a]);
const acc = new Float32Array(W * H).fill(1);
for (const i of order) if (down[i] >= 0) acc[down[i]] += acc[i];
const CELL_AREA = dxAt(H / 2) * DY;
const STREAM_KM2 = 0.3;
const isStream = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if ((acc[i] * CELL_AREA) / 1e6 >= STREAM_KM2) isStream[i] = 1;

// ---------- distance transform (meters, chamfer) ----------
function distanceTo(mask) {
  const d = new Float32Array(W * H).fill(1e9);
  for (let i = 0; i < W * H; i++) if (mask[i]) d[i] = 0;
  const dx = dxAt(H / 2), dd = Math.hypot(dx, DY);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (x > 0) d[i] = Math.min(d[i], d[i - 1] + dx);
    if (y > 0) { d[i] = Math.min(d[i], d[i - W] + DY); if (x > 0) d[i] = Math.min(d[i], d[i - W - 1] + dd); if (x < W - 1) d[i] = Math.min(d[i], d[i - W + 1] + dd); }
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = idx(x, y);
    if (x < W - 1) d[i] = Math.min(d[i], d[i + 1] + dx);
    if (y < H - 1) { d[i] = Math.min(d[i], d[i + W] + DY); if (x < W - 1) d[i] = Math.min(d[i], d[i + W + 1] + dd); if (x > 0) d[i] = Math.min(d[i], d[i + W - 1] + dd); }
  }
  return d;
}
const distStream = distanceTo(isStream);

// ---------- Hessian on smoothed surface for saddle detection ----------
const zh = boxMean(boxMean(z, 2), 2);
const K = 3; // ~80-90 m baseline
const saddleMask = new Uint8Array(W * H);
for (let y = K; y < H - K; y++) {
  const hx = K * dxAt(y), hy = K * DY;
  for (let x = K; x < W - K; x++) {
    const i = idx(x, y);
    const zxx = (zh[idx(x + K, y)] - 2 * zh[i] + zh[idx(x - K, y)]) / (hx * hx);
    const zyy = (zh[idx(x, y + K)] - 2 * zh[i] + zh[idx(x, y - K)]) / (hy * hy);
    const zxy = (zh[idx(x + K, y + K)] - zh[idx(x + K, y - K)] - zh[idx(x - K, y + K)] + zh[idx(x - K, y - K)]) / (4 * hx * hy);
    const tr = zxx + zyy, det = zxx * zyy - zxy * zxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    // opposite curvature signs with both magnitudes meaningful, on upper landscape, gentle slope
    if (l1 > 8e-4 && l2 < -8e-4 && tL[i] > 0.4 && slope[i] < 12 && Math.min(l1, -l2) / Math.max(l1, -l2) > 0.25) saddleMask[i] = 1;
  }
}

// ---------- landform masks ----------
const ridge = new Uint8Array(W * H), bench = new Uint8Array(W * H), spur = new Uint8Array(W * H), bottom = new Uint8Array(W * H), draw = new Uint8Array(W * H), steep = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  if (slope[i] > 25) steep[i] = 1;
  if (tL[i] > 1.0 && tS[i] > 0.3 && slope[i] < 15) ridge[i] = 1;
  if (slope[i] < 8 && meanSlope[i] > 11 && tL[i] > -0.6 && tL[i] < 0.8 && !isStream[i]) bench[i] = 1;
  if (tS[i] > 1.6 && tL[i] > -0.2 && tL[i] < 1.0 && slope[i] > 5 && slope[i] < 22) spur[i] = 1;
  if (tL[i] < -0.9 && slope[i] < 6 && distStream[i] < 120) bottom[i] = 1;
  if (tS[i] < -1.0 && slope[i] > 6 && !isStream[i]) draw[i] = 1;
}

// ---------- derived streams ----------
const streamLines = [];
{
  const seen = new Uint8Array(W * H);
  // trace from stream heads (stream cells with no upstream stream cell)
  const hasUp = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (isStream[i] && down[i] >= 0) hasUp[down[i]] = 1;
  for (let i = 0; i < W * H; i++) {
    if (!isStream[i] || hasUp[i]) continue;
    const line = [];
    let c = i;
    while (c >= 0 && isStream[c]) {
      line.push([+lonOf(c % W).toFixed(5), +latOf((c / W) | 0).toFixed(5)]);
      if (seen[c]) break;
      seen[c] = 1;
      c = down[c];
    }
    if (line.length > 3) streamLines.push(turf.lineString(line, { km2: +((acc[i] * CELL_AREA) / 1e6).toFixed(2) }));
  }
}
const streamsFc = turf.simplify(turf.featureCollection(streamLines), { tolerance: 0.00008 });
await fs.writeFile(path.join(OUT, 'streams.geojson'), JSON.stringify(streamsFc));

// ---------- contours (20 m) on 2x-downsampled smoothed grid ----------
{
  const w2 = W / 2, h2 = H / 2;
  const g = new Float64Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) g[y * w2 + x] = zs[idx(x * 2, y * 2)];
  const thresholds = [];
  { let lo = Infinity, hi = -Infinity; for (const v of g) { lo = Math.min(lo, v); hi = Math.max(hi, v); } for (let t = Math.ceil(lo / 20) * 20; t <= hi; t += 20) thresholds.push(t); }
  const cs = d3contours().size([w2, h2]).thresholds(thresholds)(g);
  const feats = [];
  for (const c of cs) {
    for (const poly of c.coordinates) for (const ring of poly) {
      const coords = ring.map(([x, y]) => [+(BBOX[0] + x * 2 * DEG).toFixed(5), +(BBOX[3] - y * 2 * DEG).toFixed(5)]);
      if (coords.length > 8) feats.push(turf.lineString(coords, { elevM: c.value, elevFt: Math.round(c.value * 3.28084), index: c.value % 100 === 0 }));
    }
  }
  await fs.writeFile(path.join(OUT, 'contours.geojson'), JSON.stringify(turf.simplify(turf.featureCollection(feats), { tolerance: 0.00012 })));
}

// ---------- compact terrain grid for in-browser "check this spot" ----------
// Half resolution (2 arc-sec ≈ 52×62 m). Continuous values are 2×2 means; feature masks are 2×2 ORs so thin
// features (saddles) survive. Layout per cell: elev u16 (0.5 m), slope u8 (0.25°), aspect u8 (2°), tpiL i8, tpiS i8 (σ×25),
// distStream u8 (8 m), mask u8 (bits: saddle,bench,spur,bottom,draw,ridge,steep,stream), hab u8 (hab | oak<<3 | dist<<4).
{
  const W2 = W / 2, H2 = H / 2, N2 = W2 * H2;
  const elev = new Uint16Array(N2), slp = new Uint8Array(N2), asp = new Uint8Array(N2), tl = new Int8Array(N2), ts = new Int8Array(N2), ds = new Uint8Array(N2), mask = new Uint8Array(N2), hb = new Uint8Array(N2);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
    const o = y * W2 + x;
    const cells = [idx(2 * x, 2 * y), idx(2 * x + 1, 2 * y), idx(2 * x, 2 * y + 1), idx(2 * x + 1, 2 * y + 1)];
    let ze = 0, sl = 0, l = 0, sm = 0, dmin = Infinity, m = 0, sx = 0, sy = 0;
    const habCount = new Map();
    let oakAny = 0, distBest = 0;
    for (const i of cells) {
      ze += z[i]; sl += slope[i]; l += tL[i]; sm += tS[i]; dmin = Math.min(dmin, distStream[i]);
      sx += Math.sin((aspect[i] * Math.PI) / 180); sy += Math.cos((aspect[i] * Math.PI) / 180);
      m |= (saddleMask[i] && 1) | (bench[i] && 2) | (spur[i] && 4) | (bottom[i] && 8) | (draw[i] && 16) | (ridge[i] && 32) | (steep[i] && 64) | (isStream[i] && 128);
      habCount.set(HAB[i], (habCount.get(HAB[i]) ?? 0) + 1);
      oakAny |= oakMask[i];
      if (DIST[i] && (!distBest || DIST[i] < distBest)) distBest = DIST[i];
    }
    elev[o] = clamp(Math.round((ze / 4) * 2), 0, 65535);
    slp[o] = clamp(Math.round((sl / 4) * 4), 0, 255);
    asp[o] = Math.round(((((Math.atan2(sx, sy) * 180) / Math.PI) + 360) % 360) / 2) % 180;
    tl[o] = clamp(Math.round((l / 4) * 25), -127, 127);
    ts[o] = clamp(Math.round((sm / 4) * 25), -127, 127);
    ds[o] = clamp(Math.round(dmin / 8), 0, 255);
    mask[o] = m;
    const hab = [...habCount.entries()].sort((a, b) => b[1] - a[1])[0][0];
    hb[o] = hab | (oakAny << 3) | (distBest << 4);
  }
  const body = Buffer.concat([elev, slp, asp, tl, ts, ds, mask, hb].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
  await fs.writeFile(path.join(OUT, 'terrain-grid.bin.gz'), zlib.gzipSync(body, { level: 9 }));
  await fs.writeFile(path.join(OUT, 'terrain-grid.json'), JSON.stringify({ version: ALGORITHM_VERSION, bbox: BBOX, width: W2, height: H2, cellDeg: DEG * 2, layout: ['elev:u16/2', 'slope:u8/4', 'aspect:u8*2', 'tpiL:i8/25', 'tpiS:i8/25', 'distStream:u8*8', 'mask:u8', 'hab:u8'] }));
  console.log('terrain grid', W2, 'x', H2, 'raw bytes', body.length);
}

// ---------- disturbance PNG (LANDFIRE FDist) ----------
{
  const png = new PNG({ width: W, height: H });
  const colors = { 1: [255, 120, 40, 190], 2: [255, 170, 60, 170], 3: [230, 200, 120, 130], 4: [170, 230, 255, 170], 5: [90, 190, 255, 180], 6: [60, 110, 200, 160], 7: [200, 160, 220, 120] };
  for (let i = 0; i < W * H; i++) png.data.set(colors[DIST[i]] ?? [0, 0, 0, 0], i * 4);
  await fs.writeFile(path.join(OUT, 'disturbance.png'), PNG.sync.write(png));
}

// ---------- slope shading PNG ----------
{
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const s = slope[i];
    let rgba = [0, 0, 0, 0];
    if (s > 30) rgba = [200, 40, 40, 170];
    else if (s > 20) rgba = [230, 120, 40, 140];
    else if (s > 12) rgba = [235, 200, 70, 100];
    png.data.set(rgba, i * 4);
  }
  await fs.writeFile(path.join(OUT, 'slope.png'), PNG.sync.write(png));
}


// ---------- roads, driveways and paths (OpenStreetMap) ----------
// Used for walking routes, drive-up starts and keeping zones off roads. OSM is community-mapped and incomplete:
// farm and lease roads inside private land are often missing, which the app states.
{
  const KINDS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|road|living_street|path|footway|bridleway|cycleway';
  const q = `[out:json][timeout:120];way["highway"~"^(${KINDS})$"](${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]});out geom;`;
  const j = await overpass(q);
  const feats = j.elements.filter((e) => e.geometry?.length > 1).map((e) => turf.lineString(e.geometry.map((g) => [g.lon, g.lat]), { highway: e.tags.highway, name: e.tags.name ?? null, ref: e.tags.ref ?? null, access: e.tags.access ?? null, osm_id: e.id }));
  const fc = turf.truncate(turf.simplify(turf.featureCollection(feats), { tolerance: 0.00002 }), { precision: 5 });
  const body = JSON.stringify(fc);
  await fs.writeFile(path.join(OUT, 'roads.geojson'), body);
  sources.push({ id: 'club-osm-roads', agency: 'OpenStreetMap contributors (ODbL)', title: 'Roads and paths in the private-club box', url: 'https://overpass-api.de/api/interpreter', retrieved: new Date().toISOString(), checksum: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16), quality: feats.length ? 'retrieved' : 'empty', coverage: `bbox ${BBOX.join(',')}`, usage: 'ODbL – attribution required' });
  console.log('roads', feats.length);
}

const meta = {
  algorithmVersion: ALGORITHM_VERSION,
  generated: new Date().toISOString(),
  bbox: BBOX,
  grid: { width: W, height: H, cellDeg: DEG, approxCellM: [Math.round(dxAt(H / 2)), Math.round(DY)] },
  tpiReference: REF,
  counts: { streams: streamLines.length },
  sources,
};
await fs.writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta.counts), 'grid', W, 'x', H);
