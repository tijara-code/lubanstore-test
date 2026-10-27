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
    /** stats.js's beacon (src/web/tracking/beacon.ts) — absent on a page without it */
    LMBeacon?: import("../tracking/types").Beacon;
    /** stats.js's first-party events (src/web/tracking/stats.ts) */
    LMEV?: import("../tracking/types").Lmev;
    /** stats.js's landing of this tab */
    LMLanding?: () => import("../../shared/attribution").Landing;
    /** pixel.js's api (src/web/tracking/pixel.ts) — home and checkout only */
    LMPX?: import("../tracking/types").Lmpx;
    /** the ad platforms' stubs (the head snippets) and GA4's queue */
    snaptr?: import("../tracking/types").SnapFn;
    fbq?: import("../tracking/types").FbqFn;
    gtag?: import("../tracking/types").GtagFn;
    dataLayer?: unknown[];
    [k: string]: unknown;
  }
}

export {};
