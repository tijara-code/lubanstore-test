/**
 * The Catalogue tab in happy-dom with the API stubbed: what a publish sends (the version and
 * editTag loaded, never a code-owned field, Arabic digits read), the refusals before it, the
 * 409 stale answer, the change lines after it, Discard, Restore defaults (the word), Export,
 * the offers' Reset requests, the unit flip, the stock grid, removing and restoring a size,
 * a market's route, the Stock Tracker's own route. Ported UI-side checks of test-admin-batch,
 * test-admin-tweaks, test-catalogue-merge, test-offer-admin, test-v207/v208/v209/v211,
 * test-v303/v309/v408/v410–v413, test-free-ship (panel half).
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearQueries } from "../../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../../src/admin/kit";
import { Catalogue } from "../../../../src/admin/tabs/catalogue/Catalogue";
import { byText, click, mount, settle, stubFetch, type, type Call } from "../_render";

const STORED = () => ({
  countries: [
    {
      code: "OM", flag: "🇴🇲", name: "عُمان", name_en: "Oman", cur: "OMR", dial: "968", dec: 3, ship: 2, freeOver: 30, cod: 1, courier: "omniful",
      prices: { small: { now: 12, was: 16 }, large: { now: 25, was: 30 }, bundle: { now: 29, was: 36 }, duo: { now: 29.9, was: 0 }, trio: { now: 35.9, was: 0 }, burner: { now: 6, was: 0 } },
      sizes: [{ id: "large", name: "كبير", name_en: "Large", tag: "", tagColor: "#9c464c" }, { id: "small", name: "صغير", name_en: "Small", tag: "", tagColor: "#9c464c" }],
      scents: [{ id: "oud", name: "عود", name_en: "Oud", accent: "#6f5aa8", stars: 4.8 }, { id: "amber", name: "عنبر", name_en: "Amber", accent: "#a5444a" }],
      extras: [{ id: "burner", name: "مبخرة", note: "", once: true, active: true }],
    },
    {
      code: "AE", flag: "🇦🇪", name: "الإمارات", name_en: "UAE", cur: "AED", dial: "971", dec: 0, ship: 30, freeOver: 300, cod: 10,
      prices: { small: { now: 120, was: 160 }, large: { now: 250, was: 320 }, bundle: { now: 299, was: 360 }, duo: { now: 419, was: 0 }, trio: { now: 499, was: 0 }, burner: { now: 60, was: 0 } },
      sizes: [{ id: "large", name: "كبير", name_en: "Large" }, { id: "small", name: "صغير", name_en: "Small" }],
      scents: [{ id: "oud", name: "عود", name_en: "Oud" }, { id: "amber", name: "عنبر", name_en: "Amber" }],
      extras: [{ id: "burner", name: "مبخرة", once: true, active: true }],
    },
  ],
  sizes: [{ id: "large", name: "كبير" }, { id: "small", name: "صغير" }],
  scents: [{ id: "oud", name: "عود" }, { id: "amber", name: "عنبر" }],
  extras: [{ id: "burner", name: "مبخرة" }],
  offer: { id: "bundle", active: true, name: "باقة", name_en: "Set", note: "", badge: "", hours: 72, unit: "hours", renew: "auto", sizeId: "small", countries: [], anchor: "2026-10-27T08:00:00.000Z", only: true },
  tiers: { active: true, sizeId: "large", hours: 72, unit: "hours", renew: "once", countries: [], anchor: "2026-10-27T08:00:00.000Z", clock: true },
  freeShip: { active: true, countries: { OM: { on: true, over: 10, days: 5, from: "2026-10-27T08:00:00.000Z" } } },
  stockHide: { "oud-small": true },
});
// the merged view: the stored row with the code-owned fields laid over it
const MERGED = () => {
  const d = STORED() as Record<string, any>;
  d.countries[0].toOmr = 1;
  d.countries[1].toOmr = 0.1047;
  d.countries.forEach((c: any) => c.scents.forEach((s: any) => (s.art = s.id)));
  d.version = 7;
  return d;
};
const READ = (over: Record<string, unknown> = {}) => ({ ok: true, data: MERGED(), stored: STORED(), version: 4, editTag: "tag-4", updatedAt: "2026-10-27T08:00:00.000Z", updatedBy: "shopkeeper", codeOwned: {}, deployVersion: 7, ...over });
const STOCK = { ok: true, on: false, hideSet: ["oud-small"], capSet: [], cap: {}, left: { large: 30, small: 4 }, at: "2026-10-28T07:59:00.000Z", source: "omniful", error: null, note: null, hubs: null, fields: null, skus: 4, tracker: [{ id: "oud-small", sku: "LM2001", available: 0, onHand: 1, shelf: 1, reserved: 1 }, { id: "oud-large", sku: "LM3001", available: 7, onHand: 8, shelf: 7, reserved: 0 }], held: [{ id: "LM-1000009", status: "new", at: "2026-10-28T06:00:00.000Z", boxes: { "oud-small": 1 } }], heldHours: 72, hide: { items: ["oud-small"], sizes: [] }, items: {} };
const PUBLISHED = { ok: true, version: 5, editTag: "tag-5", updatedAt: "2026-10-28T08:01:00.000Z", change: ["AE small 120→110 AED"], data: STORED() };

let reads: number;
function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /catalogue": () => {
      reads++;
      return READ();
    },
    "GET /stock": () => STOCK,
    "POST /catalogue/publish": () => PUBLISHED,
    ...over,
  };
}

const page = () => mount(h("div", null, h("div", { class: "tab" }, h(Catalogue, null)), h(DialogHost, null), h(Toast, null)));
const toastText = () => document.querySelector(".toast")!.textContent;
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;
/** the control under a caption, inside `scope` */
function box(scope: ParentNode, caption: string, n = 0): HTMLInputElement | HTMLSelectElement {
  const all = [...scope.querySelectorAll(".field-b")].filter((f) => (f.querySelector(".cap")?.textContent || "").trim() === caption);
  const f = all[n];
  if (!f) throw new Error("no field " + caption);
  return f.querySelector("input,select") as HTMLInputElement;
}
const card = (code: string) => document.querySelector(".cty-card[data-code=" + code + "]") as HTMLElement;
async function openCard(code: string) {
  await click(card(code).querySelector(".cty-toggle"));
  return card(code);
}
async function fold(id: string) {
  await click(document.querySelector("#" + id + " .fold-btn"));
  return document.querySelector("#" + id) as HTMLElement;
}
async function choose(sel: HTMLSelectElement, v: string) {
  sel.value = v;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
const sent = (calls: Call[], k: string) => calls.filter((c) => c.method + " " + c.path === k);
const lastPublish = (calls: Call[]) => sent(calls, "POST /catalogue/publish").pop()!.body as { data: any; version: number; editTag: string };

beforeEach(() => {
  reads = 0;
  clearQueries();
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("loading", () => {
  it("draws the cards with their state in the heading; nothing unsaved", async () => {
    stubFetch(routes());
    const m = page();
    await settle();
    expect(m.text()).toMatch(/Small bundle offer/);
    expect(m.text()).toMatch(/Large bundle offer/);
    expect(m.text()).toMatch(/Free delivery offer/);
    expect(m.text()).toMatch(/Stock Tracker/);
    // test-admin-tweaks: "Markets and prices" with a count stamp; cards closed unless opened
    expect(m.text()).toMatch(/Markets and prices2 markets/);
    expect(card("AE").querySelector(".cty-body")!.hasAttribute("hidden")).toBe(true);
    expect(m.text()).toMatch(/No unsaved changes · last published .* by shopkeeper/);
    // test-admin-batch: the offer's state is visible without opening it
    expect(document.querySelector("#offerCard .stamp")!.textContent).toMatch(/^on · window closes in/);
    expect(document.querySelector("#fsCard .stamp")!.textContent).toMatch(/^live in OM|^not running/);
    // test-v207: the per-size reading in the Stock Tracker's heading
    expect(document.querySelector("#stockCard .stamp")!.textContent).toBe("large 30 · small 4");
  });

  // test-catalogue-merge / admin-api notes: never publish after a failed load
  it("a failed load shows no editor and no Save & publish", async () => {
    stubFetch(routes({ "GET /catalogue": () => [503, { ok: false, error: "server_error" }] }));
    const m = page();
    await settle();
    expect(m.text()).toMatch(/Could not load the catalogue/);
    expect(byText(m.root, "button", "Save & publish")).toBeNull();
  });
});

describe("Save & publish", () => {
  it("sends the version and editTag it loaded, the edit, and never a code-owned field or a route; shows the change lines", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const ae = await openCard("AE");
    // Arabic digits are digits
    await type(box(ae.querySelector('[data-size="small"]')!, "Price"), "١١٠");
    expect(m.text()).toMatch(/Unsaved changes/);
    await click(byText(m.root, "button", "Save & publish"));
    const b = lastPublish(calls);
    expect(b.version).toBe(4);
    expect(b.editTag).toBe("tag-4");
    expect(b.data.countries[1].prices.small.now).toBe(110);
    expect(JSON.stringify(b.data)).not.toMatch(/"toOmr"|"art"|"courier"|"version"/);
    // what the server's change lines say
    expect(m.text()).toMatch(/What changed on the store:AE small 120→110 AED/);
    expect(toastText()).toBe("Published. Live within a minute.");
    // re-read after the publish (the server stamps starts)
    expect(reads).toBe(2);
  });

  it("a box that is not a number, or an offer with no market, stops the publish with words", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await type(box(ae, "COD fee"), "ten");
    expect(ae.textContent).toMatch(/Not a number/);
    await click(byText(m.root, "button", "Save & publish"));
    expect(sent(calls, "POST /catalogue/publish")).toHaveLength(0);
    expect(toastText()).toBe("COD fee: not a number");
    await type(box(ae, "COD fee"), "-2");
    await click(byText(m.root, "button", "Save & publish"));
    expect(toastText()).toBe("COD fee: cannot be negative");
    await type(box(ae, "COD fee"), "12");
    // test-admin-batch: unticking every bundle market is refused
    const offer = await fold("offerCard");
    const group = offer.querySelector('[aria-label="Offered in"]')!;
    for (const cb of group.querySelectorAll("input")) await click(cb);
    await click(byText(m.root, "button", "Save & publish"));
    expect(toastText()).toBe("Small bundle: tick at least one market, or switch the small bundle off");
    expect(sent(calls, "POST /catalogue/publish")).toHaveLength(0);
    await click(group.querySelector("input"));
    await click(byText(m.root, "button", "Save & publish"));
    expect(lastPublish(calls).data.countries[1].cod).toBe(12);
    expect(lastPublish(calls).data.offer.countries).toEqual(["OM"]);
  });

  it("409 stale: says someone else published, publishes nothing over it, offers a reload", async () => {
    stubFetch(routes({ "POST /catalogue/publish": () => [409, { ok: false, error: "stale", version: 6, editTag: "tag-6" }] }));
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await type(box(ae, "Delivery (AED)"), "25");
    await click(byText(m.root, "button", "Save & publish"));
    expect(toastText()).toMatch(/^Not published: someone else published the catalogue since you opened it/);
    expect(m.text()).toMatch(/Someone else published the catalogue since you opened it \(now version 6\)/);
    expect((byText(m.root, "button", "Save & publish") as HTMLButtonElement).disabled).toBe(true);
    await click(byText(m.root, "button", "Reload"));
    expect(reads).toBe(2);
    expect(m.text()).not.toMatch(/Someone else published/);
    expect(m.text()).toMatch(/No unsaved changes/);
  });

  // test-admin-batch: the bundle editor's inputs are read even while its card is folded
  it("a folded card keeps its edits; Reset is a request the server carries out", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const offer = await fold("offerCard");
    await type(box(offer, "Name · EN"), "The Three-Scent Set");
    await click(offer.querySelector('[aria-label="Reset the bundle\'s window"]'));
    expect(toastText()).toBe("Window will restart from now when you save");
    expect((box(offer, "Counted from") as HTMLInputElement).value).toBe("Now, when you publish");
    await fold("offerCard"); // folded again
    expect(offer.querySelector(".fold-body")!.hasAttribute("hidden")).toBe(true);
    const tiers = await fold("tiersCard");
    await click(tiers.querySelector('[aria-label="Reset the large bundle\'s countdown"]'));
    await click(byText(m.root, "button", "Save & publish"));
    const d = lastPublish(calls).data;
    expect(d.offer.name_en).toBe("The Three-Scent Set");
    expect(d.offer.anchorReset).toBe(true);
    expect(d.tiers.anchorReset).toBe(true);
  });

  // test-offer-admin / test-admin-batch: hours or days, stored in hours; the unit flip converts the number
  it("the window in days: 3 days = 72 h, 5 days = 120 h", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const offer = await fold("offerCard");
    await choose(box(offer, "Counted in") as HTMLSelectElement, "days");
    expect((box(offer, "Window") as HTMLInputElement).value).toBe("3");
    await type(box(offer, "Window"), "5");
    await click(byText(m.root, "button", "Save & publish"));
    expect(lastPublish(calls).data.offer).toMatchObject({ hours: 120, unit: "days" });
    await settle();
  });

  // test-v408/v410/v411/v413: the set ships free — switch, markets, length, renew, Reset
  it("free delivery with the set: switch, markets, length in days, renew, reset", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const offer = await fold("offerCard");
    await click(byText(offer, ".flag-sw", "On: free delivery with this set, whatever the total")!.querySelector("input"));
    await type(box(offer, "For"), "2");
    await choose(box(offer, "When it closes", 1) as HTMLSelectElement, "auto");
    const ships = offer.querySelector('[aria-label="Ships free in"]')!;
    await click(byText(ships as HTMLElement, ".flag-sw", "AE")!.querySelector("input"));
    await click(offer.querySelector('[aria-label="Reset the set\'s free delivery"]'));
    await click(byText(m.root, "button", "Save & publish"));
    const o = lastPublish(calls).data.offer;
    expect(o).toMatchObject({ freeShip: true, freeShipHours: 48, freeShipUnit: "days", freeShipRenew: "auto", freeShipIn: ["OM"], freeShipReset: true });
  });

  // test-free-ship (panel half): Restart is a flag, not a date; Same days for all
  it("free delivery per market: Restart, days stepper, same days for all", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const fs = await fold("fsCard");
    const om = fs.querySelector('[data-fs="OM"]') as HTMLElement;
    expect(om.textContent).toMatch(/4 days left|days left|Ends today/);
    await click(byText(om, "button", "Restart"));
    expect(om.textContent).toMatch(/Restarts on publish/);
    const ae = fs.querySelector('[data-fs="AE"]') as HTMLElement;
    await click(ae.querySelector(".flag-sw input"));
    await type(ae.querySelector(".fs-over input"), "٠");
    await click(ae.querySelector('[aria-label="One day more (AE)"]'));
    await click(ae.querySelector('[aria-label="One day more (AE)"]'));
    await click(byText(fs, "button", "Same days for all"));
    expect(toastText()).toBe("5 days for 2 markets. Save & publish to apply.");
    await click(byText(m.root, "button", "Save & publish"));
    const f = lastPublish(calls).data.freeShip.countries;
    expect(f.OM).toEqual({ on: true, over: 10, days: 5, restart: true });
    expect(f.AE).toEqual({ on: true, over: 0, days: 5 });
  });

  // test-v303 (ruling: duo/trio keep admin controls)
  it("the large-box offers: prices per market, switch, clock, markets", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const om = await openCard("OM");
    const duoRow = [...om.querySelectorAll(".sub-row")].find((r) => /Large bundle · 2 boxes/.test((r.querySelector("input[readonly]") as HTMLInputElement)?.value || ""))!;
    await type(box(duoRow, "Price", 0), "27.5");
    await type(box(duoRow, "Price", 1), "33");
    const tiers = await fold("tiersCard");
    expect(tiers.textContent).toMatch(/Prices now \(2 boxes · 3 boxes\): OM 27.5 · 33/);
    await click(byText(tiers, ".flag-sw", "Show the countdown on the page")!.querySelector("input"));
    await click(byText(m.root, "button", "Save & publish"));
    const d = lastPublish(calls).data;
    expect(d.countries[0].prices.duo).toEqual({ now: 27.5, was: 0 });
    expect(d.countries[0].prices.trio).toEqual({ now: 33, was: 0 });
    expect(d.tiers).toMatchObject({ active: true, clock: false, countries: [] });
  });
});

