// Merges per-script source registries into public/data/sources.json (the app's Sources view).
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const read = async (f) => JSON.parse(await fs.readFile(f, 'utf8'));
const boundaries = await read(path.join(RAW, 'registry-boundaries.json'));
const osm = [...(await read(path.join(RAW, 'registry-osm.json'))), ...(await read(path.join(RAW, 'registry-osm-roads.json')))];
const meta = await read(path.join(ROOT, 'public/data/terrain-meta.json'));
const pdfStat = await fs.stat(path.join(RAW, '2026_27_Black_Warrior_WMA_permit.pdf'));

const manual = [
  { id: 'adcnr-bw-wma-2026-27', agency: 'Alabama DCNR – WFF', title: '2026-27 Black Warrior WMA map & AREA permit (season dates, bag limits, Zone A/B map, rules)', url: 'https://www.outdooralabama.com/sites/default/files/PDF%20documents/WMA%20Mamps/2026-2027/2026_27_D1%20Black%20Warrior%20WMA%20ADA.pdf', coverage: 'Black Warrior WMA, Sept 2026 – Aug 2027', updated: '2026-27 edition', retrieved: pdfStat.mtime.toISOString(), resolution: 'Document; transcribed into src/engine/regulations.ts', usage: 'Official regulation document', quality: 'verified (manual transcription)' },
  { id: 'al-admin-code-220-2-56', agency: 'Alabama Legislature', title: 'Alabama Administrative Code 220-2-.56 (WMA seasons)', url: 'https://admincode.legislature.state.al.us/administrative-code/220-2-.56', coverage: 'Statewide WMAs', updated: null, retrieved: null, resolution: 'Document', usage: 'Governing rule – linked, not machine-parsed', quality: 'reference link' },
  { id: 'adcnr-wma-rules', agency: 'Alabama DCNR', title: 'WMA Regulation 220-2-.55 (complete WMA rules)', url: 'https://www.outdooralabama.com/WMARules', coverage: 'Statewide WMAs', updated: null, retrieved: null, resolution: 'Document', usage: 'Governing rule – linked, not machine-parsed', quality: 'reference link' },
  { id: 'open-meteo', agency: 'Open-Meteo.com', title: 'Open-Meteo Forecast API (hourly/daily; NOAA GFS/HRRR blend for CONUS)', url: 'https://open-meteo.com/en/docs', coverage: 'Point forecast, 8 days + 1 past day', updated: 'live (hourly model runs)', retrieved: 'at runtime — age shown in app', resolution: '~3–13 km model grid', usage: 'CC BY 4.0, free non-commercial tier', quality: 'live' },
  { id: 'nws-alerts', agency: 'NOAA National Weather Service', title: 'NWS active alerts API', url: 'https://api.weather.gov/alerts/active', coverage: 'Point lookup', updated: 'live', retrieved: 'at runtime', resolution: 'Zone/county polygons', usage: 'Public domain', quality: 'live' },
  { id: 'usgs-basemaps', agency: 'USGS The National Map', title: 'USGS Topo, Imagery, Imagery+Topo, Shaded Relief tile services', url: 'https://basemap.nationalmap.gov/arcgis/rest/services', coverage: 'CONUS', updated: null, retrieved: 'at runtime', resolution: 'Tiled basemaps', usage: 'Public domain', quality: 'live' },
  { id: 'landfire-evt-csv', agency: 'LANDFIRE', title: 'LF2024 EVT attribute table (code → vegetation type)', url: 'https://landfire.gov/sites/default/files/CSV/2024/LF2024_EVT.csv', coverage: 'CONUS', updated: '2024', retrieved: null, resolution: 'Table', usage: 'Public domain', quality: 'retrieved' },
  { id: 'adcnr-rut-map', agency: 'Alabama DCNR – WFF', title: 'Alabama Deer Rut Map (methodology); NW Alabama (Lawrence/Winston) ruts earlier than most of state', url: 'https://www.outdooralabama.com/node/3171', coverage: 'Statewide', updated: null, retrieved: null, resolution: 'Regional', usage: 'Reference', quality: 'county-level dates not machine-readable — phase dates use secondary source (low confidence)' },
  { id: 'al-living-bw-rut', agency: 'Alabama Living (secondary)', title: 'Black Warrior WMA article: rut mid-Nov, peak ~Thanksgiving, into early Dec', url: 'https://alabamaliving.coop/?p=10532', coverage: 'Black Warrior WMA', updated: null, retrieved: null, resolution: 'Narrative', usage: 'Secondary source', quality: 'unverified secondary' },
];
const all = [...boundaries, ...osm, ...meta.sources.map((s) => ({ ...s, updated: s.updated ?? null })), ...manual];
await fs.writeFile(path.join(ROOT, 'public/data/sources.json'), JSON.stringify({ generated: new Date().toISOString(), terrain: { algorithmVersion: meta.algorithmVersion, generated: meta.generated, parameters: meta.parameters, counts: meta.counts, grid: meta.grid }, sources: all }, null, 2));
console.log(all.length, 'sources');
