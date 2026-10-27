/**
 * GET /invoice/LM-…?k=<invoice_key> — the customer's own copy of their order, rendered on
 * the server (port of the original invoice.js, same Arabic page).
 *
 * The key is the whole security model: without it anyone could walk the id range and read
 * every customer's name, items and total. Both the id AND the key must match, the key is
 * compared in constant time, and a wrong key returns exactly the same page as an id that
 * does not exist (or a binned order) — telling them apart is what turns guessing into
 * enumeration.
 *
 * Deliberately NOT on the page: the phone, the street address, the payment details. A
 * shopper forwarding their invoice should not be handing over their address.
 */
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { r3 } from "../../shared/money";
import type { Deps } from "../core/deps";
import { esc, pageHtml } from "../core/http";
import { orders } from "../db/schema";
import { isOrderId, isOrderKey } from "./intake";

/** Constant time, length first (a mismatch still spends one comparison); empty never matches. */
export function sameSecret(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a == null ? "" : a));
  const y = Buffer.from(String(b == null ? "" : b));
  if (!x.length || !y.length) {
    timingSafeEqual(x.length ? x : Buffer.from("-"), x.length ? x : Buffer.from("-"));
    return false;
  }
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** an invoice is personal: never stored in a shared cache, never framed, never indexed */
export const INVOICE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

const CSS = [
  "*{box-sizing:border-box;margin:0;padding:0}",
  "body{font-family:'IBM Plex Sans Arabic','Noto Sans Arabic',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
  "font-weight:300;background:#ededed;color:#1e1b18;line-height:1.9;padding:26px 18px 44px;",
  "max-width:480px;margin-inline:auto;-webkit-font-smoothing:antialiased}",
  ".card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 2px 20px rgba(30,27,24,.07)}",
  ".brand{font-family:Optima,Palatino,serif;font-size:21px;color:#dc7a47;text-align:center;margin-bottom:4px}",
  ".sub{text-align:center;font-size:12px;color:#4a443d;margin-bottom:22px}",
  "h1{font-size:15px;font-weight:400;margin-bottom:16px}",
  // label one side, value the other; the value never wraps mid-amount
  ".row{display:flex;justify-content:space-between;align-items:baseline;",
  "gap:14px;font-size:13px;margin-bottom:9px;color:#4a443d}",
  ".row > span{flex:0 0 auto}",
  ".row > b{font-weight:400;color:#1e1b18;min-width:0;text-align:end;",
  "overflow-wrap:break-word}",
  ".it{display:flex;justify-content:space-between;align-items:baseline;",
  "gap:14px;font-size:13px;padding:11px 0;border-bottom:1px solid #eee}",
  ".it > span{color:#4a443d;flex:1 1 auto;min-width:0}",
  ".it > b{flex:0 0 auto;font-weight:400}",
  ".it-txt{display:flex;flex-direction:column;gap:3px;min-width:0}",
  ".it-name{color:#1e1b18}",
  ".it-name em{font-style:normal;color:#4a443d;white-space:nowrap}",
  ".it-sub{font-size:11.5px;line-height:1.6;color:#4a443d}",
  ".tot{display:flex;justify-content:space-between;align-items:baseline;",
  "margin-top:16px;padding-top:16px;border-top:1px solid #ddd}",
  ".tot b{font-size:22px;font-weight:500}",
  // an amount is one unit: not split by a line break, not reordered by the RTL paragraph
  ".amt{white-space:nowrap;unicode-bidi:isolate;direction:ltr;display:inline-block}",
  ".pill{display:inline-block;font-size:11.5px;padding:3px 10px;border-radius:100px;background:#e8f0ea;color:#26573b}",
  ".foot{text-align:center;font-size:12px;color:#4a443d;margin-top:22px;line-height:1.8}",
  ".foot a{color:#7a611f}",
  ".miss{text-align:center;padding:40px 0}",
  ".miss p{font-size:13.5px;color:#4a443d;margin-top:8px}",
].join("");

const HEAD = '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>' + CSS + "</style>";

/** the three-decimal currencies keep their baisa/fils; the rest are whole */
export function money(n: unknown, cur: unknown): string {
  const v = Number(n) || 0;
  const s = ["OMR", "BHD", "KWD"].indexOf(String(cur || "").toUpperCase()) > -1 ? v.toFixed(3).replace(/\.?0+$/, "") : String(Math.round(v));
  return '<span class="amt">' + s + " " + esc(cur || "") + "</span>";
}

/** One page for "no such order", "wrong key" and "binned". */
export function notFoundPage(): string {
  return pageHtml(
    "الفاتورة غير متاحة",
    HEAD,
    '<div class="card miss"><div class="brand">Luban &amp; Musk</div>' +
      "<h1>لم نجد هذه الفاتورة</h1>" +
      "<p>تأكد من الرابط كما وصلك، أو راسلنا وسنرسله لك من جديد.</p>" +
      '<p class="foot"><a href="https://wa.me/96876655565">تواصل معنا على واتساب</a></p></div>',
  );
}

