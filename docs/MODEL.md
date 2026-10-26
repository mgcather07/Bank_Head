# Scoring Model (bhi-score-1.0.0 / terrain-1.0.0)

## Candidate generation (offline, deterministic)
From the 1 arc-second 3DEP DEM, the pipeline computes:
- slope and aspect (Horn method)
- TPI at about 150 m and about 750 m (standardized)
- D8 flow accumulation after a priority-flood fill (streams at ≥ 0.3 km²)
- Hessian curvature

It then detects four feature types:

| Feature | Rule |
|---|---|
| Saddle | Opposite-sign principal curvatures, upper landscape position, slope < 12° |
| Bench | Slope < 8° inside terrain with mean slope > 11°, mid-slope position |
| Spur / point | Local TPI > 1.6 σ at mid position |
| Creek-bottom edge | Landscape TPI < −0.9 σ, flat, within 120 m of a derived stream |

Each feature's connected cells become a scouting polygon: a convex hull of the cells within 250 m, buffered by 60 m.

**Gates** (a candidate is rejected if it fails any):
- inside the ADCNR WMA polygon, excluding holes
- on USFS-owned land
- more than 400 m from recreation sites
- no road crossing the zone outline, and the zone center at least 100 m from any road. "Road" means the USFS road inventory, state highways and every OpenStreetMap motor road or track; the OSM layer adds the county and private roads the Forest Service data misses.

Candidates are then de-duplicated within 400 m. Context within 300 m covers feature convergence, LANDFIRE habitat fractions, oak types and edge density. Within 600 m the pipeline derives two **hypothesis** bearings:
- **Bedding cover:** upper, moderately steep, forested cells
- **Food/water:** bottoms, openings, streams

These bearings are hypotheses, not observations.

## Runtime score (0–100, relative ranking, not a probability)

| Component | Weight | Basis |
|---|---:|---|
| Terrain & habitat | 25% | Precomputed `terrainScore` |
| Wind & scent | 25% | Hourly exposure of downwind (and thermal, when wind ≤ 6 mph) bearings toward the bedding and food sides. Also penalizes variability, calm/swirl, gusts and walk-in through the bedding side. |
| Access & pressure | 20% | Estimated walk vs. effort preference, gain, steepness, distance to road/trail, weekend, gun-hunt days, stand type |
| Time & rut | 15% | Session/feature fit, rut phase, target |
| Weather | 10% | Δ temperature vs. the prior day, heat, rain, wind strength, pressure trend (minor) |
| Evidence | 5% | User pins within 400 m only |

**Mandatory gates.** These are not weighted:
- Legal status `verified_prohibited` means the zone is never ranked.
- `requires_verification` ranks below every verified-legal zone.
- Walks longer than the user's maximum are excluded.
- High wind risk caps the score at 45.

**Confidence** is reduced by:
- missing or stale forecasts
- lead time
- thermal uncertainty
- having no field observations
- unverified access
- an uncertain zone
- a legal status that requires verification

High confidence is effectively reachable only with user-confirmed evidence.

**The weights are uncalibrated product hypotheses.** Use the hunt journal (predicted score vs. outcome) to calibrate them before calling any score predictive.

## Check this spot (in the browser)

A tapped point is scored with the same terrain/habitat formula as the generated candidates, but on a half-resolution grid (2 arc-sec, about 52×62 m) exported by the build:
- Continuous layers are 2×2 means; feature masks are 2×2 ORs so thin features such as saddles survive.
- Feature-count thresholds are scaled to the larger cells (÷4) and edge density is halved to stay comparable.
- The nearest saddle/bench/spur/bottom within 150 m sets the feature base score, reduced slightly with distance; with none nearby the base is 0.28.
- A test re-checks every 15th generated zone and requires the median terrain-score difference to be ≤ 12 and the feature type to match for most of them.
- Jurisdiction is looked up for the exact point, so spots on private or non-WMA land get the matching legal status.

## Hunt this spot plan

Built from the evaluation itself. **Huntable winds** are the 16 compass directions whose downwind bearing keeps exposure to the bedding side (weight 1) and food side (0.6–0.75) under 0.3. Walk time assumes 2.5 mph on roads/trails, 1.2 mph off-trail and 1 min per 10 m of climb.

The red ✕ setup point is about 60 yd downwind of the zone center. If that spot is within 50 m of any road, it swings up to ±60° and 40–80 m until it is clear, and the plan says it was shifted. A checked spot within 40 m of a road gets the verdict "On or next to a road — move off it".

## Walk-in routes (terrain and lidar)

Routes are least-effort walking paths (`src/engine/pathfind.ts`), not straight lines:
- **Speed:** Tobler's hiking function on each step's grade, ×0.6 off mapped roads/trails.
- **Cliffs:** cells steeper than 38° are impassable, and side-hills between 25° and 38° are penalized up to 3×.
- **Blocked ground:** private (non-FS) land and open water are blocked except where a mapped road crosses them. Open water is detected from hydro-flattened (dead-level) lidar surfaces.
- **Search:** multi-source search from every road/trail node, seeded with the time to walk there from the nearest drivable start, so the route uses the network as far as it helps.
- **Precomputed (offline):** every zone is routed on USGS 3DEP 1/3 arc-second (~10 m, lidar-derived) elevation (`scripts/build-routes.mjs`). Of 871 zones, 850 have terrain routes. The other 21 have no reachable start within 4 km and keep an estimate labelled as such. Median climb on the way in fell from 45 m to 24 m versus the old straight-line legs, and no route crosses ground ≥ 38°.
- **Refined (online):** opening a zone or checked spot fetches ~4 m lidar elevation around it from USGS and re-routes (`src/engine/lidar.ts`, about 1 s). At this resolution old logging roads, skid trails and benches are the easiest lines on a slope, so the route follows them where they exist. A **Lidar hillshade** map layer shows those features.

These are suggestions over mapped terrain. They don't know about blowdowns, briars, fences or high water, and road/trail centerlines are inventory data, not field-checked.
