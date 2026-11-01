// Study areas shared by every data script. Pick one with REGION=<id> (default: bankhead).
//   bankhead: the whole William B. Bankhead National Forest (USFS land-unit extent −87.627…−87.110, 33.985…34.463)
//   with a small margin. 0.58° × 0.54° = 2088 × 1944 one-arc-second cells (both even, so the half-resolution grid
//   divides cleanly). Its files live at the top of public/data/ (the app's original layout).
//   choccolocco / hollins / oakmulgee: the three WMAs on the Talladega National Forest. Each box is the ADCNR
//   2026-27 WMA boundary extent plus ~3-4 km, snapped so the cell counts are even. Files go to public/data/<id>/.
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

export const REGIONS = {
  bankhead: {
    bbox: [-87.66, 33.96, -87.08, 34.5],
    wmaWhere: "Name = 'Black Warrior Wildlife Management Area'",
    nfWhere: "NFSLANDUNITNAME LIKE '%Bankhead%' OR NFSLANDUNITNAME LIKE '%William B. Bankhead%'",
    wildernessWhere: "WILDERNESSNAME LIKE '%Sipsey%'",
    highwayRefs: '^(AL|SR) ?(33|195|36)$',
    prefix: 'BH',
    jurisdiction: 'black_warrior_wma',
  },
  choccolocco: {
    bbox: [-85.83, 33.61, -85.45, 33.87],
    wmaWhere: "Name = 'Choccolocco Wildlife Management Area'",
    nfWhere: "NFSLANDUNITNAME LIKE '%Talladega%'",
    wildernessWhere: '1=1',
    highwayRefs: '^(AL|SR|US) ?[0-9]+$',
    prefix: 'CH',
    jurisdiction: 'state_wma',
    wmaOnly: true,
  },
  hollins: {
    bbox: [-86.24, 33.09, -86.0, 33.3],
    wmaWhere: "Name = 'Hollins Wildlife Management Area'",
    nfWhere: "NFSLANDUNITNAME LIKE '%Talladega%'",
    wildernessWhere: '1=1',
    highwayRefs: '^(AL|SR|US) ?[0-9]+$',
    prefix: 'HO',
    jurisdiction: 'state_wma',
    wmaOnly: true,
  },
  oakmulgee: {
    bbox: [-87.55, 32.82, -87.26, 33.05],
    wmaWhere: "Name = 'Oakmulgee Wildlife Management Area'",
    nfWhere: "NFSLANDUNITNAME LIKE '%Talladega%'",
    wildernessWhere: '1=1',
    highwayRefs: '^(AL|SR|US) ?[0-9]+$',
    prefix: 'OK',
    jurisdiction: 'state_wma',
    wmaOnly: true,
  },
};

export const REGION_ID = process.env.REGION ?? 'bankhead';
export const REGION = REGIONS[REGION_ID];
if (!REGION) throw new Error(`Unknown REGION ${REGION_ID} (known: ${Object.keys(REGIONS).join(', ')})`);
export const BBOX = REGION.bbox;
/** Raw downloads for this region, and the published data folder. */
export const RAW = REGION_ID === 'bankhead' ? path.join(ROOT, 'research', 'raw') : path.join(ROOT, 'research', 'raw', REGION_ID);
export const OUT = REGION_ID === 'bankhead' ? path.join(ROOT, 'public', 'data') : path.join(ROOT, 'public', 'data', REGION_ID);
/** Region-independent lookup tables (LANDFIRE attribute CSVs). */
export const RAW_SHARED = path.join(ROOT, 'research', 'raw');
/** Path of a published file as the app fetches it (relative to the site's data/ folder). */
export const DATA_PREFIX = REGION_ID === 'bankhead' ? 'data/' : `data/${REGION_ID}/`;

// Private-club study box (about 10 km × 9 km). Terrain, habitat and roads are public data, so this box only says
// "some land near Warrior, AL is covered". The club's own boundary is never part of the repo or the site; it lives
// on the user's device. 396 × 288 one-arc-second cells (both even so the half-resolution grid divides cleanly).
export const CLUB_BBOX = [-86.78, 33.73, -86.67, 33.81];
