import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Candidate } from './types';
import { evaluateLegal, ZONE_B_ANTLER_RULE, isCheckStationDay } from './regulations';
import { angleDiff, assessWind, circularStats, downwindBearing, exposure, thermalAt } from './wind';
import { addDays, chicagoTime, fmtTime, localDate, sessionWindows, sunDay, tzOffsetMinutes } from './time';
import { lookupJurisdiction, polygonContains, type Layers } from './geography';
import { parseOpenMeteo, getWeather, dataAge } from './weather';
import { evaluateCandidate, rankCandidates, WEIGHTS } from './scoring';
import { rutPhase } from './rut';
import { peakTimeline, solunarPeriods, movementAt } from './peak';
import { tilesFor, lon2x, lat2y } from './offline';
import { mergeById, parseBackup, pinsToGpx } from './backup';
import { normalFor, type Normals } from './climate';
import { analyzeSpot, buildWalkNetwork, parseGrid, routeToSpot, type TerrainGrid, type WalkNetwork } from './spot';
import { buildHuntPlan, huntableWinds, walkMinutes, setupPoint } from './plan';
import { bearingTo, haversine } from './geography';
import zlib from 'node:zlib';

const DATA = path.resolve(__dirname, '../../public/data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
let layers: Layers;
let candidates: Candidate[];
beforeAll(() => {
  layers = { wma: read('wma.geojson'), nfAdmin: read('nf-admin.geojson'), ownership: read('ownership.geojson'), wilderness: read('wilderness.geojson'), highways: read('highways.geojson') };
  candidates = read('candidates.geojson').features.map((f: Candidate) => ({ geometry: f.geometry, properties: f.properties }));
});

// ---------------- Geographic validity ----------------
describe('jurisdiction', () => {
  it('check station (AL 33 corridor) is inside the WMA', () => {
    const j = lookupJurisdiction(layers, [-87.3529, 34.3323]);
    expect(j.inWma).toBe(true);
  });
  it('a candidate in the western forest resolves to Zone A', () => {
    const j = lookupJurisdiction(layers, [-87.45, 34.33]);
    expect(j.inWma).toBe(true);
    expect(j.zone).toBe('A');
  });
  it('a point east of AL 33 resolves to Zone B', () => {
    const c = candidates.find((x) => x.properties.zone === 'B')!;
    const j = lookupJurisdiction(layers, c.properties.center);
    expect(j.kind).toBe('black_warrior_wma');
    expect(j.zone).toBe('B');
    expect(c.properties.center[0]).toBeGreaterThan(-87.36);
  });
  it('points within 400 m of AL 33 have no confirmed zone', () => {
    const j = lookupJurisdiction(layers, [-87.3529, 34.3323]);
    expect(j.zone).toBeNull();
    expect(j.distToDividerM).toBeLessThan(400);
  });
  it('a WMA interior hole (excluded parcel) is not inside the WMA', () => {
    const g = layers.wma.features[0].geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const hole = polys[0][1];
    const cx = hole.reduce((a, p) => a + p[0], 0) / hole.length, cy = hole.reduce((a, p) => a + p[1], 0) / hole.length;
    // centroid of a small convex-ish hole should fall inside the hole
    expect(polygonContains(g, [cx, cy])).toBe(false);
    const j = lookupJurisdiction(layers, [cx, cy]);
    expect(j.kind).not.toBe('black_warrior_wma');
  });
  it('a Forest Service point outside the WMA is nf_outside_wma or private, never WMA', () => {
    // far west of the WMA but inside the bbox
    const j = lookupJurisdiction(layers, [-87.545, 34.215]);
    expect(j.inWma).toBe(false);
    expect(j.kind).not.toBe('black_warrior_wma');
  });
  it('every generated candidate lies inside the WMA on FS land', () => {
    for (const c of candidates.slice(0, 120)) {
      const j = lookupJurisdiction(layers, c.properties.center);
      expect(j.kind).toBe('black_warrior_wma');
    }
  });
});

// ---------------- Regulations ----------------
const q = (date: string, weapon: 'bow' | 'crossbow' | 'rifle' | 'muzzleloader', zone: 'A' | 'B' | null = 'A', extra = {}) => evaluateLegal({ date, weapon, target: 'any', jurisdiction: 'black_warrior_wma', zone, ...extra });

describe('regulations', () => {
  it('Oct 24 2026: archery is open either-sex in Zone A', () => {
    const r = q('2026-10-24', 'bow');
    expect(r.status).toBe('verified_allowed');
    expect(r.bag).toMatch(/unantlered/);
    expect(r.antlerRestriction).toBeNull();
  });
  it('Oct 24 2026: rifle is not legal', () => {
    expect(q('2026-10-24', 'rifle').status).toBe('verified_prohibited');
  });
  it('Oct 31 – Nov 1: no general archery on youth hunt days', () => {
    expect(q('2026-10-31', 'bow').status).toBe('verified_prohibited');
    expect(q('2026-11-01', 'crossbow', 'B').status).toBe('verified_prohibited');
  });
  it('youth hunter may hunt youth days with no antler restriction', () => {
    const r = q('2026-10-31', 'rifle', 'B', { youthHunter: true });
    expect(r.status).toBe('verified_allowed');
    expect(r.antlerRestriction).toMatch(/No antler/);
  });
  it('Zone B carries the 4-point antler restriction', () => {
    expect(q('2026-10-24', 'bow', 'B').antlerRestriction).toBe(ZONE_B_ANTLER_RULE);
  });
  it('primitive weapons Nov 2-6: muzzleloader yes, rifle no', () => {
    expect(q('2026-11-03', 'muzzleloader').status).toBe('verified_allowed');
    expect(q('2026-11-03', 'rifle').status).toBe('verified_prohibited');
  });
  it('Zone A gun days are buck-only and not open in Zone B', () => {
    expect(q('2026-11-13', 'rifle', 'A').status).toBe('verified_allowed');
    expect(q('2026-11-13', 'rifle', 'B').status).toBe('verified_prohibited');
    expect(evaluateLegal({ date: '2026-11-13', weapon: 'rifle', target: 'doe', jurisdiction: 'black_warrior_wma', zone: 'A' }).status).toBe('verified_prohibited');
  });
  it('archery on a gun day follows gun-hunt bag rules', () => {
    const r = evaluateLegal({ date: '2026-11-20', weapon: 'bow', target: 'doe', jurisdiction: 'black_warrior_wma', zone: 'B' });
    expect(r.status).toBe('verified_prohibited');
    expect(q('2026-11-20', 'bow', 'A').bag).toMatch(/unantlered/);
  });
  it('Jan 16-27 2027: archery bucks only', () => {
    expect(evaluateLegal({ date: '2027-01-20', weapon: 'bow', target: 'doe', jurisdiction: 'black_warrior_wma', zone: 'A' }).status).toBe('verified_prohibited');
    expect(q('2027-01-20', 'bow').status).toBe('verified_allowed');
    expect(q('2027-01-28', 'bow').status).toBe('verified_prohibited');
  });
  it('unknown zone near divider requires verification when zones differ', () => {
    expect(q('2026-11-13', 'rifle', null).status).toBe('requires_verification');
    expect(q('2026-10-24', 'bow', null).status).toBe('verified_allowed');
  });
  it('NF land outside WMA requires verification; private is prohibited', () => {
    expect(evaluateLegal({ date: '2026-10-24', weapon: 'bow', target: 'any', jurisdiction: 'nf_outside_wma', zone: null }).status).toBe('requires_verification');
    expect(evaluateLegal({ date: '2026-10-24', weapon: 'bow', target: 'any', jurisdiction: 'private_or_unknown', zone: null }).status).toBe('verified_prohibited');
  });
  it('dates outside the loaded rule set require verification', () => {
    expect(q('2027-10-24', 'bow').status).toBe('requires_verification');
  });
  it('check-station days', () => {
    expect(isCheckStationDay('2026-11-12')).toBe(true);
    expect(isCheckStationDay('2026-11-15')).toBe(false);
  });
});

// ---------------- Wind ----------------
describe('wind', () => {
  it('a north wind blows toward the south', () => {
    expect(downwindBearing(0)).toBe(180);
    expect(downwindBearing(270)).toBe(90);
    expect(downwindBearing(350)).toBe(170);
  });
  it('angle difference wraps correctly', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
  });
  it('exposure is full when scent blows at the sensitive bearing', () => {
    expect(exposure(90, 90)).toBe(1);
    expect(exposure(90, 270)).toBe(0);
  });
  const sun = sunDay('2026-10-24', -87.36, 34.33);
  const hour = (t: number, from: number | null, mph: number | null) => ({ time: t, tempF: 50, feelsF: 50, humidity: 60, precipIn: 0, precipProb: 0, cloud: 10, pressureHpa: 1015, windMph: mph, windFrom: from, gustMph: mph, code: 0 });
  const base = { session: 'evening' as const, sun, aspectDeg: 180, aspectStrength: 0.8, foodBearing: 180, approachBearing: null };
  it('wind blowing scent toward bedding is high risk; away is low', () => {
    const hrs = [0, 1, 2].map((i) => hour(sun.sunset - i * 3600000, 180, 10)); // from S → scent to N
    expect(assessWind({ ...base, hours: hrs, beddingBearing: 0 }).risk).toBe('high');
    const away = [0, 1, 2].map((i) => hour(sun.sunset - i * 3600000, 0, 10)); // from N → scent to S... toward food (0.6 weight)
    const east = [0, 1, 2].map((i) => hour(sun.sunset - i * 3600000, 270, 10)); // scent to E, crosswind
    expect(assessWind({ ...base, hours: east, beddingBearing: 0 }).risk).toBe('low');
    expect(assessWind({ ...base, hours: away, beddingBearing: 0 }).score).toBeLessThan(assessWind({ ...base, hours: east, beddingBearing: 0 }).score);
  });
  it('a 180° wind shift increases variability and lowers the score', () => {
    const steady = [0, 1, 2, 3].map((i) => hour(sun.sunset - i * 3600000, 270, 10));
    const shift = [0, 1, 2, 3].map((i) => hour(sun.sunset - i * 3600000, i < 2 ? 270 : 90, 10));
    const a = assessWind({ ...base, hours: steady, beddingBearing: 0 });
    const b = assessWind({ ...base, hours: shift, beddingBearing: 0 });
    expect(b.variabilityDeg!).toBeGreaterThan(60);
    expect(b.score).toBeLessThan(a.score);
  });
  it('circular mean of 350° and 10° is ~0°', () => {
    const { mean } = circularStats([350, 10]);
    expect(angleDiff(mean!, 0)).toBeLessThan(1);
  });
  it('missing wind yields unknown risk, never fabricated', () => {
    const w = assessWind({ ...base, hours: [hour(sun.sunset, null, null)], beddingBearing: 0 });
    expect(w.risk).toBe('unknown');
    expect(w.windFromDegrees).toBeNull();
  });
  it('calm wind → swirling penalty; thermals downslope at dawn', () => {
    const calm = [0, 1].map((i) => hour(sun.sunrise + i * 3600000, 270, 1));
    expect(assessWind({ ...base, session: 'morning', hours: calm, beddingBearing: 0 }).score).toBeLessThanOrEqual(0.55);
    const th = thermalAt(sun.sunrise, hour(sun.sunrise, 270, 2), sun, 135, 0.8);
    expect(th.flow).toBe('downslope');
    expect(th.scentBearing).toBe(135);
    expect(thermalAt(sun.sunrise, hour(sun.sunrise, 270, 15), sun, 135, 0.8).flow).toBe('wind-dominated');
  });
});

