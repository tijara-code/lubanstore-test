import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogueFile, ready } from "./_boot";
import { ART, EXTRA_ART } from "../../../src/web/core/art";

afterEach(() => vi.unstubAllGlobals());

describe("the drawings", () => {
  it("a scent's chip: its accent behind its own drawing, named in the page's language", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    expect(LM.scentMark("oud")).toBe('<span class="scent-mark" style="background:#6A5CA8" title="عود الافندر">' + LM.scentArt("lavender") + "</span>");
    expect(LM.scentMark("nope")).toBe("");
    expect(LM.scentArt("lemon")).toBe('<svg viewBox="0 0 48 48" aria-hidden="true">' + ART.lemon + "</svg>");
    // an unknown drawing falls back to the lavender
    expect(LM.scentArt("??")).toBe(LM.scentArt("lavender"));
    const en = (await ready({ url: "/?country=OM", lang: "en", english: true })).LM;
    expect(en.scentMark("oud")).toMatch(/title="Oud Lavender"/);
  });

  // from test-catalogue-injection.js (the core's part): catalogue data reaching markup
  it("catalogue data reaches the markup only as data: hex accents only, names without markup characters", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    const XSS = '"><img src=x onerror=alert(1)>';
    LM.cfg.scents = [{ id: "oud", name: XSS, accent: '#fff" onload="alert(1)', art: "lavender" }];
    const all = LM.scentMark("oud") + LM.lineMark({ sizeId: "large", scentId: "oud", qty: 1 }) + LM.extraArt({ id: "samples", name: "", art: "scents" });
    expect(all).not.toMatch(/<img/);
    expect(all).not.toMatch(/onload=/);
    expect(all).toMatch(/background:#8f7238/);
    expect(LM.esc(XSS)).toBe("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(LM.esc(null)).toBe("");
  });

  it("the sampler is the market's scents, greying the ones already bought; the burner its drawing", async () => {
    const { LM } = await ready({ url: "/?country=OM" });
    const samples = LM.cfg.extras!.find((x) => x.id === "samples")!;
    const art = LM.extraArt(samples, { lemon: true });
    expect((art.match(/class="sa-dot"/g) || []).length).toBe(2);
    expect((art.match(/class="sa-dot off"/g) || []).length).toBe(1);
    expect(art.startsWith('<span class="sa-art">')).toBe(true);
    expect(LM.extraArt({ id: "burner", name: "", art: "burner" })).toBe('<span class="ex-draw">' + EXTRA_ART.burner + "</span>");
    expect(LM.extraArt({ id: "x", name: "", art: "none" })).toBe("");
    expect(LM.extraArt(null)).toBe("");
  });

  // (byte-for-byte equality with store.js is held by tests/parity/store-core.parity.test.ts)
  it("the burner is a whole drawing", () => {
    expect(EXTRA_ART.burner).toMatch(/^<svg viewBox="0 0 48 48" aria-hidden="true">[\s\S]*<\/svg>$/);
  });

  // from test-store-look.js (the core's part): the bundled catalogue invents no claim
  it("the bundled scents carry no badge the shop has not made", () => {
    expect(catalogueFile().scents.filter((s) => s.tag)).toEqual([]);
  });
});
