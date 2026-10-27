/**
 * CHECKOUT / CART / HEADER PARITY, IN A REAL BROWSER: the ORIGINAL store (its _site and real
 * handlers, tests/parity/checkout-ref-server.cjs over /home/claude/tools/ref-server.js) and
 * this one (built into dist-checkout, served by src/server/node.ts in fake mode, in-process)
 * are driven through the SAME journeys, and after every step the two pages are compared:
 *
 *   (a) a normalised serialisation of the page (body, scripts/iframes left out, comments and
 *       whitespace runs collapsed, ?v= and hashed asset names normalised), equal;
 *   (b) a full-page screenshot, pixel-diffed in a canvas (as scripts/compare-screens.ts),
 *       at most anti-aliasing noise;
 *   and, for orders: the POST body (dedupe id and the pixel module's signals left out), the
 *   till's answer (id, omr) and the stored order (key columns), equal.
 *
 * Frozen clock (Date fixed at 2026-10-01 09:00 +04, timers running), the same Math.random seed,
 * every host but localhost and Google's font hosts blocked, the same edge country (OM).
 * Results are written to .tmp/parity-checkout/report.json (and the PNGs of any differing step).
 *
 * Skipped when the original store, the reference server or the browsers are absent.
 * CHECKOUT_REF / CHECKOUT_NEW (base URLs) use servers already running instead (then the stored
 * order is compared through the reference only).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page, Request as PwRequest } from "playwright";
import type { Catalogue } from "../../src/shared/catalogue/types";

const REPO = path.resolve(__dirname, "../..");
const REF_DIR = process.env.LUBAN_REF || "/home/claude/ref/luban-musk";
const REF_SERVER = process.env.REF_SERVER || "/home/claude/tools/ref-server.js";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
const BROWSERS = !!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH);
const READY = existsSync(path.join(REF_DIR, "_site/checkout.html")) && existsSync(REF_SERVER) && BROWSERS;

const REF_PORT = 4102;
const NEW_PORT = 8892;
const OUT = path.join(REPO, ".tmp/parity-checkout");
const FROZEN = Date.parse("2026-10-01T09:00:00+04:00");
/** share of differing pixels tolerated (anti-aliasing) */
const PIXELS = 0.0005;

