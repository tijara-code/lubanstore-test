/**
 * THE SIZES AND THE SCENTS (#sizes): the size tiles, the large-box offers' list (v303) with
 * its countdown, the chosen offer's scent grid with its steppers and add button, and the
 * three-scent set's card (drawn by ./set.ts into the box made here).
 *
 * One picker, not two: the shopper chooses a size (or an offer), and the panel under it holds
 * every scent with its own quantity.
 */
import { LM } from "../core";
import { esc } from "../core/util";
import { addPicked } from "./add";
import { go } from "./gallery";
import { perks } from "./perks";
import {
  dropDeadTier,
  keptOpen,
  firstBuyable,
  openSizes,
  picked,
  scentShut,
  shownScents,
  sizeTotal,
  smallSize,
  stacked,
  tierCountText,
  tierNeed,
  tiersHere,
  tileWords,
  pickedCount,
} from "./rules";
import { buildOne, OFFERS } from "./set";
import { $, P, phoneGrid, qOf, read, SIZE_SLIDE, st, type PSize } from "./state";
import { sync } from "./sync";
import { blendName, leftWords, money, perBox, sizeLabel, tierLeft, tierName, toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

/* the size's own box, as the cart draws it — LM.img names the file from a fixed table, so
   nothing from the catalogue reaches the src */
function shot(sz: PSize): string {
  const base = ((window.LM && LM.root) || "") + "assets/img/" + LM.img(sz.id) + "-sm";
  const v = LM.v || "";
  return (
    '<span class="sz-shot" aria-hidden="true"><picture>' +
    '<source srcset="' + base + ".avif" + v + '" type="image/avif">' +
    '<source srcset="' + base + ".webp" + v + '" type="image/webp">' +
    '<img src="' + base + ".jpg" + v + '" alt="" loading="lazy" decoding="async" width="54" height="54">' +
    "</picture></span>"
  );
}

export function paintLeft(): void {
  /* the tiles say what is left of each size (v312) */
  if (document.querySelectorAll) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-left]"), (t: HTMLElement) => {
      const id = t.getAttribute("data-left"),
        z = P.SIZES.filter((x) => x.id === id)[0];
      if (z) t.textContent = tileWords(z);
      /* (v405) a count in red-orange; the weight stays as it was */
      if (t.classList) t.classList.toggle("is-left", !!z && (LM.stockLeft ? LM.stockLeft(id!) || 0 : 0) > 0);
    });
  }
  const el = document.getElementById("sizeLeft");
  if (!el || !st.size) return;
  const w = leftWords(LM.stockLeft ? LM.stockLeft(st.size.id) : null);
  el.textContent = w;
  el.hidden = !w;
}

/* ==========================================================
   THE LARGE-BOX OFFERS (v303) — "the list", above the chosen size's grid: one box, two
   boxes, three for the price of two. Choosing an offer sets how many scents the grid below
   takes (any mix, repeats allowed); the add button waits until that many are picked and puts
   ONE line in the basket — "trio:oud.oud.amber" — priced by the till.
   ========================================================== */
const TIER_ROWS: Array<[string, number]> = [["trio", 3], ["duo", 2], ["single", 1]]; /* v309: three boxes first */

let tierTick: ReturnType<typeof setInterval> | null = null;
function runTierClock(): void {
  if (tierTick) return;
  tierTick = setInterval(() => {
    /* the offers left the page: nothing to watch */
    if (!document.querySelector(".tiers")) {
      clearInterval(tierTick!);
      tierTick = null;
      return;
    }
    if (document.hidden) return; /* hours and days: a check every half minute is plenty */
    /* the end arrived: the offers leave the page, as they leave the till */
    if (!LM.tierLive()) {
      clearInterval(tierTick!);
      tierTick = null;
      buildSizes();
      syncAdd();
      sync();
      return;
    }
    /* the pill, while the panel shows one (v312: optional) */
    const el = document.getElementById("tierClock");
    if (!el) return;
    const left = tierLeft();
    if (el.textContent !== left) el.textContent = left;
  }, 30000);
}

