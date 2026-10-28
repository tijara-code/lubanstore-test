/**
 * EDITING WHAT IS ON AN ORDER — read-only until asked, because this is the block whose Save
 * moves money. The panel sends item ids and quantities; the server re-quotes the basket with
 * the checkout's own pricing (delivery and the COD fee included) and refuses what it must
 * (shipped, booked with Empower, the card page still open, not sold here, out of stock). The
 * only figure a person may type is the amount to collect on an unpaid cash order (empty = the
 * catalogue's total).
 */
import { useState } from "preact/hooks";
import { putItems } from "../../data/endpoints";
import { afterOrderWrite, useItemOptions } from "../../data/hooks";
import { Btn, Field, toast } from "../../kit";
import { money } from "../../lib/format";
import { explain } from "../../lib/words";
import { ItemLines, itemsOf, lineOf, newLine, type Line } from "./ItemLines";
import type { DetailOrder } from "./OrderDetail";

/** `manual`: the Empower tab's "adjust before push" (v189) — sold-out and switched-off items allowed, no shelf cap. */
export function ItemsEditor({ order: o, onDone, manual }: { order: DetailOrder; onDone: () => void; manual?: boolean }) {
  const opts = useItemOptions(o.countryCode);
  const [lines, setLines] = useState<Line[]>(() => (o.items || []).map(lineOf));
  const [cod, setCod] = useState("");
  const [busy, setBusy] = useState(false);
  const unpaidCod = o.pay === "cod" && o.paymentStatus !== "paid" && !o.refunded;

  if (!opts.data) return <p class="hint">{opts.error ? "Could not load the catalogue: " + explain(opts.error) : "Loading what this country sells…"}</p>;
  const options = opts.data.items;

  const save = async () => {
    const items = itemsOf(lines);
    if (!items.length) return toast("An order needs at least one item");
    setBusy(true);
    try {
      const j = await putItems(o.id, { items, ...(manual ? { manual: true } : {}), ...(unpaidCod && cod.trim() ? { codAmount: cod.trim() } : {}) });
      toast("Total is now " + money(j.total, j.cur) + (j.was && j.was !== j.total ? " (was " + money(j.was, j.cur) + ")" : ""), true);
      onDone();
      await afterOrderWrite();
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="item-edit">
      <ItemLines lines={lines} onChange={setLines} options={options} cur={opts.data.cur} />
      {unpaidCod ? (
        <Field label={"Amount to collect (" + o.cur + ")"} class="cod-amt">
          <input value={cod} onInput={(e) => setCod((e.currentTarget as HTMLInputElement).value)} inputMode="decimal" dir="ltr" placeholder="Catalogue total" />
        </Field>
      ) : null}
      <div class="item-acts">
        <Btn sm icon="plus" onClick={() => setLines([...lines, newLine(options)])}>
          Add item
        </Btn>
        <Btn sm kind="primary" class="spacer" busy={busy} onClick={save}>
          Re-quote &amp; save
        </Btn>
        <Btn sm onClick={onDone}>
          Cancel
        </Btn>
      </div>
      <p class="hint sml">
        Re-priced from the catalogue, delivery and COD fee included.
        {unpaidCod ? " Amount: only for an agreed price (empty = catalogue total)." : ""}
      </p>
    </div>
  );
}
