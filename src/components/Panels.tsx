import { useState } from 'react';
import type { HuntPreferences, HuntRecommendation, Session, UserPin, WeatherAlert, WeatherBundle } from '../engine/types';
import { addDays, fmtDate, fmtTime, localDate, sessionWindows, sunDay, type SunDay } from '../engine/time';
import { compass } from '../engine/wind';
import { dataAge, hoursBetween, hpaToInHg, weatherText } from '../engine/weather';
import { GOVERNING_LINKS, weaponLabel } from '../engine/regulations';
import { rutPhase, RUT_SOURCES } from '../engine/rut';
import { scoreBand } from '../engine/scoring';
import type { Jurisdiction } from '../engine/geography';
import type { SourceRegistry } from '../data';
import type { JournalEntry } from '../store';
import { uid } from '../store';

export const SESSION_LABEL: Record<Session, string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' };
const mi = (m: number) => `${(m / 1609.34).toFixed(1)} mi`;

export function ScorePill({ score, legal }: { score: number | null; legal?: HuntRecommendation['legalStatus'] }) {
  if (legal === 'requires_verification') return <span className="pill pill-verify">Verify regs</span>;
  if (score == null) return <span className="pill pill-na">—</span>;
  const band = scoreBand(score);
  return <span className={`pill pill-${band.toLowerCase()}`}>{score}<small> {band}</small></span>;
}

export function ConfidenceTag({ c }: { c: HuntRecommendation['confidence'] }) {
  return <span className={`conf conf-${c}`}>{c === 'insufficient' ? 'Insufficient data' : `${c[0].toUpperCase()}${c.slice(1)} confidence`}</span>;
}

export function LegalBadge({ status }: { status: HuntRecommendation['legalStatus'] }) {
  const t = { verified_allowed: 'Legal (verified)', verified_prohibited: 'Not legal', requires_verification: 'Regulations require verification' }[status];
  return <span className={`legal legal-${status}`}>{t}</span>;
}

export function WindArrow({ from, size = 44 }: { from: number | null; size?: number }) {
  if (from == null) return <span className="wind-na">—</span>;
  // arrow points the direction the wind blows TOWARD (downwind)
  return (
    <svg width={size} height={size} viewBox="-22 -22 44 44" aria-label={`Wind from ${compass(from)}`} className="wind-arrow">
      <circle r="20" fill="none" stroke="currentColor" strokeOpacity="0.3" />
      <text y="-12" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.6">N</text>
      <g transform={`rotate(${(from + 180) % 360})`}>
        <path d="M0,-15 L6,2 L1.5,0 L1.5,14 L-1.5,14 L-1.5,0 L-6,2 Z" fill="#ff9f43" />
      </g>
    </svg>
  );
}

