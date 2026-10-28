/**
 * The admin panel end to end (the built site, the real server, fake services, an in-memory
 * database): signing in (wrong password, lockout), the shell (nav, settings, search, sign
 * out), the Overview's KPIs agreeing with the orders, page width at 360/768/1366, no console
 * errors. Ported UI checks of test-admin-boot.js, test-login-lockout.js (UI), v202, v211, v320,
 * v333, v334 (Overview figures).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as KPI from "../../src/shared/kpi";
import type { OrdersAnswer, OverviewAnswer } from "../../src/shared/admin/api";
import { adminGet, BASE, openBrowser, PASS, pageWidth, runTag, seedOrders, signIn, USER, type Session } from "./admin-helpers";

let s: Session;
const tag = runTag();

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.21" });
});
afterAll(async () => {
  await s.browser.close();
});

describe("signing in", () => {
  it("a wrong password is said in the alert line and the field is cleared", async () => {
    const { page } = s;
    await page.goto(BASE() + "/admin/");
    await page.fill("#u", USER);
    await page.fill("#p", "not-the-password");
    await page.click("button[type=submit]");
    await expect.poll(() => page.textContent("#loginErr")).toBe("Wrong username or password");
    expect(await page.inputValue("#p")).toBe("");
    expect(await page.getAttribute("#loginErr", "role")).toBe("alert");
  });

  // from test-login-lockout.js (the panel's half): the ninth try from one address is refused
  it("after eight wrong tries the panel says 'Too many attempts'", async () => {
    const other = await openBrowser({ ip: "203.0.113." + (10 + Math.floor(Math.random() * 200)) });
    try {
      const { page } = other;
      await page.goto(BASE() + "/admin/");
      for (let i = 0; i < 9; i++) {
        await page.fill("#u", USER);
        await page.fill("#p", "wrong-" + i);
        await page.click("button[type=submit]");
        await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled && document.querySelector("#loginErr")!.textContent !== "");
      }
      expect(await page.textContent("#loginErr")).toBe("Too many attempts. Try again in 15 minutes.");
      // the right password is refused too while locked
      await page.fill("#u", USER);
      await page.fill("#p", PASS);
      await page.click("button[type=submit]");
      await page.waitForTimeout(600);
      expect(await page.textContent("#loginErr")).toBe("Too many attempts. Try again in 15 minutes.");
      expect(other.errors).toEqual([]);
    } finally {
      await other.browser.close();
    }
  });

  it("the right password opens the panel on Overview; the avatar is the user's initials", async () => {
    await signIn(s.page);
    expect(await s.page.textContent("#pageTitle")).toBe("Overview");
    expect(await s.page.textContent("#whoAmI")).toBe("EK");
    expect(await s.page.getAttribute(".nav-btn[data-tab=overview]", "aria-current")).toBe("page");
    expect(await s.page.textContent("body")).toContain("Everything that needs your attention.");
  });
});

describe("the Overview", () => {
  // from test-v320.js / test-v333.js / test-v334.js: the tiles are the KPI module's figures over every order not binned
  it("its KPI tiles agree with the orders (shared/kpi over the whole list)", async () => {
    const { page } = s;
    await seedOrders(page, [
      { name: tag + " done", status: "done", paymentStatus: "paid", total: 40, omr: 40 },
      { name: tag + " void", status: "void", paymentStatus: "cod", total: 20, omr: 20 },
      { name: tag + " binned", status: "done", paymentStatus: "paid", total: 999, omr: 999, trashed: true },
      { name: tag + " cod", status: "new", paymentStatus: "cod", total: 30, omr: 30 },
    ]);
    await page.click("#main .sync");
    await page.waitForTimeout(800);
    const all = await adminGet<OrdersAnswer>(page, "/orders?limit=500&trash=all");
    const k = KPI.compute(all.orders as unknown as Array<Record<string, unknown>>, null);
    const o = await adminGet<OverviewAnswer>(page, "/overview");
    expect(o.orders.all.orders).toBe(k.orders);
    expect(o.orders.all.settled).toBe(k.settled);
    const tiles = await page.$$eval(".kpi", (els) => els.map((e) => e.textContent || ""));
    expect(tiles[0]).toContain("Orders" + k.orders);
    expect(tiles[0]).toMatch(/\d+ this week · [▲▼] \d+%/);
    expect(tiles[1]).toContain("Revenue settled" + KPI.compute(all.orders as never, null).settled);
    expect(tiles[2]).toBe("Delivered" + k.delivered);
    expect(tiles[3]).toBe("Cancelled or failed" + k.cancelled + Math.round((k.cancelled / k.total) * 100) + "% of all orders");
    // the binned order's 999 counts nowhere (test-admin-boot)
    expect(tiles.join(" ")).not.toContain("999");
    // the chart is inline SVG, no library
    expect(await page.getAttribute("#chart svg", "viewBox")).toBe("0 0 620 210");
    expect(await page.getAttribute("#chart path.line", "d")).toMatch(/^M/);
    await page.click(".seg button:has-text('90d')");
    expect(await page.getAttribute(".seg button:has-text('90d')", "aria-pressed")).toBe("true");
    // the latest orders open the order on the Orders tab
    await page.click("#lastBox .mini >> nth=0");
    await page.waitForSelector("tr.detail");
    expect(await page.textContent("#pageTitle")).toBe("Orders");
  });
});

describe("the shell", () => {
  it("the nav is one tab stop moved by the arrow keys; Enter opens the page", async () => {
    const { page } = s;
    await page.click(".nav-btn[data-tab=overview]");
    await page.focus(".nav-btn[data-tab=overview]");
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement!.getAttribute("data-tab"))).toBe("orders");
    await page.keyboard.press("Enter");
    expect(await page.textContent("#pageTitle")).toBe("Orders");
    expect(await page.$$eval(".nav-btn[tabindex='0']", (b) => b.length)).toBe(1);
    await page.keyboard.press("End");
    expect(await page.evaluate(() => document.activeElement!.getAttribute("data-tab"))).toBe("analytics");
  });

  it("Ctrl K focuses the search and Enter hands the query to Orders", async () => {
    const { page } = s;
    await page.click(".nav-btn[data-tab=overview]");
    await page.keyboard.press("Control+k");
    expect(await page.evaluate(() => document.activeElement!.id)).toBe("globalSearch");
    await page.keyboard.type(tag + " cod");
    await page.keyboard.press("Enter");
    await page.waitForSelector("tr.row");
    expect(await page.textContent("#pageTitle")).toBe("Orders");
    expect(await page.$$eval("tr.row", (r) => r.length)).toBe(1);
    expect(page.url()).toContain("#orders?q=");
  });

  // from test-v211.js: hidden pages hide for every admin; their links fall back to Overview
  it("Settings hides a page from the nav (saved on the server); its address opens Overview", async () => {
    const { page } = s;
    await page.click("button.ghost-link:has-text('Settings')");
    await page.click("[role=dialog] label:has-text('Payments')");
    await page.click("[role=dialog] button:has-text('Save')");
    await page.waitForSelector("[role=dialog]", { state: "detached" });
    expect(await page.$(".nav-btn[data-tab=payments]")).toBeNull();
    const ui = await adminGet<{ ui: { hidden: string[] } }>(page, "/settings/ui");
    expect(ui.ui.hidden).toEqual(["payments"]);
    await page.goto(BASE() + "/admin/#payments");
    await page.waitForSelector(".nav-btn");
    expect(await page.textContent("#pageTitle")).toBe("Overview");
    await page.click("button.ghost-link:has-text('Settings')");
    await page.click("[role=dialog] label:has-text('Payments')");
    await page.click("[role=dialog] button:has-text('Save')");
    await page.waitForSelector(".nav-btn[data-tab=payments]");
  });

  it("no sideways scroll at 360, 768 and 1366 on Overview and Orders; nothing in the console", async () => {
    const { page } = s;
    for (const w of [360, 768, 1366]) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const tab of ["overview", "orders"]) {
        await page.goto(BASE() + "/admin/#" + tab);
        await page.reload();
        await page.waitForSelector(tab === "orders" ? "tr.row" : ".kpi");
        if (tab === "orders") {
          await page.click("tr.row >> nth=0 >> td.total");
          await page.waitForSelector("tr.detail");
        }
        const pw = await pageWidth(page);
        expect(pw.scroll, tab + " at " + w).toBeLessThanOrEqual(pw.client);
      }
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    expect(s.errors).toEqual([]);
  });

  it("Sign out goes back to the gate, and the API refuses the old page", async () => {
    const { page } = s;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(BASE() + "/admin/");
    await page.click("button.ghost-link:has-text('Sign out')");
    await page.waitForSelector("#u");
    const r = await page.request.get(BASE() + "/api/admin/overview");
    expect(r.status()).toBe(401);
  });
});
