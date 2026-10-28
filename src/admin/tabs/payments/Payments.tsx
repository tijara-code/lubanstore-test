/**
 * PAYMENTS — every card order, and what the gateway did with it (the original's v446 page).
 *
 * Thawani has no "list every payment" call, so the list is OUR card orders, newest first, each
 * carrying what the return check and the webhook wrote on it (payment id, masked card, card type,
 * the gateway's fee). Only the gaps — abandoned and declined attempts, which never came back —
 * are looked up, and only when asked: the tab's first read asks about up to 12 (the server's cap),
 * Refresh and the five-minute timer ask about none (`lookups: 0`), "Ask Thawani now" asks again.
 * Every page of the range is read (100 a call, up to 2,000 rows) so the tiles and the state
 * filter count every row, not the first page (v446).
 *
 *   toolbar   the state (All · Settled · Pending · Failed · Refunded), search, the dates (Muscat
 *             days, read by the server), "N not fetched from Thawani yet", Ask Thawani now, CSV
 *   tiles     Collected (net to the bank · refunded), Pending (waiting), Settled (fees),
 *             Transactions, Failed — all over the rows the filters let through
 *   table     20 a page; a row opens its detail (PaymentDetail): the ids, the card, the fee,
 *             the raw payloads, Ask Thawani, Refund, Mark paid by hand
 *
 * Cash on delivery is not on this page (as the original): the server lists card orders only.
 * The filters live in the address: #payments?state=failed&q=…&range=30&page=2.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { setParams, useRoute } from "../../app/route";
import { listPayments, type PaymentRow } from "../../data/insights";
import { useQuery } from "../../data/query";
import { Btn, DateRange, Empty, Kpi, Kpis, Pager, Pill, SearchField, Seg, copyText, resolveRange, toast, type Range } from "../../kit";
import { downloadCsv } from "../../lib/csv";
import { dtt, money, plural } from "../../lib/format";
import { isApiError } from "../../data/api";
import { canRefund, payCsv, payKinds, payLinkOf, payRefusal, payRows, payState, payTotals, PAY_FILTERS, type PayFilter } from "./pay";
import { PaymentDetail, RefundDialog } from "./PaymentDetail";

export const PER_PAGE = 20;
/** rows read a call, and in all (the original's PAY_ALL_MAX) */
export const PAY_CALL = 100;
export const PAY_ALL_MAX = 2000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface PayFilters {
  kind: PayFilter;
  q: string;
  range: Range;
  page: number;
}

export function payFiltersOf(p: Record<string, string>): PayFilters {
  const pre = p.range || "";
  const from = DAY.test(p.from || "") ? p.from! : "";
  const to = DAY.test(p.to || "") ? p.to! : "";
  return {
    kind: (PAY_FILTERS.some((x) => x.value === p.state) ? p.state : "all") as PayFilter,
    q: p.q || "",
    range: pre ? { pre, from: "", to: "" } : from || to ? { pre: "", from, to } : { pre: "all", from: "", to: "" },
    page: Math.max(1, parseInt(p.page || "1", 10) || 1),
  };
}

export function payParamsOf(f: PayFilters): Record<string, string | undefined> {
  return {
    state: f.kind !== "all" ? f.kind : undefined,
    q: f.q || undefined,
    range: f.range.pre && f.range.pre !== "all" ? f.range.pre : undefined,
    from: !f.range.pre && f.range.from ? f.range.from : undefined,
    to: !f.range.pre && f.range.to ? f.range.to : undefined,
    page: f.page > 1 ? String(f.page) : undefined,
  };
}

export interface Loaded {
  rows: PaymentRow[];
  /** gaps on the first page not asked about */
  pending: number;
  gateway: boolean;
  capped: boolean;
}

/* the first read of the session asks Thawani about the gaps (the original's tab open); after
   that only the button does */
let firstRead = true;
let askNext = false;
export function resetPaymentsSession(): void {
  firstRead = true;
  askNext = false;
}

