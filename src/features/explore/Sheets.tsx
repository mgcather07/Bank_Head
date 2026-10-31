import type { ReactNode } from 'react';
import type { HuntPreferences } from '../../engine/types';
import type { ZoneTypeFilter, BaseMap, LayerToggles } from '../../map/MapView';
import type { Workspace } from '../../lib/workspaces';
import type { Account } from '../../lib/account';
import type { SyncInfo } from '../../lib/sync/store';
import { addDays, localDate } from '../../engine/time';
import { ModalSheet } from '../../ui/Sheet';
import { Avatar, Button, Chip, Field, Notice, Segmented, Spinner, Switch } from '../../ui/kit';
import { Check, Cloud, CloudOff, Crosshair, Download, LocateFixed, Lock, LogOut, MapPin, Mountain, TreePine, Trash2, User } from '../../ui/icons';
import { LAYER_GROUPS, PRESETS, presetOf, type Preset } from './layers';
import { CompassView } from './Compass';
import { mi } from '../format';
import type { SavedArea } from '../../engine/offline';

// ---------------- filters ----------------
export function filterCount(prefs: HuntPreferences, typeFilter: ZoneTypeFilter) {
  return [prefs.weapon !== 'bow', prefs.target !== 'any', prefs.stand !== 'climber', prefs.effort !== 'balanced', prefs.maxWalkMeters !== 3200, !!prefs.withKid, prefs.youthHunter && !prefs.withKid, typeFilter !== 'all', !!prefs.start].filter(Boolean).length;
}

export function FilterSheet({ open, onClose, prefs, setPrefs, typeFilter, setTypeFilter, typeOptions, onGps, gpsStatus, pickingStart, onPickStart }: {
  open: boolean; onClose: () => void; prefs: HuntPreferences; setPrefs: (p: HuntPreferences) => void; typeFilter: ZoneTypeFilter; setTypeFilter: (t: ZoneTypeFilter) => void; typeOptions: Array<[ZoneTypeFilter, string]>;
  onGps: () => void; gpsStatus: string; pickingStart: boolean; onPickStart: () => void;
}) {
  const set = <K extends keyof HuntPreferences>(k: K, v: HuntPreferences[K]) => setPrefs({ ...prefs, [k]: v });
  const reset = () => { setPrefs({ ...prefs, weapon: 'bow', target: 'any', stand: 'climber', effort: 'balanced', maxWalkMeters: 3200, withKid: false, youthHunter: false, start: null }); setTypeFilter('all'); };
  const n = filterCount(prefs, typeFilter);
  const today = localDate();
  return (
    <ModalSheet open={open} onClose={onClose} title="Hunt settings" footer={<><Button variant="quiet" onClick={reset} disabled={!n}>Reset</Button><Button variant="primary" block onClick={onClose}>Done</Button></>}>
      <div className="stack" style={{ paddingBottom: 8 }}>
        <Field label="Date"><div className="row"><input className="input" type="date" value={prefs.date} min={today} max={addDays(today, 7)} onChange={(e) => e.target.value && set('date', e.target.value)} aria-label="Hunt date" /></div></Field>
        <Field label="Weapon"><Segmented label="Weapon" block value={prefs.weapon} onChange={(v) => set('weapon', v)} options={[['bow', 'Bow'], ['crossbow', 'Crossbow'], ['rifle', 'Rifle'], ['muzzleloader', 'Muzzle']]} /></Field>
        <Field label="Target"><Segmented label="Target" block value={prefs.target} onChange={(v) => set('target', v)} options={[['any', 'Any legal'], ['mature_buck', 'Buck'], ['doe', 'Doe']]} /></Field>
        <Field label="Stand"><Segmented label="Stand" block value={prefs.stand} onChange={(v) => set('stand', v)} options={[['climber', 'Climber'], ['saddle', 'Saddle'], ['hang_on', 'Hang-on'], ['ground', 'Ground']]} /></Field>
        <Field label="Effort"><Segmented label="Effort" block value={prefs.effort} onChange={(v) => set('effort', v)} options={[['easy', 'Easy'], ['balanced', 'Balanced'], ['deep', 'Deep woods']]} /></Field>
        <Field label={`Longest walk: ${mi(prefs.maxWalkMeters)}`}><input type="range" min={400} max={6400} step={200} value={prefs.maxWalkMeters} onChange={(e) => set('maxWalkMeters', Number(e.target.value))} aria-label="Longest walk" /></Field>
        {typeOptions.length > 1 && (
          <Field label="Terrain"><div className="row wrap" style={{ gap: 6 }}>{typeOptions.map(([t, l]) => <Chip key={t} on={typeFilter === t} onClick={() => setTypeFilter(t)}>{l}</Chip>)}</div></Field>
        )}
        <div className="card flat">
          <div className="row" style={{ justifyContent: 'space-between' }}><div><h3>Taking a kid</h3><p className="t-xs muted" style={{ marginTop: 2 }}>Short, flat walks, open ground, close to the truck. Turns on youth rules.</p></div><Switch label="Taking a kid" checked={!!prefs.withKid} onChange={(v) => setPrefs(v ? { ...prefs, withKid: true, youthHunter: true, effort: 'easy', maxWalkMeters: 1000, stand: 'ground' } : { ...prefs, withKid: false })} /></div>
          <hr className="divider" />
          <div className="row" style={{ justifyContent: 'space-between' }}><div><h3>Youth hunter</h3><p className="t-xs muted" style={{ marginTop: 2 }}>Under 16 with a licensed supervisor.</p></div><Switch label="Youth hunter" checked={prefs.youthHunter} onChange={(v) => set('youthHunter', v)} /></div>
        </div>
        <Field label="Starting point" hint={prefs.start ? `${prefs.start[1].toFixed(5)}, ${prefs.start[0].toFixed(5)} ${gpsStatus}` : `Without one, the nearest access point is used. ${gpsStatus}`}>
          <div className="row wrap">
            <Button icon={<LocateFixed size={18} />} onClick={onGps}>Use my GPS</Button>
            <Button icon={<Crosshair size={18} />} onClick={onPickStart} className={pickingStart ? 'on' : ''}>Pick on map</Button>
            {prefs.start && <Button variant="quiet" onClick={() => set('start', null)}>Clear</Button>}
          </div>
        </Field>
      </div>
    </ModalSheet>
  );
}

