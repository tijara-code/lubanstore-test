/**
 * The pictures the code draws or names: the packshot for each size, the scent drawings
 * (the product card and the basket chip are literally the same drawing), and the add-ons'
 * pictures. The SVG paths are store.js's, byte for byte.
 */
import { LM } from "./self";
import { txt } from "./lang";
import { hexOr } from "./util";
import type { LmApi } from "./types";

/** Each size has its own packshot: the small red box, the wide white box, both for the set. */
export const SIZE_IMG: Record<string, string> = {
  small: "red-box-open",
  large: "white-box-open",
  bundle: "duo-brass",
  bundle2: "duo-brass",
};

/**
 * The scent artwork. Solid fills, no strokes — the colour is set in CSS, which is why these
 * carry no fill attribute.
 */
export const ART: Record<string, string> = {
  lavender:
    '<path d="M23.1 46.2c-.7-6.2-.7-12.4 0-18.6.3-1.7 1.7-1.7 2 0 .7 6.2.7 12.4 0 18.6-.3 1.5-1.7 1.5-2 0Z"/><g transform="translate(24.0 16.5) rotate(0)"><path d="M0 0C4.1 -3.5 4.1 -7.0 4.1 -8.9C4.1 -12.2 2.5 -13.5 0 -13.5C-2.5 -13.5 -4.1 -12.2 -4.1 -8.9C-4.1 -7.0 -4.1 -3.5 0 0Z"/></g><g transform="translate(18.6 26.5) rotate(-27)"><path d="M0 0C3.8 -3.1 3.8 -6.2 3.8 -7.9C3.8 -10.8 2.3 -12.0 0 -12.0C-2.3 -12.0 -3.8 -10.8 -3.8 -7.9C-3.8 -6.2 -3.8 -3.1 0 0Z"/></g><g transform="translate(29.4 26.5) rotate(27)"><path d="M0 0C3.8 -3.1 3.8 -6.2 3.8 -7.9C3.8 -10.8 2.3 -12.0 0 -12.0C-2.3 -12.0 -3.8 -10.8 -3.8 -7.9C-3.8 -6.2 -3.8 -3.1 0 0Z"/></g><g transform="translate(17.4 36.5) rotate(-27)"><path d="M0 0C3.8 -3.1 3.8 -6.2 3.8 -7.9C3.8 -10.8 2.3 -12.0 0 -12.0C-2.3 -12.0 -3.8 -10.8 -3.8 -7.9C-3.8 -6.2 -3.8 -3.1 0 0Z"/></g><g transform="translate(30.6 36.5) rotate(27)"><path d="M0 0C3.8 -3.1 3.8 -6.2 3.8 -7.9C3.8 -10.8 2.3 -12.0 0 -12.0C-2.3 -12.0 -3.8 -10.8 -3.8 -7.9C-3.8 -6.2 -3.8 -3.1 0 0Z"/></g><g transform="translate(24.0 44.5) rotate(-118)"><path d="M0 0C4.0 -3.4 4.0 -6.8 4.0 -8.6C4.0 -11.7 2.4 -13.0 0 -13.0C-2.4 -13.0 -4.0 -11.7 -4.0 -8.6C-4.0 -6.8 -4.0 -3.4 0 0Z"/></g><g transform="translate(24.0 44.5) rotate(118)"><path d="M0 0C4.0 -3.4 4.0 -6.8 4.0 -8.6C4.0 -11.7 2.4 -13.0 0 -13.0C-2.4 -13.0 -4.0 -11.7 -4.0 -8.6C-4.0 -6.8 -4.0 -3.4 0 0Z"/></g>',
  lemon:
    '<g transform="translate(20.5 23.6) rotate(0)"><path d="M0 0C4.8 -3.6 4.8 -7.3 4.8 -9.2C4.8 -12.6 2.9 -14.0 0 -14.0C-2.9 -14.0 -4.8 -12.6 -4.8 -9.2C-4.8 -7.3 -4.8 -3.6 0 0Z"/></g><g transform="translate(24.7 26.6) rotate(72)"><path d="M0 0C4.8 -3.6 4.8 -7.3 4.8 -9.2C4.8 -12.6 2.9 -14.0 0 -14.0C-2.9 -14.0 -4.8 -12.6 -4.8 -9.2C-4.8 -7.3 -4.8 -3.6 0 0Z"/></g><g transform="translate(23.1 31.6) rotate(144)"><path d="M0 0C4.8 -3.6 4.8 -7.3 4.8 -9.2C4.8 -12.6 2.9 -14.0 0 -14.0C-2.9 -14.0 -4.8 -12.6 -4.8 -9.2C-4.8 -7.3 -4.8 -3.6 0 0Z"/></g><g transform="translate(17.9 31.6) rotate(216)"><path d="M0 0C4.8 -3.6 4.8 -7.3 4.8 -9.2C4.8 -12.6 2.9 -14.0 0 -14.0C-2.9 -14.0 -4.8 -12.6 -4.8 -9.2C-4.8 -7.3 -4.8 -3.6 0 0Z"/></g><g transform="translate(16.3 26.6) rotate(288)"><path d="M0 0C4.8 -3.6 4.8 -7.3 4.8 -9.2C4.8 -12.6 2.9 -14.0 0 -14.0C-2.9 -14.0 -4.8 -12.6 -4.8 -9.2C-4.8 -7.3 -4.8 -3.6 0 0Z"/></g><g transform="translate(39.5 20.0) rotate(0)"><path d="M0 0C4.2 -3.4 4.2 -6.8 4.2 -8.6C4.2 -11.7 2.5 -13.0 0 -13.0C-2.5 -13.0 -4.2 -11.7 -4.2 -8.6C-4.2 -6.8 -4.2 -3.4 0 0Z"/></g>',
  amber:
    '<path d="M23.1 45.8c-.6-4.8-.6-9.6 0-14.4.3-1.6 1.7-1.6 2 0 .6 4.8.6 9.6 0 14.4-.3 1.5-1.7 1.5-2 0Z"/><circle cx="24" cy="10.4" r="7.0"/><circle cx="14.2" cy="23.2" r="7.6"/><circle cx="33.8" cy="23.2" r="7.6"/><g transform="translate(24.0 45.0) rotate(-122)"><path d="M0 0C4.3 -3.5 4.3 -7.0 4.3 -8.9C4.3 -12.2 2.6 -13.5 0 -13.5C-2.6 -13.5 -4.3 -12.2 -4.3 -8.9C-4.3 -7.0 -4.3 -3.5 0 0Z"/></g><g transform="translate(24.0 45.0) rotate(122)"><path d="M0 0C4.3 -3.5 4.3 -7.0 4.3 -8.9C4.3 -12.2 2.6 -13.5 0 -13.5C-2.6 -13.5 -4.3 -12.2 -4.3 -8.9C-4.3 -7.0 -4.3 -3.5 0 0Z"/></g>'
};

