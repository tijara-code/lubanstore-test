/**
 * ORDERS — search and fulfil. The biggest tab: the toolbar (search, Trash, Order status,
 * payment, country, the calendar, CSV, New order), the bulk bar, the table (20 a page, the
 * count always shown) with each row opening into the order's detail, and the typed-in
 * (WhatsApp) order form.
 *
 * The list is the server's (GET /orders, paged and filtered there). Any filter goes back to
 * page 1 and clears the selection; the page number survives a refresh. Open and pinned rows
 * survive every redraw (rows.ts). The five-minute refresh sends the list's `since` tag.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BulkAnswer, OrderListRow, OrdersAnswer } from "../../../shared/admin/api";
import { setParams, useRoute } from "../../app/route";
import { isApiError } from "../../data/api";
import { bulk, exportUrl, listOrders } from "../../data/endpoints";
import { afterOrderWrite, useCatalogue } from "../../data/hooks";
import { useQuery } from "../../data/query";
import { useStore } from "../../data/store";
import { ask, Btn, DateRange, Empty, Icon, MultiSelect, Pager, SearchField, Select, toast } from "../../kit";
import { plural } from "../../lib/format";
import { COUNTRY_EN, explain, MARKETS, STATUS, STATUS_FILTER } from "../../lib/words";
import { pushOne } from "./empower";
import { filtered, filtersOf, keyOf, paramsOf, PER_PAGE, queryOf, type Filters } from "./filters";
import { ManualOrder } from "./ManualOrder";
import { OrderRow } from "./OrderRow";
import { forget, openOnly, rowsStore } from "./rows";

const PAYMENT_OPTIONS = [
  { value: "", label: "Any payment" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "cod", label: "Cash on delivery" },
  { value: "cancelled", label: "Payment cancelled" },
  { value: "refunded", label: "Refunded" },
];

/** The server takes 200 ids a call: a bigger selection goes in turns (test-admin-batch). */
export async function chunked(ids: string[], call: (part: string[]) => Promise<BulkAnswer>): Promise<{ updated: number; stale: string[] }> {
  let updated = 0;
  const stale: string[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const a = await call(ids.slice(i, i + 200));
    updated += Number(a.updated ?? a.deleted ?? 0);
    stale.push(...(a.stale || []));
  }
  return { updated, stale };
}

function staleWord(stale: string[]): string {
  return stale.length ? " · " + plural(stale.length, "order") + " changed meanwhile and " + (stale.length === 1 ? "was" : "were") + " left as " + (stale.length === 1 ? "it was" : "they were") + ": " + stale.slice(0, 3).join(", ") + (stale.length > 3 ? "…" : "") : "";
}

