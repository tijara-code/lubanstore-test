# Empower (Omniful) and the shelf — notes

Area: the Empower (Omniful) fulfilment route (push by hand / Push all / auto push, status
webhook and poll, take-off and re-send ids, SKU map, routing per market) and the stock rules
that read Omniful's shelf (pieces left, hide at 0, cap at stock, the till's gate).

## Files

| File | What |
| --- | --- |
| `src/server/services/omniful/index.ts` | The real client: base (`OMNIFUL_BASE` / `OMNIFUL_ENV` staging/production), `state()`, bearer token + renewal (refresh grant, rotated pair kept through an `AuthStore`), pacing (bucket of 3, then 1/s), `call`, `createOrder`, `cancelOrder`, `getOrder`, `listSkus`, `hubInventory` (+ per-SKU fallback on a 400/403 naming the hub, remembered 6 h). Also the wire vocabulary: paths, `explain`/`words`, `refOf`, `inventoryRow`, `readHook`, `expOf`. Adds `omniful` to `Services` by module augmentation. |
| `src/server/services/omniful/fake.ts` | The emulator (`omnifulFake(world)`): token, create (required fields validated; "order_id has already been taken"; optional `knownSkus` → "Sku Not Valid"; `dropAnswer` = take it then lose the answer), cancel ("order not found", "Order already cancelled", delivered refused), get order, hub inventory paged by page number (`refuseHub` → "Invalid hub code."), per-SKU inventory (404 "SKU not found"), master SKUs paged by cursor, `refuseToken` (401s), `advance()` and `hookPayload()` for tests. |
| `src/server/domain/empower/rules.ts` | Routing per market, status stages (`stageOf`, v447 order), `IMPLIED`, sent ids (`baseId`, `nextSentId`, `rowKey`), `isDuplicate`, `orderBody` (Create Order), phone/name split. |
| `src/server/domain/empower/cities.ts` | Arabic → English city names (copied from the original's `assets/js/i18n-en.js` cities block). |
| `src/server/domain/empower/lines.ts` | `skuOf`, `bundleBoxes`, `boxesOf` (shared with the gate), `nameOf`, `linesOf`, `unmapped`. |
| `src/server/domain/empower/store.ts` | ops records: `omniful_skus`, `omniful_retired`, `omniful_unsure`, `omniful_unrecorded`, `omniful_auto`, `omniful_auto_run`, `omniful_sweep`, `omniful_poll`, `omniful_auth`; `omf(deps)` binds the ops-backed token store to the client. |
| `src/server/domain/empower/shelf.ts` | Stock switches (`hideSet`, `capSet`, `stockOn`), `skuByItem`, `skusBySize`, `sumBySize`, `trackerRows`, `hidden`, `capped`, `readShelf` (cache ≤ 45 s in ops `omniful_stock`, last good ≤ 1 h with `error`, unknown never 0, `only` for a basket, `cacheOnly` inside a lock), `expireShelf`. |
| `src/server/domain/empower/push.ts` | `pushOrder`, `adopt`, `moveToPrep`, `sweep` (Push all: named ids, `left` when out of time), `autoPush`, `cancelPushed` (take-off), `noteFailure`. |
| `src/server/domain/empower/sync.ts` | `applyStatus` / `applyHook`, `followParcel` (forward only), `pollStatuses`. |
| `src/server/domain/empower/admin.ts` | The tab's actions as plain functions of `deps` (throw `fail()` with the original statuses): `empowerStatus`, `waitingList` (with `check`, `skuMissing`, `unsure`, `lines`), `pushedList`, `empowerRecords` (for the Orders list), `saveSkus`, `catalogSkus`, `matchSku`/`matchSkus`, `setRoute`, `pushOne`, `pushMany`, `autoSwitch`, `takeOff`, `syncNow`. No admin routes were written. |
| `src/server/domain/empower/index.ts` | Re-exports. |
| `src/server/domain/stock.ts` | `heldOrders`, `reserved`, `net`, `readShelfForGate`, `enforceStock`, `publicStock`, `stockStatus`, `payableUntil`. |
| `src/server/routes/empower.ts` | `POST /api/omniful/hook`, `GET /api/stock`. |
| `src/server/jobs/empower.ts` | `empower-auto` (every minute), `empower-poll` (every 30 min; schedule it at `7,37 * * * *`). Registered in `jobs/registry.ts`. |
| tests | `tests/unit/empower/rules.test.ts`, `tests/server/empower/{client,push,auto,sync,stock,admin}.test.ts`, helpers in `tests/server/empower/_helpers.ts`. |

No schema change, no new env var, no new package.

## Decisions

- **Routing (lead's decision):** a market is `"omniful"` (Empower) or `"manual"` (shipped by
  hand, tracking typed in the admin). A market with no route, or a value the code does not
  know (including the old `smsa` / `local`), is **Empower** — the main route; the live shop had
  all six markets on Omniful. `routing(cfg)` still says which markets are a choice
  (`chosen: true`) and which the default. Labels: "Empower (Omniful)" / "Shipped by hand".
- **Never twice** is read from the database under a short **lease** (claims key
  `empower-push:<id>`, 60 s, taken over when stale): a person and the auto run pressing at the
  same second → one goes, the other answers `skipped: "busy"`. The guard refuses: a tracking
  number on the order (`already_pushed` with that number), status `ship`/`done`
  (`not_shippable`, per the brief), any shipment row (`already_pushed`, `row`, `carrier`), or
  an `omniful_unrecorded` note (row written now, nothing sent). The original pushed a Shipped
  order without walking it back (test-empower "a Shipped order is sent"); the brief's rule
  wins — ported as a refusal.
- **Shipment rows**: `id = omf-<sentId>`, `carrier = "empower"`, `sentId`, `reference` (their
  id), `awb` (the courier's waybill, the original `sawb`), `courierName`, `status` verbatim
  with underscores spaced. Push answers carry `row` (our key) instead of the original's `awb`
  (which was the key); `already_pushed` carries `awb` only when it is a real waybill/tracking.
- **Unsure vs unsent:** a push whose answer was lost (timeout / reset) is `omniful_unsure` (noted;
  the next push adopts "already taken"). A connection that was refused, or a call refused
  for lack of time, never left: `omniful_unreachable`, no note (adopting a later "already
  taken" for it would be wrong). The auto run retries both next minute.
- **Adoption from news (v402)** additionally refuses a send id that was taken off
  (`omniful_retired`) and news whose stage is failed/returned (e.g. "cancelled"):
  `ignored: "retired_id"`. Otherwise a late "cancelled" for a taken-off order with no new
  send would have re-created its parcel.
- **Status → order** goes through `moveOrder(deps, id, to, "courier")` (forward only, never a
  trashed, pending or void order; failures/returns move nothing). Push → `moveOrder(…, "prep",
  "push")`; take-off → `moveOrder(…, "new", "push")` (only Preparing moves). Each push,
  adoption and take-off is also an `order_events` row (kind `empower`).
- **The webhook** records each delivery in `webhook_events` (provider `omniful`, `applied`
  = applied/adopted/<ignored reason>/failed, `dedupeKey = omniful:<sha256 of the body>`); a
  replayed body is applied again (harmless: forward only) and recorded once. Any method other
  than POST → 405 `method_not_allowed`; OPTIONS → 204.
- **Poll** asks by the row's `reference` and always applies the answer to the row's own
  `sentId` (only the exact sent id's row updates). Rows whose status says cancel/return/rto
  are not asked about; a failed answer rotates the row to the back (`syncedAt`).
- **The pacer** uses `deps.now()`; in fake mode it measures but never sleeps (`waitedMs`), so
  tests stay fast and still assert the 0/0/0/1000/2000 pacing.
- **Deadlines** are absolute ms on the deps clock (`opts.deadline`); `outbound.call`'s own
  deadline (real clock) is not used — the client converts to `timeoutMs`. The auto job gives
  itself 24 s − 4 s (budget of a 30 s scheduled function), the poll 6.5 s, `pushMany` 9 s,
  `syncNow` 7 s.
- **Held orders**: one read of the open orders (trashed false, new/pending, Empower markets,
  72 h while auto is on else 14 days, pending only while payable), then the parcel read in
  pieces of 200 — a piece whose parcel read fails is **held whole** (inventory §3 item 8).
- **The till's gate inside the lock (lead's request):** `readShelfForGate(deps, cfg, cc, lines)`
  reads the shelf (cached ≤ 45 s, else Omniful) and the auto switch through the ordinary
  handle BEFORE the till opens its locked transaction; `enforceStock(txDeps, cfg, cc, lines,
  except, tx, pre)` then only reads the open orders through `tx`. With a `tx` and no `pre`, the
  shelf comes from the kept reading only (`cacheOnly`, ≤ 1 h), never from Omniful; nothing
  kept → refuses nothing. **The tills (orders/payments areas) should call `readShelfForGate`
  first and pass it as the 7th argument** (sent to the coordinator). `enforceStock`'s first six
  parameters are unchanged.
- **`GET /api/stock`** keeps `left` always present (`{}` while the counter is off), as the
  original did. When the reading is unusable (source `none`) or the request throws, the
  instance's last good answer is served for ≤ 10 min (`s-maxage=15, stale-while-revalidate=60`);
  past that an unusable reading answers an empty body (200: "no number is better than a wrong
  one"), and only a thrown failure with no last answer is `502 { ok:false, error:"upstream" }`.
- `sku_not_set` is answered 409 by `pushOne` (a shop setting, not a fault; the original gave 502).
- `words({})` is "" (the original printed "{}").
- The auto run's "flag" is the run record (`omniful_auto_run.flagged`) and the Waiting list's
  `check` field; `orders.flagged` (the shop's own mark) is not written.
- Status/stage vocabulary lives in `domain/empower/rules.ts` (`stageOf`, `shown`, `STAGES`) —
  the tracking page's worker can import it.

## Dropped

- SMSA / local courier routing values, SMSA parcels and claims (`claim-smsa-*`), the
  shipment `contents`/`phone`/`city`/`booked_at`/`attempt_at` columns (not in the new schema;
  `attempt_at` only kept a stamp the new tracking page does not read).
- `opts.force` on a push (no caller used it).
- `OMNIFUL_SELLER_ID` (legacy, unused by the original's calls).
- test-poll-budget.js: SMSA only. test-whatsapp-courier.js: no Empower content.

## Notes for other areas

- **Storefront (test-v403):** the pieces-left number shown is display only:
  `max(1, floor(30% of the shelf))` while any box is there, 0 stays 0, unknown stays unknown.
  Caps and hides use the real figures `/api/stock` sends. The page asks `/api/stock` only
  when `stockLive` or any `stockHide`/`stockCap` tick is set.
- **Admin:** the Empower tab and the Stock Tracker call the functions in
  `domain/empower/admin.ts` and `stockStatus` (domain/stock.ts). `empowerRecords(deps, ids)`
  gives the Orders list each order's Empower record and the ids being checked (`unsure`).
  Pushes from the panel should pass `actor` (the admin name) for `order_events`.
- **Health:** `job:empower-auto` (stale after ~2 min), `job:empower-poll` (stale after ~60 min);
  warn `omniful_hook_unsigned` while `OMNIFUL_HOOK_SECRET` is unset.
- **Netlify schedules:** `empower-auto` `* * * * *`; `empower-poll` `7,37 * * * *`.

## Original suites → tests

| Original | Ported to |
| --- | --- |
| test-omniful.js | unit/empower/rules.test.ts (routing, invariant, shippable, body field by field, lines, readHook, hosts, expOf), server/empower/client.test.ts (state, bearer, retryable, renewal, 401 retry, new refresh token wins, pacing), server/empower/sync.test.ts (hook 404/200/bad_json, unknown/no reference), admin.test.ts (route action). Source-text pins on SMSA, toml and panel markup are dropped. |
| test-empower.js | push.test.ts (any market, never twice, Shipped refused (deliberate), void, take-off incl. 409/markOnly/delivered, re-send -2/-3, duplicate/fresh, Push all named ids), admin.test.ts (SKU map, status), unit (kit vs boxes, matchSku, explain), sync.test.ts (-2 news / late first-send news). WhatsApp typed-in orders, change log, Shipping list and sizes "kept open" belong to other areas. |
| test-v316.js | auto.test.ts (off by default, the run, flagged, fixed then sent, switched off, change log); unit (checkOf). The till-never-pushes check: the tills import nothing from empower. |
| test-v317.js (Empower side) | push.test.ts (a tracking number / another parcel refuses). |
| test-v319.js | stock.test.ts (held list, stockStatus held/heldHours, /api/stock last good answer), push.test.ts (sku_not_set + log, Sku Not Valid codes), auto.test.ts (held back with `sku`, waiting list check/skuMissing). |
| test-v338.js | auto.test.ts (3 min, every minute; JOBS everyMin). Panel tracking message: admin area. |
| test-v402.js | push.test.ts (unsure → adopted, adopt, no_time, sweep `left`, heal), auto.test.ts (heal, no answer retried next run, AUTO_MAX 10), sync.test.ts (news records an order; not with another parcel; unknown). |
| test-v206/207/208/209/211 | unit (inventoryRow, skusBySize, sumBySize, trackerRows, hidden, capSet, capped, boxesOf), client.test.ts (paging, cursor, per-SKU fallback, memo, odd shape), stock.test.ts (cache/fresh/kept/none, untrusted readings, gate, /api/stock body + headers). |
| test-v301.js | stock.test.ts (netting, cap follows, no extra shelf read, expire on push), push.test.ts (a push expires the reading). |
| test-v318.js | stock.test.ts (only Empower markets held; none routed → {}). |
| test-v334.js / test-v336-server.js (held windows, hook redelivery) | stock.test.ts (14 days off / 72 h on; pending 1 h / expire_at), sync.test.ts (a repeat of delivered puts a lost move right). |
| test-v314.js A5/A42, A10/A11/A13/A15 | stock.test.ts (through `/api/order`: last box, other basket refused, same submission, 5-day order holds; `except` semantics), push.test.ts (waybill on order, delivered, unrecorded tried twice then written), sync.test.ts (late picked_up), unit (isDuplicate). |
| test-v447.js (Empower parts) | unit (stageOf failures/returns), sync.test.ts (failures/returns move nothing, not polled again). |
| test-v185.js (Omniful parts) | sync.test.ts (status moves the order forward only, void untouched, poll asks only in-flight parcels by their reference, -2 row, 1/1/1 then 0), unit (bundle2 lines/kit). |
| test-v403.js | storefront note above (display only). |
| test-cart-availability.js (server parts) | covered by pricing's `outOfStock`; nothing Empower-specific. |
| test-poll-budget.js, test-whatsapp-courier.js | dropped (SMSA / no Empower content). |

Not ported: source-text pins on the old panel markup (`admin.js`, `index.html`), `netlify.toml`
and the legacy PostgREST column list (`ORDER_COLS`) — no such layer now.

## Open issues

- The tills must adopt `readShelfForGate` + the 7th `pre` argument, else inside their
  transaction the gate works only while a reading is kept (the product page's `/api/stock`
  keeps it warm every minute while caps are set).
- Admin routes for the tab's actions are for the admin worker to wire.
- Netlify scheduled-function files for `empower-auto` / `empower-poll` are not mine (jobs runner).
