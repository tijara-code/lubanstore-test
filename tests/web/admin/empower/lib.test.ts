/**
 * The Empower tab's words and its Push all loop (src/admin/tabs/empower/lib.ts). Ported
 * UI-side checks of test-v316 (the auto note), test-v402 (push all until `left` is empty),
 * test-empower / test-omniful (the status lines, the SKU list, the stage), test-v447 (stages).
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../src/admin/data/api";
import type { Catalogue } from "../../../../src/shared/catalogue/types";
import type { PushedRow, SweepAnswer } from "../../../../src/admin/tabs/empower/api";
import { skuWord } from "../../../../src/admin/tabs/empower/Detail";
import { autoNote, connWord, filterPushed, finished, pollLine, pushAll, skuProducts, stageOf, statusWords, sweepLine } from "../../../../src/admin/tabs/empower/lib";

const NOW = Date.parse("2026-10-28T08:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();

describe("the lines under the connection", () => {
  it("the last push and the last status read, in a sentence", () => {
    expect(sweepLine(null, NOW)).toEqual({ text: "Nothing pushed yet.", bad: false });
    expect(sweepLine({ at: ago(18), pushed: 2, waiting: 3, failed: [] }, NOW)).toEqual({ text: "Last push ran 18 min ago. 2 pushed · 3 still waiting.", bad: false });
    expect(sweepLine({ at: ago(180), pushed: 0, failed: [{ id: "LM-1000001", error: "x", detail: "y" }] }, NOW)).toEqual({ text: "Last push ran 3 h ago. 0 pushed · 1 refused.", bad: true });
    expect(pollLine(null, NOW).text).toBe("Statuses sync every 30 min. Not read yet.");
    expect(pollLine({ at: ago(12), tracked: 3, updated: 1, moved: 1, errors: [] }, NOW)).toEqual({ text: "Statuses read 12 min ago. 3 checked · 1 changed · 1 order moved. Orders move with their parcels on their own.", bad: false });
    expect(pollLine({ at: ago(0), tracked: 2, errors: [{ id: null, error: "e", detail: "d" }] }, NOW).bad).toBe(true);
  });

  // test-v316 / test-v338: the tab is told the run's own figures
  it("the auto push's note: what on means, what the last run did", () => {
    expect(autoNote({ on: false, since: null, afterMin: 3, everyMin: 1, retryH: 6, last: null })).toBe("");
    const s = autoNote({ on: true, since: null, afterMin: 3, everyMin: 1, retryH: 6, last: { at: "2026-10-27T09:45:00Z", pushed: 2, flagged: [{ id: "LM-900002", missing: ["area"] }], failed: [{ id: "LM-900009", error: "omniful_rejected", detail: "x" }] } });
    expect(s).toMatch(/^On: complete website orders go to Empower 3 min after they are placed \(card: once paid\), by a run every minute\. Last run .*: 2 pushed · 1 held back \(check details\) · 1 refused by Omniful \(retried after 6 h\)\.$/);
  });

  it("the connection's word", () => {
    expect(connWord({ configured: false, missing: ["OMNIFUL_API_TOKEN"], env: "production" })).toMatchObject({ text: "no API token", ready: false });
    expect(connWord({ configured: true, missing: ["OMNIFUL_HUB_CODE"], env: "production" })).toMatchObject({ text: "needs a hub code", ready: false });
    expect(connWord({ configured: true, missing: [], env: "staging" })).toMatchObject({ text: "staging", ready: true });
    expect(connWord({ configured: true, missing: [], env: "production" })).toMatchObject({ text: "live", ready: true });
  });
});

describe("what was pushed", () => {
  // test-v447 (the stage order): a failed delivery and a return before "delivered"
  it("stages", () => {
    expect(stageOf("delivered")).toBe("delivered");
    expect(stageOf("Undelivered")).toBe("failed");
    expect(stageOf("delivery failed")).toBe("failed");
    expect(stageOf("returned_to_origin")).toBe("returned");
    expect(stageOf("out_for_delivery")).toBe("transit");
    expect(stageOf("picked_up")).toBe("picked");
    expect(stageOf("Shipment Refused")).toBe("failed");
    expect(stageOf("")).toBe("created");
    expect(statusWords("out_for_delivery")).toBe("Out For Delivery");
    expect(statusWords(null)).toBe("Sent");
  });
  const row = (over: Partial<PushedRow>): PushedRow => ({ id: "omf-LM-1", orderId: "LM-1000001", carrier: "empower", sentId: "LM-1000001", reference: "OMF1", awb: null, courierName: "Aramex", status: "picked_up", cod: 0, createdAt: ago(60), updatedAt: ago(5), pickedUpAt: null, deliveredAt: null, syncedAt: null, lastError: null, ...over });
  it("the stage filter and the search", () => {
    const rows = [row({}), row({ id: "b", orderId: "LM-1000002", deliveredAt: ago(1), status: "delivered" }), row({ id: "c", orderId: "LM-1000003", status: "Shipment Refused", lastError: "Consignee refused" }), row({ id: "d", orderId: "LM-1000004", awb: "44123", city: "Dubai" } as never)];
    expect(filterPushed(rows, "", "").length).toBe(4);
    expect(filterPushed(rows, "open", "").map((r) => r.id)).toEqual(["omf-LM-1", "c", "d"]);
    expect(filterPushed(rows, "delivered", "").map((r) => r.id)).toEqual(["b"]);
    expect(filterPushed(rows, "problem", "").map((r) => r.id)).toEqual(["c"]);
    expect(filterPushed(rows, "error", "").map((r) => r.id)).toEqual(["c"]);
    expect(filterPushed(rows, "", "44123").map((r) => r.id)).toEqual(["d"]);
    expect(filterPushed(rows, "", "lm-1000002").map((r) => r.id)).toEqual(["b"]);
    // still in flight: not delivered, not taken off, not returned
    expect(rows.filter((r) => !finished(r)).length).toBe(3);
    expect(finished(row({ status: "cancelled" }))).toBe(true);
  });
});

describe("the SKU list (test-empower / test-omniful)", () => {
  it("each scent in each size, each add-on, the set last", () => {
    const cfg = {
      countries: [{ code: "OM", sizes: [{ id: "large", name: "كبير", name_en: "Large", weight_en: "300 g" }], scents: [{ id: "oud", name: "عود", name_en: "Oud" }], extras: [{ id: "burner", name: "مبخرة", name_en: "Burner" }] }],
      sizes: [{ id: "small", name: "صغير", name_en: "Small" }],
      scents: [],
      offer: { name_en: "The Three-Scent Set" },
    } as unknown as Catalogue;
    expect(skuProducts(cfg)).toEqual([
      { code: "oud-small", name: "Oud · Small" },
      { code: "oud-large", name: "Oud · Large 300 g" },
      { code: "burner", name: "Burner" },
      { code: "bundle", name: "The Three-Scent Set (bundle)", empty: "Empty = sent as its 3 boxes" },
    ]);
  });
  // the original's omfOrderBlocks: a code, "as its 3 boxes", or "no SKU"
  it("what an item goes out as", () => {
    expect(skuWord("oud-large", { "oud-large": "LM3001" })).toEqual({ text: "LM3001", tone: "" });
    expect(skuWord("bundle", {})).toEqual({ text: "as its 3 boxes", tone: "muted" });
    expect(skuWord("trio:oud.oud.amber", {})).toEqual({ text: "as its boxes", tone: "muted" });
    expect(skuWord("oud-small", {})).toEqual({ text: "no SKU", tone: "warn" });
  });
});

describe("Push all (test-v402): one press, every order", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => "LM-10000" + String(i + 10));
  it("goes again with what each call did not reach, until none are left", async () => {
    const asked: string[][] = [];
    const send = async (part: string[]): Promise<SweepAnswer> => {
      asked.push(part);
      // the server sends 6 and answers the rest as left
      return { ok: true, pushed: Math.min(6, part.length), left: part.slice(6), failed: [] };
    };
    const seen: string[] = [];
    const r = await pushAll(ids(13), send, (n, t) => seen.push(n + "/" + t));
    expect(r).toEqual({ pushed: 13, failed: [], stop: "" });
    expect(asked.map((a) => a.length)).toEqual([13, 7, 1]);
    expect(seen).toEqual(["1/13", "7/13", "13/13"]);
  });
  it("more than 200: 200 a call", async () => {
    const asked: number[] = [];
    const r = await pushAll(ids(250), async (part) => (asked.push(part.length), { ok: true, pushed: part.length, left: [], failed: [] }));
    expect(asked).toEqual([200, 50]);
    expect(r.pushed).toBe(250);
  });
  it("nothing done twice in a row: stops rather than spin", async () => {
    const r = await pushAll(ids(3), async (part) => ({ ok: true, pushed: 0, left: part, failed: [] }));
    expect(r.stop).toBe("Omniful is slow to answer. Try again in a minute.");
  });
  it("collects refusals; a refused call or a skip stops with words", async () => {
    let n = 0;
    const r = await pushAll(ids(2), async () => (n++ ? { ok: true, pushed: 1, left: [], failed: [] } : { ok: true, pushed: 0, left: ["LM-1000011"], failed: [{ id: "LM-1000010", error: "omniful_duplicate", detail: "taken" }] }));
    expect(r).toEqual({ pushed: 1, failed: [{ id: "LM-1000010", error: "omniful_duplicate", detail: "taken" }], stop: "" });
    const e = await pushAll(ids(2), async () => {
      throw new ApiError("omniful_not_configured", 409);
    });
    expect(e.stop).toBe("Omniful not connected. Add its API token on the server.");
    const s = await pushAll(ids(2), async () => ({ ok: true, skipped: "no_market_routed" }));
    expect(s.stop).toBe("no market is routed to Empower");
  });
});
