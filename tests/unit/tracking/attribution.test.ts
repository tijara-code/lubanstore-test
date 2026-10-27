import { describe, expect, it } from "vitest";
import {
  AD_LINK_TEMPLATES, attribute, clean, fromSomewhere, gaCampaign, isGatewayReferrer, lastTouch, mediumFor, originLabel, originOf,
  ownHostOf, paidOf, place, platformOf, readLanding, sourceOf, utmLink,
} from "../../../src/shared/attribution";

const own = "lubanmusk.com";
const sm = (a: { source: string; medium: string }) => a.source + " / " + a.medium;
const P = (l: unknown) => place(l, own);

// from test-v302.js: the standard
describe("the UTM standard (place)", () => {
  it("brings an ad's tags to the standard", () => {
    const l = { utm: { source: "ig", medium: "paid_social", campaign: "National Day 2026", content: "Reel A", term: "UAE 25-44" } };
    expect(sm(P(l))).toBe("instagram / paid_social");
    expect(P(l)).toEqual({ source: "instagram", medium: "paid_social", how: "utm", campaign: "national_day_2026", content: "reel_a", term: "uae_25_44" });
  });
  it("folds the messy words", () => {
    expect(sm(P({ utm: { source: "Facebook", medium: "Paid Social" } }))).toBe("facebook / paid_social");
    expect(sm(P({ utm: { source: "FB", medium: "cpc" } }))).toBe("facebook / paid_social");
    expect(sm(P({ utm: { source: "google", medium: "PPC" } }))).toBe("google / cpc");
    expect(sm(P({ utm: { source: "instagram", medium: "bio" } }))).toBe("instagram / social");
    expect(sm(P({ utm: { source: "WA", medium: "broadcast" } }))).toBe("whatsapp / message");
    expect(P({ utm: { source: "snapchat", medium: "paid_social", campaign: "اليوم الوطني" } }).campaign).toBe("اليوم_الوطني");
    expect(sm(P({ utm: { source: "snapchat" }, sccid: true }))).toBe("snapchat / paid_social");
    expect(sm(P({ utm: { source: "newsletter_july" } }))).toBe("newsletter_july / (not set)");
    expect(sm(P({ src: "IG" }))).toBe("instagram / (not set)");
  });
  it("places a landing with no tags by click id, then referrer, then direct", () => {
    expect(sm(P({ gclid: true }))).toBe("google / cpc");
    expect(sm(P({ sccid: true }))).toBe("snapchat / paid_social");
    expect(sm(P({ ttclid: true }))).toBe("tiktok / paid_social");
    expect(sm(P({ fbclid: true, ref: "https://l.instagram.com" }))).toBe("instagram / social");
    expect(sm(P({ fbclid: true }))).toBe("facebook / social");
    expect(sm(P({ ref: "https://www.google.com" }))).toBe("google / organic");
    expect(sm(P({ ref: "https://blog.example.org" }))).toBe("blog.example.org / referral");
    expect(sm(P({ ref: "https://checkout.thawani.om" }))).toBe("(direct) / (none)");
    expect(sm(P({ ref: "https://www.lubanmusk.com" }))).toBe("(direct) / (none)");
    expect(sm(P({}))).toBe("(direct) / (none)");
    expect(P({ gclid: true }).how).toBe("click");
    expect(P({ ref: "https://www.google.com" }).how).toBe("referrer");
    expect(P(null).how).toBe("direct");
  });
});

