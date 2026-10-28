/**
 * THE EMPOWER TAB — Omniful, the warehouse that picks, packs and ships.
 *
 *   Omniful            the connection (live / staging / not set up), what the last push and the
 *                      last status read did; inside the fold, what is missing and the webhook
 *   the figures        waiting, pushed, still in flight, carrying an error
 *   Waiting            New orders in Empower markets with no parcel, oldest first: each opens
 *                      to the order as the warehouse will be told it (Edit customer / Edit items
 *                      inside the row), with its own Push; Refresh only reads; Push all asks,
 *                      then sends every order on the list, call after call, until none is left,
 *                      and offers to record the ones Omniful already had (v402); the auto push
 *                      switch asks before it goes on and says what its last run did (v316)
 *   WhatsApp order     phase 1's typed-in order form (it lands in Waiting)
 *   Pushed             what Omniful has, 15 a page, filtered by stage or searched; each opens
 *                      to Omniful's record, the order (read-only), the tracking message and
 *                      "Take off Empower" (with "remove the mark only" when Omniful refuses);
 *                      Check statuses reads Omniful now
 *   Who carries each market, Omniful SKU codes   (Setup.tsx)
 */
import { useState } from "preact/hooks";
import { isApiError } from "../../data/api";
import { afterOrderWrite, useCatalogue } from "../../data/hooks";
import { invalidate, useQuery } from "../../data/query";
import { ask, Btn, Card, CardHead, CopyBtn, Kpi, Kpis, LinkBtn, Pager, Pill, Select, toast } from "../../kit";
import { dt, dtt, money } from "../../lib/format";
import { orderTotal, trackMessage, waLink } from "../../lib/order";
import { CHECK_WORD, COUNTRY_EN, explain } from "../../lib/words";
import { pushEmpower } from "../../data/endpoints";
import { ManualOrderForm } from "../orders/ManualOrder";
import { pushOne, takeOff } from "../orders/empower";
import type { DetailOrder } from "../orders/OrderDetail";
import { FoldCard } from "../catalogue/Offers";
import { getPushed, getStatus, getWaiting, pushMany, setAuto, syncStatuses, type EmpowerStatus, type PushedRow, type WaitingOrder } from "./api";
import { Dl, Loading, OrderBlocks, useOrder } from "./Detail";
import { autoNote, connWord, filterPushed, finished, notReadyWhy, pollLine, pushAll, STAGE_TONE, stageOf, statusWords, sweepLine, type StageFilter } from "./lib";
import { Routes, Skus } from "./Setup";

export const KEY = { status: "empower:status", waiting: "empower:waiting", pushed: "empower:pushed" };
export const PER = 15;

export const useEmpowerStatus = () => useQuery(KEY.status, () => getStatus());
/** The sidebar's count: orders waiting to be pushed. */
export function useEmpowerWaiting(): number | null {
  const q = useEmpowerStatus();
  return q.data && q.data.waiting > 0 ? q.data.waiting : null;
}

/** Every Empower read again, and the orders' (a push moves an order to Preparing). */
export const afterEmpower = () => Promise.all([invalidate((k) => k.startsWith("empower")), afterOrderWrite()]).then(() => undefined);

/* ---------------- the connection ---------------- */

