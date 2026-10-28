/**
 * `npm run dev` — the whole shop on http://localhost:8888, one command:
 *
 *   1. make-en (site/en/*.html), and again whenever an Arabic page changes
 *   2. vite build --watch into dist/ (a change under site/ or src/ rebuilds in well under a
 *      second; reload the page)
 *   3. src/server/node.ts on PORT (default 8888): dist/ plus the API, with the fake services
 *      (SERVICES_MODE=fake — no real Thawani, Omniful, Meta, Snap or GA4) and PGlite in .data/
 *
 * `npm run admin:local` (or double-click open-admin.cmd) is the same, plus: an invented shop is
 * seeded on the first run, and the admin panel opens in the browser already signed in — no
 * user or password to type (GET /__fake/admin/enter: fake mode, this machine only). It does NOT
 * read .env (the script has no --env-file), so a real DATABASE_URL or live keys kept there are
 * never touched: always the fakes and the local .data/ database.
 *
 * The site is served built, exactly as in production (hashed files, the English pages, the
 * headers), rather than through Vite's dev server: what you click through is what ships.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, watch } from "node:fs";
import path from "node:path";
import { build as viteBuild } from "vite";
import { makeEn, SITE_DIR } from "./make-en";
import { REPO } from "./site-meta";

type Watcher = { on(ev: "event", cb: (e: { code: string; error?: Error; result?: { close(): void } }) => void): void; close(): Promise<void> };

const ADMIN = process.argv.includes("--admin");

function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open: the address is printed above */
  }
}

async function main(): Promise<void> {
  process.env.VITE_CONFIG_NATIVE_IGNORE_WARNING = "true";
  const env: Record<string, string | undefined> = { ...process.env, SERVICES_MODE: process.env.SERVICES_MODE || "fake" };
  if (env.SERVICES_MODE !== "fake") console.warn("dev: SERVICES_MODE=" + env.SERVICES_MODE + " — real services!");
  /* a local admin sign-in when .env names none (fake mode only; invented, never a real credential) */
  let devLogin = "";
  if (env.SERVICES_MODE === "fake" && !env.ADMIN_USER && !env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    env.ADMIN_USER = "admin";
    env.ADMIN_PASSWORD = "luban-local-dev";
    env.SESSION_SECRET ||= "local-development-session-secret-not-for-production";
    devLogin = "  admin sign-in (local only): admin / luban-local-dev";
  }

  const en = () => {
    try {
      makeEn();
    } catch (e) {
      console.error("make-en: " + (e as Error).message);
    }
  };
  en();

  /* LM_DIST: build somewhere else than dist/ (two dev servers side by side) */
  const DIST = path.resolve(REPO, process.env.LM_DIST || "dist");

  /* the first build, then watch */
  let first: () => void = () => {};
  const ready = new Promise<void>((r) => (first = r));
  const watcher = (await viteBuild({
    configFile: path.join(REPO, "vite.config.ts"),
    build: { outDir: DIST, emptyOutDir: true, watch: { exclude: ["**/node_modules/**", "**/dist/**", "**/dist-*/**", "**/.data/**"] } },
  })) as unknown as Watcher;
  watcher.on("event", (e) => {
    if (e.code === "BUNDLE_END" && e.result) e.result.close();
    if (e.code === "END") {
      console.log("dev: built " + new Date().toLocaleTimeString());
      first();
    }
    if (e.code === "ERROR") {
      console.error("dev: build failed — " + (e.error && e.error.message));
      first();
    }
  });

  /* an Arabic page changed: its English twin follows (Vite then rebuilds both) */
  let t: ReturnType<typeof setTimeout> | null = null;
  watch(SITE_DIR, (_ev, name) => {
    if (!name || !/^[\w-]+\.html$/.test(String(name))) return;
    if (t) clearTimeout(t);
    t = setTimeout(en, 100);
  });

  await ready;
  /* PGlite makes its own folder but not its parent */
  const dataDir = path.resolve(REPO, env.DATA_DIR || ".data/pglite");
  if (!env.DATABASE_URL) mkdirSync(path.dirname(dataDir), { recursive: true });
  if (ADMIN && env.SERVICES_MODE === "fake" && !env.DATABASE_URL && env.DATA_DIR !== "memory" && !existsSync(dataDir)) {
    console.log("dev: first run — seeding an invented shop into " + path.relative(REPO, dataDir));
    spawnSync(process.execPath, ["--import", "tsx", path.join(REPO, "scripts/seed.ts")], { cwd: REPO, stdio: "inherit", env: { ...env, DATA_DIR: dataDir } });
  }
  const { startServer } = await import("../src/server/node");
  const { port, deps } = await startServer({ port: Number(process.env.PORT || 8888), distDir: DIST, env });
  console.log(`Luban & Musk on http://localhost:${port}  (services: ${deps.env.servicesMode}; English at /en/, admin at /admin/)`);
  if (devLogin) console.log(devLogin);
  if (ADMIN) {
    if (env.SERVICES_MODE !== "fake") console.warn("dev: the signed-in shortcut is for fake mode only — sign in at http://localhost:" + port + "/admin/");
    else {
      const url = "http://localhost:" + port + "/__fake/admin/enter";
      console.log("admin panel (already signed in): " + url);
      openBrowser(url);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
