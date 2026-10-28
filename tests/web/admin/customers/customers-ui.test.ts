/**
 * The Customers tab in happy-dom with the API stubbed: the list (every page read), the band pill
 * only when not Normal, spend without a currency in the cells (the header says OMR), search, the
 * filters in the address, a customer opened (their orders → Orders; the note and tags saved, the
 * server's refusal in words). Ported UI checks of test-customers, test-admin-tweaks (20 a page,
 * filters → page 1).
 */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { route } from "../../../../src/admin/app/route";
import { clearQueries } from "../../../../src/admin/data/query";
import { DialogHost, Toast } from "../../../../src/admin/kit";
import { Customers } from "../../../../src/admin/tabs/customers/Customers";
import { byText, click, mount, settle, stubFetch, type, type Call } from "../_render";

const C = (over: Record<string, unknown>) => ({
  phoneKey: "96891234567", name: "سالم", phone: "+968 91234567", orders: 3, live: 2, spend: 70.044, first: "2026-09-01T08:00:00Z", last: "2026-10-26T08:00:00Z",
  countries: ["OM"], note: "", tags: [] as string[], ...over,
});
let list: Array<ReturnType<typeof C>>;
function routes(over: Record<string, (c: Call) => unknown> = {}) {
  return {
    "GET /customers": (c: Call) => {
      const off = Number(c.query.get("offset") || 0);
      const lim = Number(c.query.get("limit") || 100);
      return { ok: true, customers: list.slice(off, off + lim), limit: lim, offset: off };
    },
    ...over,
  };
}
function page() {
  return mount(h("div", null, h("div", { class: "tab" }, h(Customers, null)), h(DialogHost, null), h(Toast, null)));
}
const dialog = () => document.querySelector("[role=dialog]") as HTMLElement;

