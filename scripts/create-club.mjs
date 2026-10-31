// Create a shared club and make one signed-in account its owner. The owner then invites members from the app.
//
//   node scripts/create-club.mjs --owner-email you@gmail.com --id my-club --from-land my-club
//       turns land already in that account (users/{uid}/lands/my-club) into a club, and removes the personal copy
//   node scripts/create-club.mjs --owner-email you@gmail.com --id my-club --file private/club.geojson --name "My Club" [--deer-zone C] [--county X] [--pack club]
//
// Uses admin rights (Firebase CLI login). The owner must have signed in to the app once so their account exists.
// Nothing about the land is stored in this repository or served by the website.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const ownerEmail = arg('owner-email')?.trim().toLowerCase(), id = arg('id'), fromLand = arg('from-land'), file = arg('file');
if (!ownerEmail || !id || (!fromLand && !(file && arg('name')))) { console.error('Usage: node scripts/create-club.mjs --owner-email <gmail> --id <slug> (--from-land <landId> | --file <geojson> --name <name> [--deer-zone C|D] [--county X] [--pack club])'); process.exit(1); }
if (!/^[a-z0-9-]{1,40}$/.test(id)) { console.error('--id must be a short slug (a-z, 0-9, -)'); process.exit(1); }

const DB = ['--instance', 'bankhead-hunt', '--project', 'rehtac-labs'];
const get = (p, ...extra) => JSON.parse(execFileSync('firebase', ['database:get', p, ...extra, ...DB], { encoding: 'utf8' }) || 'null');
const set = (p, value) => {
  const tmp = path.join(os.tmpdir(), `club-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(value));
  try { execFileSync('firebase', ['database:set', p, tmp, ...DB, '--force'], { stdio: ['ignore', 'ignore', 'inherit'] }); } finally { fs.rmSync(tmp, { force: true }); }
};
const remove = (p) => execFileSync('firebase', ['database:remove', p, ...DB, '--force'], { stdio: ['ignore', 'ignore', 'inherit'] });

if (get(`/clubs/${id}`, '--shallow')) { console.error(`A club with id "${id}" already exists.`); process.exit(1); }

// find the owner's account by the email on their profile
const uids = Object.keys(get('/users', '--shallow') ?? {});
const uid = uids.find((u) => (get(`/users/${u}/profile/email`) ?? '').toLowerCase() === ownerEmail);
if (!uid) { console.error(`No account with ${ownerEmail} yet. Sign in to the app once with that Google address, then run this again.`); process.exit(1); }
const profile = get(`/users/${uid}/profile`) ?? {};

let info;
if (fromLand) {
  info = get(`/users/${uid}/lands/${fromLand}`);
  if (!info) { console.error(`That account has no land "${fromLand}".`); process.exit(1); }
} else {
  const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
  const polys = [];
  (function walk(o) { if (!o) return; if (o.type === 'FeatureCollection') o.features.forEach(walk); else if (o.type === 'Feature') walk(o.geometry); else if (o.type === 'Polygon') polys.push(o.coordinates); else if (o.type === 'MultiPolygon') polys.push(...o.coordinates); })(gj);
  if (!polys.length) { console.error('No polygon found in', file); process.exit(1); }
  const geometry = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  const lat0 = polys[0][0][0][1], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const ringArea = (r) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * kx * q[1] * ky - q[0] * kx * p[1] * ky; }, 0) / 2);
  const acres = polys.reduce((s, rings) => s + ringArea(rings[0]) - rings.slice(1).reduce((t, h) => t + ringArea(h), 0), 0) / 4046.86;
  info = { name: arg('name'), kind: 'club', pack: arg('pack', 'club'), deerZone: arg('deer-zone', 'C'), ...(arg('county') ? { county: arg('county') } : {}), geometryJson: JSON.stringify(geometry), acres: Math.round(acres * 10) / 10, source: 'Created by the app owner', created: Date.now() };
}
info = { ...info, kind: 'club', updatedAt: Date.now() };

const owner = { role: 'owner', email: ownerEmail, joined: Date.now(), ...(profile.name ? { name: profile.name } : {}), ...(profile.photoURL ? { photoURL: profile.photoURL } : {}) };
set(`/clubs/${id}`, { info, members: { [uid]: owner } });
set(`/users/${uid}/clubs/${id}`, true);
if (fromLand) {
  remove(`/users/${uid}/lands/${fromLand}`);
  if (get(`/users/${uid}/prefs/workspace`) === `land:${fromLand}`) set(`/users/${uid}/prefs/workspace`, `club:${id}`);
}
console.log(`Created club "${info.name}" (${info.acres} acres) owned by ${ownerEmail}. They can invite members from the You tab.`);
