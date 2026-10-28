# Admin UI (phase 1) — notes

The admin panel's front end at `/admin`: a Preact + TypeScript SPA (`site/admin/index.html` →
`src/admin/main.tsx`) over the admin API (`docs/notes/admin-api.md`). Phase 1 built the shell
and design system, sign-in, the data layer, Overview, Orders (list, filters, bulk bar, the
open order with every editor, the typed-in WhatsApp order). Payments, Catalogue, Empower,
Customers and Analytics are registered stubs a phase-2 worker replaces — how is in
`src/admin/README.md` ("Adding a tab").

## Files

| Path | What |
|---|---|
| `src/admin/main.tsx` | entry: the stylesheets, `<App/>` |
| `src/admin/README.md` | how the panel is built: adding a tab, the kit, the data hooks, conventions |
| `src/admin/app/` | `App` (boot), `Login`, `Shell` (sidebar, top bar, Settings dialog, auto refresh), `tabs.ts` (the registry), `route.ts` (hash router), `session.ts`, `panel.ts` (hidden pages, dismissed warnings) |
| `src/admin/data/` | `api.ts` (client, ApiError, 401), `endpoints.ts` (typed routes), `query.ts` (cache), `hooks.ts` (shared reads), `store.ts` |
| `src/admin/kit/` | `basics.tsx` (Btn, LinkBtn, Pill, Card, CardHead, Fold, Seg, Switch, Field, SearchField, Select, QtyStepper, Pager, Empty), `Kpi.tsx`, `charts.tsx` (LineChart, BarChart), `pickers.tsx` (MultiSelect, DateRange), `feedback.tsx` (toast, Modal, ask, choose), `copy.tsx`, `Icon.tsx`, `index.ts` |
| `src/admin/lib/` | `format.ts`, `words.ts` (vocabulary, Empower words, refusals in English), `order.ts` (links, WhatsApp texts, tracking), `cities.ts` |
| `src/admin/tabs/overview/Overview.tsx` | warnings, KPI tiles, orders over time, best sellers, latest orders |
| `src/admin/tabs/orders/` | `Orders.tsx` (toolbar, bulk bar, table, pager), `OrderRow.tsx`, `OrderDetail.tsx`, `Fulfilment.tsx` (status flow, tracking by hand, Empower, note, flag, trash), `CustomerEditor.tsx`, `ItemsEditor.tsx`, `ItemLines.tsx`, `ManualOrder.tsx` (dialog + `ManualOrderForm` for the Empower tab), `History.tsx`, `empower.ts` (push/duplicate/take-off flows), `filters.ts`, `rows.ts` |
| `src/admin/tabs/Placeholder.tsx` | the phase-2 stub |
| `src/admin/styles/` | `tokens.css` (+ `fonts/inter-latin-var.woff2`), `base.css`, `shell.css`, `kit.css`, `orders.css` |
| `src/admin/global.d.ts` | `*.css` module declaration |
| `tests/web/admin/` | `_render.ts` (mount/settle/click/type/key, fetch stub), `order-lib`, `data`, `orders-logic`, `app`, `kit`, `orders-ui` tests (72) |
| `tests/e2e/admin-helpers.ts`, `admin-panel.test.ts`, `admin-orders.test.ts` | Playwright (19) |

Shared files touched (small additions):

- `src/server/routes/dev.ts`: `POST /__fake/admin/orders` (fake mode only — dev routes are
  registered only with `SERVICES_MODE=fake`): writes order rows as given (+ "created" event,
  + an optional Empower send) for the e2e suites.
- `tests/e2e/global-setup.ts`: the server gets an invented admin sign-in (`e2e-keeper` /
  `e2e-password-not-a-secret`, a 38-char `SESSION_SECRET`) — without one no admin e2e test can
  sign in; `LM_E2E_DIST=<dir>` serves a dist built elsewhere (skips `npm run build`, so a worker
  can run e2e against its own dev build); teardown calls `closeAllConnections()`.
- No package added. Inter (OFL, latin, variable 400–700, 48 kB) is bundled under
  `src/admin/styles/fonts/` because the CSP allows fonts from `'self'` only.

## Decisions

- **Same look, same information architecture.** The original's tokens (colours, radii,
  spacing scale, small caps, shadows), capsule buttons, pill tints, KPI card with the dark
  revenue tile, the 244 px white sidebar with the ink active state, the sticky blurred top bar,
  the store card, the calendar and the status multi-select are ported into plain CSS
  (`styles/*.css`). Class names follow the original's where the component is the same.
- **Nav**: Overview, Orders, Payments, Catalogue, Empower (Workspace); Customers, Analytics
  (Insights). Shipping, WhatsApp, Local labels and Sales are gone with their features. The nav
  is a `<nav>` of buttons with `aria-current="page"` and a roving tab stop (arrows, Home, End).
- **Routing in the hash** (`#orders?q=…&status=new,flagged&page=2`): a reload or link keeps
  the tab and the Orders filters; a hidden or unknown tab falls back to Overview.
