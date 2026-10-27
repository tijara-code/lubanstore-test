/**
 * LUBAN&MUSK — header: logo ⇄ free-shipping progress (the port of assets/js/header.js).
 * Shared by index.html and checkout.html.
 *
 * It also owns the checkout's free-delivery bar, which is two rows: the progress toward
 * free shipping, and a one-tap add of the next scent the basket has not got. Both live here
 * rather than half here and half in the checkout — one component with two owners is one
 * component whose two halves can disagree about whether it should be on screen.
 *
 * Public: window.lmShip(preview) (see below). Everything else is wired once the page is
 * parsed and the catalogue is known.
 */
import { LM } from "../core";
import type { CartLine, Extra, Scent, Size } from "../core/types";
import { G, KEY, domReady } from "../checkout/contracts";

const SHOW_AFTER = 90; // px scrolled before the bar takes over

/* every shopper-facing string goes through L() — see the core */
const L = (s: string, v?: Record<string, string | number>): string => LM.L(s, v);
const T = (o: unknown, k: string): string => LM.txt(o, k);
/* the mark where the page can render one */
const amount = (n: number): string => LM.moneyHTML(n);
/* NO FALLBACK NUMBER. 300 is the dirham threshold; in Oman free delivery starts at 30, so
   guessing 300 told a Muscat shopper to spend ten times what it actually costs — on the
   loudest element on the page, before the catalogue had even landed. Zero means "not known
   yet", and lmShip() shows nothing rather than a wrong figure; the lm:country listener
   paints it the moment the market is real. */
const freeMin = (): number => (LM.c ? LM.freeOver() : 0);
/* v408: the basket has the set, and the set ships free (LM.setFree, the till's setShipsFree) */
const setFreeNow = (): boolean => !!(LM.c && LM.setFree(lines()));
const esc = (v: unknown): string => LM.esc(v);
const $ = <E extends Element = HTMLElement>(s: string): E | null => document.querySelector<E>(s);

/* (v336) the one safe reader (the core): a null line or a non-array basket threw here and
   took the bar down with it */
const lines = (): CartLine[] => LM.readCart();

/* What the basket holds TOWARD FREE DELIVERY: every line but a sampler's, which is charged
   but does not count (LM.countsFree — the till's own rule). Both bars measure this, so
   neither can say "free" about a basket the till will charge delivery on. */
const counts = (i: CartLine): boolean => !LM.c || LM.countsFree(i);
function cartTotal(): number {
  return lines().reduce((t, i) => {
    if (!counts(i)) return t;
    /* (v336) nor a line that cannot be bought here (an ended offer, a box this market does
       not sell): the till drops it, so the bar said "free delivery" on a basket that pays */
    if (LM.c && !LM.lineOffered(i)) return t;
    const unit = LM.c ? LM.price(i.sizeId) : Number(i.price);
    return t + unit * i.qty;
  }, 0);
}

/* ---------- the next scent to suggest ----------

   Ranked by what actually sells, best first. These are catalogue ids, and the catalogue is
   editable — so a scent the panel adds later is not silently unsuggestable: anything not
   named here is tried after these, in the order the catalogue lists it. */
export const RANK = ["oud", "amber", "lemon"];
const SMALL = "small";
/* THE LARGE BOX STANDS IN when the small one cannot be sold here — a market that has hidden
   it, run out of it, never priced it, or (UAE, 27 Sep) lost it from the catalogue. The scent
   sequence is the same; only the box changes, scent by scent. */
const LARGE = "large";
export function boxFor(scentId: string): string | null {
  const ok = (sz: string): boolean =>
    LM.price(sz) > 0 &&
    LM.lineOffered({ scentId, sizeId: sz } as CartLine) &&
    /* not a box the shelf has taken off the page (v208) */
    !LM.stockHidden(scentId, sz) &&
    /* nor one the basket already holds up to the shelf's cap (v211) */
    !(LM.capRoom(scentId, sz, lines()) === 0);
  return ok(SMALL) ? SMALL : ok(LARGE) ? LARGE : null;
}

