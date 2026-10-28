/**
 * A whole server for a test: an in-memory Postgres (PGlite) with the real schema, the fake
 * world behind fetch, a clock the test moves, and the real Hono app.
 *
 *   const h = await createHarness({ catalogue });
 *   const res = await h.post("/api/order", { order });
 *   h.world.calls, h.clock.advance(3600e3), await h.db.select().from(orders)
 *
 * The `pg` Vitest project swaps this module for harness-pg.ts (the same API over a real
 * PostgreSQL); keep the two exporting the same names.
 */
import { connectPglite } from "../../src/server/db/client";
import { buildHarness, T0, type Clock, type Harness, type HarnessOptions, type World } from "./harness-core";

export { T0 };
export type { Clock, Harness, HarnessOptions, World };

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  return buildHarness(await connectPglite(), opts);
}
