# Admin phase 2: the Catalogue and Empower tabs

This area replaces the phase-1 stubs of two admin tabs: **Catalogue**, the editor for the published catalogue, and **Empower**, the Omniful fulfilment route. Both tabs use the phase-1 kit, data layer and editors. No package, env var, schema or server change was needed.

## Files

| Path | What |
|---|---|
| `src/admin/tabs/catalogue/model.ts` | The editor's rules, as pure functions. Covers numbers as typed (Arabic and Persian digits, `٫`, `,`), the draft (`toDraft`) and what a publish carries (`toPublish`), refusals before a publish (`problemsOf`), Muscat time, the window's hours and days, the bundle's clock (`offerEndsIn`), `offerWhyHidden` and the heading, the stock grid (`setScentEverywhere`, `scentStock`), tiers state, free-delivery rows (`fsWords`), `missingSizes` / `restoreSize`, `addCountry`, id renames that carry the price, and `sameButStock` |
| `src/admin/tabs/catalogue/api.ts` | The tab's routes: catalogue, publish, restore, stock switches, `/stock`, and a market's route |
| `src/admin/tabs/catalogue/fields.tsx` | The `.field-b` boxes: `NumBox` reports a box that does not read as a number to the tab through `BadBoxes`. Also `TextBox`, `Tick`, `Pick`, `MarketTicks`, `ColorBox` and `Gap` (the English line's spacer) |
| `src/admin/tabs/catalogue/Catalogue.tsx` | The tab: load, draft, unsaved state, the stale banner, the Publishing dock, and the Restore-defaults dialog with its confirm word |
| `src/admin/tabs/catalogue/Offers.tsx` | `FoldCard` (the body stays mounted; there is an optional `lead` line), and the Small bundle, Large bundle (duo/trio) and Free delivery cards |
| `src/admin/tabs/catalogue/StockTracker.tsx` | The Stock Tracker |
| `src/admin/tabs/catalogue/Markets.tsx` | Markets and prices: "Common to every market", the country cards and "Add a country" |
| `src/admin/tabs/empower/api.ts` | Status, waiting, pushed, push-many, auto, sync, SKU codes, match, catalog and routes |
| `src/admin/tabs/empower/lib.ts` | The status lines, the auto note, the connection's word, `stageOf` (the server's v447 rules restated), the pushed filter, `skuProducts`, and the Push all loop `pushAll` |
| `src/admin/tabs/empower/Detail.tsx` | The order as the warehouse will be told it (`OrderBlocks`, which uses phase 1's `CustomerEditor` and `ItemsEditor` in manual mode), and `skuWord` |
| `src/admin/tabs/empower/Setup.tsx` | "Who carries each market" (radios) and "Omniful SKU codes" (Match and Save) |
| `src/admin/tabs/empower/Empower.tsx` | The tab: Omniful card, KPIs, Waiting, the WhatsApp order (phase 1's `ManualOrderForm`), and Pushed. Also `useEmpowerWaiting`, the sidebar badge |
| `src/admin/styles/catalogue.css`, `empower.css` | Ported from the original `admin.css`: `field-b` widths, one category per line with the English line beneath, the country card, `fs-grid`, the sticky dock, and phone stacks |
| `tests/web/admin/catalogue/{model,ui}.test.ts` | 25 + 23 tests |
| `tests/web/admin/empower/{lib,ui}.test.ts` | 11 + 17 tests |
| `tests/e2e/admin-catalogue.test.ts`, `admin-empower.test.ts` | 6 + 9 Playwright tests |

Shared files touched, each with a small change:

- `src/admin/app/tabs.ts`: two entries now point at `Catalogue` and at `Empower` (with `badge: useEmpowerWaiting`), plus their imports.
- `src/admin/main.tsx`: the two stylesheets are imported.
- `src/admin/tabs/orders/ItemsEditor.tsx`: a new optional `manual` prop sends `manual: true`, for v189 "adjust before push".

## Decisions

### The Catalogue tab

- **The draft is state.** The original read its form back from the DOM ("harvest"). Here the tab edits a clone of the served (merged) catalogue. A folded card therefore keeps its edits by construction (test-admin-batch), and every edit goes through one synchronous `edit(fn)`.
- **Changes in how the draft is shaped:**
  - Each market owns its sizes, scents and add-ons from the moment the page loads. The original did this at the first save.
  - The offers' market lists are held as explicit ticks. `toPublish` stores "every market ticked" as `[]`, as before.
  - The shared lists are rebuilt from the first market at publish, as the original did.
  - Free-delivery rows that say nothing are dropped.
- **What is never sent:** `toOmr`, scent and add-on `art`, `countsFree`, any route (`courier` per market or at the top level), `ledger`, `version` and `offer2`. The server strips or keeps these anyway; the panel does not rely on that.
- **Publishing is conditional.**
  - The publish sends the `version` and `editTag` it loaded.
  - A 409 `stale` answer gives a toast and a banner ("Someone else published the catalogue since you opened it (now version N)"). It disables Save & publish and offers Reload, which discards the edits. Export still works, so the edits can be kept.
  - A timed or Refresh read that brings a new `editTag` is adopted silently when nothing is unsaved. When something is unsaved, the same banner shows.
  - After a publish the tab re-reads (the server stamps the starts) and shows the answer's change lines under "What changed on the store". When there are none it says "Nothing on the storefront changed".
- **Refused before sending, with words:**
  - A box that does not read as a number: "COD fee: not a number", "…: cannot be negative", "At most 3 decimals". Arabic digits are accepted.
  - The original's checks: an end date before the start, and an offer or the large offers with no market ticked.
  - The server's checks, restated: ids are slugs, colours are hex, codes and currencies and dial codes are well formed, and there are no duplicate ids or markets.
- **Requests the server carries out:** the bundle window's Reset, the set's free-delivery Reset, the large offers' Reset, and Restart / Run again on a free-delivery row. The panel sends `anchorReset`, `freeShipReset`, `tiers.anchorReset` and `restart`; the server stamps the time. The anchor boxes say "Now, when you publish" or "When you publish".
- **Saved at once through their own routes:** the Stock Tracker switches (`PATCH /catalogue/stock`) and a market's route (the "Ships with" select in the Costs row, `PUT /empower/routes/:code`).
  - Neither carries the tab's unsaved edits.
  - After a switch is saved, the answer's new `version` and `editTag` are adopted only if the stored catalogue moved in nothing but the switches (`sameButStock`). Otherwise the stale banner shows. The next Save & publish is therefore not refused because of the tab's own switch.
  - A route can only be set on a published market: the select is disabled until then, and a 404 is explained.
- **Restore defaults** opens a dialog with the original warning: it "DISCARDS every price and fee edited here", naming the first market's figures. The word `defaults` must be typed before the button enables, and the request sends `confirm: "defaults"`.
- **Discard edits, reload published** asks first when there are edits, then re-reads. Nothing is published.
- **Export:**
  - With unsaved edits, the panel downloads what is on screen (the publish body, without code-owned fields) as `catalogue-<day>-unpublished.json`, as the original's Export did.
  - Without edits, it downloads the server's `GET /catalogue/export` file.
- **Large bundle offer (duo/trio) keeps its admin controls, per inventory ruling 2.** Its card has the switch, window length and unit, renew, Reset, the page clock and markets. Each market card has 2-box and 3-box price rows. The v417 forced-off save is not copied.
- **"The storefront rating"** is each scent's `Rating /5` (stars, 0–5 to one decimal; empty means none). The original panel has no top-level `rating` field.
- **The small bundle's "Term"** (`term`, `term_en`) is editable beside badge, name and note, because the brief asks for it. No storefront script reads it today.
- **Schedule:** the original had "Runs (Muscat days)" on the bundle. It is kept, using the kit's calendar with no presets and future days only.
- **Restore `<size>` reads from three places:** this market and the shared list as loaded, then the other markets. The original also used the deploy's file (`DEFAULTS`), which the API does not serve. When nothing has been published, the loaded data is the deploy file.
- **Removing a size keeps its price**, so Restore brings it back at that price. Every Remove asks first and names the market: "Remove the size “صغير” from الإمارات (AE)?"
- **Layout:** each category sits on one line with the English boxes beneath, as in the original. Below 900 px the rows wrap. Remove sits at the end of the second line (the first line runs long). Below 720 px the Publishing dock is static instead of sticky.
- **Stock Tracker:** only the newest reading draws (sequence numbers). The heading names the failure as v209 does. The rows are drawn for every box before the shelf is read.

### The Empower tab

- **The waiting list comes from `GET /empower/waiting`.** The original computed it in the browser from all its orders. Each row opens to the order read with `GET /orders/:id`, which shares the Orders tab's cache key, so an edit refreshes both tabs.
- **Per-row Push** reuses phase 1's `pushOne`, which asks the duplicate question. It sends `any: true`; on this tab every row is already in an Empower market.
- **Push all:**
  - It asks first, naming the count and the oldest order.
  - It loops on `POST /empower/push-many`, 200 ids a call, re-sending `left` until nothing is left. It stops after two calls in a row that do nothing.
  - It then offers to record Omniful's duplicates with `{id, adopt: true}`.
  - The toast follows the original: "N pushed · nothing waiting", "N pushed, M refused: …", or "N pushed, then stopped: …".
- **Auto push** asks before turning on, using the original's text. Turning it off does not ask. The note under the switch says what "on" means and what the last run did (pushed, held back, refused, retried after N h).
- **Pushed list:** the server returns up to 1000 rows. The tab pages them 15 at a time in the browser, with the original's stage filter and search.
  - The **City** column became **Courier**: the shipments row has no city (the original's did), and a join would mean changing the empower area's `pushedList`.
  - **Still in flight** excludes cancelled and returned parcels as well as delivered ones.
- **Take off Empower** reuses phase 1's `takeOff`: it confirms, and when Omniful refuses it falls back to "Remove the mark".
- **Copy tracking message** and **WhatsApp tracking** show once the order is read and the parcel has a waybill. They use phase 1's `trackMessage`.
- **Who carries each market** is a radio pair per market. It cannot be a pair of ticks, because a market sent two ways would ship twice.
- **SKU codes:**
  - Match calls `POST /empower/skus/match` with what is typed. It fills the matches and marks a box Omniful does not know, with the server's own words.
  - The datalist is filled from `GET /empower/catalog`.
  - Save sends the whole map.
- **Sidebar badge:** the number of orders waiting (`GET /empower`). The phase-1 shell labels it "N new".

## Dropped, and why

- **The out-of-date-deploy banner** ("Published catalogue is out of date", checkStale): the row version and the deploy version are different counters now.
- **The SMSA and local-courier options in routing, and the setup text about them:** both couriers are dropped.
- **The browser-side anchor rules** (`harvestOfferIn` / `harvestTiers` restarts): the server now applies them, in `stampOffer` and `stampTiers`, which are tested on the server.

## Original suites → tests

| Original (UI side) | New |
|---|---|
| test-offer-admin: anchor box, days/hours and unit flip, one-shot countdown, stock grid, `offerWhyHidden`, `soldOutSizes` kept by id | `catalogue/model.test.ts` (window, grid, why, clocks), `catalogue/ui.test.ts` (unit flip, Reset, grid tick) |
| test-admin-batch: folded card keeps inputs, state line visible, hours stored, "On", no Notes box and notes kept, Price (CUR), date picker | `catalogue/ui.test.ts`, `catalogue/model.test.ts` |
| test-admin-tweaks: "Markets and prices" with its count, cards closed and opened by a button | `catalogue/ui.test.ts` "loading" |
| test-catalogue-merge (UI): no button replaces the live catalogue without asking, restore warns "DISCARDS", recover re-reads and publishes nothing, OMR rate read-only, Save / Reload / Reset / Export wired | `catalogue/ui.test.ts` "the publishing bar's other buttons", "add-ons" |
| test-extras (panel): Price (CUR), "New add-on" switched off | `catalogue/ui.test.ts` |
| test-v207 / v208 / v209 / v211 / v319 (admin): Stock Tracker switches, columns, read now, held list, failure headings | `catalogue/ui.test.ts` "the Stock Tracker", e2e "a Stock Tracker switch writes only itself" |
| test-v303 / v309 / v417 (ruling 2): duo/trio prices and card, "tick at least one market", "Sold only in this bundle", `offer2` dropped | `catalogue/ui.test.ts`, `catalogue/model.test.ts` |
| test-v408 / v410 / v411 / v413: the set ships free (switch, markets with none ticked meaning off, length, renew, Reset) | `catalogue/ui.test.ts`, `catalogue/model.test.ts` |
| test-free-ship (panel): Restart / Run again as a flag, days, "Same days for all", pill words | `catalogue/ui.test.ts`, `catalogue/model.test.ts` |
| test-v189: editable waiting detail, read-only pushed detail, items in manual mode | `empower/ui.test.ts`, e2e "the area is added inside the row" |
| test-v316 / v338: auto switch confirm and note, the run's own figures; copy tracking message | `empower/ui.test.ts`, `empower/lib.test.ts`, e2e |
| test-v402: Push all until `left` is empty, adopting duplicates, "Empower?" pill | `empower/lib.test.ts` (loop), `empower/ui.test.ts` |
| test-empower / test-omniful (panel): status lines, SKU list, routes radio, match | `empower/lib.test.ts`, `empower/ui.test.ts` |
| test-v447: stage order | `empower/lib.test.ts` |

What the e2e suites cover, against the real server and fake Omniful:

- **Catalogue:** publish with Arabic digits (stored without code-owned fields); someone else's publish leading to stale and then Reload; a non-number refused; a stock switch writing only itself, then a publish without conflict; a route that survives a publish.
- **Empower:** the waiting list and its detail; an edit before the push; Push; Push all; the auto switch; the pushed detail; Check statuses; Take off returning the order to Waiting; routes; SKU codes.
- **Both tabs:** no sideways scroll at 360, 768 and 1366 with the forms and rows open, and no console errors.

Run them with:

```
npx vitest run tests/web/admin
LM_E2E_DIST=<a dev build> npx vitest run --project e2e tests/e2e/admin-catalogue.test.ts tests/e2e/admin-empower.test.ts
```

The catalogue suite's `afterAll` restores the deploy's catalogue and puts AE back on Empower, so the suites that follow see the default shop. The empower suite publishes the served catalogue first when nothing is published (routes need a published market). Its Push all check accepts refusals of other suites' orders.

## Screenshots

`/home/claude/shots/`:

- `new-admin-catalogue.png`
- `new-admin-catalogue-open.png`
- `new-admin-catalogue-stock.png`
- `new-admin-catalogue-390.png`
- `new-admin-empower.png`
- `new-admin-empower-open.png`
- `new-admin-empower-390.png`

Compare them with the original's `admin-products.png` and `admin-omniful.png`.

## Open issues

- **Routes need a published market.** On a shop that has never published, `PUT /empower/routes/:code` answers 404 `no_such_market`. The tab says so, and the Catalogue tab disables the select until the market is published.
- **Pushed rows have no city.** Adding it would mean the empower area's `pushedList` joining `orders`.
- **Restore `<size>` cannot use the deploy file**, because the API does not serve it (see Decisions).
- **"N new" on the Empower badge:** the shell's wording is phase 1's.
- **Shared admin words:** catalogue refusals (`not_published`, `no_such_market`) are worded in these tabs rather than added to `lib/words.ts`, to keep the shared-file edits small.
