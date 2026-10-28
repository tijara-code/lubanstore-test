import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueFile, json, ready } from "./_boot";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.LMPX;
  delete window.LMBeacon;
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** the core with /api/order answered by `answer` */
async function withTill(answer: (body: { order: { id: string } }) => Response | Promise<Response>, local: Record<string, string> = {}) {
  let posts = 0;
  const r = await ready({
    local,
    fetch: (url, init) => {
      if (url === "/api/settings") return Promise.resolve(json(catalogueFile()));
      if (url === "/api/geo") return Promise.resolve(json({ country: "OM" }));
      if (url === "/api/order") {
        posts++;
        return Promise.resolve(answer(JSON.parse(String(init!.body))));
      }
      return Promise.reject(new Error("offline"));
    },
  });
  return { ...r, posts: () => posts };
}

// from test-v209.js: a parked order is posted once however many pages ask
describe("the parked-order queue", () => {
  it("two passes at once: one POST, one Purchase, the queue emptied", async () => {
    let bought = 0;
    const { LM, posts } = await withTill(async (b) => {
      await tick(30);
      return json({ ok: true, id: b.order.id, omr: 5 });
    });
    window.LMPX = { purchase: () => void bought++ } as unknown as Window["LMPX"];
    localStorage.setItem("lm_order_queue", JSON.stringify([{ id: "LM-2000001", omr: 5, items: [] }]));
    await Promise.all([LM.flushOrders(), LM.flushOrders()]);
    expect([posts(), bought, localStorage.getItem("lm_order_queue")]).toEqual([1, 1, null]);
    // an order parked while a pass is out is posted by the next ask, and survives the first pass
    localStorage.setItem("lm_order_queue", JSON.stringify([{ id: "LM-2000002", omr: 5, items: [] }]));
    const p3 = LM.flushOrders();
    localStorage.setItem("lm_order_queue", JSON.stringify([{ id: "LM-2000002", omr: 5, items: [] }, { id: "LM-2000003", omr: 5, items: [] }]));
    const p4 = LM.flushOrders();
    await Promise.all([p3, p4]);
    expect([posts(), bought, localStorage.getItem("lm_order_queue")]).toEqual([3, 3, null]);
  });

  it("the Purchase goes under the id and total the server answered", async () => {
    const seen: Array<{ id: string; omr: number }> = [];
    const { LM } = await withTill(() => json({ ok: true, id: "LM-777777", omr: 9.5 }));
    window.LMPX = { purchase: (o: unknown) => void seen.push(o as { id: string; omr: number }) } as unknown as Window["LMPX"];
    LM.queueOrder({ id: "LM-tmp-1", omr: 5 });
    expect(await LM.flushOrders()).toBe(1);
    expect(seen.map((o) => o.id + " " + o.omr)).toEqual(["LM-777777 9.5"]);
  });

  // from test-v314.js: `already` is another tab's pass — it fired the Purchase
  it("an `already` answer lands the order but fires no browser Purchase", async () => {
    let bought = 0;
    const { LM } = await withTill((b) => json({ ok: true, id: b.order.id, already: true }));
    window.LMPX = { purchase: () => void bought++ } as unknown as Window["LMPX"];
    LM.queueOrder({ id: "LM-3000001" });
    expect(await LM.flushOrders()).toBe(1);
    expect(bought).toBe(0);
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
  });

  // from test-v336-checkout.js: a parked order the server later refuses is reported, without the person
  it("a refusal (4xx with an error) drops it and logs one line with no personal data", async () => {
    const sent: Array<{ k: string; b: Record<string, string> }> = [];
    window.LMBeacon = { queue: (k: string, b: unknown) => void sent.push({ k, b: b as Record<string, string> }), flush() {} } as unknown as Window["LMBeacon"];
    const { LM } = await withTill(() => json({ ok: false, error: "offer_closed" }, { status: 409 }), {
      lm_order_queue: JSON.stringify([{ id: "LM-3000000001", name: "Test Shopper", phone: "+968 91234567", region: "Street 5" }]),
    });
    await LM.flushOrders();
    await tick(10); // the pass started at load carries it
    const log = sent.filter((x) => x.k === "log").map((x) => x.b)[0]!;
    expect([log.kind, log.message, log.detail]).toEqual(["error", "parked order refused: offer_closed", "LM-3000000001"]);
    expect(/Shopper|91234567|Street/.test(JSON.stringify(sent))).toBe(false);
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
  });

  it("without the beacon module the refusal goes to /api/beacon directly", async () => {
    const beacons: string[] = [];
    await ready({
      local: { lm_order_queue: JSON.stringify([{ id: "LM-1", name: "x" }]) },
      fetch: (url, init) => {
        if (url === "/api/settings") return Promise.resolve(json(catalogueFile()));
        if (url === "/api/order") return Promise.resolve(json({ ok: false, error: "bad_phone" }, { status: 400 }));
        if (url === "/api/beacon") beacons.push(String(init!.body));
        return Promise.resolve(json({ country: "OM" }));
      },
    });
    await tick(10);
    expect(beacons.length).toBe(1);
    expect(JSON.parse(beacons[0]!).items[0].body.message).toBe("parked order refused: bad_phone");
  });

  it("the wire (5xx, network) and a 429 keep it for the next try", async () => {
    let code = 503;
    const { LM, posts } = await withTill(() => json({ ok: false, error: "x" }, { status: code }));
    LM.queueOrder({ id: "LM-9" });
    await LM.flushOrders();
    expect(JSON.parse(localStorage.getItem("lm_order_queue")!).length).toBe(1);
    code = 429;
    await LM.flushOrders();
    expect(JSON.parse(localStorage.getItem("lm_order_queue")!).length).toBe(1);
    code = 200;
    await LM.flushOrders();
    expect(posts()).toBe(3);
  });

  it("a queue found at load is posted once the catalogue is in; an order is queued once; at most 20 kept", async () => {
    const { LM, posts } = await withTill((b) => json({ ok: true, id: b.order.id }), { lm_order_queue: JSON.stringify([{ id: "LM-5" }]) });
    await tick(10);
    expect(posts()).toBe(1);
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    LM.queueOrder({ id: "LM-6" });
    LM.queueOrder({ id: "LM-6" });
    expect(JSON.parse(localStorage.getItem("lm_order_queue")!).length).toBe(1);
    for (let i = 0; i < 30; i++) LM.queueOrder({ id: "LM-x" + i });
    expect(JSON.parse(localStorage.getItem("lm_order_queue")!).length).toBe(20);
  });

  it("retried every minute while the tab is open, and when the browser comes back online", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let up = false;
    const { LM, posts } = await withTill((b) => (up ? json({ ok: true, id: b.order.id }) : json({ ok: false }, { status: 503 })));
    LM.queueOrder({ id: "LM-10" });
    expect(posts()).toBe(0);
    await vi.advanceTimersByTimeAsync(60000);
    expect(posts()).toBe(1);
    up = true;
    window.dispatchEvent(new Event("online"));
    await tick(10);
    // (earlier boots in this file listen too: every page instance retries on `online`)
    expect(posts()).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem("lm_order_queue")).toBe(null);
  });
});