/**
 * WHICH ADD-ONS HAVE A PHOTOGRAPH IN THIS REPO, keyed by add-on id. The catalogue's own
 * `img` still wins (/admin > Catalogue > Extras), but a catalogue published before a file
 * existed says `img: ""` for it; the repo is the thing that knows what it ships. An id here
 * must have all six files under assets/img (<name>.avif/.webp/.jpg and <name>-sm.*). An
 * add-on not here falls through to its drawing (EXTRA_ART): "samples" is absent because the
 * sampler's picture is the three scent marks, not a photograph.
 */
export const EXTRA_IMG: Record<string, string> = { burner: "burner" };

/**
 * The burner, drawn rather than photographed — at this size a photograph of a small metal
 * object is mostly shadow, and a drawing costs no request. A real photograph wins the
 * moment one is named in the panel.
 */
export const EXTRA_ART: Record<string, string> = {
  burner:
    '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<ellipse cx="24" cy="38" rx="7" ry="2.2" fill="#8a6a45"/>' +
      '<path d="M8 30h32v2a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6v-2Z" fill="#f2efe9"/>' +
      '<ellipse cx="24" cy="30" rx="16" ry="4.6" fill="#1f49a8"/>' +
      '<ellipse cx="24" cy="30" rx="10.5" ry="2.8" fill="#16357c"/>' +
      '<rect x="22.4" y="22" width="3.2" height="7" rx="1" fill="#1f49a8"/>' +
      '<path d="M13 13c0-.9.8-1.5 1.6-1.1a4 4 0 0 0 4-.3 1.3 1.3 0 0 1 1.6.1 4 4 0 0 0 3.8.9 4 4 0 0 0 3.8-.9 1.3 1.3 0 0 1 1.6-.1 4 4 0 0 0 4 .3c.8-.4 1.6.2 1.6 1.1v4.6A7.4 7.4 0 0 1 24 25a7.4 7.4 0 0 1-11-7.4V13Z" fill="#1f49a8"/>' +
      '<path d="M16.4 16.6h15.2A5.8 5.8 0 0 1 24 22a5.8 5.8 0 0 1-7.6-5.4Z" fill="#cfd4dc"/>' +
    "</svg>"
};

