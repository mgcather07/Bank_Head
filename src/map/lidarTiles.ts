// Registers the lidar:// tile protocol with MapLibre (URL building lives in ../engine/lidarTiles).
import { addProtocol } from 'maplibre-gl';
import { lidarTileUrl } from '../engine/lidarTiles';

export { LIDAR_MAX_Z } from '../engine/lidarTiles';

let registered = false;
export function registerLidarProtocol() {
  if (registered) return;
  registered = true;
  addProtocol('lidar', async (params, abort) => {
    const [z, x, y] = params.url.replace('lidar://', '').split('/').map(Number);
    const r = await fetch(lidarTileUrl(z, x, y), { signal: abort.signal });
    if (!r.ok) throw new Error(`Lidar tile ${r.status}`);
    return { data: await r.arrayBuffer() };
  });
}
