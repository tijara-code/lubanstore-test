/**
 * WHAT WENT WRONG (port of stats.js's error reporting). A script error on a shopper's phone is
 * invisible from here unless it is sent somewhere, and "the add button did nothing" is what
 * it looks like from their side. Uncaught errors and unhandled promise rejections go out
 * through the same beacon as everything else — no extra request — capped at five per page and
 * never the same message twice, so a loop cannot flood the log. The message and the first
 * lines of the stack, cut short; the page path; nothing about the person (/api/log, read on
 * the panel's Insights).
 */

/* NOISE THAT IS NOT OURS, and cannot be made ours.
   "Script error." is what a browser says instead of a message when the script that threw came
   from another origin — the ad pixels, here. Our own files are same-origin and always report
   in full, so a bare one is by construction a third-party throw nobody here can act on.
   The postMessage / Java-object one is the Instagram browser's injected bridge on Android;
   window.webkit.messageHandlers is the same bridge on iPhone (it throws on show and on hide,
   so it lands on every visit from an Instagram ad). */
export const NOT_OURS: readonly RegExp[] = [
  /^script error\.?$/i,
  /java object is gone/i,
  /messageHandlers/,          /* Instagram's iOS bridge — nothing of ours touches it */
  /^ResizeObserver loop/i,    /* a browser's own scheduling warning */
];

/* AND ANYTHING INJECTED, whatever it says. A script an app pushes into the page runs as if it
   were the page's own: Safari names the page address itself as its source, always at line 1,
   and Chrome calls it <anonymous>. Nothing of ours can be either (our code is in .js files,
   the inline scripts sit below line 1, nothing uses eval). So a stack whose every frame is
   line 1 of the page or <anonymous>, and none a .js file, came from outside. */
export function injected(detail: unknown): boolean {
  const at = String(detail || "").split("\n").filter((l) => /https?:\/\/|<anonymous>/.test(l));
  if (!at.length) return false;
  for (const l of at) {
    if (/\.js(\?[^\s:)]*)?:\d+:\d+\)?\s*$/.test(l)) return false;       /* a script file: judged on its merits */
    if (!/(:1|<anonymous>(:\d+)?):\d+\)?\s*$/.test(l)) return false;     /* a real line of a page: ours */
  }
  return true;
}

export function theirs(msg: string, detail: unknown): boolean {
  if (/^script error\.?$/i.test(msg) && detail) return false;   /* ours after all */
  for (const re of NOT_OURS) if (re.test(msg)) return true;
  return injected(detail);
}

/* (v336) a message can quote what the page was handling: an e-mail address or a phone number.
   v401: the domain half takes no ":" or "/" — Safari writes a stack frame as
   "placeCountry@https://lubanmusk.com/…/main.js:2367:12", which must keep function and file. */
export function mask(v: unknown): string {
  return String(v || "")
    .replace(/[^\s@"'<>():/]+@[^\s@"'<>():/]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+?\d(?:[ -]?\d){6,}/g, "[n]");   /* 7+ digits, spaced or not */
}

export interface Reporter {
  report(kind: string, msg: unknown, detail: unknown): void;
}

/** the page's reporter: `send` queues the body (kind "log"); `sid` names the tab */
export function reporter(send: (body: Record<string, unknown>) => void, sid: () => string | null): Reporter {
  const logged: Record<string, 1> = {};
  let logN = 0;
  return {
    report(kind, rawMsg, rawDetail) {
      try {
        const msg = mask(rawMsg).slice(0, 300);
        const detail = mask(rawDetail);
        if (!msg || logged[msg] || logN >= 5) return;
        if (theirs(msg, detail)) return;
        logged[msg] = 1; logN++;
        send({
          kind, message: msg,
          detail: String(detail || "").slice(0, 600),
          place: location.pathname + (location.hash || ""),
          sid: sid() || undefined,
        });
      } catch { /* nothing */ }
    },
  };
}

/** listen for uncaught errors and unhandled rejections */
export function listen(r: Reporter): void {
  try {
    window.addEventListener("error", (e: ErrorEvent) => {
      const err = e && (e.error as { message?: string; stack?: string } | null);
      r.report("error", (e && e.message) || (err && err.message) || "Script error",
        (err && err.stack) || ((e && e.filename) ? e.filename + ":" + e.lineno + ":" + e.colno : ""));
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      const rs = e && (e.reason as { message?: string; stack?: string } | null);
      r.report("rejection", (rs && (rs.message || String(rs))) || "Unhandled rejection", (rs && rs.stack) || "");
    });
  } catch { /* nothing */ }
}