/* THE PICTURE IS THE BOX, not the scent's drawing: the small red box or the large white
   one — whichever is being offered — with the scent's chip in its corner. The same two
   layers the cart drawer and the checkout summary draw for a line. LM.img names the
   packshot from a fixed table, so nothing from the catalogue reaches the src. */
function boxArt(scentId: string, sizeId: string): string {
  const base = (LM.root || "") + "assets/img/" + LM.img(sizeId) + "-sm";
  const v = LM.v || "";
  return (
    '<span class="thumb"><picture>' +
    '<source srcset="' + base + ".avif" + v + '" type="image/avif">' +
    '<source srcset="' + base + ".webp" + v + '" type="image/webp">' +
    '<img src="' + base + ".jpg" + v + '" alt="" decoding="async" width="36" height="36">' +
    "</picture>" + LM.scentMark(scentId) + "</span>"
  );
}

function order(): string[] {
  const ids = LM.listFor("scents").map((s) => s.id);
  return RANK.filter((id) => ids.indexOf(id) > -1).concat(ids.filter((id) => RANK.indexOf(id) < 0));
}

/* How many of each scent the basket holds, at any size. The bundle is one of every scent,
   so a basket holding it holds one of each — offering "and one more scent" to somebody who
   has just bought the complete set reads as the shop not paying attention. */
function tally(): Record<string, number> {
  const n: Record<string, number> = {};
  const all = order();
  all.forEach((id) => (n[id] = 0));
  lines().forEach((l) => {
    const q = Math.max(1, Number(l.qty) || 1);
    if (l.sizeId === "bundle" || l.sizeId === "bundle2" || l.scentId === "bundle" || l.scentId === "bundle2") {
      all.forEach((id) => (n[id]! += q));
    } else if (Array.isArray(l.mix)) {
      /* an offer line holds its mix (v310): two oud and a lemon */
      l.mix.forEach((id) => {
        if (n[id] != null) n[id]! += q;
      });
    } else if (l.scentId != null && n[l.scentId] != null) {
      n[l.scentId]! += q;
    }
  });
  return n;
}

/* THE SCENT THE BASKET HAS LEAST OF, among the ones this market can actually sell today,
   ties going to the better seller. From an empty basket: the best seller; once a scent is
   in, the next-best zero wins; one of everything comes back round to the top — it rotates
   until the threshold is reached, which is where paintAdd stops it. Stateless on purpose. */
let boxOf: Record<string, string> = {}; // scentId -> the box it is offered in, this paint
function suggestion(): Scent | null {
  if (!LM.c) return null;
  boxOf = {};
  const scents = LM.listFor("scents");
  const n = tally();
  let best: Scent | null = null;
  order().forEach((id) => {
    const s = scents.filter((x) => x.id === id)[0];
    if (!s) return;
    /* the storefront's own out-of-stock rule, box by box (boxFor) — so the bar can never
       offer what /api/order would refuse */
    const box = boxFor(s.id);
    if (!box) return;
    boxOf[s.id] = box;
    /* strictly fewer, so a tie keeps whichever came first — and order() is the ranking */
    if (!best || n[id]! < n[best.id]!) best = s;
  });
  return best;
}

interface Upgrade {
  from: string;
  to: string;
  line: CartLine;
  mix: string[];
  diff: number;
}

let offered: Scent | null = null; // the scent the button currently stands for
let offeredBox = SMALL; // and the box: small, or large where small cannot be sold
let upgrade: Upgrade | null = null; // or the offer step it stands for (v310), see upgradeOf

/* ONE MORE BOX, AT THE OFFER'S PRICE (v310). A basket holding two large boxes as an offer
   is one box short of three, and three cost the difference — so the row offers that step,
   priced as it. The same for a single large box and the two-box offer. Not for the set. */
