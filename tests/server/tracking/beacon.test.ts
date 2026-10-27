import { asc, desc } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, logs } from "../../../src/server/db/schema";
import { BEACON_MAX_ITEMS } from "../../../src/server/routes/tracking";
import { pixelsFake } from "../../../src/server/services/pixels/fake";
import { createHarness, type Harness } from "../../helpers/harness";

const geo = (g: unknown) => Buffer.from(JSON.stringify(g)).toString("base64");
let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.reset(); });
beforeEach(async () => { await h.reset(); pixelsFake(h.world).clear(); });
const evRows = () => h.db.select().from(events).orderBy(asc(events.id));

// from test-beacon.js: the fan-out
describe("/api/beacon", () => {
  it("fans the batch out in process, with this request's headers, and answers 204 whatever happened", async () => {
    h.world.fail((c) => (c.host === "graph.facebook.com" ? "refused" : null));
    const r = await h.post("/api/beacon", { items: [
      { kind: "ev", body: { name: "page_view", item: "home", sid: "abcd1234" } },
      { kind: "snap", body: { name: "PAGE_VIEW", id: "pv-1" } },
      { kind: "meta", body: { name: "PageView", id: "fbpv-1" } },
      { kind: "log", body: { kind: "error", message: "TypeError: x is null", place: "/" } },
      { kind: "nope", body: { name: "x" } },
      { kind: "ev", body: "not an object" },
      { kind: "constructor", body: {} },
    ] }, { "user-agent": "UA/1", "x-nf-client-connection-ip": "1.2.3.4", "x-country": "OM" });
    h.world.fail(null);
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    const ev = await evRows();
    expect(ev.map((e) => [e.name, e.item, e.sid, e.country])).toEqual([["page_view", "home", "abcd1234", "OM"]]);
    const snap = pixelsFake(h.world).snap;
    expect(snap.length).toBe(1);
    expect(snap[0]!.event.user_data.client_ip_address).toBe("1.2.3.4");
    expect(snap[0]!.event.user_data.client_user_agent).toBe("UA/1");
    expect(snap[0]!.event.event_id).toBe("pv-1");
    const lg = await h.db.select().from(logs);
    expect(lg.filter((l) => l.side === "browser").map((l) => l.message)).toEqual(["TypeError: x is null"]);
    // Meta was down: noted for Tracking health, and the rest still went
    expect(h.world.calls.some((c) => c.host === "graph.facebook.com")).toBe(true);
  });
  it("is capped at a dozen, refuses GET, junk and an empty batch; any content type (sendBeacon)", async () => {
    expect(BEACON_MAX_ITEMS).toBe(12);
    const many = { items: Array.from({ length: 40 }, (_, i) => ({ kind: "ev", body: { name: "page_view", sid: "sid" + String(i).padStart(4, "0") } })) };
    expect((await h.request("/api/beacon", { method: "POST", body: JSON.stringify(many), headers: { "content-type": "text/plain;charset=UTF-8" } })).status).toBe(204);
    expect((await evRows()).length).toBe(12);
    expect((await h.get("/api/beacon")).status).toBe(405);
    expect((await h.request("/api/beacon", { method: "POST", body: "{" })).status).toBe(400);
    expect((await h.post("/api/beacon", { items: [] })).status).toBe(400);
    expect((await h.post("/api/beacon", {})).status).toBe(400);
  });
  it("counts one post per page per address, and stops a flood with 429", async () => {
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await h.post("/api/beacon", { items: [{ kind: "nope", body: {} }] }, { "x-nf-client-connection-ip": "9.9.9.9" })).status;
    expect(last).toBe(429);
    expect((await h.post("/api/beacon", { items: [{ kind: "nope", body: {} }] }, { "x-nf-client-connection-ip": "9.9.9.8" })).status).toBe(204);
  });
});

