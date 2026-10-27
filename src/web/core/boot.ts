/**
 * The boot: the catalogue, the server's clock, and the shopper's market.
 *
 * Live catalogue first (/api/settings, edited in the admin, shared by everyone); if it has
 * not answered in four seconds or answers nothing usable, the catalogue bundled with this
 * build (data/catalogue.json — the same file the server falls back to). `LM.ready`
 * resolves once, with LM, when the catalogue and the market are known.
 */
import { LM } from "./self";
import { setSkew } from "./offers";
import { byCode } from "./util";
import { K_CTY } from "./catalogue";
import bundled from "../../../data/catalogue.json";
import type { Catalogue, LmApi } from "./types";

/** admin preview overrides (retired) */
const K_CFG = "lm_settings";
/** the geo answer, kept for the tab */
const K_GEO = "lm_geo";

/** (v336) FOUR SECONDS, THEN THE FILE */
export const SETTINGS_WAIT = 4000;

/**
 * Retired keys. lm_country was written even without a user pick, and lm_settings let one
 * browser shadow the shared catalogue. Both caused real bugs; clear them so an old browser
 * cannot resurrect either. Any page with ?reset=1 also forgets the chosen country.
 */
export function clearRetired(): void {
  try {
    localStorage.removeItem("lm_country");
    localStorage.removeItem(K_CFG);
  } catch {
    /* storage blocked */
  }
  try {
    if (/[?&]reset=1/.test(location.search)) {
      localStorage.removeItem(K_CFG);
      localStorage.removeItem(K_CTY);
      localStorage.removeItem("lm_country");
    }
  } catch {
    /* storage blocked */
  }
}

/* ----------------------------------------------------------
   Where is the shopper? Order of authority:
     1. ?country=SA in the URL      (testing / campaign links)
     2. a country they picked before (localStorage lm_cty_v2)
     3. the edge geo lookup          (/api/geo)
     4. the device's time zone
     5. first country in the catalogue
   The geo answer is deliberately NOT persisted as a choice — only an explicit pick is, so
   travelling doesn't lock someone in.
   ---------------------------------------------------------- */
function forcedCode(): string | null {
  const m = /[?&]country=([A-Za-z]{2})/.exec(location.search || "");
  return m ? m[1]!.toUpperCase() : null;
}

const TZ2CODE: Record<string, string> = {
  "Asia/Dubai": "AE",
  "Asia/Muscat": "OM",
  "Asia/Riyadh": "SA",
  "Asia/Qatar": "QA",
  "Asia/Bahrain": "BH",
  "Asia/Kuwait": "KW",
};
function tzCode(): string | null {
  try {
    return TZ2CODE[Intl.DateTimeFormat().resolvedOptions().timeZone] || null;
  } catch {
    return null;
  }
}

/**
 * THE GEO ANSWER, ASKED FOR EARLY AND KEPT FOR THE TAB (v204). The page's head starts
 * /api/geo while the HTML is still parsing and leaves the promise in window.__lmGeo (the
 * "early" script); it is taken once here. The answer is kept in sessionStorage for the
 * rest of the tab. Never longer than 1.5 s: a slow edge call must not hold up the page.
 */
function geoCode(): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolve(v || null);
      }
    };
    setTimeout(() => finish(null), 1500);
    try {
      const early = window.__lmGeo;
      window.__lmGeo = null;
      let seen: string | null = null;
      try {
        seen = sessionStorage.getItem(K_GEO);
      } catch {
        /* storage blocked */
      }
      const ask: Promise<unknown> =
        early ||
        (seen
          ? Promise.resolve(seen)
          : fetch("/api/geo", { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((j: { country?: unknown } | null) => j && j.country));
      ask
        .then((c0: unknown) => {
          const c = /^[A-Za-z]{2}$/.test(String(c0 || "")) ? String(c0).toUpperCase() : null;
          if (c) {
            try {
              sessionStorage.setItem(K_GEO, c);
            } catch {
              /* storage blocked */
            }
          }
          finish(c);
        })
        .catch(() => finish(null));
    } catch {
      finish(null);
    }
  });
}

