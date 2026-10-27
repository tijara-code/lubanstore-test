/**
 * THE ONE LM OBJECT. Every core module adds its members to this object at load, and every
 * member reads its neighbours through it at call time (`LM.c`, `LM.offerCfg(…)`), exactly
 * as store.js did — so a test or a page that replaces `LM.c`, `LM.cfg`, `LM.now` or
 * `LM.stockCap` changes what every other member answers. index.ts assembles the modules in
 * the original order and publishes the object as window.LM.
 */
import type { LmApi } from "./types";

export const LM = {
  cfg: null,
  c: null,
} as unknown as LmApi;
