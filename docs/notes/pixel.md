# pixel — notes (the storefront's tracking: ports of pixel.js and stats.js)

The browser half of the tracking: the first-party analytics and the shared beacon (stats.js) and
the ad platforms' events (pixel.js: Snap, Meta, GA4). The server half (`/api/beacon`, `/api/ev`,
`/api/meta`, `/api/snap`, `/api/log`, the CAPI/MP copies) is the tracking worker's
(`docs/notes/tracking.md`); the request bodies here are the original's, so they meet.

## Files

| Path | What |
|---|---|
| `src/web/tracking/stats.ts` | stats.js: per-tab `lm_sid`, the landing (`lm_land`, once per tab), `session_start` once, `page_view` (home / checkout / privacy / 404 — `data-page="404"` wins), `checkout_view`, the delegated clicks (wa.me, `.size`, `.cart`, `[data-pay]`), DNT / GPC, error reporting; publishes `window.LMBeacon`, `window.LMLanding`, `window.LMEV` |
| `src/web/tracking/beacon.ts` | the queue (`LMBeacon`: queue, flush, hold, release, patch): one POST to `/api/beacon` (sendBeacon blob, else fetch keepalive / credentials omit), 80 ms timer, 12 items, pagehide / hidden, nothing from a page with `__lmLeaving`, the held batch (8 s cap) |
| `src/web/tracking/errors.ts` | uncaught errors / unhandled rejections → `log` items: masked (`[email]`, `[n]`, v401 Safari frames kept), ≤ 5 a page, never the same message twice, NOT_OURS + the injected-stack filter; keys exactly `kind, message, detail, place, sid` |
| `src/web/tracking/pixel.ts` | pixel.js: `LMPX` (viewContent, addCart, startCheckout, addPaymentInfo once per method, purchase, landing, signals, notePhone), the Snap/Meta pixel + relay pairs under one id, the first-visit hold for `_fbp` (4 s poll, `lm_fb_off`), Snap's `_scid` patched into the held batch, the page-view relays (`__lmPageView` / `__lmFbPageView`), `lm_snap_ph` removed, `lm_touch` (90 days), GA4 start via lmLater after `LM.ready` |
| `src/web/tracking/ga4.ts` | GA4: gtag only with a valid id, the 40-event queue, `page_referrer` = checkout when back from thawani.om, campaign fields (`gaCampaign`), `ga_debug`, the purchase rule (server answer `ga4: "server" \| "page"`, else `mp`), `gaIds` |
| `src/web/tracking/ids.ts` | readers: cookies (decoded), `lm_ph_v2` / `lm_ph_typed`, `lm_vid`, the market, `lm_sccid`, `_scid`, `_fbp`, the fbclid stash and `fbc` |
| `src/web/tracking/types.ts` | `Beacon`, `Lmev`, `Lmpx`, `PurchaseOrder`, `Signals`, the platforms' function types |
| `src/web/entries/{home,checkout}.ts` | my two lines: `import "../tracking/stats"; import "../tracking/pixel";` right after the core (store.js → stats.js → pixel.js → header … as the originals) |
| `src/web/entries/{privacy,notfound}.ts` | `import "../tracking/stats";` only — the original privacy.html and 404.html loaded stats.js alone (no store.js, no pixel.js) |
| `tests/web/tracking/*` | happy-dom suites (below) + `_page.ts`, a loader that runs a page's tracking fresh (core or not, stats, pixel) with the platforms, cookie jar, referrer, lmLater and sendBeacon stood in |
| `tests/parity/pixel.browser.parity.test.ts` | the browser parity (below) |

