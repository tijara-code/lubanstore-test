# The admin panel (`/admin`)

A Preact + TypeScript single-page app, bundled by Vite from `site/admin/index.html` →
`src/admin/main.tsx`. English, LTR; customer names and places stay as stored (Arabic). It talks
only to `/api/admin` (the route table: `docs/notes/admin-api.md`; request schemas and answer
types: `src/shared/admin/{schemas,api}.ts` — import them, never redeclare them).

```
src/admin/
  main.tsx            entry: the stylesheets, then <App/>
  app/                the shell
    App.tsx           session → (sign-in gate | panel settings → Shell)
    Login.tsx         the gate and its messages (401, 429 lockout, 503 not set up)
    Shell.tsx         sidebar (nav, store health, View store, Settings, Sign out), top bar
                      (title, search Ctrl/⌘ K, "Updated hh:mm", Refresh, avatar), the open tab,
                      the Settings dialog, the five-minute refresh
    tabs.ts           THE TAB REGISTRY (see "Adding a tab")
    route.ts          the hash router: #<tab>?<params>
    session.ts        signed in or not (the cookie is HttpOnly; only the user's name is kept)
    panel.ts          panel settings from the server: hidden pages, dismissed warnings
  data/               the data layer
    api.ts            get / send / urlOf, ApiError, onUnauthorised
    endpoints.ts      one typed function per route
    query.ts          the query cache: useQuery, invalidate, refreshActive, setQueryData
    hooks.ts          shared reads: useOverview, useCatalogue, useItemOptions, useNewOrders,
                      afterOrderWrite(), marketOf()
    store.ts          createStore / useStore (small global state)
  kit/                the component kit (import from "../kit")
  lib/                pure helpers: format (money, dates), words (vocabulary, refusals in
                      English), order (links, WhatsApp texts, tracking), cities
  tabs/
    overview/         Overview
    orders/           Orders (list, row, detail, editors, status flow, Empower, history,
                      the typed-in WhatsApp order form, filters, open rows)
    Placeholder.tsx   the stub a phase-2 tab replaces
  styles/             plain CSS, imported by main.tsx: tokens, base, shell, kit, orders
```

## Adding a tab

1. Make `src/admin/tabs/<name>/<Name>.tsx` exporting a component with no props. It renders
   the page's content only — the shell draws the title (`title`/`sub` from the registry) and
   the page wrapper (`.tab`).
2. In `app/tabs.ts`, replace the entry's `component: placeholder(...)` with yours. The `id`
   (the hash word), `page` (the name Settings hides it by — one of `ADMIN_PAGES`), `group`,
   `icon`, `title` and `sub` are already there for Payments, Catalogue, Empower, Customers and
   Analytics. An optional `badge` is a hook returning the sidebar's count (`null` for none).
3. Put your styles in `styles/<name>.css` and import it in `main.tsx` after `kit.css`.
4. Read with `useQuery(key, fetcher)`; write with the `endpoints.ts` functions, then
   `invalidate(prefix)` what the write changed (orders: `afterOrderWrite()`).
5. Tests: `tests/web/admin/<name>*.test.ts` (happy-dom; `_render.ts` mounts and stubs fetch),
   and Playwright in `tests/e2e/admin-<name>.test.ts` (`admin-helpers.ts` signs in and seeds).

The tab's own state that should survive a reload (filters, page) goes in the hash params:
`useRoute().params` to read, `setParams({ … })` to change (no history entry). `navigate(tab,
params)` goes elsewhere (e.g. `navigate("orders", { q: id, open: id })` opens one order).

## The data layer

```ts
const q = useQuery(key, async ({ prev, reason }) => …, { keep: true });
q.data; q.error; q.loading; q.previous; q.refetch();
```

- **Keys** are strings; every orders read starts with `orders` (`orders:list?…`,
  `orders:one:<id>`, `orders:latest`, `orders-badge`), the Overview's with `overview`.
  `invalidate("orders")` re-reads every orders key on screen; keys not on screen are marked
  stale and read when next shown. Two components asking one key share one request.
- **reason**: `"load"` (first read), `"refresh"` (the Refresh button, an invalidation),
  `"auto"` (the five-minute timer). The Orders list sends its `since` tag only on `"auto"`
  and keeps `prev` when the server answers `{ unchanged: true }`.
- **keep**: show the previous key's data while the next loads (paging, filters).
- **Errors** are `ApiError { code, status, extra }` with the server's code; `explain(e)`
  (lib/words.ts) turns one into an English sentence. A 401 anywhere returns to the gate.
- **Writes**: `send(method, path, body)` (or the endpoint function) adds `X-LM-Admin: 1` and
  JSON; the cookie goes with every call (`credentials: "same-origin"`). Never send a price:
  the server prices.
- `lastSync` (a store) is when a read last came back: the top bar's "Updated hh:mm".

## The kit

| Component | Use |
|---|---|
| `Btn` | capsule button: `kind` primary/accent/ghost/danger, `sm`, `icon`, `iconOnly` + `label` (the accessible name), `busy` |
| `LinkBtn` | a link drawn as a button (`newTab` adds `target=_blank rel=noopener`) |
| `Pill` | status tint: `tone` = pending/new/prep/ship/done/void/paid/unpaid/cod/refunded/empower/manual/red/amber/blue/leaf/muted |
| `Card`, `CardHead`, `Fold` | a white card; a heading with actions; a card that folds (its body stays mounted, hidden) |
| `Kpis`, `Kpi` | the figure tiles (`dark` = the inverted tile; a trailing currency is drawn as the unit) |
| `LineChart`, `BarChart` | hand-drawn SVG: rows `{ label, n }`, `unit` |
| `Seg` | segmented choice (7d/30d/90d) |
| `SearchField`, `Select`, `Field`, `Switch`, `QtyStepper` | form pieces (`Field` = caps label over a control) |
| `MultiSelect` | a searchable list of ticks applied on Done (Order status) |
| `DateRange` | THE calendar (presets kept by name, Muscat days; `resolveRange(value, now)`) |
| `Pager` | "20 of 86" and ‹ 1 / 5 › |
| `Modal`, `ask`, `choose` | dialogs (focus moved in and trapped, Escape closes, focus returned); `ask` = yes/no, `choose` = several answers |
| `toast` | the one status line at the foot (`role=status`) |
| `copyText`, `CopyBtn` | copy with the textarea fallback |
| `Icon` | the panel's line icons by name |

## Conventions

- Plain CSS with the tokens in `styles/tokens.css` (`--ink`, `--brand-dp`, `--r`, `--gap` …);
  small text keeps ≥ 4.5:1. No CSS framework, no chart library, no new npm package.
- Every control has an accessible name; icon-only buttons through `label`. Dialogs are
  `Modal`/`ask`/`choose`, never `window.confirm`.
- Dates are shown in the viewer's time zone (`lib/format.ts`); day filters, KPI windows and
  the charts' days are Muscat days (`src/shared/kpi.ts`).
- Words a person reads come from `lib/words.ts`; add a refusal code's sentence there.
- Phone layout (≤ 720 px): the sidebar is a scrollable bottom row; tables either stack into
  cards (see `orders.css`) or scroll inside their card — the page never scrolls sideways.