function buildTiers(sz: PSize, plain?: boolean): HTMLElement | null {
  /* (v403) plain: the large bundle offer is off — the large box is the one-box row alone, in
     the same design, with no heading or clock */
  const rows: Array<[string, number]> = plain ? [["single", 1]] : TIER_ROWS.filter((t) => t[0] === "single" || LM.tierOn(t[0]));
  if (rows.length < 2 && !plain) return null;
  if (st.tier && st.tier !== "single" && !LM.tierOn(st.tier)) st.tier = null;
  /* nothing chosen at first while the scents open in a pop-up (v312) */
  if (!st.tier && !stacked()) {
    st.tier = LM.tierOn("trio") ? "trio" : rows[rows.length - 1]![0];
  }
  /* (v440) ON A PHONE THE LARGE SIZE OPENS CHOSEN, its scents showing, unless the set is the
     chosen row (the owner's request); a desktop keeps v406's "nothing chosen at first" */
  if (!st.tier && !st.set && phoneGrid()) {
    st.tier = LM.tierOn("trio") ? "trio" : rows[rows.length - 1]![0];
  }
  const one = LM.price(sz.id);
  const over = LM.freeOver ? LM.freeOver() : 0;
  const shotSrc = ((window.LM && LM.root) || "") + "assets/img/" + LM.img(sz.id) + "-sm";
  const v = LM.v || "";
  const sec = document.createElement("section");
  sec.className = "tiers" + (plain ? " tiers-plain" : "");
  sec.setAttribute("aria-label", plain ? sizeLabel(sz) : L("عروض الحجم الكبير"));
  /* the countdown pill is the panel's choice (v312); the window ends the offers either way */
  let clock = LM.tierClockShown() ? tierLeft() : null;
  if (plain) clock = null;
  let html = plain
    ? '<div class="tiers-list" role="radiogroup" aria-label="' + sizeLabel(sz) + '">'
    : '<div class="tiers-head"><h3>' + L("كلما زدت، وفّرت") + "</h3>" +
      /* the days in words, the hours as a clock — two pieces, so the clock's digits keep
         their order inside an Arabic line */
      (clock
        ? '<span class="tiers-clock"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>' +
          "<span>" + L("ينتهي العرض خلال") + "</span>" +
          '<span id="tierClock">' + clock + "</span></span>"
        : "") +
      "</div>" +
      '<div class="tiers-list" role="radiogroup" aria-label="' + L("عروض الحجم الكبير") + '">';
  rows.forEach((t) => {
    const id = t[0], n = t[1];
    const price = id === "single" ? one : LM.price(id);
    /* (v404) the single box shows its own struck price too, as the offers do */
    const was = id === "single" ? LM.was(sz.id) : LM.tierWas(id);
    const on = st.tier === id && !st.set;
    const free = over > 0 && price >= over && one < over;
    html +=
      '<label class="tier' + (on ? " on" : "") + '" data-tier="' + id + '">' +
      (id === "trio" ? '<em class="tier-badge">' + L("الأكثر توفيرًا") + "</em>" : "") +
      /* (v407) a clean spoken name: what it is, the size, the price */
      '<input type="radio" name="tier" value="' + id + '"' + (on ? " checked" : "") +
      ' aria-label="' + esc(tierName(id) + " · " + sizeLabel(sz) + " · " + money(price)) + '">' +
      '<span class="tier-shot" aria-hidden="true"><picture>' +
      '<source srcset="' + shotSrc + ".avif" + v + '" type="image/avif">' +
      '<source srcset="' + shotSrc + ".webp" + v + '" type="image/webp">' +
      '<img src="' + shotSrc + ".jpg" + v + '" alt="" loading="lazy" decoding="async" width="54" height="54"></picture>' +
      '<b dir="ltr">×' + n + "</b></span>" +
      /* (v417) the single box is named by its size, its weight under it; the offers keep
         "علبتان" / "3 علب" */
      '<span class="tier-txt"><b>' + (n > 1 ? tierName(id) : sizeLabel(sz)) + "</b>" +
      /* (v404) the size and its weight: "الحجم الكبير · 300 جم" */
      '<span class="tier-size">' + (n > 1 ? L("{s} · {w} لكل علبة", { s: sizeLabel(sz), w: sz.weight }) : sz.weight) + "</span>" +
      /* (v417) the price a box only where there is more than one box */
      (n > 1 ? "<span>" + L("{p} للعلبة", { p: perBox(price / n, n) + " " + LM.moneyMark() }) + "</span>" : "") +
      (free
        ? '<span class="tier-free"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>' +
          L("توصيل مجاني") + "</span>"
        : "") +
      "</span>" +
      '<span class="tier-price"><b>' + LM.moneyHTML(price) + "</b>" +
      (was > price ? "<s>" + LM.moneyHTML(was) + "</s>" : "") + "</span>" +
      "</label>";
  });
  sec.innerHTML = html + "</div>";
  /* (v440) ON A PHONE A CHOSEN ROW STAYS CHOSEN: a second tap, or Space, does what a radio
     does and nothing more. These run first and keep the let-go below (a desktop's, v406,
     v407) from seeing it. */
  sec.addEventListener("click", (e) => {
    if (!phoneGrid()) return;
    const tg = e.target as Element | null;
    const row = tg && tg.closest ? tg.closest(".tier") : null;
    if (row && row.getAttribute("data-tier") === st.tier && !st.set) e.stopImmediatePropagation();
  });
  sec.addEventListener("keydown", (e) => {
    if (!phoneGrid() || (e.key !== " " && e.key !== "Spacebar")) return;
    const r = e.target as HTMLInputElement | null;
    if (r && r.name === "tier" && r.checked && st.tier === r.value && !st.set) e.stopImmediatePropagation();
  });
  /* (v406) A CHOSEN ROW TAPPED AGAIN LETS GO: nothing chosen, its scents and their counts with
     it. A radio never unchecks itself, so the tap is caught before the browser re-checks it. */
  sec.addEventListener("click", (e) => {
    if (!stacked()) return;
    const tg = e.target as Element | null;
    const row = tg && tg.closest ? tg.closest(".tier") : null;
    if (!row) return;
    const tid = row.getAttribute("data-tier");
    if (!tid || st.tier !== tid || st.set) return;
    e.preventDefault();
    st.tier = null;
    delete P.QTY[sz.id];
    buildSizes();
    syncAdd();
    sync();
  });
  /* (v407) and from the keyboard: Space on the chosen row (the browser sends no click) */
  sec.addEventListener("keydown", (e) => {
    if (!stacked() || (e.key !== " " && e.key !== "Spacebar")) return;
    const r = e.target as HTMLInputElement | null;
    if (!r || r.name !== "tier" || !r.checked || st.tier !== r.value || st.set) return;
    e.preventDefault();
    const was = r.value;
    st.tier = null;
    delete P.QTY[sz.id];
    buildSizes();
    syncAdd();
    sync();
    const again = document.querySelector<HTMLElement>('.tier[data-tier="' + was + '"] input');
    if (again) again.focus({ preventScroll: true });
  });
  sec.addEventListener("change", (e) => {
    const r = e.target as HTMLInputElement | null;
    if (!r || r.name !== "tier") return;
    st.tier = r.value;
    st.set = false; /* (v403) a large row, not the set */
    /* a new count: the picks start again */
    delete P.QTY[sz.id];
    /* (v336) the rebuild replaces the radio under the keyboard: focus goes back to the chosen
       offer's new radio */
    const had = document.activeElement === r || document.activeElement === document.body;
    buildSizes();
    syncAdd();
    sync();
    const again = had && document.querySelector<HTMLElement>('.tier[data-tier="' + st.tier + '"] input');
    if (again) again.focus({ preventScroll: true });
  });
  if (!plain) runTierClock();
  return sec;
}

