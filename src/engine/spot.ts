// SpotAnalyzer — "check this spot": evaluates any map point in the browser with the same terrain/habitat
// logic the offline build uses for candidate zones, from a compact half-resolution grid (~52×62 m cells),
// and routes the walk-in over the FS road / NFS trail network. Results feed the normal scoring engine.
import type { FeatureCollection, LineString, MultiLineString, Point, Position } from 'geojson';
import type { Candidate, CandidateProps, RouteOption } from './types';
import { bearingTo, haversine, lookupJurisdiction, type Layers } from './geography';
import { roadDistance } from './roads';

export interface TerrainGrid {
  bbox: [number, number, number, number];
  width: number;
  height: number;
  cellDeg: number;
  elev: Uint16Array; slope: Uint8Array; aspect: Uint8Array; tpiL: Int8Array; tpiS: Int8Array; distStream: Uint8Array; mask: Uint8Array; hab: Uint8Array;
}

const M = { saddle: 1, bench: 2, spur: 4, bottom: 8, draw: 16, ridge: 32, steep: 64, stream: 128 } as const;

export function parseGrid(meta: { bbox: [number, number, number, number]; width: number; height: number; cellDeg: number }, buf: ArrayBuffer): TerrainGrid {
  const n = meta.width * meta.height;
  let o = 0;
  const take = <T>(ctor: new (b: ArrayBuffer, off: number, len: number) => T, bytesPer: number) => { const a = new ctor(buf, o, n); o += n * bytesPer; return a; };
  // u16 first keeps alignment simple
  const elev = take(Uint16Array, 2), slope = take(Uint8Array, 1), aspect = take(Uint8Array, 1), tpiL = take(Int8Array, 1), tpiS = take(Int8Array, 1), distStream = take(Uint8Array, 1), mask = take(Uint8Array, 1), hab = take(Uint8Array, 1);
  if (o !== buf.byteLength) throw new Error(`Terrain grid size mismatch (${o} vs ${buf.byteLength})`);
  return { ...meta, elev, slope, aspect, tpiL, tpiS, distStream, mask, hab };
}

let gridPromise: Promise<TerrainGrid> | null = null;
export function loadGrid(base = import.meta.env?.BASE_URL ?? '/'): Promise<TerrainGrid> {
  gridPromise ??= (async () => {
    const meta = await (await fetch(`${base}data/terrain-grid.json`)).json();
    const res = await fetch(`${base}data/terrain-grid.bin.gz`);
    if (!res.ok || !res.body) throw new Error(`Terrain grid unavailable (${res.status})`);
    // Hosting may or may not have already decoded it; detect the gzip magic number.
    const raw = await res.arrayBuffer();
    const head = new Uint8Array(raw, 0, 2);
    const buf = head[0] === 0x1f && head[1] === 0x8b ? await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : raw;
    return parseGrid(meta, buf);
  })().catch((e) => { gridPromise = null; throw e; });
  return gridPromise;
}

// ---------- grid helpers ----------
const DEG2M_LAT = 110574;
export function cellOf(g: TerrainGrid, [lon, lat]: [number, number]) {
  const x = Math.floor((lon - g.bbox[0]) / g.cellDeg), y = Math.floor((g.bbox[3] - lat) / g.cellDeg);
  return x < 0 || y < 0 || x >= g.width || y >= g.height ? null : { x, y, i: y * g.width + x };
}
const lonOf = (g: TerrainGrid, x: number) => g.bbox[0] + (x + 0.5) * g.cellDeg;
const latOf = (g: TerrainGrid, y: number) => g.bbox[3] - (y + 0.5) * g.cellDeg;
export const elevAt = (g: TerrainGrid, i: number) => g.elev[i] / 2;
export const slopeAt = (g: TerrainGrid, i: number) => g.slope[i] / 4;
export const aspectAt = (g: TerrainGrid, i: number) => g.aspect[i] * 2;
export const tpiLAt = (g: TerrainGrid, i: number) => g.tpiL[i] / 25;
export const tpiSAt = (g: TerrainGrid, i: number) => g.tpiS[i] / 25;
const habOf = (g: TerrainGrid, i: number) => g.hab[i] & 7;
const oakOf = (g: TerrainGrid, i: number) => (g.hab[i] >> 3) & 1;
const distOf = (g: TerrainGrid, i: number) => (g.hab[i] >> 4) & 7;

