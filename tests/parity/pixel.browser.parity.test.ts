/**
 * TRACKING PARITY, IN A REAL BROWSER: the ORIGINAL store (its _site + real handlers, through
 * tests/parity/checkout-ref-server.cjs over /home/claude/tools/ref-server.js) and this one (built
 * into dist-pixel, served by src/server/node.ts in fake mode, in-process) are driven through the
 * SAME journeys, and after every step what the page measured is compared, call for call:
 *
 *   - every request to /api/beacon (each item: kind + body), /api/ev, /api/snap, /api/meta, /api/log;
 *   - every snaptr / fbq / gtag call (the globals are stubbed before load; the libraries are blocked);
 *   - for the order: the `snap` (LMPX.signals) and `ref` (LMPX.landing) the checkout posts;
 *   - storage the tracking keeps (lm_sid, lm_land, lm_touch, lm_ph_v2, lm_ph_typed, lm_am_v1, lm_vid,
 *     lm_fbclid, lm_sccid, lm_fb_off, lm_touch_kept).
 *
 * Also, per step, (a) a normalised serialisation of the body and (b) a viewport screenshot, pixel
 * diffed in a canvas — recorded in the report; asserted only on the pages this area alone runs
 * (privacy, 404), since the drawn parts of the product page and the checkout belong to their ports.
 *
 * Frozen clock (Date fixed, timers running), the same Math.random / crypto.randomUUID /
 * getRandomValues seeds, every host but localhost (and Google's font hosts, for the original's
 * fonts) blocked, the same edge country (OM). Ids that are random per run (uuids, the tab's sid,
 * order numbers) are compared by position: the n-th distinct id on one side must be the n-th on
 * the other, so "the pixel and the relay share one id" is compared too.
 *
 * Report: .tmp/parity-pixel/report.json. Skipped when the original, the reference server or the
 * browsers are absent. PIXEL_REF / PIXEL_NEW (base URLs) reuse servers already running (they must
 * have GA4_MEASUREMENT_ID=G-ABC123XYZ9 and a GA4 secret, as below).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";

const REPO = path.resolve(__dirname, "../..");
const REF_DIR = process.env.LUBAN_REF || "/home/claude/ref/luban-musk";
const REF_SERVER = process.env.REF_SERVER || "/home/claude/tools/ref-server.js";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
const BROWSERS = !!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH);
const READY = existsSync(path.join(REF_DIR, "_site/index.html")) && existsSync(REF_SERVER) && BROWSERS;

const REF_PORT = 4103;
const NEW_PORT = 8893;
const OUT = path.join(REPO, ".tmp/parity-pixel");
const FROZEN = Date.parse("2026-10-01T09:00:00+04:00");
const GA4 = { GA4_MEASUREMENT_ID: "G-ABC123XYZ9", GA4_API_SECRET: "parity-ga4-secret" };

type SideName = "ref" | "new";
interface Rec {
  t: string;
  a: unknown;
}
interface StepResult {
  journey: string;
  step: string;
  equal: boolean;
  records: number;
  domEqual: boolean;
  pixels: number;
  diff?: { ref: unknown; new: unknown };
  /** what both sides recorded (when equal) */
  recorded?: unknown[];
}
const results: StepResult[] = [];

let browser: Browser;
let tool: Page;
let refProc: ChildProcess | null = null;
let newServer: { close(): void } | null = null;
let newDeps: any = null;
const base: Record<SideName, string> = { ref: "", new: "" };

async function waitUp(url: string, ms = 90000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not come up: " + url);
}

async function reset(side: SideName): Promise<void> {
  if (side === "ref") { await fetch(base.ref + "/__ref/reset", { method: "POST" }).catch(() => {}); return; }
  if (!newDeps) return;
  const { orders, rateLimits } = await import("../../src/server/db/schema");
  await newDeps.db.delete(orders);
  await newDeps.db.delete(rateLimits);
}

/* ---------------- one browser tab, recording ---------------- */

interface TabOpts {
  width: number;
  lang: "ar" | "en";
  /** stub fbq (default) or let the head's loader fetch a fake library that sets _fbp */
  fakeMetaLibrary?: boolean;
  local?: Record<string, string>;
  /** stub the platforms' globals (default true) */
  stubs?: boolean;
}

interface Tab {
  ctx: BrowserContext;
  page: Page;
  recs: Rec[];
  errors: string[];
}