// ---------------- layers ----------------
const BASE_LABEL: Record<BaseMap, string> = { topo: 'Topo', satellite: 'Satellite', hybrid: 'Hybrid', hillshade: 'Relief' };
export function LayersSheet({ open, onClose, base, setBase, layers, setLayers, onCompass, onSaveOffline, dlProgress, online }: {
  open: boolean; onClose: () => void; base: BaseMap; setBase: (b: BaseMap) => void; layers: LayerToggles; setLayers: (l: LayerToggles) => void; onCompass: () => void; onSaveOffline: () => void; dlProgress: { done: number; total: number } | null; online: boolean;
}) {
  const current = presetOf(layers);
  return (
    <ModalSheet open={open} onClose={onClose} title="Map" footer={<Button variant="primary" block onClick={onClose}>Done</Button>}>
      <div className="stack" style={{ paddingBottom: 8 }}>
        <Field label="Base map"><Segmented label="Base map" block value={base} onChange={setBase} options={(Object.keys(BASE_LABEL) as BaseMap[]).map((b) => [b, BASE_LABEL[b]])} /></Field>
        <Field label="Detail">
          <div className="presets">
            {(Object.keys(PRESETS) as Preset[]).map((k) => (
              <button type="button" key={k} className={`preset ${current === k ? 'on' : ''}`} aria-pressed={current === k} onClick={() => setLayers(PRESETS[k].layers)}>
                <b>{PRESETS[k].label}</b><span>{PRESETS[k].blurb}</span>
              </button>
            ))}
          </div>
          {current === 'custom' && <p className="t-xs muted">Custom selection. Pick a preset to reset it.</p>}
        </Field>
        <div className="list">
          {LAYER_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="list-group">{g.title}</div>
              {g.items.map(([k, label]) => (
                <div key={k} className="list-row" style={{ minHeight: 48 }}><span className="grow">{label}</span><Switch label={label} checked={layers[k]} onChange={(v) => setLayers({ ...layers, [k]: v })} /></div>
              ))}
            </div>
          ))}
        </div>
        <Legend />
        <div className="row wrap">
          <Button icon={<Mountain size={18} />} onClick={() => { onClose(); onCompass(); }}>Compass</Button>
          <Button icon={dlProgress ? <Spinner /> : <Download size={18} />} onClick={() => { onClose(); onSaveOffline(); }} disabled={!!dlProgress || !online}>{dlProgress ? `${Math.round((dlProgress.done / Math.max(1, dlProgress.total)) * 100)}%` : 'Save view offline'}</Button>
        </div>
      </div>
    </ModalSheet>
  );
}

