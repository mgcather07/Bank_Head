// The hunt controller: everything the screens share. It owns the active workspace, the ranked zones, the open zone,
// weather, lidar routes and spot checks, so the screens stay presentational.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { loadClubData, loadData, type AppData, type ClubData } from '../data';
import type { BaseMap, LayerToggles, SetupMarker, ZoneMark, ZoneTypeFilter } from '../map/MapView';
import type { SavedArea } from '../engine/offline';
import { cachedTileCount, downloadArea, removeArea, tilesFor } from '../engine/offline';
import { getPastDay } from '../engine/climate';
import { analyzeSpot, buildWalkNetwork, loadGrid, type WalkNetwork } from '../engine/spot';
import { buildClubNetwork, clubBounds, generateClubZones, hasTerrainData } from '../engine/club';
import { buildHuntPlan, setupPoint } from '../engine/plan';
import { buildRoadIndex, setPathIndex, setRoadIndex } from '../engine/roads';
import { lidarRoute } from '../engine/lidar';
import type { Candidate, HuntPreferences, HuntRecommendation, RouteOption, Session } from '../engine/types';
import { addDays, fmtDate, localDate, sessionWindows, sunDay } from '../engine/time';
import { hoursBetween } from '../engine/weather';
import { evaluateCandidate, rankCandidates, sessionsFor } from '../engine/scoring';
import { haversine, lookupClubJurisdiction, lookupJurisdiction } from '../engine/geography';
import { peakTimeline } from '../engine/peak';
import { evaluateLegal } from '../engine/regulations';
import { usePins, useLands, usePref } from '../lib/data';
import { useLocal } from '../lib/local';
import { uid } from '../lib/id';
import { filterCandidates, legalProbes, resolveWorkspace, workspaceCenter, workspacesFor, youthWindow, type Workspace } from '../lib/workspaces';
import { useWeatherData } from './useWeatherData';
import type { OutlookDay } from '../features/outlook/OutlookScreen';
import { DEFAULT_LAYERS } from '../features/explore/layers';

export const DEFAULT_PREFS: HuntPreferences = { date: localDate(), session: 'compare', weapon: 'bow', target: 'any', maxWalkMeters: 3200, stand: 'climber', effort: 'balanced', youthHunter: false, start: null };

export interface Notice { id: string; tone: 'info' | 'warn' | 'good'; title: string; body?: string; actions: Array<{ label: string; run: () => void; primary?: boolean }> }
export type Insets = { top: number; bottom: number; left: number; right: number };

