import { useEffect, useState, type ReactNode } from 'react';
import type { JournalEntry, PinDoc } from '../../lib/models';
import { fmtDate, localDate } from '../../engine/time';
import { uid } from '../../lib/id';
import { ModalSheet } from '../../ui/Sheet';
import { Badge } from './Badge';
import { Button, Empty, Field, Notice, Segmented, Spinner } from '../../ui/kit';
import { BookOpen, Calendar, Cloud, Eye, MapPin, Pencil, Plus, Trash2, Wind } from '../../ui/icons';
import type { SyncInfo } from '../../lib/sync/store';
import { SyncBadge } from '../explore/Sheets';

const PIN_LABEL: Record<string, string> = { stand: 'Stand', sighting: 'Deer sighting', rub: 'Rub', scrape: 'Scrape', trail: 'Deer trail', bedding: 'Bedding', feeding: 'Feeding sign', camera: 'Trail camera', parking: 'Parking', harvest: 'Harvest', blood: 'Blood', saved_candidate: 'Saved zone' };
const PIN_DOT: Record<string, string> = { stand: '#f5c542', sighting: '#ff8a3d', rub: '#c46b2b', scrape: '#a0522d', trail: '#d9b38c', bedding: '#9b6bd6', feeding: '#6cc070', camera: '#5ab4e6', parking: '#ffffff', harvest: '#ff4d4d', blood: '#b3001b', saved_candidate: '#f7f2a1' };
const METHODS: Array<[string, string]> = [['bow', 'Bow'], ['crossbow', 'Crossbow'], ['rifle', 'Rifle'], ['muzzleloader', 'Muzzleloader']];

