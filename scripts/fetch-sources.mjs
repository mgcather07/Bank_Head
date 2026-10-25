// Downloads authoritative boundary / access layers for the Bankhead study area,
// clips them to the study bbox, and writes production GeoJSON plus a source registry.
// Usage: node scripts/fetch-sources.mjs
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import * as turf from '@turf/turf';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'research', 'raw');
const OUT = path.join(ROOT, 'public', 'data');
export const BBOX = [-87.56, 34.2, -87.2, 34.47];

const FS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW';
const ADCNR = 'https://conservationgis.alabama.gov/adcnrweb/rest/services/WildlifeManagementAreas/MapServer/0';

const LAYERS = [
  {
    id: 'adcnr-wma-boundary',
    agency: 'Alabama DCNR – Wildlife & Freshwater Fisheries',
    title: 'Wildlife Management Areas (Black Warrior WMA, MapYear 2026-27)',
    url: ADCNR,
    where: "Name = 'Black Warrior Wildlife Management Area'",
    fields: 'Name,MapYear,Acres,Link',
    file: 'wma.geojson',
    resolution: 'Vector; agency-drawn hunting boundary (not a survey). Interior holes = excluded parcels.',
    usage: 'Public agency data. ADCNR states boundaries are not a survey.',
  },
  {
    id: 'usfs-nfs-landunit',
    agency: 'USDA Forest Service',
    title: 'National Forest System Land Units (administrative boundary)',
    url: `${FS}/EDW_NFSLandUnit_01/MapServer/0`,
    where: "NFSLANDUNITNAME LIKE '%Bankhead%' OR NFSLANDUNITNAME LIKE '%William B. Bankhead%'",
    fields: '*',
    file: 'nf-admin.geojson',
    resolution: 'Vector; proclaimed/administrative boundary. Does NOT imply federal ownership of every parcel.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-basic-ownership',
    agency: 'USDA Forest Service',
    title: 'Basic Ownership (surface ownership dissolved by class)',
    url: `${FS}/EDW_BasicOwnership_01/MapServer/0`,
    where: '1=1',
    fields: '*',
    file: 'ownership.geojson',
    resolution: 'Vector; FS lands status records.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-wilderness',
    agency: 'USDA Forest Service',
    title: 'National Wilderness Areas (Sipsey Wilderness)',
    url: `${FS}/EDW_Wilderness_01/MapServer/0`,
    where: "WILDERNESSNAME LIKE '%Sipsey%'",
    fields: '*',
    file: 'wilderness.geojson',
    resolution: 'Vector; congressionally designated wilderness.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-mvum-roads',
    agency: 'USDA Forest Service',
    title: 'Motor Vehicle Use Map: Roads',
    url: `${FS}/EDW_MVUM_02/MapServer/1`,
    where: '1=1',
    fields: '*',
    file: 'mvum-roads.geojson',
    resolution: 'Vector; official MVUM designations. Does not show real-time gate/closure status.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-trails',
    agency: 'USDA Forest Service',
    title: 'National Forest System Trails',
    url: `${FS}/EDW_TrailNFSPublish_01/MapServer/0`,
    where: '1=1',
    fields: '*',
    file: 'trails.geojson',
    resolution: 'Vector; NFS trail centerlines.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-rec-sites',
    agency: 'USDA Forest Service',
    title: 'Recreation Sites (INFRA) – trailheads, campgrounds, parking',
    url: `${FS}/EDW_InfraRecreationSites_01/MapServer/0`,
    where: '1=1',
    fields: '*',
    file: 'rec-sites.geojson',
    resolution: 'Point; FS constructed recreation sites.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'adcnr-check-stations',
    agency: 'Alabama DCNR – Wildlife & Freshwater Fisheries',
    title: 'WMA Checking Stations',
    url: 'https://conservationgis.alabama.gov/adcnrweb/rest/services/CheckingStations/MapServer/0',
    where: '1=1',
    fields: '*',
    file: 'check-stations.geojson',
    resolution: 'Point',
    usage: 'Public agency data.',
  },
  {
    id: 'usfs-fuel-treatments',
    agency: 'USDA Forest Service (FACTS)',
    title: 'Hazardous Fuels Treatments – polygons (prescribed burns)',
    url: `${FS}/EDW_HazardousFuelsTreatments_01/MapServer/15`,
    where: '1=1',
    fields: 'activity,treatment_type,treatment_name,activity_unit_name,fiscal_year_completed,fy_planned_or_accomplished,stage_value,gis_acres',
    file: 'fuel-treatments.geojson',
    resolution: 'Vector; FACTS activity polygons. Only 5 features in this bbox (FY2007) — Bankhead burn history is not fully published here.',
    usage: 'Public domain (USFS EDW).',
  },
  {
    id: 'usfs-road-basic',
    agency: 'USDA Forest Service',
    title: 'National Forest System Roads (road inventory – NOT an MVUM designation)',
    url: `${FS}/EDW_RoadBasic_01/MapServer/0`,
    where: '1=1',
    fields: 'id,name,oper_maint_level,surface_type,openforuseto,jurisdiction,route_status,symbol_name',
    file: 'fs-roads.geojson',
    resolution: 'Vector; FS INFRA road inventory. MVUM layer has no Bankhead coverage in EDW (checked). Gate/seasonal status not included.',
    usage: 'Public domain (USFS EDW).',
  },
];

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function queryLayer(layer) {
  const meta = await fetchJson(`${layer.url}?f=json`);
  const features = [];
  let offset = 0;
  for (;;) {
    const p = new URLSearchParams({
      where: layer.where,
      outFields: layer.fields,
      geometry: BBOX.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: '1000',
      f: 'geojson',
    });
    const page = await fetchJson(`${layer.url}/query?${p}`);
    if (page.error) throw new Error(`${layer.id}: ${JSON.stringify(page.error)}`);
    features.push(...(page.features ?? []));
    if (!page.exceededTransferLimit && !(page.properties?.exceededTransferLimit)) break;
    offset += page.features.length;
    if (!page.features.length) break;
  }
  return { meta, fc: { type: 'FeatureCollection', features } };
}

