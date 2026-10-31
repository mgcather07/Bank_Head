// Workspaces — the places a login can hunt: the two public areas, the shared clubs it belongs to, and any private land in the account.
import type { Candidate, HuntPreferences, LegalEvaluation } from '../engine/types';
import type { LandDoc } from './models';
import type { Club } from './clubs';
import { clubCenter } from '../engine/club';
import { evaluateLegal } from '../engine/regulations';
import { BANKHEAD_CENTER } from '../engine/time';
import { inStudyArea } from '../engine/config';

export type WorkspaceKind = 'wma' | 'nf' | 'land';
export interface Workspace {
  id: string;
  kind: WorkspaceKind;
  name: string;
  short: string;
  blurb: string;
  private: boolean;
  land?: LandDoc;
  /** Set for a shared club (members, invitations and this account's role). */
  club?: Club;
}

export const WMA: Workspace = { id: 'wma', kind: 'wma', name: 'Black Warrior WMA', short: 'WMA', blurb: 'Public · AREA permit · Zones A and B', private: false };
export const NF: Workspace = { id: 'nf', kind: 'nf', name: 'National Forest', short: 'Forest', blurb: 'Public · statewide seasons · Zones C and D', private: false };

export const landWorkspace = (l: LandDoc): Workspace => ({ id: `land:${l.id}`, kind: 'land', name: l.name, short: l.name.length > 18 ? `${l.name.slice(0, 16)}…` : l.name, blurb: `Private · ${l.acres ? `${Math.round(l.acres)} acres · ` : ''}Deer Zone ${l.deerZone}`, private: true, land: l });

export const clubWorkspace = (c: Club): Workspace => {
  const n = c.members.length;
  return { ...landWorkspace(c.land), id: `club:${c.id}`, blurb: `Private club · ${Math.round(c.land.acres)} acres · ${n} member${n === 1 ? '' : 's'}`, club: c };
};

/** Public areas, then clubs, then personal land (a personal copy of a land that is now a shared club is left out). */
export const workspacesFor = (lands: LandDoc[], clubs: Club[] = []): Workspace[] => [WMA, NF, ...clubs.map(clubWorkspace), ...lands.filter((l) => !clubs.some((c) => c.id === l.id || c.land.name.trim().toLowerCase() === l.name.trim().toLowerCase())).map(landWorkspace)];

export function resolveWorkspace(id: string | undefined, lands: LandDoc[], clubs: Club[] = []): Workspace {
  const all = workspacesFor(lands, clubs);
  // land:<id> was the id before the land became a shared club
  const alias = id?.startsWith('land:') ? `club:${id.slice(5)}` : null;
  return all.find((w) => w.id === id) ?? all.find((w) => w.id === alias) ?? WMA;
}

/** Where weather and sunrise are computed for this workspace. */
export function workspaceCenter(ws: Workspace, start: HuntPreferences['start']): [number, number] {
  if (ws.land) return clubCenter(ws.land.geometry);
  return inStudyArea(start) ? start! : BANKHEAD_CENTER;
}

/** The zones this workspace shows (private lands generate their own). */
export function filterCandidates(ws: Workspace, all: Candidate[]): Candidate[] {
  if (ws.kind === 'wma') return all.filter((c) => c.properties.jurisdiction === 'black_warrior_wma');
  if (ws.kind === 'nf') return all.filter((c) => c.properties.jurisdiction === 'nf_outside_wma');
  return all;
}

/** The rules that apply anywhere in the workspace on a date, used for banners and the outlook. */
export function legalProbes(ws: Workspace, date: string, prefs: Pick<HuntPreferences, 'weapon' | 'target' | 'youthHunter'>): LegalEvaluation[] {
  const base = { date, weapon: prefs.weapon, target: prefs.target, youthHunter: prefs.youthHunter };
  if (ws.kind === 'wma') return [evaluateLegal({ ...base, jurisdiction: 'black_warrior_wma', zone: 'A' }), evaluateLegal({ ...base, jurisdiction: 'black_warrior_wma', zone: 'B' })];
  if (ws.kind === 'nf') return [evaluateLegal({ ...base, jurisdiction: 'nf_outside_wma', zone: null, deerZone: 'D' }), evaluateLegal({ ...base, jurisdiction: 'nf_outside_wma', zone: null, deerZone: 'C' })];
  return [evaluateLegal({ ...base, jurisdiction: 'private_club', zone: null, deerZone: ws.land?.deerZone ?? 'C' })];
}

/** Dates (inclusive) of the youth gun hunt for this workspace, for the one-tap "taking a kid" prompt. */
export function youthWindow(ws: Workspace): [string, string] | null {
  if (ws.kind === 'wma') return ['2026-10-31', '2026-11-01'];
  if (ws.kind === 'nf') return ['2026-10-30', '2026-11-02'];
  return ws.land?.deerZone === 'C' ? ['2026-11-13', '2026-11-16'] : null;
}
