# product-page — notes

The port of the original `assets/js/main.js` (≈2,800 lines): the product page, `index.html` and
the generated `en/index.html`. It covers the gallery, the size tiles, the large-box offers, the
scent grid, the three-scent set, the countdowns, the six points, the delivery copy, the
free-delivery strip, the add-to-basket flows, the reel, the track box, the country select and
the motion observers.

## Files

| Path | What (main.js's part) |
|---|---|
| `src/web/product/index.ts` | `init`, the boot (`Promise.all([domReady, LM.ready])`, `placeCountry` on domReady), the offer clock's midnight/visibility/focus wake-ups, the sticky button, the checkout link, the `viewContent` report. Exports `pageReady` (tests wait on it) |
| `state.ts` | main.js's closure state: `st` and `P` (`SIZES`, `SCENTS`, `QTY`, `PICK`; one object because ES modules cannot reassign another module's binding), `qOf`, `IMAGES`, `SIZE_SLIDE`, `KEY`, `$`, `read` (= `LM.readCart`), `rtl`, `phoneGrid`, and `G()`, the other scripts' window globals (`LMPX`, `LMEV`, `lmCart`, `lmShip`) read at call time |
| `words.ts` | `leftWords`, `sizeLabel`, `tierName`, `perBox`, `dayWords`/`hourWords`/`minuteWords`/`timeWords`, `tierLeft`, `setFreeLeft`, `fsLeftHtml`, `blendName`, `etaPair`/`etaWords` |
| `ingest.ts` | `ingest`, `clean`, `cleanHex`, `cleanId`: the only way catalogue data gets onto the page |
| `perks.ts` | `PERK_SVG`, `perks()` (the six points) |
| `gallery.ts` | `buildGallery` (keeps the HTML's first picture), `pic`, `go`, `mark`, `onScroll`, `galleryHome` (v438) |
| `rules.ts` | the rules with no drawing: `stacked`, `smallSize`, `keptOpen`/`allOpen`/`openSizes`, `firstBuyable`, `tiersHere`/`tierNeed`, `scentShut`, `shownScents`, `picked`/`pickedCount`/`sizeTotal`/`pickedTotal`, `tierCountText`, `sizeGated`, `tileWords`, `dropDeadTier` |
| `grid.ts` | `buildSizes` (keeps the pictures, v438), `buildPhotoSizes`, `buildStacked`, `buildTiers` with its listeners (phone guards first, then the desktop let-go, Space, change and focus), `runTierClock`, `buildPicker`, `bump`, `capNote`, `syncAdd`, `pickSize`, `paintLeft`, `shot`, `bundleBox` |
| `set.ts` | `OFFERS`, `buildOffer`, `buildOne` (the set's row, its signature and its single wake-up, the radio's listeners), `addOffer`, `runSetFreeClock` |
| `add.ts` | `addPicked` (one line per scent, or one `trio:`/`duo:` line), `afterAdd`, `flyToCart`, `accentOf`, `badge` |
| `sync.ts` | `sync` (the sticky price and `lmShip`), `stickyWords`, `shipCopy`, `shipEta`, `buildFreeBar` |
| `country.ts` | `initCountry` (the select, `lm:country`, `lm:stock` with the hide key, clamping and redraws), `placeCountry` |
| `track.ts` | `initTrack`, `trackTidy` (the box's own tidying, now shared by `?track=` and typing) |
| `reel.ts` | `initSticky`, `initAnimIdle`, `initSteps`, `initReelArrows`, `initClip` (deal, data-first, copies, dots, stack, jump, observers, posters, sources) |
| `src/web/entries/home.ts` | added `import "../product";` last, where main.js sat in the original script order (stats, pixel, header, cart, main) |
| `tests/web/product/*.test.ts` (+ `_page.ts`) | happy-dom suites (91 tests) |
| `tests/parity/product-page.browser.parity.test.ts` | the browser parity journeys against the original (19 tests, 173 compared steps) |

## How it meets the other scripts

The contracts are the same as the original's. Nothing is imported from header, cart, pixel or
stats.

- **Window globals**, read at call time: `window.LMPX.addCart(line)` and
  `LMPX.viewContent(sizeId, scentId)` (pixel); `window.LMEV.track(name, item?)` (stats:
  `add_cart` as `<scent>-<size>` or the tier id, `offer_add` `bundle`, `track_lookup`);
  `window.lmCart.refresh()` (cart); `window.lmShip(amount)` (header). Each call is guarded the
  way the original guarded it (`if (window.LMPX) LMPX.addCart(…)`).
- **Window events:** it listens to `lm:country` and `lm:stock` from the core, and to `lm:cart`
  from the drawer.
- The page also writes `#cartCount`, the `.cart` label and `#goCheckout` (`badge()`), as
  main.js did, alongside header.js and cart.js.

I checked these against the ports now in the repo: `src/web/header` sets `lmShip`,
`src/web/cart` sets `lmCart` and dispatches `lm:cart`, and `src/web/tracking/pixel.ts` exposes
`addCart` and `viewContent`.

## Decisions and deliberate differences

1. **No `if (!window.LM) return`.** The core is imported, so it always exists. The v312 rule
   that main.js "does nothing and throws nothing without window.LM" no longer applies.
2. **`esc`, `$` and `toAr` come from the core's `util.ts`.** They are identical. main.js kept
   its own copies only because a page could load a store.js from another deploy (v400/v401).
   One hashed bundle rules that out.
3. **Dead code removed.** I removed `pickSize`'s unreachable "tapping the open size closes it"
   branch (it sat after a `return`). Two hooks stay because callers ask them: `keptOpen()`
   always answers false, and `syncBundleSize()` is unchanged. The `IntersectionObserver`
   fallback, the `addListener` fallback for `matchMedia` and the `scrollBy` fallback are kept.
4. **Set lines passed to `LM.lineRoom` carry no `qty`,** exactly as main.js passed them (they
   are cast).
5. **`pageReady`** (the boot's promise) is exported for the tests. Nothing else reads it.
6. **Arabic strings:** every `L("…")` in these modules is a key the core's `LM_EN` already
   holds (the original i18n-en.js). The core's i18n test scans them and passes.
7. **Timing and storage are unchanged:**
   - `try` around every sessionStorage write.
   - The 30 s tier and set-free clocks, the 60 s strip, and the 2.2 s cap note.
   - The 1.6 s "added" flash, the 60 ms announcement, and the set wake-up at
     `min(ms + 500, 1 day)`.
   - The midnight-plus-5 s re-ask.
   - Rebuilds happen in the same order as the original's calls (for example `buildSizes();
     syncAdd(); sync();`).

## Tests: original suites → new tests

Every check below is behavioural. Source-text regexes became DOM checks. CSS-only checks are
covered by the pixel comparisons (compare-screens and the parity journeys).

| Original | New |
|---|---|
| test-picker.js | `picker.test.ts` (tiles, steppers, add, fly-to-cart and reduced motion, switching size, a shut row in the small box, `sizesOpen` no-op) |
| test-store-look.js (page), test-v415/v425/v432 (leaves, badge, blend rows) | `picker.test.ts` (badge then leaves, half leaf under 4.6, clamping, an emptied tag, middle cell, accents, stepper labels) |
| test-gallery.js, test-v205.js, test-v438.js, test-v204.js (gallery) | `page.test.ts` (three frames, first picture kept, thumbs, sizes, version on URLs, thumb jumps, `pageshow` home, pictures survive a rebuild); `--n` in `picker.test.ts` |
| test-clip.js (behaviour), test-v211.js (data-first), test-v204.js (anim idle), test-step-animation.js, test-v337/v400 (arrows) | `reel.test.ts` (deal, no loss, data-first slot over 3/4/5 cards, copies `d e \| a b c d e \| a b`, dots, nothing before "ahead", posters, the three opening clips, preload before src, warm-only-when-on-screen, play/pause on arrival/swipe/leave/return, no refetch, reduced motion, missing posters, no-IO fallback, arrows, steps, anim-idle, sticky bar) |
| test-clip.js (free-delivery copy), test-v198.js, test-v202.js (cod-faq) | `page.test.ts` (per-market `.ship-free`/`.ship-cost`/`.cod-faq`/`.ship-eta(-faq)` with `data-def`) and `words.test.ts` (etaPair, AR + EN) |
| test-free-ship.js (page strip), test-v413.js | `page.test.ts` (#fsBar from publish to end, whole days, hidden at the end and the page repainted; free-for-all without days) and `words.test.ts` |
| test-offer-clock.js, test-offer-countdown.js (page side), test-v312.js (set), test-v204.js (signature) | `set.test.ts` (no clock on the set, unchanged card not redrawn, leaves at its window's end); the LM arithmetic is the core's (`offers.test.ts`) |
| test-offer-scents.js, test-v309.js (design A), test-v404.js, test-v415.js (×1), test-v336-product.js (2) | `set.test.ts` |
| test-v408/v410/v411/v413 (set free delivery on the page), test-v419.js | `set.test.ts` (badge and countdown, gone at the end, `lmShip(0)`), `words.test.ts` (`setFreeLeft` AR + EN) |
| test-v303.js (page), test-v309.js, test-v310.js (perBox), test-v417.js, test-v404.js, test-v407.js (labels) | `stacked.test.ts` (rows, words, prices, struck prices, spoken names, clock, SA plain row, `clock:false`, free badge, pick limits, ONE line with canonical id, same mix = same line, duo label) |
| test-v312.js, test-v335.js, test-v403.js, test-v406.js, test-v407.js, test-v440.js | `stacked.test.ts` (stacked with set on/off, tiles as pictures, #ptsTop, set placement, from price, view event, desktop nothing chosen and idle grid, phone opens chosen, let-go vs keep for tap and Space, focus return, the set as a radio, its spoken name, sticky price) |
| test-v336-product.js (4, 5, 6, 9; the page parts) | `stacked.test.ts` (tileWords cases, dropDeadTier in step, sticky words/target/price), `words.test.ts` (8: the countdown table) |
| test-v206/v207/v208/v209/v211/v318/v403 (page parts) | `stock.test.ts` (hidden rows, all-hidden shows all, hidden size off the tiles, a box leaving takes its count, cap stops and "باقي {n} فقط", cap 0, live cap clamps, offer boxes count against a cap, `[data-left]` repaints in place) and `stacked.test.ts` (pending blank tile) |
| test-v192/v203/v205 (tiles), test-availability.js (storefront), test-v209.js (market change) | `picker.test.ts` |
| test-v412.js, test-v197.js / test-v202.js (hour words), test-v203.js (sizeLabel), test-v310.js (leftWords), test-v414.js (blends) | `words.test.ts` |
| test-audit-fixes.js (tracking normaliser; no-scent market), test-v447.js (`?track=`), test-track.js (page) | `track.test.ts`, `words.test.ts`; the no-scent market is in `stacked.test.ts` |
| test-catalogue-injection.js (page) | `page.test.ts` (no element or handler from catalogue strings, hex colours, slug ids, escaped country options) |
| test-v337.js / test-v400.js (placeCountry) | `page.test.ts`, plus the parity journeys at 1366 px |
| test-v202.js (a11y: `#addLive`, focus to the basket, labels) | `picker.test.ts` |
| test-boot-fast.js (product) | nothing page-specific: the boot requests are the core's (`tests/web/core/boot.test.ts`). The page waits on `LM.ready` |
| test-cart-availability.js (page parts) | the page has none beyond the core's `lineOffered`/`bundleSellable` (`availability.test.ts`) |
| test-device-fit.js | storage writes are in `try` (by construction); viewport, fit and CSS are covered by the pixel comparisons |
| v313, v319, v325–v327 | no product-page behaviour in the inventory (server, events, schema) |
| v416, v418, v420, v421, v426, v430, v437, v439 (CSS) | browser-only: the pixel comparisons (compare-screens 0 % outside the reel, parity journeys ≤ 0.015 %) |

**Browser-only behaviours (inventory §2):** these are the product-page journeys in
`tests/parity/product-page.browser.parity.test.ts`, run against the original. They cover the
phone and desktop choose/let-go rules for tap and Space, focus after rebuilds, the header
`.hdr-end` at 1366 px, lazy pictures, the gallery thumbs, the sticky bar and its scroll, reel
placement and arrows, and the leaves.

## Parity in a real browser (`tests/parity/product-page.browser.parity.test.ts`)

**Result: 19/19 tests pass, 173 compared steps, 173 with identical DOM. The largest pixel
difference is 0.0145 % (threshold 0.05 %).** Report: `.tmp/parity-product/report.json`.

Setup:
- The original runs as `ref-server.js` on port 4101. The new site is built into `dist-product`
  and served on port 8891 in fake mode (or uses `PRODUCT_REF` / `PRODUCT_NEW`).
- Both run Chromium at 390 and 1366 px, in Arabic and English, with reduced motion, every host
  but localhost and the font hosts blocked, the `x-country: OM` edge header, a seeded
  `Math.random`, and the browser `Date` fixed at 2026-10-01 09:00 +04.
- **The pages tell time by the server's Date header,** so offer windows in the variants are
  anchored on the real now.

Journeys:
- **Every market** (OM, AE, SA, QA, BH, KW), on open and after changing the select OM → SA → AE.
- **The large offers,** in four runs:
  - open, choose trio, pick 2, then 3, then a refused fourth;
  - add, check the basket JSON, the flash ends;
  - tap the chosen row again (the phone keeps it, the desktop lets go);
  - duo, then the set (choose, add, tap again), then Space on a chosen row and where focus goes.
- **11 catalogue variants:**
  - large offers in SA (plain row), with no clock, and in days;
  - set off;
  - set ships free (hours and days);
  - strip counting days, and free for everyone;
  - large box sold out;
  - amber out of both sizes, with ratings 4.3/4.8 and a badge;
  - cash off.
- **Page parts:** gallery thumb, sticky bar shown and its scroll target, reel placement and the
  next arrow, three `?track=` links, typing then submitting.
- **A basket from before** the visit.

The comparison normalises these things:
- `?v=` values and hashed chunk names.
- HTML comments and whitespace.
- `class=""` against no class.
- The header band's `.ship-run`, which is header.js's port: its `--ship-w` and copy count are
  measured off the live layout (see open issues).

The reel is masked in screenshots only; its DOM, including `--d`, `front`/`near`/`far`, dots and
posters, is still compared.

## Visual comparison (`scripts/compare-screens.ts --js`)

**Before:** product pages differed by 44–54 %.

**After, 2026-10-28 run** (ref on :4101, new dev on :8891):

| Page | 320 | 390 | 768 | 1366 |
|---|---|---|---|---|
| `/` | 0.000 % | 0.000 % | 1.911 % ¹ | 0.000 % |
| `/en/` | 0.000 % | 0.000 % | 1.844 % ¹ | 1.153 % ¹ |
| `/?country=OM` | 0.016 % ¹ | 0.000 % | 1.911 % ¹ | 0.000 % |
| `/en/?country=OM` | 0.000 % | 0.000 % | 0.000 % | 1.153 % ¹ |
| `/?country=AE` | 0.000 % | 0.000 % | 1.911 % ¹ | 0.000 % |
| `/en/?country=SA` | 0.000 % | 6.099 % ¹ | 0.000 % | 1.153 % ¹ |

Page heights are identical in every pair.

¹ Every remaining difference is inside `#reel`. A video poster has not been painted at
screenshot time on one side, or the strip has settled one card over after the tool's
mouse-wheel walk. It happens on either side: the original was the one missing the poster at
768 px here, and the new side at 390 px. The same pair is 0.000 % on a rerun (for example
`/?country=OM` at 390 and 768 px gave 0.000 % twice in a row in an earlier run).

The reel's DOM, including the stack state, is equal in every parity step. Outside the reel,
every pair is at 0 %.

In an earlier run, `/` without `?country` differed because the new server's `/api/geo` answered
`""` while ref-server.js adds `x-country: OM`. That is an environment difference, not the page.

## Open issues (for others)

- **Header band (header worker):** `.ship-run`'s `--ship-w` comes out about 7–10 px shorter on
  the new site, and on QA at 390 px one fewer copy is cloned. It is visually identical with
  reduced motion and probably measures before the font settles. The parity test normalises it.
- **`tests/unit/build/build.test.ts`** ("the product page and the checkout reach the core")
  looks for a chunk named `core-*.js`. With the cart/header modules imported by both entries,
  rolldown now names that shared chunk `cart-*.js`, so the test fails. The behaviour is right
  (both pages reach the core); the test needs to find the chunk by content, not by name.
  That test belongs to storefront-core, so I did not change it.
- **happy-dom's `select.value`** reported the wrong option for a select whose first option's
  text contains a `"` (`page.test.ts` checks `option[selected]` instead).
- **`tests/web/core/i18n.test.ts` "the checkout installs … LM_CITIES"** fails. It concerns
  `entries/checkout.ts`, which is the checkout worker's.
- **Not covered in the browser:** shelf readings (stock hide/cap) are covered in happy-dom
  (`stock.test.ts`) but not in the browser journeys. The original's shelf is
  `__W.omniful.inventory` inside ref-server.js, and the new one is the Omniful emulator; I added
  no dev route.