/** the bundle's own box (#offer), drawn into by buildOne (v309) */
function bundleBox(): HTMLElement {
  const sec = document.createElement("section");
  sec.className = "offer-a";
  sec.id = "offer";
  sec.hidden = true;
  sec.setAttribute("aria-label", L("باقة الروائح الثلاث"));
  return sec;
}

/* Style 3: the photo tiles, then the chosen size's grid */
function buildPhotoSizes(box: HTMLElement): void {
  box.setAttribute("role", "group");
  if (!P.SIZES.length) {
    box.innerHTML = '<p class="none-here">' + L("لا تتوفر أحجام للشحن إلى بلدك حاليا.") + "</p>";
    return;
  }
  if (stacked()) return buildStacked(box);
  if (!st.size || st.size.soldOut) st.size = firstBuyable();

  const row = document.createElement("div");
  row.className = "sz-tiles";
  row.setAttribute("role", "radiogroup");
  /* TWO COLUMNS AT LEAST (v205): a market left with one size keeps the tile's width */
  row.style.setProperty("--n", String(Math.max(2, Math.min(3, P.SIZES.length))));
  P.SIZES.forEach((sz) => {
    const on = !!(st.size && st.size.id === sz.id), shut = sz.soldOut;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "size tile" + (on ? " open" : "") + (shut ? " shut" : "");
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(on));
    if (shut) {
      /* grey, and not a choice: disabled so it takes no focus and no tap */
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
    }
    b.innerHTML =
      (shut
        ? '<em class="tile-tag out">' + L("نفدت الكمية") + "</em>"
        : sz.tag
          ? '<em class="tile-tag" style="--tag:' + sz.tagColor + '">' + sz.tag + "</em>"
          : "") +
      '<span class="tile-tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12.8 9.3 18 20 6.6"/></svg></span>' +
      shot(sz).replace('class="sz-shot"', 'class="sz-shot tile-shot"') +
      /* v309: no price on the size tiles; v311: the weight alone */
      '<span class="tile-name">' + sz.weight + "</span>";
    if (!shut) b.addEventListener("click", () => pickSize(sz.id));
    row.appendChild(b);
  });
  box.appendChild(row);

  const sz = st.size;
  if (!sz) return;
  /* THE SMALL SIZE IS THE BUNDLE (v309): its card holds the bundle's row where the scents
     would be — no single small box */
  if (sz.id === LM.bundleOnlySize()) {
    const bcard = document.createElement("div");
    bcard.className = "szcard open s3card s3-bundle";
    bcard.appendChild(bundleBox());
    /* and the market's six points under it (v311) */
    const bpts = document.createElement("div");
    bpts.className = "s3-bundle-pts";
    bpts.innerHTML = perks();
    bcard.appendChild(bpts);
    box.appendChild(bcard);
    buildOne(OFFERS[0]!);
    return;
  }
  /* the offers, between the tiles and the grid they fill (v303) */
  const tiersEl = tiersHere(sz) ? buildTiers(sz) : null;
  if (tiersEl) box.appendChild(tiersEl);
  const nowP = LM.price(sz.id), wasP = LM.was(sz.id);
  const card = document.createElement("div");
  card.className = "szcard open s3card";
  /* .s3-lbl heads the grid with the size it fills (v203); beside it, what is left (v206) */
  const left = leftWords(LM.stockLeft ? LM.stockLeft(sz.id) : null);
  card.innerHTML =
    '<div class="s3card-head"><span class="s3-lbl">' + sizeLabel(sz) + "</span>" +
    '<span class="s3-left" id="sizeLeft"' + (left ? "" : " hidden") + ">" + left + "</span>" +
    '<span class="sz-id"><span class="sz-name">' + sz.name + "</span>" +
    '<span class="sz-wt">' + sz.weight + "</span></span>" +
    (wasP > nowP ? '<em class="sz-save">' + L("وفر {p}", { p: LM.moneyHTML(wasP - nowP) }) + "</em>" : "") +
    "</div>";
  card.appendChild(buildPicker(sz));
  /* the shop still sells the single small box: the bundle's row sits ABOVE its scents (v309) */
  const withBundle = sz.id === LM.bundleSize();
  if (withBundle) {
    const bwrap = document.createElement("div");
    bwrap.className = "s3-bundle";
    bwrap.appendChild(bundleBox());
    box.appendChild(bwrap);
  }
  box.appendChild(card);
  if (withBundle) buildOne(OFFERS[0]!);
}