export function Orders() {
  const r = useRoute();
  const f = filtersOf(r.params);
  const now = Date.now();
  const q = queryOf(f, now);
  const key = keyOf(q);
  const cat = useCatalogue();
  const [sel, setSel] = useState<string[]>([]);
  const [newOrder, setNewOrder] = useState(false);
  const [busy, setBusy] = useState("");
  const [bulkTo, setBulkTo] = useState("");
  const rows = useStore(rowsStore);

  const list = useQuery<OrdersAnswer>(
    key,
    async ({ prev, reason }) => {
      const since = reason === "auto" && prev ? prev.tag : undefined;
      const a = await listOrders({ ...q, since });
      if (a.unchanged && prev) return prev;
      return a as OrdersAnswer;
    },
    { keep: true },
  );

  /* a new filter is a new list: nothing selected, nothing open */
  const filterSig = JSON.stringify({ ...paramsOf(f), page: undefined });
  const firstSig = useRef(filterSig);
  useEffect(() => {
    if (firstSig.current === filterSig) return;
    firstSig.current = filterSig;
    setSel([]);
    rowsStore.set(forget());
  }, [filterSig]);

  /* a link that opens one order (#orders?q=LM-1&open=LM-1) */
  useEffect(() => {
    if (r.params.open) {
      rowsStore.set(openOnly(rowsStore.get(), r.params.open));
      setParams({ open: undefined });
    }
  }, [r.params.open]);

  /* the search box types into the address a moment after the last key */
  const [qText, setQText] = useState(f.q);
  const typed = useRef(f.q);
  useEffect(() => {
    if (f.q !== typed.current) {
      typed.current = f.q;
      setQText(f.q);
    }
  }, [f.q]);
  useEffect(() => {
    if (qText === typed.current) return;
    const t = setTimeout(() => {
      typed.current = qText;
      update({ q: qText.trim() });
    }, 300);
    return () => clearTimeout(t);
  }, [qText]);

  const update = (next: Partial<Filters>) => setParams(paramsOf({ ...f, page: 1, ...next }), false);

  const routes = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of cat.data?.data.countries || []) m[c.code] = c.courier === "manual" ? "manual" : "omniful";
    return m;
  }, [cat.data]);

  const data = list.data;
  const orders = data?.orders || [];
  const unsure = data?.empowerUnsure || [];
  const total = data?.total || 0;
  const pageIds = orders.map((o) => o.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.indexOf(id) > -1);

  const pick = (id: string, on: boolean) => setSel((s) => (on ? [...s.filter((x) => x !== id), id] : s.filter((x) => x !== id)));

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy("");
    }
  };

  const selectAllMatching = () =>
    run("all", async () => {
      const ids: string[] = [];
      const all = queryOf(f, now, true);
      for (let off = 0; off < 20000; off += 500) {
        const a = (await listOrders({ ...all, limit: 500, offset: off })) as OrdersAnswer;
        ids.push(...a.orders.map((o) => o.id));
        if (ids.length >= a.total || !a.orders.length) break;
      }
      setSel(ids);
    });

  const done = async (msg: string, ok = true) => {
    setSel([]);
    await afterOrderWrite();
    toast(msg, ok);
  };

  const bulkStatus = () =>
    run("status", async () => {
      if (!bulkTo) return toast("Pick a status first");
      if (!(await ask({ title: "Set " + plural(sel.length, "order") + " to “" + STATUS[bulkTo] + "”?", ok: "Set status" }))) return;
      let force = false;
      for (;;) {
        try {
          const a = await chunked(sel, (ids) => bulk({ op: "status", ids, to: bulkTo as "new", force }));
          return done(plural(a.updated, "order") + " updated" + staleWord(a.stale), !a.stale.length);
        } catch (e) {
          const ids = isApiError(e) && Array.isArray(e.extra.ids) ? (e.extra.ids as string[]) : [];
          if (!force && isApiError(e, "moving_back")) {
            force = await ask({ title: "Move back?", text: ids.join(", ") + (ids.length === 1 ? " is" : " are") + " already shipped or delivered. Move " + (ids.length === 1 ? "it" : "them") + " back to " + STATUS[bulkTo] + " anyway?", ok: "Move back", danger: true });
            if (force) continue;
            return;
          }
          if (!force && isApiError(e, "parcel_live")) {
            force = await ask({ title: "Cancel orders with a parcel?", text: String(e.extra.detail || ids.join(", ")) + "\n\nThis does NOT cancel the courier parcel. Take it off Empower first. Cancel anyway?", ok: "Cancel anyway", danger: true });
            if (force) continue;
            return;
          }
          throw e;
        }
      }
    });

  const bulkFlag = () =>
    run("flag", async () => {
      const allFlagged = sel.every((id) => orders.find((o) => o.id === id)?.flagged);
      const a = await chunked(sel, (ids) => bulk({ op: "flag", ids, on: !allFlagged }));
      await done((allFlagged ? "Flag cleared on " : "Flagged ") + plural(a.updated, "order"));
    });

  const bulkMove = (op: "trash" | "restore" | "purge") =>
    run(op, async () => {
      if (op === "purge" && !(await ask({ title: "Delete " + plural(sel.length, "order") + " forever?", text: "This cannot be undone. Paid orders are kept (accounting records).", ok: "Delete forever", danger: true }))) return;
      const a = await chunked(sel, (ids) => bulk({ op, ids }));
      await done(plural(a.updated, "order") + (op === "trash" ? " moved to trash" : op === "restore" ? " restored" : " deleted"));
    });

  const bulkPush = () =>
    run("push", async () => {
      if (!(await ask({ title: "Push " + plural(sel.length, "order") + " to Empower?", text: "Omniful's warehouse will pick, pack and ship them, and each moves to Preparing. Orders that already have a parcel are skipped.", ok: "Push to Empower" }))) return;
      let sent = 0;
      let skipped = 0;
      const failed: string[] = [];
      for (const id of sel) {
        try {
          const o = await pushOne(id);
          if (o.kind === "sent") sent++;
          else skipped++;
        } catch (e) {
          failed.push(id + ": " + explain(e));
        }
      }
      await done(sent + " sent to Empower" + (skipped ? " · " + skipped + " skipped" : "") + (failed.length ? " · " + failed.length + " refused: " + failed[0] : ""), !failed.length);
    });

  const trashView = f.trash;
  const countries = [{ value: "", label: "Any country" }, ...MARKETS.map((c) => ({ value: c, label: COUNTRY_EN[c] || c }))];

  return (
    <>
      <div class="toolbar" role="search" aria-label="Filter orders">
        <SearchField value={qText} onInput={setQText} label="Search orders" placeholder="Search order, name, phone, city, tracking…" />
        <Btn sm icon="trash" aria-pressed={trashView} onClick={() => update({ trash: !trashView })}>
          {trashView ? "Back to orders" : "Trash"}
        </Btn>
        <MultiSelect label="Order status" options={STATUS_FILTER} value={f.status} onChange={(status) => update({ status })} searchLabel="Search statuses" />
        <Select label="Payment" value={f.payment} onChange={(payment) => update({ payment })} options={PAYMENT_OPTIONS} />
        <Select label="Country" value={f.country} onChange={(country) => update({ country })} options={countries} />
        <DateRange value={f.range} onChange={(range) => update({ range })} now={now} label="Placed" />
        <a class="btn sm" href={exportUrl(queryOf(f, now, true))} download aria-label="Export these orders as CSV">
          <Icon name="download" />
          <span>CSV</span>
        </a>
        {!trashView ? (
          <Btn sm kind="primary" icon="plus" onClick={() => setNewOrder(true)}>
            New order
          </Btn>
        ) : null}
      </div>

      {sel.length ? (
        <div class="bulk" id="bulkBar" role="region" aria-label="Selected orders">
          <span>
            <b>{sel.length}</b> selected
            {allOnPage && total > sel.length ? (
              <button type="button" class="lnk" onClick={selectAllMatching} disabled={busy === "all"}>
                Select all {total} matching
              </button>
            ) : null}
          </span>
          <div class="bulk-actions">
            {!trashView ? (
              <>
                <Select
                  sm
                  label="Set status"
                  value={bulkTo}
                  onChange={setBulkTo}
                  options={[{ value: "", label: "Set status…" }, ...["new", "prep", "ship", "done", "void"].map((s) => ({ value: s, label: STATUS[s]! }))]}
                />
                <Btn sm busy={busy === "status"} onClick={bulkStatus}>
                  Apply
                </Btn>
                <Btn sm icon="box" busy={busy === "push"} onClick={bulkPush} title="Send the selected orders to Omniful">
                  Push to Empower
                </Btn>
                <Btn sm icon="flag" busy={busy === "flag"} onClick={bulkFlag} title="Flag the selected orders (again to clear)">
                  Flag
                </Btn>
                <Btn sm icon="trash" busy={busy === "trash"} onClick={() => bulkMove("trash")}>
                  Trash
                </Btn>
              </>
            ) : (
              <>
                <Btn sm icon="undo" busy={busy === "restore"} onClick={() => bulkMove("restore")}>
                  Restore
                </Btn>
                <Btn sm kind="danger" icon="x" busy={busy === "purge"} onClick={() => bulkMove("purge")}>
                  Delete forever
                </Btn>
              </>
            )}
            <Btn sm kind="ghost" onClick={() => setSel([])}>
              Clear
            </Btn>
          </div>
        </div>
      ) : null}

      <section class="card flush" aria-label={trashView ? "Orders in the trash" : "Orders"}>
        {trashView ? <p class="note info trash-note">The trash: restore an order, or delete it forever (never a paid one).</p> : null}
        <div class="tablewrap orders-wrap">
          <table class="tbl orders-tbl" id="ordersTbl" aria-busy={list.loading ? "true" : "false"}>
            <thead>
              <tr>
                <th class="tick">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = sel.length > 0 && !allOnPage;
                    }}
                    onChange={(e) => setSel((e.currentTarget as HTMLInputElement).checked ? [...new Set([...sel, ...pageIds])] : sel.filter((x) => pageIds.indexOf(x) < 0))}
                  />
                </th>
                <th>Order</th>
                <th>Customer</th>
                <th class="hide-sm">Destination</th>
                <th>Total</th>
                <th>Status</th>
                <th class="hide-sm">Placed</th>
                <th>
                  <span class="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody id="ordersBody">
              {orders.map((o: OrderListRow) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  selected={sel.indexOf(o.id) > -1}
                  onSelect={(on) => pick(o.id, on)}
                  open={rows.open.indexOf(o.id) > -1}
                  pinned={rows.pinned.indexOf(o.id) > -1}
                  unsure={unsure.indexOf(o.id) > -1}
                  route={routes[o.countryCode] || "omniful"}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!orders.length ? (
          <Empty>
            {list.error
              ? "Could not read the orders: " + explain(list.error)
              : list.loading && !data
                ? "Loading…"
                : trashView
                  ? "The trash is empty."
                  : filtered(f)
                    ? "No orders match these filters."
                    : "No orders yet."}
          </Empty>
        ) : null}
        <Pager offset={(f.page - 1) * PER_PAGE} limit={PER_PAGE} total={total} onPage={(off) => setParams({ page: off ? String(off / PER_PAGE + 1) : undefined })} />
      </section>

      <ManualOrder
        open={newOrder}
        onClose={() => setNewOrder(false)}
        onCreated={(id) => {
          setNewOrder(false);
          rowsStore.set(openOnly(rowsStore.get(), id));
        }}
      />
    </>
  );
}
