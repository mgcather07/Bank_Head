import { describe, expect, it } from 'vitest';
import type { Candidate } from '../engine/types';
import type { LandDoc } from './models';
import { filterCandidates, legalProbes, resolveWorkspace, workspaceCenter, workspacesFor, youthWindow, NF, WMA, TALLADEGA_WMAS } from './workspaces';
import { BANKHEAD_CENTER } from '../engine/time';
import { inClubBox } from '../engine/config';

const land: LandDoc = { id: 'club1', name: 'Pine Ridge Club', kind: 'club', pack: 'club', deerZone: 'C', geometry: { type: 'Polygon', coordinates: [[[-86.73, 33.76], [-86.72, 33.76], [-86.72, 33.77], [-86.73, 33.77], [-86.73, 33.76]]] }, acres: 250, created: 1 };
const cand = (jurisdiction: 'black_warrior_wma' | 'nf_outside_wma') => ({ geometry: { type: 'Polygon', coordinates: [] }, properties: { jurisdiction } }) as unknown as Candidate;
const prefs = { weapon: 'bow', target: 'any', youthHunter: false } as const;
const priv0 = (lands: LandDoc[]) => workspacesFor(lands).find((w) => w.private)!;

describe('workspaces', () => {
  it('lists the public areas first, then every private land in the account', () => {
    const ws = workspacesFor([land]);
    expect(ws.map((w) => w.id)).toEqual(['wma', 'nf', 'wma:choccolocco', 'wma:hollins', 'wma:oakmulgee', 'land:club1']);
    expect(ws[5]).toMatchObject({ kind: 'land', private: true, name: 'Pine Ridge Club' });
    expect(ws[5].blurb).toMatch(/250 acres.*Deer Zone C/);
    expect(workspacesFor([]).every((w) => !w.private)).toBe(true);
  });
  it('falls back to the WMA when a saved workspace no longer exists', () => {
    expect(resolveWorkspace('land:club1', [land]).land?.name).toBe('Pine Ridge Club');
    expect(resolveWorkspace('land:gone', [land])).toBe(WMA);
    expect(resolveWorkspace(undefined, [])).toBe(WMA);
  });
  it('shows only the zones that belong to the public workspace', () => {
    const all = [cand('black_warrior_wma'), cand('nf_outside_wma'), cand('nf_outside_wma')];
    expect(filterCandidates(WMA, all)).toHaveLength(1);
    expect(filterCandidates(NF, all)).toHaveLength(2);
  });
  it('centres weather on the right place', () => {
    expect(workspaceCenter(WMA, null)).toEqual(BANKHEAD_CENTER);
    expect(workspaceCenter(WMA, [-87.3, 34.2])).toEqual([-87.3, 34.2]);
    expect(workspaceCenter(WMA, [-86.7, 33.7])).toEqual(BANKHEAD_CENTER); // a start point outside the study area is ignored
    const c = workspaceCenter(priv0([land]), null);
    expect(inClubBox(c)).toBe(true);
    expect(c[0]).toBeCloseTo(-86.725, 3);
  });
  it('applies the rules of the workspace: WMA zones A and B, Forest zones D and C, private land its own zone', () => {
    expect(legalProbes(WMA, '2026-11-03', prefs)).toHaveLength(2);
    expect(legalProbes(NF, '2026-11-03', prefs)).toHaveLength(2);
    const priv = legalProbes(priv0([land]), '2026-11-03', prefs);
    expect(priv).toHaveLength(1);
    expect(priv[0].summary).toMatch(/private land/);
    // Zone C private land is archery only until the youth hunt
    expect(legalProbes(priv0([land]), '2026-11-03', { ...prefs, weapon: 'rifle' })[0].status).toBe('verified_prohibited');
    // an unmodelled private zone is never silently treated as legal
    expect(legalProbes(priv0([{ ...land, deerZone: 'D' }]), '2026-11-03', prefs)[0].status).toBe('requires_verification');
  });
  it('knows each workspace\'s youth gun weekend', () => {
    expect(youthWindow(WMA)).toEqual(['2026-10-31', '2026-11-01']);
    expect(youthWindow(NF)).toEqual(['2026-10-30', '2026-11-02']);
    expect(youthWindow(priv0([land]))).toEqual(['2026-11-13', '2026-11-16']);
    expect(youthWindow(priv0([{ ...land, deerZone: 'D' }]))).toBeNull();
  });
  it('adds the Talladega WMAs with their own data, centre, rules and youth weekend', () => {
    const [ch, ho, ok] = TALLADEGA_WMAS;
    expect(ch).toMatchObject({ id: 'wma:choccolocco', kind: 'wma', region: 'choccolocco', private: false });
    expect(resolveWorkspace('wma:hollins', [])).toBe(ho);
    const c = workspaceCenter(ok, null);
    expect(c[0]).toBeCloseTo(-87.40, 1);
    expect(c[1]).toBeCloseTo(32.93, 1);
    expect(workspaceCenter(ch, [-87.3, 34.2])).not.toEqual([-87.3, 34.2]); // a Bankhead start point doesn't move Choccolocco's weather
    expect(filterCandidates(ch, [cand('black_warrior_wma'), { ...cand('nf_outside_wma'), properties: { jurisdiction: 'state_wma' } } as unknown as Candidate])).toHaveLength(1);
    expect(legalProbes(ch, '2026-11-12', prefs)).toHaveLength(2);
    expect(legalProbes(ok, '2026-11-12', prefs)).toHaveLength(1);
    expect(youthWindow(ch)).toEqual(['2026-10-31', '2026-11-01']);
    expect(youthWindow(ho)).toEqual(['2026-11-14', '2026-11-15']);
  });
});