function eachInRadius(g: TerrainGrid, cx: number, cy: number, rM: number, fn: (i: number, x: number, y: number) => void) {
  const dy = g.cellDeg * DEG2M_LAT, dx = g.cellDeg * 111320 * Math.cos((latOf(g, cy) * Math.PI) / 180);
  const rx = Math.ceil(rM / dx), ry = Math.ceil(rM / dy);
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.height - 1, cy + ry); y++)
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.width - 1, cx + rx); x++) {
      const ex = (x - cx) * dx, ey = (y - cy) * dy;
      if (ex * ex + ey * ey <= rM * rM) fn(y * g.width + x, x, y);
    }
}
const circMean = (angles: number[]) => {
  let s = 0, c = 0;
  for (const a of angles) { s += Math.sin((a * Math.PI) / 180); c += Math.cos((a * Math.PI) / 180); }
  return { mean: ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360, r: Math.hypot(s, c) / Math.max(1, angles.length) };
};
const ASPECT_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Elevation profile + gain along a path, sampled from the grid. */
export function profileAlong(g: TerrainGrid, path: Position[]) {
  const pts: [number, number][] = [];
  let total = 0;
  for (let k = 0; k < path.length; k++) {
    if (k > 0) {
      const seg = haversine(path[k - 1] as [number, number], path[k] as [number, number]);
      const steps = Math.max(1, Math.round(seg / 40));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        pts.push([path[k - 1][0] + (path[k][0] - path[k - 1][0]) * t, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * t]);
      }
      total += seg;
    } else pts.push([path[0][0], path[0][1]]);
  }
  const prof: [number, number][] = [];
  let gainIn = 0, gainOut = 0, maxSlope = 0, prevZ: number | null = null, d = 0;
  pts.forEach((p, k) => {
    if (k > 0) d += haversine(pts[k - 1], p);
    const c = cellOf(g, p);
    if (!c) return;
    const zz = elevAt(g, c.i);
    maxSlope = Math.max(maxSlope, slopeAt(g, c.i));
    if (prevZ != null) { if (zz > prevZ) gainIn += zz - prevZ; else gainOut += prevZ - zz; }
    prevZ = zz;
    prof.push([Math.round(d), Math.round(zz)]);
  });
  // thin to ≤ 60 samples
  const step = Math.max(1, Math.ceil(prof.length / 60));
  const thin = prof.filter((_, k) => k % step === 0 || k === prof.length - 1);
  return { profile: thin, gainIn, gainOut, maxSlope, lengthM: total };
}

// ---------- walking network (built once from the loaded road/trail layers) ----------
export interface WalkNetwork {
  nodes: [number, number][];
  adj: Array<Array<[number, number]>>;
  driveDist: Float64Array; // meters from the nearest drivable start along the network
  driveSrc: Int32Array; // index into starts[]
  prev: Int32Array;
  starts: Array<{ node: number; name: string; kind: string; verification: string }>;
}

type Lines = FeatureCollection<LineString | MultiLineString>;
const SNAP_DEG = 0.00018; // ≈ 20 m

