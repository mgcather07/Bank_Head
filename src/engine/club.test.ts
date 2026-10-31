import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Polygon } from 'geojson';
import { buildClubNetwork, edgeDistanceM, generateClubZones, hasTerrainData, parseLandFile, polygonAcres, type ClubGeometry } from './club';
import { parseGrid, type TerrainGrid, type WalkNetwork } from './spot';
import { buildRoadIndex, setRoadIndex } from './roads';
import { haversine, lookupClubJurisdiction, type Layers } from './geography';
import { evaluateCandidate } from './scoring';
import { evaluateLegal } from './regulations';
import { CLUB_BBOX } from './config';
import { localDate } from './time';
import type { HuntPreferences } from './types';

const ROOT = path.resolve(__dirname, '../..');
const DATA = path.join(ROOT, 'public/data');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));

/** A square of `m` meters centred `east`/`north` meters from the middle of the public club box. This is NOT the real club. */
function testSquare(m: number, east = 0, north = 0): Polygon {
  const lat0 = (CLUB_BBOX[1] + CLUB_BBOX[3]) / 2, lon0 = (CLUB_BBOX[0] + CLUB_BBOX[2]) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const cx = lon0 + east / kx, cy = lat0 + north / ky, dx = m / 2 / kx, dy = m / 2 / ky;
  return { type: 'Polygon', coordinates: [[[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy], [cx - dx, cy - dy]]] };
}

describe('club boundary files', () => {
  it('reads a bare Polygon, a Feature and a FeatureCollection with several tracts', () => {
    const sq = testSquare(800);
    expect(parseLandFile(JSON.stringify(sq), 'my_club.geojson')).toMatchObject({ name: 'my club', geometry: { type: 'Polygon' } });
    const f = { type: 'Feature', properties: { name: 'Lease A' }, geometry: sq };
    expect(parseLandFile(JSON.stringify(f)).name).toBe('Lease A');
    const fc = { type: 'FeatureCollection', features: [f, { type: 'Feature', properties: {}, geometry: testSquare(500, 2000) }, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-86.7, 33.77] } }] };
    const r = parseLandFile(JSON.stringify(fc));
    expect(r.geometry.type).toBe('MultiPolygon');
    expect((r.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });
  it('closes an open ring and rejects bad input in plain English', () => {
    const open = { type: 'Polygon', coordinates: [testSquare(800).coordinates[0].slice(0, 4)] };
    expect(parseLandFile(JSON.stringify(open)).geometry).toBeTruthy();
    expect(() => parseLandFile('')).toThrow(/empty/);
    expect(() => parseLandFile('{nope')).toThrow(/GeoJSON/);
    expect(() => parseLandFile('hello')).toThrow(/GeoJSON, KML or GPX/);
    expect(() => parseLandFile(JSON.stringify({ type: 'Point', coordinates: [-86.7, 33.77] }))).toThrow(/No property outline/);
    expect(() => parseLandFile(JSON.stringify(testSquare(40)))).toThrow(/acres/);
    expect(() => parseLandFile(JSON.stringify(testSquare(40000)))).toThrow(/larger/);
  });
  it('measures acres and edge distance', () => {
    const sq = testSquare(805); // ≈ 160 acres (805 m = half a mile)
    expect(polygonAcres(sq)).toBeGreaterThan(158);
    expect(polygonAcres(sq)).toBeLessThan(162);
    const c: [number, number] = [(CLUB_BBOX[0] + CLUB_BBOX[2]) / 2, (CLUB_BBOX[1] + CLUB_BBOX[3]) / 2];
    expect(edgeDistanceM(sq, c)).toBeGreaterThan(395);
    expect(edgeDistanceM(sq, c)).toBeLessThan(410);
  });
  it('only accepts boundaries inside the area that has terrain data', () => {
    expect(hasTerrainData(testSquare(800))).toBe(true);
    expect(hasTerrainData(testSquare(800, 40000))).toBe(false);
  });
  it('inside the boundary is the club, outside is not huntable', () => {
    const sq = testSquare(800);
    const c: [number, number] = [(CLUB_BBOX[0] + CLUB_BBOX[2]) / 2, (CLUB_BBOX[1] + CLUB_BBOX[3]) / 2];
    const inside = lookupClubJurisdiction(sq, c);
    expect(inside).toMatchObject({ kind: 'private_club', deerZone: 'C' });
    expect(lookupClubJurisdiction(sq, [c[0] + 0.05, c[1]]).kind).toBe('private_or_unknown');
  });
});

