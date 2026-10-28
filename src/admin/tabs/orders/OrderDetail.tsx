/**
 * ONE ORDER, OPEN — read from GET /orders/:id (the row, its history, its Empower sends), the
 * list's row shown until it arrives.
 *
 *   the top line   placed; the invoice and its link; the WhatsApp message the order is owed
 *                  (confirmation / payment reminder with the card and cash links / win-back /
 *                  refund note) as a wa.me link and a copy; the Aramex tracking message; the
 *                  tracking link
 *   Customer       who and where (Edit)
 *   Items          what is on it and the totals (Edit: re-quoted by the server)
 *   Payment        method, state, card, fee and net, cash collected by hand, the gateway
 *                  payload on demand
 *   Fulfilment     the status flow, tracking by hand, Empower, the shop's note, flag, trash
 *   History        every change (order_events)
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { OrderDetailAnswer, OrderListRow, ShipmentSummary } from "../../../shared/admin/api";
import { orderDetail, orderGateway, setPayment } from "../../data/endpoints";
import { afterOrderWrite, KEYS, marketOf, useCatalogue } from "../../data/hooks";
import { useQuery } from "../../data/query";
import { ask, Btn, copyText, CopyBtn, Icon, LinkBtn, toast } from "../../kit";
import { dtt, money } from "../../lib/format";
import { invoiceUrl, lineName, orderPhase, orderTotal, trackingOf, trackLinkOf, trackMessage, WA_LABEL, waLink, waMessage } from "../../lib/order";
import { COUNTRY_EN, explain, PAYSTAT, payWord } from "../../lib/words";
import { CustomerEditor } from "./CustomerEditor";
import { Fulfilment } from "./Fulfilment";
import { History } from "./History";
import { ItemsEditor } from "./ItemsEditor";

export type DetailOrder = OrderDetailAnswer["order"];

/** A shipments row (as the detail sends it) in the list's shape. */
export function summaryOf(r: Record<string, unknown> | undefined): ShipmentSummary | undefined {
  if (!r) return undefined;
  const s = (k: string) => (r[k] == null ? null : String(r[k]));
  return { id: String(r.id), sentId: String(r.sentId || ""), reference: s("reference"), awb: s("awb"), courier: s("courierName"), status: s("status"), at: String(r.createdAt || ""), deliveredAt: s("deliveredAt") };
}

