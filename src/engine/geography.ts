// GeographyService / LandOwnershipService — jurisdiction lookup for an exact point.
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';

export interface Layers {
  zoneD?: FeatureCollection<Polygon | MultiPolygon>;
  zoneDLines?: FeatureCollection<LineString | MultiLineString>;
  counties?: FeatureCollection<Polygon | MultiPolygon>;
  wma: FeatureCollection<Polygon | MultiPolygon>;
  nfAdmin: FeatureCollection<Polygon | MultiPolygon>;
  ownership: FeatureCollection<Polygon | MultiPolygon>;
  wilderness: FeatureCollection<Polygon | MultiPolygon>;
  highways: FeatureCollection<LineString | MultiLineString>;
}

function ringContains(ring: Position[], [x, y]: [number, number]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonContains(geom: Polygon | MultiPolygon, pt: [number, number]): boolean {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => ringContains(rings[0], pt) && !rings.slice(1).some((h) => ringContains(h, pt)));
}

export const anyContains = (fc: FeatureCollection<Polygon | MultiPolygon> | undefined, pt: [number, number]) =>
  !!fc?.features.some((f) => f.geometry && polygonContains(f.geometry, pt));

export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371008.8, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function bearingTo(a: [number, number], b: [number, number]): number {
  const toR = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * toR) * Math.cos(b[1] * toR);
  const x = Math.cos(a[1] * toR) * Math.sin(b[1] * toR) - Math.sin(a[1] * toR) * Math.cos(b[1] * toR) * Math.cos((b[0] - a[0]) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Nearest point on a polyline (planar approximation, fine at this scale). */
function nearestOnLine(coords: Position[], p: [number, number]) {
  let best = { d: Infinity, pt: coords[0] as Position };
  const kx = Math.cos((p[1] * Math.PI) / 180);
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i], [bx, by] = coords[i + 1];
    const vx = (bx - ax) * kx, vy = by - ay, wx = (p[0] - ax) * kx, wy = p[1] - ay;
    const t = Math.max(0, Math.min(1, (vx * wx + vy * wy) / (vx * vx + vy * vy || 1)));
    const q: Position = [ax + (bx - ax) * t, ay + (by - ay) * t];
    const d = haversine(p, q as [number, number]);
    if (d < best.d) best = { d, pt: q };
  }
  return best;
}

export type JurisdictionKind = 'black_warrior_wma' | 'nf_outside_wma' | 'private_or_unknown';

export interface Jurisdiction {
  kind: JurisdictionKind;
  label: string;
  inWma: boolean;
  inNfAdmin: boolean;
  fsOwned: boolean | null;
  wilderness: boolean;
  zone: 'A' | 'B' | null;
  provisionalZone: 'A' | 'B' | null;
  distToDividerM: number | null;
  deerZone: 'C' | 'D' | null;
  notes: string[];
}

export const ZONE_UNCERTAINTY_M = 400;

export function zoneFor(layers: Pick<Layers, 'highways'>, pt: [number, number]) {
  let best: { d: number; pt: Position } | null = null;
  for (const f of layers.highways.features) {
    if ((f.properties as { ref?: string })?.ref !== 'AL 33') continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const l of lines) {
      const n = nearestOnLine(l, pt);
      if (!best || n.d < best.d) best = n;
    }
  }
  if (!best) return { zone: null, provisional: null, dist: null };
  const side = pt[0] > best.pt[0] ? 'B' : 'A';
  return { zone: best.d < ZONE_UNCERTAINTY_M ? null : (side as 'A' | 'B'), provisional: side as 'A' | 'B', dist: Math.round(best.d) };
}

const ZONE_C_COUNTIES = new Set(['Winston', 'Lawrence', 'Walker', 'Cullman']);
export const DEER_ZONE_UNCERTAINTY_M = 400;

