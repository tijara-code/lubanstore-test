/**
 * LUBAN & MUSK — the store's core (the port of assets/js/store.js).
 *
 * One source of truth for the catalogue, the active country and every price shown
 * anywhere. Every page entry imports this module FIRST; ES module evaluation order then
 * guarantees what the original's script order did: LM exists, LM.ready is in flight and
 * window.LM is set before any page module runs (and before DOMContentLoaded, which the
 * head's "early" script waits on to read window.LM.ready).
 *
 *   LM.ready  -> Promise, resolves (once) with LM when the catalogue and market are known
 *   LM.cfg    -> the catalogue in use
 *   LM.c      -> the active country
 *
 * See ./README.md for every member.
 */
import { LM } from "./self";
import { installStorageShim } from "./storage";
import { L, LANG, ROOT, ASSET_V, txt } from "./lang";
import { $, esc } from "./util";
import { money } from "./money";
import { pictures } from "./art";
import { offers } from "./offers";
import { catalogue } from "./catalogue";
import { cart, repairCart } from "./cart";
import { stock, startStock } from "./stock";
import { orders, startOrderQueue } from "./orders";
import { boot, clearRetired, diagnostics } from "./boot";

/* 1. storage that works even when the browser blocks it — before anything reads it */
installStorageShim();

/* 2. the api, in store.js's order */
Object.assign(LM, { esc, $, lang: LANG, L, txt, root: ROOT, v: ASSET_V });
Object.assign(LM, money, pictures, offers, catalogue);

/* 3. the retired keys, then the boot (geo and the catalogue leave together) */
clearRetired();
LM.ready = boot();

/* 4. the shelf, the basket's repair, the parked orders, the console helper */
Object.assign(LM, stock);
startStock();
Object.assign(LM, cart);
repairCart();
Object.assign(LM, orders);
startOrderQueue();
Object.assign(LM, diagnostics);

window.LM = LM;

export { LM };
export type * from "./types";
