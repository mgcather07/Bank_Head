# Accounts, data and sync

## Who sees what
- **Guests** (not signed in) get every public feature: Black Warrior WMA, the National Forest, weather, rules. Anything they log stays in the browser (`bh.guest.v2`).
- **Signed-in** people (Google) also get their journal, pins, settings and **private land**, synced across devices.
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
provision/{email}/lands/{id}     private land waiting to be claimed (admin writes, the verified owner reads)
```
Boundaries are stored as a JSON string (`geometryJson`) so the database's array handling never touches them. Every journal entry and pin carries `owner`, and the rules require it to equal the signed-in uid.

## Security rules (`database.rules.json`)
- Root is closed. `users/$uid` is readable and writable only when `auth.uid === $uid`.
- Every field is validated: types, enums, length limits, coordinate ranges; unknown fields are rejected.
- `provision/$email` is readable only by a user whose **verified** email matches, writable only to delete (after claiming).
- Tested on the emulator (`npm run test:rules`, 14 cases) and against the live database with throwaway accounts.

## Delivering private land
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
- Popup sign-in is used (redirect as a fallback). On an iOS home-screen app, popups can be blocked; the app shows a clear message if so.

## Workspaces
`wma` and `nf` are built in. Each land in the account becomes `land:{id}`. The active workspace decides the zones, boundary, rules, weather location and map framing, and is saved to the account.
