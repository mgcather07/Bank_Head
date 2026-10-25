// PeakTimes — hour-by-hour opportunity across legal light for ONE zone (HuntStand/onX-style "peak times").
// Unlike generic solunar tables, each hour combines:
//   • expected deer movement (crepuscular peaks at dawn/dusk, rut midday lift) — general behavior, not site observations
//   • that hour's forecast wind vs. this zone's bedding/food sides
//   • weather for that hour (rain, wind strength)
//   • solunar major/minor periods — shown, but weighted lightly (minor, unvalidated factor)
import * as SunCalc from 'suncalc';
import type { Candidate, HourlyWeather, HuntPreferences, WeatherBundle } from './types';
import { chicagoTime, sunDay, type SunDay } from './time';
import { assessWind, compass } from './wind';
import { rutPhase } from './rut';

const H = 3600000;
export const PEAK_WEIGHTS = { movement: 0.55, wind: 0.3, weather: 0.1, solunar: 0.05 } as const;

export interface SolunarPeriod {
  kind: 'major' | 'minor';
  label: string;
  start: number;
  end: number;
}

export interface PeakHour {
  time: number; // start of hour slot (epoch ms)
  score: number; // 0-100, relative within the day
  movement: number; // 0..1
  wind: number | null; // 0..1, null when no forecast
  windFrom: number | null;
  windMph: number | null;
  tempF: number | null;
  solunar: 'major' | 'minor' | null;
  notes: string[];
}

export interface PeakWindow {
  start: number;
  end: number;
  score: number;
  why: string;
}

export interface PeakTimeline {
  sun: SunDay;
  hours: PeakHour[];
  peaks: PeakWindow[];
  solunar: SolunarPeriod[];
  hasForecast: boolean;
}

/** Moon upper/lower transits (major, ±1 h) and moonrise/moonset (minor, ±30 min) for a local date. */
export function solunarPeriods(date: string, lon: number, lat: number): SolunarPeriod[] {
  const start = chicagoTime(date, 0);
  const end = start + 24 * H;
  let maxAlt = -Infinity, minAlt = Infinity, upper = start, lower = start;
  for (let t = start; t <= end; t += 5 * 60000) {
    const alt = SunCalc.getMoonPosition(new Date(t), lat, lon).altitude;
    if (alt > maxAlt) { maxAlt = alt; upper = t; }
    if (alt < minAlt) { minAlt = alt; lower = t; }
  }
  const out: SolunarPeriod[] = [
    { kind: 'major', label: 'Moon overhead', start: upper - H, end: upper + H },
    { kind: 'major', label: 'Moon underfoot', start: lower - H, end: lower + H },
  ];
  const mt = SunCalc.getMoonTimes(new Date(start), lat, lon);
  if (mt.rise) out.push({ kind: 'minor', label: 'Moonrise', start: mt.rise.getTime() - H / 2, end: mt.rise.getTime() + H / 2 });
  if (mt.set) out.push({ kind: 'minor', label: 'Moonset', start: mt.set.getTime() - H / 2, end: mt.set.getTime() + H / 2 });
  return out.sort((a, b) => a.start - b.start);
}

const gauss = (x: number, sigma: number) => Math.exp(-(x * x) / (2 * sigma * sigma));

/** General whitetail movement curve: strong crepuscular peaks, low midday; rut lifts midday for bucks. */
export function movementAt(t: number, sun: SunDay, date: string, target: HuntPreferences['target']): number {
  const dawn = gauss((t - (sun.sunrise + 0.25 * H)) / H, 1.3);
  const dusk = gauss((t - (sun.sunset - 0.4 * H)) / H, 1.3);
  let m = Math.max(dawn, dusk * 0.97);
  const rut = rutPhase(date).phase;
  const midday = rut === 'rut' ? (target === 'mature_buck' ? 0.55 : 0.42) : rut === 'pre_rut' ? 0.3 : 0.22;
  m = Math.max(m, midday);
  return Math.min(1, m);
}

function hourAt(b: WeatherBundle | null, t: number): HourlyWeather | null {
  if (!b) return null;
  let best: HourlyWeather | null = null;
  for (const h of b.hourly) if (Math.abs(h.time - t) <= 30 * 60000 && (!best || Math.abs(h.time - t) < Math.abs(best.time - t))) best = h;
  return best;
}

