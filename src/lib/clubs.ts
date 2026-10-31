// Shared clubs — a piece of private land that several accounts hunt, visible only to its members.
//
//   clubs/{clubId}/info                 the land (same shape as a private land: boundary as a JSON string)
//   clubs/{clubId}/members/{uid}        { role, name, email, photoURL, joined }
//   clubs/{clubId}/invites/{emailKey}   pending invitations, so owners and admins can see and revoke them
//   invites/{emailKey}/{clubId}         the invitee's inbox (readable only by that verified Google address)
//   users/{uid}/clubs/{clubId}: true    the clubs this account belongs to
//
// The database rules (database.rules.json) are the real boundary: only members can read a club, only the owner edits it,
// owners and admins invite, and an invitation can only be accepted by the verified address it was sent to.
import { emailKey, landFromWire, type LandDoc, type LandWire } from './models';

export type ClubRole = 'owner' | 'admin' | 'member';
export interface ClubMember { uid: string; role: ClubRole; name?: string; email?: string; photoURL?: string; joined: number }
export interface ClubInvite { key: string; email: string; role: Exclude<ClubRole, 'owner'>; invitedBy: string; invitedByName?: string; created: number }
export interface Club { id: string; land: LandDoc; members: ClubMember[]; invites: ClubInvite[]; role: ClubRole }
export interface InboxInvite { clubId: string; clubName: string; role: Exclude<ClubRole, 'owner'>; invitedByName: string; created: number }

export interface ClubWire {
  info?: LandWire;
  members?: Record<string, Omit<ClubMember, 'uid'>>;
  invites?: Record<string, Omit<ClubInvite, 'key'>>;
}

const RANK: Record<ClubRole, number> = { owner: 0, admin: 1, member: 2 };
export const ROLE_LABEL: Record<ClubRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** A club as read from the database, from the point of view of `uid`. Null if it is unreadable or `uid` is not in it. */
export function clubFromWire(id: string, w: ClubWire | null | undefined, uid: string): Club | null {
  if (!w?.info) return null;
  const land = landFromWire(id, w.info);
  const me = w.members?.[uid];
  if (!land || !me) return null;
  const members = Object.entries(w.members ?? {})
    .map(([u, m]) => ({ ...m, uid: u }))
    .sort((a, b) => RANK[a.role] - RANK[b.role] || (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? ''));
  const invites = Object.entries(w.invites ?? {}).map(([key, i]) => ({ ...i, key })).sort((a, b) => a.created - b.created);
  return { id, land: { ...land, kind: 'club' }, members, invites, role: me.role };
}

export const canInvite = (role: ClubRole) => role === 'owner' || role === 'admin';
/** Roles `role` may hand out in an invitation. */
export const invitableRoles = (role: ClubRole): Array<Exclude<ClubRole, 'owner'>> => (role === 'owner' ? ['member', 'admin'] : role === 'admin' ? ['member'] : []);
/** Whether `actor` may change or remove `target` (mirrors the database rules). */
export const canManage = (actor: ClubRole, target: ClubMember, actorUid: string) =>
  target.uid !== actorUid && target.role !== 'owner' && (actor === 'owner' || (actor === 'admin' && target.role === 'member'));

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Checks an address before inviting it; returns a reason it can't be invited, or null. */
export function inviteProblem(club: Club, email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e)) return 'Enter a full email address, like name@gmail.com.';
  if (club.members.some((m) => m.email?.toLowerCase() === e)) return 'That person is already a member.';
  if (club.invites.some((i) => i.key === emailKey(e))) return 'That address already has an invitation waiting.';
  return null;
}

/** The message sent with an invitation (by the inviter's own share sheet or email app). */
export function inviteMessage(club: Club, email: string, from: string): { title: string; text: string; url: string } {
  const url = 'https://bankhead.web.app/#you';
  return {
    title: `Join ${club.land.name}`,
    text: `${from} invited you to ${club.land.name} on Bankhead Hunt Intelligence. Open the app and sign in with Google as ${email.trim().toLowerCase()} to accept.`,
    url,
  };
}
