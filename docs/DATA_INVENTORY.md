# Verified Data Inventory (audited 2026-10-24; study area expanded to all of Bankhead National Forest 2026-10-25)

Study area: −87.66…−87.08, 33.96…34.50 (`scripts/config.mjs`), covering the whole William B. Bankhead National Forest. Zones are generated on Black Warrior WMA land and on Forest Service-owned land inside the National Forest boundary.

## Obtained and in production

| Layer | Source | Status |
|---|---|---|
| Black Warrior WMA boundary (MapYear 2026-27, 90,268 ac) | ADCNR `WildlifeManagementAreas/MapServer/0` | Retrieved. The multipolygon has 30 interior holes, which are excluded parcels. ADCNR states it is not a survey. |
| 2026-27 season dates, bag limits, Zone B antler rule, check-station days, WMA rules | Official AREA permit PDF | Transcribed into `src/engine/regulations.ts` and covered by tests |
| Bankhead NF administrative boundary | USFS `EDW_NFSLandUnit_01` | Retrieved. This is an administrative boundary and is **not** used as proof of ownership. |
| Surface ownership (FS vs non-FS) | USFS `EDW_BasicOwnership_01` | Retrieved. Used as the land-ownership gate. |
| Sipsey Wilderness | USFS `EDW_Wilderness_01` | Retrieved |
| NFS roads (inventory, maintenance level, open-to) | USFS `EDW_RoadBasic_01` | Retrieved. This is **not** an MVUM designation. |
| NFS trails | USFS `EDW_TrailNFSPublish_01` | Retrieved |
| Recreation sites (trailhead, hunt camp, etc.) | USFS `EDW_InfraRecreationSites_01` | Retrieved |
| WMA checking station | ADCNR `CheckingStations/MapServer/0` | Retrieved |
| AL 33 centerline (Zone A/B divider) | OpenStreetMap via Overpass | Retrieved (ODbL) |
| Deer Zone C/D line | Derived from the OutdoorAlabama 2026-27 Zone D boundary description + OSM roads/Sipsey Fork + ADCNR counties (`scripts/build-deer-zones.mjs`) | Derived and validated against reference towns. Points within 400 m of the line are treated as zone-uncertain. |
| Statewide 2026-27 deer seasons (public land, Zones C and D) | OutdoorAlabama.com deer-season page | Transcribed into `src/engine/regulations.ts`. The page's zone map image is labelled "Proposed". |
| All motor roads and tracks | OpenStreetMap via Overpass (`scripts/fetch-osm-roads.mjs`) | Retrieved (ODbL). Used only to keep zones and setup points off roads, not for routing or parking. |
| DEM, 1 arc-second (about 26×31 m) | USGS 3DEP ImageServer `exportImage` | Retrieved |
| Existing Vegetation Type, 30 m | LANDFIRE LF2024 EVT ImageServer and EVT CSV | Retrieved |
| Fuel disturbance (type, severity, age ≤10 yr), 30 m | LANDFIRE LF2024 FDist ImageServer and CSV | Retrieved. Shows burns on 126 candidate zones. |
| Hazardous fuels treatment polygons | USFS FACTS `EDW_HazardousFuelsTreatments_01/15` | Retrieved, but only 5 FY2007 polygons in the bbox — Bankhead burn history is not published here. |
| Walking network | Built from the FS road inventory, NFS trails and OSM highways | Derived: 13,432 nodes; 557 of 900 candidate routes follow it; the rest are labelled straight-line. |
| 10-year temperature normals; past-day weather | Open-Meteo archive API (browser, live) | Live, cached 30 days |
| Hourly/daily forecast | Open-Meteo (browser, live) | Live, with age shown |
| Severe weather alerts | NWS API (browser, live) | Live |
| Basemaps (topo, imagery, hybrid, shaded relief) | USGS The National Map tile services | Live, public domain |

## Not obtainable as GIS and requiring manual verification

- **Zone A/B polygons.** The ADCNR service has a single WMA polygon. The split is digitized along AL 33 following the official map. Points within 400 m of AL 33 get no confirmed zone. If the rules differ between zones on that date, the app reports "Regulations require verification".
- **MVUM.** `EDW_MVUM_01/02` returned 0 features for the Bankhead bbox. Vehicle access, seasonal closures and gate status are therefore unverified.
- **Gates, kiosks, parking and wildlife openings** shown on the permit map are not published as GIS. Access points used instead:
  - USFS recreation sites
  - the checking station
  - points every 400 m along FS roads with maintenance level ≥ 2 that are open to ALL (labelled "legal pull-off not verified")
- **ADCNR rut map.** County-level peak dates were not machine-readable. Phase dates come from a secondary source (low confidence).
- **ADCNR publishes no deer-zone GIS.** Zone D was rebuilt from the official text and is labelled as derived.
- **Deer observations, density and harvest data.** None are used, and none are invented.
- **Prescribed burns and timber management.** FACTS public data for this district is almost all invasive-species work; LANDFIRE FDist is used instead (30 m, age classes only, no exact dates).

## Private land

Private land is separate from the Bankhead data above. Public files for one small area live in `public/data/club/` (`npm run data:club`):

| Layer | Source | Notes |
|---|---|---|
| DEM, 1 arc-second | USGS 3DEP ImageServer | Same as Bankhead |
| Existing vegetation and fuel disturbance (clear cuts, burns), 30 m | LANDFIRE LF2024 | Same as Bankhead. Age classes only. |
| Roads, driveways and paths | OpenStreetMap via Overpass (ODbL) | Community-mapped. Farm and lease roads inside private land are often missing, so gates and parking are never treated as verified. |
| Half-resolution terrain grid, streams, contours, slope and disturbance overlays | Derived by `scripts/build-club.mjs` | TPI is standardized against the box's own spread |
| Deer Zone C private-land seasons | OutdoorAlabama.com 2026-27 deer season page | Transcribed 2026-10-31. Jefferson County is listed under Zone C. The page's zone map image is labelled "Proposed". |

**What is not in the repo or on the site:** the boundary. It is stored in the owner's own Realtime Database node (readable only by them) and delivered with `scripts/provision-land.mjs`. County parcel records may be used once, offline, to make the boundary file. The `private/` folder is git-ignored, and a test checks that the public data contains no polygons. The public box only shows that a region is covered.

**Known gaps:** no trail, gate or parking data inside the land unless the owner drops `parking` pins; no field-checked boundary (the file is only as exact as its source); no neighbor or harvest data.
