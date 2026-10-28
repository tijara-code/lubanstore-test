/**
 * CHANGES ON THE STOREFRONT — every publish that moved a price, an offer or a scent's stock, with
 * the live orders in the N days before it and the N after (the server counts them): the plainest
 * answer to "did that change help". A change younger than its window says "still counting"
 * instead of comparing a full week with two days. Ten a page (v320), a search, the window (7 /
 * 14 / 30 days either side), ticks with select-all and "Delete N entries", a delete on each row,
 * and "Reset data" (the whole log). Deleting an entry never changes the store: it is the record.
 */
import { useState } from "preact/hooks";
import { clearChanges, deleteChange, listChanges, type ChangeEntry } from "../../data/insights";
import { invalidate, useQuery } from "../../data/query";
import { isApiError } from "../../data/api";
import { ask, Btn, Pager, Pill, Select, toast } from "../../kit";
import { dtt, plural } from "../../lib/format";
import { explain } from "../../lib/words";

export const CH_PER = 10;
const WINDOWS = [
  { value: "7", label: "7 days either side" },
  { value: "14", label: "14 days either side" },
  { value: "30", label: "30 days either side" },
];

export function Changes() {
  const [win, setWin] = useState("7");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState("");
  const list = useQuery("analytics:changes?win=" + win, () => listChanges(Number(win)));
  const all = list.data?.changes || [];
  const ql = q.trim().toLowerCase();
  const rows = all.filter((c) => !ql || c.what.toLowerCase().indexOf(ql) > -1);
  const last = Math.max(0, Math.ceil(rows.length / CH_PER) - 1);
  const p = Math.min(page, last);
  const shown = rows.slice(p * CH_PER, p * CH_PER + CH_PER);
  const pageIds = shown.map((c) => c.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.indexOf(id) > -1);
  const someOnPage = pageIds.some((id) => sel.indexOf(id) > -1);

  const reread = () => invalidate("analytics:changes");

  /* one call per entry, matched by id: the rows removed are the rows ticked */
  const remove = async (picked: ChangeEntry[]) => {
    if (!picked.length) return;
    const yes = await ask({
      title: "Delete " + plural(picked.length, "entry", "entries") + " from the change log?",
      text: picked.slice(0, 5).map((c) => "“" + c.what + "”").join(", ") + (picked.length > 5 ? " and " + (picked.length - 5) + " more" : "") + ". The store is not changed.",
      ok: "Delete",
      danger: true,
    });
    if (!yes) return;
    setBusy("del");
    let gone = 0;
    let failed = 0;
    for (const c of picked) {
      try {
        await deleteChange(c.id);
        gone++;
      } catch (e) {
        if (isApiError(e, "no_such_entry")) gone++;
        else failed++;
      }
    }
    setSel([]);
    setBusy("");
    toast(plural(gone, "entry", "entries") + " deleted" + (failed ? ", " + failed + " could not be" : ""), !failed);
    await reread();
  };

  const resetAll = async () => {
    if (!all.length) return toast("Nothing to clear");
    if (!(await ask({ title: "Clear all " + plural(all.length, "entry", "entries") + " from the change log?", text: "The store is not changed. This cannot be undone.", ok: "Clear the log", danger: true }))) return;
    setBusy("reset");
    try {
      await clearChanges();
      setSel([]);
      setPage(0);
      toast("Change log cleared", true);
      await reread();
    } catch (e) {
      toast("Could not clear: " + explain(e));
    } finally {
      setBusy("");
    }
  };

  const picked = all.filter((c) => sel.indexOf(c.id) > -1);
  return (
    <section class="card flush" id="changesCard" aria-label="Changes on the storefront">
      <div class="card-head filters">
        <h2>Changes on the storefront</h2>
        <span class="stamp">{!all.length ? "" : rows.length === all.length ? all.length + " recorded" : rows.length + " of " + all.length}</span>
        <Select sm label="Comparison window" value={win} onChange={(w) => (setWin(w), setPage(0))} options={WINDOWS} />
        <input class="srch" type="search" value={q} placeholder="What changed…" aria-label="Search the changes" onInput={(e) => (setQ((e.currentTarget as HTMLInputElement).value), setPage(0))} />
        {sel.length ? (
          <Btn sm kind="danger" icon="trash" busy={busy === "del"} onClick={() => remove(picked)} title="Delete the ticked entries (store unchanged)">
            {"Delete " + plural(sel.length, "entry", "entries")}
          </Btn>
        ) : null}
        <Btn sm kind="danger" icon="trash" busy={busy === "reset"} onClick={resetAll} title="Clear the whole change log (store unchanged)">
          Reset data
        </Btn>
      </div>
      <div class="tablewrap">
        <table class="tbl ch-tbl">
          <thead>
            <tr>
              <th>What changed</th>
              <th class="hide-sm">When</th>
              <th class="num">Before</th>
              <th class="num">After</th>
              <th class="num">Change</th>
              <th class="right">
                <input
                  type="checkbox"
                  class="ch-pick"
                  aria-label="Select every entry on this page"
                  checked={allOnPage}
                  ref={(el) => {
                    if (el) el.indeterminate = !allOnPage && someOnPage;
                  }}
                  onChange={(e) => {
                    const on = (e.currentTarget as HTMLInputElement).checked;
                    setSel((was) => (on ? [...new Set([...was, ...pageIds])] : was.filter((x) => pageIds.indexOf(x) < 0)));
                  }}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              shown.map((c) => (
                <tr key={c.id} data-change={c.id}>
                  <td>
                    <b dir="auto">{c.what}</b>
                    {c.actor ? <em class="sub">by {c.actor}</em> : null}
                  </td>
                  <td class="hide-sm num">{dtt(c.at)}</td>
                  <td class="num">{c.before}</td>
                  <td class="num">{c.after}</td>
                  <td class="num">
                    {c.counting || c.delta == null ? (
                      <Pill tone="muted">still counting</Pill>
                    ) : (
                      <span class="cmp">
                        <em class={c.delta >= 0 ? "up" : "down"}>
                          {c.delta >= 0 ? "▲ " : "▼ "}
                          {Math.abs(c.delta)}%
                        </em>
                      </span>
                    )}
                  </td>
                  <td class="right ch-acts">
                    <Btn sm kind="ghost" iconOnly icon="trash" label={"Delete “" + c.what + "”"} onClick={() => remove([c])} />
                    <input
                      type="checkbox"
                      class="ch-pick"
                      aria-label={"Select “" + c.what + "”"}
                      checked={sel.indexOf(c.id) > -1}
                      onChange={(e) => {
                        const on = (e.currentTarget as HTMLInputElement).checked;
                        setSel((was) => (on ? [...was.filter((x) => x !== c.id), c.id] : was.filter((x) => x !== c.id)));
                      }}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} class="empty">
                  {list.error ? "Could not load the change log: " + explain(list.error) : list.loading && !list.data ? "Loading…" : all.length ? "Nothing matches that." : "No published changes yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager offset={p * CH_PER} limit={CH_PER} total={rows.length} onPage={(off) => setPage(off / CH_PER)} />
    </section>
  );
}
