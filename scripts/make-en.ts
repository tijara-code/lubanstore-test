/**
 * THE ENGLISH STORE — generated, never edited by hand (the port of scripts/make-en.js).
 *
 *   npm run make-en                writes site/en/index.html, checkout.html, privacy.html
 *   npm run make-en -- --check     writes nothing; exits 1 if any page has a word with no
 *                                  English, or if site/en/ is out of date
 *
 * The Arabic pages (site/*.html) are the source. Each English page is its Arabic page with
 * the words replaced from PAGE below, the language and direction flipped, the relative
 * paths pointed one level up, the fonts cut to the Latin face, the English words module
 * named before the page's entry, and the switch and the remembered-language script swapped
 * for their English versions. Everything else — the markup, the classes, the scripts, the
 * pixels — is the Arabic page's own, so the two cannot drift apart in anything but words.
 *
 * A WORD WITH NO ENGLISH STOPS THE BUILD: every piece of Arabic text in a page, and every
 * Arabic attribute a shopper or a screen reader meets, must have an entry below.
 *
 * The words the SCRIPTS show are in src/web/core/i18n-en.ts; the catalogue's words are the
 * English boxes in /admin > Catalogue. site/en/ is build output (git-ignored); scripts/build.ts
 * and scripts/dev.ts run this first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const SITE_DIR = path.join(ROOT, "site");
const SITE = "https://lubanmusk.com";

/* Arabic → English, whitespace-insensitive. One entry per text node or attribute value
   exactly as it reads in the Arabic page. (make-en.js's PAGE, unchanged.) */
