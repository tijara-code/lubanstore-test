/**
 * VISUAL COMPARISON — the new storefront against the original, page by page, width by width.
 *
 *   node --import tsx scripts/compare-screens.ts --ref http://localhost:4100 --new http://localhost:8888 \
 *        [--out .tmp/screens] [--js] [--widths 320,390,768,1366] [--pages /,/checkout.html,...] [--threshold 24]
 *
 * The reference is the ORIGINAL built site with its real handlers (node /home/claude/tools/ref-server.js 4100).
 * For each page and width both sides are opened in Chromium with:
 *   - every host blocked but localhost and the Google font hosts (the original loads its fonts there),
 *   - a frozen clock (page.clock at 2026-10-01T09:00:00+04:00) and a fixed Math.random,
 *   - the same viewport, device scale 1, locale ar, no animations (reduced motion),
 *   - JavaScript OFF unless --js (the static parts — markup, CSS, fonts — are what match before the
 *     page scripts are ported; with --js the scripted parts are compared too).
 * Full-page PNGs of both, and a diff image (differing pixels red over a faded copy of the reference),
 * are written to --out; the share of differing pixels per pair is printed and written to report.json.
 * Two pages of different heights are compared over the taller one (the missing rows all differ).
 * The comparison runs in a browser canvas, so it needs nothing beyond Playwright.
 */
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const DEFAULT_PAGES = ["/", "/checkout.html", "/privacy.html", "/no-such-page", "/en/", "/en/checkout.html", "/en/privacy.html"];
const DEFAULT_WIDTHS = [320, 390, 768, 1366];
const FROZEN = Date.parse("2026-10-01T09:00:00+04:00");

interface Args {
  ref: string;
  neu: string;
  out: string;
  js: boolean;
  widths: number[];
  pages: string[];
  threshold: number;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string) => {
    const i = argv.indexOf("--" + k);
    return i > -1 ? argv[i + 1] : undefined;
  };
  return {
    ref: (get("ref") || "http://localhost:4100").replace(/\/$/, ""),
    neu: (get("new") || "http://localhost:8888").replace(/\/$/, ""),
    out: path.resolve(get("out") || ".tmp/screens"),
    js: argv.includes("--js"),
    widths: (get("widths") || DEFAULT_WIDTHS.join(",")).split(",").map(Number).filter((n) => n > 0),
    pages: (get("pages") || DEFAULT_PAGES.join(",")).split(","),
    threshold: Number(get("threshold") || 24),
  };
}

const slug = (p: string) => (p.replace(/^\/|\/$/g, "").replace(/[^\w.-]+/g, "_") || "home").replace(/\.html$/, "");

async function shoot(ctx: BrowserContext, url: string, js: boolean): Promise<Buffer> {
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const h = new URL(r.request().url()).host;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$|^fonts\.(googleapis|gstatic)\.com$/.test(h)) return r.continue();
    return r.abort();
  });
  if (js) {
    await page.clock.install({ time: FROZEN });
    await page.addInitScript(() => {
      let s = 42;
      Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    });
  }
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  if (js) {
    await page.evaluate("document.fonts.ready.then(function () { return 1; })").catch(() => {});
    await page.clock.runFor(5000).catch(() => {});
  }
  /* walk down the page so lazy images (loading=lazy) load on both sides, then back up */
  const vh = page.viewportSize()?.height || 900;
  for (let y = 0; y < 12000; y += vh) await page.mouse.wheel(0, vh);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.mouse.wheel(0, -20000);
  await page.waitForTimeout(800);
  const png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  await page.close();
  return png;
}

/** the in-page comparison (plain JavaScript): share of differing pixels, and a diff PNG */
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
  var da = data(ia), db = data(ib);
  var out = document.createElement("canvas"); out.width = w; out.height = h;
  var ox = out.getContext("2d"), img = ox.createImageData(w, h), n = 0;
  for (var i = 0; i < da.length; i += 4) {
    var d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
    if (d > o.threshold) { n++; img.data[i] = 255; img.data[i + 1] = 0; img.data[i + 2] = 0; }
    else { var g = 200 + (da[i] + da[i + 1] + da[i + 2]) / 15; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; }
    img.data[i + 3] = 255;
  }
  ox.putImageData(img, 0, 0);
  return { ratio: n / (w * h), size: ia.width + "x" + ia.height + " vs " + ib.width + "x" + ib.height, diff: out.toDataURL("image/png") };
}`;

/** share of differing pixels, and a diff PNG, computed in a canvas */
async function compare(page: Page, a: Buffer, b: Buffer, threshold: number): Promise<{ ratio: number; size: string; diff: Buffer }> {
  /* passed as text: the TypeScript loader would wrap a function in helpers the page lacks */
  const r = (await page.evaluate(
    "(" + IN_PAGE + ")(" + JSON.stringify({ a: "data:image/png;base64," + a.toString("base64"), b: "data:image/png;base64," + b.toString("base64"), threshold }) + ")",
  )) as { ratio: number; size: string; diff: string };
  return { ratio: r.ratio, size: r.size, diff: Buffer.from(r.diff.split(",")[1]!, "base64") };
}

export async function compareScreens(args: Args): Promise<Array<{ page: string; width: number; ratio: number; size: string }>> {
  mkdirSync(args.out, { recursive: true });
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser: Browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {});
  const tool = await (await browser.newContext()).newPage();
  const rows: Array<{ page: string; width: number; ratio: number; size: string }> = [];
  try {
    for (const p of args.pages) {
      for (const w of args.widths) {
        const opts = {
          viewport: { width: w, height: w < 500 ? 844 : 900 },
          deviceScaleFactor: 1,
          locale: "ar",
          reducedMotion: "reduce" as const,
          javaScriptEnabled: args.js,
          ignoreHTTPSErrors: true,
          /* the same edge country on both sides: ref-server.js answers every request as from
             Oman (x-country: OM); the new server reads the same header when no edge geo is set */
          extraHTTPHeaders: { "x-country": "OM" },
        };
        let r: { ratio: number; size: string; diff: Buffer };
        const base = slug(p) + "-" + w;
        try {
          const ca = await browser.newContext(opts);
          const cb = await browser.newContext(opts);
          const [a, b] = await Promise.all([shoot(ca, args.ref + p, args.js), shoot(cb, args.neu + p, args.js)]);
          await ca.close();
          await cb.close();
          writeFileSync(path.join(args.out, base + "-ref.png"), a);
          writeFileSync(path.join(args.out, base + "-new.png"), b);
          r = await compare(tool, a, b, args.threshold);
          writeFileSync(path.join(args.out, base + "-diff.png"), r.diff);
          rows.push({ page: p, width: w, ratio: r.ratio, size: r.size });
        } catch (e) {
          /* one pair failing (a crashed tab) does not stop the run; it is reported as such */
          rows.push({ page: p, width: w, ratio: NaN, size: "error: " + String((e as Error).message).split("\n")[0] });
          console.log(`${p.padEnd(20)} ${String(w).padStart(5)}px  failed: ${String((e as Error).message).split("\n")[0]}`);
          continue;
        }
        console.log(`${p.padEnd(20)} ${String(w).padStart(5)}px  ${(r.ratio * 100).toFixed(3).padStart(8)}% differ   (${r.size})`);
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(args.out, "report.json"), JSON.stringify({ js: args.js, ref: args.ref, new: args.neu, threshold: args.threshold, rows }, null, 2));
  return rows;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  compareScreens(args).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { parseArgs };
