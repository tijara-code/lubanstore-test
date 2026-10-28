/**
 * ONE ORDER AS THE WAREHOUSE WILL BE TOLD IT — who, where, what (with the SKU each line goes
 * out as), how it is paid and what to collect. On the Waiting list the Customer and the Items
 * carry an Edit (phase 1's editors, the items in the "adjust before push" mode: sold out
 * allowed, v189), inside this row. A pushed order's copy is read-only: Omniful already holds
 * what it was sent.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { OrderLine } from "../../../shared/orders/types";
import { orderDetail } from "../../data/endpoints";
import { KEYS } from "../../data/hooks";
import { invalidate, useQuery } from "../../data/query";
import { dtt, money } from "../../lib/format";
import { lineName, orderTotal } from "../../lib/order";
import { COUNTRY_EN, explain, originWord, PAYSTAT, payWord } from "../../lib/words";
import { CustomerEditor } from "../orders/CustomerEditor";
import { ItemsEditor } from "../orders/ItemsEditor";
import type { DetailOrder } from "../orders/OrderDetail";

export function Dl({ rows }: { rows: Array<[string, ComponentChildren, ("ltr" | "auto")?] | null | false> }) {
  return (
    <dl>
      {rows.filter(Boolean).map((r) => {
        const [k, v, dir] = r as [string, ComponentChildren, ("ltr" | "auto")?];
        return [
          <dt key={k + "t"}>{k}</dt>,
          <dd key={k + "d"} dir={dir || "auto"}>
            {v}
          </dd>,
        ];
      })}
    </dl>
  );
}

/** The SKU an item line goes out as: its code, its boxes (a set or a large-box offer), or none. */
export function skuWord(itemId: string, skus: Record<string, string>): { text: string; tone: "" | "muted" | "warn" } {
  const code = skus[itemId];
  if (code) return { text: code, tone: "" };
  if (itemId === "bundle") return { text: "as its 3 boxes", tone: "muted" };
  if (/^(duo|trio):/.test(itemId)) return { text: "as its boxes", tone: "muted" };
  return { text: "no SKU", tone: "warn" };
}

export function OrderBlocks({ o, skus, editable, lines }: { o: DetailOrder; skus: Record<string, string>; editable: boolean; lines?: Array<{ code: string; sku: string; qty: number }> }) {
  const [editCust, setEditCust] = useState(false);
  const [editItems, setEditItems] = useState(false);
  const ps = PAYSTAT[o.paymentStatus];
  const cod = o.paymentStatus === "cod" || (o.pay === "cod" && o.paymentStatus !== "paid");
  const done = (set: (v: boolean) => void) => () => {
    set(false);
    invalidate((k) => k.startsWith("empower"));
  };
  return (
    <>
      <div class="blk">
        <h4>
          Customer
          {editable && !editCust ? (
            <button class="lnk" type="button" onClick={() => setEditCust(true)} aria-label={"Edit the customer of " + o.id}>
              Edit
            </button>
          ) : null}
        </h4>
        {editCust ? (
          <CustomerEditor order={o} onDone={done(setEditCust)} />
        ) : (
          <Dl
            rows={[
              ["Name", o.name || "—"],
              ["Phone", o.phone || "—", "ltr"],
              !!o.email && ["Email", o.email, "ltr"],
              ["Country", (o.country || o.countryCode) + (COUNTRY_EN[o.countryCode] ? " · " + COUNTRY_EN[o.countryCode] : "")],
              [o.countryCode === "OM" ? "Governorate" : "City", o.city || "—"],
              ["Area", o.region || "—"],
              !!o.note && ["Customer note", o.note],
            ]}
          />
        )}
      </div>
      <div class="blk">
        <h4>
          Items
          {editable && !editItems ? (
            <button class="lnk" type="button" onClick={() => setEditItems(true)} aria-label={"Edit the items of " + o.id}>
              Edit
            </button>
          ) : null}
        </h4>
        {editItems ? (
          <ItemsEditor order={o} manual onDone={done(setEditItems)} />
        ) : (
          <ul class="lines omf-items">
            {(o.items || []).map((i: OrderLine, k: number) => {
              const s = skuWord(i.itemId, skus);
              return (
                <li key={k}>
                  <span dir="auto">
                    {lineName(i)} × {i.qty}
                  </span>
                  <span class={"sku-of " + s.tone}>{s.tone ? s.text : <code dir="ltr">{s.text}</code>}</span>
                  <b>{money(Number(i.price) * Number(i.qty), o.cur)}</b>
                </li>
              );
            })}
            {!o.items?.length ? <li>—</li> : null}
          </ul>
        )}
        <Dl
          rows={[
            ["Delivery", o.ship ? money(o.ship, o.cur) : "Free"],
            !!o.codFee && ["COD fee", money(o.codFee, o.cur)],
            ["Total", <b key="t">{money(orderTotal(o), o.cur)}</b>],
            !!(lines && lines.length) && ["Warehouse lines", <span key="w" dir="ltr">{lines!.map((l) => l.qty + "× " + l.sku).join(" · ")}</span>],
          ]}
        />
      </div>
      <div class="blk">
        <h4>Payment</h4>
        <Dl
          rows={[
            ["Method", payWord(o.pay)],
            ["State", ps ? ps.t : o.paymentStatus || "—"],
            ["Collect", cod ? <span key="c"><b>{money(orderTotal(o), o.cur)}</b> on delivery</span> : "Nothing (paid)"],
          ]}
        />
      </div>
      <div class="blk">
        <h4>Order</h4>
        <Dl
          rows={[
            ["Placed", dtt(o.createdAt)],
            !!o.origin && ["Source", originWord(o.origin) || o.origin],
            !!o.adminNote && ["Internal note", o.adminNote],
          ]}
        />
      </div>
    </>
  );
}

/** The order, read for its row (GET /orders/:id; shared with the Orders tab's cache key). */
export function useOrder(id: string | null) {
  return useQuery(id ? KEYS.order(id) : null, () => orderDetail(id!));
}

export function Loading({ q }: { q: { error?: unknown; loading?: boolean } }) {
  return <p class="hint full">{q.error ? "Could not read the order: " + explain(q.error) : "Reading the order…"}</p>;
}
