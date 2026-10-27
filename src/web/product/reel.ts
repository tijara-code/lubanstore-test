/**
 * MOTION AND MEDIA: the sticky bar's appearance, endless animations idled off screen (v204),
 * the preparation steps' pop cycle, the showcase reel (five clips as a looping, stacked strip
 * that loads ahead of arrival and plays only what is seen), and the reel's desktop arrows (v337).
 */
import { $ } from "./state";

/* ---------- sticky ---------- */
export function initSticky(): void {
  const bar = $("#sticky"), anchor = $("#sizes");
  if (!bar || !anchor || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(
    (e) => {
      const up = !e[0]!.isIntersecting && e[0]!.boundingClientRect.top < 0;
      bar.classList.toggle("show", up);
    },
    { threshold: 0 },
  ).observe(anchor);
}

/* ---------- motion only where it can be seen (v204) ----------
   The reel's nudging dot pauses while the reel is off screen and carries on from the same
   frame when it comes back. */
export function initAnimIdle(): void {
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((es) => {
    es.forEach((e) => e.target.classList.toggle("anim-idle", !e.isIntersecting));
  });
  ["#reel"].forEach((id) => {
    const el = $(id);
    if (el) io.observe(el);
  });
}

/* ---------- preparation steps ----------
   The pop cycle lives entirely in CSS; this only decides when it may run. */
export function initSteps(): void {
  const list = $(".step-list");
  if (!list) return;
  if (!("IntersectionObserver" in window)) {
    list.classList.add("playing");
    return;
  }
  new IntersectionObserver(
    (e) => {
      list.classList.toggle("playing", e[0]!.isIntersecting);
    },
    { threshold: 0.25 },
  ).observe(list);
}

/* THE REEL WITH A MOUSE (v337): two arrows (shown by desktop.css) step the strip one card, the
   way a swipe does. "Next" follows the reading direction: leftwards in Arabic. */
export function initReelArrows(): void {
  const track = $("#reelTrack"), prev = $("#reelPrev"), next = $("#reelNext");
  if (!track || !prev || !next) return;
  const step = (dir: number) => {
    const cards = track.querySelectorAll<HTMLElement>(".reel-slide");
    const w = cards.length > 1 ? Math.abs(cards[1]!.offsetLeft - cards[0]!.offsetLeft) : track.clientWidth / 3;
    const rtl = (document.documentElement.getAttribute("dir") || "rtl") === "rtl";
    try {
      track.scrollBy({ left: (rtl ? -1 : 1) * dir * w, behavior: "smooth" });
    } catch {
      track.scrollLeft += (rtl ? -1 : 1) * dir * w;
    }
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
}

type Clip = HTMLVideoElement & { __poster?: boolean; __src?: boolean; __cur?: boolean };

/* ---------- the showcase reel ----------
   Two questions decide what plays, each with its own observer: WHICH CARDS ARE IN VIEW inside
   the strip (the strip as root) and IS THE REEL ON SCREEN AT ALL. Loading is done ahead of
   arrival: half a screen before the reel, every poster and the clips that will be on screen;
   a card within one card-width of the visible ones is warmed; nothing beyond that costs a
   byte. A card whose files are not there removes itself. Reduced motion: still frames, and
   the clips are never fetched. */
export function initClip(): void {
  const track = $("#reelTrack");
  const reel = $("#reel");

  /* A DIFFERENT ORDER EVERY VISIT: Fisher–Yates over the figures, re-appended in the new
     order; the strip's own spacers are pseudo-elements and stay put. */
  let figs: Element[] | undefined;
  if (track && track.children) {
    figs = [];
    for (let f = 0; f < track.children.length; f++) {
      const el = track.children[f]!;
      if (el.classList && el.classList.contains("reel-slide")) figs.push(el);
    }
    for (let s = figs.length - 1; s > 0; s--) {
      const j = Math.floor(Math.random() * (s + 1));
      const t = figs[s]!;
      figs[s] = figs[j]!;
      figs[j] = t;
    }
    /* ONE CLIP OPENS THE STRIP: a card marked data-first is moved to the slot the strip opens
       on (the middle real card); the others are still dealt at random around it */
    for (let fi = 0; fi < figs.length; fi++) {
      if (figs[fi]!.hasAttribute && figs[fi]!.hasAttribute("data-first")) {
        const mid = figs.length > 2 ? Math.floor((figs.length - 1) / 2) : 0;
        const ff = figs[mid]!;
        figs[mid] = figs[fi]!;
        figs[fi] = ff;
        break;
      }
    }
    for (let a = 0; a < figs.length; a++) track.appendChild(figs[a]!);
  }

  /* NO LAST CARD: IT GOES ROUND. Two copies of the far end before the first, two of the first
     after the last; each copy carries its original's index in data-clone. */
  let pre = 0;
  if (track && figs && figs.length > 2) {
    const n = figs.length;
    pre = 2;
    for (let c = n - 2; c < n; c++) {
      const head = figs[c]!.cloneNode(true) as Element;
      head.setAttribute("data-clone", String(c));
      track.insertBefore(head, figs[0]!);
    }
    for (let c2 = 0; c2 < 2; c2++) {
      const tail = figs[c2]!.cloneNode(true) as Element;
      tail.setAttribute("data-clone", String(c2));
      track.appendChild(tail);
    }
  }

  const list = document.querySelectorAll<Clip>(".clip-v");
  if (!list.length) return;
  /* the card the strip opens on: the middle REAL one, past the copies at the head */
  const real = list.length - 2 * pre;
  const start = real > 2 ? pre + Math.floor((real - 1) / 2) : 0;

  /* one dot per REAL clip; a copy lights its original's dot */
  const dots = $("#reelDots");
  let dotEls: HTMLCollection | Element[] = [];
  if (dots) {
    let dh = "";
    for (let di = 0; di < real; di++) dh += "<i></i>";
    dots.innerHTML = dh;
    dotEls = dots.children || [];
    dots.classList.add("hint");
  }
  const cards: HTMLElement[] = [];
  function lightDot(card: HTMLElement | null): void {
    if (!dotEls.length || !card) return;
    const idx = card.hasAttribute && card.hasAttribute("data-clone") ? Number(card.getAttribute("data-clone")) : cards.indexOf(card) - pre;
    for (let e = 0; e < dotEls.length; e++) dotEls[e]!.classList.toggle("on", e === idx);
  }

  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* false until the observer that watches the page SAYS otherwise */
  let reelIn = false;
  /* NOTHING DOWNLOADS UNTIL THE STRIP IS NEAR: flipped by the "ahead" observer, the one that
     watches the viewport; source() refuses to spend a byte before then */
  let near = false;

  function poster(v: Clip): void {
    if (v.__poster) return;
    v.__poster = true;
    const url = v.dataset.poster;
    if (!url) return;
    v.setAttribute("poster", url);
    /* the same URL again, through an Image, purely to hear whether it is there: a <video
       poster> that 404s says nothing. A missing poster is a missing card. */
    const Img = window.Image;
    if (!Img) return;
    const probe = new Img();
    probe.onerror = () => fail(v);
    probe.src = url;
  }
  function source(v: Clip): void {
    if (v.__src || still || !near) return;
    v.__src = true;
    poster(v);
    /* PRELOAD FIRST, THEN SRC: setting src starts resource selection, which reads preload as it
       stands at that moment (Firefox does not pick a later change up) */
    v.preload = "auto";
    if (v.dataset.src) v.src = v.dataset.src;
  }
  /* A CARD WHOSE CLIP WILL NOT LOAD TAKES ITSELF OUT; the whole strip if none survive */
  function fail(v: Clip): void {
    const card = v.parentNode as HTMLElement | null;
    if (card && !card.hidden) card.hidden = true;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!.parentNode as HTMLElement | null;
      if (c && !c.hidden) return;
    }
    if (reel) reel.hidden = true;
  }
  Array.prototype.forEach.call(list, (v: Clip) => {
    v.addEventListener("error", () => fail(v));
  });
  /* A browser that refuses to autoplay is not an error: the poster is a good outcome */
  function play(v: Clip): void {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  }
  function refresh(): void {
    Array.prototype.forEach.call(list, (v: Clip) => {
      const want = v.__cur && reelIn && !still;
      if (want) {
        source(v);
        if (v.paused) play(v);
      } else if (!v.paused) v.pause();
    });
  }

  /* No IntersectionObserver: posters for all, clips for the ones on screen at rest */
  if (!("IntersectionObserver" in window)) {
    near = true;
    reelIn = true;
    Array.prototype.forEach.call(list, poster);
    for (let q = start - 1; q <= start + 1; q++) if (list[q]) list[q]!.__cur = true;
    refresh();
    return;
  }

  /* THE STACK. Each card's distance from the centre line (0 at the centre, 1 a full step
     away) is written to its --d on every scroll frame; at rest each is ROUNDED, so the nearest
     card fills the fixed frame to the pixel. */
  Array.prototype.forEach.call(list, (v: Clip) => {
    if (v.parentNode) cards.push(v.parentNode as HTMLElement);
  });
  let jumping = false;
  function stack(settled: boolean): void {
    if (!track || cards.length < 2) return;
    const tr = track.getBoundingClientRect();
    const mid = tr.left + tr.width / 2;
    /* the step is a LAYOUT distance (offsetLeft ignores the scale), the centres come from rects */
    const step = Math.abs(cards[1]!.offsetLeft - cards[0]!.offsetLeft) || 1;
    let front: HTMLElement | null = null, nearest: HTMLElement | null = null, nearestD = Infinity;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i]!.getBoundingClientRect();
      let raw = Math.abs(r.left + r.width / 2 - mid) / step;
      if (raw < nearestD) {
        nearestD = raw;
        nearest = cards[i]!;
      }
      if (settled) raw = Math.round(raw);
      const d = raw > 1 ? 1 : raw;
      cards[i]!.style.setProperty("--d", d.toFixed(3));
      cards[i]!.classList.toggle("front", d < 0.5);
      cards[i]!.classList.toggle("near", d >= 0.5 && d < 1);
      /* three on screen and no more */
      cards[i]!.classList.toggle("far", raw >= 1.5);
      if (settled && raw === 0) front = cards[i]!;
    }
    lightDot(nearest);
    /* settled on a copy: jump to the card it stands for, invisibly. `jumping` bounds the
       re-measure to one level, and a scroll that did not take is left alone (WebKit's RTL
       scrollLeft: "Maximum call stack size exceeded" on iOS before both guards). */
    const fr = front as HTMLElement | null;
    if (!jumping && fr && fr.hasAttribute && fr.hasAttribute("data-clone")) {
      const to = cards[pre + Number(fr.getAttribute("data-clone"))];
      if (to && to !== fr) {
        const a1 = fr.getBoundingClientRect(), b1 = to.getBoundingClientRect();
        const delta = b1.left + b1.width / 2 - (a1.left + a1.width / 2);
        const was = track.scrollLeft;
        /* snapping and smooth scrolling off for the one frame the jump takes */
        track.style.scrollSnapType = "none";
        track.style.scrollBehavior = "auto";
        track.scrollLeft += delta;
        void track.offsetWidth; /* flush */
        track.style.scrollSnapType = "";
        track.style.scrollBehavior = "";
        if (track.scrollLeft === was) return; /* it did not take */
        /* the pictures must not jump either: every copy set to its original's moment */
        twin((x, y) => {
          const src = x.paused ? y : x, dst = src === x ? y : x;
          if (!src.paused && src.currentTime) {
            try {
              dst.currentTime = src.currentTime;
            } catch {
              /* not seekable yet */
            }
          }
        });
        jumping = true;
        try {
          stack(true);
        } finally {
          jumping = false;
        }
        /* by card, not by index */
        Array.prototype.forEach.call(list, (v: Clip) => {
          if (v.parentNode) v.__cur = !(v.parentNode as HTMLElement).classList.contains("far");
        });
        refresh();
      }
    }
  }
  /* each copy with its original: head copies stand for the last `pre` cards, tail copies for the first */
  function twin(fn: (a: Clip, b: Clip) => void): void {
    const n = list.length - 2 * pre;
    for (let k = 0; k < pre; k++) {
      fn(list[k]!, list[pre + n - pre + k]!); /* head copy k ↔ original n-pre+k */
      fn(list[pre + n + k]!, list[pre + k]!); /* tail copy k ↔ original k */
    }
  }
  let queued = false, settle: ReturnType<typeof setTimeout> | undefined, opened = false;
  function onReelScroll(): void {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        stack(false);
      });
    }
    clearTimeout(settle);
    settle = setTimeout(() => stack(true), 120);
  }
  if (track) {
    track.addEventListener(
      "scroll",
      () => {
        /* the first real swipe retires the nudge — not the opening move, which is ours */
        if (opened && dots) dots.classList.remove("hint");
        onReelScroll();
      },
      { passive: true },
    );
    window.addEventListener("resize", onReelScroll, { passive: true });
    /* OPEN ON THE MIDDLE CARD, moved by the distance from that card's centre to the track's
       (a delta, so it is right in RTL) */
    let placed = false;
    const place = () => {
      if (placed) return;
      placed = true;
      const midCard = cards[start];
      if (midCard && start > 0) {
        const tr0 = track.getBoundingClientRect(), r0 = midCard.getBoundingClientRect();
        track.scrollLeft += r0.left + r0.width / 2 - (tr0.left + tr0.width / 2);
      }
      stack(true);
      /* the scroll event from the opening move arrives a frame later */
      setTimeout(() => {
        opened = true;
      }, 150);
    };
    /* NOT AT PAGE OPEN (v204): placed when it comes within a screen of view */
    const soon = new IntersectionObserver(
      (e) => {
        if (!e[0]!.isIntersecting) return;
        soon.disconnect();
        place();
      },
      { rootMargin: "100% 0px", threshold: 0 },
    );
    soon.observe(track);
    /* and once more when everything has loaded */
    window.addEventListener("load", onReelScroll);
  }

  Array.prototype.forEach.call(list, (v: Clip) => {
    /* which cards the strip is showing */
    new IntersectionObserver(
      (e) => {
        v.__cur = e[0]!.isIntersecting;
        refresh();
      },
      { root: track || null, threshold: 0.3 },
    ).observe(v);
    /* warm the neighbours — one card either way — but only while the REEL ITSELF is on screen */
    new IntersectionObserver(
      (e) => {
        if (e[0]!.isIntersecting && reelIn) source(v);
      },
      { root: track || null, rootMargin: "0px 60%", threshold: 0 },
    ).observe(v);
  });

  /* Ahead of arrival, HALF a screen early: every poster and the clips that will be on screen
     when the strip is reached. Once only. */
  const ahead = new IntersectionObserver(
    (e) => {
      if (!e[0]!.isIntersecting) return;
      near = true; /* opens the tap for source() */
      Array.prototype.forEach.call(list, poster);
      for (let k = start - 1; k <= start + 1; k++) if (list[k]) source(list[k]!);
      ahead.disconnect();
    },
    { rootMargin: "50% 0px", threshold: 0 },
  );
  ahead.observe(track || list[0]!);

  /* and whether the reel is on the page's screen at all */
  new IntersectionObserver(
    (e) => {
      reelIn = e[0]!.isIntersecting;
      refresh();
    },
    { rootMargin: "120px 0px", threshold: 0.1 },
  ).observe(track || list[0]!);
}
