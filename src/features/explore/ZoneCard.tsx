import type { HuntRecommendation } from '../../engine/types';
import { ScoreBadge } from '../../ui/kit';
import { Footprints, Wind } from '../../ui/icons';
import { mi, SESSION_LABEL } from '../format';
import { LegalBadge } from './parts';

export function ZoneCard({ rec, rank, onOpen }: { rec: HuntRecommendation; rank: number; onOpen: () => void }) {
  const p = rec.candidate;
  return (
    <button type="button" className="zone-card" onClick={onOpen}>
      <span className={`rank ${rank <= 3 ? 'top' : ''}`}>{rank}</span>
      <span className="grow">
        <span className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span className="zc-title">{p.label}<span className="muted t-xs"> {rec.areaId}</span></span>
          <ScoreBadge score={rec.score} legal={rec.legalStatus} />
        </span>
        <span className="zc-meta"><span className="nowrap">{SESSION_LABEL[rec.session]} {rec.recommendedWindow?.start}–{rec.recommendedWindow?.end}</span></span>
        <span className="zc-meta">
          <Footprints size={14} aria-hidden="true" />
          {rec.route ? <span>{mi(rec.route.distanceMeters)}{rec.route.walkMinutes ? ` · ${rec.route.walkMinutes} min` : ''}</span> : <span>No access route</span>}
          <Wind size={14} aria-hidden="true" style={{ marginLeft: 6 }} /><span>{rec.windAssessment.risk} risk</span>
        </span>
        {rec.reasons[0] && <span className="zc-reason">{rec.reasons[0]}</span>}
        <span className="row wrap" style={{ gap: 6, marginTop: 6 }}><LegalBadge status={rec.legalStatus} /></span>
      </span>
    </button>
  );
}