export const pictures: Pick<LmApi, "img" | "imgFor" | "extraImg" | "scentMark" | "lineMark" | "scentArt" | "extraArt"> = {
  /**
   * Which packshot belongs to a size. Derived at render time rather than read back off the
   * saved cart line, so a basket saved before this existed shows the right box.
   */
  img(sizeId) {
    return SIZE_IMG[String(sizeId)] || SIZE_IMG.small!;
  },

  /**
   * The picture for a whole cart LINE: an offer is its box, the three-scent set the small
   * box (v310), an add-on its own photograph — "" when it has none (the callers draw a
   * plain tile rather than a broken <img>).
   */
  imgFor(line) {
    if (line && LM.isTier(line.sizeId)) return LM.img(LM.tierSize());
    if (line && line.sizeId === "bundle") return LM.img(LM.bundleSize());
    const x = line && !line.scentId ? LM.listFor("extras").filter((e) => e && e.id === line.sizeId)[0] : null;
    if (x) return LM.extraImg(x);
    return LM.img(line && line.sizeId);
  },

  /**
   * The file name of an add-on's photograph, or "". The catalogue's own `img` first (the
   * admin's override), then what this repo ships for that id. One gate, at the source:
   * nothing that can climb out of assets/img reaches a src.
   */
  extraImg(x) {
    if (!x) return "";
    const v = String(x.img || "");
    if (/^[a-z0-9-]{1,40}$/i.test(v)) return v;
    return EXTRA_IMG[x.id] || "";
  },

  /** a small scent chip for the cart and checkout thumbnails: the accent behind the glyph */
  scentMark(scentId) {
    const s = LM.listFor("scents").filter((x) => x.id === scentId)[0];
    if (!s) return "";
    const c = hexOr(s.accent, "#8f7238");
    const name = String(txt(s, "name") || "").replace(/[&<>"']/g, "");
    return '<span class="scent-mark" style="background:' + c + '" title="' + name + '">' + LM.scentArt(s.art) + "</span>";
  },

  /**
   * The scent shapes for a basket line, in their own colour, side by side: one for a box,
   * one per scent for an offer (v303/v305), one per scent the set holds (v310).
   */
  lineMark(line) {
    if (!line) return "";
    let cnt: Record<string, number>;
    if (line.sizeId === "bundle") {
      cnt = {};
      LM.scents().forEach((s) => (cnt[s.id] = 1));
    } else if (LM.isTier(line.sizeId)) cnt = LM.tierCounts(line.mix);
    else if (line.scentId) cnt = { [line.scentId]: 1 };
    else cnt = {};
    if (!Object.keys(cnt).length) return "";
    return (
      '<span class="scent-marks">' +
      Object.keys(cnt)
        .map((id) => {
          const s = LM.listFor("scents").filter((x) => x.id === id)[0];
          if (!s) return "";
          const c = hexOr(s.accent, "#8f7238");
          return '<i class="scent-art" style="color:' + c + '">' + LM.scentArt(s.art) + "</i>";
        })
        .join("") +
      "</span>"
    );
  },

  scentArt(art) {
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' + (ART[String(art)] || ART.lavender) + "</svg>";
  },

  /**
   * The picture for an add-on, drawn rather than fetched. A sampler's picture is the SCENTS
   * — built from the market's own list; `dim` (scentId → true) greys the ones already in
   * the basket (the delivery bar passes it; the cart and the summary do not).
   */
  extraArt(x, dim) {
    if (!x) return "";
    if (x.art === "scents") {
      return (
        '<span class="sa-art">' +
        LM.scents()
          .slice(0, 3)
          .map((s) => {
            const off = !!(dim && dim[s.id]);
            const c = hexOr(s.accent, "#8f7238");
            return '<span class="sa-dot' + (off ? " off" : "") + '"' + (off ? "" : ' style="background:' + c + '"') + ">" + LM.scentArt(s.art) + "</span>";
          })
          .join("") +
        "</span>"
      );
    }
    return EXTRA_ART[String(x.art)] ? '<span class="ex-draw">' + EXTRA_ART[String(x.art)] + "</span>" : "";
  },
};
