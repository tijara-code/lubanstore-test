/**
 * LUBAN & MUSK — checkout (the port of assets/js/checkout.js).
 *
 * The summary, the form (per-market phone rules, the cities), the ways to pay, the cash
 * order (POST /api/order, parked on a network failure), the card order (POST
 * /api/pay/session → Thawani), the return from Thawani (?paid= → /api/pay/verify, ?cancelled=),
 * the done screen and every refusal's words. The delivery bar above the form is the
 * header module's (window.lmShip); the drawer's dialog is the cart module's (window.lmCart).
 */
import { LM } from "../core";
import { LM_CITIES } from "../core/cities";
import type { CartLine } from "../core/types";
import { G, KEY, TRASH, writeCart } from "./contracts";
import { FIRST, PHONE, keepName, keepPhone, leadBad as leadBadOf, phoneDigits as digitsOf, type PhonePlan } from "./phone";

type Vars = Record<string, string | number>;
interface Answer {
  ok?: boolean;
  id?: string;
  omr?: number;
  queued?: boolean;
  already?: boolean;
  [k: string]: unknown;
}
interface Refusal extends Error {
  refused?: boolean;
  item?: string | null;
  left?: unknown;
  wait?: string | null;
}
export interface OrderBody {
  id: string;
  date: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  countryCode: string;
  city: string;
  region: string;
  note: string;
  pay: string;
  items: Array<{ scent: unknown; size: unknown; price: number; qty: number; itemId: string }>;
  cur: string;
  ship: number;
  codFee: number;
  total: number;
  omr: number;
  omrRate: number;
  dedupeId: string;
  snap: unknown;
  ref: unknown;
  pageUrl: string;
  lang: string;
  status: string;
  sid?: string;
}

const L = (s: string, v?: Vars): string => LM.L(s, v);
const $ = <E extends HTMLElement = HTMLElement>(s: string): E => document.querySelector(s) as E;
const esc = (v: unknown): string => LM.esc(v);
/* digits render as Latin (0-9); one place to change that */
const toAr = (n: unknown): string => String(n);
const money = (n: number): string => LM.money(n);
const unit = (it: CartLine): number => LM.price(it.sizeId);

/* The packshot follows the size, and the scent rides in the corner as a small coloured
   chip. An add-on with no photograph gets its DRAWING (no greying here: in the summary the
   cluster is a picture of a product, not a question about what to try). */
function thumb(it: CartLine): string {
  const IMG = LM.root + "assets/img/";
  const name = LM.imgFor(it);
  if (!name) {
    const x = LM.extraOf(it);
    const art = x ? LM.extraArt(x) : "";
    return '<span class="thumb thumb-none" aria-hidden="true">' + art + "</span>";
  }
  const mark = LM.lineMark(it);
  return (
    '<span class="thumb">' +
    '<picture><source srcset="' + IMG + name + "-sm.avif" + LM.v + '" type="image/avif">' +
    '<source srcset="' + IMG + name + "-sm.webp" + LM.v + '" type="image/webp">' +
    '<img src="' + IMG + name + "-sm.jpg" + LM.v + '" alt="" loading="lazy" decoding="async" width="58" height="58"></picture>' +
    mark + "</span>"
  );
}

/* Does this basket travel free? The till's reading exactly: over a threshold when there is
   one; with no threshold, only while a free-delivery offer at 0 runs. */
function freeHere(amount: number): boolean {
  const fo = LM.freeOver();
  return fo > 0 ? amount >= fo : !!LM.freeDeal();
}

/* What the line cost before the offer, for the whole line (unit × qty, like the figure
   beneath it); 0 when there is nothing to strike through. */
function lineWas(it: CartLine): number {
  if (!LM.lineOffered(it)) return 0; /* v447, as the saving */
  const was = Number(LM.was(it.sizeId)) || 0;
  return was > LM.price(it.sizeId) ? was * it.qty : 0;
}

/* card is the default: no fee on the first render, so the first total is the lowest */
let cart: CartLine[] = [];
let pay = "card";
/* (v336) a box the till said is short: { item, left } (the line is marked) */
let shortBox: { item: string; left: number } | null = null;

let country: HTMLSelectElement;
let dial: HTMLElement | null;
let city: HTMLSelectElement | HTMLInputElement;
let phoneEl: HTMLInputElement | null;

/* (v336) the <head> script marks the page before it paints (co-wait / co-none / co-back);
   lifted once this module has set the real state */
function settle(): void {
  try {
    const h = document.documentElement;
    h.className = h.className.replace(/(^|\s)co-(wait|none|back|paid)(?=\s|$)/g, "");
  } catch {
    /* nothing to lift */
  }
}

function badge(): void {
  const el = document.querySelector<HTMLElement>("#cartCount");
  if (!el) return;
  const n = cart.reduce((t, i) => t + i.qty, 0);
  el.textContent = toAr(n);
  el.hidden = n === 0;
  const ic = document.querySelector(".cart");
  if (ic) ic.classList.toggle("filled", n > 0);
}

function items(): void {
  const box = $("#items");
  box.innerHTML = "";
  cart.forEach((it, i) => {
    const r = document.createElement("div");
    /* marked as soon as the country changes (items() runs on lm:country) */
    const off = !LM.lineOffered(it);
    r.className = "sum-item" + (off ? " sum-off" : "") + (shortBox && LM.itemId(it) === shortBox.item ? " sum-short" : "");
    /* Was above, is below: the offer legible per item */
    const was = lineWas(it);
    /* named from the catalogue as it is now, in the page's language */
    const nm = LM.lineLabel(it);
    r.innerHTML =
      thumb(it) +
      '<div><div class="n">' + esc(nm.scent) + "</div>" +
      /* an offer's line is its mix: a "× 1" after it read as one more of the last scent (v305) */
      '<div class="m">' +
      (off
        ? LM.offWords(it)
        : LM.isTier(it.sizeId)
          ? esc(nm.size) + (it.qty > 1 ? " · " + L("{n} عروض", { n: toAr(it.qty) }) : "")
          : esc(nm.size) + " × " + toAr(it.qty)) +
      "</div></div>" +
      '<button type="button" class="si-del" data-rm="' + i + '" aria-label="' + L("حذف") + '">' + TRASH + "</button>" +
      '<div class="p">' +
      /* (v336) a line that cannot be bought here has no price: out of the totals */
      (off ? "" : (was ? '<span class="was">' + LM.moneyHTML(was) + "</span>" : "") + '<span class="now">' + LM.moneyHTML(unit(it) * it.qty) + "</span>") +
      "</div>";
    box.appendChild(r);
  });

  Array.prototype.forEach.call(box.querySelectorAll("[data-rm]"), (a: HTMLElement) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      cart.splice(+(a.getAttribute("data-rm") as string), 1);
      writeCart(cart);
      if (!cart.length) {
        location.reload();
        return;
      }
      items();
      totals();
      badge();
    });
  });
}