export function buildWalkNetwork(fsRoads: Lines, trails: Lines, highways: Lines, recSites: FeatureCollection<Point>, checkStations: FeatureCollection<Point>): WalkNetwork {
  const nodes: [number, number][] = [];
  const adj: Array<Array<[number, number]>> = [];
  const cells = new Map<string, number[]>();
  const ck = (x: number, y: number) => `${Math.floor(x / 0.002)},${Math.floor(y / 0.002)}`;
  const nodeFor = (c: Position) => {
    const cx = Math.floor(c[0] / 0.002), cy = Math.floor(c[1] / 0.002);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of cells.get(`${cx + dx},${cy + dy}`) ?? []) if (Math.abs(nodes[id][0] - c[0]) < SNAP_DEG && Math.abs(nodes[id][1] - c[1]) < SNAP_DEG) return id;
    }
    const id = nodes.push([c[0], c[1]]) - 1;
    adj.push([]);
    const k = ck(c[0], c[1]);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(id);
    return id;
  };
  const starts: WalkNetwork['starts'] = [];
  const startSeen = new Set<number>();
  const addLines = (fc: Lines, drivable: (p: Record<string, unknown>) => string | null) => {
    for (const f of fc.features) {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const dname = drivable(props);
      for (const line of lines) {
        let prev = -1;
        for (const c of line) {
          const id = nodeFor(c);
          if (prev >= 0 && prev !== id) {
            const m = haversine(nodes[prev], nodes[id]);
            adj[prev].push([id, m]);
            adj[id].push([prev, m]);
          }
          if (dname && !startSeen.has(id)) {
            startSeen.add(id);
            starts.push({ node: id, name: dname, kind: 'roadside', verification: props.verification as string ?? `USFS road inventory: ${props.oper_maint_level ?? 'state highway'}; open to ${props.openforuseto ?? 'public'}. Gate/seasonal status and legal pull-off NOT verified.` });
          }
          prev = id;
        }
      }
    }
  };
  addLines(fsRoads, (p) => (/^(2|3|4|5)/.test(String(p.oper_maint_level ?? '')) && p.openforuseto === 'ALL' ? `FS Rd ${p.id}${p.name ? ` (${p.name})` : ''}` : null));
  addLines(trails, () => null);
  addLines(highways, (p) => `${p.ref ?? 'Highway'} roadside`);
  // rec sites / check station become named starts at their nearest node (within 150 m)
  for (const f of [...recSites.features, ...checkStations.features]) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    if (/TARGET RANGE/i.test(String(props.site_subtype ?? ''))) continue;
    const c = f.geometry.coordinates as [number, number];
    let best = -1, bd = 150;
    for (let i = 0; i < nodes.length; i++) { const d = haversine(nodes[i], c); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) starts.unshift({ node: best, name: String(props.public_site_name ?? props.site_name ?? `${props.Tract ?? ''} Checking Station`), kind: String(props.site_subtype ?? props.Type ?? 'site').toLowerCase(), verification: 'USFS recreation site / ADCNR check station (location verified; parking capacity not verified)' });
  }
  // multi-source Dijkstra from every drivable start
  const n = nodes.length;
  const driveDist = new Float64Array(n).fill(Infinity), driveSrc = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (d: number, i: number) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  starts.forEach((s, si) => { if (driveDist[s.node] > 0) { driveDist[s.node] = 0; driveSrc[s.node] = si; push(0, s.node); } });
  while (heap.length) {
    const [d, i] = pop();
    if (d > driveDist[i]) continue;
    for (const [j, m] of adj[i]) if (d + m < driveDist[j]) { driveDist[j] = d + m; driveSrc[j] = driveSrc[i]; prev[j] = i; push(d + m, j); }
  }
  return { nodes, adj, driveDist, driveSrc, prev, starts };
}

const OFFTRAIL_FACTOR = 1.35;

