// HuntScoringEngine + RecommendationService + ConfidenceEvaluator.
// Deterministic and versioned. Weights are product hypotheses (see docs/MODEL.md), not calibrated probabilities.
import type { Candidate, Confidence, HuntPreferences, HuntRecommendation, RouteOption, ScoreComponent, Session, UserPin, WeatherBundle } from './types';
import { evaluateLegal, isGunPressureDay, isStatewideGunDay } from './regulations';
import { assessWind, compass } from './wind';
import { rutPhase } from './rut';
import { isWeekend, localDate, sessionWindows, sunDay, fmtTime, type SunDay } from './time';
import { dataAge, hoursBetween, pressureTrend } from './weather';
import { CLUB_LABEL, haversine } from './geography';
import { normalFor, type Normals } from './climate';

export const MODEL_VERSION = 'bhi-score-1.1.0';
export const WEIGHTS = { terrain: 0.25, wind: 0.25, access: 0.2, time: 0.15, weather: 0.1, evidence: 0.05 } as const;
export const TORTUOSITY = 1.35; // fallback only: straight-line → walking estimate when no network route exists

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

export interface ScoreContext {
  prefs: HuntPreferences;
  weather: WeatherBundle | null;
  pins: UserPin[];
  normals?: Normals | null;
  now?: number;
}

function chooseRoute(c: Candidate, prefs: HuntPreferences): RouteOption | null {
  const routes = c.properties.routes ?? [];
  if (!routes.length) return null;
  if (prefs.start) {
    // prefer the access point nearest the hunter's chosen starting point
    return [...routes].sort((a, b) => haversine(prefs.start!, a.coord) + a.walkMeters - (haversine(prefs.start!, b.coord) + b.walkMeters))[0];
  }
  return routes[0];
}

/** Pressure proxy: WMA gun-hunt days, or any statewide gun/muzzleloader day on National Forest land. */
function gunPressure(p: Candidate['properties'], date: string) {
  if (p.jurisdiction === 'private_club') return false; // a private club is not subject to public-land crowding
  return p.jurisdiction === 'nf_outside_wma' ? isStatewideGunDay(date, p.deerZone ?? null) : isGunPressureDay(date, p.zone ?? p.provisionalZone);
}

