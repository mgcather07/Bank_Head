// Open-Meteo historical archive (free): 10-year daily normals for the hunt date window, and past-day weather for journal auto-fill.
import { localDate } from './time';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const KEY = 'bh.normals.v1';
const NORMAL_YEARS = 10;

export interface Normals {
  lat: number;
  lon: number;
  fetchedAt: number;
  years: number;
  /** keyed by MM-DD → mean of daily tmax/tmin (°F) over ±7-day window across the years */
  byDay: Record<string, { tMax: number; tMin: number; n: number }>;
}

const mmdd = (d: string) => d.slice(5);

export async function getNormals(lat: number, lon: number, fetchImpl: typeof fetch = fetch): Promise<Normals | null> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const n = JSON.parse(raw) as Normals;
      if (Math.abs(n.lat - lat) < 0.1 && Math.abs(n.lon - lon) < 0.1 && Date.now() - n.fetchedAt < 30 * 86400000) return n;
    }
  } catch { /* ignore */ }
  const thisYear = Number(localDate().slice(0, 4));
  const p = new URLSearchParams({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), start_date: `${thisYear - NORMAL_YEARS}-01-01`, end_date: `${thisYear - 1}-12-31`, daily: 'temperature_2m_max,temperature_2m_min', timezone: 'America/Chicago', temperature_unit: 'fahrenheit' });
  try {
    const r = await fetchImpl(`${ARCHIVE}?${p}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const days: string[] = j.daily.time, tx: (number | null)[] = j.daily.temperature_2m_max, tn: (number | null)[] = j.daily.temperature_2m_min;
    // accumulate per MM-DD, then smooth with a ±7-day window
    const acc: Record<string, { x: number; n: number; m: number }> = {};
    days.forEach((d, i) => { if (tx[i] == null || tn[i] == null) return; const k = mmdd(d); (acc[k] ??= { x: 0, n: 0, m: 0 }); acc[k].x += tx[i]!; acc[k].m += tn[i]!; acc[k].n++; });
    const keys = Object.keys(acc).sort();
    const byDay: Normals['byDay'] = {};
    keys.forEach((k, i) => {
      let x = 0, m = 0, n = 0;
      for (let o = -7; o <= 7; o++) { const kk = keys[(i + o + keys.length) % keys.length]; x += acc[kk].x; m += acc[kk].m; n += acc[kk].n; }
      byDay[k] = { tMax: x / n, tMin: m / n, n };
    });
    const out: Normals = { lat, lon, fetchedAt: Date.now(), years: NORMAL_YEARS, byDay };
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* ignore */ }
    return out;
  } catch {
    return null;
  }
}

export function normalFor(n: Normals | null, date: string) {
  return n?.byDay[mmdd(date)] ?? null;
}

export interface PastDay { date: string; tMaxF: number | null; tMinF: number | null; precipIn: number | null; windMaxMph: number | null; windDominant: number | null; summary: string }

/** Weather for a past local date (archive API; data lags ~5 days, so recent days come from the forecast API's past_days instead). */
export async function getPastDay(lat: number, lon: number, date: string, fetchImpl: typeof fetch = fetch): Promise<PastDay | null> {
  const ageDays = (Date.parse(localDate()) - Date.parse(date)) / 86400000;
  const base = ageDays <= 6 ? 'https://api.open-meteo.com/v1/forecast' : ARCHIVE;
  const p = new URLSearchParams({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant', timezone: 'America/Chicago', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' });
  if (ageDays <= 6) { p.set('past_days', '7'); p.set('forecast_days', '1'); } else { p.set('start_date', date); p.set('end_date', date); }
  try {
    const r = await fetchImpl(`${base}?${p}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const i = (j.daily.time as string[]).indexOf(date);
    if (i < 0) return null;
    const d = j.daily;
    const dir = d.wind_direction_10m_dominant?.[i];
    const c = dir == null ? '—' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(dir / 45) % 8];
    const out: PastDay = { date, tMaxF: d.temperature_2m_max?.[i] ?? null, tMinF: d.temperature_2m_min?.[i] ?? null, precipIn: d.precipitation_sum?.[i] ?? null, windMaxMph: d.wind_speed_10m_max?.[i] ?? null, windDominant: dir ?? null, summary: '' };
    out.summary = `${out.tMinF != null ? `${Math.round(out.tMinF)}–${Math.round(out.tMaxF ?? 0)}°F` : ''} · ${c} wind to ${Math.round(out.windMaxMph ?? 0)} mph · ${(out.precipIn ?? 0).toFixed(2)}" rain (Open-Meteo)`;
    return out;
  } catch {
    return null;
  }
}
