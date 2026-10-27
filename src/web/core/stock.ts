/**
 * ---------- pieces left (v206; from the shelf since v207) ----------
 * The boxes of each size on the shelf at the fulfilment centre — read by /api/stock, never
 * here. Asked for only when the counter (cfg.stockLive) or a hide/cap switch is on, once
 * the page has its prices, and again when the tab comes back or a minute has gone by
 * while it is in view (the answer is cached at the CDN for a minute). Until an answer
 * arrives, and if none does, nothing is shown — the page never guesses a number. "lm:stock"
 * tells the page when the numbers change.
 */
import { LM } from "./self";
import { scentOut } from "./util";
import type { CartLine, LmApi } from "./types";

let STOCK: Record<string, number> | null = null;
let stockAt = 0;
let stockBusy = false;
let stockAnswered = false;
/** what the shelf takes off the page (v208): boxes ticked "hide at 0" with none left, and sizes all hidden */
let HIDE: { items: string[]; sizes: string[] } = { items: [], sizes: [] };
/** CAPPED AT THE SHELF (v211): { "oud-small": 13 } — the steppers stop there, the till refuses past it */
let CAP: Record<string, number> = {};

/**
 * (v403) THE COUNT SHOWN IS 30% OF THE SHELF, by the shop's choice. Display only: caps,
 * hides and the till read the real figures. A shelf with any boxes never reads 0.
 */
const STOCK_SHOWN = 0.3;

function stockOn(): boolean {
  if (!LM.cfg) return false;
  if (LM.cfg.stockLive === true) return true;
  const any = (h: unknown) =>
    !!h && typeof h === "object" && Object.keys(h as object).some((k) => (h as Record<string, unknown>)[k] === true);
  return any(LM.cfg.stockHide) || any(LM.cfg.stockCap);
}

/** the counter is on and the shelf has answered (or failed, or 4 s passed): tell the page */
function stockSettle(): void {
  if (stockAnswered) return;
  stockAnswered = true;
  window.dispatchEvent(new CustomEvent("lm:stock"));
}

/** a cap by the till's box code ("oud-large", or an add-on's own id) */
function capOf(code: string): number | null {
  const cut = code.lastIndexOf("-");
  if (cut > 0) return LM.stockCap(code.slice(0, cut), code.slice(cut + 1));
  return CAP[code] == null ? null : CAP[code]!;
}

/** the set's boxes, as the warehouse packs them: one per active scent, from the in-stock ones */
function setPack(id: string): Record<string, number> {
  const sz = LM.bundleSizeId(id);
  const own = LM.scents();
  const out: Record<string, number> = {};
  const open = own.filter((s) => !scentOut(s, sz));
  const pool = open.length ? open : own;
  for (let i = 0; i < own.length && pool.length; i++) {
    const k = pool[i % pool.length]!.id + "-" + sz;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function loadStock(): void {
  if (!stockOn() || stockBusy) return;
  if (typeof fetch !== "function") {
    stockSettle();
    return;
  }
  stockBusy = true;
  fetch("/api/stock")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j: unknown) => {
      stockBusy = false;
      stockAt = Date.now();
      const a = j as { left?: unknown; hide?: { items?: unknown; sizes?: unknown }; cap?: unknown } | null;
      if (!a || !a.left || typeof a.left !== "object") {
        stockSettle();
        return;
      }
      const next: Record<string, number> = {};
      const left = a.left as Record<string, unknown>;
      Object.keys(left).forEach((k) => {
        const n = Math.floor(Number(left[k]));
        if (/^[A-Za-z0-9_-]{1,40}$/.test(k) && Number.isFinite(n) && n >= 0) next[k] = n;
      });
      const clean = (l: unknown) =>
        (Array.isArray(l) ? l : [])
          .map(String)
          .filter((x) => /^[A-Za-z0-9_-]{1,80}$/.test(x))
          .sort();
      const hide = { items: clean(a.hide && a.hide.items), sizes: clean(a.hide && a.hide.sizes) };
      const cap: Record<string, number> = {};
      if (a.cap && typeof a.cap === "object") {
        const c = a.cap as Record<string, unknown>;
        Object.keys(c).forEach((k) => {
          const n = Math.floor(Number(c[k]));
          if (/^[A-Za-z0-9_-]{1,80}$/.test(k) && Number.isFinite(n) && n >= 0) cap[k] = n;
        });
      }
      if (JSON.stringify(next) === JSON.stringify(STOCK) && JSON.stringify(hide) === JSON.stringify(HIDE) && JSON.stringify(cap) === JSON.stringify(CAP)) {
        stockSettle();
        return;
      }
      STOCK = next;
      HIDE = hide;
      CAP = cap;
      stockAnswered = true;
      window.dispatchEvent(new CustomEvent("lm:stock"));
    });
}

