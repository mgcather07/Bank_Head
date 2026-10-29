import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { loadData, type AppData } from './data';
import { MapView, type BaseMap, type LandFilter, type LayerToggles, type SetupMarker, type ZoneTypeFilter } from './components/MapView';
import { BackupPanel, HuntForm, InspectCard, JournalPanel, OfflinePanel, Outlook, PeekBar, RecCard, RecDetail, ScorePill, SettingsBar, SourcesPanel, TodayCard, type OutlookDay } from './components/Panels';
import { CompassView } from './components/Compass';
import { cachedTileCount, downloadArea, removeArea, tilesFor, type SavedArea } from './engine/offline';
import { downloadText, gpxToPins, makeBackup, mergeById, parseBackup, pinsToGpx } from './engine/backup';
import { getNormals, getPastDay, type Normals } from './engine/climate';
import { analyzeSpot, buildWalkNetwork, loadGrid, type WalkNetwork } from './engine/spot';
import { buildHuntPlan, setupPoint } from './engine/plan';
import { buildRoadIndex, setPathIndex, setRoadIndex } from './engine/roads';
import { lidarRoute } from './engine/lidar';
import type { Candidate, RouteOption } from './engine/types';
import { TabBar, TabIcon } from './components/TabBar';
import type { HuntPreferences, HuntRecommendation, Session, WeatherAlert, WeatherBundle } from './engine/types';
import { addDays, BANKHEAD_CENTER, fmtDate, fmtTime, localDate, sessionWindows, sunDay } from './engine/time';
import { getAlerts, getWeather, hoursBetween } from './engine/weather';
import { evaluateCandidate, rankCandidates, sessionsFor } from './engine/scoring';
import { haversine, lookupJurisdiction } from './engine/geography';
import { peakTimeline } from './engine/peak';
import { evaluateLegal } from './engine/regulations';
import { useJournal, usePersisted, usePins, uid, type JournalEntry } from './store';

type Tab = 'map' | 'hunt' | 'outlook' | 'journal' | 'sources';
const PAGE_TITLE: Record<Tab, string> = { map: 'Map', hunt: 'Hunt', outlook: '7-Day Outlook', journal: 'Journal & Pins', sources: 'Info & Sources' };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InstallPrompt = any;
import { inStudyArea } from './engine/config';

