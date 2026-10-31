# Bankhead Hunt Intelligence

Mobile-first PWA that ranks scouting/hunting zones across **Bankhead National Forest, Alabama**, on both the Black Warrior WMA and National Forest land outside it, for whitetail deer using terrain, habitat, wind/scent, access, time-of-day/rut context, weather, and **verified 2026-27 regulations**, and explains every ranking.

Live: **https://bankhead.web.app** (Firebase Hosting, project `rehtac-labs`, site `bankhead`)

## Architecture

The site is entirely static. It has no Cloud Functions and no backend.

| Layer | Where it runs | Notes |
|---|---|---|
| Boundary / access ingest | `scripts/fetch-sources.mjs`, `scripts/fetch-osm-highways.mjs` (local, on demand) | ADCNR + USFS ArcGIS REST, OSM Overpass |
| Terrain + habitat analysis, candidate generation | `scripts/build-terrain.mjs` (local, about 2.5 min) | USGS 3DEP DEM + LANDFIRE EVT → `public/data/candidates.geojson` |
| Source registry | `scripts/build-registry.mjs` | → `public/data/sources.json` |
| Walking routes + elevation profiles | `scripts/build-routes.mjs` + `src/engine/pathfind.ts` | Least-effort terrain routes on 10 m 3DEP (cliffs, private land, water avoided); refined in the browser on ~4 m lidar (`src/engine/lidar.ts`) |
| Offline map packs | Browser → USGS tiles into the service-worker cache | Up to 2,500 tiles per save (z11–15) |
| Backup | Browser → .json / .gpx download and import | |
| Compass | Browser DeviceOrientation | iOS asks for permission |
| Check this spot | Browser (`src/engine/spot.ts`) + `public/data/terrain-grid.bin.gz` | Any tapped point scored with the build's terrain logic on a half-res (~52 m) grid; walk-in routed over FS roads/trails in the browser |
| Hunt this spot plan | Browser (`src/engine/plan.ts`) | Verdict, timing/leave-by, huntable winds, setup, approach, legal, what to confirm, best upcoming sessions |
| Climate normals / past weather | Browser → **Open-Meteo archive** API | |
| Weather | Browser → **Open-Meteo** API | No key needed. Cached in localStorage. Data age is always shown and stale data is labelled. Refreshes every 30 min and on demand. |
| Severe alerts | Browser → NWS `api.weather.gov/alerts` | |
| Scoring, legal gates, recommendations | Browser (`src/engine/*`) | Deterministic and versioned |
| Pins and journal | Browser localStorage | Private to the device. Nothing is uploaded. |
| My club (private land) | `scripts/build-club.mjs` (public terrain and roads for one small area) + browser (`src/engine/club.ts`) | The boundary is imported by the owner and stored only on the device and in their backup file. Zones, scoring and plans are computed in the browser. |

Engine modules (`src/engine`):
- `geography.ts`: GeographyService / LandOwnershipService
- `regulations.ts`: RegulationsEngine
- `weather.ts`: WeatherService
- `wind.ts`: WindAndScentEngine and thermals
- `rut.ts`: RutModel
- `scoring.ts`: HuntScoringEngine, RecommendationService, ConfidenceEvaluator
- `time.ts`: sun, moon and America/Chicago time, including DST

## Commands

```bash
npm install
npm run dev          # local dev server
npm test             # 102 engine tests (LIDAR_TEST=1 also runs a live USGS lidar routing check) (jurisdiction, regulations, wind, time/DST, data failures, scoring)
npm run data         # re-download sources + rebuild terrain candidates + registry
npm run data:club    # rebuild the public terrain/roads data for the private-club area
npm run deploy       # build + firebase deploy --only hosting:bankhead --project rehtac-labs
```

## Documentation
- [docs/DATA_INVENTORY.md](docs/DATA_INVENTORY.md): which layers were actually obtained, and the known gaps
- [docs/MODEL.md](docs/MODEL.md): scoring model, gates, confidence and limits
