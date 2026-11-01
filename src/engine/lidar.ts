// LidarRouter — walk-ins and zone outlines from USGS 3DEP elevation fetched on demand at ~4 m (resampled from
// Alabama's 1 m lidar). At this resolution old logging roads, skid trails and benches show up as the easiest lines on
// a slope, so the least-effort path follows them where they exist. Needs a connection. The same routing also runs on
// the app's bundled terrain grid (≈30–50 m), so every zone has a terrain-following walk-in even offline.
import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { RouteOption } from './types';
import type { TerrainGrid, WalkNetwork } from './spot';
import { drawLines, fillRings, flatWaterMask, search, simplify, slopeDeg, tracePath, type Grid, type Search, type Seed } from './pathfind';
import { bearingTo, haversine } from './geography';
import { lidarSampler, zoneShape, type ShapeOptions } from './shape';

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
export const LIDAR_PIXEL_M = 4;
const MAX_PX = 1800;
const ROAD_MS = 1.3;
const KY = 110574;
const kxAt = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

type BBox = [number, number, number, number];

export interface LidarLayers {
  /** Bankhead: non-Forest-Service parcels are blocked. Omitted for the private club, where `walkable` is used instead. */
  ownership?: FeatureCollection<Polygon | MultiPolygon>;
  /** Private club: only ground inside this boundary (plus mapped roads and paths) may be walked; everything else is a neighbor's land. */
  walkable?: Polygon | MultiPolygon;
  water?: FeatureCollection<Polygon | MultiPolygon>;
  lines: Array<FeatureCollection<LineString | MultiLineString> | undefined>; // roads + trails (walkable, faster)
}

export interface Target { id: string; center: [number, number] }

/** Download a lidar-derived elevation window (Float32) covering `bbox`. */
export async function fetchLidarBox(bbox: BBox, pixelM = LIDAR_PIXEL_M, signal?: AbortSignal) {
  const lat = (bbox[1] + bbox[3]) / 2, kx = kxAt(lat);
  const w = Math.min(MAX_PX, Math.round(((bbox[2] - bbox[0]) * kx) / pixelM)), h = Math.min(MAX_PX, Math.round(((bbox[3] - bbox[1]) * KY) / pixelM));
  const u = `${SERVICE}?bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=tiff&compression=LZ77&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=json`;
  // The USGS service is sometimes slow or drops a request under load; retry a couple of times before giving up.
  let buf: ArrayBuffer | null = null, lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !buf; attempt++) {
    try {
      const meta = await (await fetch(u, { signal })).json();
      if (!meta.href) throw new Error('Lidar elevation request failed');
      const res = await fetch(meta.href, { signal });
      if (!res.ok) throw new Error(`Lidar download failed (${res.status})`);
      buf = await res.arrayBuffer();
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (!buf) throw lastErr instanceof Error ? lastErr : new Error('Lidar elevation request failed');
  const { fromArrayBuffer } = await import('geotiff');
  const img = await (await fromArrayBuffer(buf)).getImage();
  const [r] = (await img.readRasters()) as unknown as [Float32Array];
  const grid: Grid = { w, h, dx: ((bbox[2] - bbox[0]) * kx) / w, dy: ((bbox[3] - bbox[1]) * KY) / h, elev: Float32Array.from(r) };
  return { grid, bbox };
}

/** Download a square lidar window of `radiusM` around `center`. */
export function fetchLidarWindow(center: [number, number], radiusM: number, pixelM = LIDAR_PIXEL_M, signal?: AbortSignal) {
  const dLon = radiusM / kxAt(center[1]), dLat = radiusM / KY;
  return fetchLidarBox([center[0] - dLon, center[1] - dLat, center[0] + dLon, center[1] + dLat], pixelM, signal);
}

/** Box around the targets plus `marginM` on every side. */
export function boxAround(pts: Array<[number, number]>, marginM: number): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const dLon = marginM / kxAt((s + n) / 2), dLat = marginM / KY;
  return [w - dLon, s - dLat, e + dLon, n + dLat];
}

/** Elevation window plus the walkability layers burned into it. */
interface Prepared { grid: Grid; bbox: BBox; slope: Uint8Array; blocked: Uint8Array; onPath: Uint8Array; seeds: Seed[]; cell: (c: number[]) => number; toLL: (i: number) => [number, number]; toPx: (c: number[]) => [number, number]; pxW: number; pxH: number }

