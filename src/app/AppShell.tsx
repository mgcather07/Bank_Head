// The app frame: bottom navigation and a map-first bottom sheet on phones, a rail + side panel + map on larger screens.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { MapView } from '../map/MapView';
import { useHuntController } from './useHuntController';
import { useHashTab, useMediaQuery, useTheme, type Tab } from './hooks';
import { useInstall } from './useInstall';
import { useAccount } from '../lib/account';
import { useJournal, usePref, useStore, useSyncInfo } from '../lib/data';
import type { JournalEntry } from '../lib/models';
import type { HuntRecommendation } from '../engine/types';
import { fmtDate } from '../engine/time';
import { BottomSheet, ModalSheet, type Snap } from '../ui/Sheet';
import { Avatar, Button } from '../ui/kit';
import { useToast } from '../ui/toast';
import { BookOpen, Calendar, ChevronDown, Lock, MapIcon, TreePine, User, LogIn } from '../ui/icons';
import { ExploreBody, ExploreHeader } from '../features/explore/ExplorePanel';
import { MapChrome } from '../features/explore/MapChrome';
import { AccountSheet, CompassSheet, FilterSheet, LayersSheet, WorkspaceSheet } from '../features/explore/Sheets';
import { OutlookScreen } from '../features/outlook/OutlookScreen';
import { JournalScreen } from '../features/journal/JournalScreen';
import { YouScreen } from '../features/you/YouScreen';
import { Welcome } from '../features/you/Welcome';
import { useLocal } from '../lib/local';

type Modal = null | 'workspace' | 'account' | 'filters' | 'layers' | 'compass';
const NAV: Array<{ tab: Tab; label: string; icon: typeof MapIcon }> = [{ tab: 'explore', label: 'Explore', icon: MapIcon }, { tab: 'outlook', label: '7-Day', icon: Calendar }, { tab: 'journal', label: 'Journal', icon: BookOpen }, { tab: 'you', label: 'You', icon: User }];

