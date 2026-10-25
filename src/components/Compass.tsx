// Live compass: phone heading from DeviceOrientation, with wind-from and scent-to arrows drawn in the real world frame.
import { useEffect, useState } from 'react';
import { compass } from '../engine/wind';

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
type Requestable = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function useHeading(active: boolean) {
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  useEffect(() => {
    if (!active) return;
    const h = (e: OrientationEvt) => {
      if (e.webkitCompassHeading != null) setHeading(e.webkitCompassHeading);
      else if (e.absolute && e.alpha != null) setHeading((360 - e.alpha) % 360);
      else if (e.alpha != null) setHeading((360 - e.alpha) % 360);
    };
    const DOE = (window as unknown as { DeviceOrientationEvent?: Requestable }).DeviceOrientationEvent;
    if (!DOE) { setError('Compass not available in this browser.'); return; }
    if (typeof DOE.requestPermission === 'function') { setNeedsPermission(true); }
    const abs = 'ondeviceorientationabsolute' in window;
    window.addEventListener(abs ? 'deviceorientationabsolute' : 'deviceorientation', h as EventListener);
    return () => window.removeEventListener(abs ? 'deviceorientationabsolute' : 'deviceorientation', h as EventListener);
  }, [active]);
  const requestPermission = async () => {
    const DOE = (window as unknown as { DeviceOrientationEvent?: Requestable }).DeviceOrientationEvent;
    try {
      const res = await DOE?.requestPermission?.();
      if (res === 'granted') setNeedsPermission(false);
      else setError('Compass permission denied. Enable Motion & Orientation access in Safari settings.');
    } catch (e) {
      setError(`Compass permission failed: ${e instanceof Error ? e.message : e}`);
    }
  };
  return { heading, error, needsPermission, requestPermission };
}

export function CompassView({ windFrom, windMph, onClose }: { windFrom: number | null; windMph: number | null; onClose: () => void }) {
  const { heading, error, needsPermission, requestPermission } = useHeading(true);
  const rot = heading == null ? 0 : -heading; // rotate the dial so north stays north on the phone
  const scent = windFrom == null ? null : (windFrom + 180) % 360;
  const rel = (deg: number | null) => (deg == null || heading == null ? null : ((deg - heading + 540) % 360) - 180);
  const scentRel = rel(scent);
  const warn = scentRel != null && Math.abs(scentRel) < 35 ? 'Scent is blowing the way you are facing.' : null;
  return (
    <div className="compass">
      <div className="card-head"><h2>Compass</h2><button className="btn btn-ghost small" onClick={onClose}>✕</button></div>
      {needsPermission && heading == null && <button className="btn btn-primary" onClick={requestPermission}>Enable compass</button>}
      {error && <p className="warn small">{error}</p>}
      <svg viewBox="-110 -110 220 220" className="compass-dial" aria-label="Compass">
        <circle r="100" fill="#172019" stroke="#34443a" strokeWidth="2" />
        <g transform={`rotate(${rot})`}>
          {Array.from({ length: 36 }, (_, i) => <line key={i} x1="0" y1="-100" x2="0" y2={i % 9 === 0 ? -86 : -94} stroke={i === 0 ? '#ff5c5c' : '#9fae9f'} strokeWidth={i % 9 === 0 ? 3 : 1} transform={`rotate(${i * 10})`} />)}
          {(['N', 'E', 'S', 'W'] as const).map((l, i) => <text key={l} x="0" y="-70" textAnchor="middle" fontSize="16" fontWeight="700" fill={l === 'N' ? '#ff5c5c' : '#ecefe7'} transform={`rotate(${i * 90})`}>{l}</text>)}
          {windFrom != null && (
            <g transform={`rotate(${windFrom})`}>
              <path d="M0,-84 L-8,-66 L8,-66 Z" fill="#8fb7ff" /><text x="0" y="-56" textAnchor="middle" fontSize="9" fill="#8fb7ff">wind</text>
            </g>
          )}
          {scent != null && (
            <g transform={`rotate(${scent})`}>
              <path d="M0,-4 L-7,-20 L-2,-20 L-2,-62 L2,-62 L2,-20 L7,-20 Z" fill="#ff9f43" /><text x="0" y="-70" textAnchor="middle" fontSize="10" fill="#ff9f43">scent</text>
            </g>
          )}
        </g>
        <path d="M0,-108 L-7,-92 L7,-92 Z" fill="#ecefe7" />
        <text x="0" y="6" textAnchor="middle" fontSize="22" fontWeight="800" fill="#ecefe7">{heading == null ? '—' : `${Math.round(heading)}°`}</text>
        <text x="0" y="24" textAnchor="middle" fontSize="11" fill="#9fae9f">{heading == null ? 'waiting for sensor' : `facing ${compass(heading)}`}</text>
      </svg>
      <p className="small">Wind from <b>{compass(windFrom)}</b>{windMph != null && ` ${Math.round(windMph)} mph`} · scent drifts <b>{compass(scent)}</b>{scentRel != null && ` (${Math.abs(Math.round(scentRel))}° ${scentRel >= 0 ? 'right' : 'left'} of where you face)`}</p>
      {warn && <p className="warn small">⚠ {warn}</p>}
      <p className="tiny muted">Phone heading is magnetic and can be off by several degrees near metal or if uncalibrated. Wind is the latest forecast hour at this location, not a local measurement.</p>
    </div>
  );
}
