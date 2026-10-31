import { useState, type ReactNode } from 'react';
import type { HuntRecommendation, Session } from '../../engine/types';
import type { PeakTimeline } from '../../engine/peak';
import type { HuntPlan } from '../../engine/plan';
import { fmtDate, fmtRange, fmtTime, sunDay } from '../../engine/time';
import { compass } from '../../engine/wind';
import { weaponLabel } from '../../engine/regulations';
import { Button, ScoreBadge } from '../../ui/kit';
import { ArrowLeft, Bookmark, ChevronDown, ChevronUp, Navigation, Share2, Sunrise, Sunset } from '../../ui/icons';
import { mi, SESSION_LABEL } from '../format';
import { ConfidenceBadge, LegalBadge, WindArrow } from './parts';

export function zoneUrl(rec: HuntRecommendation) {
  const u = new URL(window.location.href);
  u.search = ''; u.hash = '';
  if (rec.candidate.type === 'spot') u.searchParams.set('spot', `${rec.center[0].toFixed(5)},${rec.center[1].toFixed(5)}`);
  else u.searchParams.set('zone', rec.areaId);
  u.searchParams.set('date', rec.huntDate);
  u.searchParams.set('session', rec.session);
  return u.toString();
}
async function shareZone(rec: HuntRecommendation) {
  const url = zoneUrl(rec);
  const text = `${rec.candidate.label} ${rec.areaId} · ${rec.landJurisdiction} · ${rec.huntDate} ${SESSION_LABEL[rec.session]} · score ${rec.score ?? '—'}`;
  try { if (navigator.share) await navigator.share({ title: 'Bankhead Hunt Intelligence', text, url }); else { await navigator.clipboard.writeText(url); alert('Link copied.'); } } catch { /* cancelled */ }
}

function Section({ id, title, open, setOpen, children }: { id: string; title: string; open: string | null; setOpen: (v: string | null) => void; children: ReactNode }) {
  const isOpen = open === id;
  return (
    <div className="sec">
      <button type="button" className="sec-h" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}><span>{title}</span>{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
      {isOpen && <div className="sec-b">{children}</div>}
    </div>
  );
}