function totals(): void {
  /* before the arithmetic: a COD choice a market does not offer is moved to card here */
  applyCodOffer();
  const sub = cart.reduce((t, i) => t + (!LM.lineOffered(i) ? 0 : unit(i) * i.qty), 0);
  /* samples are charged but do not count toward free delivery — LM.freeSub, the till's rule */
  const ship = freeHere(LM.freeSub(cart, unit)) || LM.setFree(cart) ? 0 : LM.ship();
  const cod = pay === "cod" ? LM.cod() : 0;
  /* The saving on this basket, against the catalogue reference prices. Display only. */
  let saved = cart.reduce((t, i) => {
    /* v447: a line this market cannot buy is out of the subtotal, so out of the saving */
    if (!LM.lineOffered(i)) return t;
    const was = Number(LM.was(i.sizeId)) || 0;
    const now = unit(i);
    return t + (was > now ? (was - now) * i.qty : 0);
  }, 0);

  /* The subtotal is the basket at the ORIGINAL prices, so the column adds up as written */
  $("#sub").innerHTML = LM.moneyHTML(sub + saved);
  /* (v414) struck through when there is an offer */
  $("#sub").classList.toggle("was", saved > 0);
  /* (v414) free delivery is a saving too: the fee is struck beside "مجاني" and counted */
  const shipFee = ship ? 0 : LM.ship();
  saved += shipFee;
  const savedRow = document.querySelector<HTMLElement>("#savedRow");
  const savedVal = document.querySelector<HTMLElement>("#saved");
  if (savedRow && savedVal) {
    savedRow.style.display = saved > 0 ? "flex" : "none";
    savedVal.innerHTML = saved > 0 ? "− " + LM.moneyHTML(saved) : "";
  }

  $("#ship").innerHTML = ship ? LM.moneyHTML(ship) : L("مجاني");
  $("#ship").classList.toggle("free", !ship);
  /* (v414) "مجاني" stays for screen readers when the struck fee says it on the screen */
  $("#ship").classList.toggle("sr-only", !ship && shipFee > 0);
  const shipWas = document.querySelector<HTMLElement>("#shipWas");
  if (shipWas) {
    shipWas.innerHTML = shipFee ? LM.moneyHTML(shipFee) : "";
    shipWas.hidden = !shipFee;
  }
  $("#codRow").style.display = cod ? "flex" : "none";
  $("#cod").innerHTML = LM.moneyHTML(cod);
  $("#total").innerHTML = LM.moneyHTML(sub + ship + cod);
  $("#totalNote").textContent = L("جميع المدفوعات تخصم بالريال العماني");

  const grand = sub + ship + cod;
  const omani = LM.c.cur === "OMR";
  /* On the Omani page this figure IS the rial (its mark); elsewhere the currency is spelled
     out beside the ≈ OMR figure the card is charged. textContent there: a currency code out
     of the catalogue never reaches the parser. */
  if (omani) $("#hlLocal").innerHTML = LM.moneyHTML(grand);
  else $("#hlLocal").textContent = money(grand);
  $("#hlOmr").textContent = omani ? "" : LM.omr(grand);
  $("#payHl").classList.toggle("same", omani);
  /* (v437) on a phone the amount-due row is gone (v434): the difference sits under the note */
  const fx = document.querySelector<HTMLElement>("#sumFx");
  if (fx) {
    $("#sumFxV").textContent = omani ? "" : money(grand) + " ≈ " + LM.omr(grand);
    fx.hidden = omani;
  }
  /* (v405) the notes beside the ways to pay only when cash costs more */
  const codFee = document.querySelector<HTMLElement>('[data-pay="cod"] em');
  const cardFree = document.querySelector<HTMLElement>('[data-pay="card"] em');
  const feeNow = LM.cod();
  if (codFee) {
    codFee.innerHTML = feeNow ? "+ " + LM.moneyHTML(feeNow) : "";
    codFee.hidden = !feeNow;
  }
  /* (v437) and "مجانا" only where cash is offered at all */
  if (cardFree) {
    cardFree.textContent = L("مجانا");
    cardFree.hidden = !feeNow || !LM.codOn();
  }
  const g = G();
  if (g.lmShip) g.lmShip(0);
}

/* ----------------------------------------------------------
   Keep each field to the kind of data it is for: filtering as they type beats rejecting on
   submit.
   ---------------------------------------------------------- */
function restrict(el: HTMLInputElement | null, keep: (v: string) => string): void {
  if (!el) return;
  const fix = (): void => {
    const was = el.value;
    const now = keep(was);
    if (now === was) return;
    const at = el.selectionStart as number;
    el.value = now;
    try {
      el.setSelectionRange(Math.max(0, at - (was.length - now.length)), Math.max(0, at - (was.length - now.length)));
    } catch {
      /* not a text field */
    }
  };
  el.addEventListener("input", fix);
  el.addEventListener("blur", () => {
    el.value = el.value.trim();
  });
}

/* the cities each market ships to, keyed by dial code (core/cities, shared with the panel) */
const CITIES: Record<string, string[]> = window.LM_CITIES || LM_CITIES;

