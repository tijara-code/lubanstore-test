/**
 * Where an order stands, and who may move it where.
 *
 * status:          pending (a card attempt awaiting its money) → new → prep → ship → done; void = cancelled
 * payment_status:  unpaid | cancelled (card, not paid) · paid | refunded (card) · cod · paid (transfer)
 *
 * Every writer asks `transition(order, to, by)`; the write that follows carries the status it
 * read as its condition (UPDATE … WHERE status = $from), so two writers cannot both win.
 *
 * by:  "admin"    a person in the panel ("admin:force" = a person who was told it moves back)
 *      "courier"  Empower's parcel news (forward only)
 *      "payment"  a card settled (pending → new; a void revives: the money arrived) or lapsed
 *      "push"     pushed to Empower (new → prep) or taken off (prep → new)
 */
export type Status = "pending" | "new" | "prep" | "ship" | "done" | "void";
export type PaymentState = "unpaid" | "paid" | "cod" | "refunded" | "cancelled";
export type Mover = "admin" | "courier" | "payment" | "push";

export const STATUS = { PENDING: "pending", NEW: "new", PREP: "prep", SHIP: "ship", DONE: "done", VOID: "void" } as const;

export const MOVES: Record<Status, Partial<Record<Status, string[]>>> = {
  pending: { new: ["payment"], void: ["payment", "admin"] },
  new: { prep: ["admin", "push", "courier"], ship: ["courier", "admin"], done: ["courier", "admin"], void: ["admin"] },
  prep: { new: ["push", "admin"], ship: ["courier", "admin"], done: ["courier", "admin"], void: ["admin"] },
  ship: { done: ["courier", "admin"], new: ["admin:force"], prep: ["admin:force"], void: ["admin"] },
  done: { new: ["admin:force"], prep: ["admin:force"], ship: ["admin:force"], void: ["admin"] },
  void: { new: ["payment", "admin"], prep: ["admin"], ship: ["admin"], done: ["admin"] },
};

export interface MovableOrder {
  status: string;
  pay?: string | null;
  paymentStatus?: string | null;
  refunded?: boolean | null;
  trashed?: boolean | null;
}

export type TransitionRefusal = "unknown_status" | "illegal_move" | "moving_back" | "not_yours" | "refunded" | "awaiting_payment";

export function isRefunded(o: MovableOrder | null | undefined): boolean {
  return !!o && (o.paymentStatus === "refunded" || o.refunded === true);
}

/** A real order: not binned, not cancelled, not awaiting its card money, not refunded. */
export function isLive(o: MovableOrder | null | undefined): boolean {
  return !!o && !o.trashed && o.status !== "void" && o.status !== "pending" && !isRefunded(o);
}

function refusedByMoney(o: MovableOrder, to: string): TransitionRefusal | null {
  if (isRefunded(o) && (to === "new" || to === "prep")) return "refunded";
  if (o.status === "pending" && to !== "void" && o.pay === "card" && o.paymentStatus !== "paid" && to !== "new") return "awaiting_payment";
  if (o.status === "void" && to !== "void" && o.pay === "card" && o.paymentStatus !== "paid" && !isRefunded(o)) return "awaiting_payment";
  return null;
}

/** null when allowed; otherwise why not. */
export function transition(o: MovableOrder, to: string, by: Mover, opts: { force?: boolean } = {}): TransitionRefusal | null {
  const from = String((o && o.status) || "") as Status;
  const row = MOVES[from];
  if (!row) return "unknown_status";
  if (from === to) return (MOVES as Record<string, unknown>)[to] ? null : "illegal_move";
  const who = row[to as Status];
  if (!who) return "illegal_move";
  if (who.indexOf(by) > -1) return by === "payment" ? null : refusedByMoney(o, to);
  if (opts.force && who.indexOf(by + ":force") > -1) return refusedByMoney(o, to);
  if (who.indexOf(by + ":force") > -1) return "moving_back";
  return "not_yours";
}

/** Order of the forward flow, for "only ever forward" comparisons. */
export const STAGE: Record<string, number> = { pending: 0, new: 1, prep: 2, ship: 3, done: 4 };
