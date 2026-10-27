# The storefront core (`src/web/core`) — the port of `store.js`, `i18n-en.js`, `cities.js`

Every page module imports it **first** (`import "../core"` at the top of the page's entry in
`src/web/entries/`), or takes the object directly: `import { LM } from "../core"`. The core sets
`window.LM` too (the head's inline `early` script reads `window.LM.ready`; the console uses
`LM.debug()`).

**Same names, same semantics as the original `LM`.** Every member reads its neighbours through
the one `LM` object at call time (`LM.c`, `LM.offerCfg(…)`, `LM.stockCap(…)`), exactly as
store.js did, so a page or a test that replaces `LM.c`, `LM.cfg`, `LM.now`, `LM.stockCap`,
`LM.scents`, `LM.offerCfg`… changes what the other members answer. `tests/parity/store-core.parity.test.ts`
runs the original store.js beside this core over 600 random catalogues/markets/clocks/shelves
and requires identical answers from every member below.

Window arithmetic is the till's own (`src/shared/pricing/offers.ts`, `tiers.ts`) called with
`LM.now()`; where the page adds a condition the till does not have, it is kept (e.g.
`LM.offer()` needs the set **priced** in this market; the set ships free only while
`LM.offer("bundle")`).

## Load order (what page modules may rely on)

1. storage shim (`storage.ts`) — blocked storage gets an in-memory stand-in; `lm_cart` rides in
   `window.name`; an old `lm_order_queue` is moved out of `window.name`.
2. all members below are on `LM` (no member needs the catalogue to EXIST until called).
3. retired keys cleared (`lm_country`, `lm_settings`; `?reset=1` also `lm_cty_v2`).
4. `LM.ready` in flight: `/api/geo` (only if no `?country=` / saved choice / early answer) and
   `/api/settings` leave together. `LM.cfg`/`LM.c` are **null until `LM.ready` resolves**.
5. the stored basket repaired; the stock poller and the parked-order retries wired to `LM.ready`.
6. `window.LM = LM`.

Page modules run after all of this (ES module order; the build keeps source order across
chunks with `strictExecutionOrder`). On `/en/` pages `entries/en.ts` runs before everything
and sets `window.LM_EN`; `L()` reads it at call time.

Events (on `window`): `lm:country` (after `LM.setCountry`), `lm:stock` (the shelf answered,
changed, failed, or 4 s passed).

## Members

