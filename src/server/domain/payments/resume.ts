/**
 * /resume/LM-…?k=<invoice_key>          pay by card
 * /resume/LM-…?k=<invoice_key>&cod=1    switch to cash on delivery
 *
 * The two ways back into an abandoned order, from one link in a WhatsApp reminder. A
 * Thawani session lives an hour; this link mints a FRESH session when it is used, so it works
 * for as long as the order does.
 *
 * OPENING THE LINK CHANGES NOTHING. A messenger fetches every pasted link to draw its preview
 * card, so a GET may be a machine: it is shown a page. The action is a POST from that page —
 * for the card the page sends itself on at once by script (a previewer runs none); for cash
 * the page shows what the courier will collect and the customer taps to confirm.
 *
 * Authorisation is the order's invoice_key (the /invoice secret), compared in constant time;
 * a wrong key reads exactly like an unknown id. No figure is read from the request: the card
 * amount is the one recorded when the order was placed, the cash amount is re-priced from the
 * live catalogue. A paid order is answered with a page, never a second charge.
 */
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { decimalsOf, r3, toBaisa, baisaToOmr } from "../../../shared/money";
import { priceOrder, isRefusal, type Quote } from "../../../shared/pricing/price";
import type { ClientSignals, OrderLine } from "../../../shared/orders/types";
import type { Deps } from "../../core/deps";
import { esc, HttpError, pageHtml } from "../../core/http";
import { allow } from "../../core/ratelimit";
import { orders, type NewOrderRow, type OrderRow } from "../../db/schema";
import { loadCatalogue } from "../catalogue";
import { anyCap, inStockTx } from "../orders";
import { reportPurchase } from "../purchase";
import { enforceStock, readShelfForGate, type GateShelf } from "../stock";
import { clientSignals, isOrderId, ORDER_KEY, recordEvent, sameSecret, standing } from "./events";
import { MIN_BAISA, openSession, productsFor } from "./session";
import { readOrder } from "./verify";

export const WA = "https://wa.me/96876655565";

export type ResumeResult =
  | { kind: "html"; status: number; html: string }
  | { kind: "json"; status: number; body: Record<string, unknown> }
  | { kind: "redirect"; location: string };

export interface ResumeRequest {
  /** the path segment after /resume/, still URL-encoded */
  rawId: string;
  k: string;
  cod: boolean;
  lang: "ar" | "en";
  posted: boolean;
  wantsJson: boolean;
  ip: string;
  ua: string;
  origin: string;
}

const STYLE =
  "<style>" +
  "body{margin:0;background:#efece6;font:15px/1.9 system-ui,-apple-system,'Segoe UI',sans-serif;" +
  "color:#2b2622;display:grid;place-items:center;min-height:100vh;padding:24px}" +
  ".card{background:#fff;border-radius:18px;padding:34px 26px;max-width:420px;width:100%;" +
  "text-align:center;box-shadow:0 18px 50px -34px rgba(60,44,15,.5)}" +
  ".brand{font:600 15px/1 'Segoe UI',sans-serif;letter-spacing:.16em;color:#b8974f}" +
  "h1{font-size:19px;margin:18px 0 10px}p{color:#5c554d;margin:8px 0}" +
  "b{color:#2b2622}.ok{font-size:38px;line-height:1;margin-bottom:6px}" +
  "a.btn,button.btn{display:inline-block;margin-top:18px;background:#2b2622;color:#fff;text-decoration:none;" +
  "padding:13px 26px;border-radius:12px;font:inherit;font-size:14px;border:0;cursor:pointer}" +
  "</style>";

function page(title: string, body: string, status = 200): ResumeResult {
  return { kind: "html", status, html: pageHtml(title, STYLE, '<div class="card"><div class="brand">LUBAN &amp; MUSK</div>' + body + "</div>") };
}
const contact = (text?: string) => '<a class="btn" href="' + WA + '">' + (text || "تواصل معنا") + "</a>";

export function notFound(): ResumeResult {
  return page("غير متاح", "<h1>الرابط غير صالح</h1><p>تأكد من نسخ الرابط كاملا، أو راسلنا على واتساب.</p>" + contact(), 404);
}
function noAction(id: string): ResumeResult {
  return page("لا حاجة لأي إجراء",
    "<h1>لا حاجة لأي إجراء</h1><p>طلبك <b>" + esc(id) + "</b> لا يحتاج إلى دفع من هذا الرابط.</p><p>لأي استفسار راسلنا على واتساب.</p>" + contact());
}
function couldNot(text: string, status: number): ResumeResult {
  return page("تعذر التأكيد", "<h1>تعذر تأكيد الطلب</h1><p>" + text + "</p>" + contact(), status);
}
const amount = (n: unknown, cur: string) => (Number(n) || 0).toFixed(decimalsOf(cur)) + " " + cur;