Shared modules used (no copies): `shared/attribution` (`readLanding`, `fromSomewhere`, `lastTouch`,
`gaCampaign`, `isGatewayReferrer` — instead of pixel.js's GA_SOURCE / GA_MEDIUM / GA_SEARCH tables
and stats.js's readLanding), `shared/pixels/identity` (`hashPhone`, `matchHashes`, `isHash`,
`fbcFromStash`, `gaIdsFromCookies`, `GA_ID_RE`, WebCrypto `sha256`), `shared/pixels/catalogue`
(`CURRENCY`, `CATEGORY`, `BRAND`). Browser hashes and server hashes are therefore the same
functions (checked against the server's `metaEvent` / `snapEvent` in the tests).

## Core change (smallest, listed as the brief asks)

`src/web/core/globals.d.ts`: `window.LMBeacon` / `window.LMPX` typed with the real shapes
(`tracking/types`), and `LMEV`, `LMLanding`, `snaptr`, `fbq`, `gtag`, `dataLayer` declared. Types
only; the core's own calls (`orders.ts`) still compile.

## Decisions and deliberate differences

1. **Modules read `window.LM` at call time** (pixel.js read the global `LM`), so pixel.ts does not
   import the core and a stubbed `LM` works as in the original suites; stats.ts and pixel.ts import
   only types from the core (privacy and 404 run without it — checked in `wiring.test.ts`).
2. **ES5-era code dropped**: the `Object.assign` shim, the `\p{}`-less regex fallbacks, the
   "no `crypto.subtle`" path being a separate copy (the shared `sha256` answers null the same way).
   The bundle targets ES2019 / Safari 13 (core note 7); no-module browsers get no page scripts.
3. **Hashing via the shared functions.** pixel.js lower-cased and trimmed every string before
   hashing; every value it hashed was already normalised (digits, lower-case names / cities /
   e-mails), so the hashes are identical (tests compare with the server's builders).
4. **The page-view relays' market (`cc`)**: unchanged code, but a timing fact worth knowing — the
   original's `market()` read `LM.c` when pixel.js ran; as a separate deferred script it ran
   sometimes after the preloaded `/api/settings` had answered (cc present) and sometimes before
   (cc absent → the server takes the edge's country). Measured on the reference: `- - - OM OM OM - OM`
   over 8 loads. The bundle evaluates in one go, so the new page's PageView/PAGE_VIEW relays carry
   only the address's (`?country=`) or kept (`lm_cty_v2`) market — the original's "lost the race"
   outcome, every time. Every later event carries `LM.c` as before. The parity test compares those
   two relays without `cc` (commented there).
5. **Tests reset module state per "page"** (`vi.resetModules`); the production modules keep their
   state per page load, exactly as the IIFEs did.

## Dropped

Nothing in scope. (The `?v=` / source-regex checks of the original suites became behavioural checks.)

## Original suites → new tests

| Original (browser parts) | New |
|---|---|
| test-beacon (the queue, driven; stats before pixel; Snap/Meta through it; fallback to the endpoint) | `stats.test.ts` "the beacon", `pixel.test.ts` "without the shared queue…", `wiring.test.ts` "the entries" |
| test-stats (sid per tab / sessionStorage only / no cookie; DNT + GPC; every allowlisted name has a caller, none unknown; tracker on every page) | `stats.test.ts`, `wiring.test.ts` (the caller check scans all of `src/web`; a name owned by another port is required once that port fires events) |
| test-pixel-parity (lm_snap_ph dropped; 5 phones: pixel == Snap CAPI == Meta CAPI; lm_ph_v2; no raw PII to Snap; lm_am_v1 == Meta CAPI; Snap relay items == Meta's, one id; ADD_BILLING once per method; inline snippets on 4 pages; 264-char fbclid whole) | `pixel.test.ts` "the phone hash", "the relays", "the payment step"; `head.test.ts` "the Snap and Meta snippets" |
| test-meta (eventID capital ID; Purchase eventID = order id; fbclid stash first sighting / replace / last pipe / cookie wins / decoded; one pixel id) | `pixel.test.ts` "Meta's Purchase", "the Meta click id"; `head.test.ts` |
| test-snap-dedup | `pixel.test.ts` "Snap dedup" (with the server's `snapEvent`) |
| test-v302 (GA4 in the page: no id → nothing; gtag.js src; page_referrer; campaign fields; add_to_cart in OMR; server/page purchase; GS1/GS2 ids; lm_touch 90 days, direct visit carries it, card page not a source; session_start once with the landing; nothing past the tab in stats) | `pixel.test.ts` "GA4", "the 90-day last touch"; `stats.test.ts` "the session and the landing" |
| test-v314 (the server's ga4 answer wins; Snap's cookie patched into the held batch) | `pixel.test.ts` "the server's answer wins…", "the first-visit hold" |
| test-v315 (relays carry vid + cc; signals carry vid; notePhone → lm_ph_typed; head id generator 64 hex, kept, a phone wins) | `pixel.test.ts` "the relays", "signals", "notePhone…"; `head.test.ts` |
| test-v321 (advanced matching: init `{ph, external_id, fn, ct, country}`, bad `em` omitted) | `head.test.ts` |
| test-v209 (leaving page counts nothing; first-visit Meta wait: one request, the cookie, blocked → lm_fb_off, leave mid-wait, returning visitor, no lmLater; 4 s / 8 s bounds) | `stats.test.ts` "a page leaving for /en/", `pixel.test.ts` "the first-visit hold", `wiring.test.ts` "the held batch's cap", `head.test.ts` "the leaving mark" |
| test-v204 (lmLater: after LM.ready + idle, first tap, 3.5 s cap; loaders through lmLater) | `head.test.ts` "the early script's lmLater" |
| test-v401 (mask keeps Safari frames; e-mail / phone masked) | `errors.test.ts` |
| test-v447 (a 404 counted as 404) | `stats.test.ts` "what page this is" |
| inventory §2: `_fbp` wait, deferred pixels, leaving for /en/, beacon batching + Snap patch | the parity journeys "first-visit-hold", "lang-redirect", every journey's beacon records |

88 checks in `tests/web/tracking` (all pass).

Not ported here (others' code): where checkout.js/header.js/main.js call LMPX/LMEV (once on the
cash done page, on card return incl. `already`, not on reload; extras reported qty 1; notePhone
from the checkout) — the checkout/product/header ports; the parity journeys exercise them end to end.

## Browser parity (tests/parity/pixel.browser.parity.test.ts)

Both sites in Chromium (ref 4103 via `checkout-ref-server.cjs`, new 8893 built into `dist-pixel`,
in-process, fake mode; both with `GA4_MEASUREMENT_ID=G-ABC123XYZ9` and a GA4 secret), frozen
Date, seeded Math.random / randomUUID / getRandomValues, `snaptr` / `fbq` / `gtag` stubbed before
load (libraries blocked), edge country OM. After every step: every `/api/beacon` item, `/api/ev|
snap|meta|log`, the order POST's `snap` + `ref`, every pixel/gtag call and the tracking storage keys,
normalised (origin, per-run ids by position) and compared; plus body DOM and viewport pixels
(recorded; asserted only on privacy / 404).

Journeys: the shop journey (land with utm + fbclid + ScCid → open a size → choose a scent → add →
open the basket → checkout → fill the form → COD → the same method again → place the COD order →
reload the done page → a later typed-in visit) in **ar@390, en@1366, ar@1366, en@390**; privacy,
404, English privacy, an injected script's errors; other markets (AE, SA in English with gclid, KW
checkout back from the card page) with a returning shopper's kept hashes and an error thrown in our
own code; a first visit with a stand-in Meta library that sets `_fbp` after 300 ms; a remembered
English shopper redirected from `/` and `/checkout.html` to `/en/`.

**Result: every step's tracking records equal on both sites (61 steps, 8/8 tests).** Findings:
- the `cc` race on the page-view relays (decision 4);
- the redirect to /en/: on both sites the leaving Arabic page sends nothing and the English page
  sends one `session_start` (its landing's referrer is the shop's own Arabic address);
- DOM / pixel differences reported on the product page (Arabic: DOM differs, 0 % pixels) and the
  checkout (0.08–0.21 % pixels after the form / method steps) are in those ports' markup, not
  drawn by tracking; privacy, 404 and English privacy: DOM equal, 0.000 %.

## compare-screens

`node --import tsx scripts/compare-screens.ts --ref http://localhost:4103 --new http://localhost:8893 --js`
(7 pages × 320/390/768/1366, JavaScript on). Tracking draws nothing; privacy, 404 and English privacy
(the pages whose only script is stats) were 0.000 % before and are 0.000 % after, at every width.
The other pages with every port in: `/`, `/checkout.html`, `/en/checkout.html` 0.000 % at all
widths; `/en/` 0.000 % (320, 768), 0.009 % (390), 1.153 % (1366) — the product page's drawing
(product port), not tracking.

## Open issues

- `tests/web/core/i18n.test.ts` "the checkout installs … LM_CITIES" fails in happy-dom because
  `src/web/checkout/index.ts` writes `$("#year").textContent` on an empty document (checkout port).
- Beacon limit 120 vs the original's 60 a minute (tracking note 16, server side).
- Dev pixels (core note 11): the built pages carry the real public pixel ids; harmless in dev since
  the libraries only load if reachable, but a dev switch could be added in site-meta if wanted.
