/**
 * (STUB — owned by the orders area.) What a shopper posts to a till, whitelisted and
 * capped. Nothing about money: that is priced from the catalogue.
 */
import type { RefInput } from "../../shared/attribution";
import type { ClientSignals } from "../../shared/orders/types";

export interface Intake {
  name: string;
  phone: string;
  email: string | null;
  items: Array<{ itemId: string; qty: number }>;
  countryCode: string;
  city: string;
  region: string;
  note: string;
  dedupeId: string | null;
  /** the browser's proposed LM- id, when well formed */
  proposedId: string | null;
  pageUrl: string | null;
  lang: "ar" | "en";
  ref: RefInput | null;
  /** fbp, fbc, scid, sccid, gcid, gsid, vid … from the page */
  signals: ClientSignals;
}

/** A refusal before pricing: { error: "incomplete" | "bad_qty" | "too_many" | "unknown_item", item? }. */
export interface IntakeRefusal {
  error: string;
  item?: string | null;
}

export function parseIntake(body: unknown): { intake: Intake } | { refusal: IntakeRefusal } {
  void body;
  return { refusal: { error: "incomplete" } };
}
