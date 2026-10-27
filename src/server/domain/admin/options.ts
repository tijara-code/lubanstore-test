/**
 * WHAT THE ORDER EDITORS MAY OFFER — every item a market's basket line can carry, with the
 * market's price and whether it is sold out or off the storefront, so the item editor and the
 * typed-in (WhatsApp) order form can mark them instead of hiding them (the shop decides what
 * goes in a hand-made order; the till still prices it).
 *
 *   box    "<scent>-<size>"       every scent in every size
 *   set    "bundle"               the three-scent set
 *   extra  "<id>"                 the checkout add-ons
 *   tier   "duo" | "trio"         the large-box offers: the line is "duo:<scent>.<scent>"
 */
import type { ItemOption } from "../../../shared/admin/api";
import type { Catalogue, Country } from "../../../shared/catalogue/types";
import { offerIn, offerOf, bundleSizeId } from "../../../shared/pricing/offers";
import { countryFor, isHidden, listFor, outOfStock, parseItemId, scentOut, sellableIn } from "../../../shared/pricing/price";
import { TIERS, tierInMarket, tierSizeOf, NAME, NAME_EN } from "../../../shared/pricing/tiers";
import type { Deps } from "../../core/deps";
import { fail } from "../../core/http";
import { loadCatalogue } from "../catalogue";

const s = (v: unknown) => (v == null ? "" : String(v));

function priceOf(c: Country, id: string): { price: number | null; was: number | null } {
  const p = c.prices && c.prices[id];
  const now = p && Number(p.now);
  return { price: now && now > 0 ? now : null, was: p && Number(p.was) > 0 ? Number(p.was) : null };
}

export function itemOptions(cfg: Catalogue, code: string) {
  const c = countryFor(cfg, code);
  if (!c) throw fail("unknown_country", 400);
  const items: ItemOption[] = [];
  const sizes = listFor(cfg, c, "sizes");
  const scents = listFor(cfg, c, "scents");

  for (const size of sizes) {
    if (!size || !size.id) continue;
    const { price, was } = priceOf(c, size.id);
    for (const scent of scents) {
      if (!scent || !scent.id) continue;
      const itemId = scent.id + "-" + size.id;
      const soldOut = outOfStock(size) || scentOut(scent, size.id);
      const live = !!parseItemId(cfg, itemId, c) && sellableIn(cfg, c, size.id, scent.id);
      items.push({
        itemId, kind: "box", scentId: scent.id, sizeId: size.id,
        name: s(scent.name) + " · " + s(size.name), name_en: s(scent.name_en || scent.name) + " · " + s(size.name_en || size.name),
        price, was, soldOut, active: live && price != null && !isHidden(size) && scent.active !== false,
      });
    }
  }

  const offer = offerOf(cfg, "bundle");
  if (offer) {
    const { price, was } = priceOf(c, "bundle");
    const sizeId = bundleSizeId(cfg, "bundle");
    const sellable = sellableIn(cfg, c, "bundle", null);
    items.push({
      itemId: "bundle", kind: "set", sizeId,
      name: s(offer.name) || "باقة", name_en: s(offer.name_en) || "3-scent bundle",
      price, was, soldOut: !sellable && offerIn(cfg, c.code, "bundle"),
      active: offer.active !== false && offerIn(cfg, c.code, "bundle") && sellable && price != null,
    });
  }

  for (const x of listFor(cfg, c, "extras")) {
    if (!x || !x.id) continue;
    const { price, was } = priceOf(c, x.id);
    items.push({
      itemId: x.id, kind: "extra", name: s(x.name), name_en: s(x.name_en || x.name),
      price, was, soldOut: outOfStock(x), active: x.active !== false && !outOfStock(x) && price != null,
    });
  }

  const tierSize = tierSizeOf(cfg);
  for (const tier of Object.keys(TIERS)) {
    const { price, was } = priceOf(c, tier);
    if (price == null) continue;
    items.push({
      itemId: tier, kind: "tier", sizeId: tierSize,
      name: NAME[tier] || tier, name_en: NAME_EN[tier] || tier,
      price, was, soldOut: false, active: tierInMarket(cfg, c, tier),
    });
  }
  return { ok: true as const, country: c.code, cur: c.cur, dec: Number(c.dec) || 0, items };
}

export async function orderItemOptions(deps: Deps, code: string) {
  return itemOptions(await loadCatalogue(deps, { fresh: true }), code);
}
