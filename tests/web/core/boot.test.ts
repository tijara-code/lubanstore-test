import { afterEach, describe, expect, it, vi } from "vitest";
import { bootCore, catalogueFile, json, ready, read } from "./_boot";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// from test-boot-fast.js: what leaves the browser, and when
describe("the boot's requests", () => {
  const hang = () => new Promise<Response>(() => {});

  it("a new visitor asks for the catalogue and geo at the same time, before either answers", async () => {
    const { calls } = await bootCore({ fetch: hang });
    expect(calls.map((c) => c.url).sort()).toEqual(["/api/geo", "/api/settings"]);
    // the catalogue fetch can consume the <head> preload: not no-store
    const s = calls.find((c) => c.url === "/api/settings")!;
    expect(s.init && s.init.cache).not.toBe("no-store");
    // geo stays no-store — per visitor, never cached
    expect(calls.find((c) => c.url === "/api/geo")!.init!.cache).toBe("no-store");
  });

  it("a returning visitor (saved country) is not geolocated, but gets the catalogue", async () => {
    const { calls } = await bootCore({ fetch: hang, local: { lm_cty_v2: "OM" } });
    expect(calls.some((c) => c.url === "/api/geo")).toBe(false);
    expect(calls.some((c) => c.url === "/api/settings")).toBe(true);
  });

  it("a forced ?country= skips geo too", async () => {
    const { calls } = await bootCore({ fetch: hang, url: "/?country=AE" });
    expect(calls.some((c) => c.url === "/api/geo")).toBe(false);
  });

  it("the early geo answer from the head is taken instead of asking again, and kept for the tab", async () => {
    const { LM, calls } = await ready({ earlyGeo: Promise.resolve("KW") });
    expect(calls.some((c) => c.url === "/api/geo")).toBe(false);
    expect(LM.c.code).toBe("KW");
    expect(LM.geo).toBe("KW");
    expect(sessionStorage.getItem("lm_geo")).toBe("KW");
    expect(window.__lmGeo).toBe(null);
  });

  it("a tab that already knows its geo answer does not ask", async () => {
    const { LM, calls } = await ready({ session: { lm_geo: "QA" } });
    expect(calls.some((c) => c.url === "/api/geo")).toBe(false);
    expect(LM.c.code).toBe("QA");
  });

  // from test-boot-fast.js: index.html and checkout.html preload the catalogue first
  it("the pages preload /api/settings before the stylesheet and before any script", () => {
    for (const page of ["site/index.html", "site/checkout.html"]) {
      const h = read(page);
      const pre = h.indexOf('<link rel="preload" as="fetch" href="/api/settings" crossorigin>');
      expect(pre).toBeGreaterThan(0);
      expect(pre).toBeLessThan(h.indexOf('rel="stylesheet" href="assets/css'));
      expect(pre).toBeLessThan(h.indexOf("<script"));
    }
  });
});