function Legend() {
  const dot = (c: string, round = true) => <i className="lg" style={{ background: c, borderRadius: round ? 8 : 2 }} />;
  return (
    <div className="legend t-xs muted">
      <span>{dot('#43b26a')}High</span><span>{dot('#e7a932')}Medium</span><span>{dot('#c8493f')}Low</span><span>{dot('#8b948d')}Not legal that day</span>
      <span>{dot('#7ad0ff', false)}Walk-in on road or trail</span><span>{dot('#ffd27a', false)}Off-trail leg</span>
    </div>
  );
}

// ---------------- compass ----------------
export function CompassSheet({ open, onClose, windFrom, windMph }: { open: boolean; onClose: () => void; windFrom: number | null; windMph: number | null }) {
  return <ModalSheet open={open} onClose={onClose} title="Compass"><CompassView windFrom={windFrom} windMph={windMph} /></ModalSheet>;
}

// ---------------- workspace switcher ----------------
export function WorkspaceSheet({ open, onClose, workspaces, activeId, onPick, account, landsLoading }: { open: boolean; onClose: () => void; workspaces: Workspace[]; activeId: string; onPick: (id: string) => void; account: Account; landsLoading: boolean }) {
  const publicWs = workspaces.filter((w) => !w.private), privateWs = workspaces.filter((w) => w.private);
  const row = (w: Workspace) => (
    <button type="button" key={w.id} className="list-row" role="radio" aria-checked={w.id === activeId} onClick={() => { onPick(w.id); onClose(); }}>
      <span className={`ico ${w.id === activeId ? 'brand' : ''}`}>{w.private ? <Lock size={18} /> : <TreePine size={18} />}</span>
      <span className="grow"><div className="title">{w.name}</div><div className="sub">{w.blurb}</div></span>
      {w.id === activeId && <Check size={20} color="var(--brand)" aria-label="Current" />}
    </button>
  );
  return (
    <ModalSheet open={open} onClose={onClose} title="Where are you hunting?">
      <div style={{ paddingBottom: 8 }}>
        <div className="section-label" style={{ paddingTop: 4 }}>Public land</div>
        <div className="list" role="radiogroup" aria-label="Public land">{publicWs.map(row)}</div>
        <div className="section-label">Your private land</div>
        {privateWs.length > 0 ? <div className="list" role="radiogroup" aria-label="Private land">{privateWs.map(row)}</div>
          : account.status === 'signed-in'
            ? <Notice tone="info" title={landsLoading ? 'Checking your account…' : 'No private land in your account yet'}>Your hunting club appears here as soon as it is added to your login.</Notice>
            : <div className="card flat stack"><div className="row"><span className="ico-lg"><Lock size={20} /></span><div><h3>Sign in to see your land</h3><p className="t-sm muted">Private land is tied to your login. It never appears on this public site for anyone else.</p></div></div><Button variant="google" block icon={<GoogleG />} onClick={() => void account.signIn()} disabled={account.busy}>Continue with Google</Button>{account.error && <p className="t-sm" style={{ color: 'var(--bad)' }}>{account.error}</p>}</div>}
      </div>
    </ModalSheet>
  );
}

export function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" /><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" /></svg>
  );
}