export function ZoneDetail({ rec, compare, onClose, onSave, saved, onNavigate, onJournal, timeline, plan, onPickSession, lidarStatus, shareable }: {
  rec: HuntRecommendation; compare: Partial<Record<Session, HuntRecommendation>>; onClose: () => void; onSave: () => void; saved: boolean; onNavigate: () => void; onJournal: () => void;
  timeline?: PeakTimeline | null; plan?: HuntPlan | null; onPickSession?: (s: Session) => void; lidarStatus?: string; shareable: boolean;
}) {
  const p = rec.candidate;
  const [open, setOpen] = useState<string | null>('why');
  const w = rec.windAssessment;
  const sd = sunDay(rec.huntDate, p.center[0], p.center[1]);
  const routeOf = (id?: string) => p.routes.find((r) => r.accessPointId === id);
  return (
    <div className="detail stack">
      <div className="row"><Button variant="quiet" size="sm" icon={<ArrowLeft size={18} />} onClick={onClose} style={{ marginLeft: -8 }}>All zones</Button></div>
      <div>
        <h1>{p.label} <span className="muted t-md" style={{ fontWeight: 500 }}>{rec.areaId}</span></h1>
        <p className="t-sm dim" style={{ marginTop: 4 }}>{rec.landJurisdiction} · {fmtDate(rec.huntDate, { weekday: 'short', month: 'short', day: 'numeric' })} · {SESSION_LABEL[rec.session]} {rec.recommendedWindow?.start}–{rec.recommendedWindow?.end} · {weaponLabel(rec.method)}</p>
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}><LegalBadge status={rec.legalStatus} /><ConfidenceBadge c={rec.confidence} /></div>
      </div>
      <div className="row wrap t-sm" style={{ gap: 14 }}>
        <span className="row" style={{ gap: 4 }}><Sunrise size={16} aria-hidden="true" /> <b className="num">{fmtTime(sd.sunrise)}</b></span>
        <span className="row" style={{ gap: 4 }}><Sunset size={16} aria-hidden="true" /> <b className="num">{fmtTime(sd.sunset)}</b></span>
        <span className="muted">Legal {fmtTime(sd.legalStart)}–{fmtTime(sd.legalEnd)}</span>
      </div>
      <p className="mono muted">{p.center[1].toFixed(5)}, {p.center[0].toFixed(5)} · {p.areaHa} ha · {Math.round(p.elevationM * 3.28)} ft</p>
      <div className="row wrap">
        <Button variant="primary" icon={<Navigation size={18} />} onClick={onNavigate}>Navigate</Button>
        <Button icon={<Bookmark size={18} />} onClick={onSave} disabled={saved}>{saved ? 'Saved' : 'Save'}</Button>
        <Button onClick={onJournal}>Log hunt</Button>
        {shareable && <Button variant="quiet" icon={<Share2 size={18} />} onClick={() => shareZone(rec)}>Share</Button>}
      </div>
      <p className="t-xs muted">A scouting zone, not a verified stand location or proof that deer are present.</p>

      {plan && <PlanCard plan={plan} />}
      {timeline && <PeakTimes t={timeline} />}

      {Object.keys(compare).length > 1 && (
        <div className="tiles">
          {(Object.entries(compare) as [Session, HuntRecommendation][]).map(([s, r]) => (
            <button type="button" key={s} className={`tile ${s === rec.session ? 'best' : ''}`} onClick={() => onPickSession?.(s)} aria-pressed={s === rec.session}>
              <div className="t-xs muted">{SESSION_LABEL[s]}</div><ScoreBadge score={r.score} legal={r.legalStatus} small /><div className="t-xs muted">wind {r.windAssessment.risk}</div>
            </button>
          ))}
        </div>
      )}

      <div className="secs">
        <Section id="why" title="Why this score" open={open} setOpen={setOpen}>
          {rec.components.map((c) => (
            <div key={c.key} className="comp">
              <div className="comp-h"><span>{c.label} <span className="muted t-xs">{Math.round(c.weight * 100)}%</span></span><span className="meter"><i style={{ width: `${c.value * 100}%` }} /></span><b className="num">{Math.round(c.value * 100)}</b></div>
              {c.positives.map((t) => <div key={t} className="plus">+ {t}</div>)}
              {c.negatives.map((t) => <div key={t} className="minus">− {t}</div>)}
            </div>
          ))}
          <p className="t-xs muted">Weights are product hypotheses (model {rec.modelVersion}). The score ranks zones against each other. It is not a probability of seeing or harvesting a deer.</p>
        </Section>
        <Section id="wind" title="Wind and scent" open={open} setOpen={setOpen}>
          <div className="row" style={{ alignItems: 'flex-start' }}><WindArrow from={w.windFromDegrees} size={56} /><div className="t-sm">Wind from <b>{compass(w.windFromDegrees)}</b> ({w.windFromDegrees ?? '—'}°) at {w.speedMph ?? '—'} mph. Scent drifts toward <b>{compass(w.scentDownwindDegrees)}</b>. Variability ±{w.variabilityDeg ?? '—'}°. Risk: <b>{w.risk}</b>.</div></div>
          <p className="t-sm">Likely bedding cover: {p.beddingCoverBearing != null ? <b>{compass(p.beddingCoverBearing)}</b> : 'not derived'} · food and water: {p.foodWaterBearing != null ? <b>{compass(p.foodWaterBearing)}</b> : 'not derived'} <span className="muted t-xs">(derived from terrain and vegetation, not observed)</span></p>
          <p className="t-sm">Thermals: {w.thermal.flow} · uncertainty <b>{w.thermal.uncertainty}</b>. The slope faces {p.aspectName}, so cool air drains {compass(p.aspectDeg)} and daytime upslope flow runs {compass((p.aspectDeg + 180) % 360)}.</p>
          {w.notes.map((n) => <div key={n} className="minus">− {n}</div>)}
        </Section>
        <Section id="terrain" title="Terrain and habitat" open={open} setOpen={setOpen}>
          <ul className="t-sm">
            <li>Feature: <b>{p.label}</b>. Nearby: {p.nearbyFeatures.join(', ') || '—'}.</li>
            <li>Slope {p.slopeDeg}° (area mean {p.meanSlopeDeg}°), local relief {p.localReliefM} m, aspect {p.aspectName}.</li>
            <li>{p.distStreamM} m to a derived stream · {p.distRoadM} m to a mapped road · {p.distTrailM} m to a trail.</li>
            <li>Habitat (LANDFIRE 30 m, potential only): {rec.habitatIndicators.join(' · ') || 'no strong indicators'}; edge density {Math.round(p.habitat.edgeDensity * 100)}%.</li>
            {p.disturbance && (p.disturbance.fireRecent + p.disturbance.fireMid + p.disturbance.fireOld + p.disturbance.mechRecent + p.disturbance.mechOld > 0.02
              ? <li>Disturbance: {[p.disturbance.fireRecent > 0.02 && `burn ≤1 yr ${Math.round(p.disturbance.fireRecent * 100)}%`, p.disturbance.fireMid > 0.02 && `burn 2–5 yr ${Math.round(p.disturbance.fireMid * 100)}%`, p.disturbance.fireOld > 0.02 && `burn 6–10 yr ${Math.round(p.disturbance.fireOld * 100)}%`, (p.disturbance.cutNew ?? 0) > 0.02 && `cut ≤1 yr ${Math.round((p.disturbance.cutNew ?? 0) * 100)}%`, (p.disturbance.cutRecent ?? 0) > 0.02 && `cut 2–5 yr ${Math.round((p.disturbance.cutRecent ?? 0) * 100)}%`, (p.disturbance.cutOld ?? 0) > 0.02 && `cut 6–10 yr ${Math.round((p.disturbance.cutOld ?? 0) * 100)}%`].filter(Boolean).join(' · ')}.</li>
              : <li>No mapped burn or timber disturbance in the last 10 years.</li>)}
          </ul>
          <p className="t-xs muted">Derived from public elevation and vegetation data. Current acorn drop, deer trails and beds cannot be seen in these data.</p>
        </Section>
        <Section id="access" title="Access and approach" open={open} setOpen={setOpen}>
          {rec.route ? (
            <ul className="t-sm">
              <li>Start: <b>{rec.route.name}</b> ({rec.route.coord[1].toFixed(5)}, {rec.route.coord[0].toFixed(5)})</li>
              {rec.route.routeKind === 'terrain' || rec.route.routeKind === 'lidar'
                ? <li>Walk: <b>{mi(rec.route.distanceMeters)}</b>, about {rec.route.walkMinutes} min. {mi(rec.route.onNetworkMeters)} on roads or trails, {rec.route.offTrailMeters} m cross-country. Routed over {rec.route.elevationSource ?? 'terrain'}: avoids bluffs over 38°, penalizes steep side-hills, stays off private land and open water.</li>
                : rec.route.routeKind === 'network+offtrail'
                  ? <li>Walk: <b>{mi(rec.route.distanceMeters)}</b>. {mi(rec.route.onNetworkMeters)} along a mapped road or trail, then {rec.route.offTrailMeters} m off-trail. Centerlines are mapped data, not a field-checked path.</li>
                  : <li>Walk: about {mi(rec.route.distanceMeters)} <b>straight-line estimate</b>. No mapped road or trail reaches within 1.5 km, so this is not a traversable route.</li>}
              <li>Climb on the way in about {Math.round((rec.route.elevationGainMeters ?? 0) * 3.28)} ft; steepest ground crossed {rec.route.maxSlopeDeg ?? routeOf(rec.route.verifiedAccessPointId)?.maxSlopeDeg ?? '—'}°.</li>
              <li>{rec.route.verification}</li>
              <li>Approach heading {compass(routeOf(rec.route.verifiedAccessPointId)?.approachBearing ?? null)}.</li>
            </ul>
          ) : <p className="t-sm">No access point within range.</p>}
          {lidarStatus && (() => {
            const base = p.club ? 'estimated route along mapped roads' : '10 m terrain route';
            const msg = lidarStatus === 'done' ? 'Route refined on USGS lidar. It follows old roadbeds and benches where they exist.' : lidarStatus === 'loading' ? 'Refining the route with lidar…' : lidarStatus === 'offline' ? `Offline, showing the ${base}. Lidar refinement needs signal.` : lidarStatus === 'none' ? `Lidar found no better walkable line here; showing the ${base}.` : `Lidar refinement is unavailable right now; showing the ${base}.`;
            return <p className={`t-xs ${lidarStatus === 'done' ? 'ok' : 'muted'}`}>{lidarStatus === 'done' ? '✓ ' : ''}{msg}</p>;
          })()}
          {rec.route && rec.route.profile?.length > 2 && <ElevationProfile profile={rec.route.profile} offTrailM={rec.route.offTrailMeters} gainInM={rec.route.elevationGainMeters ?? 0} />}
          <p className="t-xs muted">A road on the map is not proof of legal vehicle access. Check gates and posted rules.</p>
        </Section>
        <Section id="legal" title="Regulations here" open={open} setOpen={setOpen}>
          <p className="t-sm"><LegalBadge status={rec.legal.status} /> {rec.legal.summary}</p>
          {rec.legal.bag && <p className="t-sm">Bag: {rec.legal.bag}</p>}
          {rec.legal.antlerRestriction && <p className="t-sm"><b>{rec.legal.antlerRestriction}</b></p>}
          {rec.legal.exceptions.map((e) => <p key={e} className="t-sm" style={{ color: 'var(--warn)' }}>{e}</p>)}
          <ul className="t-sm">{rec.legal.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="t-xs">Source: <a href={rec.legal.ruleSource.url} target="_blank" rel="noreferrer">{rec.legal.ruleSource.title}</a> ({rec.legal.ruleSource.version}). This app does not check you in or report harvests.</p>
        </Section>
        {(rec.warnings.length > 0 || rec.improvements.length > 0) && (
          <Section id="improve" title="Risks and how to improve this hunt" open={open} setOpen={setOpen}>
            {rec.warnings.map((t) => <div key={t} className="minus">⚠ {t}</div>)}
            {rec.improvements.map((t) => <div key={t} className="plus">→ {t}</div>)}
          </Section>
        )}
        <Section id="conf" title={`Confidence: ${rec.confidence}`} open={open} setOpen={setOpen}>
          <ul className="t-sm">{rec.confidenceReasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <p className="t-xs muted">Evidence: {rec.evidence.map((e) => `${e.sourceId} (${e.status})`).join(' · ')}</p>
        </Section>
      </div>
    </div>
  );
}

export function PlanCard({ plan }: { plan: HuntPlan }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`plan plan-${plan.verdict.tone}`}>
      <button type="button" className="plan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span><span className="t-xs muted" style={{ letterSpacing: '.06em' }}>HUNT THIS SPOT</span><b className="plan-verdict">{plan.verdict.label}</b></span>{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      <p className="t-sm dim">{plan.verdict.why}</p>
      {open && plan.steps.map((st) => (
        <div key={st.key} className={`plan-step ${st.tone ? `tone-${st.tone}` : ''}`}>
          <div className="plan-title">{st.title}</div>
          <ul>{st.lines.map((l) => <li key={l} className="t-sm">{l}</li>)}</ul>
        </div>
      ))}
    </section>
  );
}

