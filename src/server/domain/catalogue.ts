/**
 * Reading and publishing the catalogue — one loader for every reader.
 *
 *   loadCatalogue(deps)                  the public API and the till: a minute's warm cache; on a
 *                                        failed read the last live copy, else the bundled file
 *   loadCatalogue(deps, { live: true })  the till: never the bundled file when the database is
 *                                        there but did not answer (catalogue_unreachable → 503)
 *   loadCatalogue(deps, { fresh: true }) the admin and the jobs: read now; never the bundled file
 *
 * Publishing is conditional on the row's `version` (two tabs, or a publish and a job, can
 * never silently undo each other).
 */
import { eq } from "drizzle-orm";
import bundledJson from "../../../data/catalogue.json";
import { merge, seeded, stripCodeOwned } from "../../shared/catalogue/merge";
import type { Catalogue } from "../../shared/catalogue/types";
import type { DbOrTx } from "../db/client";
import { settings } from "../db/schema";
import type { Deps } from "../core/deps";

export const TTL_MS = 60_000;

const BUNDLED = bundledJson as unknown as Catalogue;

/** The deploy's catalogue (defaults + code-owned fields). A deep copy: callers may mutate. */
export function bundledCatalogue(): Catalogue {
  return JSON.parse(JSON.stringify(BUNDLED)) as Catalogue;
}

export class CatalogueError extends Error {
  constructor(readonly code: "no_catalogue" | "catalogue_unreachable" | "busy") {
    super(code);
    this.name = "CatalogueError";
  }
}

interface CacheEntry {
  value: Catalogue;
  at: number;
  lastLive: Catalogue | null;
}
const caches = new WeakMap<object, CacheEntry>();

export interface StoredCatalogue {
  data: Catalogue;
  version: number;
  updatedAt: Date;
}

export async function readCatalogueRow(db: DbOrTx): Promise<StoredCatalogue | null> {
  const rows = await db
    .select({ data: settings.data, version: settings.version, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return rows[0] || null;
}

export async function loadCatalogue(deps: Pick<Deps, "db" | "now">, opts: { fresh?: boolean; live?: boolean } = {}): Promise<Catalogue> {
  const key = deps.db as unknown as object;
  const entry = caches.get(key);
  const now = deps.now();
  if (!opts.fresh && entry && now - entry.at < TTL_MS) return entry.value;
  try {
    const row = await readCatalogueRow(deps.db);
    if (row && seeded(row.data)) {
      const value = merge(row.data, BUNDLED)!;
      caches.set(key, { value, at: now, lastLive: value });
      return value;
    }
  } catch {
    // A blip is not a new price list: the last live copy is the better answer.
    if (entry?.lastLive) return entry.lastLive;
    if (opts.fresh) throw new CatalogueError("no_catalogue");
    if (opts.live) throw new CatalogueError("catalogue_unreachable");
  }
  // Nothing published yet: the deploy's catalogue.
  if (seeded(BUNDLED)) return bundledCatalogue();
  throw new CatalogueError("no_catalogue");
}

/** Forget this instance's warm copy (after a publish). */
export function forgetCatalogue(db: object): void {
  caches.delete(db);
}

/**
 * Change the published row where it stands. `change(stored, attempt)` returns the data to
 * store (code-owned fields are stripped) or null to store nothing. Retries when another
 * writer moved the row in between; gives up with `busy`.
 */
export async function publishCatalogue(
  deps: Pick<Deps, "db" | "now">,
  change: (stored: Catalogue | null, attempt: number) => Catalogue | null,
  actor: string,
  tries = 3,
): Promise<StoredCatalogue | null> {
  for (let n = 0; n < tries; n++) {
    const row = await readCatalogueRow(deps.db);
    const next = change(row ? row.data : null, n);
    if (!next) return null;
    const data = stripCodeOwned(next);
    const at = new Date(deps.now());
    if (!row) {
      const inserted = await deps.db
        .insert(settings)
        .values({ id: 1, data, version: 1, updatedAt: at, updatedBy: actor })
        .onConflictDoNothing()
        .returning({ version: settings.version, updatedAt: settings.updatedAt });
      if (inserted[0]) {
        forgetCatalogue(deps.db as unknown as object);
        return { data, version: inserted[0].version, updatedAt: inserted[0].updatedAt };
      }
      continue;
    }
    const hit = await deps.db
      .update(settings)
      .set({ data, version: row.version + 1, updatedAt: at, updatedBy: actor })
      .where(eq(settings.version, row.version))
      .returning({ version: settings.version, updatedAt: settings.updatedAt });
    if (hit[0]) {
      forgetCatalogue(deps.db as unknown as object);
      return { data, version: hit[0].version, updatedAt: hit[0].updatedAt };
    }
  }
  throw new CatalogueError("busy");
}