// ---------------- Time ----------------
describe('time', () => {
  it('sunrise/sunset at Bankhead on Oct 24 2026 are plausible (CDT)', () => {
    const s = sunDay('2026-10-24', -87.36, 34.33);
    expect(fmtTime(s.sunrise)).toMatch(/^6:5\d AM|^7:0\d AM/);
    expect(fmtTime(s.sunset)).toMatch(/^6:0\d PM|^5:5\d PM/);
    expect(s.legalStart).toBe(s.sunrise - 30 * 60000);
    expect(s.legalEnd).toBe(s.sunset + 30 * 60000);
  });
  it('handles the Nov 1 2026 DST change', () => {
    expect(tzOffsetMinutes(chicagoTime('2026-10-31', 12))).toBe(-300);
    expect(tzOffsetMinutes(chicagoTime('2026-11-02', 12))).toBe(-360);
    const before = sunDay('2026-10-31', -87.36, 34.33), after = sunDay('2026-11-02', -87.36, 34.33);
    expect(fmtTime(after.sunrise) < fmtTime(before.sunrise) || fmtTime(after.sunrise).startsWith('6:')).toBe(true);
    expect(fmtTime(after.sunset)).toMatch(/^4:5\d PM|^5:0\d PM/);
  });
  it('session windows are ordered and anchored to legal light', () => {
    const w = sessionWindows(sunDay('2026-11-15', -87.36, 34.33));
    expect(w.morning.start).toBeLessThan(w.morning.end);
    expect(w.midday.end).toBeLessThanOrEqual(w.evening.start + 1);
    expect(w.evening.end).toBeGreaterThan(w.evening.start);
  });
  it('local calendar arithmetic crosses months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(localDate(Date.UTC(2026, 9, 25, 3, 0))).toBe('2026-10-24'); // 10 pm CDT
  });
  it('rut phase lookup', () => {
    expect(rutPhase('2026-11-26').phase).toBe('rut');
    expect(rutPhase('2026-10-24').phase).toBe('early_season');
  });
});

