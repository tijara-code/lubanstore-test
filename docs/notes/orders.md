# Orders area — notes

Owner of: the cash till, writing/reading/moving orders, the panel's order rules (as domain
functions), CRM aggregation, the invoice page, public tracking, health, the public settings/geo
reads, and the retention + maintenance jobs.

## Files

| File | What |
|---|---|
| `src/server/domain/intake.ts` | what a shopper posts: `parseIntake`, the basket's shape (`qtyOf`, `basketRefusal`, 40 lines / 99 boxes / qty 1–99), the small validators (`isOrderId`, `isOrderKey`, `str`, `text`, `email`, `phone`, `phoneLike`, `pageUrl`, `idList`), `signalsOf` (fbp/fbc/scid/sccid/gcid/gsid/vid), `refOf` (the landing as plain data) |
| `src/server/domain/till.ts` | `priceBasket` (live catalogue; refusals 400 + item, faults 503 `pricing_unavailable` / `no_catalogue`), `gateStock` (409 `stock_short`; a failing check refuses nothing and is logged) |
| `src/server/domain/orders.ts` | `getOrder`, `moveOrder`, `writeOrder`, `baseOrderRow`, `orderIdFrom`, `newOrderId`, `newInvoiceKey`, `ownHost`, `inStockTx`, `anyCap`, `STOCK_LOCK`, `recordEvent` |
| `src/server/domain/order-admin.ts` | the panel's rules: `listOrders`, `orderDetail`, `updateCustomer`, `requoteItems`, `orderOptions`, `setStatus` / `bulkSetStatus`, `setTracking`, `setPayment`, `setFlag`, `setNote`, `setTrashed`, `purgeOrders`, `quoteManualOrder` / `createManualOrder`, `listCustomers`, `listCrm` / `saveCrm`, `exportOrders` + `toCsv` |
| `src/server/domain/invoice.ts` | the Arabic invoice page (`renderInvoice`, `invoicePage`, `notFoundPage`, `sameSecret`, `INVOICE_HEADERS`) |
| `src/server/domain/track.ts` | `trackOrder`, `stageOf` / `shown` (carrier vocabulary incl. Omniful snake_case), `normaliseOrderId`, `STAGES` |
| `src/server/domain/health.ts` | `healthStatus`, `fullHealth` (admin), `publicView`, `warnings`, `jobsHealth` |
| `src/server/routes/orders.ts` | `POST /api/order` (+ 405 for other methods) |
| `src/server/routes/storefront.ts` | `GET /api/settings`, `/api/geo`, `/api/track`, `/api/health`, `/invoice/:id` |
| `src/server/jobs/orders.ts` | jobs `retention` (daily) and `maintenance` (hourly); registered in `jobs/registry.ts` |
| `netlify/functions/job-retention.mts`, `job-maintenance.mts` | their schedules (`41 23 * * *` = 03:41 Muscat; `23 * * * *`) |

Tests: `tests/server/orders/{order,stock-gate,public,admin,jobs}.test.ts` (+ `fixtures.ts`),
`tests/unit/orders/intake.test.ts`, `tests/unit/pricing/till-rules.test.ts`.

## For the other areas (signatures you code against)

- **`moveOrder(deps, id, to, by, opts)`** — opts: `force`, `patch` (extra columns), `detail`,
  **`from`** (only if still in this status — what you read and checked), **`as`** (whose rights
  apply). A `job:<name>` mover is checked as `"admin"` unless `as` says otherwise: the Empower
  poll should pass `as: "courier"`, the expiry job `as: "payment"`. "ship" stamps `shipped_at`,
  "done" stamps `delivered_at` (if unset). Same status = `{ changed: false }`, nothing written.
  Every move writes an `order_events` row (kind `status`) in the same transaction.
