// HuntPlan — turns an evaluated zone or checked spot into concrete instructions: verdict, timing,
// huntable winds, setup position, walk-in and leave-by time, legal reminders, what to confirm on the ground.
// Everything is derived from the recommendation's own (deterministic) inputs; nothing is invented.
import type { CandidateProps, HuntRecommendation, Session } from './types';
import type { PeakTimeline } from './peak';
import { compass, downwindBearing, exposure, angleDiff } from './wind';
import { fmtTime, sunDay, sessionWindows } from './time';
import { weaponLabel } from './regulations';

export interface PlanStep { key: string; title: string; lines: string[]; tone?: 'good' | 'warn' | 'bad' }
export interface HuntPlan { verdict: { label: string; tone: 'good' | 'warn' | 'bad'; why: string }; steps: PlanStep[] }

const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Wind directions (wind FROM) that keep scent off the hypothesised bedding and food/travel sides. */
export function huntableWinds(p: Pick<CandidateProps, 'beddingCoverBearing' | 'foodWaterBearing'>, session: Session = 'evening') {
  if (p.beddingCoverBearing == null && p.foodWaterBearing == null) return null;
  const wBed = session === 'evening' ? 1 : 0.9, wFood = session === 'morning' ? 0.75 : 0.6;
  const good: string[] = [], ok: string[] = [], bad: string[] = [];
  COMPASS16.forEach((name, k) => {
    const from = k * 22.5;
    const scent = downwindBearing(from);
    let e = 0;
    if (p.beddingCoverBearing != null) e = Math.max(e, wBed * exposure(scent, p.beddingCoverBearing));
    if (p.foodWaterBearing != null) e = Math.max(e, wFood * exposure(scent, p.foodWaterBearing));
    (e < 0.3 ? good : e < 0.62 ? ok : bad).push(name);
  });
  return { good, ok, bad };
}

