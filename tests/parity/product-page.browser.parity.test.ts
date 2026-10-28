/**
 * PRODUCT PAGE PARITY, IN A REAL BROWSER: the ORIGINAL store (its _site and real handlers,
 * /home/claude/tools/ref-server.js) and this one (built into dist-product, served by
 * src/server/node.ts in fake mode, in-process) are driven through the SAME journeys on the
 * product page (index.html, en/index.html — main.js's port, src/web/product), and after every
 * step the two pages are compared:
 *
 *   (a) a normalised serialisation of the page (body, scripts/iframes left out, comments and
 *       whitespace runs collapsed, ?v= and hashed asset names normalised), equal;
 *   (b) a full-page screenshot, pixel-diffed in a canvas (as scripts/compare-screens.ts), at
 *       most anti-aliasing noise. The reel (#reel) is masked in the PICTURE only: its posters
 *       and clips decode on their own schedule on both sides (compare-screens shows the same
 *       flake either way); its markup is still compared.
 *
 * Catalogue variants are published on both sides (PUT /__ref/catalogue, PUT /__fake/catalogue).
 * Frozen clock (Date fixed at 2026-10-01 09:00 +04, timers running), the same Math.random seed,
 * every host but localhost and Google's font hosts blocked, the same edge country (OM).
 * Results: .tmp/parity-product/report.json (and the PNGs/HTML of any differing step).
 *
 * Skipped when the original store, the reference server or the browsers are absent.
 * PRODUCT_REF / PRODUCT_NEW (base URLs) use servers already running instead.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import type { Catalogue } from "../../src/shared/catalogue/types";

const REPO = path.resolve(__dirname, "../..");
const REF_DIR = process.env.LUBAN_REF || "/home/claude/ref/luban-musk";
const REF_SERVER = process.env.REF_SERVER || "/home/claude/tools/ref-server.js";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
const BROWSERS = !!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH);
const READY = existsSync(path.join(REF_DIR, "_site/index.html")) && existsSync(REF_SERVER) && BROWSERS;

const REF_PORT = 4101;
const NEW_PORT = 8891;
const OUT = path.join(REPO, ".tmp/parity-product");
const FROZEN = Date.parse("2026-10-01T09:00:00+04:00");
const HOUR = 3600e3;
/* The pages tell the time by the SERVER's clock (the Date header of /api/settings — store.js and
   the core both correct the device clock with it), and both servers run on the real clock. So
   the offers' windows are anchored on the real now, not on the frozen browser clock. */
const NOW = Date.now();
/** share of differing pixels tolerated (anti-aliasing) */
const PIXELS = 0.0005;

type SideName = "ref" | "new";
interface Side {
  name: SideName;
  base: string;
  publish(cat: Catalogue): Promise<void>;
}
interface Snap {
  dom: string;
  png: Buffer;
}
interface StepResult {
  journey: string;
  step: string;
  domEqual: boolean;
  pixels: number;
  note?: string;
}
const results: StepResult[] = [];

let browser: Browser;
let tool: Page;
let refProc: ChildProcess | null = null;
let newServer: { close(): void } | null = null;
const sides: Record<SideName, Side> = {} as Record<SideName, Side>;

const baseCatalogue = (): Catalogue => JSON.parse(readFileSync(path.join(REPO, "data/catalogue.json"), "utf8"));

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

function refSide(base: string): Side {
  return {
    name: "ref",
    base,
    async publish(cat) {
      await fetch(base + "/__ref/catalogue", { method: "PUT", body: JSON.stringify({ data: cat }) });
    },
  };
}
function newSide(base: string): Side {
  return {
    name: "new",
    base,
    async publish(cat) {
      const r = await fetch(base + "/__fake/catalogue", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: cat }) });
      if (!r.ok) throw new Error("publish failed " + r.status);
    },
  };
}

/* ---------------- pages ---------------- */

