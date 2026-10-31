// Private land — zones, walking network and geometry for a boundary that belongs to the signed-in account.
//
// Privacy model: the boundary lives in the person's own Realtime Database node (readable only by them). The site ships
// public terrain, habitat and road data for a box around the area (public/data/club/), but nothing that says where
// inside that box the land is. Zones are generated here, in the browser, from the boundary.
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type { Candidate, UserPin } from './types';
import { haversine, polygonContains, type LandMeta, type Layers } from './geography';
import { roadDistance } from './roads';
import { analyzeSpot, buildWalkNetwork, cellOf, circle, slopeAt, type TerrainGrid, type WalkNetwork } from './spot';
import { inClubBox } from './config';

export type ClubGeometry = Polygon | MultiPolygon;

const KX = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110574;

const polysOf = (g: ClubGeometry): Position[][][] => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);

// ---------- geometry ----------

function ringAreaM2(ring: Position[], lat0: number): number {
  const kx = KX(lat0);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * KY) - (ring[i][0] * kx) * (ring[j][1] * KY);
  return Math.abs(a / 2);
}

export function polygonAcres(g: ClubGeometry): number {
  let m2 = 0;
  for (const rings of polysOf(g)) {
    const lat0 = rings[0][0][1];
    m2 += ringAreaM2(rings[0], lat0) - rings.slice(1).reduce((s, h) => s + ringAreaM2(h, lat0), 0);
  }
  return m2 / 4046.86;
}

export function clubBounds(g: ClubGeometry): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of polysOf(g).flatMap((r) => r[0])) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}
export const clubCenter = (g: ClubGeometry): [number, number] => { const b = clubBounds(g); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };

/** Meters from `pt` to the nearest boundary edge. */
export function edgeDistanceM(g: ClubGeometry, pt: [number, number]): number {
  const kx = KX(pt[1]);
  let best = Infinity;
  for (const rings of polysOf(g)) for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
    const ax = (ring[i][0] - pt[0]) * kx, ay = (ring[i][1] - pt[1]) * KY, bx = (ring[i + 1][0] - pt[0]) * kx, by = (ring[i + 1][1] - pt[1]) * KY;
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(ax + vx * t, ay + vy * t));
  }
  return best;
}

/** Zones can only be built where the app has terrain data: the club's centre must be inside the public data box. */
export const hasTerrainData = (g: ClubGeometry) => inClubBox(clubCenter(g));

export const insideClub = (g: ClubGeometry, pt: [number, number]) => polygonContains(g, pt);

// ---------- walking network for the club box ----------

type Lines = FeatureCollection<LineString | MultiLineString>;
const DRIVABLE = new Set(['residential', 'service', 'tertiary', 'secondary', 'unclassified', 'living_street', 'track', 'road']);
const PATHS = new Set(['path', 'footway', 'bridleway', 'cycleway', 'track', 'service']);
const emptyPoints: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };
const emptyLines: Lines = { type: 'FeatureCollection', features: [] };

const lineCoords = (f: Feature<LineString | MultiLineString>) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates);

/**
 * Roads you can start from (public roads, plus any road or track inside the club, plus your own parking pins) and
 * paths you can walk. Interstates and highways are left out (no parking, not walkable). Private driveways outside
 * the club are left out. OpenStreetMap is community-mapped, so gates and parking are never treated as verified.
 */
