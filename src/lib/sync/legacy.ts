// Data kept by earlier versions of the app, one localStorage key per feature. Read once, when a device first
// becomes a guest of the new store, so nothing a hunter already logged is lost.
import type { Json, JournalEntry, LandWire, PinDoc, UserState } from '../models';
import { landToWire } from '../models';
import type { LandDoc } from '../models';

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}

export function legacyState(): Partial<UserState> {
  const out: Partial<UserState> = {};
  const journal = read<JournalEntry[]>('bh.journal.v1');
  if (journal?.length) out.journal = Object.fromEntries(journal.map((e) => [e.id, e])) as unknown as UserState['journal'];
  const pins = read<PinDoc[]>('bh.pins.v1');
  if (pins?.length) out.pins = Object.fromEntries(pins.map((p) => [p.id, p])) as unknown as UserState['pins'];
  const prefs: Record<string, Json> = {};
  const hunt = localStorage.getItem('bh.prefs.v1'); if (hunt) prefs.hunt = hunt;
  const base = read<string>('bh.base.v1'); if (base) prefs.base = base;
  if (Object.keys(prefs).length) out.prefs = prefs as UserState['prefs'];
  // a boundary imported with the previous version
  const club = read<{ name: string; geometry: LandDoc['geometry']; saved?: string }>('bh.club.v1');
  if (club?.geometry) {
    const land: LandWire = landToWire({ id: 'imported', name: club.name || 'My club', kind: 'club', pack: 'club', deerZone: 'C', geometry: club.geometry, acres: 0, created: Date.now() } as LandDoc);
    out.lands = { imported: land };
  }
  return out;
}
