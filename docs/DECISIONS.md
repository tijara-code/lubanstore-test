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

## Storefront

- **The original HTML and CSS, the page scripts ported module by module.** Every page script
  (store, main, cart, header, checkout, pixel, stats) was ported line for line into typed ES
  modules (`src/web/*`), keeping the same `LM` API, DOM, events, storage keys and request
  bodies. Proof is in `tests/parity/*.browser.parity.test.ts`, which drive the same journeys
  on the original and the new site in a real browser and compare the DOM, the screenshots,
  the requests and the stored orders at every step.
- **Rules shared, not copied.** Offer windows, free delivery, availability, the phone table and
  UTM attribution now come from `src/shared`; the browser's own extra conditions (e.g. a set
  is shown only when it has a price) are kept where the original had them.
- **Self-hosted fonts** (the same Google Fonts files and unicode ranges): two third-party
  origins leave the critical path, and the rendering is identical.
- **Content-hashed bundles** replace `?v=N` on code: a new deploy is a new URL, so a cached
  page can never meet an older script (the original's v401 iPhone crash). Images and clips
  keep a `?v=` filled in from a hash of the files.
- **The delivery band's width is measured with the real font.** The original measured the
  running text before its Arabic font had arrived from Google, so its loop was 28–33 px too
  long and jumped once per cycle; with the font self-hosted and preloaded the measurement is
  the true width. Visible only as the band's loop length.
- **Page-view relays always let the server take the market from the edge** when the catalogue
  has not answered yet (the original sometimes had it, sometimes not, depending on timing).
- **Pixel ids** are injected at build from `META_PIXEL_ID` / `SNAP_PIXEL_ID`, defaulting to the
  shop's current (public) ids, so the page and the server relay use the same values.

## Server

Per-area detail (every decision, with the original behaviour it replaces): `docs/notes/orders.md`,
`payments.md`, `empower.md`, `tracking.md`, `admin-api.md`, `review-fixes.md`.

- **Every status, payment and fulfilment change is recorded** in `order_events` (who, when,
  from → to), and every write is conditional on what was read, inside a transaction with a
  row lock where money is involved (settling a card payment, the cash switch, the expiry).
- **The stock gate and the order insert are one locked step**, with the shelf read *before*
  the lock (never a network call while holding it). The original could sell the last capped
  box twice (check, then write).
- **Admin sessions are HttpOnly, SameSite=Strict cookies** (no token in browser storage),
  signed with `SESSION_SECRET` and the password's fingerprint; every non-GET request needs
  `X-LM-Admin: 1` and a same-origin check; the password can be stored as a scrypt hash
  (`npm run admin:hash`). Lockout per address and overall. Every admin write is audited.
- **REST routes with zod validation** replace the single `POST /api/admin {action}` router.
- **Rate limits are in the database** (serverless instances share no memory) and cover every
  public write: order, card session, verify, resume, track, the analytics collectors, the
  pixel relays, admin sign-in.
- **Analytics are added up in SQL** over raw events plus hourly roll-ups (kept for good), so
  "All" reaches the first visit with no read caps.
- **Tables live in the Postgres schema `store`**, not `public`: the original's tables stay
  untouched during the move, and Supabase's auto-generated public API cannot reach them.
- **Production can never run on the fake services**: they must be asked for explicitly and are
  refused on Netlify or with NODE_ENV=production.
- **Inherited defects fixed** (found by an independent review, each with a reproduction): the
  stock cap could be bypassed by posting another open order's id; a customer's reminder link
  could revive an order the shop had cancelled; a cash switch racing the card webhook could
  record a card payment as cash; a late "payment succeeded" could clear a refund.

## Admin panel

Per-tab detail: `docs/notes/admin-ui.md`, `admin-catalogue-empower.md`, `admin-insights.md`.

- **Preact, rebuilt from scratch, with the original's look and information architecture**
  (the owner uses it daily): Overview, Orders, Payments, Catalogue, Empower, Customers,
  Analytics, plus panel settings. Dropped with their features: Shipping (SMSA), Local labels,
  Sales (ledger), WhatsApp (Cloud API).
- **Catalogue publishing is conditional**: it carries the version it loaded and refuses
  (409, with a reload offer) if someone else published meanwhile; stock switches and market
  routes save on their own, never publishing half-made edits.
- **Analytics follows the original's latest layout** (v446 removed the Funnel and "Orders by
  source" cards at the owner's request; the server still computes both).
- **No demo mode**: `npm run seed` builds a realistic invented shop for local use.

## Steps for the owner (by hand, in this order)

Nothing here was done for you: no deploy, no database change, no live service was used.

1. **Put the code on GitHub.** `luban-new` is a git repository with its own history (no
   remote). Push it to a new repository, or a new branch of `luban-store`.
2. **Create the new tables** in the same Supabase project. Supabase → Project settings →
   Database → connection string, **transaction pooler** (port 6543). On your computer:
   `DATABASE_URL="<that string>" npm run db:migrate`. This adds a schema `store`; the original
   store's tables in `public` are not touched.
3. **Copy the data.** Supabase → SQL editor → paste `db/import-from-v1.sql` → Run. Read the
   counts it prints (orders, Empower parcels, events, notes). Safe to run again.
4. **Netlify**: point a site (a new one first, or a deploy preview of the existing one) at the
   new repository. Build settings come from `netlify.toml`. Environment variables (scope:
   Functions; names and meanings in `docs/ENV.md`):
   - new: `DATABASE_URL` (step 2), `SITE_URL=https://lubanmusk.com`, `SESSION_SECRET` (≥ 32
     random characters), `ADMIN_PASSWORD_HASH` (`npm run admin:hash`, then paste) — or keep
     `ADMIN_PASSWORD`;
   - unchanged names: `ADMIN_USER`, `THAWANI_MODE` (`live` in production), `THAWANI_SECRET_KEY`,
     `THAWANI_PUBLISHABLE_KEY`, `THAWANI_WEBHOOK_SECRET`, the `OMNIFUL_*` set,
     `META_PIXEL_ID`, `META_CAPI_TOKEN`, `SNAP_PIXEL_ID`, `SNAP_CAPI_TOKEN`,
     `GA4_MEASUREMENT_ID`, `GA4_API_SECRET`;
   - no longer read (remove after the switch): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
     `SMSA_*`, `WA_*`.
   - The original README listed secrets that were exposed and had to be rotated
     (`SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD`, `META_CAPI_TOKEN`, `SMSA_API_KEY`). If any was
     not rotated yet, do it now — the new store uses a database connection string instead of
     the service key; rotate the database password if the old key leaked with it.
5. **Try it on the preview** with `THAWANI_MODE=uat`: place a cash order and a card order (test
   card 4242 4242 4242 4242, OTP 1234), open them in `/admin/`, check `/api/health`.
6. **Webhooks**: Thawani's portal can keep its current URL
   (`/.netlify/functions/thawani-webhook` is still answered) or move to `/api/pay/webhook`.
   Omniful's hook stays `/api/omniful/hook?k=<OMNIFUL_HOOK_SECRET>`.
7. **Switch over**: in the ORIGINAL admin turn Empower auto push **off**; run
   `db/import-from-v1.sql` once more (it copies orders placed since step 3); publish the new
   site to production with `THAWANI_MODE=live`; in the NEW admin turn Empower auto push **on**
   (the import leaves it off so the two stores never push the same order twice).
8. **On your computer, once**: `npx playwright install chromium` (for the end-to-end tests).

Rollback: redeploy the original site. Its tables were never changed; orders placed on the new
store in between are in `store.orders` (copy them back by hand if needed).

## Open questions for the owner

- The product page promises "15 يومًا ضمان استرداد الأموال" and "تعديل أو إلغاء خلال 24
  ساعة", while the privacy page allows refunds only for non-delivery within 7 days; the
  privacy page also says customer data is used only for delivery, while hashed details go to
  Meta and Snap. Kept exactly as they were; a copy/legal decision.
- WhatsApp order confirmations through the Cloud API were dropped (see Scope). They can be
  added back as one module if wanted.
- Empower auto push runs every minute (as before): about 43,000 function calls a month. Every
  2–5 minutes would cut that if the Netlify plan's limit matters.

## Speed (measured)

Both stores built and served the same way — HTTP/2 + TLS + brotli in front of each (as
Netlify's CDN serves them), a 390 px phone, slow 4G (1.6 Mbit/s, 150 ms) and 4× CPU
throttling, third-party pixels blocked on both, median of 9 cold loads, averaged over 3
rounds (`/home/claude/tools/perf.js` in the build session; ms unless noted):

| Page | First paint | Largest paint | DOM ready | Prices on screen | Fully loaded | Bytes |
|---|---|---|---|---|---|---|
| Arabic product page | 948 → **913** | 1117 → **1108** | 1227 → **1152** | 1435 → 1476 | 4618 → 4851 | 773 → **757 KB** |
| Checkout | 704 → 741 | 783 → 813 | 970 → **959** | 734 → 764 | 2890 → **967** | 435 → **425 KB** |
| English product page | 881 → **840** | 980 → 1013 | 1144 → **1138** | 1265 → 1336 | 1359 → 1574 | 273 → **266 KB** |

What changed for speed: self-hosted fonts loading after the page scripts (two third-party
origins gone, and the fonts no longer take the slow line from the scripts), no font preloads
competing with the stylesheet, the page scripts at low priority (as the original's `defer`),
content-hashed immutable bundles (no revalidation round trips), 17% less JavaScript on the
product page (35 KB vs 42 KB brotli).

Where it is still slower: the prices appear 30–70 ms later (3–5%). The original's store.js
was a classic deferred script and settled the catalogue while the page scripts were still
arriving; an ES module graph runs only once all of its modules are in. Two ways to close it
were measured and rejected: a separate early entry for the core (the extra request cost more
than it saved), and font preloads (they delayed the first paint by ~0.5 s). The page "fully
loaded" moment is later on the product pages only because the decorative fonts now start
after the scripts; the checkout is fully loaded three times sooner.
