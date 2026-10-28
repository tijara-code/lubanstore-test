/**
 * What the admin panel's end-to-end suites share: a browser, signing in (the e2e server's
 * invented admin, tests/e2e/global-setup.ts), seeding orders through the fake-mode route
 * (POST /__fake/admin/orders) and the admin API, the console's errors, and the page-width check.
 */
import { inject } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const BASE = () => inject("baseUrl");
export const USER = "e2e-keeper";
export const PASS = "e2e-password-not-a-secret";

/** Refusals the tests cause on purpose show in Chrome's console as failed loads: not errors of the page. */
const EXPECTED = /Failed to load resource: the server responded with a status of (401|409|429)/;

export interface Session {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  errors: string[];
}

export async function openBrowser(opts: { ip?: string; width?: number; height?: number } = {}): Promise<Session> {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: opts.width || 1366, height: opts.height || 900 },
    // the login lockout is counted per address: each suite is its own address
    extraHTTPHeaders: opts.ip ? { "x-forwarded-for": opts.ip } : {},
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !EXPECTED.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  return { browser, ctx, page, errors };
}

export async function signIn(page: Page): Promise<void> {
  await page.goto(BASE() + "/admin/");
  await page.fill("#u", USER);
  await page.fill("#p", PASS);
  await page.click("button[type=submit]");
  await page.waitForSelector(".nav-btn[data-tab=overview]");
}

/** POST through the admin API with the page's session (the CSRF header added). */
export async function adminPost<T = Record<string, unknown>>(page: Page, method: "POST" | "PUT" | "PATCH", path: string, data: unknown): Promise<T> {
  const r = await page.request.fetch(BASE() + "/api/admin" + path, { method, data, headers: { "X-LM-Admin": "1", Origin: BASE() } });
  return (await r.json()) as T;
}

export async function adminGet<T = Record<string, unknown>>(page: Page, path: string): Promise<T> {
  const r = await page.request.get(BASE() + "/api/admin" + path);
  return (await r.json()) as T;
}

/** Orders written as they are (fake mode only). → their ids */
export async function seedOrders(page: Page, orders: Array<Record<string, unknown>>): Promise<string[]> {
  const r = await page.request.post(BASE() + "/__fake/admin/orders", { data: { orders } });
  const j = (await r.json()) as { ok: boolean; ids: string[] };
  if (!j.ok) throw new Error("seed refused: " + JSON.stringify(j));
  return j.ids;
}

/** No sideways scroll: the page is no wider than the window. */
export async function pageWidth(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
}

/** A word only this run uses, for names to find again in a shared database. */
export const runTag = () => "e2e" + Date.now().toString(36).slice(-5);
