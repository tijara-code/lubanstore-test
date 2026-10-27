/**
 * LUBAN&MUSK — cart drawer (the port of assets/js/cart.js).
 * Injects its own markup; opened from the header cart icon. Also the "not available in your
 * country" dialog, and window.lmCart = { open, close, refresh, warn } (the checkout calls
 * warn() before it submits; the product page calls refresh()).
 */
import { LM } from "../core";
import type { CartLine } from "../core/types";
import { G, TRASH, domReady, writeCart } from "../checkout/contracts";

/* every shopper-facing string goes through L() — see the core */
const L = (s: string, v?: Record<string, string | number>): string => LM.L(s, v);
/* a line's name in the page's language, from the catalogue as it is now */
const label = (it: CartLine): { scent: string; size: string } => LM.lineLabel(it);

/* The packshot follows the size, and the scent rides in the corner as a small coloured
   chip, both derived from the line's ids (baskets stored before this shipped still render).
   An add-on with no photograph gets its DRAWING — the same one the delivery bar shows. The
   checkout's summary draws the same two lines (with a 58×58 box on its <img>). */
function thumb(it: CartLine): string {
  const IMG = (LM.root || "") + "assets/img/";
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
    '<img src="' + IMG + name + "-sm.jpg" + LM.v + '" alt="" loading="lazy" decoding="async"></picture>' +
    mark + "</span>"
  );
}

/* digits render as Latin (0-9); one place to change that */
const toAr = (n: unknown): string => String(n);
const unit = (it: CartLine): number => (LM.c ? LM.price(it.sizeId) : Number(it.price));
const esc = (v: unknown): string => LM.esc(v);
const $ = <E extends Element = HTMLElement>(s: string): E | null => document.querySelector<E>(s);

/* (v336) the one safe reader (the core): a null line or a non-array basket no longer throws */
const read = (): CartLine[] => LM.readCart();
const write = (c: CartLine[]): void => writeCart(c);

let el: HTMLElement;

