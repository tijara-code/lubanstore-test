/**
 * ONE PAYMENT, OPENED — under its row on the Payments tab:
 *
 *   the ids        order (a link into Orders), checkout session, invoice, Thawani's payment id
 *   the card       masked number and type, what Thawani kept (fee) and what reaches the bank (net)
 *   the payloads   the gateway record as stored on the order, and Thawani's own answer after
 *                  "Ask Thawani" — each with Copy
 *   Ask Thawani    GET /payments/ask/:id: Thawani's charges for the order, folded onto what this
 *                  panel shows. It refreshes the DISPLAY only: nothing is written or settled.
 *   Refund         a reason (required, stored with Thawani's refund), asked once more; the order
 *                  becomes Cancelled and Refunded. Refusals in words.
 *   Mark paid      for an unpaid card order, with Thawani's payment id: the server reads that
 *                  payment from Thawani and settles only a successful charge on this order's
 *                  checkout, for the order's amount (a different figure asks first).
 */
import { useState } from "preact/hooks";
import { navigate } from "../../app/route";
import { afterOrderWrite } from "../../data/hooks";
import { orderGateway } from "../../data/endpoints";
import { askThawani, markPaidByHand, refundPayment, type PaymentRow } from "../../data/insights";
import { invalidate } from "../../data/query";
import { isApiError } from "../../data/api";
import { Btn, copyText, Modal, Pill, toast } from "../../kit";
import { dtt, money } from "../../lib/format";
import { COUNTRY_EN } from "../../lib/words";
import { canMarkPaid, canRefund, payLinkOf, payRefusal, payState } from "./pay";

/** After a refund or a payment marked by hand: the payments and every order read on screen. */
export function afterPaymentWrite(): Promise<void> {
  return Promise.all([invalidate("payments"), afterOrderWrite()]).then(() => undefined);
}

function copy(text: string, what: string) {
  copyText(text).then(
    () => toast(what + " copied", true),
    () => toast("Could not copy. Check clipboard permission."),
  );
}

/** A raw payload, folded, with Copy (the text is loaded when the fold first opens, if `load`). */
function Raw({ title, text, load, open }: { title: string; text: string | null; load?: () => void; open?: boolean }) {
  return (
    <details
      class="raw"
      open={open}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && load) load();
      }}
    >
      <summary>{title}</summary>
      <Btn
        sm
        icon="copy"
        onClick={() => {
          if (!text || text === "Loading…") return toast("Still loading. Try again in a moment.");
          copy(text, title);
        }}
      >
        Copy
      </Btn>
      <pre dir="ltr">{text ?? ""}</pre>
    </details>
  );
}

