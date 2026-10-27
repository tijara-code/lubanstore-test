/**
 * The catalogue as this market sees it, and what each basket line is: whether it can be
 * sold here, its item id (what the till parses), its words and its add-on.
 */
import { LM } from "./self";
import { L, txt } from "./lang";
import { byCode, outOfStock, pick, scentOut } from "./util";
import { countsFree as sharedCountsFree } from "../../shared/pricing/offers";
import type { Extra, LmApi, Scent, Size } from "./types";

/** the shopper's EXPLICIT country choice, nothing else */
export const K_CTY = "lm_cty_v2";

type CataloguePart = Pick<
  LmApi,
  | "countries" | "listFor" | "sizes" | "scents" | "extras" | "fromPrice" | "setCountry"
  | "lineOffered" | "blockedLines" | "itemId" | "lineLabel" | "extraOf" | "countsFree" | "freeSub"
>;

function find<T extends { id: string }>(kind: string, id: unknown): T | undefined {
  return (LM.listFor(kind) as unknown as T[]).filter((x) => x && x.id === id)[0];
}

export const catalogue: CataloguePart = {
  countries() {
    return LM.cfg.countries;
  },
  /**
   * Sizes, scents and extras are defined per country: the name, the badge and whether it
   * is in stock are that market's own. A country without its own list falls back to the
   * shared one, so an older published catalogue keeps working unchanged.
   */
  listFor: function (kind: string) {
    const own = LM.c && (LM.c as Record<string, unknown>)[kind];
    if (Array.isArray(own) && own.length) return own;
    return ((LM.cfg && (LM.cfg as Record<string, unknown>)[kind]) || []) as Array<Size | Scent | Extra>;
  } as LmApi["listFor"],

  /**
   * PRICED HERE, or not on the page (a size this market has no price for could be added
   * and the till refused it as unpriced_item), HIDDEN ones off altogether; biggest box
   * first — sorted on price, so the running order survives any edit in /admin.
   */
  sizes() {
    return LM.listFor("sizes")
      .filter((z) => z && !(z.hidden === true || z.hidden === "true") && (pick(z.id).now || 0) > 0)
      .sort((a, b) => (pick(b.id).now || 0) - (pick(a.id).now || 0));
  },
  scents() {
    return LM.listFor("scents").filter((s) => s.active !== false);
  },
  /**
   * What this market sells alongside the boxes: switched on, not out, and with a price set
   * here (an extra with no price is one this market has no figure for — the till refuses it).
   */
  extras() {
    return LM.listFor("extras").filter((x) => x && x.id && x.active !== false && !outOfStock(x) && LM.price(x.id) > 0);
  },

  /**
   * The headline "from" figure: the cheapest box sold singly (not the set's size — the page
   * sells it only as the set, v309/v335), among the ones in stock here; the whole list if
   * everything is out, so the figure never blanks.
   */
  fromPrice() {
    const only = LM.offerCfg("bundle") ? LM.bundleSize() : LM.bundleOnlySize();
    let all = LM.sizes().filter((s) => !only || s.id !== only);
    if (!all.length) all = LM.sizes();
    let live = all.filter((s) => s.soldOut !== true);
    if (!live.length) live = all;
    return (
      live.reduce<number | null>((m, s) => {
        const p = pick(s.id).now || 0;
        return m == null || p < m ? p : m;
      }, null) || 0
    );
  },

  /** switch country, remember the choice, and tell every listener ("lm:country") */
  setCountry(code) {
    const next = byCode(code);
    if (!next || next === LM.c) return;
    LM.c = next;
    try {
      localStorage.setItem(K_CTY, code);
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new CustomEvent("lm:country"));
  },

  /**
   * Can this cart line be sold in the market currently selected? A basket survives a
   * country change, so a line may name something this market does not carry or has run
   * out of. The till is what refuses the order; this lets the shop say so first.
   */
  lineOffered(line) {
    if (!line) return true;
    /* the set: its window and its markets too, not only its stock */
    if (LM.isBundle(line.sizeId)) return !!LM.offer(line.sizeId) && LM.bundleSellable(line.sizeId);
    /* an offer: on here and now, the right number of scents, each sold here in the large box */
    if (LM.isTier(line.sizeId)) {
      const mix = Array.isArray(line.mix) ? line.mix : [];
      if (!LM.tierOn(line.sizeId) || mix.length !== LM.tierN(line.sizeId)) return false;
      const tsz = LM.tierSize();
      return mix.every((id) => {
        const sc = find<Scent>("scents", id);
        return !!sc && sc.active !== false && !scentOut(sc, tsz);
      });
    }
    /* AN EXTRA IS A PRODUCT, NOT A SCENT IN A BOX: judged on its own entry */
    const extra = find<Extra>("extras", line.sizeId);
    if (extra) return extra.active !== false && !outOfStock(extra) && LM.price(extra.id) > 0;
    /* a single box of the set's size: the set only (v309) */
    if (LM.bundleOnlySize() && String(line.sizeId) === LM.bundleOnlySize()) return false;
    /* a missing entry counts as unavailable: this market does not carry it */
    const scent = find<Scent>("scents", line.scentId);
    const size = find<Size>("sizes", line.sizeId);
    if (size && (size.hidden === true || size.hidden === "true")) return false;
    return !outOfStock(size) && LM.price(line.sizeId) > 0 && !!scent && scent.active !== false && !scentOut(scent, line.sizeId);
  },
  /** the lines this country cannot sell; empty means the basket is fine */
  blockedLines(cart) {
    return (cart || []).filter((l) => !LM.lineOffered(l));
  },

  /**
   * THE ONE PLACE A CART LINE BECOMES AN ITEM ID — what the order posts to the till and
   * what the pixels report. The till parses exactly this.
   */
  itemId(line) {
    if (!line) return "";
    if (LM.isTier(line.sizeId)) return LM.tierId(line.sizeId, line.mix);
    if (LM.isBundle(line.sizeId)) return line.sizeId;
    if (line.scentId === "bundle") return "bundle";
    /* an extra carries no scent: its own id IS the item */
    if (!line.scentId) return String(line.sizeId || "");
    return line.scentId + "-" + line.sizeId;
  },

  /**
   * WHAT A BASKET LINE IS CALLED, in the page's language and from the catalogue as it is
   * now; the words saved on the line are the fallback for a line the catalogue no longer
   * knows. { scent, size } as text.
   */
  lineLabel(line) {
    if (!line) return { scent: "", size: "" };
    if (LM.isTier(line.sizeId)) {
      const cnt = LM.tierCounts(line.mix);
      return {
        scent: line.sizeId === "trio" ? L("3 علب") : L("علبتان"),
        size: Object.keys(cnt)
          .map((id) => {
            const sc0 = find<Scent>("scents", id) || null;
            const nm0 = sc0 ? txt(sc0, "name") : id;
            return cnt[id]! > 1 ? nm0 + " ×" + cnt[id] : nm0;
          })
          .join(" · "),
      };
    }
    if (LM.isBundle(line.sizeId) || line.scentId === "bundle") {
      const o = LM.offerCfg(LM.isBundle(line.sizeId) ? line.sizeId : "bundle");
      /* (v336) the retired bundle2 has no config left: it is named as the set, never an empty line */
      const o1 = LM.offerCfg("bundle");
      return {
        scent: txt(o, "name") || line.scent || txt(o1, "name") || L("باقة الروائح الثلاث"),
        size: txt(o, "note") || line.size || "",
      };
    }
    const x = !line.scentId ? find<Extra>("extras", line.sizeId) || null : null;
    if (x) return { scent: txt(x, "name") || line.scent || "", size: txt(x, "note") || line.size || "" };
    const sc = find<Scent>("scents", line.scentId) || null;
    const sz = find<Size>("sizes", line.sizeId) || null;
    return { scent: sc ? txt(sc, "name") : line.scent || "", size: sz ? txt(sz, "name") : line.size || "" };
  },

  /** the add-on a line stands for, or null if it is a box of resin */
  extraOf(line) {
    if (!line || line.scentId) return null;
    return LM.listFor("extras").filter((e) => e && e.id === line.sizeId)[0] || null;
  },
  /** SAMPLES DO NOT BUY FREE DELIVERY: charged, but left out of the free-delivery amount */
  countsFree(line) {
    return sharedCountsFree(LM.extraOf(line));
  },
  /** the part of a basket that counts toward free delivery; `unit` prices a line (else this market's price) */
  freeSub(cart, unit) {
    return (cart || []).reduce((t, l) => {
      if (!LM.countsFree(l)) return t;
      return t + (unit ? unit(l) : LM.price(l.sizeId)) * l.qty;
    }, 0);
  },
};
