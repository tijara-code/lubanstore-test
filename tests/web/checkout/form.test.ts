/**
 * The checkout form: countries and cities, the per-market phone rules, the input filters,
 * the submit's field checks (checkout module + checkout/phone.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootPage, catalogueFile, choose, fillValid, LINE, marketOf, read, submit, type } from "./_page";
import { FIRST, PHONE, keepName, keepPhone, phoneDigits } from "../../../src/web/checkout/phone";
import { MOBILE_FIRST, MOBILE_LEN } from "../../../src/shared/orders/phone";

afterEach(() => {
  vi.restoreAllMocks();
});
const $ = <E extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as E;

// from test-phone-plan.js
describe("the phone plan per market", () => {
  it("PHONE[dial] = { hint, len } for every market; the hint has exactly len places", () => {
    const want: Record<string, [string, number]> = {
      "971": ["5X XXX XXXX", 9], "966": ["5X XXX XXXX", 9], "974": ["XXXX XXXX", 8],
      "965": ["XXXX XXXX", 8], "973": ["3XXX XXXX", 8], "968": ["9XXX XXXX", 8],
    };
    for (const dc of Object.keys(want)) {
      expect(Object.keys(PHONE[dc]!).sort()).toEqual(["hint", "len"]);
      expect([PHONE[dc]!.hint, PHONE[dc]!.len]).toEqual(want[dc]);
      expect(PHONE[dc]!.hint.replace(/\s/g, "").length).toBe(PHONE[dc]!.len);
    }
    expect(PHONE["974"]!.hint[0]).toBe("X");
    expect(PHONE["965"]!.hint[0]).toBe("X");
  });

  // from test-v414.js: one table for the page and the till
  it("lengths and first digits are the server's tables", () => {
    for (const dc of Object.keys(PHONE)) expect(PHONE[dc]!.len).toBe(MOBILE_LEN[dc]);
    expect(FIRST).toEqual(MOBILE_FIRST);
    expect(FIRST).toEqual({ "968": "79", "971": "5", "966": "5", "974": "3567", "973": "36", "965": "4569" });
  });

  it("phoneDigits: trunk 0 dropped, spaces ignored, a pasted own code stripped only when ≥ 7 digits remain", () => {
    const cases: Array<[string, string, string]> = [
      ["91234567", "968", "91234567"], ["091234567", "968", "91234567"], ["0501234567", "971", "501234567"],
      ["050 123-4567", "971", "501234567"], ["", "968", ""], ["+968 9123 4567", "968", "91234567"],
      ["00968 91234567", "968", "91234567"], ["+971 50 123 4567", "971", "501234567"],
      ["96512345", "965", "96512345"], ["+965 9651 2345", "965", "96512345"],
    ];
    for (const [v, dc, d] of cases) expect(phoneDigits(v, dc), v).toBe(d);
  });

  // from test-v202.js: the input filters
  it("the phone folds Arabic-Indic and Persian digits; the name keeps any script's letters, drops digits and symbols", () => {
    expect(keepPhone("٩٦٨ ٩١٢٣")).toBe("9689123");
    expect(keepPhone("۹۱۲۳۴۵۶۷")).toBe("91234567");
    expect(keepName("José Zoë")).toBe("José Zoë");
    expect(keepName("محمد 12 @#")).toBe("محمد ");
    expect(keepName("Ali  ٣ bin")).toBe("Ali bin");
  });
});

describe("the form on the page", () => {
  it("countries from the catalogue (flag + name, escaped), the chosen market selected; dial and placeholder follow", async () => {
    const c = catalogueFile();
    marketOf(c, "QA").name = '<b>قطر</b>';
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], catalogue: c });
    const sel = $<HTMLSelectElement>("#country");
    expect(sel.options.length).toBe(6);
    expect(sel.value).toBe("968");
    expect(sel.options[sel.selectedIndex]!.getAttribute("data-code")).toBe("OM");
    expect(sel.options[sel.selectedIndex]!.textContent).toBe("🇴🇲 عمان");
    expect(sel.querySelector("b")).toBe(null);
    expect($("#dial").textContent).toBe("+968");
    expect($<HTMLInputElement>("#phone").placeholder).toBe("9XXX XXXX");
    expect($("#phone").hasAttribute("maxlength")).toBe(false);
  });

  it("Oman's second line is its governorates (label + hint); the value stays Arabic, the words are the page's", async () => {
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], english: true });
    const city = $<HTMLSelectElement>("#city");
    expect(city.tagName).toBe("SELECT");
    expect(document.querySelector('label[for="city"]')!.textContent).toBe(window.LM_EN!["المحافظة"]);
    expect(city.options[0]!.textContent).toBe(window.LM_EN!["اختر المحافظة"]);
    expect(city.options[0]!.value).toBe("");
    expect(city.options[1]!.value).toBe("مسقط");
    expect(city.options[1]!.textContent).toBe(window.LM_EN!["مسقط"]);
  });

  it("a market with no city list gets a typed box (autocomplete kept); back to a list gets a select", async () => {
    const { LM_CITIES } = await import("../../../src/web/core/cities");
    const lists: Record<string, string[]> = { ...LM_CITIES };
    delete lists["965"];
    window.LM_CITIES = lists;
    try {
      await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
      choose("#country", "965");
      const box = $<HTMLInputElement>("#city");
      expect(box.tagName).toBe("INPUT");
      expect([box.type, box.placeholder, box.getAttribute("autocomplete")]).toEqual(["text", "اكتب اسم المدينة", "address-level2"]);
      expect(document.querySelector('label[for="city"]')!.textContent).toBe("المدينة");
      choose("#country", "971");
      expect($("#city").tagName).toBe("SELECT");
      expect($<HTMLSelectElement>("#city").options[0]!.textContent).toBe("اختر المدينة");
    } finally {
      delete window.LM_CITIES;
    }
  });

  it("changing the country: dial, placeholder, cities and the market (lm:country) follow; the summary is repriced", async () => {
    const { LM } = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    choose("#country", "971");
    expect(LM.c.code).toBe("AE");
    expect($("#dial").textContent).toBe("+971");
    expect($<HTMLInputElement>("#phone").placeholder).toBe("5X XXX XXXX");
    expect($("#total").innerHTML).toBe(LM.moneyHTML(280));
    expect(localStorage.getItem("lm_cty_v2")).toBe("AE");
  });

  it("a `change` fired on an empty list (an in-app browser's autofill) does not throw", async () => {
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    const sel = $<HTMLSelectElement>("#country");
    sel.innerHTML = "";
    expect(() => sel.dispatchEvent(new Event("change"))).not.toThrow();
  });
});

// from test-v312.js / test-v404 / test-v414.js: the counter and the note
describe("the counter and the note under the number", () => {
  it("muted while empty, red under/over, green on the length; the note says so; a wrong first digit is red with its rule", async () => {
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    const count = $("#telCount"), note = $("#telNote");
    type("#phone", "");
    expect([count.hidden, count.textContent, count.className]).toEqual([false, "0/8", "tel-count"]);
    type("#phone", "9123");
    expect([count.textContent, count.classList.contains("bad")]).toEqual(["4/8", true]);
    expect([note.textContent, note.classList.contains("bad"), note.hidden]).toEqual(["أدخل رقمًا صحيحًا", true, false]);
    type("#phone", "91234567");
    expect([count.textContent, count.classList.contains("ok"), count.classList.contains("bad")]).toEqual(["8/8", true, false]);
    expect([note.textContent, note.classList.contains("ok")]).toEqual(["رقم صحيح ✓", true]);
    type("#phone", "21234567");
    expect([count.classList.contains("ok"), count.classList.contains("bad")]).toEqual([false, true]);
    expect(note.textContent).toBe("يبدأ رقم الجوال هنا بـ 7 أو 9.");
    /* "96…" on its way to "+968 9…" is not judged by its first digit */
    type("#phone", "968");
    expect(note.textContent).toBe("أدخل رقمًا صحيحًا");
  });

  it("v315: a complete number joins this checkout's measurement (LMPX.notePhone)", async () => {
    await bootPage({ url: "/checkout.html?country=AE", cart: [LINE("oud", "large")] });
    const noted: string[] = [];
    (window as unknown as Record<string, unknown>).LMPX = { notePhone: (p: string) => noted.push(p), purchase() {}, startCheckout() {} };
    type("#phone", "0501234567");
    /* twice per keystroke, as the original: the counter's own listener, then the field's
       message being cleared repaints it */
    expect(noted).toEqual(["+971501234567", "+971501234567"]);
  });

  it("English: the first-digit rule reads 'Mobile numbers here start with 3, 5, 6 or 7' as i18n has it", async () => {
    await bootPage({ url: "/checkout.html?country=QA", cart: [LINE("oud", "large")], english: true });
    type("#phone", "21234567");
    const want = window.LM_EN!["يبدأ رقم الجوال هنا بـ {d}."];
    expect(typeof want === "string" ? $("#telNote").textContent!.indexOf(want.split("{d}")[0]!) === 0 : true).toBe(true);
    expect($("#telNote").textContent).toMatch(/3.*5.*6.*7/);
  });
});

