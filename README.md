# LUBAN & MUSK — lubanmusk.com

Single-product Arabic/English store for perfumed Dhofari frankincense, six Gulf markets.
This is the rebuild of the original `luban-musk` store. The storefront looks and behaves
exactly as before; the server, database, admin panel, tracking and tests are new.

- **Storefront** — `/`, `/checkout.html`, `/privacy.html`, `/en/…` (English generated at build).
- **Admin** — `/admin/` (Overview, Orders, Payments, Catalogue, Empower, Customers, Analytics).
- **API** — `/api/*`, `/invoice/<id>`, `/resume/<id>` (one Netlify function, a Hono app).
- **Jobs** — card attempts expire (hourly), Empower auto push (every minute) and status poll
  (:07, :37), analytics roll-up (hourly), maintenance (hourly), retention (daily), audit trim.

Read `AGENTS.md` (rules), `docs/ARCHITECTURE.md` (what lives where), `docs/DECISIONS.md` (why),
`docs/ENV.md` (every environment variable), `docs/notes/*` (each area in detail).

## Run it locally

```
npm install
npm run seed      # optional: an invented shop in .data/ (orders, customers, analytics)
npm run dev       # http://localhost:8888 — store, admin, API; fake Thawani/Omniful/pixels
```

Nothing reaches a real service in development: Thawani, Omniful, Meta, Snap and GA4 are
emulated in-process (a card payment goes to a local fake payment page). The database is
PGlite (PostgreSQL in WASM) in `.data/`. Admin sign-in locally: `admin` / `luban-local-dev`
(printed by `npm run dev`), unless `.env` names its own (`ADMIN_USER`, `ADMIN_PASSWORD`,
`SESSION_SECRET` — see `.env.example`).

## Check it

```
npm run check     # typecheck + every test + build
npm test          # unit, server, storefront (happy-dom), end-to-end (Playwright), parity
npm run test:pg   # the server suite on a real PostgreSQL (LM_TEST_PG_URL=postgres://…)
```

The `parity` suites compare the new store with the original (`../luban-musk`) when it sits
beside this folder: prices for thousands of random baskets, every `LM` member of the
storefront core, and real-browser journeys (DOM, screenshots, requests, stored orders). They
skip themselves when the original is not there. Playwright needs a Chromium:
`npx playwright install chromium` once per machine.

## Going live (by hand)

See the final section of `docs/DECISIONS.md` ("Steps for the owner") for the ordered list:
database migration and data import in Supabase, the Netlify environment variables, the
webhook URLs, and the switch-over.
