// Layer presets: the map opens clean, and a single tap turns on more.
import type { LayerToggles } from '../../map/MapView';

const OFF: LayerToggles = { boundaries: false, ownership: false, wilderness: false, roads: false, trails: false, streams: false, contours: false, slope: false, disturbance: false, lidar: false, candidates: false, access: false, pins: false };
export type Preset = 'clean' | 'scouting' | 'terrain' | 'habitat';

export const PRESETS: Record<Preset, { label: string; blurb: string; layers: LayerToggles }> = {
  clean: { label: 'Clean', blurb: 'Zones and your boundary', layers: { ...OFF, boundaries: true, candidates: true, pins: true } },
  scouting: { label: 'Scouting', blurb: 'Plus roads, trails, streams, access', layers: { ...OFF, boundaries: true, candidates: true, pins: true, roads: true, trails: true, streams: true, access: true } },
  terrain: { label: 'Terrain', blurb: 'Plus contours, slope, lidar relief', layers: { ...OFF, boundaries: true, candidates: true, pins: true, contours: true, slope: true, lidar: true } },
  habitat: { label: 'Habitat', blurb: 'Plus burns, cuts, private parcels', layers: { ...OFF, boundaries: true, candidates: true, pins: true, disturbance: true, wilderness: true, ownership: true } },
};
export const DEFAULT_LAYERS: LayerToggles = PRESETS.clean.layers;

export function presetOf(l: LayerToggles): Preset | 'custom' {
  for (const [k, p] of Object.entries(PRESETS)) if ((Object.keys(p.layers) as (keyof LayerToggles)[]).every((key) => p.layers[key] === l[key])) return k as Preset;
  return 'custom';
}

export const LAYER_GROUPS: Array<{ title: string; items: Array<[keyof LayerToggles, string]> }> = [
  { title: 'Hunting', items: [['candidates', 'Hunting zones'], ['pins', 'My pins'], ['boundaries', 'Boundaries']] },
  { title: 'Access', items: [['roads', 'Roads'], ['trails', 'Trails'], ['access', 'Access points']] },
  { title: 'Terrain', items: [['contours', 'Contours'], ['streams', 'Streams'], ['slope', 'Slope shading'], ['lidar', 'Lidar relief (zoom in)']] },
  { title: 'Habitat and land', items: [['disturbance', 'Burns and clear cuts'], ['wilderness', 'Wilderness'], ['ownership', 'Private parcels']] },
];
