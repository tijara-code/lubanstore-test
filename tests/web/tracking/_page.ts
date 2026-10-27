/**
 * Loads a storefront page's tracking the way the page does — the core (home / checkout) or not
 * (privacy / 404), then stats.ts, then pixel.ts — into happy-dom, with the platforms' stubs,
 * the cookie jar, the referrer, the head's lmLater and sendBeacon stood in and recorded. (The
 * original suites eval'd stats.js / pixel.js into a hand-rolled DOM; this is the same idea with
 * a real DOM and the real modules, fresh each time.)
 *
 * Listeners the previous page added are taken off first, so a "page" in a test is one page.
 */
import { vi } from "vitest";
import { bootCore, catalogueFile, json, type BootOpts } from "../core/_boot";
import type { LmApi, Catalogue } from "../../../src/web/core/types";

export interface Posted {
  url: string;
  /** the request body, parsed */
  body: { items: Array<{ kind: string; body: Record<string, any> }> } & Record<string, any>;
  via: "beacon" | "fetch";
}

export interface PageOpts extends BootOpts {
  /** load the core first (home/checkout); default true when pixel is loaded */
  core?: boolean;
  /** load pixel.ts after stats.ts (home/checkout); default true */
  pixel?: boolean;
  /** load stats.ts (the original's stats.js); default true */
  stats?: boolean;
  cookie?: string;
  referrer?: string;
  /** the head's lmLater: "queue" (default: the test runs them with `later()`), "none" (no loader on the page) */
  lmLater?: "queue" | "now" | "none";
  /** the head snippets' page-view ids */
  pageView?: string | null;
  fbPageView?: string | null;
  /** stub the platforms (default true) */
  snaptr?: boolean;
  fbq?: boolean;
  /** sendBeacon present and answering true (default), absent, or refusing */
  sendBeacon?: "ok" | "absent" | "refuse";
  dnt?: boolean;
  gpc?: boolean;
  /** body data-page attribute */
  dataPage?: string;
  leaving?: boolean;
  /** a deterministic crypto.randomUUID (uuid-1, uuid-2, …) */
  uuids?: boolean;
  /** the catalogue's analytics block */
  analytics?: { ga4?: string; mp?: boolean } | null;
  /** keep this tab's storage (the next page of the same tab) */
  sameTab?: boolean;
}

export interface Page {
  LM: LmApi | null;
  posted: Posted[];
  /** every /api/* fetch other than the settings/geo */
  fetches: Array<{ url: string; body: any }>;
  snap: Array<{ cmd: string; name: unknown; params: any }>;
  fb: Array<{ cmd: string; name: unknown; params: any; opt: any }>;
  /** run the queued lmLater callbacks (the head's loader firing) */
  later(): void;
  laterQueue: Array<() => void>;
  setCookie(c: string): void;
  /** the posts' items as "kind:name" lists */
  kinds(): Promise<string[]>;
  heads: HTMLScriptElement[];
}

type Rec = { t: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: unknown };
let added: Rec[] = [];
let cookieJar = "";

function recordListeners(): () => void {
  const targets: EventTarget[] = [window, document];
  const orig = targets.map((t) => t.addEventListener);
  targets.forEach((t, i) => {
    t.addEventListener = function (type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) {
      added.push({ t, type, fn, opts });
      return (orig[i] as any).call(t, type, fn, opts);
    } as any;
  });
  return () => targets.forEach((t, i) => { t.addEventListener = orig[i]!; });
}

export function dropListeners(): void {
  for (const r of added) r.t.removeEventListener(r.type, r.fn as any, r.opts as any);
  added = [];
}

export const realTimeout = globalThis.setTimeout.bind(globalThis);
export const tick = (ms = 0) => new Promise<void>((r) => realTimeout(r, ms));

