// Offline terrain + habitat preprocessing for the Bankhead study area.
// Inputs:  USGS 3DEP 1 arc-second DEM, LANDFIRE LF2024 EVT (both fetched via ImageServer exportImage),
//          boundary/access GeoJSON written by fetch-sources.mjs.
// Outputs: public/data/candidates.geojson, streams.geojson, contours.geojson, slope.png, terrain-meta.json
// Every candidate is generated algorithmically from the rasters — no hand-placed locations.
// Usage: node scripts/build-terrain.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromArrayBuffer } from 'geotiff';
import { PNG } from 'pngjs';
import zlib from 'node:zlib';
import { contours as d3contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { buildNetwork, nearestNode, dijkstra, pathTo } from './lib/network.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const BBOX = [-87.56, 34.2, -87.2, 34.47];
const W = 1296;
const H = 972; // 1 arc-second grid
const DEG = 1 / 3600;
export const ALGORITHM_VERSION = 'terrain-1.1.0';

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
  'dem_1arcsec.tif',
  { agency: 'USGS National Map', title: '3DEP Elevation (resampled to 1 arc-second ≈ 26×31 m)', resolution: '1 arc-second grid (~26 m E-W × 31 m N-S)', usage: 'Public domain' },
);
const evt = await download(
  'landfire-lf2024-evt',
  `https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_EVT_CONUS/ImageServer/exportImage?${bboxQ}&pixelType=S16&interpolation=RSP_NearestNeighbor`,
  'evt_lf2024.tif',
  { agency: 'USGS / USFS LANDFIRE', title: 'LF2024 Existing Vegetation Type (EVT)', resolution: '30 m native, nearest-neighbour resampled. Not suitable for individual trees.', usage: 'Public domain' },
);

const fdist = await download(
  'landfire-lf2024-fdist',
  `https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2024/LF2024_FDist_CONUS/ImageServer/exportImage?${bboxQ}&pixelType=S16&interpolation=RSP_NearestNeighbor`,
  'fdist_lf2024.tif',
  { agency: 'USGS / USFS LANDFIRE', title: 'LF2024 Fuel Disturbance (FDist): disturbance type, severity and age (1 / 2–5 / 6–10 yr)', resolution: '30 m native, nearest-neighbour resampled', usage: 'Public domain' },
);
// disturbance per cell: type (Fire/Mechanical/Insect…), severity, age class — from the FDist attribute CSV
const fdCsv = (await fs.readFile(path.join(RAW, 'LF2024_FDist.csv'), 'utf8')).split('\n').slice(1);
const fdInfo = new Map();
for (const line of fdCsv) { const c = line.split(','); if (c.length > 4 && Number(c[0]) > 0) fdInfo.set(Number(c[0]), { type: c[1], severity: c[2], age: c[3] }); }
const DIST = new Uint8Array(W * H); // 0 none, 1 fire ≤1y, 2 fire 2–5y, 3 fire 6–10y, 4 mech/harvest ≤5y, 5 mech 6–10y, 6 other
for (let i = 0; i < W * H; i++) {
  const d = fdInfo.get(fdist[i]);
  if (!d) continue;
  const recent = d.age === 'One Year', mid = d.age === 'Two to Five Years';
  if (/Fire/i.test(d.type)) DIST[i] = recent ? 1 : mid ? 2 : 3;
  else if (/Mechanical|Harvest|Clearcut|Thinning|Mastication/i.test(d.type)) DIST[i] = recent || mid ? 4 : 5;
  else DIST[i] = 6;
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
function standardize(a) {
  let s = 0, s2 = 0;
  for (const v of a) { s += v; s2 += v * v; }
  const m = s / a.length, sd = Math.sqrt(s2 / a.length - m * m);
  return a.map((v) => (v - m) / sd);
}
const meanS = boxMean(z, 5); // ~150 m
const meanL = boxMean(z, 25); // ~750 m
const tpiSm = new Float32Array(W * H), tpiLm = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tpiSm[i] = z[i] - meanS[i]; tpiLm[i] = z[i] - meanL[i]; }
const tS = standardize(tpiSm), tL = standardize(tpiLm);
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

