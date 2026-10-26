// RegulationsEngine — versioned, structured deer rules for Black Warrior WMA.
// Transcribed from the official 2026-27 AREA permit (ADCNR WFF, "Hunting Regulations September 2026 – August 2027").
// Anything not covered by this dataset returns "requires_verification".
import type { LegalEvaluation, Target, Weapon } from './types';

export const REG_SOURCE = {
  id: 'adcnr-bw-wma-2026-27',
  title: '2026-27 Black Warrior WMA map & AREA permit (ADCNR WFF)',
  url: 'https://www.outdooralabama.com/sites/default/files/PDF%20documents/WMA%20Mamps/2026-2027/2026_27_D1%20Black%20Warrior%20WMA%20ADA.pdf',
  version: '2026-27 (transcribed 2026-10-24)',
  validFrom: '2026-09-01',
  validTo: '2027-08-31',
};

export const GOVERNING_LINKS = [
  { title: 'Black Warrior WMA 2026-27 map & AREA permit', url: REG_SOURCE.url },
  { title: 'WMA Regulation 220-2-.55 (OutdoorAlabama.com/WMARules)', url: 'https://www.outdooralabama.com/WMARules' },
  { title: 'Alabama Admin. Code 220-2-.56 (WMA seasons)', url: 'https://admincode.legislature.state.al.us/administrative-code/220-2-.56' },
  { title: 'Alabama hunting & fishing regulations', url: 'https://www.outdooralabama.com/hunting/alabama-hunting-and-fishing-regulations' },
  { title: '2026-27 statewide deer seasons by zone (National Forest land outside the WMA)', url: 'https://www.outdooralabama.com/seasons-and-bag-limits/deer-season' },
  { title: 'ADCNR Wildlife Management Areas', url: 'https://www.outdooralabama.com/hunting/wildlife-management-areas' },
];

type Zone = 'A' | 'B';
type HuntKind = 'archery' | 'youth_gun' | 'primitive' | 'gun_either_sex' | 'gun_buck' | 'archery_buck';

interface HuntPeriod {
  name: string;
  kind: HuntKind;
  start: string;
  end: string;
  zones: Zone[];
  bag: string;
  antlerRestrictionZones: Zone[];
}

export const ZONE_B_ANTLER_RULE = 'Zone B: antlered bucks must have at least four (4) antler points, each 1 inch or longer, on at least one main beam.';

const BOTH: Zone[] = ['A', 'B'];
export const DEER_PERIODS: HuntPeriod[] = [
  { name: 'Archery', kind: 'archery', start: '2026-10-01', end: '2027-01-15', zones: BOTH, bag: 'One deer a day: one unantlered deer or one antlered buck', antlerRestrictionZones: ['B'] },
  { name: 'Archery (bucks only)', kind: 'archery_buck', start: '2027-01-16', end: '2027-01-27', zones: BOTH, bag: 'One antlered buck a day', antlerRestrictionZones: ['B'] },
  { name: 'Youth gun deer hunt', kind: 'youth_gun', start: '2026-10-31', end: '2026-11-01', zones: BOTH, bag: 'One deer a day: one unantlered deer or one antlered buck (no antler restrictions)', antlerRestrictionZones: [] },
  { name: 'Primitive weapons', kind: 'primitive', start: '2026-11-02', end: '2026-11-06', zones: BOTH, bag: 'One deer a day: one unantlered deer or one antlered buck', antlerRestrictionZones: ['B'] },
  { name: 'Gun (either sex)', kind: 'gun_either_sex', start: '2026-11-07', end: '2026-11-08', zones: BOTH, bag: 'One deer a day: one unantlered deer or one antlered buck', antlerRestrictionZones: ['B'] },
  { name: 'Zone A gun (bucks)', kind: 'gun_buck', start: '2026-11-12', end: '2026-11-15', zones: ['A'], bag: 'One antlered buck per day', antlerRestrictionZones: [] },
  { name: 'Zone A gun (bucks)', kind: 'gun_buck', start: '2026-11-26', end: '2026-11-29', zones: ['A'], bag: 'One antlered buck per day', antlerRestrictionZones: [] },
  { name: 'Zone A gun (bucks)', kind: 'gun_buck', start: '2026-12-10', end: '2026-12-13', zones: ['A'], bag: 'One antlered buck per day', antlerRestrictionZones: [] },
  { name: 'Zone B gun (bucks)', kind: 'gun_buck', start: '2026-11-19', end: '2026-11-22', zones: ['B'], bag: 'One antlered buck a day', antlerRestrictionZones: ['B'] },
  { name: 'Zone B gun (bucks)', kind: 'gun_buck', start: '2026-12-03', end: '2026-12-06', zones: ['B'], bag: 'One antlered buck a day', antlerRestrictionZones: ['B'] },
  { name: 'Zone B gun (bucks)', kind: 'gun_buck', start: '2026-12-17', end: '2026-12-20', zones: ['B'], bag: 'One antlered buck a day', antlerRestrictionZones: ['B'] },
];

