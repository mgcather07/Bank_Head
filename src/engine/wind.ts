// WindAndScentEngine — schematic (not a validated dispersion model).
import type { HourlyWeather, Session, WindAssessment } from './types';
import type { SunDay } from './time';

/** Meteorological wind direction is where wind comes FROM; scent travels the opposite way. */
export const downwindBearing = (windFrom: number) => (((windFrom + 180) % 360) + 360) % 360;

export const angleDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};

export function circularStats(angles: number[], weights?: number[]) {
  if (!angles.length) return { mean: null as number | null, spread: null as number | null };
  let s = 0, c = 0, wsum = 0;
  angles.forEach((a, i) => {
    const w = weights?.[i] ?? 1;
    s += w * Math.sin((a * Math.PI) / 180);
    c += w * Math.cos((a * Math.PI) / 180);
    wsum += w;
  });
  const R = Math.hypot(s, c) / wsum;
  const mean = ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
  // circular standard deviation in degrees
  const spread = R >= 1 ? 0 : (Math.sqrt(-2 * Math.log(Math.max(R, 1e-9))) * 180) / Math.PI;
  return { mean, spread };
}

/** 1 when scent blows straight at a sensitive bearing, 0 when ≥ 90° away. */
export function exposure(scentBearing: number, sensitiveBearing: number): number {
  const d = angleDiff(scentBearing, sensitiveBearing);
  if (d <= 30) return 1;
  if (d >= 90) return 0;
  return 1 - (d - 30) / 60;
}

export const compass = (deg: number | null) => (deg == null ? '—' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16]);

export interface ThermalEstimate {
  uncertainty: 'low' | 'moderate' | 'high';
  flow: 'downslope' | 'upslope' | 'transitional' | 'wind-dominated';
  scentBearing: number | null; // direction thermal carries scent at this spot
}

/**
 * Thermal flow heuristic. Downslope drainage when the surface is cooling (night, early morning, around/after sunset);
 * upslope when sun has warmed slopes. Ambient wind > 8 mph is treated as dominating thermals.
 */
export function thermalAt(t: number, h: HourlyWeather, sun: SunDay, aspectDeg: number, aspectStrength: number): ThermalEstimate {
  const wind = h.windMph ?? 0;
  const cloud = h.cloud ?? 50;
  if (wind > 8) return { uncertainty: 'low', flow: 'wind-dominated', scentBearing: null };
  const sinceSunrise = (t - sun.sunrise) / 3600000;
  const toSunset = (sun.sunset - t) / 3600000;
  const warmingLag = cloud > 75 ? 3.5 : 2; // overcast delays/weakens heating
  let flow: ThermalEstimate['flow'];
  if (sinceSunrise < warmingLag - 0.75 || toSunset < 0.5) flow = 'downslope';
  else if (sinceSunrise > warmingLag + 0.75 && toSunset > 2) flow = 'upslope';
  else flow = 'transitional';
  let u = 0;
  if (flow === 'transitional') u += 2;
  if (cloud > 75) u += 1;
  if (wind > 4) u += 1; // mixed wind/thermal regime
  if (aspectStrength < 0.3) u += 1; // poorly defined slope
  const downslope = aspectDeg; // aspect = direction slope faces = downhill direction
  const scentBearing = flow === 'downslope' ? downslope : flow === 'upslope' ? (downslope + 180) % 360 : null;
  return { uncertainty: u >= 3 ? 'high' : u >= 1 ? 'moderate' : 'low', flow, scentBearing };
}

export interface WindContext {
  session: Session;
  hours: HourlyWeather[];
  sun: SunDay;
  aspectDeg: number;
  aspectStrength: number;
  beddingBearing: number | null;
  foodBearing: number | null;
  approachBearing: number | null; // bearing walked from access point to the zone
}

