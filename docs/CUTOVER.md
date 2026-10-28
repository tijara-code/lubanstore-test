# Replacing the live store with this one — the runbook

The live site (lubanmusk.com, the `luban-musk` repository on Netlify) is replaced by this
code on the **same domain** and the **same Supabase project**. The original's tables in schema
`public` are never changed: the new store has its own schema `store`, filled by a copy. That is
what makes the switch safe — going back is one redeploy of the old repository.

Every step is done by you, by hand, in this order. Each has a **gate**: do not go on until it
is green. `npm run preflight` is the tool for most gates; it is read-only and prints
`READY` / `NOT READY` with the reasons (names only, never values).

Time to plan for: about an hour of your own work, in two sittings (prepare on day 1, switch on
day 2 at a quiet hour). The storefront is never down: visitors keep using the old site until
the moment Netlify publishes the new one, and the pages themselves are identical.

---

## 0. What you need in front of you

- The `luban-new` folder with `npm install` done, and Node 22.
- Supabase dashboard of the live project (SQL editor + Project settings → Database).
- Netlify dashboard of the live site (Site configuration → Environment variables, Deploys).
- The Thawani merchant portal (webhook page) and the Omniful/Empower dashboard.
- A `.env` in `luban-new` with the **production** values you will paste into Netlify (it is
  git-ignored; it is read only by the `npm run …` commands you type here, never by Netlify).
  Start from `.env.example`; every name is explained in `docs/ENV.md`.

Secrets that the original's README said were exposed (`SUPABASE_SERVICE_KEY`,
`ADMIN_PASSWORD`, `META_CAPI_TOKEN`, `SMSA_API_KEY`): if any was not rotated, rotate it now.
The new store does not use the service key at all, but the database password sits in
`DATABASE_URL` — if the old key leaked together with it, reset the database password first.

---

## 1. Prepare (day 1 — nothing visible to customers)

### 1a. Code on GitHub

Push `luban-new` to a new repository (or a new branch of `luban-store`). It has its own git
history. **Gate:** `git status` clean, the push visible on GitHub.

### 1b. The database address

Supabase → **Connect** (button at the top of the dashboard) → **Transaction pooler**. The
string looks like `postgresql://postgres.<ref>:<password>@aws-….pooler.supabase.com:6543/postgres`.
The password is the **database** password (Project settings → Database → "Reset database
password" if you do not have it), not an API key. Put it in `.env` as `DATABASE_URL`.

### 1c. The new tables and the first copy of the data

Either of these; both do the same thing and are safe to repeat:

- **By itself:** the first time the new site starts with `DATABASE_URL` set (step 1d), the server
  creates schema `store` and, finding it empty, copies the original's data from `public` —
  orders, parcels, the catalogue, Empower records, notes, analytics. The Netlify function log
  shows `[setup] done: migrated, imported, N orders`. Nothing in `public` changes.
- **From your computer:** `npm run db:setup` (migrations, the copy, then the preflight).

Then:

```
npm run preflight
```

**Gate:** `READY` (warnings about "not in the new tables yet" are fine on day 1; `FAIL` lines
are not). Fix anything it names and run it again. To bring over what changed on the old site
later, run `db/import-from-v1.sql` in Supabase → SQL editor (section 2 says when).

### 1d. Netlify, on a preview first

Create a **new Netlify site** from the new repository (or a branch deploy of the existing
site). Build settings come from `netlify.toml`. Add the environment variables (scope:
**Functions** and **Builds**):

| Set this | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the pooler string from 1b | new; TLS is used automatically for any remote host |
| `SITE_URL` | `https://lubanmusk.com` | new; on the preview, the preview's own URL |
| `SESSION_SECRET` | 32+ random characters | new; without it a key is derived from the admin password (as the original did) and the Overview warns; changing it later signs every admin out |
| `ADMIN_USER` | as today | |
| `ADMIN_PASSWORD_HASH` | `printf '%s' 'the password' \| npm run -s admin:hash` | new; replaces `ADMIN_PASSWORD` (which still works as before) |
| `THAWANI_MODE` | `uat` on the preview, `live` in production | the original's `test` is accepted as `uat` |
| `THAWANI_SECRET_KEY`, `THAWANI_PUBLISHABLE_KEY`, `THAWANI_WEBHOOK_SECRET` | as today (test keys on the preview) | |
| `OMNIFUL_API_TOKEN`, `OMNIFUL_HUB_CODE`, `OMNIFUL_HOOK_SECRET`, `OMNIFUL_ENV`, and the rest of `OMNIFUL_*` you use | as today | `OMNIFUL_SELLER_ID` is not read any more |
| `META_PIXEL_ID`, `META_CAPI_TOKEN`, `SNAP_PIXEL_ID`, `SNAP_CAPI_TOKEN`, `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | as today | the pixel ids are baked into the pages at build |
| Do **not** set | `SERVICES_MODE`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SMSA_*`, `WA_*`, `META_TEST_EVENT_CODE` (except while testing Meta events) | `SERVICES_MODE=fake` makes the site refuse to start in production |

Two things about previews that are easy to get wrong:

- **To the server, a preview IS production** (Netlify gives it a site id), so a test order on
  the preview sends a real Purchase to Meta/Snap/GA4 and lands in the real `store.orders`.
  Leave `META_CAPI_TOKEN`, `SNAP_CAPI_TOKEN` and `GA4_API_SECRET` **out of the preview's
  variables** (set them only when you switch), and trash the test orders in the new admin
  afterwards (Orders → the order → Trash).
- **Empower's tokens.** If you use the refresh-token flow (`OMNIFUL_REFRESH_TOKEN` / client id
  and secret), whichever store renews the token first invalidates the other's — testing Empower
  on the preview can break the LIVE store's Empower calls. Either set `OMNIFUL_API_TOKEN` (the
  long-lived token) on both across the switch, or do not test Empower on the preview at all
  (step 3.7 checks the first live push).

