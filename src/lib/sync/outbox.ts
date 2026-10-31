// Offline write queue. Every change is applied to the local view immediately and queued here until the
// database confirms it, so nothing is lost if the app closes or the signal drops mid-write.
import type { Json } from '../models';
import { getIn, setIn, type Tree } from './tree';

export interface Op { id: string; path: string; value: Json | null; ts: number }

const covers = (ancestor: string, path: string) => path === ancestor || path.startsWith(ancestor + '/');

/**
 * Add an op, collapsing ones it makes redundant: a later write to a path replaces earlier writes to it or
 * anything beneath it. Writes to an ancestor that still apply (earlier) are kept, since order matters.
 */
export function enqueue(ops: Op[], op: Op): Op[] {
  return [...ops.filter((o) => !covers(op.path, o.path)), op];
}

export function ack(ops: Op[], id: string): Op[] {
  return ops.filter((o) => o.id !== id);
}

/** The view a user should see: the last server state with every unconfirmed local write laid over it, in order. */
export function applyOps(base: Tree, ops: Op[]): Tree {
  let t = base;
  for (const o of ops) t = setIn(t, o.path, o.value);
  return t;
}

/** Does any pending op touch this top-level child (journal, pins, …)? */
export const touches = (ops: Op[], child: string) => ops.some((o) => covers(child, o.path) || covers(o.path, child));

export { getIn };

export function loadOps(storage: Pick<Storage, 'getItem'>, key: string): Op[] {
  try {
    const raw = storage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as Op[]).filter((o) => o && typeof o.path === 'string' && typeof o.id === 'string') : [];
  } catch {
    return [];
  }
}

export function saveOps(storage: Pick<Storage, 'setItem' | 'removeItem'>, key: string, ops: Op[]) {
  try {
    if (ops.length) storage.setItem(key, JSON.stringify(ops));
    else storage.removeItem(key);
  } catch { /* quota or private mode: the live session still works */ }
}