function upgradeOf(next: Scent | null): Upgrade | null {
  if (!LM.c || !next) return null;
  const big = LM.tierSize();
  const ok = (sc: string): boolean => !!LM.lineOffered({ scentId: sc, sizeId: big } as CartLine) && !LM.stockHidden(sc, big);
  if (!ok(next.id)) return null;
  const cart = lines();
  let l: CartLine;
  const step = (from: string, to: string, mix: string[]): Upgrade | null => {
    const diff = Math.round((LM.price(to) - LM.price(from)) * 1000) / 1000;
    return diff > 0 ? { from, to, line: l, mix: mix.concat([next.id]), diff } : null;
  };
  for (let i = 0; i < cart.length; i++) {
    l = cart[i]!;
    if (l.sizeId === "duo" && LM.tierOn("trio") && LM.lineOffered(l)) return step("duo", "trio", (l.mix || []).slice());
  }
  for (let i = 0; i < cart.length; i++) {
    l = cart[i]!;
    if (l.sizeId === big && l.scentId && LM.tierOn("duo") && LM.lineOffered(l)) return step(big, "duo", [l.scentId]);
  }
  return null;
}

/* `reached` — the basket already qualifies for free delivery. The row's point is closing
   that gap, so once it is closed the row has nothing left to say. The extras stay. */
function paintAdd(reached: boolean): boolean {
  const btn = $("#freeAdd");
  if (!btn) return false;
  if (reached) {
    offered = null;
    btn.hidden = true;
    return false;
  }
  offered = suggestion();
  if (!offered) {
    btn.hidden = true;
    return false;
  }
  const o: Scent = offered;
  offeredBox = boxOf[o.id] || SMALL;
  upgrade = upgradeOf(o);
  if (upgrade) {
    const big = LM.tierSize();
    const uk = "up-" + o.id + "-" + upgrade.to;
    const uart = $("#faArt")!;
    if (uart.getAttribute("data-k") !== uk) {
      uart.innerHTML = boxArt(o.id, big);
      uart.setAttribute("data-k", uk);
    }
    /* "3 علب" with the scent it adds: "+ عنبر توت" */
    $("#faName")!.textContent = L(upgrade.to === "trio" ? "3 علب" : "علبتان");
    $("#faNote")!.textContent = "+ " + T(o, "name");
    $("#faPrice")!.innerHTML = amount(upgrade.diff);
    btn.hidden = false;
    return true;
  }

  const size: Size | undefined = LM.listFor("sizes").filter((z) => z.id === offeredBox)[0];
  /* only when the scent or the box changed: this runs on every basket change, and
     re-writing the <img> each time would flash it */
  const art = $("#faArt")!;
  const key = o.id + "-" + offeredBox;
  if (art.getAttribute("data-k") !== key) {
    art.innerHTML = boxArt(o.id, offeredBox);
    art.setAttribute("data-k", key);
  }
  $("#faName")!.textContent = T(o, "name");
  $("#faNote")!.textContent = T(size, "weight") || "";
  $("#faPrice")!.innerHTML = amount(LM.price(offeredBox));
  btn.hidden = false;
  return true;
}

function repaintAfterAdd(): void {
  /* the checkout owns the page's copy of the basket; this is the same hand-off the cart
     drawer uses, so items, totals, badge and this bar are all repainted from one place */
  const g = G();
  if (g.lmOnCartChange) g.lmOnCartChange();
  else g.lmShip!(0);
}

