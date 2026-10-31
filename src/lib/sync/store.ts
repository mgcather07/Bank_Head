// DataStore — local-first state for one person on one device.
//
//  • Guests: everything lives in this browser (localStorage).
//  • Signed in: the same tree mirrors users/{uid}/… in the Realtime Database. Reads come from the last server
//    snapshot with unconfirmed local writes laid over it; writes apply instantly, persist in an outbox and are sent
//    whenever there is a connection, so the app works the same with no signal and nothing is lost.
//
// The class has no React and no Firebase imports: both the storage and the cloud are injected, which keeps it testable.
import { clean, normalizeJournal, normalizePin, SCHEMA_VERSION, type Json, type JournalEntry, type LandWire, type PinDoc, type PrefsDoc, type Profile, type UserState } from '../models';
import { ack, applyOps, enqueue, loadOps, saveOps, type Op } from './outbox';
import { getIn, setIn, type Tree } from './tree';

export interface CloudUser { uid: string; email: string | null; emailVerified: boolean; name: string | null; photoURL: string | null }

export interface Cloud {
  /** Subscribe to every child of the user's node and to connectivity. Returns an unsubscribe. */
  listen(onChild: (child: string, value: Json | null) => void, onConnected: (connected: boolean) => void, onError: (message: string) => void): () => void;
  set(path: string, value: Json | null): Promise<void>;
  /** Land delivered to this (verified) email address, waiting to be claimed. */
  claim(email: string): Promise<Record<string, Json> | null>;
  dropClaim(email: string): Promise<void>;
  close(): void;
}

export type SyncState = 'guest' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'error';
export interface SyncInfo { state: SyncState; pending: number; lastSynced: number | null; error: string | null }
export interface Snapshot { user: CloudUser | null; state: UserState; sync: SyncInfo; loaded: boolean }
export type StoreEvent = { type: 'migrated'; journal: number; pins: number; lands: number } | { type: 'claimed'; lands: string[] };

export const CHILDREN = ['schema', 'profile', 'prefs', 'journal', 'pins', 'lands'] as const;
const GUEST_KEY = 'bh.guest.v2';
const cacheKey = (uid: string) => `bh.cache.v2.${uid}`;
const outboxKey = (uid: string) => `bh.outbox.v2.${uid}`;
const migratedKey = (uid: string) => `bh.migrated.v2.${uid}`;

export interface StoreDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  openCloud: (user: CloudUser) => Promise<Cloud>;
  now?: () => number;
  /** How long to wait for queued writes to be confirmed before giving up (default 20 s). */
  flushTimeoutMs?: number;
  /** Treat these as already-present local items when the first guest session starts (older app versions). */
  legacy?: () => Partial<UserState>;
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const withTimeout = <T,>(p: Promise<T>, ms: number) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error('Timed out')), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