describe("markets", () => {
  // test-offer-admin: the grid sets the scent in every market
  it("Common to every market: a tick is the scent sold out in that size everywhere", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Common to every market"));
    const row = [...document.querySelectorAll(".stock-row")].find((r) => r.querySelector("b")!.textContent === "عنبر")!;
    await click(row.querySelectorAll("input")[0]!); // large
    expect(toastText()).toBe("Sold out everywhere. Save & publish to apply.");
    expect(m.text()).toMatch(/1 sold out everywhere/);
    await click(byText(m.root, "button", "Save & publish"));
    const d = lastPublish(calls).data;
    for (const c of d.countries) expect(c.scents.find((s: any) => s.id === "amber").soldOutSizes).toEqual(["large"]);
  });

  // test-admin-batch / test-catalogue-merge (UI): Remove asks, naming the market; Restore <size> brings it back with its price
  it("removing a size asks, naming the market; Restore puts it back with its price", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await click(ae.querySelector('[aria-label="Remove the size صغير from AE"]'));
    expect(dialog().textContent).toMatch(/Remove the size “صغير” from الإمارات \(AE\)\?/);
    expect(dialog().textContent).toMatch(/tick Hidden instead/);
    await click(byText(dialog(), "button", "Remove"));
    expect(ae.querySelector('[data-size="small"]')).toBeNull();
    await click(byText(ae, "button", "Restore صغير"));
    expect(toastText()).toBe("صغير is back in AE at 120 AED · Save & publish to put it on the store");
    expect(ae.querySelector('[data-size="small"]')).not.toBeNull();
    await click(byText(m.root, "button", "Save & publish"));
    expect(lastPublish(calls).data.countries[1].prices.small.now).toBe(120);
  });

  it("removing a market names it; nothing changes until published", async () => {
    stubFetch(routes());
    const m = page();
    await settle();
    await click(card("OM").querySelector('[aria-label="Remove the market عُمان (OM)"]'));
    expect(dialog().textContent).toMatch(/Remove the market عُمان \(OM\)\?/);
    expect(dialog().textContent).toMatch(/Every price, size, scent and add-on in it goes with it/);
    expect(dialog().textContent).toMatch(/Nothing changes on the store until you Save & publish/);
    await click(byText(dialog(), "button", "Cancel"));
    expect(card("OM")).not.toBeNull();
    expect(m.text()).toMatch(/No unsaved changes/);
  });

  // test-extras (panel half): Price (<CUR>), a new add-on "New add-on", off
  it("add-ons: the price in the market's currency; a new one starts off; English boxes beside the Arabic", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const ae = await openCard("AE");
    expect(box(ae, "Price (AED)")).toBeTruthy();
    await click(byText(ae, "button", "Add-on"));
    await click(byText(ae, "button", "Scent"));
    await type(box(ae.querySelector('[data-scent="oud"]')!, "Rating /5"), "٤٫٧");
    await type(box(ae.querySelector('[data-scent="oud"]')!, "Name · EN"), "Oud Lavender");
    await click(byText(m.root, "button", "Save & publish"));
    const c = lastPublish(calls).data.countries[1];
    expect(c.extras[1]).toMatchObject({ id: "extra-2", name: "New add-on", active: false, once: true });
    expect(c.scents[2]).toMatchObject({ id: "scent-3", name: "New scent", stars: 0, tag: "", tagColor: "#9c464c", accent: "#b8974f" });
    expect(c.scents[0]).toMatchObject({ stars: 4.7, name_en: "Oud Lavender" });
    // the OMR rate is shown, read-only
    expect((box(ae, "OMR rate (from deploy)") as HTMLInputElement).readOnly).toBe(true);
  });

  it("a market's route is saved at once through its own route, not with the publish", async () => {
    const { calls } = stubFetch(routes({ "PUT /empower/routes/AE": () => ({ ok: true, code: "AE", courier: "manual" }) }));
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await choose(box(ae, "Ships with") as HTMLSelectElement, "manual");
    expect(sent(calls, "PUT /empower/routes/AE")[0]!.body).toEqual({ courier: "manual" });
    expect(toastText()).toBe("AE now goes by hand (tracking typed in)");
    expect(m.text()).toMatch(/No unsaved changes/);
  });

  it("a new country: two letters, from the first market, at zero", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Country"));
    await type(dialog().querySelector("input"), "OM");
    await click(byText(dialog(), "button", "Add"));
    expect(toastText()).toBe("That country already exists");
    await type(dialog().querySelector("input"), "kw");
    await click(byText(dialog(), "button", "Add"));
    expect(card("KW")).not.toBeNull();
    expect(m.text()).toMatch(/3 markets · 2 unpriced sizes/);
    // the new market needs a dial code before it can go out
    await click(byText(m.root, "button", "Save & publish"));
    expect(toastText()).toBe("KW: the dial code is digits only (971).");
    await type(box(card("KW"), "Dial code"), "965");
    await click(byText(m.root, "button", "Save & publish"));
    expect(lastPublish(calls).data.countries[2]).toMatchObject({ code: "KW", dial: "965", prices: { large: { now: 0, was: 0 } } });
  });
});