export function PaymentDetail({ row, onRefund }: { row: PaymentRow; onRefund: () => void }) {
  const [asked, setAsked] = useState<{ row: PaymentRow; payments: PaymentRow[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const r = asked ? asked.row : row;
  const st = payState(r);
  const link = payLinkOf(r, location.origin);

  const askNow = async () => {
    if (!row.orderId) return;
    setAsking(true);
    try {
      const a = await askThawani(row.orderId);
      setAsked({ row: a.row, payments: a.payments });
      toast(a.payments.length ? "Thawani answered: " + a.payments.length + " charge" + (a.payments.length === 1 ? "" : "s") + " on this checkout" : "Thawani has no charge for this checkout", true);
    } catch (e) {
      toast(payRefusal(e));
    } finally {
      setAsking(false);
    }
  };

  const loadRaw = () => {
    if (raw !== null || !row.orderId) return;
    setRaw("Loading…");
    orderGateway(row.orderId).then(
      (j) => setRaw(j.gateway ? JSON.stringify(j.gateway, null, 2) : "No payload stored for this order."),
      (e) => setRaw("Could not read the payload: " + payRefusal(e)),
    );
  };

  const refunds = r.refunds || [];
  return (
    <div class="det pay-det">
      <div>
        <h4>
          Payment <Pill tone={st.c}>{st.t}</Pill>
          {asked ? <span class="muted">· as Thawani says now</span> : null}
        </h4>
        <dl>
          <dt>Order</dt>
          <dd>
            {r.orderId ? (
              <button type="button" class="lnk" onClick={() => navigate("orders", { q: r.orderId, open: r.orderId })}>
                {r.orderId}
              </button>
            ) : (
              "—"
            )}
          </dd>
          <dt>Customer</dt>
          <dd dir="auto">{r.customer || "—"}</dd>
          <dt>Market</dt>
          <dd>{r.country ? COUNTRY_EN[r.country] || r.country : "—"}</dd>
          {r.orderTotal != null ? (
            <>
              <dt>Order total</dt>
              <dd>{money(r.orderTotal, r.orderCur || "OMR")}</dd>
            </>
          ) : null}
          <dt>Session</dt>
          <dd dir="ltr" class="mono">{r.session || "—"}</dd>
          <dt>Invoice</dt>
          <dd dir="ltr" class="mono">{r.invoice || "—"}</dd>
          <dt>Payment id</dt>
          <dd dir="ltr" class="mono">{r.paymentId || "—"}</dd>
          <dt>Thawani's status</dt>
          <dd dir="ltr">{r.status || "—"}</dd>
          <dt>Date</dt>
          <dd>{dtt(r.at)}</dd>
          {r.reason ? (
            <>
              <dt>Last error</dt>
              <dd dir="auto">{r.reason}</dd>
            </>
          ) : null}
        </dl>
      </div>
      <div>
        <h4>Card and money</h4>
        <dl>
          <dt>Card</dt>
          <dd dir="ltr">{r.card || "—"}</dd>
          <dt>Card type</dt>
          <dd>{r.cardType || "—"}</dd>
          <dt>Amount</dt>
          <dd>{money(r.amount, "OMR")}</dd>
          <dt>Gateway fee</dt>
          <dd>{money(r.fee, "OMR")}</dd>
          <dt>Net to the bank</dt>
          <dd>{money(r.net, "OMR")}</dd>
          {refunds.map((x, i) => [
            <dt key={"rt" + i}>Refund</dt>,
            <dd key={"rd" + i}>
              {money(x.amount, "OMR")} · {x.status || "—"}
              {x.reason ? " · " + x.reason : ""}
              {x.at ? " · " + dtt(x.at) : ""}
            </dd>,
          ])}
        </dl>
        <div class="row-btns pay-acts">
          {row.orderId ? (
            <Btn sm icon="refresh" busy={asking} onClick={askNow} title="Read this checkout's charges from Thawani (shows them here; changes nothing)">
              Ask Thawani
            </Btn>
          ) : null}
          {link ? (
            <Btn sm icon="link" onClick={() => copy(link, "Payment link")}>
              Copy pay link
            </Btn>
          ) : null}
          {canRefund(r) ? (
            <Btn sm kind="danger" onClick={onRefund}>
              Refund…
            </Btn>
          ) : null}
          {canMarkPaid(r) ? (
            <Btn sm onClick={() => setMarking(true)} title="Only with Thawani's payment id; the server checks it with Thawani">
              Mark paid by hand…
            </Btn>
          ) : null}
        </div>
      </div>
      {row.orderId ? (
        <div class="full">
          <Raw title="Gateway record (as stored on the order)" text={raw} load={loadRaw} />
          {asked ? <Raw title="Thawani's answer" text={JSON.stringify(asked.payments, null, 2)} open /> : null}
        </div>
      ) : null}
      {marking ? <MarkPaidDialog row={r} onClose={() => setMarking(false)} /> : null}
    </div>
  );
}

/* ---------------- refund ---------------- */

/**
 * A refund is real money leaving a real account: it asks for a reason (stored with Thawani's
 * refund — one nobody can explain in three months is worse than none) and says it cannot be undone.
 */
export function RefundDialog({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    const reason = why.trim();
    if (reason.length < 3) return setErr("A refund needs a reason.");
    setBusy(true);
    setErr("");
    try {
      const a = await refundPayment(row.paymentId, reason);
      onClose();
      toast("Refunded " + money(a.amount, "OMR") + (a.orderId ? " · order " + a.orderId + " cancelled and marked refunded" : ""), true);
      await afterPaymentWrite();
    } catch (e) {
      setErr(payRefusal(e));
      if (isApiError(e, "already_refunded")) void afterPaymentWrite();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={"Refund " + money(row.amount, "OMR") + (row.orderId ? " for " + row.orderId : "") + "?"} initialFocus="textarea">
      <p class="hint">This sends the money back through Thawani and cannot be undone. The order becomes Cancelled and Refunded.</p>
      <label class="tf">
        <span>Reason (required, stored with the refund)</span>
        <textarea rows={3} maxLength={300} value={why} onInput={(e) => setWhy((e.currentTarget as HTMLTextAreaElement).value)} />
      </label>
      {err ? (
        <p class="note warn" role="alert">
          {err}
        </p>
      ) : null}
      <div class="dlg-foot">
        <Btn sm kind="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn sm kind="danger" busy={busy} onClick={go}>
          Refund {money(row.amount, "OMR")}
        </Btn>
      </div>
    </Modal>
  );
}

/* ---------------- mark paid by hand ---------------- */

export function MarkPaidDialog({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const [pid, setPid] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* Thawani's charge differs from the order's figure: said, and the button asks to accept it */
  const [mismatch, setMismatch] = useState("");
  const go = async () => {
    const id = pid.trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return setErr("Paste Thawani's payment id (from its portal: Payments › the payment).");
    setBusy(true);
    setErr("");
    try {
      const a = await markPaidByHand(row.orderId!, id, mismatch === id);
      onClose();
      toast(a.id + " marked paid · " + money(a.amount, "OMR") + " (Thawani " + a.paymentId + ")", true);
      await afterPaymentWrite();
    } catch (e) {
      if (isApiError(e, "amount_mismatch")) {
        setMismatch(id);
        setErr(payRefusal(e) + " Mark it paid with Thawani's figure?");
      } else setErr(payRefusal(e));
    } finally {
      setBusy(false);
    }
  };
  const accepting = !!mismatch && mismatch === pid.trim();
  return (
    <Modal open onClose={onClose} title={"Mark " + row.orderId + " paid?"} initialFocus="input">
      <p class="hint">
        Only with Thawani's payment id. The server reads that payment from Thawani: it must be a successful charge on this order's checkout, for {money(row.amount, "OMR")}.
      </p>
      <label class="tf">
        <span>Thawani payment id</span>
        <input type="text" dir="ltr" autocomplete="off" spellcheck={false} value={pid} onInput={(e) => setPid((e.currentTarget as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      </label>
      {err ? (
        <p class="note warn" role="alert">
          {err}
        </p>
      ) : null}
      <div class="dlg-foot">
        <Btn sm kind="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn sm kind="primary" busy={busy} onClick={go}>
          {accepting ? "Mark paid with Thawani's figure" : "Check with Thawani and mark paid"}
        </Btn>
      </div>
    </Modal>
  );
}