const dcNow = (): string => (country ? String(country.value || "") : "");
function phoneDigits(): string {
  const el = document.getElementById("phone") as HTMLInputElement | null;
  if (!el) return "";
  return digitsOf(el.value, dcNow());
}
const leadBad = (p: PhonePlan | undefined, dc: string): boolean => leadBadOf(phoneDigits(), p, dc);
/** "7 أو 9", "3 أو 5 أو 6 أو 7" */
function orList(digits: string): string {
  return digits.split("").reduce((a, b) => L("{a} أو {b}", { a, b }));
}

/* "3/8" beside the box: muted while empty, red under or over the market's length, green on it */
function paintTelCount(): void {
  const el = document.getElementById("telCount");
  if (!el) return;
  const p = PHONE[country ? country.value : ""];
  if (!p || !p.len) {
    el.hidden = true;
    return;
  }
  const n = phoneDigits().length;
  /* (v414) right only when the length AND the first digit are */
  const lead = leadBad(p, dcNow());
  const good = n === p.len && !lead;
  el.hidden = false;
  el.textContent = n + "/" + p.len;
  el.classList.toggle("ok", n === p.len);
  el.classList.toggle("bad", n > 0 && n !== p.len);
  if (lead) {
    el.classList.remove("ok");
    el.classList.add("bad");
  }
  /* (v404) and the note under it, in the same colours */
  const note = document.getElementById("telNote");
  if (note) {
    const err = document.getElementById("phoneErr");
    const w = good
      ? L("رقم صحيح") + " ✓"
      : lead
        ? L("يبدأ رقم الجوال هنا بـ {d}.", { d: orList(FIRST[country.value]!) })
        : L("أدخل رقمًا صحيحًا");
    if (note.textContent !== w) note.textContent = w;
    note.classList.toggle("ok", good);
    note.classList.toggle("bad", n > 0 && !good);
    note.hidden = !!(err && !err.hidden);
  }
  /* v315: a complete number joins the measurement of this checkout (hashed, this tab only) */
  const px = G().LMPX;
  if (good && px && px.notePhone) px.notePhone("+" + country.value + phoneDigits());
}

function phoneSay(msg: string): void {
  const el = document.getElementById("phoneErr");
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
  /* (v404) the error speaks for the number: the note steps aside */
  const note = document.getElementById("telNote");
  if (note && msg) note.hidden = true;
  else if (note && !msg) paintTelCount();
}

/* (v336) WHAT IS WRONG WITH THE NUMBER, or "": another market's dial code pasted in front,
   or a length that is not this market's. A market missing from PHONE keeps the 7-15 range. */
function phoneProblem(): string {
  const dc = dcNow();
  const raw = phoneEl ? phoneEl.value.replace(/\D/g, "").replace(/^0+/, "") : "";
  for (const k in PHONE) {
    if (!PHONE[dc] || !Object.prototype.hasOwnProperty.call(PHONE, k) || k === dc || raw.indexOf(k) !== 0) continue;
    if (raw.slice(k.length).replace(/^0+/, "").length === PHONE[k]!.len) {
      return L("هذا الرقم بمفتاح +{d}. اختر دولته أو اكتب رقمًا محليًا.", { d: k });
    }
  }
  const n = phoneDigits().length;
  const p = PHONE[dc];
  if (p && p.len) {
    /* (v414) the market's length, but no mobile there begins so */
    if (n === p.len && leadBad(p, dc)) return L("يبدأ رقم الجوال هنا بـ {d}.", { d: orList(FIRST[dc]!) });
    return n === p.len ? "" : L("رقم الجوال هنا من {n} أرقام.", { n: p.len, count: p.len });
  }
  return n < 7 || n > 15 ? L("تأكد من رقم الجوال.") : "";
}

/* Countries whose second address line is a governorate rather than a city. Only the label
   and the placeholder change; the value still travels as `city`. */
let GOV: Record<string, { label: string; hint: string }> = {};

/* Catalogue strings reach innerHTML from here, and the catalogue is editable — esc. */
function fillCountries(): void {
  country.innerHTML = LM.countries()
    .map(
      (c) =>
        '<option value="' + esc(c.dial) + '" data-code="' + esc(c.code) + '"' + (c.code === LM.c.code ? " selected" : "") + ">" +
        (c.flag ? esc(c.flag) + " " : "") + esc(LM.txt(c, "name")) + "</option>",
    )
    .join("");
}
/* A MARKET WITH NO CITY LIST gets a box to type in (a select holding only its placeholder
   was called empty by the submit check, every time). True when the box is the typed kind. */
function cityField(typed: boolean): boolean {
  const want = typed ? "INPUT" : "SELECT";
  if (city.tagName !== want && city.parentNode) {
    const el = document.createElement(want.toLowerCase()) as HTMLInputElement | HTMLSelectElement;
    el.id = "city";
    el.setAttribute("autocomplete", "address-level2");
    if (typed) {
      (el as HTMLInputElement).type = "text";
      (el as HTMLInputElement).placeholder = L("اكتب اسم المدينة");
    }
    city.parentNode.replaceChild(el, city);
    city = el;
  }
  return city.tagName === "INPUT";
}
function fillCities(): void {
  const list = CITIES[country.value] || [];
  let g: { label: string; hint: string } | null = GOV[country.value] || null;
  if (cityField(!list.length)) g = null;
  /* THE VALUE STAYS ARABIC (what the courier's label and the panel read); only the words the
     shopper chooses from are English. */ else
    city.innerHTML =
      '<option value="">' + (g ? g.hint : L("اختر المدينة")) + "</option>" +
      list.map((c) => '<option value="' + c + '">' + L(c) + "</option>").join("");
  /* the label follows the list */
  const lab = document.querySelector('label[for="city"]');
  if (lab) lab.textContent = g ? g.label : L("المدينة");
}
/* The placeholder is the only place the form says how long a number should be: this
   market's answer. A HINT, no maxlength (a cap cannot be argued with). */
function syncPhone(): void {
  const el = document.getElementById("phone") as HTMLInputElement | null;
  if (!el) return;
  const p = PHONE[country.value];
  el.placeholder = p ? p.hint : "";
  el.removeAttribute("maxlength");
  el.style.borderColor = "";
  /* the phone's mark is drawn on its .tel box (v202) */
  const box = el.closest ? (el.closest(".tel") as HTMLElement | null) : null;
  if (box) box.style.borderColor = "";
  el.removeAttribute("aria-invalid");
  paintTelCount();
}
function syncCountry(): void {
  if (dial) dial.textContent = "+" + country.value;
  fillCities();
  syncPhone();
}

