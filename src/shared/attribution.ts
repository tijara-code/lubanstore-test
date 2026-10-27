/**
 * SOURCE / MEDIUM — one standard for every link that brings a shopper (port of the original
 * netlify/lib/utm.js + origin.js). ONE module for the storefront (the landing it notes, the
 * 90-day last touch it keeps, what GA4 is told) and the server (a session's source, an
 * order's attribution and origin word). No DOM, no Node APIs: every input is a string.
 *
 * THE STANDARD (lower case, words joined with "_"):
 *
 *   utm_source    the platform:  facebook · instagram · snapchat · tiktok · google · whatsapp · …
 *   utm_medium    how:           paid_social  an ad on a social platform
 *                                cpc          a search ad
 *                                social       an unpaid post, bio, story
 *                                message      a WhatsApp/broadcast message
 *                                influencer · email
 *   utm_campaign  the campaign's name     utm_term     the ad set
 *   utm_content   the ad                  utm_id       the campaign id
 *
 * Links are never perfectly tagged ("Facebook", "IG", "Paid Social"), so every value is brought
 * to the standard here before it is stored or counted: one row per real source.
 *
 * A LANDING WITH NO TAGS is still placed, in the order the evidence is trusted: a tag; then a
 * platform's own click id (gclid → google/cpc, ScCid → snapchat/paid_social, ttclid →
 * tiktok/paid_social — only ever added to ad clicks; fbclid is added to EVERY link clicked
 * inside Facebook and Instagram, so alone it means facebook|instagram / social); then the
 * referrer; then (direct) / (none). The payment gateway (thawani.om) and the shop itself are
 * never a source.
 *
 * LAST NON-DIRECT CLICK, as GA4 counts it: a shopper who came from an ad and returns days later
 * by typing the address is still the ad's (90 days). The browser keeps that touch and sends it
 * beside the landing; it is used only when the landing itself is direct (`carried: true`).
 */
import type { Attribution } from "./orders/types";

/** What the page reports about the landing (stats.js `LMLanding()` + pixel.js's kept touch). */
export interface Landing {
  /** the six utm_ tags as written */
  utm?: { source?: unknown; medium?: unknown; campaign?: unknown; content?: unknown; term?: unknown; id?: unknown; [k: string]: unknown };
  /** an older page's utm_source alone */
  src?: unknown;
  /** the referrer's origin */
  ref?: unknown;
  /** click ids present (never their values) */
  fbclid?: unknown;
  sccid?: unknown;
  ttclid?: unknown;
  gclid?: unknown;
  [k: string]: unknown;
}

/** What the checkout posts as `order.ref`: the landing, and the kept last touch (with `at`, ms). */
export interface RefInput extends Landing {
  url?: unknown;
  referrer?: unknown;
  touch?: unknown;
}

export const SOURCE_ALIAS: Readonly<Record<string, string>> = {
  fb: "facebook", "facebook.com": "facebook", "m.facebook.com": "facebook",
  "l.facebook.com": "facebook", "lm.facebook.com": "facebook", "web.facebook.com": "facebook",
  ig: "instagram", insta: "instagram", "instagram.com": "instagram",
  "l.instagram.com": "instagram",
  an: "audience_network", msg: "messenger", "messenger.com": "messenger",
  snap: "snapchat", sc: "snapchat", "snapchat.com": "snapchat",
  tt: "tiktok", "tiktok.com": "tiktok",
  adwords: "google", googleads: "google", google_ads: "google",
  "google.com": "google", gads: "google",
  wa: "whatsapp", "wa.me": "whatsapp", "whatsapp.com": "whatsapp",
  twitter: "x", "t.co": "x", "x.com": "x", "twitter.com": "x",
  yt: "youtube", "youtube.com": "youtube", "m.youtube.com": "youtube",
};