interface OpenOpts {
  width?: number;
  lang?: "ar" | "en";
  cart?: unknown[] | null;
  /** prefers-reduced-motion (default reduce: the screenshots hold still) */
  motion?: "reduce" | "no-preference";
}

async function context(o: OpenOpts): Promise<BrowserContext> {
  const width = o.width || 390;
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: o.lang === "en" ? "en" : "ar",
    reducedMotion: o.motion || "reduce",
    extraHTTPHeaders: { "x-country": "OM" },
  });
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$|^fonts\.(googleapis|gstatic)\.com$/.test(u.host)) return r.continue();
    return r.abort();
  });
  await ctx.addInitScript(
    ({ cart }) => {
      let s = 42;
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      try {
        if (cart && !sessionStorage.getItem("__seeded")) {
          sessionStorage.setItem("lm_cart", JSON.stringify(cart));
          sessionStorage.setItem("__seeded", "1");
        }
      } catch {
        /* storage blocked */
      }
    },
    { cart: o.cart || null },
  );
  return ctx;
}

async function openPage(side: Side, pathname: string, o: OpenOpts): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await context(o);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FROZEN);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(side.base + pathname, { waitUntil: "networkidle" });
  await settle(page);
  /* walk down the page so lazy pictures (the painting, the tiles) load on both sides, then back
     up (as scripts/compare-screens.ts does) */
  const vh = page.viewportSize()?.height || 900;
  for (let y = 0; y < 6000; y += vh) await page.mouse.wheel(0, vh);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.mouse.wheel(0, -20000);
  await settle(page, 600);
  return { ctx, page, errors };
}

async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate("document.fonts ? document.fonts.ready.then(function () { return 1; }) : 1").catch(() => {});
  await page.waitForTimeout(ms);
}

const SERIALISE = `(function (sel) {
  var root = sel ? document.querySelector(sel) : document.body;
  if (!root) return "(none: " + sel + ")";
  var c = root.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll("script, noscript, iframe, link, style"), function (x) { x.remove(); });
  /* the header band's run (header.js's port): copies cloned to fill a measured width */
  Array.prototype.forEach.call(c.querySelectorAll(".ship-run"), function (x) { x.innerHTML = ""; });
  return c.outerHTML;
})`;

