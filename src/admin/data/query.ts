/**
 * THE QUERY CACHE — every read the panel makes goes through here, so a refresh, an
 * invalidation after a write, or the five-minute timer reaches every screen the same way.
 *
 *   useQuery(key, fetcher, opts)   → { data, error, loading, refetch }
 *       key       a string naming the read ("orders?status=new&offset=0", "overview",
 *                 "order:LM-1234"); null = do not read yet
 *       fetcher   ({ prev, reason, signal }) => Promise<T>; `reason` is "load" (first read),
 *                 "refresh" (the Refresh button, an invalidation) or "auto" (the timer) — the
 *                 Orders list sends its `since` tag only on "auto"; `prev` is what the key held
 *       opts.keep keep showing the previous key's data while the new key loads (paging,
 *                 filters), so a list never flashes empty
 *
 *   invalidate(match)    marks matching entries stale; the ones on screen re-read now
 *   refreshActive(r)     re-reads every entry on screen (the Refresh button, the timer)
 *   setQueryData(k, f)   writes an answer in place (an optimistic flag, a known result)
 *   clearQueries()       forgets everything (sign out)
 *   lastSync             a store: when a read last came back (the "Updated hh:mm" stamp)
 *
 * Two screens asking the same key share one request; an entry nobody shows is kept (marked
 * stale after an invalidation) and read again when it is shown.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createStore } from "./store";

export type FetchReason = "load" | "refresh" | "auto";
export type Fetcher<T> = (ctx: { prev: T | undefined; reason: FetchReason }) => Promise<T>;

interface Entry {
  data?: unknown;
  error?: unknown;
  loading: boolean;
  stale: boolean;
  fetcher?: Fetcher<unknown>;
  inflight?: Promise<unknown>;
  subs: Set<() => void>;
}

const cache = new Map<string, Entry>();

export const lastSync = createStore<number>(0);

function entryOf(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { loading: false, stale: true, subs: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e: Entry) {
  for (const fn of [...e.subs]) fn();
}

/** Read a key now (sharing a read already on its way). Never rejects: the error is kept on the entry. */
export function fetchQuery<T>(key: string, fetcher: Fetcher<T>, reason: FetchReason = "load"): Promise<T | undefined> {
  const e = entryOf(key);
  e.fetcher = fetcher as Fetcher<unknown>;
  if (e.inflight) return e.inflight as Promise<T | undefined>;
  e.loading = true;
  notify(e);
  const p = fetcher({ prev: e.data as T | undefined, reason })
    .then(
      (data) => {
        e.data = data;
        e.error = undefined;
        e.stale = false;
        lastSync.set(Date.now());
        return data;
      },
      (err) => {
        e.error = err;
        return undefined;
      },
    )
    .finally(() => {
      e.loading = false;
      e.inflight = undefined;
      notify(e);
    });
  e.inflight = p;
  return p;
}

export function useQuery<T>(key: string | null, fetcher: Fetcher<T>, opts: { keep?: boolean } = {}) {
  const [, force] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const shown = useRef<T | undefined>(undefined);
  const stable = useCallback<Fetcher<T>>((ctx) => fetcherRef.current(ctx), []);

  useEffect(() => {
    if (!key) return;
    const e = entryOf(key);
    const sub = () => force((n) => n + 1);
    e.subs.add(sub);
    e.fetcher = stable as Fetcher<unknown>;
    if (e.stale && !e.inflight) void fetchQuery(key, stable, e.data === undefined ? "load" : "refresh");
    return () => {
      e.subs.delete(sub);
    };
  }, [key, stable]);

  const e = key ? cache.get(key) : undefined;
  let data = e?.data as T | undefined;
  if (data !== undefined) shown.current = data;
  else if (opts.keep) data = shown.current;
  const refetch = useCallback((reason: FetchReason = "refresh") => (key ? fetchQuery(key, stable, reason) : Promise.resolve(undefined)), [key, stable]);
  return {
    data,
    error: e?.error as unknown,
    loading: !!e?.loading || (!!key && !e),
    /** the data shown belongs to another key (opts.keep) */
    previous: !!key && e?.data === undefined && data !== undefined,
    refetch,
  };
}

function matcher(match: string | RegExp | ((key: string) => boolean)): (key: string) => boolean {
  if (typeof match === "function") return match;
  if (match instanceof RegExp) return (k) => match.test(k);
  return (k) => k === match || k.startsWith(match);
}

/** Mark matching entries stale and re-read the ones on screen. */
export function invalidate(match: string | RegExp | ((key: string) => boolean), reason: FetchReason = "refresh"): Promise<void> {
  const test = matcher(match);
  const work: Promise<unknown>[] = [];
  for (const [key, e] of cache) {
    if (!test(key)) continue;
    e.stale = true;
    if (e.subs.size && e.fetcher) {
      // a write lands while a read is on its way: read again after it
      const go = () => fetchQuery(key, e.fetcher!, reason);
      work.push(e.inflight ? e.inflight.then(go) : go());
    }
  }
  return Promise.all(work).then(() => undefined);
}

/** Re-read everything on screen (the Refresh button; the timer with "auto"). */
export function refreshActive(reason: FetchReason = "refresh"): Promise<void> {
  return invalidate(() => true, reason);
}

/** The first error any matching entry on screen holds after a refresh (for the Refresh toast). */
export function errorsOnScreen(): unknown[] {
  const out: unknown[] = [];
  for (const e of cache.values()) if (e.subs.size && e.error) out.push(e.error);
  return out;
}

export function setQueryData<T>(key: string, f: (was: T | undefined) => T | undefined): void {
  const e = cache.get(key);
  if (!e) return;
  e.data = f(e.data as T | undefined);
  notify(e);
}

/** Every cached key matching (for optimistic updates across pages of a list). */
export function keysMatching(match: string | RegExp | ((key: string) => boolean)): string[] {
  const test = matcher(match);
  return [...cache.keys()].filter(test);
}

export function clearQueries(): void {
  cache.clear();
  lastSync.set(0);
}