function addOffered(): void {
  if (!offered) return;
  if (upgrade) return addUpgrade(upgrade);
  const o = offered;
  const box = offeredBox || SMALL;
  const size = LM.listFor("sizes").filter((z) => z.id === box)[0];
  const cart = lines();
  let hit = false;
  /* `img` is deliberately not stored: the packshot is derived from the size at render time */
  const line: CartLine = {
    scentId: o.id, scent: o.name,
    sizeId: box, size: (size && size.name) || "",
    price: LM.price(box), qty: 1,
  };
  cart.forEach((c) => {
    if (c.scentId === line.scentId && c.sizeId === line.sizeId) {
      c.qty = Math.min(99, c.qty + 1);
      hit = true;
    }
  });
  if (!hit) cart.push(line);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage blocked */
  }
  const g = G();
  if (g.LMPX) g.LMPX.addCart!(line);
  /* its own event name: the whole reason to build a suggestion is to find out whether
     anyone takes it */
  if (g.LMEV) g.LMEV.track("suggest_add", line.scentId + "-" + box);
  repaintAfterAdd();
}

/* the step taken: one of the line it grows from comes off, and the offer line it grows
   into goes on — merged with the same mix if the basket already has it */
function addUpgrade(u: Upgrade): void {
  const cart = lines();
  const src = cart.filter(
    (c) => c.sizeId === u.from && (u.from === "duo" ? LM.itemId(c) === LM.itemId(u.line) : c.scentId === u.line.scentId),
  )[0];
  const g = G();
  if (!src) {
    g.lmShip!(0);
    return;
  }
  src.qty = (Number(src.qty) || 1) - 1;
  if (src.qty <= 0) cart.splice(cart.indexOf(src), 1);
  const tline: CartLine = {
    sizeId: u.to, scentId: null, mix: u.mix, scent: L(u.to === "trio" ? "3 علب" : "علبتان"), size: "",
    price: LM.price(u.to), qty: 1,
  };
  tline.size = LM.lineLabel(tline).size;
  const id = LM.itemId(tline);
  let hit = false;
  cart.forEach((c) => {
    if (LM.isTier(c.sizeId) && LM.itemId(c) === id) {
      c.qty = Math.min(99, c.qty + 1);
      hit = true;
    }
  });
  if (!hit) cart.push(tline);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage blocked */
  }
  if (g.LMPX) g.LMPX.addCart!(tline);
  if (g.LMEV) g.LMEV.track("suggest_add", u.from + ">" + u.to);
  repaintAfterAdd();
}

/* ---------- the shop's add-ons ----------

   The burner and the sampler: products in their own right, priced per market, offered under
   the delivery bar. They do not care about the free-delivery threshold, so they stay when it
   is reached; and `once` means an extra already in the basket stops being offered.
   Escaping: name and note are catalogue strings going into markup (esc), and the image name
   lands in a src (imgName). */
/* a file name, not a path: no slashes, no dots, nothing that can climb out of assets/img */
function imgName(v: unknown): string {
  return /^[a-z0-9-]{1,40}$/i.test(String(v || "")) ? String(v) : "";
}

/* The pictures live in the core (the drawer and the summary draw the same add-ons). What
   this file adds is the greying: the basket's own scents, so a sampler's cluster answers
   "which of these have I not tried" by being looked at. */
function extraTile(x: Extra): string {
  const file = imgName(LM.extraImg(x));
  if (file) {
    const base = (LM.root || "") + "assets/img/" + file + "-sm";
    const v = LM.v || "";
    return (
      '<span class="ex-art"><picture>' +
      '<source srcset="' + base + ".avif" + v + '" type="image/avif">' +
      '<source srcset="' + base + ".webp" + v + '" type="image/webp">' +
      '<img src="' + base + ".jpg" + v + '" alt="" loading="lazy" decoding="async">' +
      "</picture></span>"
    );
  }
  const dim: Record<string, boolean> = {};
  const n = tally();
  Object.keys(n).forEach((id) => {
    if (n[id]! > 0) dim[id] = true;
  });
  const art = LM.extraArt(x, dim);
  /* the cluster is its own frame; a single drawing needs a tile */
  if (art && x.art === "scents") return art;
  if (art) return '<span class="ex-art ex-art-draw">' + art + "</span>";
  /* neither a photograph nor a drawing: a neutral tile rather than a broken <img> */
  return '<span class="ex-art ex-art-none" aria-hidden="true"></span>';
}