beforeEach(() => {
  list = [
    C({ tags: ["vip"], note: "عميل جملة" }),
    C({ phoneKey: "971501234567", name: "Fatma", phone: "+971 501234567", countries: ["AE"], orders: 1, live: 1, spend: 12.5, last: "2026-10-27T08:00:00Z" }),
    C({ phoneKey: "96899999999", name: "Hamed", phone: "+968 99999999", orders: 1, live: 0, spend: 0, last: "2026-10-20T08:00:00Z" }),
  ];
  history.replaceState(null, "", "#customers");
  route.set({ tab: "customers", params: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearQueries();
  document.body.innerHTML = "";
});

describe("the list", () => {
  // from test-customers.js: bands on lifetime spend ("High"/"Medium"/"Normal"); the brief: a pill only when not Normal
  it("one row a customer: name, band pill (not for Normal), tags, note; phone, country, orders and live, spend without OMR, first and last", async () => {
    stubFetch(routes());
    const m = page();
    await settle(10);
    const rows = m.$$("tr.row");
    expect(rows.map((r) => r.getAttribute("data-cust"))).toEqual(["971501234567", "96891234567", "96899999999"]);
    const salim = m.$("tr.row[data-cust='96891234567']")!;
    expect([...salim.querySelectorAll(".pill")].map((p) => p.textContent)).toEqual(["High", "vip"]);
    expect(salim.querySelector("em.sub")!.textContent).toBe("عميل جملة");
    expect(salim.querySelector(".c-spend")!.textContent).toBe("70.044");
    expect(salim.querySelector(".c-orders")!.textContent).toBe("32 live");
    expect(m.$("tr.row[data-cust='971501234567'] .pill")!.textContent).toBe("Medium");
    expect(m.$("tr.row[data-cust='96899999999'] .pill")).toBeNull(); // Normal: no pill
    expect(m.$("thead")!.textContent).toMatch(/Spend OMR/);
    expect(m.$("tbody")!.textContent).not.toMatch(/OMR/);
    expect(m.$(".pg-count")!.textContent).toBe("3 of 3");
    m.unmount();
  });

  it("every customer is read (500 a call)", async () => {
    list = Array.from({ length: 620 }, (_, i) => C({ phoneKey: "9689" + String(1000000 + i), name: "c" + i, last: new Date(Date.parse("2026-10-26T00:00:00Z") - i * 60e3).toISOString() }));
    const { calls } = stubFetch(routes());
    const m = page();
    await settle(12);
    expect(calls.filter((c) => c.path === "/customers").map((c) => c.query.get("offset"))).toEqual(["0", "500"]);
    expect(m.$(".pg-count")!.textContent).toBe("20 of 620");
    m.unmount();
  });

  // from test-customers.js: filters by band and country (built from the list), each filter → page 1
  it("search, band, country and sort live in the address and go back to page 1", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(routes());
    route.set({ tab: "customers", params: { page: "2" } });
    const m = page();
    await settle(10);
    const countries = [...m.$<HTMLSelectElement>("select[aria-label=Country]")!.options].map((o) => o.value);
    expect(countries).toEqual(["", "AE", "OM"]);
    const band = m.$<HTMLSelectElement>("select[aria-label=Band]")!;
    band.value = "high";
    band.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(route.get().params).toEqual({ band: "high" });
    expect(m.$$("tr.row").map((r) => r.getAttribute("data-cust"))).toEqual(["96891234567"]);
    band.value = "";
    band.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await type(m.$("input[type=search]"), "501234");
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(m.$$("tr.row").map((r) => r.getAttribute("data-cust"))).toEqual(["971501234567"]);
    vi.useRealTimers();
    m.unmount();
  });
});

describe("a customer, opened", () => {
  it("their orders link into Orders; the note and tags are saved (orders untouched)", async () => {
    const { calls } = stubFetch(
      routes({
        "GET /orders": () => ({
          ok: true,
          orders: [
            { id: "LM-1000009", phoneKey: "96891234567", createdAt: "2026-10-26T08:00:00Z", status: "new", cur: "OMR", total: 30, items: [] },
            { id: "LM-1000008", phoneKey: "96800000000", createdAt: "2026-10-25T08:00:00Z", status: "new", cur: "OMR", total: 30, items: [] },
          ],
          total: 2, limit: 100, offset: 0, tag: "t", empowerUnsure: [],
        }),
        "PUT /customers/96891234567": (c) => ({ ok: true, phoneKey: "96891234567", ...(c.body as object) }),
      }),
    );
    const m = page();
    await settle(10);
    await click(m.$("tr.row[data-cust='96891234567'] .crm-name"));
    expect(route.get().params.open).toBe("96891234567");
    await settle(6);
    const dlg = dialog();
    expect(calls.find((c) => c.path === "/orders")!.query.get("q")).toBe("96891234567");
    // only this phone's orders
    expect([...dlg.querySelectorAll(".cust-orders .mini b")].map((b) => b.textContent)).toEqual(["LM-1000009"]);
    expect(dlg.querySelector("a[href^='https://wa.me/']")!.getAttribute("href")).toBe("https://wa.me/96891234567");
    const ta = dlg.querySelector("textarea")!;
    await type(ta, "يفضّل العنبر");
    await type(dlg.querySelector(".cust-note input"), "VIP, gift");
    await click(byText(dlg, "button", "Save note and tags"));
    expect(calls.find((c) => c.method === "PUT")!.body).toEqual({ note: "يفضّل العنبر", tags: ["vip", "gift"] });
    expect(document.querySelector(".toast")!.textContent).toBe("Saved. Orders untouched.");
    // an order opens on the Orders tab
    await click(dlg.querySelector(".cust-orders .mini"));
    expect(route.get()).toEqual({ tab: "orders", params: { q: "LM-1000009", open: "LM-1000009" } });
    m.unmount();
  });

  it("a refusal is said in words", async () => {
    stubFetch(
      routes({
        "GET /orders": () => ({ ok: true, orders: [], total: 0, limit: 100, offset: 0, tag: "t", empowerUnsure: [] }),
        "PUT /customers/96891234567": () => [400, { ok: false, error: "bad_input", issues: [{ path: "note", message: "Too long" }] }],
      }),
    );
    // the address and the store together (happy-dom may announce a hash change late)
    history.replaceState(null, "", "#customers?open=96891234567");
    route.set({ tab: "customers", params: { open: "96891234567" } });
    const m = page();
    await settle(10);
    await type(dialog().querySelector("textarea"), "x");
    await click(byText(dialog(), "button", "Save note and tags"));
    expect(dialog().querySelector("[role=alert]")!.textContent).toBe("Not accepted: note — Too long");
    m.unmount();
  });
});
