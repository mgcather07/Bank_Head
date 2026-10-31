// BottomSheet (map screen, three snap points, drag or tap) and ModalSheet (dialogs).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { IconButton } from './kit';
import { X } from './icons';

export type Snap = 'peek' | 'half' | 'full';
const ORDER: Snap[] = ['peek', 'half', 'full'];

/** Height of the element a node lives in (the sheet is sized against the screen area it sits on). */
function useParentHeight(ref: RefObject<HTMLElement | null>) {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}

export function snapHeights(container: number, peek: number) {
  const top = 64 + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0);
  const full = Math.max(peek + 120, container - top);
  const half = Math.min(full - 60, Math.max(peek + 140, Math.round(container * 0.5)));
  return { peek, half, full } as Record<Snap, number>;
}

export function BottomSheet({ snap, onSnap, peek = 156, header, children, onHeight, label }: {
  snap: Snap;
  onSnap: (s: Snap) => void;
  peek?: number;
  header: ReactNode;
  children: ReactNode;
  /** Reports the settled visible height, so the map can pad itself around the sheet. */
  onHeight?: (px: number) => void;
  label: string;
}) {
  const el = useRef<HTMLElement>(null);
  const container = useParentHeight(el);
  const heights = snapHeights(container, peek);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; h0: number; on: boolean; t0: number; lastY: number; lastT: number; v: number } | null>(null);
  const target = container ? heights[snap] : peek;

  useEffect(() => { if (container) onHeight?.(target); }, [target, container, onHeight]);

  const settle = useCallback((h: number, v: number) => {
    const projected = h - v * 160; // v is px/ms downward positive
    let best: Snap = 'peek', bd = Infinity;
    for (const s of ORDER) { const d = Math.abs(heights[s] - projected); if (d < bd) { bd = d; best = s; } }
    if (el.current) { el.current.style.transition = ''; el.current.style.height = `${heights[best]}px`; }
    onSnap(best);
  }, [heights.peek, heights.half, heights.full, onSnap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = el.current;
    if (!root) return;
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      drag.current = { y0: t.clientY, h0: root.getBoundingClientRect().height, on: false, t0: e.timeStamp, lastY: t.clientY, lastT: e.timeStamp, v: 0 };
    };
    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const t = e.touches[0];
      const dy = t.clientY - d.y0;
      if (!d.on) {
        if (Math.abs(dy) < 8) return;
        const inBody = !!body.current && body.current.contains(e.target as Node);
        const atTop = !body.current || body.current.scrollTop <= 0;
        if (snap === 'full' && inBody && !(dy > 0 && atTop)) { drag.current = null; return; } // let the content scroll
        d.on = true;
        d.y0 = t.clientY; d.h0 = root.getBoundingClientRect().height;
        root.style.transition = 'none';
      }
      e.preventDefault();
      const h = Math.min(heights.full, Math.max(heights.peek - 24, d.h0 - (t.clientY - d.y0)));
      root.style.height = `${h}px`;
      const dt = e.timeStamp - d.lastT;
      if (dt > 0) d.v = (t.clientY - d.lastY) / dt;
      d.lastY = t.clientY; d.lastT = e.timeStamp;
    };
    const end = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.on) settle(root.getBoundingClientRect().height, d.v);
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', end);
    return () => { root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move); root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', end); };
  }, [snap, heights.full, heights.peek, settle]);

  const cycle = () => onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');

  return (
    <section ref={el} className="sheet" data-snap={snap} style={{ height: target }} aria-label={label}>
      <button type="button" className="sheet-grab" onClick={cycle} aria-label={snap === 'full' ? 'Collapse panel' : 'Expand panel'}><i /></button>
      <div className="sheet-head">{header}</div>
      <div ref={body} className="sheet-body" style={{ overflowY: snap === 'full' ? 'auto' : 'hidden' }}>{children}</div>
    </section>
  );
}

export function ModalSheet({ open, title, onClose, children, footer }: { open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.({ preventScroll: true }); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} ref={ref}>
        <div className="modal-grab" />
        <div className="modal-head"><h2>{title}</h2><IconButton label="Close" variant="quiet" onClick={onClose}><X size={20} /></IconButton></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
