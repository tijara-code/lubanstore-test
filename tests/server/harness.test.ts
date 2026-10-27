import { describe, expect, it } from "vitest";
import { createHarness } from "../helpers/harness";

describe("the test harness", () => {
  it("serves the app over an in-memory database", async () => {
    const h = await createHarness();
    const res = await h.get("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.headers.get("x-lm-release")).toBeTruthy();
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    await h.reset();
  });
});