/** a medium word → the standard; "paid" becomes cpc on a search engine, paid_social elsewhere */
export const MEDIUM_ALIAS: Readonly<Record<string, string>> = {
  paid_social: "paid", paidsocial: "paid", social_paid: "paid", paid: "paid",
  ads: "paid", ad: "paid", cpc: "paid", ppc: "paid", cpm: "paid",
  sponsored: "paid", paid_ads: "paid", paidads: "paid",
  social: "social", organic: "social", organic_social: "social",
  social_organic: "social", post: "social", bio: "social", story: "social",
  stories: "social", reel: "social", profile: "social", link_in_bio: "social",
  message: "message", broadcast: "message", chat: "message", dm: "message",
  whatsapp: "message",
  influencer: "influencer", creator: "influencer", affiliate: "influencer",
  email: "email", newsletter: "email", mail: "email",
};

export const SEARCH: readonly string[] = ["google", "bing", "yahoo", "duckduckgo", "yandex", "baidu", "ecosia"];
export const SOCIAL: readonly string[] = ["facebook", "instagram", "messenger", "audience_network", "snapchat",
  "tiktok", "x", "youtube", "linkedin", "pinterest", "threads", "reddit"];

/** the payment pages a card shopper comes back from: never a source */
const GATEWAY = /(^|\.)thawani\.om$/;
export const DIRECT = { source: "(direct)", medium: "(none)" } as const;
export const KEEP_DAYS = 90;
const DAY_MS = 86400e3;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** lower case, words joined with "_", nothing but letters (any script), digits, "." and "_" */
export function clean(v: unknown, n?: number): string {
  let s = String(v == null ? "" : v).trim().toLowerCase();
  try { s = s.normalize("NFKC"); } catch { /* keep as is */ }
  s = s.replace(/[\s\-+|/]+/g, "_").replace(/[^\p{L}\p{N}._]/gu, "").replace(/_+/g, "_").replace(/^[_.]+|[_.]+$/g, "");
  return s.slice(0, n || 80);
}

export function sourceOf(v: unknown): string {
  let s = clean(v, 60).replace(/^www\./, "");
  if (own(SOURCE_ALIAS, s)) s = SOURCE_ALIAS[s]!;
  return s;
}

export function mediumFor(v: unknown, source: string): string {
  const m = clean(v, 40);
  const k = own(MEDIUM_ALIAS, m) ? MEDIUM_ALIAS[m]! : null;
  if (k === "paid") return SEARCH.indexOf(source) !== -1 ? "cpc" : "paid_social";
  return k || m;
}