/** Mandatory check-station data-collection days (check station 9 a.m.–7 p.m.). */
export const CHECK_STATION_DAYS: Array<[string, string]> = [
  ['2026-10-31', '2026-11-01'], ['2026-11-07', '2026-11-08'], ['2026-11-12', '2026-11-14'], ['2026-11-19', '2026-11-21'],
  ['2026-11-26', '2026-11-28'], ['2026-12-03', '2026-12-05'], ['2026-12-10', '2026-12-12'], ['2026-12-17', '2026-12-19'],
];

const within = (d: string, a: string, b: string) => d >= a && d <= b;
const isArchery = (w: Weapon) => w === 'bow' || w === 'crossbow';
const isFirearm = (w: Weapon) => w === 'rifle' || w === 'muzzleloader';

export const BASE_REQUIREMENTS = [
  'Wildlife Management Area License + applicable Resident/Non-Resident All Game Hunting License (ages 16–64 residents; 16+ non-residents).',
  'Signed paper AREA Permit and a WMA daily permit, OR check in/out each hunt day with the Outdoor Alabama WMA Check-In app.',
  'Record results of every hunt day (Outdoor Alabama app or daily permit at kiosk). Report deer in Game Check before leaving the WMA.',
  'No dog deer hunting. No buckshot.',
  'No permanent tree stands; no screw-in steps, spikes or nails. Fall-restraint harness required.',
];

export function gunHuntsOnDate(date: string): HuntPeriod[] {
  return DEER_PERIODS.filter((p) => p.kind !== 'archery' && p.kind !== 'archery_buck' && within(date, p.start, p.end));
}

export function isGunPressureDay(date: string, zone: Zone | null): boolean {
  return gunHuntsOnDate(date).some((p) => p.kind !== 'youth_gun' ? zone == null || p.zones.includes(zone) : true);
}

export function isCheckStationDay(date: string): boolean {
  return CHECK_STATION_DAYS.some(([a, b]) => within(date, a, b));
}

export interface LegalQuery {
  date: string;
  weapon: Weapon;
  target: Target;
  jurisdiction: 'black_warrior_wma' | 'nf_outside_wma' | 'private_or_unknown';
  zone: Zone | null;
  youthHunter?: boolean;
  /** Statewide deer zone (only used off the WMA). null = near the C/D line or outside modeled counties. */
  deerZone?: DeerZone | null;
}

const result = (status: LegalEvaluation['status'], summary: string, extra: Partial<LegalEvaluation> = {}): LegalEvaluation => ({
  status,
  summary,
  huntName: null,
  bag: null,
  antlerRestriction: null,
  requirements: [],
  exceptions: [],
  ruleSource: REG_SOURCE,
  ...extra,
});

