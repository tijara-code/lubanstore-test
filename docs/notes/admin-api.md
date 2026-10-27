# Admin API — notes

The admin panel's server side: sign-in and the session, the HTTP API the admin SPA calls,
the audit trail, the panel's settings, and the catalogue editing/publishing rules. The domain
logic of orders, payments, Empower and analytics is the other areas'; this area puts one
validated, authenticated, audited API over it.

## Files

| File | What |
|---|---|
| `src/shared/admin/schemas.ts` | zod schema of every request body and query (shared by the server and the SPA), id/day/colour regexes, status lists |
| `src/shared/admin/api.ts` | re-exports the schemas; `API`, `CSRF_HEADER`, `SESSION_COOKIE`; the panel's pages (`ADMIN_PAGES`, `PAGE_ALIASES`); answer types (`SessionAnswer`, `OrdersAnswer`, `OrderListRow`, `OrderDetailAnswer`, `ItemOptionsAnswer`, `OverviewAnswer`, `Warning`, `CatalogueAnswer`, `PublishAnswer`, `UiAnswer`, `AuditAnswer`, …); `Jsonify<T>`; `ENDPOINTS` (the route table as data) |
| `src/server/domain/admin/auth.ts` | scrypt hash/verify, `authConfigured`, `checkCredentials`, session token issue/read, "sign out everywhere", cookie header, the login flow with the lockout |
| `src/server/domain/admin/audit.ts` | `summaryOf`, `idsOf`, `recordAudit`, `listAudit`, `purgeAudit` (180 days) |
| `src/server/domain/admin/panel.ts` | panel settings (`getUi`/`saveUi`, ops `admin_ui`), `ordersSummary` (shared/kpi `overview`), `currentWarnings`, `overview` |
| `src/server/domain/admin/catalogue.ts` | `getCatalogue`, `publish`, `restoreDefaults`, `setStockSwitches`, `exportCatalogue`, `writeCatalogue` (the conditional write), `prepare` + the stamps (`stampFreeShip`, `stampSetFree`, `stampOffer`, `stampTiers`, `keepOperational`), `editTag`, `validCatalogue` |
| `src/server/domain/admin/options.ts` | `itemOptions` — every item a market's line can carry, priced, sold out marked |
| `src/server/domain/admin/jobs.ts` | job `admin-audit` (daily, purge > 180 days); imported from `jobs/registry.ts` |
| `netlify/functions/job-admin-audit.mts` | its schedule (`47 2 * * *` UTC) |
| `src/server/routes/admin.ts` | the registrar: one Hono sub-app at `/api/admin`, guard first, its own error handler |
| `src/server/routes/admin/kit.ts` | the guard (headers → CSRF → session), `body()`/`query()` (zod → 400 `bad_input`), `audit()`, `download()` |
| `src/server/routes/admin/{session,orders,fulfilment,insights}.ts` | the routes |
| `scripts/admin-hash.ts` | `npm run admin:hash` |
| `scripts/seed.ts` | `npm run seed` |
| `tests/server/admin/{auth,orders,catalogue,panel,audit}.test.ts` + `_helpers.ts` | 62 tests |

Shared files touched: `src/server/jobs/registry.ts` (one import line), `package.json` (scripts
`admin:hash`, `seed`). No schema change, no new env var (ADMIN_*/SESSION_SECRET were already
declared), no new package.

## The endpoints

All under `/api/admin`. JSON answers `{ ok: true, … }` / `{ ok: false, error, …extra }`, always
`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`. Non-GET requests need
`X-LM-Admin: 1` and same origin. Every route except the first three needs the session cookie.
(W) = audited.

