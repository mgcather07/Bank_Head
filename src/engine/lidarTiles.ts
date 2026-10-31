// High-definition lidar relief from USGS 3DEP (about 1 m bare-earth elevation across Alabama), rendered by the
// 3DEP ImageServer as a hillshade. Map tiles are 256 px but each is requested at 512 px, so it stays sharp on phone
// screens and reaches the data's full resolution at zoom 16.
//
// Tiles go through a "lidar://z/x/y" protocol so the request URL is built in one place: the offline download and
// the map ask for exactly the same URL, which is what lets the service worker's cache serve it with no signal.
export const LIDAR_MAX_Z = 17;
const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
// single-direction gray hillshade: crisper than the multidirectional one, shows roadbeds, benches and cuts best
const RULE = encodeURIComponent(JSON.stringify({ rasterFunction: 'Hillshade Gray' }));
const HALF = Math.PI * 6378137;

/** The exportImage URL for one web-mercator tile. bbox comes first and f=image last (the cache rule relies on it). */
export function lidarTileUrl(z: number, x: number, y: number): string {
  const size = (2 * HALF) / 2 ** z;
  const b = [-HALF + x * size, HALF - (y + 1) * size, -HALF + (x + 1) * size, HALF - y * size].map((v) => v.toFixed(2)).join(',');
  return `${SERVICE}?bbox=${b}&bboxSR=3857&imageSR=3857&size=512,512&format=jpgpng&renderingRule=${RULE}&f=image`;
}