/**
 * Every HTTP response carries a Date header, so the server's clock comes back with the
 * catalogue for free. We keep the difference, not the timestamp, so the countdown stays
 * right for the whole session and cannot be moved by changing the device clock. A CDN copy
 * carries the Date it was generated plus Age (how long ago): the two together are the
 * server's clock now.
 */
function readClock(r: Response): Response {
  try {
    let t = Date.parse(r.headers.get("Date") as string);
    const age = parseInt(r.headers.get("Age") as string, 10);
    if (!Number.isNaN(t)) {
      if (age > 0) t += age * 1000;
      setSkew(t - Date.now());
      LM.clock = "server";
    }
  } catch {
    /* no headers */
  }
  return r;
}

/** a fresh copy of the bundled catalogue (pages and tests may write into LM.cfg) */
export function bundledCatalogue(): Catalogue {
  return JSON.parse(JSON.stringify(bundled)) as Catalogue;
}

/**
 * No `cache: "no-store"` here, on purpose: the page's head preloads /api/settings, and a
 * no-store fetch would refuse to consume that preload and start over. The response says
 * max-age=0, must-revalidate, so the browser never serves it from cache unasked.
 *
 * (v336) FOUR SECONDS, THEN THE FILE. A settings call that never answered held every price
 * and the confirm button. Aborted where AbortController exists; a live answer arriving
 * later is ignored (LM.ready resolves once).
 */
function loadCatalogue(): Promise<Catalogue> {
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    if (typeof AbortController === "function") ctl = new AbortController();
  } catch {
    /* old browser: the race alone */
  }
  const live = fetch("/api/settings", ctl ? { signal: ctl.signal } : undefined)
    .then(readClock)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null) as Promise<Catalogue | null>;
  const late = new Promise<null>((res) => {
    timer = setTimeout(() => {
      try {
        if (ctl) ctl.abort();
      } catch {
        /* nothing to abort */
      }
      res(null);
    }, SETTINGS_WAIT);
  });
  return Promise.race([
    live.then((j) => {
      if (timer) clearTimeout(timer);
      return j;
    }),
    late,
  ]).then((j) => {
    if (j && Array.isArray(j.countries) && j.countries.length) {
      LM.source = "supabase";
      return j;
    }
    LM.source = "settings.json";
    return bundledCatalogue();
  });
}

/**
 * Start the boot. The geo lookup leaves at the same moment as the catalogue (they used to
 * run in series: two round trips before the first price), and only when it will be used —
 * a visitor with a saved or forced country never makes the call.
 */
export function boot(): Promise<LmApi> {
  let savedCode: string | null = null;
  try {
    savedCode = localStorage.getItem(K_CTY);
  } catch {
    /* storage blocked */
  }
  const geoEarly = forcedCode() || savedCode ? null : geoCode();

  return loadCatalogue().then((json) => {
    LM.cfg = json && json.countries ? json : bundledCatalogue();

    const forced = forcedCode();
    if (forced && byCode(forced)) {
      LM.c = byCode(forced)!;
      try {
        localStorage.setItem(K_CTY, forced);
      } catch {
        /* storage blocked */
      }
      return LM;
    }

    if (byCode(savedCode)) {
      LM.c = byCode(savedCode)!;
      return LM;
    }

    return (geoEarly || geoCode()).then((code) => {
      /* IP first, device time zone second, catalogue default last */
      LM.c = byCode(code) || byCode(tzCode()) || LM.cfg.countries[0]!;
      LM.geo = code || null;
      return LM;
    });
  });
}

export const diagnostics: Pick<LmApi, "debug"> = {
  /** type `LM.debug()` in the console to see exactly what the store is using */
  debug() {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(K_CTY);
    } catch {
      saved = "(blocked)";
    }
    return {
      active: LM.c ? LM.c.code + " " + LM.c.name + " " + LM.c.cur : null,
      saved,
      codes: LM.cfg.countries.map((c) => c.code).join(","),
      source: LM.source || "?",
    };
  },
};
