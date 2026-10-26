// Loads precomputed geographic intelligence (static files on Firebase Hosting; cached offline by the service worker).
import type { FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon } from 'geojson';
import type { Candidate, CandidateProps } from './engine/types';
import type { Layers } from './engine/geography';

export interface SourceEntry {
  id: string;
  agency: string;
  title: string;
  url: string;
  coverage?: string;
  updated?: string | null;
  retrieved?: string | null;
  resolution?: string;
  usage?: string;
  quality: string;
  featureCount?: number;
  checksum?: string;
  error?: string;
}

export interface SourceRegistry {
  generated: string;
  terrain: { algorithmVersion: string; generated: string; parameters: Record<string, number>; counts: Record<string, unknown>; grid: { approxCellM: number[] } };
  sources: SourceEntry[];
}

export interface AppData extends Layers {
  candidates: Candidate[];
  candidatesFc: FeatureCollection<Polygon | MultiPolygon, CandidateProps>;
  accessPoints: FeatureCollection<Point>;
  checkStations: FeatureCollection<Point>;
  recSites: FeatureCollection<Point>;
  fsRoads: FeatureCollection<LineString | MultiLineString>;
  trails: FeatureCollection<LineString | MultiLineString>;
  streams: FeatureCollection<LineString>;
  contours: FeatureCollection<LineString>;
  fuelTreatments: FeatureCollection<Polygon | MultiPolygon>;
  osmRoads: FeatureCollection<LineString | MultiLineString>;
  zoneD: FeatureCollection<Polygon | MultiPolygon>;
  zoneDLines: FeatureCollection<LineString | MultiLineString>;
  counties: FeatureCollection<Polygon | MultiPolygon>;
  registry: SourceRegistry;
}

async function j<T>(file: string): Promise<T> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${file}`);
  if (!r.ok) throw new Error(`Failed to load ${file} (${r.status})`);
  return r.json() as Promise<T>;
}

export async function loadData(): Promise<AppData> {
  const [wma, nfAdmin, ownership, wilderness, highways, candidatesFc, accessPoints, checkStations, recSites, fsRoads, trails, streams, contours, registry, fuelTreatments, osmRoads, zoneD, zoneDLines, counties] = await Promise.all([
    j<Layers['wma']>('wma.geojson'),
    j<Layers['nfAdmin']>('nf-admin.geojson'),
    j<Layers['ownership']>('ownership.geojson'),
    j<Layers['wilderness']>('wilderness.geojson'),
    j<Layers['highways']>('highways.geojson'),
    j<AppData['candidatesFc']>('candidates.geojson'),
    j<AppData['accessPoints']>('access-points.geojson'),
    j<AppData['checkStations']>('check-stations.geojson'),
    j<AppData['recSites']>('rec-sites.geojson'),
    j<AppData['fsRoads']>('fs-roads.geojson'),
    j<AppData['trails']>('trails.geojson'),
    j<AppData['streams']>('streams.geojson'),
    j<AppData['contours']>('contours.geojson'),
    j<SourceRegistry>('sources.json'),
    j<AppData['fuelTreatments']>('fuel-treatments.geojson'),
    j<AppData['osmRoads']>('roads-osm.geojson'),
    j<AppData['zoneD']>('deer-zone-d.geojson'),
    j<AppData['zoneDLines']>('deer-zone-boundary.geojson'),
    j<AppData['counties']>('counties.geojson'),
  ]);
  const candidates: Candidate[] = candidatesFc.features.map((f) => ({ geometry: f.geometry, properties: f.properties }));
  return { wma, nfAdmin, ownership, wilderness, highways, candidates, candidatesFc, accessPoints, checkStations, recSites, fsRoads, trails, streams, contours, registry, fuelTreatments, osmRoads, zoneD, zoneDLines, counties };
}
