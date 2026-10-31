// Realtime Database calls for shared clubs. Reads are live listeners; changes are single atomic multi-path updates,
// so an invitation and its inbox copy (or a membership and its index entry) never get out of step.
import { getFirebase } from '../firebase';
import { clean, emailKey, type Json } from '../models';
import type { Club, ClubInvite, ClubRole, ClubWire, InboxInvite } from '../clubs';
import type { CloudUser } from './store';

const fb = async () => {
  const [{ db }, m] = await Promise.all([getFirebase(), import('firebase/database')]);
  return { db, ...m };
};

/** Watches one club. `onGone` fires if it can't be read (removed from the club, or the club was deleted). */
export function watchClub(id: string, onData: (w: ClubWire | null) => void, onGone: (reason: string) => void): () => void {
  let off: (() => void) | null = null;
  let stopped = false;
  void fb().then(({ db, ref, onValue }) => {
    if (stopped) return;
    off = onValue(ref(db, `clubs/${id}`), (s) => onData(s.exists() ? (s.val() as ClubWire) : null), (e) => onGone(e.message));
  }).catch((e) => onGone(String(e)));
  return () => { stopped = true; off?.(); };
}

/** Watches the invitations waiting for this verified address. */
export function watchInbox(email: string, onData: (list: InboxInvite[]) => void): () => void {
  let off: (() => void) | null = null;
  let stopped = false;
  void fb().then(({ db, ref, onValue }) => {
    if (stopped) return;
    off = onValue(ref(db, `invites/${emailKey(email)}`), (s) => {
      const v = (s.val() ?? {}) as Record<string, Omit<InboxInvite, 'clubId'>>;
      onData(Object.entries(v).map(([clubId, i]) => ({ ...i, clubId })).sort((a, b) => a.created - b.created));
    }, () => onData([]));
  }).catch(() => onData([]));
  return () => { stopped = true; off?.(); };
}

// Club changes need a connection: fail clearly instead of leaving a button spinning until signal comes back.
const online = <T,>(p: Promise<T>) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error('offline')), 12000); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

/** One atomic write: `sets` (undefined fields dropped) plus the paths in `deletes` removed. */
async function updateWithDeletes(sets: Record<string, unknown>, deletes: string[]) {
  const { db, ref, update } = await fb();
  const body: Record<string, Json | null> = clean(sets) as Record<string, Json>;
  for (const p of deletes) body[p] = null;
  await online(update(ref(db), body));
}

export async function sendInvite(club: Club, me: CloudUser, email: string, role: Exclude<ClubRole, 'owner'>) {
  const e = email.trim().toLowerCase();
  const key = emailKey(e);
  const from = me.name ?? me.email ?? 'A club member';
  const created = Date.now();
  const invite: Omit<ClubInvite, 'key'> = { email: e, role, invitedBy: me.uid, invitedByName: from, created };
  await updateWithDeletes({ [`clubs/${club.id}/invites/${key}`]: invite, [`invites/${key}/${club.id}`]: { clubName: club.land.name, role, invitedByName: from, created } }, []);
}

export const revokeInvite = (clubId: string, key: string) => updateWithDeletes({}, [`clubs/${clubId}/invites/${key}`, `invites/${key}/${clubId}`]);

export async function setMemberRole(clubId: string, uid: string, role: Exclude<ClubRole, 'owner'>) {
  const { db, ref, set } = await fb();
  await online(set(ref(db, `clubs/${clubId}/members/${uid}/role`), role));
}

export const removeMember = (clubId: string, uid: string) => updateWithDeletes({}, [`clubs/${clubId}/members/${uid}`]);

export const leaveClub = (clubId: string, me: CloudUser) => updateWithDeletes({}, [`clubs/${clubId}/members/${me.uid}`, `users/${me.uid}/clubs/${clubId}`]);

/** Joins with exactly the invited role, removes both copies of the invitation and adds the club to this account, in one write. */
export async function acceptInvite(inv: InboxInvite, me: CloudUser) {
  if (!me.email) throw new Error('This account has no email address.');
  const key = emailKey(me.email);
  await updateWithDeletes(
    { [`clubs/${inv.clubId}/members/${me.uid}`]: { role: inv.role, name: me.name ?? undefined, email: me.email.toLowerCase(), photoURL: me.photoURL ?? undefined, joined: Date.now() }, [`users/${me.uid}/clubs/${inv.clubId}`]: true },
    [`clubs/${inv.clubId}/invites/${key}`, `invites/${key}/${inv.clubId}`],
  );
}

export function declineInvite(inv: InboxInvite, email: string) {
  const key = emailKey(email);
  return updateWithDeletes({}, [`clubs/${inv.clubId}/invites/${key}`, `invites/${key}/${inv.clubId}`]);
}

/** Readable message for a failed club action. */
export function clubError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/permission/i.test(m)) return 'You don’t have permission to do that in this club.';
  if (/network|offline|disconnected/i.test(m)) return 'No connection. Club changes need signal.';
  return m;
}
