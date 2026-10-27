/**
 * The three-scent set's card (#offer): its row, its scents, its button, its clocks and
 * wake-ups, and when it leaves the page.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cat, marketOf, openPage, tap, tick } from "./_page";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("from test-offer-scents.js / test-v415.js / test-v336-product.js (2): the set's scents", () => {
  it("three scents, each its shape in its own colour, ×1, by blend name; row → scents → button", async () => {
    const p = await openPage();
    const box = p.$("#offer")!;
    const sc = box.querySelectorAll(".ob-scent");
    expect(sc.length).toBe(3);
    const accents = Array.from(sc).map((s) => /<i class="scent-art" style="color:(#[0-9a-fA-F]{6})">/.exec(s.innerHTML)![1]);
    expect(new Set(accents).size).toBe(3);
    expect(sc[0]!.innerHTML).toContain('<em class="ob-n"><bdi dir="ltr">×1</bdi></em>لُبان العود مع اللافندر وورد');
    const html = box.innerHTML;
    expect(html.indexOf('class="ob-row"')).toBeLessThan(html.indexOf('class="ob-scents"'));
    expect(html.indexOf('class="ob-scents"')).toBeLessThan(html.indexOf('id="addOffer"'));
    expect(html).not.toContain("scent-mark");
    expect(box.querySelector(".ob-scents")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("a scent out in the small box: the set names the two left; every one out → off", async () => {
    const c = cat();
    const om = marketOf(c, "OM");
    om.scents = JSON.parse(JSON.stringify(c.scents));
    om.scents!.find((s) => s.id === "amber")!.soldOutSizes = ["small"];
    const p = await openPage({ catalogue: c });
    expect(Array.from(p.$$("#offer .ob-scent")).map((s) => s.textContent)).toEqual(["×1لُبان العود مع اللافندر وورد", "×1لُبان الليمون مع مسك وورد"]);
    // the card's count is SCENTS.length (the market's scents), not the packed ones
    expect(p.$("#offer .tier-shot b")!.textContent).toBe("×3");
    om.scents!.forEach((s) => (s.soldOutSizes = ["small"]));
    const q = await openPage({ catalogue: c });
    expect(q.$<HTMLElement>("#offer")!.hidden).toBe(true);
    expect(q.$("#offer")!.innerHTML).toBe("");
  });

  it("one box capped at 0 on the shelf → off; the basket holding the cap's worth → the button says so and adds nothing", async () => {
    const c = cat();
    c.stockCap = { "lemon-small": true };
    const p = await openPage({ catalogue: c, stock: { left: {}, hide: { items: [], sizes: [] }, cap: { "lemon-small": 0 } } });
    await vi.waitFor(() => expect(p.LM.stockCap("lemon", "small")).toBe(0));
    expect(p.$<HTMLElement>("#offer")!.hidden).toBe(true);

    const q = await openPage({
      catalogue: c,
      stock: { left: {}, hide: { items: [], sizes: [] }, cap: { "lemon-small": 1 } },
      cart: [{ sizeId: "bundle", scentId: "bundle", qty: 1 }],
    });
    await vi.waitFor(() => expect(q.$<HTMLButtonElement>("#addOffer")!.disabled).toBe(true));
    expect(q.$("#addOffer")!.textContent).toBe("نفدت الكمية");
    // the drawer took it out: lm:cart → the button comes back
    sessionStorage.setItem("lm_cart", "[]");
    window.dispatchEvent(new Event("lm:cart"));
    expect(q.$<HTMLButtonElement>("#addOffer")!.disabled).toBe(false);
    expect(q.$("#addOffer")!.textContent).toBe("أضف الباقة إلى السلة");
  });
});

describe("from test-v309.js / test-v404.js: the set's row", () => {
  it("stacked: the short row in the large rows' shape, no price a box, the badge", async () => {
    const p = await openPage();
    const LM = p.LM;
    const box = p.$("#offer")!;
    expect(box.className).toBe("offer-a");
    expect(box.getAttribute("aria-label")).toBe("باقة الروائح الثلاث");
    expect(box.querySelector(".ob-card > .tier-badge")!.textContent).toBe("الأكثر مبيعا");
    expect(box.querySelector(".offer-name")!.textContent).toBe("باقة الروائح الثلاث");
    expect(box.querySelector(".tier-txt > span")!.textContent).toBe("الحجم الصغير · 3 × 100 جم");
    expect(box.querySelector(".tier-price b")!.innerHTML).toBe(LM.moneyHTML(LM.price("bundle")));
    const was = LM.was("bundle");
    expect(!!box.querySelector(".tier-price s")).toBe(was > LM.price("bundle"));
    expect(box.querySelector(".tier-shot img")!.getAttribute("src")).toBe("assets/img/" + LM.img("small") + "-sm.jpg" + LM.v);
    expect(box.querySelector("#addOffer")!.className).toBe("btn btn-offer");
  });

  it("the pick-a-size page: the heading, the long words and the price a box, above the small box's scents", async () => {
    const c = cat();
    c.offer!.only = false;
    const p = await openPage({
      catalogue: c,
      setup: (LM) => {
        const real = LM.offerCfg;
        LM.offerCfg = (id?: string) => (new Error().stack!.includes("stacked") ? null : real.call(LM, id));
      },
    });
    tap(p.$$(".tile")[1]!); // the small box
    const box = p.$("#offer")!;
    expect(box.parentElement!.className).toBe("s3-bundle");
    expect(box.parentElement!.nextElementSibling!.className).toBe("szcard open s3card");
    expect(box.querySelector(".tiers-head")!.outerHTML).toBe('<div class="tiers-head"><h3>جرّب الروائح الثلاث</h3></div>');
    expect(box.querySelector(".ob-row")!.tagName).toBe("DIV");
    expect(box.querySelector('input[name="tier"]')).toBe(null);
    const spans = box.querySelectorAll(".tier-txt > span");
    expect(spans[0]!.textContent).toBe("3 علب صغيرة · 100 جم لكل علبة");
    expect(spans[1]!.innerHTML).toBe(String(Math.round(p.LM.price("bundle") / 3)) + " " + p.LM.moneyMark() + " للعلبة");
  });

  it("only: the small tile opens the set with the six points under it (v309/v311); its price is the set's", async () => {
    const c = cat();
    c.offer!.only = true;
    const p = await openPage({
      catalogue: c,
      setup: (LM) => {
        const real = LM.offerCfg;
        LM.offerCfg = (id?: string) => (new Error().stack!.includes("stacked") ? null : real.call(LM, id));
      },
    });
    tap(p.$$(".tile")[1]!);
    const card = p.$("#offer")!.parentElement!;
    expect(card.className).toBe("szcard open s3card s3-bundle");
    expect(card.querySelector(".s3-bundle-pts .sz-perks")).not.toBe(null);
    expect(p.$("#picker")).toBe(null);
    expect(p.$("#sPrice")!.innerHTML).toBe(p.LM.moneyHTML(p.LM.price("bundle")));
  });
});

describe("from test-offer-clock.js / test-v204.js / test-v312.js: no clock on the set, one wake-up, no redraw when unchanged", () => {
  it("the wake-up at min(ms+500, 1 day) rebuilds; an identical card is left as drawn", async () => {
    const p = await openPage();
    const btn = p.$("#addOffer");
    window.dispatchEvent(new Event("focus")); // buildOffer again: same card
    expect(p.$("#addOffer")).toBe(btn);
    expect(p.$("#offer .tiers-clock")).toBe(null);
    expect(p.$("#offer #tierClock")).toBe(null);
  });

  it("the set leaves the page when its window ends (once)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const c = cat();
    c.offer!.renew = "once";
    c.offer!.anchor = new Date(Date.now() - 71 * 3600e3).toISOString();
    const p = await openPage({ catalogue: c });
    expect(p.$<HTMLElement>("#offer")!.hidden).toBe(false);
    vi.advanceTimersByTime(3600e3 + 1000);
    expect(p.$<HTMLElement>("#offer")!.hidden).toBe(true);
    expect(p.$<HTMLElement>(".s3-bundle-under")!.hidden).toBe(true);
  });
});

describe("from test-v408.js / test-v410.js / test-v411.js / test-v413.js: the set ships free, with its own clock", () => {
  it("the badge with the switch's countdown; gone (and the bars told) when the window ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const c = cat();
    Object.assign(c.offer!, { freeShip: true, freeShipIn: [], freeShipHours: 24, freeShipUnit: "hours", freeShipRenew: "once", freeShipAnchor: new Date(Date.now() - 20 * 3600e3).toISOString() });
    const p = await openPage({ catalogue: c, url: "/?country=AE" }); // AE: the set is under the threshold
    const free = p.$("#offer .tier-free")!;
    expect(free.textContent).toBe("توصيل مجاني باقي 4 ساعات");
    expect(p.$("#setFreeClock")!.className).toBe("sf-left");
    vi.advanceTimersByTime(30000);
    expect(p.$("#setFreeClock")!.textContent).toBe("باقي 4 ساعات");
    vi.advanceTimersByTime(4 * 3600e3);
    expect(p.$("#offer .tier-free")).toBe(null);
    expect(p.ship[p.ship.length - 1]).toBe(0);
  });

  it("free by the threshold: the badge, no clock", async () => {
    const c = cat();
    Object.assign(c.offer!, { freeShip: true, freeShipHours: 24, freeShipAnchor: new Date(Date.now() - 3600e3).toISOString() });
    const p = await openPage({ catalogue: c }); // OM: the set is over the 30 OMR threshold?
    const over = p.LM.freeOver() > 0 && p.LM.price("bundle") >= p.LM.freeOver();
    expect(!!p.$("#offer .tier-free")).toBe(true);
    expect(!!p.$("#setFreeClock")).toBe(!over);
  });
});

describe("the set into the basket (addOffer)", () => {
  it("one line priced as its own id; a double tap is one set; the busy button comes back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const p = await openPage();
    const btn = p.$<HTMLButtonElement>("#addOffer")!;
    tap(btn);
    tap(btn);
    expect(p.basket()).toEqual([
      { scentId: "bundle", scent: "باقة الروائح الثلاث", sizeId: "bundle", size: "3 عبوات 100 جم، واحدة من كل رائحة", price: p.LM.price("bundle"), qty: 1, img: "white-box-open" },
    ]);
    expect(btn.textContent).toBe("تمت الإضافة ✓");
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("ok")).toBe(true);
    expect(p.ev).toEqual([["offer_add", "bundle"]]);
    expect(p.px.filter((x) => x[0] === "addCart").length).toBe(1);
    expect(p.cartRefresh).toBe(1);
    expect(p.$("#cartCount")!.textContent).toBe("1");
    expect(p.$(".cart")!.classList.contains("pop")).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(p.$("#addOffer")!.textContent).toBe("أضف الباقة إلى السلة");
    tap(p.$("#addOffer"));
    expect(p.basket()[0]!.qty).toBe(2);
  });
});

void tick;
