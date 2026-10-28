# Environment variables

Every variable the server reads, by name. **No values here, ever.** In production they live
in Netlify → Site configuration → Environment variables (scope: Functions); a variable added
after the last deploy is seen only after the next one. `tests/unit/env.test.ts` fails if the
code reads a variable this file does not list. "Breaks" says what stops when it is missing.

## Core

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `SERVICES_MODE` | `live` or `fake` (trimmed, any case). **Default: `live`, everywhere.** `fake` (the in-process fake world: no real Thawani, Omniful, Meta, Snap or GA4) only when set explicitly — `npm run dev`, `npm start`, the e2e setup and the test harness set it — and **refused in production**: the server will not start (503 JSON on every request until fixed). Never set it on Netlify. | — |
| `SITE_ID` | Set by Netlify for functions at runtime (do not set it yourself). Its presence means **production**: fake services refused, `META_TEST_EVENT_CODE` never sent, the production health checks on. Production is `SITE_ID` set, or `NODE_ENV=production`, or `CONTEXT=production` — on Netlify that includes deploy previews and branch deploys (functions there see `SITE_ID` too). | — |
| `NODE_ENV` | `production` also means production (see `SITE_ID`). | — |
| `CONTEXT` | Netlify's deploy context (`production`, `deploy-preview`, …). A **build** variable: functions do not reliably see it at runtime, so production is not decided by it alone (see `SITE_ID`). | — |
| `SITE_URL` | Public origin, e.g. `https://lubanmusk.com` (return URLs, own-host attribution). `URL` (set by Netlify) is the fallback. | Falls back to the request's host |
| `DATABASE_URL` | PostgreSQL connection string: Supabase → **Connect** (top of the dashboard) → Transaction pooler, `postgresql://postgres.<ref>:<db password>@aws-…pooler.supabase.com:6543/postgres`. The password is the **database** password (Project settings → Database → Reset database password if unknown), not an API key. TLS is used automatically. On the first start with it set, the server creates schema `store` and copies the original's data (see `LM_AUTO_SETUP`). | Production refuses to start; locally PGlite is used |
| `LM_AUTO_SETUP` | `off` skips the first-run setup at start (migrations, then the copy from the original's `public` tables when `store.orders` is empty). Default on. | — |
| `DATA_DIR` | Local PGlite folder (default `.data/pglite`). Development only. | — |

## Admin

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `ADMIN_USER` | Admin login name | No one can sign in |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the admin password (`npm run admin:hash`) — preferred | — |
| `ADMIN_PASSWORD` | The plain password (development; used only when no hash is set) | No one can sign in when neither is set |
| `SESSION_SECRET` | Signs admin session cookies (≥ 32 random characters). Changing it signs everyone out. When missing or short, a key is derived from the admin password (as the original did) and the Overview shows a warning — set a real one. | Falls back to a key from the admin password |

## Card payments (Thawani)

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `THAWANI_MODE` | `live` or `uat` (default `uat`; trimmed, any case — `"live "` is `live`). **Must be `live` in production.** | Health warns `thawani_uat_in_production` |
| `THAWANI_SECRET_KEY` | Checkout API key (server only) | Card checkout answers 503 `gateway_not_configured`; cash orders unaffected |
| `THAWANI_PUBLISHABLE_KEY` | Pay-page key (public by design) | As above |
| `THAWANI_WEBHOOK_SECRET` | HMAC key for `/api/pay/webhook` | Every webhook delivery is refused (401); orders still settle on the shopper's return |

## Fulfilment (Empower / Omniful)

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `OMNIFUL_API_TOKEN` | Long-lived API token — **or** the three below | Push, poll, SKU match and the shelf reading answer `omniful_not_configured` |
| `OMNIFUL_REFRESH_TOKEN`, `OMNIFUL_CLIENT_ID`, `OMNIFUL_CLIENT_SECRET` | Token renewal set (alternative to the API token) | As above |
| `OMNIFUL_HUB_CODE` | Warehouse code orders are sent to | A push fails with "No warehouse is set" |
| `OMNIFUL_HOOK_SECRET` | The `?k=` key on `/api/omniful/hook` | The hook is closed (404); the poll still moves statuses |
| `OMNIFUL_ENV` | `staging` or `production` (default) | — |
| `OMNIFUL_BASE` | Base URL override | — |

## Tracking

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `META_PIXEL_ID` | Meta pixel id (public) | Server-side Meta events skipped |
| `META_CAPI_TOKEN` | Conversions API token | Server-side Meta events skipped |
| `META_TEST_EVENT_CODE` | Events Manager test code. **Never sent in production** (`SITE_ID`, `NODE_ENV=production` or `CONTEXT=production`), so on Netlify it has no effect at all — it is for local runs against a real pixel. | — |
| `SNAP_PIXEL_ID` | Snap pixel id (public) | Server-side Snap events skipped |
| `SNAP_CAPI_TOKEN` | Snap Conversions API token | Server-side Snap events skipped |
| `GA4_MEASUREMENT_ID` | `G-…` id; loads gtag on the page when set | GA4 off |
| `GA4_API_SECRET` | Measurement Protocol secret; the server then reports the purchase | The page reports the purchase itself |

## Build (read by `npm run build`, not by the server)

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `META_PIXEL_ID` / `SNAP_PIXEL_ID` | Also written into the pages' inline pixel snippets at build (validated: digits / uuid), so the browser pixel and the server relay report to the same dataset | The original store's ids are used |
| `LM_BUILD_ID` | The page's `<meta name="build">` | `COMMIT_REF` (set by Netlify), else the git commit, else `local` |
| `COMMIT_REF` | Set by Netlify: the deploy's commit, used as the build id | see above |

## Tests (read by Vitest, not by the server)

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `LM_TEST_PG_URL` | A scratch PostgreSQL the `pg` project (`npm run test:pg`) may create and drop databases on, e.g. `postgres://postgres@127.0.0.1:5432/postgres`. Never a real database. | The `pg` project is skipped |