/* runs in the page before anything else: seeds, and the platforms' stand-ins */
const INIT = ({ stubs, fakeMeta, local }: { stubs: boolean; fakeMeta: boolean; local: Record<string, string> | null }) => {
  let s = 42;
  Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  let r = 7;
  const next = () => ((r = (r * 48271) % 2147483647) & 255);
  try {
    crypto.getRandomValues = function <T extends ArrayBufferView | null>(a: T): T {
      const u = new Uint8Array((a as unknown as ArrayBufferView).buffer, (a as unknown as ArrayBufferView).byteOffset, (a as unknown as ArrayBufferView).byteLength);
      for (let i = 0; i < u.length; i++) u[i] = next();
      return a;
    };
    let n = 0;
    (crypto as any).randomUUID = () => {
      n++;
      const h = (n.toString(16) + "0".repeat(12)).slice(0, 12);
      return "00000000-0000-4000-8000-" + h;
    };
  } catch { /* nothing */ }
  try {
    if (local) for (const k of Object.keys(local)) if (localStorage.getItem(k) == null) localStorage.setItem(k, local[k]!);
  } catch { /* nothing */ }
  const w = window as any;
  const rec = (t: string, a: unknown[]) => {
    try { w.__rec({ t, a: JSON.parse(JSON.stringify(a, (_k, v) => (v instanceof Date ? "<date>" : v))) }); } catch { /* nothing */ }
  };
  if (stubs) {
    w.snaptr = function () { rec("snaptr", [].slice.call(arguments)); };
    if (!fakeMeta) w.fbq = function () { rec("fbq", [].slice.call(arguments)); };
    w.gtag = function () { rec("gtag", [].slice.call(arguments)); };
  }
  w.__recErr = (m: string) => rec("pageerror", [m]);
};

/* a stand-in for connect.facebook.net's library: takes the queue, and sets _fbp a moment later */
const FAKE_FBEVENTS = `(function () {
  var f = window.fbq; var q = (f && f.queue) || [];
  window.fbq.callMethod = function () { window.__rec({ t: "fbq", a: JSON.parse(JSON.stringify([].slice.call(arguments))) }); };
  for (var i = 0; i < q.length; i++) window.fbq.callMethod.apply(null, q[i]);
  setTimeout(function () { document.cookie = "_fbp=fb.1.1790000000000.4242; path=/"; }, 300);
})();`;

async function openTab(o: TabOpts): Promise<Tab> {
  const ctx = await browser.newContext({
    viewport: { width: o.width, height: o.width < 500 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: o.lang === "en" ? "en" : "ar",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "x-country": "OM" },
  });
  const recs: Rec[] = [];
  const errors: string[] = [];
  await ctx.exposeBinding("__rec", (_src, x: Rec) => { recs.push(x); });
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$|^fonts\.(googleapis|gstatic)\.com$/.test(u.host)) return r.continue();
    if (o.fakeMetaLibrary && u.host === "connect.facebook.net") return r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_FBEVENTS });
    return r.abort();
  });
  await ctx.addInitScript(INIT, { stubs: o.stubs !== false, fakeMeta: !!o.fakeMetaLibrary, local: o.local || null });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FROZEN);
  page.on("pageerror", (e) => errors.push(String(e)));
  ctx.on("request", (req) => {
    const u = new URL(req.url());
    if (!/^\/api\/(beacon|ev|snap|meta|log|order)$/.test(u.pathname)) return;
    let body: unknown = null;
    try { body = JSON.parse(req.postData() || "null"); } catch { body = req.postData(); }
    if (u.pathname === "/api/beacon") for (const it of ((body as any)?.items || [])) recs.push({ t: "beacon:" + it.kind, a: it.body });
    else if (u.pathname === "/api/order") {
      const ord = (body as any)?.order || {};
      recs.push({ t: "order", a: { snap: ord.snap, ref: ord.ref } });
    } else recs.push({ t: u.pathname, a: body });
  });
  return { ctx, page, recs, errors };
}

async function settle(page: Page, ms = 700): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
}

const STORE_KEYS = ["lm_sid", "lm_land", "lm_touch_kept", "lm_ph_typed", "lm_fbclid", "lm_sccid", "lm_fb_off", "lm_touch", "lm_ph_v2", "lm_am_v1", "lm_vid", "lm_snap_ph"];
async function storage(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((keys) => {
    const out: Record<string, string | null> = {};
    for (const k of keys) {
      let v: string | null = null;
      try { v = sessionStorage.getItem(k); if (v == null) v = localStorage.getItem(k); } catch { /* nothing */ }
      out[k] = v;
    }
    return out;
  }, STORE_KEYS);
}

