import { useState } from 'react';
import type { HuntRecommendation, Session, WeatherAlert, WeatherBundle } from '../../engine/types';
import { fmtRange, fmtTime, localDate, sessionWindows, type SunDay } from '../../engine/time';
import { compass } from '../../engine/wind';
import { dataAge, hoursBetween, hpaToInHg, weatherText } from '../../engine/weather';
import { rutPhase } from '../../engine/rut';
import { Notice, ScoreBadge } from '../../ui/kit';
import { ChevronDown, ChevronUp, RefreshCw } from '../../ui/icons';
import { SESSION_LABEL } from '../format';
import { WindArrow } from './parts';

export function ConditionsCard({ date, sun, weather, weatherError, alerts, alertsError, ratings, onRefresh, refreshing, selected, windHourIdx, setWindHourIdx }: {
  date: string; sun: SunDay; weather: WeatherBundle | null; weatherError: string | null; alerts: WeatherAlert[]; alertsError: string | null;
  ratings: Record<Session, HuntRecommendation | null>; onRefresh: () => void; refreshing: boolean; selected: HuntRecommendation | null; windHourIdx: number; setWindHourIdx: (n: number) => void;
}) {
  const [more, setMore] = useState(false);
  const age = dataAge(weather);
  const isToday = date === localDate();
  const cur = isToday ? weather?.current ?? null : null;
  const day = weather?.daily.find((d) => d.date === date) ?? null;
  const wins = sessionWindows(sun);
  const best = (['morning', 'evening'] as Session[]).map((s) => ratings[s]).filter(Boolean).sort((a, b) => (b!.score ?? -1) - (a!.score ?? -1))[0];
  const rut = rutPhase(date);
  const nextHours = weather ? weather.hourly.filter((h) => h.time >= Date.now() - 3600000).slice(0, 12) : [];
  const sessionHours = selected ? hoursBetween(weather, wins[selected.session].start, wins[selected.session].end) : [];
  const hi = Math.min(windHourIdx, Math.max(0, sessionHours.length - 1));
  return (
    <section className="card conditions">
      {alerts.length > 0 && <div className="stack" style={{ marginBottom: 12 }}>{alerts.map((a) => <Notice key={a.headline} tone="bad" title={a.event}>{a.headline}</Notice>)}</div>}
      {(weatherError || alertsError) && <p className="t-sm" style={{ color: 'var(--warn)', marginBottom: 8 }}>{weatherError ?? alertsError}</p>}

      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        {cur ? (
          <>
            <WindArrow from={cur.windFrom} size={58} />
            <div className="grow">
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big-temp num">{Math.round(cur.tempF ?? 0)}°</span><span className="muted t-sm">feels {Math.round(cur.feelsF ?? 0)}° · {weatherText(cur.code)}</span></div>
              <div className="t-sm">Wind <b>{compass(cur.windFrom)}</b> {Math.round(cur.windMph ?? 0)} mph, gusts {Math.round(cur.gustMph ?? 0)}</div>
              <div className="t-sm muted">Scent drifts {cur.windFrom != null ? compass((cur.windFrom + 180) % 360) : '—'}</div>
            </div>
          </>
        ) : (
          <div className="grow">
            <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big-temp num">{day?.tMaxF != null ? `${Math.round(day.tMaxF)}°` : '—'}</span><span className="muted t-sm">{day?.tMinF != null ? `low ${Math.round(day.tMinF)}°` : ''}</span></div>
            <div className="t-sm">{day?.windDominant != null ? <>Wind mostly <b>{compass(day.windDominant)}</b>{day.windMaxMph != null ? `, up to ${Math.round(day.windMaxMph)} mph` : ''}</> : 'No forecast for this day yet'}</div>
          </div>
        )}
        <button type="button" className="icon-btn sm quiet" aria-label="Refresh weather" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button>
      </div>

      <div className="tiles" style={{ marginTop: 14 }}>
        {(['morning', 'midday', 'evening'] as Session[]).map((s) => (
          <div key={s} className={`tile ${best?.session === s ? 'best' : ''}`}>
            <div className="t-xs muted">{SESSION_LABEL[s]}</div>
            <ScoreBadge score={ratings[s]?.score ?? null} legal={ratings[s]?.legalStatus} small />
            <div className="t-xs muted nowrap">{fmtRange(wins[s].start, wins[s].end)}</div>
          </div>
        ))}
      </div>
      {!best && <p className="t-sm" style={{ color: 'var(--warn)', marginTop: 10 }}>No legal zones for this date and weapon.</p>}

      <button type="button" className="more-toggle" onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Fewer details' : 'More conditions'}{more ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      {more && (
        <div className="stack" style={{ marginTop: 6 }}>
          <div className="facts">
            <div><span className="muted">Legal light</span><b>{fmtTime(sun.legalStart)} – {fmtTime(sun.legalEnd)}</b></div>
            <div><span className="muted">Sunrise / sunset</span><b>{fmtTime(sun.sunrise)} / {fmtTime(sun.sunset)}</b></div>
            <div><span className="muted">Moon</span><b>{sun.moon.phaseName} {Math.round(sun.moon.illumination * 100)}%</b></div>
            <div><span className="muted">Rut (est.)</span><b>{rut.label}</b></div>
            {cur && <div><span className="muted">Sky</span><b>{cur.cloud}% cloud · RH {cur.humidity}%</b></div>}
            {cur && <div><span className="muted">Pressure</span><b>{hpaToInHg(cur.pressureHpa)?.toFixed(2)} inHg</b></div>}
          </div>
          {isToday && nextHours.length > 0 && (
            <div className="hours hscroll" aria-label="Hourly wind forecast">
              {nextHours.map((h) => (
                <div key={h.time} className="hour">
                  <div className="t-xs muted">{fmtTime(h.time).replace(':00', '')}</div>
                  <WindArrow from={h.windFrom} size={28} />
                  <div className="t-xs num">{Math.round(h.windMph ?? 0)}</div>
                  <div className="t-xs muted num">{Math.round(h.tempF ?? 0)}°</div>
                </div>
              ))}
            </div>
          )}
          <p className={`t-xs ${age.stale ? '' : 'muted'}`} style={age.stale ? { color: 'var(--warn)' } : undefined}>
            {weather ? <>Open-Meteo forecast fetched {fmtTime(weather.fetchedAt)} ({age.minutes} min ago){weather.fromCache ? ' · cached' : ''}{age.stale ? ' · stale, not live' : ''}</> : 'No forecast loaded.'}
          </p>
        </div>
      )}
      {selected && sessionHours.length > 0 && (
        <div className="windshift">
          <div className="t-sm">Wind during the {SESSION_LABEL[selected.session].toLowerCase()} sit · <b>{fmtTime(sessionHours[hi].time)}</b>: {compass(sessionHours[hi].windFrom)} {Math.round(sessionHours[hi].windMph ?? 0)} mph</div>
          <input type="range" min={0} max={sessionHours.length - 1} value={hi} onChange={(e) => setWindHourIdx(Number(e.target.value))} aria-label="Hour of the sit" />
          <p className="t-xs muted">The orange cone on the map is a schematic scent direction, not a dispersion model.</p>
        </div>
      )}
    </section>
  );
}