/* wired up in the LM.ready handler — LM.cfg isn't loaded before */
function initCountry(): void {
  if (!country) return;
  fillCountries(); // picks up the country chosen on the product page
  syncCountry();
  country.addEventListener("change", () => {
    /* GUARDED: `change` is not only fired by a person — an in-app browser's autofill fires
       it on an empty list (selectedIndex -1), which threw here (Instagram, iOS) */
    const opt = country.options[country.selectedIndex];
    syncCountry();
    if (opt && opt.dataset && opt.dataset.code) {
      LM.setCountry(opt.dataset.code); // fires lm:country
    }
    totals();
  });
  window.addEventListener("lm:country", () => {
    fillCountries();
    syncCountry();
    items();
    totals();
  });
}

function choosePay(which: string): void {
  pay = which;
  Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), (x: HTMLElement) => {
    x.setAttribute("aria-checked", String(x.getAttribute("data-pay") === which));
  });
}

/* A market with cash on delivery switched off does not get the button — and a choice
   already made moves to card. */
function applyCodOffer(): void {
  const btn = document.querySelector<HTMLElement>('[data-pay="cod"]');
  if (!btn) return;
  const on = LM.codOn();
  btn.hidden = !on;
  /* (v437) the card is then the last way to pay, and loses its line */
  $("#pays").classList.toggle("no-cod", !on);
  if (!on && pay === "cod") choosePay("card");
}

/* shared "order placed" screen. (v336) parked: the server has not said yes yet — the
   shopper is told it is received and will be confirmed. */
