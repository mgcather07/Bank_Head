// Terrain pathfinder — least-effort walking route over an elevation grid (used by the offline build on 10 m
// 3DEP elevation and in the browser on 3–4 m lidar). Pure TypeScript with no imports so Node can run it directly.
//
// Cost = walking time. Speed follows Tobler's hiking function on the slope of each step, ×0.6 off mapped
// roads/trails (Tobler's off-path factor). Cells steeper than CLIFF_DEG are impassable (bluffs/cliffs), steep
// side-hills are penalised, private land and open water are blocked (except where a mapped road crosses them).
// Old roadbeds and benches are the flattest lines on a hillside, so on lidar the route naturally follows them.

export const CLIFF_DEG = 38;
export const STEEP_DEG = 25;
export const OFF_PATH_FACTOR = 0.6;

export interface Grid {
  w: number;
  h: number;
  dx: number; // meters per cell east–west
  dy: number; // meters per cell north–south
  elev: Float32Array;
}

/** Max slope in degrees per cell (Horn), 255 = nodata. */
export function slopeDeg(g: Grid): Uint8Array {
  const { w, h, dx, dy, elev } = g;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const at = (xx: number, yy: number) => elev[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
    const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1), d = at(x - 1, y), f = at(x + 1, y), gg = at(x - 1, y + 1), hh = at(x, y + 1), k = at(x + 1, y + 1);
    if (!(elev[i] > -1000)) { out[i] = 255; continue; }
    const zx = (c + 2 * f + k - (a + 2 * d + gg)) / (8 * dx);
    const zy = (gg + 2 * hh + k - (a + 2 * b + c)) / (8 * dy);
    out[i] = Math.min(254, Math.round((Math.atan(Math.hypot(zx, zy)) * 180) / Math.PI));
  }
  return out;
}

/** Even–odd scanline fill of polygon rings (in pixel coordinates) into `out`. */
export function fillRings(rings: Array<Array<[number, number]>>, w: number, h: number, out: Uint8Array, value = 1) {
  const xs: number[] = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const r of rings) for (const p of r) { yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]); }
  for (let y = Math.max(0, Math.floor(yMin)); y <= Math.min(h - 1, Math.ceil(yMax)); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [x1, y1] = r[i], [x2, y2] = r[j];
      if ((y1 > cy) !== (y2 > cy)) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) out[y * w + x] = value;
    }
  }
}

/** Draw polylines (pixel coordinates) into `out`, `radius` cells wide. */
export function drawLines(lines: Array<Array<[number, number]>>, w: number, h: number, out: Uint8Array, value = 1, radius = 0) {
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) {
    const [x0, y0] = l[i], [x1, y1] = l[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    for (let s = 0; s <= n; s++) {
      const cx = Math.floor(x0 + ((x1 - x0) * s) / n), cy = Math.floor(y0 + ((y1 - y0) * s) / n);
      for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
        const xx = cx + ox, yy = cy + oy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = value;
      }
    }
  }
}

/**
 * Open water from the elevation itself: USGS 3DEP lidar DEMs are hydro-flattened, so lakes, ponds and wide river
 * reaches are perfectly level surfaces. Marks connected dead-flat areas of at least `minCells` cells.
 */
export function flatWaterMask(g: Grid, minCells: number, out: Uint8Array = new Uint8Array(g.w * g.h), tolM = 0.02): Uint8Array {
  const { w, h, elev } = g;
  const flat = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, z = elev[i];
    if (Math.abs(elev[i - 1] - z) < tolM && Math.abs(elev[i + 1] - z) < tolM && Math.abs(elev[i - w] - z) < tolM && Math.abs(elev[i + w] - z) < tolM) flat[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const stack: number[] = [], comp: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!flat[s] || seen[s]) continue;
    comp.length = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !flat[j] || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        if (Math.abs(elev[j] - elev[i]) >= tolM) continue;
        seen[j] = 1; stack.push(j);
      }
    }
    if (comp.length >= minCells) for (const i of comp) out[i] = 1;
  }
  return out;
}

export interface Seed { i: number; cost: number; tag: number }
export interface PathResult { cells: number[]; seconds: number; seedTag: number; seedCell: number; lengthM: number; onPathM: number; offPathM: number; gainM: number; lossM: number; maxSlopeDeg: number }

/** Tobler speed in m/s for a step with signed grade s (rise/run). */
export const toblerMs = (s: number) => (6 * Math.exp(-3.5 * Math.abs(s + 0.05))) / 3.6;

