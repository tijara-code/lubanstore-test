/**
 * Opens the PRODUCT PAGE in happy-dom the way a visit does: the real index.html body (or the
 * generated English one), a fresh core (tests/web/core/_boot.ts), then src/web/product, and
 * waits for its boot. The original suites eval'd store.js + main.js into hand-rolled DOM stubs
 * (picker, clip, v336-product …); this is the same idea with a real DOM and the real modules.
 *
 * What the stubs used to fake is set per test: matchMedia (phone / desktop / reduced motion),
 * a capturing IntersectionObserver (fire it by hand), element rectangles, the shelf
 * (/api/stock), and the other page scripts' globals (LMPX, LMEV, lmCart, lmShip) recorded.
 * Listeners the previous page added to window/document are taken off first.
 */
import { vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { bootCore, catalogueFile, json, REPO, type BootOpts } from "../core/_boot";
import type { LmApi, Catalogue, CartLine } from "../../../src/web/core/types";

export { catalogueFile, json };
export type { Catalogue, CartLine, LmApi };

/* ---- the page's markup ---- */
const bodies: Record<string, string> = {};
function bodyOf(lang: "ar" | "en"): string {
  if (bodies[lang]) return bodies[lang]!;
  let html: string;
  if (lang === "ar") html = readFileSync(path.join(REPO, "site/index.html"), "utf8");
  else {
    const f = path.join(REPO, "site/en/index.html");
    html = existsSync(f) ? readFileSync(f, "utf8") : "";
    if (!html) throw new Error("site/en/index.html missing: run npm run make-en");
  }
  const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)!;
  /* scripts never run from innerHTML; drop them so nothing inline is half-parsed */
  return (bodies[lang] = m[1]!.replace(/<script\b[\s\S]*?<\/script>/g, ""));
}