/** Every row of the range: page after page of our own records; Thawani asked (if at all) on the first. */
export async function loadAll(span: { from: string; to: string }, lookups: number | undefined): Promise<Loaded> {
  const rows: PaymentRow[] = [];
  let pending = 0;
  let gateway = true;
  for (let skip = 0; skip < PAY_ALL_MAX; skip += PAY_CALL) {
    const a = await listPayments({ limit: PAY_CALL, skip, lookups: skip === 0 ? lookups : 0, from: span.from || undefined, to: span.to || undefined });
    if (skip === 0) {
      pending = a.pending || 0;
      gateway = a.gateway;
    }
    rows.push(...a.rows);
    if (!a.more) return { rows, pending, gateway, capped: false };
  }
  return { rows, pending, gateway, capped: true };
}

export function Payments() {
  const r = useRoute();
  const f = payFiltersOf(r.params);
  const now = Date.now();
  const span = resolveRange(f.range, now);
  const key = "payments:list?" + (span.from || "") + ".." + (span.to || "");
  const [open, setOpen] = useState("");
  const [asking, setAsking] = useState(false);
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);

  const list = useQuery<Loaded>(
    key,
    async () => {
      const lookups = askNext ? 12 : firstRead ? undefined : 0;
      askNext = false;
      firstRead = false;
      return loadAll(span, lookups);
    },
    { keep: true },
  );

  /* the search box writes the address a moment after the last key */
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
    }, 250);
    return () => clearTimeout(t);
  }, [qText]);

  const update = (next: Partial<PayFilters>) => setParams(payParamsOf({ ...f, page: 1, ...next }), false);

  const all = list.data?.rows || [];
  const rows = payRows(all, { kind: f.kind, q: f.q });
  const t = payTotals(rows);
  const k = payKinds(rows);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const page = Math.min(f.page, pages);
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const askThawaniNow = async () => {
    setAsking(true);
    askNext = true;
    try {
      await list.refetch("refresh");
      toast("Asked Thawani", true);
    } finally {
      askNext = false;
      setAsking(false);
    }
  };

  const exportCsv = () => {
    if (!rows.length) return toast("Nothing to export");
    downloadCsv("thawani-payments.csv", payCsv(rows));
    toast("Exported " + plural(rows.length, "transaction"), true);
  };

  const err = list.error;
  const emptyText = err
    ? isApiError(err, "thawani_not_configured")
      ? "No Thawani keys are set on the server yet."
      : "Could not read the payments: " + payRefusal(err)
    : list.loading && !list.data
      ? "Loading…"
      : all.length
        ? "No transactions match these filters."
        : "No transactions yet.";

  return (
    <>
      <div class="toolbar pay-bar" role="search" aria-label="Filter payments">
        <Seg label="Status" value={f.kind} options={PAY_FILTERS} onChange={(kind) => update({ kind })} />
        <SearchField value={qText} onInput={setQText} label="Search payments" placeholder="Order, invoice, payment id, card…" />
        <DateRange value={f.range} onChange={(range) => update({ range })} now={now} label="Paid or tried" />
        {list.data?.pending ? <span class="stamp">{list.data.pending} not fetched from Thawani yet</span> : null}
        {list.data && !list.data.gateway ? <span class="stamp">No Thawani keys: card details not looked up</span> : null}
        <Btn sm icon="refresh" busy={asking} onClick={askThawaniNow} title="Look up the attempts we never heard back about (the only control here that calls Thawani)">
          Ask Thawani now
        </Btn>
        <Btn sm icon="download" onClick={exportCsv} label="Export these transactions as CSV">
          CSV
        </Btn>
      </div>

      <Kpis five label="Payment figures">
        <Kpi icon="coin" tone="brand" dark label="Collected" value={money(t.gross, "OMR")} delta={money(t.net, "OMR") + " net to the bank" + (t.refundedN ? " · " + money(t.refunded, "OMR") + " refunded" : "")} />
        <Kpi icon="clock" tone="amber" label="Pending" value={money(k.pendingOmr, "OMR")} delta={k.pending ? k.pending + " waiting" : ""} />
        <Kpi icon="check" tone="leaf" label="Settled" value={String(k.settled)} delta={money(t.fees, "OMR") + " in fees"} />
        <Kpi icon="card" tone="blue" label="Transactions" value={String(k.all)} />
        <Kpi icon="alert" tone="red" label="Failed" value={String(k.failed)} delta={k.failed ? "card attempts that did not go through" : ""} up={k.failed ? false : null} />
      </Kpis>
      {list.data?.capped ? <p class="note warn">The newest {PAY_ALL_MAX} transactions only: narrow the dates to see older ones.</p> : null}

      <section class="card flush" aria-label="Transactions">
        <div class="card-head">
          <h2>Transactions</h2>
        </div>
        <div class="tablewrap orders-wrap">
          <table class="tbl pay-tbl" aria-busy={list.loading ? "true" : "false"}>
            <thead>
              <tr>
                <th>Total</th>
                <th>Fees</th>
                <th>Net</th>
                <th class="hide-sm">Invoice</th>
                <th>Order</th>
                <th>Status</th>
                <th class="hide-sm">Card</th>
                <th class="hide-sm">Date</th>
                <th>
                  <span class="vh">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <PayRow
                  key={row.orderId || row.paymentId || row.invoice}
                  row={row}
                  open={open === rowKey(row)}
                  onToggle={() => setOpen(open === rowKey(row) ? "" : rowKey(row))}
                  onRefund={() => setRefunding(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length ? <Empty>{emptyText}</Empty> : null}
        <Pager offset={(page - 1) * PER_PAGE} limit={PER_PAGE} total={rows.length} onPage={(off) => setParams({ page: off ? String(off / PER_PAGE + 1) : undefined })} />
      </section>
      {refunding ? <RefundDialog row={refunding} onClose={() => setRefunding(null)} /> : null}
    </>
  );
}