function terrainComponent(c: Candidate): ScoreComponent {
  const p = c.properties;
  const pos: string[] = [], neg: string[] = [];
  const featureText: Record<string, string> = { saddle: 'a ridge saddle', bench: 'a side-hill bench', spur: 'a spur/ridge point', bottom: 'a creek-bottom edge', draw: 'a draw' };
  if (p.type === 'spot') (p.nearbyFeatures.length ? pos : neg).push(`${p.club && !p.id.startsWith('SPOT') ? 'This zone is' : 'Your spot is'} on a ${p.landform ?? 'slope'}${p.label.includes('m away') ? `; ${p.label.toLowerCase()}` : ''} (${p.localReliefM} m local relief).`);
  else pos.push(`Derived ${featureText[p.type]} (${p.localReliefM} m local relief).`);
  const others = p.nearbyFeatures.filter((f) => f !== p.type);
  if (others.length) pos.push(`Terrain convergence: ${others.map((f) => featureText[f] ?? f).join(', ')} within ~300 m.`);
  if (p.habitat.oak > 0.15) pos.push(`Oak-type forest mapped on ${pct(p.habitat.oak)} of the area (mast potential — current acorn crop not verified).`);
  else if (p.habitat.hardwood > 0.4) pos.push(`Hardwood cover ${pct(p.habitat.hardwood)} (LANDFIRE).`);
  if (p.habitat.edgeDensity > 0.15) pos.push('Cover-type transitions present (edge habitat).');
  if (p.habitat.earlySuccessional > 0.03) pos.push(`Early-successional/open vegetation ${pct(p.habitat.earlySuccessional)} nearby (browse/cover potential).`);
  const d = p.disturbance;
  if (d) {
    if (d.fireMid > 0.1) pos.push(`Burned 2–5 years ago on ${pct(d.fireMid)} of the area (LANDFIRE) — fresh browse and understory cover.`);
    else if (d.fireRecent > 0.1) pos.push(`Burned within the last year on ${pct(d.fireRecent)} (LANDFIRE) — open understory, browse still recovering.`);
    else if (d.fireOld > 0.15) pos.push(`Burned 6–10 years ago on ${pct(d.fireOld)} (LANDFIRE).`);
    if ((d.cutRecent ?? 0) > 0.08) pos.push(`Clear cut / thinning 2–5 years old on ${pct(d.cutRecent!)} (LANDFIRE) — regrowth browse, deer feed here.`);
    else if ((d.cutNew ?? 0) > 0.08) pos.push(`Fresh cut (≤1 yr) on ${pct(d.cutNew!)} — opening up; browse still coming in.`);
    if ((d.cutOld ?? 0) > 0.08) pos.push(`Older cut 6–10 years on ${pct(d.cutOld!)} (LANDFIRE) — thick regrowth, likely bedding cover.`);
    if ((d.cutRecent ?? 0) > 0.05 && (d.cutOld ?? 0) > 0.05) pos.push('Young cut next to an older cut — bedding-to-feeding edge.');
    if (!d.cutRecent && !d.cutOld && d.mechRecent > 0.1) pos.push(`Recent timber/mechanical treatment on ${pct(d.mechRecent)} (LANDFIRE) — early-successional edge.`);
  }
  if (p.steepFraction > 0.35) neg.push(`${pct(p.steepFraction)} of the area is steeper than 25°.`);
  if (p.habitat.conifer > 0.6) neg.push(`Conifer-dominant (${pct(p.habitat.conifer)}) — limited mast potential.`);
  if (p.habitat.developedAg > 0.2) neg.push('Developed/agricultural cover mapped nearby.');
  neg.push('No verified deer sign; terrain/habitat indicates potential only.');
  return { key: 'terrain', label: 'Terrain & habitat', weight: WEIGHTS.terrain, value: p.terrainScore / 100, positives: pos, negatives: neg };
}