const DEFAULT_PREFS: HuntPreferences = { date: localDate(), session: 'compare', weapon: 'bow', target: 'any', maxWalkMeters: 3200, stand: 'climber', effort: 'balanced', youthHunter: false, start: null };
const DEFAULT_LAYERS: LayerToggles = { boundaries: true, ownership: true, wilderness: true, roads: true, trails: true, streams: true, contours: true, slope: false, disturbance: false, lidar: false, candidates: true, access: true, pins: true };

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storedPrefs, setPrefs] = usePersisted<HuntPreferences>('bh.prefs.v1', DEFAULT_PREFS);
  // never carry a past date forward from storage
  const prefs = useMemo(() => (storedPrefs.date < localDate() ? { ...storedPrefs, date: localDate() } : storedPrefs), [storedPrefs]);
  const [base, setBase] = usePersisted<BaseMap>('bh.base.v1', 'topo');
  const [layers, setLayers] = usePersisted<LayerToggles>('bh.layers.v1', DEFAULT_LAYERS);
  const [typeFilter, setTypeFilter] = usePersisted<ZoneTypeFilter>('bh.typeFilter.v1', 'all');
  const [landFilter, setLandFilter] = usePersisted<LandFilter>('bh.landFilter.v1', 'all');
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('hunt');
  const [selectedKey, setSelectedKey] = useState<{ id: string; session: Session; date: string } | null>(null);
  const [inspect, setInspect] = useState<[number, number] | null>(null);
  const [userLoc, setUserLoc] = useState<[number, number] | null>(null);
  const [gpsStatus, setGpsStatus] = useState('');
  const [pickingStart, setPickingStart] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Desktop always shows the map beside the panel, so the "map" tab only exists on phones.
  const view: Tab = !isMobile && tab === 'map' ? 'hunt' : tab;
  const switchTab = (t: Tab) => { setTab(t); setShowLayers(false); panelRef.current?.scrollTo({ top: 0 }); };
  // Install-to-home-screen: Android/desktop Chrome fire beforeinstallprompt; iOS needs Share → Add to Home Screen.
  const [installEvt, setInstallEvt] = useState<InstallPrompt>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const runHunt = () => { setShowForm(false); setSelectedKey(null); switchTab('hunt'); if (recs[0]) flyTo(recs[0].center, 12.5); };
  // Escape closes whichever overlay is open (also lets Android back-gesture users bail via keyboard on tablets).
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowForm(false); setShowInstallHelp(false); setShowLayers(false); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const onInstall = async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); }
    else setShowInstallHelp(true);
  };
  const [windHourIdx, setWindHourIdx] = useState(0);
  const [showLayers, setShowLayers] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [journalDraft, setJournalDraft] = useState<Partial<JournalEntry> | null>(null);
  const { pins, add: addPin, remove: removePin, setAll: setPins } = usePins();
  const [normals, setNormals] = useState<Normals | null>(null);
  const [areas, setAreas] = usePersisted<SavedArea[]>('bh.areas.v1', []);
  const [dlProgress, setDlProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [cachedTiles, setCachedTiles] = useState<number | null>(null);
  const [showCompass, setShowCompass] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [spots, setSpots] = useState<Candidate[]>([]);
  const [checking, setChecking] = useState<string | null>(null);
  const [pendingSpot, setPendingSpot] = useState<{ pt: [number, number]; date?: string; session?: Session } | null>(null);
  const netRef = useRef<WalkNetwork | null>(null);
  // lidar-refined routes keyed by zone/spot id ('loading' | 'error' | 'offline' while not available)
  const [lidar, setLidar] = useState<Record<string, RouteOption | 'loading' | 'error' | 'none'>>({});
  const journal = useJournal();
  const mapRef = useRef<MLMap | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData().then((d) => {
      setRoadIndex(buildRoadIndex(d.fsRoads, d.highways, d.osmRoads));
      setPathIndex(buildRoadIndex(d.fsRoads, d.highways, d.osmRoads, d.trails));
      setData(d);
      // ?zone=BH-..&date=YYYY-MM-DD&session=evening — shared link opens that zone
      const q = new URLSearchParams(window.location.search);
      const spotQ = q.get('spot')?.split(',').map(Number);
      if (spotQ && spotQ.length === 2 && spotQ.every(Number.isFinite)) {
        const session = (['morning', 'midday', 'evening'].includes(q.get('session') ?? '') ? q.get('session') : undefined) as Session | undefined;
        setPendingSpot({ pt: [spotQ[0], spotQ[1]], date: q.get('date') ?? undefined, session });
        window.history.replaceState(null, '', window.location.pathname);
      }
      const zone = q.get('zone');
      if (zone && d.candidates.some((c) => c.properties.id === zone)) {
        const date = q.get('date') && q.get('date')! >= localDate() ? q.get('date')! : localDate();
        const session = (['morning', 'midday', 'evening'].includes(q.get('session') ?? '') ? q.get('session') : 'evening') as Session;
        setSelectedKey({ id: zone, session, date });
        setTab(window.matchMedia('(max-width: 899px)').matches ? 'map' : 'hunt');
        window.history.replaceState(null, '', window.location.pathname);
      }
    }).catch((e) => setLoadError(String(e)));
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const wxPoint: [number, number] = inStudyArea(prefs.start) ? prefs.start! : BANKHEAD_CENTER;
  const wxKey = `${wxPoint[0].toFixed(2)},${wxPoint[1].toFixed(2)}`;
  const refreshWeather = useCallback(async (force = false) => {
    setRefreshing(true);
    const [lon, lat] = wxKey.split(',').map(Number);
    const [w, a] = await Promise.all([getWeather(lat, lon, { force }), getAlerts(lat, lon)]);
    setWeather(w.bundle);
    setWeatherError(w.error);
    setAlerts(a.alerts);
    setAlertsError(a.error);
    setRefreshing(false);
  }, [wxKey]);
  useEffect(() => { refreshWeather(); }, [refreshWeather]);
  useEffect(() => { const [lon, lat] = wxKey.split(',').map(Number); getNormals(lat, lon).then(setNormals); }, [wxKey]);
  useEffect(() => { cachedTileCount().then(setCachedTiles); }, [areas]);
  useEffect(() => {
    const t = setInterval(() => refreshWeather(), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshWeather]);

  // ---- ranking (all sessions for the chosen date) ----
  const ranked = useMemo(() => {
    if (!data) return null;
    return rankCandidates(data.candidates, { prefs: { ...prefs, session: 'compare' }, weather, pins, normals }, 5);
  }, [data, prefs, weather, pins, normals]);
  const wanted = sessionsFor(prefs.session);
  const recs = useMemo(() => {
    if (!ranked) return [];
    const seen = new Set<string>();
    return wanted.flatMap((s) => ranked.bySession[s]).filter((r) => (typeFilter === 'all' || r.candidate.type === typeFilter) && (landFilter === 'all' || (landFilter === 'nf') === (r.candidate.jurisdiction === 'nf_outside_wma'))).sort((a, b) => (a.legalStatus === b.legalStatus ? (b.score ?? -1) - (a.score ?? -1) : a.legalStatus === 'verified_allowed' ? -1 : 1)).filter((r) => (seen.has(r.areaId) ? false : (seen.add(r.areaId), true))).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, prefs.session, typeFilter, landFilter]);
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

  const findCand = useCallback((id: string) => {
    const c = data?.candidates.find((x) => x.properties.id === id) ?? spots.find((x) => x.properties.id === id) ?? null;
    const lr = lidar[id];
    // a lidar route, once computed, becomes the zone's first route everywhere (scoring, plan, map)
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
    return Object.fromEntries((['morning', 'midday', 'evening'] as Session[]).map((s) => [s, evaluateCandidate(c, s, { prefs: { ...prefs, date: selectedKey.date }, weather, pins, normals })]));
  }, [selectedKey, data, prefs, weather, pins, normals, findCand]);

  const timeline = useMemo(() => {
    if (!selectedKey || !data) return null;
    const c = findCand(selectedKey.id);
    return c ? peakTimeline(c, selectedKey.date, prefs, weather) : null;
  }, [selectedKey, data, prefs, weather, findCand]);
  // "Hunt this spot" plan with the best sessions for this zone over the next 7 days
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
  // red ✕ setup markers: the selected zone (large, labelled) plus the visible top areas
  const setups = useMemo<SetupMarker[]>(() => {
    const out: SetupMarker[] = [];
    const add = (r: HuntRecommendation, primary: boolean) => {
      if (r.legalStatus === 'verified_prohibited') return;
      const sp = setupPoint(r);
      if (sp && !out.some((m) => m.id === r.areaId)) out.push({ id: r.areaId, coord: sp.coord, primary, label: r.candidate.label });
    };
    if (selected) add(selected, true);
    if (!selected || view !== 'map') recs.forEach((r) => add(r, false));
    return out;
  }, [selected, recs, view]);
  const sun = useMemo(() => sunDay(prefs.date, wxPoint[0], wxPoint[1]), [prefs.date, wxKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const windHour = useMemo(() => {
    if (!selected) return null;
    const w = sessionWindows(sunDay(selected.huntDate, selected.center[0], selected.center[1]))[selected.session];
    const hrs = hoursBetween(weather, w.start, w.end);
    const h = hrs[Math.min(windHourIdx, hrs.length - 1)];
    return h && h.windFrom != null ? { from: h.windFrom, downwind: (h.windFrom + 180) % 360 } : null;
  }, [selected, weather, windHourIdx]);

  // ---- 7-day outlook ----
  const outlook = useMemo<OutlookDay[]>(() => {
    if (!data || view !== 'outlook') return [];
    const today = localDate();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const ctx = { prefs: { ...prefs, date }, weather, pins, normals };
      const m = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'morning' } }, 1);
      const e = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'evening' } }, 1);
      const sel = selectedKey ? findCand(selectedKey.id) : null;
      const dw = weather?.daily.find((d) => d.date === date);
      return {
        date, sun: sunDay(date, wxPoint[0], wxPoint[1]), morning: m.recommendations[0] ?? null, evening: e.recommendations[0] ?? null,
        compareMorning: sel ? evaluateCandidate(sel, 'morning', ctx) : null, compareEvening: sel ? evaluateCandidate(sel, 'evening', ctx) : null,
        tMax: dw?.tMaxF ?? null, tMin: dw?.tMinF ?? null, precip: dw?.precipIn ?? null, windDom: dw?.windDominant ?? null, windMax: dw?.windMaxMph ?? null,
        legal: evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'A', youthHunter: prefs.youthHunter }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, view, prefs, weather, pins, selectedKey, normals]);

  // Refine the open zone's walk-in on ~4 m lidar (online only; cached per zone for the session)
  useEffect(() => {
    const id = selectedKey?.id;
    if (!id || !data || lidar[id] || !online) return;
    const c = data.candidates.find((x) => x.properties.id === id) ?? spots.find((x) => x.properties.id === id);
    if (!c) return;
    const ctl = new AbortController();
    setLidar((m) => ({ ...m, [id]: 'loading' }));
    (async () => {
      try {
        if (!netRef.current) netRef.current = buildWalkNetwork(data.fsRoads, data.trails, data.highways, data.recSites, data.checkStations);
        const near = c.properties.routes[0];
        const radiusM = Math.min(2400, Math.max(1100, (near ? haversine(near.coord, c.properties.center) : 1200) + 350));
        const r = await lidarRoute(c.properties.center, netRef.current, { ownership: data.ownership, water: data.water, lines: [data.fsRoads, data.trails, data.highways, data.osmRoads] }, { radiusM, signal: ctl.signal });
        setLidar((m) => ({ ...m, [id]: r ?? 'none' }));
      } catch (e) {
        if (!ctl.signal.aborted) { console.error('lidar route', e); setLidar((m) => ({ ...m, [id]: 'error' })); }
      }
    })();
    return () => { ctl.abort(); setLidar((m) => (m[id] === 'loading' ? Object.fromEntries(Object.entries(m).filter(([k]) => k !== id)) : m)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey?.id, data, online]);

  // deep-linked selection: fit once the map and data exist
  const deepLinked = useRef(false);
  useEffect(() => {
    if (!deepLinked.current && selected && mapRef.current && data) { deepLinked.current = true; setTimeout(() => fitZone(selected), 600); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, data]);

  // ---- offline areas ----
  const saveCurrentArea = async () => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    const bbox: [number, number, number, number] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const n = tilesFor(bbox).length;
    if (n > 2500) { alert(`That view needs ${n} tiles (limit 2,500). Zoom in a little and try again.`); return; }
    if (!confirm(`Download ${n} ${base} tiles (~${Math.round((n * 18) / 1000)} MB) for offline use?`)) return;
    setDlProgress({ done: 0, total: n, failed: 0 });
    try {
      const r = await downloadArea(bbox, base, (done, total, failed) => setDlProgress({ done, total, failed }));
      const name = `${base} · ${b.getCenter().lat.toFixed(3)}, ${b.getCenter().lng.toFixed(3)} · z${Math.round(m.getZoom())}`;
      setAreas((a) => [{ id: uid(), name, bbox, base, tiles: r.done, bytesApprox: r.bytes, saved: new Date().toISOString() }, ...a]);
      if (r.failed) alert(`${r.failed} tiles failed to download; try again later for a complete pack.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDlProgress(null);
    }
  };
  const removeSavedArea = async (a: SavedArea) => { await removeArea(a); setAreas((x) => x.filter((y) => y.id !== a.id)); };

  // ---- backup ----
  const exportJson = () => downloadText(`bankhead-backup-${localDate()}.json`, JSON.stringify(makeBackup(pins, journal.entries, prefs, areas), null, 1));
  const exportGpxAll = () => downloadText(`bankhead-pins-${localDate()}.gpx`, pinsToGpx(pins), 'application/gpx+xml');
  const importFile = async (f: File) => {
    try {
      const text = await f.text();
      if (/\.gpx$/i.test(f.name) || text.trimStart().startsWith('<')) {
        const incoming = gpxToPins(text).map((p) => ({ ...p, id: uid(), created: new Date().toISOString() }));
        setPins((cur) => [...cur, ...incoming]);
        setImportMsg(`Imported ${incoming.length} pins from GPX.`);
      } else {
        const b = parseBackup(text);
        const before = { p: pins.length, j: journal.entries.length };
        setPins((cur) => mergeById(cur, b.pins));
        journal.setAll((cur) => mergeById(cur, b.journal));
        setImportMsg(`Imported backup from ${b.exported.slice(0, 10)}: +${b.pins.filter((x) => !pins.some((y) => y.id === x.id)).length} pins, +${b.journal.filter((x) => !journal.entries.some((y) => y.id === x.id)).length} journal entries (had ${before.p}/${before.j}).`);
      }
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : e}`);
    }
  };
  const fetchJournalWeather = async (date: string, coord: [number, number] | null) => {
    const c = coord ?? wxPoint;
    const d = await getPastDay(c[1], c[0], date);
    return d?.summary ?? null;
  };

  // ---- map day / session picker ----
  // The map shows prefs.date and prefs.session; a selected zone follows the picked day (and AM/PM when chosen).
  const mapSession: HuntPreferences['session'] = prefs.session === 'morning' || prefs.session === 'evening' ? prefs.session : 'compare';
  const pickDay = (date: string) => {
    setPrefs({ ...prefs, date });
    setSelectedKey((k) => (k ? { ...k, date } : k));
    setWindHourIdx(0);
  };
  const pickSession = (session: HuntPreferences['session']) => {
    setPrefs({ ...prefs, session });
    if (session === 'morning' || session === 'evening') setSelectedKey((k) => (k ? { ...k, session } : k));
    else if (selectedKey) {
      // "Best": jump the selected zone to its best session that day
      const c = findCand(selectedKey.id);
      if (c) {
        const best = (['morning', 'midday', 'evening'] as Session[]).map((s) => evaluateCandidate(c, s, { prefs: { ...prefs, date: selectedKey.date }, weather, pins, normals })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
        setSelectedKey({ ...selectedKey, session: best.session });
      }
    }
    setWindHourIdx(0);
  };
  const dayLabel = (d: string) => (d === localDate() ? `Today ${fmtDate(d, { month: 'numeric', day: 'numeric' })}` : d === addDays(localDate(), 1) ? `Tmrw ${fmtDate(d, { month: 'numeric', day: 'numeric' })}` : fmtDate(d, { weekday: 'short', month: 'numeric', day: 'numeric' }));
  const mapSun = selected ? sunDay(selected.huntDate, selected.center[0], selected.center[1]) : sun;
  // When nothing on the map is legal for the chosen weapon/day, say why and when it opens.
  const legalOnMap = useMemo(() => [...mapScores.values()].filter((v) => v != null).length, [mapScores]);
  const closedNote = useMemo(() => {
    if (!data || legalOnMap > 0) return null;
    const probe = (date: string) => [
      evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'A', youthHunter: prefs.youthHunter }),
      evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'B', youthHunter: prefs.youthHunter }),
      evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'nf_outside_wma', zone: null, deerZone: 'D', youthHunter: prefs.youthHunter }),
      evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'nf_outside_wma', zone: null, deerZone: 'C', youthHunter: prefs.youthHunter }),
    ];
    let opens: string | null = null;
    for (let i = 1; i <= 150 && !opens; i++) { const d = addDays(prefs.date, i); if (probe(d).some((r) => r.status === 'verified_allowed')) opens = d; }
    const why = probe(prefs.date)[0].summary.replace(/ on \d{4}-\d{2}-\d{2}/, '');
    const weaponName = ({ bow: 'Bow', crossbow: 'Crossbow', rifle: 'Rifle', muzzleloader: 'Muzzleloader' } as Record<string, string>)[prefs.weapon];
    const target = prefs.target === 'doe' ? ' for does' : prefs.target === 'mature_buck' ? ' for bucks' : '';
    return { title: `${weaponName}${target} isn't legal ${fmtDate(prefs.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}`, opens: opens ? `Opens ${fmtDate(opens, { weekday: 'short', month: 'numeric', day: 'numeric' })}` : 'Not open again this season', why };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, legalOnMap, prefs.date, prefs.weapon, prefs.target, prefs.youthHunter]);
  // Youth gun weekend: Oct 30–Nov 2 (Zone D / NF) and Oct 31–Nov 1 (WMA). Offer the one-tap kid setup.
  const youthDay = (d: string) => d >= '2026-10-30' && d <= '2026-11-02';
  const youthBanner = youthDay(prefs.date) && !prefs.withKid && (
    <div className="youth-banner" role="status">
      <div><b>Youth gun hunt {fmtDate(prefs.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}</b> · kids under 16 with a supervisor{prefs.date === '2026-10-30' || prefs.date === '2026-11-02' ? ' (National Forest only this day)' : ''}</div>
      <div className="row"><button className="btn btn-primary small" onClick={() => setPrefs({ ...prefs, withKid: true, youthHunter: true, weapon: 'rifle', effort: 'easy', maxWalkMeters: 1000, stand: 'ground', session: 'compare' })}>Set up for a kid</button><button className="btn small" onClick={() => setShowForm(true)}>Settings</button></div>
    </div>
  );
  const kidChip = (
    <button className={`kid-chip ${prefs.withKid ? 'on' : ''}`} aria-pressed={!!prefs.withKid} onClick={() => setPrefs(prefs.withKid ? { ...prefs, withKid: false } : { ...prefs, withKid: true, youthHunter: true, effort: 'easy', maxWalkMeters: 1000, stand: 'ground' })}>🧒 Kid-friendly{prefs.withKid ? ' ✓' : ''}</button>
  );
  const closedBanner = closedNote && (
    <div className="closed-banner" role="status">
      <div><b>{closedNote.title}</b> · {closedNote.opens}</div>
      <div className="tiny">{closedNote.why} Gray zones = not legal for your weapon that day.</div>
      <div className="row">
        {prefs.weapon !== 'bow' && <button className="btn btn-primary small" onClick={() => setPrefs({ ...prefs, weapon: 'bow', target: prefs.target })}>Use bow</button>}
        {prefs.target === 'doe' && <button className="btn small" onClick={() => setPrefs({ ...prefs, target: 'any' })}>Any legal deer</button>}
        <button className="btn small" onClick={() => setShowForm(true)}>Settings</button>
      </div>
    </div>
  );
  const dayBar = (
        <div className="day-bar" aria-label="Day and session shown on the map">
          <button className="day-arrow" aria-label="Previous day" disabled={prefs.date <= localDate()} onClick={() => pickDay(addDays(prefs.date, -1))}>‹</button>
          <span className="day-label">{dayLabel(prefs.date)}</span>
          <button className="day-arrow" aria-label="Next day" disabled={prefs.date >= addDays(localDate(), 7)} onClick={() => pickDay(addDays(prefs.date, 1))}>›</button>
          <select className="day-weapon" aria-label="Weapon" value={prefs.weapon} onChange={(e) => setPrefs({ ...prefs, weapon: e.target.value as HuntPreferences['weapon'] })}>
            <option value="bow">Bow</option><option value="crossbow">Xbow</option><option value="rifle">Rifle</option><option value="muzzleloader">Muzzle</option>
          </select>
          <span className="day-seg" role="radiogroup" aria-label="Session">
            {([['morning', 'AM'], ['evening', 'PM'], ['compare', 'Best']] as [HuntPreferences['session'], string][]).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={mapSession === v} className={mapSession === v ? 'on' : ''} onClick={() => pickSession(v)}>{l}</button>
            ))}
          </span>
        </div>
  );

  // ---- check this spot ----
  const checkSpot = async (pt: [number, number], opts: { date?: string; session?: Session } = {}) => {
    if (!data) return;
    try {
      setChecking('Loading terrain…');
      const grid = await loadGrid();
      if (!netRef.current) { setChecking('Building trail network…'); await new Promise((r) => setTimeout(r, 0)); netRef.current = buildWalkNetwork(data.fsRoads, data.trails, data.highways, data.recSites, data.checkStations); }
      setChecking('Analyzing…');
      await new Promise((r) => setTimeout(r, 0));
      const res = analyzeSpot(grid, data, netRef.current, pt);
      if ('error' in res) { setChecking(null); alert(res.error); return; }
      setSpots((x) => [...x.slice(-9), res]);
      const date = opts.date && opts.date >= localDate() ? opts.date : prefs.date;
      const ctx = { prefs: { ...prefs, date }, weather, pins, normals };
      const evals = (opts.session ? [opts.session] : (['morning', 'midday', 'evening'] as Session[])).map((s) => evaluateCandidate(res, s, ctx));
      const best = evals.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
      setChecking(null);
      setInspect(null);
      openRec(best);
    } catch (e) {
      console.error(e);
      setChecking('error');
    }
  };
  useEffect(() => {
    if (pendingSpot && data) { const p = pendingSpot; setPendingSpot(null); checkSpot(p.pt, { date: p.date, session: p.session }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSpot, data]);

  // ---- interactions ----
  // On phones the map fills the screen between the header and the tab bar; leave room for the floating card.
  const mapPadding = () => (window.innerWidth < 900 ? { bottom: 170, top: 70, left: 40, right: 40 } : { left: 480, top: 60, bottom: 60, right: 60 });
  const flyTo = (c: [number, number], zoom = 14.5) => mapRef.current?.flyTo({ center: c, zoom, padding: mapPadding() });
  // Zoom the map so the whole scouting polygon is in view (outlined), not just its centre.
  const fitZone = (r: HuntRecommendation) => {
    const g = r.geometry;
    const rings = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : [];
    const pts = rings.flat() as [number, number][];
    if (!pts.length) return flyTo(r.center);
    const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
    mapRef.current?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: mapPadding(), maxZoom: 16, duration: 900 });
  };
  const openRec = (r: HuntRecommendation) => {
    setSelectedKey({ id: r.areaId, session: r.session, date: r.huntDate });
    setInspect(null);
    setWindHourIdx(0);
    setTab('hunt');
    fitZone(r);
    panelRef.current?.scrollTo({ top: 0 });
  };
  /** Phone: jump to the Map tab with the zone outlined. */
  const showOnMap = (r: HuntRecommendation) => { setSelectedKey({ id: r.areaId, session: r.session, date: r.huntDate }); setInspect(null); switchTab('map'); fitZone(r); };
  const onCandidate = (id: string) => {
    const c = data?.candidates.find((x) => x.properties.id === id);
    if (!c) return;
    // open the best of the requested sessions
    const evals = wanted.map((s) => evaluateCandidate(c, s, { prefs, weather, pins, normals }));
    const best = evals.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];
    // On the phone map, keep the map in view and show a summary card instead of leaving the map.
    if (isMobile && view === 'map') showOnMap(best);
    else openRec(best);
  };
  const onInspect = (pt: [number, number]) => {
    if (pickingStart) {
      setPrefs({ ...prefs, start: pt });
      setPickingStart(false);
      setShowForm(true);
      return;
    }
    setInspect(pt);
    setChecking(null);
    setSelectedKey(null);
    if (!isMobile) setTab('hunt');
  };
  const onGps = () => {
    if (!navigator.geolocation) { setGpsStatus('GPS not available on this device.'); return; }
    setGpsStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLoc(p);
        setPrefs({ ...prefs, start: p });
        setGpsStatus(`±${Math.round(pos.coords.accuracy)} m${inStudyArea(p) ? '' : ' · outside Bankhead study area'}`);
        flyTo(p, 13);
      },
      (err) => setGpsStatus(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };
  const navigate = (r: HuntRecommendation) => {
    if (!r.route) return;
    const [lon, lat] = r.route.coord;
    const ios = /iPhone|iPad|Mac/i.test(navigator.userAgent);
    window.open(ios ? `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`, '_blank');
  };
  const exportGpx = (r: HuntRecommendation) => {
    const pts = [r.route ? `<wpt lat="${r.route.coord[1]}" lon="${r.route.coord[0]}"><name>Access: ${r.route.name}</name></wpt>` : '', `<wpt lat="${r.center[1]}" lon="${r.center[0]}"><name>${r.areaId} ${r.candidate.label}</name><desc>Scouting zone (not a verified stand). Straight-line approach only.</desc></wpt>`].join('');
    const blob = new Blob([`<?xml version="1.0"?><gpx version="1.1" creator="Bankhead Hunt Intelligence">${pts}</gpx>`], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${r.areaId}.gpx`;
    a.click();
  };

  const jur = inspect && data ? lookupJurisdiction(data, inspect) : null;
  const jurLegal = jur ? evaluateLegal({ date: prefs.date, weapon: prefs.weapon, target: prefs.target, jurisdiction: jur.kind, zone: jur.zone, youthHunter: prefs.youthHunter, deerZone: jur.deerZone }) : null;
  const saved = selected ? pins.some((p) => p.kind === 'saved_candidate' && p.candidateId === selected.areaId) : false;
  const ex = ranked?.excluded;

  return (
    <div className={`app view-${view}`}>
      <header className="topbar">
        <div className="brand"><span className="logo">◭</span><div><b className="brand-name">BANKHEAD HUNT INTELLIGENCE</b><b className="page-title">{PAGE_TITLE[view]}</b><div className="tiny muted">{fmtDate(localDate())}{!online && ' · OFFLINE — cached data'}</div></div></div>
        {!standalone && (installEvt || isIOS) && <button className="btn small install-btn" onClick={onInstall}>⤓ Install</button>}
      </header>
      <MapView data={data} base={base} layers={layers} scores={mapScores} setups={setups} typeFilter={typeFilter} landFilter={landFilter} selected={selected} windHour={windHour} userLoc={userLoc} pins={pins} startPin={prefs.start} onCandidate={onCandidate} onInspect={onInspect} mapRef={mapRef} />
      <div className="map-top">
        {!isMobile && closedBanner}
        {!isMobile && youthBanner}
        {!isMobile && dayBar}
        <div className="sun-chip" aria-label="Sunrise and sunset">
          <span>☀↑ <b>{fmtTime(mapSun.sunrise)}</b></span>
          <span>☀↓ <b>{fmtTime(mapSun.sunset)}</b></span>
          <span className="muted">legal {fmtTime(mapSun.legalStart)}–{fmtTime(mapSun.legalEnd)}</span>
        </div>
        <div className="type-chips" role="group" aria-label="Filter hunting areas">
          {([['all', 'All'], ['saddle', 'Saddles'], ['bench', 'Benches'], ['spur', 'Spurs'], ['bottom', 'Bottoms']] as [ZoneTypeFilter, string][]).map(([t, l]) => (
            <button key={t} role="radio" aria-checked={typeFilter === t} className={typeFilter === t ? 'on' : ''} onClick={() => setTypeFilter(t)}>{l}{t !== 'all' && data ? <small> {data.candidates.filter((c) => c.properties.type === t && (landFilter === 'all' || (landFilter === 'nf') === (c.properties.jurisdiction === 'nf_outside_wma'))).length}</small> : null}</button>
          ))}
          <i className="chip-sep" aria-hidden="true" />
          {kidChip}
          <i className="chip-sep" aria-hidden="true" />
          {([['all', 'All land'], ['wma', 'WMA'], ['nf', 'Nat\'l Forest']] as [LandFilter, string][]).map(([t, l]) => (
            <button key={'land-' + t} role="radio" aria-checked={landFilter === t} className={landFilter === t ? 'on land' : 'land'} onClick={() => setLandFilter(t)}>{l}{t !== 'all' && data ? <small> {data.candidates.filter((c) => (t === 'nf') === (c.properties.jurisdiction === 'nf_outside_wma')).length}</small> : null}</button>
          ))}
        </div>
      </div>
      <div className="map-tools">
        <button className="btn fab" onClick={() => setShowLayers(!showLayers)} aria-expanded={showLayers}>Layers</button>
        <button className="btn fab" onClick={onGps} aria-label="Locate me">◎</button>
        <button className={`btn fab ${showCompass ? 'btn-on' : ''}`} onClick={() => { setShowCompass(!showCompass); setShowLayers(false); }} aria-label="Compass">⌖</button>
        <button className="btn fab" onClick={saveCurrentArea} aria-label="Save this view for offline" disabled={!!dlProgress}>{dlProgress ? `${Math.round((dlProgress.done / dlProgress.total) * 100)}%` : '⤓'}</button>
        {showLayers && (
          <>
            <div className="popover-backdrop" onClick={() => setShowLayers(false)} />
            <div className="layers card" role="dialog" aria-label="Map layers">
              <div className="seg small">{(['topo', 'satellite', 'hybrid', 'hillshade'] as BaseMap[]).map((b) => <button key={b} className={base === b ? 'on' : ''} onClick={() => setBase(b)}>{b}</button>)}</div>
              {(Object.keys(DEFAULT_LAYERS) as (keyof LayerToggles)[]).map((k) => (
                <label key={k} className="check small"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {LAYER_LABEL[k]}</label>
              ))}
              <div className="legend tiny">
                <div><i style={{ background: '#5fbf5a' }} />High <i style={{ background: '#e0a43a' }} />Medium <i style={{ background: '#b0413e' }} />Low <i style={{ background: '#7a7a7a' }} />Not legal for your weapon that day</div>
                <div><i className="ln" style={{ background: '#f2b84b' }} />WMA <i className="ln" style={{ background: '#9fe08a' }} />National Forest <i className="ln" style={{ background: '#ffd84d' }} />WMA Zone A|B <i className="ln" style={{ background: '#c38bff' }} />Deer Zone C|D <i style={{ background: '#d64545', opacity: 0.5 }} />Private</div>
                <div><i className="ln" style={{ background: '#e36b5b' }} />NFS trail <i className="ln" style={{ background: '#f0e6d2' }} />FS road <i style={{ background: '#3fa7ff', borderRadius: 8 }} />Access</div>
                <div><i style={{ background: '#ff7828' }} />Burn ≤1 yr <i style={{ background: '#ffaa3c' }} />2–5 yr <i style={{ background: '#e6c878' }} />6–10 yr</div>
                <div><i style={{ background: '#aae6ff' }} />Cut ≤1 yr <i style={{ background: '#5abeff' }} />Cut 2–5 yr (browse) <i style={{ background: '#3c6ec8' }} />Cut 6–10 yr (bedding) <i className="ln" style={{ background: '#7ad0ff' }} />Route <i className="ln" style={{ background: '#ffd27a' }} />Off-trail</div>
              </div>
              <button className="btn btn-primary layers-done" onClick={() => setShowLayers(false)}>Done</button>
            </div>
          </>
        )}
        {pickingStart && <div className="toast">Tap the map to set your starting point</div>}
      </div>
      {selected && selected.windAssessment.windFromDegrees != null && (
        <div className="wind-widget" aria-label="Wind">
          <svg width="64" height="64" viewBox="-32 -32 64 64"><circle r="30" fill="rgba(10,16,12,.75)" stroke="#ffffff40" /><text y="-20" textAnchor="middle" fontSize="9" fill="#ccc">N</text><g transform={`rotate(${((windHour?.from ?? selected.windAssessment.windFromDegrees) + 180) % 360})`}><path d="M0,-22 L8,2 L2,0 L2,20 L-2,20 L-2,0 L-8,2 Z" fill="#ff9f43" /></g></svg>
          <div className="tiny">scent →</div>
        </div>
      )}

      {showCompass && (
        <div className={`compass-wrap card ${isMobile ? 'map-card' : ''}`}>
          <CompassView windFrom={(windHour?.from ?? selected?.windAssessment.windFromDegrees ?? weather?.current?.windFrom) ?? null} windMph={weather?.current?.windMph ?? null} onClose={() => setShowCompass(false)} />
        </div>
      )}
      {isMobile && view === 'map' && !showLayers && !showCompass && (
        <div className="map-card">
          {!inspect && closedBanner}
          {!inspect && youthBanner}
          {!inspect && dayBar}
          {inspect && jur && jurLegal ? (
            <InspectCard pt={inspect} j={jur} legalSummary={jurLegal.summary} onClose={() => setInspect(null)} onAddPin={(kind) => { addPin({ kind, coord: inspect, note: '' }); setInspect(null); }} onSetStart={() => { setPrefs({ ...prefs, start: inspect }); setInspect(null); }} onCheck={() => checkSpot(inspect)} checking={checking} />
          ) : selected ? (
            <div className="card mini">
              <div className="row">
                <ScorePill score={selected.score} legal={selected.legalStatus} />
                <div className="grow mini-text"><b>{selected.candidate.label}</b> <span className="muted">{selected.areaId}</span><div className="tiny muted">{selected.landJurisdiction} · {fmtDate(selected.huntDate, { weekday: 'short' })} {selected.session === 'morning' ? 'AM' : selected.session === 'evening' ? 'PM' : 'midday'} · wind risk {selected.windAssessment.risk}</div></div>
                <button className="btn btn-ghost small" aria-label="Clear selection" onClick={() => setSelectedKey(null)}>✕</button>
              </div>
              <div className="tiny muted mini-sun">☀↑ {fmtTime(timeline?.sun.sunrise)} · ☀↓ {fmtTime(timeline?.sun.sunset)} · <span className="setup-key">✕</span> = set up here</div>
              {timeline?.peaks[0] && <div className="tiny mini-peak">★ Peak {new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(timeline.peaks[0].start)}–{new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(timeline.peaks[0].end)}</div>}
              <div className="row mini-actions">
                <button className="btn btn-primary" onClick={() => { switchTab('hunt'); }}>Details</button>
                <button className="btn" onClick={() => navigate(selected)}>Navigate</button>
              </div>
            </div>
          ) : (
            <button className="card mini mini-summary" onClick={() => switchTab('hunt')}>
              <PeekBar ratings={ratings} selected={null} sun={sun} />
            </button>
          )}
        </div>
      )}

      {showInstallHelp && (
        <div className="modal-backdrop" onClick={() => setShowInstallHelp(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Install on your phone" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>Install on your phone</h2><button className="btn small" onClick={() => setShowInstallHelp(false)}>✕ Close</button></div>
            <section className="card modal-body">
              {isIOS ? (
                <ol className="small"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>
              ) : (
                <ol className="small"><li>Open the browser menu (⋮).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>
              )}
              <p className="tiny muted">Installed, it opens full-screen like an app and keeps map tiles you've viewed for use with weak signal.</p>
            </section>
            <div className="modal-foot"><button className="btn btn-primary" onClick={() => setShowInstallHelp(false)}>Done</button></div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Hunt settings" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>Hunt settings</h2><button className="btn small" onClick={() => setShowForm(false)}>✕ Close</button></div>
            <div className="modal-body">
              <HuntForm prefs={prefs} setPrefs={setPrefs} onGps={onGps} gpsStatus={gpsStatus} pickingStart={pickingStart} setPickingStart={(b) => { setPickingStart(b); if (b) { setShowForm(false); if (isMobile) switchTab('map'); } }} onClose={() => setShowForm(false)} onRun={runHunt} />
            </div>
            <div className="modal-foot"><button className="btn btn-primary" onClick={runHunt}>Show my best hunts</button></div>
          </div>
        </div>
      )}

      <aside className="panel">
        <nav className="tabs" role="tablist">
          {([['hunt', 'Hunt'], ['outlook', '7-Day'], ['journal', 'Journal'], ['sources', 'Sources']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={view === t} className={view === t ? 'on' : ''} onClick={() => switchTab(t)}><TabIcon tab={t} /> {l}</button>
          ))}
        </nav>
        <div className="panel-body" ref={panelRef}>
          {loadError && <div className="card warn">Could not load map data: {loadError}</div>}
          {!data && !loadError && <div className="card">Loading verified geographic data…</div>}
          {view === 'hunt' && (
            <>
              {!isMobile && inspect && jur && jurLegal && <InspectCard pt={inspect} j={jur} legalSummary={jurLegal.summary} onClose={() => setInspect(null)} onAddPin={(kind) => { addPin({ kind, coord: inspect, note: '' }); setInspect(null); }} onSetStart={() => { setPrefs({ ...prefs, start: inspect }); setInspect(null); }} onCheck={() => checkSpot(inspect)} checking={checking} />}
              {selected ? (
                <>
                  <RecDetail rec={selected} lidarStatus={selectedKey ? (typeof lidar[selectedKey.id] === 'object' ? 'done' : (lidar[selectedKey.id] as string | undefined) ?? (online ? 'loading' : 'offline')) : undefined} compare={selectedCompare} timeline={timeline} plan={plan} onPickSession={(s) => setSelectedKey((k) => (k ? { ...k, session: s } : k))} onClose={() => setSelectedKey(null)} saved={saved}
                    onSave={() => addPin({ kind: 'saved_candidate', coord: selected.center, note: `${selected.candidate.label}`, candidateId: selected.areaId })}
                    onNavigate={() => navigate(selected)}
                    onShowMap={() => showOnMap(selected)}
                    onJournal={() => { setJournalDraft({ location: `${selected.areaId} ${selected.candidate.label}`, coord: selected.center, candidateId: selected.areaId, date: selected.huntDate, method: selected.method, predictedScore: selected.score }); switchTab('journal'); }} />
                  <button className="btn btn-ghost small" onClick={() => exportGpx(selected)}>Export GPX waypoints</button>
                </>
              ) : (
                <>
                  <SettingsBar prefs={prefs} onOpen={() => setShowForm(true)} />
                  <TodayCard date={prefs.date} sun={sun} weather={weather} weatherError={weatherError} alerts={alerts} alertsError={alertsError} ratings={ratings} onRefresh={() => refreshWeather(true)} refreshing={refreshing} selected={null} windHourIdx={windHourIdx} setWindHourIdx={setWindHourIdx} />
                  <section className="card">
                    <h2>Top hunting areas{prefs.withKid && <span className="muted"> · kid-friendly</span>}{typeFilter !== 'all' && <span className="muted"> · {({ saddle: 'saddles', bench: 'benches', spur: 'spurs', bottom: 'creek bottoms' } as Record<string, string>)[typeFilter]} only</span>}</h2>
                    {prefs.withKid && <p className="tiny muted">Walks ≤ 15 min and no steep footing; short, open, close-to-the-truck spots score highest.</p>}
                    <div className="type-chips inline" role="radiogroup" aria-label="Filter by land">
                      {([['all', 'All land'], ['wma', 'WMA'], ['nf', 'National Forest']] as [LandFilter, string][]).map(([t, l]) => (
                        <button key={t} role="radio" aria-checked={landFilter === t} className={landFilter === t ? 'on' : ''} onClick={() => setLandFilter(t)}>{l}</button>
                      ))}
                    </div>
                    <div className="type-chips inline" role="radiogroup" aria-label="Filter by terrain type">
                      {([['all', 'All'], ['saddle', 'Saddles'], ['bench', 'Benches'], ['spur', 'Spurs'], ['bottom', 'Bottoms']] as [ZoneTypeFilter, string][]).map(([t, l]) => (
                        <button key={t} role="radio" aria-checked={typeFilter === t} className={typeFilter === t ? 'on' : ''} onClick={() => setTypeFilter(t)}>{l}</button>
                      ))}
                    </div>
                    <p className="tiny muted">{fmtDate(prefs.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {prefs.session === 'compare' || prefs.session === 'all' ? 'all sessions' : prefs.session} · ranked among {data?.candidates.length ?? '…'} terrain-derived zones. {ex && `${ex.prohibited ? `${ex.prohibited} zone-sessions excluded as not legal; ` : ''}${ex.overDistance ? `${ex.overDistance} beyond your walking limit.` : ''}`}</p>
                    {recs.length === 0 && data && <p className="warn small">No legally eligible zones match these settings. {evaluateLegal({ date: prefs.date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'A', youthHunter: prefs.youthHunter }).summary}</p>}
                    {recs.map((r, i) => <RecCard key={r.id} rec={r} rank={i + 1} active={false} onOpen={() => openRec(r)} />)}
                  </section>
                  <button className="btn big" onClick={() => setShowForm(true)}>Change date, weapon or session</button>
                </>
              )}
              {selected && <TodayCard date={selected.huntDate} sun={sunDay(selected.huntDate, selected.center[0], selected.center[1])} weather={weather} weatherError={weatherError} alerts={alerts} alertsError={alertsError} ratings={ratings} onRefresh={() => refreshWeather(true)} refreshing={refreshing} selected={selected} windHourIdx={windHourIdx} setWindHourIdx={setWindHourIdx} />}
            </>
          )}
          {view === 'outlook' && <Outlook days={outlook} compareId={selectedKey?.id ?? null} onPick={(date, r) => { setPrefs({ ...prefs, date }); openRec(r); }} />}
          {view === 'journal' && (
            <>
              <JournalPanel key={journalDraft?.candidateId ?? 'j'} entries={journal.entries} onSave={journal.save} onDelete={journal.remove} pins={pins} onDeletePin={removePin} draft={journalDraft} onFly={(c) => { if (isMobile) switchTab('map'); flyTo(c, 15); }} onFetchWeather={fetchJournalWeather} />
              <BackupPanel onExportJson={exportJson} onExportGpx={exportGpxAll} onImport={importFile} counts={{ pins: pins.length, journal: journal.entries.length }} />
              {importMsg && <p className="small card">{importMsg}</p>}
            </>
          )}
          {view === 'sources' && (
            <>
              {!standalone && <section className="card install-card"><h2>Use it like an app</h2><p className="small">Add Bankhead Hunt to your home screen to open it full-screen and keep viewed map tiles for weak-signal areas.</p><button className="btn btn-primary" onClick={onInstall}>⤓ Install / Add to Home Screen</button></section>}
              <OfflinePanel areas={areas} onSaveCurrent={() => { if (isMobile) switchTab('map'); saveCurrentArea(); }} onRemove={removeSavedArea} onShow={(a) => { if (isMobile) switchTab('map'); mapRef.current?.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { padding: 20 }); }} progress={dlProgress} cachedTiles={cachedTiles} online={online} />
              <SourcesPanel registry={data?.registry ?? null} />
            </>
          )}
          <p className="tiny muted foot">Decision support only. Scores are relative rankings, not probabilities. Always verify regulations, boundaries and access on site. © Rehtac Software LLC</p>
        </div>
      </aside>
      <TabBar tab={view} onTab={switchTab} hasSelection={!!selected} />
    </div>
  );
}

const LAYER_LABEL: Record<keyof LayerToggles, string> = {
  boundaries: 'WMA / National Forest / zone lines', ownership: 'Non-FS (private) parcels', wilderness: 'Sipsey Wilderness', roads: 'FS roads (inventory)', trails: 'NFS trails', streams: 'Derived streams', contours: 'Contours (20 m)', slope: 'Slope shading', disturbance: 'Burns & clear cuts (LANDFIRE)', lidar: 'Lidar hillshade (old roads & trails, zoom in)', candidates: 'Candidate zones (scored)', access: 'Access points', pins: 'My private pins',
};
