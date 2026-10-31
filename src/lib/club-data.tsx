// React bindings for shared clubs: the clubs this account belongs to (kept on the device for use with no signal),
// the invitations waiting for it, and the actions owners, admins and members can take.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAccount } from './account';
import { useSnapshot, useStore } from './data';
import { clubFromWire, type Club, type ClubRole, type ClubWire, type InboxInvite } from './clubs';
import * as cloud from './sync/clubCloud';

const cacheKey = (uid: string) => `bh.clubs.v1.${uid}`;
/** Removes this person's cached clubs from the device (on sign-out). */
export function clearClubCache(uid: string) { try { localStorage.removeItem(cacheKey(uid)); } catch { /* ignore */ } }
const readCache = (uid: string): Record<string, ClubWire> => { try { return JSON.parse(localStorage.getItem(cacheKey(uid)) ?? '{}') ?? {}; } catch { return {}; } };

export interface ClubsApi {
  clubs: Club[];
  /** True once every club in the account has been read (from the device or the database). */
  loaded: boolean;
  inbox: InboxInvite[];
  invite: (club: Club, email: string, role: Exclude<ClubRole, 'owner'>) => Promise<void>;
  revoke: (clubId: string, key: string) => Promise<void>;
  setRole: (clubId: string, uid: string, role: Exclude<ClubRole, 'owner'>) => Promise<void>;
  remove: (clubId: string, uid: string) => Promise<void>;
  leave: (clubId: string) => Promise<void>;
  accept: (inv: InboxInvite) => Promise<void>;
  decline: (inv: InboxInvite) => Promise<void>;
}

const Ctx = createContext<ClubsApi | null>(null);

export function ClubsProvider({ children }: { children: ReactNode }) {
  const { user } = useAccount();
  const snap = useSnapshot();
  const store = useStore();
  const uid = user?.uid ?? null;
  const ids = useMemo(() => (uid ? Object.keys(snap.state.clubs ?? {}).sort() : []), [uid, snap.state.clubs]);
  const idsKey = ids.join(',');

  // live copies from the database, layered over what this device last saw (so a club opens with no signal)
  const [live, setLive] = useState<{ uid: string | null; data: Record<string, ClubWire | 'gone'> }>({ uid: null, data: {} });
  const cached = useMemo(() => (uid ? readCache(uid) : {}), [uid]);
  const wires = useMemo<Record<string, ClubWire | 'gone'>>(() => ({ ...cached, ...(live.uid === uid ? live.data : {}) }), [cached, live, uid]);

  useEffect(() => {
    if (!uid) return;
    const put = (id: string, w: ClubWire | 'gone') => setLive((cur) => ({ uid, data: { ...(cur.uid === uid ? cur.data : {}), [id]: w } }));
    const offs = idsKey.split(',').filter(Boolean).map((id) => cloud.watchClub(id, (w) => put(id, w ?? 'gone'), () => put(id, 'gone')));
    return () => offs.forEach((off) => off());
  }, [uid, idsKey]);

  // keep the device copy current; drop clubs this account was removed from
  useEffect(() => {
    if (!uid || live.uid !== uid) return;
    const keep: Record<string, ClubWire> = {};
    for (const id of ids) { const w = wires[id]; if (w && w !== 'gone') keep[id] = w; }
    try { localStorage.setItem(cacheKey(uid), JSON.stringify(keep)); } catch { /* ignore */ }
    for (const id of ids) if (live.data[id] === 'gone' && snap.sync.state === 'synced') store.write(`clubs/${id}`, null);
  }, [uid, live, idsKey, snap.sync.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const email = user?.emailVerified ? user.email : null;
  const [inboxState, setInboxState] = useState<{ email: string | null; list: InboxInvite[] }>({ email: null, list: [] });
  useEffect(() => { if (email) return cloud.watchInbox(email, (list) => setInboxState({ email, list })); }, [email]);
  const inbox = useMemo(() => (inboxState.email === email ? inboxState.list : []), [inboxState, email]);

  const clubs = useMemo(() => {
    if (!uid) return [];
    return ids.map((id) => { const w = wires[id]; return w && w !== 'gone' ? clubFromWire(id, w, uid) : null; }).filter((c): c is Club => !!c).sort((a, b) => a.land.name.localeCompare(b.land.name));
  }, [uid, ids, wires]);
  const loaded = !uid || (snap.loaded && ids.every((id) => id in wires));

  const need = useCallback(() => { if (!user) throw new Error('Sign in first.'); return user; }, [user]);
  const api = useMemo<ClubsApi>(() => ({
    clubs, loaded, inbox,
    invite: (club, e, role) => cloud.sendInvite(club, need(), e, role),
    revoke: cloud.revokeInvite,
    setRole: cloud.setMemberRole,
    remove: cloud.removeMember,
    leave: (clubId) => cloud.leaveClub(clubId, need()),
    accept: (inv) => cloud.acceptInvite(inv, need()),
    decline: (inv) => { const u = need(); if (!u.email) throw new Error('No email on this account.'); return cloud.declineInvite(inv, u.email); },
  }), [clubs, loaded, inbox, need]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useClubs(): ClubsApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useClubs must be used inside <ClubsProvider>');
  return c;
}
