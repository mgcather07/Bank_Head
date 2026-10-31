// Shapes stored per user in the Realtime Database (users/{uid}/…) and mirrored on the device.
import type { Polygon, MultiPolygon } from 'geojson';
import type { UserPin } from '../engine/types';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface JournalEntry {
  id: string;
  date: string;
  start: string;
  end: string;
  location: string;
  coord: [number, number] | null;
  candidateId?: string;
  method: string;
  weather: string;
  windObserved: string;
  deerSeen: number;
  behavior: string;
  harvest: 'none' | 'buck' | 'doe';
  pressure: 'none' | 'low' | 'moderate' | 'high';
  sign: string;
  notes: string;
  predictedScore?: number | null;
  draft?: boolean;
  created: string;
  /** The signed-in user who wrote it (the database path and rules enforce this). */
  owner?: string;
  /** Which workspace it was logged in (wma, nf, land:<id>). */
  workspace?: string;
  updatedAt?: number;
}

export type PinDoc = UserPin & { owner?: string; workspace?: string; updatedAt?: number };

/** A private piece of land in the user's account, as stored (boundary kept as a JSON string). */
export interface LandWire {
  name: string;
  kind: 'club' | 'lease' | 'private';
  /** Which public terrain data pack covers it (public/data/<pack>/). */
  pack: string;
  deerZone: 'C' | 'D';
  county?: string;
  geometryJson: string;
  acres: number;
  source?: string;
  created: number;
  updatedAt?: number;
}

export interface LandDoc extends Omit<LandWire, 'geometryJson'> {
  id: string;
  geometry: Polygon | MultiPolygon;
}

export interface Profile { name?: string; email: string; photoURL?: string; created?: number; lastSeen?: number }

export interface PrefsDoc {
  /** HuntPreferences as JSON. */
  hunt?: string;
  /** Layer toggles as JSON. */
  layers?: string;
  workspace?: string;
  base?: string;
  theme?: 'auto' | 'light' | 'dark';
  typeFilter?: string;
  onboarded?: boolean;
  updatedAt?: number;
}

export interface UserState {
  schema?: number;
  profile?: Profile;
  prefs?: PrefsDoc;
  journal?: Record<string, JournalEntry>;
  pins?: Record<string, PinDoc>;
  lands?: Record<string, LandWire>;
}

export const SCHEMA_VERSION = 1;

// ---- wire helpers ----
export function landFromWire(id: string, w: LandWire): LandDoc | null {
  try {
    const geometry = JSON.parse(w.geometryJson);
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) return null;
    const { geometryJson: _g, ...rest } = w;
    return { ...rest, id, geometry };
  } catch {
    return null;
  }
}

export function landToWire(l: LandDoc): LandWire {
  const { id: _id, geometry, ...rest } = l;
  return { ...rest, geometryJson: JSON.stringify(geometry) };
}

/** Realtime Database rejects undefined and drops nulls/empty arrays; strip them so a write is always valid. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (x !== undefined && x !== null) out[k] = clean(x);
    return out as T;
  }
  return v;
}

/** An entry read back from the database: restore the optional fields the app expects. */
export function normalizeJournal(id: string, e: Partial<JournalEntry>): JournalEntry {
  return {
    id, date: e.date ?? '', start: e.start ?? '', end: e.end ?? '', location: e.location ?? '', coord: e.coord ?? null, candidateId: e.candidateId,
    method: e.method ?? '', weather: e.weather ?? '', windObserved: e.windObserved ?? '', deerSeen: e.deerSeen ?? 0, behavior: e.behavior ?? '',
    harvest: e.harvest ?? 'none', pressure: e.pressure ?? 'none', sign: e.sign ?? '', notes: e.notes ?? '', predictedScore: e.predictedScore ?? null, draft: e.draft, created: e.created ?? '',
    owner: e.owner, workspace: e.workspace, updatedAt: e.updatedAt,
  };
}

export function normalizePin(id: string, p: Partial<PinDoc>): PinDoc {
  return { id, kind: p.kind ?? 'stand', coord: p.coord ?? [0, 0], note: p.note ?? '', created: p.created ?? '', candidateId: p.candidateId, owner: p.owner, workspace: p.workspace, updatedAt: p.updatedAt };
}

export const emailKey = (email: string) => email.trim().toLowerCase().replace(/\./g, ',');
