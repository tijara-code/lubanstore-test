# Environment variables

Every variable the server reads, by name. **No values here, ever.** In production they live
in Netlify → Site configuration → Environment variables (scope: Functions); a variable added
after the last deploy is seen only after the next one. `tests/unit/env.test.ts` fails if the
code reads a variable this file does not list. "Breaks" says what stops when it is missing.

## Core

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `SERVICES_MODE` | `live` or `fake`. Default: `live` in production, `fake` elsewhere. `fake` is refused in production. | — |
| `CONTEXT` | Set by Netlify (`production`, `deploy-preview`, …). | — |
| `SITE_URL` | Public origin, e.g. `https://lubanmusk.com` (return URLs, own-host attribution). `URL` (set by Netlify) is the fallback. | Falls back to the request's host |
| `DATABASE_URL` | PostgreSQL connection string (Supabase → Project settings → Database → Connection string, **transaction pooler**, port 6543). | Production refuses to start; locally PGlite is used |
| `DATA_DIR` | Local PGlite folder (default `.data/pglite`). Development only. | — |

## Admin

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `ADMIN_USER` | Admin login name | No one can sign in |
| `ADMIN_PASSWORD_HASH` | scrypt hash of the admin password (`npm run admin:hash`) — preferred | — |
| `ADMIN_PASSWORD` | The plain password (development; used only when no hash is set) | No one can sign in when neither is set |
| `SESSION_SECRET` | Signs admin session cookies (≥ 32 random characters). Changing it signs everyone out. | No one can sign in |

## Card payments (Thawani)

| Variable | Purpose | Breaks when missing |
|---|---|---|
| `THAWANI_MODE` | `live` or `uat` (default `uat`). **Must be `live` in production.** | Health warns `thawani_uat_in_production` |
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
| `META_TEST_EVENT_CODE` | Events Manager test code; ignored in production | — |
| `SNAP_PIXEL_ID` | Snap pixel id (public) | Server-side Snap events skipped |
| `SNAP_CAPI_TOKEN` | Snap Conversions API token | Server-side Snap events skipped |
| `GA4_MEASUREMENT_ID` | `G-…` id; loads gtag on the page when set | GA4 off |
| `GA4_API_SECRET` | Measurement Protocol secret; the server then reports the purchase | The page reports the purchase itself |
