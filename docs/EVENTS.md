# Event catalogue

The table lives in `src/shared/pixels/catalogue.ts` (`EVENTS`); the relays' allowlists
(`/api/meta`, `/api/snap`), the first-party collector's (`/api/ev`) and the storefront's pixel
port read it from there. This page says what it encodes.

**Side:** *both* = the browser pixel fires it and relays a server twin with the same id, so the
platform counts one; *server* = Conversions API / Measurement Protocol only; *browser* = pixel only.

**Rules that hold everywhere**

- One id per event, shared by Meta's and Snap's copies (pixel `eventID` / `client_dedup_id` =
  server `event_id`).
- Purchase uses the **order id** on every path (cash at checkout, card on the shopper's return,
  card by webhook, cash from the reminder link) and is reported **once per order**
  (claim `purchase-<id>`); GA4's purchase has its own claim (`ga4-<id>`), marked failed — never
  given back — when a send fails, so the next path that confirms the sale sends it.
- The relays refuse `Purchase` / `PURCHASE`: only the server reports a sale, from its own figures.
- Hashed fields are SHA-256 of the normalised value (`src/shared/pixels/identity.ts`, the same
  module in the page and on the server). No raw name, phone, email or address leaves either side.
- Click ids (`fbc`, `fbp`) are sent whole or not at all; Meta's ids go to Meta only, Snap's
  (`sc_cookie1`, `sc_click_id`) to Snap only.

| Platform | Events | Side |
|---|---|---|
| Meta | PageView, ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo | both (relayed twin) |
| Meta | Purchase | both (server copy from the order) |
| Snap | PAGE_VIEW, VIEW_CONTENT, ADD_CART, START_CHECKOUT, ADD_BILLING | both (relayed twin) |
| Snap | PURCHASE | both (server copy from the order) |
| GA4 | view_item, add_to_cart, begin_checkout, add_payment_info | browser (gtag) |
| GA4 | purchase | server (Measurement Protocol); the page sends it only when the server answers `ga4: "page"` |
| First-party | page_view, session_start, size_open, add_cart, offer_add, suggest_add, extra_add, cart_open, checkout_view, pay_method, order_placed, whatsapp_click, track_lookup | browser → `/api/ev` (via `/api/beacon`) |

User data on the server copies: relayed twins carry `ph` (a hash, when known), `external_id`
(the phone hash and the browser's visitor id), `country` (the market, hashed), `fbp`/`fbc` or
`scid`/`sccid`, and the request's IP and user agent. The Purchase carries `em ph fn ln ct st
country external_id` plus each platform's own cookies and the shopper's IP and agent (the live
request's, or the one captured at checkout — never Thawani's).

## Consent

No consent banner; DNT / GPC switch off the first-party events only (the page sends none and
`/api/ev` stores none). Meta, Snap and GA4 run for every visitor.
