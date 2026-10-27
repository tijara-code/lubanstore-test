/**
 * Everything a request or a job needs, passed in rather than imported: the database, the
 * configuration, the outside services (real or fake), the clock and the logger. Tests build
 * one with fakes (tests/helpers/world.ts); production builds one per cold start.
 */
import type { Db } from "../db/client";
import type { Env } from "../env";
import type { FetchLike } from "./outbound";
import type { Logger } from "./log";

/**
 * The outside services. Each service module adds its own key by module augmentation:
 *   declare module "../../core/deps" { interface Services { thawani: ThawaniClient } }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Services {}

export interface Deps {
  db: Db;
  env: Env;
  services: Services;
  /** outbound fetch (tests swap it) */
  fetch: FetchLike;
  /** ms since epoch; tests move it */
  now(): number;
  log: Logger;
}

/** Hono context variables. */
export interface AppVariables {
  deps: Deps;
  /** the signed-in admin's user name (admin routes only) */
  admin?: string;
  rawBody?: string;
}

export type AppEnv = { Variables: AppVariables };
