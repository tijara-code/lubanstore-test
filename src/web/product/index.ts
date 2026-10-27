/**
 * LUBAN & MUSK — the product page (the port of assets/js/main.js), on index.html and the
 * generated en/index.html. Imported by src/web/entries/home.ts after the core (and after the
 * other page scripts, in the original's script order).
 *
 * The page meets the other page scripts only through what the original used: window events
 * (lm:country, lm:stock from the core; lm:cart from the drawer) and window globals (LMPX from
 * pixel.js, LMEV from stats.js, lmCart from cart.js, lmShip from header.js), read at call time.
 *
 * Modules: state (shared state), words (wording), ingest (the catalogue's one door), perks,
 * gallery, rules, grid (sizes, offers, scents), set (the three-scent set), add (into the
 * basket), sync (price, delivery copy, the free-delivery strip), country, track, reel.
 */
import { LM } from "../core";
import { badge } from "./add";
import { initCountry, placeCountry } from "./country";
import { buildGallery, gal, galleryHome, onScroll } from "./gallery";
import { buildSizes, pickSize } from "./grid";
import { ingest } from "./ingest";
import { initAnimIdle, initClip, initReelArrows, initSteps, initSticky } from "./reel";
import { allOpen, keptOpen, smallSize, stacked } from "./rules";
import { buildOffer } from "./set";
import { $, G, P, st } from "./state";
import { buildFreeBar, sync } from "./sync";
import { initTrack } from "./track";

/* ---------- offer countdown ----------
   The set's card is re-asked just after midnight, and whenever the tab is brought back (a
   phone asleep through the rollover: background timers are throttled). */
function initOfferClock(): void {
  /* the bundle is drawn in the sizes (v309), so the page with the sizes is the page with it */
  if (!$("#sizes")) return;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) buildOffer();
  });
  window.addEventListener("focus", buildOffer);
  (function schedule() {
    const now = new Date(LM.now());
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => {
      buildOffer();
      schedule();
    }, midnight.getTime() - now.getTime());
  })();
}

function init(): void {
  gal.slides = $("#slides");
  gal.thumbs = $("#thumbs");

  badge();
  buildSizes();
  buildOffer();
  buildFreeBar();
  buildGallery();
  sync();

  gal.slides!.addEventListener("scroll", onScroll, { passive: true });
  /* (v438) the open box on every visit (Safari restores a scrolled strip) */
  window.addEventListener("load", galleryHome);
  window.addEventListener("pageshow", galleryHome);
  /* (v336) the drawer changed the basket: the set's button follows the room left under the caps */
  window.addEventListener("lm:cart", buildOffer);

  /* the sticky bar adds nothing — it scrolls the shopper to the choice */
  $("#stickyAdd")!.addEventListener("click", () => {
    /* (v336) the stacked page: to the offers, or the set when they are gone */
    if (stacked()) {
      const set = $("#offer");
      const to = $(".tiers") || (set && !set.hidden ? set : null) || $("#sizes");
      if (to) to.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const sizes = $("#sizes");
    if (sizes) sizes.scrollIntoView({ behavior: "smooth", block: "center" });
    /* the first size that can actually be bought AND folds */
    if (!st.size && !allOpen()) {
      const first = P.SIZES.filter((s) => !s.soldOut && !keptOpen(s))[0];
      if (first) pickSize(first.id);
    }
  });

  /* explicit navigation — never rely on the anchor alone */
  const co = $("#goCheckout");
  if (co) {
    co.addEventListener("click", (e) => {
      e.preventDefault();
      if (co.classList.contains("on")) window.location.href = "checkout.html";
    });
  }

  initSticky();
  initAnimIdle();
  initSteps();
  initClip();
  initReelArrows();
  initOfferClock();
  initTrack();
  $("#year")!.textContent = String(new Date().getFullYear());
}

/* ---------- boot ---------- */
const domReady = new Promise<void>((res) => {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => res());
  else res();
});

/** what the page's boot finished (tests wait on it) */
export const pageReady: Promise<void> = (() => {
  domReady.then(placeCountry);
  return Promise.all([domReady, LM.ready]).then(() => {
    ingest();
    /* nothing preselected: the picker is closed until a size is tapped */
    st.size = null;
    initCountry();
    init();
    /* Report the cheapest box the page sells, matching the "from" price on screen (SIZES is
       biggest first, so the last entry); not the small box, sold only as the set (v309).
       SCENTS can be empty — a market with every scent switched off. */
    const sellable = P.SIZES.filter((s) => !s.soldOut && s.id !== smallSize());
    const pool = sellable.length ? sellable : P.SIZES;
    const from = pool[pool.length - 1];
    const g = G();
    if (g.LMPX && from && P.SCENTS[0]) g.LMPX.viewContent!(from.id, P.SCENTS[0].id);
  });
})();
