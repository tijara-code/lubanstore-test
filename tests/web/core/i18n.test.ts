import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { read, ready, REPO } from "./_boot";
import { LM_EN } from "../../../src/web/core/i18n-en";
import { LM_CITIES } from "../../../src/web/core/cities";
import { build, FILES, KEEP } from "../../../scripts/make-en";

afterEach(() => vi.unstubAllGlobals());

const AR = /[؀-ۿ]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/i18n-en\.ts$/.test(e)) out.push(p);
  }
  return out;
}

// from test-i18n.js: L() and txt()
describe("the helpers", () => {
  it("L() in Arabic returns the Arabic, filled", async () => {
    const { LM } = await ready({});
    expect(LM.lang).toBe("ar");
    expect(LM.L("وفر {p}", { p: "7" })).toBe("وفر 7");
    expect(LM.L("السلة")).toBe("السلة");
    // a placeholder with nothing to fill it stays as written
    expect(LM.L("وفر {p}", {})).toBe("وفر {p}");
  });

  it("L() in English returns the English, filled; a missing entry falls back to the Arabic", async () => {
    const { LM } = await ready({ lang: "en", english: true });
    expect(LM.lang).toBe("en");
    expect(LM.L("وفر {p}", { p: "7" })).toBe("Save 7");
    expect(LM.L("نص بلا ترجمة")).toBe("نص بلا ترجمة");
    // an entry that is a function inflects
    expect(LM.L("باقي {n} يوم", { n: 1, count: 1 })).toBe("1 day left");
    expect(LM.L("باقي {h} ساعة", { h: 5, count: 5 })).toBe("5 hours left");
  });

  it("txt(): the English box, else the Arabic; a CLEARED Arabic badge hides the English one", async () => {
    const size = { name: "كبير", name_en: "Large", tag: "", tag_en: "Best seller" };
    const en = (await ready({ lang: "en", english: true })).LM;
    expect(en.txt(size, "name")).toBe("Large");
    expect(en.txt({ name: "كبير", name_en: "" }, "name")).toBe("كبير");
    expect(en.txt(size, "tag")).toBe("");
    expect(en.txt(null, "name")).toBe("");
    const ar = (await ready({})).LM;
    expect(ar.txt(size, "name")).toBe("كبير");
  });

  it("the English words are installed only by the English entry", async () => {
    const { LM } = await ready({});
    expect(window.LM_EN).toBeUndefined();
    expect(LM.L("وفر {p}", { p: "7" })).toBe("وفر 7");
  });
});

// from test-i18n.js: every message has English
describe("every message has English", () => {
  it('every L("…") in the storefront code has an entry', () => {
    const keys = new Set<string>();
    for (const f of walk(path.join(REPO, "src/web"))) {
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/\bL\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse('"' + m[1] + '"'));
    }
    expect(keys.size).toBeGreaterThan(5);
    expect([...keys].filter((k) => AR.test(k) && LM_EN[k] == null)).toEqual([]);
  });

  it("every city and governorate, in all six markets (Ajman among the Emirates)", () => {
    const cities = Object.values(LM_CITIES).flat();
    expect(cities.filter((c) => !LM_EN[c])).toEqual([]);
    for (const k of ["971", "966", "974", "965", "973", "968"]) expect((LM_CITIES[k] || []).length).toBeGreaterThan(0);
    expect(LM_CITIES["971"]!.indexOf("عجمان")).toBeGreaterThan(-1);
    expect(LM_CITIES["968"]!.length).toBe(11);
  });

  it("the checkout installs the shared city list as window.LM_CITIES", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    await import("../../../src/web/entries/checkout");
    expect(window.LM_CITIES).toEqual(LM_CITIES);
  });

  it("every month, and every order-tracking status the server sends", () => {
    const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
    expect(months.filter((m) => !LM_EN[m])).toEqual([]);
    const track = read("src/server/domain/track.ts");
    const stages = [...track.matchAll(/ar: "([^"]+)"/g), ...track.matchAll(/text: "([^"]+)"/g)].map((m) => m[1]!);
    expect(stages.length).toBeGreaterThan(5);
    expect(stages.filter((s) => !LM_EN[s])).toEqual([]);
  });

  it("English says 1 day and 5 days", () => {
    const f = LM_EN["باقي {n} يوم"] as (v: Record<string, unknown>) => string;
    expect(f({ n: 1, count: 1 }) + " / " + f({ n: 5, count: 5 })).toBe("1 day left / 5 days left");
  });

  // from test-v401.js: the English store uses no spaced dashes
  it("no English line uses a spaced dash", () => {
    const values = Object.values(LM_EN).filter((v): v is string => typeof v === "string");
    const page = [...read("scripts/make-en.ts").matchAll(/":\s*"([^"]*)"/g)].map((m) => m[1]!);
    expect(values.concat(page).filter((v) => /\s[—–-]\s/.test(v))).toEqual([]);
  });
});

