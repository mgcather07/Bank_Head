import type { HuntRecommendation } from '../../engine/types';
import type { SunDay } from '../../engine/time';
import { fmtDate } from '../../engine/time';
import { compass } from '../../engine/wind';
import { rutPhase } from '../../engine/rut';
import { Empty, ScoreBadge } from '../../ui/kit';
import { Calendar, CloudRain, Wind } from '../../ui/icons';

export interface OutlookDay {
  date: string; sun: SunDay; morning: HuntRecommendation | null; evening: HuntRecommendation | null; compareMorning?: HuntRecommendation | null; compareEvening?: HuntRecommendation | null;
  tMax: number | null; tMin: number | null; precip: number | null; windDom: number | null; windMax: number | null; legal: HuntRecommendation['legal'] | null;
}

export function OutlookScreen({ days, compareId, workspaceName, onPick }: { days: OutlookDay[]; compareId: string | null; workspaceName: string; onPick: (date: string, rec: HuntRecommendation) => void }) {
  if (!days.length) return <Empty icon={<Calendar size={26} />} title="Loading the outlook…" />;
  return (
    <div className="stack">
      <div><h1>7-day outlook</h1><p className="t-sm muted" style={{ marginTop: 4 }}>Best legal zone per session in {workspaceName}, from Open-Meteo hourly forecasts. {compareId ? `The selected zone ${compareId} is tracked across days.` : 'Open a zone to track it across days.'}</p></div>
      {days.map((d) => {
        const pref = (d.morning?.score ?? -1) >= (d.evening?.score ?? -1) ? 'morning' : 'evening';
        return (
          <section key={d.date} className="card oday">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2>{fmtDate(d.date, { weekday: 'long' })} <span className="muted t-md" style={{ fontWeight: 500 }}>{fmtDate(d.date, { month: 'short', day: 'numeric' })}</span></h2>
              <span className="t-xs muted">{rutPhase(d.date).label}</span>
            </div>
            <div className="row wrap t-sm dim" style={{ gap: 14, margin: '6px 0 12px' }}>
              <span className="num">{d.tMin != null ? `${Math.round(d.tMin)}–${Math.round(d.tMax ?? 0)}°F` : '—'}</span>
              <span className="row" style={{ gap: 4 }}><CloudRain size={14} aria-hidden="true" />{d.precip != null ? `${d.precip.toFixed(2)}"` : '—'}</span>
              <span className="row" style={{ gap: 4 }}><Wind size={14} aria-hidden="true" />{compass(d.windDom)}{d.windMax != null ? ` up to ${Math.round(d.windMax)}` : ''}</span>
            </div>
            <div className="sessions">
              {(['morning', 'evening'] as const).map((s) => {
                const r = d[s];
                return (
                  <button key={s} type="button" className={`session ${pref === s && r ? 'best' : ''}`} disabled={!r} onClick={() => r && onPick(d.date, r)}>
                    <span className="t-xs muted">{s === 'morning' ? 'Morning' : 'Evening'}</span>
                    <ScoreBadge score={r?.score ?? null} legal={r?.legalStatus} />
                    <span className="t-xs muted">{r ? `${r.candidate.label} · ${r.confidence}` : 'No legal zone'}</span>
                  </button>
                );
              })}
            </div>
            {compareId && <p className="t-xs" style={{ marginTop: 10 }}>Your zone: morning <b>{d.compareMorning?.score ?? '—'}</b> ({d.compareMorning?.windAssessment.risk ?? '—'} wind risk) · evening <b>{d.compareEvening?.score ?? '—'}</b> ({d.compareEvening?.windAssessment.risk ?? '—'})</p>}
            {d.legal && d.legal.status !== 'verified_allowed' && <p className="t-xs" style={{ color: 'var(--warn)', marginTop: 8 }}>{d.legal.summary}</p>}
            {d.legal?.huntName && d.legal.status === 'verified_allowed' && <p className="t-xs muted" style={{ marginTop: 8 }}>{d.legal.huntName}</p>}
          </section>
        );
      })}
    </div>
  );
}
