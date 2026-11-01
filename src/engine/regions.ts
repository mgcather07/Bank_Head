// Public hunting regions. Each has its own precomputed data pack (scripts/config.mjs REGIONS mirrors these boxes):
// Bankhead lives at the top of data/ (Black Warrior WMA + the rest of Bankhead NF); the Talladega National Forest
// WMAs each live in data/<id>/ and cover only the WMA.
export type RegionId = 'bankhead' | 'choccolocco' | 'hollins' | 'oakmulgee';
export type WmaId = 'choccolocco' | 'hollins' | 'oakmulgee';

export interface Region {
  id: RegionId;
  /** Data folder under the site's data/ ('' for Bankhead). */
  dir: string;
  bbox: [number, number, number, number];
  /** WMA outline extent, for "show the whole area". */
  bounds: [[number, number], [number, number]];
  center: [number, number];
  forest: string;
  wmaName: string;
  /** Set for the Talladega WMAs (their own calendar in regulations.ts). */
  wmaId?: WmaId;
  /** Deer zone whose rut timing stands in for this area (rut.ts). */
  rutZone: 'C' | 'D';
}

const mid = (b: [number, number, number, number]): [number, number] => [+((b[0] + b[2]) / 2).toFixed(4), +((b[1] + b[3]) / 2).toFixed(4)];

export const REGIONS: Record<RegionId, Region> = {
  bankhead: { id: 'bankhead', dir: '', bbox: [-87.66, 33.96, -87.08, 34.5], bounds: [[-87.62, 34.02], [-87.12, 34.4]], center: [-87.37, 34.23], forest: 'Bankhead National Forest', wmaName: 'Black Warrior WMA', rutZone: 'D' },
  choccolocco: { id: 'choccolocco', dir: 'choccolocco/', bbox: [-85.83, 33.61, -85.45, 33.87], bounds: [[-85.788, 33.646], [-85.489, 33.834]], center: mid([-85.788, 33.646, -85.489, 33.834]), forest: 'Talladega National Forest', wmaName: 'Choccolocco WMA', wmaId: 'choccolocco', rutZone: 'C' },
  hollins: { id: 'hollins', dir: 'hollins/', bbox: [-86.24, 33.09, -86.0, 33.3], bounds: [[-86.2, 33.13], [-86.045, 33.265]], center: mid([-86.2, 33.13, -86.045, 33.265]), forest: 'Talladega National Forest', wmaName: 'Hollins WMA', wmaId: 'hollins', rutZone: 'C' },
  oakmulgee: { id: 'oakmulgee', dir: 'oakmulgee/', bbox: [-87.55, 32.82, -87.26, 33.05], bounds: [[-87.507, 32.853], [-87.3, 33.013]], center: mid([-87.507, 32.853, -87.3, 33.013]), forest: 'Talladega National Forest', wmaName: 'Oakmulgee WMA', wmaId: 'oakmulgee', rutZone: 'C' },
};

export const regionOfWma = (id: WmaId | undefined | null): Region => (id ? REGIONS[id] : REGIONS.bankhead);
export const inBox = (b: [number, number, number, number], p: [number, number] | null | undefined) => !!p && p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3];
/** The public region whose data covers a point, if any. */
export const regionAt = (p: [number, number] | null | undefined): Region | null => Object.values(REGIONS).find((r) => inBox(r.bbox, p)) ?? null;