function evalZone(q: LegalQuery, zone: Zone): LegalEvaluation {
  const { date, weapon, target } = q;
  const active = DEER_PERIODS.filter((p) => within(date, p.start, p.end) && p.zones.includes(zone));
  const youth = active.find((p) => p.kind === 'youth_gun');
  const gunToday = active.find((p) => p.kind === 'gun_buck' || p.kind === 'gun_either_sex');
  const primitive = active.find((p) => p.kind === 'primitive');
  const archery = active.find((p) => p.kind === 'archery' || p.kind === 'archery_buck');
  const requirements = [...BASE_REQUIREMENTS];
  const exceptions: string[] = [];
  if (isCheckStationDay(date)) requirements.push('Mandatory check-station day: harvested deer must be submitted at the check station (9 a.m.–7 p.m.).');
  if (gunToday || primitive || youth) requirements.push('Gun/primitive deer hunt day: hunter-orange (or pink) requirements apply — see WMA Regulation 220-2-.55.');

  // Youth gun days: no general archery; youth (<16, supervised) only.
  if (youth) {
    exceptions.push('Oct 31–Nov 1 youth gun deer hunt: "No hunting on days of youth gun deer hunt" for archery; youth must be under 16 and within 30 ft of a licensed supervisor (21+ or parent).');
    if (!q.youthHunter) return result('verified_prohibited', 'Youth gun deer hunt day — only youth hunters (<16) with a qualified supervisor may hunt deer. General archery is closed.', { huntName: youth.name, requirements, exceptions });
    return result('verified_allowed', `Youth gun deer hunt (Zone ${zone}).`, { huntName: youth.name, bag: youth.bag, antlerRestriction: 'No antler restrictions on youth hunt days.', requirements, exceptions });
  }

  let allowedPeriod: HuntPeriod | undefined;
  if (isArchery(weapon)) {
    allowedPeriod = archery;
    if (weapon === 'crossbow') exceptions.push('Crossbow treated as legal archery equipment under Alabama statewide rules — confirm equipment rules at OutdoorAlabama.com/WMARules.');
  } else if (weapon === 'muzzleloader') {
    allowedPeriod = primitive ?? gunToday;
  } else if (weapon === 'rifle') {
    allowedPeriod = gunToday;
  }
  if (!allowedPeriod) {
    const anyOpen = active.length > 0;
    const msg = anyOpen
      ? `${weaponLabel(weapon)} is not a legal method on ${date} in Zone ${zone}. Open today: ${active.map((p) => p.name).join(', ')}.`
      : `No deer season is open on Black Warrior WMA (Zone ${zone}) on ${date}.`;
    return result('verified_prohibited', msg, { requirements, exceptions });
  }

  // Archery on gun days follows gun-hunt bag/antler rules.
  let bag = allowedPeriod.bag;
  let huntName = allowedPeriod.name;
  if (isArchery(weapon) && gunToday) {
    bag = gunToday.bag;
    huntName = `${allowedPeriod.name} during ${gunToday.name}`;
    exceptions.push('Archery hunters must follow mandatory check-station requirements and gun-hunt bag/antler rules on gun deer hunt days.');
  }
  if (isFirearm(weapon) && archery && !gunToday && primitive) huntName = primitive.name;
  const buckOnly = /antlered buck/.test(bag) && !/unantlered/.test(bag);
  const ar = allowedPeriod.antlerRestrictionZones.includes(zone) || (gunToday?.antlerRestrictionZones.includes(zone) ?? false) || zone === 'B';
  const antlerRestriction = ar && zone === 'B' ? ZONE_B_ANTLER_RULE : null;

  if (target === 'doe' && buckOnly) {
    return result('verified_prohibited', `${huntName}: antlered bucks only on ${date} — does may not be taken.`, { huntName, bag, antlerRestriction, requirements, exceptions });
  }
  return result('verified_allowed', `${huntName} open in Zone ${zone} for ${weaponLabel(weapon).toLowerCase()}.`, { huntName, bag, antlerRestriction, requirements, exceptions });
}

export function evaluateLegal(q: LegalQuery): LegalEvaluation {
  if (q.date < REG_SOURCE.validFrom || q.date > REG_SOURCE.validTo) {
    return result('requires_verification', `Regulations require verification — the loaded rule set (${REG_SOURCE.version}) does not cover ${q.date}.`);
  }
  if (q.jurisdiction === 'private_or_unknown') {
    return result('verified_prohibited', 'Public hunting access is not established at this location (private inholding or non-public land). No recommendation is generated here.');
  }
  if (q.jurisdiction === 'nf_outside_wma') return evaluateStatewide(q);
  if (q.zone) return evalZone(q, q.zone);
  // Zone unknown (near the AL 33 divider): only allowed if both zones agree.
  const a = evalZone(q, 'A');
  const b = evalZone(q, 'B');
  if (a.status === b.status && a.bag === b.bag) {
    return { ...a, summary: `${a.summary.replace(' in Zone A', '')} (same rule in Zones A and B)`, antlerRestriction: b.antlerRestriction, exceptions: [...a.exceptions, 'Zone could not be confirmed (near AL 33 divider); rules identical for both zones on this date. Zone B antler restriction shown as a precaution.'] };
  }
  return result('requires_verification', 'Regulations require verification — this location is within 400 m of the Zone A/B divider (AL 33) and the rules differ between zones on this date. Confirm your zone on the official map.', { exceptions: [`Zone A: ${a.summary}`, `Zone B: ${b.summary}`] });
}

export function weaponLabel(w: Weapon): string {
  return { bow: 'Compound bow', crossbow: 'Crossbow', rifle: 'Rifle', muzzleloader: 'Muzzleloader' }[w];
}

