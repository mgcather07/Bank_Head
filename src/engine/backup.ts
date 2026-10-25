// Backup / restore of everything private on this device (pins, journal, preferences, saved areas).
import type { UserPin } from './types';
import type { JournalEntry } from '../store';

export interface Backup {
  app: 'bankhead-hunt-intelligence';
  version: 1;
  exported: string;
  pins: UserPin[];
  journal: JournalEntry[];
  prefs?: unknown;
  areas?: unknown;
}

export function makeBackup(pins: UserPin[], journal: JournalEntry[], prefs: unknown, areas: unknown): Backup {
  return { app: 'bankhead-hunt-intelligence', version: 1, exported: new Date().toISOString(), pins, journal, prefs, areas };
}

export function parseBackup(text: string): Backup {
  const j = JSON.parse(text) as Partial<Backup>;
  if (j.app !== 'bankhead-hunt-intelligence' || !Array.isArray(j.pins) || !Array.isArray(j.journal)) throw new Error('Not a Bankhead Hunt backup file.');
  return j as Backup;
}

/** Merge by id: items in the file that don't already exist are added; existing ones are kept. */
export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const have = new Set(current.map((x) => x.id));
  return [...current, ...incoming.filter((x) => !have.has(x.id))];
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export function pinsToGpx(pins: UserPin[]): string {
  const wpts = pins.map((p) => `  <wpt lat="${p.coord[1]}" lon="${p.coord[0]}"><name>${esc(p.kind.replace('_', ' '))}${p.candidateId ? ` ${esc(p.candidateId)}` : ''}</name><desc>${esc(p.note || '')}</desc><time>${p.created}</time><type>${esc(p.kind)}</type></wpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Bankhead Hunt Intelligence" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts}\n</gpx>`;
}

/** Minimal GPX waypoint import (lat/lon/name/type). */
export function gpxToPins(text: string): Array<Omit<UserPin, 'id' | 'created'>> {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const kinds = new Set(['stand', 'sighting', 'rub', 'scrape', 'trail', 'bedding', 'feeding', 'camera', 'parking', 'harvest', 'saved_candidate']);
  return [...doc.getElementsByTagName('wpt')].map((w) => {
    const type = (w.getElementsByTagName('type')[0]?.textContent ?? '').trim();
    const name = (w.getElementsByTagName('name')[0]?.textContent ?? '').trim();
    const kind = (kinds.has(type) ? type : kinds.has(name.split(' ')[0]) ? name.split(' ')[0] : 'stand') as UserPin['kind'];
    return { kind, coord: [Number(w.getAttribute('lon')), Number(w.getAttribute('lat'))] as [number, number], note: (w.getElementsByTagName('desc')[0]?.textContent ?? name).trim() };
  }).filter((p) => Number.isFinite(p.coord[0]) && Number.isFinite(p.coord[1]));
}

export function downloadText(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