- **Data layer**: one query cache (`useQuery`) instead of the original's global arrays; reads
  are keyed strings, invalidated after writes, shared between screens, refreshed by the one
  Refresh button and the five-minute timer (paused while hidden, put off while typing in the
  open tab, `reason: "auto"` → the Orders list's `since` tag).
- **Server-side paging**: the list is the server's (20 a page, filtered there); the original
  held a year of orders in the browser. Consequences: "select all" selects the page, and a
  "Select all N matching" link fetches every id (500 a call) for the bulk bar; the bulk bar
  still sends 200 ids a call.
- **Overview figures** come from `GET /overview` (shared/kpi over every order not binned).
  The chart's 7 and 30 days are the server's `byDay`; 90 days and the best sellers are computed
  with shared/kpi from the last 12 months of orders read 500 at a time (at most 5,000; the card
  says so when capped). Best sellers are valued at each line's share of its order's OMR.
- **Status pill** shows Empower's words (v446: New Order, In Packing, Shipped, …) like the
  original; the **status filter** ticks are ours (Awaiting Payment, New Order, Preparing (In
  Packing…), Shipped, Delivered, Cancelled) with Flagged last — the API filters by our status,
  so Empower's fifteen warehouse words cannot be filtered server-side.
- **Flagged with other ticks** is AND (status in … AND flagged); the original's in-browser
  filter let a flagged order through whatever its status (OR). The API has no OR.
- **The status flow** is a row of buttons (New → Preparing → Shipped → Delivered, Cancel
  order) built from `shared/orders/status.ts` `transition()`: allowed moves are buttons,
  moving back is a dashed button that asks first and sends `force`, refused moves are disabled
  with the reason. Server refusals: `moving_back` / `parcel_live` ask and resend with `force`;
  `stale` says so and re-reads. Replaces the original's status select + Save.
- **Tracking by hand**: the tracking number and carrier fields show at once for a market
  routed `manual` (catalogue `courier`), and behind "Ship by hand instead" otherwise; "Save &
  mark shipped" is `PUT /tracking { ship: true }`.
- **Tracking link**: an Empower parcel with a waybill → Aramex, never for Oman (inventory
  ruling 21); an order shipped by hand with a tracking number (Shipped/Delivered) → the
  shop's own `/?track=<id>` (the brief) — Oman included, since ruling 21 is about the Aramex
  button and manual shipping did not exist when it was made.
- **WhatsApp**: the message the order is owed (confirmation / payment reminder with the
  `/resume` card link and `&cod=1` cash link / win-back after the cancel / refund note — the
  original's Arabic exactly) is a `wa.me` link and a Copy button; the Aramex tracking message
  (v338) the same. The cash fee and "cash on delivery off" come from the catalogue's market.
- **Empower from an order**: push asks first; Omniful's "already has it" opens a three-way
  choice (record it / send as a new order (asks again) / do nothing); take-off offers "remove
  the mark only" when Omniful refuses; the list shows "Empower?" while a push is unsure.
- **Item editor**: one select per line grouped Boxes / The set / Large-box offers / Add-ons
  (from `GET /orders/options`), sold-out and not-offered items marked but allowed (the server
  decides); a large-box offer gets its scent selects and is sent as `duo:oud.amber`; a line
  the market no longer offers is kept as "(not offered now)"; the amount to collect shows for
  every unpaid cash order (the original only in the Empower tab's editor).
- **Customer editor** sends only the fields that changed; Oman's governorate is a list (an
  old town kept as a choice); other markets get the checkout's city list as a datalist.
- **Typed-in WhatsApp order** is a dialog on Orders ("New order"); `ManualOrderForm` is
  exported for the Empower tab, where the original had it.
- **Cash collected** ("Mark cash collected" / "Mark not collected") on cash orders: `POST
  /orders/:id/payment` — new in the panel (the original did this in the dropped Sales book).
- **Dialogs** are a modal of the panel's own (focus trapped, Escape, focus returned, portaled
  to `<body>`) instead of `window.confirm`.
- **Phone layout**: the sidebar is a scrollable bottom row (v202), the orders table becomes a
  stack of cards, the open order is full width; Settings (top bar cog) also carries View store,
  Sign out and Sign out everywhere (the sidebar foot is not drawn on a phone).
- **Sign out everywhere** (`POST /logout {everywhere}`) is offered in the Settings dialog.

## Dropped

- The offline demo mode (`?demo`, admin-demo.js fixtures): `npm run seed` gives a realistic
  local shop instead (as the admin-api notes already say). test-admin-demo's checks applied
  only if a demo was kept.
- "Load older orders" (v332): the list is paged on the server, there is no window.
- Everything about SMSA, the Oman local labels, the Sales ledger, the WhatsApp Cloud API tab.
- The pack slip / printing (the original had none either).

## Original suites → tests

| Original (UI half) | New |
|---|---|
| test-admin-boot (boot, English labels, one tab, trashed not counted, search hand-off + ⌘/Ctrl K, avatar, password not stored, 5-min auto refresh paused/deferred, row click except controls, inline SVG chart, health card) | `web/admin/app.test.ts`, `orders-ui.test.ts`, `kit.test.ts`, `e2e/admin-panel.test.ts` |
| test-admin-tweaks (accordion + pin, 20 a page, page survives redraw, filter → page 1, count always shown) | `orders-logic.test.ts` (rows), `kit.test.ts` (pager), `orders-ui.test.ts` (filters → page 1) |
| test-admin-batch (bulk in 200s, one date-range picker, folded card keeps its inputs) | `orders-logic.test.ts` (chunked), `kit.test.ts` (calendar); `Fold` keeps its body mounted |
| test-admin-data (itemEn) | `order-lib.test.ts` |
| test-admin-look (figure + unit split, contrast tokens, stepper) | `order-lib.test.ts` (splitUnit), tokens ported |
| test-resume / test-audit-fixes §6 / test-cod-refusal (waMessage, orderPhase, codTotal, payUrl/codUrl) | `order-lib.test.ts`, `orders-ui.test.ts`, `e2e/admin-orders.test.ts` |
| test-v338 (trackingOf, trackMessage, the copy button) | `order-lib.test.ts`, `orders-ui.test.ts` |
| test-v408 / v418 / v419 (tracking link, Oman none; flag on rows and bulk; Flagged last; dismiss by code on the server, missing key not dismissible) | `order-lib.test.ts`, `kit.test.ts`, `orders-ui.test.ts`, `e2e/admin-orders.test.ts` |
| test-v411 §2 (dismissed codes saved with ui.save, never localStorage) | `kit.test.ts` |
| test-v211 (Settings: hide pages, Overview always shown; hidden page's link → Overview) | `app.test.ts`, `e2e/admin-panel.test.ts` |
| test-v202 (lockout said; phone nav row; roving tab stop) | `app.test.ts`, `e2e/admin-panel.test.ts` |
| test-login-lockout (panel half: 429 message) | `app.test.ts`, `e2e/admin-panel.test.ts` |
| test-v320 / v333 / v334 (Overview: "Cancelled or failed" N% of all orders, "N this week · delta", KPIs from the summary) | `app.test.ts`, `e2e/admin-panel.test.ts` (tiles = shared/kpi over the API's list) |
| test-v402 (Empower? pill, adopt on duplicate) | `orders-ui.test.ts` |
| test-order-items / test-extras (panel half: ids and quantities only, add-on whole, customer patch only changed) | `orders-logic.test.ts`, `orders-ui.test.ts`, `e2e/admin-orders.test.ts` |
| test-v334 (a voided unpaid card order cannot be revived by hand; bulk stale reported) | `orders-logic.test.ts` (movesOf), `Orders.tsx` staleWord |
| test-v204 (`since` → unchanged) | `data.test.ts` |
| test-v332 | dropped with the year window (server paging) |
| test-admin-demo | not ported (no demo mode) |

e2e coverage: sign-in (wrong password, lockout), Overview KPIs = shared/kpi over the orders,
nav keyboard, search, Settings hide/show, sign out, page width at 360/768/1366 with an order
open, no console errors; Orders search/status/country filters, CSV with filters, open an
order, status forward and back (confirm), tracking by hand + tracking page link, edit
customer, re-quote items, payment reminder links, push to Empower (fake Omniful), a typed-in
WhatsApp order, flag (row and bulk), trash and restore.

Run: `npx vitest run tests/web/admin`; e2e against a dev build:
`LM_E2E_DIST=dist-admin npx vitest run --project e2e tests/e2e/admin-*.test.ts` (or plain
`npm run test:e2e`, which builds `dist/`).

## Running it locally

```
DATA_DIR=.data/admin npm run seed -- --reset
PORT=8894 LM_DIST=dist-admin DATA_DIR=.data/admin ADMIN_USER=shopkeeper \
  ADMIN_PASSWORD=correct-horse-battery SESSION_SECRET=<32+ chars> npm run dev
# http://localhost:8894/admin/
```

## Screenshots

`/home/claude/shots/new-admin-overview.png`, `new-admin-orders.png`, `new-admin-order-detail.png`,
`new-admin-order-editors.png`, `new-admin-new-order.png`, `new-admin-settings.png`,
`new-admin-overview-360.png`, `new-admin-orders-360.png`, `new-admin-orders-768.png`,
`new-admin-login-{1366,768,360}.png` (seeded shop, `npm run seed`).

## Open issues

- The admin bundle includes zod (≈ 70 kB gzip in all) because `src/shared/admin/api.ts`
  re-exports the schemas with the constants the SPA needs. Splitting the constants into a
  zod-free module would shave it.
- The e2e run prints "close timed out … something
  prevents Vite server from exiting" after passing (open file handles, not from these suites as
  far as the hanging-process reporter shows; seen with any e2e file).
- The status filter cannot pick Empower's warehouse words (see Decisions); an "Empower
  status" filter would need the API to filter by the newest send's status.
- Flagged + statuses is AND (the API has no OR).
- In dev, the Overview lists every scheduled job as late (no scheduler runs locally).
