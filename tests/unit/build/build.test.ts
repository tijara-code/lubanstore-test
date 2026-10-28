/**
 * The build: make-en, Vite, the published copy and its checks (scripts/build.ts).
 * Builds once into a temporary folder and reads what came out.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSite, leftovers, missingRefs, stripHtmlComments } from "../../../scripts/build";
import { assetVersion, pixelIds, DEFAULT_META_PIXEL_ID, DEFAULT_SNAP_PIXEL_ID } from "../../../scripts/site-meta";
import { netlifyHeadersFile } from "../../../src/server/site-headers";

let OUT = "";
const page = (f: string) => readFileSync(path.join(OUT, f), "utf8");
const PAGES = ["index.html", "checkout.html", "privacy.html", "404.html", "en/index.html", "en/checkout.html", "en/privacy.html", "admin/index.html"];
/** the module scripts a page loads, in order */
const scripts = (h: string) => [...h.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]!);
/** every chunk a page reaches through static imports */
function reach(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const js = readFileSync(path.join(OUT, file), "utf8");
  for (const m of js.matchAll(/(?:import|from)\s*["']\.\/([\w.-]+\.js)["']/g)) reach("assets/" + m[1], seen);
  return seen;
}

beforeAll(async () => {
  OUT = mkdtempSync(path.join(os.tmpdir(), "lm-build-"));
  await buildSite({ outDir: OUT, log: () => {} });
  return () => rmSync(OUT, { recursive: true, force: true });
}, 120_000);

describe("the published site", () => {
  it("has the eight pages, the static files, the fonts and the headers", () => {
    for (const f of PAGES.concat(["robots.txt", "sitemap.xml", "favicon.svg", "apple-touch-icon.png", "assets/fonts/fonts.css", "assets/fonts/fonts-en.css", "assets/img/white-box-open.avif", "assets/media/show-1.mp4"])) {
      expect(existsSync(path.join(OUT, f)), f).toBe(true);
    }
    expect(page("_headers")).toBe(netlifyHeadersFile());
    // the original pages' fallback path (an old page still open after the switch)
    expect(JSON.parse(page("data/settings.json")).countries.length).toBeGreaterThan(0);
  });

  // from build-site.js: every local file a page names is in the copy
  it("every local reference exists, nothing unfilled, no source path, no font host", () => {
    expect(missingRefs(OUT)).toEqual([]);
    expect(leftovers(OUT)).toEqual([]);
  });

  // from test-cache-bust.js (now: hashed names) / test-v401.js
  it("code is named by content hash; images, clips and the fonts' CSS carry the files' hash", () => {
    const v = assetVersion();
    for (const f of PAGES) {
      const h = page(f);
      const code = [...h.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
      for (const c of code) expect(c, f).toMatch(/^\/assets\/[\w.-]+-[\w-]{8}\.(js|css)$/);
      const media = [...h.matchAll(/(?:src|href|srcset|data-src|data-poster)="((?:\.\.\/|\/)?assets\/(?:img|media|fonts)\/[^"]+)"/g)].map((m) => m[1]!);
      for (const m of media) if (!/\.woff2$/.test(m)) expect(m, f).toMatch(new RegExp("\\?v=" + v + "$"));
    }
    expect(page("index.html")).toMatch(/assets\/img\/white-box-open\.avif\?v=/);
    // the build id is on every page
    for (const f of PAGES) expect(page(f)).toMatch(/<meta name="build" content="[\w.-]+">/);
  });

  it("the cascade is the original's: style.css, (the page's inline style), desktop.css from 768 px", () => {
    for (const f of ["index.html", "checkout.html", "privacy.html", "en/index.html", "en/checkout.html", "en/privacy.html"]) {
      const h = page(f);
      const style = h.search(/<link rel="stylesheet" href="\/assets\/style-[\w-]+\.css" media="all">/);
      const desk = h.search(/<link rel="stylesheet" href="\/assets\/desktop-[\w-]+\.css" media="\(min-width: 768px\)">/);
      expect(style, f).toBeGreaterThan(0);
      expect(desk, f).toBeGreaterThan(style);
      if (/checkout/.test(f)) expect(h.indexOf("<style>")).toBeGreaterThan(desk);
      // no stylesheet was injected anywhere else
      expect((h.match(/rel="stylesheet"/g) || []).length).toBe(4); // fonts (print→all), its noscript copy, style, desktop
    }
    expect(page("404.html")).not.toMatch(/desktop-/);
    // the stylesheets were minified (the comments gone)
    const css = readdirSync(path.join(OUT, "assets")).filter((f) => /^style-.*\.css$/.test(f))[0]!;
    expect(readFileSync(path.join(OUT, "assets", css), "utf8")).not.toMatch(/\/\*/);
  });

  it("the catalogue preload is still the first request, and the pages carry no HTML comments", () => {
    for (const f of ["index.html", "checkout.html"]) {
      const h = page(f);
      const pre = h.indexOf('<link rel="preload" as="fetch" href="/api/settings" crossorigin>');
      expect(pre).toBeGreaterThan(0);
      expect(pre).toBeLessThan(h.indexOf("<script"));
      expect(h).not.toMatch(/<!--/);
    }
  });

  it("fonts are self-hosted and load like the original's (no font preload competing with the first paint); English pages only the Latin face", () => {
    expect(page("index.html")).toMatch(/href="\/assets\/fonts\/fonts\.css\?v=/);
    for (const f of ["index.html", "checkout.html", "en/index.html", "en/checkout.html"]) expect(page(f)).not.toMatch(/as="font"/);
    for (const f of ["en/index.html", "en/checkout.html", "en/privacy.html"]) {
      expect(page(f)).toMatch(/href="\/assets\/fonts\/fonts-en\.css\?v=/);
      expect(page(f)).not.toMatch(/ibmplexsansarabic|amiri|fonts\.css/);
    }
    const css = page("assets/fonts/fonts.css");
    for (const m of css.matchAll(/url\(([^)]+)\)/g)) expect(existsSync(path.join(OUT, "assets/fonts", m[1]!)), m[1]).toBe(true);
    expect((css.match(/@font-face \{/g) || []).length).toBe(36);
    expect((page("assets/fonts/fonts-en.css").match(/@font-face \{/g) || []).length).toBe(10);
  });

  it("the page scripts load at low priority, like the original's deferred scripts (the stylesheet and hero photo first)", () => {
    for (const f of ["index.html", "checkout.html", "en/index.html", "en/checkout.html", "privacy.html", "404.html"]) {
      const h = page(f);
      expect(h, f).toMatch(/<script type="module" crossorigin fetchpriority="low" src=/);
      expect(h, f).not.toMatch(/<link rel="modulepreload" crossorigin href=/);
    }
  });

  it("the public pixel ids: the original's unless the build's environment names others (validated)", () => {
    expect(page("index.html")).toContain("var PIXEL_ID = '" + DEFAULT_META_PIXEL_ID + "';");
    expect(page("index.html")).toContain("snaptr('init', '" + DEFAULT_SNAP_PIXEL_ID + "', u);");
    expect(pixelIds({ META_PIXEL_ID: "123456789", SNAP_PIXEL_ID: "aaaa-bbbb-cccc" })).toEqual({ meta: "123456789", snap: "aaaa-bbbb-cccc" });
    expect(() => pixelIds({ META_PIXEL_ID: "1'; alert(1); '" })).toThrow();
  });
});

describe("the pages' scripts", () => {
  // the chunk that holds the core (found by what it does — its name follows Rolldown's chunking):
  // the parked-order queue's storage key lives only in src/web/core/orders.ts
  const coreChunk = () =>
    readdirSync(path.join(OUT, "assets")).find((f) => f.endsWith(".js") && readFileSync(path.join(OUT, "assets", f), "utf8").includes("lm_order_queue"))!;

  it("the product page and the checkout reach the core; privacy and 404 do not (no catalogue, no geo there)", () => {
    const core = "assets/" + coreChunk();
    for (const f of ["index.html", "checkout.html", "en/index.html", "en/checkout.html"]) {
      const s = scripts(page(f));
      expect(s.length, f).toBeGreaterThan(0);
      const all = new Set<string>();
      s.forEach((x) => reach(x.replace(/^\//, ""), all));
      expect(all.has(core), f).toBe(true);
    }
    for (const f of ["privacy.html", "404.html", "en/privacy.html"]) {
      const all = new Set<string>();
      scripts(page(f)).forEach((x) => reach(x.replace(/^\//, ""), all));
      expect(all.has(core), f).toBe(false);
    }
  });

  it("the English pages load the English words before the page's own modules (strict execution order)", () => {
    for (const f of ["en/index.html", "en/checkout.html"]) {
      const entry = scripts(page(f))[0]!.replace(/^\//, "");
      const js = readFileSync(path.join(OUT, entry), "utf8");
      // the entry runs its imports' init functions in source order: the English words first
      const names = [...js.matchAll(/import\{t(?: as (\w+))?\}from"\.\/([\w-]+)-[\w-]{8}\.js"/g)].map((m) => [m[1] || "t", m[2]!] as const);
      const en = names.find(([, n]) => n === "en");
      expect(en, js).toBeTruthy();
      // the entry's body calls its imports' init functions in source order: the English words' first
      const body = js.slice(js.lastIndexOf("(()=>{") + 6);
      const first = /^(\w+)\(\)/.exec(body);
      expect(first && first[1], js).toBe(en![0]);
    }
    for (const f of ["index.html", "checkout.html"]) {
      const all = new Set<string>();
      scripts(page(f)).forEach((x) => reach(x.replace(/^\//, ""), all));
      expect([...all].some((x) => /\/en-/.test(x)), f).toBe(false);
    }
  });

  it("the head scripts are kept verbatim (lang-remember, early, the pixels, JSON-LD)", () => {
    const src = readFileSync(path.join(__dirname, "../../../site/index.html"), "utf8");
    const out = page("index.html");
    for (const id of ["lang-remember", "early"]) {
      const re = new RegExp('<script id="' + id + '">[\\s\\S]*?<\\/script>');
      expect(re.exec(out)![0]).toBe(re.exec(src)![0]);
    }
    expect(out).toContain('<script type="application/ld+json">');
    expect(out).toContain("window.LM && window.LM.ready");
  });
});

describe("helpers", () => {
  it("stripHtmlComments keeps newlines and leaves scripts and styles alone", () => {
    expect(stripHtmlComments("a<!-- x\ny -->b")).toBe("a\nb");
    expect(stripHtmlComments("<script>var s = '<!-- not a comment -->';</script>")).toBe("<script>var s = '<!-- not a comment -->';</script>");
    expect(stripHtmlComments("<style>/* x */ a{}</style><!--c-->")).toBe("<style>/* x */ a{}</style>");
  });
});