/** the host of an address, lower case, no www. ("" for junk) */
export function hostOf(url: unknown): string {
  try { return new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

/** the shop's own host, from its address (SITE_URL or the request's); the live domain otherwise */
export function ownHostOf(origin: unknown): string {
  return hostOf(origin) || "lubanmusk.com";
}

/** a referrer's host → { source, medium }, or null for the shop itself and the payment gateway */
export function fromHost(h: string, ownHost: string): { source: string; medium: string } | null {
  const me = String(ownHost || "").toLowerCase().replace(/^www\./, "");
  if (!h || GATEWAY.test(h) || (me && (h === me || h.endsWith("." + me)))) return null;
  const s = sourceOf(h);
  if (SOCIAL.indexOf(s) !== -1) return { source: s, medium: "social" };
  if (s === "whatsapp") return { source: s, medium: "message" };
  const eng = /(^|\.)(google|bing|yahoo|duckduckgo|yandex|baidu|ecosia)\./.exec(h);
  if (eng) return { source: eng[2]!, medium: "organic" };
  return { source: h.slice(0, 60), medium: "referral" };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** one landing (as the page notes it) → the standard */
export function place(landing: unknown, ownHost: string): Attribution {
  const l = asObj(landing);
  const u = asObj(l.utm);
  const rawSource = u.source || l.src || "";
  const tagged = !!(rawSource || u.medium || u.campaign);
  const h = hostOf(l.ref);
  const byHost = fromHost(h, ownHost);
  let source = "", medium = "", how: string;

  /* the platforms' own click ids — the source when no tag names it, the medium when no tag gives one */
  let click: { source: string; medium: string } | null = null;
  if (l.gclid) click = { source: "google", medium: "cpc" };
  else if (l.sccid) click = { source: "snapchat", medium: "paid_social" };
  else if (l.ttclid) click = { source: "tiktok", medium: "paid_social" };
  else if (l.fbclid) {
    click = {
      source: byHost && (byHost.source === "instagram" || byHost.source === "facebook") ? byHost.source : "facebook",
      medium: "social",
    };
  }

  if (tagged) {
    how = "utm";
    source = sourceOf(rawSource) || (click && click.source) || (byHost && byHost.source) || "(not set)";
    medium = u.medium ? mediumFor(u.medium, source) : click && click.source === source ? click.medium : "(not set)";
  } else if (click) {
    how = "click"; source = click.source; medium = click.medium;
  } else if (byHost) {
    how = "referrer"; source = byHost.source; medium = byHost.medium;
  } else {
    how = "direct"; source = DIRECT.source; medium = DIRECT.medium;
  }

  const out: Attribution = { source, medium, how };
  if (tagged) {
    const c = clean(u.campaign, 100), ct = clean(u.content, 100), t = clean(u.term, 100), id = clean(u.id, 40);
    if (c) out.campaign = c;
    if (ct) out.content = ct;
    if (t) out.term = t;
    if (id) out.cid = id;
  }
  return out;
}

/**
 * What an order (or a session) is credited to: the landing, or — when the landing is direct —
 * the last non-direct touch the browser kept (≤ 90 days old, not dated in the future).
 * The server passes `now` from deps.now(); the page passes its own clock.
 */
export function attribute(ref: RefInput | null | undefined | unknown, ownHost: string, now?: number): Attribution {
  const r = asObj(ref);
  const a = place(r, ownHost);
  if (a.how !== "direct") return a;
  const t = asObj(r.touch);
  const at = Number(t.at);
  const clock = Number.isFinite(Number(now)) && Number(now) > 0 ? Number(now) : Date.now();
  const age = clock - at;
  if (r.touch && at > 0 && age >= 0 && age <= KEEP_DAYS * DAY_MS) {
    const b = place(t, ownHost);
    if (b.how !== "direct") return { ...b, carried: true };
  }
  return a;
}

/* ------------------------------------------------------------------------------------------
   THE ORIGIN WORD (origin.js): one word per order, stored on the row, shown under its number.
   A named source in the address is the shop's own claim (a bio/story link); then the click ids
   (the strongest signal — put there by the platform's ad server); then the referrer.
   Returns meta | instagram | facebook | snapchat | tiktok | google | whatsapp | referral | direct.
   ------------------------------------------------------------------------------------------ */
export const ORIGIN_HOSTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)messenger\.com$/, "facebook"],
  [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)google\./, "google"],
  [/(^|\.)whatsapp\.com$|(^|\.)wa\.me$/, "whatsapp"],
];

function rawHost(url: unknown): string {
  try { return new URL(String(url || "")).hostname.toLowerCase(); } catch { return ""; }
}

export function originOf(ref: RefInput | null | undefined | unknown, ownHost: string): string {
  const r = asObj(ref);
  const src = String(r.src || asObj(r.utm).source || "").toLowerCase();
  if (/insta|^ig([_\-.]|$)/.test(src)) return "instagram";
  if (/^fb$|facebook/.test(src)) return "facebook";
  if (/snap/.test(src)) return "snapchat";
  if (/tiktok|^tt$/.test(src)) return "tiktok";
  if (/google|adwords/.test(src)) return "google";
  if (/whatsapp|^wa$/.test(src)) return "whatsapp";

  const h = rawHost(r.ref);
  if (r.fbclid) {
    if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
    if (/(^|\.)facebook\.com$/.test(h)) return "facebook";
    return "meta";
  }
  if (r.sccid) return "snapchat";
  if (r.ttclid) return "tiktok";
  if (r.gclid) return "google";

  const me = String(ownHost || "").toLowerCase();
  if (h && h !== me && h.replace(/^www\./, "") !== me.replace(/^www\./, "")) {
    for (const [re, name] of ORIGIN_HOSTS) if (re.test(h)) return name;
    return "referral";
  }
  return "direct";
}

