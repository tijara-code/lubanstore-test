/**
 * FULFILMENT — moving the order along, and everything about getting it to the door.
 *
 *   the status flow   New → Preparing → Shipped → Delivered, and Cancelled. Only the moves
 *                     the shared status rules allow a person are buttons (shared/orders/
 *                     status.ts `transition`); moving back asks first and is sent as `force`;
 *                     the server's refusals are said in words (stale → the list is refreshed;
 *                     a live parcel → asked whether to cancel anyway)
 *   by hand           the tracking number and carrier for an order Empower does not carry
 *                     (Save, or Save & mark shipped)
 *   Empower           push / take off / record / send as a new id; its status and waybill
 *   the shop's note, the flag, the trash (restore, delete forever — refusals shown)
 */
import { useState } from "preact/hooks";
import { transition } from "../../../shared/orders/status";
import { isApiError } from "../../data/api";
import { bulk, moveStatus, putTracking, setFlag, setNote } from "../../data/endpoints";
import { afterOrderWrite } from "../../data/hooks";
import { ask, Btn, Field, Pill, toast } from "../../kit";
import { dtt } from "../../lib/format";
import { empWord, explain, STATUS } from "../../lib/words";
import { pushOne, takeOff } from "./empower";
import type { DetailOrder } from "./OrderDetail";
import { summaryOf } from "./OrderDetail";

const FLOW = ["new", "prep", "ship", "done", "void"] as const;
type To = (typeof FLOW)[number];

const WHY: Record<string, string> = {
  awaiting_payment: "Waiting for the card payment",
  refunded: "The money went back",
  illegal_move: "Not a move from here",
  not_yours: "The payment or the courier moves it",
  unknown_status: "Unknown status",
};

/** What the panel may do with each status from where the order is: allowed, ask first (moving back), or why not. */
export function movesOf(o: DetailOrder): Array<{ to: To; state: "here" | "ok" | "back" | "no"; why?: string }> {
  return FLOW.map((to) => {
    if (o.status === to) return { to, state: "here" as const };
    const r = transition(o, to, "admin");
    if (!r) return { to, state: "ok" as const };
    if (r === "moving_back") {
      const forced = transition(o, to, "admin", { force: true });
      return forced ? { to, state: "no" as const, why: WHY[forced] || forced } : { to, state: "back" as const };
    }
    return { to, state: "no" as const, why: WHY[r] || r };
  });
}

/** The send that is still a parcel (one taken off is not), newest first. */
function liveSend(shipments: Array<Record<string, unknown>>) {
  return shipments.find((s) => !/cancel/i.test(String(s.status || "")));
}

