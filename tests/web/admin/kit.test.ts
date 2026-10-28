/**
 * The component kit and the Overview's parts: the pager, the charts, the calendar, the
 * multi-select, the dialogs, the warnings box, best sellers and the chart's days.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderListRow } from "../../../src/shared/admin/api";
import { ask, BarChart, DateRange, DialogHost, LineChart, MultiSelect, niceMax, Pager, type Range } from "../../../src/admin/kit";
import { bestSellers, chartRows, warningLines, Warnings } from "../../../src/admin/tabs/overview/Overview";
import { panelUi } from "../../../src/admin/app/panel";
import { byText, click, key, mount, settle, stubFetch } from "./_render";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

// from test-admin-tweaks.js: 20 a page, the count always shown
describe("the pager", () => {
  it("'20 of 86' on the first page, '86 of 86' on the last, ‹ 1 / 5 ›; drawn for a single page too", async () => {
    const seen: number[] = [];
    const m = mount(h(Pager, { offset: 0, limit: 20, total: 86, onPage: (o: number) => seen.push(o) }));
    expect(m.$(".pg-count")!.textContent).toBe("20 of 86");
    expect(m.$(".pg-of")!.textContent).toBe("1 / 5");
    expect(m.$<HTMLButtonElement>("[aria-label='Previous page']")!.disabled).toBe(true);
    await click(m.$("[aria-label='Next page']"));
    expect(seen).toEqual([20]);
    m.unmount();
    const last = mount(h(Pager, { offset: 80, limit: 20, total: 86, onPage: () => {} }));
    expect(last.$(".pg-count")!.textContent).toBe("86 of 86");
    last.unmount();
    const one = mount(h(Pager, { offset: 0, limit: 20, total: 7, onPage: () => {} }));
    expect(one.$(".pg-count")!.textContent).toBe("7 of 7");
    expect(one.$(".pg-nav")).toBeNull();
    one.unmount();
  });
});

// from test-admin-boot.js / test-admin-look.js: inline SVG charts, no library
describe("the charts", () => {
  it("a line chart: an svg with a viewBox, a path that starts M, the last point marked", () => {
    const m = mount(h(LineChart, { rows: [{ label: "1 Oct", n: 1 }, { label: "2 Oct", n: 3 }, { label: "3 Oct", n: 2 }], unit: "orders" }));
    expect(m.$("svg")!.getAttribute("viewBox")).toBe("0 0 620 210");
    expect(m.$("path.line")!.getAttribute("d")).toMatch(/^M38 /);
    expect(m.$$("circle").length).toBe(3);
    expect(m.$("circle.dot-hi title")!.textContent).toBe("3 Oct: 2 orders");
    // a count has whole-number gridlines: the top is a multiple of four
    expect(m.$$("text.axis-t").map((t) => t.textContent).slice(0, 5)).toEqual(["0", "1", "2", "3", "4"]);
    m.unmount();
  });
  it("a bar chart: an empty day still answers a hover; no data says so", () => {
    const m = mount(h(BarChart, { rows: [{ label: "a", n: 0 }, { label: "b", n: 5 }], unit: "OMR" }));
    expect(m.$$("path.bar").length).toBe(1);
    expect(m.$$("rect.bar-hit").length).toBe(2);
    m.unmount();
    expect(mount(h(LineChart, { rows: [] })).text()).toBe("No data for this range yet.");
    expect([niceMax(0), niceMax(7), niceMax(23), niceMax(470)]).toEqual([1, 7, 25, 500]);
  });
});

describe("the calendar", () => {
  function Host({ onChange }: { onChange: (r: Range) => void }) {
    const [r, setR] = useState<Range>({ pre: "all", from: "", to: "" });
    return h(DateRange, { value: r, onChange: (x: Range) => (setR(x), onChange(x)), now: Date.parse("2026-10-27T09:00:00Z") });
  }
  it("a preset is kept by name; two days make a range; Escape closes and gives focus back", async () => {
    const got: Range[] = [];
    const m = mount(h(Host, { onChange: (r: Range) => got.push(r) }));
    const btn = m.$(".drp-btn")!;
    expect(btn.textContent).toBe("All time");
    await click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    await click(byText(m.root, ".drp-presets button", "Last 7 days"));
    expect(got[0]).toEqual({ pre: "7", from: "", to: "" });
    expect(m.$(".drp-btn")!.textContent).toBe("Last 7 days");
    expect(m.$(".drp-btn")!.className).toMatch(/set/);
    await click(m.$(".drp-btn"));
    await click(m.$("[aria-label='3 Oct 2026']"));
    expect(m.$(".drp-sum")!.textContent).toBe("3 Oct 2026 → pick an end day");
    await click(m.$("[aria-label='1 Oct 2026']"));
    expect(got[1]).toEqual({ pre: "", from: "2026-10-01", to: "2026-10-03" });
    expect(m.$(".drp-btn")!.textContent).toBe("1 Oct – 3 Oct 2026");
    await click(m.$(".drp-btn"));
    // a day after today cannot be picked
    expect(m.$<HTMLButtonElement>("[aria-label='28 Oct 2026']")!.disabled).toBe(true);
    await key(m.$(".drp-pop"), "Escape");
    expect(m.$(".drp-pop")).toBeNull();
    expect(document.activeElement).toBe(m.$(".drp-btn"));
    m.unmount();
  });
});

describe("the multi-select", () => {
  const OPTS = [
    { value: "new", label: "New Order" },
    { value: "ship", label: "Shipped" },
    { value: "flagged", label: "Flagged" },
  ];
  it("ticks apply on Done; the search narrows; Escape closes without applying", async () => {
    const got: string[][] = [];
    const m = mount(h(MultiSelect, { label: "Order status", options: OPTS, value: [], onChange: (v: string[]) => got.push(v) }));
    await click(m.$(".msel-btn"));
    await click(m.$$(".msel-row input")[2]!);
    await click(m.$$(".msel-row input")[0]!);
    await click(m.$(".msel-done"));
    // in the list's order, not the click order
    expect(got).toEqual([["new", "flagged"]]);
    await click(m.$(".msel-btn"));
    const q = m.$<HTMLInputElement>(".msel-q input")!;
    q.value = "ship";
    q.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(m.$$(".msel-row").map((r) => r.textContent)).toEqual(["Shipped"]);
    await click(m.$$(".msel-row input")[0]!);
    await key(m.$(".msel-pop"), "Escape");
    expect(got.length).toBe(1);
    m.unmount();
  });
});

describe("dialogs", () => {
  it("ask() is a modal: focus goes in, the answer comes back, Escape is No", async () => {
    const m = mount(h(DialogHost, null));
    const p = ask({ title: "Cancel order LM-1?", text: "It is marked cancelled, not deleted.", ok: "Cancel order", danger: true });
    await settle();
    const dlg = document.querySelector("[role=dialog]")!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.textContent).toMatch(/marked cancelled, not deleted/);
    expect(document.activeElement!.textContent).toBe("Cancel order");
    await click(byText(dlg, "button", "Cancel order"));
    expect(await p).toBe(true);
    const p2 = ask({ title: "Again?" });
    await settle();
    await key(document.querySelector("[role=dialog]"), "Escape");
    expect(await p2).toBe(false);
    m.unmount();
  });
});

describe("the Overview's warnings", () => {
  const W = (what: string, dismissible = true, kind: "warn" | "stale" = "warn") => ({ code: kind + ":" + what, kind, what, dismissible });
  // from test-v408.js §2 / test-v411.js §2: dismissed by code on the server; a missing key cannot be dismissed
  it("dismiss sends the shown dismissible codes with PUT /settings/ui; a missing key stays and has no dismiss", async () => {
    panelUi.set({ hidden: [], dismissed: ["warn:old"], loaded: true });
    const { calls } = stubFetch({ "PUT /settings/ui": (c) => ({ ok: true, ui: { hidden: [] }, dismissed: (c.body as { dismissed: string[] }).dismissed }), "GET /overview": () => ({ ok: false }) });
    const m = mount(h(Warnings, { warnings: [W("omniful_hook_unsigned"), W("empower-poll", true, "stale")] }));
    expect(m.text()).toMatch(/2 warnings from the health check/);
    expect(m.text()).toMatch(/OMNIFUL_HOOK_SECRET not set/);
    await click(m.$("[aria-label='Dismiss these warnings']"));
    await settle();
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ dismissed: ["warn:old", "warn:omniful_hook_unsigned", "stale:empower-poll"] });
    expect(m.$(".stale")).toBeNull();
    expect(JSON.stringify(localStorage)).not.toMatch(/omniful/);
    m.unmount();
    const k = mount(h(Warnings, { warnings: [W("session_secret_missing", false)] }));
    expect(k.text()).toMatch(/1 setting needs fixing on the server/);
    expect(k.$("[aria-label='Dismiss these warnings']")).toBeNull();
    k.unmount();
    expect(warningLines([W("a", true, "stale"), W("b", true, "stale")])).toEqual(["Scheduled jobs not running on time: a, b (check their schedules and last runs)."]);
  });
});

describe("best sellers and the chart's days", () => {
  const row = (over: Partial<OrderListRow>) => ({ id: "LM-1", createdAt: "2026-10-26T08:00:00Z", status: "new", paymentStatus: "cod", pay: "cod", total: 100, omr: 10, trashed: false, refunded: false, items: [], ...over }) as unknown as OrderListRow;
  it("live orders only, by quantity, valued at each line's share of the order in OMR, named in English", () => {
    const list = [
      row({ items: [{ itemId: "oud-large", scent: "عود", size: "كبير", price: 60, qty: 2 }, { itemId: "burner", scent: "مبخرة", size: "", price: 40, qty: 1 }], total: 160, omr: 16 }),
      row({ id: "LM-2", status: "void", items: [{ itemId: "burner", scent: "مبخرة", size: "", price: 40, qty: 5 }] }),
      row({ id: "LM-3", items: [{ itemId: "rose-x", scent: "ورد", size: "صغير", price: 10, qty: 1 }] }),
    ];
    expect(bestSellers(list)).toEqual([
      { key: "oud-large", name: "Oud · Large", qty: 2, omr: 12 },
      { key: "burner", name: "Incense Burner", qty: 1, omr: 4 },
      { key: "rose-x", name: "ورد · صغير", qty: 1, omr: 1 },
    ]);
  });
  // test-admin-boot / v330: Muscat days, live orders, zero-filled
  it("the chart's rows: one per Muscat day over the range, zeros included, live orders only", () => {
    const now = Date.parse("2026-10-27T09:00:00Z");
    const list = [row({ createdAt: "2026-10-26T21:30:00Z" }), row({ createdAt: "2026-10-26T10:00:00Z" }), row({ status: "pending", createdAt: "2026-10-27T05:00:00Z" })];
    expect(chartRows(list, 7, now)).toEqual([
      { label: "21 Oct", n: 0 }, { label: "22 Oct", n: 0 }, { label: "23 Oct", n: 0 }, { label: "24 Oct", n: 0 }, { label: "25 Oct", n: 0 }, { label: "26 Oct", n: 1 }, { label: "27 Oct", n: 1 },
    ]);
  });
});