type SideName = "ref" | "new";
interface Side {
  name: SideName;
  base: string;
  publish(cat: Catalogue): Promise<void>;
  reset(): Promise<void>;
  /** the order as the till stored it (key columns), or null */
  stored(id: string): Promise<Record<string, unknown> | null>;
  /** the shopper pays on the gateway's page and comes back */
  payAndReturn(page: Page, orderId: string): Promise<void>;
  cancelAndReturn(page: Page, orderId: string): Promise<void>;
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
let newDeps: any = null;
const sides: Record<SideName, Side> = {} as Record<SideName, Side>;

const baseCatalogue = (): Catalogue => JSON.parse(readFileSync(path.join(REPO, "data/catalogue.json"), "utf8"));

async function waitUp(url: string, ms = 60000): Promise<void> {
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

/* ---------------- the two sides ---------------- */

function refSide(base: string): Side {
  return {
    name: "ref",
    base,
    async publish(cat) {
      await fetch(base + "/__ref/catalogue", { method: "PUT", body: JSON.stringify({ data: cat }) });
    },
    async reset() {
      await fetch(base + "/__ref/reset", { method: "POST" });
    },
    async stored(id) {
      const rows = (await (await fetch(base + "/__ref/orders")).json()) as Array<Record<string, any>>;
      const o = rows.find((r) => r.id === id);
      return o ? project(o) : null;
    },
    async payAndReturn(page, id) {
      /* the stubbed Thawani page is up (routed below); the shopper pays there */
      await fetch(base + "/__ref/pay?ref=" + encodeURIComponent(id), { method: "POST" });
      await page.goto(base + checkoutPath(page) + "?paid=" + encodeURIComponent(id), { waitUntil: "networkidle" });
    },
    async cancelAndReturn(page, id) {
      await page.goto(base + checkoutPath(page) + "?cancelled=" + encodeURIComponent(id), { waitUntil: "networkidle" });
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
    async reset() {
      if (!newDeps) return;
      const { orders, rateLimits } = await import("../../src/server/db/schema");
      await newDeps.db.delete(orders);
      await newDeps.db.delete(rateLimits);
    },
    async stored(id) {
      if (!newDeps) return null;
      const { orders } = await import("../../src/server/db/schema");
      const { eq } = await import("drizzle-orm");
      const rows = await newDeps.db.select().from(orders).where(eq(orders.id, id));
      const o = rows[0];
      if (!o) return null;
      return project({
        id: o.id, status: o.status, payment_status: o.paymentStatus, pay: o.pay, name: o.name, phone: o.phone,
        country_code: o.countryCode, city: o.city, region: o.region, cur: o.cur, total: o.total, omr: o.omr, ship: o.ship, items: o.items,
      });
    },
    async payAndReturn(page) {
      /* the fake hosted page: press Pay; it settles and sends the shopper back (success_url) */
      await Promise.all([page.waitForURL(/checkout\.html\?paid=/, { timeout: 15000 }), page.click("button.pay")]);
      await page.waitForLoadState("networkidle");
    },
    async cancelAndReturn(page) {
      await Promise.all([page.waitForURL(/checkout\.html\?cancelled=/, { timeout: 15000 }), page.click("button.cancel")]);
      await page.waitForLoadState("networkidle");
    },
  };
}

/** /checkout.html or /en/checkout.html, from the page the shopper was on before the gateway */
let lastCheckoutPath = "/checkout.html";
function checkoutPath(_page: Page): string {
  return lastCheckoutPath;
}

/** the columns both stores keep, in one shape */
function project(o: Record<string, any>): Record<string, unknown> {
  const items = (Array.isArray(o.items) ? o.items : []).map((i: Record<string, unknown>) => ({ itemId: i.itemId, qty: Number(i.qty), price: Number(i.price) }));
  return {
    id: o.id, status: o.status, payment_status: o.payment_status, pay: o.pay, name: o.name, phone: o.phone,
    country_code: o.country_code, city: o.city, region: o.region, cur: o.cur,
    total: Number(o.total), omr: Number(o.omr), ship: Number(o.ship), items,
  };
}

/* ---------------- pages ---------------- */

interface OpenOpts {
  width?: number;
  lang?: "ar" | "en";
  cart?: unknown[] | null;
  /** extra session/local storage before load */
  local?: Record<string, string>;
}

async function context(o: OpenOpts): Promise<BrowserContext> {
  const width = o.width || 390;
  const ctx = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    deviceScaleFactor: 1,
    locale: o.lang === "en" ? "en" : "ar",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "x-country": "OM" },
  });
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$|^fonts\.(googleapis|gstatic)\.com$/.test(u.host)) return r.continue();
    /* the original's Thawani page (uatcheckout.thawani.om/pay/…): a stand-in page */
    if (/thawani\.om$/.test(u.host)) return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Thawani</title><p>gateway</p>" });
    return r.abort();
  });
  await ctx.addInitScript(
    ({ cart, local }) => {
      let s = 42;
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
      try {
        if (cart && !sessionStorage.getItem("__seeded")) {
          sessionStorage.setItem("lm_cart", JSON.stringify(cart));
          sessionStorage.setItem("__seeded", "1");
        }
        if (local) for (const k of Object.keys(local)) if (localStorage.getItem(k) == null) localStorage.setItem(k, local[k]!);
      } catch {
        /* storage blocked */
      }
    },
    { cart: o.cart || null, local: o.local || null },
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
  return { ctx, page, errors };
}

async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate("document.fonts ? document.fonts.ready.then(function () { return 1; }) : 1").catch(() => {});
  await page.waitForTimeout(ms);
}

/** the page as both sides must serialise it */
const SERIALISE = `(function (sel) {
  var root = sel ? document.querySelector(sel) : document.body;
  if (!root) return "(none: " + sel + ")";
  var c = root.cloneNode(true);
  Array.prototype.forEach.call(c.querySelectorAll("script, noscript, iframe, link, style"), function (x) { x.remove(); });
  return c.outerHTML;
})`;

function normalise(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\?v=[\w.-]+/g, "?v=V")
    .replace(/\/assets\/([\w.-]+?)-[\w-]{8}\.(js|css)/g, "/assets/$1.$2")
    /* the running band's measured width: read once, when the message is first written, so it
       depends on whether the web font had arrived by then — a race in the original too */
    .replace(/animation-duration: [\d.]+s; --ship-w: -?[\d.]+px;/g, "animation-duration: Ws; --ship-w: Wpx;")
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .trim();
}

