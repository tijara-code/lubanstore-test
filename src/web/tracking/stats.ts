/**
 * LUBAN & MUSK — first-party analytics (port of assets/js/stats.js). Loaded on every
 * storefront page (home, checkout, privacy, 404 — the last two without the core).
 *
 * Counts what people do on the site, so the shop owner can see a funnel without asking Snap
 * or Meta for it. Separate from pixel.ts on purpose: that one feeds ad platforms and is
 * blocked for a good share of visitors. This request is first-party and same-origin, so it
 * survives the blockers — which is precisely why it must collect less, not more.
 *
 * What leaves the browser: an event name, sometimes an item id, and a random token that lives
 * in sessionStorage and dies with the tab. No cookie, no persistent id, no personal data. The
 * server adds a country (and the edge's city, rounded) and stores nothing else.
 *
 * Publishes window.LMBeacon (the shared queue), window.LMLanding and window.LMEV, as the
 * original did. Nothing here may throw into the page.
 */
import { readLanding, type Landing } from "../../shared/attribution";
import { installBeacon } from "./beacon";
import { listen, reporter } from "./errors";
import type { Lmev } from "./types";

const KEY = "lm_sid";
const K_LAND = "lm_land";

/* Per-tab, not per-person. sessionStorage is cleared when the tab closes, so this cannot
   recognise a returning visitor — it only separates one person clicking five times from five
   people clicking once, which is all a funnel needs. */
export function sid(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) return v;
    let n = "";
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint8Array(9);
      crypto.getRandomValues(a);
      for (let i = 0; i < a.length; i++) n += (a[i]! % 36).toString(36);
    } else {
      n = Math.random().toString(36).slice(2, 11);
    }
    sessionStorage.setItem(KEY, n);
    return n;
  } catch {
    return null;   /* private mode: count it anonymously */
  }
}

/* ---------- what brought them here ----------
   Noted ONCE, on the first page of the session, and kept for the tab's life: by the time the
   shopper is on the checkout the address has been rewritten and the referrer is our own page,
   so the landing is the only moment the truth is readable. All six utm_ tags as written, the
   ad platforms' click ids (present or not, never the value), the referrer's origin. The
   90-day last source is pixel.ts's; this module keeps nothing past the tab. */
let freshSession = false;
function noteLanding(): void {
  try {
    if (sessionStorage.getItem(K_LAND)) return;
    sessionStorage.setItem(K_LAND, JSON.stringify(readLanding(location.search || "", document.referrer)));
    freshSession = true;
  } catch { /* nothing */ }
}

export function landing(): Landing {
  try { return (JSON.parse(sessionStorage.getItem(K_LAND) as string) as Landing) || {}; } catch { return {}; }
}

/* ---------- automatic events ---------- */
function page(): string {
  /* v447: the host serves 404.html AT the missing address, so the page says what it is
     rather than the path (every 404 was counted as home) */
  if (document.body && document.body.getAttribute("data-page") === "404") return "404";
  const p = location.pathname;
  if (/checkout/.test(p)) return "checkout";
  if (/privacy/.test(p)) return "privacy";
  if (/404/.test(p)) return "404";
  return "home";
}

function start(): Lmev {
  const B = installBeacon();
  freshSession = false;
  noteLanding();
  window.LMLanding = landing;

  listen(reporter((body) => B.queue("log", body), sid));

  function send(name: string, item?: string | null, land?: Landing): void {
    const b: Record<string, unknown> = { name, item: item || undefined, sid: sid() || undefined };
    if (land) b.land = land;     /* session_start only: placed by the server */
    B.queue("ev", b);
  }

  /* Respect the browser's own opt-out: the difference between measuring people and
     measuring people who asked not to be measured. */
  let optedOut = false;
  try {
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    optedOut = nav.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1" ||
      nav.globalPrivacyControl === true;
  } catch { /* nothing */ }

  const LMEV: Lmev = { track: optedOut ? () => {} : send };

  function boot(): void {
    LMEV.track("page_view", page());
    /* v302: once per session, how it arrived — placed by the server in the orders' standard */
    if (freshSession) LMEV.track("session_start", "", landing());
    if (page() === "checkout") LMEV.track("checkout_view");

    /* One delegated listener rather than a hook in every module: the markup is rebuilt
       constantly (sizes, cart rows, payment options), and a listener bound to an element that
       gets replaced stops firing without anyone noticing. */
    document.addEventListener("click", (e) => {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      try {
        const wa = t.closest('a[href*="wa.me"]');
        if (wa) { LMEV.track("whatsapp_click", wa.className || "link"); return; }

        const size = t.closest(".size");
        if (size) {
          const nm = size.querySelector(".sz-name");
          LMEV.track("size_open", nm ? (nm.textContent || "").trim().slice(0, 40) : "size");
          return;
        }

        if (t.closest(".cart")) { LMEV.track("cart_open"); return; }

        const payBtn = t.closest("[data-pay]");
        if (payBtn) { LMEV.track("pay_method", payBtn.getAttribute("data-pay")); return; }
      } catch { /* a counter must not break a click */ }
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.LMEV = LMEV;
  return LMEV;
}

export const LMEV: Lmev = start();
