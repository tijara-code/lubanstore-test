/**
 * (STUB — owned by the commerce area.) Orders: reading one, and moving one along the
 * status flow with a condition on the status read (so two writers cannot both win), with
 * every move recorded in order_events.
 */
import type { Mover, Status, TransitionRefusal } from "../../shared/orders/status";
import type { Deps } from "../core/deps";
import type { DbOrTx } from "../db/client";
import type { OrderRow } from "../db/schema";

export async function getOrder(db: DbOrTx, id: string): Promise<OrderRow | null> {
  void db; void id;
  return null;
}

export interface MoveResult {
  /** the row was changed by this call */
  changed: boolean;
  /** why the move was refused (transition rules), when it was */
  refusal?: TransitionRefusal | "not_found" | "stale";
  order?: OrderRow;
}

/**
 * Move an order to `to` as `by`. Conditional on the status read: a concurrent writer that
 * moved it first makes this a no-op ({ changed: false, refusal: "stale" }).
 * `patch`: extra columns written in the same UPDATE (e.g. shippedAt, tracking).
 */
export async function moveOrder(
  deps: Deps,
  id: string,
  to: Status,
  by: Mover | `job:${string}`,
  opts: { force?: boolean; patch?: Partial<OrderRow>; detail?: Record<string, unknown> } = {},
): Promise<MoveResult> {
  void deps; void id; void to; void by; void opts;
  return { changed: false, refusal: "not_found" };
}