function accessComponent(c: Candidate, prefs: HuntPreferences, route: RouteOption | null, session: Session, date: string): ScoreComponent {
  const p = c.properties;
  const pos: string[] = [], neg: string[] = [];
  if (!route) return { key: 'access', label: 'Access & pressure', weight: WEIGHTS.access, value: 0.2, positives: [], negatives: ['No verified access point within range.'] };
  const walk = route.walkMeters;
  let v = 0.7;
  const kid = !!prefs.withKid;
  const walkMin = route.walkMinutes ?? Math.round(walk / 50);
  if (kid) {
    // taking a kid: short, flat, easy to find, close to the truck — and a place a kid can sit still and see
    if (walkMin <= 8) { v += 0.2; pos.push(`Short walk for a kid (≈${walkMin} min).`); }
    else if (walkMin <= 14) { v += 0.05; pos.push(`Manageable walk with a kid (≈${walkMin} min).`); }
    else { v -= 0.35; neg.push(`Walk is ≈${walkMin} min — long for a kid in the dark.`); }
    if ((route.gainInMeters ?? 0) > 35) { v -= 0.15; neg.push(`~${Math.round((route.gainInMeters ?? 0) * 3.28)} ft of climbing on the way in.`); }
    if (route.maxSlopeDeg > 20) { v -= 0.15; neg.push(`Steep ground (${route.maxSlopeDeg}°) on the walk — hard footing for a kid.`); }
    else pos.push('Gentle footing the whole way in.');
    if (route.routeKind === 'straight') { v -= 0.1; neg.push('No mapped route — bushwhacking with a kid is a hard start.'); }
    if (p.steepFraction > 0.2) { v -= 0.1; neg.push('Steep ground around the spot.'); }
    if (p.habitat.earlySuccessional > 0.08 || (p.disturbance?.cutRecent ?? 0) > 0.08 || (p.disturbance?.cutNew ?? 0) > 0.08) { v += 0.1; pos.push('Open ground / young cut nearby — room to see deer coming and a clear shot.'); }
    if (p.type === 'bottom' || p.type === 'bench') pos.push(`${p.label}: level enough for a ground blind.`);
    if (p.distRoadM > 1200) neg.push('Far from any road — a long carry if you get one down.');
    return { key: 'access', label: 'Access & pressure', weight: WEIGHTS.access, value: clamp(v), positives: pos, negatives: neg };
  }
  const target = prefs.effort === 'easy' ? [200, 900] : prefs.effort === 'balanced' ? [700, 1800] : [1500, 4000];
  const est = route.routeKind === 'straight' || route.routeKind === 'network+offtrail' ? ' est.' : '';
  if (walk < target[0]) { v -= prefs.effort === 'deep' ? 0.25 : 0.05; neg.push(`Close to access (${Math.round(walk)} m${est}) — likely higher hunter traffic.`); }
  else if (walk > target[1]) { v -= 0.2; neg.push(`Walk (${(walk / 1609).toFixed(1)} mi${est}) is longer than your ${prefs.effort} preference.`); }
  else { v += 0.15; pos.push(`Walk length fits your ${prefs.effort} preference (${(walk / 1609).toFixed(1)} mi${est}).`); }
  if (route.routeKind === 'terrain' || route.routeKind === 'lidar') pos.push(`Walkable route on ${route.routeKind === 'lidar' ? 'lidar' : '10 m'} terrain: ${(route.onNetworkMeters / 1609).toFixed(1)} mi on roads/trails, ${route.offTrailMeters} m cross-country, ≈${route.walkMinutes ?? '?'} min — avoids cliffs and steep side-hills.`);
  else if (route.routeKind === 'network+offtrail') pos.push(`${(route.onNetworkMeters / 1609).toFixed(1)} mi on mapped road/trail, then ${route.offTrailMeters} m off-trail.`);
  else neg.push('No mapped road or trail leads near this zone — the walk is a straight-line estimate.');
  if (route.gainInMeters > 90) { v -= 0.1; neg.push(`~${Math.round(route.gainInMeters * 3.28)} ft of climbing on the way in.`); }
  if (route.maxSlopeDeg > 28) { v -= session === 'morning' ? 0.12 : 0.06; neg.push(`Steep ground (${route.maxSlopeDeg}°) along the approach — ${session === 'morning' ? 'hazardous in darkness' : 'plan exit after dark'}.`); }
  if (p.distRoadM < 250) { v -= 0.12; neg.push(`Within ${p.distRoadM} m of a road — pressure proxy.`); }
  else if (p.distRoadM > 800) { v += 0.05; pos.push(`${(p.distRoadM / 1609).toFixed(1)} mi from the nearest mapped road.`); }
  if (p.distTrailM < 150) { v -= 0.08; neg.push('On/near a mapped trail — foot traffic likely.'); }
  if (isWeekend(date)) { v -= 0.05; neg.push('Weekend — higher expected hunter presence (proxy).'); }
  if (gunPressure(p, date)) { v -= 0.08; neg.push(p.jurisdiction === 'nf_outside_wma' ? 'Statewide gun season is open on this public land — elevated pressure expected.' : 'Gun deer hunt day for this zone — elevated pressure expected.'); }
  if (prefs.stand === 'climber' && p.meanSlopeDeg > 18) { v -= 0.08; neg.push('Steep average slope — climber setup may be difficult.'); }
  if (route.kind === 'roadside') neg.push(p.jurisdiction === 'private_club' ? 'Start is a mapped road or a parking pin of yours — confirm where you may park and which gates are open.' : 'Access point is a roadside location from the USFS road inventory — legal pull-off and gate status not verified.');
  else pos.push(`Starts at ${route.name} (${route.kind}).`);
  neg.push('Hunter-density data unavailable; pressure is estimated from proxies.');
  return { key: 'access', label: 'Access & pressure', weight: WEIGHTS.access, value: clamp(v), positives: pos, negatives: neg };
}