export const PAGE: Record<string, string> = {
  /* ---- head ---- */
  "LUBAN &amp; MUSK · لبان صلالة معطر": "LUBAN &amp; MUSK · Scented Salalah Frankincense",
  "LUBAN & MUSK · لبان صلالة معطر": "LUBAN & MUSK · Scented Salalah Frankincense",
  "لبان صلالة معطر، ثلاث روائح: عود الافندر، ليمون مسك، عنبر توت. من 250 AED.":
    "Scented Salalah frankincense in three scents: Oud Lavender, Lemon Musk and Amber Berry. From 250 AED.",
  "إتمام الطلب · LUBAN &amp; MUSK": "Checkout · LUBAN &amp; MUSK",

  /* ---- header and footer ---- */
  "الرئيسية": "Home",
  "السابق": "Previous",
  "التالي": "Next",
  "السلة": "Basket",
  "واتساب": "WhatsApp",
  "إنستغرام": "Instagram",
  "تواصل عبر واتساب": "Chat on WhatsApp",
  "الخصوصية والاسترجاع": "Privacy &amp; returns",

  /* ---- the product ---- */
  "لبان صلالة معطر": "Scented Salalah Frankincense",
  "لُبان صلالة مُعَطَّر": "Scented Salalah Frankincense",
  "الدولة": "Country",
  "4.78/5 تقييم": "4.78/5 rating",
  "لبان عماني أصيل من أرض ظفار، مختار بعناية لجودة مميزة.":
    "Genuine Omani frankincense from Dhofar, hand-picked for exceptional quality.",
  "معطر بروائح فاخرة تضيف للمكان عبقا دافئا وأنيقا.":
    "Scented with fine fragrances that give any room a warm, elegant air.",
  "مثالي لتعطير المنزل والمجالس بالروائح التقليدية الأصيلة.":
    "Ideal for scenting your home and majlis with authentic traditional fragrance.",
  "أصالة عمانية بلمسة عصرية من": "Omani heritage with a modern touch from",
  /* page style 2's rating pill and paragraph (v194; the paragraph names
     no scents since v195 — a market may not sell all three) */
  "· تقييم العملاء": "· Customer rating",
  "من أشجار ظفار": "From the trees of Dhofar",
  "لبان حوجري أصيل من أشجار ظفار":
    "Authentic Hojari Frankincense, sourced from the sacred lands of Dhofar",
  "ننتقي حبّاته بعناية، ونثريها بزيوت عطرية أصلية لتفوح منها رائحة دافئة وأخاذة تملأ البيت والمجلس، وتدوم طويلًا.":
    "Each resin crystal is carefully selected and infused with pure aromatic oils, releasing a warm, captivating fragrance that fills your home and majlis and lingers beautifully.",
  /* one line break in the Arabic (br.br-ar) — the English is one sentence, so the break goes */
  "أصالة اللبان العُماني، بلمسة عصرية أنيقة… لأجواء تليق بك وبضيوفك.":
    "The timeless essence of Omani frankincense, elevated with a modern, refined touch, made for you and your guests.",
  "لبان ظفار الحوجري": "Dhofar Hojari frankincense",
  "زيوت عطرية أصلية": "Genuine fragrance oils",
  "رائحة فواحة وتدوم": "Rich, long-lasting scent",
  "طبيعي": "Natural",
  /* v196: the FAQ line on damaged or wrong orders. v211: the pill says
     the 15-day money-back guarantee instead (the policy page is unchanged) */
  "15 يومًا ضمان استرداد الأموال": "15 day refund guarantee",
  "استبدال الطلب التالف أو الخاطئ عند إبلاغنا خلال 48 ساعة": "Damaged or wrong orders replaced if reported within 48 hours",
  /* short enough for style 2's pill to hold it on one line at 320px (v195) */
  "شحن سريع خلال 72 ساعة": "72 hour shipping",
  "زهر اللافندر": "Lavender flowers",
  "خشب العود على الجمر": "Oud wood on hot coals",
  "ورد طائفي": "Taif roses",
  "استخراج اللبان من الشجرة": "Harvesting frankincense from the tree",
  "الحجم والروائح": "Size & scents",
  "الحجم": "Size",
  "عرض الباقة": "The set offer",
  "عرض الباقة الكبيرة": "The large set offer",
  "إتمام الطلب": "Checkout",
  "توصيل مجاني للطلبات الكبيرة": "Free delivery on larger orders",
  "طرق الدفع المقبولة": "Accepted payment methods",
  "ضمانات": "Guarantees",
  "دفع آمن": "Secure payment",
  "صديق للبيئة": "Eco-friendly",

  /* ---- the story ---- */
  "عن اللبان": "About the frankincense",
  "الفرق واضح": "The difference is clear",
  "مقارنة بين لبان ومسك وبين الدخون":
    "Luban & Musk compared with dukhoon",
  "دخون": "Dukhoon",
  "معطر بزيوت عطرية أصلية": "Scented with genuine fragrance oils",
  "غير معطر أو رائحة خفيفة": "Unscented, or a faint scent",
  "فواح ويجدد رائحة المكان": "Rich, and refreshes the whole room",
  "تأثير خفيف ولا يدوم": "Faint and short-lived",
  "حبة أو حبتان تكفيان للمنزل": "One or two pieces scent the whole home",
  "يحتاج كمية أكبر": "Needs much more",
  "روائح مميزة تدمج بين اللبان والعطور": "Distinctive scents that blend frankincense and perfume",
  "روائح مكررة ومتشابهة": "Repetitive, look-alike scents",
  "خطوات التحضير": "How to use",
  "سخن المبخرة": "Heat the burner",
  "ضع الفحم واتركه حتى يهدأ الجمر.": "Light the charcoal and let it settle to embers.",
  "ضع حبة لبان": "Add a piece",
  "حبة أو حبتان تكفيان للمنزل كامل.": "One or two pieces are enough for the whole home.",
  "اترك العطر ينتشر": "Let the scent spread",
  "يدوم الأثر ساعات بعد انطفاء الجمر.": "The scent lingers for hours after the embers go out.",
  "من نحن": "About us",
  "براند من ظفار، أرض اللبان. نختار الحوجري درجة أولى من مزارعي الجبل في موسم الحصاد، ونعطره يدويا بزيوت عطرية فاخرة قبل أن يصلك في علبة جاهزة للإهداء.":
    "A brand from Dhofar, the land of frankincense. We choose first-grade Hojari from mountain farmers at harvest time and scent it by hand with fine fragrance oils, before it reaches you in a gift-ready box.",
  "الشحن": "Shipping",
  "توصيل خلال 72 ساعة لجميع دول الخليج": "Delivery within 72 hours across the Gulf",
  "الدفع عند الاستلام متاح": "Cash on delivery available",

  /* ---- order tracking ---- */
  "تتبع الطلب": "Track your order",
  "تتبع طلبك": "Track your order",
  "رقم الطلب": "Order number",
  "تتبع": "Track",
  "رقم الطلب تجده في رسالة التأكيد، ويبدأ بـ LM": "Your order number is in your confirmation message and starts with LM",
  "اختر حجمك": "Choose your size",
  "اختر عرضك": "Choose your offer",
  "لبان حوجري من الدرجة الأولى من جبال ظفار، نعطّره يدويًا بزيوت عطرية فاخرة: تجربة مميزة تدمج بين أصالة لُبان صلالة وثراء العطور، بدخان طبيعي يبقى أثره ساعات بعد انطفاء الجمر.": "First grade Hojari frankincense from the Dhofar mountains, scented by hand with fine aromatic oils: a distinctive experience that joins the heritage of Salalah frankincense with the richness of fine perfume, in a natural smoke that lingers for hours after the embers die.",
  /* v440: the description's three lines */
  "🌿 لُبان مُسك - يجمع بين أصالة اللبان الحوجري العُماني من جبال ظفار ولمسة العطور الفاخرة، لتعيش تجربة عطرية تجمع بين التراث والفخامة.": "🌿 Luban Musk: the heritage of Omani Hojari frankincense from the Dhofar mountains with a touch of fine perfume, for a scent experience that joins heritage and luxury.",
  "✨ ٣ روائح حصرية - ثلاث روائح مميزة، لكل وحدة طابعها الخاص، عشان تختار العطر اللي يناسب ذوقك ويعكس أجواءك المفضلة.": "✨ 3 exclusive scents: three distinct scents, each with its own character, so you can choose the one that suits your taste and your favourite moments.",
  "🤍 جودة تدوم - لبان مختار بعناية ومعطّر بزيوت عطرية فاخرة، يفوح برائحة غنية تملأ البيت والمجلس وتستمر حتى بعد انطفاء الجمر.": "🤍 Quality that lasts: carefully chosen frankincense scented with fine aromatic oils, filling the home and the majlis with a rich scent that lingers after the embers die.",
  "متوفر عندنا 3 أنواع لتجربة عطرية مميزة:": "Three blends, each a distinctive scent:",
  "لُبان الليمون مع مسك وورد": "Lemon frankincense with musk and rose",
  "لُبان العود مع اللافندر وورد": "Oud frankincense with lavender and rose",
  "لُبان العنبر مع التوت وورد": "Amber frankincense with berries and rose",

  /* ---- checkout ---- */
  "أضف": "Add",
  "التوصيل": "Delivery",
  "الاسم": "Name",
  "اسم المستلم": "Recipient's name",
  "الاسم الكامل": "Full name",
  "المدينة": "City",
  "المنطقة": "Area",
  "الحي أو اسم الشارع": "Neighbourhood or street",
  "رقم الجوال": "Mobile number",
  "البريد الإلكتروني": "Email",
  "اختياري": "optional",
  "ملاحظة": "Note",
  "اكتب هنا...": "Write here…",
  "الدفع": "Payment",
  "طرق الدفع": "Payment method",
  "طريقة الدفع": "Payment method",
  "بطاقة الخصم المباشر": "Debit card",
  "مجانا": "Free",
  "الدفع عند الاستلام": "Cash on delivery",
  "المبلغ المستحق": "Amount due",
  "تأكيد الطلب": "Place order", "ادفع الآن": "Pay now",
  "تحدث مع خدمة العملاء": "Talk to customer service",
  "جارٍ تجهيز بوابة الدفع الآمنة، لا تغلق الصفحة": "Preparing the secure payment page. Please keep this page open.",
  "الطلب": "Your order",
  "المجموع": "Subtotal",
  "وفرت": "You saved",
  "الإجمالي": "Total",
  "جميع المدفوعات تخصم بالريال العماني": "All payments are charged in Omani rials",
  "السلة فارغة": "Your basket is empty",
  "اختر رائحتك وابدأ.": "Choose your scent to begin.",
  "العودة للمتجر": "Back to the shop",
  "جار تأكيد الدفع": "Confirming your payment",
  "لحظة واحدة، لا تغلق الصفحة.": "One moment, please don't close this page.",
  "تم استلام طلبك": "We've received your order",
  "، سنتواصل معك عبر واتساب.": ". We'll be in touch on WhatsApp.",
  "متابعة التسوق": "Continue shopping",
  "الإمارات": "UAE",
  "السعودية": "Saudi Arabia",
  "قطر": "Qatar",
  "الكويت": "Kuwait",
  "البحرين": "Bahrain",
  "عمان": "Oman",

  /* ---- privacy & returns (privacy.html) ---- */
  "الخصوصية والاسترجاع · LUBAN &amp; MUSK": "Privacy &amp; returns · LUBAN &amp; MUSK",
  "سياسة الخصوصية والاسترجاع في متجر لبان ومسك: استرداد المبلغ إن لم يصل الطلب خلال 7 أيام، واستبدال الطلب التالف أو الخاطئ عند إبلاغنا خلال 48 ساعة.":
    "Luban &amp; Musk's privacy and returns policy: a full refund if your order hasn't arrived within 7 days, and a damaged or wrong order replaced when reported within 48 hours.",
  "بياناتك محمية. نجمع أقل قدر ممكن من المعلومات، ونستخدمها لتوصيل طلبك فقط، ولا نبيعها ولا نشاركها مع أي جهة لأغراض تجارية.":
    "Your data is protected. We collect as little information as possible, use it only to deliver your order, and never sell it or share it with anyone for commercial purposes.",
  "بيانات الدفع": "Payment details",
  "لا نحفظ بيانات بطاقتك. تتم عملية الدفع بالكامل لدى بوابة ثواني المعتمدة، وجميع المبالغ تخصم بالريال العماني.":
    "We don't store your card details. Payment is handled entirely by Thawani, a licensed payment gateway, and all amounts are charged in Omani rials.",
  "الاسترجاع واسترداد المبلغ": "Returns &amp; refunds",
  "لم يصلك الطلب خلال 7 أيام؟ يحق لك طلب استرداد المبلغ كاملا. راسلنا برقم الطلب وننفذ الطلب.":
    "Order not arrived within 7 days? You're entitled to a full refund. Message us with your order number and we'll take care of it.",
  "نستبدل الطلب التالف أو الخاطئ. إن وصلك الطلب تالفا أو ناقصا أو مخالفا لما طلبته، أرسل لنا صورة على واتساب خلال 48 ساعة من الاستلام، ونتحمل نحن كامل الكلفة ونعالجها في نفس اليوم.":
    "We replace a damaged or wrong order. If your order arrives damaged, incomplete or different from what you ordered, send us a photo on WhatsApp within 48 hours of delivery. We cover the full cost and sort it out the same day.",
  "لا نقبل الإرجاع لغير ذلك. لا يُرجع المنتج ولا يُسترد ثمنه لتغيّر الرأي أو لعدم الرضا عن الرائحة.":
    "No other returns. Products can't be returned or refunded for a change of mind or because you don't like the scent.",
  "الاسترداد على البطاقة فقط. يعاد المبلغ إلى نفس البطاقة التي دفعت بها. لا نرد المبالغ إلى المحافظ الإلكترونية ولا بالتحويل البنكي.":
    "Refunds go to your card only. The money is returned to the same card you paid with; we can't refund to e-wallets or by bank transfer.",
  "يستغرق ظهور المبلغ في حسابك عادة من 5 إلى 10 أيام عمل بعد الموافقة على الاسترداد، حسب البنك المصدر للبطاقة.":
    "Once a refund is approved, it usually takes 5 to 10 working days to appear in your account, depending on the bank that issued your card.",
  "تحتاج مساعدة في طلبك؟": "Need help with your order?",
  "راسلنا على واتساب": "Message us on WhatsApp",
  "آخر تحديث: سبتمبر 2026": "Last updated: September 2026"
};