- **`writeOrder(deps, row, event?)`** — `insert … on conflict do nothing`; the same `dedupe_id`
  answers `{ fresh: false, order: <stored> }` (its id may differ from the proposed one); a taken
  id is renumbered (5 tries, then `OrderWriteError("order_id_unavailable")`). Writes the
  `created` event (`by` default `"shopper"`). DB errors propagate.
- **`baseOrderRow(deps, id, intake, quote, request?)`** — added optional `request: { ip, ua }`
  merged into `client` (with the intake's signals and page url). Sets `phoneKey`, `sub`,
  `codFee`, `omrRate`, origin (`originOf`) and attribution (`attribute(ref, host, now)`), host =
  `ownHostOf(SITE_URL)` or `lubanmusk.com`. The card till adds `pay/status/paymentStatus/
  invoiceKey` (`newInvoiceKey()`), `amountBaisa` etc.
- **Stock gate + insert in one transaction:** `inStockTx(deps, lock, fn)` runs `fn(txDeps)` in a
  transaction holding `pg_advisory_xact_lock(STOCK_LOCK)` (taken only when the catalogue caps
  anything, `anyCap(cfg)`). `txDeps.db` IS the transaction and `txDeps.log` is buffered until
  the transaction ends. Reason: PGlite has one connection — any query through the outer handle
  inside a transaction waits for ever (verified). The card till should do the same:
  `inStockTx(deps, anyCap(cfg), tx => { await gateStock(tx, …); return writeOrder(tx, row) })`.
  `gateStock` passes `deps.db` as `enforceStock`'s `tx` (the Empower worker added that
  parameter). Consequence: the shelf read (`readShelf`, possibly an Omniful call) happens while
  the lock is held — fine at this shop's volume, but noted.
- **Orders tests seeding:** `tests/server/orders/fixtures.ts` (`seedOrders`, `seedShipment`).

## Decisions and deliberate differences from the original

- **Ids:** `/^LM-\d{4,12}$/`; new ids are 10 digits (7 of the clock from `deps.now()`, 3 from
  `crypto.randomInt`). The admin domain functions refuse/skip anything that is not an order id
  (the original's `idList` took any string).
- **Dedupe:** `dedupe_id` is UNIQUE in the new schema, so "already" is recognised by the dedupe id
  alone (the original required the same id AND dedupe id). The `already` answer carries the
  stored order's id and `omr` (the original echoed the proposed id and the new quote's omr).
- **`/api/order`:** `not_configured` is gone. Cash only (`pay` in the post is ignored; a COD-off
  market is `400 cod_not_offered`). The order and its `created` event are written in the stock
  transaction. A failed write is `502 {ok:false,error:"upstream"}`; the log row holds the
  database's own message only (never the query/params, which carry the name and phone). A
  failing `reportPurchase` never fails the order; the `ga4` answer falls back to "server" when
  GA4 id + secret are set, else "page".
- **`/api/track`:** kept **404 `not_found` for unknown and binned ids** (identical bodies), as
  `test-track.js` asserts and the storefront's tracking box parses (`res.s === 404` → "لم نجد هذا
  الرقم"). The brief's "unknown → 200 unknown (v314 A22)" does not match the original: A22 is
  about pay-verify. Additions: the server normalises what people type ("lm 482913", "LM482913",
  "482913"); rate limited (`LIMITS.track`, 30/min per address, 429 `rate_limited`); stages come
  from the newest Empower `shipments` row (a send whose status says cancelled — taken off — is
  skipped); with no parcel, an order shipped by hand reads `transit` (step 2, dates.picked =
  `shipped_at`) and a delivered one `delivered` (step 3) — the manual tracking number and carrier
  are never in the answer (same reason as the AWB). A shipment lagging behind an order marked
  delivered by hand answers delivered. `dates.attempt` is always null (no such column).
- **`/invoice/:id`:** same page and words; the COD fee row is still derived (total − lines −
  delivery), so an agreed cash amount (codAmount) still adds up on the page. Path `/invoice/<id>`
  or `/invoice?id=`; other methods 405 with an empty body.