// ---------------- Data handling ----------------
describe('weather data', () => {
  const sample = { hourly: { time: [1793000000, 1793003600], temperature_2m: [50, 52], wind_direction_10m: [0, 10], wind_speed_10m: [5, 6], wind_gusts_10m: [9, 10] }, daily: { time: [1792990000], sunrise: [1793010000], sunset: [1793050000] } };
  it('parses Open-Meteo unixtime responses', () => {
    const b = parseOpenMeteo(sample, 34.33, -87.36, Date.now());
    expect(b.hourly).toHaveLength(2);
    expect(b.hourly[0].windFrom).toBe(0);
    expect(b.hourly[0].pressureHpa).toBeNull();
  });
  it('rejects malformed responses', () => {
    expect(() => parseOpenMeteo({}, 0, 0, 0)).toThrow();
  });
  it('failed API with no cache returns an error, not fake data', async () => {
    const store: Record<string, string> = {};
    (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } } as Storage;
    const r = await getWeather(34.33, -87.36, { fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(r.bundle).toBeNull();
    expect(r.error).toMatch(/unavailable/);
  });
  it('expired cache is flagged stale', () => {
    const b = parseOpenMeteo(sample, 34.33, -87.36, Date.now() - 5 * 3600000);
    expect(dataAge(b).stale).toBe(true);
  });
});

// ---------------- Scoring ----------------
describe('scoring', () => {
  const prefs = { date: '2026-10-24', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
  it('weights sum to 1', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it('is deterministic and never ranks prohibited zones', () => {
    const a = rankCandidates(candidates, { prefs, weather: null, pins: [] });
    const b = rankCandidates(candidates, { prefs, weather: null, pins: [] });
    expect(a.recommendations.map((r) => r.id)).toEqual(b.recommendations.map((r) => r.id));
    const youth = rankCandidates(candidates, { prefs: { ...prefs, date: '2026-10-31' }, weather: null, pins: [] });
    expect(youth.recommendations).toHaveLength(0);
  });
  it('no forecast → confidence reduced and wind unknown', () => {
    const r = evaluateCandidate(candidates[0], 'evening', { prefs, weather: null, pins: [] });
    expect(r.windAssessment.risk).toBe('unknown');
    expect(['low', 'insufficient']).toContain(r.confidence);
  });
  it('changing wind changes the ranking of a zone', () => {
    const c = candidates.find((x) => x.properties.beddingCoverBearing != null && x.properties.beddingCoverConsistency! > 0.3)!;
    const sun = sunDay('2026-10-24', c.properties.center[0], c.properties.center[1]);
    const mk = (from: number) => ({ source: 'open-meteo' as const, model: 't', lat: 0, lon: 0, fetchedAt: Date.now(), fromCache: false, current: null, daily: [], hourly: Array.from({ length: 30 }, (_, i) => ({ time: sun.sunrise - 6 * 3600000 + i * 3600000, tempF: 55, feelsF: 55, humidity: 60, precipIn: 0, precipProb: 0, cloud: 20, pressureHpa: 1015, windMph: 10, windFrom: from, gustMph: 14, code: 0 })) });
    const toward = (c.properties.beddingCoverBearing! + 180) % 360; // wind FROM opposite side → scent toward bedding
    const away = (c.properties.beddingCoverBearing! + 90) % 360; // crosswind relative to the bedding side
    const bad = evaluateCandidate(c, 'evening', { prefs, weather: mk(toward), pins: [] });
    const good = evaluateCandidate(c, 'evening', { prefs, weather: mk(away), pins: [] });
    expect(good.score!).toBeGreaterThan(bad.score!);
  });
  it('user evidence raises the evidence component', () => {
    const c = candidates[0];
    const r0 = evaluateCandidate(c, 'evening', { prefs, weather: null, pins: [] });
    const r1 = evaluateCandidate(c, 'evening', { prefs, weather: null, pins: [{ id: 'x', kind: 'rub', coord: c.properties.center, note: '', created: '' }] });
    expect(r1.components.find((k) => k.key === 'evidence')!.value).toBeGreaterThan(r0.components.find((k) => k.key === 'evidence')!.value);
  });
});

// ---------------- Peak times ----------------
describe('peak times', () => {
  const prefs = { date: '2026-10-24', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
  it('two major and up to two minor solunar periods per day', () => {
    const s = solunarPeriods('2026-10-24', -87.36, 34.33);
    expect(s.filter((x) => x.kind === 'major')).toHaveLength(2);
    expect(s.filter((x) => x.kind === 'minor').length).toBeLessThanOrEqual(2);
  });
  it('movement peaks near dawn and dusk, low at midday outside the rut', () => {
    const sun = sunDay('2026-10-24', -87.36, 34.33);
    expect(movementAt(sun.sunrise, sun, '2026-10-24', 'any')).toBeGreaterThan(0.8);
    expect(movementAt(sun.solarNoon, sun, '2026-10-24', 'any')).toBeLessThan(0.3);
    expect(movementAt(sun.solarNoon, sun, '2026-11-25', 'mature_buck')).toBeGreaterThan(movementAt(sun.solarNoon, sun, '2026-10-24', 'mature_buck'));
  });
  it('without a forecast, peaks fall at dawn and dusk inside legal light', () => {
    const c = candidates[0];
    const t = peakTimeline(c, '2026-10-24', prefs, null);
    expect(t.hasForecast).toBe(false);
    expect(t.peaks).toHaveLength(2);
    for (const w of t.peaks) {
      expect(w.start).toBeGreaterThanOrEqual(t.sun.legalStart);
      expect(w.end).toBeLessThanOrEqual(t.sun.legalEnd);
      const nearDawn = Math.abs((w.start + w.end) / 2 - t.sun.sunrise) < 3 * 3600000;
      const nearDusk = Math.abs((w.start + w.end) / 2 - t.sun.sunset) < 3 * 3600000;
      expect(nearDawn || nearDusk).toBe(true);
    }
  });
  it('an evening wind blowing toward bedding lowers the evening peak', () => {
    const c = candidates.find((x) => x.properties.beddingCoverBearing != null && x.properties.beddingCoverConsistency! > 0.3)!;
    const sun = sunDay('2026-10-24', c.properties.center[0], c.properties.center[1]);
    const mk = (from: number) => ({ source: 'open-meteo' as const, model: 't', lat: 0, lon: 0, fetchedAt: Date.now(), fromCache: false, current: null, daily: [], hourly: Array.from({ length: 30 }, (_, i) => ({ time: sun.sunrise - 6 * 3600000 + i * 3600000, tempF: 55, feelsF: 55, humidity: 60, precipIn: 0, precipProb: 0, cloud: 20, pressureHpa: 1015, windMph: 8, windFrom: from, gustMph: 12, code: 0 })) });
    const bad = peakTimeline(c, '2026-10-24', prefs, mk((c.properties.beddingCoverBearing! + 180) % 360));
    const good = peakTimeline(c, '2026-10-24', prefs, mk((c.properties.beddingCoverBearing! + 90) % 360));
    const pm = (t: ReturnType<typeof peakTimeline>) => Math.max(...t.hours.filter((h) => h.time > t.sun.solarNoon).map((h) => h.score));
    expect(pm(good)).toBeGreaterThan(pm(bad));
  });
});

// ---------------- Routes & disturbance (precomputed) ----------------
describe('routes and disturbance data', () => {
  it('every candidate has ≤2 routes with a path, profile and walk distance ≥ straight line', () => {
    for (const c of candidates) {
      expect(c.properties.routes.length).toBeGreaterThan(0);
      expect(c.properties.routes.length).toBeLessThanOrEqual(2);
      for (const r of c.properties.routes) {
        expect(r.path.length).toBeGreaterThanOrEqual(2);
        expect(r.profile.length).toBeGreaterThanOrEqual(2);
        expect(r.walkMeters).toBeGreaterThanOrEqual(r.straightLineMeters * 0.99);
        if (r.routeKind === 'network+offtrail') expect(r.onNetworkMeters + r.offTrailMeters).toBeGreaterThan(0);
      }
    }
  });
  it('most zones are reached by a mapped road or trail', () => {
    const net = candidates.filter((c) => c.properties.routes[0].routeKind === 'network+offtrail').length;
    expect(net / candidates.length).toBeGreaterThan(0.5);
  });
  it('disturbance fractions are present and bounded', () => {
    for (const c of candidates.slice(0, 50)) {
      const d = c.properties.disturbance;
      const sum = d.fireRecent + d.fireMid + d.fireOld + d.mechRecent + d.mechOld + d.other;
      expect(sum).toBeGreaterThanOrEqual(0);
      expect(sum).toBeLessThanOrEqual(1.001);
    }
    expect(candidates.some((c) => c.properties.disturbance.fireMid > 0.1)).toBe(true);
  });
  it('scoring uses the routed walk distance and explains straight-line fallbacks', () => {
    const prefs = { date: '2026-10-24', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
    const c = candidates.find((x) => x.properties.routes[0].routeKind === 'network+offtrail')!;
    const r = evaluateCandidate(c, 'evening', { prefs, weather: null, pins: [] });
    expect(r.route!.distanceMeters).toBe(c.properties.routes[0].walkMeters);
    const s = candidates.find((x) => x.properties.routes[0].routeKind === 'straight');
    if (s) expect(evaluateCandidate(s, 'evening', { prefs, weather: null, pins: [] }).components.find((k) => k.key === 'access')!.negatives.join(' ')).toMatch(/straight-line/);
  });
});

// ---------------- Offline tiles ----------------
describe('offline tiles', () => {
  it('tile math is monotonic and in range', () => {
    expect(lon2x(-87.36, 11)).toBeGreaterThan(lon2x(-87.56, 11) - 1);
    expect(lat2y(34.2, 11)).toBeGreaterThan(lat2y(34.47, 11)); // y grows southward
    expect(lon2x(-87.36, 11)).toBeLessThan(2 ** 11);
    expect(lon2x(-87.36, 12)).toBe(Math.floor(lon2x(-87.36, 11) * 2) + (lon2x(-87.36, 12) % 2));
  });
  it('tile counts grow ~4× per zoom level', () => {
    const t = tilesFor([-87.40, 34.30, -87.30, 34.36], 11, 15);
    const byZ = [11, 12, 13, 14, 15].map((z) => t.filter((x) => x[0] === z).length);
    expect(byZ[0]).toBeGreaterThan(0);
    expect(byZ[4]).toBeGreaterThanOrEqual(byZ[0] * 16);
    expect(t.length).toBeLessThan(2500);
  });
});

// ---------------- Backup ----------------
describe('backup', () => {
  it('merge keeps existing and adds only new ids', () => {
    const m = mergeById([{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }, { id: 'b', v: 3 }]);
    expect(m).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 3 }]);
  });
  it('rejects foreign files and round-trips pins through GPX text', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow();
    const gpx = pinsToGpx([{ id: 'x', kind: 'rub', coord: [-87.3, 34.3], note: 'fresh <rub>', created: '2026-10-24T00:00:00Z' }]);
    expect(gpx).toContain('lat="34.3"');
    expect(gpx).toContain('&lt;rub&gt;');
  });
});

// ---------------- Climate normals ----------------
describe('climate', () => {
  it('normalFor reads by month-day', () => {
    const n: Normals = { lat: 0, lon: 0, fetchedAt: 0, years: 10, byDay: { '10-24': { tMax: 71, tMin: 47, n: 150 } } };
    expect(normalFor(n, '2026-10-24')?.tMax).toBe(71);
    expect(normalFor(n, '2026-10-25')).toBeNull();
    expect(normalFor(null, '2026-10-24')).toBeNull();
  });
});

// ---------------- Check this spot ----------------
describe('check this spot', () => {
  let grid: TerrainGrid;
  let net: WalkNetwork;
  beforeAll(() => {
    const meta = read('terrain-grid.json');
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'terrain-grid.bin.gz')));
    grid = parseGrid(meta, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    net = buildWalkNetwork(read('fs-roads.geojson'), read('trails.geojson'), read('highways.geojson'), read('rec-sites.geojson'), read('check-stations.geojson'));
  });
  it('grid has plausible Bankhead elevations', () => {
    const els = Array.from(grid.elev.slice(0, 5000)).map((v) => v / 2);
    expect(Math.min(...els)).toBeGreaterThan(80);
    expect(Math.max(...els)).toBeLessThan(400);
  });
  it('re-checking a generated zone reproduces its feature and a similar terrain score', () => {
    const diffs: number[] = [];
    let sameType = 0;
    const sample = candidates.filter((_, i) => i % 15 === 0);
    for (const c of sample) {
      const r = analyzeSpot(grid, layers, net, c.properties.center);
      if ('error' in r) throw new Error(r.error);
      diffs.push(Math.abs(r.properties.terrainScore - c.properties.terrainScore));
      if (r.properties.label.toLowerCase().startsWith(c.properties.label.toLowerCase().slice(0, 8))) sameType++;
    }
    const median = diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    expect(median).toBeLessThanOrEqual(12);
    expect(sameType / sample.length).toBeGreaterThan(0.6);
  });
  it('a spot on private/non-FS land is never legal', () => {
    const g = layers.wma.features[0].geometry;
    const hole = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)[0][1];
    const pt: [number, number] = [hole.reduce((a, p) => a + p[0], 0) / hole.length, hole.reduce((a, p) => a + p[1], 0) / hole.length];
    const r = analyzeSpot(grid, layers, net, pt);
    if ('error' in r) throw new Error(r.error);
    expect(r.properties.jurisdiction).not.toBe('black_warrior_wma');
    const prefs = { date: '2026-10-25', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
    expect(evaluateCandidate(r, 'evening', { prefs, weather: null, pins: [] }).legalStatus).not.toBe('verified_allowed');
  });
  it('points outside the study area return an error, not a fake rating', () => {
    expect('error' in analyzeSpot(grid, layers, net, [-86.5, 33.5])).toBe(true);
  });
  it('routes a spot from a drivable start along the network', () => {
    const c = candidates.find((x) => x.properties.routes[0].routeKind === 'network+offtrail')!;
    const r = routeToSpot(net, grid, c.properties.center)!;
    expect(r.routeKind).toBe('network+offtrail');
    expect(r.walkMeters).toBeGreaterThanOrEqual(r.straightLineMeters);
    expect(r.path[r.path.length - 1][0]).toBeCloseTo(c.properties.center[0], 4);
    expect(r.profile.length).toBeGreaterThan(1);
  });
});

