/**
 * The Catalogue tab's routes (docs/notes/admin-api.md): the catalogue, its publish, restore,
 * the Stock Tracker's switches and the shelf reading; a market's route (Empower tab's route,
 * offered beside the market). Answer types from src/shared/admin/api.ts.
 */
import type { CatalogueAnswer, Jsonify, PublishAnswer } from "../../../shared/admin/api";
import type { Catalogue } from "../../../shared/catalogue/types";
import { get, send, urlOf } from "../../data/api";

export type CatalogueRead = Jsonify<CatalogueAnswer>;
export type Published = Jsonify<PublishAnswer>;

export const readCatalogue = () => get<CatalogueRead>("/catalogue");
export const publishCatalogue = (body: { data: Catalogue; version: number; editTag?: string }) => send<Published>("POST", "/catalogue/publish", body);
export const restoreDefaults = (body: { version: number; editTag?: string }) => send<Published>("POST", "/catalogue/restore-defaults", { ...body, confirm: "defaults" });
export const patchStock = (body: { stockLive?: boolean; stockCap?: Record<string, boolean>; stockHide?: Record<string, boolean> }) => send<Published>("PATCH", "/catalogue/stock", body);
export const exportUrl = () => urlOf("/catalogue/export");
export const setRoute = (code: string, courier: "omniful" | "manual") => send<{ ok: true; code: string; courier: string }>("PUT", "/empower/routes/" + encodeURIComponent(code), { courier });

/* ---------------- the shelf (GET /stock) ---------------- */

export interface TrackerRow {
  id: string;
  sku: string;
  available: number;
  onHand: number;
  shelf?: number;
  reserved?: number;
}
export interface StockRead {
  ok: true;
  on: boolean;
  hideSet: string[];
  capSet: string[];
  cap: Record<string, number>;
  left: Record<string, number>;
  at: string | null;
  source: string;
  error: string | null;
  note: string | null;
  hubs: string[] | null;
  fields: string[] | null;
  skus: number | null;
  tracker: TrackerRow[];
  held: Array<{ id: string; status: string; at: string; boxes: Record<string, number> }>;
  heldHours: number;
  heldDaysManual?: number;
  hide: { items: string[]; sizes: string[] };
  items: Record<string, string>;
}
export const readStock = (fresh = false) => get<StockRead>("/stock", fresh ? { fresh: true } : undefined);
