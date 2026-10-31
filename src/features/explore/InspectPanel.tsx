import { useState } from 'react';
import type { UserPin } from '../../engine/types';
import type { Jurisdiction } from '../../engine/geography';
import { Button, Notice, Spinner } from '../../ui/kit';
import { MapPin, Target, X } from '../../ui/icons';

const PIN_KINDS: Array<[UserPin['kind'], string]> = [['stand', 'Stand'], ['sighting', 'Deer sighting'], ['rub', 'Rub'], ['scrape', 'Scrape'], ['trail', 'Deer trail'], ['bedding', 'Bedding'], ['feeding', 'Feeding sign'], ['camera', 'Trail camera'], ['parking', 'Parking'], ['harvest', 'Harvest']];

/** What the map says about a tapped point, with the one-tap rating and the pin tools. */
export function InspectPanel({ pt, j, legalSummary, onClose, onAddPin, onSetStart, onCheck, checking }: {
  pt: [number, number]; j: Jurisdiction; legalSummary: string; onClose: () => void; onAddPin: (kind: UserPin['kind']) => void; onSetStart: () => void; onCheck: () => void; checking: string | null;
}) {
  const [kind, setKind] = useState<UserPin['kind']>('sighting');
  const busy = !!checking && checking !== 'error';
  const priv = j.kind === 'private_club' || j.kind === 'private_or_unknown';
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h2>{j.label}</h2>
          <p className="mono muted" style={{ marginTop: 4 }}>{pt[1].toFixed(5)}, {pt[0].toFixed(5)}</p>
        </div>
        <button type="button" className="icon-btn sm quiet" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      {!priv && (
        <ul className="t-sm facts-list">
          <li>Black Warrior WMA: <b>{j.inWma ? 'inside' : 'outside'}</b></li>
          <li>Forest Service ownership: <b>{j.fsOwned == null ? 'unknown' : j.fsOwned ? 'USDA Forest Service' : 'not Forest Service'}</b></li>
          <li>Zone: <b>{j.zone ?? (j.provisionalZone ? `${j.provisionalZone}? (unconfirmed)` : '—')}</b>{j.distToDividerM != null && ` · ${j.distToDividerM} m from AL 33`}</li>
          <li>Statewide deer zone: <b>{j.deerZone ?? 'uncertain (near the C/D line)'}</b></li>
          {j.wilderness && <li>Sipsey Wilderness: <b>yes</b></li>}
        </ul>
      )}
      <Notice tone={j.kind === 'private_or_unknown' ? 'warn' : 'info'} title={legalSummary}>{j.notes.slice(0, 2).join(' ')}</Notice>
      <Button variant="primary" size="lg" block icon={busy ? <Spinner /> : <Target size={20} />} onClick={onCheck} disabled={busy}>{busy ? checking : 'Check this spot'}</Button>
      {checking === 'error' && <p className="t-sm" style={{ color: 'var(--warn)' }}>Couldn't analyze this spot. The terrain data may not be downloaded yet; try again with signal.</p>}
      <div className="row wrap">
        <select className="select" style={{ flex: '1 1 140px', width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value as UserPin['kind'])} aria-label="Pin type">{PIN_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <Button icon={<MapPin size={18} />} onClick={() => onAddPin(kind)}>Add pin</Button>
        <Button variant="quiet" onClick={onSetStart}>Start here</Button>
      </div>
      {kind === 'parking' && <p className="t-xs muted">Parking pins become starting points for walk-in routes on your private land.</p>}
    </div>
  );
}