// ---------- boundaries & access ----------
const readGeo = async (f) => JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8'));
const wma = await readGeo('wma.geojson');
const own = await readGeo('ownership.geojson');
const wild = await readGeo('wilderness.geojson');
const recSites = await readGeo('rec-sites.geojson');
const fsRoads = await readGeo('fs-roads.geojson');
const highways = await readGeo('highways.geojson');
const trails = await readGeo('trails.geojson');
const osmRoads = await readGeo('roads-osm.geojson');
const checkStations = await readGeo('check-stations.geojson');
const fsOwned = own.features.filter((f) => f.properties.ownerclassification === 'USDA FOREST SERVICE');

// Access points: FS recreation sites + check station + points along passenger-car / high-clearance FS roads.
const accessPoints = [];
for (const f of recSites.features) {
  const p = f.properties;
  if (/TARGET RANGE/i.test(p.site_subtype)) continue;
  accessPoints.push({ id: `rec-${p.site_name?.toLowerCase().replace(/\W+/g, '-')}`, name: p.public_site_name ?? p.site_name, kind: (p.site_subtype ?? 'site').toLowerCase(), coord: f.geometry.coordinates, verified: 'USFS recreation site (location verified; hours/parking capacity not verified)' });
}
for (const f of checkStations.features) accessPoints.push({ id: `check-${f.id}`, name: `${f.properties.Tract} Checking Station`, kind: 'checking station', coord: f.geometry.coordinates, verified: 'ADCNR checking station location' });
for (const f of fsRoads.features) {
  const p = f.properties;
  if (!/^(2|3|4|5)/.test(p.oper_maint_level ?? '') || p.openforuseto !== 'ALL') continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    const ls = turf.lineString(line);
    const len = turf.length(ls, { units: 'meters' });
    for (let d = 0; d <= len; d += 400) {
      const pt = turf.along(ls, d, { units: 'meters' });
      accessPoints.push({ id: `fsr-${p.id}-${Math.round(d)}`, name: `FS Rd ${p.id}${p.name ? ` (${p.name})` : ''}`, kind: 'roadside', coord: pt.geometry.coordinates, verified: `USFS road inventory: maint. level ${p.oper_maint_level}; open to ${p.openforuseto}. Gate/seasonal status and legal pull-off NOT verified.`, maintLevel: p.oper_maint_level });
    }
  }
}

// ---------- walking network (roads + trails + highways) ----------
const net = buildNetwork([
  { fc: fsRoads, kind: 'road' },
  { fc: trails, kind: 'trail' },
  { fc: highways, kind: 'highway' },
]);
console.log('network nodes', net.nodes.length);
const OFFTRAIL_FACTOR = 1.35; // off-trail walking vs. straight line (slope/brush); on-network distance is used as-is
const accessNode = new Map(); // access id → nearest network node (within 60 m, else null)
for (const a of accessPoints) accessNode.set(a.id, nearestNode(net, a.coord, 60)?.id ?? null);
const dijkstraCache = new Map();
const sssp = (node) => { if (!dijkstraCache.has(node)) dijkstraCache.set(node, dijkstra(net, node, 12000)); return dijkstraCache.get(node); };

const al33 = highways.features.filter((f) => f.properties.ref === 'AL 33');
function zoneFor(pt) {
  // Official 2026-27 permit map: Zone B lies east of AL 33, Zone A west. Divider digitized from OSM AL 33 centerline.
  let best = null;
  for (const f of al33) {
    const np = turf.nearestPointOnLine(f, pt, { units: 'meters' });
    if (!best || np.properties.dist < best.dist) best = { dist: np.properties.dist, coord: np.geometry.coordinates };
  }
  if (!best) return { zone: null, distToDivider: null };
  const side = pt.geometry.coordinates[0] > best.coord[0] ? 'B' : 'A';
  return { zone: best.dist < 400 ? null : side, provisionalZone: side, distToDivider: Math.round(best.dist) };
}

const flatLines = (fc) => fc.features.flatMap((f) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates.map((c) => turf.lineString(c)) : [f]));
const trailLines = flatLines(trails), roadLines = [...flatLines(fsRoads), ...flatLines(highways), ...flatLines(osmRoads)];
const roadBboxes = roadLines.map((l) => turf.bbox(l));
const ROAD_CLEARANCE_M = 100; // zone centre must be at least this far from any road
// any road (FS inventory, state highway or OSM road/track) crossing the polygon disqualifies the zone
const roadCrosses = (poly) => {
  const pb = turf.bbox(poly);
  return roadLines.some((l, k) => { const b = roadBboxes[k]; return !(b[0] > pb[2] || b[2] < pb[0] || b[1] > pb[3] || b[3] < pb[1]) && turf.booleanIntersects(l, poly); });
};
const inAny = (pt, fc) => fc.some((f) => turf.booleanPointInPolygon(pt, f));

