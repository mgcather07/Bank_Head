# Bankhead Hunt Intelligence

Mobile-first PWA that ranks scouting/hunting zones for whitetail deer on **Black Warrior WMA**, the surrounding **National Forest**, and **your own private land**, using terrain, habitat, wind/scent, access, time-of-day/rut context, weather and **verified 2026-27 regulations**, and explains every ranking. Sign in with Google and your journal, pins, settings and private land follow you across devices.

Live: **https://bankhead.web.app** (Firebase Hosting, project `rehtac-labs`, site `bankhead`)

## Architecture

The site is static hosting plus Firebase Authentication (Google sign-in) and the Realtime Database for each person's own data. It has no Cloud Functions and no server of its own.

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
| Accounts | Firebase Authentication (Google) | Optional. Everything public works as a guest. |
| Journal, pins, settings, private land | Realtime Database `users/{uid}` (instance `bankhead-hunt`) | Local-first: changes show instantly, queue offline, sync when there is signal. Rules let only the owner read or write. See [docs/ACCOUNTS.md](docs/ACCOUNTS.md). |
| Private land | `scripts/build-club.mjs` (public terrain and roads for one small area) + browser (`src/engine/club.ts`) | The boundary is stored in the owner's account, delivered with `scripts/provision-land.mjs`. Zones, scoring and plans are computed in the browser. |

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
npm test             # 125 unit tests (engine, sync store, workspaces) (LIDAR_TEST=1 also runs a live USGS lidar routing check) (jurisdiction, regulations, wind, time/DST, data failures, scoring)
npm run data         # re-download sources + rebuild terrain candidates + registry
npm run data:club    # rebuild the public terrain/roads data for the private-land area
npm run test:rules   # security rules against the database emulator (needs JDK 21+)
npm run deploy:rules # publish database.rules.json
node scripts/provision-land.mjs --email you@gmail.com --file boundary.geojson --name "My Club" --id my-club   # deliver private land to an account
npm run deploy       # build + firebase deploy --only hosting:bankhead --project rehtac-labs
```

## Documentation
- [docs/DATA_INVENTORY.md](docs/DATA_INVENTORY.md): which layers were actually obtained, and the known gaps
- [docs/ACCOUNTS.md](docs/ACCOUNTS.md): sign-in, data model, security rules, offline sync, delivering private land
- [docs/MODEL.md](docs/MODEL.md): scoring model, gates, confidence and limits