Deploy. **Gate:** the preview's `/api/health` answers `ok`, `/admin/` shows the sign-in and
accepts the password, the Overview shows your real orders and the same numbers as the old
admin for the same period.

### 1e. Try the whole flow on the preview (test keys)

On the preview, with `THAWANI_MODE=uat`:

1. A **cash** order from the storefront → appears in `/admin/` as New Order; the Thank-you page
   and the invoice link work.
2. A **card** order with Thawani's test card (`4242 4242 4242 4242`, OTP `1234`) → paid; cancel
   one on the Thawani page → Awaiting Payment, then Cancelled when it expires.
3. In admin: change a status, add a tracking number by hand, write a customer note, export
   the CSV.
4. Pixels: open the page with Meta's Test Events (set `META_TEST_EVENT_CODE` on the preview
   only) and Snap's Event tester; see PageView / AddToCart / Purchase arrive from both browser
   and server with matching event ids. Remove `META_TEST_EVENT_CODE` afterwards.
5. Empower: only with a staging hub and a long-lived `OMNIFUL_API_TOKEN` (see above). Otherwise
   skip — the first live push is checked in step 3.

**Gate:** all five. Anything odd here is a bug to fix before the switch, not after.

---

## 2. Switch (day 2, a quiet hour)

The switch is three actions in a row: freeze the old store's outbound work, copy what is
new, publish. Customers see nothing; an order placed in the middle lands in whichever store
was serving that request and is carried over by the copy.

1. **Old admin → Empower → auto push OFF.** (So the old store cannot push an order the new
   one will also push.) Leave the old site serving.
2. **Netlify → the new site → environment:** `THAWANI_MODE=live`, `SITE_URL=https://lubanmusk.com`,
   live Thawani keys, no `META_TEST_EVENT_CODE`. Trigger a deploy of the new site and let it
   finish — but do not point the domain yet.
3. **Supabase → run `db/import-from-v1.sql` again** (copies everything placed since 1c).
   Then on your computer `npm run preflight`: **Gate:** `READY` with no "not in the new
   tables yet" line.
4. **Point the domain.** Netlify → the new site → Domain management → add `lubanmusk.com`
   (and `www`); remove it from the old site when asked. Netlify moves the domain in a minute;
   the old site keeps answering requests already in flight.