/* which extras are already in the basket */
function extrasIn(): Record<string, number> {
  const seen: Record<string, number> = {};
  lines().forEach((l) => {
    if (l && !l.scentId && l.sizeId) seen[l.sizeId] = 1;
  });
  return seen;
}

/* Every scent this market sells is already in the basket: the sampler has nothing to offer. */
function triedEverything(): boolean {
  const list = LM.scents();
  if (!list.length) return false;
  const n = tally();
  return list.every((s) => (n[s.id] || 0) > 0);
}

function extraRow(x: Extra): string {
  return (
    '<button type="button" class="free-add ex-row" data-extra="' + esc(x.id) + '">' +
    extraTile(x) +
    '<span class="fa-txt"><b>' + esc(T(x, "name")) + "</b><em>" + esc(T(x, "note") || "") + "</em></span>" +
    '<span class="fa-cta">' + L("أضف {p}", { p: amount(LM.price(x.id)) }) + "</span>" +
    "</button>"
  );
}

/* TWO SHELVES, not one. The add-ons inside the delivery card are things to buy alongside the
   order; the sampler is about the scents themselves — its own block under the card. */
function paintExtras(): boolean {
  const box = $("#freeExtras");
  const sbox = $("#sampleBox");
  const none = (): boolean => {
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    if (sbox) {
      sbox.hidden = true;
      sbox.innerHTML = "";
    }
    return false;
  };
  if (!box && !sbox) return false;
  if (!LM.c) return none();

  const have = extrasIn();
  const live = LM.extras().filter((x) => !(x.once !== false && have[x.id]));
  let samplers = live.filter((x) => x.art === "scents");
  const rest = live.filter((x) => x.art !== "scents");
  /* nothing left to sample */
  if (triedEverything()) samplers = [];

  if (box) {
    box.innerHTML = rest.map(extraRow).join("");
    box.hidden = !rest.length;
  }
  if (sbox) {
    sbox.innerHTML = samplers.map(extraRow).join("");
    sbox.hidden = !samplers.length;
  }
  /* only the rows INSIDE the delivery card decide whether that card is worth showing */
  return !!rest.length;
}

/* One line, quantity one, carrying its own name and note in the two fields every other line
   uses. `scentId` is deliberately empty: that is what makes LM.itemId return the extra's id. */
function addExtra(id: string | null): void {
  const x = LM.extras().filter((e) => e.id === id)[0];
  if (!x) return;
  const cart = lines();
  let hit = false;
  cart.forEach((c) => {
    if (!c.scentId && c.sizeId === x.id) {
      c.qty = Math.min(99, c.qty + 1);
      hit = true;
    }
  });
  if (!hit) {
    cart.push({ scentId: "", scent: x.name, sizeId: x.id, size: x.note || "", price: LM.price(x.id), qty: 1 });
  }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    /* storage blocked */
  }

  const line = cart.filter((c) => !c.scentId && c.sizeId === x.id)[0];
  const g = G();
  /* the one just added, not the whole line: a second tap is one more */
  if (g.LMPX && line) g.LMPX.addCart!(Object.assign({}, line, { qty: 1 }));
  if (g.LMEV) g.LMEV.track("extra_add", x.id);
  repaintAfterAdd();
}

/* The checkout's own bar, above التوصيل. The same arithmetic and thresholds — painted from
   here rather than from the checkout, because two copies of "how far to free delivery" is
   two things to keep in step. It says the amount in full where the header bar cannot. */
