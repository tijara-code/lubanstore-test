/**
 * Set once, read rarely, at the foot of the tab (v446):
 *
 *   Who carries each market   one route per market — Empower (Omniful) or by hand — a radio,
 *                             never two (two couriers is two parcels); saved at once
 *   Omniful SKU codes         the code Omniful's catalogue knows each product by; "Match from
 *                             Omniful" fills them (by code, then by name) and marks a box Omniful
 *                             does not know; nothing is saved until "Save SKU codes"
 */
import { useEffect, useId, useState } from "preact/hooks";
import type { Catalogue } from "../../../shared/catalogue/types";
import { isApiError } from "../../data/api";
import { KEYS } from "../../data/hooks";
import { invalidate } from "../../data/query";
import { Btn, Pill, toast } from "../../kit";
import { explain } from "../../lib/words";
import { FoldCard } from "../catalogue/Offers";
import { matchSkus, omnifulSkus, saveSkus, setRoute, type EmpowerStatus } from "./api";
import { skuProducts } from "./lib";

export function Routes({ status }: { status: EmpowerStatus }) {
  const [busy, setBusy] = useState("");
  const rows = status.routing || [];
  const labels = status.labels || {};
  const mine = rows.filter((r) => r.courier === "omniful").length;
  const pick = async (code: string, courier: "omniful" | "manual") => {
    setBusy(code);
    try {
      await setRoute(code, courier);
      toast(code + " now goes " + (courier === "manual" ? "by hand" : "to " + (labels[courier] || courier)), true);
    } catch (e) {
      toast(isApiError(e, "no_such_market") ? code + " is not in the published catalogue." : explain(e, "Could not change that"));
    } finally {
      setBusy("");
      invalidate((k) => k.startsWith("empower") || k === KEYS.catalogue || k === "catalogue-edit");
    }
  };
  return (
    <FoldCard title="Who carries each market" stamp={mine + " of " + rows.length + (mine === 1 ? " market goes to Omniful" : " markets go to Omniful")} id="omfRouteCard">
      {!rows.length ? (
        <p class="hint">No markets yet.</p>
      ) : (
        <div class="stock-grid routes">
          {rows.map((r) => (
            <div class="stock-row" key={r.code} role="radiogroup" aria-label={"Who carries " + (r.name || r.code)}>
              <b>
                <span dir="auto">{r.name || r.code}</span> <Pill tone="muted">{r.code}</Pill>
              </b>
              <span class="flag-wrap">
                {(status.couriers || ["omniful", "manual"]).map((c) => (
                  <label class="flag-sw" key={c} title={c === "manual" ? "Moved through the status flow by hand, with a tracking number typed in" : "Omniful's warehouse picks, packs and ships it"}>
                    <input type="radio" name={"route-" + r.code} checked={r.courier === c} disabled={busy === r.code} onChange={() => pick(r.code, c as "omniful" | "manual")} />
                    <span>{labels[c] || c}</span>
                  </label>
                ))}
              </span>
              {r.chosen ? null : <em class="sub">default</em>}
            </div>
          ))}
        </div>
      )}
    </FoldCard>
  );
}

export function Skus({ status, cfg }: { status: EmpowerStatus; cfg: Catalogue | null }) {
  const list = skuProducts(cfg);
  const saved = status.skus || {};
  const [vals, setVals] = useState<Record<string, string>>(() => ({ ...saved }));
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [known, setKnown] = useState<Array<{ sku_code: string; name: string }>>([]);
  const [busy, setBusy] = useState<"" | "match" | "save">("");
  const dl = useId();
  // the saved map changed (saved elsewhere, a refresh): take it unless being edited
  const dirty = list.some((p) => (vals[p.code] || "") !== (saved[p.code] || ""));
  useEffect(() => {
    if (!dirty) setVals({ ...saved });
  }, [JSON.stringify(saved)]);
  const set = list.filter((p) => saved[p.code]).length;

  const typed = () => {
    const out: Record<string, string> = {};
    for (const p of list) out[p.code] = (vals[p.code] || "").trim();
    return out;
  };
  const match = async () => {
    setBusy("match");
    try {
      const [m, cat] = await Promise.all([matchSkus(typed()), omnifulSkus().catch(() => null)]);
      if (cat) setKnown(cat.skus || []);
      const next = { ...vals };
      const probs: Record<string, string> = {};
      let n = 0;
      for (const p of list) {
        const hit = m.matches[p.code];
        if (!hit) continue;
        if (hit.sku && (next[p.code] || "").trim() !== hit.sku) {
          next[p.code] = hit.sku;
          n++;
        } else if (hit.problem) probs[p.code] = hit.problem;
      }
      setVals(next);
      setProblems(probs);
      toast(m.known ? (n ? n + " filled in from Omniful's " + m.known + " SKUs. Check, then Save." : "Nothing to change. All boxes match Omniful.") : "Omniful returned no SKUs", !!m.known);
    } catch (e) {
      toast(explain(e, "Could not read Omniful's SKUs"));
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      const j = await saveSkus(typed());
      setVals({ ...j.skus });
      setProblems({});
      toast("SKU codes saved", true);
      invalidate((k) => k.startsWith("empower"));
    } catch (e) {
      toast(isApiError(e, "bad_sku") ? "One of the codes has a character Omniful won't take." : explain(e, "Could not save the SKU codes"));
    } finally {
      setBusy("");
    }
  };
  return (
    <FoldCard title="Omniful SKU codes" stamp={set ? set + " of " + list.length + " set" : "using our own codes"} id="omfSkuCard">
      <p class="hint">
        Omniful <b>SKU code</b>, e.g. LM3001. <b>Match from Omniful</b> fills them; check, then Save. Bundle with a SKU = one kit.
      </p>
      <div class="tablewrap">
        <table class="tbl sku-tbl">
          <thead>
            <tr>
              <th>Product</th>
              <th class="hide-sm">Our code</th>
              <th>Omniful SKU</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.code}>
                <td dir="auto">{p.name}</td>
                <td class="hide-sm">
                  <code>{p.code}</code>
                </td>
                <td>
                  <input
                    class={"sku-in" + (problems[p.code] ? " bad" : "")}
                    value={vals[p.code] || ""}
                    placeholder={p.empty || p.code.toUpperCase()}
                    dir="ltr"
                    maxLength={80}
                    autocomplete="off"
                    list={dl}
                    title={problems[p.code] || ""}
                    aria-invalid={problems[p.code] ? "true" : undefined}
                    aria-label={"Omniful SKU for " + p.name}
                    onInput={(e) => {
                      setVals({ ...vals, [p.code]: (e.currentTarget as HTMLInputElement).value });
                      if (problems[p.code]) {
                        const n = { ...problems };
                        delete n[p.code];
                        setProblems(n);
                      }
                    }}
                  />
                  {problems[p.code] ? <em class="err-t">{problems[p.code]}</em> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id={dl}>
        {known.map((k) => (
          <option key={k.sku_code} value={k.sku_code}>
            {k.name}
          </option>
        ))}
      </datalist>
      <div class="item-acts">
        <Btn sm icon="link" busy={busy === "match"} onClick={match}>
          Match from Omniful
        </Btn>
        <Btn sm kind="primary" icon="check" class="spacer" busy={busy === "save"} onClick={save}>
          Save SKU codes
        </Btn>
      </div>
    </FoldCard>
  );
}
