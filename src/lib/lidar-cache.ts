// Lidar walk-ins and outlines kept on this device so they show at once next time (and offline). Club results are
// derived from a private boundary, so they are stored per club and cleared on sign-out with the rest of the club cache.
import type { ZoneRefinement } from '../engine/lidar';

const PREFIX = 'bh.lidar.v1.';
const MAX_PUBLIC = 60;
export const clubLidarKey = (clubId: string) => `club.${clubId}`;

interface Stored { key?: string; at: number; zones: Record<string, ZoneRefinement & { at?: number }> }

const read = (scope: string): Stored | null => { try { return JSON.parse(localStorage.getItem(PREFIX + scope) ?? 'null'); } catch { return null; } };

/** Cached results for `scope`; with `key`, only if they were computed for exactly that set of zones. */
export function readLidarCache(scope: string, key?: string): Record<string, ZoneRefinement> {
  const s = read(scope);
  if (!s || (key != null && s.key !== key)) return {};
  return s.zones;
}

/** Club scopes are replaced as a whole (with their key); the public scope accumulates, newest kept. */
export function writeLidarCache(scope: string, zones: Record<string, ZoneRefinement>, key?: string) {
  try {
    let next: Stored;
    if (key != null) next = { key, at: Date.now(), zones };
    else {
      const all = { ...(read(scope)?.zones ?? {}), ...Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, { ...v, at: Date.now() }])) };
      const keep = Object.entries(all).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, MAX_PUBLIC);
      next = { at: Date.now(), zones: Object.fromEntries(keep) };
    }
    localStorage.setItem(PREFIX + scope, JSON.stringify(next));
  } catch { /* storage full or blocked: results just won't persist */ }
}

export function clearClubLidarCache() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX + 'club.')) localStorage.removeItem(k); } catch { /* ignore */ }
}