function build(): void {
  el = document.createElement("div");
  el.className = "drawer";
  el.id = "drawer";
  el.hidden = true;
  el.innerHTML =
    '<div class="drawer-veil" data-close></div>' +
    '<aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="' + L("السلة") + '">' +
      '<div class="drawer-top">' +
        "<h2>" + L("السلة") + "</h2>" +
        '<button type="button" class="drawer-x" data-close aria-label="' + L("إغلاق") + '">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/></svg>' +
        "</button>" +
      "</div>" +
      '<div class="drawer-body" id="drawerBody"></div>' +
      '<div class="drawer-foot">' +
        '<p class="drawer-note">' + L("الشحن والضريبة تحسب عند الدفع") + "</p>" +
        '<a class="btn" id="drawerPay" href="checkout.html">' + L("الدفع") + ' <em id="drawerTotal"></em></a>' +
      "</div>" +
    "</aside>";
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-close]")) {
      close();
      return;
    }
    const pay = t.closest("#drawerPay");
    if (pay) {
      e.preventDefault();
      /* the basket outlived a country change: stop here rather than carry the shopper to a
         checkout the server will refuse */
      if (!warn()) return;
      window.location.href = "checkout.html";
    }
  });
  document.addEventListener("keydown", (e) => {
    /* the availability dialog sits on top of the drawer and handles its own Escape —
       without this guard one keypress closed both */
    if (e.key === "Escape" && !(pop && !pop.hidden)) close();
    /* keep Tab inside the open dialog */
    if (e.key === "Tab" && el && !el.hidden && !(pop && !pop.hidden)) {
      const all = el.querySelectorAll<HTMLElement>(".drawer-panel button, .drawer-panel a[href]");
      const f = Array.prototype.filter.call(all, (x: HTMLElement) => x.offsetParent !== null) as HTMLElement[];
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function render(): void {
  const cart = read();
  const body = $("#drawerBody")!;
  const foot = el.querySelector<HTMLElement>(".drawer-foot")!;
  body.innerHTML = "";

  if (!cart.length) {
    body.innerHTML = '<p class="drawer-empty">' + L("السلة فارغة") + "</p>";
    foot.style.display = "none";
    return;
  }
  foot.style.display = "block";

  cart.forEach((it, i) => {
    const row = document.createElement("div");
    /* flagged the moment the country changes, not saved up for the confirm button */
    const off = !LM.lineOffered(it);
    row.className = "ci" + (off ? " ci-off" : "");
    const nm = label(it);
    /* (v336) an off line with no price here said "0 ر.ع.": the reason goes where the price
       would be, and the line keeps its mix */
    const noPrice = off && !(unit(it) > 0);
    row.innerHTML =
      thumb(it) +
      '<div class="ci-body">' +
        '<span class="ci-name">' + esc(nm.scent) + "</span>" +
        '<span class="ci-price">' + (noPrice ? LM.offWords(it) : LM.moneyHTML(unit(it))) + "</span>" +
        '<span class="ci-meta">' + (off && !noPrice ? LM.offWords(it) : esc(nm.size)) + "</span>" +
        '<div class="ci-row">' +
          '<span class="ci-qty">' +
            '<button type="button" data-dec="' + i + '" aria-label="' + L("إنقاص") + '">−</button>' +
            "<span>" + toAr(it.qty) + "</span>" +
            '<button type="button" data-inc="' + i + '" aria-label="' + L("زيادة") + '">+</button>' +
          "</span>" +
          '<button type="button" class="ci-del" data-del="' + i + '" aria-label="' + L("حذف") + '">' + TRASH + "</button>" +
        "</div>" +
      "</div>";
    body.appendChild(row);
  });

  /* (v336) only what can be bought here: an ended offer or a line this market does not sell
     is struck through above and is not in the total the pay button carries */
  $("#drawerTotal")!.innerHTML =
    "(" + LM.moneyHTML(cart.reduce((t, x) => (!LM.lineOffered(x) ? t : t + unit(x) * x.qty), 0)) + ")";

  /* up to 20 from here — and never DOWN: a line that already held more (added from the
     page) was cut to 20 by its own + button */
  bind(body, "data-inc", (c, i) => {
    if (c[i]!.qty >= 20) return;
    /* capped at the shelf (v211). (v336) every box the line holds, a trio's three and the
       set's, against what the whole basket already holds of each (LM.lineRoom) */
    const room = LM.lineRoom(c[i]!, c);
    if (room != null && room < 1) return;
    c[i]!.qty += 1;
  });
  bind(body, "data-dec", (c, i) => {
    c[i]!.qty -= 1;
    if (c[i]!.qty < 1) c.splice(i, 1);
  });
  bind(body, "data-del", (c, i) => {
    c.splice(i, 1);
  });
}

/* ----------------------------------------------------------
   "Not available in your country"

   A basket lives in sessionStorage and survives a country change, so a box added in Oman can
   still be sitting there when the shopper switches to a market that has run out of it — or
   does not carry it at all. The server refuses that order, but finding out at the gateway is
   the worst possible moment: the lines are marked as soon as the country changes, and
   processing stops with this dialog, which offers the one action that unblocks them.
   ---------------------------------------------------------- */
let pop: HTMLElement | undefined;

function buildPop(): void {
  const p = document.createElement("div");
  pop = p;
  p.className = "avail-pop";
  p.id = "pop";
  p.hidden = true;
  p.innerHTML =
    '<div class="avail-veil" data-pop-close></div>' +
    '<div class="avail-panel" role="alertdialog" aria-modal="true" aria-labelledby="popTitle">' +
      '<h2 id="popTitle">' + L("غير متوفر في بلدك") + "</h2>" +
      '<p id="popMsg"></p>' +
      '<ul id="popList"></ul>' +
      '<div class="avail-acts">' +
        '<button type="button" class="btn" data-pop-drop>' + L("احذف غير المتوفر") + "</button>" +
        '<button type="button" class="btn btn-quiet" data-pop-close>' + L("إغلاق") + "</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(p);

  p.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-pop-close]")) return closePop();
    if (t.closest("[data-pop-drop]")) {
      const keep = read().filter((l) => LM.lineOffered(l));
      write(keep);
      closePop();
      /* the same three the quantity buttons do: redraw, then the badge and the bar */
      if (el && !el.hidden) render();
      sync();
      /* the checkout page keeps its own copy of the basket */
      const g = G();
      if (g.lmOnCartChange) g.lmOnCartChange();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pop && !pop.hidden) closePop();
  });
}

let popReturn: HTMLElement | null = null;
function closePop(): void {
  if (!pop) return;
  pop.hidden = true;
  /* the drawer may still be open underneath — give it its lock back */
  document.body.style.overflow = el && !el.hidden ? "hidden" : "";
  if (popReturn && popReturn.focus) popReturn.focus();
  popReturn = null;
}

/* true when the basket is sellable here. false means the dialog is now open and the caller
   must stop what it was doing. */