async function snap(page: Page, sel?: string, clip?: string): Promise<Snap> {
  const dom = normalise((await page.evaluate(SERIALISE + "(" + JSON.stringify(sel || null) + ")")) as string);
  let png: Buffer;
  if (clip) {
    const box = await page.locator(clip).first().boundingBox();
    png = await page.screenshot({ clip: box || undefined, animations: "disabled", caret: "hide" });
  } else {
    png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  }
  return { dom, png };
}

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

/* ---------------- a journey on both sides ---------------- */

type Record_ = (label: string, s: Snap) => void;
type Journey = (side: Side, rec: Record_, data: Record<string, unknown>) => Promise<void>;

/**
 * Runs the journey on the original, then on the new store; compares every recorded step and
 * every datum the journey put in `data` (POST bodies, answers, stored orders).
 */
async function both(name: string, journey: Journey): Promise<void> {
  const got: Record<SideName, { snaps: Map<string, Snap>; data: Record<string, unknown> }> = {
    ref: { snaps: new Map(), data: {} },
    new: { snaps: new Map(), data: {} },
  };
  for (const n of ["ref", "new"] as SideName[]) {
    const side = sides[n];
    await side.reset();
    await side.publish(baseCatalogue());
    await journey(side, (label, s) => got[n].snaps.set(label, s), got[n].data);
  }
  const failures: string[] = [];
  for (const [label, a] of got.ref.snaps) {
    const b = got.new.snaps.get(label);
    if (!b) {
      failures.push(label + ": no such step on the new site");
      continue;
    }
    const domEqual = a.dom === b.dom;
    const pixels = a.png.length && b.png.length ? await pixelDiff(a.png, b.png) : 0;
    results.push({ journey: name, step: label, domEqual, pixels });
    if (!domEqual || pixels > PIXELS) {
      const slug = (name + "-" + label).replace(/[^\w.-]+/g, "_");
      writeFileSync(path.join(OUT, slug + "-ref.png"), a.png);
      writeFileSync(path.join(OUT, slug + "-new.png"), b.png);
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
  for (const k of Object.keys(got.ref.data)) {
    const same = JSON.stringify(got.ref.data[k]) === JSON.stringify(got.new.data[k]);
    results.push({ journey: name, step: "data:" + k, domEqual: same, pixels: 0, note: same ? undefined : JSON.stringify({ ref: got.ref.data[k], new: got.new.data[k] }) });
    if (!same) failures.push("data " + k + " differs:\n  ref: " + JSON.stringify(got.ref.data[k]) + "\n  new: " + JSON.stringify(got.new.data[k]));
  }
  if (failures.length) writeFileSync(path.join(OUT, name.replace(/[^\w.-]+/g, "_") + "-failures.txt"), failures.join("\n\n"));
  expect(failures, failures.join("\n")).toEqual([]);
}

/* ---------------- the steps journeys share ---------------- */

const LINE = (scentId: string, sizeId: string, qty = 1) => ({ scentId, sizeId, qty, scent: scentId, size: sizeId, price: 1 });

async function fillForm(page: Page, o: { name: string; phone: string; region?: string; cityIndex?: number }): Promise<void> {
  await page.fill("#name", o.name);
  await page.selectOption("#city", { index: o.cityIndex ?? 1 });
  await page.fill("#region", o.region || "الخوير شارع 18");
  await page.fill("#phone", o.phone);
  await page.locator("#phone").blur();
}

/** the order the page posted (the parts the till reads; the dedupe id and the pixel module's signals left out) */
function postedOrder(req: PwRequest): Record<string, unknown> {
  const body = JSON.parse(req.postData() || "{}") as { order: Record<string, unknown> };
  const o = { ...body.order };
  o.dedupeId = typeof o.dedupeId === "string" && o.dedupeId.length > 8 ? "(uuid)" : o.dedupeId;
  o.pageUrl = String(o.pageUrl || "").replace(/^https?:\/\/[^/]+/, "");
  delete o.snap;
  delete o.ref;
  return o;
}

async function placeCod(page: Page, side: Side, data: Record<string, unknown>, rec: Record_, prefix: string): Promise<string> {
  await page.click('[data-pay="cod"]');
  await settle(page, 200);
  rec(prefix + "cod-chosen", await snap(page));
  const [req, res] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/order") && r.method() === "POST"),
    page.waitForResponse((r) => r.url().endsWith("/api/order")),
    page.click("#confirm"),
  ]);
  data[prefix + "post"] = postedOrder(req);
  const j = (await res.json()) as Record<string, unknown>;
  data[prefix + "answer"] = { status: res.status(), ok: j.ok, id: j.id, omr: j.omr, already: j.already ?? null };
  await page.waitForSelector("#done", { state: "visible" });
  await settle(page);
  rec(prefix + "done", await snap(page));
  const id = String(j.id || "");
  data[prefix + "stored"] = await side.stored(id);
  return id;
}

