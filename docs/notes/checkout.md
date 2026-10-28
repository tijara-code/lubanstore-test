# checkout — notes (checkout, cart drawer, header)

The ports of the original `assets/js/checkout.js`, `cart.js` and `header.js` to typed ES
modules, imported from the page entries in the original script order.

## Files

| Path | What |
|---|---|
| `src/web/header/index.ts` | header.js: the delivery band (running text, pace, copies, progress), `window.lmShip(preview)`, the checkout's free-delivery bar (`paintFree`), the one-tap suggestion (`RANK` oud→amber→lemon, `boxFor` small→large, the packshot + chip art, the duo/trio step `upgradeOf`), the add-ons and sampler shelves, the language switch, the scrolled `.alt` header |
| `src/web/cart/index.ts` | cart.js: the drawer (lines, steppers capped at 20 and at `LM.lineRoom`, off lines with `LM.offWords`, the total), focus trap / Escape / focus return, bfcache, the "not available in your country" dialog, `window.lmCart = { open, close, refresh, warn }`, the `lm:cart` event |
| `src/web/checkout/index.ts` | checkout.js: summary, totals, the form, phone rules, cities, ways to pay, cash order + parked queue, Netlify Forms copy, card session → gateway, the return from Thawani, done screen, stock_short fix, every refusal's words, bfcache, the minute repaint |
| `src/web/checkout/phone.ts` | the phone hints, `PHONE` (`{hint, len}` with `len` = `MOBILE_LEN`), `FIRST` = `MOBILE_FIRST` (src/shared/orders/phone.ts — identical tables), `phoneDigits`, `leadBad`, the name/phone input filters |
| `src/web/checkout/contracts.ts` | the window contracts between the page scripts, typed: `lmShip`, `lmOnCartChange`, `lmCart`, `LMPX`, `LMEV`, `LMLanding`; `KEY`, `writeCart`, `TRASH`, `domReady` |
| `src/web/entries/home.ts`, `checkout.ts` | my import lines: `header`, `cart` (both pages, after stats/pixel, as the originals' `<script>` order), `checkout` last on the checkout |
| `tests/web/checkout/{summary,suggest,form,orders,return}.test.ts`, `_page.ts` | happy-dom suites; `_page.ts` boots the real page body (site/*.html), the head's co-hold script, the core and the page modules |
| `tests/web/cart/drawer.test.ts`, `tests/web/header/band.test.ts` | drawer/dialog and band/header suites |
| `tests/parity/checkout.browser.parity.test.ts` | Playwright parity journeys (original vs new) |
| `tests/parity/checkout-ref-server.cjs` | wraps `/home/claude/tools/ref-server.js`, adding `/__ref/pay?ref=` (`__W.pay`), `/__ref/orders`, `/__ref/reset` |

## Decisions

- **Same contracts, same timing.** The original globals and events are kept exactly
  (`window.lmShip`, `lmOnCartChange`, `lmCart`, `lm:cart`, `lm:country`, `lm:stock`,
  `LMPX.*`, `LMEV.track`). header/cart still start on `Promise.all([dom, LM.ready])` and the
  checkout on `LM.ready.then`, so the order of the first paint is the original's (the
  checkout's `totals()` runs first and calls `lmShip(0)`, then the header's and the cart's init).
  The globals are read through `G()` at call time, never captured.
- **Helpers replaced by the core's** (identical semantics): `esc`, `L`, `txt`, `readCart`; the
  `window.LM && LM.x ?` guards dropped (the core is imported, every member exists). Guards on
  `LM.c` (null before ready) kept.
- **Phone tables** from `src/shared/orders/phone.ts` (lengths and first digits identical to the
  original PHONE/FIRST, asserted in `form.test.ts`); only the hints stay local.
- **Cities**: `window.LM_CITIES || LM_CITIES` (imported) — the entry assigns `window.LM_CITIES`
  after its imports run, so the module imports the same data directly.
- **The Netlify Forms backup is kept exactly** (form-urlencoded POST to `/`, same fields, the
  hidden form in checkout.html). On the Node server a POST to `/` answers the home page (200),
  as the reference server does; on Netlify the form is detected at deploy as before.

## Deliberate differences

1. **`start()` returns when the document has no `#co`/`#form`** (and `#year` is guarded): the
   checkout module imported into another document (the core's i18n test imports the entry)
   no longer throws. On the checkout page itself nothing changes (the original threw only where
   the markup was missing).
2. No other behaviour change. The original's `try`/`catch` around every storage call is kept
   (device-fit).

## Changes outside my folders

- `scripts/compare-screens.ts`: both browser contexts send `x-country: OM`. ref-server.js
  answers every request as from Oman; the new server had no edge country locally, so the two
  sides opened different markets (AE vs OM) and the band differed. Same edge on both sides now.

## Verification

### Unit/DOM (happy-dom): `npx vitest run --project web` — all 31 files / 459 tests pass (mine: 7 files, 142 tests)

### Parity in a browser (`npx vitest run --project parity tests/parity/checkout.browser.parity.test.ts`)

Original (`checkout-ref-server.cjs` on :4102, the real handlers over `_world.js`) vs new (built
into `dist-checkout`, `startServer` in fake mode with in-memory PGlite on :8892). Frozen clock
(`page.clock.setFixedTime(2026-10-01 09:00 +04)`, timers running), seeded `Math.random`, all
hosts but localhost and Google fonts blocked (the original's Thawani host answered by a stand-in
page), `x-country: OM`, reduced motion. Each journey publishes `data/catalogue.json` (or a
variant) on both sides first. After every step: normalised DOM equal, and full-page (or element)
screenshot pixel diff ≤ 0.05 %.

**Result: 52/52 journeys, every step DOM-equal; pixel differences 0 except anti-aliasing
noise (0.0014 % on one checkout step).** One flake seen once in the last full run: the header
clip at 1366 px in English differed by 0.050 % on the logo's glyph edges (static markup, the
Cormorant face from Google on the original vs the self-hosted copy) and passed on the rerun.
Report: `.tmp/parity-checkout/report.json`.

Journeys:
- add on the product page (stepper + `#add`) → drawer → pay → checkout (ar/en × 390/1366);
- the drawer with a seeded basket: open, focus, Shift+Tab/Tab wrap, +, −, bin, Escape, pay → checkout (ar/en × 390/1366);
- the summary/bar/suggestion/add-ons, the suggestion tap, an add-on tap, cash ↔ card, the bin,
  at 390 and 1366, ar and en, under 14 catalogue variants: om-short, om-free, om-set, om-samples,
  ae-mixed, sa-trio-off (an off line), kw-cod-off, om-offer-off, om-freeship-deal (free delivery
  at 0), ae-freeship-lower, om-tiers-on (duo→trio step), ae-tiers-on-large (large→duo step),
  qa-tiers-off;
- the form: empty submit (focus), typing filters, a pasted +971, a wrong first digit, a good
  number, OM→AE→KW country changes, AE short number, bad e-mail;
- cash orders end to end OM (ar), AE (ar, trunk 0), AE (en): page totals, the POST body (all
  fields but the dedupe uuid and the pixel module's `snap`/`ref`), the till's answer (status, id,
  omr), the stored order (id, status, payment_status, pay, name, phone, country_code, city,
  region, cur, total, omr, ship, items), the done screen — all equal;
- card: POST body and answer equal, to the gateway (original: the stand-in page + `__W.pay`;
  new: `/__fake/thawani/pay/<sid>` → Pay), back `?paid=` → verify → done screen, stored order
  (paid) equal, `lm_pending` gone (ar and en); cancelled with the basket kept, and
  `?cancelled=` in a tab with no basket;
- the verify answers (routed): unsure (4 tries, then "do not pay again"), unsure without a
  basket, not paid (with/without basket), amount mismatch, settled, unknown order — screens and
  the number of verify calls equal;
- parked: `/api/order` aborted → "استلمنا طلبك وسنؤكده قريبًا", one order queued, the next page
  load posts it (200), queue emptied, the order stored — equal;
- refusals: stock_short (left 1 and 0: message, mark, fix button, basket after the fix, the
  shelf re-read) routed; cod_not_offered and offer_closed produced by the real tills (catalogue
  changed after the page loaded) — status, body, screen, no queue;
- the country dialog (KW with amber sold out): marked line, submit → dialog, drop → summary.

`stock_short` is answered by a routed 409 on both sides rather than by a real shelf: the
till's gate needs Omniful configured with SKU maps on both servers; the till's own behaviour is
the orders/stock workers' (their suites). The page's handling is what is compared.

**The band's `--ship-w` (the lead's question): the cause is when the web font arrives, not
the port.** `run()` measures the first copy once, when the message is first written (both
versions). Measured at 390/1366 px for OM/AE/QA: the original records 28–33 px MORE than the
copy's real width once fonts are loaded (OM 390: −494.36 px recorded, 466.19 px real); the new
site records the real width (−466.19 px). Proof both ways, same browser: (1) on the original,
re-running `lmShip(0)` after `document.fonts.ready` (data-run cleared) records −466.19 px — the
new site's figure; (2) on the new site, holding the woff2 files back 2.5 s records −494.36 px —
the original's figure, to the 1/64 px. The original measures the fallback face because its
IBM Plex Sans Arabic comes from Google (CSS, then the files) after the catalogue; the new pages
self-host it and preload the 400 Arabic subset (core worker's change), so it is there when the
band is first written. The number of copies follows from w (`ceil(max(innerWidth,
screen.width)/w) + 1`, capped at 10), so a different w can mean one copy fewer near a boundary.
Left as is on purpose: copying the original here would mean measuring a face the page no longer
shows, and its loop then jumps by those 28 px each cycle on a first visit. (The original records
the real width too whenever its font is already there.)

Normalised in the DOM comparison (with reason): comments and whitespace runs; `?v=` values
and hashed bundle names; the band's `--ship-w`/`animation-duration` and its number of copies —
`run()` measures the text once, when first written, so the value depends on whether the web
font had arrived (the original's race too; the new site self-hosts and preloads the font, the
original loads Google's). Screenshots are taken with animations disabled. Form steps are snapped
2 s after a refused submit (the button's red shake is a 1.6 s timer).

### compare-screens (`node --import tsx scripts/compare-screens.ts --js --pages /checkout.html,/en/checkout.html`)

| page | before (core only, from the core notes) | after |
|---|---|---|
| /checkout.html 320/390/768/1366 | 0.04–0.16 % (band, basket count) | 0.000 % all four |
| /en/checkout.html 320/390/768/1366 | same | 0.000 % all four |

(The tool opens an empty basket; the scripted states with a basket are the parity journeys above.)

## Original suites → new tests

| Original | New | Notes |
|---|---|---|
| test-checkout-summary.js | `summary.test.ts` (two prices, column, bar, no-threshold), `form.test.ts` (markup) | source-text checks ("no free-delivery arithmetic in checkout.js", "threshold read once") became behaviour: lmShip(0) called, freeOver read once per paint; CSS → parity screenshots |
| test-suggest-scent.js | `suggest.test.ts` | every ranking/box/picture/tap/rows case |
| test-extras.js (page) | `suggest.test.ts` (shelf, sampler, delegated taps), `summary.test.ts` (add-on thumbs), `orders.test.ts` (burner line itemId/price in the POST) | till/panel/merge parts are others' |
| test-samples-free.js (page) | `summary.test.ts` | |
| test-free-ship.js (page side) | `summary.test.ts` (freeDeal at 0), `band.test.ts` | product-page bar is main.js's |
| test-cod-refusal.js (page) | `summary.test.ts` (button follows the market), `orders.test.ts` (refusal not a sale, network/502 parked, pixels/Forms wait) | |
| test-phone-plan.js | `form.test.ts` | |
| test-cart-availability.js (cart/checkout) | `drawer.test.ts` (KW fixture, dialog, drop, warn before submit), `summary.test.ts` (sum-off) | |
| test-cart-thumbs.js (page) | `summary.test.ts`, `drawer.test.ts` (packshot + chip; add-on art) | LM.img/scentMark are the core's |
| test-dirham.js (checkout/cart) | `summary.test.ts` (#hlLocal mark only in Oman, text elsewhere, hostile code), `drawer.test.ts` (.ci-price, #drawerTotal) | CSS masks: screenshots |
| test-fx.js (page) | `orders.test.ts` (omr = round(total × rate)), `summary.test.ts` (≈ OMR) | |
| test-resilience.js (page) | `return.test.ts` (4 tries, 1.5 s × tries, "do not pay again", network never claims), `orders.test.ts` (parked) | webhook part is payments' |
| test-v202.js (page) | `orders.test.ts` (bfcache button, parked), `drawer.test.ts` (focus, bfcache drawer, stale tap), `form.test.ts` (filters, aria-invalid, alert words, h1), `return.test.ts` (no-basket return) | Tab trap: parity (happy-dom has no layout, `offsetParent` is null) |
| test-v336-checkout.js | `return.test.ts` (§2), `form.test.ts` (§3), `orders.test.ts` (§4, §5, §9 card 429, receipts), `summary.test.ts` (co-hold lifted) | §1 resume, §5 refused-later beacon, §6 storage, §7 settings timeout are the core's/payments'; layout hold: parity |
| test-v314.js (A18 sid on verify, A25 already → pixel copy, A34 page) | `return.test.ts` (`&sid=`, `already` fires the pixel copy not the stats event) | |
| test-v403–v407 | header/drawer CSS → parity; v407 a11y and v403/v406 are the product page's | |
| test-v414.js | `summary.test.ts` (column), `form.test.ts` (FIRST = MOBILE_FIRST, first-digit refusal + words) | checkOf is the orders worker's |
| test-v427, v431, v434, v436, v437, v439, v443, v444, v445 | `orders.test.ts` (Pay now ×3, countdown, never holds the redirect), `summary.test.ts` (no-cod, مجانا, sum-fx), `return.test.ts` (nextStep), `form.test.ts` (markup), `band.test.ts` (احجز علبتك الآن) | CSS → screenshots |
| test-v428, v430, v432, v433, v438, v440–v442, v446 | browser-only CSS or other areas | phone order of sections (v428): parity screenshots at 390 |
| test-v309/v310/v311 (header) | `band.test.ts` (running line, data-run, threshold always, pace, copies, free), `suggest.test.ts` (offer step) | |
| test-v208/v209/v211 (suggestion vs shelf, cart caps) | `suggest.test.ts` (hidden box, cap, lm:stock repaint), `drawer.test.ts` (+ at lineRoom) | |
| test-device-fit.js (checkout/drawer) | `form.test.ts` (autofill tokens) | storage-in-try: the code keeps every try; CSS → screenshots |
| test-store-look.js (header/drawer) | parity screenshots | |
| test-boot-fast.js (checkout) | — | the core's (`boot.test.ts`) |

## Open issues

- `tests/web/checkout/_page.ts` works around a happy-dom 21 bug: a `<select>`'s innerHTML with
  a `selected` option selects the option before it. Test-only; browsers are right (parity).
- Unpublished catalogue: the server serves the bundled catalogue as is (no `offer.only`
  default), so locally the small box is sold alone until a catalogue is published — the
  original behaves the same with no published row; the ref server always had one. Not a
  storefront issue; parity journeys publish the same catalogue on both sides.
- `tsconfig.tests.json` errors remain in other workers' files (admin VNode types, core
  orders.test vs the pixel worker's `Lmpx` type); none in mine. `tsconfig.web.json` is clean.
