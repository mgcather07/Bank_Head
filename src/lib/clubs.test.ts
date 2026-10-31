import { describe, expect, it } from 'vitest';
import { canManage, clubFromWire, invitableRoles, inviteProblem, type ClubWire } from './clubs';
import { resolveWorkspace, workspacesFor } from './workspaces';
import type { LandDoc } from './models';

const info = { name: 'Night Shadow', kind: 'club' as const, pack: 'club', deerZone: 'C' as const, geometryJson: JSON.stringify({ type: 'Polygon', coordinates: [[[-86.73, 33.76], [-86.72, 33.76], [-86.72, 33.77], [-86.73, 33.76]]] }), acres: 376.4, created: 1 };
const wire: ClubWire = {
  info,
  members: { me: { role: 'owner', name: 'Mike', email: 'mike@gmail.com', joined: 1 }, b: { role: 'member', name: 'Bo', email: 'bo@gmail.com', joined: 2 }, a: { role: 'admin', name: 'Al', email: 'al@gmail.com', joined: 3 } },
  invites: { 'cy@gmail,com': { email: 'cy@gmail.com', role: 'member', invitedBy: 'me', created: 5 } },
};

describe('clubFromWire', () => {
  it('reads the club from the member’s point of view, owner first', () => {
    const c = clubFromWire('ns', wire, 'b')!;
    expect(c.role).toBe('member');
    expect(c.members.map((m) => m.role)).toEqual(['owner', 'admin', 'member']);
    expect(c.land.geometry.type).toBe('Polygon');
    expect(c.invites[0].key).toBe('cy@gmail,com');
  });
  it('is null for someone who is not a member or a club with no land', () => {
    expect(clubFromWire('ns', wire, 'stranger')).toBeNull();
    expect(clubFromWire('ns', { members: wire.members }, 'me')).toBeNull();
    expect(clubFromWire('ns', null, 'me')).toBeNull();
  });
});

describe('permissions mirror the database rules', () => {
  const c = clubFromWire('ns', wire, 'me')!;
  const [owner, admin, member] = c.members;
  it('owner manages admins and members, never themselves', () => {
    expect(canManage('owner', admin, 'me')).toBe(true);
    expect(canManage('owner', member, 'me')).toBe(true);
    expect(canManage('owner', owner, 'me')).toBe(false);
  });
  it('admins manage members only; members manage nobody', () => {
    expect(canManage('admin', member, 'a')).toBe(true);
    expect(canManage('admin', admin, 'x')).toBe(false);
    expect(canManage('admin', owner, 'a')).toBe(false);
    expect(canManage('member', member, 'x')).toBe(false);
  });
  it('who can hand out which role', () => {
    expect(invitableRoles('owner')).toEqual(['member', 'admin']);
    expect(invitableRoles('admin')).toEqual(['member']);
    expect(invitableRoles('member')).toEqual([]);
  });
  it('rejects bad addresses, existing members and duplicate invitations', () => {
    expect(inviteProblem(c, 'nope')).toMatch(/full email/);
    expect(inviteProblem(c, ' Bo@Gmail.com ')).toMatch(/already a member/);
    expect(inviteProblem(c, 'cy@gmail.com')).toMatch(/already has an invitation/);
    expect(inviteProblem(c, 'new.person@gmail.com')).toBeNull();
  });
});

describe('club workspaces', () => {
  const club = clubFromWire('night-shadow', wire, 'me')!;
  const personal: LandDoc = { ...club.land, id: 'night-shadow', kind: 'club' };
  it('a club replaces the personal copy of the same land', () => {
    const ws = workspacesFor([personal], [club]);
    expect(ws.map((w) => w.id)).toEqual(['wma', 'nf', 'club:night-shadow']);
    expect(ws[2].club?.members).toHaveLength(3);
  });
  it('the old land:<id> setting opens the club', () => {
    expect(resolveWorkspace('land:night-shadow', [], [club]).id).toBe('club:night-shadow');
    expect(resolveWorkspace('club:gone', [], [club]).id).toBe('wma');
  });
});
