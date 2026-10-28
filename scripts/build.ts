/**
 * THE BUILD — `npm run build` → dist/ (what Netlify publishes, and what the Node server and
 * the end-to-end tests serve).
 *
 *   1. make-en: site/en/*.html from the Arabic pages (stops on a word with no English)
 *   2. vite build: the pages, the hashed scripts and stylesheets, site/public copied as is
 *   3. the published pages lose their HTML comments (notes for the source's readers; their
 *      newlines stay, as scripts/minify.js did) and the two stylesheets are minified
 *   4. dist/_headers from src/server/site-headers.ts (the one source of the CSP & caching)
 *   5. every local file a page names must exist in dist/ (build-site.js's check), no
 *      placeholder or /src/ reference may survive, and no page may name a font host
 *
 * Content-hashed names (assets/<name>-<hash>.js|css) replace the original's ?v=N on code;
 * images, clips and the fonts' CSS keep ?v=<hash of the files> (scripts/site-meta.ts).
 */
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { transform } from "esbuild";
import { build as viteBuild, type InlineConfig } from "vite";
import { makeEn } from "./make-en";
import { REPO } from "./site-meta";
import { netlifyHeadersFile } from "../src/server/site-headers";

export const DIST_DEFAULT = path.join(REPO, "dist");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** HTML comments out, outside <script>/<style>/<pre>/<textarea>/<template>; their newlines stay. */
export function stripHtmlComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  const RAW = /^<(script|style|pre|textarea|template)\b[^>]*>/i;
  while (i < n) {
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      if (e < 0) {
        out += src.slice(i);
        break;
      }
      out += src.slice(i, e + 3).replace(/[^\n]/g, "");
      i = e + 3;
      continue;
    }
    const m = src[i] === "<" ? RAW.exec(src.slice(i, i + 200)) : null;
    if (m) {
      const close = src.toLowerCase().indexOf("</" + m[1]!.toLowerCase(), i + m[0].length);
      if (close < 0) {
        out += src.slice(i);
        break;
      }
      out += src.slice(i, close);
      i = close;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

/** Every local file a page names, and whether it is in dist/. */
export function missingRefs(dist: string = DIST_DEFAULT): string[] {
  const missing: string[] = [];
  const pages = walk(dist).filter((p) => p.endsWith(".html"));
  for (const p of pages) {
    const html = readFileSync(p, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const refs: string[] = [];
    const re = /\b(?:src|href|data-src|data-poster|poster)="([^"#]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) refs.push(m[1]!);
    const rs = /\bsrcset="([^"]+)"/g;
    while ((m = rs.exec(html))) m[1]!.split(",").forEach((part) => refs.push(part.trim().split(/\s+/)[0]!));
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/|\/api\/|\/invoice\/|\/resume\/|\?)/i.test(ref)) continue; /* external, functions, query-only */
      const clean = ref.split("?")[0]!;
      if (!clean || clean.endsWith("/")) continue; /* a directory: served by its index */
      const target = clean.startsWith("/") ? path.join(dist, clean) : path.join(path.dirname(p), clean);
      if (!existsSync(target) || !statSync(target).isFile()) missing.push(path.relative(dist, p) + " → " + ref);
    }
  }
  return missing;
}

/** What may not survive into a published page. */
export function leftovers(dist: string = DIST_DEFAULT): string[] {
  const bad: string[] = [];
  for (const p of walk(dist).filter((f) => f.endsWith(".html"))) {
    const h = readFileSync(p, "utf8");
    const rel = path.relative(dist, p);
    if (/__(ASSET_V|BUILD_ID|META_PIXEL_ID|SNAP_PIXEL_ID)__/.test(h)) bad.push(rel + ": an unfilled placeholder");
    if (/(?:src|href)="\/src\//.test(h)) bad.push(rel + ": a source path (/src/…)");
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(h)) bad.push(rel + ": a Google Fonts reference (fonts are self-hosted)");
  }
  return bad;
}

export async function buildSite(opts: { log?: (s: string) => void; outDir?: string; vite?: InlineConfig } = {}): Promise<void> {
  const DIST = opts.outDir ? path.resolve(opts.outDir) : DIST_DEFAULT;
  const log = opts.log || ((s: string) => console.log(s));
  process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = "true";

  makeEn({ log });

  await viteBuild({
    configFile: path.join(REPO, "vite.config.ts"),
    ...(opts.vite || {}),
    build: { ...((opts.vite && opts.vite.build) || {}), ...(opts.outDir ? { outDir: DIST } : {}) },
  });

  /* the published copy: comments out of the pages, the stylesheets minified */
  let before = 0;
  let after = 0;
  for (const f of walk(DIST)) {
    if (f.endsWith(".html")) {
      const src = readFileSync(f, "utf8");
      writeFileSync(f, stripHtmlComments(src));
    } else if (/[\\/]assets[\\/](?:style|desktop)-[\w-]+\.css$/.test(f)) {
      const src = readFileSync(f, "utf8");
      const r = await transform(src, { loader: "css", minify: true, legalComments: "none" });
      before += src.length;
      after += r.code.length;
      writeFileSync(f, r.code);
    }
  }

  writeFileSync(path.join(DIST, "_headers"), netlifyHeadersFile());

  /* /data/settings.json: the ORIGINAL pages' last resort when /api/settings does not answer in
     four seconds (store.js loadCatalogue). Visitors who still have an old page open after the
     switch keep that path; it is the bundled catalogue, as it was there. */
  mkdirSync(path.join(DIST, "data"), { recursive: true });
  writeFileSync(path.join(DIST, "data", "settings.json"), readFileSync(path.join(REPO, "data", "catalogue.json")));

  const missing = missingRefs(DIST);
  const bad = leftovers(DIST);
  if (missing.length || bad.length) {
    throw new Error("build: the pages are not publishable:\n  " + missing.map((m) => "missing " + m).concat(bad).join("\n  "));
  }
  const files = walk(DIST).length;
  const pages = walk(DIST).filter((f) => f.endsWith(".html")).length;
  log(`build: dist/ ready — ${files} files, ${pages} pages, every reference present; css ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  buildSite().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