| Method | Path | Body / query | Answer |
|---|---|---|---|
| POST | `/login` | `{ user, password }` | `{ user, expiresAt }` + cookie · 401 `bad_credentials` · 429 `too_many_attempts` · 503 `not_configured` |
| POST | `/logout` | `{ everywhere? }` | `{ ok }`, cookie cleared |
| GET | `/session` | — | `{ signedIn, configured, user?, expiresAt? }` |
| GET | `/overview` | — | `{ orders: OrdersSummary, warnings: Warning[], dismissedN, health }` |
| GET | `/health` | — | `fullHealth` + `tracking` (booleans, never values) |
| GET | `/orders` | `status` (comma list), `pay`, `payment`, `country`, `origin`, `flagged`, `trash` 0/1/all, `from`, `to`, `q`, `limit` ≤500, `offset`, `since` | `{ orders, total, limit, offset, tag, empowerUnsure }` or `{ unchanged: true, tag }` |
| GET | `/orders/export.csv` | the list's filters | text/csv attachment (W: `orders.export`) |
| GET | `/orders/summary` | — | `OrdersSummary` (all / week / before / delta / byDay) |
| GET | `/orders/options` | `country` | `{ country, cur, dec, items: ItemOption[] }` |
| POST | `/orders/manual/quote` | form (name/phone/city optional) | the running total |
| POST | `/orders/manual` | `ManualOrderBody` | `{ id, already, total, … }` (W) |
| POST | `/orders/bulk` | `{ op: status|flag|note|payment|trash|restore|purge, ids ≤200, … }` | `{ op, updated|deleted, stale? }` (W: `orders.bulk.<op>`) |
| GET | `/orders/:id` | `gateway=1` | `{ order (hasGateway; gateway only when asked; never client), events, shipments }` |
| GET | `/orders/:id/gateway` | — | `{ gateway }` |
| PATCH | `/orders/:id/customer` | name/phone/email/city/region/note | `{ patch }` (W: field names only) |
| PUT | `/orders/:id/items` | `{ items, manual?, codAmount? }` | the re-quote (W) |
| POST | `/orders/:id/status` | `{ to, force?, tracking?, carrier? }` | `{ id, from, to, changed }` (W) |
| PUT | `/orders/:id/tracking` | `{ tracking, carrier?, ship? }` | (W) |
| POST | `/orders/:id/payment` | `{ to: cod|paid }` | `{ updated, stale }` (W) |
| PUT | `/orders/:id/flag` · `/note` | `{ on }` · `{ note }` | (W) |
| GET | `/customers` · `/crm` | `q, country, sort, limit, offset` | `listCustomers` · `listCrm` |
| PUT | `/customers/:key` | `{ note?, tags? }` | (W; target is a hash, never the phone) |
| GET | `/payments` | `limit, skip, lookups (0 = none, absent = 12), from, to` (ms or Muscat day) | `listPayments` |
| GET | `/payments/ask/:id` | — | `askThawani` (reads, writes nothing) |
| POST | `/payments/refund` · `/payments/mark-paid` | `{ paymentId, reason }` · `{ id, paymentId, acceptAmount? }` | (W) |
| GET | `/empower` · `/empower/waiting` · `/empower/pushed?limit` | — | status (incl. routing per market, auto) · waiting · pushed |
| POST | `/empower/push` | `{ id, any?, fresh?, adopt? }` | (W) |
| POST | `/empower/push-many` | `{ ids ≤200 }` | sweep of the first 6 + `left` (the rest, to send again) (W) |
| GET/PUT | `/empower/auto` | `{ on }` | (PUT W) |
| POST | `/empower/sync` · `/empower/take-off` | — · `{ id, markOnly? }` | (W) |
| GET/PUT | `/empower/skus` | `{ skus }` | the SKU map (PUT W) |
| GET | `/empower/catalog` | — | Omniful's SKUs |
| POST | `/empower/skus/match` | `{ skus? }` | `{ matches: { code: { sku, problem } }, known }` (nothing saved) |
| PUT | `/empower/routes/:code` | `{ courier: omniful|manual }` | (W) |
| GET | `/stock` | `fresh=1` = read the shelf now | `stockStatus` |
| GET | `/catalogue` | — | `{ data (merged), stored, version, editTag, updatedAt, updatedBy, codeOwned, deployVersion }` |
| POST | `/catalogue/publish` | `{ data, version, editTag? }` | `{ version, editTag, updatedAt, change[], data }` · 409 `stale` {version, editTag} · 400 `bad_catalogue`/`bad_country_code`/`duplicate_country`/`bad_input` (W) |
| POST | `/catalogue/restore-defaults` | `{ version, editTag?, confirm: "defaults" }` | as publish (W) |
| PATCH | `/catalogue/stock` | `{ stockLive?, stockCap?, stockHide? }` | as publish; 409 `not_published` (W) |
| GET | `/catalogue/export` | — | JSON attachment |
| GET | `/analytics/summary` · `/busy` · `/live` | range/from/to/country/platform/paid · + weekday/metric · minutes | `statsSummary` · `busyHours` · `liveVisitors` |
| GET | `/analytics/errors` · `/errors.csv` | `days, side, full` | `logsList` · CSV attachment |
| GET | `/analytics/tracking` · `/analytics/links` | — | `trackingHealth` · ad link templates and words |
| GET | `/analytics/changes` | `winDays, limit` | `listCatalogueChanges` |
| DELETE | `/analytics/changes/:id` | — | (W) |
| POST | `/analytics/changes/clear` · `/analytics/reset` | `{ confirm: "changes" }` · `{ confirm: "events" }` | (W) |
| GET/PUT | `/settings/ui` | `{ hidden?, dismissed? }` | `{ ui: { hidden }, dismissed }` (PUT W) |
| GET | `/audit` | `days ≤180, limit` | `{ days, rows }` |
| GET | `/jobs` · POST `/jobs/:name/run` | — | `jobsHealth` · `{ name, result }` / 404 `no_such_job` / 502 `job_failed` (W) |