function prepare(grid: Grid, bbox: BBox, net: WalkNetwork, layers: LidarLayers, water: boolean): Prepared {
  const { w, h } = grid;
  const pxW = (bbox[2] - bbox[0]) / w, pxH = (bbox[3] - bbox[1]) / h;
  const toPx = ([lon, lat]: number[]): [number, number] => [(lon - bbox[0]) / pxW, (bbox[3] - lat) / pxH];
  const cell = (c: number[]) => { const [x, y] = toPx(c); const xi = Math.floor(x), yi = Math.floor(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : yi * w + xi; };
  const toLL = (i: number): [number, number] => [+(bbox[0] + ((i % w) + 0.5) * pxW).toFixed(6), +(bbox[3] - (Math.floor(i / w) + 0.5) * pxH).toFixed(6)];
  const slope = slopeDeg(grid);
  const blocked = new Uint8Array(w * h), onPath = new Uint8Array(w * h);
  const ringsOf = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => r.map(toPx)));
  for (const f of layers.ownership?.features ?? []) if ((f.properties as { ownerclassification?: string })?.ownerclassification !== 'USDA FOREST SERVICE') for (const p of ringsOf(f.geometry)) fillRings(p, w, h, blocked, 1);
  if (layers.walkable) {
    const ok = new Uint8Array(w * h);
    for (const p of ringsOf(layers.walkable)) fillRings(p, w, h, ok, 1);
    for (let i = 0; i < ok.length; i++) blocked[i] = ok[i] ? 0 : 1;
  }
  for (const f of layers.water?.features ?? []) for (const p of ringsOf(f.geometry)) fillRings(p, w, h, blocked, 1);
  if (water) flatWaterMask(grid, Math.round(5000 / (grid.dx * grid.dy)), blocked); // hydro-flattened ponds/lakes (≥ 0.5 ha)
  for (const fc of layers.lines) for (const f of fc?.features ?? []) {
    const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    drawLines(ls.map((l) => l.map(toPx)), w, h, onPath, 1, grid.dx < 10 ? 1 : 0);
  }
  const seeds: Seed[] = [];
  for (let n = 0; n < net.nodes.length; n++) {
    if (!Number.isFinite(net.driveDist[n])) continue;
    const i = cell(net.nodes[n]);
    if (i >= 0) seeds.push({ i, cost: net.driveDist[n] / ROAD_MS, tag: n });
  }
  return { grid, bbox, slope, blocked, onPath, seeds, cell, toLL, toPx, pxW, pxH };
}

function buildRoute(p: Prepared, net: WalkNetwork, s: Search, center: [number, number], kind: 'lidar' | 'terrain', source: string): RouteOption | null {
  const goal = p.cell(center);
  const r = tracePath(p.grid, p.slope, p.onPath, s, goal);
  if (!r || r.seedTag < 0) return null;
  const chain: [number, number][] = [];
  for (let i = r.seedTag; i >= 0; i = net.prev[i]) chain.push(net.nodes[i]);
  chain.reverse();
  const coords: [number, number][] = [...chain, ...r.cells.slice(1).map(p.toLL), center];
  const simp = simplify(coords.map(p.toPx), kind === 'lidar' ? 0.6 : 0.25).map(([x, y]) => [+(p.bbox[0] + x * p.pxW).toFixed(6), +(p.bbox[3] - y * p.pxH).toFixed(6)] as [number, number]);
  // profile from the elevation window where available
  const prof: [number, number][] = [];
  let d = 0, gain = 0, loss = 0, prevZ: number | null = null;
  coords.forEach((c, k) => {
    if (k) d += haversine(coords[k - 1], c);
    const i = p.cell(c);
    if (i < 0) return;
    const zz = p.grid.elev[i];
    if (prevZ != null) { if (zz > prevZ) gain += zz - prevZ; else loss += prevZ - zz; }
    prevZ = zz;
    prof.push([Math.round(d), Math.round(zz)]);
  });
  const step = Math.max(1, Math.ceil(prof.length / 60));
  const st = net.starts[net.driveSrc[r.seedTag]];
  const netM = net.driveDist[r.seedTag];
  return {
    accessPointId: `${kind}-${net.driveSrc[r.seedTag]}`, name: st.name, kind: st.kind, coord: net.nodes[st.node], verification: st.verification,
    straightLineMeters: Math.round(haversine(net.nodes[st.node], center)), walkMeters: Math.round(Math.max(haversine(net.nodes[st.node], center), netM + r.lengthM)),
    onNetworkMeters: Math.round(netM + r.onPathM), offTrailMeters: Math.round(r.offPathM), routeKind: kind,
    path: simp, profile: prof.filter((_, k) => k % step === 0 || k === prof.length - 1),
    gainInMeters: Math.round(gain), gainOutMeters: Math.round(loss), maxSlopeDeg: Math.round(r.maxSlopeDeg),
    walkMinutes: Math.round(r.seconds / 60), approachBearing: Math.round(bearingTo(coords[Math.max(0, coords.length - 8)], center)),
    elevationSource: source,
  };
}