// from test-stats.js / test-v302.js / test-v338-live.js: the collector
describe("/api/ev", () => {
  it("stores the allowlisted name, the item, the shape-checked sid and the edge's country — nothing else", async () => {
    expect((await h.post("/api/ev", { name: "size_open", item: "large", sid: "abcd1234", ip: "1.2.3.4", ua: "x" })).status).toBe(204);
    expect((await h.post("/api/ev", { name: "add_cart", item: "oud-small", sid: "bad sid!" })).status).toBe(204);
    expect((await h.post("/api/ev", { name: "steal_data", sid: "abcd1234" })).status).toBe(400);
    expect((await h.get("/api/ev")).status).toBe(405);
    const r = await evRows();
    expect(r.map((e) => [e.name, e.item, e.sid, e.country])).toEqual([["size_open", "large", "abcd1234", "OM"], ["add_cart", "oud-small", null, "OM"]]);
    expect(Object.keys(r[0]!).sort()).toEqual(["at", "city", "country", "id", "item", "lat", "lng", "name", "sid"]);
  });
  // from test-v302.js: a session says where it came from, placed by the server
  it("places a session_start's landing in the standard", async () => {
    await h.post("/api/ev", { name: "session_start", sid: "abcd1234", land: { utm: { source: "Snap", medium: "Paid_Social", campaign: "Launch Test" } } });
    await h.post("/api/ev", { name: "session_start", sid: "abcd5678", land: {} });
    await h.post("/api/ev", { name: "session_start", sid: "abcd9999", land: { ref: "https://lubanmusk.test" } });
    expect((await evRows()).map((e) => e.item)).toEqual(["snapchat|paid_social|launch_test", "(direct)|(none)|", "(direct)|(none)|"]);
  });
  // from test-v338-live.js: the edge's place
  it("adds the city and a point rounded to a tenth of a degree", async () => {
    await h.post("/api/ev", { name: "page_view", sid: "sidA1", item: "home" },
      { "x-nf-geo": geo({ city: "Riyadh", country: { code: "SA" }, latitude: 24.7136, longitude: 46.6753 }), "x-country": "" });
    await h.post("/api/ev", { name: "page_view", sid: "sidA2" }, { "x-nf-geo": geo({ city: "<b>Doha</b>", latitude: 0, longitude: 0 }) });
    const [a, b] = await evRows();
    expect([a!.city, a!.lat, a!.lng, a!.country]).toEqual(["Riyadh", 24.7, 46.7, "SA"]);
    expect([b!.city, b!.lat, b!.lng]).toEqual(["bDoha/b", null, null]);
  });
  it("honours Do Not Track and Global Privacy Control (first-party events only)", async () => {
    expect((await h.post("/api/ev", { name: "page_view", sid: "abcd1234" }, { dnt: "1" })).status).toBe(204);
    expect((await h.post("/api/ev", { name: "page_view", sid: "abcd1234" }, { "sec-gpc": "1" })).status).toBe(204);
    expect((await evRows()).length).toBe(0);
    await h.post("/api/meta", { name: "PageView", id: "pv-dnt" }, { dnt: "1" });
    expect(pixelsFake(h.world).meta.length).toBe(1);
  });
  // from test-v336 (beacon.js): posted directly, counted per address — 60 a minute
  it("counts direct posts per address; a beacon's items are the beacon's", async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await h.post("/api/ev", { name: "page_view" }, { "x-nf-client-connection-ip": "7.7.7.7" })).status;
    expect(last).toBe(429);
    expect((await h.post("/api/beacon", { items: [{ kind: "ev", body: { name: "page_view", sid: "beacon01" } }] }, { "x-nf-client-connection-ip": "7.7.7.7" })).status).toBe(204);
    const r = await h.db.select().from(events).orderBy(desc(events.id)).limit(1);
    expect(r[0]!.sid).toBe("beacon01");
  });
});

// from test-admin-data.js: the logs
describe("/api/log", () => {
  it("takes two kinds, a short message, the agent and the place — masked, never the IP", async () => {
    expect((await h.post("/api/log", { kind: "error", message: "x".repeat(400), detail: "at f (https://lubanmusk.com/assets/main.js:1:2)", place: "/checkout", sid: "abcd1234" },
      { "user-agent": "Mozilla/5.0 (iPhone) Safari" })).status).toBe(204);
    expect((await h.post("/api/log", { kind: "rejection", message: "call me on 96891234567 or a@b.co" })).status).toBe(204);
    expect((await h.post("/api/log", { kind: "warn", message: "x" })).status).toBe(400);
    expect((await h.post("/api/log", { kind: "error", message: "" })).status).toBe(400);
    expect((await h.post("/api/log", { kind: "error", message: "bot" }, { "user-agent": "facebookexternalhit/1.1" })).status).toBe(204);
    const rows = await h.db.select().from(logs).orderBy(asc(logs.id));
    expect(rows.length).toBe(2);
    expect(rows[0]!.message.length).toBe(300);
    expect([rows[0]!.side, rows[0]!.source, rows[0]!.path]).toEqual(["browser", "error", "/checkout"]);
    expect(rows[0]!.detail).toEqual({ stack: "at f (https://lubanmusk.com/assets/main.js:1:2)", ua: "Mozilla/5.0 (iPhone) Safari", sid: "abcd1234", country: "OM" });
    expect(rows[1]!.message).toBe("call me on [number] or [email]");
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });
  it("counts direct posts per address: 30 a minute", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await h.post("/api/log", { kind: "error", message: "m" + i }, { "x-nf-client-connection-ip": "6.6.6.6" })).status;
    expect(last).toBe(429);
  });
});
