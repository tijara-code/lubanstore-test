/**
 * THE ORDER'S HISTORY — every change, oldest first, from order_events: who (the shopper, a
 * person in the panel by name, the payment, Empower, a job) and what, in a sentence.
 * Customer corrections are named by field, never by value.
 */
import type { OrderEvent } from "../../../shared/admin/api";
import { dtt } from "../../lib/format";
import { STATUS } from "../../lib/words";

const WHO: Record<string, string> = {
  shopper: "Customer",
  admin: "Panel",
  "admin:force": "Panel",
  webhook: "Thawani",
  payment: "Payment",
  push: "Empower push",
  courier: "Courier",
  omniful: "Empower",
};

export function whoOf(e: Pick<OrderEvent, "by" | "detail">): string {
  const actor = e.detail && typeof e.detail.actor === "string" ? e.detail.actor : "";
  if (actor) return actor;
  if (/^job:/.test(e.by)) return "Job " + e.by.slice(4);
  return WHO[e.by] || e.by;
}

const EMPOWER: Record<string, string> = {
  pushed: "Pushed to Empower",
  adopted: "Recorded as on Empower (Omniful already had it)",
  taken_off: "Taken off Empower",
  mark_removed: "Empower mark removed (cancelled in Omniful by hand)",
};

const st = (s: string | null) => (s ? STATUS[s] || s : "—");

/** One event in a sentence. */
export function eventText(e: Pick<OrderEvent, "kind" | "from" | "to" | "detail">): string {
  const d = (e.detail || {}) as Record<string, unknown>;
  switch (e.kind) {
    case "created":
      return "Order placed" + (d.origin === "whatsapp_order" ? " (typed in from WhatsApp)" : "") + (d.codAmount != null ? " · collect " + String(d.codAmount) : "");
    case "status":
      return "Status: " + st(e.from) + " → " + st(e.to) + (d.force ? " (moved back)" : "");
    case "payment":
      return "Payment: " + (e.from || "—") + " → " + (e.to || "—");
    case "refund":
      return "Refunded";
    case "customer":
      return "Customer details changed" + (Array.isArray(d.fields) && d.fields.length ? " (" + (d.fields as string[]).join(", ") + ")" : "");
    case "items":
      return "Items changed" + (Array.isArray(d.lines) ? ": " + (d.lines as string[]).join(", ") : "") + (d.was != null && d.total != null ? " · total " + String(d.was) + " → " + String(d.total) : "") + (d.codAmount != null ? " (agreed amount)" : "");
    case "tracking":
      return "Tracking: " + (e.to || "cleared") + (d.carrier ? " (" + String(d.carrier) + ")" : "");
    case "flag":
      return "Flagged";
    case "unflag":
      return "Flag cleared";
    case "note":
      return Number(d.length) ? "Note written" : "Note cleared";
    case "trash":
      return "Moved to the trash";
    case "restore":
      return "Restored from the trash";
    case "empower": {
      const what = EMPOWER[String(e.to || "")] || "Empower: " + String(e.to || "updated").replace(/_/g, " ");
      return what + (d.sentId ? " (as " + String(d.sentId) + ")" : "") + (d.ref ? " · Omniful " + String(d.ref) : "");
    }
    default:
      return e.kind.replace(/_/g, " ") + (e.from || e.to ? ": " + (e.from || "—") + " → " + (e.to || "—") : "");
  }
}

export function History({ events }: { events: OrderEvent[] }) {
  if (!events.length) return <p class="hint">Nothing recorded yet.</p>;
  return (
    <ol class="timeline">
      {events.map((e) => (
        <li key={e.id}>
          <time dateTime={e.at}>{dtt(e.at)}</time>
          <span class="what">{eventText(e)}</span>
          <span class="by">{whoOf(e)}</span>
        </li>
      ))}
    </ol>
  );
}
