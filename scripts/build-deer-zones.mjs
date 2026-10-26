// Builds the Alabama Deer Zone D polygon for the Bankhead area from the official 2026-27 boundary description
// (OutdoorAlabama.com deer-season page). ADCNR publishes no zone GIS, so each named boundary element is taken from
// OpenStreetMap (roads, Sipsey Fork) or ADCNR county polygons (county lines), trimmed to the stretch between its
// junctions with the previous and next element (shortest path along that element), rasterized as walls, and the
// interior is flood-filled from a point known to be in Zone D. The result is validated against reference towns.
// Usage: node scripts/build-deer-zones.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as turf from '@turf/turf';
import { contours as d3contours } from 'd3-contour';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
const REGION = [-87.85, 33.85, -86.9, 34.6];
const UA = { 'User-Agent': 'BankheadHuntIntel/1.0 (rehtac)' };

// ---------- inputs ----------
async function overpass() {
  const cache = path.join(RAW, 'deer-zone-osm.json');
  try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch { /* fetch */ }
  const q = `[out:json][timeout:240];
(
  way["highway"]["ref"~"(^|;) ?(AL|SR) ?(13|195|5|157|24)( |;|$)"](33.85,-87.85,34.6,-86.9);
  way["highway"]["ref"~"US ?278"](33.85,-87.85,34.6,-86.9);
  way["highway"]["name"~"Helicon",i](33.95,-87.35,34.30,-86.95);
  way["highway"]["name"~"(County Road|CR) ?41$",i](33.98,-87.30,34.15,-87.10);
  way["highway"]["ref"~"(^|;)(CR|Co Rd|CO) ?41$",i](33.98,-87.30,34.15,-87.10);
  way["highway"]["name"~"(County Road|CR) ?1114$",i](34.10,-87.20,34.40,-86.90);
  way["highway"]["ref"~"(CR|Co Rd|CO) ?1114",i](34.10,-87.20,34.40,-86.90);
  way["highway"]["name"~"(County Road|CR) ?93$",i](34.18,-87.75,34.35,-87.50);
  way["highway"]["ref"~"(CR|Co Rd|CO) ?93$",i](34.18,-87.75,34.35,-87.50);
  way["waterway"]["name"~"Sipsey Fork",i](33.80,-87.45,34.20,-87.05);
  node["place"]["name"~"^(Helicon|Arley|Jones Chapel|Natural Bridge|Haleyville|Moulton|Double Springs|Jasper|Cullman|Russellville|Houston|Grayson)$"](33.7,-88.0,34.7,-86.7);
);
out geom;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: UA });
  if (!r.ok) throw new Error('overpass ' + r.status);
  const j = await r.json();
  await fs.writeFile(cache, JSON.stringify(j));
  return j;
}
async function counties() {
  const cache = path.join(RAW, 'counties.geojson');
  try { return JSON.parse(await fs.readFile(cache, 'utf8')); } catch { /* fetch */ }
  const u = `https://conservationgis.alabama.gov/adcnrweb/rest/services/AlabamaCounties/MapServer/0/query?where=1%3D1&geometry=${REGION.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&outFields=NAME&outSR=4326&f=geojson`;
  const j = await (await fetch(u)).json();
  await fs.writeFile(cache, JSON.stringify(j));
  return j;
}

const osm = await overpass();
const cty = await counties();
const places = Object.fromEntries(osm.elements.filter((e) => e.type === 'node').map((e) => [e.tags.name, [e.lon, e.lat]]));
const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry?.length > 1).map((e) => ({ tags: e.tags, line: e.geometry.map((g) => [g.lon, g.lat]) }));
const county = (n) => cty.features.find((f) => f.properties.NAME === n);
const ringLines = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).flatMap((p) => p.map((r) => r));

const refHas = (w, re) => re.test(w.tags.ref ?? '');
const nameHas = (w, re) => re.test(w.tags.name ?? '');
const E = (name, lines) => ({ name, lines });
const sel = (pred) => ways.filter(pred).map((w) => w.line);

