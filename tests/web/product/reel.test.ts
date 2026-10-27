/**
 * The showcase reel and the page's other observers (the original's test-clip.js drove main.js
 * with a capturing IntersectionObserver and fake videos; so do these). What needs real layout
 * (the stack's --d, the invisible jump from a copy) is checked in the browser parity journeys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeIO, observersOf, openPage, tap, type Page } from "./_page";

type V = HTMLVideoElement & { _playing?: boolean; __cur?: boolean };
const probes: Array<{ src: string; onerror: (() => void) | null }> = [];

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get(this: V) {
      return !this._playing;
    },
  });
  HTMLMediaElement.prototype.play = function (this: V) {
    this._playing = true;
    return Promise.resolve();
  };
  HTMLMediaElement.prototype.pause = function (this: V) {
    this._playing = false;
  };
  probes.length = 0;
  vi.stubGlobal(
    "Image",
    class {
      onerror: (() => void) | null = null;
      _src = "";
      constructor() {
        probes.push(this as unknown as { src: string; onerror: null });
      }
      set src(v: string) {
        this._src = v;
      }
      get src() {
        return this._src;
      }
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const vids = () => Array.from(document.querySelectorAll<V>(".clip-v"));
const realOf = (v: Element) => (v.parentElement!.getAttribute("data-clone") == null ? "real" : "clone");
const name = (v: HTMLVideoElement) => /show-(\d)/.exec(v.getAttribute("data-src") || "")![1];

/** a strip of n figures, show-1…show-n (one marked data-first), then the reel module run on it */
async function strip(n: number, first = -1) {
  const p = await openPage();
  const track = p.$("#reelTrack")!;
  track.innerHTML = Array.from({ length: n }, (_, i) =>
    '<figure class="reel-slide"' + (i === first ? " data-first" : "") + '><video class="clip-v" data-src="assets/media/show-' + (i + 1) + '.mp4" data-poster="assets/media/show-' + (i + 1) + '-poster.jpg" preload="none"></video></figure>',
  ).join("");
  FakeIO.all = [];
  const R = await import("../../../src/web/product/reel");
  R.initClip();
  return { p, track };
}

describe("from test-clip.js: the deal, the loop, the dots", () => {
  it("the page's three clips: dealt, copied two each side, dots for the real ones, the hint on", async () => {
    const p = await openPage();
    const track = p.$("#reelTrack")!;
    expect(track.querySelectorAll(".reel-slide").length).toBe(7);
    expect(Array.from(track.children).map((f) => f.getAttribute("data-clone"))).toEqual(["1", "2", null, null, null, "0", "1"]);
    expect(p.$$("#reelDots i").length).toBe(3);
    expect(p.$("#reelDots")!.classList.contains("hint")).toBe(true);
    // v211: the burner clip (data-first) opens the strip, in the middle real slot
    const reals = Array.from(track.children).filter((f) => f.getAttribute("data-clone") == null);
    expect(reals[1]!.hasAttribute("data-first")).toBe(true);
    expect(name(reals[1]!.querySelector("video")!)).toBe("2");
  });

  it("dealt at random every visit; no card lost or repeated", async () => {
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      await strip(5);
      const order = vids().filter((v) => realOf(v) === "real").map(name).join("");
      expect(order.split("").sort().join("")).toBe("12345");
      seen.add(order);
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("v211: data-first always lands in slot floor((n-1)/2), whatever the deal", async () => {
    for (const n of [3, 4, 5]) {
      for (let k = 0; k < 15; k++) {
        await strip(n, k % n);
        const reals = Array.from(document.querySelectorAll("#reelTrack .reel-slide")).filter((f) => f.getAttribute("data-clone") == null);
        expect(reals.findIndex((f) => f.hasAttribute("data-first"))).toBe(Math.floor((n - 1) / 2));
      }
    }
  });

  it("the copies: d e | a b c d e | a b, each naming its original", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999); // Fisher–Yates leaves the order as it is
    await strip(5);
    const all = vids();
    expect(all.map(name).join("")).toBe("451234512");
    expect(all.map((v) => v.parentElement!.getAttribute("data-clone"))).toEqual(["3", "4", null, null, null, null, null, "0", "1"]);
  });
});