export function assessWind(ctx: WindContext): WindAssessment {
  const notes: string[] = [];
  const hrs = ctx.hours.filter((h) => h.windFrom != null && h.windMph != null);
  if (!hrs.length) {
    return { windFromDegrees: null, speedMph: null, scentDownwindDegrees: null, variabilityDeg: null, risk: 'unknown', score: 0.4, notes: ['Wind forecast unavailable — scent risk cannot be evaluated.'], thermal: { uncertainty: 'high', flow: 'unknown' } };
  }
  const dirs = hrs.map((h) => h.windFrom!);
  const speeds = hrs.map((h) => h.windMph!);
  const { mean, spread } = circularStats(dirs, speeds.map((s) => Math.max(1, s)));
  const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const maxGust = Math.max(...hrs.map((h) => h.gustMph ?? 0));

  // Sensitive bearings: where deer are hypothesised to be bedded / coming from or heading to.
  const wBed = ctx.session === 'evening' ? 1 : 0.9;
  const wFood = ctx.session === 'morning' ? 0.75 : 0.6;
  let hourScores: number[] = [];
  let thermalU: Array<'low' | 'moderate' | 'high'> = [];
  let flows: string[] = [];
  let worstHour: { t: number; exp: number } | null = null;
  for (const h of hrs) {
    const scent = downwindBearing(h.windFrom!);
    const th = thermalAt(h.time, h, ctx.sun, ctx.aspectDeg, ctx.aspectStrength);
    thermalU.push(th.uncertainty);
    flows.push(th.flow);
    const bearings: number[] = [scent];
    // In light wind, thermals compete with synoptic wind: evaluate both
    if (h.windMph! <= 6 && th.scentBearing != null) bearings.push(th.scentBearing);
    let exp = 0;
    for (const b of bearings) {
      if (ctx.beddingBearing != null) exp = Math.max(exp, wBed * exposure(b, ctx.beddingBearing));
      if (ctx.foodBearing != null) exp = Math.max(exp, wFood * exposure(b, ctx.foodBearing));
    }
    if (h.windMph! < 3) exp = Math.max(exp, 0.45); // swirling / unpredictable
    if ((h.gustMph ?? 0) > 25) exp = Math.max(exp, 0.5);
    if (!worstHour || exp > worstHour.exp) worstHour = { t: h.time, exp };
    hourScores.push(1 - exp);
  }
  let score = hourScores.reduce((a, b) => a + b, 0) / hourScores.length;
  if (spread != null && spread > 60) {
    score -= 0.15;
    notes.push(`Wind direction is forecast to vary widely during the hunt (±${Math.round(spread)}°).`);
  }
  // Walk-in contamination: if the walk-in path runs through the bedding side, entering disturbs the zone.
  if (ctx.approachBearing != null && ctx.beddingBearing != null) {
    const fromZoneToAccess = (ctx.approachBearing + 180) % 360;
    if (angleDiff(fromZoneToAccess, ctx.beddingBearing) < 45) {
      score -= ctx.session === 'evening' ? 0.15 : 0.1;
      notes.push('The approach from the nearest access point comes from the same side as the hypothesised bedding cover — walk-in may push deer.');
    }
    const walkScent = downwindBearing(mean!);
    if (ctx.beddingBearing != null && exposure(walkScent, ctx.beddingBearing) > 0.6 && ctx.session !== 'morning') {
      notes.push('During the walk in, scent is forecast to drift toward the bedding side.');
    }
  }
  if (ctx.beddingBearing == null && ctx.foodBearing == null) {
    notes.push('No bedding/feeding hypothesis could be derived here; wind scored on variability only.');
    score = Math.min(score, 0.6);
  }
  score = Math.max(0, Math.min(1, score));
  const highU = thermalU.filter((u) => u === 'high').length;
  const thermal = {
    uncertainty: (highU > thermalU.length / 3 ? 'high' : thermalU.some((u) => u !== 'low') ? 'moderate' : 'low') as 'low' | 'moderate' | 'high',
    flow: summarizeFlows(flows),
  };
  if (avgSpeed < 3) notes.push('Near-calm winds: scent will follow terrain/thermals and may swirl.');
  if (maxGust > 25) notes.push(`Gusts to ${Math.round(maxGust)} mph forecast — swirling scent, noisy woods; check stand safety.`);
  const risk = score >= 0.7 ? 'low' : score >= 0.38 ? 'moderate' : 'high';
  if (risk === 'high' && worstHour) notes.push('Forecast wind carries scent toward the hypothesised deer approach/bedding side for much of this session.');
  return { windFromDegrees: Math.round(mean!), speedMph: Math.round(avgSpeed), scentDownwindDegrees: Math.round(downwindBearing(mean!)), variabilityDeg: spread == null ? null : Math.round(spread), risk, score, notes, thermal };
}

function summarizeFlows(flows: string[]): string {
  const uniq = [...new Set(flows)];
  if (uniq.length === 1) return uniq[0];
  return uniq.join(' → ');
}
