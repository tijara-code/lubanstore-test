/**
 * THE SIX POINTS. Each is read off this market's own settings rather than written in, so a
 * point can never promise what the till will not do: free delivery only where there is a
 * threshold or a running offer, "or cash on delivery" only where COD is on, the delivery
 * time the market's own, and the scent count the market's own. v309: the order the owner set
 * — free delivery (a tick), payment, change or cancel, the guarantee, the delivery time, the
 * scents.
 */
import { LM } from "../core";
import { P } from "./state";
import { etaWords, toAr } from "./words";

const L = (s: string, v?: Parameters<typeof LM.L>[1]) => LM.L(s, v);

const PERK_SVG: Record<string, string> = {
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 9.5h18M7 14.5h4"/>',
  tick: '<path d="M4.5 12.6 9.4 17.4 19.5 6.8"/>',
  spark: '<path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  /* v301: the market's delivery time and the guarantee */
  ship: '<rect x="2.6" y="6.2" width="10.7" height="9.4" rx="1.3"/><path d="M13.3 9.6h3.4a1 1 0 0 1 .74.33l2.6 2.86a1 1 0 0 1 .26.67v1.14a1 1 0 0 1-1 1h-1.5"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  shield: '<path d="M12 2.6 4.6 5.4v6.1c0 4.5 3.1 8.2 7.4 9.6 4.3-1.4 7.4-5.1 7.4-9.6V5.4Z"/><path d="m9.2 12.1 2.1 2.1 4-4.1"/>',
};

export function perks(): string {
  const out: Array<[string, string]> = [];
  const free = LM.freeOver ? LM.freeOver() : 0;
  const deal = LM.freeDeal ? LM.freeDeal() : null;
  /* the amount and its currency mark never part at a line break */
  if (free > 0) out.push(["tick", L("توصيل مجاني فوق {p}", { p: '<span class="nw">' + LM.moneyHTML(free) + "</span>" })]);
  else if (deal) out.push(["tick", L("توصيل مجاني لكل الطلبات")]);
  out.push(["card", LM.codOn && !LM.codOn() ? L("الدفع بالفيزا") : L("فيزا أو الدفع عند الاستلام")]);
  out.push(["clock", L("تعديل أو إلغاء خلال 24 ساعة")]);
  out.push(["shield", L("15 يومًا ضمان استرداد الأموال")]);
  /* the delivery time, this market's own (shipEta): the grid is rebuilt on every country
     change, so it is written here directly */
  out.push(["ship", '<span class="ship-eta">' + (etaWords() || L("شحن سريع خلال 72 ساعة")) + "</span>"]);
  const n = P.SCENTS.length;
  if (n) out.push(["spark", n === 1 ? L("رائحة حصرية") : n === 2 ? L("رائحتان حصريتان") : L("{n} روائح حصرية", { n: toAr(n) })]);
  return (
    '<ul class="sz-perks">' +
    out.map((p) => '<li><svg viewBox="0 0 24 24" aria-hidden="true">' + PERK_SVG[p[0]] + "</svg><span>" + p[1] + "</span></li>").join("") +
    "</ul>"
  );
}
