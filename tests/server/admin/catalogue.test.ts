import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { catalogueChanges, settings } from "../../../src/server/db/schema";
import { editTag, prepare, stampFreeShip, stampOffer, stampSetFree, stampTiers } from "../../../src/server/domain/admin/catalogue";
import { bundledCatalogue } from "../../../src/server/domain/catalogue";
import type { Catalogue } from "../../../src/shared/catalogue/types";
import { createHarness, T0, type Harness } from "../../helpers/harness";
import { adminClient, trail, type AdminClient } from "./_helpers";

const iso = (t: number) => new Date(t).toISOString();
type Obj = Record<string, any>;

describe("the stamps (functions of their arguments)", () => {
  // from test-free-ship.js: the server stamps the free-delivery start
  it("stampFreeShip: on → now (a forged start ignored); kept; days/over keep it; off loses it; restart", () => {
    const at = Date.parse("2026-09-23T11:00:00Z");
    const next: Obj = { freeShip: { active: true, countries: { OM: { on: true, over: 10, days: 5, from: "1999-01-01T00:00:00.000Z" }, KW: { on: false, from: "2026-01-01" } } } };
    stampFreeShip({ freeShip: { countries: {} } }, next, at);
    expect(next.freeShip.countries.OM.from).toBe(iso(at));
    expect("from" in next.freeShip.countries.KW).toBe(false);
    const again: Obj = { freeShip: { countries: { OM: { on: true, over: 10, days: 5 } } } };
    stampFreeShip(next, again, at + 86400e3);
    expect(again.freeShip.countries.OM.from).toBe(iso(at));
    const longer: Obj = { freeShip: { countries: { OM: { on: true, over: 10, days: 7 } } } };
    stampFreeShip(next, longer, at + 86400e3);
    expect(longer.freeShip.countries.OM.from).toBe(iso(at));
    const cheaper: Obj = { freeShip: { countries: { OM: { on: true, over: 5, days: 5 } } } };
    stampFreeShip(next, cheaper, at + 2 * 86400e3);
    expect(cheaper.freeShip.countries.OM).toMatchObject({ from: iso(at), over: 5 });
    const off: Obj = { freeShip: { countries: { OM: { on: false, over: 10, days: 5 } } } };
    stampFreeShip(next, off, at + 86400e3);
    expect("from" in off.freeShip.countries.OM).toBe(false);
    const on2: Obj = { freeShip: { countries: { OM: { on: true, over: 10, days: 5 } } } };
    stampFreeShip(off, on2, at + 3 * 86400e3);
    expect(on2.freeShip.countries.OM.from).toBe(iso(at + 3 * 86400e3));
    const rerun: Obj = { freeShip: { countries: { OM: { on: true, over: 10, days: 5, restart: true } } } };
    stampFreeShip(next, rerun, at + 9 * 86400e3);
    expect(rerun.freeShip.countries.OM.from).toBe(iso(at + 9 * 86400e3));
    expect("restart" in rerun.freeShip.countries.OM).toBe(false);
  });

  // from test-v411.js §3
  it("stampSetFree: the set's free-delivery window", () => {
    const stamp = (before: Obj, next: Obj, at: number) => (stampSetFree(before, next, at), next.offer);
    const o = stamp({ offer: {} }, { offer: { freeShip: true, freeShipHours: 72 } }, T0);
    expect(o.freeShipAnchor).toBe(iso(T0));
    expect(stamp({ offer: o }, { offer: { freeShip: true, freeShipHours: 72, freeShipIn: ["OM"] } }, T0 + 3600e3).freeShipAnchor).toBe(o.freeShipAnchor);
    expect(stamp({ offer: o }, { offer: { freeShip: true, freeShipHours: 48 } }, T0 + 3600e3).freeShipAnchor).toBe(iso(T0 + 3600e3));
    const r = stamp({ offer: o }, { offer: { freeShip: true, freeShipHours: 72, freeShipReset: true } }, T0 + 7200e3);
    expect(r.freeShipAnchor).toBe(iso(T0 + 7200e3));
    expect("freeShipReset" in r).toBe(false);
    expect("freeShipAnchor" in stamp({ offer: o }, { offer: { freeShip: false, freeShipHours: 72 } }, T0)).toBe(false);
    expect("freeShipAnchor" in stamp({ offer: o }, { offer: { freeShip: true } }, T0)).toBe(false);
    // v413: a change to "When it closes" starts it again too
    expect(stamp({ offer: o }, { offer: { freeShip: true, freeShipHours: 72, freeShipRenew: "auto" } }, T0 + 60e3).freeShipAnchor).toBe(iso(T0 + 60e3));
  });

  // from test-offer-admin.js: the one-shot window (the panel's harvest rules, now the server's)
  it("stampOffer: a one-shot window restarts on a new length, on becoming one-shot, when over; a rolling one keeps its anchor", () => {
    const now = T0;
    const nineAgo = iso(now - 9 * 3600e3);
    const rolling = { offer: { id: "bundle", active: true, hours: 72, renew: "auto", anchor: nineAgo } };
    // rolling: a new length keeps the anchor
    let next: Obj = { offer: { ...rolling.offer, hours: 48, anchor: "2020-01-01T00:00:00Z" } };
    stampOffer(rolling, next, now);
    expect(next.offer.anchor).toBe(nineAgo); // the stored one, never the posted one
    // switched to one-shot with 12 h → restarts now: 12 h left
    next = { offer: { ...rolling.offer, hours: 12, renew: "once" } };
    stampOffer(rolling, next, now);
    expect(next.offer.anchor).toBe(iso(now));
    // its length again (6) → restarts
    const once = { offer: next.offer };
    let n2: Obj = { offer: { ...once.offer, hours: 6 } };
    stampOffer(once, n2, now + 3600e3);
    expect(n2.offer.anchor).toBe(iso(now + 3600e3));
    // neither length nor mode touched → unchanged (unrelated edits never extend it)
    n2 = { offer: { ...once.offer, name: "new name" } };
    stampOffer(once, n2, now + 3600e3);
    expect(n2.offer.anchor).toBe(iso(now));
    // a one-shot already over (anchor 40 h ago, 12 h long) is restarted rather than stored over
    const dead = { offer: { ...once.offer, anchor: iso(now - 40 * 3600e3) } };
    n2 = { offer: { ...dead.offer } };
    stampOffer(dead, n2, now);
    expect(n2.offer.anchor).toBe(iso(now));
    // Reset (any mode) → now, and the flag does not stay
    n2 = { offer: { ...rolling.offer, anchorReset: true } };
    stampOffer(rolling, n2, now + 5000);
    expect(n2.offer.anchor).toBe(iso(now + 5000));
    expect("anchorReset" in n2.offer).toBe(false);
    // a rolling window with no anchor stays without one (the till's default anchor)
    n2 = { offer: { active: true, hours: 72, renew: "auto" } };
    stampOffer({ offer: { active: true, hours: 72 } }, n2, now);
    expect("anchor" in n2.offer).toBe(false);
  });

  // from the original panel's harvestTiers (v303): any change to the countdown restarts it
  it("stampTiers: on, a new length/unit/ending, Reset or no start → now; otherwise kept", () => {
    const a0 = iso(T0 - 86400e3);
    const prev = { tiers: { active: true, hours: 72, unit: "hours", renew: "once", anchor: a0 } };
    const run = (t: Obj, at = T0) => {
      const next: Obj = { tiers: t };
      stampTiers(prev, next, at);
      return next.tiers;
    };
    expect(run({ active: true, hours: 72, unit: "hours", renew: "once", countries: ["OM"] }).anchor).toBe(a0);
    expect(run({ active: true, hours: 48, unit: "hours", renew: "once" }).anchor).toBe(iso(T0));
    expect(run({ active: true, hours: 72, unit: "days", renew: "once" }).anchor).toBe(iso(T0));
    expect(run({ active: true, hours: 72, unit: "hours", renew: "auto" }).anchor).toBe(iso(T0));
    const r = run({ active: true, hours: 72, unit: "hours", renew: "once", anchorReset: true });
    expect(r.anchor).toBe(iso(T0));
    expect("anchorReset" in r).toBe(false);
    const switchedOn: Obj = { tiers: { active: true, hours: 72, unit: "hours", renew: "once" } };
    stampTiers({ tiers: { ...prev.tiers, active: false } }, switchedOn, T0);
    expect(switchedOn.tiers.anchor).toBe(iso(T0));
    const fresh: Obj = { tiers: { active: true, hours: 72 } };
    stampTiers({}, fresh, T0);
    expect(fresh.tiers.anchor).toBe(iso(T0));
    // off: the anchor it had is kept, nothing new stamped
    expect(run({ active: false, hours: 48, unit: "hours", renew: "once" }).anchor).toBe(a0);
  });

  // from test-v300.js / test-v314.js / test-admin-data: routes are the Empower tab's
  it("prepare keeps each market's stored route and the operational keys, drops what the server owns", () => {
    const stored = bundledCatalogue() as Obj;
    stored.countries[0].courier = "manual";
    stored.courier = { shipper: "kept" };
    const incoming = bundledCatalogue() as Obj;
    incoming.countries[0].courier = "omniful";
    incoming.countries[1].courier = "manual";
    incoming.__publishedVersion = 9;
    incoming.offer2 = { active: true };
    const out = prepare(stored as Catalogue, incoming as Catalogue, T0) as Obj;
    expect(out.countries[0].courier).toBe("manual");
    expect("courier" in out.countries[1]).toBe(false);
    expect(out.courier).toEqual({ shipper: "kept" });
    expect("__publishedVersion" in out).toBe(false);
    expect("offer2" in out).toBe(false);
  });

  it("the edit tag ignores routes and code-owned fields, sees everything else", () => {
    const a = bundledCatalogue() as Obj;
    const b = bundledCatalogue() as Obj;
    b.countries[0].courier = "manual";
    delete b.countries[0].toOmr;
    expect(editTag(b as Catalogue)).toBe(editTag(a as Catalogue));
    b.countries[0].prices.small.now = 1;
    expect(editTag(b as Catalogue)).not.toBe(editTag(a as Catalogue));
    expect(editTag(null)).toBe("none");
  });
});

