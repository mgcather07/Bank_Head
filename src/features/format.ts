import type { HuntPreferences, Session } from '../engine/types';
import { addDays, fmtDate, localDate, type SunDay } from '../engine/time';

export const SESSION_LABEL: Record<Session, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' };
export const mi = (m: number) => `${(m / 1609.34).toFixed(1)} mi`;

export const dayLabel = (d: string) => (d === localDate() ? 'Today' : d === addDays(localDate(), 1) ? 'Tomorrow' : fmtDate(d, { weekday: 'short' }));
export const dayShort = (d: string) => `${dayLabel(d)} ${fmtDate(d, { month: 'numeric', day: 'numeric' })}`;

export const SESSION_SHORT: Record<HuntPreferences['session'], string> = { morning: 'Morning', evening: 'Evening', midday: 'Midday', all: 'All day', compare: 'Best' };

/** "6h 19m of legal light left", or the wait until it starts. */
export function legalLightLeft(sun: SunDay, now = Date.now()): string | null {
  if (now < sun.legalStart) { const m = Math.round((sun.legalStart - now) / 60000); return m < 600 ? `Legal light in ${Math.floor(m / 60)}h ${m % 60}m` : null; }
  if (now > sun.legalEnd) return null;
  const m = Math.round((sun.legalEnd - now) / 60000);
  return `${Math.floor(m / 60)}h ${m % 60}m of legal light left`;
}
