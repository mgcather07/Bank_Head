// Pure helpers for the path-addressed document tree that mirrors users/{uid}/… in the database.
import type { Json } from '../models';

export type Tree = { [k: string]: Json };

const parts = (path: string) => path.split('/').filter(Boolean);

export function getIn(tree: Tree | undefined, path: string): Json | undefined {
  let cur: Json | undefined = tree;
  for (const p of parts(path)) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) cur = (cur as Tree)[p];
    else return undefined;
  }
  return cur;
}

/** Returns a new tree with `value` at `path`; null removes the node and any parents left empty. Never mutates. */
export function setIn(tree: Tree, path: string, value: Json | null): Tree {
  const ps = parts(path);
  if (!ps.length) return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Tree) } : {};
  const [head, ...rest] = ps;
  const next: Tree = { ...tree };
  if (!rest.length) {
    if (value === null) delete next[head];
    else next[head] = value;
    return next;
  }
  const child = tree[head];
  const sub = child && typeof child === 'object' && !Array.isArray(child) ? (child as Tree) : {};
  const updated = setIn(sub, rest.join('/'), value);
  if (Object.keys(updated).length === 0) delete next[head];
  else next[head] = updated;
  return next;
}