/* ---------------- normalising one side's records ---------------- */

/* THE ORIGINAL'S RACE on the page-view relays' market: pixel.js read LM.c when it ran, and as a
   separate deferred script it sometimes ran after the preloaded /api/settings had answered (cc
   set) and sometimes before (cc absent — the server then takes the edge's country). One bundle
   evaluates before any answer can arrive, so the new page's relays carry the address's / kept
   country only, as the original's did whenever it lost the race. Compared without that field. */
function dropPageViewCc(recs: Rec[]): Rec[] {
  return recs.map((r) => {
    const a = r.a as Record<string, unknown> | null;
    if (/^beacon:(snap|meta)$/.test(r.t) && a && (a.name === "PAGE_VIEW" || a.name === "PageView")) {
      const { cc: _cc, ...rest } = a;
      return { t: r.t, a: rest };
    }
    return r;
  });
}

function normalise(side: SideName, recs: Rec[]): unknown[] {
  recs = dropPageViewCc(recs);
  /* an error's stack names each side's own file and line: compared as present or not */
  recs = recs.map((r) => (r.t === "beacon:log" && r.a && typeof (r.a as any).detail === "string"
    ? { t: r.t, a: { ...(r.a as object), detail: (r.a as any).detail ? "<stack>" : "" } } : r));
  const tokens = new Map<string, string>();
  const tok = (kind: string, v: string) => {
    if (!tokens.has(v)) tokens.set(v, kind + (tokens.size + 1));
    return tokens.get(v)!;
  };
  let s = JSON.stringify(recs);
  s = s.split(base[side]).join("ORIGIN").split(encodeURIComponent(base[side])).join("ORIGIN");
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => tok("U", m));
  s = s.replace(/LM-\d{4,12}/g, (m) => tok("O", m));
  s = s.replace(/"sid":"([a-z0-9]{4,32})"/g, (_m, v) => '"sid":"' + tok("S", v) + '"');
  return JSON.parse(s);
}

/* ---------------- DOM + screenshot ---------------- */

const SERIALISE = `(function () {
  var c = document.body.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll("script, noscript, iframe, link, style"), function (x) { x.remove(); });
  return c.outerHTML;
})()`;
const normDom = (s: string) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\?v=[\w.-]+/g, "?v=V").replace(/\/assets\/v\/\d+\//g, "/assets/")
  .replace(/\/assets\/([\w.-]+?)-[\w-]{8}\.(js|css)/g, "/assets/$1.$2").replace(/\s+/g, " ").replace(/> </g, "><").trim();

const IN_PAGE = `async function (o) {
  var load = function (src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); };
  var ims = await Promise.all([load(o.a), load(o.b)]);
  var w = Math.max(ims[0].width, ims[1].width), h = Math.max(ims[0].height, ims[1].height);
  var data = function (im) { var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d");
    x.fillStyle = "#ff00ff"; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0); return x.getImageData(0, 0, w, h).data; };
  var da = data(ims[0]), db = data(ims[1]), n = 0;
  for (var i = 0; i < da.length; i += 4) {
    var d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 24) n++;
  }
  return n / (w * h);
}`;
async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  return (await tool.evaluate("(" + IN_PAGE + ")(" + JSON.stringify({ a: "data:image/png;base64," + a.toString("base64"), b: "data:image/png;base64," + b.toString("base64") }) + ")")) as number;
}

/* ---------------- a journey, both sides in step ---------------- */

type Step = { name: string; run: (t: Tab, side: SideName) => Promise<void>; strictLook?: boolean };

