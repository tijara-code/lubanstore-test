/**
 * CUSTOMERS — the CRM: everyone who has ordered, one row per person (the server adds orders up by
 * the phone key, so "+968 9123 4567" on one order and "91234567" on another are one customer).
 *
 *   toolbar   search (name, phone digits, note, tags), band (High / Medium / Normal on lifetime
 *             spend), country (from the list itself), sort, CSV
 *   table     name with its band (a pill only when not Normal) and tags, phone, country, orders
 *             (and how many are live), spend in OMR (the header says OMR, the cells do not),
 *             first and last order; 20 a page
 *   a row     opens the customer: their orders (each a link into Orders), the note and the tags
 *             (PUT /customers/:key — the panel's own words about them; orders untouched)
 *
 * The whole list is read once (500 a call) and filtered here, so search and filters are instant.
 * The filters live in the address: #customers?q=…&band=high&country=AE&sort=spend&page=2.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { CustomerRow } from "../../../shared/admin/api";
import { setParams, useRoute } from "../../app/route";
import { listCustomers } from "../../data/insights";
import { useQuery } from "../../data/query";
import { Btn, Empty, Pager, Pill, SearchField, Select, toast } from "../../kit";
import { downloadCsv } from "../../lib/csv";
import { dt, plural } from "../../lib/format";
import { COUNTRY_EN, explain } from "../../lib/words";
import { bandOf, BANDS, crmCountries, crmCsv, crmRows, CUSTOMERS_KEY, omr, SORTS, type CrmFilters, type CrmSort } from "./crm";
import { CustomerDialog } from "./CustomerDialog";

export const PER_PAGE = 20;
const CALL = 500;
const MAX_CALLS = 20;


/** Every customer (500 a call, at most 10,000). */
export async function loadCustomers(): Promise<{ rows: CustomerRow[]; capped: boolean }> {
  const rows: CustomerRow[] = [];
  for (let i = 0; i < MAX_CALLS; i++) {
    const a = await listCustomers({ sort: "last", limit: CALL, offset: i * CALL });
    rows.push(...a.customers);
    if (a.customers.length < CALL) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export function crmFiltersOf(p: Record<string, string>): CrmFilters & { page: number } {
  return {
    q: p.q || "",
    band: BANDS.some((b) => b.id === p.band) ? p.band! : "",
    country: /^[A-Z]{2}$/.test(p.country || "") ? p.country! : "",
    sort: (SORTS.some((s) => s.value === p.sort) ? p.sort : "last") as CrmSort,
    page: Math.max(1, parseInt(p.page || "1", 10) || 1),
  };
}


export function Customers() {
  const r = useRoute();
  const f = crmFiltersOf(r.params);
  const list = useQuery(CUSTOMERS_KEY, () => loadCustomers());
  const open = r.params.open || "";

  const [qText, setQText] = useState(f.q);
  const typed = useRef(f.q);
  useEffect(() => {
    if (f.q !== typed.current) {
      typed.current = f.q;
      setQText(f.q);
    }
  }, [f.q]);
  useEffect(() => {
    if (qText === typed.current) return;
    const t = setTimeout(() => {
      typed.current = qText;
      update({ q: qText.trim() });
    }, 200);
    return () => clearTimeout(t);
  }, [qText]);

  const update = (next: Partial<CrmFilters & { page: number }>) => {
    const g = { ...f, page: 1, ...next };
    setParams(
      {
        q: g.q || undefined,
        band: g.band || undefined,
        country: g.country || undefined,
        sort: g.sort !== "last" ? g.sort : undefined,
        page: g.page > 1 ? String(g.page) : undefined,
      },
      false,
    );
  };

  const all = list.data?.rows || [];
  const rows = crmRows(all, f);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const page = Math.min(f.page, pages);
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const countries = crmCountries(all);
  const current = open ? all.find((c) => c.phoneKey === open) || null : null;

  const exportCsv = () => {
    if (!rows.length) return toast("Nothing to export");
    downloadCsv("customers.csv", crmCsv(rows));
    toast("Exported " + plural(rows.length, "customer"), true);
  };

  const show = (key: string) => setParams({ open: key || undefined });

  return (
    <>
      <div class="toolbar" role="search" aria-label="Filter customers">
        <SearchField value={qText} onInput={setQText} label="Search customers" placeholder="Search name, phone, note or tag…" />
        <Select label="Band" value={f.band} onChange={(band) => update({ band })} options={[{ value: "", label: "Any band" }, ...BANDS.map((b) => ({ value: b.id, label: b.label }))]} />
        <Select label="Country" value={f.country} onChange={(country) => update({ country })} options={[{ value: "", label: "Any country" }, ...countries.map((c) => ({ value: c, label: COUNTRY_EN[c] || c }))]} />
        <Select label="Sort by" value={f.sort} onChange={(sort) => update({ sort: sort as CrmSort })} options={SORTS} />
        <Btn sm icon="download" onClick={exportCsv} label="Export these customers as CSV">
          CSV
        </Btn>
      </div>

      <section class="card flush" aria-label="Customers">
        <div class="tablewrap">
          <table class="tbl crm-tbl" aria-busy={list.loading ? "true" : "false"}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th class="hide-sm">Country</th>
                <th class="num">Orders</th>
                <th class="num">
                  Spend <small>OMR</small>
                </th>
                <th class="hide-sm">First order</th>
                <th class="hide-sm">Last order</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const b = bandOf(c.spend);
                return (
                  <tr key={c.phoneKey} class="row" data-cust={c.phoneKey} onClick={() => show(c.phoneKey)}>
                    <td class="crm-who">
                      <button type="button" class="crm-name" dir="auto" aria-label={"Open " + (c.name || c.phone || "customer")} onClick={(e) => (e.stopPropagation(), show(c.phoneKey))}>
                        {c.name || "—"}
                      </button>
                      {b.id !== "low" || c.tags.length ? (
                        <span class="pills">
                          {b.id !== "low" ? <Pill tone={"rank-" + b.id}>{b.label}</Pill> : null}
                          {c.tags.map((t) => (
                            <Pill key={t} tone="muted">
                              {t}
                            </Pill>
                          ))}
                        </span>
                      ) : null}
                      {c.note ? (
                        <em class="sub" dir="auto">
                          {c.note}
                        </em>
                      ) : null}
                    </td>
                    <td class="num c-phone" dir="ltr">
                      {c.phone || "—"}
                    </td>
                    <td class="hide-sm">{c.countries.join(" ") || "—"}</td>
                    <td class="num c-orders">
                      {c.orders}
                      {c.live !== c.orders ? <em class="sub">{c.live} live</em> : null}
                    </td>
                    <td class="num c-spend">{omr(c.spend)}</td>
                    <td class="hide-sm num">{dt(c.first)}</td>
                    <td class="hide-sm num">{dt(c.last)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!shown.length ? (
          <Empty>{list.error ? "Could not read the customers: " + explain(list.error) : list.loading && !list.data ? "Loading…" : all.length ? "Nobody matches these filters." : "No customers yet. Built from orders."}</Empty>
        ) : null}
        {list.data?.capped ? <p class="note warn">The 10,000 most recent customers only.</p> : null}
        <Pager offset={(page - 1) * PER_PAGE} limit={PER_PAGE} total={rows.length} onPage={(off) => setParams({ page: off ? String(off / PER_PAGE + 1) : undefined })} />
      </section>
      {current ? <CustomerDialog customer={current} onClose={() => show("")} /> : null}
    </>
  );
}