5. **Run `db/import-from-v1.sql` one last time**, then `db/reconcile-v1.sql` (it lists any
   order that was paid/shipped/cancelled on the old site after an earlier copy and applies the
   old site's newer state; rows marked "kept" were touched in both — look at those by hand).
   Then `npm run preflight -- --after`. **Gate:** `READY`.
6. **Webhooks.** Thawani's portal URL can stay as it is (`/.netlify/functions/thawani-webhook`
   is still answered) or move to `https://lubanmusk.com/api/pay/webhook`. Omniful's hook stays
   `https://lubanmusk.com/api/omniful/hook?k=<OMNIFUL_HOOK_SECRET>`. Both now reach the new
   site automatically because the domain moved. **WhatsApp:** `/api/whatsapp/hook` no longer
   exists — in the Meta app's WhatsApp → Configuration, remove the webhook subscription so Meta
   stops retrying (and disables it after enough failures anyway).
7. **New admin → Empower → auto push ON.** Watch the first order go through (Empower tab shows
   the push; the parcel appears in Omniful).

---

## 3. Verify in the first hour

Do these on the live domain; each takes a minute.

| Check | Where | Expected |
|---|---|---|
| Site up, Arabic and English | `/`, `/en/`, `/checkout.html` | identical to before; prices, offers, delivery band |
| Health | `/api/health` | `ok`, database reachable, jobs scheduled |
| A real cash order (your own phone) | storefront → admin | New Order within seconds; invoice link; the pixels' Purchase in Events Manager |
| A real card payment of the smallest item | storefront → Thawani → admin | Paid; the webhook recorded in Payments; refund it from the Thawani portal afterwards |
| Empower push | admin → Empower | the order reaches Omniful once, with the right SKU codes |
| KPIs | admin Overview / Analytics vs the old admin (open its last deploy preview) | same orders, revenue and best sellers for the same dates |
| Customers | admin Customers | the same people and notes as before |
| Old links | a `/resume/<id>` or `/invoice/<id>` link from an old WhatsApp message | still opens |
| Jobs | Netlify → Logs → Functions → `job-*` | each ran at its schedule (hourly / every minute / daily) |
| Admin | sign out everywhere, sign in again | works; the audit trail records it |

If any of these fails and you cannot see why within a few minutes, **roll back** (section 5)
rather than debugging on the live store.

---

## 4. The days after

- Keep the old Netlify site and repository as they are for at least two weeks. Do not delete
  the `public` tables; they cost nothing and are the rollback.
- After two weeks of clean running: remove the unused variables from Netlify (`SUPABASE_*`,
  `SMSA_*`, `WA_*`), archive the old repository, and optionally drop the `public` tables (take
  a Supabase backup first).
- The storefront's Thawani test mode, the fake services and the local admin door exist only
  outside production; nothing to switch off.

---

## 5. Rollback (any time)

1. Netlify → the OLD site → Domain management → add `lubanmusk.com` back (it moves away from
   the new site). Two minutes.
2. Old admin → Empower → auto push ON again.
3. Orders placed on the new store meanwhile are in `store.orders`; the old store does not read
   that schema. For the few that exist, re-enter them in the old admin, or ask for the copy-back
   script (it is the import in reverse; not written because it should never be needed).

Nothing in `public` was changed by the new store, so the old site behaves exactly as before.

---

## 6. What is different afterwards — tell the team

- **SMSA and the Oman local courier are gone.** Orders not sent through Empower get a tracking
  number typed by hand in admin (Orders → the order → Tracking).
- **WhatsApp confirmations through the Cloud API are not sent.** (Can be added back.)
- **The offline sales ledger is gone.** Payments and refunds are read from the orders.
- Admin sign-in uses a password hash; "Sign out everywhere" signs out every browser at once.
- The Overview's KPI numbers come from the same event history (copied), rolled up hourly by
  a job instead of on demand, so they can lag by up to an hour. "Delivery hours" shifts a
  little: SMSA parcels and the old booked-at time are gone from the average.
- The catalogue: once someone publishes in the NEW admin, a later copy from the old site no
  longer overwrites it. Publish price changes in one admin only during the switch days.