function clip(fc) {
  const box = turf.bboxPolygon(BBOX);
  const out = [];
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const t = f.geometry.type;
    try {
      if (t === 'Polygon' || t === 'MultiPolygon') {
        const c = turf.intersect(turf.featureCollection([f, box]));
        if (c) out.push({ ...c, properties: f.properties });
      } else if (t === 'LineString' || t === 'MultiLineString') {
        const c = turf.bboxClip(f, BBOX);
        if (c.geometry.coordinates.length) out.push({ ...c, properties: f.properties });
      } else if (t === 'Point') {
        if (turf.booleanPointInPolygon(f, box)) out.push(f);
      }
    } catch {
      out.push(f);
    }
  }
  return turf.truncate(turf.featureCollection(out), { precision: 6, mutate: true });
}

await fs.mkdir(RAW, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
const registry = [];
for (const layer of LAYERS) {
  process.stdout.write(`Fetching ${layer.id}… `);
  try {
    const { meta, fc } = await queryLayer(layer);
    await fs.writeFile(path.join(RAW, layer.file), JSON.stringify(fc));
    const clipped = clip(fc);
    const body = JSON.stringify(clipped);
    await fs.writeFile(path.join(OUT, layer.file), body);
    registry.push({
      id: layer.id,
      agency: layer.agency,
      title: layer.title,
      url: layer.url,
      query: layer.where,
      coverage: `bbox ${BBOX.join(',')}`,
      updated: meta?.editingInfo?.lastEditDate ? new Date(meta.editingInfo.lastEditDate).toISOString() : null,
      retrieved: new Date().toISOString(),
      resolution: layer.resolution,
      usage: layer.usage,
      quality: clipped.features.length ? 'retrieved' : 'empty',
      featureCount: clipped.features.length,
      checksum: crypto.createHash('sha256').update(body).digest('hex').slice(0, 16),
      file: `data/${layer.file}`,
    });
    console.log(`${clipped.features.length} features`);
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    registry.push({ id: layer.id, agency: layer.agency, title: layer.title, url: layer.url, retrieved: new Date().toISOString(), quality: 'failed', error: e.message });
  }
}
await fs.writeFile(path.join(RAW, 'registry-boundaries.json'), JSON.stringify(registry, null, 2));
console.log('done');
