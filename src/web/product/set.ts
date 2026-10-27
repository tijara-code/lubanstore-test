/**
 * THE THREE-SCENT SET ("bundle"): three SMALL boxes, one of each scent — the only way the
 * small size is sold (v309). Drawn into #offer (made by ./grid.ts) as one row in the look of
 * the large offers; on the stacked page it is a choice like the large rows (v403). Its window,
 * markets, copy and price are set in /admin > Catalogue. The large set ("bundle2") is retired:
 * the store never offers it.
 */
import { LM } from "../core";
import type { CartLine, Offer } from "../core";
import { badge } from "./add";
import { buildSizes, syncAdd } from "./grid";
import { clean } from "./ingest";
import { stacked } from "./rules";
import { $, G, IMAGES, KEY, P, phoneGrid, read, st } from "./state";
import { sync } from "./sync";
import { blendName, money, perBox, setFreeLeft, sizeLabel, toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

export interface OfferKey {
  key: string;
  box: string;
}
export const OFFERS: OfferKey[] = [{ key: "bundle", box: "offer" }];

/* The wake-up's handle, per card, cleared before every rebuild (a second timer writing the
   same node would stutter). v312: the set shows no countdown, so there is no ticker — the
   window is kept by the one wake-up in buildOne. */
const clockTimer: Record<string, ReturnType<typeof setTimeout> | null> = {};

/* THE SET'S FREE-DELIVERY CLOCK (v411), watched every half minute; when it ends, the set's row
   is drawn again without the badge and the delivery bars follow (the till has already stopped). */
let sfTick: ReturnType<typeof setInterval> | null = null;
function runSetFreeClock(): void {
  if (sfTick) return;
  sfTick = setInterval(() => {
    const el = document.getElementById("setFreeClock");
    if (!el) {
      clearInterval(sfTick!);
      sfTick = null;
      return;
    }
    if (document.hidden) return;
    if (!(LM.setShipsFree && LM.setShipsFree())) {
      clearInterval(sfTick!);
      sfTick = null;
      buildSizes();
      syncAdd();
      sync();
      if (G().lmShip) G().lmShip!(0);
      return;
    }
    const left = setFreeLeft();
    if (left && el.textContent !== left) el.textContent = left;
  }, 30000);
}

/* THE SMALL SIZE FOLLOWED THE BUNDLE (v309 to v334). Kept as a hook (buildOffer asks it
   first); v335: the tile no longer follows the set, so there is nothing to redraw here. */
function syncBundleSize(): boolean {
  return false;
}

export function buildOffer(): void {
  if (syncBundleSize()) return;
  OFFERS.forEach(buildOne);
}

type Box = HTMLElement & { __sig?: string };

export function buildOne(k: OfferKey): void {
  const box = $<Box>("#" + k.box);
  if (!box) return;
  const stop = () => {
    const h = clockTimer[k.key];
    if (h) {
      clearTimeout(h);
      clearInterval(h);
      clockTimer[k.key] = null;
    }
  };
  /* v335: the card round the set (.s3-bundle) hides with it */
  const parent = box.parentNode as HTMLElement | null;
  const wrap = parent && parent.classList && parent.classList.contains("s3-bundle") ? parent : null;
  const off = () => {
    stop();
    box.hidden = true;
    box.innerHTML = "";
    box.__sig = "";
    if (wrap) wrap.hidden = true;
  };
  const o = LM.offer(k.key);
  if (!o) {
    off();
    return;
  }
  /* the bundle is one of every scent: it cannot be sold while it cannot be packed here — the
     server refuses it too */
  if (!LM.bundleSellable(k.key)) {
    off();
    return;
  }
  /* (v336) the basket already holds as many of one of its boxes as the shelf's cap allows: the
     card stays, its button does not add */
  const room = LM.lineRoom ? LM.lineRoom({ sizeId: k.key, scentId: k.key } as CartLine, read()) : null;
  const full = room != null && room < 1;

  const id = k.key;
  const now = LM.price(id);
  const was = LM.was(id);
  const n = P.SCENTS.length || 3;
  const bsz = P.SIZES.filter((z) => z.id === LM.bundleSize())[0];
  const badgeTxt = LM.txt(o, "badge");
  const shotSrc = ((window.LM && LM.root) || "") + "assets/img/" + LM.img(LM.bundleSize()) + "-sm";
  const v = LM.v || "";

  /* (v336) the scents it is packed from right now, not every one */
  const inSet: Record<string, number> = {};
  (LM.bundleScents ? LM.bundleScents(id) : P.SCENTS).forEach((sc) => {
    inSet[sc.id] = 1;
  });
  const scents = P.SCENTS.filter((sc) => inSet[sc.id])
    .map(
      (sc) =>
        /* (v415) "×1", one box of each scent in the set; CSS moves it to the row's far end */
        '<span class="ob-scent"><i class="scent-art" style="color:' + sc.accent + '">' + sc.art + "</i>" +
        '<em class="ob-n"><bdi dir="ltr">×1</bdi></em>' + blendName(sc) + "</span>",
    )
    .join("");
  /* NO COUNTDOWN ON THE SET (v312): stacked under the large offers it is the row alone; on its
     own it keeps its heading. The wake-up below takes it off the page when the till stops. */
  const bare = stacked();
  /* (v403) ON THE STACKED PAGE THE SET IS A CHOICE, like the large rows */
  const pick = bare, on = pick && !!st.set;
  const fOver = LM.freeOver ? LM.freeOver() : 0;
  /* v408: or the set's own switch says it ships free (LM.setShipsFree) */
  const setFree = (fOver > 0 && now >= fOver) || !!(LM.setShipsFree && LM.setShipsFree());
  /* v411: the switch's own countdown beside the badge, only while the switch (not the
     threshold) makes it free */
  const sfClock = !(fOver > 0 && now >= fOver) && setFree ? setFreeLeft() : null;
  if (sfClock) runSetFreeClock();
  const html =
    (bare ? "" : '<div class="tiers-head"><h3>' + L("جرّب الروائح الثلاث") + "</h3></div>") +
    '<div class="ob-card">' +
    (badgeTxt ? '<em class="tier-badge">' + clean(badgeTxt) + "</em>" : "") +
    (pick
      ? '<label class="ob-row">' +
        '<input type="radio" name="tier" value="bundle"' + (on ? " checked" : "") + ' aria-label="' +
        clean(LM.txt(o, "name") + (bsz ? " · " + sizeLabel(bsz) : "") + " · " + money(now)) + '">'
      : '<div class="ob-row">') +
    '<span class="tier-shot" aria-hidden="true"><picture>' +
    '<source srcset="' + shotSrc + ".avif" + v + '" type="image/avif">' +
    '<source srcset="' + shotSrc + ".webp" + v + '" type="image/webp">' +
    '<img src="' + shotSrc + ".jpg" + v + '" alt="" loading="lazy" decoding="async" width="62" height="62"></picture>' +
    '<b dir="ltr">×' + n + "</b></span>" +
    '<span class="tier-txt"><b class="offer-name">' + clean(LM.txt(o, "name")) + "</b>" +
    /* (v404) on the stacked page, short and in the large rows' shape: "الحجم الصغير · 3 × 100 جم" */
    "<span>" +
    (pick && bsz
      ? L("{s} · {n} × {w}", { s: sizeLabel(bsz), n: toAr(n), w: bsz.weight })
      : L("{n} علب صغيرة · {w} لكل علبة", { n: toAr(n), w: bsz ? bsz.weight : "100 جم" })) +
    "</span>" +
    /* (v404) on the stacked page, no price a box: "توصيل مجاني" when the set ships free */
    (pick
      ? setFree
        ? '<span class="tier-free"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>' +
          L("توصيل مجاني") +
          (sfClock ? ' <em class="sf-left" id="setFreeClock">' + sfClock + "</em>" : "") +
          "</span>"
        : ""
      : "<span>" + L("{p} للعلبة", { p: perBox(now / n, n) + " " + LM.moneyMark() }) + "</span>") +
    "</span>" +
    '<span class="tier-price"><b>' + LM.moneyHTML(now) + "</b>" +
    (was > now ? "<s>" + LM.moneyHTML(was) + "</s>" : "") + "</span>" +
    (pick ? "</label>" : "</div>") +
    '<div class="ob-scents" aria-hidden="true">' + scents + "</div>" +
    '<button type="button" class="btn btn-offer" id="addOffer"' + (full ? " disabled" : "") + ">" +
    (full ? L("نفدت الكمية") : L("أضف الباقة إلى السلة")) + "</button>" +
    "</div>";

  /* NOTHING CHANGED, NOTHING REDRAWN (v204). An identical card (same markup, same offer) is
     left as it is — redrawing replaced the button under a finger that might be on it. */
  const ms = LM.offerLeftMs(k.key);
  const sig = html + "\u0001" + JSON.stringify(o);
  /* (v403) chosen or not: the frame and what shows under the row */
  const mark = () => {
    const c = box.querySelector(".ob-card");
    if (!c) return;
    c.classList.toggle("pick", pick);
    c.classList.toggle("on", on);
  };
  mark();
  if (!box.hidden && box.__sig === sig && (ms == null || clockTimer[k.key])) return;
  stop();
  box.hidden = false;
  if (wrap) wrap.hidden = false;
  box.innerHTML = html;
  box.__sig = sig;
  mark();

  $("#addOffer")!.addEventListener("click", function (this: HTMLButtonElement) {
    addOffer(this, o, k.key);
  });
  /* (v403) choosing the set: the large rows let go of their choice and their half-picked
     scents, and the page is drawn again with the set open */
  const radio = box.querySelector<HTMLInputElement>('input[name="tier"]');
  /* (v440) on a phone the chosen set stays chosen too: these run before the let-go below */
  if (radio)
    radio.addEventListener("keydown", (e) => {
      if (phoneGrid() && st.set && (e.key === " " || e.key === "Spacebar")) e.stopImmediatePropagation();
    });
  const setRow0 = box.querySelector<HTMLElement>(".ob-row");
  if (radio && setRow0)
    setRow0.addEventListener("click", (e) => {
      if (phoneGrid() && st.set) e.stopImmediatePropagation();
    });
  /* (v407) Space on the chosen set lets go too, as on the large rows */
  if (radio)
    radio.addEventListener("keydown", (e) => {
      if (!st.set || (e.key !== " " && e.key !== "Spacebar")) return;
      e.preventDefault();
      st.set = false;
      buildSizes();
      syncAdd();
      sync();
      const back = $("#offer") && $("#offer")!.querySelector<HTMLElement>('input[name="tier"]');
      if (back) back.focus({ preventScroll: true });
    });
  /* (v406) the set tapped again while chosen lets go, as the large rows do */
  const setRow = box.querySelector<HTMLElement>(".ob-row");
  if (radio && setRow)
    setRow.addEventListener("click", (e) => {
      if (!st.set) return;
      e.preventDefault();
      st.set = false;
      buildSizes();
      syncAdd();
      sync();
    });
  if (radio)
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      st.set = true;
      st.tier = null;
      delete P.QTY[LM.tierSize()];
      if (st.size) delete P.QTY[st.size.id];
      buildSizes();
      syncAdd();
      sync();
      const again = $("#offer") && $("#offer")!.querySelector<HTMLElement>('input[name="tier"]');
      if (again) again.focus({ preventScroll: true });
    });

  /* one wake-up at the window's end (a day at most, then again), so the set leaves the page
     when the till stops selling it — never a tick that redraws the card under a finger */
  if (ms != null)
    clockTimer[k.key] = setTimeout(() => {
      clockTimer[k.key] = null;
      buildOffer();
    }, Math.min(ms + 500, 864e5));
}