export class DataStore {
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: StoreEvent) => void>();
  private snapshot: Snapshot;
  private base: Tree = {};
  private ops: Op[] = [];
  private user: CloudUser | null = null;
  private cloud: Cloud | null = null;
  private unlisten: (() => void) | null = null;
  private connected = false;
  private connKnown = false;
  private connTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedChildren = new Set<string>();
  private flushing = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private lastSynced: number | null = null;
  private error: string | null = null;
  private flushWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private session = 0;

  private deps: StoreDeps;

  constructor(deps: StoreDeps) {
    this.deps = deps;
    this.snapshot = this.build();
    this.initGuest();
  }

  private now() { return (this.deps.now ?? Date.now)(); }

  // ---------- subscription (useSyncExternalStore) ----------
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  onEvent(fn: (e: StoreEvent) => void) { this.eventListeners.add(fn); return () => { this.eventListeners.delete(fn); }; }
  private emit(e: StoreEvent) { for (const f of this.eventListeners) f(e); }

  private syncState(): SyncState {
    if (!this.user) return 'guest';
    if (this.error && this.ops.length) return 'error';
    if (!this.connKnown) return 'connecting';
    if (!this.connected) return 'offline';
    if (this.ops.length) return 'syncing';
    return this.loadedChildren.size >= CHILDREN.length ? 'synced' : 'connecting';
  }
  private hasCache() { return Object.keys(this.base).length > 0; }

  private build(): Snapshot {
    const state = applyOps(this.base, this.ops) as unknown as UserState;
    return { user: this.user, state, sync: { state: this.syncState(), pending: this.ops.length, lastSynced: this.lastSynced, error: this.error }, loaded: !this.user || this.loadedChildren.size >= CHILDREN.length || (!this.connected && this.hasCache()) };
  }
  private recompute() {
    this.snapshot = this.build();
    for (const f of this.listeners) f();
  }

  // ---------- guest ----------
  private initGuest() {
    this.user = null;
    let guest: Tree | null = null;
    try { guest = JSON.parse(this.deps.storage.getItem(GUEST_KEY) ?? 'null'); } catch { guest = null; }
    if (!guest) {
      guest = {};
      const legacy = this.deps.legacy?.();
      if (legacy) for (const [k, v] of Object.entries(legacy)) if (v !== undefined) guest[k] = v as unknown as Json;
      this.saveGuest(guest);
    }
    this.base = guest;
    this.ops = [];
    this.snapshot = this.build();
  }
  private saveGuest(t: Tree) { try { this.deps.storage.setItem(GUEST_KEY, JSON.stringify(t)); } catch { /* ignore */ } }

  // ---------- account ----------
  /** Switch to a signed-in account (or back to guest with null). Safe to call repeatedly with the same user. */
  async attach(user: CloudUser | null) {
    if (user?.uid && this.user?.uid === user.uid) { this.user = user; this.recompute(); return; }
    this.detach();
    const session = ++this.session;
    if (!user) { this.initGuest(); this.recompute(); return; }
    this.user = user;
    this.loadedChildren = new Set();
    this.connected = false;
    this.connKnown = false;
    this.error = null;
    // the first connection can take a few seconds; until then say "connecting", after that "offline"
    this.connTimer = setTimeout(() => { if (session === this.session && !this.connKnown) { this.connKnown = true; this.recompute(); } }, 5000);
    try { this.base = JSON.parse(this.deps.storage.getItem(cacheKey(user.uid)) ?? '{}') ?? {}; } catch { this.base = {}; }
    this.ops = loadOps(this.deps.storage, outboxKey(user.uid));
    this.recompute();
    try {
      const cloud = await this.deps.openCloud(user);
      if (session !== this.session) { cloud.close(); return; }
      this.cloud = cloud;
      this.unlisten = cloud.listen(
        (child, value) => {
          if (session !== this.session) return;
          this.base = setIn(this.base, child, value);
          this.loadedChildren.add(child);
          this.persistCache();
          this.recompute();
          this.maybeBootstrap(session);
        },
        (c) => {
          if (session !== this.session) return;
          this.connected = c;
          if (c) { this.connKnown = true; this.error = null; void this.flush(); }
          this.recompute();
        },
        (msg) => { if (session === this.session) { this.error = msg; this.recompute(); } },
      );
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.recompute();
    }
  }

  detach() {
    this.session++;
    this.unlisten?.(); this.unlisten = null;
    this.cloud?.close(); this.cloud = null;
    if (this.retry) clearTimeout(this.retry);
    if (this.connTimer) clearTimeout(this.connTimer);
    this.retry = null;
    this.connTimer = null;
    this.connected = false;
    this.connKnown = false;
    this.bootstrapped = false;
    for (const w of this.flushWaiters.splice(0)) w.reject(new Error('Signed out'));
  }

  private persistCache() { if (this.user) { try { this.deps.storage.setItem(cacheKey(this.user.uid), JSON.stringify(this.base)); } catch { /* ignore */ } } }
  private persistOps() { if (this.user) saveOps(this.deps.storage, outboxKey(this.user.uid), this.ops); }

  // ---------- writes ----------
  /** Write (or delete with null) the value at a path such as `journal/abc123`. Applies instantly and syncs when possible. */
  write(path: string, value: Json | null) {
    const v = value === null ? null : (clean(value) as Json);
    if (!this.user) {
      this.base = setIn(this.base, path, v);
      this.saveGuest(this.base);
      this.recompute();
      return;
    }
    this.ops = enqueue(this.ops, { id: rid(), path, value: v, ts: this.now() });
    this.persistOps();
    this.recompute();
    void this.flush();
  }

  read(path: string) { return getIn(this.snapshot.state as unknown as Tree, path); }

  /** Resolves when every queued write has been confirmed by the database. */
  flushed(timeoutMs = 20000): Promise<void> {
    if (!this.user || this.ops.length === 0) return Promise.resolve();
    return withTimeout(new Promise<void>((resolve, reject) => { this.flushWaiters.push({ resolve, reject }); void this.flush(); }), timeoutMs);
  }

  private async flush() {
    if (this.flushing || !this.cloud || !this.connected || !this.user) return;
    this.flushing = true;
    const session = this.session;
    try {
      while (this.ops.length && this.connected && session === this.session) {
        const op = this.ops[0];
        try {
          await withTimeout(this.cloud.set(op.path, op.value), 15000);
          if (session !== this.session) return;
          this.ops = ack(this.ops, op.id);
          this.persistOps();
          this.lastSynced = this.now();
          this.attempt = 0;
          this.error = null;
          this.recompute();
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e);
          this.recompute();
          this.scheduleRetry();
          return;
        }
      }
      if (this.ops.length === 0) for (const w of this.flushWaiters.splice(0)) w.resolve();
    } finally {
      this.flushing = false;
    }
  }

  private scheduleRetry() {
    if (this.retry) return;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, delay);
  }

  /** Before signing out: try to send what is waiting, then remove this person's cached copy from the device. */
  async signOutCleanup(uid: string) {
    if (this.user?.uid === uid) await this.flushed(4000).catch(() => undefined);
    try { this.deps.storage.removeItem(cacheKey(uid)); this.deps.storage.removeItem(outboxKey(uid)); } catch { /* ignore */ }
  }

  /** Push whatever is waiting right now (e.g. when the browser says it is back online). */
  retryNow() { if (this.retry) { clearTimeout(this.retry); this.retry = null; } void this.flush(); }

  // ---------- first sign-in on this account/device ----------
  private bootstrapped = false;
  private maybeBootstrap(session: number) {
    if (this.bootstrapped || this.loadedChildren.size < CHILDREN.length) return;
    this.bootstrapped = true;
    void this.bootstrap(session).catch((e) => { this.error = e instanceof Error ? e.message : String(e); this.recompute(); });
  }

  private async bootstrap(session: number) {
    const user = this.user;
    if (!user) return;
    const state = () => this.snapshot.state;

    // profile + schema
    const prev = state().profile;
    const profile: Profile = { email: user.email ?? prev?.email ?? '', ...(user.name ?? prev?.name ? { name: (user.name ?? prev?.name)! } : {}), ...(user.photoURL ?? prev?.photoURL ? { photoURL: (user.photoURL ?? prev?.photoURL)! } : {}), created: prev?.created ?? this.now(), lastSeen: this.now() };
    if (profile.email) this.write('profile', profile as unknown as Json);
    if (state().schema !== SCHEMA_VERSION) this.write('schema', SCHEMA_VERSION);

    // land delivered to this verified email address
    if (user.email && user.emailVerified && this.cloud) {
      const waiting = await this.cloud.claim(user.email).catch(() => null);
      if (session !== this.session) return;
      if (waiting && Object.keys(waiting).length) {
        const names: string[] = [];
        for (const [id, wire] of Object.entries(waiting)) {
          const w = wire as unknown as LandWire;
          this.write(`lands/${id}`, { ...w, created: w.created ?? this.now(), updatedAt: this.now() } as unknown as Json);
          names.push(w.name);
        }
        await this.flushed(this.deps.flushTimeoutMs);
        await this.cloud.dropClaim(user.email);
        this.emit({ type: 'claimed', lands: names });
      }
    }

    // bring this device's guest data into the account once
    if (!this.deps.storage.getItem(migratedKey(user.uid))) {
      const m = this.migrateGuest(user);
      this.deps.storage.setItem(migratedKey(user.uid), String(this.now()));
      if (m.journal || m.pins || m.lands) this.emit({ type: 'migrated', ...m });
    }
  }

  private migrateGuest(user: CloudUser) {
    let guest: UserState = {};
    try { guest = JSON.parse(this.deps.storage.getItem(GUEST_KEY) ?? '{}'); } catch { guest = {}; }
    const have = this.snapshot.state;
    let journal = 0, pins = 0, lands = 0;
    for (const [id, e] of Object.entries(guest.journal ?? {})) {
      if (have.journal?.[id]) continue;
      this.write(`journal/${id}`, { ...normalizeJournal(id, e), id: undefined, owner: user.uid, updatedAt: this.now() } as unknown as Json);
      journal++;
    }
    for (const [id, p] of Object.entries(guest.pins ?? {})) {
      if (have.pins?.[id]) continue;
      this.write(`pins/${id}`, { ...normalizePin(id, p), id: undefined, owner: user.uid, updatedAt: this.now() } as unknown as Json);
      pins++;
    }
    const haveNames = new Set(Object.values(have.lands ?? {}).map((x) => x.name.trim().toLowerCase()));
    for (const [id, l] of Object.entries(guest.lands ?? {})) {
      if (have.lands?.[id] || haveNames.has(l.name.trim().toLowerCase())) continue; // e.g. a boundary imported before accounts, now delivered to the account
      this.write(`lands/${id}`, l as unknown as Json);
      lands++;
    }
    if (guest.prefs && !have.prefs) this.write('prefs', { ...(guest.prefs as PrefsDoc), updatedAt: this.now() } as unknown as Json);
    // keep a copy, empty the guest store so nothing is imported twice or shown to the next person on this device
    try { this.deps.storage.setItem(GUEST_KEY + '.backup', JSON.stringify(guest)); this.deps.storage.setItem(GUEST_KEY, JSON.stringify({})); } catch { /* ignore */ }
    return { journal, pins, lands };
  }

  // ---------- typed readers (used by the React hooks) ----------
  static journal(state: UserState): JournalEntry[] {
    return Object.entries(state.journal ?? {}).map(([id, e]) => normalizeJournal(id, e));
  }
  static pins(state: UserState): PinDoc[] {
    return Object.entries(state.pins ?? {}).map(([id, p]) => normalizePin(id, p));
  }
}