// ---------------- Settings chip bar (replaces scrolling to the form) ----------------
const SESSION_SHORT: Record<HuntPreferences['session'], string> = { morning: 'Morning', evening: 'Evening', midday: 'Midday', all: 'All day', compare: 'AM vs PM' };
export function SettingsBar({ prefs, onOpen }: { prefs: HuntPreferences; onOpen: () => void }) {
  const today = localDate();
  const dateLabel = prefs.date === today ? 'Today' : prefs.date === addDays(today, 1) ? 'Tomorrow' : fmtDate(prefs.date, { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <button className="settings-bar" onClick={onOpen} aria-label="Change hunt settings">
      <span className="chip">{dateLabel}</span>
      <span className="chip">{SESSION_SHORT[prefs.session]}</span>
      <span className="chip">{weaponLabel(prefs.weapon).replace('Compound bow', 'Bow')}</span>
      <span className="chip">≤ {mi(prefs.maxWalkMeters)}</span>
      <span className="chip chip-edit">Change ›</span>
    </button>
  );
}

/** One-line summary shown when the sheet is collapsed to a strip. */
export function PeekBar({ ratings, selected }: { ratings: Record<Session, HuntRecommendation | null>; selected: HuntRecommendation | null }) {
  if (selected) {
    return (
      <div className="peek">
        <ScorePill score={selected.score} legal={selected.legalStatus} />
        <div className="peek-text"><b>{selected.candidate.label}</b> · {selected.areaId}<div className="tiny muted">{SESSION_LABEL[selected.session]} · wind risk {selected.windAssessment.risk} · tap to open</div></div>
      </div>
    );
  }
  const m = ratings.morning, e = ratings.evening;
  const best = (m?.score ?? -1) >= (e?.score ?? -1) ? 'Morning' : 'Evening';
  return (
    <div className="peek">
      <div className="peek-scores"><span className="tiny muted">AM</span><ScorePill score={m?.score ?? null} legal={m?.legalStatus} /><span className="tiny muted">PM</span><ScorePill score={e?.score ?? null} legal={e?.legalStatus} /></div>
      <div className="peek-text"><b>{m || e ? `${best} favored` : 'No legal zones'}</b><div className="tiny muted">tap or drag up for top areas</div></div>
    </div>
  );
}

// ---------------- Hunt form ----------------
export function HuntForm({ prefs, setPrefs, onGps, gpsStatus, pickingStart, setPickingStart, onRun, onClose }: { prefs: HuntPreferences; setPrefs: (p: HuntPreferences) => void; onGps: () => void; gpsStatus: string; pickingStart: boolean; setPickingStart: (b: boolean) => void; onRun: () => void; onClose?: () => void }) {
  const today = localDate();
  const set = <K extends keyof HuntPreferences>(k: K, v: HuntPreferences[K]) => setPrefs({ ...prefs, [k]: v });
  const Seg = <T extends string>({ value, opts, on }: { value: T; opts: [T, string][]; on: (v: T) => void }) => (
    <div className="seg" role="radiogroup">
      {opts.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => on(v)}>{l}</button>
      ))}
    </div>
  );
  const dateMode = prefs.date === today ? 'today' : prefs.date === addDays(today, 1) ? 'tomorrow' : 'custom';
  return (
    <section className="card form">
      <div className="card-head"><h2>Hunt settings</h2>{onClose && <button className="btn btn-ghost small" onClick={onClose}>✕ Close</button>}</div>
      <label>Date</label>
      <div className="row">
        <Seg value={dateMode} opts={[['today', 'Today'], ['tomorrow', 'Tomorrow'], ['custom', 'Custom']]} on={(v) => set('date', v === 'today' ? today : v === 'tomorrow' ? addDays(today, 1) : prefs.date)} />
        <input type="date" value={prefs.date} min={today} onChange={(e) => e.target.value && set('date', e.target.value)} aria-label="Custom hunt date" />
      </div>
      <label>Session</label>
      <Seg value={prefs.session} opts={[['morning', 'Morning'], ['evening', 'Evening'], ['all', 'All day'], ['compare', 'Compare']]} on={(v) => set('session', v)} />
      <label>Weapon</label>
      <Seg value={prefs.weapon} opts={[['bow', 'Bow'], ['crossbow', 'Crossbow'], ['rifle', 'Rifle'], ['muzzleloader', 'Muzzleloader']]} on={(v) => set('weapon', v)} />
      <label>Target (whitetail deer)</label>
      <Seg value={prefs.target} opts={[['any', 'Any legal deer'], ['mature_buck', 'Mature buck'], ['doe', 'Doe']]} on={(v) => set('target', v)} />
      <label>Stand type</label>
      <Seg value={prefs.stand} opts={[['climber', 'Climber'], ['saddle', 'Saddle'], ['hang_on', 'Hang-on'], ['ground', 'Ground']]} on={(v) => set('stand', v)} />
      <label>Effort</label>
      <Seg value={prefs.effort} opts={[['easy', 'Easy access'], ['balanced', 'Balanced'], ['deep', 'Deep woods']]} on={(v) => set('effort', v)} />
      <label htmlFor="maxwalk">Max walking distance: <b>{mi(prefs.maxWalkMeters)}</b> (estimated)</label>
      <input id="maxwalk" type="range" min={400} max={6400} step={200} value={prefs.maxWalkMeters} onChange={(e) => set('maxWalkMeters', Number(e.target.value))} />
      <label>Starting point</label>
      <div className="row wrap">
        <button className="btn" onClick={onGps}>📍 Use my GPS</button>
        <button className={`btn ${pickingStart ? 'btn-on' : ''}`} onClick={() => setPickingStart(!pickingStart)}>{pickingStart ? 'Tap the map…' : 'Pick on map'}</button>
        {prefs.start && <button className="btn btn-ghost" onClick={() => set('start', null)}>Clear</button>}
      </div>
      <p className="muted small">{prefs.start ? `Start: ${prefs.start[1].toFixed(5)}, ${prefs.start[0].toFixed(5)}` : 'No start point — nearest access point is used.'} {gpsStatus}</p>
      <label className="check"><input type="checkbox" checked={prefs.youthHunter} onChange={(e) => set('youthHunter', e.target.checked)} /> Youth hunter (under 16, supervised)</label>
      <button className="btn btn-primary big" onClick={onRun}>Show my best hunts</button>
    </section>
  );
}