- **`/api/settings`:** nothing published → the deploy's catalogue (the original said 503 empty;
  the storefront then fell back to the same file). Retry once, then the instance's last good copy
  (≤ 6 h) with `s-maxage=15, stale-while-revalidate=60`, else `502 {error:"upstream"}`.
  `analytics: { ga4, mp }` exactly as the original `GA4.publicConfig()`.
- **Health:** jobs come from the registry `JOBS` (`job:<name>` ops rows, `everyMin`); there is no
  "optional job behind a switch" any more — every job runs on schedule and records a run, so a
  switched-off job is never absent. Never ran → stale; `skipped` containing `not_configured` →
  not stale. Warnings: `thawani_uat_in_production`, `omniful_hook_unsigned`,
  `thawani_webhook_secret_missing`, `admin_password_missing` (password or hash), plus new
  `admin_user_missing`, `session_secret_missing` (< 32 chars), `site_url_missing` (production),
  `fake_services_in_production`. **Dropped:** `pixel_failures:<p>` — the pixel health records are
  the tracking area's; add the code to `warnings()` when that record exists. `health.ts` imports
  `RELEASE` from `app.ts` (circular, but read only at call time).
- **Admin rules (order-admin.ts):**
  - Refusals keep the original codes/statuses (`no_id`, `no_such_order` 404, `already_shipped`,
    `parcel_booked` {awb, carrier}, `payment_open` {until}, `cod_amount_not_cod`,
    `bad_cod_amount`, `bad_status` {allowed}, `bad_payment_status`, `card_payment_is_the_gateways`,
    `awaiting_payment`/`moving_back`/<transition code> {ids}, `parcel_live` {detail, ids, parcels},
    `stale`, `paid_orders_cannot_be_deleted`, `must_be_trashed_first`, `no_ids`,
    `nothing_to_update`, `name_required`, `bad_phone`, `no_name`, `no_city`, `unknown_country`).
  - "A parcel" is now a `shipments` row (Empower) whose status is not a cancellation; the waybill
    shown is `awb` or the sent id; the carrier `courier_name` or `carrier`.
  - `requoteItems` writes `sub` and `codFee` too (new columns), conditionally on the status read
    (409 `stale`), and passes the order's own `{id, dedupeId}` to `enforceStock`.
  - `updateCustomer` also recomputes `phone_key` when the phone changes; free text loses `<>`
    (the original admin stored it raw); the event names changed fields, never values.
  - The original `orders.update` is split: `setStatus` (with manual `tracking`/`carrier` on a move
    to ship), `setTracking` (`ship: true` moves it too), `setPayment` (cod ↔ paid; stamps/clears
    `paid_at`), `setNote`, `setFlag`. Bulk variants answer `{ ok, updated, stale }`.
  - `createManualOrder`: `pay` "cod" | "transfer" (`payment: "paid"` read as transfer); never
    stock-gated (as the original) and never reported as a Purchase. SMSA booking dropped.
  - `purgeOrders`: refuses any order that was paid, refunded, or carries a `payment_id` (a charge);
    the original's Sales-ledger cleanup is gone with the ledger.
  - CRM: `listCustomers` aggregates in SQL by `phone_key` (international digits, not the
    original's last nine digits — the shared phone module's key): `orders` (not binned), `live`
    (`isLive`), `spend` (OMR of live orders), `first`/`last`, `countries`, latest name/phone, and
    the CRM note/tags. Spend bands, local "corrections" overlay and sheet/ledger customers were
    panel/ledger features (admin worker / dropped). `saveCrm` deletes the row when note and tags
    are both empty.
  - Export: `exportOrders` → `{ columns, rows }`, `toCsv` defuses formula cells (`= + - @`).
