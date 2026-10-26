// Live check against USGS 3DEP (network). Run with: LIDAR_TEST=1 npx vitest run src/engine/lidar.live.test.ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildWalkNetwork } from './spot';
import { lidarRoute } from './lidar';

const DATA = path.resolve(__dirname, '../../public/data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
describe.runIf(process.env.LIDAR_TEST)('lidar route (live USGS)', () => {
  it('routes to a real zone on ~4 m lidar without crossing cliffs', async () => {
    const cands = read('candidates.geojson').features;
    const c = cands.find((f: { properties: { routes: Array<{ routeKind: string }> } }) => f.properties.routes[0].routeKind === 'straight') ?? cands[0];
    const net = buildWalkNetwork(read('fs-roads.geojson'), read('trails.geojson'), read('highways.geojson'), read('rec-sites.geojson'), read('check-stations.geojson'));
    const t = Date.now();
    const r = await lidarRoute(c.properties.center, net, { ownership: read('ownership.geojson'), water: { type: 'FeatureCollection', features: [] }, lines: [read('fs-roads.geojson'), read('trails.geojson'), read('highways.geojson'), read('roads-osm.geojson')] }, { radiusM: 1600 });
    console.log(c.properties.id, 'old:', JSON.stringify({ kind: c.properties.routes[0].routeKind, walk: c.properties.routes[0].walkMeters, gain: c.properties.routes[0].gainInMeters, maxSlope: c.properties.routes[0].maxSlopeDeg }));
    console.log('lidar:', JSON.stringify({ kind: r?.routeKind, walk: r?.walkMeters, off: r?.offTrailMeters, min: r?.walkMinutes, gain: r?.gainInMeters, maxSlope: r?.maxSlopeDeg, src: r?.elevationSource, pts: r?.path.length }), (Date.now() - t) + ' ms');
    expect(r).not.toBeNull();
    expect(r!.maxSlopeDeg).toBeLessThan(38);
  }, 120000);
});
