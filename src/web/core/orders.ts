/**
 * ---------- orders the wire dropped ----------
 * A cash order the server could not be reached for is parked in localStorage by the
 * checkout and the shopper is told it was received — because it is a good order, and the
 * shop's own copy has to land. Retried from every page: on load, then once a minute while
 * the tab is open (and on `online`), until it lands or the server refuses it outright.
 *
 * Same rule as the first attempt: a 4xx with a named error is a decision — dropped (and
 * logged); a 429 or anything else is the wire, and the order waits for the next try.
 */
import { LM } from "./self";
import type { LmApi, ParkedOrder } from "./types";

export const Q_KEY = "lm_order_queue";

/**
 * (v336) A PARKED ORDER THE SERVER THEN REFUSED. The shopper was told it was received, so
 * the shop has to hear of it: one line in the error log (the beacon's "log" item) with the
 * order id and the reason, and nothing about the person.
 */
function refusedNote(o: ParkedOrder, err: unknown): void {
  const body = {
    kind: "error",
    message: "parked order refused: " + String(err || "?").slice(0, 40),
    detail: String((o && o.id) || "").slice(0, 20),
    place: location.pathname,
  };
  try {
    const B = window.LMBeacon;
    if (B && B.queue) {
      B.queue("log", body);
      if (B.flush) B.flush();
      return;
    }
    fetch("/api/beacon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ kind: "log", body }] }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* measurement never breaks the queue */
  }
}

function queued(): ParkedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(Q_KEY) as string) || [];
  } catch {
    return [];
  }
}

function setQueued(list: ParkedOrder[]): void {
  try {
    if (list.length) localStorage.setItem(Q_KEY, JSON.stringify(list.slice(-20)));
    else localStorage.removeItem(Q_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * The retry loop, started by whichever comes first: a queue found on load, or an order
 * parked on THIS page (the done screen, where a shopper who has just ordered stays).
 */
let qTimer: ReturnType<typeof setInterval> | null = null;
function retryLoop(): void {
  if (qTimer) return;
  qTimer = setInterval(() => {
    if (!queued().length) {
      clearInterval(qTimer!);
      qTimer = null;
      return;
    }
    if (!document.hidden) LM.flushOrders();
  }, 60000);
}

/**
 * THE PIXELS' PURCHASE FOR A PARKED ORDER. The checkout holds it back while the order is
 * parked (no server id yet); it goes now, under the id the order landed with and the total
 * the server charged — the same pair the server just sent both platforms.
 */
function purchased(o: ParkedOrder, j: Record<string, unknown> | null): void {
  try {
    const PX = window.LMPX;
    if (!PX || !PX.purchase) return;
    const id = j && j.id && /^LM-\d{4,12}$/.test(String(j.id)) ? j.id : o.id;
    const omr = j && j.omr != null && Number.isFinite(+(j.omr as number)) && +(j.omr as number) > 0 ? +(j.omr as number) : o.omr;
    PX.purchase(Object.assign({}, o, { id, omr }), j);
  } catch {
    /* measurement never breaks the queue */
  }
}

/**
 * ONE POST PER PARKED ORDER AT A TIME (v209). This page asks on load and the checkout asks
 * again as it starts — two passes posting the same order would fire its Purchase twice.
 * An order already on its way is left to the pass that sent it.
 */
const posting: Record<string, 1> = {};

export const orders: Pick<LmApi, "queueOrder" | "flushOrders"> = {
  queueOrder(o) {
    const q = queued();
    if (!q.some((x) => x.id === o.id)) q.push(o);
    setQueued(q);
    retryLoop();
  },
  flushOrders() {
    const q = queued().filter((o) => o && !posting[o.id]);
    if (!q.length || !window.fetch) return Promise.resolve(0);
    let landed = 0;
    q.forEach((o) => (posting[o.id] = 1));
    return Promise.all(
      q.map((o) =>
        fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: o }),
          keepalive: true,
        })
          .then((r) =>
            r
              .json()
              .catch(() => null)
              .then((j: Record<string, unknown> | null) => {
                /* v314: `already` is the server saying another tab's pass wrote it — that pass fired the Purchase */
                if (r.ok && j && j.ok) {
                  landed++;
                  if (!j.already) purchased(o, j);
                  return "done";
                }
                if (r.status === 429) return "keep"; /* v329: too many from here just now — later */
                if (r.status >= 400 && r.status < 500 && j && j.error) {
                  refusedNote(o, j.error);
                  return "refused";
                }
                return "keep";
              }),
          )
          .catch(() => "keep"),
      ),
    ).then((results) => {
      /* RE-READ, then remove only what this pass settled: an order queued while the pass
         was in flight must survive */
      const gone: Record<string, 1> = {};
      q.forEach((o, i) => {
        if (results[i] !== "keep") gone[o.id] = 1;
      });
      setQueued(queued().filter((o) => o && !gone[o.id]));
      /* free only once the queue says what landed */
      q.forEach((o) => delete posting[o.id]);
      return landed;
    });
  },
};

/** wire the retries: on `online`, and once the catalogue is in, a queue found on load */
export function startOrderQueue(): void {
  try {
    window.addEventListener("online", () => {
      if (queued().length) LM.flushOrders();
    });
  } catch {
    /* no window events */
  }
  LM.ready.then(() => {
    if (!queued().length) return;
    LM.flushOrders();
    retryLoop();
  });
}