/* v312 — see stacked() */
function buildStacked(box: HTMLElement): void {
  /* the market's six points, above the sizes (v312) */
  const top = $("#ptsTop");
  if (top) {
    top.innerHTML = perks();
    top.hidden = false;
  }
  const setCard = () => {
    /* always drawn: hidden with the set while it is off (buildOne) */
    const bcard = document.createElement("div");
    bcard.className = "szcard open s3card s3-bundle s3-bundle-under";
    bcard.appendChild(bundleBox());
    box.appendChild(bcard);
    buildOne(OFFERS[0]!);
  };
  const only = smallSize();
  const big = P.SIZES.filter((z) => z.id !== only && !z.soldOut)[0] || null;
  st.size = big;
  /* (v403) the set was chosen and has since gone: nothing stays chosen */
  if (st.set && !(LM.bundleOpen && LM.bundleOpen())) st.set = false;

  /* the tiles: pictures, not choices — each says what is left of it */
  const row = document.createElement("div");
  row.className = "sz-tiles sz-tiles-still";
  row.style.setProperty("--n", String(Math.max(2, Math.min(3, P.SIZES.length))));
  P.SIZES.forEach((sz) => {
    const t = document.createElement("div");
    t.className = "size tile still" + (sz.soldOut ? " shut" : "");
    t.innerHTML =
      (sz.soldOut ? '<em class="tile-tag out">' + L("نفدت الكمية") + "</em>" : "") +
      shot(sz).replace('class="sz-shot"', 'class="sz-shot tile-shot"') +
      '<span class="tile-name" data-left="' + sz.id + '">' + tileWords(sz) + "</span>";
    const tn = t.querySelector && t.querySelector(".tile-name");
    if (tn && tn.classList) tn.classList.toggle("is-left", (LM.stockLeft ? LM.stockLeft(sz.id) || 0 : 0) > 0);
    row.appendChild(t);
  });
  box.appendChild(row);

  if (big) {
    /* (v403) with the large bundle offer off, the large box is the one-box row of the same
       list, never the bare grid */
    let tiersEl = tiersHere(big) ? buildTiers(big) : null;
    if (!tiersEl) {
      /* (v406) nothing chosen at first, as with the offers */
      tiersEl = buildTiers(big, true);
    }
    const card = document.createElement("div");
    card.className = "szcard open s3card s3-big";
    if (tiersEl) {
      /* THE SCENTS OPEN UNDER THE CHOSEN OFFER (v312), and nowhere until one is chosen */
      box.appendChild(tiersEl);
      /* (v406) no row chosen: the scents are drawn but wait hidden */
      if (!(st.tier && tiersEl.querySelector('.tier[data-tier="' + st.tier + '"]'))) {
        const idle = document.createElement("div");
        idle.className = "szcard open s3card s3-big";
        idle.hidden = true;
        idle.appendChild(buildPicker(big, true));
        box.appendChild(idle);
      }
      const onRow = st.tier ? tiersEl.querySelector('.tier[data-tier="' + st.tier + '"]') : null;
      if (onRow) {
        card.className += " tier-scents";
        card.appendChild(buildPicker(big, true));
        if (!onRow.parentNode) box.appendChild(card); /* a row outside any list: never on a real page */
        else onRow.parentNode.insertBefore(card, onRow.nextSibling);
      }
      /* the three-scent set directly under the large offers */
      setCard();
    } else {
      /* a market with no offer price: the scents on the page, as before */
      setCard();
      card.appendChild(buildPicker(big, true));
      box.appendChild(card);
    }
  } else setCard();
}