/*
 * The card page posts by fetch, not by form: the site's CSP has form-action 'self', and
 * Chrome applies it to the 302 a form POST follows (to Thawani). The script asks for JSON
 * ({ url }) and goes there itself; any other answer (a page) is shown in place. The form
 * stays for a browser without fetch and for a tap after a failed try.
 */
const AUTO =
  '(function(){var f=document.getElementById("go"),m=document.getElementById("err"),busy=0;' +
  "function say(){busy=0;if(m)m.hidden=false}" +
  "function go(e){if(e&&e.preventDefault)e.preventDefault();if(busy)return;busy=1;if(m)m.hidden=true;" +
  'if(!window.fetch){document.getElementById("go").submit();return}' +
  'window.fetch.call(window,location.href,{method:"POST",credentials:"same-origin",headers:{Accept:"application/json"}})' +
  '.then(function(r){if(/json/.test(r.headers.get("Content-Type")||""))' +
  "return r.json().then(function(j){if(j&&j.url)location.href=j.url;else say()});" +
  "return r.text().then(function(h){document.open();document.write(h);document.close()})})" +
  '["catch"](say)}' +
  'f.addEventListener("submit",go);go()})()';

function confirmPage(title: string, body: string, button: string, auto: boolean): ResumeResult {
  return page(title, body + '<form id="go" method="post"><button class="btn" type="submit">' + esc(button) + "</button></form>" +
    (auto ? '<p id="err" hidden>تعذر فتح صفحة الدفع. اضغط ادفع الآن مرة أخرى.</p><script>' + AUTO + "</script>" : ""));
}

/** ONLY AN UNSETTLED ORDER CAN BE REOPENED: waiting for its card money, or cancelled for want of it. */
export function reopenable(o: OrderRow): boolean {
  return !o.refunded && o.paymentStatus !== "refunded" && (o.status === "pending" || o.status === "void") &&
    (o.paymentStatus === "unpaid" || o.paymentStatus === "cancelled" || (o.paymentStatus === "cod" && o.status === "void"));
}

/** The read's own conditions, again in the write: a payment landing in between wins. */
function stillOpen(id: string): SQL {
  return and(
    eq(orders.id, id), eq(orders.trashed, false), eq(orders.refunded, false), inArray(orders.status, ["pending", "void"]),
    or(inArray(orders.paymentStatus, ["unpaid", "cancelled"]), and(eq(orders.paymentStatus, "cod"), eq(orders.status, "void"))),
  )!;
}

/** The card figure — only an order that once had a card session has one. A card order that
 * became cash (fee included) and was then cancelled is rebuilt from its lines and delivery,
 * no fee, at its own rate. */
export function cardFigure(o: OrderRow): { totalLocal: number; totalBaisa: number; rate: number; wasCard: boolean } | null {
  const storedBaisa = Number(o.amountBaisa) || 0;
  const storedLocal = Number(o.total) || 0;
  if (storedBaisa < MIN_BAISA || storedLocal <= 0) return null;
  const wasCard = o.pay === "card";
  const rate = (Number(o.omr) || 0) / storedLocal;
  const totalLocal = wasCard ? storedLocal : r3((o.items || []).reduce((t, i) => t + (Number(i.price) || 0) * (Number(i.qty) || 1), 0) + (Number(o.ship) || 0));
  const totalBaisa = wasCard ? storedBaisa : toBaisa(totalLocal * rate);
  if (totalBaisa < MIN_BAISA || totalLocal <= 0) return null;
  return { totalLocal, totalBaisa, rate, wasCard };
}

const note = (was: string | null, add: string) => (was ? was + "\n" + add : add).slice(-2000);

export async function resume(deps: Deps, req: ResumeRequest): Promise<ResumeResult> {
  let id: string;
  try {
    id = decodeURIComponent(req.rawId || "").toUpperCase();
  } catch {
    return notFound(); // "%E0" and friends
  }
  const key = String(req.k || "");
  if (!isOrderId(id) || !ORDER_KEY.test(key)) return notFound();
  if (req.posted) {
    const rl = await allow(deps.db, "resume", req.ip, deps.now());
    if (!rl.ok) return page("حاول لاحقا", "<h1>محاولات كثيرة</h1><p>حاول مرة أخرى بعد قليل، أو راسلنا على واتساب.</p>" + contact(), 429);
  }

  let o: OrderRow | null;
  try {
    o = await readOrder(deps, id);
  } catch {
    return notFound();
  }
  // constant-time, and a wrong key is indistinguishable from a wrong id
  const keyOk = sameSecret(o ? o.invoiceKey : "0".repeat(32), key);
  if (!o || o.trashed || !keyOk) return notFound();

  // ---- already settled: never charge, never convert ----
  if (o.paymentStatus === "paid") {
    return page("تم الدفع", '<div class="ok">✅</div><h1>هذا الطلب مدفوع</h1><p>طلبك <b>' + esc(o.id) + "</b> مدفوع وجاري تجهيزه.</p><p>لا حاجة لأي إجراء.</p>");
  }
  if (o.paymentStatus === "cod" && o.status !== "void") {
    return page("تم التأكيد", '<div class="ok">✅</div><h1>طلبك مؤكد</h1><p>طلبك <b>' + esc(o.id) + "</b> مؤكد بالدفع عند الاستلام.</p><p>سنتواصل معك عند الشحن.</p>");
  }
  if (!reopenable(o)) return noAction(o.id);

  return req.cod ? toCash(deps, req, o) : toCard(deps, req, o);
}