function normalise(s: string): string {
  return s
    /* the header band's measured run (header.js's port, not this page's): its width is read off
       the live layout as the font settles — see docs/notes/product-page.md */
    .replace(/(<span class="ship-run" style=")[^"]*"/g, '$1"')
    /* a class toggled off leaves class="" behind: the same element either way */
    .replace(/ class=""/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\?v=[\w.-]+/g, "?v=V")
    .replace(/\/assets\/([\w.-]+?)-[\w-]{8}\.(js|css)/g, "/assets/$1.$2")
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}

async function snap(page: Page, sel?: string, clip?: string): Promise<Snap> {
  const dom = normalise((await page.evaluate(SERIALISE + "(" + JSON.stringify(sel || null) + ")")) as string);
  let png: Buffer;
  if (clip) {
    /* the fixed bars (header, sticky bar, WhatsApp button) float over a part of the page: out of a
       part's picture, where the scroll that brought it into view decides what they cover */
    png = await page.locator(clip).first().screenshot({ animations: "disabled", caret: "hide", style: ".hdr, .sticky, .fab { visibility: hidden !important; }" });
  } else {
    png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", mask: [page.locator("#reel")], maskColor: "#888" });
  }
  return { dom, png };
}
const info = (s: string): Snap => ({ dom: s, png: Buffer.alloc(0) });

const IN_PAGE = `async function (o) {
  var load = function (src) { return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); };
  var ims = await Promise.all([load(o.a), load(o.b)]);
  var ia = ims[0], ib = ims[1];
  var w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
  var data = function (im) {
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    var x = c.getContext("2d"); x.fillStyle = "#ff00ff"; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  };
  var da = data(ia), db = data(ib), n = 0;
  for (var i = 0; i < da.length; i += 4) {
    var d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > 24) n++;
  }
  return n / (w * h);
}`;

async function pixelDiff(a: Buffer, b: Buffer): Promise<number> {
  return (await tool.evaluate(
    "(" + IN_PAGE + ")(" + JSON.stringify({ a: "data:image/png;base64," + a.toString("base64"), b: "data:image/png;base64," + b.toString("base64") }) + ")",
  )) as number;
}

type Rec = (label: string, s: Snap) => void;
type Journey = (side: Side, rec: Rec) => Promise<void>;

async function both(name: string, cat: Catalogue | null, journey: Journey): Promise<void> {
  const got: Record<SideName, Map<string, Snap>> = { ref: new Map(), new: new Map() };
  for (const n of ["ref", "new"] as SideName[]) {
    const side = sides[n];
    await side.publish(cat || baseCatalogue());
    await journey(side, (label, s) => got[n].set(label, s));
  }
  const failures: string[] = [];
  for (const [label, a] of got.ref) {
    const b = got.new.get(label);
    if (!b) {
      failures.push(label + ": no such step on the new site");
      continue;
    }
    const domEqual = a.dom === b.dom;
    const pixels = a.png.length && b.png.length ? await pixelDiff(a.png, b.png) : 0;
    results.push({ journey: name, step: label, domEqual, pixels });
    if (!domEqual || pixels > PIXELS) {
      const slug = (name + "-" + label).replace(/[^\w.-]+/g, "_");
      if (a.png.length) writeFileSync(path.join(OUT, slug + "-ref.png"), a.png);
      if (b.png.length) writeFileSync(path.join(OUT, slug + "-new.png"), b.png);
      writeFileSync(path.join(OUT, slug + "-ref.html"), a.dom);
      writeFileSync(path.join(OUT, slug + "-new.html"), b.dom);
      if (!domEqual) {
        let i = 0;
        while (i < a.dom.length && a.dom[i] === b.dom[i]) i++;
        failures.push(label + ": DOM differs at " + i + "\n  ref: " + a.dom.slice(Math.max(0, i - 120), i + 200) + "\n  new: " + b.dom.slice(Math.max(0, i - 120), i + 200));
      }
      if (pixels > PIXELS) failures.push(label + ": " + (pixels * 100).toFixed(3) + "% pixels differ");
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
}

/* ---------------- catalogue variants ---------------- */

/** the large offers live: anchored an hour before the frozen clock, the clock shown (hours) */
function tiersLive(c: Catalogue = baseCatalogue()): Catalogue {
  c.tiers = Object.assign({}, c.tiers, { active: true, renew: "once", hours: 72, unit: "hours", anchor: new Date(NOW - HOUR).toISOString() });
  return c;
}
function variant(edit: (c: Catalogue) => void): Catalogue {
  const c = baseCatalogue();
  edit(c);
  return c;
}

const home = (lang: "ar" | "en", q: string) => (lang === "en" ? "/en/" : "/") + q;

/* ---------------- the journeys ---------------- */

describe.skipIf(!READY)("the product page against the original, in a browser", () => {
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    const { chromium } = await import("playwright");
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
    tool = await (await browser.newContext()).newPage();

    const refBase = process.env.PRODUCT_REF || "http://localhost:" + REF_PORT;
    if (!process.env.PRODUCT_REF) {
      refProc = spawn(process.execPath, [REF_SERVER, String(REF_PORT)], { env: { ...process.env, REF: REF_DIR }, stdio: "ignore" });
    }
    let newBase = process.env.PRODUCT_NEW || "";
    if (!newBase) {
      const dist = path.join(REPO, "dist-product");
      const { buildSite } = await import("../../scripts/build");
      await buildSite({ outDir: dist, log: () => {} });
      const { startServer } = await import("../../src/server/node");
      const s = await startServer({ port: NEW_PORT, distDir: dist, env: { ...process.env, SERVICES_MODE: "fake", DATA_DIR: "memory", PORT: String(NEW_PORT) } });
      newServer = s.server as unknown as { close(): void };
      newBase = "http://localhost:" + NEW_PORT;
    }
    await waitUp(refBase + "/api/settings");
    await waitUp(newBase + "/api/settings");
    sides.ref = refSide(refBase);
    sides.new = newSide(newBase);
  }, 400_000);

  afterAll(async () => {
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
    await browser?.close().catch(() => {});
    if (refProc) refProc.kill();
    if (newServer) newServer.close();
  });

  /* ---- the page as it opens, per market (the bundled catalogue: large offers not started) ---- */
  for (const lang of ["ar", "en"] as const) {
    it(`opens in every market, and follows a change of market (${lang})`, async () => {
      await both("markets-" + lang, null, async (side, rec) => {
        for (const width of [390, 1366]) {
          for (const code of ["OM", "AE", "SA", "QA", "BH", "KW"]) {
            const { ctx, page, errors } = await openPage(side, home(lang, "?country=" + code), { width, lang });
            rec(code + "-" + width, await snap(page));
            expect(errors).toEqual([]);
            await ctx.close();
          }
          /* the select: OM → SA → AE */
          const { ctx, page, errors } = await openPage(side, home(lang, "?country=OM"), { width, lang });
          await page.selectOption("#cty", "SA");
          await settle(page, 200);
          rec("to-SA-" + width, await snap(page));
          await page.selectOption("#cty", "AE");
          await settle(page, 200);
          rec("to-AE-" + width, await snap(page));
          expect(errors).toEqual([]);
          await ctx.close();
        }
      });
    }, 400_000);
  }

  /* ---- the large offers: rows, clock, choosing, three scents, the basket ---- */
  for (const lang of ["ar", "en"] as const) {
    for (const width of [390, 1366]) {
      it(`the large offers: choose, pick, add, let go (${lang}, ${width}px)`, async () => {
        await both(`tiers-${lang}-${width}`, tiersLive(), async (side, rec) => {
          const { ctx, page, errors } = await openPage(side, home(lang, "?country=OM"), { width, lang });
          rec("open", await snap(page));
          await page.click('.tier[data-tier="trio"]');
          await settle(page, 200);
          rec("trio-chosen", await snap(page));
          rec("focus", info(String(await page.evaluate("document.activeElement && (document.activeElement.value || document.activeElement.id || document.activeElement.tagName)"))));
          const under = '.tier-scents .prow[data-scent="';
          await page.click(under + 'oud"] [data-step="1"]');
          await page.click(under + 'oud"] [data-step="1"]');
          await settle(page, 100);
          rec("two-picked", await snap(page, "#sizes", "#sizes"));
          await page.click(under + 'amber"] [data-step="1"]');
          await page.click(under + 'lemon"] [data-step="1"]'); // a fourth: refused
          await settle(page, 100);
          rec("three-picked", await snap(page));
          await page.click("#add");
          await settle(page, 100);
          rec("added", await snap(page));
          rec("basket", info(String(await page.evaluate("sessionStorage.getItem('lm_cart')"))));
          await page.waitForTimeout(1700);
          rec("after-flash", await snap(page, "#sizes", "#sizes"));
          /* the chosen row tapped again: a desktop lets go, a phone keeps it (v440) */
          await page.click('.tier[data-tier="trio"]');
          await settle(page, 200);
          rec("tapped-again", await snap(page, "#sizes", "#sizes"));
          /* the duo, then the set */
          await page.click('.tier[data-tier="duo"]');
          await settle(page, 200);
          rec("duo-chosen", await snap(page, "#sizes", "#sizes"));
          await page.click("#offer .ob-row");
          await settle(page, 200);
          rec("set-chosen", await snap(page));
          await page.click("#addOffer");
          await settle(page, 100);
          rec("set-added", await snap(page, "#sizes", "#sizes"));
          rec("basket-2", info(String(await page.evaluate("sessionStorage.getItem('lm_cart')"))));
          await page.click("#offer .ob-row");
          await settle(page, 200);
          rec("set-tapped-again", await snap(page, "#sizes", "#sizes"));
          /* the keyboard: Space on a chosen row (v407 / v440) */
          await page.click('.tier[data-tier="single"]');
          await settle(page, 100);
          await page.focus('.tier[data-tier="single"] input');
          await page.keyboard.press("Space");
          await settle(page, 200);
          rec("space-on-chosen", await snap(page, "#sizes", "#sizes"));
          rec("space-focus", info(String(await page.evaluate("document.activeElement && (document.activeElement.value || document.activeElement.tagName)"))));
          expect(errors).toEqual([]);
          await ctx.close();
        });
      }, 300_000);
    }
  }

  /* ---- catalogue variants: offers off, the set off, the set ships free, the strip, sold out ---- */
  const variants: Array<{ name: string; country: string; cat: () => Catalogue; cart?: unknown[] }> = [
    { name: "tiers-sa-plain", country: "SA", cat: () => tiersLive() },
    { name: "tiers-no-clock", country: "AE", cat: () => tiersLive(variant((c) => (c.tiers!.clock = false))) },
    { name: "tiers-days", country: "QA", cat: () => { const c = tiersLive(); c.tiers!.unit = "days"; return c; } },
    { name: "set-off", country: "OM", cat: () => variant((c) => (c.offer!.active = false)) },
    { name: "set-free-hours", country: "AE", cat: () => variant((c) => Object.assign(c.offer!, { freeShip: true, freeShipIn: [], freeShipHours: 24, freeShipUnit: "hours", freeShipRenew: "once", freeShipAnchor: new Date(NOW - 20 * HOUR).toISOString() })) },
    { name: "set-free-days", country: "KW", cat: () => variant((c) => Object.assign(c.offer!, { freeShip: true, freeShipIn: [], freeShipHours: 72, freeShipUnit: "days", freeShipRenew: "once", freeShipAnchor: new Date(NOW - 20 * HOUR).toISOString() })) },
    { name: "strip-days", country: "OM", cat: () => variant((c) => (c.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5, from: new Date(NOW - 2 * HOUR).toISOString() } } })) },
    { name: "strip-all", country: "AE", cat: () => variant((c) => (c.freeShip = { active: true, countries: { AE: { on: true, over: 0 } } })) },
    {
      name: "large-sold-out",
      country: "OM",
      cat: () =>
        variant((c) => {
          const om = c.countries.find((x) => x.code === "OM")!;
          om.sizes = JSON.parse(JSON.stringify(c.sizes));
          om.sizes!.find((s) => s.id === "large")!.soldOut = true;
        }),
    },
    {
      name: "scent-out-large",
      country: "OM",
      cat: () =>
        tiersLive(
          variant((c) => {
            const om = c.countries.find((x) => x.code === "OM")!;
            om.scents = JSON.parse(JSON.stringify(c.scents));
            om.scents!.find((s) => s.id === "amber")!.soldOutSizes = ["large", "small"];
            om.scents!.find((s) => s.id === "oud")!.stars = 4.3;
            om.scents!.find((s) => s.id === "lemon")!.stars = 4.8;
            om.scents!.find((s) => s.id === "lemon")!.tag = "الأكثر مبيعا";
          }),
        ),
    },
    { name: "cash-off", country: "BH", cat: () => variant((c) => c.countries.forEach((x) => x.code === "BH" && (x.codOn = false))) },
  ];
  for (const v of variants) {
    it(`a catalogue variant: ${v.name}`, async () => {
      await both("variant-" + v.name, v.cat(), async (side, rec) => {
        for (const lang of ["ar", "en"] as const) {
          for (const width of [390, 1366]) {
            const { ctx, page, errors } = await openPage(side, home(lang, "?country=" + v.country), { width, lang, cart: v.cart });
            rec(lang + "-" + width, await snap(page));
            if (width === 390) {
              /* phones open the large size chosen: its scents are showing */
              const row = page.locator('.tier-scents .prow:not(.shut) [data-step="1"]').first();
              if (await row.isVisible().catch(() => false)) {
                await row.click();
                await settle(page, 100);
                rec(lang + "-picked", await snap(page, "#sizes", "#sizes"));
              }
            }
            expect(errors).toEqual([]);
            await ctx.close();
          }
        }
      });
    }, 300_000);
  }

  /* ---- the rest of the page: gallery, sticky bar, reel arrows, track box ---- */
  it("the gallery, the sticky bar, the reel's arrows, the track box", async () => {
    await both("page-parts", null, async (side, rec) => {
      for (const width of [390, 1366]) {
        const { ctx, page, errors } = await openPage(side, "/?country=OM", { width });
        await page.click("#thumbs button:nth-child(3)");
        await page.waitForTimeout(700);
        rec("thumb-3-" + width, await snap(page, ".gal", ".gal"));
        if (width === 390) {
          await page.evaluate("window.scrollTo(0, document.getElementById('sizes').getBoundingClientRect().bottom + window.scrollY + 300)");
          await settle(page, 300);
          rec("sticky-shown", info(String(await page.evaluate("document.getElementById('sticky').className"))));
          await page.click("#stickyAdd");
          await page.waitForTimeout(900);
          rec("sticky-scrolled", info(String(await page.evaluate("Math.round(window.scrollY / 10)"))));
        } else {
          await page.locator("#reel").scrollIntoViewIfNeeded();
          await settle(page, 600);
          rec("reel-placed", info(String(await page.evaluate("document.getElementById('reelTrack').scrollLeft"))));
          await page.click("#reelNext");
          await page.waitForTimeout(900);
          rec("reel-next", info(String(await page.evaluate("Math.round(document.getElementById('reelTrack').scrollLeft) + ' ' + document.getElementById('reelDots').innerHTML"))));
          rec("reel-dom", await snap(page, "#reel"));
        }
        expect(errors).toEqual([]);
        await ctx.close();
      }
      for (const [q, lang] of [
        ["?country=OM&track=lm482913", "ar"],
        ["?country=OM&track=12", "ar"],
        ["?country=OM&track=LM-12345", "en"],
      ] as const) {
        const { ctx, page, errors } = await openPage(side, home(lang, q), { width: 390, lang });
        await settle(page, 300);
        rec("track-" + q + "-" + lang, await snap(page, ".track", ".track"));
        expect(errors).toEqual([]);
        await ctx.close();
      }
      /* typing in the box, then asking */
      const { ctx, page } = await openPage(side, "/?country=OM", { width: 390 });
      await page.fill("#trackId", "");
      await page.type("#trackId", "lm 9999");
      rec("typed", info(await page.inputValue("#trackId")));
      await page.press("#trackId", "Enter");
      await settle(page, 300);
      rec("asked", await snap(page, ".track", ".track"));
      await ctx.close();
    });
  }, 300_000);

  /* ---- the basket comes in from elsewhere: the badge and the checkout link ---- */
  it("a basket from before: the badge, the checkout link, a set at its cap", async () => {
    await both("basket", null, async (side, rec) => {
      const { ctx, page, errors } = await openPage(side, "/?country=OM", {
        width: 390,
        cart: [
          { scentId: "oud", sizeId: "large", qty: 2, scent: "عود الافندر", size: "كبير", price: 12.9 },
          { scentId: "bundle", sizeId: "bundle", qty: 1, scent: "باقة الروائح الثلاث", size: "", price: 29 },
        ],
      });
      rec("page", await snap(page));
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }, 120_000);
});