describe("the market", () => {
  it("?country= wins and is remembered as the shopper's choice", async () => {
    const { LM } = await ready({ url: "/?country=sa", local: { lm_cty_v2: "OM" } });
    expect(LM.c.code).toBe("SA");
    expect(localStorage.getItem("lm_cty_v2")).toBe("SA");
  });

  it("then a saved choice, then the edge's answer (never saved), then the catalogue's first", async () => {
    expect((await ready({ local: { lm_cty_v2: "BH" } })).LM.c.code).toBe("BH");
    const g = await ready({ geo: "QA" });
    expect(g.LM.c.code).toBe("QA");
    expect(localStorage.getItem("lm_cty_v2")).toBe(null);
    // an unknown geo answer and no time-zone match: the catalogue's first market
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const first = await ready({ geo: "FR" });
    if (!/^Asia\/(Dubai|Muscat|Riyadh|Qatar|Bahrain|Kuwait)$/.test(tz)) expect(first.LM.c.code).toBe(catalogueFile().countries[0]!.code);
    expect(first.LM.geo).toBe("FR");
  });

  it("setCountry switches, remembers and tells every listener (lm:country)", async () => {
    const { LM } = await ready({ geo: "OM" });
    const seen = vi.fn();
    window.addEventListener("lm:country", seen);
    LM.setCountry("AE");
    expect(LM.c.code).toBe("AE");
    expect(localStorage.getItem("lm_cty_v2")).toBe("AE");
    expect(seen).toHaveBeenCalledTimes(1);
    LM.setCountry("AE"); // the same market: nothing
    LM.setCountry("ZZ"); // unknown: nothing
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("lm:country", seen);
  });

  it("retired keys are cleared; ?reset=1 forgets the chosen country", async () => {
    await ready({ local: { lm_country: "AE", lm_settings: "{}", lm_cty_v2: "KW" } });
    expect(localStorage.getItem("lm_country")).toBe(null);
    expect(localStorage.getItem("lm_settings")).toBe(null);
    expect(localStorage.getItem("lm_cty_v2")).toBe("KW");
    const r = await ready({ url: "/?reset=1", local: { lm_cty_v2: "KW" }, geo: "OM" });
    expect(r.LM.c.code).toBe("OM");
  });
});

describe("the catalogue", () => {
  it("the live answer is used (source supabase)", async () => {
    const cat = catalogueFile();
    cat.countries[0]!.name = "LIVE";
    const { LM } = await ready({ catalogue: cat, url: "/?country=AE" });
    expect(LM.source).toBe("supabase");
    expect(LM.c.name).toBe("LIVE");
  });

  it("a failed or empty answer falls back to the bundled catalogue (data/catalogue.json)", async () => {
    const { LM } = await ready({ catalogue: null });
    expect(LM.source).toBe("settings.json");
    expect(LM.cfg).toEqual(catalogueFile());
    const e = await ready({ catalogue: { countries: [] } as never });
    expect(e.LM.source).toBe("settings.json");
  });

  // (v336) four seconds, then the file
  it("a catalogue that never answers is abandoned after 4 s (aborted) for the bundled one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    const { LM } = await bootCore({
      local: { lm_cty_v2: "OM" },
      fetch: (url, init) => {
        if (url === "/api/settings") signal = init && (init.signal as AbortSignal);
        return new Promise(() => {});
      },
    });
    let done = false;
    LM.ready.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(3900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(signal && signal.aborted).toBe(true);
    expect(LM.source).toBe("settings.json");
    expect(LM.c.code).toBe("OM");
  });

  it("the bundled copy is a copy: writing into LM.cfg does not change the next boot's", async () => {
    const a = await ready({ catalogue: null });
    a.LM.cfg.countries[0]!.name = "changed";
    const b = await ready({ catalogue: null });
    expect(b.LM.cfg.countries[0]!.name).not.toBe("changed");
  });
});

// from test-offer-clock.js / test-boot-fast.js: the server's clock
describe("the server clock", () => {
  it("the Date header sets LM.now(), whatever the device says", async () => {
    const real = Date.parse("2026-09-04T12:00:00Z");
    const { LM } = await ready({ serverDate: real });
    expect(LM.clock).toBe("server");
    expect(Math.abs(LM.now() - real)).toBeLessThan(5000);
  });

  it("Age is added to Date, so a CDN's stale copy still tells the time", async () => {
    const t = Date.parse("2026-09-04T12:00:00Z");
    const { LM } = await ready({
      fetch: (url) =>
        url === "/api/settings"
          ? Promise.resolve(json(catalogueFile(), { headers: { date: new Date(t).toUTCString(), age: "120" } }))
          : Promise.resolve(json({ country: "OM" })),
    });
    expect(Math.abs(LM.now() - (t + 120e3))).toBeLessThan(5000);
  });

  it("no Date header: the device clock", async () => {
    const { LM } = await ready({});
    expect(LM.clock).toBeUndefined();
    expect(Math.abs(LM.now() - Date.now())).toBeLessThan(50);
  });
});

