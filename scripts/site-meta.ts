/**
 * What the build writes into the storefront pages and code: the asset version, the build
 * id and the public pixel ids. Read by vite.config.ts (the HTML placeholders and the
 * `__LM_ASSET_V__` define) and by scripts/build.ts.
 *
 *   __ASSET_V__      on every image, clip and the fonts' CSS (`?v=`), and LM.v in the code.
 *                    A content hash of site/public/assets/{img,media,fonts}: /assets/* is
 *                    served immutable for a year, so a photo overwritten under the same
 *                    name must change URL (the original README, "Replacing a photo").
 *   __BUILD_ID__     <meta name="build">: which build is live (View Source → "build").
 *   __META_PIXEL_ID__ / __SNAP_PIXEL_ID__
 *                    the browser pixels' ids. Public by design (they sit in the page source
 *                    and the <noscript> beacon URL). Taken from META_PIXEL_ID / SNAP_PIXEL_ID
 *                    at build time so the page and the server relay report to the SAME
 *                    dataset; the original store's ids are the defaults.
 */
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITE = path.join(REPO, "site");
export const PUBLIC = path.join(SITE, "public");

export const DEFAULT_META_PIXEL_ID = "1045103308296251";
export const DEFAULT_SNAP_PIXEL_ID = "854522c6-46ba-4244-a92a-e0ff0b07e7e7";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!e.name.startsWith(".")) out.push(p);
  }
  return out;
}

/** Ten hex characters over every image, clip and font file (paths and bytes). */
export function assetVersion(publicDir: string = PUBLIC): string {
  const h = createHash("sha256");
  const files = ["img", "media", "fonts"].flatMap((d) => walk(path.join(publicDir, "assets", d))).sort();
  for (const f of files) {
    h.update(path.relative(publicDir, f).split(path.sep).join("/") + "\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 10);
}

/** The deploy's commit (Netlify sets COMMIT_REF), else the checkout's, else "local". */
export function buildId(env: Record<string, string | undefined> = process.env): string {
  const pick = String(env.LM_BUILD_ID || env.COMMIT_REF || "").trim();
  if (/^[\w.-]{1,64}$/.test(pick)) return pick.slice(0, 12);
  try {
    const sha = execSync("git rev-parse --short=12 HEAD", { cwd: REPO, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (/^[0-9a-f]{4,40}$/.test(sha)) return sha;
  } catch {
    /* no git here */
  }
  return "local";
}

/** The pixel ids, validated: they are written into an inline script. */
export function pixelIds(env: Record<string, string | undefined> = process.env): { meta: string; snap: string } {
  const meta = String(env.META_PIXEL_ID || "").trim() || DEFAULT_META_PIXEL_ID;
  const snap = String(env.SNAP_PIXEL_ID || "").trim() || DEFAULT_SNAP_PIXEL_ID;
  if (!/^\d{5,20}$/.test(meta)) throw new Error("META_PIXEL_ID must be digits, got " + JSON.stringify(meta));
  if (!/^[0-9a-f-]{8,64}$/i.test(snap)) throw new Error("SNAP_PIXEL_ID must be a uuid, got " + JSON.stringify(snap));
  return { meta, snap };
}

/** Every placeholder the source pages carry, and what it becomes. */
export function placeholders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const px = pixelIds(env);
  return {
    __ASSET_V__: assetVersion(),
    __BUILD_ID__: buildId(env),
    __META_PIXEL_ID__: px.meta,
    __SNAP_PIXEL_ID__: px.snap,
  };
}

export function fill(html: string, values: Record<string, string>): string {
  let out = html;
  for (const k of Object.keys(values)) out = out.split(k).join(values[k]!);
  return out;
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