function paintFree(FREE_MIN: number, cart: number, total: number): void {
  const box = $("#freeBar");
  const prog = $("#freeProg");
  const msg = $("#freeMsg");
  const fill = $("#freeFill");
  if (!box || !prog || !msg || !fill) return;

  /* The container hides only when EVERY row has nothing to show. A free-delivery offer at 0:
     every basket already qualifies; v408: or the set is in the basket and ships free. */
  const freeAll = setFreeNow() || (!FREE_MIN && !!(LM.c && LM.freeDeal()));
  const reached = freeAll || (FREE_MIN > 0 && cart >= FREE_MIN);
  const hasAdd = paintAdd(reached);
  const hasExtras = paintExtras();
  const anyRow = hasAdd || hasExtras;

  /* No threshold means no claim — unless a free-delivery offer made EVERY order free. */
  if (!FREE_MIN && !freeAll) {
    prog.hidden = true;
    box.hidden = !anyRow;
    return;
  }
  prog.hidden = false;
  box.hidden = false;

  const pct = freeAll ? 100 : Math.max(0, Math.min(100, Math.round((total / FREE_MIN) * 100)));
  fill.style.width = pct + "%";
  fill.classList.toggle("done", reached);
  box.classList.toggle("free", reached);

  /* One channel for both messages (innerHTML: the amount carries the currency mark), and,
     while still short, why the samples in the basket did not close the gap. */
  const skipped = !reached && lines().some((i) => !counts(i));
  msg.innerHTML = reached
    ? L("التوصيل مجاني على هذا الطلب")
    : L("أضف {p} ليصبح التوصيل مجانيًا", { p: amount(FREE_MIN - total) }) +
      (skipped ? '<span class="free-note">' + L("العينات لا تُحتسب ضمن التوصيل المجاني") + "</span>" : "");
}

/* THE RUNNING LINE (v309): the delivery message and the shop's two lines, each its own item
   with a dot between, scrolling right to left. Two copies end to end: the track slides one
   copy's width and starts again. Written again only when the message changes. */
function run(txt: HTMLElement, msg: string): void {
  const dot = '<span class="ship-dot" aria-hidden="true">·</span>';
  /* each in its own <span>: the copy is a flex box, and loose text beside the currency mark
     would lose the spaces either side of it */
  const seq =
    "<span>" + msg + "</span>" + dot +
    '<span class="ship-x">' + L("تجربة فريدة للأصالة العمانية") + "</span>" + dot +
    '<span class="ship-x">' + L("احجز علبتك الآن") + "</span>" + dot;
  if (txt.getAttribute("data-run") === seq) return;
  txt.setAttribute("data-run", seq);
  txt.innerHTML =
    '<span class="ship-run"><span class="ship-seq">' + seq + "</span>" +
    '<span class="ship-seq" aria-hidden="true">' + seq + "</span></span>";
  /* THE PACE, NOT THE CLOCK (v311): one copy's width at 60 px a second */
  const r = txt.firstChild as HTMLElement | null;
  const w = r && r.firstChild ? (r.firstChild as HTMLElement).getBoundingClientRect().width : 0;
  if (!r || !(w > 0)) return;
  r.style.animationDuration = Math.max(6, Math.round((w / 60) * 10) / 10) + "s";
  /* v400: the loop on a desktop too — as many copies as the bar is wide (the widest this
     window could get) plus one */
  const need = Math.min(10, Math.ceil(Math.max(window.innerWidth || 0, (window.screen && screen.width) || 0) / w) + 1);
  for (let i = 2; i < need; i++) r.appendChild(r.lastChild!.cloneNode(true));
  r.style.setProperty("--ship-w", -w + "px");
}

/* Public: `preview` is the value of the selection currently configured on the page. The bar
   tracks cart + preview, but only says "free" once the CART alone qualifies. Both bars are
   painted from here, the checkout one first. */
