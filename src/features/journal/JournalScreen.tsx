import { useEffect, useState } from 'react';
import type { JournalEntry, PinDoc } from '../../lib/models';
import { fmtDate, localDate } from '../../engine/time';
import { uid } from '../../lib/id';
import { ModalSheet } from '../../ui/Sheet';
import { Badge } from './Badge';
import { Button, Empty, Field, Notice, Segmented, Spinner } from '../../ui/kit';
import { BookOpen, MapPin, Plus, Trash2 } from '../../ui/icons';
import type { SyncInfo } from '../../lib/sync/store';
import { SyncBadge } from '../explore/Sheets';

const PIN_LABEL: Record<string, string> = { stand: 'Stand', sighting: 'Deer sighting', rub: 'Rub', scrape: 'Scrape', trail: 'Deer trail', bedding: 'Bedding', feeding: 'Feeding sign', camera: 'Trail camera', parking: 'Parking', harvest: 'Harvest', saved_candidate: 'Saved zone' };
const PIN_DOT: Record<string, string> = { stand: '#f5c542', sighting: '#ff8a3d', rub: '#c46b2b', scrape: '#a0522d', trail: '#d9b38c', bedding: '#9b6bd6', feeding: '#6cc070', camera: '#5ab4e6', parking: '#ffffff', harvest: '#ff4d4d', saved_candidate: '#f7f2a1' };
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

function JournalEditor({ entry, isNew, onClose, onSave, onDelete, onFetchWeather }: { entry: JournalEntry | null; isNew: boolean; onClose: () => void; onSave: (e: JournalEntry) => void; onDelete: (id: string) => void; onFetchWeather: (date: string, coord: [number, number] | null) => Promise<string | null> }) {
  const [e, setE] = useState<JournalEntry | null>(entry);
  const [busy, setBusy] = useState(false);
  useEffect(() => setE(entry), [entry]);
  if (!entry || !e) return null;
  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE((cur) => (cur ? { ...cur, [k]: v } : cur));
  return (
    <ModalSheet open onClose={onClose} title={isNew ? 'Log a hunt' : 'Edit entry'}
      footer={<>{!isNew && <Button variant="danger" icon={<Trash2 size={18} />} onClick={() => { if (confirm('Delete this journal entry?')) onDelete(e.id); }}>Delete</Button>}<Button variant="primary" block onClick={() => onSave({ ...e, draft: undefined })}>Save entry</Button></>}>
      <div className="stack" style={{ paddingBottom: 8 }}>
        <div className="grid-2">
          <Field label="Date"><input className="input" type="date" value={e.date} onChange={(x) => set('date', x.target.value)} /></Field>
          <Field label="Method"><select className="select" value={e.method} onChange={(x) => set('method', x.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Start"><input className="input" type="time" value={e.start} onChange={(x) => set('start', x.target.value)} /></Field>
          <Field label="End"><input className="input" type="time" value={e.end} onChange={(x) => set('end', x.target.value)} /></Field>
        </div>
        <Field label="Where"><input className="input" value={e.location} onChange={(x) => set('location', x.target.value)} placeholder="Zone, stand or landmark" /></Field>
        <Field label="Weather" hint="Fill it from the day's recorded weather.">
          <div className="row"><input className="input" value={e.weather} onChange={(x) => set('weather', x.target.value)} placeholder="58°F, light east wind" />
            <Button disabled={busy} onClick={async () => { setBusy(true); try { const w = await onFetchWeather(e.date, e.coord); if (w) set('weather', w); } finally { setBusy(false); } }}>{busy ? <Spinner /> : 'Auto'}</Button></div>
        </Field>
        <Field label="Wind you felt"><input className="input" value={e.windObserved} onChange={(x) => set('windObserved', x.target.value)} placeholder="E, swirling at dusk" /></Field>
        <div className="grid-2">
          <Field label="Deer seen"><div className="stepper"><button type="button" className="icon-btn" aria-label="Fewer" onClick={() => set('deerSeen', Math.max(0, e.deerSeen - 1))}>−</button><b className="num">{e.deerSeen}</b><button type="button" className="icon-btn" aria-label="More" onClick={() => set('deerSeen', e.deerSeen + 1)}>+</button></div></Field>
          <Field label="Pressure"><select className="select" value={e.pressure} onChange={(x) => set('pressure', x.target.value as JournalEntry['pressure'])}><option value="none">None</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></Field>
        </div>
        <Field label="Harvest"><Segmented label="Harvest" block value={e.harvest} onChange={(v) => set('harvest', v)} options={[['none', 'None'], ['buck', 'Buck'], ['doe', 'Doe']]} /></Field>
        <Field label="Behavior"><input className="input" value={e.behavior} onChange={(x) => set('behavior', x.target.value)} placeholder="Feeding, travelling, bedded" /></Field>
        <Field label="Sign"><input className="input" value={e.sign} onChange={(x) => set('sign', x.target.value)} placeholder="Fresh rub, scrape line" /></Field>
        <Field label="Notes"><textarea className="textarea" value={e.notes} onChange={(x) => set('notes', x.target.value)} placeholder="What worked, what didn't" /></Field>
        {e.predictedScore != null && <p className="t-xs muted">The app rated this zone {e.predictedScore} for the day. Logging outcomes over a season is how those weights get calibrated.</p>}
      </div>
    </ModalSheet>
  );
}
