import * as SunCalc from 'suncalc';

export const TZ = 'America/Chicago';
export const BANKHEAD_CENTER: [number, number] = [-87.36, 34.33];

const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });

export function chicagoParts(t: number | Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday as string };
}

/** Local (America/Chicago) calendar date for an instant. */
export const localDate = (t: number | Date = Date.now()) => chicagoParts(t).date;

/** Offset (minutes) of America/Chicago from UTC at instant t. Handles DST. */
export function tzOffsetMinutes(t: number): number {
  const p = chicagoParts(t);
  const [y, m, d] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(t / 60000) * 60000) / 60000);
}

/** Epoch ms for a local wall-clock time in America/Chicago. */
export function chicagoTime(date: string, hour = 0, minute = 0): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let t = guess - tzOffsetMinutes(guess) * 60000;
  t = guess - tzOffsetMinutes(t) * 60000; // second pass resolves DST edges
  return t;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export const weekday = (date: string) => chicagoParts(chicagoTime(date, 12)).weekday;
export const isWeekend = (date: string) => ['Sat', 'Sun'].includes(weekday(date));

export function fmtTime(t: number | null | undefined): string {
  if (t == null || Number.isNaN(t)) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
}

export function fmtDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(new Date(chicagoTime(date, 12)));
}

export interface SunDay {
  date: string;
  sunrise: number;
  sunset: number;
  civilDawn: number;
  civilDusk: number;
  legalStart: number;
  legalEnd: number;
  solarNoon: number;
  moon: { phase: number; phaseName: string; illumination: number; rise: number | null; set: number | null };
}

const LEGAL_OFFSET_MIN = 30; // Alabama deer: 30 min before sunrise to 30 min after sunset

export function phaseName(p: number): string {
  if (p < 0.03 || p > 0.97) return 'New moon';
  if (p < 0.22) return 'Waxing crescent';
  if (p < 0.28) return 'First quarter';
  if (p < 0.47) return 'Waxing gibbous';
  if (p < 0.53) return 'Full moon';
  if (p < 0.72) return 'Waning gibbous';
  if (p < 0.78) return 'Last quarter';
  return 'Waning crescent';
}

export function sunDay(date: string, lon: number, lat: number): SunDay {
  const noon = new Date(chicagoTime(date, 12));
  const s = SunCalc.getTimes(noon, lat, lon);
  const mi = SunCalc.getMoonIllumination(noon);
  const mt = SunCalc.getMoonTimes(new Date(chicagoTime(date, 0)), lat, lon);
  return {
    date,
    sunrise: s.sunrise!.getTime(),
    sunset: s.sunset!.getTime(),
    civilDawn: s.dawn!.getTime(),
    civilDusk: s.dusk!.getTime(),
    legalStart: s.sunrise!.getTime() - LEGAL_OFFSET_MIN * 60000,
    legalEnd: s.sunset!.getTime() + LEGAL_OFFSET_MIN * 60000,
    solarNoon: s.solarNoon!.getTime(),
    moon: { phase: mi.phase, phaseName: phaseName(mi.phase), illumination: mi.fraction, rise: mt.rise ? mt.rise.getTime() : null, set: mt.set ? mt.set.getTime() : null },
  };
}

export interface SessionWindow {
  session: 'morning' | 'midday' | 'evening';
  start: number;
  end: number;
}

/** Hunt session windows. Morning: legal light → sunrise+4h. Evening: sunset−4h → legal end. Midday between. */
export function sessionWindows(sun: SunDay): Record<'morning' | 'midday' | 'evening', SessionWindow> {
  const H = 3600000;
  const morningEnd = sun.sunrise + 4 * H;
  const eveningStart = sun.sunset - 4 * H;
  return {
    morning: { session: 'morning', start: sun.legalStart, end: morningEnd },
    midday: { session: 'midday', start: morningEnd, end: Math.max(morningEnd, eveningStart) },
    evening: { session: 'evening', start: eveningStart, end: sun.legalEnd },
  };
}
