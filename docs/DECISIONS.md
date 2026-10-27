# Decisions

The rebuild's choices, newest last within each section, with the reason for each. The
original store is `../luban-musk` (read-only reference, never modified).

## Scope

- **Kept:** Thawani card payments and cash on delivery (session, verify, webhook, reminder
  links, invoice, refunds, expiry); orders, status flow and stock; pricing and every offer
  (the three-scent set, the large-box duo/trio offers, free-delivery offers, the set ships
  free, COD fee, per-market availability); the admin panel; CRM; KPIs and analytics; Meta,
  Snap and GA4 tracking (pixel + server copies, dedup ids, hashing); UTM attribution.
- **Kept, by the owner's instruction during the build ("empower main shipment"):** Empower
  (Omniful) as the main fulfilment route — push, auto push, status poll, webhook, SKU map,
  take-off and re-send ids, and the shelf reading that feeds the stock tracker and caps.
- **Dropped, as instructed:** SMSA, the Oman local-courier labels, and every other courier
  integration. Orders that do not go through Empower move through the status flow by hand,
  with a manual tracking number (and carrier name) in the admin.

## Stack

- **TypeScript, strict, everywhere.** The original was JavaScript with JSDoc types checked
  after the fact; here types are the source.
- **One Hono app** for every endpoint instead of 25 Netlify functions. Hono runs unchanged on
  Netlify Functions (production) and Node (local, e2e), so the end-to-end tests exercise the
  production code path.
- **PostgreSQL through Drizzle ORM with a real driver** instead of PostgREST over fetch. This
  gives transactions and row locks, which replace the original's read-then-conditional-PATCH
  workarounds (stock reservation race, catalogue publish race, changelog race), and typed
  queries checked against the schema.
- **PGlite for tests and local development:** the same Postgres, in-process. Tests run against
  the real schema and real SQL instead of a hand-written PostgREST emulator.
- **One fake world for outside services**, emulating Thawani, Omniful, Meta, Snap and GA4 behind
  `fetch`. The real clients run in tests; only the network is fake. Local development uses the
  same fakes, so a full card payment can be clicked through without Thawani.
- **Shared modules** (`src/shared`) for every rule both the page and the till apply (pricing,
  offer windows, free delivery, availability, phone rules, attribution). The original kept two
  copies of each and ran suites to prove they agreed; one copy cannot drift.

## Verification so far

- Pricing: `tests/parity/pricing.parity.test.ts` prices 4,000 random baskets over random
  catalogue variants with both the original `price.js` and the new engine — identical answers,
  refusals included.

## Rulings where the original's own suites disagreed

The original's 162 suites were inventoried (7,076 checks). Where an older suite and a newer
one disagree, the newer behaviour is built. Rulings that needed a choice because the
deciding rule belonged to a dropped feature:

- **Market routing default:** a market with no route goes to **Empower**. The only other
  route is "manual" (shipped by hand, tracking number typed in the admin). The original
  defaulted to the dropped couriers (Oman → local courier, others → SMSA); the live shop had
  every market on Empower.
- **Large-box offers (duo/trio):** kept, with admin controls (prices per market, window,
  renew, markets). The original's last admin save forced them off when their card was
  removed; that is not copied — the published catalogue decides.
- **Sales-ledger cancel/restore:** dropped with the ledger. An admin can still move a
  cancelled order back through the status flow (void → new/prep/ship/done), recorded in the
  order's history; the "sales" actor no longer exists.
- **WhatsApp Cloud API order confirmations:** dropped (a messaging integration, on neither
  the keep list nor needed by a kept feature). The admin keeps the wa.me message buttons
  (confirmation, payment reminder, win-back), which need no API.
- **"15-day refund guarantee" on the product page vs the privacy page's narrower refund
  policy:** the storefront is copied exactly, so both stay as they are. Flagged to the owner
  as a copy/legal question.
