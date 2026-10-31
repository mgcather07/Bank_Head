import type { HuntRecommendation } from '../../engine/types';
import { compass } from '../../engine/wind';

export function WindArrow({ from, size = 44 }: { from: number | null; size?: number }) {
  if (from == null) return <span className="muted">—</span>;
  // the arrow points the way the wind blows TOWARD (downwind)
  return (
    <svg width={size} height={size} viewBox="-22 -22 44 44" role="img" aria-label={`Wind from ${compass(from)}`} className="wind-arrow">
      <circle r="20" fill="none" stroke="currentColor" strokeOpacity="0.28" />
      <text y="-12" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.6">N</text>
      <g transform={`rotate(${(from + 180) % 360})`}><path d="M0,-15 L6,2 L1.5,0 L1.5,14 L-1.5,14 L-1.5,0 L-6,2 Z" fill="#f08a24" /></g>
    </svg>
  );
}

export function LegalBadge({ status }: { status: HuntRecommendation['legalStatus'] }) {
  const t = { verified_allowed: ['Legal', 'good'], verified_prohibited: ['Not legal', 'bad'], requires_verification: ['Verify regulations', 'warn'] }[status];
  return <span className={`badge ${t[1]}`}>{t[0]}</span>;
}

export function ConfidenceBadge({ c }: { c: HuntRecommendation['confidence'] }) {
  return <span className={`badge ${c === 'high' ? 'info' : ''}`}>{c === 'insufficient' ? 'Insufficient data' : `${c[0].toUpperCase()}${c.slice(1)} confidence`}</span>;
}
