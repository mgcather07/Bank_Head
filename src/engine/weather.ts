// WeatherService — Open-Meteo forecast API (no key, called directly from the browser) with a
// localStorage cache whose age is always surfaced. NWS active alerts are fetched separately.
import type { DailyWeather, HourlyWeather, WeatherAlert, WeatherBundle } from './types';
import { localDate } from './time';

const HOURLY = ['temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'precipitation_probability', 'cloud_cover', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'weather_code'];
const DAILY = ['sunrise', 'sunset', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max', 'wind_direction_10m_dominant'];
export const CACHE_TTL_MS = 30 * 60 * 1000;
export const STALE_MS = 3 * 3600 * 1000;
const KEY = 'bh.weather.v1';

export function openMeteoUrl(lat: number, lon: number) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: HOURLY.join(','),
    daily: DAILY.join(','),
    timezone: 'America/Chicago',
    timeformat: 'unixtime',
    wind_speed_unit: 'mph',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    past_days: '1',
    forecast_days: '8',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

type Num = number | null | undefined;
const n = (v: Num) => (v == null || Number.isNaN(v) ? null : v);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseOpenMeteo(j: any, lat: number, lon: number, fetchedAt: number): WeatherBundle {
  if (!j?.hourly?.time) throw new Error('Open-Meteo response missing hourly data');
  const H = j.hourly;
  const hourly: HourlyWeather[] = H.time.map((t: number, i: number) => ({
    time: t * 1000,
    tempF: n(H.temperature_2m?.[i]),
    feelsF: n(H.apparent_temperature?.[i]),
    humidity: n(H.relative_humidity_2m?.[i]),
    precipIn: n(H.precipitation?.[i]),
    precipProb: n(H.precipitation_probability?.[i]),
    cloud: n(H.cloud_cover?.[i]),
    pressureHpa: n(H.pressure_msl?.[i]),
    windMph: n(H.wind_speed_10m?.[i]),
    windFrom: n(H.wind_direction_10m?.[i]),
    gustMph: n(H.wind_gusts_10m?.[i]),
    code: n(H.weather_code?.[i]),
  }));
  const D = j.daily ?? { time: [] };
  const daily: DailyWeather[] = D.time.map((t: number, i: number) => ({
    date: localDate(t * 1000 + 12 * 3600000),
    sunrise: D.sunrise?.[i] ? D.sunrise[i] * 1000 : null,
    sunset: D.sunset?.[i] ? D.sunset[i] * 1000 : null,
    tMaxF: n(D.temperature_2m_max?.[i]),
    tMinF: n(D.temperature_2m_min?.[i]),
    precipIn: n(D.precipitation_sum?.[i]),
    windMaxMph: n(D.wind_speed_10m_max?.[i]),
    windDominant: n(D.wind_direction_10m_dominant?.[i]),
  }));
  const now = Date.now();
  const current = hourly.reduce<HourlyWeather | null>((best, h) => (h.time <= now && (!best || h.time > best.time) ? h : best), null);
  return { source: 'open-meteo', model: 'Open-Meteo best-match (NOAA GFS/HRRR blend for CONUS)', lat, lon, fetchedAt, fromCache: false, hourly, daily, current };
}

function readCache(lat: number, lon: number): WeatherBundle | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as WeatherBundle;
    if (Math.abs(b.lat - lat) > 0.05 || Math.abs(b.lon - lon) > 0.05) return null;
    return { ...b, fromCache: true };
  } catch {
    return null;
  }
}

export async function getWeather(lat: number, lon: number, opts: { force?: boolean; fetchImpl?: typeof fetch } = {}): Promise<{ bundle: WeatherBundle | null; error: string | null }> {
  const cached = readCache(lat, lon);
  if (cached && !opts.force && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { bundle: cached, error: null };
  try {
    const r = await (opts.fetchImpl ?? fetch)(openMeteoUrl(lat, lon), { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const bundle = parseOpenMeteo(await r.json(), lat, lon, Date.now());
    try {
      localStorage.setItem(KEY, JSON.stringify(bundle));
    } catch {
      /* storage full / private mode */
    }
    return { bundle, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { bundle: cached, error: cached ? `Live weather unavailable (${msg}); showing cached forecast.` : `Weather unavailable: ${msg}` };
  }
}

export async function getAlerts(lat: number, lon: number): Promise<{ alerts: WeatherAlert[]; error: string | null }> {
  try {
    const r = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, { headers: { Accept: 'application/geo+json' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`NWS HTTP ${r.status}`);
    const j = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { alerts: (j.features ?? []).map((f: any) => ({ event: f.properties.event, severity: f.properties.severity, headline: f.properties.headline, expires: f.properties.expires ?? null })), error: null };
  } catch (e) {
    return { alerts: [], error: `Severe-weather alerts could not be checked (${e instanceof Error ? e.message : e}).` };
  }
}

export function hoursBetween(b: WeatherBundle | null, start: number, end: number): HourlyWeather[] {
  if (!b) return [];
  return b.hourly.filter((h) => h.time >= start - 30 * 60000 && h.time <= end);
}

export function dataAge(b: WeatherBundle | null): { minutes: number | null; stale: boolean } {
  if (!b) return { minutes: null, stale: true };
  const m = Math.round((Date.now() - b.fetchedAt) / 60000);
  return { minutes: m, stale: Date.now() - b.fetchedAt > STALE_MS };
}

export const hpaToInHg = (h: number | null) => (h == null ? null : h * 0.02953);

const WMO: Record<number, string> = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ hail' };
export const weatherText = (code: number | null) => (code == null ? '—' : WMO[code] ?? `Code ${code}`);

/** Pressure trend over the 3 hours ending at t (hPa). */
export function pressureTrend(b: WeatherBundle | null, t: number): number | null {
  if (!b) return null;
  const at = (x: number) => b.hourly.reduce<HourlyWeather | null>((best, h) => (Math.abs(h.time - x) < (best ? Math.abs(best.time - x) : Infinity) ? h : best), null);
  const a = at(t - 3 * 3600000), c = at(t);
  if (a?.pressureHpa == null || c?.pressureHpa == null) return null;
  return c.pressureHpa - a.pressureHpa;
}