async function journey(name: string, o: TabOpts, steps: Step[]): Promise<StepResult[]> {
  const tabs = {} as Record<SideName, Tab>;
  const mine: StepResult[] = [];
  for (const side of ["ref", "new"] as SideName[]) { await reset(side); tabs[side] = await openTab(o); }
  for (const st of steps) {
    const got = {} as Record<SideName, { recs: unknown[]; dom: string; png: Buffer }>;
    for (const side of ["ref", "new"] as SideName[]) {
      const t = tabs[side];
      t.recs.length = 0;
      await st.run(t, side);
      await settle(t.page);
      const recs = t.recs.slice();
      recs.push({ t: "storage", a: await storage(t.page).catch(() => ({})) });
      const dom = normDom((await t.page.evaluate(SERIALISE).catch(() => "")) as string);
      const png = await t.page.screenshot({ animations: "disabled", caret: "hide" });
      got[side] = { recs: normalise(side, recs), dom, png };
    }
    const equal = JSON.stringify(got.ref.recs) === JSON.stringify(got.new.recs);
    const pixels = await pixelDiff(got.ref.png, got.new.png);
    const r: StepResult = {
      journey: name, step: st.name, equal, records: got.ref.recs.length, domEqual: got.ref.dom === got.new.dom, pixels,
    };
    if (!equal) r.diff = { ref: got.ref.recs, new: got.new.recs };
    else r.recorded = got.ref.recs;
    if (pixels > 0.0005) {
      writeFileSync(path.join(OUT, (name + "-" + st.name).replace(/\W+/g, "_") + "-ref.png"), got.ref.png);
      writeFileSync(path.join(OUT, (name + "-" + st.name).replace(/\W+/g, "_") + "-new.png"), got.new.png);
    }
    if (st.strictLook) (r as any).strictLook = true;
    results.push(r);
    mine.push(r);
  }
  for (const side of ["ref", "new"] as SideName[]) {
    if (tabs[side].errors.length) results.push({ journey: name, step: "page errors (" + side + ")", equal: false, records: 0, domEqual: true, pixels: 0, diff: { ref: tabs[side].errors, new: [] } });
    await tabs[side].ctx.close();
  }
  return mine;
}

const go = (p: string): Step["run"] => async (t, side) => { await t.page.goto(base[side] + p, { waitUntil: "networkidle" }); };

/** the shopping journey: land with tags → open a size → add → checkout → a method → COD order placed */
function shopping(lang: "ar" | "en"): Step[] {
  const root = lang === "en" ? "/en/" : "/";
  return [
    { name: "land with utm tags + click ids", run: go(root + "?utm_source=IG&utm_medium=Paid%20Social&utm_campaign=National%20Day&utm_content=reel_1&fbclid=IwAR_parity&ScCid=sc-parity") },
    { name: "open a size", run: async (t) => { await t.page.locator(".size").first().click(); } },
    { name: "choose a scent", run: async (t) => {
      /* a desktop opens nothing by itself: the large box's single offer first (a phone has it chosen) */
      const plus = t.page.locator("button:has-text('+'):visible").first();
      if (!(await plus.isVisible().catch(() => false))) await t.page.locator("label.tier:visible").first().click();
      await t.page.locator("button:has-text('+'):visible").first().click();
    } },
    { name: "add to the basket", run: async (t) => { await t.page.click("#add"); } },
    { name: "open the basket", run: async (t) => { await t.page.locator(".cart:visible").first().click().catch(() => {}); } },
    { name: "the checkout", run: go(root + "checkout.html") },
    { name: "fill the form", run: async (t) => {
      await t.page.fill("#name", "Sara Ali");
      await t.page.selectOption("#city", { index: 1 });
      await t.page.fill("#region", "Al Khuwair");
      await t.page.fill("#email", "Sara@Example.com");
      await t.page.fill("#phone", "91234567");
      await t.page.locator("#phone").blur();
    } },
    { name: "choose cash on delivery", run: async (t) => { await t.page.click('[data-pay="cod"]'); } },
    { name: "the same method again", run: async (t) => { await t.page.click('[data-pay="card"]'); await t.page.click('[data-pay="cod"]'); } },
    { name: "place the COD order", run: async (t) => { await t.page.click("#confirm"); await t.page.waitForTimeout(800); } },
    { name: "reload the done page", run: async (t) => { await t.page.reload({ waitUntil: "networkidle" }); } },
    { name: "a later visit, typed in", run: go(root) },
  ];
}

const suite = READY ? describe : describe.skip;

