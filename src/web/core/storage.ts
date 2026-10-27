/**
 * WEB STORAGE SWITCHED OFF ("block all cookies", some in-app browsers): every access
 * throws, so the basket could never hold anything — the button said "تمت الإضافة ✓" and
 * checkout said the basket was empty. A stand-in for this tab: the basket alone rides in
 * window.name, which survives same-site navigation; everything else (the pending order,
 * receipts) stays in memory, so no personal data is written there.
 *
 * (v336) THE BASKET ONLY. The parked orders rode in window.name too (v314), and
 * window.name outlives the site: a parked order's name, phone and address went with the
 * tab to the next site it opened. They stay in storage, or in memory when storage is
 * blocked. A queue an older build left in window.name is moved into storage (or the
 * stand-in) and taken out of window.name.
 *
 * Runs once, first thing when the core loads (index.ts), before anything reads storage.
 */

type Kind = "sessionStorage" | "localStorage";

/** keys that persist through window.name, and which storage they live in */
const PERSIST: Record<string, 1> = { lm_cart: 1 };
const HOME: Record<string, Kind> = { lm_cart: "sessionStorage" };

let installed = false;

export function installStorageShim(): void {
  if (installed) return;
  installed = true;
  let named: Record<string, unknown> = {};
  try {
    const n0: unknown = JSON.parse(window.name || "{}");
    if (n0 && typeof n0 === "object") named = n0 as Record<string, unknown>;
  } catch {
    /* not ours */
  }
  const save = () => {
    try {
      const keep: Record<string, string> = {};
      Object.keys(PERSIST).forEach((x) => {
        if (named[x] != null) keep[x] = String(named[x]);
      });
      window.name = Object.keys(keep).length ? JSON.stringify(keep) : "";
    } catch {
      /* nothing to do */
    }
  };
  const oldQ = named.lm_order_queue;
  if (oldQ != null) {
    delete named.lm_order_queue;
    save();
  }
  (["sessionStorage", "localStorage"] as Kind[]).forEach((k) => {
    try {
      const s = window[k];
      s.setItem("__lm_t", "1");
      s.removeItem("__lm_t");
      if (k === "localStorage" && oldQ != null && !s.getItem("lm_order_queue")) s.setItem("lm_order_queue", String(oldQ));
      return;
    } catch {
      /* blocked: the stand-in below */
    }
    let own: Record<string, string> = {};
    if (k === "localStorage" && oldQ != null) own.lm_order_queue = String(oldQ);
    Object.keys(PERSIST).forEach((x) => {
      if (HOME[x] === k && named[x] != null) own[x] = String(named[x]);
    });
    const shim = {
      getItem(x: string): string | null {
        return Object.prototype.hasOwnProperty.call(own, x) ? own[x]! : null;
      },
      setItem(x: string, v: unknown): void {
        own[x] = String(v);
        if (PERSIST[x] && HOME[x] === k) {
          named[x] = own[x];
          save();
        }
      },
      removeItem(x: string): void {
        delete own[x];
        if (PERSIST[x] && HOME[x] === k) {
          delete named[x];
          save();
        }
      },
      clear(): void {
        own = {};
        Object.keys(PERSIST).forEach((x) => {
          if (HOME[x] === k) delete named[x];
        });
        save();
      },
      key(i: number): string | null {
        return Object.keys(own)[i] || null;
      },
      get length(): number {
        return Object.keys(own).length;
      },
    };
    try {
      Object.defineProperty(window, k, { value: shim, configurable: true, writable: true });
    } catch {
      /* cannot replace it either: every read below is guarded */
    }
  });
}