// from test-i18n.js: the English pages (make-en)
describe("the English pages", () => {
  for (const f of FILES) {
    it("en/" + f + ": every Arabic word has English, and nothing Arabic is left but the way back", () => {
      const built = build(f);
      let rest = built.html;
      KEEP.forEach((k) => (rest = rest.split(k).join("")));
      expect(AR.test(rest)).toBe(false);
      expect(built.html).toMatch(/<html lang="en" dir="ltr" class="pg2 pg3">/);
      // every asset one level up; no bare assets/
      expect(/\s(?:src|href|srcset)="assets\//.test(built.html)).toBe(false);
      // only the Latin face: the English fonts' CSS, and no Arabic face preloaded
      expect(built.html).toMatch(/\/assets\/fonts\/fonts-en\.css\?v=__ASSET_V__/);
      expect(/fonts\.css\?|ibmplexsansarabic|amiri|Almarai|fonts\.googleapis/i.test(built.html)).toBe(false);
      // the Arabic page does not load the English words
      expect(read("site/" + f)).not.toMatch(/entries\/en\.ts/);
      if (/entries\/(home|checkout)\.ts/.test(built.html)) {
        // the English words, immediately before the page's entry (which loads the core)
        expect(built.html).toMatch(/<script type="module" src="\/src\/web\/entries\/en\.ts"><\/script>\n<script type="module" src="\/src\/web\/entries\/(home|checkout)\.ts"><\/script>/);
      } else {
        expect(built.html).not.toMatch(/entries\/en\.ts/);
      }
    });
  }

  it("a word with no English stops the generator", () => {
    expect(() => build("index.html", path.join(REPO, "tests/web/core/fixtures"))).toThrow(/No English for:\n {2}كلمة جديدة بلا ترجمة/);
  });

  it("the switch: EN / عربي point the right way on every page", () => {
    const sw = (h: string) => (/<nav class="lang"[\s\S]*?<\/nav>/.exec(h) || [""])[0];
    const ar = (f: string) => read("site/" + f);
    const en = (f: string) => build(f).html;
    expect(sw(ar("index.html"))).toMatch(/href="en\/"[^>]*data-lang="en">EN/);
    expect(sw(ar("index.html"))).toMatch(/data-lang="ar" aria-current="page">عربي/);
    expect(sw(en("index.html"))).toMatch(/data-lang="en" aria-current="page">EN/);
    expect(sw(en("index.html"))).toMatch(/href="\.\.\/\?lang=ar"[^>]*>عربي/);
    expect(sw(ar("checkout.html"))).toMatch(/href="en\/checkout\.html"/);
    expect(sw(en("checkout.html"))).toMatch(/href="\.\.\/checkout\.html\?lang=ar"/);
    expect(sw(ar("privacy.html"))).toMatch(/href="en\/privacy\.html"/);
    expect(sw(en("privacy.html"))).toMatch(/href="\.\.\/privacy\.html\?lang=ar"/);
    expect(en("index.html")).toMatch(/class="ftr-link" href="privacy\.html"/);
    expect(en("index.html")).not.toMatch(/href="\.\.\/privacy\.html"/);
    expect(ar("index.html").indexOf('class="lang"')).toBeLessThan(ar("index.html").indexOf('class="cart"'));
  });

  it("remembering the choice: the same lang-remember script on the three Arabic pages, before any pixel", () => {
    const head = read("site/index.html");
    expect(head).toMatch(/localStorage\.getItem\("lm_lang"\) === "en"/);
    expect(head).toMatch(/location\.replace\("\/en\/"/);
    expect(head.indexOf('id="lang-remember"')).toBeLessThan(head.indexOf("snaptr("));
    expect(head).toMatch(/setItem\("lm_lang", "ar"\)/);
    const remember = (f: string) => (/<script id="lang-remember">[\s\S]*?<\/script>/.exec(read("site/" + f)) || [""])[0];
    expect(remember("index.html")).toBe(remember("checkout.html"));
    expect(remember("index.html")).toBe(remember("privacy.html"));
    expect(build("index.html").html).toMatch(/localStorage\.setItem\("lm_lang", "en"\)/);
  });

  it("search engines: hreflang, canonicals, the sitemap and robots", () => {
    expect(read("site/index.html")).toMatch(/hreflang="en" href="https:\/\/lubanmusk\.com\/en\/"/);
    expect(build("index.html").html).toMatch(/<link rel="canonical" href="https:\/\/lubanmusk\.com\/en\/">/);
    expect(build("privacy.html").html).toMatch(/<link rel="canonical" href="https:\/\/lubanmusk\.com\/en\/privacy\.html">/);
    expect(build("index.html").html).toMatch(/<meta property="og:locale" content="en_US">/);
    const map = read("site/public/sitemap.xml");
    expect(map).toMatch(/<loc>https:\/\/lubanmusk\.com\/<\/loc>/);
    expect(map).toMatch(/<loc>https:\/\/lubanmusk\.com\/en\/<\/loc>/);
    expect(map).toMatch(/<loc>https:\/\/lubanmusk\.com\/en\/privacy\.html<\/loc>/);
    expect(read("site/public/robots.txt")).toMatch(/Disallow: \/en\/checkout\.html/);
    expect(read("site/privacy.html")).toMatch(/hreflang="en" href="https:\/\/lubanmusk\.com\/en\/privacy\.html"/);
  });

  it("the look: Arial on the English store, the Arabic keeps its faces, the wordmark its own", () => {
    const css = read("site/assets/css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/:root\[lang="en"\] \{\s*--sans: Arial,[^;]*sans-serif;/);
    expect(css).toMatch(/:root \{[^}]*--sans:\s*"Almarai"/);
    expect(css).toMatch(/\.logo \{[^}]*font-family: var\(--latin\)/);
    const star = (/<span class="stars"[^>]*>([\s\S]*?)<\/span>/.exec(read("site/index.html")) || ["", ""])[1];
    expect(star).toBe("<i>★</i>".repeat(4) + '<i class="half">★</i>');
  });
});

// from test-i18n.js: the catalogue's English (the bundled file)
describe("the catalogue's English", () => {
  it("the bundled scents, sizes, extras, the set and every country carry English", () => {
    const cat = JSON.parse(read("data/catalogue.json"));
    const lists: Array<[string, string[]]> = [["scents", ["name", "notes"]], ["sizes", ["name", "weight"]], ["extras", ["name", "note"]]];
    for (const [kind, fields] of lists) expect(cat[kind].filter((x: Record<string, unknown>) => fields.some((k) => !x[k + "_en"]))).toEqual([]);
    expect(["name", "note", "badge"].every((k) => cat.offer[k + "_en"])).toBe(true);
    expect(cat.countries.filter((c: { name_en?: string }) => !c.name_en)).toEqual([]);
  });
});
