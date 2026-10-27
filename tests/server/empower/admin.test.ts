import { describe, expect, it } from "vitest";
import { HttpError } from "../../../src/server/core/http";
import { loadCatalogue } from "../../../src/server/domain/catalogue";
import {
  catalogSkus,
  empowerRecords,
  empowerStatus,
  pushedList,
  pushOne,
  saveSkus,
  setRoute,
  syncNow,
  waitingList,
} from "../../../src/server/domain/empower/admin";
import { empowerHarness } from "./_helpers";

const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return e instanceof HttpError ? e.status + " " + e.code + ((e.extra as any).code ? " " + (e.extra as any).code : "") : String(e);
  }
};

describe("the Empower tab", () => {
  // from test-empower.js: the SKU list
  it("saves the SKU map trimmed, drops empty boxes, refuses a bad code or markup; status hands it back", async () => {
    const h = await empowerHarness();
    const r = await saveSkus(h.deps, { "oud-large": " LM-OUD-300 ", "lemon-small": "", burner: "BRN-1" });
    expect(r.skus).toEqual({ "oud-large": "LM-OUD-300", burner: "BRN-1" });
    expect((await h.op("omniful_skus")).burner).toBe("BRN-1");
    expect(await err(saveSkus(h.deps, { "<script>": "x" }))).toBe("400 bad_code <script>");
    expect(await err(saveSkus(h.deps, { burner: "<b>" }))).toBe("400 bad_sku burner");
    expect(await err(saveSkus(h.deps, null))).toBe("400 no_skus");
    const st = await empowerStatus(h.deps);
    expect(st.skus.burner + " " + st.skus["oud-large"]).toBe("BRN-1 LM-OUD-300");
    // a catalogue publish cannot touch it: it is not in the catalogue
    expect(JSON.stringify(await loadCatalogue(h.deps, { fresh: true })).indexOf("LM-OUD-300")).toBe(-1);
  });

  // from test-omniful.js / test-v202.js: the status action
  it("status: state (never the token), routing, counts of waiting and every order ever pushed", async () => {
    const h = await empowerHarness({ routes: { QA: "manual" }, env: { OMNIFUL_HOOK_SECRET: "s" } });
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const a = await h.order();
    await h.order();
    await h.order({ countryCode: "QA" });
    await h.order({ status: "prep" });
    await pushOne(h.deps, { id: a.id });
    const st: any = await empowerStatus(h.deps);
    expect(st.ok).toBe(true);
    expect(st.configured + " " + st.hub + " " + st.env).toBe("true set production");
    expect(JSON.stringify(st).indexOf("fake-omniful-token")).toBe(-1);
    expect(st.waiting + " " + st.pushed).toBe("1 1");
    expect(st.routing.find((r: any) => r.code === "QA")).toMatchObject({ courier: "manual", chosen: true });
    expect(st.routing.find((r: any) => r.code === "OM")).toMatchObject({ courier: "omniful", chosen: false });
    expect(st.couriers).toEqual(["omniful", "manual"]);
    expect(st.hookPath + " " + st.hookGuarded).toBe("/api/omniful/hook true");
    expect(st.lastSweep).toMatchObject({ pushed: 1, one: a.id });
    expect(st.auto).toMatchObject({ on: false, afterMin: 3, everyMin: 1, retryH: 6 });
  });

  // from test-omniful.js: the route action guards its inputs
  it("routes a market in the catalogue, keeping the rest of the row; refuses bad input and unknown markets", async () => {
    const h = await empowerHarness();
    expect(await err(setRoute(h.deps, "ZZ", "omniful"))).toBe("404 no_such_market");
    expect(await err(setRoute(h.deps, "A", "omniful"))).toBe("400 bad_country");
    expect(await err(setRoute(h.deps, "AE", "smsa"))).toBe("400 bad_courier");
    const before = await loadCatalogue(h.deps, { fresh: true });
    const r = await setRoute(h.deps, "ae", "MANUAL");
    expect(r).toEqual({ ok: true, code: "AE", courier: "manual" });
    const after = await loadCatalogue(h.deps, { fresh: true });
    const ae = after.countries.find((c) => c.code === "AE")!;
    expect(ae.courier).toBe("manual");
    expect(ae.prices).toEqual(before.countries.find((c) => c.code === "AE")!.prices);
    expect(after.countries.length).toBe(before.countries.length);
  });

  it("Match from Omniful: their catalogue, or 409 when not set up", async () => {
    const h = await empowerHarness();
    h.omf.skus = [{ sku_code: "LM3001", name: "oud-large" }];
    expect((await catalogSkus(h.deps)).skus).toEqual([{ sku_code: "LM3001", name: "oud-large", type: "simple", status: "active" }]);
    const off = await empowerHarness({ env: { OMNIFUL_API_TOKEN: "" } });
    expect(await err(catalogSkus(off.deps))).toBe("409 omniful_not_configured");
    expect(await err(syncNow(off.deps))).toBe("409 omniful_not_configured");
  });

  it("the waiting list marks an order whose push is being checked; the Orders list gets each order's Empower record", async () => {
    const h = await empowerHarness();
    await h.setOp("omniful_skus", { "oud-large": "LM3001" });
    const a = await h.order();
    const b = await h.order();
    h.omf.dropAnswer = (id) => id === b.id;
    await pushOne(h.deps, { id: a.id });
    await err(pushOne(h.deps, { id: b.id }));
    h.omf.dropAnswer = null;
    const w = await waitingList(h.deps);
    expect(w.orders.map((o) => o.id + ":" + !!o.unsure)).toEqual([b.id + ":true"]);
    const rec = await empowerRecords(h.deps, [a.id, b.id, "junk"]);
    expect(rec.records[a.id]).toMatchObject({ sent: a.id, ref: "OMF-1", awb: null, st: "Sent to Omniful", done: null });
    expect(rec.unsure).toEqual([b.id]);
    const pushed = await pushedList(h.deps);
    expect(pushed.rows.map((r) => r.id)).toEqual(["omf-" + a.id]);
  });
});
