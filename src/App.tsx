import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { loadData, type AppData } from './data';
import { MapView, type BaseMap, type LayerToggles } from './components/MapView';
import { HuntForm, InspectCard, JournalPanel, Outlook, RecCard, RecDetail, SourcesPanel, TodayCard, type OutlookDay } from './components/Panels';
import type { HuntPreferences, HuntRecommendation, Session, WeatherAlert, WeatherBundle } from './engine/types';
import { addDays, BANKHEAD_CENTER, fmtDate, localDate, sessionWindows, sunDay } from './engine/time';
import { getAlerts, getWeather, hoursBetween } from './engine/weather';
import { evaluateCandidate, rankCandidates, sessionsFor } from './engine/scoring';
import { lookupJurisdiction } from './engine/geography';
import { evaluateLegal } from './engine/regulations';
import { useJournal, usePersisted, usePins, type JournalEntry } from './store';

type Tab = 'hunt' | 'outlook' | 'journal' | 'sources';
const BBOX = [-87.56, 34.2, -87.2, 34.47];
const inStudyArea = (p: [number, number] | null) => !!p && p[0] > BBOX[0] && p[0] < BBOX[2] && p[1] > BBOX[1] && p[1] < BBOX[3];

const DEFAULT_PREFS: HuntPreferences = { date: localDate(), session: 'compare', weapon: 'bow', target: 'any', maxWalkMeters: 3200, stand: 'climber', effort: 'balanced', youthHunter: false, start: null };
const DEFAULT_LAYERS: LayerToggles = { boundaries: true, ownership: true, wilderness: true, roads: true, trails: true, streams: true, contours: true, slope: false, candidates: true, access: true, pins: true };

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storedPrefs, setPrefs] = usePersisted<HuntPreferences>('bh.prefs.v1', DEFAULT_PREFS);
  // never carry a past date forward from storage
  const prefs = useMemo(() => (storedPrefs.date < localDate() ? { ...storedPrefs, date: localDate() } : storedPrefs), [storedPrefs]);
  const [base, setBase] = usePersisted<BaseMap>('bh.base.v1', 'topo');
  const [layers, setLayers] = usePersisted<LayerToggles>('bh.layers.v1', DEFAULT_LAYERS);
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
  const [sheet, setSheet] = useState<'peek' | 'half' | 'full'>('half');
  const [windHourIdx, setWindHourIdx] = useState(0);
  const [showLayers, setShowLayers] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [journalDraft, setJournalDraft] = useState<Partial<JournalEntry> | null>(null);
  const { pins, add: addPin, remove: removePin } = usePins();
  const journal = useJournal();
  const mapRef = useRef<MLMap | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData().then(setData).catch((e) => setLoadError(String(e)));
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
  useEffect(() => {
    const t = setInterval(() => refreshWeather(), 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [refreshWeather]);

  // ---- ranking (all sessions for the chosen date) ----
  const ranked = useMemo(() => {
    if (!data) return null;
    return rankCandidates(data.candidates, { prefs: { ...prefs, session: 'compare' }, weather, pins }, 5);
  }, [data, prefs, weather, pins]);
  const wanted = sessionsFor(prefs.session);
  const recs = useMemo(() => {
    if (!ranked) return [];
    const seen = new Set<string>();
    return wanted.flatMap((s) => ranked.bySession[s]).sort((a, b) => (a.legalStatus === b.legalStatus ? (b.score ?? -1) - (a.score ?? -1) : a.legalStatus === 'verified_allowed' ? -1 : 1)).filter((r) => (seen.has(r.areaId) ? false : (seen.add(r.areaId), true))).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, prefs.session]);
  const ratings = useMemo(() => ({ morning: ranked?.bySession.morning[0] ?? null, midday: ranked?.bySession.midday[0] ?? null, evening: ranked?.bySession.evening[0] ?? null }), [ranked]);

  const mapScores = useMemo(() => {
    const m = new Map<string, number | null>();
    if (!data) return m;
    for (const c of data.candidates) {
      let best: number | null = null;
      for (const s of wanted) {
        const r = evaluateCandidate(c, s, { prefs, weather, pins });
        if (r.legalStatus === 'verified_prohibited') continue;
        if (r.score != null && (best == null || r.score > best)) best = r.score;
      }
      m.set(c.properties.id, best);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs, weather, pins]);

  const selected = useMemo<HuntRecommendation | null>(() => {
    if (!selectedKey || !data) return null;
    const c = data.candidates.find((x) => x.properties.id === selectedKey.id);
    return c ? evaluateCandidate(c, selectedKey.session, { prefs: { ...prefs, date: selectedKey.date }, weather, pins }) : null;
  }, [selectedKey, data, prefs, weather, pins]);
  const selectedCompare = useMemo(() => {
    if (!selectedKey || !data) return {};
    const c = data.candidates.find((x) => x.properties.id === selectedKey.id);
    if (!c) return {};
    return Object.fromEntries((['morning', 'midday', 'evening'] as Session[]).map((s) => [s, evaluateCandidate(c, s, { prefs: { ...prefs, date: selectedKey.date }, weather, pins })]));
  }, [selectedKey, data, prefs, weather, pins]);

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
    if (!data || tab !== 'outlook') return [];
    const today = localDate();
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const ctx = { prefs: { ...prefs, date }, weather, pins };
      const m = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'morning' } }, 1);
      const e = rankCandidates(data.candidates, { ...ctx, prefs: { ...ctx.prefs, session: 'evening' } }, 1);
      const sel = selectedKey ? data.candidates.find((c) => c.properties.id === selectedKey.id) : null;
      const dw = weather?.daily.find((d) => d.date === date);
      return {
        date, sun: sunDay(date, wxPoint[0], wxPoint[1]), morning: m.recommendations[0] ?? null, evening: e.recommendations[0] ?? null,
        compareMorning: sel ? evaluateCandidate(sel, 'morning', ctx) : null, compareEvening: sel ? evaluateCandidate(sel, 'evening', ctx) : null,
        tMax: dw?.tMaxF ?? null, tMin: dw?.tMinF ?? null, precip: dw?.precipIn ?? null, windDom: dw?.windDominant ?? null, windMax: dw?.windMaxMph ?? null,
        legal: evaluateLegal({ date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'A', youthHunter: prefs.youthHunter }),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, prefs, weather, pins, selectedKey]);

  // ---- interactions ----
  const flyTo = (c: [number, number], zoom = 14.5) => mapRef.current?.flyTo({ center: c, zoom, padding: window.innerWidth < 900 ? { bottom: window.innerHeight * 0.45, top: 0, left: 0, right: 0 } : { left: 440, top: 0, bottom: 0, right: 0 } });
  const openRec = (r: HuntRecommendation) => {
    setSelectedKey({ id: r.areaId, session: r.session, date: r.huntDate });
    setInspect(null);
    setWindHourIdx(0);
    setTab('hunt');
    flyTo(r.center);
    panelRef.current?.scrollTo({ top: 0 });
  };
  const onCandidate = (id: string) => {
    const c = data?.candidates.find((x) => x.properties.id === id);
    if (!c) return;
    // open the best of the requested sessions
    const evals = wanted.map((s) => evaluateCandidate(c, s, { prefs, weather, pins }));
    openRec(evals.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]);
    if (sheet === 'peek') setSheet('half');
  };
  const onInspect = (pt: [number, number]) => {
    if (pickingStart) {
      setPrefs({ ...prefs, start: pt });
      setPickingStart(false);
      return;
    }
    setInspect(pt);
    setSelectedKey(null);
    setTab('hunt');
    if (sheet === 'peek') setSheet('half');
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
  const jurLegal = jur ? evaluateLegal({ date: prefs.date, weapon: prefs.weapon, target: prefs.target, jurisdiction: jur.kind, zone: jur.zone, youthHunter: prefs.youthHunter }) : null;
  const saved = selected ? pins.some((p) => p.kind === 'saved_candidate' && p.candidateId === selected.areaId) : false;
  const ex = ranked?.excluded;

  return (
    <div className={`app sheet-${sheet}`}>
      <header className="topbar">
        <div className="brand"><span className="logo">◭</span><div><b>BANKHEAD HUNT INTELLIGENCE</b><div className="tiny muted">{fmtDate(localDate())}{!online && ' · OFFLINE — cached data'}</div></div></div>
      </header>
      <MapView data={data} base={base} layers={layers} scores={mapScores} selected={selected} windHour={windHour} userLoc={userLoc} pins={pins} startPin={prefs.start} onCandidate={onCandidate} onInspect={onInspect} mapRef={mapRef} />
      <div className="map-tools">
        <button className="btn fab" onClick={() => setShowLayers(!showLayers)} aria-expanded={showLayers}>Layers</button>
        <button className="btn fab" onClick={onGps} aria-label="Locate me">◎</button>
        {showLayers && (
          <div className="layers card">
            <div className="seg small">{(['topo', 'satellite', 'hybrid', 'hillshade'] as BaseMap[]).map((b) => <button key={b} className={base === b ? 'on' : ''} onClick={() => setBase(b)}>{b}</button>)}</div>
            {(Object.keys(DEFAULT_LAYERS) as (keyof LayerToggles)[]).map((k) => (
              <label key={k} className="check small"><input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} /> {LAYER_LABEL[k]}</label>
            ))}
            <div className="legend tiny">
              <div><i style={{ background: '#5fbf5a' }} />High <i style={{ background: '#e0a43a' }} />Medium <i style={{ background: '#b0413e' }} />Low <i style={{ background: '#7a7a7a' }} />Not legal</div>
              <div><i className="ln" style={{ background: '#f2b84b' }} />WMA <i className="ln" style={{ background: '#ffd84d' }} />Zone A|B (AL 33) <i style={{ background: '#d64545', opacity: 0.5 }} />Non-FS land</div>
              <div><i className="ln" style={{ background: '#e36b5b' }} />NFS trail <i className="ln" style={{ background: '#f0e6d2' }} />FS road <i style={{ background: '#3fa7ff', borderRadius: 8 }} />Access</div>
            </div>
          </div>
        )}
        {pickingStart && <div className="toast">Tap the map to set your starting point</div>}
      </div>
      {selected && selected.windAssessment.windFromDegrees != null && (
        <div className="wind-widget" aria-label="Wind">
          <svg width="64" height="64" viewBox="-32 -32 64 64"><circle r="30" fill="rgba(10,16,12,.75)" stroke="#ffffff40" /><text y="-20" textAnchor="middle" fontSize="9" fill="#ccc">N</text><g transform={`rotate(${((windHour?.from ?? selected.windAssessment.windFromDegrees) + 180) % 360})`}><path d="M0,-22 L8,2 L2,0 L2,20 L-2,20 L-2,0 L-8,2 Z" fill="#ff9f43" /></g></svg>
          <div className="tiny">scent →</div>
        </div>
      )}

      <aside className="panel">
        <button className="grab" aria-label="Resize panel" onClick={() => setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek')}><span /></button>
        <nav className="tabs" role="tablist">
          {([['hunt', 'Hunt'], ['outlook', '7-Day'], ['journal', 'Journal'], ['sources', 'Sources']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (sheet === 'peek') setSheet('half'); }}>{l}</button>
          ))}
        </nav>
        <div className="panel-body" ref={panelRef}>
          {loadError && <div className="card warn">Could not load map data: {loadError}</div>}
          {!data && !loadError && <div className="card">Loading verified geographic data…</div>}
          {tab === 'hunt' && (
            <>
              {inspect && jur && jurLegal && <InspectCard pt={inspect} j={jur} legalSummary={jurLegal.summary} onClose={() => setInspect(null)} onAddPin={(kind) => { addPin({ kind, coord: inspect, note: '' }); setInspect(null); }} onSetStart={() => { setPrefs({ ...prefs, start: inspect }); setInspect(null); }} />}
              {selected ? (
                <>
                  <RecDetail rec={selected} compare={selectedCompare} onClose={() => setSelectedKey(null)} saved={saved}
                    onSave={() => addPin({ kind: 'saved_candidate', coord: selected.center, note: `${selected.candidate.label}`, candidateId: selected.areaId })}
                    onNavigate={() => navigate(selected)}
                    onJournal={() => { setJournalDraft({ location: `${selected.areaId} ${selected.candidate.label}`, coord: selected.center, candidateId: selected.areaId, date: selected.huntDate, method: selected.method, predictedScore: selected.score }); setTab('journal'); }} />
                  <button className="btn btn-ghost small" onClick={() => exportGpx(selected)}>Export GPX waypoints</button>
                </>
              ) : (
                <>
                  <TodayCard date={prefs.date} sun={sun} weather={weather} weatherError={weatherError} alerts={alerts} alertsError={alertsError} ratings={ratings} onRefresh={() => refreshWeather(true)} refreshing={refreshing} selected={null} windHourIdx={windHourIdx} setWindHourIdx={setWindHourIdx} />
                  <section className="card">
                    <h2>Top hunting areas</h2>
                    <p className="tiny muted">{fmtDate(prefs.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {prefs.session === 'compare' || prefs.session === 'all' ? 'all sessions' : prefs.session} · ranked among {data?.candidates.length ?? '…'} terrain-derived zones. {ex && `${ex.prohibited ? `${ex.prohibited} zone-sessions excluded as not legal; ` : ''}${ex.overDistance ? `${ex.overDistance} beyond your walking limit.` : ''}`}</p>
                    {recs.length === 0 && data && <p className="warn small">No legally eligible zones match these settings. {evaluateLegal({ date: prefs.date, weapon: prefs.weapon, target: prefs.target, jurisdiction: 'black_warrior_wma', zone: 'A', youthHunter: prefs.youthHunter }).summary}</p>}
                    {recs.map((r, i) => <RecCard key={r.id} rec={r} rank={i + 1} active={false} onOpen={() => openRec(r)} />)}
                  </section>
                  <HuntForm prefs={prefs} setPrefs={setPrefs} onGps={onGps} gpsStatus={gpsStatus} pickingStart={pickingStart} setPickingStart={setPickingStart} onRun={() => { panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); if (recs[0]) flyTo(recs[0].center, 12.5); }} />
                </>
              )}
              {selected && <TodayCard date={selected.huntDate} sun={sunDay(selected.huntDate, selected.center[0], selected.center[1])} weather={weather} weatherError={weatherError} alerts={alerts} alertsError={alertsError} ratings={ratings} onRefresh={() => refreshWeather(true)} refreshing={refreshing} selected={selected} windHourIdx={windHourIdx} setWindHourIdx={setWindHourIdx} />}
            </>
          )}
          {tab === 'outlook' && <Outlook days={outlook} compareId={selectedKey?.id ?? null} onPick={(date, r) => { setPrefs({ ...prefs, date }); openRec(r); }} />}
          {tab === 'journal' && <JournalPanel key={journalDraft?.candidateId ?? 'j'} entries={journal.entries} onSave={journal.save} onDelete={journal.remove} pins={pins} onDeletePin={removePin} draft={journalDraft} onFly={(c) => flyTo(c, 15)} />}
          {tab === 'sources' && <SourcesPanel registry={data?.registry ?? null} />}
          <p className="tiny muted foot">Decision support only. Scores are relative rankings, not probabilities. Always verify regulations, boundaries and access on site. © Rehtac Software LLC</p>
        </div>
      </aside>
    </div>
  );
}

const LAYER_LABEL: Record<keyof LayerToggles, string> = {
  boundaries: 'WMA / NF / Zone A|B boundaries', ownership: 'Non-FS (private) parcels', wilderness: 'Sipsey Wilderness', roads: 'FS roads (inventory)', trails: 'NFS trails', streams: 'Derived streams', contours: 'Contours (20 m)', slope: 'Slope shading', candidates: 'Candidate zones (scored)', access: 'Access points', pins: 'My private pins',
};
