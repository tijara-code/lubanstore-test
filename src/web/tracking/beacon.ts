/**
 * THE BEACON: ONE REQUEST FOR EVERYTHING (port of stats.js's queue, `window.LMBeacon`).
 *
 * Every page view used to leave as three to five separate requests — the counter, Snap's
 * twin, Meta's twin, and on the home page a VIEW_CONTENT for each ad platform — each a
 * function invocation the till shares its credit with. Anything that wants to send queues
 * here and one POST goes to /api/beacon a moment later, fanned out server-side. The queue
 * flushes on a short timer (80 ms), at a dozen items, and on pagehide / the tab going hidden
 * — the click that leaves for WhatsApp or the checkout must not lose what it queued.
 *
 * A HELD FIRST BATCH (v209). On a visit with no Meta cookie yet, pixel.ts holds its Meta
 * relays until the pixel library has set one, and holds this batch with them — so the page's
 * measurement still leaves as ONE request, just later. Nothing goes on the timer while held;
 * the batch goes when the holder lets go, at a dozen items, as the page is left (the holder's
 * own items put in first), or after 8 seconds whatever happens.
 *
 * Nothing here may throw into the page.
 */
import type { Beacon } from "./types";

export const BEACON_URL = "/api/beacon";
export const FLUSH_AFTER = 80;
export const MAX = 12;
export const HOLD_CAP = 8000;

interface Item {
  kind: string;
  body: unknown;
}

let Q: Item[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let holder: (() => void) | null = null;
let holdCap: ReturnType<typeof setTimeout> | undefined;

function post(items: Item[]): void {
  const body = JSON.stringify({ items });
  /* sendBeacon survives the page navigating away; fetch + keepalive where it is missing */
  if (navigator.sendBeacon && navigator.sendBeacon(BEACON_URL, new Blob([body], { type: "application/json" }))) return;
  if (typeof window.fetch === "function") {
    fetch(BEACON_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body, keepalive: true, credentials: "omit",
    }).catch(() => {});
  }
}

function hold(fn: (() => void) | null): void {
  holder = typeof fn === "function" ? fn : null;
  if (timer) { clearTimeout(timer); timer = null; }
  clearTimeout(holdCap);
  if (holder) holdCap = setTimeout(flush, HOLD_CAP);
}

function release(): void {
  holder = null;
  clearTimeout(holdCap);
  if (Q.length && !timer) timer = setTimeout(flush, FLUSH_AFTER);
}

function flush(): void {
  if (holder) { const f = holder; holder = null; clearTimeout(holdCap); try { f(); } catch { /* the holder's problem */ } }
  if (timer) { clearTimeout(timer); timer = null; }
  if (!Q.length) return;
  const items = Q.splice(0, Q.length);
  try { post(items); } catch { /* never break the page for a counter */ }
}

function queue(kind: string, body: unknown): void {
  try {
    /* a page already moving to /en/ (the lang-remember script) counts nothing: the English
       page counts its own view, and this one's pagehide flush used to send a second (v209) */
    if (window.__lmLeaving) return;
    Q.push({ kind, body });
    if (Q.length >= MAX) { flush(); return; }
    if (!timer && !holder) timer = setTimeout(flush, FLUSH_AFTER);
  } catch { /* nothing */ }
}

/* fill in what a queued item lacked when it was queued (v314: Snap's cookie, set by its
   library after the first relays were built) */
function patch(kind: string, fn: (body: Record<string, unknown>) => void): void {
  try {
    Q.forEach((it) => { if (it.kind === kind && it.body) fn(it.body as Record<string, unknown>); });
  } catch { /* nothing */ }
}

export const LMBeacon: Beacon = { queue, flush, hold, release, patch };

/** wire the page-leaving flushes and publish window.LMBeacon (stats.ts calls this first) */
export function installBeacon(): Beacon {
  Q = [];
  timer = null;
  holder = null;
  try {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  } catch { /* nothing */ }
  window.LMBeacon = LMBeacon;
  return LMBeacon;
}
