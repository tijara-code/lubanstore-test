/**
 * stats.ts — the page's own error reports (kind "log" in the beacon → /api/log).
 */
import { afterEach, describe, expect, it } from "vitest";
import { injected, mask, theirs } from "../../../src/web/tracking/errors";
import { dropListeners, items, loadPage, tick } from "./_page";

afterEach(() => dropListeners());

// from test-v401.js: the mask keeps a Safari stack frame whole
describe("mask", () => {
  it("keeps function and file, masks e-mails and phone numbers", () => {
    expect(mask("placeCountry@https://lubanmusk.com/assets/js/main.js:2367:12")).toBe("placeCountry@https://lubanmusk.com/assets/js/main.js:2367:12");
    expect(mask("@https://lubanmusk.com/assets/js/main.js:2396:7")).toBe("@https://lubanmusk.com/assets/js/main.js:2396:7");
    expect(mask("write to ali.s@gmail.com today")).toBe("write to [email] today");
    expect(mask("call +968 9123 4567")).toBe("call [n]");
    expect(mask("order 9123-4567 and 123456")).toBe("order [n] and 123456");
  });
});

describe("noise that is not ours", () => {
  it("bare Script error., the in-app bridges, ResizeObserver, injected stacks", () => {
    expect(theirs("Script error.", "")).toBe(true);
    expect(theirs("Script error.", "https://lubanmusk.com/assets/x.js:1:2")).toBe(false);   // ours after all
    expect(theirs("Error: Java object is gone", "")).toBe(true);
    expect(theirs("undefined is not an object (evaluating 'window.webkit.messageHandlers')", "")).toBe(true);
    expect(theirs("ResizeObserver loop limit exceeded", "")).toBe(true);
    expect(injected("sendDataToNative@https://lubanmusk.com/:1:220\n@https://lubanmusk.com/:1:400")).toBe(true);
    expect(injected("at <anonymous>:3:9")).toBe(true);
    expect(injected("at f (https://lubanmusk.com/assets/home-abc123.js:1:900)")).toBe(false);
    expect(injected("at https://lubanmusk.com/checkout.html:212:5")).toBe(false);
    expect(injected("no frames here")).toBe(false);
  });
});

describe("reports", () => {
  it("uncaught errors and rejections go through the beacon, masked, with the exact keys", async () => {
    const p = await loadPage({ core: false, pixel: false, url: "/checkout.html#pay" });
    const err = new TypeError("x is null for ali@example.com");
    err.stack = "TypeError: x is null\n    at go (http://localhost:3000/assets/checkout-1a2b.js:10:5)";
    window.dispatchEvent(new ErrorEvent("error", { message: "TypeError: x is null for ali@example.com", error: err }));
    const ev = new Event("unhandledrejection") as any;
    ev.reason = new Error("failed for +968 9123 4567");
    ev.reason.stack = "Error: failed\n    at q (http://localhost:3000/assets/x.js:2:3)";
    window.dispatchEvent(ev);
    await tick(120);
    const logs = (await items(p)).filter((i) => i.kind === "log").map((i) => i.body);
    expect(logs.length).toBe(2);
    expect(Object.keys(logs[0]!).sort()).toEqual(["detail", "kind", "message", "place", "sid"]);
    expect(logs[0]).toMatchObject({ kind: "error", message: "TypeError: x is null for [email]", place: "/checkout.html#pay", sid: sessionStorage.getItem("lm_sid") });
    expect(logs[0]!.detail).toContain("checkout-1a2b.js:10:5");
    expect(logs[1]).toMatchObject({ kind: "rejection", message: "failed for [n]" });
  });

  it("at most five a page, never the same message twice, and nothing that is not ours", async () => {
    const p = await loadPage({ core: false, pixel: false });
    const fire = (m: string, stack = "at a (http://localhost:3000/assets/a.js:1:1)") => {
      const e = new Error(m); e.stack = stack;
      window.dispatchEvent(new ErrorEvent("error", { message: m, error: e }));
    };
    fire("one"); fire("one"); fire("Script error.", ""); fire("from an app", "@http://localhost:3000/:1:5");
    for (let i = 2; i <= 9; i++) fire("n" + "abcdefgh"[i - 2]);
    await tick(120);
    const logs = (await items(p)).filter((i) => i.kind === "log").map((i) => i.body.message);
    expect(logs).toEqual(["one", "na", "nb", "nc", "nd"]);
  });

  it("a filename-only error reports file:line:col", async () => {
    const p = await loadPage({ core: false, pixel: false });
    window.dispatchEvent(new ErrorEvent("error", { message: "boom", filename: "http://localhost:3000/assets/z.js", lineno: 3, colno: 4 }));
    await tick(120);
    const log = (await items(p)).find((i) => i.kind === "log")!.body;
    expect(log.detail).toBe("http://localhost:3000/assets/z.js:3:4");
  });
});
