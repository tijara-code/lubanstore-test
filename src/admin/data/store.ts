/**
 * A store: one value, read with `get()`, changed with `set()`, watched with `subscribe()` or,
 * in a component, `useStore(store)`. The panel's few pieces of global state (the session, the
 * panel settings, the route, the toast, the "Updated hh:mm" stamp) are each one of these.
 */
import { useEffect, useState } from "preact/hooks";

export interface Store<T> {
  get(): T;
  set(next: T | ((was: T) => T)): void;
  subscribe(fn: (v: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === "function" ? (next as (was: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      for (const fn of [...subs]) fn(v);
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** The store's value, re-rendering the component when it changes. */
export function useStore<T>(store: Store<T>): T {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  return store.get();
}
