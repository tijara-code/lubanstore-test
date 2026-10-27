/// <reference path="./globals.d.ts" />
/**
 * The storefront's shared shapes: a basket line and the `LM` api (window.LM).
 *
 * `LM.cfg` and `LM.c` are typed as present: they are null only until `LM.ready` resolves,
 * and every page script that reads them does so from inside (or after) `LM.ready`.
 */
import type { Catalogue, Country, Extra, Offer, Scent, Size, Tiers } from "../../shared/catalogue/types";
import type { FreeDeal } from "../../shared/pricing/offers";

export type { Catalogue, Country, Extra, Offer, Scent, Size, Tiers, FreeDeal };

/**
 * A line of the basket, as stored in sessionStorage "lm_cart" and read through
 * LM.readCart() (only lines with a string sizeId and a whole qty ≥ 1 survive). Kinds:
 * - a box:    { sizeId: "large", scentId: "oud", qty, … }
 * - an offer: { sizeId: "trio" | "duo", scentId: null, mix: ["oud","oud","amber"], … }
 * - the set:  { sizeId: "bundle", scentId: "bundle", … }
 * - an add-on: { sizeId: "burner", qty } (no scentId)
 * The till prices every line itself; `price` is what the page showed.
 */
export interface CartLine {
  sizeId: string;
  scentId?: string | null;
  mix?: string[];
  scent?: string;
  size?: string;
  price?: number;
  qty: number;
  img?: string;
  [k: string]: unknown;
}

/** A parked cash order (checkout.js builds it; the queue only needs the id and the total). */
export interface ParkedOrder {
  id: string;
  omr?: number;
  [k: string]: unknown;
}

export type Vars = Record<string, string | number | boolean | null | undefined>;
export type EnEntry = string | ((v: Vars) => string);

export interface LmApi {
  /* ---- state ---- */
  /** the catalogue in use (set once LM.ready resolves) */
  cfg: Catalogue;
  /** the active market (set once LM.ready resolves) */
  c: Country;
  /** resolves (once) with LM when the catalogue and the market are known */
  ready: Promise<LmApi>;
  /** "supabase" (the live /api/settings answer) or "settings.json" (the bundled catalogue) */
  source?: string;
  /** "server" once the server's clock was read from a Date header */
  clock?: string;
  /** the country the edge geo lookup answered, when it decided the market */
  geo?: string | null;
  /** "ar" | "en", from <html lang> */
  lang: "ar" | "en";
  /** where assets/ is relative to this page: "" (Arabic, root) or "../" (/en/) */
  root: string;
  /** "?v=<hash>" — append to every assets/img URL the code builds ("" when unbuilt) */
  v: string;

  /* ---- words ---- */
  L(s: string, v?: Vars): string;
  txt(o: unknown, k: string): string;
  esc(v: unknown): string;
  $(s: string): Element | null;

  /* ---- money ---- */
  moneyMark(): string;
  moneyHTML(n: number): string;
  money(n: number): string;
  num(n: number): string;
  omrRate(): number;
  omrNum(n: number): number;
  omr(n: number): string;
  price(sizeId: string): number;
  was(sizeId: string): number;

  /* ---- pictures ---- */
  img(sizeId: string | null | undefined): string;
  imgFor(line: CartLine | null | undefined): string;
  extraImg(x: Extra | null | undefined): string;
  scentMark(scentId: string | null | undefined): string;
  lineMark(line: CartLine | null | undefined): string;
  scentArt(art: string | null | undefined): string;
  extraArt(x: Extra | null | undefined, dim?: Record<string, unknown> | null): string;

  /* ---- delivery and cash ---- */
  ship(): number;
  freeDeal(): FreeDeal | null;
  freeOver(): number;
  cod(): number;
  codOn(): boolean;
  setFree(cart: CartLine[] | null | undefined): boolean;
  setShipsFree(): boolean;
  setFreeEndsAt(): number | null;
  countsFree(line: CartLine | null | undefined): boolean;
  freeSub(cart: CartLine[] | null | undefined, unit?: ((l: CartLine) => number) | null): number;

  /* ---- the clock and the set's window ---- */
  now(): number;
  offerCycleMs(o: Partial<Offer> | Tiers | null | undefined): number;
  offerAnchor(o: Partial<Offer> | Tiers | null | undefined): number;
  offerEndsAt(o: Partial<Offer> | Tiers | null | undefined): Date | null;
  isBundle(id: unknown): boolean;
  offerCfg(id?: string): Offer | null;
  offerHere(id?: string): boolean;
  offer(id?: string): Offer | null;
  offerLeftMs(id?: string): number | null;
  offerEnded(line: CartLine | null | undefined): boolean;
  offWords(line: CartLine | null | undefined): string;
  bundleSize(): string;
  bundleOnlySize(): string;
  bundleSizeId(id?: string): string;
  bundleSellable(id?: string): boolean;
  bundleScents(id?: string): Scent[];
  bundleOpen(): boolean;

  /* ---- the large-box offers ---- */
  isTier(id: unknown): boolean;
  tierN(id: unknown): number;
  tierCfg(): Tiers | null;
  tierSize(): string;
  tierClockShown(): boolean;
  tierUnstarted(): boolean;
  tierEndsAt(): number | null;
  tierLive(): boolean;
  tierOn(id: unknown): boolean;
  tierWas(id: unknown): number;
  tierId(id: string, mix: string[] | null | undefined): string;
  tierCounts(mix: string[] | null | undefined): Record<string, number>;

  /* ---- the catalogue, for this market ---- */
  countries(): Country[];
  listFor(kind: "sizes"): Size[];
  listFor(kind: "scents"): Scent[];
  listFor(kind: "extras"): Extra[];
  listFor(kind: string): Array<Size | Scent | Extra>;
  sizes(): Size[];
  scents(): Scent[];
  extras(): Extra[];
  fromPrice(): number;
  setCountry(code: string): void;

  /* ---- basket lines ---- */
  lineOffered(line: CartLine | null | undefined): boolean;
  blockedLines(cart: CartLine[] | null | undefined): CartLine[];
  itemId(line: CartLine | null | undefined): string;
  lineLabel(line: CartLine | null | undefined): { scent: string; size: string };
  extraOf(line: CartLine | null | undefined): Extra | null;
  readCart(): CartLine[];

  /* ---- the shelf (pieces left, caps, hides) ---- */
  stockShown(n: number | null | undefined): number | null | undefined;
  stockLeft(id: string): number | null;
  stockPending(): boolean;
  stockHidden(scentId: string, sizeId: string): boolean;
  stockHiddenSize(sizeId: string): boolean;
  stockCap(scentId: string, sizeId: string): number | null;
  lineBoxes(line: CartLine | null | undefined): Record<string, number>;
  basketBoxes(cart: CartLine[] | null | undefined): Record<string, number>;
  capRoom(scentId: string, sizeId: string, cart: CartLine[] | null | undefined): number | null;
  lineRoom(line: CartLine | null | undefined, cart: CartLine[] | null | undefined): number | null;
  loadStock(): void;

  /* ---- parked orders ---- */
  queueOrder(o: ParkedOrder): void;
  flushOrders(): Promise<number>;

  /* ---- diagnostics ---- */
  debug(): { active: string | null; saved: string | null; codes: string; source: string };
}