// Boundary in the order the regulation lists it (closed loop).
const elements = [
  E('AL 157 (Moulton → CR 1114)', sel((w) => refHas(w, /(^|;) ?(AL|SR) ?157( |;|$)/))),
  E('Cullman CR 1114', sel((w) => nameHas(w, /1114$/) || refHas(w, /1114/))),
  E('US 278 (Jones Chapel → Helicon Rd)', sel((w) => refHas(w, /US ?278/))),
  E('Helicon Road (Winston CR 77)', sel((w) => nameHas(w, /Helicon/i))),
  E('Winston CR 41', sel((w) => nameHas(w, /41$/) || refHas(w, /(^|;)(CR|Co Rd|CO) ?41$/i))),
  E('Sipsey Fork', sel((w) => nameHas(w, /Sipsey Fork/i) && w.tags.waterway)),
  E('Winston/Walker county line', ringLines(county('Winston'))),
  E('AL 5', sel((w) => refHas(w, /(^|;) ?(AL|SR) ?5( |;|$)/))),
  E('AL 13 (Natural Bridge → Haleyville)', sel((w) => refHas(w, /(^|;) ?(AL|SR) ?13( |;|$)/))),
  E('AL 195 (Haleyville → CR 93)', sel((w) => refHas(w, /(^|;) ?(AL|SR) ?195( |;|$)/))),
  E('Winston CR 93', sel((w) => nameHas(w, /93$/) || refHas(w, /(CR|Co Rd|CO) ?93$/i))),
  E('Franklin/Winston county line', ringLines(county('Winston'))),
  E('Lawrence/Franklin county line', ringLines(county('Lawrence'))),
  E('AL 24 (→ Moulton)', sel((w) => refHas(w, /(^|;) ?(AL|SR) ?24( |;|$)/))),
];
for (const el of elements) if (!el.lines.length) throw new Error(`No geometry for boundary element: ${el.name}`);

// Hints pick the right junction when two elements cross more than once.
const tri = (() => {
  // Franklin–Winston–Lawrence tripoint: vertex of the Winston ring closest to both other counties
  const fr = turf.polygonToLine(county('Franklin')), la = turf.polygonToLine(county('Lawrence'));
  let best = null;
  for (const c of ringLines(county('Winston')).flat()) {
    const d = turf.pointToLineDistance(c, fr, { units: 'meters' }) + turf.pointToLineDistance(c, la, { units: 'meters' });
    if (!best || d < best.d) best = { c, d };
  }
  return best.c;
})();
const hints = [
  [-87.12, 34.33], places['Jones Chapel'], [-87.10, 34.19], places['Arley'], places['Arley'], [-87.25, 33.99],
  [-87.55, 34.0], places['Natural Bridge'], places['Haleyville'], [-87.62, 34.27], [-87.62, 34.30], tri, [-87.53, 34.47], places['Moulton'],
];

const fcOf = (lines) => turf.featureCollection(lines.map((l) => turf.lineString(l)));
function junction(a, b, hint) {
  const pts = turf.lineIntersect(fcOf(a.lines), fcOf(b.lines)).features.map((f) => f.geometry.coordinates);
  if (!pts.length) {
    // no exact crossing (endpoints meeting or a tiny gap): closest pair of vertices near the hint
    let best = null;
    for (const la of a.lines) for (const p of la) {
      if (turf.distance(p, hint, { units: 'kilometers' }) > 8) continue;
      for (const lb of b.lines) for (const q of lb) { const d = turf.distance(p, q, { units: 'meters' }); if (!best || d < best.d) best = { p, q, d }; }
    }
    if (!best || best.d > 400) throw new Error(`No junction between ${a.name} and ${b.name} (closest ${best?.d?.toFixed(0)} m)`);
    return { pt: [(best.p[0] + best.q[0]) / 2, (best.p[1] + best.q[1]) / 2], gapM: best.d };
  }
  pts.sort((p, q) => turf.distance(p, hint) - turf.distance(q, hint));
  return { pt: pts[0], gapM: 0 };
}