/* ================= switch to cash on delivery ================= */
async function toCash(deps: Deps, req: ResumeRequest, o: OrderRow): Promise<ResumeResult> {
  let quote: Quote;
  let cfg;
  try {
    // the live catalogue or nothing, as at the till; an order already placed keeps its small box
    cfg = await loadCatalogue(deps, { live: true });
    quote = priceOrder(cfg, { countryCode: o.countryCode, items: (o.items || []).map((i) => ({ itemId: i.itemId, qty: i.qty })), pay: "cod", existing: true }, deps.now());
  } catch (e) {
    if (isRefusal(e) && e.code === "cod_not_offered") {
      return page("الدفع عند الاستلام غير متاح",
        "<h1>الدفع عند الاستلام غير متاح</h1><p>لم يعد الدفع عند الاستلام متاحًا في بلدك. يمكنك إتمام الدفع بالبطاقة من الرابط الآخر في الرسالة، أو راسلنا.</p>" + contact(), 409);
    }
    // an item that no longer prices: converting at the old total would promise what may not ship
    return couldNot("تغير توفر أحد المنتجات. راسلنا على واتساب ونكمله معك.", 409);
  }
  const feeLine = quote.codFee > 0 ? '<p style="font-size:13px;color:#8a8179">يشمل رسوم الدفع عند الاستلام.</p>' : "";

  if (!req.posted) {
    return confirmPage("تأكيد الدفع عند الاستلام",
      "<h1>تأكيد الطلب بالدفع عند الاستلام</h1><p>طلبك <b>" + esc(o.id) + "</b></p><p>المبلغ المستحق عند الاستلام: <b>" + esc(amount(quote.total, quote.cur)) + "</b></p>" + feeLine,
      "تأكيد الطلب", false);
  }

  const at = new Date(deps.now());
  const patch: Partial<NewOrderRow> = {
    pay: "cod", paymentStatus: "cod",
    // "new", as a cash order placed at the checkout; an auto-cancelled order is revived by the same write
    status: "new",
    items: quote.items as OrderLine[], cur: quote.cur, sub: quote.sub, ship: quote.ship, codFee: quote.codFee, total: quote.total,
    omr: quote.omr, omrRate: quote.omrRate,
    adminNote: note(o.adminNote, "Confirmed as cash on delivery from the reminder link"),
    updatedAt: at,
  };
  // (audit A14) the shelf's cap holds here as at the till — the order's own boxes set aside —
  // and the gate's read and the write are one step under the stock lock, as at the till
  const short = Symbol("short");
  // the shelf is read before the stock lock (no Omniful call while it is held)
  let shelf: GateShelf | null = null;
  if (anyCap(cfg)) {
    try {
      shelf = await readShelfForGate(deps, cfg, quote.country.code, quote.items);
    } catch {
      shelf = null; // a shelf that cannot be read refuses nothing
    }
  }
  let changed: OrderRow | null | typeof short = null;
  try {
    changed = await inStockTx(deps, anyCap(cfg), async (tx) => {
      try {
        await enforceStock(tx, cfg, quote.country.code, quote.items, { id: o.id, dedupeId: o.dedupeId }, tx.db, shelf);
      } catch (e) {
        if (e instanceof HttpError && e.code === "stock_short") return short;
        // a shelf that cannot be read refuses nothing
      }
      const rows = await tx.db.update(orders).set(patch).where(stillOpen(o.id)).returning();
      if (rows[0]) await recordEvent(tx.db, { orderId: o.id, kind: "payment", from: standing(o), to: standing(rows[0]), by: "shopper", at, detail: { via: "resume", cod: true, total: quote.total } });
      return rows[0] || null;
    });
  } catch (e) {
    await deps.log.error("resume", "could not confirm " + o.id + " as cash: " + String((e as Error)?.message || e), { orderId: o.id });
    return page("تعذر التأكيد", "<h1>تعذر تأكيد الطلب</h1><p>حاول مرة أخرى، أو راسلنا على واتساب.</p>" + contact(), 502);
  }
  if (changed === short) return couldNot("الكمية المتوفرة من أحد المنتجات أقل مما في طلبك. راسلنا على واتساب ونكمله معك.", 409);
  // paid (or otherwise settled) between the read and this write
  if (!changed) return noAction(o.id);

  // THE SALE: a card order never paid was never a Purchase; confirmed here as cash it is one.
  // One that was already cash (and cancelled) was reported when it was placed.
  if (o.pay === "card" && (o.paymentStatus === "unpaid" || o.paymentStatus === "cancelled")) {
    try {
      await reportPurchase(deps, changed, { ip: req.ip || undefined, ua: req.ua || undefined });
    } catch {
      /* measurement only */
    }
  }
  return page("تم التأكيد",
    '<div class="ok">✅</div><h1>تم تأكيد طلبك</h1><p>طلبك <b>' + esc(o.id) + "</b> مؤكد بالدفع عند الاستلام.</p>" +
    "<p>المبلغ المستحق عند الاستلام: <b>" + esc(amount(quote.total, quote.cur)) + "</b></p>" + feeLine + "<p>سنتواصل معك عند الشحن.</p>");
}

