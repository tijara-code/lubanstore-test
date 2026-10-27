/**
 * Into the basket: the chosen scents (one line each) or the chosen offer (one "trio:…" line),
 * their events (pixel.js's LMPX.addCart, stats.js's LMEV.track), the flying icons, the basket
 * badge and the button's "added" moment.
 */
import { LM } from "../core";
import type { CartLine } from "../core";
import { buildSizes, syncAdd } from "./grid";
import { dropDeadTier, picked, tierNeed } from "./rules";
import { $, G, IMAGES, KEY, P, qOf, read, st, type PScent, type PSize } from "./state";
import { sync } from "./sync";
import { tierName, toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

/* ---------- fly to cart ----------
   Clones the scent's own icon out of its row and arcs it up to the cart. Fixed positioning
   against the viewport, outside the layout. The clone always removes itself — on animationend,
   and again on a timer, because animationend never fires if the tab is hidden mid-flight. */
function accentOf(el: HTMLElement): string {
  let v = "";
  try {
    v = el.style && el.style.getPropertyValue ? el.style.getPropertyValue("--accent") : "";
  } catch {
    /* read it back the other way */
  }
  if (!v) {
    const m = /--accent:\s*([^;"]+)/.exec(el.getAttribute("style") || "");
    v = m ? m[1]! : "";
  }
  return v.trim() || "var(--gold)";
}

function flyToCart(scentId: string, delay: number, scope: ParentNode | undefined): void {
  try {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    /* from the panel it was added from */
    const row = (scope || document).querySelector('.prow[data-scent="' + scentId + '"]');
    const art = row && row.querySelector<HTMLElement>(".prow-art");
    const cart = document.querySelector(".cart");
    if (!art || !cart) return;

    const from = art.getBoundingClientRect();
    const to = cart.getBoundingClientRect();
    if (!from.width || !to.width) return;

    const fly = document.createElement("span");
    fly.className = "fly";
    fly.innerHTML = art.innerHTML;
    fly.style.cssText =
      "left:" + from.left + "px;top:" + from.top + "px;" +
      "width:" + from.width + "px;height:" + from.height + "px;" +
      "--dx:" + (to.left + to.width / 2 - (from.left + from.width / 2)) + "px;" +
      "--dy:" + (to.top + to.height / 2 - (from.top + from.height / 2)) + "px;" +
      "--accent:" + accentOf(art) + ";" +
      "animation-delay:" + (delay || 0) + "ms";
    document.body.appendChild(fly);

    const done = () => {
      if (fly.parentNode) fly.parentNode.removeChild(fly);
      const c = document.querySelector<HTMLElement>(".cart");
      if (c) {
        c.classList.remove("pop");
        void c.offsetWidth;
        c.classList.add("pop");
      }
    };
    fly.addEventListener("animationend", done);
    setTimeout(done, (delay || 0) + 1200); /* belt and braces */
  } catch {
    /* decoration must never break adding to the cart */
  }
}

export function badge(): void {
  const n = read().reduce((t, i) => t + i.qty, 0);
  const el = $("#cartCount");
  if (el) {
    el.textContent = toAr(n);
    el.hidden = n === 0;
  }
  const ic = document.querySelector(".cart");
  if (ic) {
    ic.classList.toggle("filled", n > 0);
    ic.setAttribute("aria-label", L("السلة") + (n ? " (" + toAr(n) + ")" : ""));
  }
  /* checkout button wakes up only once there is something to pay for */
  const co = $("#goCheckout");
  if (co) {
    co.classList.toggle("on", n > 0);
    co.setAttribute("aria-disabled", String(n === 0));
  }
}

/* Adds every scent that has a quantity, as its own cart line — each fires its own ADD_CART
   (one lumped event would misreport both the items and the value). */
export function addPicked(btn: HTMLButtonElement, size?: PSize | null): void {
  const sz = size || st.size;
  if (!sz) return;
  /* (v336) never single boxes out of an offer that just ended */
  if (dropDeadTier()) {
    buildSizes();
    sync();
    return;
  }
  const chosen = picked(sz);
  if (!chosen.length) return;

  const cart = read();
  /* the catalogue's own words, not the escaped copies the page draws with: a basket line is
     TEXT, and every reader escapes it where it is drawn */
  const raw = (kind: string, id: string) => {
    const x = (LM.listFor(kind) as Array<{ id: string; name?: string }>).filter((v) => v && v.id === id)[0];
    return x ? String(x.name || "") : "";
  };
  const g = G();
  /* AN OFFER IS ONE LINE (v303): the mix, in the market's order, as one "trio:oud.oud.amber"
     — the same mix again is the same line */
  const need = tierNeed(sz);
  if (need) {
    const mix: string[] = [];
    chosen.forEach((sc) => {
      for (let k = 0; k < qOf(sz.id, sc.id); k++) mix.push(sc.id);
    });
    if (mix.length !== need) return;
    const tline: CartLine = {
      sizeId: st.tier!, scentId: null, mix: mix,
      scent: tierName(st.tier), size: "",
      price: LM.price(st.tier!), qty: 1, img: IMAGES[0],
    };
    tline.size = LM.lineLabel(tline).size;
    const tid = LM.itemId(tline);
    let thit = false;
    cart.forEach((c) => {
      if (LM.isTier(c.sizeId) && LM.itemId(c) === tid) {
        c.qty = Math.min(99, c.qty + 1);
        thit = true;
      }
    });
    if (!thit) cart.push(tline);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(cart));
    } catch {
      /* storage blocked */
    }
    if (g.LMPX) g.LMPX.addCart!(tline);
    if (g.LMEV) g.LMEV.track!("add_cart", st.tier!);
    return afterAdd(btn, sz, chosen);
  }
  const lines = chosen.map((sc) => {
    const line: CartLine = {
      scentId: sc.id, scent: raw("scents", sc.id),
      sizeId: sz.id, size: raw("sizes", sz.id),
      price: LM.price(sz.id), qty: qOf(sz.id, sc.id), img: IMAGES[0],
    };
    let hit = false;
    cart.forEach((c) => {
      /* the till takes at most 99 of a line */
      if (c.scentId === line.scentId && c.sizeId === line.sizeId) {
        c.qty = Math.min(99, c.qty + line.qty);
        hit = true;
      }
    });
    if (!hit) cart.push(line);
    return line;
  });

  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage blocked */
  }
  if (g.LMPX) lines.forEach((l) => g.LMPX!.addCart!(l));
  if (g.LMEV) lines.forEach((l) => g.LMEV!.track!("add_cart", l.scentId + "-" + l.sizeId));

  afterAdd(btn, sz, chosen);
}

