/**
 * THE LINES OF A BASKET, edited — shared by the item editor and the typed-in order form.
 *
 * What may be chosen comes from the server (GET /orders/options?country=): every box (scent ×
 * size), the set, the add-ons and the large-box offers, with the market's price, sold-out ones
 * marked (the shop may still pick them; the server decides). A line whose item the market
 * does not offer now is kept as its own choice, "(not offered now)", so opening the editor
 * never rewrites it. An add-on or the set is a whole product (its id is kept as it is); a
 * large-box offer is composed from its scents ("duo:oud.amber"). The panel sends ids and
 * quantities only — never a price.
 */
import type { ItemOption } from "../../../shared/admin/api";
import type { OrderLine } from "../../../shared/orders/types";
import { Btn, QtyStepper, toast } from "../../kit";
import { money } from "../../lib/format";
import { itemEn, lineName } from "../../lib/order";

export interface Line {
  /** a box/set/extra id, a tier template ("duo"), or a kept id the market does not offer */
  pick: string;
  /** the scents of a large-box offer */
  scents: string[];
  qty: number;
  /** the stored line's own words (for a kept id) */
  was?: string;
}

const TIER_N: Record<string, number> = { duo: 2, trio: 3 };

export function lineOf(l: Pick<OrderLine, "itemId" | "qty" | "scent" | "size">): Line {
  const id = String(l.itemId || "");
  const tm = /^(duo|trio):([a-z0-9_.-]+)$/.exec(id);
  if (tm) return { pick: tm[1]!, scents: tm[2]!.split("."), qty: Number(l.qty) || 1 };
  return { pick: id, scents: [], qty: Number(l.qty) || 1, was: lineName(l as OrderLine) || itemEn(l) || id };
}

/** The scents a large-box offer can be made of (the boxes of its size). */
export function tierScents(options: ItemOption[], tier: ItemOption | undefined): ItemOption[] {
  if (!tier) return [];
  const seen = new Set<string>();
  return options.filter((o) => o.kind === "box" && o.sizeId === tier.sizeId && o.scentId && !seen.has(o.scentId) && !!seen.add(o.scentId));
}

/** The basket the API takes: { itemId, qty } per line. */
export function itemsOf(lines: Line[]): Array<{ itemId: string; qty: number }> {
  return lines
    .filter((l) => l.pick)
    .map((l) => ({ itemId: TIER_N[l.pick] ? l.pick + ":" + l.scents.slice(0, TIER_N[l.pick]).join(".") : l.pick, qty: Math.max(1, Math.min(99, l.qty)) }));
}

/** A fresh line: the first offered item, else the first. */
export function newLine(options: ItemOption[]): Line {
  const first = options.find((o) => o.active && o.kind !== "tier") || options.find((o) => o.kind !== "tier") || options[0];
  return { pick: first ? first.itemId : "", scents: [], qty: 1 };
}

function optionLabel(o: ItemOption, cur: string): string {
  const name = o.name_en && o.name_en !== o.name ? o.name_en + " · " + o.name : o.name;
  return name + (o.price != null ? " — " + money(o.price, cur) : "") + (o.soldOut ? " — sold out" : !o.active ? " (not offered now)" : "");
}

const GROUPS: Array<[ItemOption["kind"], string]> = [
  ["box", "Boxes"],
  ["set", "The set"],
  ["tier", "Large-box offers"],
  ["extra", "Add-ons"],
];

export function ItemLines({ lines, onChange, options, cur }: { lines: Line[]; onChange: (lines: Line[]) => void; options: ItemOption[]; cur: string }) {
  const set = (i: number, l: Line) => onChange(lines.map((x, k) => (k === i ? l : x)));
  const known = new Set(options.map((o) => o.itemId));
  return (
    <div class="item-lines">
      {lines.map((l, i) => {
        const tier = TIER_N[l.pick] ? options.find((o) => o.itemId === l.pick) : undefined;
        const scents = tierScents(options, tier);
        return (
          <div class="item-line" key={i}>
            <select
              class="pick sm"
              aria-label={"Item " + (i + 1)}
              value={l.pick}
              onChange={(e) => {
                const pick = (e.currentTarget as HTMLSelectElement).value;
                const t = options.find((o) => o.itemId === pick);
                const sc = t && t.kind === "tier" ? tierScents(options, t).map((s) => s.scentId!) : [];
                set(i, { pick, qty: l.qty, scents: TIER_N[pick] ? Array.from({ length: TIER_N[pick]! }, (_, k) => sc[k % Math.max(1, sc.length)] || "") : [] });
              }}
            >
              {l.pick && !known.has(l.pick) ? <option value={l.pick}>{(l.was || l.pick) + " (not offered now)"}</option> : null}
              {GROUPS.map(([kind, label]) => {
                const list = options.filter((o) => o.kind === kind);
                return list.length ? (
                  <optgroup label={label} key={kind}>
                    {list.map((o) => (
                      <option key={o.itemId} value={o.itemId}>
                        {optionLabel(o, cur)}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
            {tier
              ? Array.from({ length: TIER_N[l.pick]! }, (_, k) => (
                  <select
                    key={"s" + k}
                    class="pick sm"
                    aria-label={"Scent " + (k + 1) + " of item " + (i + 1)}
                    value={l.scents[k] || ""}
                    onChange={(e) => {
                      const next = [...l.scents];
                      next[k] = (e.currentTarget as HTMLSelectElement).value;
                      set(i, { ...l, scents: next });
                    }}
                  >
                    {scents.map((s) => (
                      <option key={s.scentId} value={s.scentId}>
                        {(s.name_en || s.name).split(" · ")[0]}
                      </option>
                    ))}
                  </select>
                ))
              : null}
            <QtyStepper value={l.qty} onChange={(qty) => set(i, { ...l, qty })} label={"Quantity of item " + (i + 1)} />
            <Btn
              sm
              iconOnly
              icon="x"
              label={"Remove item " + (i + 1)}
              onClick={() => {
                if (lines.length < 2) return toast("An order needs at least one item");
                onChange(lines.filter((_, k) => k !== i));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