// ---------------- Today's hunt ----------------
export function TodayCard({ date, sun, weather, weatherError, alerts, alertsError, ratings, onRefresh, refreshing, selected, windHourIdx, setWindHourIdx }: {
  date: string; sun: SunDay; weather: WeatherBundle | null; weatherError: string | null; alerts: WeatherAlert[]; alertsError: string | null;
  ratings: Record<Session, HuntRecommendation | null>; onRefresh: () => void; refreshing: boolean; selected: HuntRecommendation | null; windHourIdx: number; setWindHourIdx: (n: number) => void;
}) {
  const age = dataAge(weather);
  const isToday = date === localDate();
  const cur = isToday ? weather?.current ?? null : null;
  const wins = sessionWindows(sun);
  const best = (['morning', 'evening'] as Session[]).map((s) => ratings[s]).filter(Boolean).sort((a, b) => (b!.score ?? -1) - (a!.score ?? -1))[0];
  const toSunset = sun.legalEnd - Date.now();
  const sessionHours = selected ? hoursBetween(weather, wins[selected.session].start, wins[selected.session].end) : [];
  const rut = rutPhase(date);
  const nextHours = weather ? weather.hourly.filter((h) => h.time >= Date.now() - 3600000).slice(0, 12) : [];
  return (
    <section className="card today">
      <div className="card-head">
        <h2>{isToday ? "Today's hunt" : 'Hunt day'} · {fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
        <button className="btn btn-ghost small" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : '↻ Weather'}</button>
      </div>
      {alerts.length > 0 && <div className="alert-box">{alerts.map((a) => <div key={a.headline}><b>⚠ {a.event}</b> — {a.headline}</div>)}</div>}
      {alertsError && <p className="warn small">{alertsError}</p>}
      {weatherError && <p className="warn small">{weatherError}</p>}
      <div className="ratings">
        {(['morning', 'midday', 'evening'] as Session[]).map((s) => (
          <div key={s} className={`rating ${best?.session === s ? 'best' : ''}`}>
            <div className="muted small">{SESSION_LABEL[s]}</div>
            <ScorePill score={ratings[s]?.score ?? null} legal={ratings[s]?.legalStatus} />
            <div className="tiny muted">{fmtTime(wins[s].start)}–{fmtTime(wins[s].end)}</div>
          </div>
        ))}
      </div>
      {best && <p className="small">Recommended: <b>{SESSION_LABEL[best.session]}</b> — top zone scores {best.score} vs. {(['morning', 'evening'] as Session[]).filter((s) => s !== best.session).map((s) => `${ratings[s]?.score ?? '—'} ${SESSION_LABEL[s].toLowerCase()}`).join('')}. Ratings are the best-scoring legal zone per session, not a probability.</p>}
      {!best && <p className="small warn">No legally eligible zones for this date and weapon — see regulation status below.</p>}
      <div className="grid2">
        <div><span className="muted">Legal light</span><br /><b>{fmtTime(sun.legalStart)} – {fmtTime(sun.legalEnd)}</b></div>
        <div><span className="muted">Sunrise / sunset</span><br /><b>{fmtTime(sun.sunrise)} / {fmtTime(sun.sunset)}</b></div>
        {isToday && toSunset > 0 && <div><span className="muted">Legal light remaining</span><br /><b>{Math.floor(toSunset / 3600000)}h {Math.round((toSunset % 3600000) / 60000)}m</b></div>}
        <div><span className="muted">Moon</span><br /><b>{sun.moon.phaseName}</b> {Math.round(sun.moon.illumination * 100)}% <span className="tiny muted">(minor factor)</span></div>
        <div><span className="muted">Rut phase (est.)</span><br /><b>{rut.label}</b> <span className="tiny muted">low confidence</span></div>
      </div>
      {cur ? (
        <div className="current">
          <WindArrow from={cur.windFrom} size={56} />
          <div>
            <div className="big-num">{Math.round(cur.tempF ?? 0)}°F <span className="small muted">feels {Math.round(cur.feelsF ?? 0)}°</span></div>
            <div>Wind <b>{compass(cur.windFrom)}</b> {Math.round(cur.windMph ?? 0)} mph, gusts {Math.round(cur.gustMph ?? 0)} · scent drifts <b>{cur.windFrom != null ? compass((cur.windFrom + 180) % 360) : '—'}</b></div>
            <div className="small muted">{weatherText(cur.code)} · {cur.cloud}% cloud · RH {cur.humidity}% · {hpaToInHg(cur.pressureHpa)?.toFixed(2)} inHg</div>
          </div>
        </div>
      ) : (
        <p className="muted small">{isToday ? 'Current conditions unavailable.' : 'Showing forecast for the selected date in the session panels.'}</p>
      )}
      <p className={`tiny ${age.stale ? 'warn' : 'muted'}`}>
        {weather ? <>Open-Meteo forecast fetched {fmtTime(weather.fetchedAt)} ({age.minutes} min ago){weather.fromCache ? ' · cached' : ''}{age.stale ? ' — STALE, not live' : ''}</> : 'No forecast loaded.'}
      </p>
      {isToday && nextHours.length > 0 && (
        <div className="hours" aria-label="Hourly wind forecast">
          {nextHours.map((h) => (
            <div key={h.time} className="hour">
              <div className="tiny muted">{fmtTime(h.time).replace(':00', '')}</div>
              <WindArrow from={h.windFrom} size={28} />
              <div className="tiny">{Math.round(h.windMph ?? 0)}</div>
              <div className="tiny muted">{Math.round(h.tempF ?? 0)}°</div>
            </div>
          ))}
        </div>
      )}
      {selected && sessionHours.length > 0 && (
        <div className="windshift">
          <label className="small">Wind shift during {SESSION_LABEL[selected.session].toLowerCase()} at {selected.areaId}: <b>{fmtTime(sessionHours[Math.min(windHourIdx, sessionHours.length - 1)].time)}</b> — {compass(sessionHours[Math.min(windHourIdx, sessionHours.length - 1)].windFrom)} {Math.round(sessionHours[Math.min(windHourIdx, sessionHours.length - 1)].windMph ?? 0)} mph</label>
          <input type="range" min={0} max={sessionHours.length - 1} value={Math.min(windHourIdx, sessionHours.length - 1)} onChange={(e) => setWindHourIdx(Number(e.target.value))} />
          <p className="tiny muted">The orange cone on the map is a schematic scent direction, not a validated dispersion model.</p>
        </div>
      )}
    </section>
  );
}

