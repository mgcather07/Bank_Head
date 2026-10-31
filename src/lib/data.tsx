// React bindings for the DataStore: the signed-in account's journal, pins, land and preferences.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useAccount } from './account';
import { DataStore, type Snapshot, type StoreEvent, type SyncInfo } from './sync/store';
import { openFirebaseCloud } from './sync/cloud';
import { legacyState } from './sync/legacy';
import { landFromWire, landToWire, normalizeJournal, normalizePin, type Json, type JournalEntry, type LandDoc, type PinDoc, type PrefsDoc } from './models';
import type { UserPin } from '../engine/types';

const Ctx = createContext<DataStore | null>(null);

let singleton: DataStore | null = null;
/** One store per page. The account layer uses it to flush and clear this device's copy when someone signs out. */
export function getStore(): DataStore {
  singleton ??= new DataStore({ storage: localStorage, openCloud: openFirebaseCloud, legacy: legacyState });
  return singleton;
}

export function DataProvider({ children, onEvent }: { children: ReactNode; onEvent?: (e: StoreEvent) => void }) {
  const account = useAccount();
  const store = useMemo(() => getStore(), []);
  const uid = account.user?.uid ?? null;
  const user = account.user;
  const latestUser = useRef(user);
  latestUser.current = user;

  useEffect(() => { void store.attach(latestUser.current); }, [store, uid]);
  useEffect(() => { if (onEvent) return store.onEvent(onEvent); }, [store, onEvent]);
  useEffect(() => {
    const on = () => store.retryNow();
    window.addEventListener('online', on);
    document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('online', on); document.removeEventListener('visibilitychange', on); };
  }, [store]);
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): DataStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used inside <DataProvider>');
  return s;
}

export function useSnapshot(): Snapshot {
  const s = useStore();
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}

export function useSyncInfo(): SyncInfo & { loaded: boolean } {
  const snap = useSnapshot();
  return useMemo(() => ({ ...snap.sync, loaded: snap.loaded }), [snap.sync, snap.loaded]);
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function useJournal() {
  const store = useStore();
  const snap = useSnapshot();
  const uid = snap.user?.uid ?? 'local';
  const entries = useMemo<JournalEntry[]>(() => Object.entries(snap.state.journal ?? {}).map(([id, e]) => normalizeJournal(id, e)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start) || b.created.localeCompare(a.created)), [snap.state.journal]);
  const save = useCallback((e: JournalEntry) => {
    const { id, ...rest } = e;
    store.write(`journal/${id}`, { ...rest, owner: uid, updatedAt: Date.now() } as unknown as Json);
  }, [store, uid]);
  const remove = useCallback((id: string) => store.write(`journal/${id}`, null), [store]);
  return { entries, save, remove };
}

export function usePins() {
  const store = useStore();
  const snap = useSnapshot();
  const uid = snap.user?.uid ?? 'local';
  const pins = useMemo<PinDoc[]>(() => Object.entries(snap.state.pins ?? {}).map(([id, p]) => normalizePin(id, p)).sort((a, b) => a.created.localeCompare(b.created)), [snap.state.pins]);
  const add = useCallback((p: Omit<UserPin, 'id' | 'created'> & { workspace?: string }) => {
    const id = rid();
    store.write(`pins/${id}`, { ...p, owner: uid, created: new Date().toISOString(), updatedAt: Date.now() } as unknown as Json);
    return id;
  }, [store, uid]);
  const remove = useCallback((id: string) => store.write(`pins/${id}`, null), [store]);
  return { pins, add, remove };
}

export function useLands(): LandDoc[] {
  const snap = useSnapshot();
  return useMemo(() => Object.entries(snap.state.lands ?? {}).map(([id, w]) => landFromWire(id, w)).filter((l): l is LandDoc => !!l).sort((a, b) => a.created - b.created), [snap.state.lands]);
}

export function useLandActions() {
  const store = useStore();
  return useMemo(() => ({
    save: (l: LandDoc) => store.write(`lands/${l.id}`, { ...landToWire(l), updatedAt: Date.now() } as unknown as Json),
    remove: (id: string) => store.write(`lands/${id}`, null),
  }), [store]);
}

/** One synced preference. JSON-valued ones (hunt settings, layer toggles) are stored as strings. */
export function usePref<T>(key: Exclude<keyof PrefsDoc, 'updatedAt'>, initial: T, opts: { json?: boolean } = {}): [T, (v: T | ((prev: T) => T)) => void] {
  const store = useStore();
  const snap = useSnapshot();
  const raw = snap.state.prefs?.[key] as unknown;
  const value = useMemo<T>(() => {
    if (raw === undefined || raw === null) return initial;
    if (!opts.json) return raw as T;
    try { return { ...(initial as object), ...JSON.parse(raw as string) } as T; } catch { return initial; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  const latest = useRef(value);
  latest.current = value;
  const set = useCallback((v: T | ((prev: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(latest.current) : v;
    latest.current = next;
    store.write(`prefs/${key}`, (opts.json ? JSON.stringify(next) : next) as Json);
    store.write('prefs/updatedAt', Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);
  return [value, set];
}