/** the pages built, each from the Arabic page of the same name */
export const FILES = ["index.html", "checkout.html", "privacy.html"];

/** Arabic that stays Arabic on the English page, on purpose: the switch back is labelled in Arabic. */
export const KEEP = ["عربي", "Language · اللغة"];

/** the entries that load the store's core, and so take the English words module first */
const CORE_ENTRIES = /<script type="module" src="\/src\/web\/entries\/(home|checkout)\.ts"><\/script>/;

const AR = /[؀-ۿ]/;
const norm = (s: string) => String(s).replace(/\s+/g, " ").trim();
const DICT: Record<string, string> = {};
Object.keys(PAGE).forEach((k) => {
  DICT[norm(k)] = PAGE[k]!;
});

export class MissingEnglish extends Error {
  constructor(public missing: string[]) {
    super("No English for:\n  " + Array.from(new Set(missing)).join("\n  "));
  }
}

export interface Built {
  html: string;
  arabicLeft: string[];
}

/** One English page from its Arabic source text (`file` names it: index.html, …). */
export function buildFrom(file: string, src: string): Built {
  const missing: string[] = [];
  const tr = (s: string) => {
    const n = norm(s);
    if (!AR.test(n) || KEEP.indexOf(n) > -1) return s;
    if (DICT[n] == null) {
      missing.push(n);
      return s;
    }
    /* keep the surrounding whitespace, so the markup stays as laid out */
    const lead = /^\s*/.exec(s)![0];
    const tail = /\s*$/.exec(s)![0];
    return lead + DICT[n] + tail;
  };

  let h = src;
  /* comments are for the Arabic source's readers; the English page is output, and says
     where its source is instead */
  h = h.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n/gm, "");
  h = h.replace(/[ \t]*<!--[\s\S]*?-->/g, "");
  h = h.replace(/^<!DOCTYPE html>\n/, "<!DOCTYPE html>\n<!-- GENERATED from site/" + file + " by scripts/make-en.ts — edit the Arabic page and the words there, not this file. -->\n");
  h = h.replace('<html lang="ar" dir="rtl" class="pg2 pg3">', '<html lang="en" dir="ltr" class="pg2 pg3">');

  /* the English store is set in Arial for text (style.css, :root[lang="en"]) with Cormorant
     Garamond for names and prices, so only the Latin face is fetched: the English fonts'
     CSS, and no preload of the Arabic face */
  h = h.split("/assets/fonts/fonts.css?").join("/assets/fonts/fonts-en.css?");
  h = h.replace(/^<link rel="preload" as="font"[^>]*\/assets\/fonts\/(?:ibmplexsansarabic|amiri)-[^>]*>\n/gm, "");

  /* the remembered language: on this page, being here is the choice */
  h = h.replace(/<script id="lang-remember">[\s\S]*?<\/script>/, '<script id="lang-remember">try { localStorage.setItem("lm_lang", "en"); } catch (e) {}</script>');

  /* the switch: EN lit, عربي the link back (carrying ?lang=ar, which the Arabic page's own
     script reads as the new choice) */
  const back = file === "index.html" ? "../?lang=ar" : "../" + file + "?lang=ar";
  const here = file === "index.html" ? "./" : file;
  h = h.replace(
    /<nav class="lang"[\s\S]*?<\/nav>/,
    '<nav class="lang" aria-label="Language · اللغة">\n' +
      '      <a href="' + here + '" lang="en" hreflang="en" data-lang="en" aria-current="page">EN</a>\n' +
      '      <a href="' + back + '" lang="ar" hreflang="ar" data-lang="ar">عربي</a>\n' +
      "    </nav>",
  );

  /* one level up for everything that lives at the root. The pages that have an English
     twin (index, checkout, privacy) are NOT here: their links stay relative, so from /en/
     they reach the English page. */
  h = h.replace(/(\s(?:src|href|srcset|data-src|data-poster|poster)=")(assets\/|favicon\.svg|apple-touch-icon\.png)/g, "$1../$2");

  /* the English words for the scripts, before the core reads them */
  h = h.replace(CORE_ENTRIES, (tag) => '<script type="module" src="/src/web/entries/en.ts"></script>\n' + tag);

  /* where this page is */
  const self = file === "index.html" ? "" : file;
  h = h.replace('<link rel="canonical" href="' + SITE + "/" + self + '">', '<link rel="canonical" href="' + SITE + "/en/" + self + '">');
  h = h.replace('<meta property="og:url" content="' + SITE + "/" + self + '">', '<meta property="og:url" content="' + SITE + "/en/" + self + '">');
  h = h.replace('<meta property="og:locale" content="ar_AE">', '<meta property="og:locale" content="en_US">');
  h = h.replace(/"image": \["assets\//, '"image": ["' + SITE + "/assets/");

  /* a line break the Arabic wants and the English sentence does not */
  h = h.split('<br class="br-ar">').join(" ");

  /* the words: attributes a shopper or a screen reader meets, then text */
  h = h.replace(/(\s(?:alt|aria-label|placeholder|title|content)=")([^"]*)(")/g, (m, a: string, v: string, z: string) => a + tr(v) + z);
  h = h.replace(/("name": ")([^"]*)(")/g, (m, a: string, v: string, z: string) => a + tr(v) + z);
  h = h.replace(/>([^<>]+)</g, (m, t: string) => ">" + tr(t) + "<");

  if (missing.length) throw new MissingEnglish(missing);

  /* nothing Arabic left but what is kept on purpose */
  let rest = h;
  KEEP.forEach((k) => {
    rest = rest.split(k).join("");
  });
  const left = rest.split("\n").filter((l) => AR.test(l) && !/<script|^\s*[{}[\]"]/.test(l.trim().slice(0, 7)));
  return { html: h, arabicLeft: left };
}

/** One English page from site/<file>. */
export function build(file: string, siteDir: string = SITE_DIR): Built {
  return buildFrom(file, readFileSync(path.join(siteDir, file), "utf8"));
}

/** Write (or with check, compare) every English page. Returns the out-of-date files. */
export function makeEn(opts: { check?: boolean; siteDir?: string; log?: (s: string) => void } = {}): string[] {
  const siteDir = opts.siteDir || SITE_DIR;
  const log = opts.log || (() => {});
  const stale: string[] = [];
  for (const file of FILES) {
    const out = build(file, siteDir);
    const dest = path.join(siteDir, "en", file);
    const have = existsSync(dest) ? readFileSync(dest, "utf8") : "";
    if (opts.check) {
      if (have !== out.html) stale.push("en/" + file);
    } else {
      mkdirSync(path.dirname(dest), { recursive: true });
      if (have !== out.html) writeFileSync(dest, out.html);
      log("  wrote en/" + file + (out.arabicLeft.length ? "  (Arabic left on " + out.arabicLeft.length + " line(s))" : ""));
    }
  }
  return stale;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const check = process.argv.includes("--check");
  try {
    const stale = makeEn({ check, log: (s) => console.log(s) });
    if (check && stale.length) {
      stale.forEach((f) => console.log("  out of date: site/" + f));
      process.exit(1);
    }
    if (check) console.log("  make-en: every Arabic word has English; site/en/ is up to date");
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
