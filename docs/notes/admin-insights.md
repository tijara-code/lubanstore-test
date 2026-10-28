# Admin insights (phase 2): Payments, Customers, Analytics — notes

The three phase-1 stubs replaced with the real tabs, on the phase-1 kit and data layer, matching
the original panel's look and behaviour (admin.js PAYMENTS / CUSTOMERS / ANALYTICS / LIVE NOW /
BUSY HOURS / SOURCE-MEDIUM, admin.css, admin/index.html), plus the phase-1 open issue "the admin
bundle pulls zod in".

## Files

| Path | What |
|---|---|
| `src/admin/data/insights.ts` | the three tabs' endpoints (one function per route) and their answer types as the SPA receives them; `health()` reads `/health` without the client's `ok:true` rule (its `ok` is the store's health) |
| `src/admin/lib/csv.ts` | a CSV made in the browser (BOM, quoting, formula cells neutralised) and downloaded |
| `src/admin/tabs/payments/pay.ts` | pure: `payKind`/`payState`/`payKinds`, `payTotals` (= the server's `totals`), `payRows` (state + search), `canRefund`, `canMarkPaid`, `payLinkOf`, `payCsv`, `payRefusal` (refusals in words) |
| `src/admin/tabs/payments/Payments.tsx` | toolbar (state seg, search, dates, "N not fetched from Thawani yet", Ask Thawani now, CSV), five tiles, the table (20 a page), `loadAll` (every page, 100 a call, ≤ 2,000) |
| `src/admin/tabs/payments/PaymentDetail.tsx` | a row opened (ids, card, fee, net, refunds, the stored payload and Thawani's answer with Copy, Ask Thawani, pay link), `RefundDialog`, `MarkPaidDialog` |
| `src/admin/tabs/customers/crm.ts` | pure: bands, search/filter/sort, countries from the list, tags parsing, CSV, `omr()` |
| `src/admin/tabs/customers/Customers.tsx` | toolbar (search, band, country, sort, CSV), the table (20 a page), every customer read (500 a call) |
| `src/admin/tabs/customers/CustomerDialog.tsx` | one customer: facts (+ wa.me link), their orders (links into Orders), note and tags |
| `src/admin/tabs/analytics/stats.ts` | pure: the view in the address, the request, keys, the caption, KPIs, notes, ranks, busy hours, live (places, pins, projection, lines), `createSeq` |
| `src/admin/tabs/analytics/Analytics.tsx` | the tab in the original's last order; the numbered summary read; Reset at the foot |
| `src/admin/tabs/analytics/LiveNow.tsx` | Live now: windows, Gulf/World, step chips, the map (lazy `/admin/live-map.json`), pins, tooltip, list, 15 s polling |
| `src/admin/tabs/analytics/cards.tsx` | `Rank`, `Busy`, `SourceMedium`, `AdLinks` |
| `src/admin/tabs/analytics/Changes.tsx` | Changes on the storefront |
| `src/admin/tabs/analytics/Health.tsx` | Tracking health, Errors and crashes |
| `src/admin/styles/insights.css` | the three tabs' styles (ported from admin.css; phone layouts) |
| `site/public/admin/live-map.json` | the original's world/Gulf outlines (Natural Earth via world-atlas, ISC), copied unchanged |
| `src/shared/admin/constants.ts` | NEW: `API`, `CSRF_HEADER`, `SESSION_COOKIE`, `SESSION_HOURS`, `ADMIN_PAGES`, `AdminPage`, `PAGE_ALIASES` (zod-free) |
| `tests/unit/admin-insights/pay.test.ts`, `crm-stats.test.ts` | 35 tests |
| `tests/web/admin/payments/payments-ui.test.ts`, `customers/customers-ui.test.ts`, `analytics/analytics-ui.test.ts` | 29 tests (happy-dom) |
| `tests/e2e/admin-payments.test.ts`, `admin-customers.test.ts`, `admin-analytics.test.ts` | 12 tests (Playwright) |

Shared files touched (small edits): `src/admin/app/tabs.ts` (the three entries), `src/admin/main.tsx`
(one stylesheet import), `src/shared/admin/api.ts` (constants moved out, re-exported),
`src/admin/data/api.ts` (imports the constants module), `src/admin/README.md` (the tree; the
"values from constants" rule). No server change, no schema change, no env var, no package.

Settings: the dialog lists `TABS` with a `page`, so Payments, Customers and Analytics are there
(checked; phase-1's app.test and admin-panel e2e still pass).

## The zod split (phase-1 open issue — fixed)

`src/shared/admin/api.ts` did `export * from "./schemas"` beside the constants the panel imports
as values (`API`, `CSRF_HEADER` in `data/api.ts`), so the panel bundled zod. The constants now live
in `src/shared/admin/constants.ts`; `api.ts` re-exports them (`export * from "./constants"`), so
every server import is unchanged and the API behaves exactly as before. The SPA imports values
from `constants` and only types from `api` (erased). Measured with esbuild over `main.tsx`: zod
inputs 95 → 0; the minified bundle went 620 kB → 159 kB at the time (phase-1 tabs only; ≈ 300 kB /
94 kB gzip now with every tab). The README says the rule.

## Decisions

### Payments
- **The list is the server's (card orders only)**, read whole for the range: 100 a call, every
  page (`more`), up to 2,000 rows (the original's `PAY_ALL_MAX`), then filtered by state and
  search in the browser so the tiles count every row (v446). The dates go to the server (Muscat
  days) — the range is a new read; the original narrowed in the browser.
- **Thawani is asked only when asked** (test-admin-tweaks): the session's first read sends no
  `lookups` (the server's cap, 12 — the original's tab open), Refresh and the five-minute timer
  send `lookups=0`, "Ask Thawani now" sends 12. A new date range does not re-ask.
- **One state per transaction** (v446) drives the filter, the pill and the tiles; "inProccess"
  (Thawani's spelling) is Pending, never Failed (v447).
- **Tiles**: Collected (net to the bank · refunded), Pending (waiting), Settled (fees),
  Transactions, Failed — the original's v446 five, all over the filtered rows. Money cells keep
  "OMR" as the original's table did.
- **A row's detail** (new; the original had none): session, invoice, payment id, Thawani's status,
  masked card, card type, amount, fee, net, refunds, the stored gateway payload (lazy, Copy) and,
  after "Ask Thawani" (`GET /payments/ask/:id`), Thawani's answer (Copy) — folded onto the shown
  row only; nothing is written (e2e checks `updatedAt`).
- **Refund** is a dialog (not `prompt`): the reason is required (≥ 3), "cannot be undone", the
  order becomes Cancelled and Refunded (the server); refusals in words; `already_refunded`
  re-reads.
- **Mark paid by hand** (new in the panel): Thawani's payment id (shape-checked first); the server
  checks it with Thawani. `amount_mismatch` is said with both figures and the button becomes "Mark
  paid with Thawani's figure" (resends `acceptAmount: true`) — inline, not a second modal.
- **Pay link** (copy the `/resume/<id>?k=` link) kept on unpaid card rows, as the original.
- **CSV** kept (`thawani-payments.csv`, the original's columns), made in the browser.

### Customers
- **Every customer is read** (`GET /customers`, 500 a call, ≤ 10,000) and searched, filtered and
  sorted in the browser — instant, and the pager has its total (the endpoint returns no count).
- **The band pill shows only when not Normal** (the brief); bands are the original's (High ≥ 26,
  Medium ≥ 10 OMR lifetime, live orders only — the server's sums).
- **Spend in OMR without "OMR" in every cell** (the header says it; on a phone the stacked row
  adds a small unit).
- **Note and tags are the server's CRM** (`PUT /customers/:key`): the original's browser-only
  overlay (`lm_crm_edits`, phone/spent corrections) is gone — corrections of an order belong on
  the order (Orders › customer editor). "Changed here only. Orders untouched." became "Saved.
  Orders untouched."
- **Source filter (website / whatsapp / repeat) dropped**: "whatsapp" meant the courier sheet and
  the ledger (dropped); every customer here is from orders. Repeat customers are visible by the
  Orders column / sort.
- **A customer opened**: a dialog with their orders (`GET /orders?q=<phone key>`, kept to that
  exact key), each opening on the Orders tab, "Show in Orders", a wa.me link.

### Analytics
- **The original's last order (v446)**: Live now; the toolbar; KPIs; Sessions by day; Busy hours;
  Added to cart · Visits by country; All events; Source / Medium; Ad links (folded); Changes;
  Tracking health; Errors; Reset at the foot. **The funnel and "Orders by source" cards are NOT
  drawn** — the owner had them removed in v446 ("the funnel and orders by source are gone (the
  owner's request)"; the server still answers `funnel` and `orders.origins`). The brief's list
  names them; I followed the original's last state. Adding them back is a small card each
  (`d.funnel`, `d.orders.origins`) if the coordinator wants them.
- **One range on screen (v209)**: the summary read is keyed by range + filters (`viewKey`) and
  numbered (`statsSeq`, the original's `STATS.seq`; `data-seq` on the tab); an answer is drawn
  only under the view it was asked for, so a slow "All" can never draw under "7 days"; a change
  empties every panel ("Loading…"); a failed read says "Not loaded." / "Could not load: …"; a
  refresh of the same range keeps its figures until replaced.
- **Range in the address** (`#analytics?range=30&country=OM…`, 7 days by default); the buttons
  and the calendar release each other (v211). The calendar is the kit's `DateRange` without
  presets.
- **Live now**: 1h (default), 3h, 6h, Today (inventory ruling 23); furthest step per visitor; the
  blue ramp; step chips filter pins and list; every 15 s via a timer that runs only while the
  card is mounted (the tab open) and `document.hidden` is false, and asks at once on return if
  15 s have passed; Gulf/World; "N outside this view · Show world"; tooltips as text. The map file
  is fetched once, lazily, when the tab first opens.
- **Busy hours** are computed in the browser from the summary's `busy` grid (as the original),
  not from `GET /analytics/busy` (one read fewer; same arithmetic as the server's `busyValues`).
- **Tracking health** reads `GET /health` (wiring + `tracking`); "Failed today" is the server's
  `failedToday` (Muscat day, v334).
- **Errors**: the server's groups; a row opens its newest occurrence's detail; side and window
  are re-reads keyed by both; the CSV is the server's `errors.csv` link with the window and side
  current when pressed.
- **Changes**: ten a page, search, 7/14/30 days either side (the server's `winDays`), a delete on
  each row and ticks with select-all → "Delete N entries" (one `DELETE` each, `no_such_entry`
  counted as gone), "Reset data" (`confirm: "changes"`); every one asks first.

## Deliberate differences from the original

1. Payments: a row detail, per-order Ask Thawani, Mark paid by hand (new); dialogs instead of
   `prompt`/`confirm`; the dates are read by the server.
2. Customers: server-side note and tags instead of the local overlay; no source filter; the
   sheet/ledger customers are gone with their features; a customer dialog; Normal has no pill.
3. Analytics: no funnel / orders-by-source (as v446); live polling stops when the card unmounts;
   the change log's window options come from the server's `winDays` (7/14/30).
4. CSV files are made with a Blob link instead of the original's helper (same columns).

## Original suites → tests

| Original (UI half) | New |
|---|---|
| test-payments (panel: columns, refund only paid & !refunded, reason ≥ 3, "cannot be undone", failed filter, CSV, pay link; totals client == server) | `unit/admin-insights/pay.test.ts`, `web/admin/payments/payments-ui.test.ts`, `e2e/admin-payments.test.ts` |
| test-admin-tweaks (Payments: Refresh lookups 0, Ask Thawani 12, date range drives the KPIs; 20 a page; filter → page 1) | `payments-ui.test.ts`, `customers-ui.test.ts` |
| test-v446 §2 (payKind / payState / payKinds, the five filters, every page read with lookups 0), §3 (1h/3h/6h/Today) | `pay.test.ts`, `payments-ui.test.ts`, `crm-stats.test.ts`, `analytics-ui.test.ts` |
| test-v447 (Payments "inProccess" is pending) | `pay.test.ts`, `payments-ui.test.ts`, `e2e/admin-payments.test.ts` |
| test-customers (bands 26/10, lifetime, cancelled → listed with 0, country code, filters → page 1, country from the list, CSV Band) | `crm-stats.test.ts`, `customers-ui.test.ts`, `e2e/admin-customers.test.ts` |
| test-admin-data (CRM key: the server's phone key; change log window, still counting, paged; logs grouped, CSV errors-<days>d.csv) | `customers` e2e (two spellings, one row), `analytics-ui.test.ts` |
| test-v209 (numbered reads, stale answer dropped, range change empties panels, failed read "Not loaded.", stamp from the payload; logs never another window's rows) | `analytics-ui.test.ts` "a slow answer…", "a failed read…", `crm-stats.test.ts` (stampOf, createSeq) |
| test-v211 (custom range: calendar beside the buttons, each releases the other, "Custom · N days", line chart; Settings lists pages) | `analytics-ui.test.ts`, `e2e/admin-analytics.test.ts`; Settings: phase 1's tests (TABS) |
| test-v338-live (live card first, 15 s only while open and visible, tooltips as text, map file) | `analytics-ui.test.ts`, `e2e/admin-analytics.test.ts` (outlines > 100 paths, pin, tooltip) |
| test-v408 (filters sent with the range, cache key has them; busy hours today first, hour now; typical day = total ÷ weekdays) | `crm-stats.test.ts`, `analytics-ui.test.ts`, e2e |
| test-v411 (one-line toolbar, Reset at the foot) | `analytics-ui.test.ts` (Reset), screenshots |
| test-v333 (top six countries; "Clear all N entries" asks) | `crm-stats.test.ts`, `analytics-ui.test.ts` |
| test-v334 (tracking health today's failures; export Net = settled − fee) | `analytics-ui.test.ts`, `pay.test.ts` (CSV Net) |
| test-v331 (tracking health card) | `analytics-ui.test.ts` |
| test-stats (5 ranges incl. All; reset asks, confirm "events"; "Sessions by week") | `analytics-ui.test.ts`, `crm-stats.test.ts` |
| test-admin-batch (one date-range picker everywhere) | Payments and Analytics use the kit's `DateRange` |

Not ported: regex-over-source checks (exact identifiers, CSS, `data-*` names) — replaced by the
behaviour; demo-mode answers (no demo); the CRM overlay and the sheet/ledger customers (dropped);
`#crmWindow` "older orders not loaded" (no year window).

## Screenshots

`/home/claude/shots/new-admin-payments.png`, `-payments-detail.png`, `-payments-390.png`,
`-customers.png`, `-customer-dialog.png`, `-customers-390.png`, `-analytics.png` (full),
`-analytics-390.png` — next to the original's `admin-pay.png`, `admin-crm.png`, `admin-stats.png`.
No sideways scroll at 360 / 390 / 768 / 1366 (checked in the e2e suites too).

## Running

```
DATA_DIR=.data/admin3 npm run seed -- --reset
PORT=8896 LM_DIST=dist-admin3 DATA_DIR=.data/admin3 ADMIN_USER=shopkeeper \
  ADMIN_PASSWORD=correct-horse-battery SESSION_SECRET=<32+ chars> npm run dev
npx vitest run tests/unit/admin-insights tests/web/admin
LM_E2E_DIST=dist-admin3 npx vitest run --project e2e tests/e2e/admin-{payments,customers,analytics}.test.ts
```

## Open issues

- The funnel / orders-by-source cards (see Decisions): the coordinator's call.
- `GET /customers` returns no total; the tab reads every customer (fine at this shop's size; a
  `total` in the answer would let it page on the server).
- `GET /payments` scans at most 5,000 card orders server-side (`SCAN`), the tab at most 2,000.
- The e2e run still prints "something prevents Vite server from exiting" (phase 1's open issue).
- `src/admin/app/tabs.ts` still imports `placeholder` though no tab uses it now (left for the
  other phase-2 worker's file edits; harmless).