function timeComponent(c: Candidate, session: Session, date: string, prefs: HuntPreferences, sun: SunDay): ScoreComponent {
  const p = c.properties;
  const rut = rutPhase(date, p.jurisdiction === 'nf_outside_wma' || p.jurisdiction === 'private_club' ? p.deerZone ?? null : 'D');
  const pos: string[] = [], neg: string[] = [];
  let v = 0.55;
  // feature-session fit (hypotheses): morning → travel toward bedding cover; evening → transition toward food/water
  if (session === 'morning') {
    if (p.type === 'bench' || p.type === 'saddle') { v += 0.12; pos.push(`${p.label}s are classic morning travel routes between bottoms and upper bedding cover (hypothesis).`); }
    if (p.type === 'bottom') { v -= 0.08; neg.push('Creek bottoms are more often evening food/water destinations; morning entry may bump deer.'); }
    if (p.beddingCoverBearing != null) pos.push(`Potential bedding cover lies to the ${compass(p.beddingCoverBearing)}.`);
  } else if (session === 'evening') {
    if (p.type === 'bottom' || p.type === 'spur') { v += 0.1; pos.push('Positioned between hypothesised bedding cover and bottoms/openings — evening transition.'); }
    if (p.habitat.earlySuccessional > 0.03 || p.habitat.oak > 0.2) { v += 0.05; pos.push('Food-potential habitat nearby for evening movement.'); }
  } else {
    v -= 0.1;
    neg.push('Midday movement is generally lower outside the rut.');
  }
  if (rut.phase === 'rut') {
    if (prefs.target === 'mature_buck') { v += session === 'midday' ? 0.25 : 0.12; pos.push(`${rut.label}: buck movement elevated${session === 'midday' ? '; midday sits are worthwhile' : ''}.`); }
    if (p.type === 'saddle' || p.type === 'bench') { v += 0.05; pos.push('Rut: bucks cruise saddles/benches between doe bedding areas.'); }
  } else if (rut.phase === 'pre_rut') {
    if (session === 'evening') v += 0.04;
    pos.push(`${rut.label}: ${rut.note}`);
  } else if (rut.phase === 'post_rut' || rut.phase === 'late_season') {
    if (session === 'evening') { v += 0.08; pos.push(`${rut.label}: food-related evening movement favored.`); }
  } else if (rut.phase === 'early_season') {
    if (session === 'evening') v += 0.05;
    pos.push(`${rut.label}: ${rut.note}`);
  }
  if (gunPressure(p, date) && session === 'morning') { v += 0.05; pos.push('Gun-hunt day: other hunters moving at first light can push deer.'); }
  neg.push((p.jurisdiction === 'nf_outside_wma' || p.jurisdiction === 'private_club') && p.deerZone === 'C' ? 'Zone C rut timing estimated from ADCNR regional guidance (low confidence).' : `Rut timing from secondary source (low confidence) — verify against ADCNR rut map.`);
  void sun;
  return { key: 'time', label: 'Time of day & rut', weight: WEIGHTS.time, value: clamp(v), positives: pos, negatives: neg };
}

