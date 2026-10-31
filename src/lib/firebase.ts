// Firebase (Rehtac Labs project). These values identify the project and are safe to ship in client code;
// access is enforced by Authentication and the Realtime Database rules (database.rules.json).
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Database } from 'firebase/database';

export const firebaseConfig = {
  apiKey: 'AIzaSyC7ksEzwS4Rw57AnCKxVBjEj_ohZysnGFg',
  authDomain: 'rehtac-labs.firebaseapp.com',
  databaseURL: 'https://bankhead-hunt.firebaseio.com',
  projectId: 'rehtac-labs',
  storageBucket: 'rehtac-labs.firebasestorage.app',
  messagingSenderId: '921295215817',
  appId: '1:921295215817:web:bb1e198b577bd934334118',
};

export interface Firebase { app: FirebaseApp; auth: Auth; db: Database }
let instance: Promise<Firebase> | null = null;

/** The SDK is loaded on demand so the first paint never waits for it. */
export function getFirebase(): Promise<Firebase> {
  instance ??= (async () => {
    const [{ initializeApp }, { getAuth }, { getDatabase }] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/database')]);
    const app = initializeApp(firebaseConfig);
    return { app, auth: getAuth(app), db: getDatabase(app) };
  })().catch((e) => { instance = null; throw e; });
  return instance;
}
