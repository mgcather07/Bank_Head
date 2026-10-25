// Walking network built from FS roads, NFS trails and highways: lines are split at vertices,
// endpoints within SNAP_M are merged, and Dijkstra gives the on-network path between two snapped points.
// The remaining gap between the network and a zone is reported separately as an off-trail leg.
import * as turf from '@turf/turf';

export const SNAP_M = 20;
const toKey = (c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`;

export function buildNetwork(featureCollections) {
  const nodes = []; // [lon, lat]
  const nodeIndex = new Map();
  const adj = []; // adj[i] = [[j, meters, kind]]
  const cells = new Map(); // coarse grid → node ids (for snapping)
  const cellKey = (c) => `${Math.floor(c[0] / 0.002)},${Math.floor(c[1] / 0.002)}`;
  const nodeFor = (c) => {
    const k = toKey(c);
    if (nodeIndex.has(k)) return nodeIndex.get(k);
    // merge with any node within SNAP_M
    const ck = cellKey(c);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ids = cells.get(`${Math.floor(c[0] / 0.002) + dx},${Math.floor(c[1] / 0.002) + dy}`);
      if (!ids) continue;
      for (const id of ids) if (turf.distance(nodes[id], c, { units: 'meters' }) <= SNAP_M) { nodeIndex.set(k, id); return id; }
    }
    const id = nodes.push(c) - 1;
    adj.push([]);
    nodeIndex.set(k, id);
    if (!cells.has(ck)) cells.set(ck, []);
    cells.get(ck).push(id);
    return id;
  };
  for (const { fc, kind, filter } of featureCollections) {
    for (const f of fc.features) {
      if (filter && !filter(f)) continue;
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
      for (const line of lines) {
        let prev = null;
        for (const c of line) {
          const id = nodeFor([c[0], c[1]]);
          if (prev != null && prev !== id) {
            const m = turf.distance(nodes[prev], nodes[id], { units: 'meters' });
            adj[prev].push([id, m, kind]);
            adj[id].push([prev, m, kind]);
          }
          prev = id;
        }
      }
    }
  }
  return { nodes, adj, cells };
}

/** Nearest network node to a point (meters). Scans a widening window of grid cells. */
export function nearestNode(net, pt, maxM = 2000) {
  let best = { id: -1, d: Infinity };
  const cx = Math.floor(pt[0] / 0.002), cy = Math.floor(pt[1] / 0.002);
  const r = Math.ceil(maxM / 180) + 1;
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const ids = net.cells.get(`${cx + dx},${cy + dy}`);
    if (!ids) continue;
    for (const id of ids) {
      const d = turf.distance(net.nodes[id], pt, { units: 'meters' });
      if (d < best.d) best = { id, d };
    }
  }
  return best.d <= maxM ? best : null;
}

/** Dijkstra from one node; returns dist[] and prev[] so many targets can be read cheaply. */
export function dijkstra(net, src, limitM = 15000) {
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  dist[src] = 0;
  // simple binary heap
  const hI = [], hD = [];
  const push = (i, d) => { hI.push(i); hD.push(d); let k = hI.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hD[p] <= hD[k]) break; [hI[p], hI[k]] = [hI[k], hI[p]]; [hD[p], hD[k]] = [hD[k], hD[p]]; k = p; } };
  const pop = () => { const i = hI[0], d = hD[0]; const li = hI.pop(), ld = hD.pop(); if (hI.length) { hI[0] = li; hD[0] = ld; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= hI.length) break; if (c + 1 < hI.length && hD[c + 1] < hD[c]) c++; if (hD[c] >= hD[k]) break; [hI[c], hI[k]] = [hI[k], hI[c]]; [hD[c], hD[k]] = [hD[k], hD[c]]; k = c; } } return [i, d]; };
  push(src, 0);
  while (hI.length) {
    const [i, d] = pop();
    if (d > dist[i] || d > limitM) continue;
    for (const [j, m] of net.adj[i]) {
      const nd = d + m;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(j, nd); }
    }
  }
  return { dist, prev };
}

export function pathTo(net, prev, target) {
  const out = [];
  for (let i = target; i >= 0; i = prev[i]) out.push(net.nodes[i]);
  return out.reverse();
}