function Head({ s, now }: { s: EmpowerStatus; now: number }) {
  const w = connWord(s);
  const sw = sweepLine(s.lastSweep, now);
  const pl = pollLine(s.lastPoll, now);
  const hook = location.origin + (s.hookPath || "/api/omniful/hook");
  return (
    <FoldCard
      title="Omniful"
      stamp={
        <Pill tone={w.tone} title="The connection to Omniful">
          {w.text}
        </Pill>
      }
      id="omfCard"
      lead={
        <div class="omf-lines">
          <p class={"note" + (sw.bad ? " warn" : "")}>{sw.text}</p>
          <p class={"note" + (pl.bad ? " warn" : "")}>{pl.text}</p>
        </div>
      }
    >
      <div class="omf-setup">
        {!s.configured || (s.missing || []).length ? (
          <>
            <p class="note warn">To connect: set these on the server (environment variables), then redeploy. From Omniful › Settings › Apps &amp; Integrations › Custom Apps.</p>
            <ul class="note-list">
              <li>
                <code>OMNIFUL_API_TOKEN</code>: access token{s.configured ? " ✓" : ""}
              </li>
              <li>
                <code>OMNIFUL_HUB_CODE</code>: warehouse code{s.hub ? " ✓" : ""}
              </li>
              <li>
                <code>OMNIFUL_REFRESH_TOKEN</code>, <code>OMNIFUL_CLIENT_ID</code>, <code>OMNIFUL_CLIENT_SECRET</code>: auto renews the token{s.renews ? " ✓" : ""}
              </li>
            </ul>
          </>
        ) : !s.renews ? (
          <p class="note warn">
            The token expires in 30 days. Add <code>OMNIFUL_REFRESH_TOKEN</code>, <code>OMNIFUL_CLIENT_ID</code> and <code>OMNIFUL_CLIENT_SECRET</code> to renew it automatically.
          </p>
        ) : null}
        <p class="hint">
          Sending to <code>{s.base}</code>
          {s.env === "staging" ? (
            <>
              {" "}
              (<b>staging</b>, nothing ships)
            </>
          ) : null}
          .
        </p>
        <p class="hint">
          Webhook URL for Omniful › Settings › Apps &amp; Integrations › Configurations:{" "}
          <code>
            {hook}
            {s.hookGuarded ? "?k=<your OMNIFUL_HOOK_SECRET>" : ""}
          </code>
          {s.hookGuarded ? "." : <>. Set <code>OMNIFUL_HOOK_SECRET</code> to enable it.</>}
        </p>
      </div>
    </FoldCard>
  );
}

/* ---------------- waiting ---------------- */

