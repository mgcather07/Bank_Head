import { describe, expect, it } from 'vitest';
import { getIn, setIn, type Tree } from './tree';
import { ack, applyOps, enqueue, loadOps, saveOps, type Op } from './outbox';
import { CHILDREN, DataStore, type Cloud, type CloudUser, type StoreEvent } from './store';
import { clean, emailKey, landFromWire, landToWire, normalizeJournal, type Json, type LandDoc } from '../models';

const op = (path: string, value: Json | null, id = path + Math.random()): Op => ({ id, path, value, ts: 1 });

describe('tree', () => {
  it('sets, reads and prunes without mutating', () => {
    const a: Tree = { journal: { j1: { notes: 'a' } } };
    const b = setIn(a, 'journal/j2', { notes: 'b' });
    expect(a).toEqual({ journal: { j1: { notes: 'a' } } });
    expect(getIn(b, 'journal/j2/notes')).toBe('b');
    const c = setIn(setIn(b, 'journal/j1', null), 'journal/j2', null);
    expect(c).toEqual({});
  });
});

describe('outbox', () => {
  it('a later write to a path replaces earlier writes at or below it', () => {
    let ops: Op[] = [];
    ops = enqueue(ops, op('prefs/theme', 'dark', 'a'));
    ops = enqueue(ops, op('journal/j1', { notes: 'x' }, 'b'));
    ops = enqueue(ops, op('prefs', { theme: 'light' }, 'c'));
    expect(ops.map((o) => o.id)).toEqual(['b', 'c']);
    ops = enqueue(ops, op('journal/j1', null, 'd'));
    expect(ops.map((o) => o.id)).toEqual(['c', 'd']);
  });
  it('lays unconfirmed writes over the server state in order, and drops confirmed ones', () => {
    const base: Tree = { journal: { j1: { notes: 'server' } } };
    const ops = [op('journal/j1/notes', 'mine', 'a'), op('journal/j2', { notes: 'new' }, 'b')];
    expect(applyOps(base, ops)).toEqual({ journal: { j1: { notes: 'mine' }, j2: { notes: 'new' } } });
    expect(ack(ops, 'a')).toHaveLength(1);
  });
  it('survives a restart through storage and ignores corrupt data', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    saveOps(st, 'k', [op('a', 1, 'x')]);
    expect(loadOps(st, 'k')).toHaveLength(1);
    mem.set('k', '{not json');
    expect(loadOps(st, 'k')).toEqual([]);
    saveOps(st, 'k', []);
    expect(mem.has('k')).toBe(false);
  });
});

describe('models', () => {
  it('cleans values the database would reject', () => {
    expect(clean({ a: 1, b: undefined, c: null, d: { e: undefined, f: [1, 2] } })).toEqual({ a: 1, d: { f: [1, 2] } });
  });
  it('round-trips a land boundary through its JSON string', () => {
    const land: LandDoc = { id: 'l1', name: 'Club', kind: 'club', pack: 'club', deerZone: 'C', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, acres: 5, created: 1 };
    const wire = landToWire(land);
    expect(typeof wire.geometryJson).toBe('string');
    expect(landFromWire('l1', wire)).toEqual(land);
    expect(landFromWire('l1', { ...wire, geometryJson: '{"type":"Point"}' })).toBeNull();
    expect(landFromWire('l1', { ...wire, geometryJson: 'nope' })).toBeNull();
  });
  it('normalizes entries and email keys', () => {
    expect(normalizeJournal('j', { date: '2026-10-31' }).coord).toBeNull();
    expect(emailKey(' Me.Name@Gmail.com ')).toBe('me,name@gmail,com');
  });
});

// ---------------- store with a fake cloud ----------------
function memoryStorage() {
  const mem = new Map<string, string>();
  return { mem, getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
}

class FakeCloud implements Cloud {
  server: Tree = {};
  online = true;
  provision: Record<string, Json> | null = null;
  provisionDropped = false;
  sets: Array<[string, Json | null]> = [];
  failPaths = new Set<string>();
  private onChild?: (c: string, v: Json | null) => void;
  private onConn?: (c: boolean) => void;
  listen(onChild: (c: string, v: Json | null) => void, onConnected: (c: boolean) => void) {
    this.onChild = onChild; this.onConn = onConnected;
    queueMicrotask(() => { for (const c of CHILDREN) onChild(c, (this.server[c] as Json) ?? null); onConnected(this.online); });
    return () => {};
  }
  async set(path: string, value: Json | null) {
    if (!this.online) throw new Error('offline');
    if ([...this.failPaths].some((p) => path.startsWith(p))) throw new Error('denied');
    this.sets.push([path, value]);
    this.server = setIn(this.server, path, value);
    const top = path.split('/')[0];
    this.onChild?.(top, (this.server[top] as Json) ?? null);
  }
  async claim() { return this.provision; }
  async dropClaim() { this.provisionDropped = true; this.provision = null; }
  close() {}
  setOnline(b: boolean) { this.online = b; this.onConn?.(b); }
  serverChange(path: string, value: Json | null) { this.server = setIn(this.server, path, value); const top = path.split('/')[0]; this.onChild?.(top, (this.server[top] as Json) ?? null); }
}

const user = (uid = 'u1', over: Partial<CloudUser> = {}): CloudUser => ({ uid, email: `${uid}@example.com`, emailVerified: true, name: 'Test Hunter', photoURL: null, ...over });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 10)); };
const entry = { date: '2026-10-31', start: '06:30', end: '09:00', location: 'Zone', method: 'bow', weather: '', windObserved: '', deerSeen: 1, behavior: '', harvest: 'none', pressure: 'low', sign: '', notes: 'hello', created: '2026-10-31T11:00:00Z' } as unknown as Json;