export function routeToSpot(net: WalkNetwork, g: TerrainGrid, spot: [number, number]): RouteOption | null {
  // Best option = minimise (network distance from a drivable start + off-trail distance × factor) over nodes within 1.5 km.
  let best: { node: number; cost: number; off: number } | null = null;
  for (let i = 0; i < net.nodes.length; i++) {
    if (!Number.isFinite(net.driveDist[i])) continue;
    const off = haversine(net.nodes[i], spot);
    if (off > 1500) continue;
    const cost = net.driveDist[i] + off * OFFTRAIL_FACTOR;
    if (!best || cost < best.cost) best = { node: i, cost, off };
  }
  if (!best) {
    // straight-line fallback to the closest drivable start anywhere
    let s = -1, sd = Infinity;
    net.starts.forEach((st, k) => { const d = haversine(net.nodes[st.node], spot); if (d < sd) { sd = d; s = k; } });
    if (s < 0) return null;
    const st = net.starts[s];
    const path: [number, number][] = [net.nodes[st.node], spot];
    const pr = profileAlong(g, path);
    return { accessPointId: `net-${st.node}`, name: st.name, kind: st.kind, coord: net.nodes[st.node], verification: st.verification, straightLineMeters: Math.round(sd), walkMeters: Math.round(sd * OFFTRAIL_FACTOR), onNetworkMeters: 0, offTrailMeters: Math.round(sd), routeKind: 'straight', path, profile: pr.profile, gainInMeters: Math.round(pr.gainIn), gainOutMeters: Math.round(pr.gainOut), maxSlopeDeg: Math.round(pr.maxSlope), approachBearing: Math.round(bearingTo(net.nodes[st.node], spot)) };
  }
  const chain: [number, number][] = [];
  for (let i = best.node; i >= 0; i = net.prev[i]) chain.push(net.nodes[i]);
  chain.reverse(); // start → node
  const st = net.starts[net.driveSrc[best.node]];
  const path: [number, number][] = best.off > 5 ? [...chain, spot] : chain;
  const pr = profileAlong(g, path);
  const startC = chain[0];
  const straight = haversine(startC, spot);
  const walk = Math.max(Math.round(straight), Math.round(net.driveDist[best.node] + best.off * OFFTRAIL_FACTOR));
  const thin = path.length > 80 ? path.filter((_, k) => k % Math.ceil(path.length / 80) === 0 || k === path.length - 1) : path;
  return {
    accessPointId: `net-${st.node}`, name: st.name, kind: st.kind, coord: startC, verification: st.verification,
    straightLineMeters: Math.round(straight), walkMeters: walk, onNetworkMeters: Math.round(net.driveDist[best.node]), offTrailMeters: Math.round(best.off),
    routeKind: 'network+offtrail', path: thin, profile: pr.profile, gainInMeters: Math.round(pr.gainIn), gainOutMeters: Math.round(pr.gainOut), maxSlopeDeg: Math.round(pr.maxSlope),
    approachBearing: Math.round(bearingTo(path[Math.max(0, path.length - 2)], spot)),
  };
}

// ---------- spot analysis (mirrors scripts/build-terrain.mjs at half resolution) ----------
const FEATURES = [
  { type: 'saddle', bit: M.saddle, label: 'Ridge saddle', base: 0.48 },
  { type: 'bench', bit: M.bench, label: 'Side-hill bench', base: 0.45 },
  { type: 'spur', bit: M.spur, label: 'Spur / ridge point', base: 0.36 },
  { type: 'bottom', bit: M.bottom, label: 'Creek bottom edge', base: 0.33 },
] as const;

function landformAt(g: TerrainGrid, i: number): string {
  const l = tpiLAt(g, i), s = tpiSAt(g, i), sl = slopeAt(g, i);
  if (g.mask[i] & M.stream) return 'creek channel';
  if (l > 1 && sl < 15) return 'ridge top';
  if (l < -0.9 && sl < 6) return 'creek bottom';
  if (s < -1 && sl > 6) return 'draw';
  if (s > 1.2) return 'spur';
  if (sl > 25) return 'steep side-slope';
  if (sl < 6) return 'flat';
  return 'side-slope';
}

let spotSeq = 0;

