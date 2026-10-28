/**
 * ONE CUSTOMER — a dialog over the Customers tab: who they are (name, phone with a WhatsApp link,
 * markets, orders, spend, band, first and last order), their orders (newest first, each a link
 * that opens it on the Orders tab), and the shop's note and tags about them (PUT /customers/:key;
 * both empty removes the record). The orders themselves are never touched from here.
 */
import { useState } from "preact/hooks";
import type { CustomerRow, OrderListRow, OrdersAnswer } from "../../../shared/admin/api";
import { navigate } from "../../app/route";
import { listOrders } from "../../data/endpoints";
import { saveCustomer } from "../../data/insights";
import { invalidate, useQuery } from "../../data/query";
import { Btn, Empty, Field, LinkBtn, Modal, Pill, toast } from "../../kit";
import { dt, dtt, money, waDigits } from "../../lib/format";
import { orderTotal } from "../../lib/order";
import { COUNTRY_EN, explain, STATUS } from "../../lib/words";
import { bandOf, CUSTOMERS_KEY, omr, tagsOf } from "./crm";

const SAY: Record<string, string> = { bad_phone_key: "That customer has no usable phone number to keep a note against." };

export function CustomerDialog({ customer: c, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const orders = useQuery<OrderListRow[]>("customers:orders:" + c.phoneKey, async () => {
    const a = (await listOrders({ q: c.phoneKey, limit: 100 })) as OrdersAnswer;
    return a.orders.filter((o) => o.phoneKey === c.phoneKey);
  });
  const [note, setNote] = useState(c.note);
  const [tags, setTags] = useState(c.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const band = bandOf(c.spend);
  const changed = note.trim() !== c.note || tagsOf(tags).join(",") !== c.tags.join(",");

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const a = await saveCustomer(c.phoneKey, { note: note.trim(), tags: tagsOf(tags) });
      setTags(a.tags.join(", "));
      toast(a.removed ? "Note and tags cleared" : "Saved. Orders untouched.", true);
      await invalidate(CUSTOMERS_KEY);
    } catch (e) {
      setErr((e as { code?: string }).code && SAY[(e as { code: string }).code] ? SAY[(e as { code: string }).code]! : explain(e));
    } finally {
      setBusy(false);
    }
  };

  const open = (id: string) => {
    onClose();
    navigate("orders", { q: id, open: id });
  };

  return (
    <Modal open wide onClose={onClose} title={<span dir="auto">{c.name || c.phone || "Customer"}</span>}>
      <div class="cust-det">
        <dl class="cust-facts">
          <dt>Phone</dt>
          <dd dir="ltr">
            {c.phone || "—"}
            {c.phone ? (
              <LinkBtn sm kind="ghost" icon="chat" href={"https://wa.me/" + waDigits(c.phone)} newTab label={"WhatsApp " + (c.name || c.phone)}>
                WhatsApp
              </LinkBtn>
            ) : null}
          </dd>
          <dt>Country</dt>
          <dd>{c.countries.map((k) => COUNTRY_EN[k] || k).join(", ") || "—"}</dd>
          <dt>Orders</dt>
          <dd>
            {c.orders} · {c.live} live
          </dd>
          <dt>Spend</dt>
          <dd>
            {omr(c.spend)} OMR {band.id !== "low" ? <Pill tone={"rank-" + band.id}>{band.label}</Pill> : null}
          </dd>
          <dt>First order</dt>
          <dd>{dt(c.first)}</dd>
          <dt>Last order</dt>
          <dd>{dt(c.last)}</dd>
        </dl>

        <div class="cust-orders">
          <h3>
            Orders
            <button type="button" class="lnk" onClick={() => (onClose(), navigate("orders", { q: c.phoneKey }))}>
              Show in Orders
            </button>
          </h3>
          {orders.data ? (
            orders.data.length ? (
              orders.data.map((o) => (
                <button type="button" class="mini" key={o.id} onClick={() => open(o.id)} aria-label={"Open order " + o.id}>
                  <div class="grow">
                    <b class="mono">{o.id}</b>
                    <span>{dtt(o.createdAt)}</span>
                  </div>
                  <span class="val">{money(orderTotal(o), o.cur)}</span>
                  <Pill tone={o.status}>{STATUS[o.status] || o.status}</Pill>
                </button>
              ))
            ) : (
              <Empty>No orders found under this phone.</Empty>
            )
          ) : (
            <Empty>{orders.error ? explain(orders.error) : "Loading…"}</Empty>
          )}
        </div>

        <div class="cust-note">
          <Field label="Note (the shop's own, never on an order)">
            <textarea rows={3} maxLength={1000} value={note} dir="auto" onInput={(e) => setNote((e.currentTarget as HTMLTextAreaElement).value)} />
          </Field>
          <Field label="Tags (comma separated)">
            <input type="text" value={tags} placeholder="vip, wholesale" autocomplete="off" onInput={(e) => setTags((e.currentTarget as HTMLInputElement).value)} />
          </Field>
          {err ? (
            <p class="note warn" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      </div>
      <div class="dlg-foot">
        <Btn sm kind="ghost" onClick={onClose}>
          Close
        </Btn>
        <Btn sm kind="primary" busy={busy} disabled={!changed} onClick={save}>
          Save note and tags
        </Btn>
      </div>
    </Modal>
  );
}