/** Shortest path along an element's own geometry between two points (both snapped onto it). */
function pathAlong(el, from, to) {
  const nodes = [], idx = new Map(), adj = [];
  const id = (c) => { const k = `${c[0].toFixed(6)},${c[1].toFixed(6)}`; if (!idx.has(k)) { idx.set(k, nodes.length); nodes.push(c); adj.push([]); } return idx.get(k); };
  const link = (a, b) => { if (a === b) return; const m = turf.distance(nodes[a], nodes[b], { units: 'meters' }); adj[a].push([b, m]); adj[b].push([a, m]); };
  const segs = [];
  for (const l of el.lines) for (let i = 0; i < l.length - 1; i++) segs.push([l[i], l[i + 1]]);
  // snap endpoints onto their nearest segment, splitting it
  const snap = (p) => {
    let best = null;
    segs.forEach((s, k) => { const np = turf.nearestPointOnLine(turf.lineString(s), p); if (!best || np.properties.dist < best.d) best = { k, c: np.geometry.coordinates, d: np.properties.dist }; });
    return best;
  };
  const sa = snap(from), sb = snap(to);
  const splits = new Map();
  for (const s of [sa, sb]) { if (!splits.has(s.k)) splits.set(s.k, []); splits.get(s.k).push(s.c); }
  segs.forEach((s, k) => {
    const mids = (splits.get(k) ?? []).sort((p, q) => turf.distance(s[0], p) - turf.distance(s[0], q));
    const chain = [s[0], ...mids, s[1]];
    for (let i = 0; i < chain.length - 1; i++) link(id(chain[i]), id(chain[i + 1]));
  });
  // join near-touching ways (OSM ways that share no exact vertex)
  const ends = el.lines.flatMap((l) => [l[0], l[l.length - 1]]);
  for (const e of ends) for (const n of nodes) if (e !== n && turf.distance(e, n, { units: 'meters' }) < 30) link(id(e), id(n));
  const s = id(sa.c), t = id(sb.c);
  const dist = new Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(-1), done = new Uint8Array(nodes.length);
  dist[s] = 0;
  for (;;) {
    let u = -1, du = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
    if (u < 0 || u === t) break;
    done[u] = 1;
    for (const [v, m] of adj[u]) if (du + m < dist[v]) { dist[v] = du + m; prev[v] = u; }
  }
  if (!Number.isFinite(dist[t])) return { line: [from, to], straight: true, meters: turf.distance(from, to, { units: 'meters' }) };
  const out = [];
  for (let i = t; i >= 0; i = prev[i]) out.push(nodes[i]);
  return { line: [from, ...out.reverse(), to], straight: false, meters: dist[t] };
}

const n = elements.length;
const J = elements.map((el, i) => junction(el, elements[(i + 1) % n], hints[i]));
const walls = [];
const report = [];
for (let i = 0; i < n; i++) {
  const from = J[(i - 1 + n) % n].pt, to = J[i].pt;
  const p = pathAlong(elements[i], from, to);
  walls.push(turf.lineString(p.line, { element: elements[i].name, straight: p.straight }));
  report.push(`${elements[i].name}: ${(p.meters / 1000).toFixed(1)} km${p.straight ? ' (STRAIGHT — element disconnected)' : ''}${J[i].gapM ? `, junction gap ${J[i].gapM.toFixed(0)} m` : ''}`);
}
console.log(report.join('\n'));

// ---------- rasterize walls and flood-fill Zone D ----------
const CELL = 0.0005;
const GW = Math.ceil((REGION[2] - REGION[0]) / CELL), GH = Math.ceil((REGION[3] - REGION[1]) / CELL);
const wall = new Uint8Array(GW * GH);
const toXY = (c) => [Math.floor((c[0] - REGION[0]) / CELL), Math.floor((REGION[3] - c[1]) / CELL)];
const mark = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < GW && yy < GH) wall[yy * GW + xx] = 1; } };
for (const w of walls) {
  const c = w.geometry.coordinates;
  for (let i = 0; i < c.length - 1; i++) {
    const [x0, y0] = toXY(c[i]), [x1, y1] = toXY(c[i + 1]);
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let s = 0; s <= steps; s++) mark(Math.round(x0 + ((x1 - x0) * s) / steps), Math.round(y0 + ((y1 - y0) * s) / steps));
  }
}
const inD = new Uint8Array(GW * GH);
const seed = toXY([-87.3529, 34.3323]); // Black Warrior WMA checking station (WMA calendar = Zone D calendar)
const stack = [seed[1] * GW + seed[0]];
inD[stack[0]] = 1;
while (stack.length) {
  const i = stack.pop(), x = i % GW, y = (i / GW) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= GW || yy >= GH) throw new Error('Zone D flood fill leaked to the edge of the region — boundary is not closed.');
    const j = yy * GW + xx;
    if (!inD[j] && !wall[j]) { inD[j] = 1; stack.push(j); }
  }
}
for (let i = 0; i < GW * GH; i++) if (wall[i]) { const x = i % GW, y = (i / GW) | 0; if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inD[(y + dy) * GW + x + dx])) inD[i] = 1; }