function weatherComponent(ctx: ScoreContext, start: number, end: number): ScoreComponent & { factors: string[] } {
  const hrs = hoursBetween(ctx.weather, start, end);
  const pos: string[] = [], neg: string[] = [], factors: string[] = [];
  if (!hrs.length) return { key: 'weather', label: 'Weather', weight: WEIGHTS.weather, value: 0.5, positives: [], negatives: ['No forecast covers this window.'], factors: ['Forecast unavailable'] };
  let v = 0.6;
  const temps = hrs.map((h) => h.tempF).filter((x): x is number => x != null);
  const avgT = temps.reduce((a, b) => a + b, 0) / (temps.length || 1);
  const prior = hoursBetween(ctx.weather, start - 24 * 3600000, end - 24 * 3600000).map((h) => h.tempF).filter((x): x is number => x != null);
  const priorAvg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null;
  if (priorAvg != null) {
    const d = avgT - priorAvg;
    factors.push(`${Math.round(avgT)}°F (${d >= 0 ? '+' : ''}${Math.round(d)}° vs. same time yesterday)`);
    if (d <= -8) { v += 0.15; pos.push(`Notable cool-down (${Math.round(d)}°F vs. yesterday) — often associated with increased daylight activity.`); }
    if (d >= 8) { v -= 0.08; neg.push(`Warmer than yesterday by ${Math.round(d)}°F.`); }
  } else factors.push(`${Math.round(avgT)}°F`);
  const nrm = normalFor(ctx.normals ?? null, localDate(start + 12 * 3600000));
  if (nrm) {
    const hiHrs = hrs.map((h) => h.tempF).filter((x): x is number => x != null);
    const dayHi = Math.max(...hiHrs);
    const anom = dayHi - nrm.tMax;
    factors.push(`${anom >= 0 ? '+' : ''}${Math.round(anom)}° vs. ${ctx.normals!.years}-yr normal high (${Math.round(nrm.tMax)}°F)`);
    if (anom <= -8) { v += 0.1; pos.push(`Well below the seasonal normal (${Math.round(anom)}°F vs. 10-yr average) — cooler than deer are acclimated to.`); }
    else if (anom >= 10) { v -= 0.1; neg.push(`Well above the seasonal normal (+${Math.round(anom)}°F vs. 10-yr average).`); }
  }
  if (avgT > 78) { v -= 0.12; neg.push('Warm temperatures tend to suppress daylight movement.'); }
  const rain = hrs.reduce((a, h) => a + (h.precipIn ?? 0), 0);
  const maxProb = Math.max(...hrs.map((h) => h.precipProb ?? 0));
  if (rain > 0.25) { v -= 0.15; neg.push(`${rain.toFixed(2)} in of rain forecast during the hunt.`); factors.push(`Rain ${rain.toFixed(2)} in`); }
  else if (maxProb >= 50) { v -= 0.05; neg.push(`Rain chance up to ${maxProb}%.`); factors.push(`Rain chance ${maxProb}%`); }
  const winds = hrs.map((h) => h.windMph ?? 0);
  const avgW = winds.reduce((a, b) => a + b, 0) / winds.length;
  if (avgW > 18) { v -= 0.12; neg.push(`Strong wind (avg ${Math.round(avgW)} mph).`); }
  else if (avgW >= 4 && avgW <= 12) { v += 0.05; pos.push(`Steady ${Math.round(avgW)} mph wind — predictable scent direction.`); }
  const trend = pressureTrend(ctx.weather, start);
  if (trend != null) {
    factors.push(`Pressure ${trend >= 0 ? 'rising' : 'falling'} (${trend.toFixed(1)} hPa/3h)`);
    if (trend >= 1.5) { v += 0.03; pos.push('Rising pressure after a system (minor contextual factor).'); }
  }
  return { key: 'weather', label: 'Weather', weight: WEIGHTS.weather, value: clamp(v), positives: pos, negatives: neg, factors };
}

