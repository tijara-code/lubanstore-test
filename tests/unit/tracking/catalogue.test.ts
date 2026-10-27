import { describe, expect, it } from "vitest";
import { ADD_TO_CART, EVENTS, ITEM_KEPT, LM_NAMES, META_RELAY, SNAP_RELAY, names, pickName } from "../../../src/shared/pixels/catalogue";

// from test-v325.js: the event catalogue
describe("the event catalogue", () => {
  it("the Meta relay's allowlist: the five, Purchase absent", () => {
    expect(META_RELAY.join(",")).toBe("PageView,ViewContent,AddToCart,InitiateCheckout,AddPaymentInfo");
    expect(names("meta")).toContain("Purchase");
  });
  it("the Snap relay's allowlist: the five, PURCHASE absent", () => {
    expect(SNAP_RELAY.join(",")).toBe("PAGE_VIEW,VIEW_CONTENT,ADD_CART,START_CHECKOUT,ADD_BILLING");
  });
  it("the first-party allowlist: the thirteen names", () => {
    expect(LM_NAMES.slice().sort().join(",")).toBe("add_cart,cart_open,checkout_view,extra_add,offer_add,order_placed,page_view,pay_method,session_start,size_open,suggest_add,track_lookup,whatsapp_click");
  });
  it("Purchase carries the order id as its dedup id on both ad platforms; GA4's purchase is the server's", () => {
    expect(EVENTS.filter((e) => /^purchase$/i.test(e.name) && e.platform !== "ga4").every((e) => /order id/.test(e.id))).toBe(true);
    expect(EVENTS.find((e) => e.platform === "ga4" && e.name === "purchase")!.side).toBe("server");
  });
  // from test-stats.js / test-admin-tweaks.js: every add counts as an add to cart
  it("every way into the basket is one add, and the roll-up keeps their items", () => {
    expect(Object.keys(ADD_TO_CART).sort()).toEqual(["add_cart", "extra_add", "offer_add", "suggest_add"]);
    expect(ITEM_KEPT).toEqual(["add_cart", "offer_add", "suggest_add", "extra_add", "session_start"]);
    expect(Object.keys(ADD_TO_CART).every((n) => LM_NAMES.includes(n))).toBe(true);
  });
  it("picks a name case-insensitively, in the platform's casing", () => {
    expect(pickName(META_RELAY, "addtocart")).toBe("AddToCart");
    expect(pickName(META_RELAY, "Purchase")).toBe("");
    expect(pickName(SNAP_RELAY, "purchase")).toBe("");
    expect(pickName(SNAP_RELAY, "add_billing")).toBe("ADD_BILLING");
  });
});