/* ---------------- the journeys ---------------- */

describe.skipIf(!READY)("checkout, cart and header against the original, in a browser", () => {
  beforeAll(async () => {
    mkdirSync(OUT, { recursive: true });
    const { chromium } = await import("playwright");
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
    tool = await (await browser.newContext()).newPage();

    const refBase = process.env.CHECKOUT_REF || "http://localhost:" + REF_PORT;
    if (!process.env.CHECKOUT_REF) {
      refProc = spawn(process.execPath, [path.join(__dirname, "checkout-ref-server.cjs"), String(REF_PORT)], {
        env: { ...process.env, REF: REF_DIR, REF_SERVER },
        stdio: "ignore",
      });
    }
    let newBase = process.env.CHECKOUT_NEW || "";
    if (!newBase) {
      const dist = path.join(REPO, "dist-checkout");
      const { buildSite } = await import("../../scripts/build");
      await buildSite({ outDir: dist, log: () => {} });
      const { startServer } = await import("../../src/server/node");
      const s = await startServer({ port: NEW_PORT, distDir: dist, env: { ...process.env, SERVICES_MODE: "fake", DATA_DIR: "memory", PORT: String(NEW_PORT) } });
      newServer = s.server as unknown as { close(): void };
      newDeps = s.deps;
      newBase = "http://localhost:" + NEW_PORT;
    }
    await waitUp(refBase + "/api/settings");
    await waitUp(newBase + "/api/settings");
    sides.ref = refSide(refBase);
    sides.new = newSide(newBase);
  }, 300_000);

  afterAll(async () => {
    writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
    await browser?.close().catch(() => {});
    if (refProc) refProc.kill();
    if (newServer) newServer.close();
  });

  /* ---- header band and drawer, on the product page (the drawer, the band; main.js is the product page's port) ---- */
  for (const width of [390, 1366]) {
    for (const lang of ["ar", "en"] as const) {
      it(`the drawer: open, +, −, delete, pay → checkout (${lang}, ${width}px)`, async () => {
        await both(`drawer-${lang}-${width}`, async (side, rec) => {
          const home = lang === "en" ? "/en/?country=OM" : "/?country=OM";
          const { ctx, page, errors } = await openPage(side, home, { width, lang, cart: [LINE("oud", "large", 1), LINE("amber", "large", 2), { scentId: "", sizeId: "burner", qty: 1, scent: "مبخرة", size: "", price: 6 }] });
          rec("header", await snap(page, "#hdr", "#hdr"));
          await page.click(".cart");
          await settle(page, 200);
          rec("drawer-open", await snap(page, "#drawer", ".drawer-panel"));
          rec("focus-open", { dom: String(await page.evaluate("document.activeElement && document.activeElement.className")), png: Buffer.alloc(0) } as Snap);
          await page.click('[data-inc="0"]');
          await settle(page, 200);
          rec("drawer-inc", await snap(page, "#drawer", ".drawer-panel"));
          rec("badge-inc", await snap(page, "#hdr", "#hdr"));
          await page.click('[data-dec="1"]');
          await settle(page, 200);
          rec("drawer-dec", await snap(page, "#drawer", ".drawer-panel"));
          await page.click('[data-del="2"]');
          await settle(page, 200);
          rec("drawer-del", await snap(page, "#drawer", ".drawer-panel"));
          rec("focus-after-del", { dom: String(await page.evaluate("document.activeElement && (document.activeElement.className || document.activeElement.getAttribute('data-del'))")), png: Buffer.alloc(0) } as Snap);
          await page.keyboard.press("Escape");
          await settle(page, 100);
          rec("drawer-closed", { dom: String(await page.evaluate("document.getElementById('drawer').hidden + ' ' + document.body.style.overflow")), png: Buffer.alloc(0) } as Snap);
          await page.click(".cart");
          await Promise.all([page.waitForURL(/checkout\.html/), page.click("#drawerPay")]);
          await settle(page);
          rec("checkout", await snap(page));
          expect(errors).toEqual([]);
          await ctx.close();
        });
      }, 180_000);
    }
  }

  /* ---- the checkout summary under catalogue variants ---- */
  const variants: Array<{ name: string; country: string; cart: unknown[]; edit?: (c: Catalogue) => void }> = [
    { name: "om-short", country: "OM", cart: [LINE("oud", "large", 1)] },
    { name: "om-free", country: "OM", cart: [LINE("oud", "large", 2), LINE("lemon", "large", 1)] },
    { name: "om-set", country: "OM", cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, scent: "set", size: "", price: 1 }, LINE("amber", "large", 1)] },
    { name: "om-samples", country: "OM", cart: [LINE("oud", "large", 1), { scentId: "", sizeId: "samples", qty: 3, scent: "عينات", size: "", price: 1 }] },
    { name: "ae-mixed", country: "AE", cart: [LINE("oud", "large", 1), { scentId: "", sizeId: "burner", qty: 1, scent: "مبخرة", size: "", price: 60 }] },
    { name: "sa-trio-off", country: "SA", cart: [{ sizeId: "trio", scentId: null, mix: ["oud", "oud", "amber"], qty: 1, scent: "3", size: "", price: 1 }, LINE("lemon", "large", 1)] },
    { name: "kw-cod-off", country: "KW", cart: [LINE("oud", "large", 1)], edit: (c) => c.countries.forEach((x) => x.code === "KW" && (x.codOn = false)) },
    { name: "om-offer-off", country: "OM", cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, scent: "set", size: "", price: 1 }], edit: (c) => c.offer && (c.offer.active = false) },
    { name: "om-freeship-deal", country: "OM", cart: [LINE("oud", "large", 1)], edit: (c) => c.countries.forEach((x) => x.code === "OM" && ((x as Record<string, unknown>).freeShip = { on: true, over: 0, from: "2026-09-30T00:00:00+04:00" })) },
    { name: "qa-tiers-off", country: "QA", cart: [{ sizeId: "duo", scentId: null, mix: ["oud", "lemon"], qty: 1, scent: "2", size: "", price: 1 }], edit: (c) => c.tiers && (c.tiers.active = false) },
  ];
  for (const v of variants) {
    for (const lang of ["ar", "en"] as const) {
      it(`the summary, bar, suggestion and add-ons: ${v.name} (${lang})`, async () => {
        await both(`summary-${v.name}-${lang}`, async (side, rec) => {
          if (v.edit) {
            const c = baseCatalogue();
            v.edit(c);
            await side.publish(c);
          }
          for (const width of [390, 1366]) {
            const p = (lang === "en" ? "/en" : "") + "/checkout.html?country=" + v.country;
            const { ctx, page, errors } = await openPage(side, p, { width, lang, cart: v.cart });
            rec("page-" + width, await snap(page));
            if (width === 390) {
              /* the one-tap suggestion, then an add-on */
              if (await page.locator("#freeAdd").isVisible()) {
                await page.click("#freeAdd");
                await settle(page, 200);
                rec("suggest-added", await snap(page));
                rec("basket-after-suggest", { dom: String(await page.evaluate("sessionStorage.getItem('lm_cart')")), png: Buffer.alloc(0) } as Snap);
              }
              const extra = page.locator("[data-extra]").first();
              if (await extra.isVisible().catch(() => false)) {
                await extra.click();
                await settle(page, 200);
                rec("extra-added", await snap(page));
              }
              /* card → cash and back */
              if (await page.locator('[data-pay="cod"]').isVisible()) {
                await page.click('[data-pay="cod"]');
                await settle(page, 150);
                rec("cod", await snap(page));
                await page.click('[data-pay="card"]');
                await settle(page, 150);
                rec("card", await snap(page));
              }
              /* the summary's bin */
              await page.click('#items [data-rm="0"]');
              await settle(page);
              rec("line-removed", await snap(page));
            }
            expect(errors).toEqual([]);
            await ctx.close();
          }
        });
      }, 240_000);
    }
  }

  /* ---- the form: country change, phone rules, invalid fields ---- */
  it("the form: countries, cities, phone counter and notes, refusals of the form", async () => {
    await both("form", async (side, rec) => {
      const { ctx, page, errors } = await openPage(side, "/checkout.html?country=OM", { cart: [LINE("oud", "large", 1)] });
      await page.click("#confirm");
      await settle(page, 200);
      rec("empty-submit", await snap(page));
      rec("empty-submit-focus", { dom: String(await page.evaluate("document.activeElement.id")), png: Buffer.alloc(0) } as Snap);
      await page.fill("#name", "José Zoë 12 محمد");
      await page.fill("#phone", "٩١٢٣");
      await settle(page, 100);
      rec("typing", await snap(page));
      await page.fill("#phone", "+971501234567");
      await page.click("#confirm");
      await settle(page, 200);
      rec("foreign-code", await snap(page));
      await page.fill("#phone", "21234567");
      await page.click("#confirm");
      await settle(page, 200);
      rec("first-digit", await snap(page));
      await page.fill("#phone", "91234567");
      await settle(page, 100);
      rec("good-number", await snap(page));
      await page.selectOption("#country", "971");
      await settle(page);
      rec("to-ae", await snap(page));
      await page.fill("#phone", "05012345");
      await page.click("#confirm");
      await settle(page, 200);
      rec("ae-short", await snap(page));
      await page.selectOption("#country", "965");
      await settle(page);
      rec("to-kw", await snap(page));
      await page.fill("#email", "not-an-email");
      await page.click("#confirm");
      await settle(page, 200);
      rec("bad-email", await snap(page));
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }, 180_000);

  /* ---- cash orders end to end ---- */
  for (const m of [
    { code: "OM", phone: "91234567", lang: "ar" as const },
    { code: "AE", phone: "0501234567", lang: "ar" as const },
    { code: "AE", phone: "501234567", lang: "en" as const },
  ]) {
    it(`a cash order end to end: ${m.code} (${m.lang})`, async () => {
      await both(`cod-${m.code}-${m.lang}`, async (side, rec, data) => {
        const p = (m.lang === "en" ? "/en" : "") + "/checkout.html?country=" + m.code;
        const { ctx, page, errors } = await openPage(side, p, { cart: [LINE("oud", "large", 1), LINE("amber", "large", 1)], lang: m.lang });
        await fillForm(page, { name: "سارة الهاشمي", phone: m.phone });
        await settle(page, 100);
        rec("filled", await snap(page));
        await placeCod(page, side, data, rec, "");
        rec("basket-after", { dom: String(await page.evaluate("sessionStorage.getItem('lm_cart')")), png: Buffer.alloc(0) } as Snap);
        expect(errors).toEqual([]);
        await ctx.close();
      });
    }, 180_000);
  }

  /* ---- card: to the gateway and back, paid and cancelled ---- */
  for (const lang of ["ar", "en"] as const) {
    it(`a card order: to the gateway and back paid (${lang})`, async () => {
      await both(`card-paid-${lang}`, async (side, rec, data) => {
        lastCheckoutPath = (lang === "en" ? "/en" : "") + "/checkout.html";
        const { ctx, page, errors } = await openPage(side, lastCheckoutPath + "?country=OM", { cart: [LINE("oud", "large", 1)], lang });
        await fillForm(page, { name: "Sara Hashmi", phone: "91234567" });
        const [req, res] = await Promise.all([
          page.waitForRequest((r) => r.url().endsWith("/api/pay/session")),
          page.waitForResponse((r) => r.url().endsWith("/api/pay/session")),
          page.click("#confirm"),
        ]);
        data.post = postedOrder(req);
        const j = (await res.json()) as Record<string, unknown>;
        data.answer = { status: res.status(), ok: j.ok, hasUrl: typeof j.url === "string", hasSession: typeof j.session_id === "string" };
        await page.waitForURL((u) => !/checkout\.html/.test(u.toString()));
        const pending = JSON.parse(String(await page.evaluate("sessionStorage.getItem('lm_pending')")) || "{}") as Record<string, unknown>;
        data.pendingKeys = Object.keys(pending).sort();
        const id = String((data.post as Record<string, unknown>).id);
        await side.payAndReturn(page, id);
        await page.waitForSelector("#done", { state: "visible", timeout: 15000 });
        await settle(page);
        rec("done", await snap(page));
        data.url = page.url().replace(/^https?:\/\/[^/]+/, "");
        data.stored = await side.stored(id);
        data.pendingAfter = await page.evaluate("sessionStorage.getItem('lm_pending')");
        expect(errors).toEqual([]);
        await ctx.close();
      });
    }, 180_000);
  }

  it("a card order: to the gateway and back cancelled (basket kept), then back with no basket", async () => {
    await both("card-cancelled", async (side, rec) => {
      lastCheckoutPath = "/checkout.html";
      const { ctx, page } = await openPage(side, "/checkout.html?country=OM", { cart: [LINE("oud", "large", 1)] });
      await fillForm(page, { name: "Sara", phone: "91234567" });
      await Promise.all([page.waitForURL((u) => !/checkout\.html/.test(u.toString())), page.click("#confirm")]);
      const id = String(JSON.parse(String(await page.evaluate("sessionStorage.getItem('lm_pending')"))).id);
      await side.cancelAndReturn(page, id);
      await settle(page);
      rec("cancelled-with-basket", await snap(page));
      await ctx.close();
      /* a reminder link in another browser: no basket in this tab */
      const o = await openPage(side, "/checkout.html?cancelled=LM-9990001235", {});
      rec("cancelled-no-basket", await snap(o.page));
      await o.ctx.close();
    });
  }, 180_000);

  /* ---- verify: unsure → retried → "do not pay again"; not paid; settled ---- */
  for (const v of [
    { name: "unsure", answer: { status: 502, body: { ok: false, error: "db_read_failed" } }, cart: true },
    { name: "unsure-no-basket", answer: { status: 502, body: { ok: false, error: "gateway_error" } }, cart: false },
    { name: "not-paid", answer: { status: 200, body: { ok: true, paid: false, id: "LM-9990001235" } }, cart: true },
    { name: "not-paid-no-basket", answer: { status: 200, body: { ok: true, paid: false, id: "LM-9990001235" } }, cart: false },
    { name: "mismatch-no-basket", answer: { status: 409, body: { ok: false, error: "amount_mismatch" } }, cart: false },
    { name: "settled", answer: { status: 200, body: { ok: true, paid: false, settled: true, id: "LM-9990001235" } }, cart: true },
    { name: "unknown-order", answer: { status: 404, body: { ok: false, error: "unknown_order" } }, cart: false },
  ]) {
    it(`back from the gateway, the verify answers ${v.name}`, async () => {
      await both(`verify-${v.name}`, async (side, rec, data) => {
        const ctx = await context({ cart: v.cart ? [LINE("oud", "large", 1)] : null });
        const page = await ctx.newPage();
        await page.clock.setFixedTime(FROZEN);
        let calls = 0;
        await page.route("**/api/pay/verify**", (r) => {
          calls++;
          return r.fulfill({ status: v.answer.status, contentType: "application/json", body: JSON.stringify(v.answer.body) });
        });
        await page.goto(side.base + "/checkout.html?paid=LM-9990001235", { waitUntil: "networkidle" });
        await page.waitForTimeout(v.name.startsWith("unsure") ? 9500 : 600);
        await settle(page);
        rec("screen", await snap(page));
        data.calls = calls;
        data.url = page.url().replace(/^https?:\/\/[^/]+/, "");
        await ctx.close();
      });
    }, 180_000);
  }

  /* ---- the parked order: the API is down, the shopper is told "received", it lands later ---- */
  it("a parked cash order: API down → received → posted on the next page load", async () => {
    await both("parked", async (side, rec, data) => {
      const { ctx, page, errors } = await openPage(side, "/checkout.html?country=OM", { cart: [LINE("oud", "large", 1)] });
      await fillForm(page, { name: "سارة", phone: "91234567" });
      await page.click('[data-pay="cod"]');
      await page.route("**/api/order", (r) => r.abort());
      await page.click("#confirm");
      await page.waitForSelector("#done", { state: "visible" });
      await settle(page);
      rec("received", await snap(page));
      const q = JSON.parse(String(await page.evaluate("localStorage.getItem('lm_order_queue')")) || "[]") as Array<Record<string, unknown>>;
      data.queued = q.length;
      const id = String(q[0] && q[0].id);
      await page.unroute("**/api/order");
      const [res] = await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/order")), page.goto(side.base + "/?country=OM")]);
      data.flushStatus = res.status();
      await settle(page);
      data.queueAfter = await page.evaluate("localStorage.getItem('lm_order_queue')");
      data.stored = await side.stored(id);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }, 180_000);

  /* ---- refusals ---- */
  it("refused: stock_short (409 {item, left}) → named, marked, set to N / remove", async () => {
    await both("stock-short", async (side, rec, data) => {
      for (const left of [1, 0]) {
        const { ctx, page } = await openPage(side, "/checkout.html?country=OM", { cart: [LINE("oud", "large", 3), LINE("amber", "large", 1)] });
        await fillForm(page, { name: "سارة", phone: "91234567" });
        await page.click('[data-pay="cod"]');
        let stock = 0;
        page.on("request", (r) => {
          if (r.url().includes("/api/stock")) stock++;
        });
        await page.route("**/api/order", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "stock_short", item: "oud-large", left }) }));
        await page.click("#confirm");
        await settle(page);
        rec("refused-" + left, await snap(page));
        data["stockAsked" + left] = stock > 0;
        await page.click(".pm-fix");
        await settle(page);
        rec("fixed-" + left, await snap(page));
        data["basket" + left] = await page.evaluate("sessionStorage.getItem('lm_cart')");
        await ctx.close();
      }
    });
  }, 180_000);

  it("refused: cod_not_offered (switched off after the page loaded) and offer_closed", async () => {
    await both("refusals", async (side, rec, data) => {
      /* cash switched off for Oman after the page drew the cash button */
      let o = await openPage(side, "/checkout.html?country=OM", { cart: [LINE("oud", "large", 1)] });
      await fillForm(o.page, { name: "سارة", phone: "91234567" });
      await o.page.click('[data-pay="cod"]');
      const off = baseCatalogue();
      off.countries.forEach((x) => x.code === "OM" && (x.codOn = false));
      await side.publish(off);
      let [res] = await Promise.all([o.page.waitForResponse((r) => r.url().endsWith("/api/order")), o.page.click("#confirm")]);
      data.codStatus = res.status();
      data.codBody = await res.json();
      await settle(o.page);
      rec("cod-refused", await snap(o.page));
      data.codQueue = await o.page.evaluate("localStorage.getItem('lm_order_queue')");
      await o.ctx.close();
      await side.publish(baseCatalogue());

      /* the set's window closed after the page loaded */
      o = await openPage(side, "/checkout.html?country=OM", { cart: [{ scentId: "bundle", sizeId: "bundle", qty: 1, scent: "set", size: "", price: 1 }] });
      await fillForm(o.page, { name: "سارة", phone: "91234567" });
      await o.page.click('[data-pay="cod"]');
      const closed = baseCatalogue();
      if (closed.offer) closed.offer.active = false;
      await side.publish(closed);
      [res] = await Promise.all([o.page.waitForResponse((r) => r.url().endsWith("/api/order")), o.page.click("#confirm")]);
      data.offerStatus = res.status();
      data.offerBody = await res.json();
      await settle(o.page);
      rec("offer-refused", await snap(o.page));
      await o.ctx.close();
    });
  }, 180_000);

  it("the country-change dialog: blocked lines stop the drawer's pay and the submit", async () => {
    await both("availability", async (side, rec) => {
      const c = baseCatalogue();
      c.countries.forEach((x) => {
        if (x.code === "KW") (x as Record<string, unknown>).scents = c.scents.map((s) => (s.id === "amber" ? { ...s, soldOut: true } : s));
      });
      await side.publish(c);
      const { ctx, page } = await openPage(side, "/checkout.html?country=KW", { cart: [LINE("oud", "large", 1), LINE("amber", "large", 1)] });
      rec("marked", await snap(page));
      await fillForm(page, { name: "سارة", phone: "51234567" });
      await page.click("#confirm");
      await settle(page, 200);
      rec("dialog", await snap(page, "#pop", ".avail-panel"));
      await page.click("[data-pop-drop]");
      await settle(page);
      rec("dropped", await snap(page));
      await ctx.close();
    });
  }, 180_000);
});