// ---------------- Recommendation card + detail ----------------
export function RecCard({ rec, rank, onOpen, active }: { rec: HuntRecommendation; rank: number; onOpen: () => void; active: boolean }) {
  const p = rec.candidate;
  return (
    <button className={`rec ${active ? 'active' : ''}`} onClick={onOpen}>
      <div className="rec-rank">{rank}</div>
      <div className="rec-body">
        <div className="rec-title">{p.label} <span className="muted">· {rec.areaId}</span></div>
        <div className="small">{rec.landJurisdiction} · {SESSION_LABEL[rec.session]} {rec.recommendedWindow?.start}–{rec.recommendedWindow?.end}</div>
        <div className="small muted">{rec.route ? `${mi(rec.route.distanceMeters)} est. walk from ${rec.route.name}` : 'No access route'} · wind risk {rec.windAssessment.risk}</div>
        <div className="row tags"><LegalBadge status={rec.legalStatus} /><ConfidenceTag c={rec.confidence} /></div>
        {rec.reasons[0] && <div className="small reason">{rec.reasons[0]}</div>}
      </div>
      <ScorePill score={rec.score} legal={rec.legalStatus} />
    </button>
  );
}

export function RecDetail({ rec, compare, onClose, onSave, saved, onNavigate, onJournal, onShowMap }: { rec: HuntRecommendation; compare: Partial<Record<Session, HuntRecommendation>>; onClose: () => void; onSave: () => void; saved: boolean; onNavigate: () => void; onJournal: () => void; onShowMap?: () => void }) {
  const p = rec.candidate;
  const [open, setOpen] = useState<string | null>('why');
  const Sec = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <div className="acc">
      <button className="acc-h" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>{title}<span>{open === id ? '−' : '+'}</span></button>
      {open === id && <div className="acc-b">{children}</div>}
    </div>
  );
  const w = rec.windAssessment;
  return (
    <section className="card detail">
      <div className="card-head">
        <button className="btn btn-ghost small" onClick={onClose}>← Back</button>
        <ScorePill score={rec.score} legal={rec.legalStatus} />
      </div>
      <h2>{p.label} <span className="muted">{rec.areaId}</span></h2>
      <p className="small">{rec.landJurisdiction} · {fmtDate(rec.huntDate, { weekday: 'short', month: 'short', day: 'numeric' })} · {SESSION_LABEL[rec.session]} {rec.recommendedWindow?.start}–{rec.recommendedWindow?.end} · {weaponLabel(rec.method)}</p>
      <div className="row tags"><LegalBadge status={rec.legalStatus} /><ConfidenceTag c={rec.confidence} /></div>
      <p className="small coords">📍 {p.center[1].toFixed(5)}, {p.center[0].toFixed(5)} · {p.areaHa} ha scouting zone · {Math.round(p.elevationM * 3.28)} ft</p>
      <div className="row wrap">
        <button className="btn btn-primary" onClick={onNavigate}>Navigate to access</button>
        <button className="btn" onClick={onSave} disabled={saved}>{saved ? '★ Saved' : '☆ Save zone'}</button>
        <button className="btn" onClick={onJournal}>Log hunt</button>
        {onShowMap && <button className="btn mobile-only" onClick={onShowMap}>🗺 Show on map</button>}
      </div>
      <p className="tiny muted">This is a scouting zone, not a verified stand location or proof that deer are present.</p>

      {Object.keys(compare).length > 1 && (
        <div className="compare">
          {(Object.entries(compare) as [Session, HuntRecommendation][]).map(([s, r]) => (
            <div key={s} className={`rating ${s === rec.session ? 'best' : ''}`}><div className="small muted">{SESSION_LABEL[s]}</div><ScorePill score={r.score} legal={r.legalStatus} /><div className="tiny muted">wind {r.windAssessment.risk}</div></div>
          ))}
        </div>
      )}

      <Sec id="why" title="Why this hunt? — score breakdown">
        {rec.components.map((c) => (
          <div key={c.key} className="comp">
            <div className="comp-h"><span>{c.label} <span className="muted tiny">({Math.round(c.weight * 100)}%)</span></span><span className="bar"><i style={{ width: `${c.value * 100}%` }} /></span><b>{Math.round(c.value * 100)}</b></div>
            {c.positives.map((t) => <div key={t} className="plus small">+ {t}</div>)}
            {c.negatives.map((t) => <div key={t} className="minus small">− {t}</div>)}
          </div>
        ))}
        <p className="tiny muted">Weights are initial product hypotheses (model {rec.modelVersion}); the score ranks candidates relative to each other and is not a probability of seeing or harvesting deer.</p>
      </Sec>
      <Sec id="wind" title="Wind & scent">
        <div className="row"><WindArrow from={w.windFromDegrees} size={56} /><div className="small">Average wind from <b>{compass(w.windFromDegrees)}</b> ({w.windFromDegrees ?? '—'}°) at {w.speedMph ?? '—'} mph. Scent drifts toward <b>{compass(w.scentDownwindDegrees)}</b> ({w.scentDownwindDegrees ?? '—'}°). Variability ±{w.variabilityDeg ?? '—'}°. Risk: <b>{w.risk}</b>.</div></div>
        <p className="small">Hypothesised bedding cover: {p.beddingCoverBearing != null ? <b>{compass(p.beddingCoverBearing)}</b> : 'not derived'} · food/water side: {p.foodWaterBearing != null ? <b>{compass(p.foodWaterBearing)}</b> : 'not derived'} <span className="tiny muted">(derived from terrain/vegetation, not observed)</span></p>
        <p className="small">Thermals: {w.thermal.flow} · uncertainty <b>{w.thermal.uncertainty}</b>. Slope faces {p.aspectName} ({p.aspectDeg}°), so drainage flow runs {compass(p.aspectDeg)} and daytime upslope flow runs {compass((p.aspectDeg + 180) % 360)}.</p>
        {w.notes.map((n) => <div key={n} className="minus small">− {n}</div>)}
      </Sec>
      <Sec id="terrain" title="Terrain & habitat evidence">
        <ul className="small">
          <li>Feature: <b>{p.label}</b> (derived from USGS 3DEP DEM). Nearby: {p.nearbyFeatures.join(', ') || '—'}.</li>
          <li>Slope {p.slopeDeg}° (area mean {p.meanSlopeDeg}°), local relief {p.localReliefM} m, aspect {p.aspectName}, TPI local {p.tpiLocal} / landscape {p.tpiLandscape}.</li>
          <li>{p.distStreamM} m to derived stream channel · {p.distRoadM} m to mapped road · {p.distTrailM} m to NFS trail.</li>
          <li>Habitat (LANDFIRE 30 m, potential only): {rec.habitatIndicators.join(' · ') || 'no strong indicators'}; edge density {Math.round(p.habitat.edgeDensity * 100)}%.</li>
        </ul>
        <p className="tiny muted">Status: derived / habitat potential. Current acorn drop, deer trails and beds are not observable from these data.</p>
      </Sec>
      <Sec id="access" title="Access & approach">
        {rec.route ? (
          <ul className="small">
            <li>Start: <b>{rec.route.name}</b> ({rec.route.coord[1].toFixed(5)}, {rec.route.coord[0].toFixed(5)})</li>
            <li>Distance: ~{mi(rec.route.distanceMeters)} estimated walk (straight line × 1.3). <b>Not a verified traversable route.</b></li>
            <li>Elevation gain in: ~{Math.round((rec.route.elevationGainMeters ?? 0) * 3.28)} ft (straight-line profile).</li>
            <li>{rec.route.verification}</li>
            <li>Approach heading {compass(p.routes.find((r) => r.accessPointId === rec.route!.verifiedAccessPointId)?.approachBearing ?? null)}.</li>
          </ul>
        ) : <p className="small">No access point within range.</p>}
        <p className="tiny muted">Road appearance does not prove legal vehicle access. Check the USFS Motor Vehicle Use Map and posted gates.</p>
      </Sec>
      <Sec id="legal" title="Regulations at this location">
        <p className="small"><LegalBadge status={rec.legal.status} /> {rec.legal.summary}</p>
        {rec.legal.bag && <p className="small">Bag: {rec.legal.bag}</p>}
        {rec.legal.antlerRestriction && <p className="small"><b>{rec.legal.antlerRestriction}</b></p>}
        {rec.legal.exceptions.map((e) => <p key={e} className="small warn">{e}</p>)}
        <ul className="small">{rec.legal.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="tiny">Source: <a href={rec.legal.ruleSource.url} target="_blank" rel="noreferrer">{rec.legal.ruleSource.title}</a> ({rec.legal.ruleSource.version}). This app does not check you in or report harvests — use the Outdoor Alabama app.</p>
      </Sec>
      {(rec.warnings.length > 0 || rec.improvements.length > 0) && (
        <Sec id="improve" title="Risks & how this hunt could improve">
          {rec.warnings.map((t) => <div key={t} className="minus small">⚠ {t}</div>)}
          {rec.improvements.map((t) => <div key={t} className="plus small">→ {t}</div>)}
        </Sec>
      )}
      <Sec id="conf" title={`Confidence: ${rec.confidence}`}>
        <ul className="small">{rec.confidenceReasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="tiny muted">Evidence: {rec.evidence.map((e) => `${e.sourceId} (${e.status})`).join(' · ')}</p>
      </Sec>
    </section>
  );
}

// ---------------- 7-day outlook ----------------
export interface OutlookDay {
  date: string;
  sun: SunDay;
  morning: HuntRecommendation | null;
  evening: HuntRecommendation | null;
  compareMorning?: HuntRecommendation | null;
  compareEvening?: HuntRecommendation | null;
  tMax: number | null;
  tMin: number | null;
  precip: number | null;
  windDom: number | null;
  windMax: number | null;
  legal: HuntRecommendation['legal'] | null;
}

export function Outlook({ days, compareId, onPick }: { days: OutlookDay[]; compareId: string | null; onPick: (date: string, rec: HuntRecommendation) => void }) {
  return (
    <section className="card">
      <h2>Seven-day hunting outlook</h2>
      <p className="tiny muted">Best-scoring legal zone per session from Open-Meteo hourly forecasts (America/Chicago). {compareId ? `Row "${compareId}" tracks the selected zone across days.` : 'Select a zone to compare it across days.'}</p>
      <div className="outlook">
        {days.map((d) => {
          const pref = (d.morning?.score ?? -1) >= (d.evening?.score ?? -1) ? 'morning' : 'evening';
          return (
            <div key={d.date} className="oday">
              <div className="oday-h"><b>{fmtDate(d.date, { weekday: 'short' })}</b> <span className="muted">{fmtDate(d.date, { month: 'numeric', day: 'numeric' })}</span></div>
              <div className="small">{d.tMin != null ? `${Math.round(d.tMin)}–${Math.round(d.tMax ?? 0)}°F` : '—'} · {d.precip != null ? `${d.precip.toFixed(2)}"` : '—'} · {compass(d.windDom)} {d.windMax != null ? `≤${Math.round(d.windMax)}` : ''}</div>
              <div className="tiny muted">{rutPhase(d.date).label}</div>
              <div className="osess">
                {(['morning', 'evening'] as const).map((s) => {
                  const r = d[s];
                  return (
                    <button key={s} className={`osbtn ${pref === s && r ? 'best' : ''}`} disabled={!r} onClick={() => r && onPick(d.date, r)}>
                      <span className="tiny">{s === 'morning' ? 'AM' : 'PM'}</span>
                      <ScorePill score={r?.score ?? null} legal={r?.legalStatus} />
                      <span className="tiny muted">{r ? `${r.areaId.replace('BH-', '')} · ${r.confidence}` : 'none'}</span>
                    </button>
                  );
                })}
              </div>
              {compareId && (
                <div className="tiny">Selected zone: AM <b>{d.compareMorning?.score ?? '—'}</b> ({d.compareMorning?.windAssessment.risk ?? '—'} wind risk) · PM <b>{d.compareEvening?.score ?? '—'}</b> ({d.compareEvening?.windAssessment.risk ?? '—'})</div>
              )}
              {d.legal && d.legal.status !== 'verified_allowed' && <div className="tiny warn">{d.legal.summary}</div>}
              {d.legal?.huntName && d.legal.status === 'verified_allowed' && <div className="tiny muted">{d.legal.huntName}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- Jurisdiction inspect ----------------
export function InspectCard({ pt, j, legalSummary, onClose, onAddPin, onSetStart }: { pt: [number, number]; j: Jurisdiction; legalSummary: string; onClose: () => void; onAddPin: (kind: UserPin['kind']) => void; onSetStart: () => void }) {
  const [kind, setKind] = useState<UserPin['kind']>('sighting');
  return (
    <section className="card inspect">
      <div className="card-head"><h2>{j.label}</h2><button className="btn btn-ghost small" onClick={onClose}>✕</button></div>
      <p className="small coords">{pt[1].toFixed(5)}, {pt[0].toFixed(5)}</p>
      <ul className="small">
        <li>Black Warrior WMA (ADCNR 2026-27 boundary): <b>{j.inWma ? 'inside' : 'outside'}</b></li>
        <li>Forest Service surface ownership: <b>{j.fsOwned == null ? 'unknown' : j.fsOwned ? 'USDA Forest Service' : 'Non-FS'}</b></li>
        <li>NF administrative boundary: {j.inNfAdmin ? 'inside' : 'outside'}</li>
        <li>Zone: <b>{j.zone ?? (j.provisionalZone ? `${j.provisionalZone}? (unconfirmed)` : '—')}</b>{j.distToDividerM != null && ` · ${j.distToDividerM} m from AL 33`}</li>
        <li>Sipsey Wilderness: {j.wilderness ? 'yes' : 'no'}</li>
      </ul>
      <p className="small">{legalSummary}</p>
      {j.notes.map((n) => <p key={n} className="tiny muted">{n}</p>)}
      <div className="row wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value as UserPin['kind'])} aria-label="Pin type">
          {['stand', 'sighting', 'rub', 'scrape', 'trail', 'bedding', 'feeding', 'camera', 'parking', 'harvest'].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button className="btn" onClick={() => onAddPin(kind)}>+ Private pin</button>
        <button className="btn" onClick={onSetStart}>Start here</button>
      </div>
    </section>
  );
}

// ---------------- Journal & pins ----------------
export function JournalPanel({ entries, onSave, onDelete, pins, onDeletePin, draft, onFly }: { entries: JournalEntry[]; onSave: (e: JournalEntry) => void; onDelete: (id: string) => void; pins: UserPin[]; onDeletePin: (id: string) => void; draft: Partial<JournalEntry> | null; onFly: (c: [number, number]) => void }) {
  const blank = (): JournalEntry => ({ id: uid(), date: localDate(), start: '', end: '', location: '', coord: null, method: 'bow', weather: '', windObserved: '', deerSeen: 0, behavior: '', harvest: 'none', pressure: 'none', sign: '', notes: '', created: new Date().toISOString(), ...draft });
  const [e, setE] = useState<JournalEntry>(blank);
  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE({ ...e, [k]: v });
  return (
    <>
      <section className="card form">
        <h2>Hunt journal</h2>
        <p className="tiny muted">Private: stored only on this device. Record unsuccessful hunts too — one blank sit doesn't invalidate a zone.</p>
        <div className="grid2">
          <label>Date<input type="date" value={e.date} onChange={(x) => set('date', x.target.value)} /></label>
          <label>Method<select value={e.method} onChange={(x) => set('method', x.target.value)}>{['bow', 'crossbow', 'rifle', 'muzzleloader'].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Start<input type="time" value={e.start} onChange={(x) => set('start', x.target.value)} /></label>
          <label>End<input type="time" value={e.end} onChange={(x) => set('end', x.target.value)} /></label>
        </div>
        <label>Location / zone<input value={e.location} onChange={(x) => set('location', x.target.value)} placeholder="e.g. BH-SA-0012 north bench" /></label>
        <div className="grid2">
          <label>Deer seen<input type="number" min={0} value={e.deerSeen} onChange={(x) => set('deerSeen', Number(x.target.value))} /></label>
          <label>Harvest<select value={e.harvest} onChange={(x) => set('harvest', x.target.value as JournalEntry['harvest'])}><option value="none">None</option><option value="buck">Buck</option><option value="doe">Doe</option></select></label>
          <label>Hunter pressure<select value={e.pressure} onChange={(x) => set('pressure', x.target.value as JournalEntry['pressure'])}>{['none', 'low', 'moderate', 'high'].map((m) => <option key={m}>{m}</option>)}</select></label>
          <label>Wind observed<input value={e.windObserved} onChange={(x) => set('windObserved', x.target.value)} placeholder="NW swirling" /></label>
        </div>
        <label>Weather<input value={e.weather} onChange={(x) => set('weather', x.target.value)} /></label>
        <label>Deer behavior<input value={e.behavior} onChange={(x) => set('behavior', x.target.value)} /></label>
        <label>Sign found<input value={e.sign} onChange={(x) => set('sign', x.target.value)} /></label>
        <label>Notes<textarea rows={3} value={e.notes} onChange={(x) => set('notes', x.target.value)} /></label>
        <div className="row"><button className="btn btn-primary" onClick={() => { onSave(e); setE(blank()); }}>Save entry</button><button className="btn btn-ghost" onClick={() => onSave({ ...e, draft: true })}>Save draft</button></div>
      </section>
      <section className="card">
        <h2>Entries ({entries.length})</h2>
        {entries.length === 0 && <p className="muted small">No entries yet.</p>}
        {entries.map((x) => (
          <div key={x.id} className="entry">
            <div><b>{x.date}</b> {x.start && `${x.start}–${x.end}`} · {x.method} · {x.location || 'no location'} {x.draft && <span className="pill pill-na">draft</span>}</div>
            <div className="small">Deer seen {x.deerSeen} · harvest {x.harvest} · pressure {x.pressure}{x.predictedScore != null && ` · predicted score ${x.predictedScore}`}</div>
            {x.notes && <div className="small muted">{x.notes}</div>}
            <div className="row">{x.draft && <button className="btn btn-ghost small" onClick={() => setE(x)}>Edit</button>}<button className="btn btn-ghost small" onClick={() => onDelete(x.id)}>Delete</button></div>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Private pins ({pins.length})</h2>
        <p className="tiny muted">Tap anywhere on the map to add a pin. Pins never leave this device.</p>
        {pins.map((p) => (
          <div key={p.id} className="entry row">
            <span className="grow"><b>{p.kind.replace('_', ' ')}</b> {p.candidateId ?? ''} <span className="tiny muted">{p.coord[1].toFixed(5)}, {p.coord[0].toFixed(5)}</span></span>
            <button className="btn btn-ghost small" onClick={() => onFly(p.coord)}>Show</button>
            <button className="btn btn-ghost small" onClick={() => onDeletePin(p.id)}>✕</button>
          </div>
        ))}
      </section>
    </>
  );
}

// ---------------- Sources ----------------
export function SourcesPanel({ registry }: { registry: SourceRegistry | null }) {
  return (
    <>
      <section className="card">
        <h2>Governing regulations</h2>
        <ul className="small">{GOVERNING_LINKS.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.title}</a></li>)}</ul>
        <p className="tiny muted">Bankhead Hunt Intelligence is not affiliated with ADCNR or the USDA Forest Service and does not provide check-in or harvest reporting.</p>
      </section>
      <section className="card">
        <h2>Data inventory</h2>
        {registry && <p className="tiny muted">Terrain analysis {registry.terrain.algorithmVersion}, generated {new Date(registry.terrain.generated).toLocaleString()} · grid ≈{registry.terrain.grid.approxCellM.join('×')} m · {String(registry.terrain.counts.candidates)} candidates.</p>}
        {registry?.sources.map((s) => (
          <div key={s.id} className="source">
            <div><b>{s.title}</b> <span className={`q q-${s.quality.split(' ')[0]}`}>{s.quality}</span></div>
            <div className="tiny">{s.agency} · <a href={s.url} target="_blank" rel="noreferrer">source</a>{s.featureCount != null && ` · ${s.featureCount} features`}{s.checksum && ` · sha256 ${s.checksum}`}</div>
            <div className="tiny muted">{s.resolution}{s.retrieved && ` · retrieved ${s.retrieved.slice(0, 10)}`}{s.updated && ` · updated ${String(s.updated).slice(0, 10)}`}{s.usage && ` · ${s.usage}`}</div>
          </div>
        ))}
      </section>
      <section className="card">
        <h2>Rut timing sources</h2>
        <ul className="small">{RUT_SOURCES.map((s) => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> — {s.status}</li>)}</ul>
      </section>
      <section className="card">
        <h2>Known gaps</h2>
        <ul className="small">
          <li>USFS Motor Vehicle Use Map has no Bankhead coverage in the EDW service — vehicle access and gate status are unverified.</li>
          <li>No official Zone A/B polygon exists in the ADCNR GIS service; the split is digitized along AL 33 from the official permit map, with a 400 m uncertainty band.</li>
          <li>Parking/kiosk locations from the permit map are not published as GIS; access points are USFS recreation sites, the check station, and roadside points on FS roads.</li>
          <li>No deer observation, density, or harvest data is used. All habitat indicators are potential only.</li>
          <li>National Forest land outside the WMA is marked "requires verification" (statewide seasons not modeled).</li>
          <li>Scoring weights are uncalibrated hypotheses.</li>
        </ul>
      </section>
    </>
  );
}

export { sunDay, sessionWindows };
