/**
 * Boots a storefront PAGE in happy-dom the way the browser loads it: the page's own body
 * markup (site/checkout.html or site/index.html), the head's co-hold script, then the core
 * and the page modules in the entry's order (header, cart, checkout). The original suites
 * eval'd store.js + header.js + cart.js + checkout.js into a DOM stub; this is the same with
 * a real DOM and the real page markup.
 *
 * Between boots every listener the previous page's modules put on window/document is taken
 * off and their intervals cleared, so each test meets one page.
 */
import { vi } from "vitest";
import type { LmApi, Catalogue, CartLine } from "../../../src/web/core/types";
import { bootCore, catalogueFile, json, read, type Call } from "../core/_boot";

export { json, catalogueFile, read };
export type { Call };

/* ---- the previous page's listeners and timers ---- */
type Tracked = [EventTarget, string, EventListenerOrEventListenerObject, unknown];
const tracked: Tracked[] = [];
const intervals: number[] = [];
let patched = false;
function patch(): void {
  if (patched) return;
  patched = true;
  for (const t of [window, document] as EventTarget[]) {
    const add = t.addEventListener.bind(t);
    (t as { addEventListener: EventTarget["addEventListener"] }).addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null, opts?: unknown) => {
      if (fn) tracked.push([t, type, fn, opts]);
      return add(type, fn, opts as AddEventListenerOptions);
    };
  }
  /* happy-dom 21 picks the wrong option when a select's innerHTML carries a `selected`
     attribute (the option before it); a browser selects the marked one. Re-applied here. */
  const proto = window.HTMLSelectElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(window.Element.prototype, "innerHTML")!;
  Object.defineProperty(proto, "innerHTML", {
    configurable: true,
    get(this: HTMLSelectElement) {
      return desc.get!.call(this);
    },
    set(this: HTMLSelectElement, v: string) {
      desc.set!.call(this, v);
      const opts = Array.prototype.slice.call(this.options) as HTMLOptionElement[];
      let at = -1;
      opts.forEach((o, i) => {
        if (o.hasAttribute("selected")) at = i;
      });
      this.selectedIndex = at > -1 ? at : opts.length ? 0 : -1;
    },
  });
  const si = window.setInterval.bind(window);
  (window as { setInterval: unknown }).setInterval = (f: TimerHandler, ms?: number, ...a: unknown[]) => {
    const id = si(f, ms, ...a) as unknown as number;
    intervals.push(id);
    return id;
  };
}
function unload(): void {
  while (tracked.length) {
    const [t, type, fn, opts] = tracked.pop()!;
    t.removeEventListener(type, fn, opts as EventListenerOptions);
  }
  while (intervals.length) clearInterval(intervals.pop());
  for (const k of ["lmShip", "lmOnCartChange", "lmCart", "LMPX", "LMEV", "LMLanding", "LMBeacon"]) delete (window as unknown as Record<string, unknown>)[k];
}

const PAGE_HTML: Record<string, string> = {};
function pageHtml(page: "checkout" | "home"): string {
  if (!PAGE_HTML[page]) PAGE_HTML[page] = read(page === "checkout" ? "site/checkout.html" : "site/index.html");
  return PAGE_HTML[page]!;
}

export interface PageOpts {
  page?: "checkout" | "home";
  lang?: "ar" | "en";
  /** the page address, e.g. "/checkout.html?country=OM" */
  url?: string;
  cart?: Array<Partial<CartLine> & Record<string, unknown>> | null;
  catalogue?: Catalogue;
  local?: Record<string, string>;
  session?: Record<string, string>;
  /** answers the page's own requests (/api/order, /api/pay/*, "/", /api/stock); null = not handled */
  answer?: (url: string, init?: RequestInit) => Response | Promise<Response> | null;
  /** the English words (an /en/ page) */
  english?: boolean;
  /** run the head's co-hold script (the layout hold) before the modules */
  coHold?: boolean;
  /** runs once the previous page is gone, before the core boots (e.g. other modules' globals) */
  setup?: () => void;
}

export interface BootedPage {
  LM: LmApi;
  calls: Call[];
  posts: (path: string) => Array<{ url: string; body: any }>;
  $: <E extends HTMLElement = HTMLElement>(s: string) => E;
}

export const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
export async function flush(n = 6): Promise<void> {
  for (let i = 0; i < n; i++) await tick(0);
}