## Decisions

- **Session = HttpOnly cookie, not a bearer token in sessionStorage.** `lm_admin` =
  base64url(`{u, iat, exp, n}`) + "." + HMAC-SHA256; `Path=/api/admin; HttpOnly;
  SameSite=Strict; Max-Age=43200`, `Secure` except on `http://localhost|127.0.0.1`. 12 h
  (the original 8 h). The SPA never holds the credential, so an XSS cannot lift it.
- **The signing key** is derived from `SESSION_SECRET`, the user name and a fingerprint of the
  password (hash), so a new password signs everyone out (the original needed SESSION_SECRET
  rotated too). `SESSION_SECRET` is required and must be ≥ 32 characters (matching the health
  warning `session_secret_missing`); without it — or without a user or password — nothing
  signs in (503 `not_configured`). The original's fallback "sign with the password" and its
  two-part legacy token are gone (v329's compatibility window is over).
- **Sign out everywhere**: `POST /logout {everywhere:true}` stores an instant in `ops`
  (`admin_sessions_since`); older sessions are refused. One small read per request.
- **Password**: `ADMIN_PASSWORD_HASH` = `scrypt$N$r$p$salt$key` (base64url; N = 2^15, r 8, p 1,
  32-byte key), else `ADMIN_PASSWORD`. A malformed hash counts as no password (not
  configured), never as "any password". `npm run admin:hash` reads stdin without echo
  (raw-mode TTY, or a pipe), refuses < 12 characters, prints only the hash. The hash contains
  `$`: quote it in a shell; Netlify's UI and Node's `--env-file` take it as is.
- **Lockout**: `ratelimit.ts` `login` (8 / 15 min per address) + `loginGlobal` (60 / 15 min,
  all addresses). Locked → refused BEFORE counting (`peek`), else counted BEFORE checking
  (`allow`) — exactly the original's two orders (v202, test-login-lockout). 429
  `too_many_attempts` with `retry_after_min: 15`, `retryAfter` seconds and `Retry-After`.
  A success clears the address. Every answer padded to ≥ 350 ms (`LOGIN_TIMING.padMs`, tests
  set 0). Note: the global ceiling lets a distributed guesser lock the owner out for 15
  minutes — the price of the ceiling the brief asked for.
- **CSRF**: every non-GET request must send `X-LM-Admin: 1`; `Sec-Fetch-Site`, when present,
  must be `same-origin`; `Origin`, when present, must be the request's own origin, `SITE_URL`
  or the forwarded host. Plus `SameSite=Strict`. Checked in the guard before the session and
  before any body is read; the session before the body too (no token + bad JSON → 401).
- **REST routes instead of one `POST {action}`**: the router's `unknown_action` /
  "declared twice" rules become Hono's routing (an unknown path is 404 `not_found` after the
  401 check; `constructor`/`hasOwnProperty` are just unknown paths).
- **Errors**: refusals as `fail()`; `CatalogueError` → 503 (`busy` → 409); anything else 500
  `server_error`, logged with the path. The original's 502 `upstream {detail}` is gone (the
  detail went to the browser).
- **Audit**: after the answer, for writes that succeeded (refusals throw before the call);
  `actor` = the session's user. `target` = ids from the path, body and answer (or explicit);
  `summary` = scalar fields masked like a log line, lists counted, customer fields only named
  (`"(changed)"`), plus `→updated`/`→deleted` from the answer. Customer corrections record
  the field names; CRM edits a hash of the key, never the phone. New: sign-ins
  (`session.login`), "sign out everywhere", the Orders CSV export (customer data leaving) and
  job runs are recorded too. Purged at 180 days by the daily `admin-audit` job.