function make(over: Partial<{ storage: ReturnType<typeof memoryStorage>; cloud: FakeCloud; flushTimeoutMs: number }> = {}) {
  const storage = over.storage ?? memoryStorage();
  const cloud = over.cloud ?? new FakeCloud();
  const store = new DataStore({ storage, openCloud: async () => cloud, flushTimeoutMs: over.flushTimeoutMs ?? 200 });
  const events: StoreEvent[] = [];
  store.onEvent((e) => events.push(e));
  return { storage, cloud, store, events };
}

describe('DataStore as a guest', () => {
  it('keeps data on the device and reloads it', () => {
    const { store, storage } = make();
    store.write('journal/a', entry);
    expect(store.getSnapshot().sync.state).toBe('guest');
    const again = make({ storage }).store;
    expect(again.getSnapshot().state.journal?.a).toBeTruthy();
  });
  it('imports data from older app versions once', () => {
    const storage = memoryStorage();
    const s = new DataStore({ storage, openCloud: async () => new FakeCloud(), legacy: () => ({ pins: { p1: { id: 'p1', kind: 'stand', coord: [1, 2], note: '', created: 'x' } } }) });
    expect(s.getSnapshot().state.pins?.p1).toBeTruthy();
    const s2 = new DataStore({ storage, openCloud: async () => new FakeCloud(), legacy: () => ({ pins: { p2: { id: 'p2', kind: 'stand', coord: [1, 2], note: '', created: 'x' } } }) });
    expect(s2.getSnapshot().state.pins?.p2).toBeUndefined();
  });
});

describe('DataStore signed in', () => {
  it('shows a write at once, then confirms it with the database', async () => {
    const { store, cloud } = make();
    await store.attach(user());
    await settle();
    expect(store.getSnapshot().sync.state).toBe('synced');
    store.write('journal/j1', { ...(entry as object), owner: 'u1' } as Json);
    expect(store.getSnapshot().state.journal?.j1).toBeTruthy();
    expect(store.getSnapshot().sync.pending).toBe(1);
    await settle();
    expect(getIn(cloud.server, 'journal/j1/notes')).toBe('hello');
    expect(store.getSnapshot().sync.pending).toBe(0);
    expect(store.getSnapshot().sync.state).toBe('synced');
  });
  it('queues writes while offline and sends them in order on reconnect', async () => {
    const { store, cloud } = make();
    await store.attach(user());
    await settle();
    cloud.setOnline(false);
    store.write('pins/p1', { owner: 'u1', kind: 'stand', coord: [1, 2], created: 'x', note: 'a' });
    store.write('pins/p1', { owner: 'u1', kind: 'stand', coord: [1, 2], created: 'x', note: 'b' });
    await settle();
    expect(store.getSnapshot().sync).toMatchObject({ state: 'offline', pending: 1 });
    expect(store.getSnapshot().state.pins?.p1?.note).toBe('b');
    cloud.setOnline(true);
    await settle();
    expect(getIn(cloud.server, 'pins/p1/note')).toBe('b');
    expect(store.getSnapshot().sync.pending).toBe(0);
  });
  it('does not lose an offline write when the app is closed and reopened', async () => {
    const storage = memoryStorage();
    const cloud = new FakeCloud();
    const first = make({ storage, cloud });
    await first.store.attach(user());
    await settle();
    cloud.setOnline(false);
    first.store.write('journal/j9', { ...(entry as object), owner: 'u1' } as Json);
    await settle();
    first.store.detach();
    // reopen later, on a connection
    cloud.online = true;
    const second = make({ storage, cloud });
    await second.store.attach(user());
    expect(second.store.getSnapshot().state.journal?.j9).toBeTruthy(); // visible immediately, from the outbox
    await settle();
    expect(getIn(cloud.server, 'journal/j9/notes')).toBe('hello');
  });
  it('keeps an unconfirmed local edit on top of a newer server snapshot', async () => {
    const { store, cloud } = make();
    await store.attach(user());
    await settle();
    cloud.setOnline(false);
    store.write('journal/j1', { ...(entry as object), owner: 'u1', notes: 'mine' } as Json);
    cloud.serverChange('journal/j1', { ...(entry as object), owner: 'u1', notes: 'other device' } as Json);
    await settle();
    expect(store.getSnapshot().state.journal?.j1.notes).toBe('mine');
    cloud.setOnline(true);
    await settle();
    expect(getIn(cloud.server, 'journal/j1/notes')).toBe('mine');
  });
  it('reports an error and keeps the write when the database refuses it', async () => {
    const { store, cloud } = make();
    await store.attach(user());
    await settle();
    cloud.failPaths.add('pins');
    store.write('pins/p1', { owner: 'u1', kind: 'stand', coord: [1, 2], created: 'x' });
    await settle();
    expect(store.getSnapshot().sync.state).toBe('error');
    expect(store.getSnapshot().sync.pending).toBe(1);
    expect(store.getSnapshot().state.pins?.p1).toBeTruthy();
    store.detach();
  });
  it('keeps people on the same device apart', async () => {
    const { store, cloud } = make();
    await store.attach(user('a'));
    await settle();
    store.write('journal/ja', { ...(entry as object), owner: 'a' } as Json);
    await settle();
    cloud.server = {};
    await store.attach(user('b'));
    await settle();
    expect(store.getSnapshot().state.journal).toBeUndefined();
    await store.attach(null);
    expect(store.getSnapshot().sync.state).toBe('guest');
    expect(store.getSnapshot().state.journal).toBeUndefined();
  });
});

