/**
 * What follows every change on the grid: the sticky bar's price and words, the delivery copy
 * of this market (the الشحن panel's bullets and the delivery time, v198), the header band's
 * preview (window.lmShip), and the free-delivery strip (#fsBar).
 */
import { LM } from "../core";
import { keptOpen, pickedTotal, stacked } from "./rules";
import { $, G, st } from "./state";
import { etaPair, fsLeftHtml } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

export function sync(): void {
  const line = pickedTotal();
  const sp = $("#sPrice");
  /* innerHTML, because the dirham mark is markup; both arguments are numbers */
  /* the small size is the bundle (v309): its price is the bundle's */
  let pid = st.size ? (st.size.id === LM.bundleOnlySize() ? "bundle" : st.size.id) : null;
  /* (v336) the stacked page with its large box sold out: the set's price when it is what can
     be bought, and no figure at all when nothing can */
  const stillOnly = stacked() && !st.size && !line;
  /* (v403) the set chosen on the stacked page: its price */
  if (stacked() && st.set && !line && LM.bundleOpen()) pid = "bundle";
  const p = line || (pid && !keptOpen(st.size) ? LM.price(pid) : stillOnly ? (LM.bundleOpen() ? LM.price("bundle") : 0) : LM.fromPrice());
  if (sp) {
    sp.innerHTML = p ? LM.moneyHTML(p) : "";
    sp.hidden = !p;
  }
  stickyWords();
  shipCopy();
  const g = G();
  if (g.lmShip) g.lmShip(line);
}

/* (v336) the stacked page has no size to choose, so its sticky button asks for an offer
   (index.html carries "اختر حجمك") */
function stickyWords(): void {
  const b = $("#stickyAdd");
  if (!b) return;
  const w = stacked() ? L("اختر عرضك") : L("اختر حجمك");
  if (b.textContent !== w) b.textContent = w;
}

/* WHAT SHIPPING COSTS, IN THIS MARKET — every country carries its own threshold, fee and
   currency; written in the bullets of the الشحن panel from here so they cannot drift */
export function shipCopy(): void {
  const free = LM.freeOver(), fee = +(LM.c.ship as number) || 0;
  /* a free-delivery offer at 0 is free on every order, whatever the usual fee */
  const deal = LM.freeDeal ? LM.freeDeal() : null;

  /* No threshold is not "free for everyone" — only a free-delivery offer at 0 is */
  const li = document.querySelector<HTMLElement>(".ship-free");
  if (li) {
    li.innerHTML = free > 0 ? L("توصيل مجاني للطلبات فوق {p}", { p: LM.moneyHTML(free) }) : deal ? L("توصيل مجاني لكل الطلبات") : "";
    li.hidden = !li.innerHTML;
  }

  /* the FAQ's cash line, only where cash is taken (v202) */
  const codLi = document.querySelector<HTMLElement>(".cod-faq");
  if (codLi) codLi.hidden = !!(LM.codOn && !LM.codOn());

  /* and what it costs when the basket is under that */
  const cost = document.querySelector<HTMLElement>(".ship-cost");
  if (cost) {
    cost.innerHTML = free > 0 && fee > 0 ? L("الشحن {p} للطلبات الأقل من ذلك", { p: LM.moneyHTML(fee) }) : "";
    cost.hidden = !cost.innerHTML;
  }

  shipEta();
}

/* The page is written with the 72-hour words — the pill (.ship-eta) and the الشحن bullet
   (.ship-eta-faq) — and a Saudi, Qatari or Omani shopper's page swaps them. Each keeps its own
   words in data-def, so a change of country puts them back; on /en/ those are the English. */
function shipEta(): void {
  const own = etaPair();
  const swap = (el: Element, text: string | null | undefined) => {
    if (el.getAttribute("data-def") === null) el.setAttribute("data-def", el.textContent || "");
    el.textContent = own ? (text as string) : el.getAttribute("data-def");
  };
  Array.prototype.forEach.call(document.querySelectorAll(".ship-eta"), (el: Element) => {
    swap(el, own && own[0]);
  });
  const faq = document.querySelector(".ship-eta-faq");
  if (faq) swap(faq, own && own[1]);
}

/* THE FREE-DELIVERY STRIP, painted from LM.freeDeal() (the till's rule). It re-reads the deal
   on every tick: the tick after the end hides the strip and repaints every threshold. */
let fsTimer: ReturnType<typeof setInterval> | null = null;
export function buildFreeBar(): void {
  const bar = $("#fsBar"), txt = $("#fsTxt"), left = $("#fsLeft"), dot = $("#fsDot");
  if (!bar || !txt || !left) return;
  if (fsTimer) {
    clearInterval(fsTimer);
    fsTimer = null;
  }
  const d = LM.freeDeal ? LM.freeDeal() : null;
  if (!d) {
    bar.hidden = true;
    return;
  }
  const over = LM.freeOver();
  /* one line, as short as it can be said: "توصيل مجاني فوق 10" */
  txt.innerHTML =
    "<b>" + L("توصيل مجاني") + "</b> " + (over > 0 ? L("فوق {p}", { p: '<span class="fs-amt">' + LM.moneyHTML(over) + "</span>" }) : L("على جميع الطلبات"));
  bar.hidden = false;

  const fin = (on: boolean) => {
    left.hidden = !on;
    if (dot) dot.hidden = !on;
  };
  if (!d.end) {
    fin(false);
    return;
  }
  const tick = () => {
    const now = LM.freeDeal ? LM.freeDeal() : null;
    if (!now) {
      clearInterval(fsTimer!);
      fsTimer = null;
      bar.hidden = true;
      sync(); /* every threshold on the page, back to normal */
      return;
    }
    left.innerHTML = fsLeftHtml(now.end as number);
  };
  fin(true);
  tick();
  /* once a minute is plenty for a count of days — it only has to notice midnight and the end */
  fsTimer = setInterval(tick, 60e3);
}