// ======================= Statewide seasons (National Forest land outside the WMA) =======================
// Transcribed from the official 2026-27 deer season page, PUBLIC LAND columns (Bankhead NF is public land).
// Bankhead NF lies in Deer Zone D (most of it) and Zone C (east of the Helicon Rd / CR 41 / Sipsey Fork line and
// south of the Winston/Walker line). Zone membership is derived — see scripts/build-deer-zones.mjs.
export type DeerZone = 'C' | 'D';

export const STATEWIDE_SOURCE = {
  id: 'adcnr-deer-season-2026-27',
  title: '2026-27 Alabama deer seasons and bag limits (OutdoorAlabama.com)',
  url: 'https://www.outdooralabama.com/seasons-and-bag-limits/deer-season',
  version: '2026-27 (transcribed 2026-10-25; zone map image labelled "Proposed")',
  validFrom: '2026-09-01',
  validTo: '2027-08-31',
};

type SwKind = 'archery' | 'youth_gun' | 'muzzleloader' | 'gun';
interface SwPeriod { kind: SwKind; start: string; end: string; eitherSex: boolean; name: string }

export const STATEWIDE_PUBLIC: Record<DeerZone, SwPeriod[]> = {
  D: [
    { kind: 'archery', start: '2026-10-01', end: '2027-01-15', eitherSex: true, name: 'Archery' },
    { kind: 'archery', start: '2027-01-16', end: '2027-01-27', eitherSex: false, name: 'Archery (bucks only)' },
    { kind: 'youth_gun', start: '2026-10-30', end: '2026-11-02', eitherSex: true, name: 'Special youth gun' },
    { kind: 'muzzleloader', start: '2026-11-02', end: '2026-11-06', eitherSex: true, name: 'Special muzzleloader / air rifle (stalk only)' },
    { kind: 'gun', start: '2026-11-07', end: '2026-12-11', eitherSex: false, name: 'Gun, public land (bucks only)' },
    { kind: 'gun', start: '2026-12-12', end: '2027-01-01', eitherSex: true, name: 'Gun, public land (either sex)' },
    { kind: 'gun', start: '2027-01-02', end: '2027-01-27', eitherSex: false, name: 'Gun, public land (bucks only)' },
  ],
  C: [
    { kind: 'archery', start: '2026-10-15', end: '2027-02-10', eitherSex: true, name: 'Archery' },
    { kind: 'youth_gun', start: '2026-11-13', end: '2026-11-16', eitherSex: true, name: 'Special youth gun' },
    { kind: 'muzzleloader', start: '2026-11-16', end: '2026-11-20', eitherSex: true, name: 'Special muzzleloader / air rifle (stalk only)' },
    { kind: 'gun', start: '2026-11-21', end: '2026-12-11', eitherSex: false, name: 'Gun, public land (bucks only)' },
    { kind: 'gun', start: '2026-12-12', end: '2027-01-01', eitherSex: true, name: 'Gun, public land (either sex)' },
    { kind: 'gun', start: '2027-01-02', end: '2027-02-10', eitherSex: false, name: 'Gun, public land (bucks only)' },
  ],
};

const SW_BAG: Record<DeerZone, string> = {
  D: 'One antlered buck per day and up to two unantlered deer per day (unantlered limit applies during archery, special muzzleloader and youth seasons and either-sex gun days).',
  C: 'One unantlered deer and one antlered buck per day.',
};
const SW_BUCK_RULE = 'Statewide: 3 antlered bucks per season; one of the three must have at least 4 antler points 1 inch or longer on one antler.';
const SW_REQUIREMENTS = [
  'Alabama hunting license (all-game or resident/non-resident as applicable). No WMA license or AREA permit is needed off the WMA.',
  'Report harvested deer through Game Check before moving the deer.',
  'No dog deer hunting on public land.',
  'Portable stands only on National Forest land; no screw-in steps, spikes or nails. Use a fall-restraint harness.',
  'Know the boundary: private inholdings are common inside the National Forest.',
];

export function swPeriodsOn(date: string, zone: DeerZone) {
  return STATEWIDE_PUBLIC[zone].filter((p) => within(date, p.start, p.end));
}

export function isStatewideGunDay(date: string, zone: DeerZone | null): boolean {
  if (!zone) return (['C', 'D'] as DeerZone[]).some((z) => swPeriodsOn(date, z).some((p) => p.kind === 'gun'));
  return swPeriodsOn(date, zone).some((p) => p.kind === 'gun' || p.kind === 'muzzleloader');
}

