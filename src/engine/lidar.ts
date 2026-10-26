// LidarRouter — refines the walk-in for the zone or spot you open, using USGS 3DEP elevation fetched on demand at
// ~4 m (resampled from Alabama's 1 m lidar). At this resolution old logging roads, skid trails and benches show up as
// the easiest lines on a slope, so the least-effort path follows them where they exist. Needs a connection.
import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { RouteOption } from './types';
import type { WalkNetwork } from './spot';
import { drawLines, fillRings, findPath, flatWaterMask, simplify, slopeDeg, type Grid } from './pathfind';
import { bearingTo, haversine } from './geography';

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
export const LIDAR_PIXEL_M = 4;
const ROAD_MS = 1.3;

export interface LidarLayers {
  ownership: FeatureCollection<Polygon | MultiPolygon>;
  water?: FeatureCollection<Polygon | MultiPolygon>;
  lines: Array<FeatureCollection<LineString | MultiLineString> | undefined>; // roads + trails (walkable, faster)
}

/** Download a lidar-derived elevation window (Float32) around `center`. */
export async function fetchLidarWindow(center: [number, number], radiusM: number, pixelM = LIDAR_PIXEL_M, signal?: AbortSignal) {
  const kx = 111320 * Math.cos((center[1] * Math.PI) / 180), ky = 110574;
  const dLon = radiusM / kx, dLat = radiusM / ky;
  const bbox: [number, number, number, number] = [center[0] - dLon, center[1] - dLat, center[0] + dLon, center[1] + dLat];
  const w = Math.min(1800, Math.round((2 * radiusM) / pixelM)), h = Math.min(1800, Math.round((2 * radiusM) / pixelM));
  const u = `${SERVICE}?bbox=${bbox.join(',')}&bboxSR=4326&imageSR=4326&size=${w},${h}&format=tiff&compression=LZ77&pixelType=F32&noData=-9999&interpolation=RSP_BilinearInterpolation&f=json`;
  const meta = await (await fetch(u, { signal })).json();
  if (!meta.href) throw new Error('Lidar elevation request failed');
  const buf = await (await fetch(meta.href, { signal })).arrayBuffer();
  const { fromArrayBuffer } = await import('geotiff');
  const img = await (await fromArrayBuffer(buf)).getImage();
  const [r] = (await img.readRasters()) as unknown as [Float32Array];
  const grid: Grid = { w, h, dx: ((bbox[2] - bbox[0]) * kx) / w, dy: ((bbox[3] - bbox[1]) * ky) / h, elev: Float32Array.from(r) };
  return { grid, bbox };
}

export async function lidarRoute(center: [number, number], net: WalkNetwork, layers: LidarLayers, opts: { radiusM?: number; signal?: AbortSignal } = {}): Promise<RouteOption | null> {
  // Window: big enough to reach the network; grow once if no start is inside.
  for (const radiusM of [opts.radiusM ?? 1600, 2600]) {
    const { grid, bbox } = await fetchLidarWindow(center, radiusM, radiusM > 2000 ? 6 : LIDAR_PIXEL_M, opts.signal);
    const { w, h } = grid;
    const pxW = (bbox[2] - bbox[0]) / w, pxH = (bbox[3] - bbox[1]) / h;
    const toPx = ([lon, lat]: number[]): [number, number] => [(lon - bbox[0]) / pxW, (bbox[3] - lat) / pxH];
    const cell = (c: number[]) => { const [x, y] = toPx(c); const xi = Math.floor(x), yi = Math.floor(y); return xi < 0 || yi < 0 || xi >= w || yi >= h ? -1 : yi * w + xi; };
    const toLL = (i: number): [number, number] => [+(bbox[0] + ((i % w) + 0.5) * pxW).toFixed(6), +(bbox[3] - (Math.floor(i / w) + 0.5) * pxH).toFixed(6)];
    const slope = slopeDeg(grid);
    const blocked = new Uint8Array(w * h), onPath = new Uint8Array(w * h);
    const ringsOf = (g: Polygon | MultiPolygon) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => p.map((r) => r.map(toPx)));
    for (const f of layers.ownership.features) if ((f.properties as { ownerclassification?: string })?.ownerclassification !== 'USDA FOREST SERVICE') for (const p of ringsOf(f.geometry)) fillRings(p, w, h, blocked, 1);
    for (const f of layers.water?.features ?? []) for (const p of ringsOf(f.geometry)) fillRings(p, w, h, blocked, 1);
    flatWaterMask(grid, Math.round(5000 / (grid.dx * grid.dy)), blocked); // hydro-flattened ponds/lakes (≥ 0.5 ha)
    for (const fc of layers.lines) for (const f of fc?.features ?? []) {
      const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      drawLines(ls.map((l) => l.map(toPx)), w, h, onPath, 1, 1);
    }
    const seeds = [];
    for (let n = 0; n < net.nodes.length; n++) {
      if (!Number.isFinite(net.driveDist[n])) continue;
      const i = cell(net.nodes[n]);
      if (i >= 0) seeds.push({ i, cost: net.driveDist[n] / ROAD_MS, tag: n });
    }
    if (!seeds.length) continue;
    const goal = cell(center);
    const r = findPath(grid, slope, blocked, onPath, seeds, goal);
    if (!r) continue;
    const chain: [number, number][] = [];
    for (let i = r.seedTag; i >= 0; i = net.prev[i]) chain.push(net.nodes[i]);
    chain.reverse();
    const gridPts = r.cells.map(toLL);
    const coords: [number, number][] = [...chain, ...gridPts.slice(1), center];
    const simp = simplify(coords.map(toPx), 0.6).map(([x, y]) => [+(bbox[0] + x * pxW).toFixed(6), +(bbox[3] - y * pxH).toFixed(6)] as [number, number]);
    // profile from the lidar grid where available
    const prof: [number, number][] = [];
    let d = 0, gain = 0, loss = 0, prevZ: number | null = null;
    coords.forEach((c, k) => {
      if (k) d += haversine(coords[k - 1], c);
      const i = cell(c);
      if (i < 0) return;
      const zz = grid.elev[i];
      if (prevZ != null) { if (zz > prevZ) gain += zz - prevZ; else loss += prevZ - zz; }
      prevZ = zz;
      prof.push([Math.round(d), Math.round(zz)]);
    });
    const step = Math.max(1, Math.ceil(prof.length / 60));
    const st = net.starts[net.driveSrc[r.seedTag]];
    const netM = net.driveDist[r.seedTag];
    return {
      accessPointId: `lidar-${net.driveSrc[r.seedTag]}`, name: st.name, kind: st.kind, coord: net.nodes[st.node], verification: st.verification,
      straightLineMeters: Math.round(haversine(net.nodes[st.node], center)), walkMeters: Math.round(Math.max(haversine(net.nodes[st.node], center), netM + r.lengthM)),
      onNetworkMeters: Math.round(netM + r.onPathM), offTrailMeters: Math.round(r.offPathM), routeKind: 'lidar',
      path: simp, profile: prof.filter((_, k) => k % step === 0 || k === prof.length - 1),
      gainInMeters: Math.round(gain), gainOutMeters: Math.round(loss), maxSlopeDeg: Math.round(r.maxSlopeDeg),
      walkMinutes: Math.round(r.seconds / 60), approachBearing: Math.round(bearingTo(coords[Math.max(0, coords.length - 8)], center)),
      elevationSource: `USGS 3DEP lidar (~${Math.round(grid.dx)} m)`,
    };
  }
  return null;
}
