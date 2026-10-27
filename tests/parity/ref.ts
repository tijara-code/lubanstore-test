/**
 * Parity checks against the ORIGINAL store (luban-musk), when it sits beside this repo.
 * They load the old code read-only and compare answers on the same inputs. Skipped when
 * the original is not present (set LUBAN_REF to point at it).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const candidates = [process.env.LUBAN_REF, path.resolve(process.cwd(), "../luban-musk"), "/home/claude/ref/luban-musk"].filter(Boolean) as string[];
export const REF_DIR = candidates.find((p) => existsSync(path.join(p, "netlify/lib/price.js"))) || null;
const req = createRequire(import.meta.url);
export function refLib<T = any>(name: string): T {
  if (!REF_DIR) throw new Error("original store not found");
  return req(path.join(REF_DIR, "netlify/lib", name)) as T;
}
