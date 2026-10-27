/**
 * The storefront and the admin, built by Vite into dist/.
 *
 * root: site/ (the pages), publicDir: site/public (copied as is: images, clips, fonts,
 * robots, sitemap, icons). Page scripts are ES modules under src/web (src/admin for the
 * panel), named from the pages as /src/…; the alias below points that at the repo's src/.
 *
 * Content-hashed file names (dist/assets/<name>-<hash>.js|css) replace the original's
 * ?v=N on code: a new build is a new URL, so the immutable cache can never pair a page
 * with an older script. Images and clips keep ?v=<hash of the files> (filled in here),
 * because their names are stable and the page scripts build some of their URLs.
 *
 * Stylesheets: each page names style.css (media="all") and desktop.css (media="(min-width:
 * 768px)") as links. A link WITH a media attribute is emitted by Vite as a hashed asset and
 * left where it is in the head — which keeps the cascade exactly the original's (style.css,
 * then the page's inline <style>, then desktop.css). Without media Vite would move the CSS
 * to the end of the head. No page script may import CSS for the same reason.
 */
import path from "node:path";
import { createLogger, defineConfig, type Plugin, type UserConfig } from "vite";
import preact from "@preact/preset-vite";
import { REPO, SITE, fill, placeholders } from "./scripts/site-meta";

const PAGES: Record<string, string> = {
  index: "index.html",
  checkout: "checkout.html",
  privacy: "privacy.html",
  notfound: "404.html",
  en_index: "en/index.html",
  en_checkout: "en/checkout.html",
  en_privacy: "en/privacy.html",
  admin: "admin/index.html",
};

function lmPages(values: Record<string, string>): Plugin {
  return {
    name: "lm-pages",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const out = fill(html, values);
        const left = /__(ASSET_V|BUILD_ID|META_PIXEL_ID|SNAP_PIXEL_ID)__/.exec(out);
        if (left) throw new Error("unfilled placeholder " + left[0]);
        return out;
      },
    },
  };
}

/* The original pages carry the Meta pixel's <noscript><img> in the head — valid in practice,
   and kept as it is; parse5 reports it on every build, so that one notice is dropped. */
const logger = createLogger();
const warn = logger.warn.bind(logger);
logger.warn = (msg, opts) => {
  if (/disallowed-content-in-noscript-in-head/.test(msg)) return;
  warn(msg, opts);
};

export default defineConfig((): UserConfig => {
  const values = placeholders();
  return {
    root: SITE,
    publicDir: "public",
    base: "/",
    appType: "mpa",
    plugins: [preact(), lmPages(values)],
    resolve: {
      alias: [{ find: /^\/src\//, replacement: path.join(REPO, "src") + "/" }],
    },
    define: {
      /* LM.v — the images' version, appended by the page scripts to every image URL */
      __LM_ASSET_V__: JSON.stringify(values.__ASSET_V__),
    },
    build: {
      outDir: path.join(REPO, "dist"),
      emptyOutDir: true,
      assetsDir: "assets",
      /* never turn a file into a data: URI behind the page's back */
      assetsInlineLimit: 0,
      /* the original's page scripts ran on old in-app browsers (ES5); modules need Safari 11+,
         and this lowers newer syntax for the in-app webviews still on Safari 13/14 */
      target: ["es2019", "safari13", "chrome80", "firefox78"],
      sourcemap: false,
      /* every browser that runs these modules preloads natively or simply loads in order */
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, path.join(SITE, f)])),
        /* modules run in source (import) order even across shared chunks — the guarantee the
           original got from its script order (e.g. the English words before any page module) */
        output: { strictExecutionOrder: true },
      },
    },
    server: { fs: { allow: [REPO] } },
    customLogger: logger,
    logLevel: "warn",
  };
});
