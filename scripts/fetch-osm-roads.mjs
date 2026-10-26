// Fetches every motor road and track in the study area from OpenStreetMap (Overpass). The USFS road inventory
// omits most county and private roads, so this layer is used to keep hunting zones and setup points off roads.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as turf from '@turf/turf';
import { overpass } from './lib/overpass.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
import { BBOX } from './config.mjs';
const KINDS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|track|road|living_street';
const q = `[out:json][timeout:120];way["highway"~"^(${KINDS})$"](${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]});out geom;`;
const j = await overpass(q);
const feats = j.elements.filter((e) => e.geometry?.length > 1).map((e) => turf.lineString(e.geometry.map((g) => [g.lon, g.lat]), { highway: e.tags.highway, name: e.tags.name ?? null, ref: e.tags.ref ?? null, access: e.tags.access ?? null, osm_id: e.id }));
const fc = turf.truncate(turf.simplify(turf.featureCollection(feats), { tolerance: 0.00002 }), { precision: 5 });
const body = JSON.stringify(fc);
await fs.writeFile(path.join(ROOT, 'public/data/roads-osm.geojson'), body);
const reg = [{ id: 'osm-roads', agency: 'OpenStreetMap contributors (ODbL)', title: 'All motor roads and tracks (used to keep zones and setups off roads)', url: 'https://overpass-api.de/api/interpreter', query: q, coverage: `bbox ${BBOX.join(',')}`, retrieved: new Date().toISOString(), resolution: 'Vector; community-mapped centerlines', usage: 'ODbL – attribution required', quality: feats.length ? 'retrieved' : 'empty', featureCount: feats.length, checksum: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16), file: 'data/roads-osm.geojson' }];
await fs.writeFile(path.join(ROOT, 'research/raw/registry-osm-roads.json'), JSON.stringify(reg, null, 2));
const by = {};
for (const f of feats) by[f.properties.highway] = (by[f.properties.highway] ?? 0) + 1;
console.log(feats.length, 'ways', by, (body.length / 1e6).toFixed(2), 'MB');
