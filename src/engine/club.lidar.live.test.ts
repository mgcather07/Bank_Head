// Live check against USGS 3DEP (network). Run with: LIDAR_TEST=1 npx vitest run src/engine/club.lidar.live.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { buildClubNetwork, clubShapeOptions, generateClubZones } from './club';
import { parseGrid } from './spot';
import { buildRoadIndex, setRoadIndex } from './roads';
import { lidarZones } from './lidar';
import { haversine } from './geography';
import { CLUB_BBOX } from './config';
import type { Polygon } from 'geojson';
import type { Layers } from './geography';

const DATA = path.resolve(__dirname, '../../public/data');
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
function testSquare(m: number, east = 0, north = 0): Polygon {
  const lat0 = (CLUB_BBOX[1] + CLUB_BBOX[3]) / 2, lon0 = (CLUB_BBOX[0] + CLUB_BBOX[2]) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const cx = lon0 + east / kx, cy = lat0 + north / ky, dx = m / 2 / kx, dy = m / 2 / ky;
  return { type: 'Polygon', coordinates: [[[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy], [cx - dx, cy - dy]]] };
}
describe.runIf(process.env.LIDAR_TEST)('club lidar route (live USGS)', () => {
  it('routes into a club zone over lidar', async () => {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'club/terrain-grid.bin.gz')));
    const grid = parseGrid(readJson('club/terrain-grid.json'), raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const roads = readJson('club/roads.geojson');
    setRoadIndex(buildRoadIndex(roads));
    const club = testSquare(1400, 300, 100);
    const net = buildClubNetwork(roads, club, []);
    const zones = generateClubZones(grid, club, net, {} as Layers, { roads });
    const t = Date.now();
    const res = await lidarZones(zones.map((z) => ({ id: z.properties.id, center: z.properties.center })), net, { walkable: club, lines: [roads] }, { shape: clubShapeOptions(club) });
    console.log('batch', zones.length, 'zones in', Date.now() - t, 'ms');
    let routed = 0;
    for (const z of zones) {
      const r = res[z.properties.id];
      const ring = r.shape!.coordinates[0];
      const radii = ring.map((p) => haversine(z.properties.center, p as [number, number]));
      if (r.route) routed++;
      console.log(z.properties.id, 'terrain', z.properties.routes[0].walkMeters, 'lidar', r.route?.walkMeters, r.route?.path.length, 'pts', 'radius', Math.round(Math.min(...radii)), '-', Math.round(Math.max(...radii)));
    }
    expect(routed).toBe(zones.length);
  }, 240000);
});
