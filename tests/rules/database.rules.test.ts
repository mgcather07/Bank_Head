import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

let env: RulesTestEnvironment;
const rules = fs.readFileSync(path.resolve(__dirname, '../../database.rules.json'), 'utf8');

const verified = (email: string) => ({ email, email_verified: true });
const journalEntry = (uid: string, extra: Record<string, unknown> = {}) => ({ owner: uid, date: '2026-10-31', start: '06:30', end: '09:30', location: 'CL-BO-006 Creek bottom edge', coord: [-86.72, 33.768], method: 'bow', weather: '58F E 5', windObserved: 'E', deerSeen: 2, behavior: 'Walking', harvest: 'none', pressure: 'low', sign: 'fresh rub', notes: 'Good sit.', created: '2026-10-31T11:00:00.000Z', workspace: 'land:club1', updatedAt: 1793000000000, ...extra });
const pin = (uid: string, extra: Record<string, unknown> = {}) => ({ owner: uid, kind: 'stand', coord: [-86.72, 33.768], note: 'oak flat', created: '2026-10-31T11:00:00.000Z', ...extra });
const land = (extra: Record<string, unknown> = {}) => ({ name: 'My Club', kind: 'club', pack: 'club', deerZone: 'C', geometryJson: '{"type":"Polygon","coordinates":[]}', acres: 376, created: 1793000000000, ...extra });

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-bankhead', database: { rules, host: '127.0.0.1', port: 9000 } });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const as = (uid: string, token: Record<string, unknown> = {}) => env.authenticatedContext(uid, token).database();
const anon = () => env.unauthenticatedContext().database();

describe('who can touch what', () => {
  it('signed-out visitors can read and write nothing', async () => {
    await assertFails(anon().ref('users/alice/journal').get());
    await assertFails(anon().ref('users/alice/journal/j1').set(journalEntry('alice')));
    await assertFails(anon().ref('provision').get());
    await assertFails(anon().ref('/').get());
  });
  it('a user reads and writes only their own subtree', async () => {
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice')));
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').get());
    await assertFails(as('bob').ref('users/alice/journal/j1').get());
    await assertFails(as('bob').ref('users/alice/journal/j2').set(journalEntry('alice')));
    await assertFails(as('bob').ref('users/alice').get());
  });
  it('nobody can list all users or write elsewhere in the tree', async () => {
    await assertFails(as('alice').ref('users').get());
    await assertFails(as('alice').ref('/').get());
    await assertFails(as('alice').ref('somewhere/else').set({ a: 1 }));
    await assertFails(as('alice').ref('users/alice/unknown').set({ a: 1 }));
  });
});

describe('journal entries', () => {
  it('accepts a complete entry and an update to it', async () => {
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice')));
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { notes: 'edited', updatedAt: 1793000001000 })));
  });
  it('is always tied to the signed-in user', async () => {
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('bob')));
    const { owner: _omit, ...noOwner } = journalEntry('alice');
    await assertFails(as('alice').ref('users/alice/journal/j1').set(noOwner));
  });
  it('rejects unknown fields, oversize text and bad enums', async () => {
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { sneaky: 'x' })));
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { notes: 'x'.repeat(8001) })));
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { harvest: 'elk' })));
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { deerSeen: -1 })));
    await assertFails(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice', { coord: [-300, 33] })));
  });
  it('can be deleted by its owner only', async () => {
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').set(journalEntry('alice')));
    await assertFails(as('bob').ref('users/alice/journal/j1').remove());
    await assertSucceeds(as('alice').ref('users/alice/journal/j1').remove());
  });
});

describe('pins', () => {
  it('accepts valid pins and rejects bad kinds or coordinates', async () => {
    await assertSucceeds(as('alice').ref('users/alice/pins/p1').set(pin('alice')));
    await assertSucceeds(as('alice').ref('users/alice/pins/p2').set(pin('alice', { kind: 'parking', note: 'gate' })));
    await assertFails(as('alice').ref('users/alice/pins/p3').set(pin('alice', { kind: 'bomb' })));
    await assertFails(as('alice').ref('users/alice/pins/p4').set(pin('alice', { coord: [10, 95] })));
    await assertFails(as('alice').ref('users/alice/pins/p5').set(pin('bob')));
  });
});

