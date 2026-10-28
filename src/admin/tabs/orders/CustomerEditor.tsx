/**
 * EDITING WHO AND WHERE — the delivery details, and only those (one order at a time; the
 * money, the items and the payment have their own editors and guards). Only the fields that
 * changed are sent (PATCH /orders/:id/customer); the audit records their names, never their
 * values. Oman's governorate is a list (the courier reads it as a region); a town an order
 * already carries is kept as an extra choice, so opening the editor never quietly changes it.
 * The country is locked: it set the prices.
 */
import { useId, useState } from "preact/hooks";
import type { CustomerBody } from "../../../shared/admin/api";
import { patchCustomer } from "../../data/endpoints";
import { afterOrderWrite } from "../../data/hooks";
import { Btn, Field, toast } from "../../kit";
import { isOman, placesOf } from "../../lib/cities";
import { explain } from "../../lib/words";
import type { DetailOrder } from "./OrderDetail";

const FIELDS = ["name", "phone", "email", "city", "region", "note"] as const;
type Key = (typeof FIELDS)[number];

/** The fields that changed, trimmed (what the PATCH carries). */
export function changedFields(was: Partial<Record<Key, string | null>>, now: Record<Key, string>): CustomerBody {
  const out: CustomerBody = {};
  for (const k of FIELDS) {
    const v = now[k].trim();
    if (v !== String(was[k] ?? "").trim()) out[k] = v;
  }
  return out;
}

export function CustomerEditor({ order: o, onDone }: { order: DetailOrder; onDone: () => void }) {
  const [v, setV] = useState<Record<Key, string>>({
    name: o.name || "",
    phone: o.phone || "",
    email: o.email || "",
    city: o.city || "",
    region: o.region || "",
    note: o.note || "",
  });
  const [busy, setBusy] = useState(false);
  const list = useId();
  const set = (k: Key) => (e: Event) => setV({ ...v, [k]: (e.currentTarget as HTMLInputElement).value });
  const oman = isOman(o.countryCode);
  const places = placesOf(o.countryCode, [o.city]);

  const save = async () => {
    const patch = changedFields(o, v);
    if (!Object.keys(patch).length) {
      toast("Nothing changed", true);
      onDone();
      return;
    }
    setBusy(true);
    try {
      await patchCustomer(o.id, patch);
      toast("Customer details saved", true);
      onDone();
      await afterOrderWrite();
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="cust-edit">
      <div class="form-grid">
        <Field label="Name">
          <input value={v.name} onInput={set("name")} autocomplete="off" dir="auto" />
        </Field>
        <Field label="Phone">
          <input value={v.phone} onInput={set("phone")} dir="ltr" inputMode="tel" autocomplete="off" />
        </Field>
        <Field label="Email">
          <input value={v.email} onInput={set("email")} dir="ltr" type="email" placeholder="optional" autocomplete="off" />
        </Field>
        <Field label={oman ? "Governorate" : "City"}>
          {oman ? (
            <select class="pick" value={v.city} onChange={set("city")}>
              {!v.city ? <option value="">Choose…</option> : null}
              {places.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value + (p.en ? " · " + p.en : "")}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input value={v.city} onInput={set("city")} list={list} autocomplete="off" dir="auto" />
              <datalist id={list}>
                {places.map((p) => (
                  <option key={p.value} value={p.value} label={p.en || undefined} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Area">
          <input value={v.region} onInput={set("region")} autocomplete="off" dir="auto" />
        </Field>
        <Field label="Customer note">
          <input value={v.note} onInput={set("note")} autocomplete="off" dir="auto" />
        </Field>
      </div>
      <div class="item-acts">
        <Btn sm kind="primary" busy={busy} onClick={save}>
          Save
        </Btn>
        <Btn sm onClick={onDone}>
          Cancel
        </Btn>
      </div>
      <p class="hint sml">Country is locked (it sets the prices). Cancel and create a new order to change it.</p>
    </div>
  );
}