// from test-v302.js: the last source, 90 days
describe("the 90-day last non-direct touch (attribute)", () => {
  const now = Date.parse("2026-10-04T10:00:00Z");
  const ad = { at: now - 3 * 86400e3, utm: { source: "ig", medium: "paid_social", campaign: "launch" } };
  const A = (ref: unknown) => attribute(ref, own, now);
  it("credits a direct visit to the ad three days ago, and says so", () => {
    expect(sm(A({ touch: ad })) + " " + A({ touch: ad }).campaign).toBe("instagram / paid_social launch");
    expect(A({ touch: ad }).carried).toBe(true);
  });
  it("not after 90 days, not over a visit's own source, not from the future", () => {
    expect(sm(A({ touch: { ...ad, at: now - 91 * 86400e3 } }))).toBe("(direct) / (none)");
    expect(sm(A({ utm: { source: "snapchat", medium: "paid_social" }, touch: ad }))).toBe("snapchat / paid_social");
    expect(A({ utm: { source: "snapchat", medium: "paid_social" }, touch: ad }).carried).toBeUndefined();
    expect(sm(A({ touch: { ...ad, at: now + 86400e3 } }))).toBe("(direct) / (none)");
  });
  it("the shop's own host comes from its address", () => {
    expect(ownHostOf("https://www.lubanmusk.test")).toBe("lubanmusk.test");
    expect(ownHostOf("")).toBe("lubanmusk.com");
  });
});

// from test-admin-data.js: where an order came from
describe("the origin word (originOf)", () => {
  it("decides tag > click id > referrer > direct", () => {
    expect(originOf({ fbclid: true, ref: "https://l.instagram.com" }, own)).toBe("instagram");
    expect(originOf({ fbclid: true, ref: "https://m.facebook.com" }, own)).toBe("facebook");
    expect(originOf({ fbclid: true, ref: "" }, own)).toBe("meta");
    expect(originOf({ sccid: true }, own)).toBe("snapchat");
    expect(originOf({ ttclid: true }, own)).toBe("tiktok");
    expect(originOf({ src: "ig_bio" }, own)).toBe("instagram");
    expect(originOf({ sccid: true, ref: "https://www.instagram.com" }, own)).toBe("snapchat");
    expect(originOf({ src: "snap", fbclid: true }, own)).toBe("snapchat");
    expect(originOf({ ref: "https://www.tiktok.com" }, own)).toBe("tiktok");
    expect(originOf({ ref: "https://some-blog.example" }, own)).toBe("referral");
    expect(originOf({ ref: "https://lubanmusk.com" }, "lubanmusk.com")).toBe("direct");
    expect(originOf({}, own)).toBe("direct");
    expect(originOf("nope", own)).toBe("direct");
  });
  // from test-v211.js: the words under the order number
  it("has the admin's words", () => {
    expect(["meta", "instagram", "facebook", "snapchat", "tiktok", "google", "whatsapp", "whatsapp_order", "referral", "direct", "unknown"].map(originLabel))
      .toEqual(["Meta ad", "Instagram", "Facebook", "Snapchat", "TikTok", "Google", "WhatsApp", "WhatsApp (typed in)", "Other site", "Direct", ""]);
  });
});

// from test-v408.js: the platform filter words
describe("platforms and ads", () => {
  it("folds sources into the filter's platforms", () => {
    expect(["facebook", "instagram", "messenger", "meta", "snapchat", "tiktok", "google", "whatsapp", "whatsapp_order", "(direct)", "direct", "blog.example.org", "(not set)", "", "unknown"].map(platformOf))
      .toEqual(["meta", "meta", "meta", "meta", "snapchat", "tiktok", "google", "whatsapp", "whatsapp", "direct", "direct", "other", "", "", ""]);
    expect([paidOf("paid_social"), paidOf("cpc"), paidOf("social"), paidOf("(none)")]).toEqual([true, true, false, false]);
  });
});

