import { useState } from 'react';
import type { HuntController } from '../../app/useHuntController';
import type { Account } from '../../lib/account';
import type { SyncInfo } from '../../lib/sync/store';
import type { JournalEntry, PinDoc } from '../../lib/models';
import { downloadText, gpxToPins, pinsToGpx } from '../../engine/backup';
import { localDate } from '../../engine/time';
import { Avatar, Button, ListRow, Notice, Segmented } from '../../ui/kit';
import { ArrowLeft, Check, ChevronRight, Download, FileText, Info, LogIn, LogOut, Lock, MapPin, Moon, Shield, Smartphone, TreePine, Upload, Users } from '../../ui/icons';
import { SavedAreasList, SyncBadge, syncText, GoogleG } from '../explore/Sheets';
import { SourcesScreen } from './SourcesScreen';
import { ClubScreen, InboxCard } from './ClubScreen';
import { useClubs } from '../../lib/club-data';
import { ROLE_LABEL } from '../../lib/clubs';

export function YouScreen({ ctl, account, sync, theme, setTheme, journal, canInstall, onInstall, onToast }: {
  ctl: HuntController; account: Account; sync: SyncInfo & { loaded: boolean }; theme: 'auto' | 'light' | 'dark'; setTheme: (t: 'auto' | 'light' | 'dark') => void;
  journal: JournalEntry[]; canInstall: boolean; onInstall: () => void; onToast: (t: string) => void;
}) {
  const [page, setPage] = useState<string>('home');
  const u = account.user;
  const clubsApi = useClubs();
  const openWorkspace = (id: string) => { ctl.switchWorkspace(id); window.location.hash = '/explore'; };
  const t = syncText(sync);

  const exportJson = () => downloadText(`standpoint-backup-${localDate()}.json`, JSON.stringify({ app: 'bankhead-hunt-intelligence', version: 2, exported: new Date().toISOString(), journal, pins: ctl.pins, prefs: ctl.prefs }, null, 1));
  const importGpx = async (f: File) => {
    try {
      const incoming = gpxToPins(await f.text());
      for (const p of incoming) ctl.addPin({ ...p, workspace: ctl.workspace.id });
      onToast(`Imported ${incoming.length} pin${incoming.length === 1 ? '' : 's'}.`);
    } catch (e) { onToast(`Import failed: ${e instanceof Error ? e.message : e}`); }
  };

  const club = page.startsWith('club:') ? clubsApi.clubs.find((c) => `club:${c.id}` === page) : null;
  if (club && u) return <ClubScreen club={club} me={u} api={clubsApi} onBack={() => setPage('home')} onOpenMap={() => openWorkspace(`club:${club.id}`)} onToast={onToast} />;

  if (page === 'sources') {
    return <div className="stack"><Button variant="quiet" icon={<ArrowLeft size={18} />} onClick={() => setPage('home')}>You</Button><h1>Sources and methods</h1><SourcesScreen registry={ctl.baseData?.registry ?? null} /></div>;
  }

  return (
    <div className="stack">
      <h1>You</h1>
      <section className="card">
        {u ? (
          <>
            <div className="row" style={{ gap: 14 }}><Avatar user={u} size="lg" /><div className="grow"><h2>{u.name ?? 'Hunter'}</h2><p className="t-sm muted">{u.email}</p></div><SyncBadge sync={sync} /></div>
            <p className="t-sm dim" style={{ marginTop: 12 }}>{t.label}. Your journal, pins, settings and private land follow you to any device you sign in on.</p>
          </>
        ) : (
          <div className="stack">
            <div><h2>Keep your hunts with you</h2><p className="t-sm muted" style={{ marginTop: 4 }}>Sign in to sync your journal and pins across devices and unlock your private land. Everything public works without it.</p></div>
            <Button variant="google" size="lg" block icon={<GoogleG />} onClick={() => void account.signIn()} disabled={account.busy}>{account.busy ? 'Opening Google…' : 'Continue with Google'}</Button>
            {account.error && <Notice tone="bad" title="Sign-in problem" onDismiss={account.clearError}>{account.error}</Notice>}
          </div>
        )}
      </section>

      {u && <InboxCard api={clubsApi} onToast={onToast} onJoined={(id) => setTimeout(() => openWorkspace(`club:${id}`), 400)} />}

      {clubsApi.clubs.length > 0 && (
        <>
          <div className="section-label" style={{ paddingTop: 4 }}>Your clubs</div>
          <div className="list">
            {clubsApi.clubs.map((c) => (
              <ListRow key={c.id} icon={<Users size={18} />} tone="brand" title={c.land.name} sub={`${ROLE_LABEL[c.role]} · ${c.members.length} member${c.members.length === 1 ? '' : 's'}${c.invites.length && c.role !== 'member' ? ` · ${c.invites.length} invited` : ''}`}
                right={<ChevronRight size={20} className="muted" />} onClick={() => setPage(`club:${c.id}`)} />
            ))}
          </div>
        </>
      )}

      <div className="section-label" style={{ paddingTop: 4 }}>Hunting areas</div>
      <div className="list">
        {ctl.workspaces.map((w) => (
          <ListRow key={w.id} icon={w.private ? <Lock size={18} /> : <TreePine size={18} />} tone={w.id === ctl.workspace.id ? 'brand' : undefined} title={w.name} sub={w.blurb}
            right={w.id === ctl.workspace.id ? <Check size={20} color="var(--brand)" aria-label="Current" /> : <span className="t-sm muted">Open</span>} onClick={() => openWorkspace(w.id)} />
        ))}
        {!ctl.lands.length && !clubsApi.clubs.length && <ListRow icon={<Lock size={18} />} title="Your private land" sub={u ? 'No club yet. When someone invites your Google address, it shows up here.' : 'Sign in to see land that belongs to you.'} right={!u ? <Button size="sm" variant="primary" onClick={() => void account.signIn()}>Sign in</Button> : undefined} />}
      </div>

      <div className="section-label">Appearance</div>
      <div className="card"><Segmented label="Theme" block value={theme} onChange={setTheme} options={[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} /></div>

      <div className="section-label">Offline maps</div>
      <SavedAreasList areas={ctl.areas} onShow={(a) => { window.location.hash = '/explore'; setTimeout(() => ctl.mapRef.current?.fitBounds([[a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]], { padding: 20 }), 80); }} onRemove={(a) => void ctl.removeSavedArea(a)} />
      <p className="t-xs muted">{ctl.cachedTiles != null ? `${ctl.cachedTiles} map tiles are cached on this device. ` : ''}Zones, boundaries, roads and the last forecast stay available offline once loaded. iOS may clear website storage after weeks of non-use, so re-save before the season.</p>

      <div className="section-label">Your data</div>
      <div className="list">
        <ListRow icon={<Download size={18} />} title="Export backup" sub={`${journal.length} journal entries, ${ctl.pins.length} pins (.json)`} onClick={exportJson} />
        <ListRow icon={<MapPin size={18} />} title="Export pins as GPX" sub="For your GPS or another app" onClick={() => downloadText(`standpoint-pins-${localDate()}.gpx`, pinsToGpx(ctl.pins as PinDoc[]), 'application/gpx+xml')} disabled={!ctl.pins.length} />
        <label className="list-row file-row"><span className="ico"><Upload size={18} /></span><span className="grow"><div className="title">Import pins from GPX</div><div className="sub">Waypoints from a GPS or hunting app</div></span><input type="file" accept=".gpx,application/gpx+xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.currentTarget.value = ''; }} /></label>
      </div>

      <div className="section-label">App</div>
      <div className="list">
        {canInstall && <ListRow icon={<Smartphone size={18} />} tone="brand" title="Install on this device" sub="Opens full-screen, keeps maps for weak signal" onClick={onInstall} />}
        <ListRow icon={<FileText size={18} />} title="Sources and methods" sub="Data inventory, regulations, known gaps" onClick={() => setPage('sources')} />
        <ListRow icon={<Shield size={18} />} title="Privacy" sub="Your journal and pins are visible only to you. A club is visible only to its members." />
        <ListRow icon={<Info size={18} />} title="Stand Point" sub="© Rehtac Software LLC · decision support only" />
      </div>
      {u && <Button block icon={<LogOut size={18} />} onClick={() => void account.signOut()} disabled={account.busy}>Sign out</Button>}
      {!u && <Button block variant="quiet" icon={<LogIn size={18} />} onClick={() => void account.signIn()}>Sign in</Button>}
      <p className="t-xs muted foot"><Moon size={12} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Theme follows your device by default.</p>
    </div>
  );
}
