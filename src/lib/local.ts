// Device-only state (never synced): offline map packs, dismissed notices, install hints.
import { useEffect, useState } from 'react';

export function useLocal<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }, [key, value]);
  return [value, setValue] as const;
}
