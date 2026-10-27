/**
 * ORDER TRACKING (#trackForm, "تتبع طلبك"). The server answers with a stage and dates only, so
 * there is nothing sensitive to render here. Four dots: received, picked up, on its way,
 * delivered. A stopped shipment (refused, returned) reports step -1 and the rail is not drawn.
 */
import { LM } from "../core";
import { esc } from "../core/util";
import { $, G } from "./state";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

/** "lm 482913" / "LM482913" / "482913" → "LM-482913", the box's own tidying (v447: a link's too) */
export function trackTidy(raw: unknown): string {
  let v = String(raw || "").toUpperCase().replace(/[^A-Z0-9-]/g, "");
  /* "lm 482913" loses its space above and became "LM482913", which the lookup then refused */
  v = v.replace(/^LM-?(?=\d)/, "LM-");
  if (/^\d/.test(v)) v = "LM-" + v;
  return v;
}

interface TrackAnswer {
  ok?: boolean;
  id?: string;
  text?: string;
  step: number;
  dates?: Record<string, string>;
}

export function initTrack(): void {
  const form = $("#trackForm");
  if (!form) return;
  const out = $("#trackOut")!, input = $<HTMLInputElement>("#trackId")!;

  function say(html: string, bad?: boolean): void {
    out.hidden = false;
    out.className = "track-out" + (bad ? " bad" : "");
    out.innerHTML = html;
  }

  function fmtDay(v: string): string {
    const d = new Date(v);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(LM.lang === "en" ? "en-GB" : "ar", { day: "2-digit", month: "short", timeZone: "Asia/Muscat" });
  }

  function render(j: TrackAnswer): void {
    const stopped = j.step < 0;
    let rail = "";
    for (let i = 0; i < 4; i++) {
      const on = !stopped && i <= j.step;
      const done = on && j.step === 3;
      if (i) rail += '<b class="' + (on ? (done ? "done" : "on") : "") + '"></b>';
      rail += '<i class="' + (on ? (done ? "done" : "on") : "") + '"></i>';
    }
    let dates = "";
    (
      [
        ["created", "تم الاستلام"],
        ["picked", "لدى شركة الشحن"],
        ["attempt", "محاولة تسليم"],
        ["delivered", "تم التسليم"],
      ] as Array<[string, string]>
    ).forEach((p) => {
      const v = j.dates && j.dates[p[0]];
      if (v) dates += "<span>" + L(p[1]) + "<em>" + fmtDay(v) + "</em></span>";
    });
    /* both come from our own endpoint and are constrained there, but this reaches innerHTML */
    say(
      '<span class="t-id">' + esc(j.id) + "</span>" +
        /* the server's words are one of a fixed few, so they translate */
        '<span class="t-state">' + esc(L(String(j.text || ""))) + "</span>" +
        (stopped ? "" : '<div class="t-rail">' + rail + "</div>") +
        (dates ? '<div class="t-dates">' + dates + "</div>" : ""),
      stopped,
    );
  }

  function lookup(): void {
    const id = (input.value || "").trim().toUpperCase();
    if (!/^LM-\d{4,12}$/.test(id)) {
      say('<span class="t-state">' + L("تأكد من رقم الطلب — يبدأ بـ LM") + "</span>", true);
      return;
    }
    say('<span class="t-state">' + L("جارٍ البحث…") + "</span>");
    fetch("/api/track?id=" + encodeURIComponent(id), { cache: "no-store" })
      .then((r) =>
        r
          .json()
          .catch(() => ({}))
          .then((j: unknown) => ({ s: r.status, j: j as TrackAnswer })),
      )
      .then((res) => {
        if (res.s === 404) {
          say('<span class="t-state">' + L("لم نجد هذا الرقم. تأكد منه أو راسلنا.") + "</span>", true);
          return;
        }
        if (!res.j || !res.j.ok) {
          say('<span class="t-state">' + L("تعذر جلب الحالة. جرب بعد قليل.") + "</span>", true);
          return;
        }
        render(res.j);
      })
      .catch(() => {
        say('<span class="t-state">' + L("تعذر الاتصال. تحقق من الإنترنت.") + "</span>", true);
      });
  }

  /* let a link do the work too: /?track=LM-123456 — v447: tidied the way the box tidies */
  try {
    const pre = new URLSearchParams(location.search).get("track");
    if (pre) {
      input.value = trackTidy(pre);
      lookup();
    }
  } catch {
    /* an old engine without URLSearchParams */
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const g = G();
    if (g.LMEV) g.LMEV.track!("track_lookup");
    lookup();
  });

  /* people type "lm 482913" or paste with spaces */
  input.addEventListener("input", function (this: HTMLInputElement) {
    this.value = trackTidy(this.value);
  });
}