- **Catalogue publish** is conditional on `version` + `editTag`. `editTag` = sha256 over the
  canonical JSON of everything the Catalogue tab edits (code-owned fields and the operational
  keys — per-market `courier`, top-level `courier`/`ledger` — removed). A version moved on by a
  route change (Empower tab, `setRoute` → `publishCatalogue`) keeps the tag, so the publish
  goes ahead; any other change → 409 `stale` with the current `version`/`editTag` (the SPA
  reloads and re-applies). The check is repeated inside `publishCatalogue`'s change function,
  so a write landing between the read and the write is caught too.
- **Stamped by the server** (`prepare`): the stored routes; `freeShip.countries.*.from`
  (stampFreeShip, port); `offer.freeShipAnchor` (stampSetFree, port, v413 renew rule);
  `offer.anchor` and `tiers.anchor` — the rules the original panel applied in the browser
  (harvestOfferIn / harvestTiers) now run on the server, from the STORED anchor (a posted
  anchor is ignored); Reset is `offer.anchorReset` / `tiers.anchorReset`; restarts
  `freeShipReset` / `restart` as the original. Flags never stored. `__publishedVersion`,
  `version` and the retired `offer2` are dropped.
- **Change lines** come from the tracking area's `catalogueChangeLines(stored, next)` (both
  stripped of code-owned fields so a stale `toOmr` in an old row never reads as a change) and
  are written with `recordCatalogueChange`; none for a publish that changed nothing.
- **Validation of the catalogue**: `bad_catalogue` (no market), `bad_country_code`,
  `duplicate_country` (new), `too_large` (> 400 kB), then the zod `CatalogueData` schema:
  ids are slugs (`^[A-Za-z0-9_-]{1,40}$`), `accent`/`tagColor` plain hex, currencies three
  capitals, dial codes digits, prices non-negative numbers — the server-side half of
  test-catalogue-injection (the storefront still escapes everything).
- **Restore defaults** is a publish of the deploy's file through the same door (routes and
  operational keys kept, anchors stamped), and needs `confirm: "defaults"`.
- **Stock Tracker switches** (`PATCH /catalogue/stock`) write only `stockLive`/`stockCap`/
  `stockHide` into the stored row (only ticked boxes kept), like the original
  `settings.patch` did for its keys — a switch never publishes the Catalogue tab's edits.
  They bump the version: a Catalogue tab opened before will get 409 `stale`.
- **Panel settings**: ops `admin_ui` `{ hidden, dismissed }`, written with a row lock
  (`updateOp`). Pages: `orders, payments, catalogue, empower, customers, analytics` (Overview
  never hidden); the original names `pay, products, omniful, crm, stats` are read as those;
  `shipping`, `local`, `sales`, `whatsapp` (dropped features) are dropped.
- **Overview warnings**: `warn:<code>` for every `health.warnings()` code plus the tracking
  area's `pixel_failures:<p>`, `stale:<job>` for late jobs. Dismissible except a missing key
  (`…_missing`), `fake_services_in_production` and `thawani_uat_in_production`.
- **Orders list `since`**: tag = sha1 over the page (rows, total, offset, limit); the same tag
  back → `{ unchanged: true, tag }`. The list is paged (the original read every order for the
  browser to compute KPIs; the Overview's figures now come from `/overview`).
- **Item options** are a new endpoint (`/orders/options`, `domain/admin/options.ts`) instead of
  the orders area's `orderOptions` (which marks sold out by appending " — sold out" to the
  name): every box, the set, add-ons and the duo/trio with the market's price and booleans
  `soldOut`/`active`.
- **Payments `from`/`to`** accept a Muscat day as well as ms.
- **Push all** takes up to 200 ids, sends the first `SWEEP_MAX` (6) and answers `left` =
  untried of those + the rest, so the SPA loops until `left` is empty.
- **Changes clear** needs `confirm: "changes"` (the original asked only in the browser).

## Dropped (and why)

- `settings.patch {courier|ledger}`: both keys belonged to SMSA and the Sales ledger
  (dropped). Operational keys are still preserved on publish if an old row carries them.
- `orders.list {days}` window / `older` count (the list is paged and filtered by day now).
- Actions for dropped features: `smsa.*`, `shipments.*`, `sales.*`, `labels.*`,
  `whatsapp.*` (Cloud API).
