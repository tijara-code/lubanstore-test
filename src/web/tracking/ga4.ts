/**
 * GOOGLE ANALYTICS 4 IN THE PAGE (pixel.js v302). Off until GA4_MEASUREMENT_ID is set on the
 * server: /api/settings then carries { analytics: { ga4, mp } } and this loads gtag.js —
 * through lmLater like the other libraries, once the store has drawn itself. Events asked for
 * before then wait in a short queue (40).
 *
 * The funnel goes from here (view_item, add_to_cart, begin_checkout, add_payment_info). The
 * PURCHASE goes from the server when `mp` is true, so it is counted once, even when the tab is
 * closed after paying; the page reports it only while the server cannot (v314: the server's
 * own answer says which).
 *
 * Two corrections for the Source / Medium report: a shopper back from the card page arrives
 * with thawani.om as the referrer — GA4 is told the checkout instead; and the address's utm_
 * tags are passed on brought to the shop's standard (shared/attribution gaCampaign), so one
 * source is one row.
 */
import { gaCampaign, isGatewayReferrer } from "../../shared/attribution";
import { GA_ID_RE, gaIdsFromCookies } from "../../shared/pixels/identity";
import { cookie } from "./ids";

const GA: { on: boolean; q: Array<[string, unknown]> | null } = { on: false, q: [] };

export interface GaCfg {
  ga4: string;
  mp?: boolean;
}

export function gaCfg(): GaCfg | null {
  const LM = window.LM;
  const a = LM && LM.cfg && (LM.cfg.analytics as GaCfg | undefined);
  return a && GA_ID_RE.test(a.ga4 || "") ? a : null;
}

/** the server reports the purchase */
export function gaServerBuys(): boolean {
  const a = gaCfg();
  return !!(a && a.mp);
}

/* gtag's own shim: dataLayer takes the arguments object itself */
function gtagShim(): void {
  (window.dataLayer = window.dataLayer || []).push(arguments);
}

function gaConfig(): Record<string, unknown> {
  const c: Record<string, unknown> = { send_page_view: true };
  try {
    if (document.referrer && isGatewayReferrer(document.referrer)) c.page_referrer = location.origin + "/checkout.html";
  } catch { /* nothing */ }
  const u = gaCampaign(location.search);
  if (u) for (const k in u) c[k] = u[k];
  if (/[?&]ga_debug=1(&|$)/.test(location.search)) c.debug_mode = true;
  return c;
}

/** an event; the purchase only while the server cannot send it */
export function ga(name: string, params: unknown): void {
  try {
    if (name === "purchase" && gaServerBuys()) return;
    gaRaw(name, params);
  } catch { /* nothing */ }
}

/** the event, whatever the config says about purchases (v314) */
export function gaRaw(name: string, params: unknown): void {
  try {
    if (GA.on) { window.gtag!("event", name, params); return; }
    if (GA.q && GA.q.length < 40) GA.q.push([name, params]);
  } catch { /* nothing */ }
}

export function gaStart(): void {
  try {
    if (GA.on || !GA.q || window.__lmLeaving) return;
    const a = gaCfg();
    if (!a) { GA.q = null; return; }      /* off: nothing loads, nothing waits */
    GA.on = true;
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") window.gtag = gtagShim;
    const LM = window.LM;
    window.gtag("js", new Date());
    window.gtag("set", "user_properties", {
      market: (LM.c && LM.c.code) || undefined,
      site_language: LM.lang === "en" ? "en" : "ar",
    });
    window.gtag("config", a.ga4, gaConfig());
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(a.ga4);
    (document.head || document.documentElement).appendChild(s);
    const q = GA.q;
    GA.q = null;
    for (const [n, p] of q) ga(n, p);
  } catch { /* nothing */ }
}

/** GA4's client and session ids, read from its cookies, for the server's copy of the purchase */
export function gaIds(): { gcid?: string; gsid?: string } {
  const a = gaCfg();
  return gaIdsFromCookies(cookie("_ga"), a ? cookie("_ga_" + a.ga4.slice(2)) : null);
}