- **Retention:** done/void orders whose `coalesce(delivered_at, created_at)` is more than 12
  months old (the original used `created_at`); 500 per run. Cleared: name, phone, email, city,
  region, note, `client`, the gateway record's `client` and every `metadata` block's customer
  keys (the card session's metadata carried name/phone/city). **`phone_key` is kept as is** (not
  hashed): it is what the CRM notes and the repeat-customer figure hang on, it is not shown
  anywhere a stranger can reach, and hashing it would orphan the CRM rows. A missing key is
  derived before the phone is cleared. `pii_cleared_at` stamped.
- **Maintenance:** logs older than 60 days; the newest 20,000 non-browser rows and 15,000
  `side = 'browser'` rows kept, each on its own; `webhook_events` > 90 days; claims > 60 days;
  rate-limit rows an hour past reset. `admin_audit` and `events` purges are the admin and tracking
  areas' (the original purged admin audit at 180 days in the same hourly run).

## Original suites → new tests

| Original | New |
|---|---|
| test-v336-server §1, §3, §4, §5, §7 | `order.test.ts` (market without rate, basket shapes, doors, cold/warm till, fields); `intake.test.ts` (qtyOf, validators) |
| test-v314 A5/A42 (stock), A20/A38 | `stock-gate.test.ts`, `order.test.ts` |
| test-v314 A2/A12/A14/A41 (item editor), A3/A4/A7 (status) | `admin.test.ts` |
| test-v329 (order flood) | `order.test.ts` "the doors" |
| test-bugcheck (writeOrder, cash only, freeOver 0, dashed size, invoice decimals/%E0) | `order.test.ts`, `till-rules.test.ts`, `public.test.ts` |
| test-order-items | `admin.test.ts` (options, re-quote, customer) |
| test-v189 (manual adjust, codAmount) | `admin.test.ts` |
| test-v326, test-v328, test-v334 (status parts) | `admin.test.ts` ("the status flow"); transition table itself is `shared/orders/status` |
| test-v408 §3 (flag) | `admin.test.ts` |
| test-trash, test-audit-fixes (purge, invoice fee/pill, track void, normaliser, 5xx hygiene) | `admin.test.ts`, `public.test.ts`, `order.test.ts`, `intake.test.ts` |
| test-track | `public.test.ts`, `intake.test.ts` (vocabulary) |
| test-invoice (server parts) | `public.test.ts` |
| test-customers (orders-based rules) | `admin.test.ts` "customers" |
| test-v324 / test-v334 (health) | `public.test.ts` "/api/health" |
| test-admin-data (origin stamped by both writers) | `order.test.ts` |
| test-price-tampering, test-availability (server), test-cod-refusal (server), test-free-ship (till), test-samples-free (till), test-v303 / v309 / v411 / v185 (pricing parts) | `tests/unit/pricing/till-rules.test.ts` |
| PII retention SQL (2026-10-pii-retention / fixes), purge_logs (2026-10-storefront), v326 housekeeping | `jobs.test.ts` |

Not ported (with reason): source-text regex checks (replaced by behaviour); the `needs_migration`
paths (no tolerant schema any more); the panel/DOM assertions (admin worker); SMSA, Sales ledger,
courier-sheet and WhatsApp Cloud parts (dropped); the stock math itself (`enforce`, `heldOrders`,
`boxesOf` — Empower area; the gate is exercised here with a stand-in shelf); payment/settlement
parts of v314/v334/v336 §8 (payments area); the Purchase report's contents (tracking area — here
only "not reported twice / not for manual orders").

## Open issues

- The stock lock is held across the shelf read (possibly an Omniful call); if that ever becomes
  slow, read the shelf before `inStockTx` and only count held orders inside it (needs a split API
  from the Empower area).
- `listOrders` paging is offset-based (fine for the panel's sizes; keyset if it grows).
- Health's `pixel_failures:*` warnings wait for the tracking area's health record.
- The admin routes (and their audit rows) are the admin worker's; every function here returns the
  original action's answer shape and throws `HttpError` refusals.
