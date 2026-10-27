/**
 * Where the tracking modules load, what names they fire, the 8-second cap on a held batch.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LM_NAMES } from "../../../src/shared/pixels/catalogue";
import { dropListeners, loadPage } from "./_page";

const REPO = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(REPO, f), "utf8");
const imports = (f: string) => [...read(f).matchAll(/^import\s+(?:[^"']+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]!);

afterEach(() => { dropListeners(); vi.useRealTimers(); });

// from test-beacon.js / test-stats.js: stats loads before pixel; the tracker ships on every storefront page
describe("the entries", () => {
  for (const e of ["home", "checkout"]) {
    it(e + ": the core, then stats, then pixel — before any other page module", () => {
      const list = imports("src/web/entries/" + e + ".ts").filter((x) => x.startsWith("../") && !x.startsWith("../core/"));
      expect(list.slice(0, 3)).toEqual(["../core", "../tracking/stats", "../tracking/pixel"]);
    });
  }
  for (const e of ["privacy", "notfound"]) {
    it(e + ": stats only — no core, no pixel (the original loaded stats.js alone)", () => {
      const list = imports("src/web/entries/" + e + ".ts");
      expect(list).toContain("../tracking/stats");
      expect(list.some((x) => x.includes("core") || x.includes("pixel"))).toBe(false);
    });
  }
  it("the pages load those entries (and the English ones the same)", () => {
    expect(read("site/index.html")).toContain("/src/web/entries/home.ts");
    expect(read("site/checkout.html")).toContain("/src/web/entries/checkout.ts");
    expect(read("site/privacy.html")).toContain("/src/web/entries/privacy.ts");
    expect(read("site/404.html")).toContain("/src/web/entries/notfound.ts");
  });
  it("stats and pixel import nothing of the core but types (privacy and 404 run without it)", () => {
    for (const f of readdirSync(path.join(REPO, "src/web/tracking")).filter((x) => x.endsWith(".ts"))) {
      const src = read("src/web/tracking/" + f);
      expect(/^import (?!type)[^;]*["']\.\.\/core/m.test(src)).toBe(false);
    }
  });
});

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(n)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}

// from test-stats.js: every allowlisted event has a caller, and no caller fires an unknown one
describe("the first-party names", () => {
  const all = sources(path.join(REPO, "src/web")).join("\n");
  const fired = [...all.matchAll(/\btrack!?\(\s*"([a-z_]+)"/g)].map((m) => m[1]!);
  it("nothing in the storefront fires a name the collector would drop", () => {
    expect([...new Set(fired)].filter((n) => LM_NAMES.indexOf(n) === -1)).toEqual([]);
  });
  /* the callers outside tracking live in the other page ports (main.js → product, header.js,
     checkout.js); a name is required once its owner's port reports events at all */
  const OWNER: Record<string, string> = { add_cart: "product", offer_add: "product", track_lookup: "product",
    suggest_add: "header", extra_add: "header", order_placed: "checkout" };
  const reports = (d: string) => { try { return /LMEV/.test(sources(path.join(REPO, "src/web", d)).join("\n")); } catch { return false; } };
  it("every allowlisted name has a caller (once its owner's port is in)", () => {
    const missing = LM_NAMES.filter((n) => fired.indexOf(n) === -1 && (!OWNER[n] || reports(OWNER[n]!)));
    expect(missing).toEqual([]);
  });
  it("the names stats fires itself", () => {
    for (const n of ["page_view", "session_start", "checkout_view", "whatsapp_click", "size_open", "cart_open", "pay_method"]) expect(fired).toContain(n);
  });
});

// from test-v209.js: the wait is bounded — 8 s for the queue
describe("the held batch's cap", () => {
  it("goes after 8 seconds whatever happens", async () => {
    const p = await loadPage({ core: false, pixel: false });
    vi.useFakeTimers();
    window.LMBeacon!.hold(() => {});
    window.LMBeacon!.queue("snap", { name: "PAGE_VIEW", id: "a" });
    await vi.advanceTimersByTimeAsync(7_900);
    expect(p.posted.length).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(p.posted.length).toBe(1);
  });
  it("a hold taken after the timer started cancels it", async () => {
    vi.useFakeTimers();
    const p = await loadPage({ core: false, pixel: false });
    window.LMBeacon!.hold(() => {});
    await vi.advanceTimersByTimeAsync(500);
    expect(p.posted.length).toBe(0);
    window.LMBeacon!.release();
    await vi.advanceTimersByTimeAsync(79);
    expect(p.posted.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(p.posted.length).toBe(1);
  });
});