type StockPart = Pick<
  LmApi,
  "stockShown" | "stockLeft" | "stockPending" | "stockHidden" | "stockHiddenSize" | "stockCap" | "lineBoxes" | "basketBoxes" | "capRoom" | "lineRoom" | "loadStock"
>;

export const stock: StockPart = {
  stockShown(n) {
    if (n == null || !(n > 0)) return n;
    return Math.max(1, Math.floor(n * STOCK_SHOWN));
  },
  /** the pieces left to SHOW for a size, or null while unknown */
  stockLeft(id) {
    return STOCK && STOCK[id] != null ? (LM.stockShown(STOCK[id]) as number) : null;
  },
  /** (v403) the counter is on and the shelf has not answered yet: the tiles wait (blank) */
  stockPending() {
    return stockOn() && !stockAnswered;
  },
  /** display only — a hidden box already in the basket still buys */
  stockHidden(scentId, sizeId) {
    return HIDE.items.indexOf(scentId + "-" + sizeId) > -1;
  },
  stockHiddenSize(sizeId) {
    return HIDE.sizes.indexOf(String(sizeId)) > -1;
  },
  /** the cap on a box, or null (no cap, or the shelf not known yet) */
  stockCap(scentId, sizeId) {
    const n = CAP[scentId + "-" + sizeId];
    return n == null ? null : n;
  },
  /**
   * (v336) THE BOXES ONE OF A BASKET LINE HOLDS, keyed as the till keys them: a box is
   * itself, an offer its mix in the offer's size, the set one box of each active scent in
   * its size, an add-on its own id.
   */
  lineBoxes(line) {
    let out: Record<string, number> = {};
    if (!line || typeof line !== "object") return out;
    const id = String(line.sizeId || "");
    if (LM.isTier(id)) {
      const tsz = LM.tierSize();
      (Array.isArray(line.mix) ? line.mix : []).forEach((m) => {
        const k = m + "-" + tsz;
        out[k] = (out[k] || 0) + 1;
      });
    } else if (LM.isBundle(id) || line.scentId === "bundle") {
      out = setPack(LM.isBundle(id) ? id : "bundle");
    } else if (!line.scentId) {
      if (id) out[id] = 1;
    } else out[line.scentId + "-" + id] = 1;
    return out;
  },
  basketBoxes(cart) {
    const need: Record<string, number> = {};
    (Array.isArray(cart) ? cart : []).forEach((c: CartLine) => {
      const q = Math.max(0, Math.floor(Number(c && c.qty)) || 0);
      const per = LM.lineBoxes(c);
      Object.keys(per).forEach((k) => (need[k] = (need[k] || 0) + per[k]! * q));
    });
    return need;
  },
  /** how many more of this box the basket can take (every line's boxes counted, v336); null with no cap */
  capRoom(scentId, sizeId, cart) {
    const cap = LM.stockCap(scentId, sizeId);
    if (cap == null) return null;
    return Math.max(0, cap - (LM.basketBoxes(cart)[scentId + "-" + sizeId] || 0));
  },
  /** (v336) how many more of this whole line fit under the caps of every box it holds; null when none is capped */
  lineRoom(line, cart) {
    const per = LM.lineBoxes(line);
    const held = LM.basketBoxes(cart);
    let room: number | null = null;
    Object.keys(per).forEach((k) => {
      const cap = capOf(k);
      if (cap == null || !(per[k]! > 0)) return;
      const r = Math.max(0, Math.floor((cap - (held[k] || 0)) / per[k]!));
      room = room == null ? r : Math.min(room, r);
    });
    return room;
  },
  loadStock,
};

/** start the poller once the catalogue is known (index.ts calls this after LM.ready exists) */
export function startStock(): void {
  LM.ready.then(() => {
    if (!stockOn()) return;
    LM.loadStock();
    /* (v403) a shelf that never answers: the weights come back */
    setTimeout(stockSettle, 4000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - stockAt > 20e3) LM.loadStock();
    });
    const tick = () => {
      setTimeout(() => {
        if (!document.hidden) LM.loadStock();
        tick();
      }, 60e3);
    };
    tick();
  });
}
