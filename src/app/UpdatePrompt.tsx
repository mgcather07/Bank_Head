// "A new version is ready" with a Refresh button. The new service worker installs in the background and waits;
// tapping Refresh activates it and reloads, so nobody is switched to new code in the middle of something.
// Updates are checked when the app opens, every 30 minutes, and whenever it comes back to the foreground (an
// installed iPhone app can stay open for days).
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from '../ui/icons';
import { LogoMark } from '../ui/Logo';

export function UpdatePrompt() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [busy, setBusy] = useState(false);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({ onRegisteredSW: (_url, r) => { if (r) setReg(r); } });

  useEffect(() => {
    if (!reg) return;
    const check = () => { if (navigator.onLine && !reg.installing) void reg.update().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const t = setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', check); };
  }, [reg]);

  const apply = () => {
    setBusy(true);
    void updateServiceWorker(true);
    // the worker reloads the page once it takes over; a tab it doesn't control yet (first visit) needs a plain reload
    setTimeout(() => window.location.reload(), 4000);
  };

  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status" aria-live="polite">
      <LogoMark size={34} />
      <div className="grow"><b>Update available</b><span>A new version of Stand Point is ready.</span></div>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={apply}><RefreshCw size={16} className={busy ? 'spin' : undefined} />{busy ? 'Updating' : 'Refresh'}</button>
      <button type="button" className="icon-btn sm quiet" aria-label="Later" onClick={() => setNeedRefresh(false)}><X size={16} /></button>
    </div>
  );
}