describe('first sign-in', () => {
  it('writes the profile and brings this device\'s guest journal and pins into the account once', async () => {
    const storage = memoryStorage();
    const g = make({ storage });
    g.store.write('journal/j1', { ...(entry as object), id: 'j1', owner: 'guest' } as Json);
    g.store.write('pins/p1', { id: 'p1', kind: 'stand', coord: [-86.7, 33.7], note: 'oak', created: 'x' } as Json);
    const cloud = new FakeCloud();
    const { store, events } = make({ storage, cloud });
    await store.attach(user('u1'));
    await settle();
    expect(getIn(cloud.server, 'profile/email')).toBe('u1@example.com');
    expect(getIn(cloud.server, 'journal/j1/owner')).toBe('u1');
    expect(getIn(cloud.server, 'journal/j1/id')).toBeUndefined();
    expect(getIn(cloud.server, 'pins/p1/owner')).toBe('u1');
    expect(events).toContainEqual({ type: 'migrated', journal: 1, pins: 1, lands: 0 });
    // a second device/session never duplicates or resurrects them
    cloud.server = setIn(cloud.server, 'journal/j1', null);
    const again = make({ storage, cloud });
    await again.store.attach(user('u1'));
    await settle();
    expect(getIn(cloud.server, 'journal/j1')).toBeUndefined();
  });
  it('claims land delivered to the verified email, then clears the delivery', async () => {
    const cloud = new FakeCloud();
    cloud.provision = { club1: { name: 'My Club', kind: 'club', pack: 'club', deerZone: 'C', geometryJson: '{"type":"Polygon","coordinates":[]}', acres: 376 } };
    const { store, events } = make({ cloud });
    await store.attach(user('u1'));
    await settle();
    expect(getIn(cloud.server, 'lands/club1/name')).toBe('My Club');
    expect(store.getSnapshot().state.lands?.club1).toBeTruthy();
    expect(cloud.provisionDropped).toBe(true);
    expect(events).toContainEqual({ type: 'claimed', lands: ['My Club'] });
  });
  it('does not duplicate a boundary that was imported on this device before accounts existed', async () => {
    const storage = memoryStorage();
    const wire = { name: 'My Club', kind: 'club', pack: 'club', deerZone: 'C', geometryJson: '{}', acres: 0, created: 1 };
    const g = new DataStore({ storage, openCloud: async () => new FakeCloud(), legacy: () => ({ lands: { imported: wire } as never }) });
    expect(g.getSnapshot().state.lands?.imported).toBeTruthy();
    const cloud = new FakeCloud();
    cloud.provision = { club1: { ...wire, geometryJson: '{"type":"Polygon","coordinates":[]}', acres: 376 } };
    const { store } = make({ storage, cloud });
    await store.attach(user('u1'));
    await settle();
    expect(Object.keys(cloud.server.lands as object)).toEqual(['club1']);
  });
  it('does not claim for an unverified email', async () => {
    const cloud = new FakeCloud();
    cloud.provision = { club1: { name: 'My Club', kind: 'club', pack: 'club', deerZone: 'C', geometryJson: '{}', acres: 1 } };
    const { store } = make({ cloud });
    await store.attach(user('u1', { emailVerified: false }));
    await settle();
    expect(cloud.provisionDropped).toBe(false);
    expect(store.getSnapshot().state.lands).toBeUndefined();
  });
  it('keeps the delivery in place if saving the land did not go through', async () => {
    const cloud = new FakeCloud();
    cloud.failPaths.add('lands');
    cloud.provision = { club1: { name: 'My Club', kind: 'club', pack: 'club', deerZone: 'C', geometryJson: '{}', acres: 1 } };
    const { store } = make({ cloud, flushTimeoutMs: 60 });
    await store.attach(user('u1'));
    await new Promise((r) => setTimeout(r, 150));
    expect(cloud.provisionDropped).toBe(false);
    expect(cloud.provision).not.toBeNull();
    store.detach();
  });
});