function finish(order: { id: string }, parked?: boolean): void {
  $("#orderNo").textContent = order.id;
  const head = document.querySelector<HTMLElement>("#doneHead");
  if (head && parked) head.textContent = L("استلمنا طلبك وسنؤكده قريبًا");
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  cart = [];
  $("#co").style.display = "none";
  $("#done").style.display = "block";
  badge();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* (v443) THE WAIT BEFORE THE GATEWAY: a note under the button counts fifteen seconds down
   while the session is made. (v444) The note only: the shopper goes to Thawani the moment
   the session is ready. */
const PAY_WAIT_S = 15;
let payWaitTimer = 0;
function payWait(): void {
  const box = document.querySelector<HTMLElement>("#payWait");
  const n = document.querySelector<HTMLElement>("#payWaitN");
  let left = PAY_WAIT_S;
  clearInterval(payWaitTimer);
  if (n) n.textContent = String(left);
  if (box) box.hidden = false;
  payWaitTimer = window.setInterval(() => {
    left -= 1;
    if (n) n.textContent = String(Math.max(left, 0));
    if (left <= 0) clearInterval(payWaitTimer);
  }, 1000);
}
function payWaitStop(): void {
  clearInterval(payWaitTimer);
  const box = document.querySelector<HTMLElement>("#payWait");
  if (box) box.hidden = true;
}

/* ----------------------------------------------------------
   Card: open a Thawani session and hand the shopper over. The cart is deliberately NOT
   cleared yet — if they cancel or the gateway errors, they come back to an intact basket.
   ---------------------------------------------------------- */
function payByCard(order: OrderBody, btn: HTMLButtonElement | null): void {
  if (btn) {
    btn.classList.remove("ok-go");
    btn.disabled = true;
    btn.textContent = L("جار تحويلك للدفع…");
  }
  payWait();

  /* keep the order so the return trip can show the right screen */
  try {
    sessionStorage.setItem("lm_pending", JSON.stringify(order));
  } catch {
    /* storage blocked */
  }

  fetch("/api/pay/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  })
    .then((r) =>
      r
        .json()
        .catch(() => ({}))
        .then((j: Answer & { url?: string; session_id?: string; error?: string; item?: string; left?: unknown }) => ({ s: r.status, j, ra: r.headers.get("Retry-After") })),
    )
    .then((res) => {
      if (res.j && res.j.ok && res.j.url) {
        /* the session id rides with the pending copy: the verify on the way back shows it
           and is told the amount (v314) */
        try {
          order.sid = res.j.session_id || "";
          sessionStorage.setItem("lm_pending", JSON.stringify(order));
        } catch {
          /* storage blocked */
        }
        window.location.href = res.j.url;
        return;
      }
      const e: Refusal = new Error(res.s === 429 ? "rate_limited" : (res.j && res.j.error) || "http_" + res.s);
      /* (v336) what the refusal names: the short box and its count, and a 429's wait */
      e.item = res.j && res.j.item;
      e.left = res.j && res.j.left;
      e.wait = res.ra;
      throw e;
    })
    .catch((err: Refusal) => {
      payWaitStop();
      if (btn) {
        btn.disabled = false;
        btn.textContent = L("ادفع الآن");
        btn.classList.add("bad");
      }
      payError(err.message, err);
      if (err.message === "stock_short") LM.loadStock();
    });
}

function payError(code: string, err: Refusal | null): void {
  setTimeout(() => {
    const b = document.querySelector("#confirm");
    if (b) b.classList.remove("bad");
  }, 1800);
  if (code === "stock_short" && err && err.item) {
    shortFix(err.item, err.left);
    return;
  }
  /* (v336) too many tries from here just now: the button rests for the Retry-After the
     server sent (capped), and says so */
  if (code === "rate_limited") {
    const b0 = document.querySelector<HTMLButtonElement>("#confirm");
    const wait = Math.min(120, Math.max(5, parseInt(String(err && err.wait), 10) || 60));
    if (b0) {
      b0.disabled = true;
      setTimeout(() => {
        b0.disabled = false;
      }, wait * 1000);
    }
  }
  const msg = L(
    code === "rate_limited" ? "محاولات كثيرة الآن. جرب مرة أخرى بعد دقيقة." :
    code === "gateway_not_configured" ? (LM.codOn() ? "بوابة الدفع غير مهيأة بعد. اختر الدفع عند الاستلام أو راسلنا." : "بوابة الدفع غير مهيأة بعد. راسلنا على واتساب.") :
    code === "amount_too_small" ? "المبلغ أقل من الحد المسموح للدفع بالبطاقة." :
    code === "incomplete" ? "تأكد من إكمال بياناتك." :
    /* a size or scent switched off for this country, or sold out, after the basket was filled */
    code === "unavailable_here" ? "أحد المنتجات في سلتك غير متوفر في بلدك. احذفه وأعد المحاولة." :
    code === "unknown_item" ? "أحد المنتجات في سلتك لم يعد متاحا. احذفه وأعد المحاولة." :
    code === "cod_not_offered" ? "الدفع عند الاستلام غير متاح في بلدك. اختر الدفع بالبطاقة." :
    code === "offer_closed" ? "انتهى عرض الباقة. احذفها من السلة وأعد المحاولة." :
    code === "unpriced_item" ? "أحد المنتجات في سلتك غير مسعّر لبلدك. احذفه وأعد المحاولة." :
    /* the shelf has fewer than the basket asks for (v211) */
    code === "stock_short" ? "الكمية المتوفرة أقل مما في سلتك. قلّل الكمية وأعد المحاولة." :
    code === "unknown_country" ? "اختر بلدك من القائمة وأعد المحاولة." :
    /* (v336) over 99 boxes in one order */
    code === "too_many" ? "الكمية أكبر من المسموح لطلب واحد. قلّلها أو راسلنا على واتساب." :
    "تعذر إتمام الطلب. جرب مرة أخرى أو راسلنا على واتساب.",
  );
  const box = document.querySelector<HTMLElement>("#payMsg");
  if (box) {
    box.textContent = msg;
    box.hidden = false;
  }
}

/* (v336) THE SHELF HAS FEWER THAN THE BASKET ASKS FOR. The server names the box
   ("oud-large") and how many are still free; the page names it as the summary does, marks
   its line, and offers the one tap that fixes it: set to what is left, or remove it at 0. A
   box taken only inside a set or an offer has no line of its own: it is named. */
function shortFix(itemIn: unknown, leftIn: unknown): void {
  const item = String(itemIn);
  const left = Math.max(0, parseInt(String(leftIn), 10) || 0);
  const lineOf = (): number => {
    for (let i = 0; i < cart.length; i++) if (LM.itemId(cart[i]) === item) return i;
    return -1;
  };
  const at = lineOf();
  const cut = item.lastIndexOf("-");
  const nm = LM.lineLabel(at > -1 ? cart[at] : ({ scentId: item.slice(0, cut), sizeId: item.slice(cut + 1) } as CartLine));
  const name = ((nm.scent || "") + (nm.size ? " " + nm.size : "")).trim() || item;
  shortBox = { item, left };
  items();
  const box = document.querySelector<HTMLElement>("#payMsg");
  if (!box) return;
  box.removeAttribute("data-form");
  box.textContent = left > 0 ? L("بقي {n} فقط من {item}.", { n: left, item: name, count: left }) : L("نفدت الكمية من {item}.", { item: name });
  box.hidden = false;
  if (at < 0) {
    box.appendChild(document.createTextNode(" " + L("عدّل سلتك وأعد المحاولة.")));
    return;
  }
  const fix = document.createElement("button");
  fix.type = "button";
  fix.className = "pm-fix";
  fix.textContent = left > 0 ? L("اجعلها {n}", { n: left }) : L("احذفه من السلة");
  fix.addEventListener("click", () => {
    const i = lineOf();
    if (i > -1) {
      if (left > 0) cart[i]!.qty = left;
      else cart.splice(i, 1);
    }
    shortBox = null;
    box.hidden = true;
    writeCart(cart);
    if (!cart.length) {
      location.reload();
      return;
    }
    items();
    totals();
    badge();
  });
  box.appendChild(document.createTextNode(" "));
  box.appendChild(fix);
}

/* ----------------------------------------------------------
   Coming back from Thawani. ?paid= is only a hint — the server asks the gateway what really
   happened before anything is treated as sold.
   ---------------------------------------------------------- */
/* (v439) cash on delivery is suggested only where it is offered */
export function nextStep(): string {
  return LM.codOn() ? L("استخدم الرابط في رسالتك للدفع، أو اختر الدفع عند الاستلام.") : L("استخدم الرابط في رسالتك للدفع، أو راسلنا على واتساب.");
}
/* (v336) BACK FROM THE GATEWAY WITH NO BASKET IN THIS TAB: a message stands in for the form
   (the order, what happened, what to do next, WhatsApp). An id that is not an order number
   gets the empty basket screen. */
function told(id: unknown, what: string, next: string): void {
  const w = document.querySelector<HTMLElement>("#verifying");
  const box = document.querySelector<HTMLElement>("#returned");
  if (w) w.style.display = "none";
  $("#co").style.display = "none";
  if (!box || !/^LM-\d{4,12}$/.test(String(id || ""))) {
    $("#empty").style.display = "block";
    settle();
    return;
  }
  $("#retHead").textContent = L("طلبك {id}", { id: String(id) });
  $("#retWhat").textContent = what;
  $("#retNext").textContent = next;
  const wa = document.querySelector<HTMLAnchorElement>("#retWa");
  if (wa) {
    wa.textContent = L("راسلنا على واتساب");
    wa.href = "https://wa.me/96876655565?text=" + encodeURIComponent(L("طلبك {id}", { id: String(id) }));
  }
  box.style.display = "block";
  settle();
}

/* "We could not check" and "it was not paid" are different answers: the unknown case
   retries a few times, then says so with the order number and keeps the pending order. */
/* the server could not say: retried, then "could not check — do not pay again". rate_limited and server_error are
   the rebuilt server's words for a busy or failing check (the original had no limit on verify). */
const UNSURE: Record<string, 1> = { db_read_failed: 1, db_write_failed: 1, gateway_error: 1, db_not_configured: 1, gateway_not_configured: 1, rate_limited: 1, server_error: 1, upstream: 1 };

function handleReturn(): boolean {
  const q = new URLSearchParams(location.search || "");
  const paid = q.get("paid");
  const cancelled = q.get("cancelled");
  if (!paid && !cancelled) return false;

  let pending: (OrderBody & { omr?: number }) | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem("lm_pending") as string);
  } catch {
    /* nothing waiting */
  }

  if (cancelled) {
    try {
      sessionStorage.removeItem("lm_pending");
    } catch {
      /* storage blocked */
    }
    if (!cart.length) {
      history.replaceState({}, "", location.pathname);
      told(cancelled, L("تم إلغاء الدفع."), nextStep());
      return true;
    }
    const box = document.querySelector<HTMLElement>("#payMsg");
    if (box) {
      box.textContent = LM.codOn() ? L("تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى أو اختر الدفع عند الاستلام.") : L("تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى.");
      box.hidden = false;
    }
    history.replaceState({}, "", location.pathname);
    return false;
  }
  const ref = paid as string;

  /* show a neutral waiting state while we confirm */
  $("#co").style.display = "none";
  const wait = document.querySelector<HTMLElement>("#verifying");
  if (wait) wait.style.display = "block";

  let tries = 0;

  const unsure = (): void => {
    if (!cart.length) {
      told(ref, L("تعذر التحقق من الدفع الآن."), L("إن خُصم المبلغ فطلبك محفوظ. لا تدفع مرة أخرى وراسلنا برقم الطلب."));
      return;
    }
    if (wait) wait.style.display = "none";
    $("#co").style.display = "";
    const box = document.querySelector<HTMLElement>("#payMsg");
    if (box) {
      box.textContent = L("تعذر التحقق من الدفع الآن. إن كان المبلغ قد خُصم فطلبك محفوظ — راسلنا برقم الطلب {id} ولا تدفع مرة أخرى.", { id: ref });
      box.hidden = false;
    }
  };

  const later = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 1500 * tries)).then(verify);

  function verify(): Promise<void> {
    tries++;
    return fetch("/api/pay/verify?ref=" + encodeURIComponent(ref) + (pending && pending.sid ? "&sid=" + encodeURIComponent(pending.sid) : ""), { cache: "no-store" })
      .then((r) => r.json().catch(() => ({})))
      .then((j: (Answer & { paid?: boolean; amount_omr?: unknown; settled?: boolean; error?: string }) | null): Promise<void> | void => {
        if (j && j.ok && j.paid) {
          if (wait) wait.style.display = "none";
          history.replaceState({}, "", location.pathname);
          /* the id in the return URL is the server's — a pending copy may carry the number it proposed */
          if (pending) pending.id = ref;
          /* what was charged, as the server reported it to both platforms */
          if (pending && j.amount_omr != null && isFinite(+(j.amount_omr as number)) && +(j.amount_omr as number) > 0) pending.omr = +(j.amount_omr as number);
          const order = pending || { id: ref };
          try {
            sessionStorage.removeItem("lm_pending");
          } catch {
            /* storage blocked */
          }
          /* On `already` too: the webhook often confirms first, and then this was the only
             chance for the pixels' copy (the one with the browser's cookies). The removal
             just above keeps a reload from firing it again. */
          const g = G();
          if (g.LMPX && pending) g.LMPX.purchase(pending, j);
          if (!j.already && g.LMEV) g.LMEV.track("order_placed", "card");
          if (pending) sendToNetlify(pending);
          finish(order);
          return;
        }
        /* the server could not say — a blip on our side or the gateway's */
        if (!j || !j.ok) {
          if ((!j || UNSURE[j.error as string] || !j.error) && tries < 4) return later();
          if (!j || UNSURE[j.error as string] || !j.error) {
            unsure();
            return;
          }
        }
        /* a definite answer: not paid. Back to the form, cart intact. */
        if (wait) wait.style.display = "none";
        history.replaceState({}, "", location.pathname);
        const mism = j && j.error === "amount_mismatch";
        /* (v336) settled without a card payment: converted to cash, or binned by the shop */
        if (j && j.ok && j.settled) {
          try {
            sessionStorage.removeItem("lm_pending");
          } catch {
            /* storage blocked */
          }
          told(ref, L("طلبك قيد المعالجة بالفعل."), L("لا حاجة لأي إجراء. لأي استفسار راسلنا برقم الطلب."));
          return;
        }
        /* back in a tab with no basket: there is no form to go back to */
        if (!cart.length) {
          if (mism) told(ref, L("هناك اختلاف في المبلغ."), L("راسلنا وسنكمل طلبك يدويا."));
          else if (j && j.ok) told(ref, L("لم يكتمل الدفع."), nextStep());
          else $("#empty").style.display = "block";
          return;
        }
        $("#co").style.display = "";
        const box = document.querySelector<HTMLElement>("#payMsg");
        if (box) {
          box.textContent = j && j.error === "amount_mismatch" ? L("هناك اختلاف في المبلغ. راسلنا وسنكمل طلبك يدويا.") : L("لم يكتمل الدفع. سلتك كما هي، جرب مرة أخرى.");
          box.hidden = false;
        }
      })
      .catch(() => {
        if (tries < 4) return later();
        unsure();
      });
  }
  void verify();
  return true;
}