export function analyzeSpot(g: TerrainGrid, layers: Layers, net: WalkNetwork | null, pt: [number, number]): Candidate | { error: string } {
  const c = cellOf(g, pt);
  if (!c) return { error: 'This spot is outside the Bankhead study area.' };
  // nearest qualifying feature within 150 m sets the feature type (else a generic spot)
  let feat: (typeof FEATURES)[number] | null = null, featD = Infinity;
  for (const f of FEATURES) {
    eachInRadius(g, c.x, c.y, 150, (i, x, y) => {
      if (!(g.mask[i] & f.bit)) return;
      const d = haversine(pt, [lonOf(g, x), latOf(g, y)]);
      if (d < featD - 1 || (feat && FEATURES.indexOf(f) < FEATURES.indexOf(feat) && d < featD + 40)) { feat = f; featD = d; }
    });
  }
  const counts = { saddle: 0, bench: 0, spur: 0, bottom: 0, draw: 0, steep: 0 };
  const hab = [0, 0, 0, 0, 0, 0, 0, 0], dist = [0, 0, 0, 0, 0, 0, 0, 0];
  let oak = 0, total = 0, zmin = Infinity, zmax = -Infinity, slopeSum = 0, edges = 0;
  const aspects: number[] = [];
  eachInRadius(g, c.x, c.y, 300, (i, x, y) => {
    total++;
    const m = g.mask[i];
    if (m & M.saddle) counts.saddle++;
    if (m & M.bench) counts.bench++;
    if (m & M.spur) counts.spur++;
    if (m & M.bottom) counts.bottom++;
    if (m & M.draw) counts.draw++;
    if (m & M.steep) counts.steep++;
    hab[habOf(g, i)]++;
    dist[distOf(g, i)]++;
    oak += oakOf(g, i);
    const zz = elevAt(g, i);
    zmin = Math.min(zmin, zz); zmax = Math.max(zmax, zz);
    slopeSum += slopeAt(g, i);
    if (slopeAt(g, i) > 4) aspects.push(aspectAt(g, i));
    if (x < g.width - 1 && habOf(g, i) !== habOf(g, i + 1)) edges++;
    if (y < g.height - 1 && habOf(g, i) !== habOf(g, i + g.width)) edges++;
  });
  const up: number[] = [], down: number[] = [];
  eachInRadius(g, c.x, c.y, 600, (i, x, y) => {
    const h = habOf(g, i), sl = slopeAt(g, i);
    const b = bearingTo(pt, [lonOf(g, x), latOf(g, y)]);
    if (x === c.x && y === c.y) return;
    const dc = distOf(g, i);
    if ((tpiLAt(g, i) > 0.5 && sl > 8 && sl < 30 && h >= 1 && h <= 3) || dc === 6) up.push(b);
    if (g.mask[i] & (M.bottom | M.stream) || h === 4 || h === 6 || dc === 4 || dc === 5) down.push(b);
  });
  // thresholds are the build's full-res counts scaled to quarter-area cells
  const bed = up.length >= 3 ? circMean(up) : null;
  const food = down.length >= 3 ? circMean(down) : null;
  const pct = (n: number) => n / Math.max(1, total);
  const habitat = { hardwood: pct(hab[1]), conifer: pct(hab[2]), mixed: pct(hab[3]), earlySuccessional: pct(hab[4]), riparian: pct(hab[5]), developedAg: pct(hab[6]), oak: pct(oak), edgeDensity: edges / Math.max(1, total) / 2 };
  const disturbance = { fireRecent: pct(dist[1]), fireMid: pct(dist[2]), fireOld: pct(dist[3]), cutNew: pct(dist[4]), cutRecent: pct(dist[5]), cutOld: pct(dist[6]), mechRecent: pct(dist[4] + dist[5]), mechOld: pct(dist[6]), other: pct(dist[7]) };
  const featureTypes = Object.entries({ saddle: counts.saddle >= 1, bench: counts.bench >= 2, spur: counts.spur >= 2, bottom: counts.bottom >= 3, draw: counts.draw >= 2 }).filter(([, v]) => v).map(([k]) => k);
  const steepFrac = pct(counts.steep);
  const asp = circMean(aspects);
  const f0 = feat as (typeof FEATURES)[number] | null;
  let t: number = f0 ? f0.base - Math.min(0.1, featD / 1500) : 0.28;
  t += Math.min(0.18, (new Set([f0?.type ?? 'spot', ...featureTypes]).size - 1) * 0.06);
  t += Math.min(0.12, (habitat.oak + 0.5 * habitat.hardwood) * 0.15);
  t += Math.min(0.08, habitat.edgeDensity * 0.6);
  if (habitat.earlySuccessional > 0.03 && habitat.earlySuccessional < 0.5) t += 0.05;
  const dStream = g.distStream[c.i] * 8;
  if (dStream > 40 && dStream < 400) t += 0.03;
  t += Math.min(0.1, disturbance.fireMid * 0.2 + disturbance.cutRecent * 0.25 + disturbance.cutNew * 0.1 + disturbance.cutOld * 0.15 + disturbance.fireRecent * 0.08 + disturbance.fireOld * 0.05 + (disturbance.cutRecent > 0.05 && disturbance.cutOld > 0.05 ? 0.04 : 0));
  if (steepFrac > 0.35) t -= 0.1;
  if (habitat.developedAg > 0.4) t -= 0.15;
  const terrainScore = Math.round(Math.max(0, Math.min(1, t)) * 100);

  const j = lookupJurisdiction(layers, pt);
  const route = net ? routeToSpot(net, g, pt) : null;
  const landform = landformAt(g, c.i);
  const label = f0 ? `${f0.label}${featD > 40 ? ` (${Math.round(featD)} m away)` : ''}` : `Checked spot — ${landform}`;
  // distance to roads/trails: reuse the network nodes
  let distRoad = roadDistance(pt, 3000);
  if (!Number.isFinite(distRoad) && net) for (const s of net.starts) distRoad = Math.min(distRoad, haversine(net.nodes[s.node], pt));
  const props: CandidateProps = {
    id: `SPOT-${++spotSeq}`,
    type: 'spot',
    label,
    terrainScore,
    center: [+pt[0].toFixed(6), +pt[1].toFixed(6)],
    elevationM: Math.round(elevAt(g, c.i)),
    slopeDeg: Math.round(slopeAt(g, c.i)),
    aspectDeg: Math.round(asp.mean),
    aspectName: ASPECT_NAMES[Math.round(asp.mean / 45) % 8],
    aspectStrength: +asp.r.toFixed(2),
    tpiLocal: +tpiSAt(g, c.i).toFixed(2),
    tpiLandscape: +tpiLAt(g, c.i).toFixed(2),
    localReliefM: Math.round(zmax - zmin),
    meanSlopeDeg: Math.round(slopeSum / Math.max(1, total)),
    steepFraction: +steepFrac.toFixed(2),
    distStreamM: dStream,
    distTrailM: Math.round(route?.routeKind === 'network+offtrail' ? route.offTrailMeters : 9999),
    distRoadM: Number.isFinite(distRoad) ? Math.round(distRoad) : 9999,
    nearbyFeatures: featureTypes,
    habitat: Object.fromEntries(Object.entries(habitat).map(([k, v]) => [k, +v.toFixed(3)])) as CandidateProps['habitat'],
    disturbance: Object.fromEntries(Object.entries(disturbance).map(([k, v]) => [k, +v.toFixed(3)])) as CandidateProps['disturbance'],
    beddingCoverBearing: bed ? Math.round(bed.mean) : null,
    beddingCoverConsistency: bed ? +bed.r.toFixed(2) : null,
    foodWaterBearing: food ? Math.round(food.mean) : null,
    foodWaterConsistency: food ? +food.r.toFixed(2) : null,
    zone: j.zone,
    provisionalZone: j.provisionalZone,
    distToZoneDivider: j.distToDividerM,
    wilderness: j.wilderness,
    areaHa: 3.1,
    routes: route ? [route] : [],
    jurisdiction: j.kind,
    deerZone: j.kind === 'black_warrior_wma' ? 'D' : j.deerZone,
    landform,
  };
  return { geometry: circle(pt, 100), properties: props };
}

function circle(c: [number, number], rM: number) {
  const ring: [number, number][] = [];
  for (let a = 0; a <= 360; a += 15) {
    const r = (a * Math.PI) / 180;
    ring.push([c[0] + (rM * Math.sin(r)) / (111320 * Math.cos((c[1] * Math.PI) / 180)), c[1] + (rM * Math.cos(r)) / DEG2M_LAT]);
  }
  return { type: 'Polygon' as const, coordinates: [ring] };
}