// ---------------- account ----------------
export function syncText(sync: SyncInfo & { loaded: boolean }): { label: string; tone: 'good' | 'warn' | 'info' | 'bad' } {
  switch (sync.state) {
    case 'guest': return { label: 'Saved on this device only', tone: 'info' };
    case 'connecting': return { label: 'Connecting…', tone: 'info' };
    case 'synced': return { label: 'All changes saved to your account', tone: 'good' };
    case 'syncing': return { label: `Saving ${sync.pending} change${sync.pending === 1 ? '' : 's'}…`, tone: 'info' };
    case 'offline': return { label: sync.pending ? `Offline · ${sync.pending} change${sync.pending === 1 ? '' : 's'} will save when you reconnect` : 'Offline · changes will save when you reconnect', tone: 'warn' };
    default: return { label: 'Could not save to your account. Retrying…', tone: 'bad' };
  }
}

export function SyncBadge({ sync }: { sync: SyncInfo & { loaded: boolean } }) {
  const t = syncText(sync);
  const Icon = sync.state === 'offline' ? CloudOff : sync.state === 'guest' ? User : sync.state === 'syncing' || sync.state === 'connecting' ? Spinner : Cloud;
  return <span className={`badge ${t.tone}`}>{sync.state === 'syncing' || sync.state === 'connecting' ? <Spinner size={12} /> : <Icon size={12} aria-hidden="true" />}{sync.state === 'synced' ? 'Synced' : sync.state === 'guest' ? 'Guest' : sync.state === 'offline' ? 'Offline' : sync.state === 'error' ? 'Retrying' : sync.state === 'syncing' ? 'Saving' : 'Connecting'}</span>;
}

export function AccountSheet({ open, onClose, account, sync, extra }: { open: boolean; onClose: () => void; account: Account; sync: SyncInfo & { loaded: boolean }; extra?: ReactNode }) {
  const u = account.user;
  const t = syncText(sync);
  return (
    <ModalSheet open={open} onClose={onClose} title={u ? 'Account' : 'Sign in'}>
      <div className="stack" style={{ paddingBottom: 8 }}>
        {u ? (
          <>
            <div className="row" style={{ gap: 14 }}><Avatar user={u} size="lg" /><div className="grow"><h2>{u.name ?? 'Hunter'}</h2><p className="t-sm muted">{u.email}</p></div></div>
            <Notice tone={t.tone} title={t.label}>{sync.lastSynced ? `Last saved ${new Date(sync.lastSynced).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ` : ''}Your journal, pins, settings and private land follow you to any device you sign in on.</Notice>
            {extra}
            <Button block icon={<LogOut size={18} />} onClick={() => { onClose(); void account.signOut(); }} disabled={account.busy}>Sign out</Button>
          </>
        ) : (
          <>
            <h2>Keep your hunts with you</h2>
            <ul className="t-sm dim" style={{ lineHeight: 1.6 }}>
              <li>Your journal and pins sync to every device.</li>
              <li>Your private land appears under your own login.</li>
              <li>Works offline. Changes save when you reconnect.</li>
            </ul>
            <Button variant="google" size="lg" block icon={<GoogleG />} onClick={() => void account.signIn()} disabled={account.busy}>{account.busy ? 'Opening Google…' : 'Continue with Google'}</Button>
            {account.error && <Notice tone="bad" title="Sign-in problem" onDismiss={account.clearError}>{account.error}</Notice>}
            <p className="t-xs muted">Everything public works without signing in. What you log as a guest stays on this device and moves to your account when you sign in.</p>
          </>
        )}
      </div>
    </ModalSheet>
  );
}

export function SavedAreasList({ areas, onShow, onRemove }: { areas: SavedArea[]; onShow: (a: SavedArea) => void; onRemove: (a: SavedArea) => void }) {
  if (!areas.length) return <p className="t-sm muted">No offline maps saved yet. Open Map from the explore screen and choose Save view offline.</p>;
  return (
    <div className="list">
      {areas.map((a) => (
        <div key={a.id} className="list-row"><span className="ico"><MapPin size={18} /></span><span className="grow"><div className="title">{a.name}</div><div className="sub">{a.tiles} tiles · about {(a.bytesApprox / 1e6).toFixed(0)} MB · {a.saved.slice(0, 10)}</div></span><Button size="sm" variant="quiet" onClick={() => onShow(a)}>Show</Button><button type="button" className="icon-btn sm quiet" aria-label="Remove" onClick={() => onRemove(a)}><Trash2 size={16} /></button></div>
      ))}
    </div>
  );
}
