// Zone outlines that follow the ground instead of fixed circles. From the zone's centre the outline reaches out in
// every direction until the land changes: the elevation leaves the zone's contour band (so a side-slope zone runs
// along the hill and a ridge zone follows the ridge), the ground turns steep, or it meets the property line or a road.
import type { Polygon } from 'geojson';
import type { Grid } from './pathfind';
import { cellOf, elevAt, slopeAt, type TerrainGrid } from './spot';

/** Elevation (m) and slope (°) at a point, or null outside the data. */
export type Sampler = (p: [number, number]) => { z: number; slope: number } | null;

const KY = 110574;
const kxAt = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Bilinear elevation from the app's terrain grid (≈30–50 m cells); slope is the cell's. */
export function terrainSampler(g: TerrainGrid): Sampler {
  return ([lon, lat]) => {
    const fx = (lon - g.bbox[0]) / g.cellDeg - 0.5, fy = (g.bbox[3] - lat) / g.cellDeg - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= g.width || y0 + 1 >= g.height) return null;
    const tx = fx - x0, ty = fy - y0, i = y0 * g.width + x0;
    const z = (elevAt(g, i) * (1 - tx) + elevAt(g, i + 1) * tx) * (1 - ty) + (elevAt(g, i + g.width) * (1 - tx) + elevAt(g, i + g.width + 1) * tx) * ty;
    const c = cellOf(g, [lon, lat]);
    return { z, slope: c ? slopeAt(g, c.i) : 0 };
  };
}

/** Bilinear elevation from a lidar window (≈4 m cells). */
export function lidarSampler(grid: Grid, bbox: [number, number, number, number], slope: Uint8Array): Sampler {
  const pxW = (bbox[2] - bbox[0]) / grid.w, pxH = (bbox[3] - bbox[1]) / grid.h;
  return ([lon, lat]) => {
    const fx = (lon - bbox[0]) / pxW - 0.5, fy = (bbox[3] - lat) / pxH - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= grid.w || y0 + 1 >= grid.h) return null;
    const tx = fx - x0, ty = fy - y0, i = y0 * grid.w + x0, e = grid.elev;
    if (!(e[i] > -1000 && e[i + 1] > -1000 && e[i + grid.w] > -1000 && e[i + grid.w + 1] > -1000)) return null;
    const z = (e[i] * (1 - tx) + e[i + 1] * tx) * (1 - ty) + (e[i + grid.w] * (1 - tx) + e[i + grid.w + 1] * tx) * ty;
    return { z, slope: slope[Math.round(fy) * grid.w + Math.round(fx)] ?? 0 };
  };
}

export interface ShapeOptions {
  maxR?: number; minR?: number;
  /** Meters above or below the zone's own elevation the outline may wander. */
  bandM?: number;
  maxSlopeDeg?: number;
  /** False where the zone may not reach (outside the property, on a road). */
  allowed?: (p: [number, number]) => boolean;
  rays?: number;
}

/** A smooth polygon around `center` shaped by the terrain. Falls back to a circle of `minR` where there is no data. */
export function zoneShape(sample: Sampler, center: [number, number], o: ShapeOptions = {}): Polygon {
  const maxR = o.maxR ?? 130, minR = o.minR ?? 35, band = o.bandM ?? 5, maxSlope = o.maxSlopeDeg ?? 32, rays = o.rays ?? 64;
  const kx = kxAt(center[1]);
  const at = (a: number, r: number): [number, number] => [center[0] + (r * Math.sin(a)) / kx, center[1] + (r * Math.cos(a)) / KY];
  // the zone's own level: average of the ground within ~12 m so one noisy cell doesn't skew the band
  const zs: number[] = [];
  for (let k = 0; k < 8; k++) { const s = sample(at((k * Math.PI) / 4, 12)); if (s) zs.push(s.z); }
  const s0 = sample(center);
  if (s0) zs.push(s0.z, s0.z);
  const z0 = zs.length ? zs.reduce((x, y) => x + y, 0) / zs.length : null;
  const radii: number[] = [];
  for (let k = 0; k < rays; k++) {
    const a = (k / rays) * 2 * Math.PI;
    let r = minR;
    if (z0 != null) {
      for (let d = 8; d <= maxR; d += 4) {
        const p = at(a, d), s = sample(p);
        if (!s || Math.abs(s.z - z0) > band || s.slope > maxSlope || (o.allowed && !o.allowed(p))) break;
        r = Math.max(r, d);
      }
    }
    // never push the minimum radius over a boundary or road
    if (o.allowed) while (r > 12 && !o.allowed(at(a, r))) r -= 4;
    radii.push(r);
  }
  // smooth: circular moving average, then cap how fast the outline can jump between neighbouring rays
  const sm = radii.map((_, k) => { let t = 0; for (let j = -3; j <= 3; j++) t += radii[(k + j + rays) % rays]; return t / 7; });
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < rays; k++) {
    const nb = Math.min(sm[(k + 1) % rays], sm[(k - 1 + rays) % rays]);
    sm[k] = Math.min(sm[k], nb * 1.35 + 6);
  }
  const ring = sm.map((r, k) => at((k / rays) * 2 * Math.PI, r)).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as [number, number]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

/** Hectares inside a single-ring polygon. */
export function ringHectares(p: Polygon): number {
  const ring = p.coordinates[0], kx = kxAt(ring[0][1]);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * kx * ring[i][1] * KY - ring[i][0] * kx * ring[j][1] * KY;
  return Math.abs(a / 2) / 1e4;
}