export function PeakTimes({ t }: { t: PeakTimeline }) {
  const [pick, setPick] = useState<number | null>(null);
  if (!t.hours.length) return null;
  const scores = t.hours.map((h) => h.score);
  const lo = Math.min(...scores), hi = Math.max(...scores);
  const inPeak = (time: number) => t.peaks.some((w) => time >= w.start - 1 && time < w.end);
  const sel = pick != null ? t.hours[pick] : null;
  const span = t.hours[t.hours.length - 1].time + 1800000 - t.hours[0].time;
  const pos = (time: number) => `${Math.max(0, Math.min(100, ((time - t.hours[0].time) / span) * 100))}%`;
  return (
    <section className="peak card flat">
      <div className="card-title"><h3>Peak times</h3><span className="t-xs muted">{fmtDate(t.sun.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
      <div className="peak-windows">
        {t.peaks.map((w, i) => (
          <div key={w.start} className={`peak-win ${i === 0 ? 'best' : ''}`}>
            <div className="num"><b>{i === 0 ? '★ ' : ''}{fmtRange(w.start, w.end)}</b></div>
            <div className="t-xs muted">{w.why}</div>
          </div>
        ))}
      </div>
      <div className="peak-chart" role="list" aria-label="Half-hourly opportunity">
        {t.hours.map((h, i) => {
          const rel = hi === lo ? 0.6 : (h.score - lo) / (hi - lo);
          return <button type="button" key={h.time} role="listitem" className={`bar ${inPeak(h.time) ? 'peak' : ''} ${pick === i ? 'sel' : ''}`} style={{ height: `${18 + rel * 82}%` }} onClick={() => setPick(pick === i ? null : i)} aria-label={`${fmtTime(h.time)} rating ${h.score}`} />;
        })}
        <i className="mark" style={{ left: pos(t.sun.sunrise) }} title="Sunrise" />
        <i className="mark" style={{ left: pos(t.sun.sunset) }} title="Sunset" />
      </div>
      <div className="peak-sol" aria-label="Solunar periods">
        {t.solunar.filter((s) => s.end > t.hours[0].time && s.start < t.sun.legalEnd).map((s) => (
          <i key={s.label} className={`sol-${s.kind}`} style={{ left: pos(s.start), width: `calc(${pos(Math.min(s.end, t.sun.legalEnd))} - ${pos(Math.max(s.start, t.hours[0].time))})` }} title={s.label} />
        ))}
      </div>
      <div className="peak-axis t-xs muted"><span>{fmtTime(t.hours[0].time)}</span><span>☀ {fmtTime(t.sun.sunrise)}</span><span>noon</span><span>☀ {fmtTime(t.sun.sunset)}</span><span>{fmtTime(t.sun.legalEnd)}</span></div>
      {sel
        ? <div className="t-sm" style={{ marginTop: 8 }}><b>{fmtTime(sel.time)}</b> · rating {sel.score} · {sel.windFrom != null ? `${compass(sel.windFrom)} ${Math.round(sel.windMph ?? 0)} mph` : 'no wind forecast'}{sel.tempF != null && ` · ${Math.round(sel.tempF)}°F`}{sel.notes.length > 0 && <div className="t-xs muted">{sel.notes.join(' · ')}</div>}</div>
        : <p className="t-xs muted" style={{ marginTop: 8 }}>Tap a bar for that half hour. Gold is the peak window. The lower strip shows solunar periods, weighted lightly.</p>}
      {!t.hasForecast && <p className="t-xs" style={{ color: 'var(--warn)' }}>No wind forecast for this date yet, so peaks reflect movement timing only.</p>}
      <p className="t-xs muted">Blends typical deer movement, this hour's wind for this zone, weather and solunar. A timing guide, not a prediction.</p>
    </section>
  );
}

export function ElevationProfile({ profile, offTrailM, gainInM }: { profile: [number, number][]; offTrailM: number; gainInM: number }) {
  const W = 320, H = 90, padL = 34, padB = 16;
  const ds = profile.map((p) => p[0]), zs = profile.map((p) => p[1] * 3.28084);
  const dMax = Math.max(...ds) || 1, zMin = Math.min(...zs), zMax = Math.max(...zs);
  const span = Math.max(40, zMax - zMin);
  const x = (d: number) => padL + (d / dMax) * (W - padL - 6);
  const y = (z: number) => 4 + (1 - (z - zMin) / span) * (H - padB - 4);
  const pts = profile.map((p, i) => `${x(p[0]).toFixed(1)},${y(zs[i]).toFixed(1)}`).join(' ');
  const offStart = dMax - offTrailM;
  return (
    <div className="profile">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Elevation profile of the walk">
        {offTrailM > 5 && <rect x={x(Math.max(0, offStart))} y={0} width={W - 6 - x(Math.max(0, offStart))} height={H - padB} fill="#e9a82418" />}
        <polyline points={`${padL},${H - padB} ${pts} ${x(dMax)},${H - padB}`} fill="#4aa3e033" stroke="none" />
        <polyline points={pts} fill="none" stroke="#3f9ae0" strokeWidth="2" />
        <text x={2} y={10} fontSize="9" fill="currentColor" opacity=".6">{Math.round(zMax)} ft</text>
        <text x={2} y={H - padB} fontSize="9" fill="currentColor" opacity=".6">{Math.round(zMin)} ft</text>
        <text x={padL} y={H - 3} fontSize="9" fill="currentColor" opacity=".6">0</text>
        <text x={W - 6} y={H - 3} fontSize="9" fill="currentColor" opacity=".6" textAnchor="end">{(dMax / 1609).toFixed(2)} mi</text>
      </svg>
      <div className="t-xs muted">Elevation along the route (USGS 3DEP). Shaded is the off-trail leg. Total climb on the way in about {Math.round(gainInM * 3.28084)} ft.</div>
    </div>
  );
}
