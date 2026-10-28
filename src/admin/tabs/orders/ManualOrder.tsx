/**
 * A WHATSAPP ORDER, TYPED IN — saved as a real order (an LM- number, priced by the checkout's
 * own engine, origin "whatsapp_order") so it reaches Orders, Empower's waiting list,
 * Customers and the figures like any other. The market sets the prices; the items come from
 * the market's options (sold-out ones marked, allowed: the shop decides what goes in a
 * hand-made order); the running total is the server's quote. Paid by transfer = paid outside
 * the gateway (no cash fee); cash on delivery may carry an agreed amount to collect. One form
 * filled = one order, even if Create is pressed twice (dedupeId).
 *
 * Exported as a form (`ManualOrderForm`) for the Empower tab, and as a dialog for Orders.
 */
import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { ManualOrderBody } from "../../../shared/admin/api";
import { manualCreate, manualQuote, type QuoteAnswer } from "../../data/endpoints";
import { afterOrderWrite, marketOf, useCatalogue, useItemOptions } from "../../data/hooks";
import { Btn, Field, Modal, toast } from "../../kit";
import { isOman, placesOf } from "../../lib/cities";
import { money } from "../../lib/format";
import { COUNTRY_EN, explain } from "../../lib/words";
import { ItemLines, itemsOf, newLine, type Line } from "./ItemLines";

const dedupe = () => "wa-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

interface Form {
  country: string;
  name: string;
  phone: string;
  city: string;
  area: string;
  email: string;
  note: string;
  pay: "cod" | "transfer";
  cod: string;
}
const blank = (country: string): Form => ({ country, name: "", phone: "", city: "", area: "", email: "", note: "", pay: "cod", cod: "" });

/** What the form is missing before it is sent (the server checks again). */
export function missingOf(f: Form, lines: Line[]): string {
  if (!f.name.trim()) return "Add the customer's name.";
  if (f.phone.replace(/\D/g, "").length < 7) return "Check the phone number.";
  if (!f.city.trim()) return "Add the city.";
  if (!itemsOf(lines).length) return "Add at least one item.";
  if (f.pay === "cod" && f.cod.trim() !== "" && !(Number(f.cod) >= 0)) return "Check the COD amount.";
  return "";
}

export function bodyOf(f: Form, lines: Line[], dedupeId: string): ManualOrderBody {
  return {
    countryCode: f.country,
    name: f.name.trim(),
    phone: f.phone.trim(),
    city: f.city.trim(),
    region: f.area.trim() || undefined,
    email: f.email.trim() || undefined,
    note: f.note.trim() || undefined,
    items: itemsOf(lines),
    pay: f.pay,
    codAmount: f.pay === "cod" && f.cod.trim() ? f.cod.trim() : undefined,
    dedupeId,
  };
}