export function AppShell() {
  const ctl = useHuntController();
  const account = useAccount();
  const sync = useSyncInfo();
  const store = useStore();
  const toast = useToast();
  const journal = useJournal();
  const [theme, setTheme] = usePref<'auto' | 'light' | 'dark'>('theme', 'auto');
  const dark = useTheme(theme);
  const desktop = useMediaQuery('(min-width: 900px)');
  const install = useInstall();
  const [tab, setTab] = useHashTab();
  const [snap, setSnap] = useState<Snap>('half');
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState<Partial<JournalEntry> | null>(null);
  const [welcomed, setWelcomed] = useLocal<boolean>('bh.welcomed.v1', false);
  const signedIn = account.status === 'signed-in';

  // phone: the map is only visible on Explore; when it comes back, let it re-measure itself
  useEffect(() => { if (tab === 'explore' || desktop) setTimeout(() => ctl.mapRef.current?.resize(), 60); }, [tab, desktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // opening a zone or tapping the map lifts the sheet so the answer is visible
  useEffect(() => { if ((ctl.selected || ctl.inspect) && snap === 'peek') setSnap('half'); }, [ctl.selected?.areaId, ctl.inspect]); // eslint-disable-line react-hooks/exhaustive-deps

  // leave room around the sheet when the map flies somewhere
  const { setInsets } = ctl;
  const onSheetHeight = useCallback((h: number) => setInsets({ top: 110, bottom: h + 18, left: 36, right: 36 }), [setInsets]);
  useEffect(() => { if (desktop) setInsets({ top: 60, bottom: 60, left: 60, right: 60 }); }, [desktop, setInsets]);

  // things that happen on first sign-in
  useEffect(() => store.onEvent((e) => {
    if (e.type === 'claimed') { toast.show(`${e.lands.join(', ')} was added to your account.`, { action: { label: 'Open', run: () => { window.location.hash = '/explore'; } }, ms: 7000 }); }
    if (e.type === 'migrated') toast.show(`Moved ${e.journal} journal ${e.journal === 1 ? 'entry' : 'entries'} and ${e.pins} ${e.pins === 1 ? 'pin' : 'pins'} from this device into your account.`, { ms: 7000 });
  }), [store, toast]);
  // a land that just arrived becomes the active workspace once, so the first thing you see after signing in is yours
  const seenLands = useRef<string[] | null>(null);
  useEffect(() => {
    const ids = ctl.lands.map((l) => l.id);
    if (seenLands.current && ids.some((id) => !seenLands.current!.includes(id))) { const added = ctl.lands.find((l) => !seenLands.current!.includes(l.id)); if (added) setTimeout(() => ctl.switchWorkspace(`land:${added.id}`), 500); }
    if (ids.length || signedIn) seenLands.current = ids;
  }, [ctl.lands, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // first visit: invite a guest to sign in, once
  const showWelcome = account.confirmed && !signedIn && !welcomed && !account.busy;
  useEffect(() => { if (signedIn && !welcomed) setWelcomed(true); }, [signedIn, welcomed, setWelcomed]);

  const wsName = useCallback((id?: string) => ctl.workspaces.find((w) => w.id === id)?.name ?? (id ? 'Removed area' : 'Black Warrior WMA'), [ctl.workspaces]);
  const startJournal = (r: HuntRecommendation) => {
    setDraft({ location: `${r.areaId} ${r.candidate.label}`, coord: r.center, candidateId: r.areaId, date: r.huntDate, method: r.method, predictedScore: r.score, workspace: ctl.workspace.id });
    setTab('journal');
  };
  const typeOptions = useMemo(() => {
    const present = new Set(ctl.data?.candidates.map((c) => c.properties.type));
    const all: Array<[typeof ctl.typeFilter, string]> = [['all', 'All'], ['saddle', 'Saddles'], ['bench', 'Benches'], ['spur', 'Spurs'], ['bottom', 'Bottoms'], ['spot', 'Other']];
    return all.filter(([t]) => t === 'all' || present.has(t as never));
  }, [ctl.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOffline = async () => { const msg = await ctl.saveCurrentArea(); toast.show(msg ?? 'Saved this view for offline use.'); };
  const onPickStart = () => { ctl.setPickingStart(!ctl.pickingStart); setModal(null); if (!desktop) setTab('explore'); };

  const mapNode = (
    <MapView data={ctl.data} workspaceKind={ctl.workspace.kind} dark={dark} base={ctl.base} layers={ctl.layers} marks={ctl.marks} selected={ctl.selected} windHour={ctl.windHour} userLoc={ctl.userLoc} pins={ctl.pins}
      setups={ctl.setups} typeFilter={ctl.typeFilter} startPin={ctl.prefs.start} clubBoundary={ctl.land?.geometry ?? null} clubRoads={ctl.land ? ctl.clubRoads : null} onCandidate={ctl.onCandidate} onInspect={ctl.onInspect} mapRef={ctl.mapRef} />
  );
  const chrome = (variant: 'mobile' | 'desktop') => (
    <MapChrome variant={variant} workspace={ctl.workspace} onWorkspace={() => setModal('workspace')} user={account.user} signedIn={signedIn} onAccount={() => setModal('account')} onLayers={() => setModal('layers')} onLocate={ctl.onGps} onCompass={() => setModal('compass')} hint={ctl.pickingStart ? 'Tap the map to set your starting point' : null} />
  );

  const screens: Record<Exclude<Tab, 'explore'>, ReactNode> = {
    outlook: <OutlookScreen days={ctl.outlook} compareId={ctl.selectedKey?.id ?? null} workspaceName={ctl.workspace.name} onPick={(date, r) => { ctl.setPrefs({ ...ctl.prefs, date }); ctl.openRec(r); setTab('explore'); }} />,
    journal: <JournalScreen entries={journal.entries} onSave={(e) => journal.save({ ...e, workspace: e.workspace ?? ctl.workspace.id })} onDelete={journal.remove} pins={ctl.pins} onDeletePin={ctl.removePin} draft={draft} onDraftUsed={() => setDraft(null)} workspaceName={wsName} sync={sync} signedIn={signedIn} onSignIn={() => setModal('account')}
      onFly={(c) => { setTab('explore'); setTimeout(() => ctl.flyTo(c, 15.5), 120); }} onFetchWeather={ctl.fetchJournalWeather} />,
    you: <YouScreen ctl={ctl} account={account} sync={sync} theme={theme} setTheme={setTheme} journal={journal.entries} canInstall={install.canInstall} onInstall={() => void install.install()} onToast={(t) => toast.show(t)} />,
  };

  const sheets = (
    <>
      <WorkspaceSheet open={modal === 'workspace'} onClose={() => setModal(null)} workspaces={ctl.workspaces} activeId={ctl.workspace.id} onPick={ctl.switchWorkspace} account={account} landsLoading={!sync.loaded} />
      <AccountSheet open={modal === 'account'} onClose={() => setModal(null)} account={account} sync={sync} />
      <FilterSheet open={modal === 'filters'} onClose={() => setModal(null)} prefs={ctl.prefs} setPrefs={ctl.setPrefs} typeFilter={ctl.typeFilter} setTypeFilter={ctl.setTypeFilter} typeOptions={typeOptions} onGps={ctl.onGps} gpsStatus={ctl.gpsStatus} pickingStart={ctl.pickingStart} onPickStart={onPickStart} />
      <LayersSheet open={modal === 'layers'} onClose={() => setModal(null)} base={ctl.base} setBase={ctl.setBase} layers={ctl.layers} setLayers={ctl.setLayers} onCompass={() => setModal('compass')} onSaveOffline={() => void saveOffline()} dlProgress={ctl.dlProgress} online={ctl.online} />
      <CompassSheet open={modal === 'compass'} onClose={() => setModal(null)} windFrom={ctl.windHour?.from ?? ctl.selected?.windAssessment.windFromDegrees ?? ctl.weather?.current?.windFrom ?? null} windMph={ctl.weather?.current?.windMph ?? null} />
      <ModalSheet open={install.help} onClose={install.closeHelp} title="Install on your phone" footer={<Button variant="primary" block onClick={install.closeHelp}>Done</Button>}>
        {install.ios ? <ol className="t-md steps"><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol> : <ol className="t-md steps"><li>Open the browser menu.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol>}
        <p className="t-sm muted" style={{ marginTop: 10 }}>Installed, it opens full-screen like an app and keeps the maps you have viewed for weak signal.</p>
      </ModalSheet>
      <Welcome open={showWelcome} onClose={() => setWelcomed(true)} account={account} />
    </>
  );

  // ---------- desktop ----------
  if (desktop) {
    return (
      <div className="app desktop">
        <nav className="rail" aria-label="Main">
          <div className="rail-logo" aria-hidden="true">◭</div>
          {NAV.map(({ tab: t, label, icon: Icon }) => <button key={t} type="button" className={`rail-btn ${tab === t ? 'on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}><Icon size={22} /><span>{label}</span></button>)}
          <div className="grow" />
          <button type="button" className="rail-btn" onClick={() => setModal('account')} aria-label={signedIn ? 'Account' : 'Sign in'}>{signedIn ? <Avatar user={account.user} size="sm" /> : <LogIn size={22} />}<span>{signedIn ? 'Account' : 'Sign in'}</span></button>
        </nav>
        <aside className="panel">
          <header className="panel-head">
            <button type="button" className="ws-pill flat" onClick={() => setModal('workspace')}>{ctl.workspace.private ? <Lock size={16} /> : <TreePine size={16} />}<span className="ws-name">{ctl.workspace.name}</span><ChevronDown size={16} /></button>
            <span className="t-xs muted">{fmtDate(ctl.prefs.date, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          </header>
          {tab === 'explore' && <div className="panel-sticky"><ExploreHeader ctl={ctl} onFilters={() => setModal('filters')} /></div>}
          <div className="panel-body scroll">{tab === 'explore' ? <ExploreBody ctl={ctl} onJournal={startJournal} onFilters={() => setModal('filters')} /> : <div className="page-inner">{screens[tab]}</div>}</div>
        </aside>
        <main className="map-wrap">{mapNode}{chrome('desktop')}</main>
        {sheets}
      </div>
    );
  }

  // ---------- phone ----------
  return (
    <div className="app mobile">
      <div className="explore" hidden={tab !== 'explore'}>
        {mapNode}
        {chrome('mobile')}
        <BottomSheet snap={snap} onSnap={setSnap} onHeight={onSheetHeight} label="Hunting areas and conditions" header={<ExploreHeader ctl={ctl} onFilters={() => setModal('filters')} />}>
          <ExploreBody ctl={ctl} onJournal={startJournal} onFilters={() => setModal('filters')} />
        </BottomSheet>
      </div>
      {tab !== 'explore' && (
        <div className="page scroll">
          <header className="page-top">
            <button type="button" className="ws-pill flat" onClick={() => setModal('workspace')}>{ctl.workspace.private ? <Lock size={16} /> : <TreePine size={16} />}<span className="ws-name">{ctl.workspace.name}</span><ChevronDown size={16} /></button>
            <button type="button" className="avatar-btn" onClick={() => setModal('account')} aria-label={signedIn ? 'Account' : 'Sign in'}>{signedIn ? <Avatar user={account.user} /> : <span className="signin-chip"><LogIn size={16} />Sign in</span>}</button>
          </header>
          <div className="page-inner">{screens[tab]}</div>
        </div>
      )}
      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(({ tab: t, label, icon: Icon }) => <button key={t} type="button" className={tab === t ? 'on' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}><span className="nav-ico"><Icon size={22} />{t === 'journal' && sync.pending > 0 && <i className="nav-dot" />}</span><span>{label}</span></button>)}
      </nav>
      {sheets}
    </div>
  );
}