export function buildSizes(): void {
  dropDeadTier();
  const box = $("#sizes")!;
  /* (v438) THE PICTURES STAY. The grid is drawn afresh on every choice; on iOS a new <img>
     decodes its picture again and every photo blinked. The pictures already on the grid are
     kept, by their address, and put back into the new markup in place of the fresh copies. */
  const kept: Record<string, Element[]> = {};
  Array.prototype.forEach.call(box.querySelectorAll("picture"), (p: Element) => {
    const im = p.querySelector("img"), k = im && im.getAttribute("src");
    if (k) (kept[k] = kept[k] || []).push(p); /* a tile and a row share a box's photo */
  });
  box.innerHTML = "";
  P.PICK = {};
  box.classList.add("s3");
  buildPhotoSizes(box);
  Array.prototype.forEach.call(box.querySelectorAll("picture"), (p: Element) => {
    const im = p.querySelector("img"), k = im && im.getAttribute("src"), old = k && kept[k] && kept[k]!.shift();
    if (old && p.parentNode) p.parentNode.replaceChild(old, p);
  });
  /* the button's words belong to the grid just drawn */
  syncAdd();
}

function buildPicker(sz: PSize, noPoints?: boolean): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "picker";
  /* ids on the one panel only */
  const one = !keptOpen(sz);
  if (one) wrap.id = "picker";
  wrap.setAttribute("data-size", sz.id);
  P.PICK[sz.id] = wrap;

  /* THE MIDDLE CELL IS ALWAYS THERE, mark or no mark: it takes the row's spare width, so every
     row's stepper lines up with the others */
  const mid = (inner: string) => '<span class="prow-mid">' + (inner || "") + "</span>";

  const rows = shownScents(sz)
    .map((sc) => {
      const q = qOf(sz.id, sc.id);
      if (scentShut(sc, sz)) {
        /* out of THIS size: the words where the stepper would be */
        return (
          '<div class="prow shut" data-scent="' + sc.id + '">' +
          '<span class="prow-art" style="--accent:' + sc.accent + '">' + sc.art + "</span>" +
          '<span class="prow-txt"><b>' + blendName(sc) + "</b></span>" +
          mid("") +
          '<em class="sz-tag out">' + L("نفدت الكمية") + "</em></div>"
        );
      }
      /* THE BADGE FIRST, THEN THE RATING — the rating lines up down the column */
      let mark = "";
      if (sc.tag) mark += '<em class="sz-tag" style="--tag:' + sc.tagColor + '">' + sc.tag + "</em>";
      if (sc.stars > 0) {
        /* (v425) three leaves in solid gold, the figure for screen readers; (v432) the last
           leaf, the one on the left, half filled under 4.6 */
        const LEAF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.2 3.8C10.5 3.8 3.8 10.5 3.8 20.2c9.7 0 16.4-6.7 16.4-16.4Z"/></svg>';
        const FIRST = sc.stars < 4.6 ? '<i class="lv-half">' + LEAF + LEAF + "</i>" : LEAF;
        mark += '<span class="sc-rate sc-leaves" role="img" aria-label="' + L("{n} من 5", { n: sc.stars }) + '">' + FIRST + LEAF + LEAF + "</span>";
      }
      /* (v415) each row by the blend's own name */
      return (
        '<div class="prow' + (q ? " on" : "") + '" data-scent="' + sc.id + '">' +
        '<span class="prow-art" style="--accent:' + sc.accent + '">' + sc.art + "</span>" +
        '<span class="prow-txt"><b>' + blendName(sc) + "</b></span>" +
        mid(mark) +
        '<span class="qty sm">' +
        '<button type="button" data-step="-1" aria-label="' + L("إنقاص") + " " + sc.name + '">−</button>' +
        '<b data-count aria-live="polite" aria-atomic="true">' + toAr(q) + "</b>" +
        '<button type="button" data-step="1" aria-label="' + L("زيادة") + " " + sc.name + '">+</button>' +
        "</span></div>"
      );
    })
    .join("");

  wrap.innerHTML =
    (noPoints ? "" : perks()) +
    /* v312: no count over the rows — the button carries "اختر روائح 0/3" */
    '<div class="prows">' + rows + "</div>" +
    '<button class="btn add-btn"' + (one ? ' id="add"' : "") + ' type="button" disabled>' +
    '<span class="add-lbl"' + (one ? ' id="addLabel"' : "") + ">" + L("اختر رائحة") + "</span></button>";

  wrap.addEventListener("click", (e) => {
    const tg = e.target as Element;
    const step = tg.getAttribute && tg.getAttribute("data-step");
    if (!step) return;
    const row = tg.closest(".prow");
    if (!row) return;
    bump(sz, row.getAttribute("data-scent")!, +step);
  });
  const btn = wrap.querySelector<HTMLButtonElement>(".add-btn")!;
  btn.addEventListener("click", function (this: HTMLButtonElement) {
    addPicked(this, sz);
  });
  return wrap;
}