export interface InvoiceOrder {
  id: string;
  createdAt: Date;
  name: string | null;
  items: Array<{ scent?: unknown; size?: unknown; price?: unknown; qty?: unknown }>;
  cur: string;
  ship: number;
  total: number;
  pay: string;
  paymentStatus: string;
  status: string;
  refunded: boolean;
}

/** The page itself (exported for tests). */
export function invoicePage(o: InvoiceOrder): string {
  const items = (o.items || [])
    .map((i) => {
      const qty = Number(i.qty) || 1;
      return (
        '<div class="it"><span class="it-txt">' +
        '<span class="it-name">' + esc(i.scent) + " <em>×&nbsp;" + qty + "</em></span>" +
        (i.size ? '<span class="it-sub">' + esc(i.size) + "</span>" : "") +
        "</span><b>" + money((Number(i.price) || 0) * qty, o.cur) + "</b></div>"
      );
    })
    .join("");

  const paid = o.paymentStatus === "paid";
  // THE CASH-HANDLING FEE: what a cash total holds beyond the lines and the delivery, shown
  // when positive — otherwise the lines and the total do not add up.
  const lineSum = (o.items || []).reduce((t, i) => t + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const codFee = o.pay === "cod" ? r3((Number(o.total) || 0) - lineSum - (Number(o.ship) || 0)) : 0;

  // where the payment STANDS, not just how it was chosen
  const pill = paid
    ? "مدفوع"
    : o.paymentStatus === "refunded" || o.refunded
      ? "مسترد"
      : o.status === "void"
        ? "ملغي"
        : o.pay === "card"
          ? "بانتظار الدفع"
          : "عند الاستلام";
  const when = o.createdAt.toLocaleDateString("ar-AE", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Muscat" });

  return pageHtml(
    "فاتورة " + o.id,
    HEAD,
    '<div class="card">' +
      '<div class="brand">Luban &amp; Musk</div>' +
      '<div class="sub">لبان صلالة معطر</div>' +
      "<h1>فاتورة الطلب</h1>" +
      '<div class="row"><span>رقم الطلب</span><b dir="ltr">' + esc(o.id) + "</b></div>" +
      // the name exactly as typed, in full; its own direction
      '<div class="row"><span>الاسم</span><b dir="auto">' + esc(o.name || "—") + "</b></div>" +
      '<div class="row"><span>التاريخ</span><b>' + esc(when) + "</b></div>" +
      '<div class="row"><span>الدفع</span><b>' +
      (o.pay === "card" ? "بطاقة الخصم المباشر" : o.pay === "transfer" ? "تحويل بنكي" : "الدفع عند الاستلام") +
      ' <span class="pill">' + pill + "</span></b></div>" +
      '<div style="margin-top:18px">' + (items || '<div class="it"><span>—</span></div>') + "</div>" +
      '<div class="row" style="margin-top:14px"><span>الشحن</span><b>' + (Number(o.ship) ? money(o.ship, o.cur) : "مجاني") + "</b></div>" +
      (codFee > 0 ? '<div class="row"><span>رسوم الدفع عند الاستلام</span><b>' + money(codFee, o.cur) + "</b></div>" : "") +
      '<div class="tot"><span>الإجمالي</span><b>' + money(o.total, o.cur) + "</b></div>" +
      "</div>" +
      '<p class="foot">شكرا لثقتك بنا 🌿<br>' +
      'لأي استفسار <a href="https://wa.me/96876655565">راسلنا على واتساب</a></p>',
  );
}

/** → { status, html }: 200 with the invoice, or 404 with the one not-found page. */
export async function renderInvoice(deps: Pick<Deps, "db">, rawId: string, key: unknown): Promise<{ status: 200 | 404; html: string }> {
  const missing = { status: 404 as const, html: notFoundPage() };
  let id: string;
  try {
    id = decodeURIComponent(String(rawId || "")).toUpperCase();
  } catch {
    return missing; // "%E0" and friends
  }
  const k = String(key == null ? "" : key);
  if (!isOrderId(id) || !isOrderKey(k)) return missing;
  let o;
  try {
    const rows = await deps.db
      .select({
        id: orders.id,
        createdAt: orders.createdAt,
        name: orders.name,
        items: orders.items,
        cur: orders.cur,
        ship: orders.ship,
        total: orders.total,
        pay: orders.pay,
        paymentStatus: orders.paymentStatus,
        status: orders.status,
        refunded: orders.refunded,
        invoiceKey: orders.invoiceKey,
        trashed: orders.trashed,
      })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);
    o = rows[0];
  } catch {
    return missing;
  }
  if (!o || o.trashed || !sameSecret(o.invoiceKey, k)) return missing;
  return { status: 200, html: invoicePage(o as InvoiceOrder) };
}
