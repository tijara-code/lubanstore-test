/**
 * Empower's small records in `ops`: the SKU map, the spent ids, the unsure and unrecorded
 * pushes, the auto switch and what each run did, and the token pair.
 */
import type { Deps } from "../../core/deps";
import type { DbOrTx } from "../../db/client";
import { getOp, getOpData, putOp, updateOp } from "../../core/ops";
import type { AuthPair, OmnifulClient } from "../../services/omniful";
import { AUTH_KEY } from "../../services/omniful";
import type { SkuMap } from "./lines";

export const SKUS_KEY = "omniful_skus";
export const RETIRED_KEY = "omniful_retired";
export const UNSURE_KEY = "omniful_unsure";
export const UNRECORDED_KEY = "omniful_unrecorded";
export const AUTO_KEY = "omniful_auto";
export const AUTO_RUN_KEY = "omniful_auto_run";
export const SWEEP_KEY = "omniful_sweep";
export const POLL_KEY = "omniful_poll";

const at = (deps: Pick<Deps, "now">) => new Date(deps.now());
const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback);

/** The client, with the ops-backed token store bound (once per client). */
const bound = new WeakSet<OmnifulClient>();
export function omf(deps: Deps): OmnifulClient {
  const c = deps.services.omniful;
  if (!bound.has(c)) {
    bound.add(c);
    c.auth = {
      async get() {
        const d = await getOpData<AuthPair | null>(deps.db, AUTH_KEY, null);
        return d && typeof d === "object" && d.access_token ? d : null;
      },
      async set(pair) {
        await putOp(deps.db, AUTH_KEY, pair, at(deps));
      },
    };
  }
  return c;
}

/** strict: a failed read throws (never "no codes saved" when it could not ask). */
export async function readSkus(deps: Deps, opts: { strict?: boolean } = {}): Promise<SkuMap> {
  try {
    return obj<SkuMap>(await getOpData(deps.db, SKUS_KEY, {}), {});
  } catch (e) {
    if (opts.strict) throw e;
    return {};
  }
}

export async function readRetired(deps: Deps): Promise<Record<string, string[]>> {
  return obj(await getOpData(deps.db, RETIRED_KEY, {}), {});
}

export async function retire(deps: Deps, orderId: string, sentId: string): Promise<void> {
  await updateOp<Record<string, string[]>>(deps.db, RETIRED_KEY, {}, (all) => {
    const next = { ...obj<Record<string, string[]>>(all, {}) };
    const list = Array.isArray(next[orderId]) ? next[orderId]!.slice() : [];
    if (list.indexOf(sentId) < 0) list.push(sentId);
    next[orderId] = list;
    return next;
  }, at(deps));
}

export interface Note {
  sentId: string;
  at: string;
  ref?: string | null;
}

export async function readNotes(deps: Deps, key: string): Promise<Record<string, Note>> {
  try {
    return obj(await getOpData(deps.db, key, {}), {});
  } catch {
    return {};
  }
}

export async function setNote(deps: Deps, key: string, orderId: string, note: Note | null): Promise<void> {
  try {
    await updateOp<Record<string, Note>>(deps.db, key, {}, (all) => {
      const next = { ...obj<Record<string, Note>>(all, {}) };
      if (note) next[orderId] = note;
      else delete next[orderId];
      return next;
    }, at(deps));
  } catch {
    /* a note is a help; the push's own guards stand without it */
  }
}

export interface AutoSetting {
  on: boolean;
  at: string | null;
}

/** `db`: a transaction handle to read through (inside the till's locked step). */
export async function autoSetting(deps: Deps, db: DbOrTx = deps.db): Promise<AutoSetting> {
  const d = obj<{ on?: unknown; at?: unknown }>(await getOpData(db, AUTO_KEY, {}), {});
  return { on: d.on === true, at: typeof d.at === "string" ? d.at : null };
}

export async function setAuto(deps: Deps, on: boolean): Promise<void> {
  await putOp(deps.db, AUTO_KEY, { on, at: at(deps).toISOString() }, at(deps));
}

export async function readRun<T extends Record<string, unknown>>(deps: Deps, key: string): Promise<(T & { at: string }) | null> {
  const r = await getOp<T>(deps.db, key);
  return r ? ({ at: r.updatedAt.toISOString(), ...obj<T>(r.data, {} as T) } as T & { at: string }) : null;
}

export async function noteRun(deps: Deps, key: string, data: Record<string, unknown>): Promise<void> {
  try {
    await putOp(deps.db, key, data, at(deps));
  } catch {
    /* the bookkeeping must never fail the run */
  }
}