function warn(): boolean {
  if (!LM.c) return true;
  const bad = LM.blockedLines(read());
  if (!bad.length) return true;

  if (!pop) buildPop();
  popReturn = document.activeElement as HTMLElement | null;
  /* (v336) an offer that ended is not "we can't ship to Oman": when every blocked line is an
     ended offer the dialog says so, and an ended line in a mixed list carries its reason */
  const ended = (l: CartLine): boolean => !!LM.offerEnded(l);
  const allEnded = bad.every(ended);
  const title = document.getElementById("popTitle");
  if (title) title.textContent = allEnded ? L("انتهى العرض") : L("غير متوفر في بلدك");
  document.getElementById("popMsg")!.textContent = allEnded
    ? L("انتهى العرض على هذه المنتجات:")
    : L("لا يمكننا شحن هذه المنتجات إلى {c} حاليا:", { c: LM.txt(LM.c, "name") });
  const list = document.getElementById("popList")!;
  list.innerHTML = "";
  bad.forEach((l) => {
    const li = document.createElement("li");
    /* textContent, not innerHTML: these strings were written into the basket from the
       catalogue and are not re-escaped anywhere here */
    const nm = label(l);
    const why = !allEnded && ended(l) ? L("انتهى العرض") : nm.size;
    li.textContent = nm.scent + (why ? " · " + why : "");
    list.appendChild(li);
  });
  pop!.hidden = false;
  document.body.style.overflow = "hidden";
  const drop = pop!.querySelector<HTMLElement>("[data-pop-drop]");
  if (drop) drop.focus();
  return false;
}

function bind(scope: Element, attr: string, fn: (c: CartLine[], i: number) => void): void {
  Array.prototype.forEach.call(scope.querySelectorAll("[" + attr + "]"), (b: HTMLElement) => {
    b.addEventListener("click", () => {
      const c = read();
      const i = +(b.getAttribute(attr) as string);
      /* a drawer drawn from an older basket (bfcache restore): redraw it from the basket as
         it is, and change nothing */
      if (c[i]) {
        fn(c, i);
        write(c);
      }
      render();
      sync();
      /* render() replaced the focused button: refocus its twin, or the close button when
         the line is gone */
      const again = el.querySelector<HTMLElement>("[" + attr + '="' + i + '"]') || el.querySelector<HTMLElement>(".drawer-x");
      if (again) again.focus();
    });
  });
}

/* keep header badge + shipping bar in step */
function sync(): void {
  const n = read().reduce((t, i) => t + i.qty, 0);
  const badge = $("#cartCount");
  if (badge) {
    badge.textContent = toAr(n);
    badge.hidden = n === 0;
  }
  const ic = document.querySelector(".cart");
  if (ic) ic.classList.toggle("filled", n > 0);
  const co = $("#goCheckout");
  if (co) {
    co.classList.toggle("on", n > 0);
    co.setAttribute("aria-disabled", String(n === 0));
  }
  const g = G();
  if (g.lmShip) g.lmShip(0);
  /* the checkout page keeps its own summary — let it re-read */
  if (g.lmOnCartChange) g.lmOnCartChange();
  /* (v336) and the product page's set card, whose button follows the room the basket
     leaves under the shelf's caps */
  try {
    window.dispatchEvent(new CustomEvent("lm:cart"));
  } catch {
    /* old browsers */
  }
}

let opener: HTMLElement | null = null;
function open(): void {
  render();
  opener = document.activeElement as HTMLElement | null;
  el.hidden = false;
  document.body.style.overflow = "hidden";
  const x = el.querySelector<HTMLElement>(".drawer-x");
  if (x) x.focus();
}

function close(): void {
  if (!el || el.hidden) return;
  el.hidden = true;
  document.body.style.overflow = "";
  if (opener && opener.focus && document.contains(opener)) opener.focus();
  opener = null;
}

function init(): void {
  build();
  window.addEventListener("lm:country", () => {
    if (!el.hidden) render();
  });
  /* bfcache restore: badge, bar and an open drawer were drawn from the basket as it was when
     the page was left (the checkout re-reads itself) */
  window.addEventListener("pageshow", (e) => {
    if (!(e as PageTransitionEvent).persisted) return;
    if (!el.hidden) render();
    if (!G().lmOnCartChange) sync();
  });
  const icon = $(".cart");
  if (icon) {
    icon.addEventListener("click", (e) => {
      e.preventDefault();
      open();
    });
  }
  G().lmCart = {
    open, close,
    refresh: () => {
      if (!el.hidden) render();
    },
    /* the checkout calls this before it submits. false = the dialog has opened: stop. */
    warn,
  };
}

void Promise.all([domReady(), LM.ready]).then(init);