function evalStatewideZone(q: LegalQuery, zone: DeerZone): LegalEvaluation {
  const active = swPeriodsOn(q.date, zone);
  const requirements = [...SW_REQUIREMENTS];
  const exceptions: string[] = [];
  const youth = active.find((p) => p.kind === 'youth_gun');
  const gun = active.find((p) => p.kind === 'gun');
  const muzz = active.find((p) => p.kind === 'muzzleloader');
  if (gun || youth || muzz) requirements.push('A gun or youth deer season is open — hunter-orange requirements apply; see Alabama statewide regulations.');
  if (youth) exceptions.push(`Special youth gun season (${youth.start}–${youth.end}): hunters under 16 with a licensed adult. Other legal seasons stay open on public land.`);
  let period: SwPeriod | undefined;
  if (q.weapon === 'bow' || q.weapon === 'crossbow') period = active.find((p) => p.kind === 'archery');
  else if (q.weapon === 'muzzleloader') period = gun ?? muzz ?? (q.youthHunter ? youth : undefined);
  else if (q.weapon === 'rifle') period = gun ?? (q.youthHunter ? youth : undefined);
  if (q.weapon === 'crossbow') exceptions.push('Crossbows are legal archery equipment in Alabama — confirm current equipment rules.');
  const src = { id: STATEWIDE_SOURCE.id, title: STATEWIDE_SOURCE.title, url: STATEWIDE_SOURCE.url, version: STATEWIDE_SOURCE.version };
  if (!period) {
    const msg = active.length
      ? `${weaponLabel(q.weapon)} is not legal on ${q.date} in Deer Zone ${zone} (public land). Open: ${active.map((p) => p.name).join(', ')}${youth && !q.youthHunter ? ' (youth season is for hunters under 16)' : ''}.`
      : `No deer season is open on ${q.date} in Deer Zone ${zone}.`;
    return { status: 'verified_prohibited', summary: msg, huntName: null, bag: null, antlerRestriction: SW_BUCK_RULE, requirements, exceptions, ruleSource: src };
  }
  if (q.target === 'doe' && !period.eitherSex) {
    return { status: 'verified_prohibited', summary: `${period.name}, Deer Zone ${zone}: antlered bucks only on ${q.date} — does may not be taken with a ${weaponLabel(q.weapon).toLowerCase()}.`, huntName: period.name, bag: 'One antlered buck per day', antlerRestriction: SW_BUCK_RULE, requirements, exceptions, ruleSource: src };
  }
  return {
    status: 'verified_allowed',
    summary: `${period.name} open on National Forest land in Deer Zone ${zone} for ${weaponLabel(q.weapon).toLowerCase()}.`,
    huntName: `${period.name} (Zone ${zone}, public land)`,
    bag: period.eitherSex ? SW_BAG[zone] : 'One antlered buck per day',
    antlerRestriction: SW_BUCK_RULE,
    requirements, exceptions, ruleSource: src,
  };
}

function evaluateStatewide(q: LegalQuery): LegalEvaluation {
  if (q.date < STATEWIDE_SOURCE.validFrom || q.date > STATEWIDE_SOURCE.validTo) return result('requires_verification', `Regulations require verification — statewide seasons loaded only for ${STATEWIDE_SOURCE.version}.`);
  if (q.deerZone) return evalStatewideZone(q, q.deerZone);
  // near the C/D line or outside the modeled counties: allowed only if both zones agree
  const c = evalStatewideZone(q, 'C'), d = evalStatewideZone(q, 'D');
  if (c.status === d.status && c.status !== 'verified_allowed') return { ...d, summary: `${d.summary.replace(/ in Deer Zone D/, '')} (same in Zones C and D)` };
  if (c.status === 'verified_allowed' && d.status === 'verified_allowed' && c.huntName?.split(' (')[0] === d.huntName?.split(' (')[0]) return { ...d, summary: `${d.summary.replace(/ in Deer Zone D/, '')} (same in Zones C and D)`, bag: 'Zone C: one unantlered + one antlered buck per day; Zone D: up to two unantlered + one antlered buck per day.' };
  return result('requires_verification', 'Regulations require verification — this spot is near the Deer Zone C/D line (or outside the counties modeled) and the seasons differ on this date. Check the zone map.', { exceptions: [`Zone C: ${c.summary}`, `Zone D: ${d.summary}`], ruleSource: { id: STATEWIDE_SOURCE.id, title: STATEWIDE_SOURCE.title, url: STATEWIDE_SOURCE.url, version: STATEWIDE_SOURCE.version } });
}
