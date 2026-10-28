/**
 * Card attempts that never got paid. A card order is `pending` until Thawani confirms the
 * money; a shopper who closes the tab at the payment page leaves it there for good. After 72
 * hours it is not going to be paid (three days, not three hours: a session can be completed
 * later from the same link, and a bank's 3-D Secure step can span a night).
 *
 * It never touches an order the gateway settled (payment_status is the gateway's word, and a
 * webhook that landed while the order still said pending is exactly the case that must
 * survive), never a cash order, never one whose payment page is still open (expire_at in the
 * future — a reopened reminder link), and deletes nothing: cancelled, not removed. The read's
 * conditions are repeated in the write, so an order paid in between keeps its money.
 */
import { errorText } from "../../core/log";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Deps } from "../../core/deps";
import { orders } from "../../db/schema";
import { moveOrder } from "../orders";
import { purgeWebhookEvents } from "./webhook";

export const HOURS = 72;

export async function expireUnpaid(deps: Deps): Promise<{ cancelled: number; cutoff: string; ids: string[]; purged: number }> {
  const now = deps.now();
  const cutoff = new Date(now - HOURS * 3600e3);
  const at = new Date(now);
  const lapsed = and(
    eq(orders.status, "pending"),
    inArray(orders.paymentStatus, ["unpaid", "cancelled"]),
    eq(orders.pay, "card"),
    lt(orders.createdAt, cutoff),
    eq(orders.trashed, false),
    or(isNull(orders.expireAt), lt(orders.expireAt, at)),
  )!;
  // the rows read are locked until each is moved, so a reminder link reopening one (a new
  // expire_at) or a payment landing waits for this sweep, and the move repeats the status read
  const ids = await deps.db.transaction(async (tx) => {
    const rows = await tx.select({ id: orders.id, adminNote: orders.adminNote }).from(orders).where(lapsed).limit(200).for("update");
    const done: string[] = [];
    const txDeps = { ...deps, db: tx as unknown as Deps["db"] };
    for (const r of rows) {
      const note = "Cancelled automatically: no payment within " + HOURS + " hours";
      const m = await moveOrder(txDeps, r.id, "void", "job:orders-expire", {
        as: "payment",
        from: "pending",
        patch: { paymentStatus: "cancelled", adminNote: r.adminNote ? r.adminNote + "\n" + note : note },
        detail: { hours: HOURS, paymentStatus: "cancelled" },
      });
      if (m.changed) done.push(r.id);
    }
    return done;
  });
  let purged = 0;
  try {
    purged = await purgeWebhookEvents(deps, 90);
  } catch (e) {
    await deps.log.error("job:orders-expire", "the webhook record purge failed: " + errorText(e), { side: "job" });
  }
  return { cancelled: ids.length, cutoff: cutoff.toISOString(), ids, purged };
}