function bump(sz: PSize, scentId: string, by: number): void {
  /* (v336) the offer ended between ticks: redraw, count nothing */
  if (dropDeadTier()) {
    buildSizes();
    sync();
    return;
  }
  const m = P.QTY[sz.id] || (P.QTY[sz.id] = {});
  /* an offer takes its number of scents and no more (v303) */
  const need = tierNeed(sz);
  if (need && by > 0 && pickedCount(sz) >= need) return;
  let q = Math.max(0, Math.min(20, (m[scentId] || 0) + by));
  /* capped at the shelf (v211): no more than is available, counting what the basket holds */
  const room = LM.capRoom ? LM.capRoom(scentId, sz.id, read()) : null;
  const capped = room != null && q > room;
  if (capped) q = room!;
  m[scentId] = q;

  const wrap = P.PICK[sz.id];
  const row = wrap && wrap.querySelector('.prow[data-scent="' + scentId + '"]');
  if (row && capped) capNote(row, room!);
  if (row) {
    const count = row.querySelector("[data-count]");
    if (count) count.textContent = toAr(q);
    row.classList.toggle("on", q > 0);
  }
  syncAdd();
  sync();
}

/* "باقي 3 فقط" in the row's middle cell for a moment, when the stepper stops at the shelf
   (v211); "نفدت الكمية" at 0 */
