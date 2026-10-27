# Tracking area — notes

Ad-platform tracking (Meta pixel + CAPI, Snap pixel + CAPI, GA4 gtag + Measurement Protocol),
UTM attribution, first-party analytics (collector, Analytics tab, Overview KPIs) and the shared
KPI definitions.

## What I built (files)

Shared (browser + server, no DOM, no Node APIs):
- `src/shared/attribution.ts` — the UTM standard (`clean`, `sourceOf`, `mediumFor`, `fromHost`,
  `place`, `attribute(ref, ownHost, now?)`), the origin word (`originOf`, `ORIGIN_WORD`,
  `originLabel`), platforms for the filters (`platformOf`, `paidOf`, `PLATFORMS`, `PLATFORM_WORD`),
  the browser's side as pure functions (`readLanding`, `fromSomewhere`, `lastTouch`, `gaCampaign`,
  `isGatewayReferrer`), Ad links (`AD_LINK_TEMPLATES`, `utmLink`, `utmWord`, link option lists).
- `src/shared/pixels/identity.ts` — normalisers (`normPhone`, `normEmail`, `normName`, `normCity`,
  `normState`, `normCountry`, `normZip`), `splitName` (purchase.js customerOf's split), async
  WebCrypto `sha256`, `hashed`, `hashPhone`, `phoneId`, `hashedUser`, `matchHashes` (pixel.js
  rememberMatch), `clickId`/`CLICK_MAX`, `fbcFromStash`, GA id shapes and `gaIdsFromCookies`.
- `src/shared/pixels/catalogue.ts` — the event catalogue as data, `META_RELAY`, `SNAP_RELAY`,
  `LM_NAMES`, `ADD_TO_CART`, `ITEM_KEPT`, `pickName`, CURRENCY/CATEGORY/BRAND.
- `src/shared/kpi.ts` — port of kpi.js (+ `cancelledPct`, `overview(list, now)`); reads drizzle
  camelCase rows, snake_case rows, panel rows and ledger rows.

Server:
- `src/server/services/pixels/index.ts` — `deps.services.pixels` (`meta.send`, `snap.send`,
  `ga4.collect`, `ga4.publicConfig`, `publicIds`); 1.2 s cap, never throws; Meta token in the body,
  Snap token as Bearer, test code ignored on production.
- `src/server/services/pixels/fake.ts` — emulator for the three hosts; validates shapes the way the
  platforms refuse them, records every event (`pixelsFake(world).meta/snap/ga4`).
- `src/server/domain/pixels/build.ts` (Meta/Snap event builders), `relay.ts` (relay body →
  spec, allowlists from the catalogue), `send.ts` (build + send + note), `health.ts` (ops
  `px:<platform>`, `trackingHealth` with `failedToday` and `pixel_failures:<p>` warnings).
- `src/server/domain/purchase.ts` — `reportPurchase(deps, order, live?)`, `customerOf`, `itemsOmr`.
- `src/server/routes/tracking.ts` — `/api/beacon`, `/api/ev`, `/api/meta`, `/api/snap`, `/api/log`.
- `src/server/domain/analytics/` — `statsSummary`, `busyHours`/`busyValues`, `liveVisitors`,
  `logsList`/`logsCsv`, `catalogueChangeLines`/`describeChange`/`recordCatalogueChange`/
  `listCatalogueChanges`/`deleteCatalogueChange`/`clearCatalogueChanges`, `resetStats`,
  `trackingHealth`, `purgeEvents`; `index.ts` re-exports everything for the admin worker
  (plus `AD_LINK_TEMPLATES`, `utmLink`, `ORIGIN_WORD`).
- `src/server/jobs/analytics.ts` — `events-rollup` (hourly), registered in `jobs/registry.ts`.
- `docs/EVENTS.md`.

No schema change was needed (events, event_hours, catalogue_changes, claims, ops were in the
scaffold). No new env vars, no new packages.

## For the other workers

- **Orders/payments:** `attribute(ref, ownHost, now?)` — pass `deps.now()` as the third argument
  (the 90-day touch is judged on it; without it the function falls back to the wall clock).
  `originOf(ref, ownHost)` unchanged. `reportPurchase(deps, order, live?)` — `live` widened
  compatibly: `{ ip?, ua?, url?, signals?: ClientSignals }` (fresh page signals override the stored
  `client`). Returns `{ ga4: "server" | "page", reported?: boolean }`; put `ga4` in the till's /
  verify answer as the original did. Never throws. The order's `client` should hold `ip, ua, url
  (the checkout page), fbp, fbc, scid, sccid, gcid, gsid, vid` — validate `gcid/gsid` with
  `gaCid/gaSid` and `vid` with `isHash` from `shared/pixels/identity`, and keep `fbp/fbc` with
  `clickId` (never `str(…, 200)`).
- **Storefront (routes/storefront.ts):** `analyticsConfig` there does not upper-case the GA4 id or
  refuse a Universal Analytics id (test-v302: `g-abc123xyz9` → `G-ABC123XYZ9`, `UA-12345-1` → "").
  Use `deps.services.pixels.ga4.publicConfig()`. The public pixel ids are
  `deps.services.pixels.publicIds()` — the only config values that may reach a page.
- **Storefront (browser port of stats.js / pixel.js):** import `src/shared/pixels` and
  `src/shared/attribution`; hash with `hashPhone`/`matchHashes`/`sha256`, never a copy.
  Post the original bodies to `/api/beacon` (`{ items: [{ kind, body }] }`).
- **Admin:** expose the `domain/analytics` functions (no admin routes written here). Catalogue
  publish: `recordCatalogueChange(deps, actor, catalogueChangeLines(stored, next))`. Other areas
  may record a switch the same way (`"Empower auto push on"`).
- **Health:** `trackingHealth(deps)` → `{ meta, snap, ga4, warnings }` for the admin picture; the
  public health answer should carry only a warning count (v334).

## Decisions and deliberate differences from the original

1. **One module per rule.** The alias tables, normalisers and hashing exist once (the original
   kept browser copies and tests held them equal). Hashing is async WebCrypto everywhere.
2. **Analytics are always added up in SQL** (`domain/analytics/rollup.ts`): one grouped read of
   `events` ∪ `event_hours` (session = `left(md5(sid),16)`, item kept only for the adds and
   session_start). The original's paged-read fallback, its 50,000 cap and "partial" answers are
   gone; `capped` is always false and `coveredFrom` null.
3. **The purge is the hourly `events-rollup` job**, not 1-in-200 collector requests (and the
   collector no longer purges). Same rule: older than 90 days or beyond 500,000 rows, added into
   `event_hours` in the same statement.
4. **GA4 claim** is `ga4-<id>` in `claims` (state `taken` / `failed`; a failed one is taken over
   with a conditional update). GA4 is attempted even when another path already holds
   `purchase-<id>`, so a failed GA4 send is retried by the next confirming path — the original's
   `reportOnce` returned before GA4, so after v334 a failed GA4 send could never be retried.
5. **Phone for hashing on the Purchase** is the order's `phoneKey` (international digits), else
   `normPhone(phone)`; equal to the original's `normPhone(row.phone)` whenever the checkout posts
   the dial code (it does).
6. **Tracking-health notes are awaited** (one row-locked upsert) instead of fire-and-forget; the
   five-minute success throttle is per database handle in memory, as the original's per container.
7. **Browser error rows** use the new `logs` table: `side: "browser"`, `source` = kind,
   `path` = place, `detail = { stack, ua, sid, country }`; masking is core/log's (`[number]`,
   `[email]`). `logsList` never returns the session id: visitors are numbered "visitor N" per
   answer, groups and CSV are built server-side.
8. **DNT / GPC** headers also make `/api/ev` store nothing (the original only checked in the page).
9. **originOf** compares the own host without `www.`, and reads `utm.source` when `src` is absent
   (the page always filled `src` from it, so this only helps a newer page).
10. **Relay numbers:** `null` stays null (the original's `Number(null)` became 0).
11. **Change log** is the `catalogue_changes` table (no 500 cap), each row keeping its lines;
    the before/after order counts and "still counting" are computed server-side
    (`listCatalogueChanges`). The "Routed XX to …" legacy filter is not needed.
12. **Live map:** the city/lat/lng columns always exist, so `geo` is always true and the
    "pinned by country" fallback is not ported; the 20,000-row read cap is not needed
    (one grouped query for the ≤ 300 newest visitors, then their events).
13. **KPI functions that need "today" take `now`** (`window.days(n, now)`, `todayMuscat(now)`).
14. **statsSummary adds** `kpi` (shared/kpi over the window's orders, with sessions), `funnel`,
    `addedToCart`, `countriesTop` (top 6); the original fields are kept with their names.
15. **Meta test code** is ignored when `CONTEXT=production`, or when there is no CONTEXT and
    `NODE_ENV=production` (a self-hosted live server).
16. **Beacon rate limit** is core's `LIMITS.beacon` (120/min); the original was 60/min. Not my
    file — change it there if the original number matters.

## Dropped

- PostgREST-era tolerance (missing columns, missing functions, the 10-minute "no rollup" memory,
  `stats_first` RPC, geo-column fallback), the `?v=` and build checks, source-text regex checks on
  admin.js / HTML / netlify.toml (CSP, routing) — the admin and storefront are rebuilt by others.

## Test mapping (original suite → new tests)

| Original | New |
|---|---|
| test-pixel-parity (server halves: phone hash on both CAPIs, relays, card/webhook context, cash sale, OMR lines, test code, one set of normalisers) | `tests/unit/tracking/identity.test.ts`, `build.test.ts`, `tests/server/tracking/relays.test.ts`, `purchase.test.ts` |
| test-meta (normalisers, double hash, payload, click id) | `identity.test.ts`, `build.test.ts`, `relays.test.ts` |
| test-snap-capi | `build.test.ts`, `relays.test.ts` |
| test-snap-dedup (CAPI half) | `build.test.ts` |
| test-beacon (server fan-out), test-bugcheck ("constructor" kind) | `beacon.test.ts` |
| test-stats (collector, aggregation, chart, ledger orders, countries, All) | `beacon.test.ts`, `summary.test.ts` |
| test-v302 (standard, 90-day touch, session_start, GA4 server purchase + claim, Source/Medium, Ad links, publicConfig) | `attribution.test.ts`, `beacon.test.ts`, `purchase.test.ts`, `summary.test.ts`, `relays.test.ts` |
| test-v315 (visitor id, market, Snap the same, customerOf) | `relays.test.ts`, `purchase.test.ts` |
| test-v325 (catalogue ↔ allowlists) | `catalogue.test.ts` |
| test-v330 (KPI fixture, windows, row shapes) | `kpi.test.ts` |
| test-v331 (tracking health) | `health.test.ts` |
| test-v334 (purchase once; Tracking health counts today's failures) | `purchase.test.ts`, `health.test.ts` |
| test-v314 (A24 GA4 claim marked failed; ga4 server/page answer) | `purchase.test.ts` |
| test-v338-live (edge geo in events, stats.live) | `beacon.test.ts`, `live.test.ts` |
| test-v408 (filters, busy hours, live windows) | `summary.test.ts`, `live.test.ts`, `attribution.test.ts` |
| test-v209 (server windows, reminder-link Purchase payload) | `summary.test.ts`, `purchase.test.ts` |
| test-v211 (custom range, origin words) | `summary.test.ts`, `attribution.test.ts` |
| test-v410 (rollup = reading every event) | `summary.test.ts` (purge then every figure identical) |
| test-v411 (kept hours, All, Reset) | `summary.test.ts` |
| test-admin-data (originOf, describeChange, logs endpoint) | `attribution.test.ts`, `changes.test.ts`, `beacon.test.ts`, `live.test.ts` |
| test-email-savings (Purchase names the email) | `purchase.test.ts` |
| test-scan-keys (only public ids reach a page) | `relays.test.ts` ("what reaches a browser") |
| test-v300 (purchase both platforms at once, never throws, customerOf) | `purchase.test.ts` |

Not ported here (in scope, but not this area's code): the order writers stamping `origin` /
`attribution` (orders worker), `/resume` cash confirmation flow and pay-verify/webhook calling
`reportPurchase` (payments worker), `/api/settings`' `analytics` (storefront), admin rendering
(admin worker), `/api/health` warnings (health owner).

### Browser-behaviour checks for the storefront worker (stats.js / pixel.js ports)

From test-pixel-parity, test-snap-dedup, test-beacon, test-stats, test-v302, test-v209, test-v314,
test-v315, test-meta, test-admin-data, test-v204:
- sid: per tab in sessionStorage `lm_sid`, never localStorage or a cookie; DNT/GPC → no `ev` sent.
- beacon queue: one POST to `/api/beacon` (sendBeacon blob, fetch keepalive fallback); flush after
  80 ms, at 12 items, on pagehide and visibility hidden; nothing from a page with `__lmLeaving`;
  first batch order `ev:page_view, ev:session_start, snap, meta`; `hold`/`release` with an 8 s cap;
  `patch("snap")` fills `scid` when the held batch leaves.
- landing noted once per tab (`readLanding`), `session_start` once with `land`; page item
  home/checkout/privacy/404 (`data-page="404"`); checkout_view; delegated clicks: wa.me →
  whatsapp_click, `.size` → size_open, `.cart` → cart_open, `[data-pay]` → pay_method.
- error reports: ≤ 5 a page, never the same message twice, masked, the NOT_OURS / injected-stack
  filter; payload keys exactly `detail, kind, message, place, sid`.
- pixel + relay share one id (`client_dedup_id` / `eventID`, capital ID); never relay a Purchase;
  ADD_BILLING ↔ AddPaymentInfo once per method per page; values in OMR; an extra reported qty 1;
  Snap relay `items` with qty and OMR price; `lm_snap_ph` removed, `lm_ph_v2 = hashPhone`,
  `lm_ph_typed` via notePhone, `lm_am_v1 = matchHashes`; `lm_vid` 64-hex; relays send `vid`, `cc`.
- fbclid stashed as `<id>|<ms>` (first sighting kept, a new click replaces), `fbc` from the cookie
  else `fbcFromStash`; first-visit Meta relays wait for `_fbp` (≤ 4 s, `lm_fb_off` on script error).
- GA4: gtag only with an id; `page_referrer` = checkout when back from thawani.om; tags via
  `gaCampaign`; the page's purchase only when the server answered `ga4: "page"`; `signals()` with
  `gaIdsFromCookies`; `lm_touch` kept 90 days (`fromSomewhere`/`lastTouch`); `landing()` adds it.
- head snippets: Snap init `user_hashed_phone_number`; Meta init `{ ph, external_id, fn, ct, country }`;
  PAGE_VIEW / PageView relays under `__lmPageView` / `__lmFbPageView`.

## Open issues

- `core/log` stamps `logs.at` with the database's `now()`, not `deps.now()` (core's file); log
  windows in tests therefore run on the wall clock.
- `routes/storefront.ts` `analyticsConfig` (see above).
- Beacon limit 120 vs 60 (see 16).
- The Purchase's GA4 `item_name` is the item id (as the original's server copy); the Arabic name is
  on the order line if the shop ever wants it.
