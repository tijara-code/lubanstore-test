/**
 * The Empower tab's routes (docs/notes/admin-api.md, domain/empower/admin.ts): the connection's
 * state with the routes and the auto switch, the Waiting list, what was pushed, Push all, the
 * switch, Check statuses, the SKU map and its match. Pushing one order and taking one off are
 * phase 1's (data/endpoints.ts), with the duplicate question (tabs/orders/empower.ts).
 */
import type { OrderLine } from "../../../shared/orders/types";
import { get, send } from "../../data/api";

export interface Run {
  at: string;
  pushed?: number;
  considered?: number;
  waiting?: number;
  failed?: Array<{ id: string; error: string; detail: string; at?: string }>;
  flagged?: Array<{ id: string; missing: string[] }>;
  error?: string;
  tracked?: number;
  updated?: number;
  moved?: number;
  errors?: Array<{ id: string | null; error: string; detail: string }>;
  [k: string]: unknown;
}

export interface MarketRoute {
  code: string;
  name: string;
  courier: "omniful" | "manual";
  /** false: the default (nobody chose) */
  chosen: boolean;
}

export interface AutoState {
  on: boolean;
  since: string | null;
  afterMin: number;
  everyMin: number;
  retryH: number;
  last: Run | null;
}

export interface EmpowerStatus {
  ok: true;
  configured: boolean;
  env: "staging" | "production";
  base: string;
  hub: "set" | "";
  renews: boolean;
  missing: string[];
  lastSweep: Run | null;
  lastPoll: Run | null;
  routing: MarketRoute[];
  couriers: string[];
  labels: Record<string, string>;
  waiting: number;
  pushed: number;
  hookPath: string;
  hookGuarded: boolean;
  skus: Record<string, string>;
  auto: AutoState;
}

export interface WaitingOrder {
  id: string;
  createdAt: string;
  name: string | null;
  phone: string | null;
  countryCode: string;
  city: string | null;
  region: string | null;
  cur: string;
  total: number;
  ship: number;
  codFee: number;
  pay: string;
  paymentStatus: string;
  origin: string | null;
  items: OrderLine[];
  lines: Array<{ code: string; sku: string; qty: number }>;
  check?: string[];
  skuMissing?: string[];
  unsure?: boolean;
}

/** a shipments row as the API sends it */
export interface PushedRow {
  id: string;
  orderId: string | null;
  carrier: string;
  sentId: string;
  reference: string | null;
  awb: string | null;
  courierName: string | null;
  status: string | null;
  cod: number | null;
  createdAt: string;
  updatedAt: string;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  syncedAt: string | null;
  lastError: string | null;
}

export interface SweepAnswer {
  ok: true;
  pushed?: number;
  considered?: number;
  left?: string[];
  waiting?: number;
  failed?: Array<{ id: string; error: string; detail: string }>;
  skipped?: string;
}

export interface SyncAnswer {
  ok: true;
  tracked?: number;
  updated?: number;
  moved?: number;
  errors?: Array<{ id: string | null; error: string; detail: string }>;
  skipped?: string;
}

export const getStatus = () => get<EmpowerStatus>("/empower");
export const getWaiting = () => get<{ ok: true; orders: WaitingOrder[] }>("/empower/waiting");
export const getPushed = (limit = 1000) => get<{ ok: true; rows: PushedRow[] }>("/empower/pushed", { limit });
export const pushMany = (ids: string[]) => send<SweepAnswer>("POST", "/empower/push-many", { ids });
export const setAuto = (on: boolean) => send<AutoState & { ok: true }>("PUT", "/empower/auto", { on });
export const syncStatuses = () => send<SyncAnswer>("POST", "/empower/sync", {});
export const saveSkus = (skus: Record<string, string>) => send<{ ok: true; skus: Record<string, string> }>("PUT", "/empower/skus", { skus });
export const matchSkus = (skus: Record<string, string>) => send<{ ok: true; matches: Record<string, { sku: string | null; problem: string | null }>; known: number }>("POST", "/empower/skus/match", { skus });
export const omnifulSkus = () => get<{ ok: true; skus: Array<{ sku_code: string; name: string; type?: string }> }>("/empower/catalog");
export const setRoute = (code: string, courier: "omniful" | "manual") => send<{ ok: true; code: string; courier: string }>("PUT", "/empower/routes/" + encodeURIComponent(code), { courier });