/* ----------------------------------------------------------
   Persist the order through our own endpoint. A NETWORK failure (offline, a cold start, a
   database blip, a 429) is a valid order the write did not reach: park it and retry later.
   A REFUSAL (a 4xx with a named error) is not a valid order and never will be: it comes back
   to the caller with its reason, and nothing is queued.
   ---------------------------------------------------------- */
function saveOrder(o: OrderBody): Promise<Answer> {
  return fetch("/api/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order: o }),
  })
    .then((r) =>
      r
        .json()
        .catch(() => null)
        .then((j: (Answer & { error?: string; item?: string; left?: unknown }) | null) => {
          if (r.ok && j && j.ok) return j;
          /* 4xx with a named error is the server's decision; anything else is the wire's */
          if (r.status === 429) throw new Error("unreachable"); /* v329: queued, sent later */
          if (r.status >= 400 && r.status < 500 && j && j.error) {
            const e: Refusal = new Error(String(j.error));
            e.refused = true;
            e.item = j.item || null;
            e.left = j.left;
            throw e;
          }
          throw new Error("unreachable");
        }),
    )
    .catch((e: Refusal) => {
      if (e && e.refused) throw e;
      queue(o);
      return { ok: true, queued: true };
    });
}

/* the queue itself lives in the core, so it is retried from every page — LM.flushOrders */
function queue(o: OrderBody): void {
  LM.queueOrder(o as unknown as Parameters<typeof LM.queueOrder>[0]);
}
function flushQueue(): void {
  void LM.flushOrders();
}

