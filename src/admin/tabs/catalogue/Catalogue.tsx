/**
 * THE CATALOGUE TAB — the editor for the published catalogue. A wrong save changes live
 * prices, so:
 *   - nothing is published until "Save & publish", and the bar says when there are unsaved
 *     changes; boxes that do not read as numbers, and the original's own refusals (a schedule
 *     ending before it starts, an offer with no market ticked), stop the publish with words;
 *   - the publish is conditional (the version + editTag loaded): someone else's publish in
 *     between answers 409 stale, and the tab says so and offers to reload — never overwrites;
 *   - code-owned fields (OMR rates, drawings) and the routes are never sent;
 *   - a failed load shows no editor at all (nothing can be published over a catalogue that
 *     was not read);
 *   - after a publish the server's change lines are shown ("AE small 120→110 AED").
 * The Stock Tracker's switches and a market's route are saved at once through their own
 * routes and never carry this tab's unsaved edits.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Catalogue as Cat } from "../../../shared/catalogue/types";
import { isApiError } from "../../data/api";
import { KEYS } from "../../data/hooks";
import { invalidate, setQueryData, useQuery } from "../../data/query";
import { ask, Btn, Icon, Modal, toast } from "../../kit";
import { explain } from "../../lib/words";
import { exportUrl, publishCatalogue, readCatalogue, restoreDefaults, type CatalogueRead, type Published } from "./api";
import { BadBoxes } from "./fields";
import { Markets } from "./Markets";
import { clone, copyStock, problemsOf, sameButStock, sameDraft, toDraft, toPublish, type Draft } from "./model";
import { FreeDelivery, LargeBundle, SmallBundle } from "./Offers";
import { StockTracker } from "./StockTracker";

export const CAT_KEY = "catalogue-edit";

interface Loaded {
  version: number;
  editTag: string;
  /** the row as stored when loaded (null: nothing published) */
  stored: Cat | null;
  /** what the server served (the merged view), for "Restore <size>" */
  data: Cat;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Save a text as a file (the panel's own copy of what is on screen). */
function saveFile(name: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function Catalogue() {
  const q = useQuery(CAT_KEY, () => readCatalogue());
  const [draft, setDraftState] = useState<Draft | null>(null);
  const cur = useRef<Draft | null>(null);
  const [base, setBase] = useState<Draft | null>(null);
  const [meta, setMeta] = useState<Loaded | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [changes, setChanges] = useState<{ lines: string[]; at: string } | null>(null);
  const [busy, setBusy] = useState<"" | "publish" | "reload" | "restore">("");
  const [restoring, setRestoring] = useState(false);
  const [word, setWord] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const bad = useRef(new Map<string, string>());
  const [, setBadN] = useState(0);

  const setDraft = (d: Draft | null) => {
    cur.current = d;
    setDraftState(d);
  };
  /** every edit: a copy changed and put back (synchronous, so a caller can read what it did) */
  const edit = (fn: (d: Draft) => void) => {
    if (!cur.current) return;
    const n = clone(cur.current);
    fn(n);
    setDraft(n);
  };
  const report = (key: string, problem: string | null) => {
    const had = bad.current.get(key);
    if (problem) bad.current.set(key, problem);
    else bad.current.delete(key);
    if (had !== (problem || undefined)) setBadN((x) => x + 1);
  };

  const adopt = (r: CatalogueRead) => {
    const d = toDraft(r.data as Cat);
    setDraft(d);
    setBase(clone(d));
    setMeta({ version: r.version, editTag: r.editTag, stored: (r.stored as Cat | null) || null, data: r.data as Cat, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    setStale(null);
  };

  const dirty = !!(draft && base && !sameDraft(draft, base));

  // a read came in (the first, a refresh): take it when there is nothing unsaved; with unsaved
  // edits, say that someone else has published rather than overwrite either side
  useEffect(() => {
    const r = q.data;
    if (!r) return;
    if (!draft || !meta) return adopt(r);
    if (r.editTag === meta.editTag) {
      if (r.version !== meta.version && !dirty) adopt(r);
      return;
    }
    if (!dirty) adopt(r);
    else setStale("Someone else published the catalogue since you opened it" + (r.updatedBy ? " (" + r.updatedBy + ")" : "") + ".");
  }, [q.data]);

  // the clocks in the headings move on their own
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const reload = async () => {
    setBusy("reload");
    try {
      const r = await readCatalogue();
      setQueryData(CAT_KEY, () => r);
      bad.current.clear();
      adopt(r);
      return r;
    } finally {
      setBusy("");
    }
  };

  const afterWrite = (j: Published) => {
    setChanges({ lines: j.change || [], at: j.updatedAt });
    // the order screens' markets, the Empower tab's routes read the catalogue too
    invalidate((k) => k === KEYS.catalogue || k.startsWith("options:") || k.startsWith("empower"));
  };

  const onStale = (e: unknown) => {
    setStale("Someone else published the catalogue since you opened it" + (isApiError(e) && e.extra.version != null ? " (now version " + String(e.extra.version) + ")" : "") + ".");
    toast("Not published: someone else published the catalogue since you opened it. Reload to see theirs, then make your change again.");
  };

  const publish = async () => {
    if (!draft || !meta) return;
    const problems = [...bad.current.values(), ...problemsOf(draft)];
    if (problems.length) return toast(problems[0]!);
    setBusy("publish");
    try {
      const j = await publishCatalogue({ data: toPublish(draft), version: meta.version, editTag: meta.editTag });
      afterWrite(j);
      toast(j.change && j.change.length ? "Published. Live within a minute." : "Published. Nothing on the storefront changed.", true);
      setBusy("");
      await reload();
    } catch (e) {
      if (isApiError(e, "stale")) onStale(e);
      else if (isApiError(e, "bad_country_code")) toast("Invalid country code. Use two letters, e.g. AE.");
      else toast("Could not publish: " + explain(e));
    } finally {
      setBusy("");
    }
  };

  const discard = async () => {
    if (dirty && !(await ask({ title: "Discard your edits?", text: "Reload the published catalogue. Anything typed here since the last save is discarded. Nothing is published — this only refills the form.", ok: "Discard and reload", danger: true }))) return;
    try {
      await reload();
      setChanges(null);
      toast("Reloaded the published catalogue · nothing published", true);
    } catch (e) {
      toast("Could not reload: " + explain(e));
    }
  };

  const exportIt = () => {
    if (!draft) return;
    if (!dirty) {
      location.href = exportUrl();
      return;
    }
    const day = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
    if (saveFile("catalogue-" + day + "-unpublished.json", JSON.stringify(toPublish(draft), null, 2) + "\n")) toast("Downloaded what is on screen (not published). Publish with Save & publish.", true);
    else toast("Could not make the file in this browser");
  };

  const lost = () => {
    const c0 = (draft && draft.countries[0]) || null;
    if (!c0) return "";
    const bits = ["COD fee " + (c0.cod ?? 0), "shipping " + (c0.ship ?? 0), "free over " + (c0.freeOver ?? 0)];
    const p = (c0.prices || {}).large;
    if (p && p.now != null) bits.push("large " + p.now);
    return " (" + c0.code + ": " + bits.join(", ") + ")";
  };

  const restore = async () => {
    if (!meta || word.trim().toLowerCase() !== "defaults") return;
    setBusy("restore");
    try {
      const j = await restoreDefaults({ version: meta.version, editTag: meta.editTag });
      setRestoring(false);
      setWord("");
      afterWrite(j);
      toast("Restored the deploy's catalogue and published it", true);
      setBusy("");
      await reload();
    } catch (e) {
      if (isApiError(e, "stale")) {
        setRestoring(false);
        onStale(e);
      } else toast("Could not restore: " + explain(e));
    } finally {
      setBusy("");
    }
  };

  /** a Stock Tracker switch was saved: take its new version only when nothing else moved */
  const stockSaved = (j: Published) => {
    afterWrite(j);
    if (!meta || !cur.current) return;
    if (meta.stored && sameButStock(meta.stored, j.data as Cat)) {
      setMeta({ ...meta, version: j.version, editTag: j.editTag, stored: j.data as Cat });
      edit((d) => copyStock(d, j.data as Cat));
      setBase((b) => {
        if (!b) return b;
        const n = clone(b);
        copyStock(n, j.data as Cat);
        return n;
      });
    } else {
      setStale("The catalogue was published elsewhere while this page was open.");
    }
  };

  const routed = (code: string, courier: string) => {
    const set = (d: Draft) => {
      const c = d.countries.find((x) => x.code === code);
      if (c) c.courier = courier;
    };
    edit(set);
    setBase((b) => {
      if (!b) return b;
      const n = clone(b);
      set(n);
      return n;
    });
    invalidate((k) => k === KEYS.catalogue || k.startsWith("empower"));
  };

  if (!draft || !meta) {
    return (
      <section class="card">
        {q.error ? (
          <div class="stale" role="alert">
            <Icon name="alert" />
            <div>
              <b>Could not load the catalogue</b>
              <span class="hint">{explain(q.error)} Nothing can be published until it loads.</span>
            </div>
            <Btn sm kind="primary" onClick={() => q.refetch()}>
              Try again
            </Btn>
          </div>
        ) : (
          <p class="hint" aria-live="polite">
            Loading the catalogue…
          </p>
        )}
      </section>
    );
  }

  const problems = [...bad.current.values(), ...problemsOf(draft)];
  const publishedCodes = ((meta.stored && meta.stored.countries) || []).map((c) => c.code);

  return (
    <BadBoxes.Provider value={report}>
      <div class="cat-tab">
        {stale ? (
          <div class="stale" role="alert">
            <Icon name="alert" />
            <div>
              <b>{stale}</b>
              <span class="hint">Publishing now would be refused. Reload to see the published catalogue (your edits here are discarded), then make your change again — or Export first to keep them.</span>
            </div>
            <Btn sm kind="primary" icon="undo" busy={busy === "reload"} onClick={() => reload().then(() => toast("Reloaded the published catalogue", true), (e) => toast(explain(e)))}>
              Reload
            </Btn>
          </div>
        ) : null}

        <SmallBundle d={draft} edit={edit} now={now} />
        <LargeBundle d={draft} edit={edit} now={now} />
        <FreeDelivery d={draft} edit={edit} now={now} />
        <StockTracker d={draft} onSaved={stockSaved} />
        <Markets d={draft} edit={edit} loaded={meta.data} publishedCodes={publishedCodes} onRouted={routed} />

        <section class="card dock" aria-labelledby="pub-h">
          <div class="card-head">
            <h2 id="pub-h">Publishing</h2>
            <span class={"stamp" + (dirty ? " info" : "")} aria-live="polite">
              {dirty ? "Unsaved changes" : "No unsaved changes"}
              {meta.updatedAt ? " · last published " + new Date(meta.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) + (meta.updatedBy ? " by " + meta.updatedBy : "") : " · nothing published yet"}
            </span>
          </div>
          {dirty && problems.length ? (
            <p class="note warn" role="alert">
              {problems.length === 1 ? problems[0] : problems.length + " things to fix before publishing: " + problems.slice(0, 3).join(" · ") + (problems.length > 3 ? " · …" : "")}
            </p>
          ) : null}
          {changes ? (
            <div class="note info pub-changes" role="status">
              <b>Published {new Date(changes.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</b>{" "}
              {changes.lines.length ? (
                <>
                  What changed on the store:
                  <ul>
                    {changes.lines.map((l, k) => (
                      <li key={k} dir="auto">
                        {l}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                "Nothing on the storefront changed."
              )}
            </div>
          ) : null}
          <div class="row-btns">
            <Btn kind="accent" icon="check" busy={busy === "publish"} disabled={!!stale} onClick={publish}>
              Save &amp; publish
            </Btn>
            <Btn icon="download" onClick={exportIt} title={dirty ? "Download what is on screen, unsaved edits included" : "Download the published catalogue"}>
              Export settings.json
            </Btn>
            <Btn icon="undo" busy={busy === "reload"} onClick={discard}>
              Discard edits, reload published
            </Btn>
            <Btn kind="ghost" onClick={() => setRestoring(true)}>
              Restore defaults
            </Btn>
          </div>
        </section>

        <Modal open={restoring} onClose={() => setRestoring(false)} title="Restore the deploy's catalogue?">
          <p class="hint">
            {"This replaces the live catalogue with the one shipped in this deploy and publishes it at once. It DISCARDS every price and fee edited here" + lost() + ". Routes are kept."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              restore();
            }}
          >
            <label class="tf">
              <span>Type defaults to confirm</span>
              <input value={word} dir="ltr" autocomplete="off" onInput={(e) => setWord((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <div class="dlg-foot">
              <Btn sm kind="ghost" onClick={() => setRestoring(false)}>
                Cancel
              </Btn>
              <Btn sm kind="danger" type="submit" disabled={word.trim().toLowerCase() !== "defaults"} busy={busy === "restore"}>
                Restore and publish
              </Btn>
            </div>
          </form>
        </Modal>
      </div>
    </BadBoxes.Provider>
  );
}
