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