/* ---- a capturing IntersectionObserver ---- */
export class FakeIO {
  static all: FakeIO[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(
    public cb: (e: Array<Partial<IntersectionObserverEntry>>, o: FakeIO) => void,
    public opts: IntersectionObserverInit = {},
  ) {
    FakeIO.all.push(this);
  }
  observe(t: Element) {
    this.targets.push(t);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** fire for one target (default the first) */
  fire(isIntersecting: boolean, target?: Element, top = 0) {
    const t = target || this.targets[0]!;
    this.cb([{ isIntersecting, target: t, boundingClientRect: { top } as DOMRectReadOnly }], this);
  }
}
/** the observers watching an element, optionally with a given option */
export function observersOf(el: Element | null, pred: (o: FakeIO) => boolean = () => true): FakeIO[] {
  return FakeIO.all.filter((o) => el && o.targets.indexOf(el) > -1 && pred(o));
}

/* ---- listeners the previous page added ---- */
type Rec = { t: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: unknown };
let added: Rec[] = [];
let wrapped = false;
function recordListeners(): void {
  if (wrapped) return;
  wrapped = true;
  [window, document].forEach((t) => {
    const orig = t.addEventListener;
    t.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) {
      added.push({ t, type, fn, opts });
      return (orig as (...a: unknown[]) => void).call(t, type, fn, opts);
    } as typeof t.addEventListener;
  });
}
function dropListeners(): void {
  for (const r of added) r.t.removeEventListener(r.type, r.fn as EventListener, r.opts as boolean);
  added = [];
}

export interface Media {
  phone?: boolean;
  /** min-width: 768px */
  wide?: boolean;
  reduce?: boolean;
}

export interface PageOpts extends BootOpts {
  media?: Media;
  /** change the core before the page module runs (as the suites did between store.js and main.js) */
  setup?: (LM: LmApi) => void;
  /** /api/stock's answer (the shelf); default: offline */
  stock?: Record<string, unknown> | null;
  /** the basket before the visit */
  cart?: CartLine[];
  /** the IntersectionObserver: the capturing fake (default), or none at all */
  io?: "fake" | "none";
  /** keep happy-dom's element rectangles (default: every element 34×34 at 20,300) */
  realRects?: boolean;
  /** extra fetch answers (path → Response) */
  answer?: (url: string, init?: RequestInit) => Promise<Response> | null;
}

export interface Page {
  LM: LmApi;
  /** every call the other page scripts' globals received */
  px: Array<[string, ...unknown[]]>;
  ev: Array<[string, ...unknown[]]>;
  ship: number[];
  cartRefresh: number;
  calls: Array<{ url: string; init?: RequestInit }>;
  media: Media;
  basket(): CartLine[];
  $<T extends Element = HTMLElement>(s: string): T | null;
  $$<T extends Element = HTMLElement>(s: string): T[];
}

export const realTimeout = globalThis.setTimeout.bind(globalThis);
export const tick = (ms = 0) => new Promise<void>((r) => realTimeout(r, ms));

export async function openPage(o: PageOpts = {}): Promise<Page> {
  recordListeners();
  dropListeners();
  const W = window as unknown as Record<string, unknown>;
  for (const k of ["LMPX", "LMEV", "lmCart", "lmShip"]) delete W[k];

  const lang = o.lang || "ar";
  document.documentElement.setAttribute("dir", lang === "en" ? "ltr" : "rtl");
  document.body.innerHTML = bodyOf(lang);

  const media: Media = Object.assign({ phone: false, wide: false, reduce: false }, o.media || {});
  vi.stubGlobal("matchMedia", (q: string) => {
    const matches = /reduce/.test(q) ? !!media.reduce : /max-width:\s*767px/.test(q) ? !!media.phone : /min-width:\s*768px/.test(q) ? !!media.wide : false;
    return { matches, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  });
  FakeIO.all = [];
  if (o.io === "none") vi.stubGlobal("IntersectionObserver", undefined), delete W.IntersectionObserver;
  else vi.stubGlobal("IntersectionObserver", FakeIO);
  if (!o.realRects) {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ left: 20, top: 300, width: 34, height: 34, right: 54, bottom: 334, x: 20, y: 300, toJSON() {} }) as DOMRect,
    );
  }

  const page: Page = {
    LM: null as unknown as LmApi,
    px: [],
    ev: [],
    ship: [],
    cartRefresh: 0,
    calls: [],
    media,
    basket: () => {
      try {
        return JSON.parse(sessionStorage.getItem("lm_cart") || "[]");
      } catch {
        return [];
      }
    },
    $: (s) => document.querySelector(s),
    $$: (s) => Array.from(document.querySelectorAll(s)),
  };
  W.LMPX = {
    addCart: (l: unknown) => page.px.push(["addCart", l]),
    viewContent: (a: unknown, b: unknown) => page.px.push(["viewContent", a, b]),
  };
  W.LMEV = { track: (n: string, i?: string) => page.ev.push(i === undefined ? [n] : [n, i]) };
  W.lmCart = { refresh: () => page.cartRefresh++ };
  W.lmShip = (n: number) => page.ship.push(n);

  const cat = o.catalogue === undefined ? catalogueFile() : o.catalogue;
  const session = Object.assign({}, o.session || {});
  if (o.cart) session.lm_cart = JSON.stringify(o.cart);
  const { LM, calls } = await bootCore({
    ...o,
    session,
    catalogue: cat,
    url: o.url || "/?country=OM",
    fetch:
      o.fetch ||
      ((url: string, init?: RequestInit) => {
        const extra = o.answer && o.answer(url, init);
        if (extra) return extra;
        if (url === "/api/settings") return Promise.resolve(cat ? json(cat) : json({ error: "x" }, { status: 500 }));
        if (url === "/api/geo") return Promise.resolve(json({ country: o.geo === undefined ? "OM" : o.geo }));
        if (url.indexOf("/api/stock") === 0 && o.stock) return Promise.resolve(json(o.stock));
        return Promise.reject(new Error("offline"));
      }),
  });
  page.LM = LM;
  page.calls = calls;
  await LM.ready;
  if (o.setup) o.setup(LM);
  const mod = await import("../../../src/web/product");
  await mod.pageReady;
  return page;
}

/** the product module's own state (for checks the suites made on main.js's closure) */
export async function productState() {
  return import("../../../src/web/product/state");
}

/** a click that bubbles, as a finger's does */
export function tap(el: Element | null): void {
  if (!el) throw new Error("nothing to tap");
  (el as HTMLElement).click();
}
/** the stepper of a scent row ("+" or "−") */
export function step(row: Element | null, by: 1 | -1): void {
  tap(row!.querySelector('[data-step="' + by + '"]'));
}
export function key(el: Element, k: string): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
}

/** a catalogue to change (a deep copy of data/catalogue.json) */
export function cat(): Catalogue {
  return JSON.parse(JSON.stringify(catalogueFile()));
}
/** a market of a catalogue */
export function marketOf(c: Catalogue, code: string) {
  return c.countries.find((x) => x.code === code)!;
}
