# Working on this repository

Luban & Musk: a single-product Arabic/English frankincense store (six Gulf markets). This
repository is a full rebuild of the original `luban-musk` store. The storefront looks and
behaves exactly like the original; everything behind it was redesigned.

Read `docs/ARCHITECTURE.md` (what lives where) and `docs/DECISIONS.md` (why) first.

## Stack

- **TypeScript everywhere**, `strict`. One package, Node ≥ 22, npm.
- **Server:** [Hono](https://hono.dev) app (`src/server/app.ts`), run by Netlify Functions in
  production (`netlify/functions/*.mts`) and by Node locally/in e2e (`src/server/node.ts`).
- **Database:** PostgreSQL via Drizzle ORM (`src/server/db/schema.ts`). Supabase in
  production; **PGlite** (Postgres in WASM, in-process) for local dev and tests.
- **Storefront:** the original HTML/CSS, with the page scripts ported to typed ES modules
  (`src/web`), bundled by Vite. English pages are generated from the Arabic ones at build.
- **Admin:** Preact single-page app (`src/admin`), bundled by Vite.
- **Shared logic** (`src/shared`): pricing, offers, catalogue merge, money, phone rules,
  status flow, UTM attribution, KPI definitions — imported by the server, the storefront
  and the admin, so the page, the till and the panel cannot disagree.
- **Tests:** Vitest projects `unit`, `server`, `web` (happy-dom), `e2e` (Playwright against
  the built site + Node server), `parity` (compares answers with the original store when it
  sits beside this repo).

## Commands

```
npm run dev          site + API on http://localhost:8888 (fake services, PGlite in .data/)
npm run build        dist/ (storefront, English pages, admin)
npm test             every suite
npm run test:pg      the server suite again on a real PostgreSQL (needs LM_TEST_PG_URL; skipped without)
npm run typecheck    tsc over server, web, admin and tests
npm run check        typecheck + test + build
npm run db:generate  regenerate db/migrations from schema.ts
npm run db:migrate   apply migrations to DATABASE_URL (run by hand, never by a deploy)
```

## Rules

1. **No secrets in the repo.** Every variable is named in `.env.example` and `docs/ENV.md`
   with no value. Test fixtures use invented values.
2. **No live services in tests or dev.** Outside services (Thawani, Omniful, Meta, Snap,
   GA4) are reached only through `deps.fetch`; in tests and `SERVICES_MODE=fake` that is the
   in-process fake world (`src/server/services/fakes`). The real clients run unchanged; only
   the network is emulated.
3. **The clock is `deps.now()`** on the server (never `Date.now()`/`new Date()` without an
   argument in domain code). Shared functions take `now` as a parameter.
4. **Money** goes through `src/shared/money.ts` (`r3`, `toBaisa`). Prices are decided only by
   `src/shared/pricing/price.ts` from the catalogue; nothing about money is read from a request.
5. **Errors a caller should see** are thrown as `fail(code, status, extra)` and answered as
   `{ ok: false, error: code, ...extra }`. Anything else is a 500 `server_error` with the
   detail in the `logs` table only.
6. **Status writes are conditional** (`UPDATE … WHERE status = <the status read>`) through
   `moveOrder` in `src/server/domain/orders.ts`, and recorded in `order_events`.
7. **Public JSON shapes** used by the storefront (`/api/settings`, `/api/order`,
   `/api/pay/*`, `/api/stock`, `/api/track`, `/api/geo`, `/api/beacon`) match the original
   store's, because the storefront scripts are ports of the original ones.
8. **Schema changes:** edit `src/server/db/schema.ts`, then `npm run db:generate`.
9. Every behaviour gets a test. Tests ported from the original name the original suite in
   a comment (`// from test-v314.js`).