function capNote(row: Element, room: number): void {
  const mid = row.querySelector(".prow-mid");
  if (!mid) return;
  let em = mid.querySelector(".cap-note") as (HTMLElement & { _t?: ReturnType<typeof setTimeout> }) | null;
  if (!em) {
    em = document.createElement("em");
    em.className = "sz-tag out cap-note";
    mid.appendChild(em);
  }
  const e = em;
  e.textContent = room > 0 ? L("باقي {n} فقط", { n: room }) : L("نفدت الكمية");
  clearTimeout(e._t);
  e._t = setTimeout(() => {
    if (e.parentNode) e.parentNode.removeChild(e);
  }, 2200);
}

/* the button only becomes real once something is actually chosen */
export function syncAdd(): void {
  openSizes().forEach((sz) => {
    const wrap = P.PICK[sz.id];
    const btn = wrap && wrap.querySelector<HTMLButtonElement>(".add-btn");
    if (!btn) return;
    const n = picked(sz).reduce((t, sc) => t + qOf(sz.id, sc.id), 0);
    const need = tierNeed(sz);
    const label = btn.querySelector(".add-lbl");
    if (need) {
      /* an offer: complete, or say how many are still to choose */
      btn.disabled = n < need;
      const rest = need - n;
      if (label) {
        label.textContent =
          rest <= 0
            ? need === 2
              ? L("أضف علبتين · {p}", { p: money(LM.price(st.tier!)) })
              : L("أضف {n} علب · {p}", { n: toAr(need), p: money(LM.price(st.tier!)) })
            : tierCountText(sz); /* v312: "اختر روائح 0/3", 1/3 … on the button itself */
      }
      return;
    }
    btn.disabled = n === 0;
    if (label) {
      label.textContent = n === 0 ? L("اختر رائحة") : L("أضف إلى السلة · {p}", { p: money(sizeTotal(sz)) });
    }
  });
}

export function pickSize(id: string): void {
  const sz = P.SIZES.filter((x) => x.id === id)[0];
  if (!sz) return;
  /* second gate: the row is disabled, but pickSize is also reached from elsewhere */
  if (sz.soldOut) return;
  /* THE OPEN GRID FOLDS NOTHING */
  if (keptOpen(sz)) {
    st.size = sz;
    const g = SIZE_SLIDE[id];
    if (g != null && g !== st.slide) go(g);
    sync();
    return;
  }
  /* with the photo tiles one size is always chosen and its grid always shown */
  if (st.size && st.size.id === id) return;
  st.size = sz;
  P.QTY = {};
  /* show the box they just picked, so the photo and the row agree */
  const f = SIZE_SLIDE[id];
  if (f != null && f !== st.slide) go(f);
  buildSizes();
  syncAdd();
  sync();
}

