/**
 * Boots a FRESH copy of the storefront core in happy-dom, the way a page load would: the
 * module registry is reset, storage and window.name are as the test sets them, the page's
 * language, address and fetch are the test's. (The original suites eval'd store.js into a
 * hand-rolled DOM stub; this is the same idea with a real DOM.)
 */
import { vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LmApi, Catalogue } from "../../../src/web/core/types";

export const REPO = path.resolve(__dirname, "../../..");
export const read = (f: string) => readFileSync(path.join(REPO, f), "utf8");
export const catalogueFile = (): Catalogue => JSON.parse(read("data/catalogue.json"));

export interface Call {
  url: string;
  init?: RequestInit;
}

export interface BootOpts {
  lang?: "ar" | "en";
  /** the page address (path + query), e.g. "/?country=AE" */
  url?: string;
  local?: Record<string, string>;
  session?: Record<string, string>;
  windowName?: string;
  /** answers fetch; default: the bundled catalogue for /api/settings, OM for /api/geo, nothing else */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** the catalogue /api/settings answers with (default data/catalogue.json) */
  catalogue?: Catalogue | null;
  /** the server's Date header (default: none) */
  serverDate?: number;
  geo?: string | null;
  /** install the English words before the core (what entries/en.ts does) */
  english?: boolean;
  /** an early geo answer left by the head's script */
  earlyGeo?: Promise<string | null>;
  assetV?: string;
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status || 200, headers: { "content-type": "application/json", ...(init.headers || {}) } });
}

export async function bootCore(o: BootOpts = {}): Promise<{ LM: LmApi; calls: Call[] }> {
  vi.resetModules();
  document.documentElement.lang = o.lang || "ar";
  history.replaceState(null, "", o.url || "/");
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* a test replaced them */
  }
  Object.entries(o.local || {}).forEach(([k, v]) => localStorage.setItem(k, v));
  Object.entries(o.session || {}).forEach(([k, v]) => sessionStorage.setItem(k, v));
  window.name = o.windowName || "";
  delete (window as { LM_EN?: unknown }).LM_EN;
  window.__lmGeo = o.earlyGeo || null;
  (globalThis as { __LM_ASSET_V__?: string }).__LM_ASSET_V__ = o.assetV;
  const calls: Call[] = [];
  const cat = o.catalogue === undefined ? catalogueFile() : o.catalogue;
  const answer =
    o.fetch ||
    ((url: string) => {
      if (url === "/api/settings") {
        const headers: Record<string, string> = {};
        if (o.serverDate != null) headers.date = new Date(o.serverDate).toUTCString();
        return Promise.resolve(cat ? json(cat, { headers }) : json({ error: "x" }, { status: 500, headers }));
      }
      if (url === "/api/geo") return Promise.resolve(json({ country: o.geo === undefined ? "OM" : o.geo }));
      return Promise.reject(new Error("offline"));
    });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  });
  if (o.english) await import("../../../src/web/entries/en");
  const mod = await import("../../../src/web/core");
  return { LM: mod.LM, calls };
}

/** settle the boot (LM.ready) */
export async function ready(o: BootOpts = {}): Promise<{ LM: LmApi; calls: Call[] }> {
  const r = await bootCore(o);
  await r.LM.ready;
  return r;
}

/** the market by code, from the LM's catalogue */
export function market(LM: LmApi, code: string) {
  return LM.cfg.countries.find((c) => c.code === code)!;
}
