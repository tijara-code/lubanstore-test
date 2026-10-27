/**
 * THE GALLERY: three fixed frames (IMAGES) in a scrolled strip, and their thumbnails.
 */
import { LM } from "../core";
import { IMAGES, rtl, st } from "./state";
import { toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);
/* read once, when the page module loads, as main.js did */
const TITLE = L("لبان صلالة معطر");
const IMG = LM.root + "assets/img/";

export const gal: { slides: HTMLElement | null; thumbs: HTMLElement | null; lock: boolean; built: boolean } = {
  slides: null,
  thumbs: null,
  lock: false,
  built: false,
};

function pic(name: string, suf: string, eager: boolean): string {
  const big = !suf;
  return (
    "<picture>" +
    '<source srcset="' + IMG + name + suf + ".avif" + LM.v + '" type="image/avif">' +
    '<source srcset="' + IMG + name + suf + ".webp" + LM.v + '" type="image/webp">' +
    '<img src="' + IMG + name + suf + ".jpg" + LM.v + '" alt="' + TITLE + '" decoding="async" ' +
    (eager ? 'fetchpriority="high"' : 'loading="lazy"') +
    ' width="' + (big ? 1080 : 320) + '" height="' + (big ? 1080 : 320) + '"></picture>'
  );
}

export function buildGallery(): void {
  const slides = gal.slides!, thumbs = gal.thumbs!;
  /* THE FIRST PICTURE IS ALREADY ON THE PAGE — the HTML carries it, so it can paint before any
     script. The first build keeps that very element and adds the others after it (v204: a
     fresh copy restarted its decode, and the largest thing on the page painted late). */
  let keep: Element | null = null;
  if (!gal.built && slides.children.length === 1) {
    const im = slides.firstElementChild!.querySelector("img");
    if (im && (im.getAttribute("src") || "").indexOf("/" + IMAGES[0] + ".") > -1) keep = slides.firstElementChild;
  }
  if (!keep) slides.innerHTML = "";
  thumbs.innerHTML = "";

  IMAGES.forEach((name, i) => {
    if (!(i === 0 && keep)) {
      const s = document.createElement("div");
      s.className = "gal-slide";
      s.innerHTML = pic(name, "", i === 0);
      slides.appendChild(s);
    }
    const t = document.createElement("button");
    t.type = "button";
    t.setAttribute("aria-label", L("صورة {n}", { n: toAr(i + 1) }));
    t.setAttribute("aria-current", String(i === 0));
    t.innerHTML = pic(name, "-sm", false);
    t.addEventListener("click", () => go(i));
    thumbs.appendChild(t);
  });

  st.slide = 0;
  /* A REBUILT strip goes back to its first picture. The first build skips it: assigning
     scrollLeft forces a full layout in the middle of building the page (v204). */
  if (gal.built) slides.scrollLeft = 0;
  gal.built = true;
}

export function go(i: number): void {
  /* pickSize can reach this before the gallery is built: the scroll needs a live element */
  const slides = gal.slides;
  if (!slides) return;
  gal.lock = true;
  if (slides.scrollTo) {
    slides.scrollTo({ left: i * slides.clientWidth * (rtl() ? -1 : 1), behavior: "smooth" });
  }
  mark(i);
  setTimeout(() => {
    gal.lock = false;
  }, 420);
}

export function mark(i: number): void {
  st.slide = i;
  Array.prototype.forEach.call(gal.thumbs!.children, (el: Element, k: number) => {
    el.setAttribute("aria-current", String(k === i));
  });
}

export function onScroll(): void {
  const slides = gal.slides!;
  if (gal.lock || !slides.clientWidth) return;
  const i = Math.round(Math.abs(slides.scrollLeft) / slides.clientWidth);
  if (i !== st.slide) mark(i);
}

/* (v438) THE OPEN BOX ON EVERY VISIT. Safari puts a scrolled strip back where it was on a
   reload and on a return from its cache. The first picture is the default, every time —
   moved only when the strip has moved (a scrollLeft written at 0 lays the page out). */
export function galleryHome(): void {
  const slides = gal.slides!;
  if (slides.scrollLeft) slides.scrollLeft = 0;
  if (st.slide !== 0) mark(0);
}
