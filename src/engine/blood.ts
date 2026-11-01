// Blood trails: blood pins in the order you dropped them, split into separate trails when hours pass between drops.
import type { UserPin } from './types';
import { haversine } from './geography';

export const TRAIL_GAP_MS = 12 * 3600000; // a drop more than 12 h after the last one starts a new trail
export const ACTIVE_MS = 24 * 3600000; // a trail stays "being tracked" for a day after its last drop

export interface BloodTrail {
  id: string; // id of the first drop
  drops: Array<Pick<UserPin, 'id' | 'coord' | 'created'>>;
  lengthM: number;
  start: number;
  end: number;
}

export function bloodTrails(pins: Array<Pick<UserPin, 'id' | 'kind' | 'coord' | 'created'> & { workspace?: string }>, workspace?: string): BloodTrail[] {
  const drops = pins
    .filter((p) => p.kind === 'blood' && (workspace == null || p.workspace == null || p.workspace === workspace))
    .map((p) => ({ id: p.id, coord: p.coord, created: p.created, t: Date.parse(p.created) || 0 }))
    .sort((a, b) => a.t - b.t);
  const trails: BloodTrail[] = [];
  for (const d of drops) {
    const cur = trails[trails.length - 1];
    if (cur && d.t - cur.end <= TRAIL_GAP_MS) {
      cur.lengthM += haversine(cur.drops[cur.drops.length - 1].coord, d.coord);
      cur.drops.push({ id: d.id, coord: d.coord, created: d.created });
      cur.end = d.t;
    } else trails.push({ id: d.id, drops: [{ id: d.id, coord: d.coord, created: d.created }], lengthM: 0, start: d.t, end: d.t });
  }
  return trails;
}

/** The trail you are on right now: the latest one, if its last drop was within a day. */
export function activeTrail(trails: BloodTrail[], now = Date.now()): BloodTrail | null {
  const last = trails[trails.length - 1];
  return last && now - last.end <= ACTIVE_MS ? last : null;
}