describe("the Catalogue tab over HTTP", () => {
  let h: Harness;
  let a: AdminClient;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    a = await adminClient(h);
  });

  const load = async () => (await a.get("/catalogue")).body as { data: Obj; stored: Obj | null; version: number; editTag: string; codeOwned: Obj };

  // from test-catalogue-merge.js: the merged view; the stored version reported separately
  it("reads the merged catalogue, the stored row, its version and the code-owned fields", async () => {
    const r = await load();
    expect(r.version).toBe(1);
    expect(r.data.countries.find((c: Obj) => c.code === "AE").toOmr).toBe(0.1047);
    expect(r.stored).toBeTruthy();
    expect(r.codeOwned.country).toEqual(["toOmr"]);
    expect(r.editTag).toMatch(/^[0-9a-f]{24}$/);
  });

  // from test-catalogue-merge.js: settings.save stores the stripped copy
  it("publishes the stripped copy and records what changed, in words", async () => {
    const r0 = await load();
    const data = r0.data;
    const ae = data.countries.find((c: Obj) => c.code === "AE");
    ae.prices.small.now = 110;
    ae.toOmr = 0.1; // a stale rate never lands
    data.scents[0].art = "forged";
    const r = await a.post("/catalogue/publish", { data, version: r0.version, editTag: r0.editTag });
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
    expect(r.body.change).toContain("AE small 120→110 AED");
    const [row] = await h.db.select().from(settings);
    const sae = (row!.data.countries as Obj[]).find((c) => c.code === "AE")!;
    expect(sae.prices.small.now).toBe(110);
    expect("toOmr" in sae).toBe(false);
    expect((row!.data.scents as Obj[]).every((s) => !("art" in s))).toBe(true);
    expect(row!.version).toBe(2);
    expect(row!.updatedBy).toBe("shopkeeper");
    // the merged view heals the rate
    expect((await load()).data.countries.find((c: Obj) => c.code === "AE").toOmr).toBe(0.1047);
    const ch = await h.db.select().from(catalogueChanges);
    expect(ch.map((c) => c.what)).toEqual(["AE small 120→110 AED"]);
    expect(ch[0]!.actor).toBe("shopkeeper");
    const t = (await trail(h)).filter((x) => x.action !== "session.login");
    expect(t[0]).toMatchObject({ action: "catalogue.publish", target: "v2" });
    // from test-admin-data.js: a publish that changed nothing writes no change line
    const r1 = await load();
    const same = await a.post("/catalogue/publish", { data: r1.data, version: r1.version, editTag: r1.editTag });
    expect(same.body.change).toEqual([]);
    expect((await h.db.select().from(catalogueChanges)).length).toBe(1);
  });

  it("refuses a publish when another one happened since (409 stale) — but not for a route change", async () => {
    const r0 = await load();
    const first = structuredClone(r0.data);
    first.countries[0].prices.small.now = 111;
    expect((await a.post("/catalogue/publish", { data: first, version: r0.version, editTag: r0.editTag })).status).toBe(200);
    // the second tab, still on version 1
    const second = structuredClone(r0.data);
    second.countries[0].name = "renamed";
    const stale = await a.post("/catalogue/publish", { data: second, version: r0.version, editTag: r0.editTag });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, error: "stale", version: 2 });
    // a route set on the Empower tab meanwhile is not a conflict, and it is kept
    const r1 = await load();
    const route = await a.put("/empower/routes/OM", { courier: "manual" });
    expect(route.status).toBe(200);
    const edit = structuredClone(r1.data);
    edit.countries.find((c: Obj) => c.code === "OM").courier = "omniful";
    edit.countries[0].prices.small.now = 112;
    const ok = await a.post("/catalogue/publish", { data: edit, version: r1.version, editTag: r1.editTag });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(4);
    const om = (ok.body.data.countries as Obj[]).find((c) => c.code === "OM")!;
    expect(om.courier).toBe("manual");
  });

  it("validates: no market → bad_catalogue; a bad ISO code → bad_country_code; markup in an id or a colour → bad_input", async () => {
    const r0 = await load();
    expect((await a.post("/catalogue/publish", { data: { countries: [] }, version: 1 })).body.error).toBe("bad_catalogue");
    const bad = structuredClone(r0.data);
    bad.countries[0].code = "C1";
    expect((await a.post("/catalogue/publish", { data: bad, version: 1 })).body.error).toBe("bad_country_code");
    // from test-catalogue-injection.js: ids are slugs, colours plain hex (refused at the door too)
    const inj = structuredClone(r0.data);
    inj.scents[0].id = 'bad" onmouseover="x';
    inj.scents[1].accent = '#fff" onmouseover="alert(1)';
    const r = await a.post("/catalogue/publish", { data: inj, version: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad_input");
    expect(r.body.issues.map((i: Obj) => i.path)).toEqual(expect.arrayContaining(["data.scents.0.id", "data.scents.1.accent"]));
    expect((await h.db.select().from(settings))[0]!.version).toBe(1);
  });

  it("stamps the anchors and starts on the server; the request flags are never stored", async () => {
    const r0 = await load();
    const data = structuredClone(r0.data);
    data.freeShip = { active: true, countries: { OM: { on: true, over: 10, days: 5, from: "1999-01-01T00:00:00Z" } } };
    data.offer = { ...data.offer, renew: "once", hours: 12, anchor: "2001-01-01T00:00:00Z", freeShip: true, freeShipHours: 24, freeShipReset: true };
    data.tiers = { ...(data.tiers || {}), active: true, hours: 72, unit: "hours", renew: "once", anchorReset: true };
    const r = await a.post("/catalogue/publish", { data, version: r0.version, editTag: r0.editTag });
    expect(r.status).toBe(200);
    const d = r.body.data as Obj;
    expect(d.freeShip.countries.OM.from).toBe(iso(T0));
    expect(d.offer.anchor).toBe(iso(T0));
    expect(d.offer.freeShipAnchor).toBe(iso(T0));
    expect(d.tiers.anchor).toBe(iso(T0));
    for (const k of ["freeShipReset", "anchorReset"]) expect(k in d.offer).toBe(false);
    expect("anchorReset" in d.tiers).toBe(false);
    // a later publish an hour on keeps every start
    h.clock.advance(3600e3);
    const r1 = await load();
    const again = await a.post("/catalogue/publish", { data: r1.data, version: r1.version, editTag: r1.editTag });
    expect((again.body.data as Obj).freeShip.countries.OM.from).toBe(iso(T0));
    expect((again.body.data as Obj).offer.anchor).toBe(iso(T0));
    expect((again.body.data as Obj).tiers.anchor).toBe(iso(T0));
  });

  // from test-v314.js / test-catalogue-merge.js: Restore defaults keeps the operational settings
  it("restores the deploy's catalogue but keeps the routes; asks for the word first", async () => {
    await a.put("/empower/routes/AE", { courier: "manual" });
    const r0 = await load();
    const edit = structuredClone(r0.data);
    edit.countries[0].prices.small.now = 1;
    await a.post("/catalogue/publish", { data: edit, version: r0.version, editTag: r0.editTag });
    const r1 = await load();
    expect((await a.post("/catalogue/restore-defaults", { version: r1.version, editTag: r1.editTag })).status).toBe(400);
    const r = await a.post("/catalogue/restore-defaults", { version: r1.version, editTag: r1.editTag, confirm: "defaults" });
    expect(r.status).toBe(200);
    const d = r.body.data as Obj;
    expect(d.countries[0].prices.small.now).toBe(bundledCatalogue().countries[0]!.prices!.small!.now);
    expect((d.countries as Obj[]).find((c) => c.code === "AE")!.courier).toBe("manual");
  });

  it("writes the Stock Tracker's switches into the row where it stands, and nothing else", async () => {
    const r = await a.patch("/catalogue/stock", { stockLive: true, stockCap: { "oud-small": true, "lemon-small": false }, stockHide: { "amber-small": true } });
    expect(r.status).toBe(200);
    const [row] = await h.db.select().from(settings);
    expect(row!.data.stockLive).toBe(true);
    expect(row!.data.stockCap).toEqual({ "oud-small": true });
    expect(row!.data.stockHide).toEqual({ "amber-small": true });
    // from test-v211.js: the change log says "<id> cap at stock on"
    expect(r.body.change).toEqual(expect.arrayContaining(["oud-small cap at stock on", "pieces-left counter on"]));
    const off = await a.patch("/catalogue/stock", { stockCap: { "oud-small": false } });
    expect(off.body.change).toContain("oud-small cap at stock off");
    expect((await a.patch("/catalogue/stock", {})).status).toBe(400);
    await h.publish(null);
    expect((await a.patch("/catalogue/stock", { stockLive: false })).body.error).toBe("not_published");
  });

  it("exports the stored catalogue as a file", async () => {
    const res = await h.request("/api/admin/catalogue/export", { headers: { cookie: a.cookie } });
    expect(res.headers.get("content-disposition")).toMatch(/catalogue-2026-10-20-v1\.json/);
    const body = JSON.parse(await res.text());
    expect(body.countries.length).toBeGreaterThan(0);
  });

  it("publishes the first catalogue (version 0) when nothing is stored", async () => {
    await h.publish(null);
    const r0 = await load();
    expect(r0).toMatchObject({ version: 0, stored: null, editTag: "none" });
    const r = await a.post("/catalogue/publish", { data: r0.data, version: 0, editTag: r0.editTag });
    expect(r.body).toMatchObject({ ok: true, version: 1, change: ["catalogue published for the first time"] });
  });
});
