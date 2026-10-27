/**
 * Who owns which catalogue field.
 *
 * ADMIN-OWNED: prices, shipping, thresholds, the COD fee, names, offer copy, switches —
 * business decisions. A deploy never overwrites one.
 *
 * CODE-OWNED: the OMR conversion rates, the drawing each scent/add-on renders with, and
 * the add-ons' `countsFree` rule. They come from the deploy's bundled catalogue on every
 * read, and the panel can neither set nor lose them.
 *
 * The live catalogue = the published one with the code-owned fields overlaid. The public
 * API and the pricing engine both read it through `merge`, so the page and the till
 * cannot disagree.
 */
import type { Catalogue, Country, Extra, Scent } from "./types";

export const CODE_OWNED = {
  country: ["toOmr"],
  offer: [] as string[],
  scent: ["art"],
  extra: ["art", "countsFree"],
} as const;

type WithId = { id?: string; [k: string]: unknown };

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function mergeById<T extends WithId>(list: T[] | undefined, deployList: WithId[] | undefined, fields: readonly string[]): T[] | undefined {
  if (!Array.isArray(list)) return list;
  const byId: Record<string, WithId> = {};
  (deployList || []).forEach((s) => {
    if (s && s.id) byId[s.id] = s;
  });
  return list.map((s) => {
    const d = s && s.id ? byId[s.id] : undefined;
    if (!d) return s;
    const merged: Record<string, unknown> = { ...s };
    fields.forEach((k) => {
      if (d[k] !== undefined) merged[k] = d[k];
    });
    return merged as T;
  });
}

/**
 * English words lent from the deploy where the shop has written none — but only while the
 * Arabic still says what the deploy says (a renamed size must not pick up the old English),
 * and never over a value the shop has set.
 */
export function fillEnglish<T extends Record<string, unknown>>(item: T, source: Record<string, unknown> | undefined): T {
  if (!item || !source) return item;
  let out: Record<string, unknown> = item;
  Object.keys(source).forEach((k) => {
    if (!/_en$/.test(k)) return;
    const base = k.slice(0, -3);
    const have = item[k];
    if (have !== undefined && have !== null && String(have).trim() !== "") return;
    if (String(item[base] == null ? "" : item[base]) !== String(source[base] == null ? "" : source[base])) return;
    if (out === item) out = { ...item };
    out[k] = source[k];
  });
  return out as T;
}

function fillEnglishList<T extends WithId>(list: T[] | undefined, deployList: WithId[] | undefined): T[] | undefined {
  if (!Array.isArray(list) || !Array.isArray(deployList)) return list;
  const byId: Record<string, WithId> = {};
  deployList.forEach((s) => {
    if (s && s.id) byId[s.id] = s;
  });
  return list.map((s) => (s && s.id && byId[s.id] ? fillEnglish(s, byId[s.id]) : s));
}

const mergeScents = (list: Scent[] | undefined, d: WithId[] | undefined) => mergeById(list, d, CODE_OWNED.scent);
const mergeExtras = (list: Extra[] | undefined, d: WithId[] | undefined) => mergeById(list, d, CODE_OWNED.extra);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The catalogue has at least one market. */
export function seeded(data: unknown): data is Catalogue {
  const c = data as Catalogue | null;
  return !!(c && Array.isArray(c.countries) && c.countries.length);
}

/**
 * Published wins everywhere except the code-owned fields. Never mutates either argument.
 */
