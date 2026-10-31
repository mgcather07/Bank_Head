import { useCallback, useEffect, useState } from 'react';

/** "Add to home screen": Chrome/Android fire an install prompt; iOS needs the Share menu. */
export function useInstall() {
  const [evt, setEvt] = useState<Event | null>(null);
  const [help, setHelp] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const install = useCallback(async () => {
    const e = evt as (Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> }) | null;
    if (e) { await e.prompt(); await e.userChoice; setEvt(null); } else setHelp(true);
  }, [evt]);
  return { canInstall: !standalone && (!!evt || ios), install, help, closeHelp: () => setHelp(false), ios };
}