suite("tracking parity in a real browser (original vs new)", () => {
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    const { chromium } = await import("playwright");
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
    tool = await (await browser.newContext()).newPage();

    base.ref = process.env.PIXEL_REF || "http://localhost:" + REF_PORT;
    if (!process.env.PIXEL_REF) {
      refProc = spawn(process.execPath, [path.join(__dirname, "checkout-ref-server.cjs"), String(REF_PORT)], {
        env: { ...process.env, ...GA4, REF: REF_DIR, REF_SERVER },
        stdio: "ignore",
      });
    }
    base.new = process.env.PIXEL_NEW || "";
    if (!base.new) {
      const dist = path.join(REPO, "dist-pixel");
      const { buildSite } = await import("../../scripts/build");
      await buildSite({ outDir: dist, log: () => {} });
      const { startServer } = await import("../../src/server/node");
      const s = await startServer({ port: NEW_PORT, distDir: dist, env: { ...process.env, ...GA4, SERVICES_MODE: "fake", DATA_DIR: "memory", PORT: String(NEW_PORT) } });
      newServer = s.server as unknown as { close(): void };
      newDeps = s.deps;
      base.new = "http://localhost:" + NEW_PORT;
    }
    await waitUp(base.ref + "/api/settings");
    await waitUp(base.new + "/api/settings");
  }, 240_000);

  afterAll(async () => {
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 1));
    await browser?.close().catch(() => {});
    refProc?.kill();
    newServer?.close();
  });

  const expectSteps = (rs: StepResult[]) => {
    const bad = rs.filter((r) => !r.equal).map((r) => ({ step: r.step, diff: r.diff }));
    expect(bad).toEqual([]);
    for (const r of rs) if ((r as any).strictLook) { expect(r.domEqual, r.step + ": DOM").toBe(true); expect(r.pixels, r.step + ": pixels").toBeLessThan(0.0005); }
  };

  for (const [lang, width] of [["ar", 390], ["en", 1366], ["ar", 1366], ["en", 390]] as const) {
    it(`the shopping journey, ${lang} at ${width}px`, async () => {
      expectSteps(await journey(`shop-${lang}-${width}`, { width, lang }, shopping(lang)));
    }, 180_000);
  }

  it("privacy and 404 (stats alone), Arabic and English", async () => {
    expectSteps(await journey("stats-pages", { width: 390, lang: "ar" }, [
      { name: "privacy", run: go("/privacy.html?utm_source=wa"), strictLook: true },
      { name: "a missing page", run: go("/no-such-page"), strictLook: true },
      { name: "privacy in English", run: go("/en/privacy.html"), strictLook: true },
      { name: "an injected script's errors are not ours (nothing sent)", run: async (t) => {
        await t.page.evaluate(() => { setTimeout(() => { throw new Error("boom for ali@example.com +968 9123 4567"); }, 0); });
        await t.page.evaluate(() => { void Promise.reject(new Error("rejected 12345678")); });
      } },
    ]));
  }, 120_000);

  it("other markets and a returning shopper", async () => {
    expectSteps(await journey("markets", { width: 390, lang: "ar", local: { lm_ph_v2: "c".repeat(64), lm_am_v1: JSON.stringify({ fn: "a".repeat(64), em: "bad" }) } }, [
      { name: "AE by address", run: go("/?country=AE") },
      { name: "open a size (AE)", run: async (t) => { await t.page.locator(".size").first().click(); } },
      { name: "an error in our own code is reported (once)", run: async (t) => {
        /* thrown inside the pixel module (a line of null) from an event listener — reported, not
           propagated; the stack's top frame names our file. (The page's clock wraps timers.) */
        await t.page.evaluate("document.addEventListener('lm:parity', function () { window.LMPX.addCart(null); });" +
          "document.dispatchEvent(new Event('lm:parity')); document.dispatchEvent(new Event('lm:parity'));");
      } },
      { name: "SA by address, English", run: go("/en/?country=SA&gclid=x") },
      { name: "KW checkout, back from the card page", run: async (t, side) => { await t.page.goto(base[side] + "/checkout.html?country=KW", { referer: "https://checkout.thawani.om/pay/x", waitUntil: "networkidle" }); } },
    ]));
  }, 120_000);

  it("a first visit waits for Meta's cookie (a stand-in library sets _fbp)", async () => {
    expectSteps(await journey("first-visit-hold", { width: 390, lang: "ar", fakeMetaLibrary: true }, [
      { name: "land: one batch once _fbp is set", run: async (t, side) => { await t.page.goto(base[side] + "/?utm_source=snapchat&utm_medium=paid_social", { waitUntil: "networkidle" }); await t.page.waitForTimeout(3500); } },
      { name: "open a size: the cookie on Meta's relay", run: async (t) => { await t.page.locator(".size").first().click(); } },
    ]));
  }, 120_000);

  it("a remembered English shopper on the Arabic address: the page moves to /en/ and counts once", async () => {
    expectSteps(await journey("lang-redirect", { width: 390, lang: "ar", local: { lm_lang: "en" } }, [
      { name: "/ → /en/", run: async (t, side) => { await t.page.goto(base[side] + "/?utm_source=ig", { waitUntil: "networkidle" }); await t.page.waitForTimeout(500); } },
      { name: "/checkout.html → /en/checkout.html", run: go("/checkout.html") },
    ]));
  }, 120_000);
});