export function JournalScreen({ entries, onSave, onDelete, pins, onDeletePin, draft, onDraftUsed, onFly, onFetchWeather, workspaceName, sync, signedIn, onSignIn }: {
  entries: JournalEntry[]; onSave: (e: JournalEntry) => void; onDelete: (id: string) => void; pins: PinDoc[]; onDeletePin: (id: string) => void; draft: Partial<JournalEntry> | null; onDraftUsed: () => void;
  onFly: (c: [number, number]) => void; onFetchWeather: (date: string, coord: [number, number] | null) => Promise<string | null>; workspaceName: (id?: string) => string; sync: SyncInfo & { loaded: boolean }; signedIn: boolean; onSignIn: () => void;
}) {
  const [view, setView] = useState<'entries' | 'pins'>('entries');
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const blank = (over: Partial<JournalEntry> = {}): JournalEntry => ({ id: uid(), date: localDate(), start: '', end: '', location: '', coord: null, method: 'bow', weather: '', windObserved: '', deerSeen: 0, behavior: '', harvest: 'none', pressure: 'none', sign: '', notes: '', created: new Date().toISOString(), ...over });
  // arriving from "Log hunt" on a zone opens the form with that zone filled in
  useEffect(() => { if (draft) { setEditing(blank(draft)); onDraftUsed(); setView('entries'); } }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><h1>Journal</h1><p className="t-sm muted" style={{ marginTop: 4 }}>{entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {pins.length} {pins.length === 1 ? 'pin' : 'pins'}</p></div>
        <SyncBadge sync={sync} />
      </div>
      {!signedIn && entries.length + pins.length > 0 && (
        <Notice tone="info" title="Saved on this device only" action={<Button size="sm" variant="primary" onClick={onSignIn}>Sign in to back it up</Button>}>Sign in and your journal and pins sync to your account and every device you use.</Notice>
      )}
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <Segmented label="Journal view" value={view} onChange={setView} options={[['entries', 'Entries'], ['pins', 'Pins']]} />
        <Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing(blank())}>New entry</Button>
      </div>

      {view === 'entries' ? (
        entries.length === 0 ? (
          <Empty icon={<BookOpen size={26} />} title="No hunts logged yet" action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setEditing(blank())}>Log your first hunt</Button>}>Record what you saw and the wind you had. Over a season it shows which spots really work.</Empty>
        ) : (
          <div className="list">
            {entries.map((e) => (
              <button type="button" key={e.id} className="entry" onClick={() => setEditing(e)}>
                <div className="entry-date"><b>{fmtDate(e.date, { day: 'numeric' })}</b><span>{fmtDate(e.date, { month: 'short' })}</span></div>
                <div className="grow">
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><b>{e.location || 'Hunt'}</b>{e.draft && <Badge>Draft</Badge>}</div>
                  <div className="t-xs muted">{fmtDate(e.date, { weekday: 'short' })}{e.start ? ` · ${e.start}${e.end ? `–${e.end}` : ''}` : ''} · {workspaceName(e.workspace)}</div>
                  <div className="row wrap" style={{ gap: 6, margin: '6px 0 2px' }}>
                    <Badge>{METHODS.find((m) => m[0] === e.method)?.[1] ?? e.method}</Badge>
                    <Badge tone={e.deerSeen ? 'info' : undefined}>{e.deerSeen} deer</Badge>
                    {e.harvest !== 'none' && <Badge tone="good">{e.harvest === 'buck' ? 'Buck taken' : 'Doe taken'}</Badge>}
                    {e.weather && <Badge>{e.weather}</Badge>}
                  </div>
                  {e.notes && <div className="t-sm dim clamp2">{e.notes}</div>}
                </div>
              </button>
            ))}
          </div>
        )
      ) : pins.length === 0 ? (
        <Empty icon={<MapPin size={26} />} title="No pins yet">Tap the map, choose a pin type and add it. Stands, sign, cameras and parking all show up here.</Empty>
      ) : (
        <div className="list">
          {pins.map((p) => (
            <div key={p.id} className="list-row">
              <span className="pin-dot" style={{ background: PIN_DOT[p.kind] ?? '#fff' }} />
              <span className="grow"><div className="title">{PIN_LABEL[p.kind] ?? p.kind}{p.note ? ` · ${p.note}` : ''}</div><div className="sub">{p.coord[1].toFixed(5)}, {p.coord[0].toFixed(5)} · {workspaceName(p.workspace)} · {p.created.slice(0, 10)}</div></span>
              <Button size="sm" variant="quiet" onClick={() => onFly(p.coord)}>Show</Button>
              <button type="button" className="icon-btn sm quiet" aria-label="Delete pin" onClick={() => onDeletePin(p.id)}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <JournalEditor entry={editing} isNew={!!editing && !entries.some((x) => x.id === editing.id)} onClose={() => setEditing(null)} onSave={(e) => { onSave(e); setEditing(null); }} onDelete={(id) => { onDelete(id); setEditing(null); }} onFetchWeather={onFetchWeather} />
    </div>
  );
}

const BEHAVIORS = ['Feeding', 'Travelling', 'Chasing', 'Bedded', 'Spooked', 'Calm'];
const SIGNS = ['Fresh rub', 'Scrape', 'Tracks', 'Droppings', 'Trail', 'Acorns'];
const PRESSURE: Array<[JournalEntry['pressure'], string]> = [['none', 'None'], ['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High']];

/** Comma-separated tags, toggled by tapping a chip; anything typed by hand is kept. */
const tagsOf = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
const hasTag = (s: string, t: string) => tagsOf(s).some((x) => x.toLowerCase() === t.toLowerCase());
const toggleTag = (s: string, t: string) => (hasTag(s, t) ? tagsOf(s).filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tagsOf(s), t]).join(', ');
const nowHM = () => new Date().toTimeString().slice(0, 5);

function Chips({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="chip-row" role="group" aria-label={label}>{options.map((o) => <button key={o} type="button" className={`chip ${hasTag(value, o) ? 'on' : ''}`} aria-pressed={hasTag(value, o)} onClick={() => onChange(toggleTag(value, o))}>{o}</button>)}</div>;
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="form-sec"><h3 className="form-sec-title">{icon}{title}</h3>{children}</section>;
}

function JournalEditor({ entry, isNew, onClose, onSave, onDelete, onFetchWeather }: { entry: JournalEntry | null; isNew: boolean; onClose: () => void; onSave: (e: JournalEntry) => void; onDelete: (id: string) => void; onFetchWeather: (date: string, coord: [number, number] | null) => Promise<string | null> }) {
  const [e, setE] = useState<JournalEntry | null>(entry);
  const [busy, setBusy] = useState(false);
  useEffect(() => setE(entry), [entry]);
  if (!entry || !e) return null;
  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE((cur) => (cur ? { ...cur, [k]: v } : cur));
  const bump = (d: number) => setE((cur) => (cur ? { ...cur, deerSeen: Math.max(0, cur.deerSeen + d) } : cur));
  const time = (k: 'start' | 'end', label: string) => (
    <Field label={label}>
      <div className="time-field">
        <input className="input" type="time" value={e[k]} onChange={(x) => set(k, x.target.value)} aria-label={`${label} time`} />
        {!e[k] && <button type="button" className="chip now" onClick={() => set(k, nowHM())}>Now</button>}
      </div>
    </Field>
  );
  return (
    <ModalSheet open onClose={onClose} title={isNew ? 'Log a hunt' : 'Edit entry'}
      footer={<>{!isNew && <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => { if (confirm('Delete this journal entry?')) onDelete(e.id); }} aria-label="Delete entry" />}<Button variant="primary" block onClick={() => onSave({ ...e, draft: undefined })}>Save entry</Button></>}>
      <div className="journal-form">
        <Section icon={<Calendar size={16} />} title="When">
          <Field label="Date"><input className="input" type="date" value={e.date} onChange={(x) => set('date', x.target.value)} /></Field>
          <div className="grid-2">{time('start', 'Start')}{time('end', 'End')}</div>
          <Field label="Method"><div className="chip-row" role="radiogroup" aria-label="Method">{METHODS.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={e.method === v} className={`chip ${e.method === v ? 'on' : ''}`} onClick={() => set('method', v)}>{l}</button>)}</div></Field>
        </Section>

        <Section icon={<MapPin size={16} />} title="Where">
          <input className="input" value={e.location} onChange={(x) => set('location', x.target.value)} placeholder="Zone, stand or landmark" aria-label="Where" enterKeyHint="next" autoCapitalize="words" />
        </Section>

        <Section icon={<Wind size={16} />} title="Conditions">
          <Field label="Weather">
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={e.weather} onChange={(x) => set('weather', x.target.value)} placeholder="58°F, light east wind" enterKeyHint="next" />
              <Button disabled={busy} icon={busy ? undefined : <Cloud size={16} />} onClick={async () => { setBusy(true); try { const w = await onFetchWeather(e.date, e.coord); if (w) set('weather', w); } finally { setBusy(false); } }}>{busy ? <Spinner /> : 'Fill'}</Button>
            </div>
          </Field>
          <Field label="Wind you felt"><input className="input" value={e.windObserved} onChange={(x) => set('windObserved', x.target.value)} placeholder="E, swirling at dusk" enterKeyHint="next" /></Field>
        </Section>

        <Section icon={<Eye size={16} />} title="What happened">
          <div className="deer-count">
            <div><b>Deer seen</b><span className="t-xs muted">Every deer, bucks and does</span></div>
            <div className="stepper big">
              <button type="button" className="icon-btn" aria-label="Fewer deer" onClick={() => bump(-1)}>−</button>
              <b className="num" aria-live="polite">{e.deerSeen}</b>
              <button type="button" className="icon-btn" aria-label="More deer" onClick={() => bump(1)}>+</button>
            </div>
          </div>
          <Field label="Harvest"><Segmented label="Harvest" block value={e.harvest} onChange={(v) => set('harvest', v)} options={[['none', 'None'], ['buck', 'Buck'], ['doe', 'Doe']]} /></Field>
          <Field label="Hunting pressure"><Segmented label="Hunting pressure" block value={e.pressure} onChange={(v) => set('pressure', v)} options={PRESSURE} /></Field>
          <Field label="Behavior">
            <Chips label="Behavior" options={BEHAVIORS} value={e.behavior} onChange={(v) => set('behavior', v)} />
            <input className="input" value={e.behavior} onChange={(x) => set('behavior', x.target.value)} placeholder="Or type your own" aria-label="Behavior" />
          </Field>
          <Field label="Sign">
            <Chips label="Sign" options={SIGNS} value={e.sign} onChange={(v) => set('sign', v)} />
            <input className="input" value={e.sign} onChange={(x) => set('sign', x.target.value)} placeholder="Or type your own" aria-label="Sign" />
          </Field>
        </Section>

        <Section icon={<Pencil size={16} />} title="Notes">
          <textarea className="textarea" value={e.notes} onChange={(x) => set('notes', x.target.value)} placeholder="What worked, what didn't" aria-label="Notes" />
          {e.predictedScore != null && <p className="t-xs muted">The app rated this zone {e.predictedScore} for the day. Logging outcomes over a season is how those weights get calibrated.</p>}
        </Section>
      </div>
    </ModalSheet>
  );
}
