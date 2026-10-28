/**
 * One order in the list, and its detail under it when open.
 *
 * The whole row opens the order (a click on a control inside it does only that control's
 * job). Cells: the tick, the number with where it came from, the customer, the destination,
 * the total in its currency, the pills (the status in Empower's words, the payment state, the
 * courier — Empower / "Empower?" while a push is being checked / shipped by hand — and "Check:
 * phone digits, area …" for what a courier would lack), when it was placed (viewer's time),
 * then the flag, the tracking link, the pin and the chevron.
 */
import type { OrderListRow } from "../../../shared/admin/api";
import { setFlag } from "../../data/endpoints";
import { afterOrderWrite } from "../../data/hooks";
import { Icon, Pill, toast } from "../../kit";
import { dtt, money } from "../../lib/format";
import { orderTotal, trackLinkOf } from "../../lib/order";
import { CHECK_WORD, EMP_PILL, empowerOf, empStatus, explain, originWord, PAYSTAT } from "../../lib/words";
import { OrderDetail } from "./OrderDetail";
import { pin, rowsStore, toggle } from "./rows";

export function StatusPills({ o, unsure, route }: { o: OrderListRow; unsure: boolean; route: string }) {
  const w = empStatus(o);
  const ps = PAYSTAT[o.paymentStatus];
  const e = empowerOf(o);
  const check = (o.status === "new" || o.status === "prep") && o.check && o.check.length ? o.check.map((k) => CHECK_WORD[k] || k) : [];
  return (
    <div class="pills">
      <Pill tone={EMP_PILL[w] || "prep"}>{w}</Pill>
      {ps ? <Pill tone={ps.c}>{ps.t}</Pill> : null}
      {e ? (
        <Pill tone="empower" title="Pushed to Empower (Omniful)">
          Empower
        </Pill>
      ) : unsure ? (
        <Pill tone="empower unsure" title="A push got no answer from Omniful. The next push checks it and records it.">
          Empower?
        </Pill>
      ) : route === "manual" ? (
        <Pill tone="manual" title={o.tracking ? "Shipped by hand: " + (o.carrier ? o.carrier + " " : "") + o.tracking : "This market is shipped by hand"}>
          By hand
        </Pill>
      ) : null}
      {check.length ? (
        <Pill tone="red" title={"Missing or wrong: " + check.join(", ") + ". Fix before shipping. Auto push holds it."}>
          Check: {check.join(", ")}
        </Pill>
      ) : null}
    </div>
  );
}

export function OrderRow({ order: o, selected, onSelect, open, pinned, unsure, route }: { order: OrderListRow; selected: boolean; onSelect: (on: boolean) => void; open: boolean; pinned: boolean; unsure: boolean; route: string }) {
  const tl = trackLinkOf(o);
  const detailId = "det-" + o.id;
  const flip = () => rowsStore.set(toggle(rowsStore.get(), o.id));
  const flag = async () => {
    try {
      await setFlag(o.id, !o.flagged);
      toast(o.flagged ? "Flag cleared on " + o.id : "Flagged " + o.id, true);
      await afterOrderWrite();
    } catch (e) {
      toast("Could not save the flag: " + explain(e));
    }
  };
  const cls = ["row", selected && "sel", o.flagged && "flagged", open && "open-row"].filter(Boolean).join(" ");
  return (
    <>
      <tr
        class={cls}
        data-row={o.id}
        onClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("input,button,a,label,select,textarea")) return;
          flip();
        }}
      >
        <td class="tick">
          <input type="checkbox" aria-label={"Select " + o.id} checked={selected} onChange={(e) => onSelect((e.currentTarget as HTMLInputElement).checked)} />
        </td>
        <td class="id">
          {o.id}
          {originWord(o.origin) ? <span class="src">{originWord(o.origin)}</span> : null}
        </td>
        <td class="who">
          <b dir="auto">{o.name || "—"}</b>
          <span dir="ltr">{o.phone || ""}</span>
        </td>
        <td class="hide-sm dest">
          {o.city ? <bdi>{o.city}</bdi> : null}
          {o.city && o.countryCode ? ", " : ""}
          {o.countryCode || (o.city ? "" : "—")}
        </td>
        <td class="num total">{money(orderTotal(o), o.cur)}</td>
        <td class="st">
          <StatusPills o={o} unsure={unsure} route={route} />
        </td>
        <td class="hide-sm num">{dtt(o.createdAt)}</td>
        <td class="acts-td">
          <div class="acts">
            <button
              type="button"
              class={"btn sm ghost icon flag" + (o.flagged ? " on" : "")}
              aria-pressed={o.flagged}
              aria-label={o.flagged ? "Flagged " + o.id + ": clear the flag" : "Flag " + o.id}
              title={o.flagged ? "Flagged " + dtt(o.flaggedAt) + " · click to clear" : "Flag this order"}
              onClick={flag}
            >
              <Icon name="flag" />
            </button>
            {tl ? (
              <a class="btn sm ghost icon trk" href={tl.url} target="_blank" rel="noopener" title={tl.title} aria-label={tl.title}>
                <Icon name="truck" />
              </a>
            ) : null}
            <button
              type="button"
              class="btn sm ghost icon pin"
              aria-pressed={pinned}
              aria-label={(pinned ? "Unpin " : "Keep open ") + o.id}
              title={pinned ? "Pinned open. Click to unpin." : "Keep open"}
              onClick={() => rowsStore.set(pin(rowsStore.get(), o.id))}
            >
              <Icon name="pin" />
            </button>
            <button type="button" class="btn sm ghost icon chev" aria-expanded={open} aria-controls={open ? detailId : undefined} aria-label={(open ? "Close " : "Open ") + o.id} title="Details" onClick={flip}>
              <Icon name="chev" />
            </button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr class="detail" data-detail={o.id}>
          <td colSpan={8}>
            <OrderDetail row={o} id={detailId} unsure={unsure} route={route} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
