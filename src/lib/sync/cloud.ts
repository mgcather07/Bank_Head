// Realtime Database implementation of the store's Cloud interface.
import type { Json } from '../models';
import { emailKey } from '../models';
import { getFirebase } from '../firebase';
import { CHILDREN, type Cloud, type CloudUser } from './store';

export async function openFirebaseCloud(user: CloudUser): Promise<Cloud> {
  const { db } = await getFirebase();
  const { ref, onValue, set, remove, get } = await import('firebase/database');
  const root = `users/${user.uid}`;
  return {
    listen(onChild, onConnected, onError) {
      const offs: Array<() => void> = [];
      for (const child of CHILDREN) {
        offs.push(onValue(ref(db, `${root}/${child}`), (snap) => onChild(child, snap.exists() ? (snap.val() as Json) : null), (err) => onError(err.message)));
      }
      offs.push(onValue(ref(db, '.info/connected'), (snap) => onConnected(snap.val() === true)));
      return () => offs.forEach((off) => off());
    },
    async set(path, value) {
      const r = ref(db, `${root}/${path}`);
      if (value === null) await remove(r);
      else await set(r, value);
    },
    async claim(email) {
      const snap = await get(ref(db, `provision/${emailKey(email)}/lands`));
      return snap.exists() ? (snap.val() as Record<string, Json>) : null;
    },
    async dropClaim(email) {
      await remove(ref(db, `provision/${emailKey(email)}`));
    },
    close() { /* listeners are removed by unlisten */ },
  };
}