| member | module | meaning |
|---|---|---|
| `cfg` | boot | the catalogue in use (live `/api/settings`, else bundled `data/catalogue.json`) |
| `c` | boot | the active market (country row) |
| `ready` | boot | Promise<LM>, resolves once: catalogue + market known (4 s cap on the catalogue) |
| `source` | boot | `"supabase"` (live answer) or `"settings.json"` (bundled) |
| `clock` | boot | `"server"` once the Date (+Age) header set the skew |
| `geo` | boot | the edge's country, when geo decided the market |
| `debug()` | boot | `{ active, saved, codes, source }` for the console |
| `lang` | lang | `"ar"` / `"en"` from `<html lang>` |
| `L(s, vars)` | lang | the shopper's words: Arabic key → English on /en/; `{name}` filled |
| `txt(o, k)` | lang | catalogue text in the page's language (`k_en`), empty Arabic wins |
| `root` | lang | `""` (Arabic, root) or `"../"` (/en/) — prefix for `assets/…` URLs |
| `v` | lang | `"?v=<hash>"` — append to every `assets/img` URL the code builds |
| `esc(v)` | util | HTML-escape (& < > " ') |
| `$(sel)` | util | `document.querySelector` |
| `money(n)` / `num(n)` | money | figure in the market's decimals (+ currency code) as text |
| `moneyHTML(n)` / `moneyMark()` | money | figure + the currency's CSS-mask mark (dh/omr/sar) or escaped code |
| `omrRate()` / `omrNum(n)` / `omr(n)` | money | the OMR every card is charged in |
| `price(id)` / `was(id)` | money | this market's price; an offer's was = its boxes at the single price |
| `img(sizeId)` | art | packshot name for a size |
| `imgFor(line)` | art | picture for a basket line ("" = none: draw a tile) |
| `extraImg(x)` | art | an add-on's photograph name (validated) or "" |
| `scentMark(id)` / `lineMark(line)` / `scentArt(art)` | art | the scent chips / shapes (SVG markup) |
| `extraArt(x, dim)` | art | an add-on's drawing (the sampler = the scents, `dim` greys some) |
| `now()` | offers | server-corrected clock (ms) |
| `ship()` / `cod()` / `codOn()` | offers | delivery fee, COD fee, COD offered here |
| `freeDeal()` / `freeOver()` | offers | the running free-delivery run `{over,end}` / threshold in force |
| `setFree(cart)` / `setShipsFree()` / `setFreeEndsAt()` | offers | the set's own free delivery (switch, window, markets) |
| `countsFree(line)` / `freeSub(cart, unit?)` | catalogue | samples don't count toward free delivery |
| `offerCycleMs(o)` / `offerAnchor(o)` / `offerEndsAt(o)` | offers | window length / anchor / current window's last instant |
| `isBundle(id)` / `offerCfg(id)` / `offerHere(id)` | offers | the set's id test / its row (bundle2 = null) / offered in this market |
| `offer(id)` | offers | the set's row while live, here, started, in date AND priced; else null |
| `offerLeftMs(id)` / `offerEnded(line)` / `offWords(line)` | offers | time left / an offer line whose offer is over / why a line is off, in words |
| `bundleSize()` / `bundleOnlySize()` / `bundleSizeId(id)` | offers | the set's size / that size while sold only in the set / per set id |
| `bundleSellable(id)` / `bundleScents(id)` / `bundleOpen()` | offers | can be packed here / the scents it holds now / on sale and packable |
| `isTier` `tierN` `tierCfg` `tierSize` `tierClockShown` `tierUnstarted` `tierEndsAt` `tierLive` `tierOn` `tierWas` `tierId` `tierCounts` | offers | the large-box offers (duo/trio): ids, window, market, prices, mix ids/counts |
| `countries()` / `listFor(kind)` | catalogue | markets / this market's sizes·scents·extras (else the shared list) |
| `sizes()` / `scents()` / `extras()` | catalogue | priced & visible sizes biggest first / active scents / sellable add-ons |
| `fromPrice()` | catalogue | the headline "from" figure |
| `setCountry(code)` | catalogue | switch market, remember it, fire `lm:country` |
| `lineOffered(line)` / `blockedLines(cart)` | catalogue | can this line be sold here now (the till's answer) |
| `itemId(line)` | catalogue | THE item id the till parses (`oud-large`, `bundle`, `trio:oud.oud.amber`, `burner`) |
| `lineLabel(line)` / `extraOf(line)` | catalogue | `{scent,size}` words from the catalogue / the add-on a line is |
| `readCart()` | cart | the basket, cleaned (object lines, string sizeId, whole qty ≥ 1) |
| `stockShown(n)` / `stockLeft(id)` / `stockPending()` | stock | 30% display of the shelf / pieces to show / counter on, no answer yet |
| `stockHidden(sc, sz)` / `stockHiddenSize(sz)` | stock | hidden at 0 (display only) |
| `stockCap(sc, sz)` / `capRoom(sc, sz, cart)` / `lineRoom(line, cart)` | stock | the shelf cap / room left for a box / for a whole line |
| `lineBoxes(line)` / `basketBoxes(cart)` | stock | boxes a line / basket holds, keyed as the till keys them |
| `loadStock()` | stock | ask `/api/stock` now (the poller calls it) |
| `queueOrder(o)` / `flushOrders()` | orders | park a cash order / post the parked ones (one POST per order at a time) |

Window globals the core uses but does not own: `window.LMBeacon` (stats) for a refused parked
order's log line, `window.LMPX.purchase` (pixel) for a parked order's Purchase.

## Data modules (no DOM — the server and the admin may import them)

- `i18n-en.ts` — `LM_EN`, the English for every `L("…")` (installed by `entries/en.ts`).
- `cities.ts` — `LM_CITIES`, the cities per dial code (installed as `window.LM_CITIES` by
  `entries/checkout.ts`).
- `art.ts` — `ART`, `EXTRA_ART`, `SIZE_IMG`, `EXTRA_IMG`.

## For page-module authors

- No CSS imports in page modules (the stylesheets are links in the pages; an imported CSS
  would be injected at the end of `<head>` and change the cascade).
- Image URLs: `LM.root + "assets/img/" + name + ".avif" + LM.v`.
- Types: `import type { LmApi, CartLine } from "../core"`; `globals.d.ts` types `window.*`.
- Every Arabic literal passed to `L("…")` anywhere under `src/web` needs an `LM_EN` entry
  (`tests/web/core/i18n.test.ts` scans them all).
