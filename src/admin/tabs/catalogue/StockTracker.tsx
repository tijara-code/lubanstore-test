/**
 * STOCK TRACKER (v207/v208/v211/v319) — what the shelf at Empower holds, box by box: Empower's
 * available figure, what orders placed here and not yet on Empower hold, what is left to sell,
 * on hand. Three switches, saved AT ONCE through their own route (PATCH /catalogue/stock), which
 * writes only them — a switch never publishes the tab's other, unsaved edits:
 *   · the pieces-left counter on the product page
 *   · Hide at 0, per box: off the product page while none is available
 *   · Cap at stock, per box: a shopper can add only as many as the shelf has; the till refuses more
 * "Read the shelf now" asks Omniful again (GET /stock?fresh=1). Only the newest reading draws.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { isApiError } from "../../data/api";
import { Btn, Pill, Switch, toast } from "../../kit";
import { explain } from "../../lib/words";
import { patchStock, readStock, type Published, type StockRead } from "./api";
import { FoldCard } from "./Offers";
import { muscatText, type Draft } from "./model";

/** The heading's words: which failure, or the pieces left per size. */
export function stockStamp(d: Draft, r: StockRead | null | { error: string }): { text: string; tone: string } {
  const on = d.stockLive === true;
  const hide = Object.values(d.stockHide || {}).some((v) => v === true) || Object.values(d.stockCap || {}).some((v) => v === true);
  if (!on && !hide) return { text: "off", tone: "" };
  if (!r) return { text: on ? "counter on" : "hiding at 0", tone: "" };
  const e = r.error || "";
  const at = "at" in r ? r.at : null;
  if (e && !at) {
    return {
      text: /SKU codes match/.test(e) ? "SKU codes do not match the shelf" : /no row the panel can read/.test(e) ? "Empower's answer not understood" : /could not be read/.test(e) ? "SKU codes could not be read" : "Empower not answering",
      tone: "low",
    };
  }
  const left = "left" in r ? r.left : {};
  const sizes: string[] = [];
  for (const c of d.countries || []) for (const z of c.sizes || []) if (sizes.indexOf(z.id) < 0) sizes.push(z.id);
  return { text: sizes.map((id) => id + " " + (left[id] != null ? left[id] : "?")).join(" · "), tone: (at ? "ok" : "") + (e ? " low" : "") };
}

interface Row {
  id: string;
  name: string;
  sku: string;
  shelf: number | null;
  held: number | null;
  available: number | null;
  onHand: number | null;
}

/** One row per box the catalogue sells (scent × size), whether or not the shelf has been read. */
export function trackerRows(d: Draft, r: StockRead | null): Row[] {
  const sizes: Record<string, { id: string; name?: string; name_en?: string }> = {};
  const scents: Record<string, { id: string; name?: string; name_en?: string }> = {};
  for (const c of d.countries || []) {
    for (const z of c.sizes || []) if (z && z.id && !sizes[z.id]) sizes[z.id] = z;
    for (const s of c.scents || []) if (s && s.id && !scents[s.id]) scents[s.id] = s;
  }
  const en = (z: { id: string; name?: string; name_en?: string }) => String(z.name_en || z.name || z.id);
  const byId: Record<string, StockRead["tracker"][number]> = {};
  for (const t of (r && r.tracker) || []) byId[t.id] = t;
  const rows: Row[] = [];
  for (const sz of Object.keys(sizes)) {
    for (const sc of Object.keys(scents)) {
      const id = sc + "-" + sz;
      const t = byId[id];
      rows.push({
        id,
        name: en(scents[sc]!) + " " + en(sizes[sz]!),
        sku: t ? t.sku : (r && r.items && r.items[id]) || "",
        shelf: t ? (t.shelf != null ? t.shelf : t.available) : null,
        held: t ? t.reserved || 0 : null,
        available: t ? t.available : null,
        onHand: t ? t.onHand : null,
      });
    }
  }
  return rows;
}