/** Point `m` meters from `c` along `bearing` (spherical). */
export function offsetPoint(c: [number, number], bearing: number, m: number): [number, number] {
  const R = 6371008.8, br = (bearing * Math.PI) / 180, d = m / R;
  const lat1 = (c[1] * Math.PI) / 180, lon1 = (c[0] * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [+((lon2 * 180) / Math.PI).toFixed(6), +((lat2 * 180) / Math.PI).toFixed(6)];
}

export const SETUP_OFFSET_M = 55; // ≈ 60 yd

/**
 * Suggested setup location (the red ✕): ~60 yd downwind of the zone centre for the session's forecast wind, so scent
 * drifts away from where deer should travel. Without a forecast, it falls on the side away from bedding cover.
 * This is a starting point to scout from, not a verified tree.
 */
export function setupPoint(rec: HuntRecommendation): { coord: [number, number]; bearing: number; distanceM: number; basis: 'wind' | 'bedding' } | null {
  const w = rec.windAssessment;
  const p = rec.candidate;
  if (w.scentDownwindDegrees != null && w.risk !== 'unknown') return { coord: offsetPoint(p.center, w.scentDownwindDegrees, SETUP_OFFSET_M), bearing: w.scentDownwindDegrees, distanceM: SETUP_OFFSET_M, basis: 'wind' };
  if (p.beddingCoverBearing != null) { const b = (p.beddingCoverBearing + 180) % 360; return { coord: offsetPoint(p.center, b, SETUP_OFFSET_M), bearing: b, distanceM: SETUP_OFFSET_M, basis: 'bedding' }; }
  return null;
}

/** Walking time: 2.5 mph on road/trail, 1.2 mph off-trail, +1 min per 10 m of climb. */
export function walkMinutes(onNetworkM: number, offTrailM: number, gainM: number) {
  return Math.round(onNetworkM / 67 + offTrailM / 32 + gainM / 10);
}

const t = (ms: number) => fmtTime(ms);

export function buildHuntPlan(rec: HuntRecommendation, timeline: PeakTimeline | null, upcoming: Array<{ date: string; session: Session; score: number | null; windFrom: number | null; label: string }> = []): HuntPlan {
  const p = rec.candidate;
  const w = rec.windAssessment;
  const sun = sunDay(rec.huntDate, p.center[0], p.center[1]);
  const win = sessionWindows(sun)[rec.session];
  const steps: PlanStep[] = [];

  // ---- verdict ----
  let verdict: HuntPlan['verdict'];
  // weakest meaningful factor (ignore the 5% evidence slot and boilerplate caveats)
  const weakest = [...rec.components].filter((c) => c.weight >= 0.1).sort((a, b) => a.value - b.value)[0];
  const weakNote = weakest.negatives.find((n) => !/data unavailable|not verified|secondary source|No verified deer sign/i.test(n)) ?? weakest.negatives[0];
  if (rec.legalStatus === 'verified_prohibited') verdict = { label: "Don't hunt here on this date", tone: 'bad', why: rec.legal.summary };
  else if (rec.legalStatus === 'requires_verification') verdict = { label: 'Check the regulations first', tone: 'warn', why: rec.legal.summary };
  else if ((rec.score ?? 0) >= 70 && w.risk !== 'high') verdict = { label: `Good ${rec.session} sit`, tone: 'good', why: rec.reasons[0] ?? 'Terrain, wind and timing line up.' };
  else if (w.risk === 'high') verdict = { label: 'Wrong wind for this spot right now', tone: 'bad', why: w.notes[w.notes.length - 1] ?? 'Forecast wind carries scent toward where deer are expected.' };
  else if ((rec.score ?? 0) >= 50) verdict = { label: 'Huntable, with trade-offs', tone: 'warn', why: `Weakest factor — ${weakest.label.toLowerCase()}: ${weakNote ?? 'scores low'}` };
  else verdict = { label: 'Pass on it today', tone: 'bad', why: `Weakest factor — ${weakest.label.toLowerCase()}: ${weakNote ?? 'scores low'}` };

  // ---- when ----
  const when: string[] = [];
  const peak = timeline?.peaks.find((pk) => (rec.session === 'morning' ? pk.start < sun.solarNoon : rec.session === 'evening' ? pk.start >= sun.solarNoon : true)) ?? timeline?.peaks[0];
  const walkMin = rec.route ? walkMinutes(rec.route.onNetworkMeters, rec.route.offTrailMeters, rec.route.elevationGainMeters ?? 0) : null;
  if (rec.session === 'morning') {
    const settled = sun.legalStart - 20 * 60000;
    when.push(`Be in your setup by ${t(settled)} — 20 minutes before legal light (${t(sun.legalStart)}).`);
    if (walkMin != null) when.push(`Leave the truck by ${t(settled - (walkMin + 10) * 60000)} (≈${walkMin} min walk + 10 min to set up).`);
    when.push(`Stay until at least ${t(Math.min(win.end, sun.sunrise + 3 * 3600000))}.`);
  } else if (rec.session === 'evening') {
    const settle = Math.max(win.start, sun.sunset - 3 * 3600000);
    when.push(`Be settled by ${t(settle)}; hunt until legal light ends at ${t(sun.legalEnd)}.`);
    if (walkMin != null) when.push(`Leave the truck by ${t(settle - (walkMin + 10) * 60000)} (≈${walkMin} min walk). Plan the walk out in the dark — mark it as you go in.`);
  } else {
    when.push(`Midday sit: ${t(win.start)}–${t(win.end)}. Worth it mainly during the rut.`);
  }
  if (peak) when.push(`Peak window here: ${t(peak.start)}–${t(peak.end)} (${peak.why}).`);
  steps.push({ key: 'when', title: 'When', lines: when });

  // ---- wind ----
  const hw = huntableWinds(p, rec.session);
  const windLines: string[] = [];
  if (hw) {
    windLines.push(`Hunt this spot on a ${hw.good.length ? hw.good.join(', ') : hw.ok.slice(0, 4).join(', ')} wind${hw.good.length ? '' : ' (no direction is fully clean here)'}.`);
    if (hw.bad.length) windLines.push(`Avoid ${hw.bad.join(', ')} winds — they carry scent toward the bedding/food side.`);
  } else windLines.push('No bedding or food side could be derived here, so no wind is clearly better — keep the wind in your face toward where you expect deer.');
  if (w.windFromDegrees != null) windLines.push(`Forecast for this sit: ${compass(w.windFromDegrees)} ${w.speedMph ?? '?'} mph, scent drifting ${compass(w.scentDownwindDegrees)} — risk ${w.risk}${w.variabilityDeg != null && w.variabilityDeg > 45 ? `, shifting ±${w.variabilityDeg}°` : ''}.`);
  else windLines.push('No wind forecast available for this date yet.');
  if (w.thermal.uncertainty !== 'low') windLines.push(`Thermals: ${w.thermal.flow}. Early and late, cool air drains downhill toward the ${compass(p.aspectDeg)}; mid-day it rises toward the ${compass((p.aspectDeg + 180) % 360)}.`);
  steps.push({ key: 'wind', title: 'Wind', lines: windLines, tone: w.risk === 'high' ? 'bad' : w.risk === 'moderate' ? 'warn' : 'good' });

  // ---- setup ----
  const setup: string[] = [];
  const sp = setupPoint(rec);
  if (sp?.basis === 'wind') setup.push(`Red ✕ on the map (${sp.coord[1].toFixed(5)}, ${sp.coord[0].toFixed(5)}): set up about 60 yards ${compass(sp.bearing)} of the center so the ${compass(w.windFromDegrees)} wind carries your scent away from where deer should pass.`);
  else if (sp) setup.push(`Red ✕ on the map (${sp.coord[1].toFixed(5)}, ${sp.coord[0].toFixed(5)}): about 60 yards ${compass(sp.bearing)} of the center, on the side away from bedding cover. No wind forecast yet — re-check the morning of the hunt.`);
  if (p.beddingCoverBearing != null && p.foodWaterBearing != null && angleDiff(p.beddingCoverBearing, p.foodWaterBearing) > 60) setup.push(`Expect movement between the ${compass(p.beddingCoverBearing)} (bedding cover) and the ${compass(p.foodWaterBearing)} (bottoms/food); ${rec.session === 'morning' ? 'deer heading back toward bedding' : 'deer leaving bedding'} should cross near the spot.`);
  else if (p.beddingCoverBearing != null) setup.push(`Likely bedding cover is to the ${compass(p.beddingCoverBearing)} — face that way and keep your scent off it.`);
  if (p.meanSlopeDeg > 18) setup.push(`Ground is steep (avg ${p.meanSlopeDeg}°). ${rec.method === 'rifle' || rec.method === 'muzzleloader' ? 'Look for a spot with a long view across the slope.' : 'A climber needs a straight tree on a level spot — a saddle or hang-on may be easier.'}`);
  if (p.type === 'saddle' || p.label.startsWith('Ridge saddle')) setup.push('Sit just below the lowest point of the saddle on the downwind side, not in it.');
  if (p.type === 'bench' || p.label.startsWith('Side-hill bench')) setup.push('Deer often walk the bench edge; set up just above it on the downwind end.');
  if (p.type === 'bottom' || p.label.startsWith('Creek bottom')) setup.push('Watch crossings and the edge where the slope meets the bottom; cool air pools here at dawn and dusk.');
  setup.push(rec.method === 'bow' || rec.method === 'crossbow' ? 'Keep shots inside 30 yards — clear 2–3 shooting lanes toward the expected travel.' : 'Pick a spot with a clear field of fire and a known backstop.');
  steps.push({ key: 'setup', title: 'Setup', lines: setup });

  // ---- approach ----
  const app: string[] = [];
  if (rec.route) {
    const r = rec.route;
    app.push(`Park at ${r.name} (${r.coord[1].toFixed(5)}, ${r.coord[0].toFixed(5)}).`);
    if (r.routeKind === 'network+offtrail') app.push(`Walk ${(r.onNetworkMeters / 1609).toFixed(1)} mi along the mapped road/trail, then ${r.offTrailMeters} m off-trail to the spot (~${Math.round((r.elevationGainMeters ?? 0) * 3.28)} ft climb, ≈${walkMin} min).`);
    else app.push(`No mapped road or trail gets close — about ${(r.distanceMeters / 1609).toFixed(1)} mi cross-country (~${Math.round((r.elevationGainMeters ?? 0) * 3.28)} ft climb, ≈${walkMin} min). Scout this route in daylight first.`);
    const appr = p.routes.find((x) => x.accessPointId === r.verifiedAccessPointId)?.approachBearing ?? null;
    if (appr != null && p.beddingCoverBearing != null && angleDiff((appr + 180) % 360, p.beddingCoverBearing) < 50) app.push(`⚠ The direct walk-in comes from the bedding side. Swing wide and make your final approach from the ${compass(p.foodWaterBearing ?? (p.beddingCoverBearing + 180) % 360)}.`);
    else if (appr != null) app.push(`Final approach heading ${compass(appr)}${w.scentDownwindDegrees != null && exposure(w.scentDownwindDegrees, p.beddingCoverBearing ?? -999) > 0.5 ? ' — move slowly; your walk-in scent drifts toward bedding' : ''}.`);
    app.push(r.verification.includes('NOT verified') ? 'Confirm the pull-off is legal and the gate is open before you go.' : 'Parking is a known site; capacity is not verified.');
  } else app.push('No access route could be computed for this point.');
  if (p.wilderness) app.push('Sipsey Wilderness: no carts, ATVs or bikes — plan to pack out.');
  steps.push({ key: 'approach', title: 'Getting there', lines: app });

  // ---- legal ----
  const legal: string[] = [`${rec.legal.summary}`];
  if (rec.legal.bag) legal.push(`Bag: ${rec.legal.bag}.`);
  if (rec.legal.antlerRestriction) legal.push(rec.legal.antlerRestriction);
  legal.push(`Method: ${weaponLabel(rec.method)}. Check in with the Outdoor Alabama app or a daily permit; report harvest before leaving.`);
  for (const r of rec.legal.requirements.filter((x) => /check-station|orange/i.test(x))) legal.push(r);
  steps.push({ key: 'legal', title: 'Legal', lines: legal, tone: rec.legalStatus === 'verified_allowed' ? 'good' : rec.legalStatus === 'requires_verification' ? 'warn' : 'bad' });

  // ---- confirm on the ground ----
  steps.push({
    key: 'confirm', title: 'Confirm on the ground',
    lines: [
      'Fresh sign: rubs, scrapes, tracks and droppings on the travel line — log them as pins to raise confidence.',
      p.habitat.oak > 0.15 ? 'Whether white or red oaks are actually dropping acorns nearby.' : 'What deer are actually eating nearby (browse, acorns, green-up).',
      rec.method === 'bow' || rec.method === 'crossbow' ? 'A safe, straight tree (no dead limbs) for your stand — wear a harness and tether.' : 'A safe shooting position and backstop.',
      'Other hunters\' vehicles or flagging at the access — if crowded, use the next option below.',
    ],
  });

  // ---- better options ----
  const best = upcoming.filter((u) => u.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  if (best.length) steps.push({ key: 'better', title: 'Best times to hunt this spot (next 7 days)', lines: best.map((u) => `${u.label} — score ${u.score}${u.windFrom != null ? `, ${compass(u.windFrom)} wind` : ''}`) });

  return { verdict, steps };
}
