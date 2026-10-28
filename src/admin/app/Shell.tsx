/**
 * THE SHELL — the sidebar (nav, the store's health, View store, Settings, Sign out), the top
 * bar (the page's name, the search, "Updated hh:mm", Refresh, the avatar) and the open tab.
 *
 * Keyboard: the nav is one Tab stop (roving tabindex); arrows, Home and End move along it,
 * Enter/Space opens. Ctrl K / ⌘ K focuses the search; Enter hands the query to Orders.
 *
 * Refresh re-reads every read on screen (our data only — never Thawani or Omniful). Every five
 * minutes the same happens by itself as an "auto" refresh (the Orders list sends its `since`
 * tag and is answered "unchanged" when nothing moved), paused while the page is hidden and put
 * off while someone is typing in the open tab.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { AdminPage } from "../../shared/admin/api";
import { useOverview } from "../data/hooks";
import { errorsOnScreen, lastSync, refreshActive } from "../data/query";
import { useStore } from "../data/store";
import { Btn, DialogHost, Icon, Modal, Switch, toast, Toast } from "../kit";
import { hhmm, initials, plural } from "../lib/format";
import { explain } from "../lib/words";
import { panelUi, saveHidden, usePanelUi } from "./panel";
import { navigate, useRoute } from "./route";
import { session, signOut } from "./session";
import { TABS, visibleTabs, type TabDef } from "./tabs";

export const AUTO_REFRESH_MS = 300_000;

/* ---------------- the sidebar ---------------- */

function NavItem({ tab, current, onKey }: { tab: TabDef; current: boolean; onKey: (e: KeyboardEvent) => void }) {
  const n = tab.badge ? tab.badge() : null;
  return (
    <button
      type="button"
      class="nav-btn"
      data-tab={tab.id}
      aria-current={current ? "page" : undefined}
      aria-label={tab.label + (n ? ", " + n + " new" : "")}
      title={tab.label}
      tabIndex={current ? 0 : -1}
      onClick={() => navigate(tab.id)}
      onKeyDown={onKey}
    >
      <Icon name={tab.icon} />
      <span>{tab.label}</span>
      {n ? (
        <b class="badge" aria-hidden="true">
          {n}
        </b>
      ) : null}
    </button>
  );
}

export function Nav({ tabs, current }: { tabs: TabDef[]; current: string }) {
  const ref = useRef<HTMLElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key];
    if (!step && e.key !== "Home" && e.key !== "End") return;
    const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".nav-btn") || [])];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : (i + step! + bs.length) % bs.length;
    bs.forEach((b, k) => b.setAttribute("tabindex", k === j ? "0" : "-1"));
    bs[j]!.focus();
  };
  const groups: Array<TabDef["group"]> = ["Workspace", "Insights"];
  return (
    <nav class="nav" aria-label="Panel" ref={ref}>
      {groups.map((g) => {
        const list = tabs.filter((t) => t.group === g);
        if (!list.length) return null;
        return [
          <span class="nav-label" key={"l" + g} aria-hidden="true">
            {g}
          </span>,
          ...list.map((t) => <NavItem key={t.id} tab={t} current={t.id === current} onKey={onKey} />),
        ];
      })}
    </nav>
  );
}

/** The store card: the health from /overview (database reachable, no job late, no key missing). */
export function HealthCard() {
  const q = useOverview();
  const o = q.data;
  let cls = "";
  let title = "Checking store…";
  let msg = "Reading configuration";
  if (o) {
    const missing = o.warnings.filter((w) => /_missing$/.test(w.what)).length;
    const warns = o.warnings.length;
    if (!o.health.db.ok) {
      cls = "bad";
      title = "Database unreachable";
      msg = "Orders cannot be read or saved right now";
    } else if (missing) {
      cls = "warn";
      title = "Configuration incomplete";
      msg = plural(missing, "setting") + " missing (see Overview)";
    } else if (warns || o.health.staleJobs.length) {
      cls = "warn";
      title = "Store is up, with warnings";
      msg = plural(warns, "warning") + " on the Overview";
    } else {
      cls = "ok";
      title = "Store is healthy";
      msg = "Payments, database and pixels all reachable";
    }
  } else if (q.error) {
    cls = "bad";
    title = "Health not read";
    msg = explain(q.error);
  }
  return (
    <div class={"store-card " + cls} aria-live="polite" id="storeCard">
      <div class="store-card-top">
        <i aria-hidden="true" />
        <b>{title}</b>
      </div>
      <p>{msg}</p>
    </div>
  );
}

