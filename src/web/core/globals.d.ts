/* The storefront's window globals. The page scripts are ES modules now and share the
   core by import; window.LM (and the rest) stay for the inline head scripts, the
   console, and anything that still reads them by name. */
import type { LmApi, EnEntry } from "./types";

declare global {
  /** the images' version, written by the build (vite.config.ts `define`); absent in tests */
  const __LM_ASSET_V__: string | undefined;

  interface Window {
    LM: LmApi;
    /** the English words, set by src/web/entries/en.ts on the /en/ pages only */
    LM_EN?: Record<string, EnEntry>;
    /** the cities each market ships to, keyed by dial code (the checkout's) */
    LM_CITIES?: Record<string, string[]>;
    /** the early geo answer started by the head's "early" script */
    __lmGeo?: Promise<string | null> | null;
    __lmLeaving?: number;
    __lmPageView?: string;
    __lmFbPageView?: string;
    lmLater?: (f: () => void) => void;
    /** stats.js's beacon (another module) — optional */
    LMBeacon?: { queue?: (kind: string, body: unknown) => void; flush?: () => void; [k: string]: unknown };
    /** pixel.js's api (another module) — optional */
    LMPX?: { purchase?: (o: unknown, j: unknown) => void; [k: string]: unknown };
    [k: string]: unknown;
  }
}

export {};