// ---------- candidate extraction ----------
function components(mask, minCells) {
  const seen = new Uint8Array(W * H);
  const comps = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cells = [];
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      const x = c % W, y = (c / W) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = idx(xx, yy);
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (cells.length >= minCells) comps.push(cells);
  }
  return comps;
}

const FEATURE_DEFS = [
  { type: 'saddle', mask: saddleMask, min: 4, label: 'Ridge saddle', base: 0.48 },
  { type: 'bench', mask: bench, min: 6, label: 'Side-hill bench', base: 0.45 },
  { type: 'spur', mask: spur, min: 10, label: 'Spur / ridge point', base: 0.36 },
  { type: 'bottom', mask: bottom, min: 25, label: 'Creek bottom edge', base: 0.33 },
];

function window(cx, cy, rM, fn) {
  const rx = Math.ceil(rM / dxAt(cy)), ry = Math.ceil(rM / DY);
  for (let y = Math.max(0, cy - ry); y <= Math.min(H - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(W - 1, cx + rx); x++) {
      const ddx = (x - cx) * dxAt(cy), ddy = (y - cy) * DY;
      if (ddx * ddx + ddy * ddy <= rM * rM) fn(idx(x, y), x, y);
    }
}
const bearing = (x0, y0, x1, y1) => ((Math.atan2((x1 - x0) * dxAt(y0), -(y1 - y0) * DY) * 180) / Math.PI + 360) % 360;
const circMean = (angles) => {
  let s = 0, c = 0;
  for (const a of angles) { s += Math.sin((a * Math.PI) / 180); c += Math.cos((a * Math.PI) / 180); }
  return { mean: ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360, r: Math.hypot(s, c) / Math.max(1, angles.length) };
};
const ASPECT_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const raw = [];
const rejected = { outsideWma: 0, notFsOwned: 0, safetyBuffer: 0, nearRoad: 0, roadCrosses: 0, tooLarge: 0 };
for (const def of FEATURE_DEFS) {
  for (const cells of components(def.mask, def.min)) {
    // representative cell: the one nearest the component centroid
    let sx = 0, sy = 0;
    for (const c of cells) { sx += c % W; sy += (c / W) | 0; }
    sx /= cells.length; sy /= cells.length;
    let rep = cells[0], bd = Infinity;
    for (const c of cells) { const d = (c % W - sx) ** 2 + (((c / W) | 0) - sy) ** 2; if (d < bd) { bd = d; rep = c; } }
    const cx = rep % W, cy = (rep / W) | 0;
    raw.push({ def, cells, cx, cy });
  }
}

// gate + context evaluation
const candidates = [];
for (const r of raw) {
  const { def, cx, cy } = r;
  const lon = lonOf(cx), lat = latOf(cy);
  const pt = turf.point([lon, lat]);
  if (!inAny(pt, wma.features)) { rejected.outsideWma++; continue; }
  if (!inAny(pt, fsOwned)) { rejected.notFsOwned++; continue; }
  const nearRec = recSites.features.some((f) => turf.distance(pt, f, { units: "meters" }) < 400);
  if (nearRec) { rejected.safetyBuffer++; continue; }
  if (Math.min(...roadLines.map((l) => turf.pointToLineDistance(pt, l, { units: 'meters' }))) < ROAD_CLEARANCE_M) { rejected.nearRoad++; continue; }

  // context within 300 m
  const counts = { saddle: 0, bench: 0, spur: 0, bottom: 0, draw: 0, steep: 0, stream: 0, ridge: 0 };
  const hab = [0, 0, 0, 0, 0, 0, 0];
  const dist = [0, 0, 0, 0, 0, 0, 0];
  let oak = 0, total = 0, zmin = Infinity, zmax = -Infinity, slopeSum = 0, edges = 0;
  const aspects = [];
  const upCells = [], downCells = [];
  window(cx, cy, 300, (i, x, y) => {
    total++;
    if (saddleMask[i]) counts.saddle++;
    if (bench[i]) counts.bench++;
    if (spur[i]) counts.spur++;
    if (bottom[i]) counts.bottom++;
    if (draw[i]) counts.draw++;
    if (steep[i]) counts.steep++;
    if (isStream[i]) counts.stream++;
    if (ridge[i]) counts.ridge++;
    hab[HAB[i]]++;
    dist[DIST[i]]++;
    oak += oakMask[i];
    zmin = Math.min(zmin, z[i]); zmax = Math.max(zmax, z[i]);
    slopeSum += slope[i];
    if (slope[i] > 4) aspects.push(aspect[i]);
    if (x < W - 1 && HAB[i] !== HAB[i + 1]) edges++;
    if (y < H - 1 && HAB[i] !== HAB[i + W]) edges++;
  });
  // bedding-cover hypothesis: upper, steeper, non-open cells within 600 m; food/water hypothesis: bottoms / openings / streams
  window(cx, cy, 600, (i, x, y) => {
    if ((tL[i] > 0.5 && slope[i] > 8 && slope[i] < 30 && HAB[i] >= 1 && HAB[i] <= 3)) upCells.push([x, y]);
    if (bottom[i] || HAB[i] === 4 || HAB[i] === 6 || isStream[i]) downCells.push([x, y]);
  });
  const beddingBearing = upCells.length >= 10 ? circMean(upCells.map(([x, y]) => bearing(cx, cy, x, y))) : null;
  const foodWaterBearing = downCells.length >= 10 ? circMean(downCells.map(([x, y]) => bearing(cx, cy, x, y))) : null;

  const pct = (n) => n / total;
  const habitat = {
    hardwood: pct(hab[1]), conifer: pct(hab[2]), mixed: pct(hab[3]), earlySuccessional: pct(hab[4]), riparian: pct(hab[5]), developedAg: pct(hab[6]), oak: pct(oak), edgeDensity: edges / total,
  };
  const disturbance = { fireRecent: pct(dist[1]), fireMid: pct(dist[2]), fireOld: pct(dist[3]), mechRecent: pct(dist[4]), mechOld: pct(dist[5]), other: pct(dist[6]) };
  const relief = zmax - zmin;
  const asp = circMean(aspects);
  const featureTypes = Object.entries({ saddle: counts.saddle >= 3, bench: counts.bench >= 6, spur: counts.spur >= 5, bottom: counts.bottom >= 10, draw: counts.draw >= 8 }).filter(([, v]) => v).map(([k]) => k);
  const steepFrac = pct(counts.steep);

  // terrain + habitat potential (hypothesis weights; see docs/MODEL.md)
  let t = def.base;
  const convergence = new Set([def.type, ...featureTypes]).size - 1;
  t += Math.min(0.18, convergence * 0.06);
  t += Math.min(0.12, (habitat.oak + 0.5 * habitat.hardwood) * 0.15);
  t += Math.min(0.08, habitat.edgeDensity * 0.6);
  if (habitat.earlySuccessional > 0.03 && habitat.earlySuccessional < 0.5) t += 0.05;
  if (distStream[r.cx + r.cy * W] > 40 && distStream[r.cx + r.cy * W] < 400) t += 0.03;
  // Recent fire (2–5 yr) and recent mechanical treatment create browse and edge; 1-yr burns are bare and get less credit.
  const distBonus = Math.min(0.08, disturbance.fireMid * 0.2 + disturbance.mechRecent * 0.2 + disturbance.fireRecent * 0.08 + disturbance.fireOld * 0.05);
  t += distBonus;
  if (steepFrac > 0.35) t -= 0.1;
  if (habitat.developedAg > 0.4) t -= 0.15;
  const terrainScore = Math.round(Math.max(0, Math.min(1, t)) * 100);

  // access: nearest access points
  const ranked = accessPoints.map((a) => ({ a, d: turf.distance(pt, turf.point(a.coord), { units: 'meters' }) })).sort((p, q) => p.d - q.d).slice(0, 3);
  const sampleProfile = (coords) => {
    // elevation every ~30 m along a polyline; returns [[distM, elevM], …] (≤ 60 samples) plus gain in/out and max slope
    const ls = turf.lineString(coords);
    const len = turf.length(ls, { units: 'meters' });
    const n = Math.max(2, Math.min(60, Math.round(len / 30)));
    const prof = [];
    let gainIn = 0, gainOut = 0, prevZ = null, maxSlope = 0;
    for (let s = 0; s <= n; s++) {
      const dist = (len * s) / n;
      const p = turf.along(ls, dist, { units: 'meters' }).geometry.coordinates;
      const xx = Math.min(W - 1, Math.max(0, xOf(p[0]))), yy = Math.min(H - 1, Math.max(0, yOf(p[1])));
      const v = z[idx(xx, yy)];
      maxSlope = Math.max(maxSlope, slope[idx(xx, yy)]);
      if (prevZ != null) { if (v > prevZ) gainIn += v - prevZ; else gainOut += prevZ - v; }
      prevZ = v;
      prof.push([Math.round(dist), Math.round(v)]);
    }
    return { len, prof, gainIn, gainOut, maxSlope };
  };
  const zoneNode = nearestNode(net, [lon, lat], 1500);
  const routes = ranked.map(({ a, d }) => {
    const an = accessNode.get(a.id);
    let coords = null, onNetworkM = 0, offTrailM = 0, verifiedRoute = false;
    if (an != null && zoneNode) {
      const { dist, prev } = sssp(an);
      if (Number.isFinite(dist[zoneNode.id]) && dist[zoneNode.id] < d * 2.5 + 400) {
        coords = pathTo(net, prev, zoneNode.id);
        onNetworkM = dist[zoneNode.id];
        offTrailM = zoneNode.d;
        verifiedRoute = true;
        if (offTrailM > 5) coords = [...coords, [lon, lat]];
      }
    }
    if (!coords) { coords = [a.coord, [lon, lat]]; offTrailM = d; }
    const simp = turf.truncate(turf.simplify(turf.lineString(coords), { tolerance: 0.00003 }), { precision: 5 }).geometry.coordinates;
    const { prof, gainIn, gainOut, maxSlope } = sampleProfile(coords);
    const walkM = Math.max(Math.round(d), Math.round(onNetworkM + offTrailM * OFFTRAIL_FACTOR)); // never shorter than the straight line
    return { accessPointId: a.id, name: a.name, kind: a.kind, coord: a.coord, verification: a.verified, straightLineMeters: Math.round(d), walkMeters: walkM, onNetworkMeters: Math.round(onNetworkM), offTrailMeters: Math.round(offTrailM), routeKind: verifiedRoute ? 'network+offtrail' : 'straight', path: simp, profile: prof, gainInMeters: Math.round(gainIn), gainOutMeters: Math.round(gainOut), maxSlopeDeg: Math.round(maxSlope), approachBearing: Math.round(turf.bearing(turf.point(coords[Math.max(0, coords.length - 2)]), pt) + 360) % 360 };
  }).sort((p, q) => p.walkMeters - q.walkMeters).slice(0, 2);

  const zoneInfo = zoneFor(pt);
  const wilderness = inAny(pt, wild.features);
  const distTrail = Math.min(...trailLines.map((f) => turf.pointToLineDistance(pt, f, { units: 'meters' })));
  const distRoad = Math.min(...roadLines.map((f) => turf.pointToLineDistance(pt, f, { units: 'meters' })));

  // scouting polygon: hull of feature cells within 250 m of rep, buffered 60 m
  const near = r.cells.filter((c) => ((c % W - cx) * dxAt(cy)) ** 2 + ((((c / W) | 0) - cy) * DY) ** 2 < 250 * 250);
  const pts = turf.featureCollection(near.map((c) => turf.point([lonOf(c % W), latOf((c / W) | 0)])));
  let geom = near.length >= 3 ? turf.convex(pts) : null;
  geom = turf.buffer(geom ?? pt, 60, { units: 'meters' });
  if (roadCrosses(geom)) { rejected.roadCrosses++; continue; }
  const areaHa = turf.area(geom) / 1e4;

  candidates.push({
    lon, lat, type: def.type, label: def.label, terrainScore, geometry: turf.truncate(geom, { precision: 5 }).geometry,
    props: {
      elevationM: Math.round(z[rep(r)]), slopeDeg: Math.round(slope[rep(r)]), aspectDeg: Math.round(asp.mean), aspectName: ASPECT_NAMES[Math.round(asp.mean / 45) % 8], aspectStrength: +asp.r.toFixed(2),
      tpiLocal: +tS[rep(r)].toFixed(2), tpiLandscape: +tL[rep(r)].toFixed(2), localReliefM: Math.round(relief), meanSlopeDeg: Math.round(slopeSum / total), steepFraction: +steepFrac.toFixed(2),
      distStreamM: Math.round(distStream[rep(r)]), distTrailM: Math.round(distTrail), distRoadM: Math.round(distRoad), nearbyFeatures: featureTypes,
      habitat: Object.fromEntries(Object.entries(habitat).map(([k, v]) => [k, +v.toFixed(3)])),
      disturbance: Object.fromEntries(Object.entries(disturbance).map(([k, v]) => [k, +v.toFixed(3)])),
      beddingCoverBearing: beddingBearing ? Math.round(beddingBearing.mean) : null, beddingCoverConsistency: beddingBearing ? +beddingBearing.r.toFixed(2) : null,
      foodWaterBearing: foodWaterBearing ? Math.round(foodWaterBearing.mean) : null, foodWaterConsistency: foodWaterBearing ? +foodWaterBearing.r.toFixed(2) : null,
      zone: zoneInfo.zone, provisionalZone: zoneInfo.provisionalZone, distToZoneDivider: zoneInfo.distToDivider, wilderness, areaHa: +areaHa.toFixed(1), routes,
    },
  });
}
function rep(r) { return idx(r.cx, r.cy); }

// deduplicate: keep best-scoring candidate per ~300 m neighbourhood
candidates.sort((a, b) => b.terrainScore - a.terrainScore);
const kept = [];
let merged = 0;
for (const c of candidates) {
  const dup = kept.find((k) => turf.distance([k.lon, k.lat], [c.lon, c.lat], { units: "meters" }) < 400);
  if (dup) { merged++; if (!dup.props.nearbyFeatures.includes(c.type)) dup.props.nearbyFeatures.push(c.type); continue; }
  kept.push(c);
}

const features = kept.map((c, i) => ({
  type: 'Feature',
  id: i + 1,
  geometry: c.geometry,
  properties: { id: `BH-${c.type.slice(0, 2).toUpperCase()}-${String(i + 1).padStart(4, '0')}`, type: c.type, label: c.label, terrainScore: c.terrainScore, center: [+c.lon.toFixed(6), +c.lat.toFixed(6)], ...c.props },
}));
await fs.writeFile(path.join(OUT, 'candidates.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
await fs.writeFile(path.join(OUT, 'access-points.geojson'), JSON.stringify(turf.featureCollection(accessPoints.filter((a) => a.kind !== 'roadside').map((a) => turf.point(a.coord, { id: a.id, name: a.name, kind: a.kind, verification: a.verified })))));

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
  for (let t = 120; t <= 360; t += 20) thresholds.push(t);
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
  const colors = { 1: [255, 120, 40, 190], 2: [255, 170, 60, 170], 3: [230, 200, 120, 130], 4: [120, 200, 255, 170], 5: [150, 190, 220, 120], 6: [200, 160, 220, 120] };
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

const meta = {
  algorithmVersion: ALGORITHM_VERSION,
  generated: new Date().toISOString(),
  bbox: BBOX,
  grid: { width: W, height: H, cellDeg: DEG, approxCellM: [Math.round(dxAt(H / 2)), Math.round(DY)] },
  parameters: { tpiSmallRadiusCells: 5, tpiLargeRadiusCells: 25, streamThresholdKm2: STREAM_KM2, saddleHessianBaselineCells: K, dedupeMeters: 400, contextRadiusM: 300, recSiteSafetyBufferM: 400, roadClearanceM: ROAD_CLEARANCE_M, zoneDividerUncertaintyM: 400 },
  counts: { networkNodes: net.nodes.length, raw: raw.length, rejected, mergedDuplicates: merged, candidates: features.length, byType: Object.fromEntries(FEATURE_DEFS.map((d) => [d.type, features.filter((f) => f.properties.type === d.type).length])), accessPoints: accessPoints.length, streams: streamLines.length },
  sources,
};
await fs.writeFile(path.join(OUT, 'terrain-meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta.counts, null, 2));