function evidenceComponent(c: Candidate, pins: UserPin[]): ScoreComponent {
  const sign = pins.filter((p) => ['sighting', 'rub', 'scrape', 'trail', 'bedding', 'feeding', 'camera', 'harvest'].includes(p.kind) && haversine(p.coord, c.properties.center) < 400);
  if (!sign.length) return { key: 'evidence', label: 'Verified evidence', weight: WEIGHTS.evidence, value: 0.4, positives: [], negatives: ['No user-confirmed observations here.'] };
  return { key: 'evidence', label: 'Verified evidence', weight: WEIGHTS.evidence, value: clamp(0.6 + 0.1 * sign.length), positives: [`${sign.length} of your private observations within 400 m (${[...new Set(sign.map((s) => s.kind))].join(', ')}).`], negatives: [] };
}

export function evaluateCandidate(c: Candidate, session: Session, ctx: ScoreContext): HuntRecommendation {
  const { prefs } = ctx;
  const p = c.properties;
  const date = prefs.date;
  const sun = sunDay(date, p.center[0], p.center[1]);
  const win = sessionWindows(sun)[session];
  const legal = evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: p.jurisdiction ?? 'black_warrior_wma', zone: p.zone, youthHunter: prefs.youthHunter, deerZone: p.deerZone ?? null });
  const route = chooseRoute(c, prefs);
  const hours = hoursBetween(ctx.weather, win.start, win.end);
  const wind = assessWind({ session, hours, sun, aspectDeg: p.aspectDeg, aspectStrength: p.aspectStrength, beddingBearing: p.beddingCoverBearing, foodBearing: p.foodWaterBearing, approachBearing: route?.approachBearing ?? null });
  const windComp: ScoreComponent = {
    key: 'wind', label: 'Wind & scent', weight: WEIGHTS.wind, value: wind.score,
    positives: wind.risk === 'low' ? [`Forecast ${compass(wind.windFromDegrees)} wind carries scent ${compass(wind.scentDownwindDegrees)}, away from the hypothesised bedding/approach sides.`] : [],
    negatives: wind.notes,
  };
  const comps = [terrainComponent(c), windComp, accessComponent(c, prefs, route, session, date), timeComponent(c, session, date, prefs, sun), weatherComponent(ctx, win.start, win.end), evidenceComponent(c, ctx.pins)];
  let score = comps.reduce((a, k) => a + k.weight * k.value, 0) * 100;
  const warnings: string[] = [];
  if (wind.risk === 'high') { score = Math.min(score, 45); warnings.push('Severe wind mismatch for this session — score capped.'); }
  if (route && route.walkMeters > prefs.maxWalkMeters) warnings.push('Walk exceeds your maximum walking distance.');
  if (legal.status !== 'verified_allowed') warnings.push(legal.summary);
  if (p.type === 'spot' && p.distRoadM < 100) warnings.push(`Road ${p.distRoadM} m away — you can't hunt from or across a public road; set up well off it.`);
  if (p.wilderness) warnings.push('Sipsey Wilderness — no motorized/mechanized equipment (incl. game carts); pack-in/pack-out.');
  if (prefs.withKid && route && (route.walkMinutes ?? 0) > 15) warnings.push('Long walk for a kid — pick a closer spot.');
  if (prefs.stand === 'climber' || prefs.stand === 'hang_on' || prefs.stand === 'saddle') warnings.push('Tree suitability cannot be verified remotely — inspect trees on site; full-body harness and tether required (WMA rule).');
  if (sun && Date.now() > win.end && date === localDate()) warnings.push('This session has already ended today.');

  // Confidence
  const cr: string[] = [];
  let conf = 0.85;
  const age = dataAge(ctx.weather);
  if (!hours.length) { conf -= 0.35; cr.push('No forecast for this window.'); }
  else if (age.stale) { conf -= 0.15; cr.push(`Forecast is ${Math.round((age.minutes ?? 0) / 60)} h old.`); }
  const lead = (win.start - Date.now()) / 86400000;
  if (lead > 3) { conf -= 0.1; cr.push(`Forecast lead time ${Math.round(lead)} days.`); }
  if (lead > 5) conf -= 0.05;
  if (wind.thermal.uncertainty === 'high') { conf -= 0.1; cr.push('High thermal uncertainty.'); }
  if (comps[5].value <= 0.4) { conf -= 0.15; cr.push('No field observations; terrain/habitat potential only.'); }
  if (route?.kind === 'roadside') { conf -= 0.05; cr.push('Access point not verified as legal parking.'); }
  if (p.zone == null) { conf -= 0.1; cr.push('Zone uncertain (near AL 33).'); }
  cr.push('Rut timing low-confidence; weights not yet field-calibrated.');
  let confidence: Confidence = conf >= 0.75 ? 'high' : conf >= 0.5 ? 'moderate' : conf >= 0.3 ? 'low' : 'insufficient';
  if (legal.status === 'requires_verification' && (confidence === 'high' || confidence === 'moderate')) confidence = 'low';

  const reasons = comps.flatMap((k) => k.positives.map((t) => ({ t, w: k.weight * k.value }))).sort((a, b) => b.w - a.w).map((x) => x.t);
  const improvements: string[] = [];
  if (wind.risk !== 'low' && p.beddingCoverBearing != null) improvements.push(`Hunt this zone on a wind that blows scent away from the ${compass(p.beddingCoverBearing)} (bedding side), e.g. a wind out of the ${compass(p.beddingCoverBearing)}.`);
  if (route && route.kind === 'roadside') improvements.push('Scout the access in daylight to confirm a legal pull-off and gate status.');
  if (route && route.routeKind === 'straight') improvements.push('Walk in from the nearest mapped road or trail and log the actual route as pins.');
  if (comps[5].value <= 0.4) improvements.push('Scout for rubs, scrapes, trails and beds and log them as private pins — verified sign raises confidence.');
  if (session === 'morning' && p.type === 'bottom') improvements.push('Consider this zone as an evening sit instead.');
  if (route && route.maxSlopeDeg > 28) improvements.push('Pick an alternate access that follows the ridge rather than the steep side-slope.');

  return {
    id: `${p.id}-${date}-${session}`,
    areaId: p.id,
    geometry: c.geometry,
    center: p.center,
    landJurisdiction: p.jurisdiction && p.jurisdiction !== 'black_warrior_wma' ? (p.jurisdiction === 'nf_outside_wma' ? `Bankhead National Forest · Deer Zone ${p.deerZone ?? 'C/D (near line)'}` : p.jurisdiction === 'private_club' ? p.landLabel ?? CLUB_LABEL : 'Private / non-public land') : `Black Warrior WMA${p.zone ? ` Zone ${p.zone}` : ''}${p.wilderness ? ' · Sipsey Wilderness' : ''}`,
    zoneId: p.zone ?? undefined,
    huntDate: date,
    session,
    method: prefs.weapon,
    legal,
    legalStatus: legal.status,
    score: legal.status === 'verified_prohibited' ? null : Math.round(score),
    confidence,
    confidenceReasons: cr,
    components: comps,
    terrainFeatures: [p.label, ...p.nearbyFeatures.filter((f) => f !== p.type)],
    habitatIndicators: [p.habitat.oak > 0.15 ? `Oak forest types ${pct(p.habitat.oak)} (habitat potential)` : null, p.habitat.hardwood > 0.3 ? `Hardwood ${pct(p.habitat.hardwood)}` : null, p.habitat.conifer > 0.3 ? `Conifer ${pct(p.habitat.conifer)}` : null, p.habitat.earlySuccessional > 0.02 ? `Early-successional ${pct(p.habitat.earlySuccessional)}` : null].filter(Boolean) as string[],
    weatherFactors: (comps[4] as ScoreComponent & { factors?: string[] }).factors ?? [],
    windAssessment: wind,
    recommendedWindow: { start: fmtTime(win.start), end: fmtTime(win.end) },
    route: route ? { verifiedAccessPointId: route.accessPointId, name: route.name, distanceMeters: route.walkMeters, elevationGainMeters: route.gainInMeters, verification: route.verification, coord: route.coord, routeKind: route.routeKind, onNetworkMeters: route.onNetworkMeters, offTrailMeters: route.offTrailMeters, path: route.path, profile: route.profile, walkMinutes: route.walkMinutes, elevationSource: route.elevationSource, maxSlopeDeg: route.maxSlopeDeg } : undefined,
    reasons,
    warnings,
    improvements,
    evidence: [
      { sourceId: 'usgs-3dep-dem', timestamp: 'see Sources', status: 'derived' },
      { sourceId: 'landfire-lf2024-evt', timestamp: 'see Sources', status: 'habitat_potential' },
      { sourceId: 'landfire-lf2024-fdist', timestamp: 'see Sources', status: 'derived' },
      { sourceId: 'adcnr-wma-boundary', timestamp: 'see Sources', status: 'observed' },
      { sourceId: 'open-meteo', timestamp: ctx.weather ? new Date(ctx.weather.fetchedAt).toISOString() : 'unavailable', status: ctx.weather ? 'forecast' : 'missing' },
      { sourceId: 'adcnr-bw-wma-2026-27', timestamp: '2026-27', status: 'regulation' },
    ],
    modelVersion: MODEL_VERSION,
    candidate: p,
  };
}

