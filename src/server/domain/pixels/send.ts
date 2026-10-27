/**
 * Sending events: build each spec for its platform, send through the client (capped, never
 * throws), and note the result for Tracking health. Never throws into the caller.
 */
import type { Deps } from "../../core/deps";
import type { PixelSendResult } from "../../services/pixels";
import { metaEvent, snapEvent, type EventSpec } from "./build";
import { noteSend } from "./health";

async function safe<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try { return await f(); } catch { return fallback; }
}

export async function sendMeta(deps: Deps, specs: EventSpec[]): Promise<PixelSendResult> {
  return safe(async () => {
    const client = deps.services.pixels.meta;
    if (!client.configured()) return { ok: false, skipped: "not_configured" };
    const data = await Promise.all(specs.map(metaEvent));
    const r = await client.send(data);
    if (!r.skipped) await noteSend(deps, "meta", r.ok, r.error, { data });
    return r;
  }, { ok: false, error: "build_failed" });
}

export async function sendSnap(deps: Deps, specs: EventSpec[]): Promise<PixelSendResult> {
  return safe(async () => {
    const client = deps.services.pixels.snap;
    if (!client.configured()) return { ok: false, skipped: "not_configured" };
    const data = await Promise.all(specs.map(snapEvent));
    const r = await client.send(data);
    if (!r.skipped) await noteSend(deps, "snap", r.ok, r.error, { data });
    return r;
  }, { ok: false, error: "build_failed" });
}

export async function sendGa4(deps: Deps, payload: Record<string, unknown>): Promise<PixelSendResult> {
  return safe(async () => {
    const r = await deps.services.pixels.ga4.collect(payload);
    if (!r.skipped) await noteSend(deps, "ga4", r.ok, r.error, payload);
    return r;
  }, { ok: false, error: "send_failed" });
}
