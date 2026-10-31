// Offline area packs: pre-fetch USGS basemap tiles (or lidar relief tiles) for a bounding box into the same cache
// the service worker serves from, so the map keeps working with no signal. USGS data is public domain.
import { lidarTileUrl } from './lidarTiles';

export const TILE_CACHE = 'usgs-tiles';
export const LIDAR_CACHE = 'lidar-hillshade';
export const MIN_Z = 11;
export const MAX_Z = 15;
export const MAX_TILES = 2500;

export interface SavedArea {
  id: string;
  name: string;
  bbox: [number, number, number, number]; // w,s,e,n
  base: string;
  tiles: number;
  bytesApprox: number;
  saved: string;
}

const svcFor = (base: string) => ({ topo: 'USGSTopo', satellite: 'USGSImageryOnly', hybrid: 'USGSImageryTopo', hillshade: 'USGSShadedReliefOnly' }[base] ?? 'USGSTopo');
export const tileUrl = (base: string, z: number, x: number, y: number) => (base === 'lidar' ? lidarTileUrl(z, x, y) : `https://basemap.nationalmap.gov/arcgis/rest/services/${svcFor(base)}/MapServer/tile/${z}/${y}/${x}`);
const cacheFor = (base: string) => (base === 'lidar' ? LIDAR_CACHE : TILE_CACHE);
/** Lidar is saved one zoom deeper: its detail is the point of choosing it. */
export const tilesForBase = (bbox: [number, number, number, number], base: string) => tilesFor(bbox, MIN_Z, base === 'lidar' ? MAX_Z + 1 : MAX_Z);

export function lon2x(lon: number, z: number) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
export function lat2y(lat: number, z: number) { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); }

export function tilesFor(bbox: [number, number, number, number], zMin = MIN_Z, zMax = MAX_Z): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lon2x(bbox[0], z), x1 = lon2x(bbox[2], z), y0 = lat2y(bbox[3], z), y1 = lat2y(bbox[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

export async function downloadArea(bbox: [number, number, number, number], base: string, onProgress: (done: number, total: number, failed: number) => void, signal?: AbortSignal): Promise<{ done: number; failed: number; bytes: number }> {
  const tiles = tilesForBase(bbox, base);
  if (tiles.length > MAX_TILES) throw new Error(`Area too large (${tiles.length} tiles; limit ${MAX_TILES}). Zoom in and try again.`);
  const cache = await caches.open(cacheFor(base));
  let done = 0, failed = 0, bytes = 0;
  const queue = [...tiles];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) return;
      const [z, x, y] = queue.shift()!;
      const url = tileUrl(base, z, x, y);
      try {
        if (!(await cache.match(url))) {
          const r = await fetch(url, { signal });
          if (!r.ok) throw new Error(String(r.status));
          bytes += Number(r.headers.get('content-length') ?? 15000);
          await cache.put(url, r);
        }
        done++;
      } catch {
        if (signal?.aborted) return;
        failed++;
      }
      onProgress(done, tiles.length, failed);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { done, failed, bytes };
}

export async function cachedTileCount(): Promise<number> {
  try {
    let n = 0;
    for (const name of [TILE_CACHE, LIDAR_CACHE]) n += (await (await caches.open(name)).keys()).length;
    return n;
  } catch {
    return 0;
  }
}

export async function removeArea(area: SavedArea) {
  const c = await caches.open(cacheFor(area.base));
  for (const [z, x, y] of tilesForBase(area.bbox, area.base)) await c.delete(tileUrl(area.base, z, x, y));
}