export function Fulfilment({ order: o, shipments, unsure, route }: { order: DetailOrder; shipments: Array<Record<string, unknown>>; unsure: boolean; route: string }) {
  const [busy, setBusy] = useState("");
  const [tracking, setTracking] = useState(o.tracking || "");
  const [carrier, setCarrier] = useState(o.carrier || "");
  const [note, setNoteText] = useState(o.adminNote || "");
  const [byHand, setByHand] = useState(route === "manual" || !!o.tracking);
  const live = liveSend(shipments);
  const parcel = live ? summaryOf(live) : o.shipment && !/cancel/i.test(String(o.shipment.status || "")) ? o.shipment : undefined;

  const run = async (what: string, fn: () => Promise<string | null | void>) => {
    setBusy(what);
    try {
      const said = await fn();
      if (said) toast(said, true);
      await afterOrderWrite();
    } catch (e) {
      toast(explain(e));
      if (isApiError(e, "stale")) await afterOrderWrite();
    } finally {
      setBusy("");
    }
  };

  const move = (to: To, back: boolean) =>
    run("st:" + to, async () => {
      if (back && !(await ask({ title: "Move " + o.id + " back?", text: "It is already " + STATUS[o.status]!.toLowerCase() + ". Move it back to " + STATUS[to] + " anyway?", ok: "Move back", danger: true }))) return null;
      if (to === "void" && !(await ask({ title: "Cancel order " + o.id + "?", text: "It is marked cancelled, not deleted.", ok: "Cancel order", cancel: "Keep it", danger: true }))) return null;
      const body: { to: To; force?: boolean; tracking?: string; carrier?: string } = { to, ...(back ? { force: true } : {}) };
      if (to === "ship" && byHand && tracking.trim()) Object.assign(body, { tracking: tracking.trim(), carrier: carrier.trim() });
      try {
        await moveStatus(o.id, body);
      } catch (e) {
        if (isApiError(e, "parcel_live")) {
          if (!(await ask({ title: o.id + " has a live parcel", text: String(e.extra.detail || "") + "\n\nThis does NOT cancel the courier parcel: take it off Empower first. Cancel the order anyway?", ok: "Cancel anyway", danger: true }))) return null;
          await moveStatus(o.id, { ...body, force: true });
        } else if (isApiError(e, "moving_back") && !back) {
          if (!(await ask({ title: "Move " + o.id + " back?", text: "It moved further along meanwhile. Move it back to " + STATUS[to] + " anyway?", ok: "Move back", danger: true }))) return null;
          await moveStatus(o.id, { ...body, force: true });
        } else throw e;
      }
      return o.id + " → " + STATUS[to];
    });

  const saveTracking = (ship: boolean) =>
    run(ship ? "trk-ship" : "trk", async () => {
      if (ship && !tracking.trim() && !(await ask({ title: "No tracking number", text: "Mark " + o.id + " shipped without a tracking number?", ok: "Mark shipped" }))) return null;
      await putTracking(o.id, { tracking: tracking.trim(), carrier: carrier.trim(), ...(ship ? { ship: true } : {}) });
      return ship ? o.id + " → Shipped" + (tracking.trim() ? " · " + tracking.trim() : "") : "Tracking saved";
    });

  const pushReason = o.trashed
    ? "In the trash"
    : o.status === "void"
      ? "Cancelled orders are not shipped"
      : o.status === "pending"
        ? "Not paid yet"
        : o.status === "ship" || o.status === "done"
          ? "Already shipped"
          : o.tracking
            ? "Has a tracking number (shipped by hand)"
            : "";

  const moves = movesOf(o);
  return (
    <>
      <div class="full blk">
        <h4>Fulfilment</h4>
        <div class="flow" role="group" aria-label={"Status of " + o.id}>
          {o.status === "pending" ? <Pill tone="pending">Awaiting payment</Pill> : null}
          {moves.map((m) =>
            m.state === "here" ? (
              <span key={m.to} class={"step here " + m.to} aria-current="step">
                {STATUS[m.to]}
              </span>
            ) : (
              <button
                key={m.to}
                type="button"
                class={"step " + m.to + (m.state === "back" ? " back" : "")}
                disabled={m.state === "no" || !!busy}
                title={m.state === "no" ? m.why : m.state === "back" ? "Moving back: asks first" : "Move to " + STATUS[m.to]}
                aria-label={(m.to === "void" ? "Cancel order" : "Move to " + STATUS[m.to]) + (m.state === "no" ? " (" + m.why + ")" : m.state === "back" ? " (moving back)" : "")}
                onClick={() => move(m.to, m.state === "back")}
              >
                {m.to === "void" ? "Cancel order" : STATUS[m.to]}
              </button>
            ),
          )}
        </div>

        {byHand ? (
          <div class="hand">
            <div class="det-form">
              <Field label="Tracking number">
                <input value={tracking} onInput={(e) => setTracking((e.currentTarget as HTMLInputElement).value)} dir="ltr" autocomplete="off" />
              </Field>
              <Field label="Carrier">
                <input value={carrier} onInput={(e) => setCarrier((e.currentTarget as HTMLInputElement).value)} placeholder="e.g. DHL" autocomplete="off" />
              </Field>
              <Btn sm busy={busy === "trk"} onClick={() => saveTracking(false)}>
                Save tracking
              </Btn>
              {o.status === "new" || o.status === "prep" ? (
                <Btn sm kind="primary" icon="truck" busy={busy === "trk-ship"} onClick={() => saveTracking(true)}>
                  Save &amp; mark shipped
                </Btn>
              ) : null}
            </div>
            {route !== "manual" ? <p class="hint sml">This market ships with Empower. A tracking number here means it went by hand instead.</p> : null}
          </div>
        ) : !parcel ? (
          <button type="button" class="lnk hand-lnk" onClick={() => setByHand(true)}>
            Ship by hand instead (type a tracking number)
          </button>
        ) : null}
      </div>

      <div class="blk">
        <h4>Empower</h4>
        {parcel ? (
          <>
            <dl>
              <dt>State</dt>
              <dd>
                <Pill tone="empower" title={"Pushed to Empower (Omniful) " + dtt(parcel.at)}>
                  On Empower{parcel.reference ? " · " + parcel.reference : ""}
                </Pill>
              </dd>
              <dt>Status</dt>
              <dd>{parcel.deliveredAt ? "Delivered " + dtt(parcel.deliveredAt) : empWord(parcel.status) || "Sent"}</dd>
              {parcel.sentId && parcel.sentId !== o.id ? (
                <>
                  <dt>Sent as</dt>
                  <dd dir="ltr">{parcel.sentId}</dd>
                </>
              ) : null}
              {parcel.awb ? (
                <>
                  <dt>Waybill</dt>
                  <dd dir="ltr">{(parcel.courier ? parcel.courier + " · " : "") + parcel.awb}</dd>
                </>
              ) : null}
              <dt>Pushed</dt>
              <dd>{dtt(parcel.at)}</dd>
            </dl>
            {!parcel.deliveredAt ? (
              <div class="row-btns" style="margin-top:10px">
                <Btn sm icon="x" busy={busy === "off"} onClick={() => run("off", async () => { const r = await takeOff(o.id); if (r && !r.ok) toast(r.said); return r && r.ok ? r.said : null; })}>
                  Take off Empower
                </Btn>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {unsure ? <p class="note info">A push got no answer from Omniful. Push again: it checks and records it, nothing is sent twice.</p> : null}
            <Btn
              sm
              icon="box"
              disabled={!!pushReason}
              title={pushReason || "Send to Omniful. Moves to Preparing."}
              busy={busy === "push"}
              onClick={() =>
                run("push", async () => {
                  if (!(await ask({ title: "Push " + o.id + " to Empower?", text: "Omniful's warehouse will pick, pack and ship it, and the order moves to Preparing.", ok: "Push to Empower" }))) return null;
                  const r = await pushOne(o.id);
                  if (r.kind !== "sent") {
                    toast(r.said);
                    return null;
                  }
                  return r.said;
                })
              }
            >
              Push to Empower
            </Btn>
            {pushReason ? <p class="hint sml">{pushReason}.</p> : null}
          </>
        )}
      </div>

      <div class="blk">
        <h4>The shop's note</h4>
        <div class="det-form">
          <input class="grow" aria-label={"Internal note on " + o.id} value={note} placeholder="Internal note (not shown to the customer)" onInput={(e) => setNoteText((e.currentTarget as HTMLInputElement).value)} />
          <Btn sm kind="primary" busy={busy === "note"} disabled={note.trim() === (o.adminNote || "")} onClick={() => run("note", async () => (await setNote(o.id, note.trim()), note.trim() ? "Note saved" : "Note cleared"))}>
            Save note
          </Btn>
        </div>
        <div class="row-btns" style="margin-top:10px">
          <Btn sm icon="flag" aria-pressed={o.flagged} busy={busy === "flag"} onClick={() => run("flag", async () => (await setFlag(o.id, !o.flagged), o.flagged ? "Flag cleared on " + o.id : "Flagged " + o.id))}>
            {o.flagged ? "Clear flag" : "Flag"}
          </Btn>
          {!o.trashed ? (
            <Btn sm icon="trash" busy={busy === "trash"} onClick={() => run("trash", async () => (await bulk({ op: "trash", ids: [o.id] }), o.id + " moved to trash"))}>
              Move to trash
            </Btn>
          ) : (
            <>
              <Btn sm icon="undo" busy={busy === "restore"} onClick={() => run("restore", async () => (await bulk({ op: "restore", ids: [o.id] }), o.id + " restored"))}>
                Restore
              </Btn>
              <Btn
                sm
                kind="danger"
                icon="x"
                busy={busy === "purge"}
                onClick={() =>
                  run("purge", async () => {
                    if (!(await ask({ title: "Delete " + o.id + " forever?", text: "This cannot be undone. Paid orders are kept (accounting records).", ok: "Delete forever", danger: true }))) return null;
                    await bulk({ op: "purge", ids: [o.id] });
                    return o.id + " deleted";
                  })
                }
              >
                Delete forever
              </Btn>
            </>
          )}
        </div>
      </div>
    </>
  );
}