describe('private lands', () => {
  it('stores a land with a JSON-string boundary, and nothing malformed', async () => {
    await assertSucceeds(as('alice').ref('users/alice/lands/club1').set(land()));
    await assertFails(as('alice').ref('users/alice/lands/club2').set(land({ geometryJson: { type: 'Polygon' } })));
    await assertFails(as('alice').ref('users/alice/lands/club3').set(land({ geometryJson: 'x'.repeat(400001) })));
    await assertFails(as('alice').ref('users/alice/lands/club4').set(land({ deerZone: 'Z' })));
    await assertFails(as('alice').ref('users/alice/lands/club5').set(land({ name: '' })));
    await assertFails(as('bob').ref('users/alice/lands/club6').set(land()));
  });
  it('other users cannot read a land', async () => {
    await assertSucceeds(as('alice').ref('users/alice/lands/club1').set(land()));
    await assertFails(as('bob').ref('users/alice/lands/club1').get());
    await assertFails(as('bob').ref('users/alice/lands').get());
  });
});

describe('prefs and profile', () => {
  it('validates preferences and rejects junk keys', async () => {
    await assertSucceeds(as('alice').ref('users/alice/prefs').set({ hunt: '{"weapon":"bow"}', workspace: 'wma', theme: 'dark', onboarded: true }));
    await assertFails(as('alice').ref('users/alice/prefs/theme').set('neon'));
    await assertFails(as('alice').ref('users/alice/prefs/other').set('x'));
  });
  it('requires an email on the profile', async () => {
    await assertSucceeds(as('alice').ref('users/alice/profile').set({ email: 'alice@example.com', name: 'Alice', created: 1, lastSeen: 2 }));
    await assertFails(as('alice').ref('users/alice/profile').set({ name: 'Alice' }));
  });
});

describe('provisioned lands (delivered to a verified email)', () => {
  const seed = async () => env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref('provision/owner@example,com/lands/club1').set(land()); });
  it('can be read only by the verified owner of that email', async () => {
    await seed();
    await assertSucceeds(as('alice', verified('owner@example.com')).ref('provision/owner@example,com').get());
    await assertSucceeds(as('alice', verified('Owner@Example.com')).ref('provision/owner@example,com').get());
    await assertFails(as('mallory', verified('mallory@example.com')).ref('provision/owner@example,com').get());
    await assertFails(as('mallory', { email: 'owner@example.com', email_verified: false }).ref('provision/owner@example,com').get());
    await assertFails(as('alice').ref('provision/owner@example,com').get());
    await assertFails(as('alice', verified('owner@example.com')).ref('provision').get());
  });
  it('can be removed after claiming, but never written by a client', async () => {
    await seed();
    await assertFails(as('alice', verified('owner@example.com')).ref('provision/owner@example,com/lands/evil').set(land()));
    await assertFails(as('mallory', verified('mallory@example.com')).ref('provision/owner@example,com').remove());
    await assertSucceeds(as('alice', verified('owner@example.com')).ref('provision/owner@example,com').remove());
  });
});