/* a bundle is one cart line priced as its own id, so every re-price downstream (drawer,
   shipping bar, checkout) keeps working untouched */
function addOffer(btn: HTMLButtonElement, o: Offer, key: string): void {
  key = key || "bundle";
  /* asked again at the tap: the card may have outlived its window */
  if (!LM.offer(key) || !LM.bundleSellable(key)) {
    buildOffer();
    return;
  }
  /* (v336) and under the shelf's caps, every box the set packs */
  const room = LM.lineRoom ? LM.lineRoom({ sizeId: key, scentId: key } as CartLine, read()) : null;
  if (room != null && room < 1) {
    buildOffer();
    return;
  }
  const id = key;
  const cart = read();
  let hit = false;
  cart.forEach((c) => {
    if (c.sizeId === id) {
      c.qty = Math.min(99, c.qty + 1);
      hit = true;
    }
  });
  const line = {
    scentId: id, scent: o.name,
    sizeId: id, size: o.note,
    price: LM.price(id), qty: 1, img: IMAGES[0],
  };
  if (!hit) cart.push(line);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage blocked: the core's stand-in has it */
  }
  const g = G();
  if (g.LMPX) g.LMPX.addCart!(line);
  if (g.LMEV) g.LMEV.track!("offer_add", id);

  badge();
  sync();
  if (g.lmCart) g.lmCart.refresh!();

  const icon = $(".cart");
  if (icon) {
    icon.classList.remove("pop");
    void icon.offsetWidth;
    icon.classList.add("pop");
  }

  if (btn && !btn.dataset.busy) {
    const was = btn.innerHTML;
    btn.dataset.busy = "1";
    btn.textContent = L("تمت الإضافة ✓");
    btn.classList.add("ok");
    /* same guard as addPicked: a double-tap is one set, not two */
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = was;
      btn.classList.remove("ok");
      btn.disabled = false;
      delete btn.dataset.busy;
      /* (v336) that set may have taken the last room under a cap */
      buildOffer();
    }, 1600);
  }
}
