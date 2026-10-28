/**
 * THE ROUTE — the tab and its parameters live in the address's hash, so a reload, a bookmark
 * or a link from another tab opens the same view:
 *
 *   #orders                         a tab
 *   #orders?q=LM-123&status=new     a tab with its filters (each tab names its own params)
 *
 * navigate(tab, params?)  goes there (a history entry); setParams(p) changes the current tab's
 * params in place (replaceState: filters do not fill the back button). useRoute() re-renders
 * on a change. A tab that does not exist, or is hidden in Settings, falls back to Overview —
 * the Shell decides that, not this file.
 */
import { createStore, useStore } from "../data/store";

export interface Route {
  tab: string;
  params: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const h = String(hash || "").replace(/^#/, "");
  const q = h.indexOf("?");
  const tab = (q < 0 ? h : h.slice(0, q)).trim() || "overview";
  const params: Record<string, string> = {};
  if (q >= 0) new URLSearchParams(h.slice(q + 1)).forEach((v, k) => (params[k] = v));
  return { tab, params };
}

export function hashOf(tab: string, params: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, v);
  const s = p.toString();
  return "#" + tab + (s ? "?" + s : "");
}

export const route = createStore<Route>(parseHash(typeof location !== "undefined" ? location.hash : ""));

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const next = parseHash(location.hash);
    const was = route.get();
    if (hashOf(next.tab, next.params) !== hashOf(was.tab, was.params)) route.set(next);
  });
}

export function navigate(tab: string, params: Record<string, string | undefined> = {}, opts: { replace?: boolean } = {}): void {
  const h = hashOf(tab, params);
  if (opts.replace) history.replaceState(null, "", h);
  else if (location.hash !== h) history.pushState(null, "", h);
  route.set(parseHash(h));
}

/** Change the current tab's params without a history entry (filters, paging). */
export function setParams(params: Record<string, string | undefined>, merge = true): void {
  const r = route.get();
  const next = merge ? { ...r.params, ...params } : params;
  navigate(r.tab, next as Record<string, string | undefined>, { replace: true });
}

export const useRoute = () => useStore(route);
