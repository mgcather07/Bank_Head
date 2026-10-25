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
  if (q.jurisdiction === 'nf_outside_wma') {
    return result('requires_verification', 'Regulations require verification — this point is National Forest land outside the Black Warrior WMA boundary. Statewide seasons and Forest Service rules apply; this app does not yet model them.');
  }
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
