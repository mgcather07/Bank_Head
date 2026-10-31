// The map. Designed to be calm: zones are ranked dots (only the best few numbered), outlines appear when you
// zoom in, and everything else is opt-in from the Layers sheet. Boundaries shown belong to the active workspace.
import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { AppData } from '../data';
import type { HuntRecommendation, UserPin } from '../engine/types';
import type { ClubGeometry } from '../engine/club';
import { BANKHEAD_CENTER } from '../engine/time';
import { CLUB_BBOX, STUDY_BBOX } from '../engine/config';
import { pathDistance } from '../engine/roads';
import type { WorkspaceKind } from '../lib/workspaces';

// MapLibre v6 ships its worker as a separate ES module; bundle it so the static build can load it.
maplibregl.setWorkerUrl(workerUrl);

export type BaseMap = 'topo' | 'satellite' | 'hybrid' | 'hillshade';
export interface LayerToggles {
  boundaries: boolean; ownership: boolean; wilderness: boolean; roads: boolean; trails: boolean; streams: boolean; contours: boolean;
  slope: boolean; disturbance: boolean; lidar: boolean; candidates: boolean; access: boolean; pins: boolean;
}
export type ZoneTypeFilter = 'all' | 'saddle' | 'bench' | 'spur' | 'bottom' | 'spot';
export interface SetupMarker { id: string; coord: [number, number]; primary: boolean; label: string }
/** What the map needs to know to draw one zone. rank is 1-based among legal zones; tier 1 shows at every zoom, 3 only up close. */
export interface ZoneMark { score: number | null; rank: number | null; tier: 1 | 2 | 3 }

