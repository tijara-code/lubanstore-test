/**
 * THE ENDPOINTS THE PANEL CALLS, typed — one function per route, the request and answer types
 * from src/shared/admin/api.ts (never redeclared here). The route table is
 * docs/notes/admin-api.md. A tab added later adds its own functions in the same style.
 */
import type {
  BulkAnswer, BulkBody, CatalogueAnswer, CustomerBody, ItemOptionsAnswer, ItemsBody, Jsonify, ManualOrderAnswer,
  ManualOrderBody, MoveAnswer, OrderDetailAnswer, OrdersAnswer, OrdersQuery, OrdersUnchanged, OverviewAnswer,
  SessionAnswer, StatusBody, TrackingBody, UiAnswer,
} from "../../shared/admin/api";
import type { OrderLine } from "../../shared/orders/types";
import { get, send, urlOf, type Query } from "./api";

/* ---------------- session ---------------- */

export const getSession = () => get<SessionAnswer>("/session");
export const login = (user: string, password: string) => send<{ ok: true; user: string; expiresAt: string }>("POST", "/login", { user, password });
export const logout = (everywhere = false) => send<{ ok: true }>("POST", "/logout", { everywhere });

/* ---------------- panel ---------------- */

export const getOverview = () => get<OverviewAnswer>("/overview");
export const getUi = () => get<UiAnswer>("/settings/ui");
export const putUi = (body: { hidden?: string[]; dismissed?: string[] }) => send<UiAnswer>("PUT", "/settings/ui", body);
export const getCatalogue = () => get<Jsonify<CatalogueAnswer>>("/catalogue");

/* ---------------- orders ---------------- */

export type OrdersFilter = Omit<OrdersQuery, "since">;
export const listOrders = (q: OrdersFilter & { since?: string }) => get<OrdersAnswer | OrdersUnchanged>("/orders", q as Query);
export const exportUrl = (q: OrdersFilter) => urlOf("/orders/export.csv", q as Query);
export const orderDetail = (id: string) => get<OrderDetailAnswer>("/orders/" + encodeURIComponent(id));
export const orderGateway = (id: string) => get<{ ok: true; id: string; gateway: unknown }>("/orders/" + encodeURIComponent(id) + "/gateway");
export const itemOptions = (country: string) => get<ItemOptionsAnswer>("/orders/options", { country });

const one = (id: string, rest: string) => "/orders/" + encodeURIComponent(id) + rest;

export const patchCustomer = (id: string, body: CustomerBody) => send<{ ok: true; patch: Record<string, string | null> }>("PATCH", one(id, "/customer"), body);

export interface RequoteAnswer {
  ok: true;
  items: OrderLine[];
  cur: string;
  ship: number;
  total: number;
  omr: number;
  catalogueTotal: number;
  codAmount: number | null;
  was: number;
}
export const putItems = (id: string, body: ItemsBody) => send<RequoteAnswer>("PUT", one(id, "/items"), body);
export const moveStatus = (id: string, body: StatusBody) => send<MoveAnswer>("POST", one(id, "/status"), body);
export const putTracking = (id: string, body: TrackingBody) => send<{ ok: true }>("PUT", one(id, "/tracking"), body);
export const setPayment = (id: string, to: "cod" | "paid") => send<{ ok: true; updated: number; stale: string[] }>("POST", one(id, "/payment"), { to });
export const setFlag = (id: string, on: boolean) => send<{ ok: true; updated: number; flagged: boolean }>("PUT", one(id, "/flag"), { on });
export const setNote = (id: string, note: string) => send<{ ok: true; updated: number }>("PUT", one(id, "/note"), { note });
export const bulk = (body: BulkBody) => send<BulkAnswer>("POST", "/orders/bulk", body);

export interface QuoteAnswer {
  ok: true;
  cur: string;
  sub: number;
  ship: number;
  codFee: number;
  total: number;
  omr: number;
  catalogueTotal?: number;
  codAmount?: number;
  pay: "cod" | "transfer";
}
export const manualQuote = (body: Partial<ManualOrderBody>) => send<QuoteAnswer>("POST", "/orders/manual/quote", body);
export const manualCreate = (body: ManualOrderBody) => send<ManualOrderAnswer>("POST", "/orders/manual", body);

/* ---------------- Empower, from an order ---------------- */

export interface PushAnswer {
  ok: true;
  skipped?: string;
  sentId?: string;
  status?: string;
  adopted?: boolean;
  carrier?: string;
  awb?: string;
  [k: string]: unknown;
}
export const pushEmpower = (body: { id: string; any?: boolean; fresh?: boolean; adopt?: boolean }) => send<PushAnswer>("POST", "/empower/push", body);
export const takeOffEmpower = (body: { id: string; markOnly?: boolean }) => send<PushAnswer>("POST", "/empower/take-off", body);
