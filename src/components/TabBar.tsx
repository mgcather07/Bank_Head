// Phone bottom tab bar (hidden on desktop, where the map and panel sit side by side).
type Tab = 'map' | 'hunt' | 'outlook' | 'journal' | 'sources';

const PATHS: Record<Tab, string> = {
  map: 'M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z M9 4v13.5 M15 6.5V20',
  hunt: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  outlook: 'M4 6h16v14H4Z M4 10h16 M8 3v5 M16 3v5 M8 14h2 M12 14h2 M16 14h1 M8 17h2 M12 17h2',
  journal: 'M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2Z M6 19a2 2 0 0 1 2-2h11 M10 7h6 M10 10h5',
  sources: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 11v6 M12 7.5v.5',
};

export function TabIcon({ tab, size = 18 }: { tab: Tab; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="tab-icon">
      <path d={PATHS[tab]} />
    </svg>
  );
}

const ITEMS: [Tab, string][] = [['map', 'Map'], ['hunt', 'Hunt'], ['outlook', '7-Day'], ['journal', 'Journal'], ['sources', 'Info']];

export function TabBar({ tab, onTab, hasSelection }: { tab: Tab; onTab: (t: Tab) => void; hasSelection: boolean }) {
  return (
    <nav className="tabbar" role="tablist" aria-label="Main">
      {ITEMS.map(([t, label]) => (
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
          <span className="tb-icon"><TabIcon tab={t} size={24} />{t === 'map' && hasSelection && <i className="tb-dot" />}</span>
          <span className="tb-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