export function sessionsFor(pref: HuntPreferences['session']): Session[] {
  if (pref === 'all' || pref === 'compare') return ['morning', 'midday', 'evening'];
  return [pref];
}

export interface RankResult {
  recommendations: HuntRecommendation[];
  bySession: Record<Session, HuntRecommendation[]>;
  excluded: { prohibited: number; overDistance: number; verification: number };
}

/** Ranks candidates. Legal + access gates are applied before ranking; prohibited zones are never ranked. */
export function rankCandidates(cands: Candidate[], ctx: ScoreContext, limit = 5): RankResult {
  const sessions = sessionsFor(ctx.prefs.session);
  const bySession = { morning: [], midday: [], evening: [] } as Record<Session, HuntRecommendation[]>;
  const excluded = { prohibited: 0, overDistance: 0, verification: 0 };
  const all: HuntRecommendation[] = [];
  for (const s of sessions) {
    for (const c of cands) {
      const r = evaluateCandidate(c, s, ctx);
      if (r.legalStatus === 'verified_prohibited') { excluded.prohibited++; continue; }
      if (r.route && r.route.distanceMeters > ctx.prefs.maxWalkMeters) { excluded.overDistance++; continue; }
      if (ctx.prefs.withKid && r.route && ((r.route.walkMinutes ?? 99) > 15 || (r.route.maxSlopeDeg ?? 0) > 28)) { excluded.overDistance++; continue; }
      if (r.legalStatus === 'requires_verification') excluded.verification++;
      bySession[s].push(r);
      all.push(r);
    }
    bySession[s].sort(compareRecs);
  }
  all.sort(compareRecs);
  // one entry per area in the overall list
  const seen = new Set<string>();
  const recommendations = all.filter((r) => (seen.has(r.areaId) ? false : (seen.add(r.areaId), true))).slice(0, limit);
  for (const s of sessions) bySession[s] = bySession[s].slice(0, 50);
  return { recommendations, bySession, excluded };
}

function compareRecs(a: HuntRecommendation, b: HuntRecommendation) {
  const la = a.legalStatus === 'verified_allowed' ? 0 : 1, lb = b.legalStatus === 'verified_allowed' ? 0 : 1;
  if (la !== lb) return la - lb;
  return (b.score ?? -1) - (a.score ?? -1) || a.areaId.localeCompare(b.areaId);
}

export const scoreBand = (s: number | null) => (s == null ? 'n/a' : s >= 70 ? 'High' : s >= 50 ? 'Medium' : 'Low');
