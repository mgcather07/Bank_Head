// Fetches state highway centerlines (AL 33 etc.) from OpenStreetMap via Overpass.
// AL 33 is used as the digitized Zone A/Zone B divider shown on the official 2026-27 permit map.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as turf from '@turf/turf';
import { overpass } from './lib/overpass.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
import { BBOX } from './config.mjs';
const q = `[out:json][timeout:60];way["highway"]["ref"~"^(AL|SR) ?(33|195|36)$"](${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]});out geom;`;
const j = await overpass(q);
const feats = j.elements.filter((e) => e.geometry).map((e) => turf.lineString(e.geometry.map((g) => [g.lon, g.lat]), { ref: e.tags.ref.replace('SR', 'AL').replace(/\s+/, ' '), name: e.tags.name ?? null, osm_id: e.id }));
const fc = turf.truncate(turf.featureCollection(feats), { precision: 6 });
const body = JSON.stringify(fc);
await fs.writeFile(path.join(ROOT, 'public/data/highways.geojson'), body);
const regPath = path.join(ROOT, 'research/raw/registry-osm.json');
await fs.writeFile(regPath, JSON.stringify([{ id: 'osm-highways', agency: 'OpenStreetMap contributors (ODbL)', title: 'State highway centerlines (AL 33, AL 195, AL 36)', url: 'https://overpass-api.de/api/interpreter', query: q, coverage: `bbox ${BBOX.join(',')}`, retrieved: new Date().toISOString(), resolution: 'Vector; community-mapped centerlines', usage: 'ODbL – attribution required', quality: feats.length ? 'retrieved' : 'empty', featureCount: feats.length, checksum: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16), file: 'data/highways.geojson' }], null, 2));
console.log(feats.length, 'highway segments', [...new Set(feats.map((f) => f.properties.ref))]);
