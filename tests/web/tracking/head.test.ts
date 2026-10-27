/**
 * The inline head scripts the pixels rely on (verbatim from the original pages): the Snap and
 * Meta snippets (init objects, advanced matching, the visitor id, the page-view ids, the click
 * ids), the `early` script's lmLater, the leaving mark. Run as the browser runs them, from the
 * site's own pages (Arabic sources and the generated English ones).
 */
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { build } from "../../../scripts/make-en";
import { fill, placeholders } from "../../../scripts/site-meta";

const REPO = path.resolve(__dirname, "../../..");
/* a page as built: the English ones generated from the Arabic sources, the ids filled in */
const read = (f: string) => fill(f.startsWith("en/") ? build(f.slice(3)).html : readFileSync(path.join(REPO, "site", f), "utf8"),
  placeholders({ META_PIXEL_ID: "", SNAP_PIXEL_ID: "" }));
const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const PAGES = ["index.html", "checkout.html", "en/index.html", "en/checkout.html"];

function blocks(html: string): string[] {
  return [...html.matchAll(/<script(?: id="[\w-]+"| type='text\/javascript')?>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

function snippets(page: string) {
  const b = blocks(read(page));
  return { snap: b.find((x) => x.includes("snaptr('init'"))!, meta: b.find((x) => x.includes("fbq('init'"))!, early: b.find((x) => x.includes("window.lmLater = function"))! };
}

function runSnippets(page: string, store: Record<string, string>, search: string) {
  const { snap, meta } = snippets(page);
  const calls: unknown[][] = [];
  const st = { getItem: (k: string) => (k in store ? store[k]! : null), setItem: (k: string, v: string) => { store[k] = String(v); } };
  const box: Record<string, any> = {
    localStorage: st, sessionStorage: st, location: { search }, URLSearchParams, crypto: webcrypto, Date, Math,
    snaptr: (...a: unknown[]) => calls.push(["snaptr", ...a]),
    fbq: (...a: unknown[]) => calls.push(["fbq", ...a]),
  };
  box.fbq.loaded = true;
  box.window = box;
  box.document = {};
  vm.createContext(box);
  vm.runInContext(snap, box);
  vm.runInContext(meta, box);
  return { calls, box };
}

// from test-pixel-parity.js 9c: the inline snippets, all four pages
describe("the Snap and Meta snippets", () => {
  for (const page of PAGES) {
    it(page + ": init objects, the kept hashes, the market, the click ids", () => {
      const PH = sha("971501234567");
      const store: Record<string, string> = { lm_ph_v2: PH, lm_am_v1: JSON.stringify({ fn: "a".repeat(64), ct: "b".repeat(64), em: "nope" }), lm_cty_v2: "AE" };
      const { calls, box } = runSnippets(page, store, "?fbclid=IwAR" + "x".repeat(260) + "&ScCid=sc-1");
      const snapInit = calls.find((c) => c[0] === "snaptr" && c[1] === "init")!;
      const metaInit = calls.find((c) => c[0] === "fbq" && c[1] === "init")!;
      expect(snapInit[2]).toMatch(/^[0-9a-f-]{36}$/);
      expect(snapInit[3]).toEqual({ user_hashed_phone_number: PH });
      expect(metaInit[2]).toMatch(/^\d{15,16}$/);
      expect(metaInit[3]).toEqual({ ph: PH, external_id: PH, fn: "a".repeat(64), ct: "b".repeat(64), country: "ae" });
      expect(/lm_snap_ph/.test(read(page))).toBe(false);
      expect(store.lm_fbclid!.split("|")[0]!.length).toBe(264);
      expect(store.lm_sccid).toBe("sc-1");
      // the page views: one id each, left for pixel.ts to relay
      const spv = calls.find((c) => c[0] === "snaptr" && c[1] === "track")!;
      const fpv = calls.find((c) => c[0] === "fbq" && c[1] === "track")!;
      expect(spv).toEqual(["snaptr", "track", "PAGE_VIEW", { client_dedup_id: box.__lmPageView }]);
      expect(fpv).toEqual(["fbq", "track", "PageView", {}, { eventID: box.__lmFbPageView }]);
      expect(box.__lmPageView).not.toBe(box.__lmFbPageView);
    });

    // from test-v315.js: the pixel's init carries the visitor id when no phone is known
    it(page + ": a first visit gets a 64-hex visitor id, made once and kept; the market from the address", () => {
      const store: Record<string, string> = {};
      const a = runSnippets(page, store, "?country=sa");
      const init1 = a.calls.find((c) => c[0] === "fbq" && c[1] === "init")![3] as Record<string, string>;
      expect(init1.external_id).toMatch(/^[a-f0-9]{64}$/);
      expect(store.lm_vid).toBe(init1.external_id);
      expect(init1.country).toBe("sa");
      expect(a.calls.find((c) => c[0] === "snaptr" && c[1] === "init")![3]).toEqual({});
      const b = runSnippets(page, store, "");
      expect((b.calls.find((c) => c[0] === "fbq" && c[1] === "init")![3] as Record<string, string>).external_id).toBe(init1.external_id);
    });
  }

  it("one pixel id per platform on every page, and in the noscript beacons", () => {
    const ids = new Set<string>();
    for (const page of PAGES) {
      const h = read(page);
      for (const m of h.matchAll(/(?:fbq\('init', PIXEL_ID|var PIXEL_ID = '([^']+)')/g)) if (m[1]) ids.add(m[1]);
      for (const m of h.matchAll(/facebook\.com\/tr\?id=([^&]+)&/g)) ids.add(m[1]!);
    }
    expect([...ids]).toEqual(["1045103308296251"]);   // filled at build from META_PIXEL_ID, the relay's own variable
  });
});

// from test-v204.js: the pixels load through lmLater
describe("the early script's lmLater", () => {
  function make(page: string) {
    const src = snippets(page).early;
    const h: Record<string, () => void> = {};
    const timers: Array<{ f: () => void; ms: number }> = [];
    const w: Record<string, any> = {
      document: { readyState: "loading", documentElement: { lang: "ar" }, addEventListener: (t: string, f: () => void) => { h[t] = f; } },
      location: { search: "?country=AE", pathname: "/" },
      localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
      setTimeout: (f: () => void, ms: number) => { timers.push({ f, ms }); return 1; },
      requestIdleCallback: (f: () => void) => { w.__idle = f; },
      addEventListener: (t: string, f: () => void) => { h["win:" + t] = f; },
    };
    new Function("window", "document", "location", "localStorage", "sessionStorage", "setTimeout", "requestIdleCallback", "addEventListener", src)(
      w, w.document, w.location, w.localStorage, w.sessionStorage, w.setTimeout, w.requestIdleCallback, w.addEventListener);
    return { w, h, timers };
  }
  for (const page of ["index.html", "checkout.html"]) {
    it(page + ": after the store has drawn and the page is quiet; a tap at once; never later than 3.5 s; not on a leaving page", async () => {
      let e = make(page), loaded = 0;
      e.w.lmLater(() => loaded++);
      expect(loaded).toBe(0);
      let ready!: () => void;
      e.w.LM = { ready: new Promise<void>((r) => { ready = r; }) };
      e.h.DOMContentLoaded!();
      expect(loaded).toBe(0);
      ready();
      await new Promise((r) => setTimeout(r, 5));
      expect(loaded).toBe(0);
      e.w.__idle();
      expect(loaded).toBe(1);
      e.w.lmLater(() => loaded++);
      expect(loaded).toBe(2);
      e = make(page); loaded = 0; e.w.lmLater(() => loaded++);
      e.h["win:pointerdown"]!();
      expect(loaded).toBe(1);
      e = make(page); loaded = 0; e.w.lmLater(() => loaded++); e.w.LM = { ready: new Promise(() => {}) };
      e.h.DOMContentLoaded!();
      const cap = e.timers.find((t) => t.ms === 3500)!;
      cap.f();
      expect(loaded).toBe(1);
      e = make(page); loaded = 0; e.w.lmLater(() => loaded++); e.w.__lmLeaving = 1;
      e.h["win:pointerdown"]!();
      expect(loaded).toBe(0);
    });
  }

  it("the Snap and Meta loaders wait for lmLater", () => {
    for (const page of PAGES) {
      const h = read(page);
      expect(/a\.queue=\[\];lmLater\(function\(\)\{var r=t\.createElement\('script'\)/.test(h)).toBe(true);
      expect(/n\.queue=\[\];lmLater\(function\(\)\{t=b\.createElement\(e\)/.test(h)).toBe(true);
      expect(h.indexOf("window.lmLater = function")).toBeLessThan(h.indexOf("lmLater(function(){var r="));
    }
  });
});

// from test-v209.js: a page on its way to /en/ is marked as leaving before it moves
describe("the leaving mark", () => {
  for (const page of ["index.html", "checkout.html", "privacy.html"]) {
    it(page, () => {
      const src = blocks(read(page)).find((b) => b.includes("lm_lang"))!;
      const w: Record<string, any> = {};
      let replaced = "";
      const ls = { getItem: (k: string) => (k === "lm_lang" ? "en" : null), setItem() {} };
      new Function("window", "location", "localStorage", "history", src)(w, { search: "?utm_source=x", hash: "", pathname: "/" + page.replace("index.html", ""), replace: (u: string) => { replaced = u; expect(w.__lmLeaving).toBe(1); } }, ls, {});
      expect(w.__lmLeaving).toBe(1);
      expect(replaced).toBe("/en/" + (page === "index.html" ? "" : page) + "?utm_source=x");
    });
  }
});
