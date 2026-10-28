/**
 * MARKETS AND PRICES — "Common to every market" (the stock grid across all markets), then one
 * card per market, read top to bottom: who it is, what it costs (and who carries it), its sizes
 * and prices (the set's and the large-box offers' prices too), its scents, its checkout
 * add-ons. Every Arabic word has its English box beside it ("· EN"). Cards are folded unless
 * opened; which are open survives a redraw. Removing anything asks first, naming the market.
 */
import { useState } from "preact/hooks";
import type { Catalogue, Country } from "../../../shared/catalogue/types";
import { isApiError } from "../../data/api";
import { ask, Btn, Icon, Modal, Pill, Switch, toast } from "../../kit";
import { COUNTRY_EN, explain } from "../../lib/words";
import { setRoute } from "./api";
import { Box, ColorBox, Gap, NumBox, Pick, TextBox, Tick } from "./fields";
import {
  addCountry, allScents, allSizes, commonStamp, marketsStamp, missingSizes, newExtra, newScent, newSize, renameExtraId, renameSizeId, restoreSize,
  scentStock, setScentEverywhere, setScentOutHere, type Draft,
} from "./model";

export type Edit = (fn: (d: Draft) => void) => void;

const MONEY = { min: 0, max: 1_000_000, dec: 3 };
const yes = (v: unknown) => v === true || v === "true";
const marketName = (c: Country) => (c.name || COUNTRY_EN[c.code] || c.code) + " (" + c.code + ")";

/* ---------------- Common to every market ---------------- */