export async function bootPage(o: PageOpts = {}): Promise<BootedPage> {
  patch();
  unload();
  if (o.setup) o.setup();
  const page = o.page || "checkout";
  const html = pageHtml(page);
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)!;
  document.body.innerHTML = m[1]!;
  document.body.removeAttribute("style");
  const cls = /<html[^>]*class="([^"]*)"/.exec(html);
  document.documentElement.className = cls ? cls[1]! : "";
  document.documentElement.removeAttribute("style");
  const session: Record<string, string> = { ...(o.session || {}) };
  if (o.cart) session.lm_cart = JSON.stringify(o.cart);
  const cat = o.catalogue || catalogueFile();
  const answer = (url: string, init?: RequestInit): Promise<Response> => {
    if (url === "/api/settings") return Promise.resolve(json(cat));
    if (url === "/api/geo") return Promise.resolve(json({ country: "OM" }));
    const a = o.answer ? o.answer(url, init) : null;
    if (a) return Promise.resolve(a);
    if (url.indexOf("/api/stock") === 0) return Promise.resolve(json({ left: {}, hide: { items: [], sizes: [] }, cap: {} }));
    if (url === "/") return Promise.resolve(new Response("", { status: 200 }));
    return Promise.reject(new TypeError("Failed to fetch"));
  };
  const lang = o.lang || (o.english ? "en" : "ar");
  const r = await bootCore({
    lang,
    english: o.english || lang === "en",
    url: o.url || (page === "checkout" ? "/checkout.html" : "/"),
    local: o.local,
    session,
    fetch: answer,
  });
  if (o.coHold !== false && page === "checkout") {
    const hold = /<script id="co-hold">([\s\S]*?)<\/script>/.exec(html);
    if (hold) new Function(hold[1]!)();
  }
  await import("../../../src/web/header");
  await import("../../../src/web/cart");
  if (page === "checkout") await import("../../../src/web/checkout");
  await r.LM.ready;
  await flush();
  const posts = (path: string) =>
    r.calls
      .filter((c) => c.url === path && c.init && c.init.method === "POST")
      .map((c) => ({ url: c.url, body: typeof c.init!.body === "string" && c.init!.body[0] === "{" ? JSON.parse(c.init!.body) : c.init!.body }));
  const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;
  return { LM: r.LM, calls: r.calls, posts, $ };
}

/** the market row of the catalogue, to edit a fixture */
export function marketOf(c: Catalogue, code: string) {
  return c.countries.find((x) => x.code === code)!;
}

/** the text of an element with its markup taken out */
export const text = (h: string | Element | null | undefined): string =>
  String(h == null ? "" : typeof h === "string" ? h : h.innerHTML).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
/** the first number in an element's text */
export const num = (h: string | Element | null | undefined): number => parseFloat((/-?[\d.]+/.exec(text(h)) || ["NaN"])[0]!);

export const LINE = (scentId: string, sizeId: string, qty = 1, extra: Record<string, unknown> = {}) => ({ scentId, sizeId, qty, scent: scentId, size: sizeId, price: 1, ...extra });

/** stubs reload / navigation the page asks for (happy-dom would really navigate) */
export function stubNavigation(): { reloads: () => number; hrefs: string[] } {
  let reloads = 0;
  const hrefs: string[] = [];
  vi.spyOn(window.location, "reload").mockImplementation(() => void reloads++);
  vi.spyOn(window.location, "href", "set").mockImplementation((v: string) => void hrefs.push(v));
  return { reloads: () => reloads, hrefs };
}

/** fill the form the way a shopper does (input events, so the filters run) */
export function type(sel: string, value: string): void {
  const el = document.querySelector(sel) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
export function choose(sel: string, value: string): void {
  const el = document.querySelector(sel) as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
export function submit(): void {
  const f = document.querySelector("#form") as HTMLFormElement;
  f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}
export function fillValid(o: { name?: string; phone?: string; city?: string; region?: string } = {}): void {
  type("#name", o.name || "سارة الهاشمي");
  const city = document.querySelector("#city") as HTMLSelectElement | HTMLInputElement;
  if (city.tagName === "SELECT") (city as HTMLSelectElement).selectedIndex = 1;
  else city.value = o.city || "Doha";
  type("#region", o.region || "الخوير");
  type("#phone", o.phone || "91234567");
}