export async function loadPage(o: PageOpts = {}): Promise<Page> {
  const W = window as any;
  /* the previous page's queue leaves with the previous page (its pagehide) */
  try { W.LMBeacon?.flush(); } catch { /* nothing */ }
  dropListeners();
  for (const k of ["LMBeacon", "LMEV", "LMPX", "LMLanding", "snaptr", "fbq", "gtag", "dataLayer", "lmLater", "__lmPageView", "__lmFbPageView", "__lmLeaving"]) delete W[k];

  const posted: Posted[] = [];
  const fetches: Page["fetches"] = [];
  const snap: Page["snap"] = [];
  const fb: Page["fb"] = [];
  const laterQueue: Array<() => void> = [];
  const heads: HTMLScriptElement[] = [];

  cookieJar = o.cookie || "";
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieJar,
    set: (v: string) => {
      const [kv] = String(v).split(";");
      const name = kv!.split("=")[0]!;
      const rest = cookieJar.split(/;\s*/).filter((c) => c && c.split("=")[0] !== name);
      cookieJar = rest.concat([kv!]).join("; ");
    },
  });
  Object.defineProperty(document, "referrer", { configurable: true, get: () => o.referrer || "" });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, get: () => (o.dnt ? "1" : null) });
  Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, get: () => (o.gpc ? true : undefined) });
  if (o.dataPage) document.body.setAttribute("data-page", o.dataPage);
  else document.body.removeAttribute("data-page");

  const beacon = o.sendBeacon || "ok";
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: beacon === "absent" ? undefined : (url: string, blob: Blob) => {
      if (beacon === "refuse") return false;
      const p: Posted = { url, body: null as any, via: "beacon" };
      posted.push(p);
      (p as any).ready = blob.text().then((t) => { p.body = JSON.parse(t); });
      return true;
    },
  });

  if (o.uuids) {
    let n = 0;
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => "uuid-" + (++n) });
  }

  if (o.snaptr !== false) W.snaptr = (cmd: string, name: unknown, params: unknown) => { snap.push({ cmd, name, params }); };
  if (o.fbq !== false) W.fbq = (cmd: string, name: unknown, params: unknown, opt: unknown) => { fb.push({ cmd, name, params, opt }); };
  if (o.lmLater !== "none") W.lmLater = o.lmLater === "now" ? (f: () => void) => f() : (f: () => void) => { laterQueue.push(f); };
  if (o.pageView !== null) W.__lmPageView = o.pageView === undefined ? "pv-snap-1" : o.pageView;
  if (o.fbPageView !== null) W.__lmFbPageView = o.fbPageView === undefined ? "pv-meta-1" : o.fbPageView;
  if (o.leaving) W.__lmLeaving = 1;

  /* storage: the core's boot clears it unless this is the same tab */
  const keepLocal: Record<string, string> = {};
  const keepSession: Record<string, string> = {};
  if (o.sameTab) {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; keepLocal[k] = localStorage.getItem(k)!; }
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i)!; keepSession[k] = sessionStorage.getItem(k)!; }
  }
  const local = { ...keepLocal, ...(o.local || {}) };
  const session = { ...keepSession, ...(o.session || {}) };

  const appendChild = document.head.appendChild.bind(document.head);
  document.head.appendChild = ((n: Node) => {
    if ((n as HTMLScriptElement).tagName === "SCRIPT") { heads.push(n as HTMLScriptElement); return n; }
    return appendChild(n);
  }) as any;

  const wantPixel = o.pixel !== false;
  const wantCore = o.core !== undefined ? o.core : wantPixel;
  const restore = recordListeners();
  let LM: LmApi | null = null;
  try {
    const cat: Catalogue | null = o.catalogue === undefined ? catalogueFile() : o.catalogue;
    if (cat && o.analytics !== undefined) (cat as any).analytics = o.analytics;
    const fetchAnswer = o.fetch || ((url: string, init?: RequestInit) => {
      if (url === "/api/settings") return Promise.resolve(cat ? json(cat) : json({}, { status: 500 }));
      if (url === "/api/geo") return Promise.resolve(json({ country: o.geo === undefined ? "OM" : o.geo }));
      fetches.push({ url, body: init && init.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    if (wantCore) {
      const r = await bootCore({ ...o, local, session, catalogue: cat, fetch: fetchAnswer });
      LM = r.LM;
    } else {
      vi.resetModules();
      history.replaceState(null, "", o.url || "/");
      localStorage.clear(); sessionStorage.clear();
      Object.entries(local).forEach(([k, v]) => localStorage.setItem(k, v));
      Object.entries(session).forEach(([k, v]) => sessionStorage.setItem(k, v));
      vi.stubGlobal("fetch", (url: string, init?: RequestInit) => fetchAnswer(String(url), init));
    }
    if (o.stats !== false) await import("../../../src/web/tracking/stats");
    if (wantPixel) await import("../../../src/web/tracking/pixel");
  } finally {
    restore();
  }

  return {
    LM, posted, fetches, snap, fb, laterQueue, heads,
    later() { laterQueue.splice(0).forEach((f) => f()); },
    setCookie(c: string) { cookieJar = c; },
    async kinds() { await bodies(this as Page); return posted.map((p) => (p.body?.items || []).map((i) => i.kind + ":" + (i.body.name || "")).join(",")); },
  };
}

/** wait for the posted bodies to be read */
export async function bodies(p: Page): Promise<Posted[]> {
  await Promise.all(p.posted.map((x) => (x as any).ready));
  return p.posted;
}

/** the items of every post, flattened */
export async function items(p: Page): Promise<Array<{ kind: string; body: Record<string, any> }>> {
  return (await bodies(p)).flatMap((x) => x.body.items);
}
