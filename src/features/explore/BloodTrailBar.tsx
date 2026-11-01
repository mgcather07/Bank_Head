import { useEffect, useState } from 'react';
import type { BloodTrail } from '../../engine/blood';
import { Button } from '../../ui/kit';
import { Droplet, LocateFixed, Undo2, X } from '../../ui/icons';

const ago = (ms: number) => { const m = Math.round(ms / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; };
const dist = (m: number) => { const yd = m * 1.094; return yd < 1000 ? `${Math.round(yd)} yd` : `${(m / 1609).toFixed(1)} mi`; };

/** Floats on the map while you're tracking: how far the blood goes, and one tap to mark the next drop where you stand. */
export function BloodTrailBar({ trail, status, onMarkGps, onUndo, onDone, onShow }: {
  trail: BloodTrail; status: string; onMarkGps: () => void; onUndo: () => void; onDone: () => void; onShow: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const n = trail.drops.length;
  return (
    <div className="blood-bar" role="region" aria-label="Blood trail">
      <div className="blood-bar-row">
        <button type="button" className="blood-bar-sum" onClick={onShow} aria-label={`Blood trail: ${n} drops. Show on the map`}>
          <Droplet size={18} aria-hidden="true" className="blood-ico" />
          <span className="blood-bar-text"><b>{n}</b>{n > 1 && <> · {dist(trail.lengthM)}</>}<span className="muted t-xs"> · {ago(now - trail.end)}</span></span>
        </button>
        <Button variant="primary" size="sm" className="blood-btn" icon={<LocateFixed size={16} />} onClick={onMarkGps}>Mark</Button>
        <button type="button" className="icon-btn sm quiet" aria-label="Undo last drop" onClick={onUndo}><Undo2 size={16} /></button>
        <button type="button" className="icon-btn sm quiet" aria-label="Done tracking — hide this bar" onClick={onDone}><X size={16} /></button>
      </div>
      {status && <p className="t-xs muted blood-bar-status" role="status">{status}</p>}
    </div>
  );
}