describe('shared clubs', () => {
  const key = (e: string) => e.toLowerCase().replace(/\./g, ',');
  const member = (role: string, extra: Record<string, unknown> = {}) => ({ role, name: 'Someone', email: 'x@gmail.com', joined: 1793000000000, ...extra });
  const invite = (by: string, role = 'member', email = 'carol.ann@gmail.com') => ({ email, role, invitedBy: by, invitedByName: 'Alice', created: 1793000000000 });
  const inbox = (role = 'member') => ({ clubName: 'My Club', role, invitedByName: 'Alice', created: 1793000000000 });
  const seed = async (extraMembers: Record<string, unknown> = {}) => env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref('clubs/c1').set({ info: land(), members: { alice: member('owner'), bob: member('member'), ...extraMembers } });
  });
  const carol = () => as('carol', verified('carol.ann@gmail.com'));
  const acceptAsCarol = (role = 'member') => carol().ref().update({
    'clubs/c1/members/carol': member(role, { email: 'carol.ann@gmail.com' }),
    [`clubs/c1/invites/${key('carol.ann@gmail.com')}`]: null,
    [`invites/${key('carol.ann@gmail.com')}/c1`]: null,
    'users/carol/clubs/c1': true,
  });

  it('only members can read a club; nobody can list clubs', async () => {
    await seed();
    await assertSucceeds(as('alice').ref('clubs/c1').get());
    await assertSucceeds(as('bob').ref('clubs/c1/info').get());
    await assertFails(as('carol').ref('clubs/c1').get());
    await assertFails(as('carol').ref('clubs/c1/info').get());
    await assertFails(as('alice').ref('clubs').get());
    await assertFails(anon().ref('clubs/c1').get());
  });
  it('nobody can create a club or make themselves a member from the app', async () => {
    await assertFails(as('mallory').ref('clubs/c2/info').set(land()));
    await assertFails(as('mallory').ref('clubs/c2/members/mallory').set(member('owner')));
    await seed();
    await assertFails(as('mallory', verified('mallory@gmail.com')).ref('clubs/c1/members/mallory').set(member('member')));
  });
  it('the owner invites; plain members cannot', async () => {
    await seed();
    await assertSucceeds(as('alice').ref().update({ [`clubs/c1/invites/${key('carol.ann@gmail.com')}`]: invite('alice'), [`invites/${key('carol.ann@gmail.com')}/c1`]: inbox() }));
    await assertFails(as('bob').ref(`clubs/c1/invites/${key('dave@gmail.com')}`).set(invite('bob', 'member', 'dave@gmail.com')));
    await assertFails(as('bob').ref(`invites/${key('dave@gmail.com')}/c1`).set(inbox()));
    await assertFails(as('alice').ref(`clubs/c1/invites/${key('dave@gmail.com')}`).set(invite('bob', 'member', 'dave@gmail.com'))); // must sign as yourself
    await assertFails(as('alice').ref(`clubs/c1/invites/${key('dave@gmail.com')}`).set(invite('alice', 'owner', 'dave@gmail.com')));
  });
  it('admins invite members but not admins', async () => {
    await seed({ dan: member('admin') });
    await assertSucceeds(as('dan').ref(`clubs/c1/invites/${key('carol.ann@gmail.com')}`).set(invite('dan')));
    await assertFails(as('dan').ref(`clubs/c1/invites/${key('erin@gmail.com')}`).set(invite('dan', 'admin', 'erin@gmail.com')));
  });
  it('the invited, verified email accepts with exactly the invited role, then can read the club', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref().update({ [`clubs/c1/invites/${key('carol.ann@gmail.com')}`]: invite('alice'), [`invites/${key('carol.ann@gmail.com')}/c1`]: inbox() }); });
    await assertSucceeds(carol().ref(`invites/${key('carol.ann@gmail.com')}`).get());
    await assertFails(as('bob', verified('bob@gmail.com')).ref(`invites/${key('carol.ann@gmail.com')}`).get());
    await assertFails(as('carol', { email: 'carol.ann@gmail.com', email_verified: false }).ref('clubs/c1/members/carol').set(member('member')));
    await assertFails(carol().ref('clubs/c1/members/carol').set(member('admin')));
    await assertSucceeds(acceptAsCarol());
    await assertSucceeds(carol().ref('clubs/c1/info').get());
    await assertFails(carol().ref('clubs/c1/members/carol').set(member('admin'))); // cannot promote yourself
  });
  it('an invitation is single-use and can be declined', async () => {
    await seed();
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref().update({ [`clubs/c1/invites/${key('carol.ann@gmail.com')}`]: invite('alice'), [`invites/${key('carol.ann@gmail.com')}/c1`]: inbox() }); });
    await assertSucceeds(carol().ref().update({ [`clubs/c1/invites/${key('carol.ann@gmail.com')}`]: null, [`invites/${key('carol.ann@gmail.com')}/c1`]: null }));
    await assertFails(carol().ref('clubs/c1/members/carol').set(member('member')));
  });
  it('the owner removes members; members leave; the owner cannot be removed', async () => {
    await seed({ dan: member('admin') });
    await assertFails(as('bob').ref('clubs/c1/members/dan').remove());
    await assertFails(as('dan').ref('clubs/c1/members/alice').remove());
    await assertFails(as('alice').ref('clubs/c1/members/alice').remove());
    await assertFails(as('dan').ref('clubs/c1/members/bob').set(member('admin')));
    await assertSucceeds(as('alice').ref('clubs/c1/members/bob').set(member('admin')));
    await assertSucceeds(as('dan').ref('clubs/c1/members/dan').remove());
    await assertSucceeds(as('alice').ref('clubs/c1/members/bob').remove());
    await assertFails(as('bob').ref('clubs/c1').get());
  });
  it('only the owner edits the boundary', async () => {
    await seed({ dan: member('admin') });
    await assertSucceeds(as('alice').ref('clubs/c1/info/name').set('Renamed'));
    await assertFails(as('dan').ref('clubs/c1/info/name').set('Hijack'));
    await assertFails(as('bob').ref('clubs/c1/info/geometryJson').set('{}'));
  });
});