export interface ZoneRefinement { route: RouteOption | null; shape: Polygon | null }

/**
 * Walk-ins (and, with `shape`, outlines) for many zones from one lidar window and one search. The window covers every
 * zone plus `marginM`, so the search reaches the roads they start from.
 */
export async function lidarZones(targets: Target[], net: WalkNetwork, layers: LidarLayers, opts: { marginM?: number; signal?: AbortSignal; shape?: ShapeOptions | false } = {}): Promise<Record<string, ZoneRefinement>> {
  if (!targets.length) return {};
  const bbox = boxAround(targets.map((t) => t.center), opts.marginM ?? 900);
  const spanM = Math.max((bbox[2] - bbox[0]) * kxAt((bbox[1] + bbox[3]) / 2), (bbox[3] - bbox[1]) * KY);
  const { grid } = await fetchLidarBox(bbox, Math.max(LIDAR_PIXEL_M, Math.ceil(spanM / MAX_PX)), opts.signal);
  const p = prepare(grid, bbox, net, layers, true);
  const s = search(grid, p.slope, p.blocked, p.onPath, p.seeds, targets.map((t) => p.cell(t.center)));
  const source = `USGS 3DEP lidar (~${Math.round(grid.dx)} m)`;
  const sample = opts.shape === false ? null : lidarSampler(grid, bbox, p.slope);
  const out: Record<string, ZoneRefinement> = {};
  for (const t of targets) out[t.id] = { route: buildRoute(p, net, s, t.center, 'lidar', source), shape: sample ? zoneShape(sample, t.center, opts.shape || {}) : null };
  return out;
}

/** Lidar walk-in (and outline) for one zone, growing the window once if no road is inside it. */
export async function lidarZone(center: [number, number], net: WalkNetwork, layers: LidarLayers, opts: { radiusM?: number; signal?: AbortSignal; shape?: ShapeOptions | false } = {}): Promise<ZoneRefinement | null> {
  for (const marginM of [opts.radiusM ?? 1600, 2600]) {
    const r = (await lidarZones([{ id: 'z', center }], net, layers, { marginM, signal: opts.signal, shape: opts.shape })).z;
    if (r.route) return r;
  }
  return null;
}

export async function lidarRoute(center: [number, number], net: WalkNetwork, layers: LidarLayers, opts: { radiusM?: number; signal?: AbortSignal } = {}): Promise<RouteOption | null> {
  return (await lidarZone(center, net, layers, { ...opts, shape: false }))?.route ?? null;
}

/**
 * Terrain-following walk-ins on the bundled terrain grid — no connection needed. Used for zones the offline build did
 * not route (your club, checked spots) until the lidar version arrives.
 */
export function terrainRoutes(tg: TerrainGrid, targets: Target[], net: WalkNetwork, layers: LidarLayers, marginM = 1500): Record<string, RouteOption | null> {
  if (!targets.length) return {};
  const want = boxAround(targets.map((t) => t.center), marginM);
  const x0 = Math.max(0, Math.floor((want[0] - tg.bbox[0]) / tg.cellDeg)), x1 = Math.min(tg.width, Math.ceil((want[2] - tg.bbox[0]) / tg.cellDeg));
  const y0 = Math.max(0, Math.floor((tg.bbox[3] - want[3]) / tg.cellDeg)), y1 = Math.min(tg.height, Math.ceil((tg.bbox[3] - want[1]) / tg.cellDeg));
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 || h < 3) return {};
  const bbox: BBox = [tg.bbox[0] + x0 * tg.cellDeg, tg.bbox[3] - y1 * tg.cellDeg, tg.bbox[0] + x1 * tg.cellDeg, tg.bbox[3] - y0 * tg.cellDeg];
  const elev = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) elev[y * w + x] = tg.elev[(y + y0) * tg.width + x + x0] / 2;
  const lat = (bbox[1] + bbox[3]) / 2;
  const grid: Grid = { w, h, dx: tg.cellDeg * kxAt(lat), dy: tg.cellDeg * KY, elev };
  const p = prepare(grid, bbox, net, layers, false);
  const s = search(grid, p.slope, p.blocked, p.onPath, p.seeds, targets.map((t) => p.cell(t.center)));
  const source = `terrain grid (~${Math.round(grid.dx)} m)`;
  return Object.fromEntries(targets.map((t) => [t.id, buildRoute(p, net, s, t.center, 'terrain', source)]));
}