export function StockTracker({ d, onSaved }: { d: Draft; onSaved: (j: Published) => void }) {
  const [read, setRead] = useState<StockRead | { error: string; at: null; left: Record<string, number> } | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const seq = useRef(0);
  const load = (fresh: boolean) => {
    const my = ++seq.current;
    if (fresh) setReading(true);
    return readStock(fresh).then(
      (j) => {
        if (my === seq.current) setRead(j);
      },
      (e) => {
        if (my === seq.current) setRead({ error: explain(e), at: null, left: {} });
      },
    ).finally(() => {
      if (my === seq.current) setReading(false);
    });
  };
  useEffect(() => {
    load(false);
  }, []);

  const save = async (what: string, body: Parameters<typeof patchStock>[0], said: string) => {
    setSaving(what);
    try {
      const j = await patchStock(body);
      onSaved(j);
      toast(said, true);
      load(false);
    } catch (e) {
      toast(isApiError(e, "not_published") ? "Publish the catalogue once before setting these." : explain(e));
    } finally {
      setSaving(null);
    }
  };

  const r = read && "tracker" in read ? read : null;
  const st = stockStamp(d, read);
  const hideMap = d.stockHide || {};
  const capMap = d.stockCap || {};
  const hiddenItems = (r && r.hide && r.hide.items) || [];
  const hiddenSizes = (r && r.hide && r.hide.sizes) || [];
  const rows = trackerRows(d, r);
  const n = (v: number | null) => (v == null ? "—" : String(v));
  const on = d.stockLive === true;
  const held = (r && r.held) || [];

  return (
    <FoldCard title="Stock Tracker" stamp={st.text} tone={st.tone} id="stockCard">
      <div class="fs-top st-top">
        <Switch checked={on} disabled={saving === "live"} onChange={(v) => save("live", { stockLive: v }, "Pieces-left counter " + (v ? "on" : "off"))}>
          {on ? "Counter on" : "Counter off"}
        </Switch>
        <Btn sm icon="refresh" busy={reading} onClick={() => load(true)}>
          {reading ? "Reading…" : "Read the shelf now"}
        </Btn>
      </div>
      <p class="hint sml">The switches here are saved as you flip them; they never publish the other edits on this page.</p>
      <div class="tablewrap">
        <table class="tbl st-tbl">
          <thead>
            <tr>
              <th>Item</th>
              <th>SKU</th>
              <th class="num" title="Available on the Empower SKU screen">
                Empower available
              </th>
              <th class="num" title="Placed here, not yet sent to Empower (listed below the table)">
                Held here
              </th>
              <th class="num" title="Empower available less held: what the page and the till go by">
                To sell
              </th>
              <th class="num">On hand</th>
              <th title="Take this box off the product page while none is available">Hide at 0</th>
              <th title="A shopper can add only as many of this box as the shelf has; the till refuses more">Cap at stock</th>
              <th>On the page</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const size = t.id.replace(/^.+-/, "");
              const tick = hideMap[t.id] === true;
              const cap = capMap[t.id] === true;
              const off = tick && (hiddenItems.indexOf(t.id) > -1 || hiddenSizes.indexOf(size) > -1);
              return (
                <tr key={t.id} class={off ? "st-off" : ""}>
                  <td>
                    {t.name}
                    <small class="sub">{t.id}</small>
                  </td>
                  <td dir="ltr">{t.sku}</td>
                  <td class="num">{n(t.shelf)}</td>
                  <td class="num">{t.held == null ? "—" : String(t.held)}</td>
                  <td class="num">
                    <b>{n(t.available)}</b>
                  </td>
                  <td class="num">{n(t.onHand)}</td>
                  <td>
                    <Switch checked={tick} disabled={saving === "h" + t.id} onChange={(v) => save("h" + t.id, { stockHide: { [t.id]: v } }, t.id + " hide at 0 " + (v ? "on" : "off"))}>
                      <span class="sr-only">Hide {t.name} at 0: </span>
                      {tick ? "Yes" : "No"}
                    </Switch>
                  </td>
                  <td>
                    <Switch checked={cap} disabled={saving === "c" + t.id} onChange={(v) => save("c" + t.id, { stockCap: { [t.id]: v } }, t.id + " cap at stock " + (v ? "on" : "off"))}>
                      <span class="sr-only">Cap {t.name} at the shelf: </span>
                      {cap ? "Yes" : "No"}
                    </Switch>
                  </td>
                  <td>
                    {t.available == null ? (
                      <Pill>not read</Pill>
                    ) : off ? (
                      <Pill tone="void">hidden</Pill>
                    ) : t.available <= 0 ? (
                      <Pill>{"at 0, " + (cap ? "not for sale" : "still shown")}</Pill>
                    ) : cap ? (
                      <Pill tone="ship">{"up to " + t.available + " each"}</Pill>
                    ) : (
                      <Pill tone="ship">shown</Pill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {read ? (
        <p class="note st-note">
          {read.error ? "Empower: " + read.error + (read.at ? ". Showing reading from " + muscatText(read.at) : ". Nothing to show.") : read.at ? "Read " + muscatText(read.at) + (r && r.skus != null ? " · " + r.skus + " SKUs on the shelf" : "") : "Not read yet."}
          {r && r.fields && r.fields.length ? " · Unknown Empower fields: " + r.fields.join(", ") : ""}
          {r && r.note ? " · " + r.note : ""}
        </p>
      ) : (
        <p class="note">Reading the shelf…</p>
      )}
      {r && r.at ? (
        held.length ? (
          <p class="note st-held">
            Held here: {held.length} order{held.length > 1 ? "s" : ""} from the last {r.heldHours || 72} h, not sent to Empower yet:{" "}
            {held.slice(0, 30).map((o, k) => {
              const b = Object.keys(o.boxes || {})
                .map((x) => x + " ×" + o.boxes[x])
                .join(", ");
              return (
                <span key={o.id}>
                  {k ? " · " : ""}
                  <b>{o.id}</b> ({o.status === "pending" ? "awaiting card" : "new"}
                  {b ? ": " + b : ""})
                </span>
              );
            })}
            {held.length > 30 ? " · …" : ""}. Push or close them on the Empower tab and the gap goes.
          </p>
        ) : (
          <p class="note st-held">Held here: none. Counts are Empower's.</p>
        )
      ) : null}
    </FoldCard>
  );
}
