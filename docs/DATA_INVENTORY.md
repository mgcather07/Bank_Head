# Verified Data Inventory (audited 2026-10-24)

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
| All motor roads and tracks (982 ways) | OpenStreetMap via Overpass (`scripts/fetch-osm-roads.mjs`) | Retrieved (ODbL). Used only to keep zones and setup points off roads, not for routing or parking. |
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
- **Statewide rules on NF land outside the WMA** are not modeled. That land is marked "requires verification".
- **Deer observations, density and harvest data.** None are used, and none are invented.
- **Prescribed burns and timber management.** FACTS public data for this district is almost all invasive-species work; LANDFIRE FDist is used instead (30 m, age classes only, no exact dates).