const USGS = (svc: string) => `https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
const BASES: Record<BaseMap, string> = { topo: 'USGSTopo', satellite: 'USGSImageryOnly', hybrid: 'USGSImageryTopo', hillshade: 'USGSShadedReliefOnly' };
type Quad = [[number, number], [number, number], [number, number], [number, number]];
const quad = (b: readonly number[]): Quad => [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]];
const PIN_COLORS: Record<string, string> = { stand: '#f5c542', sighting: '#ff8a3d', rub: '#c46b2b', scrape: '#a0522d', trail: '#d9b38c', bedding: '#9b6bd6', feeding: '#6cc070', camera: '#5ab4e6', parking: '#ffffff', harvest: '#ff4d4d', saved_candidate: '#f7f2a1' };
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

function styleFor(base: BaseMap, dark: boolean): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: { base: { type: 'raster', tiles: [USGS(BASES[base])], tileSize: 256, maxzoom: 16, attribution: 'USGS The National Map' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#0e1410' : '#e9ebe4' } },
      { id: 'base', type: 'raster', source: 'base', paint: basePaint(base, dark) },
    ],
  };
}
// A quieter basemap: topo is desaturated a little, and dimmed in dark mode so the zones stand out.
function basePaint(base: BaseMap, dark: boolean) {
  const sat = base === 'satellite' || base === 'hybrid' ? -0.1 : -0.32;
  return { 'raster-saturation': sat, 'raster-contrast': dark ? 0.05 : 0, 'raster-brightness-max': dark ? 0.72 : 1, 'raster-opacity': base === 'hillshade' ? 0.9 : 1 };
}

/** Schematic scent cone: sector from the zone centre toward the downwind bearing. Not a dispersion model. */
export function scentCone(center: [number, number], downwind: number, lengthM = 350, halfAngle = 22): Feature<Polygon> {
  const pts: [number, number][] = [center];
  const R = 6371008.8;
  for (let a = -halfAngle; a <= halfAngle; a += 4) {
    const br = ((downwind + a) * Math.PI) / 180;
    const lat1 = (center[1] * Math.PI) / 180, lon1 = (center[0] * Math.PI) / 180, d = lengthM / R;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    pts.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  pts.push(center);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
}

/** Red ✕ with a white halo, drawn once into the map's sprite. */
function setupIcon(size = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const pad = size * 0.2;
  g.lineCap = 'round';
  for (const [color, w] of [['#ffffff', size * 0.26], ['#d81e1e', size * 0.15]] as const) {
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(pad, pad); g.lineTo(size - pad, size - pad); g.moveTo(size - pad, pad); g.lineTo(pad, size - pad); g.stroke();
  }
  return g.getImageData(0, 0, size, size);
}

const SCORE_COLOR: maplibregl.ExpressionSpecification = ['case', ['<', ['get', 'score'], 0], '#8b948d', ['interpolate', ['linear'], ['get', 'score'], 35, '#c8493f', 55, '#e7a932', 75, '#43b26a']];

interface Props {
  data: AppData | null;
  workspaceKind: WorkspaceKind;
  dark: boolean;
  base: BaseMap;
  layers: LayerToggles;
  marks: Map<string, ZoneMark>;
  selected: HuntRecommendation | null;
  windHour: { from: number | null; downwind: number | null } | null;
  userLoc: [number, number] | null;
  pins: UserPin[];
  setups: SetupMarker[];
  typeFilter: ZoneTypeFilter;
  startPin: [number, number] | null;
  clubBoundary?: ClubGeometry | null;
  clubRoads?: FeatureCollection | null;
  onCandidate: (id: string) => void;
  onInspect: (lngLat: [number, number]) => void;
  mapRef: React.MutableRefObject<MLMap | null>;
}

export function MapView({ data, workspaceKind, dark, base, layers, marks, selected, windHour, userLoc, pins, setups, typeFilter, startPin, clubBoundary, clubRoads, onCandidate, onInspect, mapRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const pending = useRef<Array<() => void>>([]);
  const whenReady = (fn: () => void) => (ready.current ? fn() : pending.current.push(fn));
  const cbs = useRef({ onCandidate, onInspect });
  cbs.current = { onCandidate, onInspect };
  const initial = useRef({ base, dark });

  // ---- init ----
  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({ container: el.current, style: styleFor(initial.current.base, initial.current.dark), center: BANKHEAD_CENTER, zoom: 9.9, maxZoom: 18, attributionControl: { compact: true } });
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __bhMap?: MLMap }).__bhMap = map;
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e));
    const zoneLayers = ['cand-dot-1', 'cand-dot-2', 'cand-dot-3', 'cand-fill'];
    map.on('click', (e: MapMouseEvent) => {
      const layers = zoneLayers.filter((l) => map.getLayer(l));
      const r = 16; // forgiving tap target for small dots
      const hits = layers.length ? map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers }) : [];
      if (hits.length) {
        // nearest to the tap, best-ranked first
        let best = hits[0], bd = Infinity;
        for (const h of hits) {
          const g = h.geometry as unknown as { type: string; coordinates: number[] };
          const c = g.type === 'Point' ? g.coordinates : null;
          const d = c ? Math.hypot(map.project(c as [number, number]).x - e.point.x, map.project(c as [number, number]).y - e.point.y) : 40;
          if (d < bd) { bd = d; best = h; }
        }
        cbs.current.onCandidate(String(best.properties.id));
      } else cbs.current.onInspect([e.lngLat.lng, e.lngLat.lat]);
    });
    for (const l of zoneLayers) { map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', l, () => (map.getCanvas().style.cursor = '')); }
    return () => { map.remove(); mapRef.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- base map and theme ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('base') as maplibregl.RasterTileSource | undefined;
    if (src && 'setTiles' in src) src.setTiles([USGS(BASES[base])]);
    if (map.getLayer('base')) for (const [k, v] of Object.entries(basePaint(base, dark))) map.setPaintProperty('base', k as never, v as never);
    if (map.getLayer('bg')) map.setPaintProperty('bg', 'background-color', dark ? '#0e1410' : '#e9ebe4');
  }, [base, dark, mapRef]);

  // ---- sources and layers (once data arrives) ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const add = () => {
      if (map.getSource('wma')) return;
      const text = { 'text-font': ['Noto Sans Regular'] };
      const halo = { 'text-halo-color': '#101510', 'text-halo-width': 1.4 };
      // raster overlays first, so everything else draws above them
      map.addSource('slope', { type: 'image', url: `${import.meta.env.BASE_URL}data/slope.png`, coordinates: quad([STUDY_BBOX[0], STUDY_BBOX[1], STUDY_BBOX[2], STUDY_BBOX[3]]) });
      map.addLayer({ id: 'slope', type: 'raster', source: 'slope', paint: { 'raster-opacity': 0.7, 'raster-resampling': 'nearest' }, layout: { visibility: 'none' } });
      map.addSource('lidar-hs', { type: 'raster', tileSize: 256, minzoom: 11, maxzoom: 17, attribution: 'USGS 3DEP lidar', tiles: ['https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&renderingRule=%7B%22rasterFunction%22%3A%22Hillshade%20Multidirectional%22%7D&f=image'] });
      map.addLayer({ id: 'lidar-hs', type: 'raster', source: 'lidar-hs', minzoom: 12, paint: { 'raster-opacity': 0.55 }, layout: { visibility: 'none' } });
      map.addSource('disturbance', { type: 'image', url: `${import.meta.env.BASE_URL}data/disturbance.png`, coordinates: quad([STUDY_BBOX[0], STUDY_BBOX[1], STUDY_BBOX[2], STUDY_BBOX[3]]) });
      map.addLayer({ id: 'disturbance', type: 'raster', source: 'disturbance', paint: { 'raster-opacity': 0.7, 'raster-resampling': 'nearest' }, layout: { visibility: 'none' } });
      map.addSource('fuel', { type: 'geojson', data: data.fuelTreatments });
      map.addLayer({ id: 'fuel-line', type: 'line', source: 'fuel', paint: { 'line-color': '#ff8a3d', 'line-width': 1.5, 'line-dasharray': [2, 2] }, layout: { visibility: 'none' } });
      map.addSource('contours', { type: 'geojson', data: data.contours });
      map.addLayer({ id: 'contours', type: 'line', source: 'contours', paint: { 'line-color': '#b08a52', 'line-width': ['case', ['get', 'index'], 1.1, 0.5], 'line-opacity': 0.7 }, minzoom: 11, layout: { visibility: 'none' } });
      map.addLayer({ id: 'contour-labels', type: 'symbol', source: 'contours', minzoom: 13.5, filter: ['get', 'index'], layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'elevFt']], ' ft'], 'text-size': 10, ...text, visibility: 'none' }, paint: { 'text-color': '#e8d3a8', ...halo } });
      map.addSource('streams', { type: 'geojson', data: data.streams });
      map.addLayer({ id: 'streams', type: 'line', source: 'streams', paint: { 'line-color': '#4aa3e0', 'line-width': ['interpolate', ['linear'], ['get', 'km2'], 0.3, 0.6, 10, 2.2], 'line-opacity': 0.8 }, layout: { visibility: 'none' } });
      map.addSource('ownership', { type: 'geojson', data: { ...data.ownership, features: data.ownership.features.filter((f) => (f.properties as { ownerclassification?: string }).ownerclassification !== 'USDA FOREST SERVICE') } });
      map.addLayer({ id: 'nonfs', type: 'fill', source: 'ownership', paint: { 'fill-color': '#d64545', 'fill-opacity': 0.2 }, layout: { visibility: 'none' } });
      map.addSource('wilderness', { type: 'geojson', data: data.wilderness });
      map.addLayer({ id: 'wilderness', type: 'fill', source: 'wilderness', paint: { 'fill-color': '#7fbf6a', 'fill-opacity': 0.12 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'wilderness-line', type: 'line', source: 'wilderness', paint: { 'line-color': '#9fd98a', 'line-width': 1.5, 'line-dasharray': [3, 2] }, layout: { visibility: 'none' } });
      // boundaries (each belongs to one workspace)
      map.addSource('nf', { type: 'geojson', data: data.nfAdmin });
      map.addLayer({ id: 'nf-line', type: 'line', source: 'nf', paint: { 'line-color': '#5fbf6a', 'line-width': 2.2, 'line-dasharray': [2, 1.5] }, layout: { visibility: 'none' } });
      map.addSource('zoned', { type: 'geojson', data: data.zoneDLines });
      map.addLayer({ id: 'zoned-line', type: 'line', source: 'zoned', paint: { 'line-color': '#a974e6', 'line-width': 2, 'line-dasharray': [4, 3], 'line-opacity': 0.85 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'zoned-label', type: 'symbol', source: 'zoned', minzoom: 10.5, layout: { 'symbol-placement': 'line', 'text-field': 'Deer Zone D | C', 'text-size': 11, ...text, 'symbol-spacing': 400, visibility: 'none' }, paint: { 'text-color': '#e2c6ff', ...halo } });
      map.addSource('wma', { type: 'geojson', data: data.wma });
      map.addLayer({ id: 'wma-line', type: 'line', source: 'wma', paint: { 'line-color': '#e9a824', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 13, 2.4], 'line-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.75, 13, 1] }, layout: { visibility: 'none' } });
      map.addSource('highways', { type: 'geojson', data: data.highways });
      map.addLayer({ id: 'zone-divider', type: 'line', source: 'highways', filter: ['==', ['get', 'ref'], 'AL 33'], paint: { 'line-color': '#ffd84d', 'line-width': 2, 'line-dasharray': [4, 2] }, layout: { visibility: 'none' } });
      map.addSource('club', { type: 'geojson', data: empty });
      map.addLayer({ id: 'club-fill', type: 'fill', source: 'club', paint: { 'fill-color': '#ffd84d', 'fill-opacity': 0.06 }, layout: { visibility: 'none' } });
      map.addLayer({ id: 'club-line', type: 'line', source: 'club', paint: { 'line-color': '#ffd84d', 'line-width': 2.6 }, layout: { visibility: 'none' } });
      // roads and trails
      map.addSource('fsroads', { type: 'geojson', data: data.fsRoads });
      map.addLayer({ id: 'fsroads', type: 'line', source: 'fsroads', paint: { 'line-color': ['match', ['slice', ['get', 'oper_maint_level'], 0, 1], '1', '#888', '2', '#d9a066', '#f0e6d2'], 'line-width': 1.5 }, layout: { visibility: 'none' } });
      map.addSource('clubroads', { type: 'geojson', data: empty });
      map.addLayer({ id: 'clubroads', type: 'line', source: 'clubroads', paint: { 'line-color': ['match', ['get', 'highway'], 'path', '#e36b5b', 'footway', '#e36b5b', 'bridleway', '#e36b5b', 'cycleway', '#e36b5b', '#f0e6d2'], 'line-width': 1.4 }, layout: { visibility: 'none' } });
      map.addSource('trails', { type: 'geojson', data: data.trails });
      map.addLayer({ id: 'trails', type: 'line', source: 'trails', paint: { 'line-color': '#e36b5b', 'line-width': 1.4, 'line-dasharray': [2, 1.5] }, layout: { visibility: 'none' } });
      // zones: outlines only up close, ranked dots at every scale
      map.addSource('cands', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addLayer({ id: 'cand-fill', type: 'fill', source: 'cands', minzoom: 14, paint: { 'fill-color': SCORE_COLOR, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 0.28] } });
      map.addLayer({ id: 'cand-line', type: 'line', source: 'cands', minzoom: 14, paint: { 'line-color': SCORE_COLOR, 'line-width': 1.5, 'line-opacity': 0.9 } });
      map.addSource('cand-pts', { type: 'geojson', data: empty });
      const dot = (n: 1 | 2 | 3, minzoom: number, r: [number, number]) => map.addLayer({
        id: `cand-dot-${n}`, type: 'circle', source: 'cand-pts', minzoom, filter: ['==', ['get', 'tier'], n],
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, r[0], 16, r[1]], 'circle-color': SCORE_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': n === 1 ? 2 : 1.5, 'circle-stroke-opacity': 0.95, 'circle-opacity': n === 3 ? 0.8 : 1 },
      });
      dot(3, 13, [3.5, 6]); dot(2, 11.5, [4.5, 8]); dot(1, 0, [8, 13]);
      map.addLayer({ id: 'cand-rank', type: 'symbol', source: 'cand-pts', filter: ['>', ['get', 'rank'], 0], layout: { 'text-field': ['to-string', ['get', 'rank']], 'text-size': 11.5, 'text-allow-overlap': true, 'text-ignore-placement': true, ...text }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.55)', 'text-halo-width': 1 } });
      // selection, scent, route
      map.addSource('selected', { type: 'geojson', data: empty });
      if (!map.hasImage('setup-x')) map.addImage('setup-x', setupIcon(48), { pixelRatio: 2 });
      map.addLayer({ id: 'selected-fill', type: 'fill', source: 'selected', paint: { 'fill-color': '#ffe9a8', 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'selected-casing', type: 'line', source: 'selected', paint: { 'line-color': '#101510', 'line-width': 7, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': '#ffe9a8', 'line-width': 3.5 } });
      map.addSource('cone', { type: 'geojson', data: empty });
      map.addLayer({ id: 'cone', type: 'fill', source: 'cone', paint: { 'fill-color': '#ff9f43', 'fill-opacity': 0.28 } });
      map.addLayer({ id: 'cone-line', type: 'line', source: 'cone', paint: { 'line-color': '#ff9f43', 'line-width': 1, 'line-dasharray': [2, 2] } });
      map.addSource('route', { type: 'geojson', data: empty });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0b1a26', 'line-width': 6.5, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ['match', ['get', 'leg'], 'offtrail', '#ffd27a', '#7ad0ff'], 'line-width': 3.2, 'line-dasharray': ['match', ['get', 'leg'], 'offtrail', ['literal', [1, 1.5]], ['literal', [1, 0]]] } });
      map.addSource('access', { type: 'geojson', data: { type: 'FeatureCollection', features: [...data.accessPoints.features] } });
      map.addLayer({ id: 'access', type: 'circle', source: 'access', layout: { visibility: 'none' }, paint: { 'circle-radius': 5.5, 'circle-color': ['match', ['get', 'kind'], 'checking station', '#ff5c5c', '#3fa7ff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'access-label', type: 'symbol', source: 'access', minzoom: 11.5, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', ...text, visibility: 'none' }, paint: { 'text-color': '#fff', ...halo } });
      map.addSource('setups', { type: 'geojson', data: empty });
      map.addLayer({ id: 'setups', type: 'symbol', source: 'setups', minzoom: 12.5, layout: { 'icon-image': 'setup-x', 'icon-size': ['case', ['get', 'primary'], 1.15, 0.8], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'primary'], 1, 0] } });
      map.addLayer({ id: 'setup-label', type: 'symbol', source: 'setups', minzoom: 13.5, filter: ['get', 'primary'], layout: { 'text-field': 'Set up here', 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', ...text }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#b01010', 'text-halo-width': 1.5 } });
      map.addSource('pins', { type: 'geojson', data: empty });
      map.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'color'], '#fff'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });
      map.addSource('me', { type: 'geojson', data: empty });
      map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 14, 'circle-color': '#4da3ff', 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'start', '#ffffff', '#4da3ff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      ready.current = true;
      pending.current.splice(0).forEach((fn) => fn());
    };
    if (map.isStyleLoaded()) add(); else map.once('load', add);
  }, [data, mapRef]);

  // ---- visibility: layer toggles + the active workspace's own boundaries ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
      vis(['wma-line', 'zone-divider'], layers.boundaries && workspaceKind === 'wma');
      vis(['nf-line', 'zoned-line', 'zoned-label'], layers.boundaries && workspaceKind === 'nf');
      vis(['club-fill', 'club-line'], layers.boundaries && workspaceKind === 'land');
      vis(['nonfs'], layers.ownership);
      vis(['wilderness', 'wilderness-line'], layers.wilderness);
      vis(['fsroads'], layers.roads && workspaceKind !== 'land');
      vis(['clubroads'], layers.roads && workspaceKind === 'land');
      vis(['trails'], layers.trails);
      vis(['streams'], layers.streams);
      vis(['contours', 'contour-labels'], layers.contours);
      vis(['slope', 'slope-club'], layers.slope);
      vis(['disturbance', 'disturbance-club', 'fuel-line'], layers.disturbance);
      vis(['lidar-hs'], layers.lidar);
      vis(['cand-fill', 'cand-line', 'cand-dot-1', 'cand-dot-2', 'cand-dot-3', 'cand-rank', 'setups', 'setup-label'], layers.candidates);
      vis(['access', 'access-label'], layers.access);
      vis(['pins'], layers.pins);
    };
    whenReady(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, workspaceKind, data, clubBoundary, mapRef]);

  // ---- the private land: boundary, roads, and its own slope / disturbance overlays ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      (map.getSource('club') as GeoJSONSource | undefined)?.setData(clubBoundary ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: clubBoundary }] } : empty);
      (map.getSource('clubroads') as GeoJSONSource | undefined)?.setData(clubRoads ?? empty);
      if (clubBoundary && !map.getSource('slope-club')) {
        const b = import.meta.env.BASE_URL;
        map.addSource('slope-club', { type: 'image', url: `${b}data/club/slope.png`, coordinates: quad(CLUB_BBOX) });
        map.addLayer({ id: 'slope-club', type: 'raster', source: 'slope-club', paint: { 'raster-opacity': 0.7, 'raster-resampling': 'nearest' }, layout: { visibility: layers.slope ? 'visible' : 'none' } }, 'club-fill');
        map.addSource('disturbance-club', { type: 'image', url: `${b}data/club/disturbance.png`, coordinates: quad(CLUB_BBOX) });
        map.addLayer({ id: 'disturbance-club', type: 'raster', source: 'disturbance-club', paint: { 'raster-opacity': 0.7, 'raster-resampling': 'nearest' }, layout: { visibility: layers.disturbance ? 'visible' : 'none' } }, 'club-fill');
      }
      if (map.getLayer('slope-club')) { map.setLayoutProperty('slope-club', 'visibility', layers.slope ? 'visible' : 'none'); map.setLayoutProperty('disturbance-club', 'visibility', layers.disturbance ? 'visible' : 'none'); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubBoundary, clubRoads, data, layers.slope, layers.disturbance, mapRef]);

  // contours and streams change when the private land's are merged in
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    whenReady(() => {
      (map.getSource('contours') as GeoJSONSource | undefined)?.setData(data.contours);
      (map.getSource('streams') as GeoJSONSource | undefined)?.setData(data.streams);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.contours, data?.streams, mapRef]);

  // ---- zones ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    whenReady(() => {
      const feats = data.candidatesFc.features.map((f) => {
        const m = marks.get(f.properties.id);
        const score = m?.score ?? -1;
        return { f, props: { id: f.properties.id, type: f.properties.type, score, rank: m?.rank ?? 0, tier: m?.tier ?? 3 } };
      });
      (map.getSource('cands') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats.map(({ f, props }) => ({ ...f, properties: props })) } as FeatureCollection);
      (map.getSource('cand-pts') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats.map(({ f, props }) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: f.properties.center } })) } as FeatureCollection);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, data, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      const f: maplibregl.ExpressionSpecification | null = typeFilter === 'all' ? null : ['==', ['get', 'type'], typeFilter];
      const tier = (n: 1 | 2 | 3): maplibregl.ExpressionSpecification => (f ? ['all', ['==', ['get', 'tier'], n], f] : ['==', ['get', 'tier'], n]);
      for (const n of [1, 2, 3] as const) if (map.getLayer(`cand-dot-${n}`)) map.setFilter(`cand-dot-${n}`, tier(n));
      for (const id of ['cand-fill', 'cand-line']) if (map.getLayer(id)) map.setFilter(id, f);
      const ranked: maplibregl.ExpressionSpecification = ['>', ['get', 'rank'], 0];
      if (map.getLayer('cand-rank')) map.setFilter('cand-rank', f ? ['all', ranked, f] : ranked);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, data, mapRef]);

  // ---- red ✕ setup markers ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => (map.getSource('setups') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: setups.map((m) => ({ type: 'Feature', properties: { id: m.id, primary: m.primary, label: m.label }, geometry: { type: 'Point', coordinates: m.coord } })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setups, mapRef]);

  // ---- selection, scent cone, route ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      (map.getSource('selected') as GeoJSONSource | undefined)?.setData((selected ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: selected.geometry }] } : empty) as FeatureCollection);
      const dw = windHour?.downwind ?? selected?.windAssessment.scentDownwindDegrees;
      const origin = setups.find((m) => m.primary)?.coord ?? selected?.center;
      (map.getSource('cone') as GeoJSONSource | undefined)?.setData(selected && origin && dw != null ? { type: 'FeatureCollection', features: [scentCone(origin, dw)] } : empty);
      const r = selected?.route;
      let routeFc: FeatureCollection = empty;
      if (r) {
        const path = r.path?.length >= 2 ? r.path : [r.coord, selected!.center];
        if (r.routeKind === 'terrain' || r.routeKind === 'lidar') {
          const feats: Feature[] = [];
          let cur: number[][] = [path[0]], curLeg: string | null = null;
          for (let k = 1; k < path.length; k++) {
            const mid: [number, number] = [(path[k - 1][0] + path[k][0]) / 2, (path[k - 1][1] + path[k][1]) / 2];
            const leg = pathDistance(mid, 40) < 18 ? 'network' : 'offtrail';
            if (curLeg && leg !== curLeg) { feats.push({ type: 'Feature', properties: { leg: curLeg }, geometry: { type: 'LineString', coordinates: cur } }); cur = [path[k - 1]]; }
            curLeg = leg;
            cur.push(path[k]);
          }
          if (cur.length > 1) feats.push({ type: 'Feature', properties: { leg: curLeg ?? 'offtrail' }, geometry: { type: 'LineString', coordinates: cur } });
          routeFc = { type: 'FeatureCollection', features: feats };
        } else if (r.routeKind === 'network+offtrail' && r.offTrailMeters > 5 && path.length >= 3) {
          routeFc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { leg: 'network' }, geometry: { type: 'LineString', coordinates: path.slice(0, -1) } }, { type: 'Feature', properties: { leg: 'offtrail' }, geometry: { type: 'LineString', coordinates: path.slice(-2) } }] };
        } else routeFc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { leg: r.routeKind === 'straight' ? 'offtrail' : 'network' }, geometry: { type: 'LineString', coordinates: path } }] };
      }
      (map.getSource('route') as GeoJSONSource | undefined)?.setData(routeFc);
    });
  }, [selected, windHour, setups, mapRef]);

  // ---- me, start point, pins ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    whenReady(() => {
      const feats: Feature[] = [];
      if (userLoc) feats.push({ type: 'Feature', properties: { kind: 'gps' }, geometry: { type: 'Point', coordinates: userLoc } });
      if (startPin && (!userLoc || startPin[0] !== userLoc[0])) feats.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: startPin } });
      (map.getSource('me') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
      (map.getSource('pins') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', properties: { kind: p.kind, color: PIN_COLORS[p.kind] }, geometry: { type: 'Point', coordinates: p.coord } })) });
    });
  }, [userLoc, startPin, pins, mapRef]);

  return <div ref={el} className="map" aria-label="Interactive hunting map" />;
}
