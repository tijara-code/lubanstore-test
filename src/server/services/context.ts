import type { Env } from "../env";
import type { FetchLike } from "../core/outbound";

/** What a service client is built from. */
export interface ServiceContext {
  env: Env;
  fetch: FetchLike;
  now(): number;
}