/**
 * Multi-source Dijkstra from `seeds` (cells already reached, with a starting cost in seconds — e.g. the walk along
 * the road/trail network to get there) to `goal`. Returns the fastest walking path, or null if the goal is cut off.
 */
export function findPath(g: Grid, slope: Uint8Array, blocked: Uint8Array, onPath: Uint8Array, seeds: Seed[], goal: number, maxSeconds = 4 * 3600): PathResult | null {
  const { w, h, dx, dy, elev } = g;
  const n = w * h;
  const cost = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const tag = new Int32Array(n).fill(-1);
  // binary heap of (cost, cell)
  let hc = new Float64Array(1024), hi = new Int32Array(1024), hn = 0;
  const push = (c: number, i: number) => {
    if (hn === hc.length) { const nc = new Float64Array(hn * 2); nc.set(hc); hc = nc; const ni = new Int32Array(hn * 2); ni.set(hi); hi = ni; }
    let k = hn++;
    while (k > 0) { const p = (k - 1) >> 1; if (hc[p] <= c) break; hc[k] = hc[p]; hi[k] = hi[p]; k = p; }
    hc[k] = c; hi[k] = i;
  };
  const pop = () => {
    const i = hi[0], c = hc[0];
    const lc = hc[--hn], li = hi[hn];
    let k = 0;
    for (;;) { let ch = 2 * k + 1; if (ch >= hn) break; if (ch + 1 < hn && hc[ch + 1] < hc[ch]) ch++; if (hc[ch] >= lc) break; hc[k] = hc[ch]; hi[k] = hi[ch]; k = ch; }
    hc[k] = lc; hi[k] = li;
    return [i, c] as const;
  };
  const passable = (i: number) => onPath[i] === 1 || (!blocked[i] && slope[i] < CLIFF_DEG);
  for (const s of seeds) if (s.i >= 0 && s.i < n && s.cost < cost[s.i]) { cost[s.i] = s.cost; tag[s.i] = s.tag; push(s.cost, s.i); }
  if (!passable(goal)) blocked[goal] = 0; // always allow arriving at the zone itself
  const DIRS: Array<[number, number, number]> = [[1, 0, dx], [-1, 0, dx], [0, 1, dy], [0, -1, dy], [1, 1, Math.hypot(dx, dy)], [-1, 1, Math.hypot(dx, dy)], [1, -1, Math.hypot(dx, dy)], [-1, -1, Math.hypot(dx, dy)]];
  let found = false;
  while (hn) {
    const [i, c] = pop();
    if (c > cost[i]) continue;
    if (i === goal) { found = true; break; }
    if (c > maxSeconds) break;
    const x = i % w, y = (i - x) / w;
    for (const [ox, oy, d] of DIRS) {
      const xx = x + ox, yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!passable(j) && j !== goal) continue;
      const grade = (elev[j] - elev[i]) / d;
      if (Math.abs(grade) > 1.2 && !onPath[j]) continue; // > 50° step: not walkable
      let v = toblerMs(grade);
      if (!onPath[j]) v *= OFF_PATH_FACTOR;
      const sd = slope[j];
      if (sd > STEEP_DEG && !onPath[j]) v /= 1 + ((sd - STEEP_DEG) / (CLIFF_DEG - STEEP_DEG)) * 2;
      const nc = c + d / v;
      if (nc < cost[j]) { cost[j] = nc; prev[j] = i; tag[j] = tag[i]; push(nc, j); }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) cells.push(i);
  cells.reverse();
  let lengthM = 0, onPathM = 0, gain = 0, loss = 0, maxSlope = 0;
  for (let k = 1; k < cells.length; k++) {
    const a = cells[k - 1], b = cells[k];
    const ddx = ((b % w) - (a % w)) * dx, ddy = (Math.floor(b / w) - Math.floor(a / w)) * dy;
    const seg = Math.hypot(ddx, ddy);
    lengthM += seg;
    if (onPath[b]) onPathM += seg;
    const dz = elev[b] - elev[a];
    if (dz > 0) gain += dz; else loss -= dz;
    // steepest cross-country ground walked (road cuts and the destination cell itself don't count)
    if (slope[b] < 255 && !onPath[b] && b !== goal) maxSlope = Math.max(maxSlope, slope[b]);
  }
  return { cells, seconds: cost[goal], seedTag: tag[goal], seedCell: cells[0], lengthM, onPathM, offPathM: lengthM - onPathM, gainM: gain, lossM: loss, maxSlopeDeg: maxSlope };
}

/** Douglas–Peucker simplification of [x,y] points. */
export function simplify(pts: Array<[number, number]>, tol: number): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let md = -1, mi = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
