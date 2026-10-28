/**
 * The Catalogue tab end to end, against the real server: an edit published (Arabic digits,
 * the server's change lines shown, nothing code-owned stored), someone else's publish in
 * between (409 stale → reload), a Stock Tracker switch saved through its own route without
 * publishing the tab's other edits, a market's route, and the page at 360/768/1366 with the
 * forms open. Ported UI checks of test-admin-batch/-tweaks, test-catalogue-merge (UI side),
 * test-offer-admin, test-v207/v208/v211 (admin), test-v408/v410/v411.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { CatalogueAnswer, Jsonify } from "../../src/shared/admin/api";
import { adminGet, adminPost, BASE, openBrowser, pageWidth, signIn, type Session } from "./admin-helpers";

let s: Session;
let page: Page;
type Read = Jsonify<CatalogueAnswer>;
const read = () => adminGet<Read>(page, "/catalogue");
const toast = async (re: RegExp) => expect.poll(() => page.textContent(".toast"), { timeout: 10000 }).toMatch(re);

async function openTab() {
  await page.goto(BASE() + "/admin/#catalogue");
  await page.reload();
  await page.waitForSelector(".cty-card[data-code=AE]");
}
/** the control under a caption, inside a scope */
const field = (scope: string, caption: string) => page.locator(`${scope} .field-b:has(> .cap:text-is("${caption}")) >> input, ${scope} .field-b:has(> .cap:text-is("${caption}")) >> select`).first();

beforeAll(async () => {
  s = await openBrowser({ ip: "198.51.100.61" });
  page = s.page;
  await signIn(page);
});
afterAll(async () => {
  // leave the shop as the other suites expect it: the deploy's catalogue, every market on Empower
  const r = await read();
  await adminPost(page, "POST", "/catalogue/restore-defaults", { version: r.version, editTag: r.editTag, confirm: "defaults" });
  await adminPost(page, "PUT", "/empower/routes/AE", { courier: "omniful" });
  await s.browser.close();
});

describe("publishing", () => {
  it("an edit typed in Arabic digits is published with the version loaded; the change lines are shown; nothing code-owned is stored", async () => {
    await openTab();
    await page.click(".cty-card[data-code=AE] .cty-toggle");
    await field(".cty-card[data-code=AE]", "Delivery (AED)").fill("٢٥");
    await expect.poll(() => page.textContent(".card.dock .stamp")).toMatch(/Unsaved changes/);
    await page.click("button:has-text('Save & publish')");
    await toast(/Published/);
    await expect.poll(() => page.textContent(".pub-changes")).toMatch(/AE/);
    const r = await read();
    expect(r.data.countries.find((c) => c.code === "AE")!.ship).toBe(25);
    expect(JSON.stringify(r.stored)).not.toMatch(/"toOmr"|"art":|"countsFree"/);
    // the OMR rate still shows (the deploy's), read-only
    expect(r.data.countries.find((c) => c.code === "AE")!.toOmr).toBeGreaterThan(0);
    await expect.poll(() => page.textContent(".card.dock .stamp")).toMatch(/No unsaved changes/);
  });

  it("someone else's publish in between: refused as stale, said, and the reload shows theirs", async () => {
    await openTab();
    await page.click(".cty-card[data-code=OM] .cty-toggle");
    await field(".cty-card[data-code=OM]", "COD fee").fill("1.5");
    // another tab publishes first
    const r = await read();
    const other = JSON.parse(JSON.stringify(r.data));
    other.countries.find((c: { code: string }) => c.code === "QA").ship = 33;
    const j = await adminPost<{ ok: boolean }>(page, "POST", "/catalogue/publish", { data: other, version: r.version, editTag: r.editTag });
    expect(j.ok).toBe(true);
    await page.click("button:has-text('Save & publish')");
    await toast(/someone else published the catalogue since you opened it/);
    await page.waitForSelector(".stale:has-text('Someone else published')");
    expect((await read()).data.countries.find((c) => c.code === "OM")!.cod).not.toBe(1.5);
    await page.click(".stale button:has-text('Reload')");
    await expect.poll(() => page.$(".stale")).toBeNull();
    await page.click(".cty-card[data-code=QA] .cty-toggle");
    expect(await field(".cty-card[data-code=QA]", "Delivery (QAR)").inputValue()).toBe("33");
  });

  it("a box that does not read as a number stops the publish", async () => {
    await openTab();
    await page.click(".cty-card[data-code=AE] .cty-toggle");
    const before = (await read()).version;
    await field(".cty-card[data-code=AE]", "Free over").fill("abc");
    await page.click("button:has-text('Save & publish')");
    await toast(/Free over: not a number/);
    expect((await read()).version).toBe(before);
  });
});

describe("saved at once, never with the tab's edits", () => {
  it("a Stock Tracker switch writes only itself", async () => {
    await openTab();
    await page.click(".cty-card[data-code=AE] .cty-toggle");
    await field(".cty-card[data-code=AE]", "Free over").fill("280");
    await page.click("#stockCard .fold-btn");
    const row = page.locator("#stockCard tbody tr:has-text('oud-small')");
    await row.locator(".flag-sw").first().click();
    await toast(/oud-small hide at 0 on/);
    const r = await read();
    expect(r.stored!.stockHide).toEqual({ "oud-small": true });
    expect(r.data.countries.find((c) => c.code === "AE")!.freeOver).not.toBe(280);
    // the tab's own edit is still unsaved, and publishes without a conflict
    await expect.poll(() => page.textContent(".card.dock .stamp")).toMatch(/Unsaved changes/);
    await page.click("button:has-text('Save & publish')");
    await toast(/Published/);
    const after = await read();
    expect(after.data.countries.find((c) => c.code === "AE")!.freeOver).toBe(280);
    expect(after.stored!.stockHide).toEqual({ "oud-small": true });
  });

  it("a market's route is the Empower tab's: saved at once, and a later publish keeps it", async () => {
    await openTab();
    await page.click(".cty-card[data-code=AE] .cty-toggle");
    await field(".cty-card[data-code=AE]", "Ships with").selectOption("manual");
    await toast(/AE now goes by hand/);
    await field(".cty-card[data-code=AE]", "COD fee").fill("11");
    await page.click("button:has-text('Save & publish')");
    await toast(/Published/);
    const r = await read();
    const ae = r.data.countries.find((c) => c.code === "AE")!;
    expect(ae.courier).toBe("manual");
    expect(ae.cod).toBe(11);
  });
});

describe("the page", () => {
  it("never scrolls sideways at 360, 768 and 1366 with the forms open; no console errors", async () => {
    for (const w of [1366, 768, 360]) {
      await page.setViewportSize({ width: w, height: 900 });
      await openTab();
      for (const id of ["offerCard", "fsCard", "stockCard"]) await page.click(`#${id} .fold-btn`);
      await page.click(".cty-card[data-code=OM] .cty-toggle");
      const pw = await pageWidth(page);
      expect(pw.scroll, "catalogue at " + w).toBeLessThanOrEqual(pw.client);
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    expect(s.errors).toEqual([]);
  });
});