// ---------- validate against reference towns ----------
const inside = (c) => { const [x, y] = toXY(c); return !!inD[y * GW + x]; };
const mustIn = ['Double Springs', 'Houston', 'Grayson'];
const mustOut = ['Jasper', 'Cullman', 'Russellville'];
for (const t of mustIn) if (!inside(places[t])) throw new Error(`Validation failed: ${t} should be in Zone D`);
for (const t of mustOut) if (inside(places[t])) throw new Error(`Validation failed: ${t} should NOT be in Zone D`);
let cellsIn = 0;
for (let i = 0; i < GW * GH; i++) cellsIn += inD[i];
const areaKm2 = cellsIn * CELL * 111.32 * Math.cos((34.2 * Math.PI) / 180) * CELL * 110.57;
console.log(`Zone D area ≈ ${Math.round(areaKm2)} km² (${Math.round(areaKm2 * 247.1)} acres); validation towns OK`);

// ---------- polygon output ----------
const grid = new Float64Array(GW * GH);
for (let i = 0; i < GW * GH; i++) grid[i] = inD[i];
const [poly] = d3contours().size([GW, GH]).thresholds([0.5])(grid);
const mp = { type: 'MultiPolygon', coordinates: poly.coordinates.map((p) => p.map((r) => r.map(([x, y]) => [+(REGION[0] + x * CELL).toFixed(5), +(REGION[3] - y * CELL).toFixed(5)]))) };
const zoneD = turf.simplify(turf.feature(mp, { zone: 'D', source: 'Derived from the OutdoorAlabama 2026-27 Zone D boundary description' }), { tolerance: 0.0003 });
const bodyD = JSON.stringify(turf.featureCollection([zoneD]));
await fs.writeFile(path.join(OUT, 'deer-zone-d.geojson'), bodyD);
await fs.writeFile(path.join(OUT, 'deer-zone-boundary.geojson'), JSON.stringify(turf.truncate(turf.featureCollection(walls), { precision: 5 })));
const keep = new Set(['Winston', 'Lawrence', 'Walker', 'Cullman', 'Franklin', 'Marion', 'Morgan']);
const ctyOut = turf.truncate(turf.simplify(turf.featureCollection(cty.features.filter((f) => keep.has(f.properties.NAME)).map((f) => turf.feature(f.geometry, { name: f.properties.NAME }))), { tolerance: 0.0003 }), { precision: 5 });
await fs.writeFile(path.join(OUT, 'counties.geojson'), JSON.stringify(ctyOut));
await fs.writeFile(path.join(RAW, 'registry-deer-zones.json'), JSON.stringify([
  { id: 'derived-deer-zone-d', agency: 'Derived (Rehtac) from ADCNR text + OSM + ADCNR counties', title: 'Alabama Deer Zone D boundary (2026-27), reconstructed from the official boundary description', url: 'https://www.outdooralabama.com/seasons-and-bag-limits/deer-season', coverage: `region ${REGION.join(',')}`, retrieved: new Date().toISOString(), resolution: `~55 m raster, ${report.length} boundary elements`, usage: 'Derived; ADCNR publishes no zone GIS. Points within 400 m of the line are treated as zone-uncertain.', quality: 'derived (validated: Double Springs/Houston/Grayson in D; Jasper/Cullman/Russellville out)', checksum: crypto.createHash('sha256').update(bodyD).digest('hex').slice(0, 16), file: 'data/deer-zone-d.geojson' },
  { id: 'adcnr-counties', agency: 'Alabama DCNR', title: 'Alabama county boundaries', url: 'https://conservationgis.alabama.gov/adcnrweb/rest/services/AlabamaCounties/MapServer/0', coverage: `region ${REGION.join(',')}`, retrieved: new Date().toISOString(), resolution: 'Vector', usage: 'Public agency data', quality: 'retrieved', file: 'data/counties.geojson' },
], null, 2));
console.log('wrote deer-zone-d.geojson, deer-zone-boundary.geojson, counties.geojson');