/* Netlify Forms — a second, independent copy of the order (the hidden form "orders" in the
   page). Nothing breaks locally or if forms are disabled; failures are ignored. */
function sendToNetlify(o: OrderBody): void {
  const body: Record<string, unknown> = {
    "form-name": "orders",
    id: o.id, date: o.date, name: o.name, phone: o.phone, email: o.email || "",
    country: o.country, city: o.city, region: o.region, note: o.note,
    pay: o.pay === "card" ? "بطاقة الخصم المباشر" : "الدفع عند الاستلام",
    items: o.items.map((i) => i.scent + " " + i.size + " ×" + i.qty).join(" | "),
    total: o.total + " " + o.cur, charged: o.omr + " OMR",
  };
  const enc = Object.keys(body)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(body[k])))
    .join("&");
  try {
    fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: enc,
    }).catch(() => {});
  } catch {
    /* no fetch */
  }
}

function onSubmit(e: Event): void {
  e.preventDefault();
  let bad: HTMLElement | null = null;
  /* one way to mark a field: the underline that is drawn (.tel for the phone), aria-invalid */
  const flag = (el: HTMLElement, on: boolean): void => {
    const box = (el.closest(".tel") as HTMLElement | null) || el;
    box.style.borderColor = on ? "#b4483c" : "";
    /* the phone has no line under it (v309): its +971 box is marked */
    const code = box !== el && box.querySelector ? box.querySelector<HTMLElement>(".tel-code") : null;
    if (code) {
      code.style.borderColor = on ? "#b4483c" : "";
      code.style.background = on ? "#b4483c" : "";
    }
    if (on) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  };
  /* Same order as the form reads: it decides which field gets focused when several are empty */
  ["name", "country", "city", "region", "phone"].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (!el.value.trim()) {
      flag(el, true);
      if (!bad) bad = el;
    } else {
      flag(el, false);
    }
  });

  /* (v336) The market's exact length, after the trunk 0 and a pasted own code are stripped;
     a pasted foreign code is asked about. See phoneProblem. */
  const ph = document.getElementById("phone") as HTMLInputElement | null;
  const phoneWhy = ph && ph.value.trim() ? phoneProblem() : "";
  if (phoneWhy && ph) {
    flag(ph, true);
    if (!bad) bad = ph;
  }
  phoneSay(phoneWhy);

  /* Email is optional; a filled one still has to be well formed */
  const em = document.getElementById("email") as HTMLInputElement | null;
  if (em) {
    const v = em.value.trim();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) {
      flag(em, true);
      if (!bad) bad = em;
    } else {
      flag(em, false);
    }
  }
  /* Before anything is validated or sent: the basket may have outlived a country change, and
     this market may not sell part of it — the dialog offers the one action that unblocks. */
  const lmCart = G().lmCart;
  if (lmCart && lmCart.warn && !lmCart.warn()) return;

  const go = document.querySelector<HTMLButtonElement>("#confirm");
  if (bad) {
    const b: HTMLElement = bad;
    if (go) {
      go.classList.add("bad");
      setTimeout(() => go.classList.remove("bad"), 1600);
    }
    /* say it in words too: #payMsg is role=alert */
    const pm = document.querySelector<HTMLElement>("#payMsg");
    if (pm) {
      pm.textContent = b === ph && phoneWhy ? phoneWhy : L("تأكد من إكمال بياناتك.");
      pm.setAttribute("data-form", "1");
      pm.hidden = false;
    }
    b.focus();
    b.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  /* complete now: the line above is no longer true */
  const pm1 = document.querySelector<HTMLElement>("#payMsg");
  if (pm1 && pm1.getAttribute("data-form")) {
    pm1.hidden = true;
    pm1.removeAttribute("data-form");
  }
  if (go) go.classList.add("ok-go");
  shortBox = null; /* (v336) a fresh try: the mark comes back only if refused again */

  /* Ten digits, not six: seven of the clock and three random (a six-digit clock id repeats
     every seventeen minutes; the server renumbers a taken id and says so). */
  const id = "LM-" + String(Date.now()).slice(-7) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  const sub = cart.reduce((t, i) => t + unit(i) * i.qty, 0);
  const ship = freeHere(LM.freeSub(cart, unit)) || LM.setFree(cart) ? 0 : LM.ship();
  const fee = pay === "cod" ? LM.cod() : 0;
  const g = G();
  const order: OrderBody = {
    id,
    date: new Date().toISOString(),
    name: $<HTMLInputElement>("#name").value.trim(),
    email: document.querySelector("#email") ? $<HTMLInputElement>("#email").value.trim().toLowerCase() : "",
    /* normalised: the trunk 0 typed out of habit is dropped */
    phone: "+" + $<HTMLSelectElement>("#country").value + " " + phoneDigits(),
    country: LM.c.name, /* the option text carries the flag emoji */
    countryCode: LM.c.code,
    city: $<HTMLInputElement>("#city").value.trim(),
    region: $<HTMLInputElement>("#region").value.trim(),
    note: document.querySelector("#note") ? $<HTMLTextAreaElement>("#note").value.trim() : "",
    pay,
    items: cart.map((i) => ({
      scent: i.scent, size: i.size, price: unit(i), qty: i.qty,
      /* LM.itemId: the id the server parses and the pixels report */
      itemId: LM.itemId(i),
    })),
    cur: LM.c.cur,
    ship,
    codFee: fee,
    total: sub + ship + fee,
    omr: Math.round((sub + ship + fee) * LM.omrRate() * 1000) / 1000,
    omrRate: LM.omrRate(),
    dedupeId: window.crypto && crypto.randomUUID ? crypto.randomUUID() : "lm-" + id + "-" + Date.now(),
    /* the Snap cookie and click id, and Meta's _fbp/_fbc: the server can derive none */
    snap: g.LMPX && g.LMPX.signals ? g.LMPX.signals() : {},
    /* what brought this shopper (v302: the last source of 90 days when this visit is direct) */
    ref: g.LMPX && g.LMPX.landing ? g.LMPX.landing() : g.LMLanding ? g.LMLanding() : {},
    pageUrl: location.href,
    /* which page the shopper is reading, so the gateway sends them back to the same language */
    lang: LM.lang,
    status: "new",
  };
  if (pay === "card") {
    payByCard(order, go);
    return;
  }

  /* Cash on delivery: final the moment the SERVER accepts it. The copies and the pixels
     follow the acceptance. A parked write (offline) still counts — the screen is shown. */
  if (go) {
    go.disabled = true;
    go.textContent = L("جار تأكيد طلبك…");
  }
  saveOrder(order)
    .then((j) => {
      /* the number the order was actually stored under */
      if (j && j.id && /^LM-\d{4,12}$/.test(String(j.id))) order.id = j.id;
      /* and the total the server charged and reported */
      if (j && j.omr != null && isFinite(+j.omr) && +j.omr > 0) order.omr = +j.omr;
      sendToNetlify(order);
      /* A parked order's Purchase waits for its landing: LM.flushOrders fires it */
      const g2 = G();
      if (g2.LMPX && !(j && j.queued)) g2.LMPX.purchase(order, j);
      if (g2.LMEV) g2.LMEV.track("order_placed", "cod");
      finish(order, !!(j && j.queued));
    })
    .catch((err: Refusal) => {
      if (go) {
        go.disabled = false;
        go.textContent = L("ادفع الآن");
        go.classList.add("bad");
      }
      payError(err.message, err);
      /* the basket is repainted: what was refused may have just changed */
      items();
      totals();
      if (err.message === "stock_short") LM.loadStock();
    });
}

