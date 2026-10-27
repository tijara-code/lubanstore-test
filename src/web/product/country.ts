/**
 * THE COUNTRY: the market select (#cty), what a change of market or of the shelf redraws
 * (lm:country, lm:stock — the core's events), and the select's place in the header (v337/v400).
 */
import { LM } from "../core";
import { esc } from "../core/util";
import { badge } from "./add";
import { buildSizes, paintLeft, syncAdd } from "./grid";
import { ingest } from "./ingest";
import { shownScents } from "./rules";
import { buildOffer } from "./set";
import { $, G, P, read, st } from "./state";
import { buildFreeBar, sync } from "./sync";

export function initCountry(): void {
  const sel = $<HTMLSelectElement>("#cty");
  if (!sel) return;
  sel.innerHTML = LM.countries()
    .map(
      (c) =>
        '<option value="' + esc(c.code) + '"' + (c.code === LM.c.code ? " selected" : "") + ">" +
        (c.flag ? esc(c.flag) + " " : "") + esc(LM.txt(c, "name")) + "</option>",
    )
    .join("");
  sel.addEventListener("change", () => LM.setCountry(sel.value));

  /* what the shelf takes off the page, as drawn now (see lm:stock) */
  const hideKey = () =>
    P.SIZES.map((s) => s.id).join() +
    "|" +
    P.SCENTS.map((sc) => P.SIZES.map((s) => (LM.stockHidden && LM.stockHidden(sc.id, s.id) ? sc.id + "-" + s.id : "")).join()).join();
  let hideWas = hideKey();

  window.addEventListener("lm:country", () => {
    /* the new country brings its own sizes, scents and stock flags */
    ingest();
    /* a size chosen in the old country may not exist in the new one — or may be sold out
       there. The new market's own copy of the size is kept, not the old one's. */
    if (st.size) {
      const now = P.SIZES.filter((s) => s.id === st.size!.id)[0];
      if (!now || now.soldOut) {
        st.size = null;
        P.QTY = {};
      } else st.size = now;
    }
    buildSizes();
    /* the counts carried over are on the rows again — so is the add button (v209) */
    syncAdd();
    /* and the page as drawn is the one the next shelf reading is compared with (v209) */
    hideWas = hideKey();
    buildOffer();
    buildFreeBar();
    sync();
    const g = G();
    if (g.lmCart) g.lmCart.refresh!();
    badge();
  });

  /* THE SHELF CHANGED (v206/v208). The number beside the size is rewritten in place. If what
     the page hides changed too, the sizes are drawn again the way a country change draws them.
     Nothing a shopper can BUY changes: a hidden box in the basket still goes through. */
  window.addEventListener("lm:stock", () => {
    ingest();
    /* a cap that fell under what is counted on the rows (v211): the count comes down to it */
    let clamped = false;
    Object.keys(P.QTY).forEach((id) => {
      Object.keys(P.QTY[id]!).forEach((sc) => {
        const room = LM.capRoom ? LM.capRoom(sc, id, read()) : null;
        if (room != null && P.QTY[id]![sc]! > room) {
          P.QTY[id]![sc] = room;
          clamped = true;
        }
      });
    });
    const now = hideKey();
    if (now === hideWas) {
      paintLeft();
      if (clamped) {
        buildSizes();
        syncAdd();
        sync();
      }
      return;
    }
    hideWas = now;
    if (st.size) {
      const still = P.SIZES.filter((s) => s.id === st.size!.id)[0];
      if (!still) {
        st.size = null;
        P.QTY = {};
      } else st.size = still;
    }
    /* a box that just left the page takes its count with it (v209) */
    Object.keys(P.QTY).forEach((id) => {
      const sz = P.SIZES.filter((s) => s.id === id)[0];
      if (!sz) {
        delete P.QTY[id];
        return;
      }
      const keep: Record<string, number> = {};
      shownScents(sz).forEach((sc) => {
        keep[sc.id] = 1;
      });
      Object.keys(P.QTY[id]!).forEach((sc) => {
        if (!keep[sc]) delete P.QTY[id]![sc];
      });
    });
    buildSizes();
    syncAdd();
    sync();
    buildOffer();
  });
}

/* THE DESKTOP HEADER (v337, desktop.css): from 768px (v400) the country sits with the language
   and the basket at the header's end; below that it goes back beside the name. The same
   <select> moves, so its listeners and its value go with it. */
export function placeCountry(): void {
  const cty = $("#cty"), bar = document.querySelector<HTMLElement>(".hdr-bar");
  const lang = bar && bar.querySelector(".lang"), cart = bar && bar.querySelector(".cart");
  if (!cty || !bar || !lang || !cart || !window.matchMedia) return;
  const mq = window.matchMedia("(min-width: 768px)");
  const home = cty.parentNode!, next = cty.nextSibling;
  /* v400: the end of the bar — the country, the language, the basket */
  const box = document.createElement("div");
  box.className = "hdr-end";
  const put = () => {
    if (mq.matches) {
      if (cty.parentNode === box) return;
      bar.insertBefore(box, lang);
      box.appendChild(cty);
      box.appendChild(lang);
      box.appendChild(cart);
    } else if (cty.parentNode === box) {
      home.insertBefore(cty, next);
      bar.insertBefore(lang, box);
      bar.insertBefore(cart, box);
      bar.removeChild(box);
    }
  };
  put();
  if (mq.addEventListener) mq.addEventListener("change", put);
  else if ((mq as MediaQueryList & { addListener?: (f: () => void) => void }).addListener) mq.addListener(put);
}