export function useHuntController() {
  const lands = useLands();
  const { pins, add: addPin, remove: removePin } = usePins();
  const [huntStored, setHunt] = usePref<HuntPreferences>('hunt', DEFAULT_PREFS, { json: true });
  const prefs = useMemo(() => (huntStored.date < localDate() ? { ...huntStored, date: localDate() } : huntStored), [huntStored]);
  const setPrefs = useCallback((p: HuntPreferences) => setHunt(p), [setHunt]);
  const [base, setBase] = usePref<BaseMap>('base', 'topo');
  const [layers, setLayers] = usePref<LayerToggles>('layers', DEFAULT_LAYERS, { json: true });
  const [typeFilter, setTypeFilter] = usePref<ZoneTypeFilter>('typeFilter', 'all');
  const [workspaceId, setWorkspaceId] = usePref<string>('workspace', 'wma');
  const [areas, setAreas] = useLocal<SavedArea[]>('bh.areas.v1', []);

  // ---- data ----
  const [baseData, setBaseData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clubData, setClubData] = useState<ClubData | null>(null);
  const [clubError, setClubError] = useState<string | null>(null);
  useEffect(() => { loadData().then((d) => { setRoadIndex(buildRoadIndex(d.fsRoads, d.highways, d.osmRoads)); setPathIndex(buildRoadIndex(d.fsRoads, d.highways, d.osmRoads, d.trails)); setBaseData(d); }).catch((e) => setLoadError(String(e))); }, []);
  const needsClub = lands.some((l) => l.pack === 'club');
  useEffect(() => { if (needsClub && !clubData) loadClubData().then(setClubData).catch((e) => setClubError(`Could not load the terrain data for your land: ${e}`)); }, [needsClub, clubData]);

  // ---- workspace ----
  const workspaces = useMemo(() => workspacesFor(lands), [lands]);
  const workspace: Workspace = useMemo(() => resolveWorkspace(workspaceId, lands), [workspaceId, lands]);
  const land = workspace.land ?? null;
  const landReady = !land || !!clubData;

  const clubNet = useMemo(() => (land && clubData ? buildClubNetwork(clubData.roads, land.geometry, pins.filter((p) => p.kind === 'parking')) : null), [land, clubData, pins]);
  const landZones = useMemo<Candidate[]>(() => {
    if (!land || !clubData || !baseData) return [];
    setRoadIndex(buildRoadIndex(baseData.fsRoads, baseData.highways, baseData.osmRoads, clubData.roads));
    setPathIndex(buildRoadIndex(baseData.fsRoads, baseData.highways, baseData.osmRoads, baseData.trails, clubData.roads));
    return generateClubZones(clubData.grid, land.geometry, clubNet, baseData, { meta: { name: land.name, deerZone: land.deerZone } });
  }, [land, clubData, baseData, clubNet]);

  const data = useMemo<AppData | null>(() => {
    if (!baseData) return null;
    const contours = clubData ? { ...baseData.contours, features: [...baseData.contours.features, ...clubData.contours.features] } : baseData.contours;
    const streams = clubData ? { ...baseData.streams, features: [...baseData.streams.features, ...clubData.streams.features] } : baseData.streams;
    const candidates = land ? landZones : filterCandidates(workspace, baseData.candidates);
    const feats = candidates.map((c, i) => ({ type: 'Feature' as const, id: i + 1, geometry: c.geometry, properties: c.properties }));
    return { ...baseData, contours, streams, candidates, candidatesFc: { type: 'FeatureCollection', features: feats }, accessPoints: land ? { type: 'FeatureCollection', features: [] } : baseData.accessPoints };
  }, [baseData, clubData, land, landZones, workspace]);

  // ---- weather / sun ----
  const wxPoint = useMemo(() => workspaceCenter(workspace, prefs.start), [workspace, prefs.start]);
  const wx = useWeatherData(wxPoint);
  const { weather, normals } = wx;
  const sun = useMemo(() => sunDay(prefs.date, wxPoint[0], wxPoint[1]), [prefs.date, wxPoint[0], wxPoint[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- selection state ----
  const mapRef = useRef<MLMap | null>(null);
  const insets = useRef<Insets>({ top: 80, bottom: 200, left: 40, right: 40 });
  /** The screen reports how much of the map is covered (the sheet), so flights leave room around it. */
  const setInsets = useCallback((i: Insets) => { insets.current = i; }, []);
  const [selectedKey, setSelectedKey] = useState<{ id: string; session: Session; date: string } | null>(null);
  const [inspect, setInspect] = useState<[number, number] | null>(null);
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);
  const [gpsStatus, setGpsStatus] = useState('');
  const [pickingStart, setPickingStart] = useState(false);
  const [windHourIdx, setWindHourIdx] = useState(0);
  const [spots, setSpots] = useState<Candidate[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [pendingSpot, setPendingSpot] = useState<{ pt: [number, number]; date?: string; session?: Session } | null>(null);
  const [lidar, setLidar] = useState<Record<string, RouteOption | 'loading' | 'error' | 'none'>>({});
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const netRef = useRef<WalkNetwork | null>(null);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);

  // ---- ranking ----
  const ranked = useMemo(() => (data ? rankCandidates(data.candidates, { prefs: { ...prefs, session: 'compare' }, weather, pins, normals }, 5) : null), [data, prefs, weather, pins, normals]);
  const wanted = sessionsFor(prefs.session);
  const recs = useMemo(() => {
    if (!ranked) return [] as HuntRecommendation[];
    const seen = new Set<string>();
    return wanted.flatMap((s) => ranked.bySession[s]).filter((r) => typeFilter === 'all' || r.candidate.type === typeFilter).sort((a, b) => (a.legalStatus === b.legalStatus ? (b.score ?? -1) - (a.score ?? -1) : a.legalStatus === 'verified_allowed' ? -1 : 1)).filter((r) => (seen.has(r.areaId) ? false : (seen.add(r.areaId), true))).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, prefs.session, typeFilter]);
  const ratings = useMemo(() => ({ morning: ranked?.bySession.morning[0] ?? null, midday: ranked?.bySession.midday[0] ?? null, evening: ranked?.bySession.evening[0] ?? null }), [ranked]);

  const mapScores = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data) return m;
    for (const c of data.candidates) {
      let best: number | null = null;
      for (const s of wanted) {
        const r = evaluateCandidate(c, s, { prefs, weather, pins, normals });
        if (r.legalStatus === 'verified_prohibited') continue;
        if (r.score != null && (best == null || r.score > best)) best = r.score;
      }
      m.set(c.properties.id, best);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs, weather, pins, normals]);

  /** How each zone is drawn: dots sized by rank, the top five numbered. */
  const marks = useMemo(() => {
    const out = new Map<string, ZoneMark>();
    if (!data) return out;
    const order = data.candidates.map((c) => ({ id: c.properties.id, type: c.properties.type, s: mapScores.get(c.properties.id) ?? null })).filter((x) => x.s != null && (typeFilter === 'all' || x.type === typeFilter)).sort((a, b) => (b.s! - a.s!));
    order.forEach((x, i) => out.set(x.id, { score: x.s, rank: null, tier: i < 12 ? 1 : i < 70 ? 2 : 3 }));
    recs.forEach((r, i) => out.set(r.areaId, { score: mapScores.get(r.areaId) ?? r.score, rank: i + 1, tier: 1 }));
    for (const c of data.candidates) if (!out.has(c.properties.id)) out.set(c.properties.id, { score: null, rank: null, tier: 3 });
    return out;
  }, [data, mapScores, recs, typeFilter]);

  const findCand = useCallback((id: string) => {
    const c = data?.candidates.find((x) => x.properties.id === id) ?? spots.find((x) => x.properties.id === id) ?? null;
    const lr = lidar[id];
    return c && lr && typeof lr === 'object' ? { ...c, properties: { ...c.properties, routes: [lr, ...c.properties.routes.filter((r) => r.routeKind !== 'lidar')] } } : c;
  }, [data, spots, lidar]);
  const selected = useMemo<HuntRecommendation | null>(() => {
    if (!selectedKey || !data) return null;
    const c = findCand(selectedKey.id);
    return c ? evaluateCandidate(c, selectedKey.session, { prefs: { ...prefs, date: selectedKey.date }, weather, pins, normals }) : null;
  }, [selectedKey, data, prefs, weather, pins, normals, findCand]);
  const selectedCompare = useMemo(() => {
    if (!selectedKey || !data) return {};
    const c = findCand(selectedKey.id);
    if (!c) return {};
    return Object.fromEntries((['morning', 'midday', 'evening'] as Session[]).map((s) => [s, evaluateCandidate(c, s, { prefs: { ...prefs, date: selectedKey.date }, weather, pins, normals })])) as Partial<Record<Session, HuntRecommendation>>;
  }, [selectedKey, data, prefs, weather, pins, normals, findCand]);
  const timeline = useMemo(() => {
    if (!selectedKey || !data) return null;
    const c = findCand(selectedKey.id);
    return c ? peakTimeline(c, selectedKey.date, prefs, weather) : null;
  }, [selectedKey, data, prefs, weather, findCand]);
  const plan = useMemo(() => {
    if (!selected || !selectedKey) return null;
    const c = findCand(selectedKey.id);
    if (!c) return null;
    const today = localDate();
    const upcoming = Array.from({ length: 7 }, (_, i) => addDays(today, i)).flatMap((date) => (['morning', 'evening'] as Session[]).map((session) => {
      const r = evaluateCandidate(c, session, { prefs: { ...prefs, date }, weather, pins, normals });
      return { date, session, score: r.legalStatus === 'verified_prohibited' ? null : r.score, windFrom: r.windAssessment.windFromDegrees, label: `${fmtDate(date, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${session === 'morning' ? 'morning' : 'evening'}` };
    }));
    return buildHuntPlan(selected, timeline, upcoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, timeline]);
  const setups = useMemo<SetupMarker[]>(() => {
    const out: SetupMarker[] = [];
    const add = (r: HuntRecommendation, primary: boolean) => {
      if (r.legalStatus === 'verified_prohibited') return;
      const sp = setupPoint(r);
      if (sp && !out.some((m) => m.id === r.areaId)) out.push({ id: r.areaId, coord: sp.coord, primary, label: r.candidate.label });
    };
    if (selected) add(selected, true); else recs.slice(0, 3).forEach((r) => add(r, false));
    return out;
  }, [selected, recs]);
  const windHour = useMemo(() => {
    if (!selected) return null;
    const w = sessionWindows(sunDay(selected.huntDate, selected.center[0], selected.center[1]))[selected.session];
    const hrs = hoursBetween(weather, w.start, w.end);
    const h = hrs[Math.min(windHourIdx, hrs.length - 1)];
    return h && h.windFrom != null ? { from: h.windFrom, downwind: (h.windFrom + 180) % 360 } : null;
  }, [selected, weather, windHourIdx]);

  // ---- legal / notices ----
  const legalOnMap = useMemo(() => [...mapScores.values()].filter((v) => v != null).length, [mapScores]);
  const probe = useCallback((date: string) => legalProbes(workspace, date, prefs), [workspace, prefs]);
  const outlook = useMemo<OutlookDay[]>(() => {
    if (!data) return [];
    const today = localDate();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const ctx = { prefs: { ...prefs, date }, weather, pins, normals };
      const m = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'morning' } }, 1);
      const e = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'evening' } }, 1);
      const sel = selectedKey ? findCand(selectedKey.id) : null;
      const dw = weather?.daily.find((d) => d.date === date);
      return { date, sun: sunDay(date, wxPoint[0], wxPoint[1]), morning: m.recommendations[0] ?? null, evening: e.recommendations[0] ?? null, compareMorning: sel ? evaluateCandidate(sel, 'morning', ctx) : null, compareEvening: sel ? evaluateCandidate(sel, 'evening', ctx) : null, tMax: dw?.tMaxF ?? null, tMin: dw?.tMinF ?? null, precip: dw?.precipIn ?? null, windDom: dw?.windDominant ?? null, windMax: dw?.windMaxMph ?? null, legal: probe(date)[0] };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs, weather, pins, selectedKey, normals, probe]);

  const notices = useMemo<Notice[]>(() => {
    const out: Notice[] = [];
    if (data && legalOnMap === 0) {
      let opens: string | null = null;
      for (let i = 1; i <= 150 && !opens; i++) { const d = addDays(prefs.date, i); if (probe(d).some((r) => r.status === 'verified_allowed')) opens = d; }
      const why = probe(prefs.date)[0].summary.replace(/ on \d{4}-\d{2}-\d{2}/, '');
      const weaponName = ({ bow: 'Bow', crossbow: 'Crossbow', rifle: 'Rifle', muzzleloader: 'Muzzleloader' } as Record<string, string>)[prefs.weapon];
      const tgt = prefs.target === 'doe' ? ' for does' : prefs.target === 'mature_buck' ? ' for bucks' : '';
      out.push({
        id: `closed-${prefs.date}-${prefs.weapon}-${prefs.target}-${workspace.id}`, tone: 'warn', title: `${weaponName}${tgt} isn't legal ${fmtDate(prefs.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}`,
        body: `${opens ? `Opens ${fmtDate(opens, { weekday: 'short', month: 'numeric', day: 'numeric' })}` : 'Not open again this season'}. ${why}`,
        actions: [...(prefs.weapon !== 'bow' ? [{ label: 'Use bow', primary: true, run: () => setPrefs({ ...prefs, weapon: 'bow' }) }] : []), ...(prefs.target === 'doe' ? [{ label: 'Any legal deer', run: () => setPrefs({ ...prefs, target: 'any' }) }] : [])],
      });
    }
    if (land && clubData && !hasTerrainData(land.geometry)) out.push({ id: `nodata-${land.id}`, tone: 'warn', title: 'No terrain data for this land yet', body: 'Rankings need public elevation and vegetation data for the area, which has not been set up for this land. Tap the map to see its boundary and rules.', actions: [] });
    const yw = youthWindow(workspace);
    if (yw && prefs.date >= yw[0] && prefs.date <= yw[1] && !prefs.withKid) {
      out.push({ id: `youth-${prefs.date}-${workspace.id}`, tone: 'good', title: `Youth gun hunt ${fmtDate(prefs.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}`, body: 'Kids under 16 with a licensed supervisor can hunt with a rifle today.', actions: [{ label: 'Set up for a kid', primary: true, run: () => setPrefs({ ...prefs, withKid: true, youthHunter: true, weapon: 'rifle', effort: 'easy', maxWalkMeters: 1000, stand: 'ground', session: 'compare' }) }] });
    }
    return out.filter((n) => !dismissed.includes(n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, legalOnMap, prefs, workspace, probe, dismissed]);

  // ---- network, lidar ----
  const getNet = useCallback(() => {
    if (land) return clubNet;
    if (!netRef.current && data) netRef.current = buildWalkNetwork(data.fsRoads, data.trails, data.highways, data.recSites, data.checkStations);
    return netRef.current;
  }, [land, clubNet, data]);

  useEffect(() => {
    const id = selectedKey?.id;
    if (!id || !data || lidar[id] || !online) return;
    const c = data.candidates.find((x) => x.properties.id === id) ?? spots.find((x) => x.properties.id === id);
    if (!c) return;
    const ctl = new AbortController();
    setLidar((m) => ({ ...m, [id]: 'loading' }));
    (async () => {
      try {
        const net = getNet();
        if (!net) { setLidar((m) => ({ ...m, [id]: 'none' })); return; }
        const near = c.properties.routes[0];
        const radiusM = Math.min(2400, Math.max(1100, (near ? haversine(near.coord, c.properties.center) : 1200) + 350));
        const layerSet = land && clubData ? { walkable: land.geometry, water: data.water, lines: [clubData.roads] } : { ownership: data.ownership, water: data.water, lines: [data.fsRoads, data.trails, data.highways, data.osmRoads] };
        const r = await lidarRoute(c.properties.center, net, layerSet, { radiusM, signal: ctl.signal });
        setLidar((m) => ({ ...m, [id]: r ?? 'none' }));
      } catch (e) {
        if (!ctl.signal.aborted) { console.error('lidar route', e); setLidar((m) => ({ ...m, [id]: 'error' })); }
      }
    })();
    return () => { ctl.abort(); setLidar((m) => (m[id] === 'loading' ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)) : m)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey?.id, data, online, land]);
  const lidarStatus = selectedKey ? (typeof lidar[selectedKey.id] === 'object' ? 'done' : (lidar[selectedKey.id] as string | undefined) ?? (online ? 'loading' : 'offline')) : undefined;

  // ---- map movement ----
  const pad = () => ({ ...insets.current });
  const flyTo = useCallback((c: [number, number], zoom = 14.5) => mapRef.current?.flyTo({ center: c, zoom, padding: pad() }), []);
  const fitZone = useCallback((r: HuntRecommendation) => {
    const g = r.geometry;
    const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    const pts = rings.flat() as [number, number][];
    if (!pts.length) return flyTo(r.center);
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    mapRef.current?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad(), maxZoom: 16, duration: 900 });
  }, [flyTo]);
  const fitWorkspace = useCallback((ws: Workspace) => {
    const m = mapRef.current;
    if (!m) return;
    if (ws.land) { const b = clubBounds(ws.land.geometry); m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad(), maxZoom: 15.5, duration: 800 }); }
    else if (data && ws.kind === 'wma') m.fitBounds([[-87.62, 34.02], [-87.12, 34.4]], { padding: pad(), duration: 800 });
    else m.fitBounds([[-87.66, 33.98], [-87.08, 34.48]], { padding: pad(), duration: 800 });
  }, [data]);

  const switchWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    setSelectedKey(null); setInspect(null); setSpots([]); setTypeFilter('all');
    const ws = resolveWorkspace(id, lands);
    setTimeout(() => fitWorkspace(ws), 60);
  }, [lands, setWorkspaceId, fitWorkspace, setTypeFilter]);

  // if the active land disappears (removed on another device), fall back to the WMA
  useEffect(() => { if (workspaceId.startsWith('land:') && !lands.some((l) => `land:${l.id}` === workspaceId)) setWorkspaceId('wma'); }, [lands, workspaceId, setWorkspaceId]);

  // ---- actions ----
  const openRec = useCallback((r: HuntRecommendation) => { setSelectedKey({ id: r.areaId, session: r.session, date: r.huntDate }); setInspect(null); setWindHourIdx(0); setTimeout(() => fitZone(r), 40); }, [fitZone]);
  const onCandidate = useCallback((id: string) => {
    const c = data?.candidates.find((x) => x.properties.id === id);
    if (!c) return;
    const best = wanted.map((s) => evaluateCandidate(c, s, { prefs, weather, pins, normals })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
    openRec(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs, weather, pins, normals, openRec]);
  const onInspect = useCallback((pt: [number, number]) => {
    if (pickingStart) { setPrefs({ ...prefs, start: pt }); setPickingStart(false); return; }
    setInspect(pt); setChecking(null); setSelectedKey(null);
  }, [pickingStart, prefs, setPrefs]);
  const clearSelection = useCallback(() => { setSelectedKey(null); setInspect(null); }, []);

  const pickDay = (date: string) => { setPrefs({ ...prefs, date }); setSelectedKey((k) => (k ? { ...k, date } : k)); setWindHourIdx(0); };
  const pickSession = (session: HuntPreferences['session']) => {
    setPrefs({ ...prefs, session });
    if (session === 'morning' || session === 'evening') setSelectedKey((k) => (k ? { ...k, session } : k));
    else if (selectedKey) {
      const c = findCand(selectedKey.id);
      if (c) { const best = (['morning', 'midday', 'evening'] as Session[]).map((s) => evaluateCandidate(c, s, { prefs: { ...prefs, date: selectedKey.date }, weather, pins, normals })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]; setSelectedKey({ ...selectedKey, session: best.session }); }
    }
    setWindHourIdx(0);
  };

  const checkSpot = useCallback(async (pt: [number, number], opts: { date?: string; session?: Session } = {}) => {
    if (!data) return;
    try {
      setChecking('Loading terrain…');
      const grid = await loadGrid(land ? 'club' : 'bankhead');
      setChecking('Building trail network…');
      await new Promise((r) => setTimeout(r, 0));
      const net = getNet();
      setChecking('Analyzing…');
      await new Promise((r) => setTimeout(r, 0));
      const res = analyzeSpot(grid, data, net, pt, land ? { club: land.geometry, clubMeta: { name: land.name, deerZone: land.deerZone } } : {});
      if ('error' in res) { setChecking(null); setSpotError(res.error); return; }
      setSpots((x) => [...x.slice(-9), res]);
      const date = opts.date && opts.date >= localDate() ? opts.date : prefs.date;
      const ctx = { prefs: { ...prefs, date }, weather, pins, normals };
      const best = (opts.session ? [opts.session] : (['morning', 'midday', 'evening'] as Session[])).map((s) => evaluateCandidate(res, s, ctx)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
      setChecking(null);
      setInspect(null);
      openRec(best);
    } catch (e) { console.error(e); setChecking('error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, land, getNet, prefs, weather, pins, normals, openRec]);
  const [spotError, setSpotError] = useState<string | null>(null);

  // deep links: ?zone=BH-… / ?spot=lon,lat (public workspaces only)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !baseData) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const spotQ = q.get('spot')?.split(',').map(Number);
    const sess = (['morning', 'midday', 'evening'].includes(q.get('session') ?? '') ? q.get('session') : undefined) as Session | undefined;
    if (spotQ && spotQ.length === 2 && spotQ.every(Number.isFinite)) { setPendingSpot({ pt: [spotQ[0], spotQ[1]], date: q.get('date') ?? undefined, session: sess }); window.history.replaceState(null, '', window.location.pathname); }
    const zone = q.get('zone');
    const cand = zone ? baseData.candidates.find((c) => c.properties.id === zone) : null;
    if (zone && cand) {
      const ws = cand.properties.jurisdiction === 'nf_outside_wma' ? 'nf' : 'wma';
      setWorkspaceId(ws);
      const date = q.get('date') && q.get('date')! >= localDate() ? q.get('date')! : localDate();
      setSelectedKey({ id: zone, session: (sess ?? 'evening') as Session, date });
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => { const c = findCand(zone); if (c) fitZone(evaluateCandidate(c, sess ?? 'evening', { prefs, weather: null, pins: [], normals: null })); }, 900);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseData]);
  useEffect(() => { if (pendingSpot && data && landReady) { const p = pendingSpot; setPendingSpot(null); void checkSpot(p.pt, { date: p.date, session: p.session }); } }, [pendingSpot, data, landReady, checkSpot]);

  const onGps = useCallback(() => {
    if (!navigator.geolocation) { setGpsStatus('GPS not available on this device.'); return; }
    setGpsStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p: [number, number] = [pos.coords.longitude, pos.coords.latitude]; setUserLoc(p); setPrefs({ ...prefs, start: p }); setGpsStatus(`±${Math.round(pos.coords.accuracy)} m`); flyTo(p, 14); },
      (err) => setGpsStatus(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }, [prefs, setPrefs, flyTo]);

  const navigate = (r: HuntRecommendation) => {
    if (!r.route) return;
    const [lon, lat] = r.route.coord;
    const ios = /iPhone|iPad|Mac/i.test(navigator.userAgent);
    window.open(ios ? `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
  };

  // ---- offline map packs (device only) ----
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [cachedTiles, setCachedTiles] = useState<number | null>(null);
  useEffect(() => { void cachedTileCount().then(setCachedTiles); }, [areas]);
  const saveCurrentArea = async (): Promise<string | null> => {
    const m = mapRef.current;
    if (!m) return 'The map is not ready.';
    const b = m.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const n = tilesFor(bbox).length;
    if (n > 2500) return `That view needs ${n} tiles (limit 2,500). Zoom in a little and try again.`;
    if (!confirm(`Download ${n} ${base} tiles (~${Math.round((n * 18) / 1000)} MB) for offline use?`)) return null;
    setDlProgress({ done: 0, total: n, failed: 0 });
    try {
      const r = await downloadArea(bbox, base, (done, total, failed) => setDlProgress({ done, total, failed }));
      const name = `${base} · ${b.getCenter().lat.toFixed(3)}, ${b.getCenter().lng.toFixed(3)} · z${Math.round(m.getZoom())}`;
      setAreas((a) => [{ id: uid(), name, bbox, base, tiles: r.done, bytesApprox: r.bytes, saved: new Date().toISOString() }, ...a]);
      return r.failed ? `${r.failed} tiles failed to download; try again later for a complete pack.` : null;
    } catch (e) { return e instanceof Error ? e.message : String(e); } finally { setDlProgress(null); }
  };
  const removeSavedArea = async (a: SavedArea) => { await removeArea(a); setAreas((x) => x.filter((y) => y.id !== a.id)); };

  const fetchJournalWeather = async (date: string, coord: [number, number] | null) => { const c = coord ?? wxPoint; const d = await getPastDay(c[1], c[0], date); return d?.summary ?? null; };

  // ---- inspect (tap on empty map) ----
  const jur = inspect && data ? (land ? lookupClubJurisdiction(land.geometry, inspect, { name: land.name, deerZone: land.deerZone }) : lookupJurisdiction(data, inspect)) : null;
  const jurLegal = jur ? evaluateLegal({ date: prefs.date, weapon: prefs.weapon, target: prefs.target, jurisdiction: jur.kind, zone: jur.zone, youthHunter: prefs.youthHunter, deerZone: jur.deerZone }) : null;

  return {
    // data
    data, baseData, loadError, clubError, landReady, clubRoads: clubData?.roads ?? null, workspace, workspaces, switchWorkspace, land, lands,
    // preferences
    prefs, setPrefs, base, setBase, layers, setLayers, typeFilter, setTypeFilter,
    // hunt
    ranked, recs, ratings, marks, selected, selectedKey, setSelectedKey, selectedCompare, timeline, plan, setups, windHour, windHourIdx, setWindHourIdx, lidarStatus,
    sun, wxPoint, ...wx, notices, dismiss: (id: string) => setDismissed((d) => [...d, id]), legalOnMap, outlook,
    // interaction
    mapRef, setInsets, flyTo, fitZone, fitWorkspace, openRec, onCandidate, onInspect, clearSelection, pickDay, pickSession, checkSpot, checking, spotError, clearSpotError: () => setSpotError(null),
    inspect, setInspect, jur, jurLegal, pickingStart, setPickingStart, userLoc, gpsStatus, onGps, navigate, online,
    // pins
    pins, addPin, removePin,
    // offline maps
    areas, dlProgress, cachedTiles, saveCurrentArea, removeSavedArea, fetchJournalWeather,
  };
}
export type HuntController = ReturnType<typeof useHuntController>;