function start(): void {
  /* not the checkout's markup (a test importing the entry into an empty document): nothing to
     drive. On the page itself the form is always there. */
  if (!document.getElementById("co") || !document.getElementById("form")) return;
  /* (v336) through the shared reader: a malformed basket is cleaned, not thrown on */
  cart = LM.readCart();

  /* (v336) RECEIPTS NOTHING READ: an older build's copies (lm_orders, lm_last) are removed */
  try {
    localStorage.removeItem("lm_orders");
  } catch {
    /* storage blocked */
  }
  try {
    sessionStorage.removeItem("lm_last");
  } catch {
    /* storage blocked */
  }

  const year = document.querySelector("#year");
  if (year) year.textContent = String(new Date().getFullYear());

  /* the drawer can edit the cart from this page too — stay in sync */
  G().lmOnCartChange = () => {
    const next = LM.readCart();
    if (!next.length) {
      location.reload();
      return;
    }
    cart = next;
    items();
    totals();
    badge();
  };

  /* RESTORED FROM THE BACK/FORWARD CACHE (Back from the gateway, or Back/Forward after
     editing the basket on the product page): the button still said "جار تحويلك للدفع…" and
     was disabled, and `cart` was the basket as it was when the page was left. */
  window.addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    const next = LM.readCart();
    const co = document.querySelector<HTMLElement>("#co");
    if (!co || co.style.display === "none" || !next.length) {
      if (next.length || cart.length) location.reload();
      return;
    }
    const b = document.querySelector<HTMLButtonElement>("#confirm");
    if (b) {
      b.disabled = false;
      b.classList.remove("ok-go", "bad");
      b.textContent = L("ادفع الآن");
    }
    payWaitStop();
    cart = next;
    items();
    totals();
    badge();
  });

  /* returning from a successful payment empties the cart legitimately, so the payment result
     is resolved before the "cart is empty" screen */
  const returning = /[?&](paid|cancelled)=/.test(location.search || "");

  if (!cart.length && !returning) {
    $("#co").style.display = "none";
    $("#empty").style.display = "block";
    badge();
    settle();
    return;
  }

  restrict(document.getElementById("name") as HTMLInputElement | null, keepName);
  restrict(document.getElementById("phone") as HTMLInputElement | null, keepPhone);

  phoneEl = document.getElementById("phone") as HTMLInputElement | null;
  if (phoneEl) phoneEl.addEventListener("input", paintTelCount);
  /* (v336) the field's own message goes once the number is edited */
  if (phoneEl) phoneEl.addEventListener("input", () => phoneSay(""));

  GOV = { "968": { label: L("المحافظة"), hint: L("اختر المحافظة") } };

  country = $<HTMLSelectElement>("#country");
  dial = document.querySelector<HTMLElement>("#dial");
  city = $<HTMLSelectElement>("#city");

  Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), (b: HTMLElement) => {
    b.addEventListener("click", () => {
      choosePay(b.getAttribute("data-pay") as string);
      totals();
      /* Meta's AddPaymentInfo and Snap's ADD_BILLING — one id for both, once per method */
      const px = G().LMPX;
      if (px && px.addPaymentInfo) px.addPaymentInfo(pay);
    });
  });

  /* a field marked on submit loses its mark as soon as it is typed into */
  $("#form").addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || el.getAttribute("aria-invalid") !== "true" || !el.value.trim()) return;
    const box = (el.closest(".tel") as HTMLElement | null) || el;
    box.style.borderColor = "";
    el.removeAttribute("aria-invalid");
  });

  $("#form").addEventListener("submit", onSubmit);

  void LM.ready.then(() => {
    initCountry();
    items();
    totals();
    badge();
    /* THE SUMMARY AGES (a free-delivery offer ends at midnight, the set's window closes):
       re-read once a minute and whenever the tab comes back; display only. */
    const fresh = (): void => {
      if (document.hidden) return;
      const co = document.querySelector<HTMLElement>("#co");
      if (!co || co.style.display === "none" || !cart.length) return;
      items();
      totals();
    };
    setInterval(fresh, 60e3);
    document.addEventListener("visibilitychange", fresh);
    const back = handleReturn();
    settle();
    if (back) return;
    const px = G().LMPX;
    if (px) px.startCheckout();
    flushQueue();
  });
}

start();
