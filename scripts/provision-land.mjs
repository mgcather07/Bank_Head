// Deliver a piece of private land (a club boundary) to one person's Google account.
//
//   node scripts/provision-land.mjs --email you@gmail.com --file private/club.geojson --name "My Club" --id my-club [--deer-zone C] [--county Jefferson] [--pack club]
//
// Writes provision/<email>/lands/<id> with admin rights (Firebase CLI login). The person's app claims it the first
// time they sign in with that verified email address, copies it into their own account and deletes the delivery.
// Nothing about the land is stored in this repository or served by the website.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const email = arg('email'), file = arg('file'), name = arg('name'), id = arg('id');
if (!email || !file || !name || !id) { console.error('Usage: node scripts/provision-land.mjs --email <gmail> --file <geojson> --name <name> --id <slug> [--deer-zone C|D] [--county X] [--pack club]'); process.exit(1); }
if (!/^[a-z0-9-]{1,40}$/.test(id)) { console.error('--id must be a short slug (a-z, 0-9, -)'); process.exit(1); }

const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
const polys = [];
(function walk(o) {
  if (!o) return;
  if (o.type === 'FeatureCollection') o.features.forEach(walk);
  else if (o.type === 'Feature') walk(o.geometry);
  else if (o.type === 'Polygon') polys.push(o.coordinates);
  else if (o.type === 'MultiPolygon') polys.push(...o.coordinates);
})(gj);
if (!polys.length) { console.error('No polygon found in', file); process.exit(1); }
const geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };

const lat0 = polys[0][0][0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
const ringArea = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * kx * q[1] * ky - q[0] * kx * p[1] * ky; }, 0) / 2);
const acres = polys.reduce((s, rings) => s + ringArea(rings[0]) - rings.slice(1).reduce((t, h) => t + ringArea(h), 0), 0) / 4046.86;

const wire = { name, kind: 'club', pack: arg('pack', 'club'), deerZone: arg('deer-zone', 'C'), ...(arg('county') ? { county: arg('county') } : {}), geometryJson: JSON.stringify(geometry), acres: Math.round(acres * 10) / 10, source: 'Delivered by the app owner', created: Date.now() };
const key = email.trim().toLowerCase().replace(/\./g, ',');
const tmp = path.join(os.tmpdir(), `provision-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify({ lands: { [id]: wire } }));
try {
  execFileSync('firebase', ['database:set', `/provision/${key}`, tmp, '--instance', 'bankhead-hunt', '--project', 'rehtac-labs', '--force'], { stdio: 'inherit' });
  console.log(`Delivered "${name}" (${wire.acres} acres, ${polys.length} part${polys.length > 1 ? 's' : ''}) to ${email}. It appears in their account the next time they sign in.`);
} finally { fs.rmSync(tmp, { force: true }); }
