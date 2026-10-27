/**
 * EMPOWER (Omniful) — the main fulfilment route. Plain functions of `deps`:
 *
 *   push.ts    pushOrder, sweep (Push all), autoPush, adopt, cancelPushed (take-off)
 *   sync.ts    applyStatus / applyHook (webhook), pollStatuses (the 7/37 poll), followParcel
 *   shelf.ts   readShelf (the shelf at the hub), the stock switches, tracker rows, hide/caps
 *   admin.ts   the Empower tab's actions (status, waiting/pushed lists, SKUs, routing, …)
 *   rules.ts   routing per market, status stages, the Create Order body, sent ids
 *   lines.ts   SKU codes and the boxes a line is
 *   store.ts   the ops records (SKU map, spent ids, notes, the auto switch)
 *
 * The till's stock gate and the public stock answer are in domain/stock.ts.
 */
export * from "./rules";
export * from "./lines";
export * from "./store";
export * from "./shelf";
export * from "./push";
export * from "./sync";
export * from "./admin";
export { stockStatus, enforceStock, publicStock, heldOrders } from "../stock";
