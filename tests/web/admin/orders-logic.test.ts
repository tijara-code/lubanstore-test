/**
 * The Orders tab's rules, without a page: the accordion and the pin, the filters in the
 * address and in the API query, the bulk bar's turns of 200, the status moves a person is
 * offered, the item lines (add-ons whole, large-box offers composed, "not offered now" kept),
 * the customer patch (only what changed), the typed-in order's checks.
 */
import { describe, expect, it, vi } from "vitest";
import type { ItemOption } from "../../../src/shared/admin/api";
import { forget, openOnly, pin, toggle } from "../../../src/admin/tabs/orders/rows";
import { filtersOf, keyOf, paramsOf, queryOf } from "../../../src/admin/tabs/orders/filters";
import { chunked } from "../../../src/admin/tabs/orders/Orders";
import { movesOf } from "../../../src/admin/tabs/orders/Fulfilment";
import { itemsOf, lineOf, newLine, tierScents } from "../../../src/admin/tabs/orders/ItemLines";
import { changedFields } from "../../../src/admin/tabs/orders/CustomerEditor";
import { bodyOf, missingOf } from "../../../src/admin/tabs/orders/ManualOrder";
import { presetSpan } from "../../../src/admin/kit/pickers";
import type { DetailOrder } from "../../../src/admin/tabs/orders/OrderDetail";

// from test-admin-tweaks.js: the order rows accordion
describe("open rows", () => {
  it("opening one closes the others unless pinned; closing drops the pin", () => {
    let s = forget();
    s = toggle(s, "A");
    s = toggle(s, "B");
    expect(s.open).toEqual(["B"]);
    s = pin(s, "B");
    s = toggle(s, "C");
    expect(s.open.sort()).toEqual(["B", "C"]);
    s = toggle(s, "B");
    expect(s.open).toEqual(["C"]);
    expect(s.pinned).toEqual([]);
  });
  it("pinning a closed row opens it, and does not close the others", () => {
    let s = toggle(forget(), "A");
    s = pin(s, "B");
    expect(s.open.sort()).toEqual(["A", "B"]);
    expect(s.pinned).toEqual(["B"]);
    expect(openOnly(s, "A")).toBe(s);
  });
});