describe("the publishing bar's other buttons", () => {
  // test-catalogue-merge: "recover from database" re-reads and publishes nothing
  it("Discard asks, re-reads, publishes nothing", async () => {
    const { calls } = stubFetch(routes());
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await type(box(ae, "Free over"), "250");
    await click(byText(m.root, "button", "Discard edits, reload published"));
    expect(dialog().textContent).toMatch(/Nothing is published/);
    await click(byText(dialog(), "button", "Discard and reload"));
    expect(reads).toBe(2);
    expect(sent(calls, "POST /catalogue/publish")).toHaveLength(0);
    expect((box(card("AE"), "Free over") as HTMLInputElement).value).toBe("300");
    expect(toastText()).toBe("Reloaded the published catalogue · nothing published");
  });

  // test-catalogue-merge: an explicit restore warns that it DISCARDS every price and fee; the word is named back
  it("Restore defaults: warns, needs the word typed, sends confirm: defaults", async () => {
    const { calls } = stubFetch(routes({ "POST /catalogue/restore-defaults": () => ({ ...PUBLISHED, change: ["AE small 110→120 AED"] }) }));
    const m = page();
    await settle();
    await click(byText(m.root, "button", "Restore defaults"));
    expect(dialog().textContent).toMatch(/DISCARDS every price and fee edited here \(OM: COD fee 1, shipping 2, free over 30, large 25\)/);
    const go = byText(dialog(), "button", "Restore and publish") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await type(dialog().querySelector("input"), "defaults");
    await click(byText(dialog(), "button", "Restore and publish"));
    expect(sent(calls, "POST /catalogue/restore-defaults")[0]!.body).toEqual({ version: 4, editTag: "tag-4", confirm: "defaults" });
    expect(m.text()).toMatch(/AE small 110→120 AED/);
  });

  it("Export: unsaved edits are downloaded as they are on screen; otherwise the server's file", async () => {
    stubFetch(routes());
    const made: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (made.push(b), "blob:x"), revokeObjectURL: () => {} }));
    const m = page();
    await settle();
    const ae = await openCard("AE");
    await type(box(ae, "Free over"), "250");
    await click(byText(m.root, "button", "Export settings.json"));
    expect(made).toHaveLength(1);
    const text = await made[0]!.text();
    expect(JSON.parse(text).countries[1].freeOver).toBe(250);
    expect(text).not.toMatch(/"toOmr"/);
    expect(toastText()).toMatch(/^Downloaded what is on screen/);
  });
});