- The `admin_audit` "table missing" tolerance (42P01 → `missing: true`) and `needs_migration`
  paths: the schema is ours.
- The admin offline demo (test-admin-demo): no demo mode in the API. If the SPA keeps one, its
  rules (file:/localhost AND a `demo` token in hash/query; fixtures without secrets; an
  answer for every endpoint; >50 coherent orders) are the SPA's — `npm run seed` gives a
  realistic local shop instead.

## Seed

`npm run seed [-- --reset] [-- --now=ISO]` → PGlite at `DATA_DIR` (default `.data/pglite`).
Refuses `DATABASE_URL`; refuses a database with orders unless `--reset`. Deterministic.
Makes: 122 orders over 60 days (OM/AE/SA/QA/KW/BH, cash and card, pending/new/prep/ship/done/
void, collected cash, refunds, cancelled card attempts, flagged, binned), ~94 Empower parcels
(Aramex waybills outside Oman), Kuwait routed `manual` with typed tracking numbers, repeat
customers (30 regulars) with 8 CRM notes, the order history, ~10,000 analytics events
(session_start with source|medium|campaign, the funnel, countries with city/lat/lng, 9
visitors in the last hour), 4 error rows, a catalogue at version 4 with 4 change entries, and
3 audit rows. Checked by running it and reading `/overview`, `/orders`, `/customers`,
`/analytics/summary`, `/analytics/live`, `/payments`, `/empower`, `/analytics/changes`.

## Original suites → tests

| Original | New |
|---|---|
| test-login-lockout | `auth.test.ts` "the lockout" (401, 9th → 429, right password locked, window clears, success clears, 50 parallel ≥ 40 refused, 350 ms) |
| test-v202 (login: nothing more written once locked; body "null") | `auth.test.ts` |
| test-v300 (auth: sameSecret, no password no token, tampered; router: unknown names, no token + bad JSON → 401; `thawani.payments` lookups 0; `settings.save` keeps routes; publicView) | `auth.test.ts`, `panel.test.ts` (lookups 0), `catalogue.test.ts` (routes kept) |
| test-v329 (session tokens; audit trail: who/what/ids/summary, reads and refusals not recorded, no customer field, audit.list) | `auth.test.ts`, `orders.test.ts`, `audit.test.ts` |
| test-v334 (audit names customer fields, never values) | `orders.test.ts`, `audit.test.ts` |
| test-trash (trash/restore/purge, no token 401, empty ids 400) | `orders.test.ts` "the bulk bar" |
| test-v408 §2 (dismissible warnings by code, server-side, missing key not dismissible), §3 (flag, bulk flag, list carries flagged) | `panel.test.ts`, `orders.test.ts` |
| test-v411 §2 (ui.save dismissed codes), §3 stampSetFree | `panel.test.ts`, `catalogue.test.ts` |
| test-v211 (ui.get/ui.save hidden tabs; cap at stock change line) | `panel.test.ts`, `catalogue.test.ts` (stock switches) |
| test-v333 (KPI total / 33 %; changes.clear empties and is audited) | `panel.test.ts` |
| test-free-ship (stampFreeShip all cases; settings.save stamps) | `catalogue.test.ts` |
| test-offer-admin (one-shot window rules, rolling keeps anchor, unrelated edit keeps it, dead window restarted) | `catalogue.test.ts` `stampOffer` |
| original harvestTiers rules (v303) | `catalogue.test.ts` `stampTiers` |
| test-catalogue-merge (settings.save stores the stripped copy; merged view; stored version separately) | `catalogue.test.ts` |
| test-admin-data (change log: non-empty only; routes not storefront changes) | `catalogue.test.ts` |
| test-catalogue-injection (server half: ids slugs, colours hex) | `catalogue.test.ts` "validates" |
| test-extras (admin API gives the editor the market's add-ons) | `orders.test.ts` "options" |
| test-admin-boot (trashed order out of the list and KPIs) | `orders.test.ts`, `panel.test.ts` |
| test-v204 (orders.list since → unchanged) | `orders.test.ts` |
| test-admin-tweaks (Payments refresh does not call Thawani) | `panel.test.ts` |

Not ported: the original's 42P01/`missing` tolerance and `needs_migration` (no tolerant
schema); `admin action declared twice` (no action table); the legacy two-part token (dropped
by design); demo-mode checks (no demo); the 502 `upstream {detail}` answer (replaced by 500
`server_error` without detail). Domain behaviour already tested by the owning areas (status
rules, re-quote rules, refunds, pushes, analytics figures) is exercised here only through the
route wiring.