export function merge(published: Catalogue | null | undefined, deploy: Catalogue | null | undefined): Catalogue | null {
  if (!seeded(published)) return deploy || published || null;
  if (!deploy) return published;
  const out = clone(published);
  const byCode: Record<string, Country> = {};
  (deploy.countries || []).forEach((c) => {
    if (c && c.code) byCode[c.code] = c;
  });

  out.scents = fillEnglishList(mergeScents(out.scents, deploy.scents), deploy.scents) as Scent[];
  out.sizes = fillEnglishList(out.sizes, deploy.sizes) as Catalogue["sizes"];

  // A default, not an override: a catalogue published before add-ons existed gets the deploy's.
  if (!Array.isArray(out.extras) || !out.extras.length) {
    if (Array.isArray(deploy.extras) && deploy.extras.length) out.extras = clone(deploy.extras);
  }
  out.extras = fillEnglishList(mergeExtras(out.extras, deploy.extras), deploy.extras);

  const extraIds: Record<string, true> = {};
  (out.extras || []).forEach((x) => {
    if (x && x.id) extraIds[x.id] = true;
  });

  out.countries = (out.countries || []).map((c) => {
    const d = byCode[c.code];
    const dScents = (d && d.scents) || deploy.scents;
    const dSizes = (d && d.sizes) || deploy.sizes;
    const dExtras = (d && d.extras) || deploy.extras;
    const withArt: Country = {
      ...fillEnglish(c, d),
      scents: fillEnglishList(mergeScents(c.scents, dScents), dScents),
      sizes: fillEnglishList(c.sizes, dSizes),
      extras: fillEnglishList(mergeExtras(c.extras, dExtras), dExtras),
    };
    if (!c.scents) delete withArt.scents;
    if (!c.sizes) delete withArt.sizes;
    if (!c.extras) delete withArt.extras;
    if (!d) return withArt;
    CODE_OWNED.country.forEach((k) => {
      if (num(d[k]) !== null) withArt[k] = d[k];
    });
    // Gap-fill prices for add-ons and the large-box offers only; never a size.
    if (d.prices) {
      const merged = { ...withArt.prices };
      Object.keys(d.prices).forEach((id) => {
        if ((extraIds[id] || id === "duo" || id === "trio") && merged[id] === undefined) {
          merged[id] = { ...d.prices![id]! };
        }
      });
      withArt.prices = merged;
    }
    return withArt;
  });

  if (out.offer && deploy.offer) {
    out.offer = { ...fillEnglish(out.offer, deploy.offer) };
    CODE_OWNED.offer.forEach((k) => {
      if (deploy.offer![k] !== undefined) out.offer![k] = deploy.offer![k];
      else delete out.offer![k];
    });
    // A default length until the shop sets one.
    if (out.offer.hours == null && out.offer.repeat == null && deploy.offer.hours != null) {
      out.offer.hours = deploy.offer.hours;
    }
    // The small size sold only as the set: starts ON for a catalogue that predates the switch.
    if (out.offer.only === undefined) out.offer.only = true;
  }
  // The large three-scent set is retired.
  delete out.offer2;
  if (deploy.tiers && !(out.tiers && typeof out.tiers === "object")) out.tiers = clone(deploy.tiers);
  if (deploy.version !== undefined) out.version = deploy.version;
  return out;
}

/** What the admin may persist: the code-owned keys stripped. */
export function stripCodeOwned(data: Catalogue): Catalogue {
  if (!data) return data;
  const out = clone(data);
  const strip = (list: WithId[] | undefined, fields: readonly string[]) =>
    (list || []).forEach((s) => fields.forEach((k) => delete s[k]));
  strip(out.scents, CODE_OWNED.scent);
  strip(out.extras, CODE_OWNED.extra);
  (out.countries || []).forEach((c) => {
    CODE_OWNED.country.forEach((k) => delete c[k]);
    strip(c.scents, CODE_OWNED.scent);
    strip(c.extras, CODE_OWNED.extra);
  });
  if (out.offer) CODE_OWNED.offer.forEach((k) => delete out.offer![k]);
  return out;
}

/** What the storefront may see: no operational settings (routing, ledger). Copies, never deletes in place. */
export function publicView(merged: Catalogue): Catalogue {
  const data: Catalogue = {
    ...merged,
    countries: (merged.countries || []).map((c) => {
      const x = { ...c };
      delete x.courier;
      return x;
    }),
  };
  delete data.courier;
  delete data.ledger;
  return data;
}