function Dl({ rows }: { rows: Array<[string, ComponentChildren, ("ltr" | "rtl" | "auto")?] | null | false> }) {
  return (
    <dl>
      {rows.filter(Boolean).map((r) => {
        const [k, v, dir] = r as [string, ComponentChildren, ("ltr" | "rtl" | "auto")?];
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

function Gateway({ id }: { id: string }) {
  const [text, setText] = useState<string | null>(null);
  const load = (e: Event) => {
    if (!(e.currentTarget as HTMLDetailsElement).open || text !== null) return;
    setText("Loading…");
    orderGateway(id).then(
      (j) => setText(j.gateway ? JSON.stringify(j.gateway, null, 2) : "No payload stored for this order."),
      (err) => setText("Could not read the payload: " + explain(err)),
    );
  };
  return (
    <details class="raw" onToggle={load}>
      <summary>Full gateway payload</summary>
      <Btn
        sm
        icon="copy"
        onClick={() => {
          if (!text || text === "Loading…") return toast("Still loading. Try again in a moment.");
          copyText(text).then(
            () => toast("Copied", true),
            () => toast("Copy failed"),
          );
        }}
      >
        Copy
      </Btn>
      <pre dir="ltr">{text ?? ""}</pre>
    </details>
  );
}

export function OrderDetail({ row, id, unsure, route }: { row: OrderListRow; id: string; unsure: boolean; route: string }) {
  const q = useQuery(KEYS.order(row.id), () => orderDetail(row.id));
  const cat = useCatalogue();
  const [editCust, setEditCust] = useState(false);
  const [editItems, setEditItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const o: DetailOrder = (d ? { ...d.order, shipment: summaryOf(d.shipments[0]) || row.shipment } : { ...row, check: row.check || [] }) as DetailOrder;
  const country = marketOf(cat.data?.data.countries, o.countryCode);
  const inv = invoiceUrl(o);
  const phase = orderPhase(o);
  const msg = waMessage(o, { country });
  const wa = waLink(o.phone, msg);
  const awb = trackingOf(o);
  const tl = trackLinkOf(o);
  const ps = PAYSTAT[o.paymentStatus];
  const paidHeld = o.paymentStatus === "paid" && o.pay === "card";

  const collected = async (to: "paid" | "cod") => {
    if (!(await ask({ title: to === "paid" ? "Mark the cash as collected?" : "Mark the cash as not collected?", text: o.id + " · " + money(orderTotal(o), o.cur), ok: to === "paid" ? "Collected" : "Not collected" }))) return;
    setBusy(true);
    try {
      await setPayment(o.id, to);
      toast(to === "paid" ? "Cash collected on " + o.id : "Back to cash on delivery", true);
      await afterOrderWrite();
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="det" id={id} role="region" aria-label={"Order " + o.id}>
      <div class="full confirm">
        <span>Placed {dtt(o.createdAt)}</span>
        {inv ? (
          <>
            <LinkBtn sm href={inv} newTab icon="out">
              Invoice
            </LinkBtn>
            <CopyBtn text={() => inv} label="Copy link" done="Invoice link copied" />
          </>
        ) : null}
        {wa ? (
          <LinkBtn sm kind="primary" href={wa} newTab icon="chat" label={"WhatsApp " + WA_LABEL[phase].toLowerCase() + " to " + (o.name || "the customer")}>
            WhatsApp: {WA_LABEL[phase]}
          </LinkBtn>
        ) : null}
        <CopyBtn text={() => msg} label={"Copy " + WA_LABEL[phase].toLowerCase()} done={WA_LABEL[phase] + " copied. Paste it into WhatsApp."} />
        {awb ? (
          <>
            {waLink(o.phone, trackMessage(o, awb)) ? (
              <LinkBtn sm href={waLink(o.phone, trackMessage(o, awb))} newTab icon="chat">
                WhatsApp tracking
              </LinkBtn>
            ) : null}
            <CopyBtn text={() => trackMessage(o, awb)} label="Copy tracking message" done="Tracking message copied. Paste it into WhatsApp." />
          </>
        ) : null}
        {tl ? (
          <LinkBtn sm href={tl.url} newTab icon="truck" title={tl.title}>
            {tl.label}
          </LinkBtn>
        ) : null}
      </div>

      <div class="blk">
        <h4>
          Customer
          {!editCust ? (
            <button class="lnk" type="button" onClick={() => setEditCust(true)} aria-label={"Edit the customer of " + o.id}>
              Edit
            </button>
          ) : null}
        </h4>
        {editCust ? (
          <CustomerEditor order={o} onDone={() => setEditCust(false)} />
        ) : (
          <Dl
            rows={[
              ["Name", o.name || "—"],
              ["Phone", o.phone || "—", "ltr"],
              ["Email", o.email || "—", "ltr"],
              ["Country", (o.country || "") + (COUNTRY_EN[o.countryCode] ? " · " + COUNTRY_EN[o.countryCode] : "")],
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
          {!editItems ? (
            <button class="lnk" type="button" onClick={() => setEditItems(true)} aria-label={"Edit the items of " + o.id}>
              Edit
            </button>
          ) : null}
          {paidHeld || o.refunded ? <span class="muted sml"> paid · Thawani holds {money(Number(o.amountBaisa || 0) / 1000 || orderTotal(o), Number(o.amountBaisa) ? "OMR" : o.cur)}</span> : null}
        </h4>
        {editItems ? (
          <ItemsEditor order={o} onDone={() => setEditItems(false)} />
        ) : (
          <ul class="lines">
            {(o.items || []).map((i, k) => (
              <li key={k}>
                <span dir="auto">
                  {lineName(i)} × {i.qty}
                </span>
                <b>{money(Number(i.price) * Number(i.qty), o.cur)}</b>
              </li>
            ))}
            {!o.items?.length ? <li>—</li> : null}
          </ul>
        )}
        <Dl
          rows={[
            ["Delivery", o.ship ? money(o.ship, o.cur) : "Free"],
            !!o.codFee && ["COD fee", money(o.codFee, o.cur)],
            ["Total", <b key="t">{money(orderTotal(o), o.cur)}</b>],
            o.cur !== "OMR" && ["In OMR", money(o.omr, "OMR")],
          ]}
        />
      </div>

      <div class="blk">
        <h4>Payment</h4>
        <Dl
          rows={[
            ["Method", payWord(o.pay)],
            ["State", (ps ? ps.t : o.paymentStatus) + (o.paidAt ? " · " + dtt(o.paidAt) : "")],
            !!o.maskedCard && ["Card", String(o.maskedCard) + (o.cardType ? " · " + String(o.cardType) : ""), "ltr"],
            o.gatewayFee != null && ["Gateway fee", money(o.gatewayFee, "OMR") + (o.netAmount != null ? " · net " + money(o.netAmount, "OMR") : "")],
            o.refunded && ["Refunded", "Yes"],
            !!o.invoiceNo && ["Invoice", o.invoiceNo, "ltr"],
            !!o.paymentId && ["Payment ID", o.paymentId, "ltr"],
            !!o.expireAt && o.status === "pending" && ["Card page until", dtt(o.expireAt)],
            !!o.lastPaymentError && ["Last error", o.lastPaymentError],
          ]}
        />
        {o.pay === "cod" && !o.refunded && (o.paymentStatus === "cod" || o.paymentStatus === "paid") ? (
          <div class="row-btns" style="margin-top:10px">
            {o.paymentStatus === "cod" ? (
              <Btn sm icon="cash" busy={busy} onClick={() => collected("paid")}>
                Mark cash collected
              </Btn>
            ) : (
              <Btn sm kind="ghost" icon="undo" busy={busy} onClick={() => collected("cod")}>
                Mark not collected
              </Btn>
            )}
          </div>
        ) : null}
      </div>

      <div class="blk">
        <h4>Shipping to</h4>
        <Dl
          rows={[
            ["Market", COUNTRY_EN[o.countryCode] || o.countryCode],
            ["Ships with", route === "manual" ? "By hand (tracking typed here)" : "Empower (Omniful)"],
            !!o.tracking && ["Tracking", (o.carrier ? o.carrier + " · " : "") + o.tracking, "ltr"],
            !!o.shippedAt && ["Shipped", dtt(o.shippedAt)],
            !!o.deliveredAt && ["Delivered", dtt(o.deliveredAt)],
          ]}
        />
      </div>

      <Fulfilment order={o} shipments={d?.shipments || []} unsure={unsure} route={route} />

      <div class="full">
        <h4>History</h4>
        {d ? <History events={d.events} /> : <p class="hint">{q.error ? explain(q.error) : "Loading…"}</p>}
      </div>

      {o.hasGateway ? (
        <div class="full">
          <Gateway id={o.id} />
        </div>
      ) : null}
      {!d && q.loading ? (
        <p class="full hint sml" aria-live="polite">
          <Icon name="refresh" /> Reading the order…
        </p>
      ) : null}
    </div>
  );
}