/* ---------------- settings ---------------- */

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = usePanelUi();
  const [hidden, setHidden] = useState<string[]>(ui.hidden);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setHidden(panelUi.get().hidden);
  }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      await saveHidden(hidden as AdminPage[]);
      onClose();
      toast(hidden.length ? plural(hidden.length, "page") + " hidden from the panel" : "Every page is shown", true);
    } catch (e) {
      toast("Could not save: " + explain(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Panel settings">
      <p class="hint">Pages in the left panel. Hidden pages hide for every admin; nothing is deleted.</p>
      <div class="ui-pages">
        <Switch checked fixed disabled>
          Overview (always shown)
        </Switch>
        {TABS.filter((t) => t.page).map((t) => (
          <Switch key={t.id} checked={hidden.indexOf(t.page!) < 0} onChange={(on) => setHidden((h) => (on ? h.filter((x) => x !== t.page) : [...h, t.page!]))}>
            {t.label}
          </Switch>
        ))}
      </div>
      <div class="dlg-foot">
        <Btn sm kind="ghost" onClick={onClose}>
          Cancel
        </Btn>
        <Btn sm kind="primary" busy={busy} onClick={save}>
          Save
        </Btn>
      </div>
      <div class="dlg-links">
        <a class="btn sm ghost" href="/" target="_blank" rel="noopener">
          <Icon name="link" />
          <span>View store</span>
        </a>
        <Btn sm kind="ghost" icon="out" onClick={() => void signOut()}>
          Sign out
        </Btn>
        <Btn
          sm
          kind="ghost"
          icon="out"
          title="End the session in every browser, this one included"
          onClick={() => void signOut(true).then(() => toast("Signed out everywhere", true))}
        >
          Sign out everywhere
        </Btn>
      </div>
    </Modal>
  );
}

/* ---------------- the top bar ---------------- */

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test((navigator.platform || "") + (navigator.userAgent || ""));

function TopBar({ tab, showSearch, onSettings }: { tab: TabDef; showSearch: boolean; onSettings: () => void }) {
  const s = useStore(session);
  const stamp = useStore(lastSync);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "k" && box.current) {
        e.preventDefault();
        box.current.focus();
        box.current.select();
      }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    await refreshActive("refresh");
    setBusy(false);
    const errs = errorsOnScreen();
    if (errs.length) toast("Could not refresh: " + explain(errs[0]));
    else toast("Refreshed", true);
  };

  const me = initials(s.user);
  return (
    <header class="top">
      <div class="top-copy">
        <h1 id="pageTitle" tabIndex={-1}>
          {tab.title}
        </h1>
        <span class="crumb">{tab.sub}</span>
      </div>
      {showSearch ? (
        <label class="top-search">
          <Icon name="search" />
          <input
            id="globalSearch"
            ref={box}
            type="search"
            placeholder="Search orders or customers"
            aria-label="Search orders"
            autocomplete="off"
            spellcheck={false}
            value={q}
            onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                e.preventDefault();
                navigate("orders", { q: q.trim() });
                setQ("");
                box.current?.blur();
              }
              if (e.key === "Escape") {
                setQ("");
                box.current?.blur();
              }
            }}
          />
          <kbd aria-hidden="true">{MAC ? "⌘ K" : "Ctrl K"}</kbd>
        </label>
      ) : null}
      <div class="top-actions">
        <span class="stamp" id="syncStamp" aria-live="off">
          {stamp ? "Updated " + hhmm(stamp) : ""}
        </span>
        <Btn class="sync" iconOnly icon="refresh" label="Refresh this page" busy={busy} onClick={refresh} />
        <Btn id="topSettings" iconOnly icon="cog" label="Settings" aria-haspopup="dialog" onClick={onSettings} />
        {me ? (
          <span class="avatar" id="whoAmI" title={"Signed in as " + s.user} aria-label={"Signed in as " + s.user} role="img">
            {me}
          </span>
        ) : null}
      </div>
    </header>
  );
}

/* ---------------- the five-minute refresh ---------------- */

/** Someone is typing in the open tab: a field with focus that is not empty. */
export function typing(): boolean {
  const a = document.activeElement as HTMLInputElement | null;
  if (!a || !a.closest || !a.closest(".tab")) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && String(a.value || "") !== "";
}

export function useAutoRefresh(ms = AUTO_REFRESH_MS) {
  useEffect(() => {
    let due = false;
    const tick = () => {
      if (document.hidden || typing()) {
        due = true;
        return;
      }
      due = false;
      void refreshActive("auto");
    };
    const t = setInterval(tick, ms);
    // put off while typing: try again shortly after the field is left
    const again = setInterval(() => due && tick(), 30_000);
    const vis = () => {
      if (!document.hidden && due) tick();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      clearInterval(again);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [ms]);
}

/* ---------------- the shell ---------------- */

export function Shell() {
  const r = useRoute();
  const ui = usePanelUi();
  const [settings, setSettings] = useState(false);
  const tabs = visibleTabs(ui.hidden);
  const tab = tabs.find((t) => t.id === r.tab) || tabs[0]!;
  useAutoRefresh();

  useEffect(() => {
    // a hidden or unknown page is not a page: Overview
    if (tab.id !== r.tab) navigate(tab.id, {}, { replace: true });
    document.title = tab.title + " · Luban & Musk";
  }, [tab.id, r.tab]);

  const Page = tab.component;
  const ordersShown = tabs.some((t) => t.id === "orders");
  return (
    <div class="shell">
      <aside class="side">
        <div class="side-top">
          <span class="brand-mark" aria-hidden="true">
            LM
          </span>
          <span class="brand-copy">
            <span class="brand">Luban &amp; Musk</span>
          </span>
        </div>
        <Nav tabs={tabs} current={tab.id} />
        <div class="side-foot">
          <HealthCard />
          <a class="ghost-link" href="/" target="_blank" rel="noopener" aria-label="View store" title="View store">
            <Icon name="link" />
            <span>View store</span>
          </a>
          <button class="ghost-link" type="button" aria-label="Settings" title="Settings" aria-haspopup="dialog" onClick={() => setSettings(true)}>
            <Icon name="cog" />
            <span>Settings</span>
          </button>
          <button class="ghost-link" type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
            <Icon name="out" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>
      <main class="main" id="main">
        <TopBar tab={tab} showSearch={ordersShown} onSettings={() => setSettings(true)} />
        <div class="tab" id={"tab-" + tab.id} key={tab.id} role="region" aria-labelledby="pageTitle">
          <Page />
        </div>
      </main>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

export { Toast, DialogHost };