## For the SPA worker (UI behaviours from the original suites)

- Login: lockout shown as "Too many attempts" on 429 (use `retryAfter`); sign-in error with
  `role="alert"`; the password is never stored; the avatar shows `session.user`; Sign out
  works at once (`POST /logout`). Boot = `GET /session`, then `GET /settings/ui` before
  drawing the Overview warnings (v408).
- Every write: `fetch(…, { credentials: "same-origin", headers: { "X-LM-Admin": "1",
  "Content-Type": "application/json" } })`. 401 → back to the login gate; 409 `stale` on an
  order → refresh the list ("the order changed while you were looking at it").
- Orders: auto refresh every 5 min (paused while hidden, deferred while typing), sending
  `since=<tag>`; 20 rows a page (any filter → page 1, count always shown); accordion rows with
  "Keep open" pins surviving the redraw; the Flagged filter last in the status list; flag on
  each row and in the bulk bar; bulk in chunks of 200 ids; one date-range picker everywhere
  (Muscat days); tracking link: none for Oman, Aramex
  (`https://www.aramex.com/track/results?ShipmentNumber=<awb>`) for an Empower parcel with a
  waybill elsewhere, `target="_blank" rel="noopener"`; manual tracking number + carrier for
  hand-shipped markets; wa.me buttons (confirmation, payment reminder, win-back) built in the
  browser; the item editor treats an add-on id as whole and uses `/orders/options`.
- Overview: "Everything that needs your attention"; KPIs Revenue/Orders/Delivered/Awaiting
  from `/overview`; "N this week · delta"; inline SVG charts (no chart library); dismiss
  sends the shown dismissible codes with `PUT /settings/ui {dismissed}` (never localStorage).
- Catalogue: send back `version` + `editTag` with every publish; on 409 `stale` reload and
  say so; adopt `data` from the publish answer (stamped starts); offer window in hours or
  days (stored hours; unit switch converts the number; default 72); Reset sets
  `offer.anchorReset` / `tiers.anchorReset` / `offer.freeShipReset` /
  `freeShip.countries.XX.restart`; "Restore defaults" warns that it DISCARDS every price and
  fee and sends `confirm: "defaults"`; a "recover from database" button just re-reads; OMR
  rate read-only (`codeOwned`); never publish after a failed load; the bundle editor's inputs
  are read even while its card is folded; unticking every bundle market is refused
  ("tick at least one market"); harvest keeps each scent's `soldOutSizes` by id; new scent
  defaults (`stars 0`, `tag ""`, `tagColor #9c464c`, accent `#b8974f`, rating 0–5 one
  decimal); new add-on `name "New add-on"`, `active false`; the stock grid sets the scent in
  every market (`soldOutSizes`, `soldOut` when out of every size); "why the bundle isn't
  showing" texts (test-offer-admin).
- Stock Tracker: `PATCH /catalogue/stock` for "cap at stock" / "hide at 0" / the counter;
  "read the shelf now" = `GET /stock?fresh=1`.
- Payments: Refresh = `lookups=0` (never calls Thawani), "Ask Thawani now" = no `lookups`;
  date range drives the KPIs; refunds ask for a reason.
- Empower: "Push all" loops `POST /empower/push-many` while `left` is non-empty; the list
  Refresh reads our data only.
- Settings: a dialog listing every page except "Overview (always shown)"; hidden pages'
  nav, shortcuts and hash links fall back to Overview.
- Analytics: the change list with before/after windows ("still counting"); errors export
  `/analytics/errors.csv`; "Clear all N entries" confirms then sends `confirm: "changes"`;
  Reset data sends `confirm: "events"`.
- Contrast ≥ 4.5:1 for small text; accessible names on nav buttons and filters; toasts
  `role="status" aria-live="polite"`.

## Open issues

- The global login ceiling can lock the owner out during a distributed attack (15 min).
- `GET /orders` builds the `since` tag after reading the page (the saving is the transfer,
  not the read — as the original).
- The order list's `OrderListRow` type is declared by hand in `src/shared/admin/api.ts`
  (the SPA cannot import server modules); keep it in step with `order-admin.ts` `listRow`.
- `itemOptions` lists tiers as `duo`/`trio` templates; the editor composes
  `duo:<scent>.<scent>` itself.