export function peakTimeline(c: Candidate, date: string, prefs: HuntPreferences, weather: WeatherBundle | null): PeakTimeline {
  const p = c.properties;
  const sun = sunDay(date, p.center[0], p.center[1]);
  const solunar = solunarPeriods(date, p.center[0], p.center[1]);
  const route = p.routes?.[0];
  const first = Math.floor(sun.legalStart / (H / 2)) * (H / 2);
  const hours: PeakHour[] = [];
  let hasForecast = false;
  for (let t = first; t < sun.legalEnd; t += H / 2) {
    const mid = t + H / 4;
    const h = hourAt(weather, mid);
    const notes: string[] = [];
    const movement = movementAt(mid, sun, date, prefs.target);
    let wind: number | null = null;
    if (h && h.windFrom != null && h.windMph != null) {
      hasForecast = true;
      const w = assessWind({ session: mid < sun.solarNoon ? 'morning' : 'evening', hours: [h], sun, aspectDeg: p.aspectDeg, aspectStrength: p.aspectStrength, beddingBearing: p.beddingCoverBearing, foodBearing: p.foodWaterBearing, approachBearing: route?.approachBearing ?? null });
      wind = w.score;
      if (w.risk === 'high') notes.push(`${compass(h.windFrom)} wind pushes scent toward the bedding/food side`);
      else if (w.risk === 'low') notes.push(`${compass(h.windFrom)} wind works for this zone`);
      if (h.windMph < 3) notes.push('near calm — thermals control scent');
    }
    let wx = 0.6;
    if (h) {
      if ((h.precipIn ?? 0) > 0.1) { wx -= 0.4; notes.push('rain'); }
      else if ((h.precipProb ?? 0) >= 60) wx -= 0.15;
      if ((h.windMph ?? 0) > 18) { wx -= 0.3; notes.push('strong wind'); }
      else if ((h.windMph ?? 0) >= 4 && (h.windMph ?? 0) <= 12) wx += 0.15;
    }
    const sol = solunar.find((s) => mid >= s.start && mid <= s.end);
    const solv = sol?.kind === 'major' ? 1 : sol?.kind === 'minor' ? 0.6 : 0.2;
    if (sol) notes.push(`${sol.kind} solunar (${sol.label.toLowerCase()})`);
    if (Math.abs(mid - sun.sunrise) < 0.75 * H) notes.push('around sunrise');
    if (Math.abs(mid - sun.sunset) < 0.75 * H) notes.push('around sunset');
    const raw = PEAK_WEIGHTS.movement * movement + PEAK_WEIGHTS.wind * (wind ?? 0.5) + PEAK_WEIGHTS.weather * Math.max(0, Math.min(1, wx)) + PEAK_WEIGHTS.solunar * solv;
    hours.push({ time: t, score: Math.round(raw * 100), movement, wind, windFrom: h?.windFrom ?? null, windMph: h?.windMph ?? null, tempF: h?.tempF ?? null, solunar: sol?.kind ?? null, notes });
  }
  const peaks = findPeaks(hours).map((w) => ({ ...w, start: Math.max(w.start, sun.legalStart), end: Math.min(w.end, sun.legalEnd) }));
  return { sun, hours, peaks, solunar, hasForecast };
}

/** Best contiguous run in the morning half and in the evening half (slots within 8 pts of that half's best). */
export function findPeaks(hours: PeakHour[]): PeakWindow[] {
  if (!hours.length) return [];
  const noon = hours[0].time + (hours[hours.length - 1].time - hours[0].time) / 2;
  const halves = [hours.filter((h) => h.time < noon), hours.filter((h) => h.time >= noon)];
  const out: PeakWindow[] = [];
  for (const half of halves) {
    if (!half.length) continue;
    const best = Math.max(...half.map((h) => h.score));
    const bi = half.findIndex((h) => h.score === best);
    let a = bi, b = bi;
    while (a > 0 && half[a - 1].score >= best - 8) a--;
    while (b < half.length - 1 && half[b + 1].score >= best - 8) b++;
    const slice = half.slice(a, b + 1);
    const notes = [...new Set(slice.flatMap((h) => h.notes))];
    const firstWind = notes.find((n) => / wind /.test(n));
    const why = [...(firstWind ? [firstWind] : []), ...notes.filter((n) => !/ wind /.test(n))].slice(0, 3).join(' · ') || 'deer movement timing';
    out.push({ start: half[a].time, end: half[b].time + H / 2, score: best, why });
  }
  return out.sort((x, y) => y.score - x.score);
}
