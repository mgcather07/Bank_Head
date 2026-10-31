import { useCallback, useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

export type Tab = 'explore' | 'outlook' | 'journal' | 'you';
const TABS: Tab[] = ['explore', 'outlook', 'journal', 'you'];

/** The current tab lives in the URL hash (#/journal), so the browser's back button and links work. */
export function useHashTab(): [Tab, (t: Tab) => void] {
  const read = (): Tab => { const h = window.location.hash.replace(/^#\/?/, '') as Tab; return TABS.includes(h) ? h : 'explore'; };
  const [tab, setTab] = useState<Tab>(read);
  useEffect(() => { const on = () => setTab(read()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const go = useCallback((t: Tab) => { if (window.location.hash !== `#/${t}`) window.location.hash = `/${t}`; else setTab(t); }, []);
  return [tab, go];
}

/** Applies the theme preference to the document and the browser chrome colour. Returns whether the UI is dark. */
export function useTheme(pref: 'auto' | 'light' | 'dark') {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = pref === 'dark' || (pref === 'auto' && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
    // the picked theme overrides the system-based colours in index.html
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.removeAttribute('media'); m.setAttribute('content', dark ? '#0b100d' : '#f2f3ee'); });
  }, [pref, dark]);
  return dark;
}