describe("window.LM and the load order", () => {
  it("the core publishes window.LM synchronously with LM.ready in flight (the head's early script reads it)", async () => {
    const { LM } = await bootCore({ fetch: () => new Promise(() => {}) });
    expect(window.LM).toBe(LM);
    expect(typeof LM.ready.then).toBe("function");
  });

  it("LM.ready resolves with LM", async () => {
    const { LM } = await bootCore({});
    expect(await LM.ready).toBe(LM);
  });

  // from test-v401.js: a page script must not depend at load on a newer store.js than it got.
  // Moot now: every entry imports the core, the bundle is built in one piece, and the page
  // names its chunks by content hash — a page can never meet another build's core. What is
  // left to hold: the entries import the core first (tests/unit/build/build.test.ts holds the
  // built pages to it).
  it("every page entry that uses the core imports it first", () => {
    for (const e of ["home", "checkout"]) {
      const src = read("src/web/entries/" + e + ".ts");
      const imports = [...src.matchAll(/^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(imports[0]).toBe("../core");
    }
    // the privacy and 404 pages never loaded store.js: no catalogue, no geo there
    for (const e of ["privacy", "notfound"]) expect(read("src/web/entries/" + e + ".ts")).not.toMatch(/["']\.\.\/core(\/index)?["']/);
  });

  it("LM.debug() says what the store is using", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    const d = LM.debug();
    expect(d.active).toBe("OM عمان OMR");
    expect(d.saved).toBe("OM");
    expect(d.codes).toBe("AE,SA,QA,OM,BH,KW");
    expect(d.source).toBe("supabase");
  });
});

describe("storage switched off (blocked cookies)", () => {
  it("the basket rides in window.name; nothing else does; an old queue leaves window.name", async () => {
    const realLocal = Object.getOwnPropertyDescriptor(window, "localStorage");
    const realSession = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    const blocked = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
      clear() { throw new Error("blocked"); },
    };
    Object.defineProperty(window, "localStorage", { value: blocked, configurable: true, writable: true });
    Object.defineProperty(window, "sessionStorage", { value: blocked, configurable: true, writable: true });
    try {
      const cart = JSON.stringify([{ sizeId: "large", scentId: "oud", qty: 1 }]);
      const { LM } = await ready({ windowName: JSON.stringify({ lm_cart: cart, lm_order_queue: '[{"id":"q1"}]' }) });
      // the stand-ins answer
      expect(sessionStorage.getItem("lm_cart")).toBe(cart);
      expect(LM.readCart()).toEqual([{ sizeId: "large", scentId: "oud", qty: 1 }]);
      // the parked queue moved into the (in-memory) localStorage and out of window.name
      expect(localStorage.getItem("lm_order_queue")).toBe('[{"id":"q1"}]');
      expect(JSON.parse(window.name)).toEqual({ lm_cart: cart });
      // a basket write persists through window.name; other keys stay in memory
      sessionStorage.setItem("lm_cart", "[]");
      sessionStorage.setItem("lm_pending", "secret");
      expect(JSON.parse(window.name)).toEqual({ lm_cart: "[]" });
      sessionStorage.removeItem("lm_cart");
      expect(window.name).toBe("");
      localStorage.setItem("lm_cty_v2", "AE");
      expect(localStorage.getItem("lm_cty_v2")).toBe("AE");
      expect(window.name).toBe("");
    } finally {
      if (realLocal) Object.defineProperty(window, "localStorage", realLocal);
      else delete (window as { localStorage?: unknown }).localStorage;
      if (realSession) Object.defineProperty(window, "sessionStorage", realSession);
      else delete (window as { sessionStorage?: unknown }).sessionStorage;
      window.name = "";
    }
  });

  it("with storage working, an old queue in window.name moves into localStorage", async () => {
    await ready({ windowName: JSON.stringify({ lm_order_queue: '[{"id":"q2"}]' }) });
    expect(localStorage.getItem("lm_order_queue")).toBe('[{"id":"q2"}]');
    expect(window.name).toBe("");
  });
});