export function buildClubNetwork(roads: Lines, club: ClubGeometry, pins: UserPin[] = []): WalkNetwork {
  const starts: Feature<LineString>[] = [];
  const paths: Feature<LineString>[] = [];
  for (const f of roads.features) {
    const p = (f.properties ?? {}) as { highway?: string; name?: string | null; access?: string | null; ref?: string | null };
    const hw = p.highway ?? '';
    for (const line of lineCoords(f)) {
      const inside = line.some((c) => polygonContains(club, [c[0], c[1]]));
      const priv = p.access === 'private' || p.access === 'no';
      if (DRIVABLE.has(hw) && (!priv || inside)) {
        starts.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { ref: p.name ?? (inside ? 'Road inside the club' : `${hw} road`), verification: `OpenStreetMap ${hw}${inside ? ' inside your club' : ''} (community-mapped): where you may park, gates and conditions are NOT verified.` } });
      } else if (PATHS.has(hw) && !priv) {
        paths.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} });
      }
    }
  }
  const b = clubBounds(club);
  for (const pin of pins) {
    if (pin.kind !== 'parking') continue;
    const [x, y] = pin.coord;
    if (x < b[0] - 0.02 || x > b[2] + 0.02 || y < b[1] - 0.02 || y > b[3] + 0.02) continue;
    starts.unshift({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[x, y], [x + 0.00002, y]] }, properties: { ref: pin.note?.trim() || 'Your parking pin', verification: 'Your own parking pin (you placed it).' } });
  }
  return buildWalkNetwork(emptyLines, { type: 'FeatureCollection', features: paths }, { type: 'FeatureCollection', features: starts }, emptyPoints, emptyPoints);
}

// ---------- zone generation ----------

export interface ClubZoneOptions { meta?: LandMeta; spacingM?: number; minEdgeM?: number; roadClearM?: number; separationM?: number; max?: number; maxSlopeDeg?: number }

/**
 * Candidate zones for the club: a regular lattice of spots inside the boundary, each scored with the same terrain and
 * habitat logic as "check this spot", then the best ones kept at least `separationM` apart. A lattice is used instead of
 * only saddles/benches because gentle ground like this has few of those, and it stays deterministic. Spots too close to the
 * boundary (so the zone would spill onto a neighbor) or to a mapped road are skipped.
 */
export function generateClubZones(grid: TerrainGrid, club: ClubGeometry, net: WalkNetwork | null, layers: Layers, o: ClubZoneOptions = {}): Candidate[] {
  const spacing = o.spacingM ?? 110, minEdge = o.minEdgeM ?? 70, roadClear = o.roadClearM ?? 50, sep = o.separationM ?? 210, max = o.max ?? 24, maxSlope = o.maxSlopeDeg ?? 30;
  const [w, s, e, n] = clubBounds(club);
  const lat0 = (s + n) / 2;
  const dLon = spacing / KX(lat0), dLat = spacing / KY;
  const found: Candidate[] = [];
  for (let lat = s + dLat / 2; lat < n; lat += dLat) for (let lon = w + dLon / 2; lon < e; lon += dLon) {
    const pt: [number, number] = [+lon.toFixed(6), +lat.toFixed(6)];
    if (!polygonContains(club, pt) || edgeDistanceM(club, pt) < minEdge) continue;
    const c = cellOf(grid, pt);
    if (!c || slopeAt(grid, c.i) > maxSlope) continue;
    if (roadDistance(pt, roadClear + 1) < roadClear) continue;
    const r = analyzeSpot(grid, layers, net, pt, { club, clubMeta: o.meta, asZone: true });
    if ('error' in r) continue;
    found.push(r);
  }
  // best first; deterministic tie-break by position
  found.sort((a, b) => b.properties.terrainScore - a.properties.terrainScore || a.properties.center[1] - b.properties.center[1] || a.properties.center[0] - b.properties.center[0]);
  const kept: Candidate[] = [];
  for (const c of found) {
    if (kept.length >= max) break;
    if (kept.some((k) => haversine(k.properties.center, c.properties.center) < sep)) continue;
    kept.push(c);
  }
  return kept.map((c, i) => {
    const p = c.properties;
    const ab = p.type === 'spot' ? 'SP' : p.type.slice(0, 2).toUpperCase();
    return { geometry: circle(p.center, 70), properties: { ...p, id: `CL-${ab}-${String(i + 1).padStart(3, '0')}`, club: true } };
  });
}