// from test-v302.js: the page's copy of the standard (one module now: the page's functions ARE these)
describe("the browser's side", () => {
  it("brings the same words to the same standard", () => {
    const words = [["Facebook", "Paid Social"], ["IG", "bio"], ["google", "PPC"], ["Snap", "paid-social"], ["www.TikTok.com", "Story"],
      ["WA", "Broadcast"], ["newsletter", "e-mail"], [" Instagram ", "  organic_social "], ["يوم", "رسالة"]] as const;
    expect(words.map((w) => sourceOf(w[0]) + "/" + mediumFor(w[1], sourceOf(w[0]))))
      .toEqual(["facebook/paid_social", "instagram/social", "google/cpc", "snapchat/paid_social", "tiktok/social", "whatsapp/message", "newsletter/e_mail", "instagram/social", "يوم/رسالة"]);
    expect(["National Day 2026", "Reel—A", "  a  b  ", "اليوم الوطني"].map((c) => clean(c, 100))).toEqual(["national_day_2026", "reela", "a_b", "اليوم_الوطني"]);
  });
  it("notes the landing as stats.js did: six tags, click ids as present/absent, the referrer's origin", () => {
    const l = readLanding("?utm_source=IG&utm_medium=Paid%20Social&utm_campaign=National+Day&fbclid=IwAR123&ScCid=x", "https://l.instagram.com/path?x=1");
    expect(l).toEqual({ src: "IG", ref: "https://l.instagram.com", fbclid: true, sccid: true, ttclid: false, gclid: false,
      utm: { source: "IG", medium: "Paid Social", campaign: "National Day" } });
    expect(JSON.stringify(l)).not.toContain("IwAR123");
    expect(readLanding("", "")).toEqual({ src: "", ref: "", fbclid: false, sccid: false, ttclid: false, gclid: false });
  });
  it("keeps a touch only from somewhere, and sends it only with a direct landing within 90 days", () => {
    const now = Date.parse("2026-10-04T10:00:00Z");
    expect(fromSomewhere({ utm: { source: "ig" }, ref: "" }, own)).toBe(true);
    expect(fromSomewhere({ ref: "https://checkout.thawani.om" }, own)).toBe(false);
    expect(fromSomewhere({ ref: "https://www.lubanmusk.com" }, own)).toBe(false);
    expect(fromSomewhere({ ref: "" }, own)).toBe(false);
    const kept = { at: now - 86400e3, utm: { source: "ig" } };
    expect(lastTouch({ ref: "" }, kept, own, now)).toEqual(kept);
    expect(lastTouch({ ref: "https://checkout.thawani.om" }, kept, own, now)).toEqual(kept);
    expect(lastTouch({ gclid: true }, kept, own, now)).toBeNull();
    expect(lastTouch({ ref: "" }, { ...kept, at: now - 91 * 86400e3 }, own, now)).toBeNull();
  });
  it("tells GA4 the tags in the standard, and the card page is not a referrer", () => {
    expect(gaCampaign("?utm_source=IG&utm_medium=Paid%20Social&utm_campaign=National%20Day"))
      .toEqual({ campaign_source: "instagram", campaign_medium: "paid_social", campaign_name: "national_day" });
    expect(gaCampaign("?x=1")).toBeNull();
    expect(isGatewayReferrer("https://checkout.thawani.om/pay/x")).toBe(true);
    expect(isGatewayReferrer("https://www.google.com/")).toBe(false);
  });
});

// from test-v302.js: Ad links
describe("ad links", () => {
  it("carries each platform's line, already in the standard", () => {
    const lines = AD_LINK_TEMPLATES.map((t) => t.line);
    expect(lines[0]).toBe("utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}");
    expect(lines[1]).toContain("utm_source=snapchat&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adSet.name}}&utm_content={{ad.name}}");
    expect(lines[2]).toContain("utm_term=__AID_NAME__&utm_content=__CID_NAME__");
    expect(lines[3]).toContain("utm_source=google&utm_medium=cpc");
    for (const l of lines) {
      const m = /utm_source=([^&]+)&utm_medium=([^&]+)/.exec(l)!;
      expect(m[1]!.startsWith("{{") || sourceOf(m[1]) === m[1]).toBe(true);
      expect(mediumFor(m[2], m[1]!)).toBe(m[2]);
    }
  });
  it("builds a link that is not an ad", () => {
    expect(utmLink({ origin: "https://lubanmusk.com/", page: "/en/", source: "instagram", medium: "social", campaign: "Bio Link", content: "" }))
      .toBe("https://lubanmusk.com/en/?utm_source=instagram&utm_medium=social&utm_campaign=bio_link");
    expect(utmLink({ origin: "https://lubanmusk.com", source: "instagram", medium: "social", campaign: "  " })).toBe("");
  });
});
