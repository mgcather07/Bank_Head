# Accounts, data and sync

## Who sees what
- **Guests** (not signed in) get every public feature: Black Warrior WMA, the National Forest, weather, rules. Anything they log stays in the browser (`bh.guest.v2`).
- **Signed-in** people (Google) also get their journal, pins and settings, synced across devices, plus every **club** they have been invited to.
- A club is visible only to its members. Journals and pins stay private to each member, even inside a club.
- Private land never appears for anyone else. The public site only ships terrain, vegetation and road data for a small box; it contains nothing that says where inside the box the land is.

## Data model (Realtime Database instance `bankhead-hunt`)
```
users/{uid}/
  schema                         1
  profile    { email, name, photoURL, created, lastSeen }
  prefs      { hunt (json), layers (json), workspace, base, theme, typeFilter, onboarded, updatedAt }
  journal/{id}   { owner, date, start, end, location, coord, method, weather, windObserved, deerSeen,
                   behavior, harvest, pressure, sign, notes, predictedScore, draft, created, workspace, updatedAt }
  pins/{id}      { owner, kind, coord, note, created, candidateId, workspace, updatedAt }
  lands/{id}     { name, kind, pack, deerZone, county, geometryJson, acres, source, created, updatedAt }
  clubs/{clubId} true            the clubs this account belongs to
clubs/{clubId}/
  info                 { same fields as a land }
  members/{uid}        { role: owner|admin|member, name, email, photoURL, joined }
  invites/{emailKey}   { email, role: admin|member, invitedBy, invitedByName, created }
invites/{emailKey}/{clubId}      { clubName, role, invitedByName, created }   the invitee's inbox
provision/{email}/lands/{id}     private land waiting to be claimed (admin writes, the verified owner reads)
```
`emailKey` is the address lowercased with `.` replaced by `,` (keys can't contain dots).
Boundaries are stored as a JSON string (`geometryJson`) so the database's array handling never touches them. Every journal entry and pin carries `owner`, and the rules require it to equal the signed-in uid.

## Security rules (`database.rules.json`)
- Root is closed. `users/$uid` is readable and writable only when `auth.uid === $uid`.
- Every field is validated: types, enums, length limits, coordinate ranges; unknown fields are rejected.
- `provision/$email` is readable only by a user whose **verified** email matches, writable only to delete (after claiming).
- `clubs/$id` is readable only by its members, and nobody can list clubs. Only the owner edits the land. The owner invites members or admins; admins invite and remove plain members; nobody can make an owner from the app. A member joins only by accepting an invitation sent to their **verified** Google address, with exactly the invited role. Members can leave; the owner can't be removed.
- Tested on the emulator (`npm run test:rules`, 22 cases) and end to end against the live database with throwaway accounts.

## Clubs
Create a club (admin, Firebase CLI login). The owner must have signed in once:
```
npm run club:create -- --owner-email you@gmail.com --id my-club --from-land my-club     # turn land in that account into a club
npm run club:create -- --owner-email you@gmail.com --id my-club --file club.geojson --name "My Club" --deer-zone C --county Jefferson
```
Then, in the app: You → the club → **Invite**, enter their Google address, and send them the invitation from the share sheet. When they sign in with that address, the invitation is waiting on their You tab; **Join club** adds it to their account and opens it on the map. Owners and admins see who is waiting and can withdraw an invitation; tapping a member changes their role or removes them, and access ends immediately.

Clubs are kept on the device (`bh.clubs.v1.{uid}`) so they open with no signal; that copy is removed on sign-out or when access ends. Club changes (invite, join, remove) need a connection. Land saved in a browser is never merged into whichever account signs in there; land is shared only through clubs.

## Delivering private land (single account)
```
node scripts/provision-land.mjs --email you@gmail.com --file boundary.geojson --name "My Club" --id my-club --deer-zone C --county Jefferson
```
The next time that person signs in with that verified Google address, the app copies the land into their account, confirms it is saved, then deletes the delivery. It becomes their active workspace.

## Offline and sync (`src/lib/sync`)
- `DataStore` keeps one tree per person. Reads are the last server snapshot with unconfirmed local writes laid over it.
- Writes apply instantly, are persisted in an outbox (`bh.outbox.v2.{uid}`) and sent in order whenever the database is reachable. Retries back off; the outbox survives closing the app.
- The last server snapshot is cached (`bh.cache.v2.{uid}`) so the app opens with the person's data offline.
- On first sign-in, what a guest logged on this device is merged into the account (by id, never overwriting) and the guest copy is emptied. On sign-out, unsent writes are flushed and the cached copy is removed from the device.
- The store has no React or Firebase imports; both are injected, which is how it is unit-tested (`sync.test.ts`).

## Sign-in notes
- Provider: Google, via Firebase Authentication on project `rehtac-labs`. `bankhead.web.app` is an authorized domain.
- Sign-in runs through `bankhead.web.app/__/auth/handler` (same site), not `rehtac-labs.firebaseapp.com`: browsers partition storage across sites, which silently loses a cross-site redirect result. The OAuth client lists that handler as an authorized redirect URI. Phones and the installed app use redirect sign-in; desktops use a popup. The service worker never serves the app shell for `/__/`.

## Workspaces
`wma` and `nf` are built in. Each club becomes `club:{id}` and each land in the account `land:{id}` (an old `land:{id}` setting opens `club:{id}` once the land is a club). The active workspace decides the zones, boundary, rules, weather location and map framing, and is saved to the account.