/* what follows any add: the counts back to zero, the icons fly, the badge and the button say so */
function afterAdd(btn: HTMLButtonElement, sz: PSize, chosen: PScent[]): void {
  /* Every quantity back to zero, so the next tap cannot silently re-add what was just added.
     THE COUNTER IS OPTIONAL: a sold-out scent renders no stepper. THIS size's counts only. */
  delete P.QTY[sz.id];
  const wrap = P.PICK[sz.id];
  (wrap || document).querySelectorAll(".prow").forEach((r) => {
    r.classList.remove("on");
    const count = r.querySelector("[data-count]");
    if (count) count.textContent = toAr(0);
  });

  /* one flying icon per scent, staggered, before the counter moves */
  chosen.forEach((sc, i) => flyToCart(sc.id, i * 110, wrap));

  badge();
  syncAdd();
  sync();
  const g = G();
  if (g.lmCart) g.lmCart.refresh!();

  if (btn && !btn.dataset.busy) {
    const was = btn.innerHTML;
    btn.dataset.busy = "1";
    btn.textContent = L("تمت الإضافة ✓");
    btn.classList.add("ok");
    btn.disabled = true;
    /* the button just took focus with it: hand focus to the basket (its name carries the
       count) and say what happened */
    const live = $("#addLive");
    if (live) {
      live.textContent = "";
      setTimeout(() => {
        live.textContent = L("تمت الإضافة ✓");
      }, 60);
    }
    if (document.activeElement === document.body || document.activeElement === btn) {
      const ic2 = document.querySelector<HTMLElement>(".cart");
      if (ic2) ic2.focus({ preventScroll: true });
    }
    setTimeout(() => {
      btn.innerHTML = was;
      btn.classList.remove("ok");
      delete btn.dataset.busy;
      syncAdd();
    }, 1600);
  }
}
