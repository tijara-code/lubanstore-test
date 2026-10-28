/**
 * PUSHING AN ORDER TO EMPOWER (OMNIFUL), from the Orders tab — one order or the selection.
 * The server keeps the guard that matters (never twice, never a second parcel); the panel
 * asks the one question only a person can answer: Omniful already has this order number —
 * was it our earlier push that got no answer (record it, send nothing), or was the old one
 * cancelled at Omniful (send it again under a new id)? (v402)
 */
import { isApiError } from "../../data/api";
import { pushEmpower, takeOffEmpower, type PushAnswer } from "../../data/endpoints";
import { ask, choose } from "../../kit";
import { explain } from "../../lib/words";

export type PushOutcome = { kind: "sent"; answer: PushAnswer; said: string } | { kind: "skipped"; said: string } | { kind: "kept"; said: string };

/** A skip in words (never an error: an order already on its way is the system working). */
export function skippedWord(id: string, j: PushAnswer): string {
  const s = String(j.skipped || "");
  if (s === "already_pushed") return j.carrier && !/empower|omniful/i.test(String(j.carrier)) ? id + " already has a " + j.carrier + " parcel" + (j.awb ? " (" + j.awb + ")" : "") + ". Not pushed." : id + " is already on Empower";
  if (s === "not_shippable") return id + " is cancelled, unpaid or already shipped. Not pushed.";
  if (s === "not_configured") return "Omniful not connected. Add its API token on the server.";
  if (s === "busy") return id + " is being pushed right now. Check again in a minute.";
  if (s === "no_time") return id + " was not sent (out of time). Push it again.";
  if (/^routed_to_/.test(s)) return id + " goes " + (s === "routed_to_manual" ? "by hand" : s.replace("routed_to_", "to ")) + ". Not pushed.";
  return id + " not pushed: " + s;
}

const sentAs = (id: string, j: PushAnswer) => (j.sentId && j.sentId !== id ? " (as " + j.sentId + ")" : "");

/** One push, asking about a duplicate. Refusals other than the duplicate are thrown. */
export async function pushOne(id: string): Promise<PushOutcome> {
  let j: PushAnswer;
  try {
    j = await pushEmpower({ id, any: true });
  } catch (e) {
    if (!isApiError(e, "omniful_duplicate")) throw e;
    const pick = await choose<"adopt" | "fresh" | "keep">({
      title: "Omniful already has " + id,
      text:
        "Almost always this is our earlier push that got no answer: record it as on Empower, nothing is sent.\n\n" +
        "Send it again as a NEW Omniful order only if the old one was cancelled in Omniful. Still live there? Then it would ship twice.",
      options: [
        { value: "keep", label: "Do nothing", kind: "ghost" },
        { value: "fresh", label: "Send as a new order", kind: "danger" },
        { value: "adopt", label: "Record it (send nothing)", kind: "primary" },
      ],
    });
    if (!pick || pick === "keep") return { kind: "kept", said: "Not sent. Omniful already has " + id };
    if (pick === "fresh" && !(await ask({ title: "Send " + id + " again?", text: "Only if the old one was cancelled in Omniful.", ok: "Send again", danger: true }))) {
      return { kind: "kept", said: "Not sent. Omniful already has " + id };
    }
    j = await pushEmpower(pick === "adopt" ? { id, any: true, adopt: true } : { id, any: true, fresh: true });
  }
  if (j.skipped) return { kind: "skipped", said: skippedWord(id, j) };
  return { kind: "sent", answer: j, said: id + (j.adopted ? " recorded as on Empower" : " sent to Empower" + sentAs(id, j)) + " · Preparing" };
}

/** Take an order off Empower; when Omniful refuses, offer to remove our mark only. → the toast's words, or null when nothing was done. */
export async function takeOff(id: string): Promise<{ ok: boolean; said: string } | null> {
  if (!(await ask({ title: "Take " + id + " off Empower?", text: "Omniful cancels it and the order goes back to New.", ok: "Take off Empower", danger: true }))) return null;
  try {
    const j = await takeOffEmpower({ id });
    if (j.skipped === "not_pushed") return { ok: false, said: id + " is not on Empower" };
    return { ok: true, said: id + " taken off Empower and cancelled on Omniful" + (j.status === "new" ? " · back to New" : "") };
  } catch (e) {
    if (isApiError(e, "already_delivered")) return { ok: false, said: id + " is delivered. Nothing to cancel." };
    const said = explain(e, "Omniful refused the cancel");
    const yes = await ask({
      title: "Omniful did not cancel it",
      text: said + "\n\nIf you have already cancelled " + id + " in Omniful's own dashboard, remove the Empower mark here anyway?",
      ok: "Remove the mark",
      danger: true,
    });
    if (!yes) return { ok: false, said };
    await takeOffEmpower({ id, markOnly: true });
    return { ok: true, said: "Empower mark removed from " + id };
  }
}