describe("filters", () => {
  const now = Date.parse("2026-10-27T09:00:00Z");
  it("read from the address and written back (page 1 is not written)", () => {
    const f = filtersOf({ q: "LM-1", status: "new,flagged", payment: "cod", country: "AE", range: "7", trash: "1", page: "3" });
    expect(f).toMatchObject({ q: "LM-1", status: ["new", "flagged"], payment: "cod", country: "AE", trash: true, page: 3 });
    expect(paramsOf({ ...f, page: 1 })).toEqual({ q: "LM-1", status: "new,flagged", payment: "cod", country: "AE", range: "7", from: undefined, to: undefined, trash: "1", page: undefined });
    expect(filtersOf({}).range).toEqual({ pre: "all", from: "", to: "" });
    expect(filtersOf({ from: "2026-10-01", to: "2026-10-05" }).range).toEqual({ pre: "", from: "2026-10-01", to: "2026-10-05" });
    expect(filtersOf({ country: "<x>" }).country).toBe("");
  });
  // test-v408: Flagged is a tick of its own; Muscat days
  it("the API query: statuses without Flagged, flagged=1, the preset as Muscat days, 20 a page", () => {
    const q = queryOf(filtersOf({ status: "new,flagged", range: "7", page: "2" }), now);
    expect(q).toMatchObject({ status: "new", flagged: "1", from: "2026-10-21", to: "2026-10-27", limit: 20, offset: 20 });
    const all = queryOf(filtersOf({ status: "flagged", page: "2" }), now, true);
    expect(all.status).toBeUndefined();
    expect(all.limit).toBeUndefined();
    expect(all.offset).toBeUndefined();
    expect(keyOf({ q: "a", limit: 20 })).toBe("orders:list?limit=20&q=a");
  });
  it("presets resolve as of now in Muscat days", () => {
    expect(presetSpan("today", Date.parse("2026-10-27T21:00:00Z"))).toEqual({ from: "2026-10-28", to: "2026-10-28" });
    expect(presetSpan("lmonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetSpan("month", now)).toEqual({ from: "2026-10-01", to: "2026-10-27" });
    expect(presetSpan("all", now)).toEqual({ from: "", to: "" });
  });
});

// from test-admin-batch.js / test-v408.js: the server takes 200 ids a call
describe("bulk in turns of 200", () => {
  it("450 ids → three calls of 200, 200, 50; updated and stale added up", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => "LM-" + (100000 + i));
    const call = vi.fn(async (part: string[]) => ({ ok: true as const, op: "flag", updated: part.length - 1, stale: [part[0]!] }));
    const out = await chunked(ids, call);
    expect(call.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(out.updated).toBe(447);
    expect(out.stale).toEqual(["LM-100000", "LM-100200", "LM-100400"]);
  });
});

describe("the status flow a person is offered", () => {
  const o = (over: Partial<DetailOrder>) => ({ status: "new", pay: "cod", paymentStatus: "cod", refunded: false, trashed: false, ...over }) as DetailOrder;
  const state = (x: DetailOrder) => Object.fromEntries(movesOf(x).map((m) => [m.to, m.state]));
  it("forward moves are open, moving back asks first", () => {
    expect(state(o({}))).toEqual({ new: "here", prep: "ok", ship: "ok", done: "ok", void: "ok" });
    expect(state(o({ status: "ship" }))).toEqual({ new: "back", prep: "back", ship: "here", done: "ok", void: "ok" });
    expect(state(o({ status: "done" }))).toEqual({ new: "back", prep: "back", ship: "back", done: "here", void: "ok" });
  });
  // from test-v334.js: a voided unpaid card order cannot be revived by hand
  it("an unpaid card order waits for its payment; a refunded one cannot go out again", () => {
    const pend = movesOf(o({ status: "pending", pay: "card", paymentStatus: "unpaid" }));
    expect(pend.filter((m) => m.state === "ok").map((m) => m.to)).toEqual(["void"]);
    const voided = movesOf(o({ status: "void", pay: "card", paymentStatus: "cancelled" }));
    expect(voided.find((m) => m.to === "new")).toMatchObject({ state: "no", why: "Waiting for the card payment" });
    const refunded = movesOf(o({ status: "void", pay: "card", paymentStatus: "refunded", refunded: true }));
    expect(refunded.find((m) => m.to === "prep")).toMatchObject({ state: "no", why: "The money went back" });
  });
});

describe("item lines", () => {
  const opt = (o: Partial<ItemOption>): ItemOption => ({ itemId: "x", kind: "box", name: "x", name_en: "x", price: 10, was: null, soldOut: false, active: true, ...o });
  const OPTIONS = [
    opt({ itemId: "oud-large", scentId: "oud", sizeId: "large" }),
    opt({ itemId: "amber-large", scentId: "amber", sizeId: "large", soldOut: true }),
    opt({ itemId: "oud-small", scentId: "oud", sizeId: "small" }),
    opt({ itemId: "bundle", kind: "set", sizeId: "small" }),
    opt({ itemId: "burner", kind: "extra" }),
    opt({ itemId: "duo", kind: "tier", sizeId: "large" }),
  ];
  // from test-extras.js: an add-on id is whole, never rewritten as a scent-size
  it("an add-on and the set keep their own id; a box its scent-size; a large-box offer is composed", () => {
    const lines = [lineOf({ itemId: "burner", qty: 2, scent: "مبخرة", size: "" }), lineOf({ itemId: "bundle", qty: 1, scent: "", size: "" }), lineOf({ itemId: "duo:oud.amber", qty: 1, scent: "", size: "" })];
    expect(itemsOf(lines)).toEqual([
      { itemId: "burner", qty: 2 },
      { itemId: "bundle", qty: 1 },
      { itemId: "duo:oud.amber", qty: 1 },
    ]);
    expect(tierScents(OPTIONS, OPTIONS[5]).map((s) => s.scentId)).toEqual(["oud", "amber"]);
  });
  it("a line the market does not offer now is kept as it is; quantities stay 1–99; a new line is an offered item", () => {
    const kept = lineOf({ itemId: "rose-large", qty: 120, scent: "ورد", size: "كبير" });
    expect(kept.was).toBe("ورد · كبير");
    expect(itemsOf([kept])).toEqual([{ itemId: "rose-large", qty: 99 }]);
    expect(newLine(OPTIONS).pick).toBe("oud-large");
  });
});

describe("the customer patch", () => {
  // from test-order-items.js / v334: only what changed is sent (names, never values, are audited)
  it("only the fields that changed, trimmed", () => {
    const was = { name: "سالم", phone: "+968 91234567", email: null, city: "مسقط", region: "الخوير", note: "" };
    expect(changedFields(was, { name: "سالم ", phone: "+968 91234567", email: "", city: "صحار", region: "الخوير", note: "" })).toEqual({ city: "صحار" });
    expect(changedFields(was, { name: "سالم", phone: "+968 91234567", email: "", city: "مسقط", region: "الخوير", note: "" })).toEqual({});
  });
});

describe("the typed-in order", () => {
  const f = { country: "OM", name: "سالم", phone: "91234567", city: "مسقط", area: "", email: "", note: "", pay: "cod" as const, cod: "" };
  const lines = [{ pick: "oud-large", scents: [], qty: 1 }];
  it("says what is missing before sending", () => {
    expect(missingOf({ ...f, name: " " }, lines)).toBe("Add the customer's name.");
    expect(missingOf({ ...f, phone: "123" }, lines)).toBe("Check the phone number.");
    expect(missingOf({ ...f, city: "" }, lines)).toBe("Add the city.");
    expect(missingOf(f, [])).toBe("Add at least one item.");
    expect(missingOf({ ...f, cod: "abc" }, lines)).toBe("Check the COD amount.");
    expect(missingOf(f, lines)).toBe("");
  });
  it("sends ids and quantities, the payment, the amount to collect for cash only, and one dedupe id", () => {
    expect(bodyOf({ ...f, cod: "25" }, lines, "wa-abc123")).toEqual({
      countryCode: "OM", name: "سالم", phone: "91234567", city: "مسقط", region: undefined, email: undefined, note: undefined,
      items: [{ itemId: "oud-large", qty: 1 }], pay: "cod", codAmount: "25", dedupeId: "wa-abc123",
    });
    expect(bodyOf({ ...f, pay: "transfer", cod: "25" }, lines, "wa-abc123").codAmount).toBeUndefined();
  });
});
