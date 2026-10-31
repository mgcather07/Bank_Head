import type { HuntPreferences } from '../../engine/types';
import { addDays, fmtDate, localDate } from '../../engine/time';
import { IconButton, Segmented } from '../../ui/kit';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from '../../ui/icons';
import { dayLabel } from '../format';

/** Date stepper, AM / PM / Best, and the filters button — the one control strip for the whole map. */
export function DayControl({ prefs, onDay, onSession, onFilters, filterCount }: { prefs: HuntPreferences; onDay: (d: string) => void; onSession: (s: HuntPreferences['session']) => void; onFilters: () => void; filterCount: number }) {
  const today = localDate();
  const session = prefs.session === 'morning' || prefs.session === 'evening' ? prefs.session : 'compare';
  return (
    <div className="day-control">
      <div className="row" style={{ gap: 2 }}>
        <IconButton label="Previous day" size="sm" variant="quiet" disabled={prefs.date <= today} onClick={() => onDay(addDays(prefs.date, -1))}><ChevronLeft size={20} /></IconButton>
        <div className="day-label"><b>{dayLabel(prefs.date)}</b><span className="muted"> {fmtDate(prefs.date, { month: 'numeric', day: 'numeric' })}</span></div>
        <IconButton label="Next day" size="sm" variant="quiet" disabled={prefs.date >= addDays(today, 7)} onClick={() => onDay(addDays(prefs.date, 1))}><ChevronRight size={20} /></IconButton>
      </div>
      <Segmented label="Session" size="sm" value={session} options={[['morning', 'AM'], ['evening', 'PM'], ['compare', 'Best']]} onChange={(v) => onSession(v)} />
      <IconButton label="Filters" size="sm" onClick={onFilters} badge={filterCount || null}><SlidersHorizontal size={18} /></IconButton>
    </div>
  );
}