// from test-v336-checkout.js §3, test-phone-plan.js, test-v414.js, test-v202.js (a11y)
describe("submit: the field checks", () => {
  function posts(p: { calls: Array<{ url: string }> }) {
    return p.calls.filter((c) => c.url === "/api/order" || c.url === "/api/pay/session").length;
  }

  it("empty fields are flagged in the form's order: aria-invalid, the drawn mark, focus on the first, the words in #payMsg", async () => {
    const p = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    const scrolled: string[] = [];
    HTMLElement.prototype.scrollIntoView = function () {
      scrolled.push(this.id);
    };
    submit();
    for (const id of ["name", "city", "region", "phone"]) expect($("#" + id).getAttribute("aria-invalid"), id).toBe("true");
    expect($("#name").style.borderColor).toBe("#b4483c");
    expect($<HTMLElement>(".tel").style.borderColor).toBe("#b4483c");
    expect($<HTMLElement>(".tel-code").style.background).toBe("#b4483c");
    expect(document.activeElement && document.activeElement.id).toBe("name");
    expect(scrolled).toEqual(["name"]);
    expect($("#payMsg").textContent).toBe("تأكد من إكمال بياناتك.");
    expect($("#payMsg").getAttribute("data-form")).toBe("1");
    expect($("#payMsg").hidden).toBe(false);
    expect($("#confirm").classList.contains("bad")).toBe(true);
    expect(posts(p)).toBe(0);
    /* typing clears the field's own mark */
    type("#name", "سارة");
    expect($("#name").hasAttribute("aria-invalid")).toBe(false);
    expect($("#name").style.borderColor).toBe("");
  });

  it("OM with a pasted +971 number: not posted; the reason names +971, under the field and in #payMsg; editing clears it", async () => {
    const p = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    fillValid({ phone: "+971501234567" });
    submit();
    const why = "هذا الرقم بمفتاح +971. اختر دولته أو اكتب رقمًا محليًا.";
    expect($("#phoneErr").textContent).toBe(why);
    expect($("#phoneErr").hidden).toBe(false);
    expect($("#telNote").hidden).toBe(true);
    expect($("#payMsg").textContent).toBe(why);
    expect($("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(posts(p)).toBe(0);
    type("#phone", "91234567");
    expect($("#phoneErr").hidden).toBe(true);
    expect($("#telNote").hidden).toBe(false);
  });

  it("AE with 8 digits → the market's length; OM with 4 → refused; a wrong first digit at the right length → refused", async () => {
    let p = await bootPage({ url: "/checkout.html?country=AE", cart: [LINE("oud", "large")] });
    fillValid({ phone: "50123456" });
    submit();
    expect($("#phoneErr").textContent).toBe("رقم الجوال هنا من 9 أرقام.");
    expect(posts(p)).toBe(0);
    p = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    fillValid({ phone: "9123" });
    submit();
    expect($("#phoneErr").textContent).toBe("رقم الجوال هنا من 8 أرقام.");
    fillValid({ phone: "24123456" });
    submit();
    expect($("#phoneErr").textContent).toBe("يبدأ رقم الجوال هنا بـ 7 أو 9.");
    expect(posts(p)).toBe(0);
  });

  it("accepted: OM 0096891234567, OM 91234567, KW 96512345 (starts with its own code) — posted as +dial digits", async () => {
    for (const [cc, raw, want] of [
      ["OM", "0096891234567", "+968 91234567"],
      ["OM", "91234567", "+968 91234567"],
      ["KW", "96512345", "+965 96512345"],
      ["AE", "050 123 4567", "+971 501234567"],
    ]) {
      const p = await bootPage({
        url: "/checkout.html?country=" + cc,
        cart: [LINE("oud", "large")],
        answer: (url) => (url === "/api/pay/session" ? new Response(JSON.stringify({ ok: false, error: "gateway_error" }), { status: 502 }) : null),
      });
      fillValid({ phone: raw! });
      submit();
      await new Promise((r) => setTimeout(r, 10));
      const sent = p.posts("/api/pay/session");
      expect(sent.length, raw).toBe(1);
      expect(sent[0]!.body.order.phone).toBe(want);
      expect($("#phoneErr").hidden).toBe(true);
    }
  });

  it("an unknown market keeps the 7-15 range", async () => {
    const c = catalogueFile();
    c.countries.push({ ...marketOf(c, "OM"), code: "GB", dial: "44", name: "بريطانيا", flag: "" });
    for (const [raw, ok] of [["123", false], ["123456", false], ["1234567890123456", false], ["123456789", true]] as const) {
      await bootPage({ url: "/checkout.html?country=GB", cart: [LINE("oud", "large")], catalogue: c });
      expect($<HTMLInputElement>("#phone").placeholder).toBe("");
      expect($("#telCount").hidden).toBe(true);
      fillValid({ phone: raw });
      if ($("#city").tagName === "INPUT") $<HTMLInputElement>("#city").value = "London";
      submit();
      expect($("#phoneErr").hidden, raw).toBe(ok);
      if (!ok) expect($("#phoneErr").textContent).toBe("تأكد من رقم الجوال.");
    }
  });

  it("email: empty is fine; a malformed one is flagged and focused; a good one is sent lower-cased", async () => {
    let p = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    fillValid();
    type("#email", "not-an-email");
    submit();
    expect($("#email").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement!.id).toBe("email");
    expect($("#payMsg").textContent).toBe("تأكد من إكمال بياناتك.");
    p = await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")] });
    fillValid();
    type("#email", " Sara@Example.COM ");
    submit();
    await new Promise((r) => setTimeout(r, 10));
    expect(p.posts("/api/pay/session")[0]!.body.order.email).toBe("sara@example.com");
  });

  it("a later complete submit lifts the form's message", async () => {
    await bootPage({ url: "/checkout.html?country=OM", cart: [LINE("oud", "large")], answer: (u) => (u === "/api/pay/session" ? new Response("{}", { status: 500 }) : null) });
    submit();
    expect($("#payMsg").hidden).toBe(false);
    fillValid();
    submit();
    expect($("#payMsg").hasAttribute("data-form")).toBe(false);
    expect($("#payMsg").hidden).toBe(true);
  });
});

// from test-device-fit.js, test-v336-checkout.js, test-phone-plan.js, test-v414.js, test-v431.js, test-v436.js, test-v427.js, test-v443.js (markup the module relies on)
describe("the markup the checkout module relies on (site/checkout.html)", () => {
  /* the source page, its comments taken out (they mention retired things by name) */
  const html = read("site/checkout.html").replace(/<!--[\s\S]*?-->/g, "");
  it("autofill tokens, the phone input, the email box", () => {
    expect(html).toMatch(/<input id="name" type="text"[^>]*autocomplete="name"/);
    expect(html).toMatch(/<input id="phone" type="tel" inputmode="numeric" autocomplete="tel-national"\s+pattern="\[0-9\]\*" placeholder="5X XXX XXXX" aria-describedby="phoneErr">/);
    expect(html).toMatch(/<input id="email" type="email"[^>]*autocomplete="email"/);
    expect(html).not.toMatch(/id="email"[^>]*placeholder/);
    expect(html).toMatch(/<label for="email">البريد الإلكتروني <span class="opt-tag">اختياري<\/span><\/label>/);
    expect(html).toMatch(/<input id="region" type="text" autocomplete="address-line1"/);
    expect(html).toMatch(/<select id="city" autocomplete="address-level2">/);
    expect(html).toMatch(/<span class="tel-code" id="dial" dir="ltr">\+971<\/span>/);
    expect(html).not.toMatch(/id="phone"[^>]*maxlength/);
  });
  it("the form, the ways to pay, the button, the countdown, the panels", () => {
    expect(html).toContain('<form id="form" novalidate>\n      <h2>التوصيل</h2>');
    expect(html.indexOf("<h2>التوصيل</h2>") < html.indexOf('<div class="pays" id="pays"')).toBe(true);
    expect(html).toContain('<div class="pays" id="pays" role="radiogroup" aria-label="طريقة الدفع">');
    expect(html).not.toMatch(/<h2>طرق الدفع/);
    expect(html).not.toMatch(/class="trust"|صديق للبيئة/);
    expect(html).toContain('<button class="btn btn-go" id="confirm" type="submit" style="margin-top:14px">ادفع الآن</button>');
    expect(html).toContain('<p class="pay-wait" id="payWait" role="status" hidden><span class="pw-n" id="payWaitN" aria-hidden="true">15</span><span class="pw-t">جارٍ تجهيز بوابة الدفع الآمنة، لا تغلق الصفحة</span></p>');
    expect(html).toContain('<div class="co-msg" id="returned" style="display:none" role="status">');
    expect(html).toContain('<p class="sum-fx" id="sumFx" hidden><span dir="ltr" id="sumFxV"></span></p>');
    expect(html).toContain('<span class="sum-pair"><span id="ship">—</span><s id="shipWas" hidden></s></span>');
    expect(html).toContain('<h1 class="sr-only">إتمام الطلب</h1>');
    expect(html).toMatch(/<div class="free-bar" id="freeBar" hidden>/);
    expect(html).toMatch(/id="freeProg" aria-live="polite" hidden/);
    expect(html).not.toMatch(/id="freeAdd"[^>]*aria-live/);
    expect(html.indexOf('id="freeBar"') < html.indexOf('id="freeAdd"') && html.indexOf('id="freeAdd"') < html.indexOf("<h2>التوصيل</h2>")).toBe(true);
    expect(html).toMatch(/<div class="extras" id="freeExtras" hidden><\/div>/);
    expect(html).toMatch(/<div class="samples" id="sampleBox" hidden><\/div>/);
  });
  it("the Netlify Forms copy's form declares every field the module sends", () => {
    for (const f of ["id", "date", "name", "phone", "country", "city", "region", "note", "pay", "items", "total", "email", "charged", "bot-field"]) {
      expect(html).toContain('name="' + f + '"');
    }
    expect(html).toContain('<form name="orders" netlify netlify-honeypot="bot-field" hidden>');
  });
});