function WaitingRow({ o, open, onToggle, ready, why, skus, autoOn }: { o: WaitingOrder; open: boolean; onToggle: () => void; ready: boolean; why: string; skus: Record<string, string>; autoOn: boolean }) {
  const [busy, setBusy] = useState(false);
  const d = useOrder(open ? o.id : null);
  const check = (o.check || []).filter((k) => k !== "sku").map((k) => CHECK_WORD[k] || k);
  const push = async () => {
    setBusy(true);
    try {
      const r = await pushOne(o.id);
      toast(r.said, r.kind === "sent");
      await afterEmpower();
    } catch (e) {
      toast(explain(e, "Omniful refused it"));
    } finally {
      setBusy(false);
    }
  };
  const detailId = "omf-det-" + o.id;
  return (
    <>
      <tr class={"row omf-w" + (open ? " open-row" : "")} onClick={(e) => !(e.target as HTMLElement).closest("button,a,input,select,label") && onToggle()}>
        <td class="id">{o.id}</td>
        <td class="who">
          <b dir="auto">{o.name || ""}</b>
          <span dir="ltr">{o.phone || ""}</span>
        </td>
        <td class="hide-sm dest" title={COUNTRY_EN[o.countryCode] || o.countryCode}>
          {o.city ? <span dir="auto">{o.city}</span> : null}
          {o.city ? ", " : ""}
          {o.countryCode}
        </td>
        <td class="num total">{money(orderTotal(o), o.cur)}</td>
        <td class="st">
          <div class="pills">
            <Pill tone="new">New</Pill>
            {check.length ? (
              <Pill tone="red" title={"Missing or wrong: " + check.join(", ") + ". Fix before shipping. Auto push holds it."}>
                Check: {check.join(", ")}
              </Pill>
            ) : null}
            {o.skuMissing && o.skuMissing.length ? (
              <Pill tone="red" title={"No Empower SKU code for " + o.skuMissing.join(", ") + " (Omniful SKU codes, below). Our own code is sent instead."}>
                {o.skuMissing.length === 1 ? "No SKU: " + o.skuMissing[0] : "No SKU: " + o.skuMissing.length + " items"}
              </Pill>
            ) : null}
            {o.unsure ? (
              <Pill tone="empower unsure" title="A push got no answer from Omniful. The next push checks it and records it.">
                Empower?
              </Pill>
            ) : null}
            {o.origin === "whatsapp_order" && autoOn ? (
              <Pill tone="muted" title="Typed in here. Pushed by hand only.">
                manual
              </Pill>
            ) : null}
          </div>
        </td>
        <td class="acts-td">
          <div class="acts">
            <Btn sm busy={busy} disabled={!ready} title={ready ? "Send " + o.id + " to Omniful" : why} onClick={push}>
              Push
            </Btn>
            <Btn sm kind="ghost" iconOnly icon="chev" class="chev" label={(open ? "Close " : "Open ") + o.id} aria-expanded={open} aria-controls={detailId} onClick={onToggle} />
          </div>
        </td>
      </tr>
      {open ? (
        <tr class="detail">
          <td colSpan={6}>
            <div class="det" id={detailId} role="region" aria-label={"Order " + o.id}>
              {d.data ? <OrderBlocks o={d.data.order as DetailOrder} skus={skus} editable lines={o.lines} /> : <Loading q={d} />}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Waiting({ s, now }: { s: EmpowerStatus; now: number }) {
  void now;
  const q = useQuery(KEY.waiting, () => getWaiting(), { keep: true });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"" | "refresh" | "all" | "auto">("");
  const [progress, setProgress] = useState("");
  const w = connWord(s);
  const why = notReadyWhy(s);
  const list = (q.data && q.data.orders) || [];
  const routed = (s.routing || []).some((r) => r.courier === "omniful");
  const auto = s.auto;

  const refresh = async () => {
    setBusy("refresh");
    try {
      await invalidate((k) => k.startsWith("empower"));
      const j = await getWaiting();
      toast("Refreshed: " + (j.orders.length ? j.orders.length + " waiting" : "nothing waiting"), true);
    } catch (e) {
      toast(explain(e, "Could not refresh the list"));
    } finally {
      setBusy("");
    }
  };

  const all = async () => {
    if (!w.ready) return toast(why);
    if (!list.length) return toast("Nothing waiting to push");
    const oldest = list.reduce((m, o) => (!m || o.createdAt < m.createdAt ? o : m), list[0]!);
    if (!(await ask({ title: "Push all " + list.length + " waiting order" + (list.length === 1 ? "" : "s") + " to Omniful?", text: "Oldest: " + dtt(oldest.createdAt) + ". Each moves to Preparing.", ok: "Push all" }))) return;
    setBusy("all");
    const r = await pushAll(
      list.map((o) => o.id),
      pushMany,
      (n, t) => setProgress("Pushing " + n + " of " + t + "…"),
    );
    setProgress("");
    let pushed = r.pushed;
    let bad = r.failed;
    // v402: the ones Omniful already had are almost always our own earlier push that got no answer
    const dup = bad.filter((b) => b.error === "omniful_duplicate");
    if (
      dup.length &&
      (await ask({
        title: dup.length + " order" + (dup.length === 1 ? " is" : "s are") + " already in Omniful",
        text: dup.map((b) => b.id).join(", ") + "\n\nThey came from our earlier pushes that got no answer: record them as on Empower? Nothing is sent.\n\nOr leave them for a look one by one.",
        ok: "Record our earlier push",
        cancel: "Leave them",
      }))
    ) {
      for (const b of dup) {
        try {
          const j = await pushEmpower({ id: b.id, adopt: true });
          if (j && j.ok) {
            pushed++;
            bad = bad.filter((x) => x !== b);
          }
        } catch {
          /* left for a look one by one */
        }
      }
    }
    await afterEmpower();
    const left = await getWaiting().then(
      (j) => j.orders.length,
      () => null,
    );
    const tail = left === null ? "" : " · " + (left ? left + " still waiting" : "nothing waiting");
    if (r.stop) toast(pushed + " pushed, then stopped: " + r.stop + tail);
    else if (bad.length) toast(pushed + " pushed, " + bad.length + " refused: " + bad[0]!.id + ": " + (bad[0]!.detail || bad[0]!.error) + tail);
    else toast(pushed + " pushed" + tail, true);
    setBusy("");
  };

  const flipAuto = async () => {
    const on = !(auto && auto.on);
    if (on && !w.ready) return toast(why);
    if (on && !(await ask({ title: "Turn auto push on?", text: "Complete website orders go to Omniful when placed (card when paid). Incomplete ones stay here, flagged. WhatsApp orders typed in here are never sent automatically.", ok: "Turn on" }))) return;
    setBusy("auto");
    try {
      const j = await setAuto(on);
      toast("Auto push " + (j.on ? "on" : "off"), true);
      await invalidate((k) => k.startsWith("empower"));
    } catch (e) {
      toast(explain(e));
    } finally {
      setBusy("");
    }
  };

  const note = autoNote(auto);
  return (
    <Card flush aria-labelledby="omf-wait-h" class="omf-wait">
      <CardHead title="Waiting to be pushed" id="omf-wait-h">
        <span class="stamp">{list.length ? list.length + " waiting" : ""}</span>
        <span class="row-btns spacer">
          <Btn sm kind="ghost" icon="refresh" busy={busy === "refresh"} title="Reload the list (sends nothing)" onClick={refresh}>
            Refresh
          </Btn>
          <Btn sm icon="box" busy={busy === "all"} disabled={!w.ready} title={w.ready ? "Send every order here to Omniful (asks first)" : why} onClick={all}>
            {progress || "Push all"}
          </Btn>
          <Btn sm kind={auto && auto.on ? "primary" : "ghost"} icon="clock" aria-pressed={!!(auto && auto.on)} busy={busy === "auto"} title="Push complete website orders to Empower when placed" onClick={flipAuto}>
            {"Auto push: " + (auto && auto.on ? "On" : "Off")}
          </Btn>
        </span>
      </CardHead>
      {note ? <p class="note omf-auto-note">{note}</p> : null}
      <div class="tablewrap orders-wrap">
        <table class="tbl omf-tbl" aria-busy={q.loading ? "true" : "false"}>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th class="hide-sm">Destination</th>
              <th>Total</th>
              <th>Status</th>
              <th>
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <WaitingRow key={o.id} o={o} open={!!open[o.id]} onToggle={() => setOpen({ ...open, [o.id]: !open[o.id] })} ready={w.ready} why={why} skus={s.skus || {}} autoOn={!!(auto && auto.on)} />
            ))}
            {!list.length ? (
              <tr>
                <td colSpan={6} class="empty">
                  {q.error ? "Could not read the list: " + explain(q.error) : q.loading && !q.data ? "Loading…" : routed ? "Nothing waiting." : "No market is routed to Omniful yet. Choose one below."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------- pushed ---------------- */

function PushedRowView({ r, open, onToggle, skus }: { r: PushedRow; open: boolean; onToggle: () => void; skus: Record<string, string> }) {
  const id = r.orderId || "";
  const d = useOrder(open && id ? id : null);
  const [busy, setBusy] = useState(false);
  const st = stageOf(r.status);
  const done = !!r.deliveredAt;
  const o = d.data ? (d.data.order as DetailOrder) : null;
  const awb = r.awb || "";
  const msg = o && awb ? trackMessage(o, awb) : "";
  const off = async () => {
    setBusy(true);
    try {
      const j = await takeOff(id);
      if (j) toast(j.said, j.ok);
      await afterEmpower();
    } catch (e) {
      toast(explain(e, "Could not remove the mark"));
    } finally {
      setBusy(false);
    }
  };
  const detailId = "omf-pdet-" + r.id;
  return (
    <>
      <tr class={"row" + (open ? " open-row" : "")} onClick={(e) => id && !(e.target as HTMLElement).closest("button,a,input,select,label") && onToggle()}>
        <td class="id">
          {id || "—"}
          {r.sentId && r.sentId !== id ? <span class="src">as {r.sentId}</span> : null}
        </td>
        <td dir="ltr">{r.reference || <span class="muted">—</span>}</td>
        <td class="hide-sm" dir="ltr">
          {awb || <span class="muted">not yet</span>}
        </td>
        <td class="st">
          <Pill tone={STAGE_TONE[st]}>{statusWords(r.status)}</Pill>
          {r.lastError ? <em class="sub warn-t">{r.lastError}</em> : null}
        </td>
        <td class="hide-sm">{r.courierName || <span class="muted">—</span>}</td>
        <td class="hide-sm num">{dt(r.createdAt)}</td>
        <td class="hide-sm num">{dtt(r.updatedAt)}</td>
        <td class="acts-td">
          {id ? <Btn sm kind="ghost" iconOnly icon="chev" class="chev" label={(open ? "Close " : "Open ") + id} aria-expanded={open} aria-controls={detailId} onClick={onToggle} /> : null}
        </td>
      </tr>
      {open && id ? (
        <tr class="detail">
          <td colSpan={8}>
            <div class="det" id={detailId} role="region" aria-label={"Pushed order " + id}>
              <div class="full confirm">
                <span>Pushed to Omniful {dtt(r.createdAt)}</span>
                {msg ? (
                  <>
                    {waLink(o!.phone, msg) ? (
                      <LinkBtn sm href={waLink(o!.phone, msg)} newTab icon="chat">
                        WhatsApp tracking
                      </LinkBtn>
                    ) : null}
                    <CopyBtn text={() => msg} label="Copy tracking message" done="Tracking message copied. Paste it into WhatsApp." />
                  </>
                ) : null}
                {done ? (
                  <span class="muted">Delivered. Nothing to cancel.</span>
                ) : finished(r) ? (
                  <span class="muted">Off Empower ({statusWords(r.status)}).</span>
                ) : (
                  <Btn sm kind="danger" icon="x" busy={busy} title="Ask Omniful to cancel it, then take the Empower mark off here" onClick={off}>
                    Take off Empower
                  </Btn>
                )}
              </div>
              <div class="blk">
                <h4>On Omniful</h4>
                <Dl
                  rows={[
                    ["Their ref", r.reference || "—", "ltr"],
                    ["AWB", awb || "not yet", "ltr"],
                    !!r.courierName && ["Courier", r.courierName],
                    ["Stage", statusWords(r.status)],
                    ["Updated", dtt(r.updatedAt)],
                    !!r.deliveredAt && ["Delivered", dtt(r.deliveredAt)],
                    ["Collect", Number(r.cod) ? money(r.cod, o ? o.cur : "") + " on delivery" : "Nothing"],
                    r.sentId !== id && ["Sent as", r.sentId, "ltr"],
                    !!r.lastError && ["Error", <span key="e" class="warn-t">{r.lastError}</span>],
                  ]}
                />
              </div>
              {o ? <OrderBlocks o={o} skus={skus} editable={false} /> : d.error && isApiError(d.error, "no_such_order") ? <p class="hint">Not in the orders (deleted).</p> : <Loading q={d} />}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Pushed({ s, all }: { s: EmpowerStatus; all: PushedRow[] | null }) {
  const [stage, setStage] = useState<StageFilter>("");
  const [qText, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const w = connWord(s);
  const rows = filterPushed(all || [], stage, qText);
  const page = rows.slice(offset, offset + PER);
  const check = async () => {
    if (!w.ready) return toast(notReadyWhy(s));
    setBusy(true);
    try {
      const j = await syncStatuses();
      if (j.skipped) toast("Omniful not connected");
      else {
        const bits = [(j.tracked || 0) + " checked"];
        if (j.updated) bits.push(j.updated + " changed");
        if (j.moved) bits.push(j.moved + " order" + (j.moved === 1 ? "" : "s") + " moved");
        if (j.errors && j.errors.length) bits.push(j.errors.length + " not answered: " + (j.errors[0]!.detail || j.errors[0]!.error));
        toast("Omniful: " + bits.join(" · "), !(j.errors && j.errors.length));
      }
      await afterEmpower();
    } catch (e) {
      toast(explain(e, "Could not reach Omniful"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card flush aria-labelledby="omf-push-h">
      <div class="card-head filters">
        <h2 id="omf-push-h">Pushed to Omniful</h2>
        <span class="stamp">{all ? rows.length + " of " + all.length : ""}</span>
        <Btn sm kind="ghost" icon="truck" busy={busy} title="Sync parcel statuses from Omniful (sends nothing)" onClick={check}>
          Check statuses
        </Btn>
        <Select
          sm
          label="Stage"
          value={stage}
          onChange={(v) => {
            setStage(v as StageFilter);
            setOffset(0);
          }}
          options={[
            { value: "", label: "Any stage" },
            { value: "open", label: "Not delivered yet" },
            { value: "delivered", label: "Delivered" },
            { value: "problem", label: "Refused or returned" },
            { value: "error", label: "Carrying an error" },
          ]}
        />
        <Btn
          sm
          onClick={() => {
            setStage("");
            setQ("");
            setOffset(0);
          }}
        >
          Clear
        </Btn>
        <input
          class="srch"
          type="search"
          value={qText}
          placeholder="Order, reference, AWB, courier…"
          aria-label="Search what was pushed"
          onInput={(e) => {
            setQ((e.currentTarget as HTMLInputElement).value);
            setOffset(0);
          }}
        />
      </div>
      <div class="tablewrap orders-wrap">
        <table class="tbl omf-tbl omf-pushed">
          <thead>
            <tr>
              <th>Order</th>
              <th>Omniful ref</th>
              <th class="hide-sm">AWB</th>
              <th>Stage</th>
              <th class="hide-sm">Courier</th>
              <th class="hide-sm">Pushed</th>
              <th class="hide-sm">Updated</th>
              <th>
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.map((r) => (
              <PushedRowView key={r.id} r={r} open={!!open[r.id]} onToggle={() => setOpen({ ...open, [r.id]: !open[r.id] })} skus={s.skus || {}} />
            ))}
            {!page.length ? (
              <tr>
                <td colSpan={8} class="empty">
                  {!all ? "Loading…" : all.length ? "Nothing matches these filters." : "Nothing pushed yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} limit={PER} total={rows.length} onPage={setOffset} />
    </Card>
  );
}

/* ---------------- the tab ---------------- */

export function Empower() {
  const st = useEmpowerStatus();
  const pushed = useQuery(KEY.pushed, () => getPushed(1000), { keep: true });
  const cat = useCatalogue();
  const now = Date.now();
  const s = st.data;
  if (!s) {
    return (
      <Card>
        <p class="hint" aria-live="polite">
          {st.error ? "Could not read Empower's state: " + explain(st.error) : "Checking Omniful…"}
        </p>
        {st.error ? (
          <Btn sm onClick={() => st.refetch()}>
            Try again
          </Btn>
        ) : null}
      </Card>
    );
  }
  const rows = pushed.data ? pushed.data.rows : null;
  const live = (rows || []).filter((r) => !finished(r)).length;
  const errs = (rows || []).filter((r) => r.lastError).length;
  return (
    <div class="omf-tab">
      <Head s={s} now={now} />
      <Kpis label="Empower figures">
        <Kpi label="Waiting to push" value={String(s.waiting || 0)} icon="clock" tone="amber" />
        <Kpi label="Pushed to Omniful" value={String(s.pushed || 0)} icon="box" tone="blue" />
        <Kpi label="Still in flight" value={rows ? String(live) : "—"} icon="truck" tone="leaf" />
        <Kpi label="Carrying an error" value={rows ? String(errs) : "—"} icon="alert" tone="red" />
      </Kpis>
      <Waiting s={s} now={now} />
      <Card aria-labelledby="omf-wa-h" class="omf-wa">
        <CardHead title="New WhatsApp order" id="omf-wa-h">
          <span class="stamp">Saved as a real order · priced from the catalogue</span>
        </CardHead>
        <ManualOrderForm onCreated={() => invalidate((k) => k.startsWith("empower"))} />
      </Card>
      <Pushed s={s} all={rows} />
      <Routes status={s} />
      <Skus status={s} cfg={cat.data ? cat.data.data : null} />
    </div>
  );
}
