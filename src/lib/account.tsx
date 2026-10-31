// Account — Google sign-in through Firebase Authentication.
//
// The person's name, photo and uid are cached on the device, so the app opens already signed in (even offline)
// while the SDK confirms the session in the background. Signed-out visitors are "guests": every public feature
// works, and anything they log stays on the device until they sign in.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CloudUser } from './sync/store';
import { getFirebase } from './firebase';

const HINT = 'bh.auth.user.v1';

export interface Account {
  status: 'guest' | 'signed-in';
  user: CloudUser | null;
  /** True once Firebase has confirmed (or denied) the cached session. */
  confirmed: boolean;
  busy: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const Ctx = createContext<Account | null>(null);

function readHint(): CloudUser | null {
  try { const v = JSON.parse(localStorage.getItem(HINT) ?? 'null'); return v && typeof v.uid === 'string' ? (v as CloudUser) : null; } catch { return null; }
}
function writeHint(u: CloudUser | null) {
  try { if (u) localStorage.setItem(HINT, JSON.stringify(u)); else localStorage.removeItem(HINT); } catch { /* ignore */ }
}

export function authMessage(e: unknown): string | null {
  const code = (e as { code?: string })?.code ?? '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return null;
  if (code === 'auth/unauthorized-domain') return 'This site is not yet authorized for Google sign-in. An administrator needs to add it in Firebase Authentication settings.';
  if (code === 'auth/network-request-failed') return 'No connection. Signing in needs signal; everything else still works.';
  if (code === 'auth/operation-not-allowed') return 'Google sign-in is turned off for this project.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  return e instanceof Error ? e.message : 'Sign-in failed. Please try again.';
}

export function AccountProvider({ children, beforeSignOut }: { children: ReactNode; /** Called with the uid just before an explicit sign-out (flush unsent writes, clear the cached copy). */ beforeSignOut?: (uid: string) => Promise<void> }) {
  const [user, setUser] = useState<CloudUser | null>(() => readHint());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { auth } = await getFirebase();
        const { onAuthStateChanged, getRedirectResult } = await import('firebase/auth');
        getRedirectResult(auth).catch((e) => { const m = authMessage(e); if (m) setError(m); });
        off = onAuthStateChanged(auth, (u) => {
          if (cancelled) return;
          const next: CloudUser | null = u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, name: u.displayName, photoURL: u.photoURL } : null;
          setUser(next);
          writeHint(next);
          setConfirmed(true);
        });
      } catch {
        // offline with no cached SDK: keep whatever the device already knows
        if (!cancelled) setConfirmed(true);
      }
    })();
    return () => { cancelled = true; off?.(); };
  }, []);

  // dev-only test hook: sign in with an email/password test account (never shipped in the production build)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __bhSignInEmail?: (e: string, p: string) => Promise<string> }).__bhSignInEmail = async (email, password) => {
      const { auth } = await getFirebase();
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user.uid;
    };
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { auth } = await getFirebase();
      const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') await signInWithRedirect(auth, provider);
        else throw e;
      }
    } catch (e) {
      const m = authMessage(e);
      if (m) setError(m);
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    try { if (user) await beforeSignOut?.(user.uid); } catch { /* best effort */ }
    try {
      const { auth } = await getFirebase();
      const { signOut: fbSignOut } = await import('firebase/auth');
      await fbSignOut(auth);
    } catch { /* offline: still clear locally below */ }
    writeHint(null);
    setUser(null);
    setBusy(false);
  }, [user, beforeSignOut]);

  const value = useMemo<Account>(() => ({ status: user ? 'signed-in' : 'guest', user, confirmed, busy, error, signIn, signOut, clearError: () => setError(null) }), [user, confirmed, busy, error, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): Account {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccount must be used inside <AccountProvider>');
  return v;
}
