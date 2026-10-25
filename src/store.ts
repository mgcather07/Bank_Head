// HuntJournalService + private pins. Stored only on this device (localStorage) — never uploaded.
import { useCallback, useEffect, useState } from 'react';
import type { UserPin } from './engine/types';

export interface JournalEntry {
  id: string;
  date: string;
  start: string;
  end: string;
  location: string;
  coord: [number, number] | null;
  candidateId?: string;
  method: string;
  weather: string;
  windObserved: string;
  deerSeen: number;
  behavior: string;
  harvest: 'none' | 'buck' | 'doe';
  pressure: 'none' | 'low' | 'moderate' | 'high';
  sign: string;
  notes: string;
  predictedScore?: number | null;
  draft?: boolean;
  created: string;
}

function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function usePins() {
  const [pins, setPins] = usePersisted<UserPin[]>('bh.pins.v1', []);
  const add = useCallback((p: Omit<UserPin, 'id' | 'created'>) => setPins((x) => [...x, { ...p, id: uid(), created: new Date().toISOString() }]), [setPins]);
  const remove = useCallback((id: string) => setPins((x) => x.filter((p) => p.id !== id)), [setPins]);
  return { pins, add, remove, setAll: setPins };
}

export function useJournal() {
  const [entries, setEntries] = usePersisted<JournalEntry[]>('bh.journal.v1', []);
  const save = useCallback((e: JournalEntry) => setEntries((x) => [e, ...x.filter((y) => y.id !== e.id)]), [setEntries]);
  const remove = useCallback((id: string) => setEntries((x) => x.filter((p) => p.id !== id)), [setEntries]);
  return { entries, save, remove, setAll: setEntries };
}

export { usePersisted };
