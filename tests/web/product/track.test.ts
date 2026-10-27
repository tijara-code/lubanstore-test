/**
 * The track box ("تتبع طلبك"): the tidying, the link form (?track=), the answers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, openPage, type Page } from "./_page";

afterEach(() => vi.restoreAllMocks());

function trackAnswer(body: unknown, status = 200) {
  return (u: string) => (u.indexOf("/api/track") === 0 ? Promise.resolve(json(body, { status })) : null);
}
const submit = (p: Page) => p.$("#trackForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const out = (p: Page) => p.$<HTMLElement>("#trackOut")!;

describe("from test-audit-fixes.js / test-v447.js / test-track.js: the track box", () => {
  it("typing tidies as it goes; a bad number is refused without a request", async () => {
    const p = await openPage();
    const input = p.$<HTMLInputElement>("#trackId")!;
    input.value = "lm 482913";
    input.dispatchEvent(new Event("input"));
    expect(input.value).toBe("LM-482913");
    input.value = "12";
    submit(p);
    expect(out(p).hidden).toBe(false);
    expect(out(p).className).toBe("track-out bad");
    expect(out(p).innerHTML).toBe('<span class="t-state">تأكد من رقم الطلب — يبدأ بـ LM</span>');
    expect(p.calls.filter((c) => c.url.indexOf("/api/track") === 0).length).toBe(0);
    expect(p.ev).toContainEqual(["track_lookup"]);
  });

  it("?track=lm482913 looks it up at once, tidied; the rail and the dates", async () => {
    const p = await openPage({
      url: "/?country=OM&track=lm482913",
      answer: trackAnswer({ ok: true, id: "LM-482913", text: "قيد التحضير", step: 1, dates: { created: "2026-10-01T08:00:00Z", picked: "2026-10-02T08:00:00Z" } }),
    });
    expect(p.$<HTMLInputElement>("#trackId")!.value).toBe("LM-482913");
    const call = p.calls.find((c) => c.url.indexOf("/api/track") === 0)!;
    expect(call.url).toBe("/api/track?id=LM-482913");
    expect(call.init).toEqual({ cache: "no-store" });
    await vi.waitFor(() => expect(out(p).querySelector(".t-id")).not.toBe(null));
    expect(out(p).className).toBe("track-out");
    expect(out(p).querySelector(".t-id")!.textContent).toBe("LM-482913");
    expect(out(p).querySelector(".t-state")!.textContent).toBe("قيد التحضير");
    expect(out(p).querySelector(".t-rail")!.innerHTML).toBe('<i class="on"></i><b class="on"></b><i class="on"></i><b class=""></b><i class=""></i><b class=""></b><i class=""></i>');
    const dates = out(p).querySelectorAll(".t-dates span");
    expect(dates.length).toBe(2);
    expect(dates[0]!.firstChild!.textContent).toBe("تم الاستلام");
    expect(dates[0]!.querySelector("em")!.textContent).toBe(new Date("2026-10-01T08:00:00Z").toLocaleDateString("ar", { day: "2-digit", month: "short", timeZone: "Asia/Muscat" }));
  });

  it("delivered: every dot done; stopped: no rail, marked bad; 404 and errors in words", async () => {
    let p = await openPage({ url: "/?track=LM-1234", answer: trackAnswer({ ok: true, id: "LM-1234", text: "تم التسليم", step: 3 }) });
    await vi.waitFor(() => expect(out(p).querySelector(".t-rail")).not.toBe(null));
    expect(out(p).querySelectorAll(".t-rail .done").length).toBe(7);
    p = await openPage({ url: "/?track=LM-1234", answer: trackAnswer({ ok: true, id: "LM-1234", text: "تم إلغاء الطلب", step: -1 }) });
    await vi.waitFor(() => expect(out(p).querySelector(".t-id")).not.toBe(null));
    expect(out(p).querySelector(".t-rail")).toBe(null);
    expect(out(p).className).toBe("track-out bad");
    p = await openPage({ url: "/?track=LM-1234", answer: trackAnswer({ ok: false }, 404) });
    await vi.waitFor(() => expect(out(p).textContent).toBe("لم نجد هذا الرقم. تأكد منه أو راسلنا."));
    p = await openPage({ url: "/?track=LM-1234", answer: trackAnswer({ ok: false }, 500) });
    await vi.waitFor(() => expect(out(p).textContent).toBe("تعذر جلب الحالة. جرب بعد قليل."));
    p = await openPage({ url: "/?track=LM-1234" }); // offline
    await vi.waitFor(() => expect(out(p).textContent).toBe("تعذر الاتصال. تحقق من الإنترنت."));
    expect(out(p).className).toBe("track-out bad");
  });

  it("English: the server's words translated; the status escaped", async () => {
    const p = await openPage({ lang: "en", english: true, url: "/?track=LM-1234", answer: trackAnswer({ ok: true, id: "LM-1234<b>", text: "تم إلغاء الطلب", step: -1 }) });
    await vi.waitFor(() => expect(out(p).querySelector(".t-state")).not.toBe(null));
    expect(out(p).querySelector(".t-state")!.textContent).toBe("Order cancelled");
    expect(out(p).querySelector(".t-id")!.innerHTML).toBe("LM-1234&lt;b&gt;");
  });
});
