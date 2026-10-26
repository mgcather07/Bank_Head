// Rebuilds every zone's walk-in route on USGS 3DEP 1/3 arc-second (~10 m) elevation, which in Alabama is
// resampled from 1 m lidar. Routes follow the road/trail network as far as it helps, then take the least-effort
// line over the ground (src/engine/pathfind.ts): cliffs impassable, steep side-hills penalised, private land and
// open water blocked. Replaces the old "network + straight line" routes in public/data/candidates.geojson.
// Usage: node scripts/build-routes.mjs   (run after build-terrain.mjs)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fromArrayBuffer } from 'geotiff';
import * as turf from '@turf/turf';
import { BBOX } from './config.mjs';
import { overpass } from './lib/overpass.mjs';
import { buildNetwork, nearestNode } from './lib/network.mjs';
import { slopeDeg, fillRings, drawLines, findPath, simplify, flatWaterMask } from '../src/engine/pathfind.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const readGeo = async (f) => JSON.parse(await fs.readFile(path.join(OUT, f), 'utf8'));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// ---------- 10 m DEM (3×3 tiles, cached) ----------
const PX = 1 / 10800; // 1/3 arc-second
const W = Math.round((BBOX[2] - BBOX[0]) / PX), H = Math.round((BBOX[3] - BBOX[1]) / PX);
const TX = 3, TY = 3, tw = Math.ceil(W / TX), th = Math.ceil(H / TY);
await fs.mkdir(path.join(RAW, 'dem10'), { recursive: true });
const elev = new Float32Array(W * H);
for (let ty = 0; ty < TY; ty++) for (let tx = 0; tx < TX; tx++) {
  const x0 = tx * tw, y0 = ty * th, cw = Math.min(tw, W - x0), ch = Math.min(th, H - y0);
  const bb = [BBOX[0] + x0 * PX, BBOX[3] - (y0 + ch) * PX, BBOX[0] + (x0 + cw) * PX, BBOX[3] - y0 * PX];
  const file = path.join(RAW, 'dem10', `t_${ty}_${tx}.tif`);
  let buf;
  try { buf = await fs.readFile(file); } catch {
    const u = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=${bb.join(',')}&bboxSR=4326&imageSR=4326&size=${cw},${ch}&format=tiff&compression=LZ77&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=json`;
    for (let a = 0; a < 4 && !buf; a++) {
      try {
        const j = await (await fetch(u, { signal: AbortSignal.timeout(180000) })).json();
        const b = Buffer.from(await (await fetch(j.href, { signal: AbortSignal.timeout(180000) })).arrayBuffer());
        // the image server sometimes returns an HTML error page (502) — only accept a real TIFF
        if (!((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d))) throw new Error(`not a TIFF (${b.subarray(0, 40).toString()})`);
        buf = b;
      } catch (e) { log('retry tile', ty, tx, e.message); await new Promise((r) => setTimeout(r, 4000)); }
    }
    if (!buf) throw new Error('DEM tile download failed');
    await fs.writeFile(file, buf);
  }
  const img = await (await fromArrayBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))).getImage();
  const [r] = await img.readRasters();
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) elev[(y0 + y) * W + x0 + x] = r[y * cw + x];
}
log('DEM', W, 'x', H);
const LAT0 = (BBOX[1] + BBOX[3]) / 2;
const DX = PX * 111320 * Math.cos((LAT0 * Math.PI) / 180), DY = PX * 110574;
const toPx = ([lon, lat]) => [(lon - BBOX[0]) / PX, (BBOX[3] - lat) / PX];
const cellOf = (c) => { const [x, y] = toPx(c); const xi = Math.floor(x), yi = Math.floor(y); return xi < 0 || yi < 0 || xi >= W || yi >= H ? -1 : yi * W + xi; };
const lonLat = (i) => [+(BBOX[0] + ((i % W) + 0.5) * PX).toFixed(6), +(BBOX[3] - (Math.floor(i / W) + 0.5) * PX).toFixed(6)];
const slope = slopeDeg({ w: W, h: H, dx: DX, dy: DY, elev });
log('slope done');

// ---------- masks ----------
const ringsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).map((p) => p.map((r) => r.map(toPx)));
const blocked = new Uint8Array(W * H);
const own = await readGeo('ownership.geojson');
for (const f of own.features) if (f.properties.ownerclassification !== 'USDA FOREST SERVICE') for (const poly of ringsOf(f.geometry)) fillRings(poly, W, H, blocked, 1);
// open water: hydro-flattened lake/pond/river surfaces in the lidar-derived DEM (≥ 1 ha of dead-flat ground)
const waterMask = flatWaterMask({ w: W, h: H, dx: DX, dy: DY, elev }, Math.round(10000 / (DX * DY)));
let waterCells = 0;
for (let i = 0; i < W * H; i++) if (waterMask[i]) { blocked[i] = 1; waterCells++; }
const water = { features: { length: `${Math.round((waterCells * DX * DY) / 1e4)} ha of open water` } };
const onPath = new Uint8Array(W * H);
const linesOf = (fc) => fc.features.flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [])).map((l) => l.map(toPx));
const fsRoads = await readGeo('fs-roads.geojson'), trails = await readGeo('trails.geojson'), highways = await readGeo('highways.geojson'), osmRoads = await readGeo('roads-osm.geojson');
for (const fc of [fsRoads, trails, highways, osmRoads]) drawLines(linesOf(fc), W, H, onPath, 1, 0);
log('masks done; water', water.features.length);

// ---------- network distance from every drivable start (multi-source) ----------
const net = buildNetwork([{ fc: fsRoads, kind: 'road' }, { fc: trails, kind: 'trail' }, { fc: highways, kind: 'highway' }]);
const starts = [];
const addStart = (coord, name, kind, verification) => { const n = nearestNode(net, coord, 150); if (n) starts.push({ node: n.id, coord: net.nodes[n.id], name, kind, verification }); };
const recSites = await readGeo('rec-sites.geojson'), checks = await readGeo('check-stations.geojson');
for (const f of recSites.features) { const p = f.properties; if (!/TARGET RANGE/i.test(p.site_subtype ?? '')) addStart(f.geometry.coordinates, p.public_site_name ?? p.site_name, (p.site_subtype ?? 'site').toLowerCase(), 'USFS recreation site (location verified; parking capacity not verified)'); }
for (const f of checks.features) addStart(f.geometry.coordinates, `${f.properties.Tract} Checking Station`, 'checking station', 'ADCNR checking station location');
for (const f of fsRoads.features) {
  const p = f.properties;
  if (!/^(2|3|4|5)/.test(p.oper_maint_level ?? '') || p.openforuseto !== 'ALL') continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const l of lines) for (const c of l) addStart(c, `FS Rd ${p.id}${p.name ? ` (${p.name})` : ''}`, 'roadside', `USFS road inventory: maint. level ${p.oper_maint_level}; open to ${p.openforuseto}. Gate/seasonal status and legal pull-off NOT verified.`);
}
for (const f of highways.features) for (const c of f.geometry.coordinates) addStart(c, `${f.properties.ref} roadside`, 'roadside', 'State highway shoulder — legal pull-off NOT verified.');
const N = net.nodes.length;
const dDist = new Float64Array(N).fill(Infinity), dSrc = new Int32Array(N).fill(-1), dPrev = new Int32Array(N).fill(-1);
{
  const heap = [];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  starts.forEach((s, si) => { if (dDist[s.node] > 0) { dDist[s.node] = 0; dSrc[s.node] = si; push(0, s.node); } });
  while (heap.length) { const [d, i] = pop(); if (d > dDist[i]) continue; for (const [j, m] of net.adj[i]) if (d + m < dDist[j]) { dDist[j] = d + m; dSrc[j] = dSrc[i]; dPrev[j] = i; push(d + m, j); } }
}
log('network', N, 'nodes,', starts.length, 'drivable starts');
const ROAD_MS = 1.3; // walking pace along a road/trail (~2.9 mph)

// ---------- per-zone routing ----------
const sub = (x0, y0, w, h) => {
  const e = new Float32Array(w * h), s = new Uint8Array(w * h), b = new Uint8Array(w * h), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const src = (y0 + y) * W + x0; e.set(elev.subarray(src, src + w), y * w); s.set(slope.subarray(src, src + w), y * w); b.set(blocked.subarray(src, src + w), y * w); o.set(onPath.subarray(src, src + w), y * w); }
  return { g: { w, h, dx: DX, dy: DY, elev: e }, s, b, o };
};
const profileOf = (coords) => {
  const pts = [];
  let d = 0;
  for (let k = 0; k < coords.length; k++) {
    if (k) d += turf.distance(coords[k - 1], coords[k], { units: 'meters' });
    const i = cellOf(coords[k]);
    if (i >= 0) pts.push([Math.round(d), Math.round(elev[i])]);
  }
  // resample to ≤ 60 points
  const step = Math.max(1, Math.ceil(pts.length / 60));
  return pts.filter((_, k) => k % step === 0 || k === pts.length - 1);
};

function routeFor(center, excludeNear) {
  for (const R of [2200, 4000]) {
    const rx = Math.ceil(R / DX), ry = Math.ceil(R / DY);
    const [cxF, cyF] = toPx(center);
    const cx = Math.floor(cxF), cy = Math.floor(cyF);
    const x0 = Math.max(0, cx - rx), y0 = Math.max(0, cy - ry), x1 = Math.min(W - 1, cx + rx), y1 = Math.min(H - 1, cy + ry);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const local = (c) => { const [x, y] = toPx(c); const xi = Math.floor(x) - x0, yi = Math.floor(y) - y0; return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : yi * w + xi; };
    const seeds = [];
    for (let n = 0; n < N; n++) {
      if (!Number.isFinite(dDist[n])) continue;
      const li = local(net.nodes[n]);
      if (li < 0) continue;
      const st = starts[dSrc[n]];
      if (excludeNear && turf.distance(st.coord, excludeNear, { units: 'meters' }) < 600) continue;
      seeds.push({ i: li, cost: dDist[n] / ROAD_MS, tag: n });
    }
    if (!seeds.length) continue;
    const { g, s, b, o } = sub(x0, y0, w, h);
    const goal = local(center);
    const r = findPath(g, s, b, o, seeds, goal);
    if (!r) continue;
    const seedNode = r.seedTag;
    const netChain = [];
    for (let i = seedNode; i >= 0; i = dPrev[i]) netChain.push(net.nodes[i]);
    netChain.reverse();
    const gridPts = r.cells.map((ci) => lonLat((y0 + Math.floor(ci / w)) * W + x0 + (ci % w)));
    const coords = [...netChain, ...gridPts.slice(1), center];
    const st = starts[dSrc[seedNode]];
    const simp = simplify(coords.map(toPx), 0.4).map(([x, y]) => [+(BBOX[0] + x * PX).toFixed(6), +(BBOX[3] - y * PX).toFixed(6)]);
    const prof = profileOf(coords);
    let gain = 0, loss = 0;
    for (let k = 1; k < prof.length; k++) { const dz = prof[k][1] - prof[k - 1][1]; if (dz > 0) gain += dz; else loss -= dz; }
    const netM = dDist[seedNode];
    const straightM = turf.distance(starts[dSrc[seedNode]].coord, center, { units: 'meters' });
    const walkMeters = Math.round(Math.max(straightM, netM + r.lengthM)); // grid snapping can shave a few metres
    return {
      accessPointId: `start-${dSrc[seedNode]}`, name: st.name, kind: st.kind, coord: st.coord, verification: st.verification,
      straightLineMeters: Math.round(turf.distance(st.coord, center, { units: 'meters' })),
      walkMeters, onNetworkMeters: Math.round(netM + r.onPathM), offTrailMeters: Math.round(r.offPathM),
      routeKind: 'terrain', path: simp, profile: prof,
      gainInMeters: Math.round(gain), gainOutMeters: Math.round(loss), maxSlopeDeg: Math.round(r.maxSlopeDeg),
      walkMinutes: Math.round(r.seconds / 60), // seed cost already includes the walk along the road/trail network
      approachBearing: Math.round((turf.bearing(turf.point(coords[Math.max(0, coords.length - 6)]), turf.point(center)) + 360) % 360),
      elevationSource: '3DEP 1/3 arc-second (~10 m, lidar-derived)',
    };
  }
  return null;
}

const cands = await readGeo('candidates.geojson');
let ok = 0, kept = 0;
for (const [k, f] of cands.features.entries()) {
  const c = f.properties.center;
  const r1 = routeFor(c, null);
  if (!r1) { kept++; continue; }
  const r2 = routeFor(c, r1.coord);
  f.properties.routes = [r1, ...(r2 ? [r2] : [])].sort((a, b) => a.walkMinutes - b.walkMinutes);
  f.properties.distRoadM = f.properties.distRoadM; // unchanged
  ok++;
  if (k % 100 === 0) log(`routed ${k}/${cands.features.length}`);
}
await fs.writeFile(path.join(OUT, 'candidates.geojson'), JSON.stringify(cands));
log(`done: ${ok} zones re-routed on terrain, ${kept} kept their previous route (no reachable start)`);
