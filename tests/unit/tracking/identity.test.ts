import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLICK_MAX, clickId, fbcFromStash, gaCid, gaIdsFromCookies, gaSid, hashed, hashedUser, hashPhone, isHash, matchHashes,
  normCity, normCountry, normEmail, normName, normPhone, normZip, phoneId, sha256, splitName,
} from "../../../src/shared/pixels/identity";
import { metaEvent, snapEvent } from "../../../src/server/domain/pixels/build";

const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

// from test-meta.js: 1. normalisation, field by field
describe("the normalisers (Meta's rules, Snap's too)", () => {
  it("email", () => {
    expect(normEmail("  Sample@Example.COM ")).toBe("sample@example.com");
    expect(normEmail("a.b+tag@x.com")).toBe("a.b+tag@x.com");
    expect(normEmail("not an email")).toBeNull();
  });
  it("phone", () => {
    expect(normPhone("+968 9123 4567")).toBe("96891234567");
    expect(normPhone("0096891234567")).toBe("96891234567");
    expect(new Set(["+968 9123 4567", "968-9123-4567", "00968 91234567"].map(normPhone)).size).toBe(1);
    expect(normPhone("123")).toBeNull();
  });
  it("name, city, country, zip", () => {
    expect(normName("O'Brien-Smith")).toBe("obriensmith");
    expect(normName(" محمد ")).toBe("محمد");
    expect(normCity("Abu Dhabi")).toBe("abudhabi");
    expect(normCountry("AE")).toBe("ae");
    expect(normCountry("United Arab Emirates")).toBeNull();
    expect(normZip("SW1A 1AA")).toBe("sw1a1aa");
  });
  // from test-pixel-parity.js / test-v300.js: first and last name as the Purchase splits them
  it("splits a name: first word, then the rest", () => {
    expect(splitName("  Ahmed  Al-Balushi ")).toEqual({ firstName: "Ahmed", lastName: "Al-Balushi" });
    expect(splitName("Salim Al Balushi")).toEqual({ firstName: "Salim", lastName: "Al Balushi" });
    expect(splitName("Sara")).toEqual({ firstName: "Sara", lastName: "" });
  });
});

// from test-meta.js: 2. hashing, and the double-hash trap
describe("hashing (WebCrypto, the same in the page and on the server)", () => {
  it("is SHA-256 hex of the exact string", async () => {
    expect(await sha256("96891234567")).toBe(sha("96891234567"));
    expect(await sha256("")).toBeNull();
  });
  it("a hash is never hashed again", async () => {
    const already = sha("96891234567");
    expect(await hashed("+96891234567", normPhone)).toBe(already);
    expect(await hashed(already, normPhone)).toBe(already);
    expect(await hashed(already, normPhone)).toBe(await hashed("+968 9123 4567", normPhone));
  });
  // from test-pixel-parity.js: 1. the phone hash is the same everywhere
  it("the page's phone hash is the servers' for every way of writing it", async () => {
    for (const ph of ["+968 9123 4567", "00968 91234567", "+971 501234567", "96891234567", "0 971-50-123-4567"]) {
      const page = await hashPhone(ph);
      const meta = ((await metaEvent({ name: "Purchase", id: "x", time: 0, user: { phone: ph } })).user_data as any).ph[0];
      const snap = ((await snapEvent({ name: "PURCHASE", id: "x", time: 0, user: { phone: ph } })).user_data as any).ph[0];
      expect(isHash(page) && page === meta && meta === snap).toBe(true);
      expect(await phoneId(ph)).toBe(page);
    }
    expect(await hashPhone("+971 501234567")).toBe(sha("971501234567"));
  });
  // from test-pixel-parity.js (v321): the kept browser hashes == Meta CAPI's
  it("the browser's kept match hashes are the server's", async () => {
    const kept = await matchHashes({ name: "  Ahmed  Al-Balushi ", email: " Test@Example.com ", city: "Abu Dhabi" });
    const srv = (await metaEvent({ name: "Purchase", id: "x", time: 0, user: { email: "Test@Example.com", firstName: "Ahmed", lastName: "Al-Balushi", city: "Abu Dhabi" } })).user_data as any;
    for (const k of ["em", "fn", "ln", "ct"]) expect(kept[k]).toBe(srv[k][0]);
    expect(Object.values(kept).every(isHash)).toBe(true);
  });
  it("external_id: one id or several, each hashed once, no repeats", async () => {
    const vid = "a".repeat(64);
    const u = await hashedUser({ externalId: [vid, "LM-1", vid, ""] });
    expect(u.external_id).toEqual([vid, sha("LM-1")]);
    expect(await hashedUser({})).toEqual({});
  });
});

// from test-meta.js: the click id, unmodified
describe("the click id", () => {
  const long = "IwAR" + "aB3xY7zQ".repeat(30);
  const realFbc = "fb.1.1554763741205." + long;
  it("is taken whole or not at all", () => {
    expect(clickId(realFbc)).toBe(realFbc);
    expect(clickId(realFbc).length > 200).toBe(true);
    expect(clickId("fb.1.1.AbCdEf")).toBe("fb.1.1.AbCdEf");
    expect(clickId("  fb.1.1.abc \n")).toBe("fb.1.1.abc");
    expect(clickId(null) + clickId(undefined) + clickId("")).toBe("");
    expect(clickId("fb.1.1." + "x".repeat(CLICK_MAX))).toBe("");
    expect(CLICK_MAX >= 1024).toBe(true);
  });
  it("is rebuilt in the documented shape from the stash, split at the LAST pipe", () => {
    expect(fbcFromStash("IwAR1|1790534142169", 5)).toBe("fb.1.1790534142169.IwAR1");
    expect(fbcFromStash("Iw|AR|1790534142169", 5)).toBe("fb.1.1790534142169.Iw|AR");
    expect(fbcFromStash("IwAR1", 42)).toBe("fb.1.42.IwAR1");
    expect(fbcFromStash(null, 1)).toBeNull();
  });
});

// from test-v302.js: GA4's ids from the cookies, and their shapes
describe("GA4 ids", () => {
  it("reads _ga and the stream cookie (GS1 and GS2)", () => {
    expect(gaIdsFromCookies("GA1.1.1234567890.1759500000", "GS2.1.s1759560000$o3$g1$t1759560100$j0$l0$h0")).toEqual({ gcid: "1234567890.1759500000", gsid: "1759560000" });
    expect(gaIdsFromCookies("GA1.1.1234567890.1759500000", "GS1.1.1759560000.3.1.1759560100.0.0.0").gsid).toBe("1759560000");
  });
  it("drops anything not in their shape", () => {
    expect(gaCid("<x>")).toBe("");
    expect(gaSid("1;2")).toBe("");
    expect(gaCid("1234567890.1759500000")).toBe("1234567890.1759500000");
  });
});