export function ManualOrderForm({ onCreated, onCancel }: { onCreated?: (id: string) => void; onCancel?: () => void }) {
  const cat = useCatalogue();
  const markets = cat.data?.data.countries || [];
  const [f, setF] = useState<Form>(blank(""));
  const [lines, setLines] = useState<Line[]>([]);
  const [key, setKey] = useState(dedupe);
  const [quote, setQuote] = useState<{ q?: QuoteAnswer; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const cityList = useId();
  const code = f.country || (markets[0]?.code ?? "");
  const opts = useItemOptions(code || null);
  const market = marketOf(markets, code);
  const places = useMemo(() => placesOf(code), [code]);

  // a new market: its items, its places
  useEffect(() => {
    if (opts.data && opts.data.country === code && !lines.length) setLines([newLine(opts.data.items)]);
  }, [opts.data, code, lines.length]);

  // the running total, a moment after the last change
  const items = itemsOf(lines);
  const sig = JSON.stringify([code, items, f.pay, f.cod]);
  useEffect(() => {
    if (!code || !items.length) return setQuote(null);
    let live = true;
    const t = setTimeout(() => {
      manualQuote({ countryCode: code, items, pay: f.pay, codAmount: f.pay === "cod" && f.cod.trim() ? f.cod.trim() : undefined }).then(
        (q) => live && setQuote({ q }),
        (e) => live && setQuote({ err: explain(e) }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sig]);

  const set = (k: keyof Form) => (e: Event) => setF({ ...f, country: code, [k]: (e.currentTarget as HTMLInputElement).value });
  const reset = () => {
    setF(blank(code));
    if (opts.data) setLines([newLine(opts.data.items)]);
    setKey(dedupe());
  };

  const save = async () => {
    const need = missingOf(f, lines);
    if (need) return toast(need);
    setBusy(true);
    try {
      const j = await manualCreate(bodyOf({ ...f, country: code }, lines, key));
      toast((j.already ? "Already saved: " : "Created ") + j.id + " · " + money(j.total, j.cur), true);
      reset();
      await afterOrderWrite();
      onCreated?.(j.id);
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const q = quote?.q;
  const oman = isOman(code);
  return (
    <div class="wa-form">
      <div class="form-grid four">
        <Field label="Country">
          <select
            class="pick"
            value={code}
            onChange={(e) => {
              const c = (e.currentTarget as HTMLSelectElement).value;
              setF({ ...f, country: c, city: "" });
              setLines([]);
            }}
          >
            {markets.map((c) => (
              <option key={c.code} value={c.code}>
                {(c.flag ? c.flag + " " : "") + (COUNTRY_EN[c.code] || c.name_en || c.name || c.code)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input value={f.name} onInput={set("name")} autocomplete="off" dir="auto" />
        </Field>
        <Field label="Phone">
          <span class="dial">
            <i>+{market?.dial || ""}</i>
            <input value={f.phone} onInput={set("phone")} inputMode="numeric" dir="ltr" autocomplete="off" aria-label="Phone" />
          </span>
        </Field>
        <Field label={oman ? "Governorate" : "City"}>
          {oman ? (
            <select class="pick" value={f.city} onChange={set("city")}>
              <option value="">Choose…</option>
              {places.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value + (p.en ? " · " + p.en : "")}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input value={f.city} onInput={set("city")} list={cityList} autocomplete="off" dir="auto" />
              <datalist id={cityList}>
                {places.map((p) => (
                  <option key={p.value} value={p.value} label={p.en || undefined} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Area / street">
          <input value={f.area} onInput={set("area")} autocomplete="off" dir="auto" />
        </Field>
        <Field label="Email (optional)">
          <input value={f.email} onInput={set("email")} type="email" dir="ltr" autocomplete="off" />
        </Field>
        <Field label="Payment">
          <select class="pick" value={f.pay} onChange={set("pay")}>
            <option value="cod">Cash on delivery</option>
            <option value="transfer">Already paid (transfer / pay link)</option>
          </select>
        </Field>
        {f.pay === "cod" ? (
          <Field label={"Amount to collect" + (market?.cur ? " (" + market.cur + ")" : "")}>
            <input value={f.cod} onInput={set("cod")} inputMode="decimal" dir="ltr" placeholder="Catalogue total" autocomplete="off" />
          </Field>
        ) : null}
        <Field label="Note" class="wide">
          <input value={f.note} onInput={set("note")} autocomplete="off" dir="auto" />
        </Field>
      </div>

      <h3 class="wa-items">Items</h3>
      {opts.data && opts.data.country === code ? (
        <ItemLines lines={lines} onChange={setLines} options={opts.data.items} cur={opts.data.cur} />
      ) : (
        <p class="hint">{opts.error ? "Could not load the catalogue: " + explain(opts.error) : code ? "Loading what this country sells…" : cat.error ? explain(cat.error) : "Loading the markets…"}</p>
      )}
      <div class="item-acts">
        <Btn sm icon="plus" disabled={!opts.data} onClick={() => opts.data && setLines([...lines, newLine(opts.data.items)])}>
          Add item
        </Btn>
        <span class="wa-total spacer" aria-live="polite">
          {quote?.err ? (
            <span class="warn-t">{quote.err}</span>
          ) : q ? (
            q.codAmount != null ? (
              <>
                Collect <b>{money(q.codAmount, q.cur)}</b>
                <span class="sub"> · catalogue total {money(q.catalogueTotal, q.cur)}</span>
              </>
            ) : (
              <>
                Total <b>{money(q.total, q.cur)}</b>
                <span class="sub">
                  {" "}
                  · items {money(q.sub, q.cur)} · delivery {q.ship ? money(q.ship, q.cur) : "free"}
                  {q.codFee ? " · COD fee " + money(q.codFee, q.cur) : ""}
                </span>
              </>
            )
          ) : null}
        </span>
      </div>
      <div class="item-acts">
        {onCancel ? (
          <Btn sm kind="ghost" onClick={onCancel}>
            Cancel
          </Btn>
        ) : null}
        <Btn sm icon="undo" class="spacer" onClick={reset}>
          Clear
        </Btn>
        <Btn sm kind="primary" icon="check" busy={busy} onClick={save}>
          Create order
        </Btn>
      </div>
    </div>
  );
}

export function ManualOrder({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New WhatsApp order" wide>
      <p class="hint">Saved as a real order and priced from the catalogue.</p>
      <ManualOrderForm onCreated={onCreated} onCancel={onClose} />
    </Modal>
  );
}
