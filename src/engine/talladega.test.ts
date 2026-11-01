import { describe, expect, it } from 'vitest';
import { evaluateLegal, isWmaGunDay, WMA_CALENDARS } from './regulations';
import { lookupJurisdiction, wmaZoneAt, type Layers } from './geography';
import { REGIONS } from './regions';
import type { LegalQuery } from './regulations';

const q = (wmaId: 'choccolocco' | 'hollins' | 'oakmulgee', date: string, weapon: LegalQuery['weapon'], zone: 'A' | 'B' | null, extra: Partial<LegalQuery> = {}) =>
  evaluateLegal({ date, weapon, target: 'any', jurisdiction: 'state_wma', wmaId, zone, ...extra });

describe('Talladega NF WMA calendars (2026-27 permits)', () => {
  it('Choccolocco: zone-specific gun days, 4-point rule, archery closed on the youth hunt', () => {
    expect(q('choccolocco', '2026-11-12', 'rifle', 'B').status).toBe('verified_allowed');
    expect(q('choccolocco', '2026-11-12', 'rifle', 'A').status).toBe('verified_prohibited');
    expect(q('choccolocco', '2026-11-07', 'rifle', 'A').bag).toBe('One antlered buck a day');
    expect(q('choccolocco', '2026-11-21', 'rifle', 'A', { target: 'doe' }).status).toBe('verified_allowed');
    expect(q('choccolocco', '2026-11-08', 'bow', 'A', { target: 'doe' }).status).toBe('verified_prohibited'); // archery follows gun-hunt bag
    expect(q('choccolocco', '2026-11-03', 'bow', 'A').antlerRestriction).toMatch(/four \(4\)/);
    expect(q('choccolocco', '2026-10-31', 'bow', 'A').status).toBe('verified_prohibited');
    expect(q('choccolocco', '2027-01-20', 'bow', 'A', { target: 'doe' }).status).toBe('verified_prohibited');
    // near the A/B line: same rule → allowed; different → verify
    expect(q('choccolocco', '2026-11-03', 'bow', null).status).toBe('verified_allowed');
    expect(q('choccolocco', '2026-11-12', 'rifle', null).status).toBe('requires_verification');
  });
  it('Hollins: later archery, two primitive weeks, Zone B January gun hunts, 3-point rule', () => {
    expect(q('hollins', '2026-10-10', 'bow', 'A').status).toBe('verified_prohibited');
    expect(q('hollins', '2027-02-10', 'bow', 'B').status).toBe('verified_allowed');
    expect(q('hollins', '2026-12-26', 'muzzleloader', 'A').status).toBe('verified_allowed');
    expect(q('hollins', '2026-12-26', 'rifle', 'A').status).toBe('verified_prohibited');
    expect(q('hollins', '2027-01-01', 'rifle', 'B').status).toBe('verified_allowed');
    expect(q('hollins', '2027-01-01', 'rifle', 'A').status).toBe('verified_prohibited');
    expect(q('hollins', '2026-11-22', 'rifle', 'A').antlerRestriction).toMatch(/three \(3\)/);
    expect(q('hollins', '2026-11-14', 'rifle', 'A', { youthHunter: true }).status).toBe('verified_allowed');
  });
  it('Oakmulgee: one set of dates, two deer a day on either-sex gun days, no gun Dec 30–31', () => {
    expect(q('oakmulgee', '2027-01-15', 'rifle', null).bag).toMatch(/Two deer a day/);
    expect(q('oakmulgee', '2026-12-30', 'rifle', null).status).toBe('verified_prohibited');
    expect(q('oakmulgee', '2026-12-29', 'rifle', null, { target: 'doe' }).status).toBe('verified_prohibited');
    expect(q('oakmulgee', '2026-12-10', 'muzzleloader', null).status).toBe('verified_allowed');
    expect(isWmaGunDay('oakmulgee', '2026-11-27', null)).toBe(true);
    expect(isWmaGunDay('oakmulgee', '2026-11-24', null)).toBe(false);
  });
  it('every period sits inside the permit year and check days fall on hunt days', () => {
    for (const cal of Object.values(WMA_CALENDARS)) {
      for (const p of cal.periods) { expect(p.start <= p.end).toBe(true); expect(p.start >= '2026-09-01' && p.end <= '2027-08-31').toBe(true); }
      for (const [a] of cal.checkDays) expect(cal.periods.some((p) => p.kind !== 'archery' && p.kind !== 'archery_buck' && a >= p.start && a <= p.end)).toBe(true);
    }
  });
});

describe('Talladega jurisdiction', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number) => ({ type: 'Polygon' as const, coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
  const fc = <G,>(gs: Array<{ g: G; p?: object }>) => ({ type: 'FeatureCollection' as const, features: gs.map(({ g, p }) => ({ type: 'Feature' as const, properties: p ?? {}, geometry: g })) });
  const layers = {
    region: REGIONS.choccolocco,
    wma: fc([{ g: sq(-85.7, 33.7, -85.6, 33.8) }]),
    nfAdmin: fc([{ g: sq(-85.8, 33.6, -85.5, 33.9) }]),
    ownership: fc([{ g: sq(-85.8, 33.6, -85.62, 33.9), p: { ownerclassification: 'USDA FOREST SERVICE' } }]),
    wilderness: fc([]), highways: fc([]),
    wmaZones: fc([{ g: sq(-85.7, 33.75, -85.6, 33.8), p: { zone: 'A' } }, { g: sq(-85.7, 33.7, -85.6, 33.75), p: { zone: 'B' } }]),
  } as unknown as Layers;
  it('inside the WMA → that WMA and zone, even on non-FS title; near the A/B line → zone unconfirmed', () => {
    const a = lookupJurisdiction(layers, [-85.65, 33.79]);
    expect(a).toMatchObject({ kind: 'state_wma', wmaId: 'choccolocco', zone: 'A' });
    expect(lookupJurisdiction(layers, [-85.61, 33.71])).toMatchObject({ kind: 'state_wma', zone: 'B', fsOwned: false });
    expect(wmaZoneAt(layers.wmaZones!, [-85.65, 33.751])).toMatchObject({ zone: null, provisional: 'A' });
  });
  it('Forest Service land outside the WMA is public but its statewide rules are not modelled', () => {
    const j = lookupJurisdiction(layers, [-85.75, 33.65]);
    expect(j).toMatchObject({ kind: 'nf_outside_wma', statewideUnmodeled: true });
    expect(evaluateLegal({ date: '2026-11-20', weapon: 'bow', target: 'any', jurisdiction: j.kind, zone: null, statewideUnmodeled: true }).status).toBe('requires_verification');
    expect(lookupJurisdiction(layers, [-85.55, 33.65]).kind).toBe('private_or_unknown');
  });
});
