import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { AppData } from '../data';
import type { HuntRecommendation, UserPin } from '../engine/types';
import { BANKHEAD_CENTER } from '../engine/time';

// MapLibre v6 ships its worker as a separate ES module; bundle it so the static build can load it.
maplibregl.setWorkerUrl(workerUrl);

export type BaseMap = 'topo' | 'satellite' | 'hybrid' | 'hillshade';
export interface LayerToggles {
  boundaries: boolean;
  ownership: boolean;
  wilderness: boolean;
  roads: boolean;
  trails: boolean;
  streams: boolean;
  contours: boolean;
  slope: boolean;
  disturbance: boolean;
  candidates: boolean;
  access: boolean;
  pins: boolean;
}

const USGS = (svc: string) => `https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
const BASES: Record<BaseMap, string> = { topo: 'USGSTopo', satellite: 'USGSImageryOnly', hybrid: 'USGSImageryTopo', hillshade: 'USGSShadedReliefOnly' };
const SLOPE_BOUNDS: [[number, number], [number, number], [number, number], [number, number]] = [[-87.56, 34.47], [-87.2, 34.47], [-87.2, 34.2], [-87.56, 34.2]];

const PIN_COLORS: Record<string, string> = { stand: '#f5c542', sighting: '#ff8a3d', rub: '#c46b2b', scrape: '#a0522d', trail: '#d9b38c', bedding: '#9b6bd6', feeding: '#6cc070', camera: '#5ab4e6', parking: '#ffffff', harvest: '#ff4d4d', saved_candidate: '#f7f2a1' };

function styleFor(base: BaseMap): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      base: { type: 'raster', tiles: [USGS(BASES[base])], tileSize: 256, maxzoom: 16, attribution: 'USGS The National Map' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#1b231d' } },
      { id: 'base', type: 'raster', source: 'base', paint: base === 'hillshade' ? { 'raster-opacity': 0.9 } : {} },
    ],
  };
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

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

export type ZoneTypeFilter = 'all' | 'saddle' | 'bench' | 'spur' | 'bottom';
export interface SetupMarker { id: string; coord: [number, number]; primary: boolean; label: string }

/** Red ✕ with a white halo, drawn once into the map's sprite. */
function setupIcon(size = 40) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const pad = size * 0.2;
  g.lineCap = 'round';
  for (const [color, w] of [['#ffffff', size * 0.26], ['#d81e1e', size * 0.15]] as const) {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(pad, pad); g.lineTo(size - pad, size - pad);
    g.moveTo(size - pad, pad); g.lineTo(pad, size - pad);
    g.stroke();
  }
  return g.getImageData(0, 0, size, size);
}

interface Props {
  data: AppData | null;
  base: BaseMap;
  layers: LayerToggles;
  scores: Map<string, number | null>;
  selected: HuntRecommendation | null;
  windHour: { from: number | null; downwind: number | null } | null;
  userLoc: [number, number] | null;
  pins: UserPin[];
  setups: SetupMarker[];
  typeFilter: ZoneTypeFilter;
  startPin: [number, number] | null;
  onCandidate: (id: string) => void;
  onInspect: (lngLat: [number, number]) => void;
  mapRef: React.MutableRefObject<MLMap | null>;
}

export function MapView({ data, base, layers, scores, selected, windHour, userLoc, pins, setups, typeFilter, startPin, onCandidate, onInspect, mapRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const ready = useRef(false);
  const pending = useRef<Array<() => void>>([]);
  const whenReady = (fn: () => void) => (ready.current ? fn() : pending.current.push(fn));
  const cbs = useRef({ onCandidate, onInspect });
  cbs.current = { onCandidate, onInspect };

  // init
  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({ container: el.current, style: styleFor(base), center: BANKHEAD_CENTER, zoom: 10.6, maxZoom: 18, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    mapRef.current = map;
    map.on('click', (e: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: map.getLayer('cand-fill') ? ['cand-fill'] : [] });
      if (hits.length) cbs.current.onCandidate(String(hits[0].properties.id));
      else cbs.current.onInspect([e.lngLat.lng, e.lngLat.lat]);
    });
    map.on('mouseenter', 'cand-fill', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'cand-fill', () => (map.getCanvas().style.cursor = ''));
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // base map switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('base') as maplibregl.RasterTileSource | undefined;
    if (src && 'setTiles' in src) src.setTiles([USGS(BASES[base])]);
  }, [base, mapRef]);

  // overlays (once data arrives)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const add = () => {
      if (map.getSource('wma')) return;
      map.addSource('slope', { type: 'image', url: `${import.meta.env.BASE_URL}data/slope.png`, coordinates: SLOPE_BOUNDS });
      map.addLayer({ id: 'slope', type: 'raster', source: 'slope', paint: { 'raster-opacity': 0.75, 'raster-resampling': 'nearest' }, layout: { visibility: 'none' } });
      map.addSource('disturbance', { type: 'image', url: `${import.meta.env.BASE_URL}data/disturbance.png`, coordinates: SLOPE_BOUNDS });
      map.addLayer({ id: 'disturbance', type: 'raster', source: 'disturbance', paint: { 'raster-opacity': 0.7, 'raster-resampling': 'nearest' }, layout: { visibility: 'none' } });
      map.addSource('fuel', { type: 'geojson', data: data.fuelTreatments });
      map.addLayer({ id: 'fuel-line', type: 'line', source: 'fuel', paint: { 'line-color': '#ff8a3d', 'line-width': 1.5, 'line-dasharray': [2, 2] }, layout: { visibility: 'none' } });
      map.addSource('contours', { type: 'geojson', data: data.contours });
      map.addLayer({ id: 'contours', type: 'line', source: 'contours', paint: { 'line-color': '#c9a46a', 'line-width': ['case', ['get', 'index'], 1.2, 0.5], 'line-opacity': 0.75 }, minzoom: 11 });
      map.addLayer({ id: 'contour-labels', type: 'symbol', source: 'contours', minzoom: 13.5, filter: ['get', 'index'], layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'elevFt']], ' ft'], 'text-size': 10, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#e8d3a8', 'text-halo-color': '#1b231d', 'text-halo-width': 1.2 } });
      map.addSource('streams', { type: 'geojson', data: data.streams });
      map.addLayer({ id: 'streams', type: 'line', source: 'streams', paint: { 'line-color': '#5fb2e8', 'line-width': ['interpolate', ['linear'], ['get', 'km2'], 0.3, 0.6, 10, 2.2], 'line-opacity': 0.8 } });
      map.addSource('ownership', { type: 'geojson', data: { ...data.ownership, features: data.ownership.features.filter((f) => (f.properties as { ownerclassification?: string }).ownerclassification !== 'USDA FOREST SERVICE') } });
      map.addLayer({ id: 'nonfs', type: 'fill', source: 'ownership', paint: { 'fill-color': '#d64545', 'fill-opacity': 0.22 } });
      map.addSource('wilderness', { type: 'geojson', data: data.wilderness });
      map.addLayer({ id: 'wilderness', type: 'fill', source: 'wilderness', paint: { 'fill-color': '#7fbf6a', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'wilderness-line', type: 'line', source: 'wilderness', paint: { 'line-color': '#9fd98a', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      map.addSource('nf', { type: 'geojson', data: data.nfAdmin });
      map.addLayer({ id: 'nf-line', type: 'line', source: 'nf', paint: { 'line-color': '#e0e0c8', 'line-width': 1, 'line-dasharray': [1, 2], 'line-opacity': 0.6 } });
      map.addSource('wma', { type: 'geojson', data: data.wma });
      map.addLayer({ id: 'wma-line', type: 'line', source: 'wma', paint: { 'line-color': '#f2b84b', 'line-width': 2.4 } });
      map.addSource('highways', { type: 'geojson', data: data.highways });
      map.addLayer({ id: 'zone-divider', type: 'line', source: 'highways', filter: ['==', ['get', 'ref'], 'AL 33'], paint: { 'line-color': '#ffd84d', 'line-width': 2, 'line-dasharray': [4, 2] } });
      map.addSource('fsroads', { type: 'geojson', data: data.fsRoads });
      map.addLayer({ id: 'fsroads', type: 'line', source: 'fsroads', paint: { 'line-color': ['match', ['slice', ['get', 'oper_maint_level'], 0, 1], '1', '#888', '2', '#d9a066', '#f0e6d2'], 'line-width': 1.6 } });
      map.addSource('trails', { type: 'geojson', data: data.trails });
      map.addLayer({ id: 'trails', type: 'line', source: 'trails', paint: { 'line-color': '#e36b5b', 'line-width': 1.4, 'line-dasharray': [2, 1.5] } });
      map.addSource('cands', { type: 'geojson', data: empty, promoteId: 'id' });
      map.addLayer({ id: 'cand-fill', type: 'fill', source: 'cands', paint: { 'fill-color': ['case', ['==', ['get', 'score'], -1], '#7a7a7a', ['interpolate', ['linear'], ['get', 'score'], 35, '#b0413e', 55, '#e0a43a', 75, '#5fbf5a']], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 14, 0.45] } });
      map.addLayer({ id: 'cand-line', type: 'line', source: 'cands', paint: { 'line-color': '#101510', 'line-width': 0.8 } });
      map.addSource('selected', { type: 'geojson', data: empty });
      if (!map.hasImage('setup-x')) map.addImage('setup-x', setupIcon(48), { pixelRatio: 2 });
      map.addLayer({ id: 'selected-fill', type: 'fill', source: 'selected', paint: { 'fill-color': '#ffe9a8', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'selected-casing', type: 'line', source: 'selected', paint: { 'line-color': '#101510', 'line-width': 7, 'line-opacity': 0.85 } });
      map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': '#ffe9a8', 'line-width': 3.5 } });
      map.addSource('cone', { type: 'geojson', data: empty });
      map.addLayer({ id: 'cone', type: 'fill', source: 'cone', paint: { 'fill-color': '#ff9f43', 'fill-opacity': 0.28 } });
      map.addLayer({ id: 'cone-line', type: 'line', source: 'cone', paint: { 'line-color': '#ff9f43', 'line-width': 1, 'line-dasharray': [2, 2] } });
      map.addSource('route', { type: 'geojson', data: empty });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0b1a26', 'line-width': 6, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ['match', ['get', 'leg'], 'offtrail', '#ffd27a', '#7ad0ff'], 'line-width': 3, 'line-dasharray': ['match', ['get', 'leg'], 'offtrail', ['literal', [1, 1.5]], ['literal', [1, 0]]] } });
      map.addSource('access', { type: 'geojson', data: { type: 'FeatureCollection', features: [...data.accessPoints.features] } });
      map.addLayer({ id: 'access', type: 'circle', source: 'access', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'checking station', '#ff5c5c', '#3fa7ff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'access-label', type: 'symbol', source: 'access', minzoom: 11, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.2 } });
      map.addSource('setups', { type: 'geojson', data: empty });
      map.addLayer({ id: 'setups', type: 'symbol', source: 'setups', layout: { 'icon-image': 'setup-x', 'icon-size': ['case', ['get', 'primary'], 1.25, 0.85], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['case', ['get', 'primary'], 1, 0] } });
      map.addLayer({ id: 'setup-label', type: 'symbol', source: 'setups', minzoom: 13, filter: ['get', 'primary'], layout: { 'text-field': 'Set up here', 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#b01010', 'text-halo-width': 1.5 } });
      map.addSource('pins', { type: 'geojson', data: empty });
      map.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'color'], '#fff'], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });
      map.addSource('me', { type: 'geojson', data: empty });
      map.addLayer({ id: 'me-halo', type: 'circle', source: 'me', paint: { 'circle-radius': 14, 'circle-color': '#4da3ff', 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'me', type: 'circle', source: 'me', paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'kind'], 'start', '#ffffff', '#4da3ff'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      ready.current = true;
      pending.current.splice(0).forEach((fn) => fn());
    };
    if (map.isStyleLoaded()) add();
    else map.once('load', add);
  }, [data, mapRef]);

  // visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
      vis(['wma-line', 'nf-line', 'zone-divider'], layers.boundaries);
      vis(['nonfs'], layers.ownership);
      vis(['wilderness', 'wilderness-line'], layers.wilderness);
      vis(['fsroads'], layers.roads);
      vis(['trails'], layers.trails);
      vis(['streams'], layers.streams);
      vis(['contours', 'contour-labels'], layers.contours);
      vis(['slope'], layers.slope);
      vis(['disturbance', 'fuel-line'], layers.disturbance);
      vis(['cand-fill', 'cand-line', 'setups', 'setup-label'], layers.candidates);
      vis(['access', 'access-label'], layers.access);
      vis(['pins'], layers.pins);
    };
    whenReady(apply);
  }, [layers, data, mapRef]);

  // candidate scores
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const apply = () => {
      const fc = { type: 'FeatureCollection', features: data.candidatesFc.features.map((f) => ({ ...f, properties: { id: f.properties.id, type: f.properties.type, score: scores.has(f.properties.id) ? scores.get(f.properties.id) ?? -1 : -1 } })) };
      (map.getSource('cands') as GeoJSONSource | undefined)?.setData(fc as FeatureCollection);
    };
    whenReady(apply);
  }, [scores, data, mapRef]);

  // red ✕ setup markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => (map.getSource('setups') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: setups.map((m) => ({ type: 'Feature', properties: { id: m.id, primary: m.primary, label: m.label }, geometry: { type: 'Point', coordinates: m.coord } })) });
    whenReady(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setups, mapRef]);

  // zone-type filter (Saddles / Benches / …)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const f = typeFilter === 'all' ? null : (['==', ['get', 'type'], typeFilter] as maplibregl.FilterSpecification);
      for (const id of ['cand-fill', 'cand-line']) if (map.getLayer(id)) map.setFilter(id, f);
    };
    whenReady(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, data, mapRef]);

  // selection, cone, route
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const sel = selected ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: selected.geometry }] } : empty;
      (map.getSource('selected') as GeoJSONSource | undefined)?.setData(sel as FeatureCollection);
      const dw = windHour?.downwind ?? selected?.windAssessment.scentDownwindDegrees;
      // the cone is the hunter's scent, so it starts at the suggested setup (red ✕) when there is one
      const origin = setups.find((m) => m.primary)?.coord ?? selected?.center;
      (map.getSource('cone') as GeoJSONSource | undefined)?.setData(selected && origin && dw != null ? { type: 'FeatureCollection', features: [scentCone(origin, dw)] } : empty);
      const r = selected?.route;
      let routeFc: FeatureCollection = empty;
      if (r) {
        const path = r.path?.length >= 2 ? r.path : [r.coord, selected!.center];
        if (r.routeKind === 'network+offtrail' && r.offTrailMeters > 5 && path.length >= 3) {
          routeFc = { type: 'FeatureCollection', features: [
            { type: 'Feature', properties: { leg: 'network' }, geometry: { type: 'LineString', coordinates: path.slice(0, -1) } },
            { type: 'Feature', properties: { leg: 'offtrail' }, geometry: { type: 'LineString', coordinates: path.slice(-2) } },
          ] };
        } else routeFc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { leg: r.routeKind === 'straight' ? 'offtrail' : 'network' }, geometry: { type: 'LineString', coordinates: path } }] };
      }
      (map.getSource('route') as GeoJSONSource | undefined)?.setData(routeFc);
    };
    whenReady(apply);
  }, [selected, windHour, setups, mapRef]);

  // user location + start pin + pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const feats: Feature[] = [];
      if (userLoc) feats.push({ type: 'Feature', properties: { kind: 'gps' }, geometry: { type: 'Point', coordinates: userLoc } });
      if (startPin && (!userLoc || startPin[0] !== userLoc[0])) feats.push({ type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: startPin } });
      (map.getSource('me') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
      (map.getSource('pins') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pins.map((p) => ({ type: 'Feature', properties: { kind: p.kind, color: PIN_COLORS[p.kind] }, geometry: { type: 'Point', coordinates: p.coord } })) });
    };
    whenReady(apply);
  }, [userLoc, startPin, pins, mapRef]);

  return <div ref={el} className="map" aria-label="Interactive intelligence map" />;
}
