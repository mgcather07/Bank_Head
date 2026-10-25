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
