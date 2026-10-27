/**
 * (STUB — owned by the orders area.) What both tills (cash: /api/order, card:
 * /api/pay/session) do before an order is written: price the basket from the live
 * catalogue (refusals → 400 with the code; a fault of ours → 503, which the page retries),
 * then check the shelf for capped boxes (409 stock_short).
 */
import type { Catalogue } from "../../shared/catalogue/types";
import type { Quote } from "../../shared/pricing/price";
import type { Deps } from "../core/deps";
import type { Intake } from "./intake";

export async function priceBasket(deps: Deps, intake: Intake, pay: "cod" | "card"): Promise<{ cfg: Catalogue; quote: Quote }> {
  void deps; void intake; void pay;
  throw new Error("not implemented");
}

export async function gateStock(deps: Deps, cfg: Catalogue, quote: Quote, intake: Intake): Promise<void> {
  void deps; void cfg; void quote; void intake;
}