/** The admin's words for an origin ("whatsapp_order" is one typed in by the shop; "unknown" shows as nothing). */
export const ORIGIN_WORD: Readonly<Record<string, string>> = {
  meta: "Meta ad", instagram: "Instagram", facebook: "Facebook", snapchat: "Snapchat",
  tiktok: "TikTok", google: "Google", whatsapp: "WhatsApp", whatsapp_order: "WhatsApp (typed in)",
  referral: "Other site", direct: "Direct", unknown: "",
};

export function originLabel(origin: unknown): string {
  const k = String(origin || "unknown");
  return own(ORIGIN_WORD, k) ? ORIGIN_WORD[k]! : k;
}

/* ------------------------------------------------------------------------------------------
   PLATFORMS (the Analytics filters, v408): a source (or, for an order with no attribution, its
   origin word) → meta | snapchat | tiktok | google | whatsapp | direct | other; "" = not known.
   ------------------------------------------------------------------------------------------ */
export const PLATFORMS = ["meta", "snapchat", "tiktok", "google", "whatsapp", "direct", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_WORD: Readonly<Record<Platform, string>> = {
  meta: "Meta", snapchat: "Snapchat", tiktok: "TikTok", google: "Google", whatsapp: "WhatsApp", direct: "Direct", other: "Other sites",
};
const PLATFORM_OF: Readonly<Record<string, Platform>> = {
  facebook: "meta", instagram: "meta", messenger: "meta", audience_network: "meta", meta: "meta",
  snapchat: "snapchat", tiktok: "tiktok", google: "google", whatsapp: "whatsapp", whatsapp_order: "whatsapp",
  "(direct)": "direct", direct: "direct",
};

export function platformOf(source: unknown): Platform | "" {
  const k = String(source || "").toLowerCase().trim();
  if (!k || k === "(not set)" || k === "unknown") return "";
  return own(PLATFORM_OF, k) ? PLATFORM_OF[k]! : "other";
}

/** an ad: paid_social or cpc */
export function paidOf(medium: unknown): boolean {
  return /^(paid_social|cpc)$/.test(String(medium || ""));
}

/* ------------------------------------------------------------------------------------------
   THE BROWSER'S SIDE, as pure functions of strings (the storefront port calls these).
   ------------------------------------------------------------------------------------------ */
export const UTM_KEYS = ["source", "medium", "campaign", "content", "term", "id"] as const;

/** The landing as stats.js notes it, from location.search and document.referrer. */
export function readLanding(search: string, referrer: string): Landing {
  const q = String(search || "");
  const has = (k: string) => new RegExp("[?&]" + k + "=").test(q);
  const get = (k: string) => {
    const m = new RegExp("[?&]" + k + "=([^&#]*)").exec(q);
    if (!m) return "";
    try { return decodeURIComponent(m[1]!.replace(/\+/g, " ")).slice(0, 100); } catch { return m[1]!.slice(0, 100); }
  };
  const utm: Record<string, string> = {};
  let any = false;
  for (const k of UTM_KEYS) {
    const v = get("utm_" + k);
    if (v) { utm[k] = v; any = true; }
  }
  let ref = "";
  try { ref = referrer ? new URL(referrer).origin : ""; } catch { /* none */ }
  const out: Landing = {
    src: utm.source ? utm.source.slice(0, 40) : "",
    ref: ref.slice(0, 120),
    fbclid: has("fbclid"), sccid: has("ScCid") || has("sccid"),
    ttclid: has("ttclid"), gclid: has("gclid"),
  };
  if (any) out.utm = utm;
  return out;
}

/** A landing that came from somewhere (a tag, a click id, another site — not this shop, not the card page). */
export function fromSomewhere(landing: unknown, ownHost: string): boolean {
  const l = asObj(landing);
  if (!landing) return false;
  if (l.utm || l.fbclid || l.sccid || l.ttclid || l.gclid) return true;
  const h = rawHost(l.ref);
  if (!h || GATEWAY.test(h)) return false;
  return h.replace(/^www\./, "") !== String(ownHost || "").toLowerCase().replace(/^www\./, "");
}

/** The kept touch to send with the order: only when this tab's landing is direct and the touch is ≤ 90 days old. */
export function lastTouch(landing: unknown, touch: unknown, ownHost: string, now: number): Record<string, unknown> | null {
  if (fromSomewhere(landing, ownHost)) return null;
  const t = asObj(touch);
  const at = Number(t.at);
  if (!touch || !(at > 0)) return null;
  const age = now - at;
  return age >= 0 && age <= KEEP_DAYS * DAY_MS ? t : null;
}

/** The address's tags in the standard, as gtag's config takes them (null when there are none). */
export function gaCampaign(search: string): Record<string, string> | null {
  const l: Record<string, string> = {};
  try {
    const q = new URLSearchParams(String(search || ""));
    for (const k of UTM_KEYS) { const v = q.get("utm_" + k); if (v) l[k] = v; }
  } catch { return null; }
  if (!l.source && !l.medium && !l.campaign) return null;
  const out: Record<string, string> = {};
  const src = l.source ? sourceOf(l.source) : "";
  if (src) out.campaign_source = src;
  if (l.medium) out.campaign_medium = mediumFor(l.medium, src);
  if (l.campaign) out.campaign_name = clean(l.campaign, 100);
  if (l.content) out.campaign_content = clean(l.content, 100);
  if (l.term) out.campaign_term = clean(l.term, 100);
  if (l.id) out.campaign_id = clean(l.id, 40);
  return out;
}

/** A referrer GA4 must not count as a source (the card page): the checkout stands in for it. */
export function isGatewayReferrer(referrer: string): boolean {
  return GATEWAY.test(rawHost(referrer));
}

/* ------------------------------------------------------------------------------------------
   AD LINKS (the Analytics tab): the line each platform takes in its ad's URL parameters — the
   platform fills the names in itself — and the builder for links that are not ads.
   ------------------------------------------------------------------------------------------ */
export interface AdLinkTemplate {
  platform: string;
  where: string;
  line: string;
}

export const AD_LINK_TEMPLATES: readonly AdLinkTemplate[] = [
  {
    platform: "Meta (Facebook & Instagram)",
    where: "Ad → Destination → URL parameters",
    line: "utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}",
  },
  {
    platform: "Snapchat",
    where: "Ad → Website URL, after the address with ?",
    line: "utm_source=snapchat&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adSet.name}}&utm_content={{ad.name}}&utm_id={{campaign.id}}",
  },
  {
    platform: "TikTok",
    where: "Ad → Destination → URL parameters",
    line: "utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_NAME__&utm_term=__AID_NAME__&utm_content=__CID_NAME__&utm_id=__CAMPAIGN_ID__",
  },
  {
    platform: "Google Ads",
    where: "Account settings → Tracking → Final URL suffix (keep auto-tagging on)",
    line: "utm_source=google&utm_medium=cpc&utm_id={campaignid}&utm_term={keyword}&utm_content={creative}",
  },
];

export const LINK_SOURCES = ["instagram", "facebook", "snapchat", "tiktok", "whatsapp", "google"] as const;
export const LINK_MEDIUMS = ["social", "message", "influencer", "email", "paid_social", "cpc"] as const;
export const LINK_PAGES = ["/", "/en/"] as const;

/** A campaign or content word as the builder writes it. */
export function utmWord(v: unknown): string {
  return clean(v, 80);
}

/** The builder: a link to the store, tagged in the standard; "" until the campaign is named. */
export function utmLink(o: { origin: string; page?: string; source: string; medium: string; campaign: string; content?: string }): string {
  const campaign = utmWord(o.campaign);
  if (!campaign) return "";
  const q: Array<[string, string]> = [
    ["utm_source", o.source], ["utm_medium", o.medium], ["utm_campaign", campaign], ["utm_content", utmWord(o.content)],
  ];
  const base = String(o.origin || "").replace(/\/+$/, "") + (o.page || "/");
  return base + "?" + q.filter((x) => x[1]).map((x) => x[0] + "=" + encodeURIComponent(x[1])).join("&");
}