describe('club zones from the public club terrain data', () => {
  let grid: TerrainGrid;
  let net: WalkNetwork;
  let club: ClubGeometry;
  let zones: ReturnType<typeof generateClubZones>;
  const layers = {} as Layers;
  beforeAll(() => {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'club/terrain-grid.bin.gz')));
    grid = parseGrid(readJson('club/terrain-grid.json'), raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const roads = readJson('club/roads.geojson');
    setRoadIndex(buildRoadIndex(roads));
    club = testSquare(1400, 300, 100);
    net = buildClubNetwork(roads, club, []);
    zones = generateClubZones(grid, club, net, layers);
  });
  it('the public grid covers the club box with plausible Jefferson County elevations', () => {
    expect(grid.bbox).toEqual(CLUB_BBOX);
    const els = Array.from(grid.elev).map((v) => v / 2);
    expect(Math.min(...els)).toBeGreaterThan(90);
    expect(Math.max(...els)).toBeLessThan(400);
  });
  it('makes a sensible set of zones, all inside the boundary and away from its edge', () => {
    expect(zones.length).toBeGreaterThanOrEqual(5);
    expect(zones.length).toBeLessThanOrEqual(24);
    for (const z of zones) {
      expect(z.properties.club).toBe(true);
      expect(z.properties.jurisdiction).toBe('private_club');
      expect(z.properties.deerZone).toBe('C');
      expect(z.properties.id).toMatch(/^CL-[A-Z]{2}-\d{3}$/);
      expect(edgeDistanceM(club, z.properties.center)).toBeGreaterThanOrEqual(69);
      expect(z.properties.terrainScore).toBeGreaterThan(0);
    }
    expect(new Set(zones.map((z) => z.properties.id)).size).toBe(zones.length);
    // best first, and kept well apart
    for (let i = 1; i < zones.length; i++) expect(zones[i].properties.terrainScore).toBeLessThanOrEqual(zones[0].properties.terrainScore);
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) expect(haversine(zones[i].properties.center, zones[j].properties.center)).toBeGreaterThanOrEqual(200);
  });
  it('is deterministic', () => {
    const again = generateClubZones(grid, club, net, layers);
    expect(again.map((z) => z.properties.id + z.properties.center.join())).toEqual(zones.map((z) => z.properties.id + z.properties.center.join()));
  });
  it('ranks on Zone C private-land rules: archery open Oct 31, rifle not until Nov 21 (or youth Nov 13-16)', () => {
    const z = zones[0];
    const prefs = (date: string, weapon: HuntPreferences['weapon'], youth = false): HuntPreferences => ({ date, session: 'morning', weapon, target: 'any', maxWalkMeters: 3200, stand: 'climber', effort: 'balanced', youthHunter: youth, start: null });
    expect(evaluateCandidate(z, 'morning', { prefs: prefs('2026-10-31', 'bow'), weather: null, pins: [], normals: null }).legalStatus).toBe('verified_allowed');
    expect(evaluateCandidate(z, 'morning', { prefs: prefs('2026-10-31', 'rifle'), weather: null, pins: [], normals: null }).legalStatus).toBe('verified_prohibited');
    expect(evaluateCandidate(z, 'morning', { prefs: prefs('2026-11-14', 'rifle', true), weather: null, pins: [], normals: null }).legalStatus).toBe('verified_allowed');
    const r = evaluateCandidate(z, 'morning', { prefs: prefs('2026-11-22', 'rifle'), weather: null, pins: [], normals: null });
    expect(r.legalStatus).toBe('verified_allowed');
    expect(r.landJurisdiction).toMatch(/My club/);
  });
});

describe('private-land deer seasons (Zone C, official 2026-27 page)', () => {
  const q = (date: string, weapon: 'bow' | 'crossbow' | 'rifle' | 'muzzleloader', extra: { target?: 'any' | 'doe' | 'mature_buck'; youth?: boolean } = {}) =>
    evaluateLegal({ date, weapon, target: extra.target ?? 'any', jurisdiction: 'private_club', zone: null, youthHunter: extra.youth ?? false, deerZone: 'C' });
  it('archery opens Oct 15 and runs to Feb 10', () => {
    expect(q('2026-10-14', 'bow').status).toBe('verified_prohibited');
    expect(q('2026-10-15', 'bow').status).toBe('verified_allowed');
    expect(q('2027-02-10', 'crossbow').status).toBe('verified_allowed');
    expect(q('2027-02-11', 'bow').status).toBe('verified_prohibited');
  });
  it('youth gun Nov 13-16 needs a youth hunter', () => {
    expect(q('2026-11-13', 'rifle').status).toBe('verified_prohibited');
    expect(q('2026-11-13', 'rifle', { youth: true }).status).toBe('verified_allowed');
    expect(q('2026-11-16', 'rifle', { youth: true }).status).toBe('verified_allowed');
  });
  it('muzzleloader Nov 16-20, gun from Nov 21 (either sex Nov 21-29, bucks only Nov 30-Dec 11)', () => {
    expect(q('2026-11-18', 'muzzleloader').status).toBe('verified_allowed');
    expect(q('2026-11-18', 'rifle').status).toBe('verified_prohibited');
    expect(q('2026-11-21', 'rifle', { target: 'doe' }).status).toBe('verified_allowed');
    expect(q('2026-11-29', 'rifle', { target: 'doe' }).status).toBe('verified_allowed');
    expect(q('2026-11-30', 'rifle', { target: 'doe' }).status).toBe('verified_prohibited');
    expect(q('2026-11-30', 'rifle', { target: 'mature_buck' }).status).toBe('verified_allowed');
    expect(q('2026-12-12', 'rifle', { target: 'doe' }).status).toBe('verified_allowed');
    expect(q('2027-01-02', 'rifle', { target: 'doe' }).status).toBe('verified_prohibited');
  });
  it('says private land, never National Forest, and flags the zone map as proposed', () => {
    const r = q('2026-11-22', 'rifle');
    expect(r.summary).toMatch(/private land/);
    expect(r.summary).not.toMatch(/National Forest/);
    expect(r.exceptions.join(' ')).toMatch(/Proposed/);
    expect(r.requirements.join(' ')).toMatch(/permission/i);
  });
  it('un-modelled private zones need verification', () => {
    expect(evaluateLegal({ date: '2026-11-22', weapon: 'rifle', target: 'any', jurisdiction: 'private_club', zone: null, deerZone: 'D' }).status).toBe('requires_verification');
  });
  it('uses the plain "today" helper sanely', () => { expect(localDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});

describe('privacy', () => {
  it('the personal boundary folder is git-ignored and the public club data contains no polygons', () => {
    expect(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^private\/$/m);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(DATA, 'club'))) {
      if (!/\.(json|geojson)$/.test(f)) continue;
      const j = fs.readFileSync(f, 'utf8');
      if (/roads\.geojson|streams|contours/.test(f)) expect(j).not.toMatch(/"Polygon"|"MultiPolygon"/);
    }
  });
});