describe("the Stock Tracker (v207/v208/v211/v319)", () => {
  it("rows for every box, the shelf's figures, held orders; a switch is saved at once and publishes nothing else", async () => {
    const { calls } = stubFetch(routes({ "PATCH /catalogue/stock": (c) => ({ ...PUBLISHED, change: [], data: { ...STORED(), stockCap: c.body && (c.body as any).stockCap } }) }));
    const m = page();
    await settle();
    const st = await fold("stockCard");
    const rows = [...st.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(4);
    const oudSmall = rows.find((r) => /oud-small/.test(r.textContent || ""))!;
    expect(oudSmall.className).toBe("st-off");
    expect(oudSmall.textContent).toMatch(/LM2001/);
    expect(oudSmall.textContent).toMatch(/hidden/);
    expect(st.textContent).toMatch(/Held here: 1 order from the last 72 h, not sent to Empower yet: LM-1000009 \(new: oud-small ×1\)/);
    // an unsaved edit elsewhere stays unsaved
    const ae = await openCard("AE");
    await type(box(ae, "Free over"), "250");
    const oudLarge = rows.find((r) => /oud-large/.test(r.textContent || ""))!;
    await click(oudLarge.querySelectorAll(".flag-sw input")[1]!); // cap at stock
    expect(sent(calls, "PATCH /catalogue/stock")[0]!.body).toEqual({ stockCap: { "oud-large": true } });
    expect(sent(calls, "POST /catalogue/publish")).toHaveLength(0);
    expect(toastText()).toBe("oud-large cap at stock on");
    expect(m.text()).toMatch(/Unsaved changes/);
    // the next publish carries the new version, so it is not refused as stale
    await click(byText(m.root, "button", "Save & publish"));
    expect(lastPublish(calls)).toMatchObject({ version: 5, editTag: "tag-5" });
    expect(lastPublish(calls).data.stockCap).toEqual({ "oud-large": true });
  });

  it("Read the shelf now asks Omniful again (fresh=1); the counter switch has its own route", async () => {
    const { calls } = stubFetch(routes({ "PATCH /catalogue/stock": () => ({ ...PUBLISHED, change: ["pieces-left counter on"], data: { ...STORED(), stockLive: true } }) }));
    const m = page();
    await settle();
    const st = await fold("stockCard");
    await click(byText(st, "button", "Read the shelf now"));
    expect(calls.filter((c) => c.path === "/stock" && c.query.get("fresh") === "1")).toHaveLength(1);
    await click(byText(st, ".flag-sw", "Counter off")!.querySelector("input"));
    expect(sent(calls, "PATCH /catalogue/stock")[0]!.body).toEqual({ stockLive: true });
    expect(m.text()).toMatch(/Counter on/);
  });

  it("a switch on a catalogue never published says so", async () => {
    stubFetch(routes({ "PATCH /catalogue/stock": () => [409, { ok: false, error: "not_published" }] }));
    page();
    await settle();
    const st = await fold("stockCard");
    await click(st.querySelector("tbody tr .flag-sw input"));
    expect(toastText()).toBe("Publish the catalogue once before setting these.");
  });

  // test-v209: the heading names which failure
  it("the heading names the failure", async () => {
    stubFetch(routes({ "GET /stock": () => ({ ...STOCK, at: null, error: "none of our SKU codes match the shelf (X1, X2)", tracker: [] }) }));
    page();
    await settle();
    expect(document.querySelector("#stockCard .stamp")!.textContent).toBe("SKU codes do not match the shelf");
  });
});