describe("from test-clip.js: nothing downloaded at first; ahead of arrival; on screen", () => {
  it("first paint: no src, no poster; the ahead observer: every poster, the three opening clips, preload first", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { track } = await strip(5);
    const all = vids();
    expect(all.every((v) => !v.getAttribute("src") && !v.getAttribute("poster"))).toBe(true);
    // the warm-the-neighbour observer before the reel is near buys nothing
    observersOf(all[0]!, (o) => o.opts.rootMargin === "0px 60%")[0]!.fire(true);
    expect(all[0]!.getAttribute("src")).toBe(null);
    const ahead = observersOf(track, (o) => o.opts.rootMargin === "50% 0px")[0]!;
    const order: string[] = [];
    all.forEach((v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src")!;
      Object.defineProperty(v, "preload", { configurable: true, set: (x) => order.push("preload=" + x), get: () => "auto" });
      Object.defineProperty(v, "src", { configurable: true, set: (x) => (order.push("src"), set.set!.call(v, x)), get: () => set.get!.call(v) });
    });
    ahead.fire(true);
    expect(ahead.disconnected).toBe(true);
    expect(all.every((v) => /show-\d-poster\.jpg$/.test(v.getAttribute("poster") || ""))).toBe(true);
    // pre 2, real 5 → start 4: list[3..5] = clips 2, 3, 4
    expect(all.map((v) => (v.getAttribute("src") ? name(v) : "-")).join("")).toBe("---234---");
    expect(order.slice(0, 2)).toEqual(["preload=auto", "src"]);
    // every poster probed with an Image at the same address
    expect(probes.map((p) => p.src)).toEqual(all.map((v) => v.getAttribute("data-poster")));
  });

  it("arrival: the cards in view play when the reel is on screen; leaving pauses; back resumes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { track } = await strip(5);
    const all = vids();
    observersOf(track, (o) => o.opts.rootMargin === "50% 0px")[0]!.fire(true);
    const page = observersOf(track, (o) => o.opts.rootMargin === "120px 0px")[0]!;
    const cur = (v: V) => observersOf(v, (o) => o.opts.threshold === 0.3)[0]!;
    [3, 4, 5].forEach((i) => cur(all[i]!).fire(true, all[i]));
    expect(all.filter((v) => !v.paused).length).toBe(0); // the reel is not on screen yet
    page.fire(true);
    expect(all.map((v) => (v.paused ? "." : "▶")).join("")).toBe("...▶▶▶...");
    // the fifth warmed by the neighbour observer (src) but paused; the first still cold
    observersOf(all[6]!, (o) => o.opts.rootMargin === "0px 60%")[0]!.fire(true, all[6]);
    expect(all[6]!.getAttribute("src")).toMatch(/show-5/);
    expect(all[6]!.paused).toBe(true);
    expect(all[2]!.getAttribute("src")).toBe(null);
    // a swipe: the leaving card pauses, the arriving one plays
    cur(all[3]!).fire(false, all[3]);
    cur(all[6]!).fire(true, all[6]);
    expect(all[3]!.paused).toBe(true);
    expect(all[6]!.paused).toBe(false);
    page.fire(false);
    expect(all.every((v) => v.paused)).toBe(true);
    const srcBefore = all.map((v) => v.getAttribute("src"));
    page.fire(true);
    expect(all.map((v) => (v.paused ? "." : "▶")).join("")).toBe("....▶▶▶..");
    expect(all.map((v) => v.getAttribute("src"))).toEqual(srcBefore); // no refetch
  });

  it("reduced motion: nothing fetched, nothing plays", async () => {
    const p = await openPage({ media: { reduce: true } });
    void p;
    const track = document.querySelector("#reelTrack")!;
    observersOf(track, (o) => o.opts.rootMargin === "50% 0px")[0]!.fire(true);
    observersOf(track, (o) => o.opts.rootMargin === "120px 0px")[0]!.fire(true);
    vids().forEach((v) => observersOf(v, (o) => o.opts.threshold === 0.3)[0]!.fire(true, v));
    expect(vids().every((v) => !v.getAttribute("src") && v.paused)).toBe(true);
    expect(vids().every((v) => !!v.getAttribute("poster"))).toBe(true); // the still frames
  });

  it("a missing poster hides its card; all missing hide the reel", async () => {
    const p = await openPage();
    observersOf(p.$("#reelTrack"), (o) => o.opts.rootMargin === "50% 0px")[0]!.fire(true);
    probes[0]!.onerror!();
    expect(vids()[0]!.parentElement!.hidden).toBe(true);
    expect(p.$<HTMLElement>("#reel")!.hidden).toBe(false);
    probes.forEach((x) => x.onerror!());
    expect(p.$<HTMLElement>("#reel")!.hidden).toBe(true);
  });

  it("no IntersectionObserver: posters for all, the clips on screen at rest", async () => {
    await openPage({ io: "none" });
    const all = vids();
    expect(all.every((v) => !!v.getAttribute("poster"))).toBe(true);
    // 3 clips: pre 2, start 3 → list[2..4] current
    expect(all.map((v) => (v.paused ? "." : "▶")).join("")).toBe("..▶▶▶..");
    expect(document.querySelector("#sticky")!.classList.contains("show")).toBe(false);
    expect(document.querySelector(".step-list")!.classList.contains("playing")).toBe(true);
  });
});