function lmShip(preview?: number): void {
  const txt = $("#shipTxt");
  const fill = $("#shipFill");
  const FREE_MIN = freeMin();
  const cart = cartTotal();
  const total = cart + (preview || 0);
  paintFree(FREE_MIN, cart, total);

  if (!txt || !fill) return;
  /* v309: the message runs in a loop until delivery is free; then it stands still */
  const track = fill.parentNode as HTMLElement | null;
  const setFree = setFreeNow();
  const freeNow = setFree || (!FREE_MIN && !!(LM.c && LM.freeDeal())) || (FREE_MIN > 0 && cart >= FREE_MIN);
  if (track && track.classList) track.classList.toggle("free", freeNow);
  /* free on every order while a free-delivery offer at 0 runs — and (v408) on a basket with
     the set in it, when the set ships free */
  if (setFree || (!FREE_MIN && LM.c && LM.freeDeal())) {
    txt.textContent = L("التوصيل مجاني ✓");
    txt.removeAttribute("data-run");
    fill.style.width = "100%";
    fill.classList.add("done");
    txt.classList.add("over");
    return;
  }
  if (!FREE_MIN) {
    txt.textContent = "";
    txt.removeAttribute("data-run");
    fill.style.width = "0%";
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round((total / FREE_MIN) * 100)));
  fill.style.width = pct + "%";

  fill.classList.toggle("done", cart >= FREE_MIN);

  if (cart >= FREE_MIN) {
    txt.textContent = L("التوصيل مجاني ✓");
    txt.removeAttribute("data-run");
  } else {
    /* ALWAYS THE THRESHOLD (v310): the bar is an announcement, not a counter */
    run(txt, L("{p} للتوصيل المجاني", { p: amount(FREE_MIN) }));
  }

  /* flip label to white once the gold fill reaches it */
  txt.classList.toggle("over", pct >= 55);
}
G().lmShip = lmShip;

/* THE LANGUAGE SWITCH is two plain links (EN / عربي). This only records the choice and
   carries the rest of the address across, so a chosen country (?country=) survives. */
function initLang(): void {
  const sw = document.querySelector(".lang");
  if (!sw) return;
  sw.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    const a = t && t.closest ? t.closest("a[data-lang]") : null;
    if (!a || a.getAttribute("aria-current")) return;
    try {
      localStorage.setItem("lm_lang", a.getAttribute("data-lang") || "");
    } catch {
      /* storage blocked */
    }
    const q = location.search.replace(/([?&])lang=\w+(&|$)/, (_m, x: string, y: string) => (y ? x : "")).replace(/[?&]$/, "");
    if (!q) return;
    e.preventDefault();
    const href = a.getAttribute("href") || "";
    location.href = href + (href.indexOf("?") > -1 ? "&" : "?") + q.slice(1) + location.hash;
  });
}

function init(): void {
  initLang();
  /* Bound once, on the element: the row is repainted on every change, and a listener added
     each time would fire once per repaint (the third tap would add three boxes). */
  const add = $("#freeAdd");
  if (add) add.addEventListener("click", addOffered);
  /* the suggestion never offers a box the shelf has just taken off the page (v209).
     Checkout only — the one page with the row. */
  if (add) window.addEventListener("lm:stock", () => G().lmShip!(0));

  /* Delegated, on BOTH containers (the rows are rewritten on every repaint). */
  const tap = (e: Event): void => {
    const t = e.target as Element | null;
    const b = t && t.closest ? t.closest("[data-extra]") : null;
    if (b) addExtra(b.getAttribute("data-extra"));
  };
  ["#freeExtras", "#sampleBox"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("click", tap);
  });

  const hdr = $("#hdr");
  if (!hdr) return;

  let on = false;
  const check = (): void => {
    const next = window.scrollY > SHOW_AFTER;
    if (next !== on) {
      on = next;
      hdr.classList.toggle("alt", on);
    }
  };
  window.addEventListener("lm:country", () => G().lmShip!(0));
  window.addEventListener("scroll", check, { passive: true });
  check();

  G().lmShip!(0);
}

void Promise.all([domReady(), LM.ready]).then(init);