const rowKey = (r: PaymentRow) => r.orderId || r.paymentId || r.invoice;

function PayRow({ row, open, onToggle, onRefund }: { row: PaymentRow; open: boolean; onToggle: () => void; onRefund: () => void }) {
  const st = payState(row);
  const link = payLinkOf(row, location.origin);
  // a click on the row opens it, except on its own controls
  const click = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    onToggle();
  };
  return (
    <>
      <tr class={"row" + (open ? " open-row" : "")} data-pay={rowKey(row)} onClick={click}>
        <td class="num">
          <b>{money(row.amount, "OMR")}</b>
        </td>
        <td class="num">{money(row.fee, "OMR")}</td>
        <td class="num">{money(row.net, "OMR")}</td>
        <td class="hide-sm id">{row.invoice || "—"}</td>
        <td class="id">
          {row.orderId || <span class="muted">—</span>}
          {row.customer ? (
            <em class="sub" dir="auto">
              {row.customer}
            </em>
          ) : null}
        </td>
        <td>
          <Pill tone={st.c}>{st.t}</Pill>
          {row.refunds && row.refunds.length && row.refunds[0]!.reason ? <em class="sub">{row.refunds[0]!.reason}</em> : null}
          {row.stale ? <em class="sub">not checked with Thawani</em> : null}
        </td>
        <td class="hide-sm" dir="ltr">
          {row.card || "—"}
          {row.cardType ? <em class="sub">{row.cardType}</em> : null}
        </td>
        <td class="hide-sm num">{dtt(row.at)}</td>
        <td class="acts-td">
          <div class="acts">
            {link ? (
              <Btn
                sm
                icon="link"
                title="Copy a payment link for this order"
                onClick={() =>
                  copyText(link).then(
                    () => toast("Payment link copied", true),
                    () => toast("Could not copy. Check clipboard permission."),
                  )
                }
              >
                Pay link
              </Btn>
            ) : null}
            {canRefund(row) ? (
              <Btn sm kind="danger" onClick={onRefund}>
                Refund
              </Btn>
            ) : null}
            <Btn sm kind="ghost" iconOnly icon="chev" class="chev" label={(open ? "Close " : "Open ") + (row.orderId || "payment")} aria-expanded={open} onClick={onToggle} />
          </div>
        </td>
      </tr>
      {open ? (
        <tr class="detail" data-pay-detail={rowKey(row)}>
          <td colSpan={9}>
            <PaymentDetail row={row} onRefund={onRefund} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

