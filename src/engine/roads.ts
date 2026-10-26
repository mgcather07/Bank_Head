// Road proximity index (FS road inventory + state highways + OSM roads/tracks), used to keep setup points
// and checked spots off roads. Segments are bucketed on a ~200 m grid for fast nearest-distance queries.
import type { FeatureCollection, LineString, MultiLineString } from 'geojson';

type Seg = [number, number, number, number];
export interface RoadIndex { cells: Map<string, Seg[]>; cell: number }

const CELL = 0.002;
const key = (x: number, y: number) => `${x},${y}`;

export function buildRoadIndex(...fcs: Array<FeatureCollection<LineString | MultiLineString> | undefined>): RoadIndex {
  const cells = new Map<string, Seg[]>();
  for (const fc of fcs) {
    for (const f of fc?.features ?? []) {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
        const s: Seg = [l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]];
        const x0 = Math.floor(Math.min(s[0], s[2]) / CELL), x1 = Math.floor(Math.max(s[0], s[2]) / CELL);
        const y0 = Math.floor(Math.min(s[1], s[3]) / CELL), y1 = Math.floor(Math.max(s[1], s[3]) / CELL);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = key(x, y);
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k)!.push(s);
        }
      }
    }
  }
  return { cells, cell: CELL };
}

let current: RoadIndex | null = null;
export const setRoadIndex = (r: RoadIndex | null) => { current = r; };
export const getRoadIndex = () => current;

/** Meters from pt to the nearest road (searches up to ~maxM); Infinity when none is that close or no index is loaded. */
export function roadDistance(pt: [number, number], maxM = 600, idx: RoadIndex | null = current): number {
  if (!idx) return Infinity;
  const kx = 111320 * Math.cos((pt[1] * Math.PI) / 180), ky = 110574;
  const r = Math.ceil(maxM / (CELL * ky)) + 1;
  const cx = Math.floor(pt[0] / CELL), cy = Math.floor(pt[1] / CELL);
  let best = Infinity;
  const seen = new Set<Seg>();
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    for (const s of idx.cells.get(key(cx + dx, cy + dy)) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const ax = (s[0] - pt[0]) * kx, ay = (s[1] - pt[1]) * ky, bx = (s[2] - pt[0]) * kx, by = (s[3] - pt[1]) * ky;
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1)));
      best = Math.min(best, Math.hypot(ax + vx * t, ay + vy * t));
    }
  }
  return best <= maxM ? best : Infinity;
}

let pathIdx: RoadIndex | null = null;
/** Index of roads AND trails, used to tell which parts of a route follow a mapped path. */
export const setPathIndex = (r: RoadIndex | null) => { pathIdx = r; };
export const pathDistance = (pt: [number, number], maxM = 60) => roadDistance(pt, maxM, pathIdx);
