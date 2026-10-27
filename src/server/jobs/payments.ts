/**
 * The payments area's scheduled job: `orders-expire`, hourly — card attempts unpaid after
 * 72 hours are cancelled (domain/payments/expire.ts), and the webhook record is trimmed to
 * 90 days. The run is on record every hour (runJob), whatever it did.
 */
import { expireUnpaid } from "../domain/payments/expire";
import { defineJob } from "./index";

defineJob("orders-expire", 60, async (deps) => {
  const r = await expireUnpaid(deps);
  return { cancelled: r.cancelled, cutoff: r.cutoff, ids: r.ids.slice(0, 25), purged: r.purged };
});