/** Statewide deer zone at a point (reconstructed Zone D line; Zone C = rest of Winston/Lawrence/Walker/Cullman). */
export function deerZoneAt(layers: Layers, pt: [number, number]): { deerZone: 'C' | 'D' | null; distToLine: number | null } {
  if (!layers.zoneD || !layers.zoneDLines) return { deerZone: null, distToLine: null };
  let d = Infinity;
  for (const f of layers.zoneDLines.features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const l of lines) d = Math.min(d, nearestOnLine(l, pt).d);
  }
  if (d < DEER_ZONE_UNCERTAINTY_M) return { deerZone: null, distToLine: Math.round(d) };
  if (anyContains(layers.zoneD, pt)) return { deerZone: 'D', distToLine: Math.round(d) };
  const c = layers.counties?.features.find((f) => polygonContains(f.geometry, pt));
  return { deerZone: c && ZONE_C_COUNTIES.has((c.properties as { name?: string })?.name ?? '') ? 'C' : null, distToLine: Math.round(d) };
}

export function lookupJurisdiction(layers: Layers, pt: [number, number]): Jurisdiction {
  const inWma = anyContains(layers.wma, pt);
  const inNfAdmin = anyContains(layers.nfAdmin, pt);
  const fsFeatures = layers.ownership.features.filter((f: Feature) => (f.properties as { ownerclassification?: string })?.ownerclassification === 'USDA FOREST SERVICE');
  const fsOwned = layers.ownership.features.length ? fsFeatures.some((f) => polygonContains(f.geometry, pt)) : null;
  const wilderness = anyContains(layers.wilderness, pt);
  const notes: string[] = [];
  const z = zoneFor(layers, pt);
  if (inWma && fsOwned) {
    if (z.zone == null) notes.push(`Within ${z.dist} m of AL 33 (Zone A/B divider) — confirm zone on the official map.`);
    if (wilderness) notes.push('Sipsey Wilderness: no motorized or mechanized travel; foot/horse access only.');
    notes.push('Zone A/B split digitized from AL 33 per the official 2026-27 permit map (derived, not an official zone polygon).');
    return { kind: 'black_warrior_wma', label: `Black Warrior WMA${z.zone ? ` — Zone ${z.zone}` : ''}${wilderness ? ' (Sipsey Wilderness)' : ''}`, inWma, inNfAdmin, fsOwned, wilderness, zone: z.zone, provisionalZone: z.provisional, distToDividerM: z.dist, deerZone: 'D', notes };
  }
  if (inWma && fsOwned === false) {
    notes.push('Inside the WMA outline but USFS ownership records show non-Forest Service land here. Treat as private until verified.');
    return { kind: 'private_or_unknown', label: 'Non-FS parcel inside WMA outline', inWma, inNfAdmin, fsOwned, wilderness, zone: null, provisionalZone: z.provisional, distToDividerM: z.dist, deerZone: null, notes };
  }
  if (!inWma && fsOwned) {
    const dz = deerZoneAt(layers, pt);
    notes.push('Bankhead National Forest land outside the Black Warrior WMA: statewide public-land deer seasons apply (no WMA license or AREA permit).');
    if (dz.deerZone == null) notes.push(dz.distToLine != null && dz.distToLine < DEER_ZONE_UNCERTAINTY_M ? `Within ${dz.distToLine} m of the Deer Zone C/D line — confirm your zone on the ADCNR map.` : 'Deer zone could not be determined here — check the ADCNR zone map.');
    notes.push('Deer Zone D line reconstructed from the official 2026-27 boundary description (derived, not an official polygon).');
    return { kind: 'nf_outside_wma', label: `Bankhead National Forest${dz.deerZone ? ` — Deer Zone ${dz.deerZone}` : ''}`, inWma, inNfAdmin, fsOwned, wilderness, zone: null, provisionalZone: null, distToDividerM: null, deerZone: dz.deerZone, notes };
  }
  if (inNfAdmin) notes.push('Inside the National Forest administrative boundary, but not Forest Service-owned per USFS ownership data — likely a private inholding.');
  else notes.push('Outside Bankhead National Forest and Black Warrior WMA.');
  return { kind: 'private_or_unknown', label: inNfAdmin ? 'Private / non-FS inholding' : 'Outside public hunting land', inWma, inNfAdmin, fsOwned, wilderness, zone: null, provisionalZone: null, distToDividerM: null, deerZone: null, notes };
}