/* ===================== pay by card ===================== */
async function toCard(deps: Deps, req: ResumeRequest, o: OrderRow): Promise<ResumeResult> {
  if (!deps.services.thawani.configured()) return notFound();
  const fig = cardFigure(o);
  if (!fig) return notFound();

  if (!req.posted) {
    return confirmPage("متابعة الدفع",
      "<h1>متابعة الدفع</h1><p>طلبك <b>" + esc(o.id) + "</b> — المبلغ: <b>" + esc(amount(fig.totalLocal, o.cur)) + "</b></p>", "ادفع الآن", true);
  }

  const products = productsFor(o.items, o.ship, 0, fig.rate, fig.totalBaisa);
  if (!products.length) return notFound();
  let opened;
  try {
    // the name only: this page is reached by a link and reads no more of the customer than the invoice shows
    opened = await openSession(deps, { id: o.id, products, origin: req.origin, lang: req.lang, metadata: { customer: String(o.name || ""), resumed: "1" } });
  } catch {
    return page("تعذر فتح صفحة الدفع", "<h1>تعذر فتح صفحة الدفع</h1><p>حاول مرة أخرى بعد قليل، أو راسلنا على واتساب.</p>" + contact(), 502);
  }

  // Back to pending BEFORE the customer leaves, with the new session's invoice (so the
  // webhook's payment events find it) and expiry (so the 72-hour sweep leaves it alone).
  const at = new Date(deps.now());
  const reopen: Partial<NewOrderRow> = {
    status: "pending", paymentStatus: "unpaid", pay: "card",
    sessionId: opened.sessionId, invoiceNo: opened.invoice,
    expireAt: opened.expireAt && Number.isFinite(Date.parse(opened.expireAt)) ? new Date(opened.expireAt) : null,
    adminNote: note(o.adminNote, "Payment reopened from the reminder link"),
    updatedAt: at,
  };
  // the card figures for an order coming back from cash: amount_baisa is what the charge is held to
  if (!fig.wasCard) {
    reopen.total = fig.totalLocal;
    reopen.omr = baisaToOmr(fig.totalBaisa);
    reopen.amountBaisa = fig.totalBaisa;
    reopen.codFee = 0;
  }
  // the browser that reopened the payment is the one the Purchase is matched to
  const had = (o.client || {}) as ClientSignals;
  if (!had.ip || !fig.wasCard) reopen.client = { ...had, ...clientSignals({ ip: req.ip, ua: req.ua }, null, req.origin + "/resume") };

  let changed: OrderRow | null | undefined;
  try {
    changed = await deps.db.transaction(async (tx) => {
      const rows = await tx.update(orders).set(reopen).where(stillOpen(o.id)).returning();
      if (rows[0]) await recordEvent(tx, { orderId: o.id, kind: "payment", from: standing(o), to: standing(rows[0]), by: "shopper", at, detail: { via: "resume", session: opened.sessionId } });
      return rows[0] || null;
    });
  } catch (e) {
    // the session is live; a failed note must not block it
    await deps.log.error("resume", "the reopened session was not recorded on " + o.id + ": " + String((e as Error)?.message || e), { orderId: o.id });
    changed = undefined;
  }
  // answered, and nothing matched: paid (or settled) while the session was opening — the unused
  // session simply expires; sending the shopper to it would be a second charge
  if (changed === null) return noAction(o.id);

  const url = deps.services.thawani.payUrl(opened.sessionId, req.origin);
  if (req.wantsJson) return { kind: "json", status: 200, body: { ok: true, url } };
  return { kind: "redirect", location: url };
}