describe('hunt plan', () => {
  it('huntable winds: scent must not blow toward bedding', () => {
    const hw = huntableWinds({ beddingCoverBearing: 0, foodWaterBearing: null })!;
    expect(hw.bad).toContain('S'); // wind from S pushes scent north into bedding
    expect(hw.good).toContain('N');
    expect(huntableWinds({ beddingCoverBearing: null, foodWaterBearing: null })).toBeNull();
  });
  it('walk time grows with distance and climb', () => {
    expect(walkMinutes(1609, 0, 0)).toBeGreaterThan(20);
    expect(walkMinutes(0, 300, 60)).toBeGreaterThan(walkMinutes(0, 300, 0));
  });
  it('builds a complete plan; prohibited dates say not to hunt', () => {
    const prefs = { date: '2026-10-25', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
    const rec = evaluateCandidate(candidates[0], 'evening', { prefs, weather: null, pins: [] });
    const plan = buildHuntPlan(rec, peakTimeline(candidates[0], '2026-10-25', prefs, null));
    expect(plan.steps.map((s) => s.key)).toEqual(expect.arrayContaining(['when', 'wind', 'setup', 'approach', 'legal', 'confirm']));
    expect(plan.steps.find((s) => s.key === 'when')!.lines.join(' ')).toMatch(/legal light/);
    const youth = evaluateCandidate(candidates[0], 'morning', { prefs: { ...prefs, date: '2026-10-31' }, weather: null, pins: [] });
    expect(buildHuntPlan(youth, null).verdict.tone).toBe('bad');
    expect(buildHuntPlan(youth, null).verdict.label).toMatch(/Don't hunt/);
  });
});

describe('setup point (red X)', () => {
  const prefs = { date: '2026-10-25', session: 'compare' as const, weapon: 'bow' as const, target: 'any' as const, maxWalkMeters: 4000, stand: 'climber' as const, effort: 'balanced' as const, youthHunter: false, start: null };
  it('lands ~55 m downwind of the zone center when there is a wind forecast', () => {
    const c = candidates[3];
    const sun = sunDay('2026-10-25', c.properties.center[0], c.properties.center[1]);
    const weather = { source: 'open-meteo' as const, model: 't', lat: 0, lon: 0, fetchedAt: Date.now(), fromCache: false, current: null, daily: [], hourly: Array.from({ length: 30 }, (_, i) => ({ time: sun.sunrise - 6 * 3600000 + i * 3600000, tempF: 55, feelsF: 55, humidity: 60, precipIn: 0, precipProb: 0, cloud: 20, pressureHpa: 1015, windMph: 8, windFrom: 315, gustMph: 12, code: 0 })) };
    const rec = evaluateCandidate(c, 'evening', { prefs, weather, pins: [] });
    const sp = setupPoint(rec)!;
    expect(sp.basis).toBe('wind');
    expect(haversine(c.properties.center, sp.coord)).toBeGreaterThan(50);
    expect(haversine(c.properties.center, sp.coord)).toBeLessThan(60);
    expect(angleDiff(bearingTo(c.properties.center, sp.coord), 135)).toBeLessThan(2); // NW wind → set up SE
  });
  it('without a forecast it falls on the side away from bedding cover', () => {
    const c = candidates.find((x) => x.properties.beddingCoverBearing != null)!;
    const sp = setupPoint(evaluateCandidate(c, 'evening', { prefs, weather: null, pins: [] }))!;
    expect(sp.basis).toBe('bedding');
    expect(angleDiff(bearingTo(c.properties.center, sp.coord), (c.properties.beddingCoverBearing! + 180) % 360)).toBeLessThan(2);
  });
});