describe("from test-v337.js / test-v400.js: the reel's arrows", () => {
  it("one card a click, the reading direction's way", async () => {
    const p = await openPage();
    const track = p.$("#reelTrack")!;
    const by = vi.fn();
    track.scrollBy = by as unknown as typeof track.scrollBy;
    const cards = Array.from(track.querySelectorAll<HTMLElement>(".reel-slide"));
    Object.defineProperty(cards[0]!, "offsetLeft", { value: 500 });
    Object.defineProperty(cards[1]!, "offsetLeft", { value: 330 });
    tap(p.$("#reelNext"));
    tap(p.$("#reelPrev"));
    expect(by.mock.calls).toEqual([[{ left: -170, behavior: "smooth" }], [{ left: 170, behavior: "smooth" }]]);
    expect(p.$("#reelPrev")!.getAttribute("tabindex")).toBe("-1");
    expect(p.$("#reelPrev")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("from test-step-animation.js / test-v204.js: motion only where it is seen", () => {
  it("the step list plays only in view (threshold .25)", async () => {
    const p = await openPage();
    const list = p.$(".step-list")!;
    const io = observersOf(list)[0]!;
    expect(io.opts.threshold).toBe(0.25);
    expect(list.classList.contains("playing")).toBe(false);
    io.fire(true);
    expect(list.classList.contains("playing")).toBe(true);
    io.fire(false);
    expect(list.classList.contains("playing")).toBe(false);
    io.fire(true);
    expect(list.classList.contains("playing")).toBe(true);
  });

  it("the reel's endless dot idles off screen (anim-idle)", async () => {
    const p = await openPage();
    const reel = p.$("#reel")!;
    const io = observersOf(reel).find((o) => !o.opts.rootMargin)!;
    io.fire(false, reel);
    expect(reel.classList.contains("anim-idle")).toBe(true);
    io.fire(true, reel);
    expect(reel.classList.contains("anim-idle")).toBe(false);
  });

  it("the sticky bar shows once the sizes are scrolled past (above), not before", async () => {
    const p: Page = await openPage();
    const io = observersOf(p.$("#sizes"))[0]!;
    io.fire(false, p.$("#sizes")!, -10);
    expect(p.$("#sticky")!.classList.contains("show")).toBe(true);
    io.fire(false, p.$("#sizes")!, 900);
    expect(p.$("#sticky")!.classList.contains("show")).toBe(false);
    io.fire(true, p.$("#sizes")!, -10);
    expect(p.$("#sticky")!.classList.contains("show")).toBe(false);
  });
});