function Common({ d, edit }: { d: Draft; edit: Edit }) {
  const [open, setOpen] = useState(false);
  const bundleSize = String((d.offer && d.offer.sizeId) || "small");
  const bundleName = (allSizes(d).find((z) => z.id === bundleSize) || { name: "small" }).name;
  const sizes = allSizes(d);
  return (
    <div class={"common" + (open ? " open" : "")}>
      <div class="sub-head">
        <button type="button" class="fold-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name="chev" class="fold-chev" />
          <h3>Common to every market</h3>
        </button>
        <span class="stamp">{commonStamp(d)}</span>
      </div>
      <div hidden={!open} class="common-body">
        <div class="cty-sec">
          <h4>Stock, all markets</h4>
          <p class="hint sml">Ticked = sold out in every market. The bundle is packed from the {bundleName} box: a scent out of it hides the bundle.</p>
          <div class="stock-grid" role="group" aria-label="Sold out everywhere" title={"Ticked = sold out everywhere. Bundle is packed from the " + bundleName + " box. A scent out of it hides the bundle."}>
            {allScents(d).map((s) => (
              <div class="stock-row" key={s.id}>
                <b dir="auto">{s.name}</b>
                {sizes.map((z) => {
                  const st = scentStock(d, s.id, z.id);
                  return (
                    <span key={z.id} title={st.note + (z.id === bundleSize ? " · bundle is packed from this box" : "")}>
                      <Switch
                        checked={st.all}
                        onChange={(on) => {
                          edit((x) => setScentEverywhere(x, s.id, z.id, on));
                          toast((on ? "Sold out" : "Back in stock") + " everywhere. Save & publish to apply.", true);
                        }}
                      >
                        <span dir="auto">{z.name}</span>
                        {st.some && !st.all ? <em class="sub"> (out in {st.some})</em> : null}
                      </Switch>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- one market ---------------- */

function CountryCard({ c, i, d, edit, loaded, published, open, onToggle, onRouted }: {
  c: Country;
  i: number;
  d: Draft;
  edit: Edit;
  loaded: Catalogue | null;
  published: boolean;
  open: boolean;
  onToggle: () => void;
  onRouted: (code: string, courier: string) => void;
}) {
  const [routing, setRouting] = useState(false);
  const ec = (fn: (c: Country) => void) => edit((x) => fn(x.countries[i]!));
  const price = (id: string, k: "now" | "was") => {
    const p = (c.prices || {})[id];
    return p ? p[k] : 0;
  };
  const setPrice = (id: string, k: "now" | "was", v: number | null) =>
    ec((m) => {
      m.prices = m.prices || {};
      const p = (m.prices[id] = m.prices[id] || { now: 0, was: 0 });
      p[k] = v || 0;
      if (p.was === undefined) p.was = 0;
    });
  const cur = c.cur || "";
  const remove = async (kind: "size" | "scent" | "add-on", name: string, j: number) => {
    const yesNo = await ask({
      title: "Remove the " + kind + " “" + (name || "unnamed") + "” from " + marketName(c) + "?",
      text: (kind === "size" ? "To take it off the store but keep it, tick Hidden instead.\n\n" : "") + "Nothing changes on the store until you Save & publish.",
      ok: "Remove",
      danger: true,
    });
    if (!yesNo) return;
    ec((m) => {
      const list = kind === "size" ? m.sizes : kind === "scent" ? m.scents : m.extras;
      (list || []).splice(j, 1);
      // a removed size's price is kept, so "Restore" brings it back as it was
    });
  };
  const removeMarket = async () => {
    const yesNo = await ask({
      title: "Remove the market " + marketName(c) + "?",
      text: "Every price, size, scent and add-on in it goes with it.\n\nNothing changes on the store until you Save & publish.",
      ok: "Remove the market",
      danger: true,
    });
    if (yesNo) edit((x) => x.countries.splice(i, 1));
  };
  const route = String(c.courier || "omniful") === "manual" ? "manual" : "omniful";
  const changeRoute = async (want: string) => {
    if (want === route) return;
    setRouting(true);
    try {
      await setRoute(c.code, want as "omniful" | "manual");
      onRouted(c.code, want);
      toast(c.code + " now goes " + (want === "manual" ? "by hand (tracking typed in)" : "to Empower (Omniful)"), true);
    } catch (e) {
      toast(isApiError(e, "no_such_market") ? "Publish " + c.code + " first: a route is set on a published market." : explain(e));
    } finally {
      setRouting(false);
    }
  };
  const sizes = c.sizes || [];
  const scents = c.scents || [];
  const extras = c.extras || [];
  const missing = missingSizes(c, d, loaded);
  const bodyId = "cty-body-" + c.code;

  return (
    <div class={"cty-card" + (open ? " open" : "")} data-code={c.code}>
      <div class="cty-head">
        <button type="button" class="cty-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <Icon name="chev" class="cty-chev" />
          <b dir="auto">{(c.flag ? c.flag + " " : "") + (c.name || c.code)}</b>
          <Pill tone="muted">{c.code}</Pill>
          <span class="cty-sum">
            {cur} · {sizes.length} sizes · {scents.length} scents
          </span>
        </button>
        <Btn sm kind="danger" class="kill" onClick={removeMarket} aria-label={"Remove the market " + marketName(c)}>
          Remove
        </Btn>
      </div>
      <div class="cty-body" id={bodyId} hidden={!open}>
        <div class="cty-sec">
          <h4>Market</h4>
          <div class="rows">
            <div class="item-row">
              <TextBox label="Code" value={c.code} onValue={() => {}} readOnly width="narrow" />
              <TextBox label="Flag" value={c.flag} onValue={(v) => ec((m) => (m.flag = v))} width="narrow" />
              <TextBox label="Country" value={c.name} onValue={(v) => ec((m) => (m.name = v))} />
              <TextBox label="Country · EN" value={c.name_en} onValue={(v) => ec((m) => (m.name_en = v))} en />
              <TextBox label="Currency" value={c.cur} onValue={(v) => ec((m) => (m.cur = v.trim().toUpperCase()))} width="narrow" ltr error={/^[A-Z]{3}$/.test(cur) ? undefined : "Three capitals"} maxLength={3} />
              <TextBox label="Dial code" value={c.dial} onValue={(v) => ec((m) => (m.dial = v.replace(/[^\d٠-٩]/g, "").replace(/[٠-٩]/g, (x) => String(x.charCodeAt(0) - 0x0660))))} width="narrow" ltr error={/^\d{1,4}$/.test(String(c.dial || "")) ? undefined : "Digits"} maxLength={6} />
              <NumBox label="Decimals" value={c.dec || 0} onValue={(v) => ec((m) => (m.dec = v || 0))} rule={{ int: true, max: 3 }} width="narrow" />
            </div>
          </div>
        </div>

        <div class="cty-sec">
          <h4>Costs</h4>
          <div class="rows">
            <div class="item-row">
              <NumBox label={"Delivery (" + cur + ")"} value={c.ship ?? 0} onValue={(v) => ec((m) => (m.ship = v || 0))} rule={MONEY} />
              <NumBox label="Free over" value={c.freeOver ?? 0} onValue={(v) => ec((m) => (m.freeOver = v || 0))} rule={MONEY} title="Free delivery from this basket total. 0 = no free delivery." />
              <NumBox label="COD fee" value={c.cod ?? 0} onValue={(v) => ec((m) => (m.cod = v || 0))} rule={MONEY} />
              <Tick label="Cash on delivery" text="Offered here" checked={c.codOn !== false} onChange={(on) => ec((m) => (m.codOn = on))} width="" title="Off hides cash on delivery at checkout for this market, and the till refuses it." />
              <TextBox label="OMR rate (from deploy)" value={c.toOmr == null ? 1 : c.toOmr} onValue={() => {}} readOnly width="narrow" title="Set in the deploy's catalogue and applied automatically" />
              <Box label="Ships with" width="wide">
                <select class="pick" value={route} disabled={routing || !published} title={published ? "Saved at once (not with Save & publish)" : "Publish this market first"} onChange={(e) => changeRoute((e.currentTarget as HTMLSelectElement).value)}>
                  <option value="omniful">Empower (Omniful)</option>
                  <option value="manual">By hand</option>
                </select>
              </Box>
            </div>
          </div>
          <p class="hint sml">Free over 0 = no threshold. "Ships with" is saved at once; everything else on this page waits for Save &amp; publish.</p>
        </div>

        <div class="cty-sec">
          <div class="sec-head">
            <h4>Sizes and prices</h4>
            {missing.map((m) => (
              <Btn
                key={m.id}
                sm
                icon="undo"
                class="restore"
                title={"Put the " + (m.name || m.id) + " size back in this market"}
                onClick={() => {
                  let back: ReturnType<typeof restoreSize> = null;
                  let now = 0;
                  edit((x) => {
                    const mk = x.countries[i]!;
                    back = restoreSize(mk, x, loaded, m.id);
                    now = Number(((mk.prices || {})[m.id] || { now: 0 }).now) || 0;
                  });
                  if (back || m) toast((m.name || m.id) + " is back in " + c.code + (now > 0 ? " at " + now + " " + cur : " · needs a price") + " · Save & publish to put it on the store", true);
                }}
              >
                {"Restore " + (m.name || m.id)}
              </Btn>
            ))}
            <Btn sm icon="plus" onClick={() => ec((m) => (m.sizes = [...(m.sizes || []), newSize(m)]))}>
              Size
            </Btn>
          </div>
          <div class="rows">
            {sizes.map((z, j) => {
              const out = yes(z.soldOut);
              const hid = yes(z.hidden);
              const es = (fn: (z: NonNullable<Country["sizes"]>[number]) => void) => ec((m) => fn(m.sizes![j]!));
              return (
                <div class={"sub-row has-en" + (out || hid ? " off" : "")} key={j} data-size={z.id}>
                  <TextBox label="ID" value={z.id} onValue={(v) => ec((m) => renameSizeId(m, j, v.trim()))} width="narrow" ltr />
                  <TextBox label="Name" value={z.name} onValue={(v) => es((s) => (s.name = v))} width="wide" />
                  <TextBox label="Weight" value={z.weight} onValue={(v) => es((s) => (s.weight = v))} width="narrow" />
                  <NumBox label="Price" value={price(z.id, "now")} onValue={(v) => setPrice(z.id, "now", v)} rule={MONEY} width="narrow" />
                  <NumBox label="Was" value={price(z.id, "was")} onValue={(v) => setPrice(z.id, "was", v)} rule={MONEY} width="narrow" />
                  <TextBox label="Badge" value={z.tag} onValue={(v) => es((s) => (s.tag = v))} width="wide" />
                  <ColorBox label="Colour" value={z.tagColor} fallback="#9c464c" onValue={(v) => es((s) => (s.tagColor = v))} />
                  <Tick label="Stock" text="Sold out here" width="" checked={out} onChange={(on) => es((s) => (s.soldOut = on))} />
                  <div class="field-b act">
                    <span class="cap" aria-hidden="true">
                      {" "}
                    </span>
                    <Btn sm kind="danger" onClick={() => remove("size", z.name, j)} aria-label={"Remove the size " + (z.name || z.id) + " from " + c.code} title="Delete this size here. To keep it but hide it, tick Hidden.">
                      Remove
                    </Btn>
                  </div>
                  <Gap />
                  <TextBox label="Name · EN" value={z.name_en} onValue={(v) => es((s) => (s.name_en = v))} width="wide" en />
                  <TextBox label="Weight · EN" value={z.weight_en} onValue={(v) => es((s) => (s.weight_en = v))} width="narrow" en />
                  <Gap n={2} />
                  <TextBox label="Badge · EN" value={z.tag_en} onValue={(v) => es((s) => (s.tag_en = v))} width="wide" en />
                  <div class="field-b wide row2" role="group" aria-label={"On the page: " + (z.name || z.id)}>
                    <span class="cap" aria-hidden="true">
                      On the page
                    </span>
                    <span class="flag-pair">
                      <span title="Off the store and the till, kept here with its price. Untick to bring it back.">
                        <Switch checked={hid} onChange={(on) => es((s) => (s.hidden = on))}>
                          Hidden
                        </Switch>
                      </span>
                      <span title="Kept for the catalogue's record: its scents always show under it">
                        <Switch checked={yes(z.open) || c.sizesOpen === true} onChange={(on) => es((s) => (s.open = on))}>
                          Always open
                        </Switch>
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
            <div class="sub-row">
              <TextBox label="Size" value="Small bundle" onValue={() => {}} readOnly title="The small size can be sold only as this bundle (Small bundle offer)" />
              <NumBox label="Price" value={price("bundle", "now")} onValue={(v) => setPrice("bundle", "now", v)} rule={MONEY} width="narrow" />
              <NumBox label="Was" value={price("bundle", "was")} onValue={(v) => setPrice("bundle", "was", v)} rule={MONEY} width="narrow" />
              <TextBox label="Stock" value="Needs one scent" onValue={() => {}} readOnly title="Sells while its box and one scent are in stock." />
            </div>
            <div class="sub-row">
              <TextBox label="Size" value="Large bundle · 2 boxes" onValue={() => {}} readOnly title="Two large boxes, any scents (Large bundle offer). 0 = not offered here." />
              <NumBox label="Price" value={price("duo", "now")} onValue={(v) => setPrice("duo", "now", v)} rule={MONEY} width="narrow" />
              <TextBox label="Size" value="Large bundle · 3 boxes" onValue={() => {}} readOnly title="Three large boxes, any scents (Large bundle offer). 0 = not offered here." />
              <NumBox label="Price" value={price("trio", "now")} onValue={(v) => setPrice("trio", "now", v)} rule={MONEY} width="narrow" />
            </div>
          </div>
        </div>

        <div class="cty-sec">
          <div class="sec-head">
            <h4>Scents</h4>
            <Btn sm icon="plus" onClick={() => ec((m) => (m.scents = [...(m.scents || []), newScent(m)]))}>
              Scent
            </Btn>
          </div>
          <div class="rows">
            {scents.map((s, j) => {
              const out = yes(s.soldOut);
              const sizesOut = Array.isArray(s.soldOutSizes) && s.soldOutSizes.length && !out ? s.soldOutSizes.join(", ") : "";
              const ss = (fn: (s: NonNullable<Country["scents"]>[number]) => void) => ec((m) => fn(m.scents![j]!));
              return (
                <div class={"sub-row has-en" + (out ? " off" : "")} key={j} data-scent={s.id}>
                  <TextBox label="ID" value={s.id} onValue={(v) => ss((x) => (x.id = v.trim()))} width="narrow" ltr />
                  <TextBox label="Name" value={s.name} onValue={(v) => ss((x) => (x.name = v))} width="wide" />
                  <ColorBox label="Accent" value={s.accent} fallback="#b8974f" onValue={(v) => ss((x) => (x.accent = v))} />
                  <NumBox
                    label="Rating /5"
                    value={Number(s.stars) > 0 ? Number(s.stars) : ""}
                    onValue={(v) => ss((x) => (x.stars = v === null ? 0 : Math.round(v * 10) / 10))}
                    rule={{ min: 0, max: 5, dec: 1, blank: true }}
                    width="rate"
                    placeholder="0 – 5"
                    title="Shown beside the scent as three gold leaves: 4.6 to 5 all full, under 4.6 the last one half. Empty = none."
                  />
                  <TextBox label="Marked as" value={s.tag} onValue={(v) => ss((x) => (x.tag = v))} width="wide" placeholder="e.g. الأكثر مبيعا" title="Badge on this scent. Empty = none." />
                  <Tick
                    label="Stock"
                    text={
                      <>
                        Sold out here{sizesOut ? <em class="sub"> ({sizesOut} out)</em> : null}
                      </>
                    }
                    title={sizesOut ? "Out of the " + sizesOut + " box here (set in Common to every market)" : "Out of every size in this market"}
                    checked={out}
                    onChange={(on) => ss((x) => setScentOutHere(x, on))}
                  />
                  <div class="field-b act">
                    <span class="cap" aria-hidden="true">
                      {" "}
                    </span>
                    <Btn sm kind="danger" onClick={() => remove("scent", s.name, j)} aria-label={"Remove the scent " + (s.name || s.id) + " from " + c.code}>
                      Remove
                    </Btn>
                  </div>
                  <Gap />
                  <TextBox label="Name · EN" value={s.name_en} onValue={(v) => ss((x) => (x.name_en = v))} width="wide" en />
                  <Gap n={2} />
                  <TextBox label="Marked as · EN" value={s.tag_en} onValue={(v) => ss((x) => (x.tag_en = v))} width="wide" en placeholder="e.g. Best seller" title="English badge. Shown only with the Arabic one." />
                </div>
              );
            })}
            {!scents.length ? <p class="hint">No scents in this market yet.</p> : null}
          </div>
        </div>

        <div class="cty-sec">
          <div class="sec-head">
            <h4>Checkout add-ons</h4>
            <Btn sm icon="plus" onClick={() => ec((m) => (m.extras = [...(m.extras || []), newExtra(m)]))}>
              Add-on
            </Btn>
          </div>
          <div class="rows">
            {extras.map((x, j) => {
              const off = x.active === false || yes(x.soldOut);
              const sx = (fn: (e: NonNullable<Country["extras"]>[number]) => void) => ec((m) => fn(m.extras![j]!));
              return (
                <div class={"sub-row has-en" + (off ? " off" : "")} key={j} data-extra={x.id}>
                  <TextBox label="ID" value={x.id} onValue={(v) => ec((m) => renameExtraId(m, j, v.trim()))} width="narrow" ltr />
                  <TextBox label="Name" value={x.name} onValue={(v) => sx((e) => (e.name = v))} width="wide" />
                  <TextBox label="Note" value={x.note} onValue={(v) => sx((e) => (e.note = v))} width="wide" />
                  <NumBox label={"Price (" + cur + ")"} value={price(x.id, "now")} onValue={(v) => setPrice(x.id, "now", v)} rule={MONEY} width="narrow" />
                  <TextBox label="Image" value={x.img} onValue={(v) => sx((e) => (e.img = v.trim()))} width="narrow" ltr placeholder="burner" title="File name in assets/img, no -sm or extension. Empty = plain tile." />
                  <Tick label="Offer" text="Once per basket" checked={x.once !== false} onChange={(on) => sx((e) => (e.once = on))} />
                  <Tick label="On" text="Offered here" checked={x.active !== false} onChange={(on) => sx((e) => (e.active = on))} />
                  <div class="field-b act">
                    <span class="cap" aria-hidden="true">
                      {" "}
                    </span>
                    <Btn sm kind="danger" onClick={() => remove("add-on", x.name, j)} aria-label={"Remove the add-on " + (x.name || x.id) + " from " + c.code}>
                      Remove
                    </Btn>
                  </div>
                  <Gap />
                  <TextBox label="Name · EN" value={x.name_en} onValue={(v) => sx((e) => (e.name_en = v))} width="wide" en />
                  <TextBox label="Note · EN" value={x.note_en} onValue={(v) => sx((e) => (e.note_en = v))} width="wide" en />
                </div>
              );
            })}
            {!extras.length ? <p class="hint">No add-ons in this market yet.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- the card ---------------- */

export function Markets({ d, edit, loaded, publishedCodes, onRouted }: { d: Draft; edit: Edit; loaded: Catalogue | null; publishedCodes: string[]; onRouted: (code: string, courier: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const stamp = marketsStamp(d);
  const add = () => {
    let err = "";
    const want = code.trim().toUpperCase();
    edit((x) => {
      err = addCountry(x, want);
    });
    if (err) return toast(err);
    setAdding(false);
    setCode("");
    setOpen({ ...open, [want]: true });
    toast(want + " added from the first market's products, at zero. Set its prices, then Save & publish.", true);
  };
  return (
    <section class="card markets" aria-labelledby="mk-h">
      <div class="card-head">
        <h2 id="mk-h">Markets and prices</h2>
        <span class={"stamp" + (stamp.warn ? " low" : "")}>{stamp.text}</span>
        <Btn sm icon="plus" class="spacer-l" onClick={() => setAdding(true)}>
          Country
        </Btn>
      </div>
      <Common d={d} edit={edit} />
      <div class="cty-list">
        {(d.countries || []).map((c, i) => (
          <CountryCard
            key={c.code + ":" + i}
            c={c}
            i={i}
            d={d}
            edit={edit}
            loaded={loaded}
            published={publishedCodes.indexOf(c.code) > -1}
            open={!!open[c.code]}
            onToggle={() => setOpen({ ...open, [c.code]: !open[c.code] })}
            onRouted={onRouted}
          />
        ))}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a country">
        <p class="hint">Two-letter country code (e.g. KW). It starts with the first market's sizes, scents and add-ons, at zero.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label class="tf">
            <span>Country code</span>
            <input value={code} maxLength={2} dir="ltr" autocomplete="off" onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)} />
          </label>
          <div class="dlg-foot">
            <Btn sm kind="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
            <Btn sm kind="primary" type="submit">
              Add
            </Btn>
          </div>
        </form>
      </Modal>
    </section>
  );
}
