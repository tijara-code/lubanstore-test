/* ==========================================================
   LUBAN & MUSK — the English words

   Installed as window.LM_EN by src/web/entries/en.ts, on the /en/ pages only, before any
   page module runs (the original loaded i18n-en.js just before store.js). Pure data: the
   server may import it too (the English city names an Omniful order carries). Every string the
   storefront shows a shopper is written in Arabic in the code and passed
   through L() (src/web/core/lang.ts); this is the English for each, keyed by the
   Arabic itself so the code still reads as the page reads.

   A value may be a function of the placeholders, for the phrases English
   inflects and Arabic does not ("1 day" / "5 days"). `count` is passed
   beside a placeholder that carries markup, so the function can choose
   the word without parsing HTML.

   tests/web/core/i18n.test.ts fails if an L("...") in the storefront has no
   entry here, so a new message cannot ship half-translated.

   The catalogue's own words — scent and size names, the bundle, the
   add-ons, the country names — are not here: they are edited in
   /admin > Catalogue, in the English boxes beside the Arabic ones.
   ========================================================== */
import type { EnEntry, Vars } from "./types";

function days(v: Vars): string { return v.n + " " + (Number(v.count) === 1 ? "day" : "days") + " left"; }

export const LM_EN: Record<string, EnEntry> = {
  /* ---- money and the offer ---- */
  "درهم": "dirham",
  "ريال عماني": "Omani rial",
  "ريال سعودي": "Saudi riyal",
  "عرض محدود": "Limited offer",
  "عرض هذا الأسبوع": "This week's offer",
  "عرض {m}": "{m} offer",
  "يناير": "January", "فبراير": "February", "مارس": "March", "أبريل": "April",
  "مايو": "May", "يونيو": "June", "يوليو": "July", "أغسطس": "August",
  "سبتمبر": "September", "أكتوبر": "October", "نوفمبر": "November", "ديسمبر": "December",
  "باقي {t} ساعة": "Ends in {t}",
  /* style 3 counts the bundle's window in whole hours (v197) */
  "باقي {h} ساعة": function (v: Vars) { return v.h + " " + (Number(v.count) === 1 ? "hour" : "hours") + " left"; },
  "باقي {h} ساعات": function (v: Vars) { return v.h + " hours left"; },
  "باقي {n} يوم": days,
  "ينتهي اليوم": "Ends today",
  /* v411: the set's free-delivery countdown — "باقي 3 أيام" */
  "باقي {t}": "{t} left",
  "وفر {p}": "Save {p}",
  "أضف الباقة إلى السلة": "Add the set to basket",
  /* v414: the set's scents, by the blends' names */
  "لُبان الليمون مع مسك وورد": "Lemon frankincense with musk and rose",
  "لُبان العود مع اللافندر وورد": "Oud frankincense with lavender and rose",
  "لُبان العنبر مع التوت وورد": "Amber frankincense with berries and rose",

  /* ---- the product ---- */
  "لبان صلالة معطر": "Scented Salalah Frankincense",
  "صورة {n}": "Photo {n}",
  "لا تتوفر أحجام للشحن إلى بلدك حاليا.": "No sizes ship to your country right now.",
  "نفدت الكمية": "Sold out",
  "{n} من 5": "{n} out of 5",
  "إنقاص": "Decrease",
  "زيادة": "Increase",
  "اختر رائحة": "Choose a scent",
  "الحجم {n}": "{n} size",
  /* the pieces left beside it (v206) */
  "باقي قطعة واحدة": "1 piece left",
  "باقي قطعتان": "2 pieces left",
  "قطعة واحدة متبقية": "1 piece left",
  "قطعتان متبقيتان": "2 pieces left",
  "{n} قطع متبقية": "{n} pieces left",
  "{n} قطعة متبقية": "{n} pieces left",
  "باقي {n} قطع": "{n} pieces left",
  "باقي {n} قطعة": "{n} pieces left",
  /* delivery time in Saudi Arabia (v198): the pill, the fact, the bullet */
  "شحن خلال 3-5 أيام": "3–5 day shipping",
  "توصيل خلال 3-5 أيام إلى السعودية": "Delivery to Saudi Arabia in 3–5 days",
  "توصيل خلال 3-5 أيام إلى قطر": "Delivery to Qatar in 3–5 days",
  "شحن سريع خلال 48 ساعة": "48 hour shipping",
  "شحن سريع خلال 72 ساعة": "72 hour shipping",
  "15 يومًا ضمان استرداد الأموال": "15 day refund guarantee",
  "توصيل خلال 48 ساعة داخل عُمان": "Delivery within 48 hours in Oman",
  "أضف إلى السلة · {p}": "Add to basket · {p}",
  "تمت الإضافة ✓": "Added ✓",
  /* page style 2's size grid (Catalogue > Page style, v194) */
  "تعديل أو إلغاء خلال 24 ساعة": "Change or cancel within 24 hours",
  "فيزا أو الدفع عند الاستلام": "Visa or cash on delivery",
  "الدفع بالفيزا": "Pay by Visa",
  "{n} روائح حصرية": "{n} exclusive scents",
  "رائحتان حصريتان": "2 exclusive scents",
  "رائحة حصرية": "1 exclusive scent",

  /* ---- delivery ---- */
  "توصيل مجاني فوق {p}": "Free delivery over {p}",
  "الشحن {p}": "Delivery {p}",
  "توصيل مجاني": "Free delivery",
  /* the large-box offers (v303) */
  "علبة": "One box", "علبتان": "Two boxes", "3 علب": "Three boxes",
  "عروض الحجم الكبير": "Large-box offers", "كلما زدت، وفّرت": "The more you take, the more you save",
  "ينتهي العرض خلال": "Offer ends in", "يوم واحد": "1 day", "يومين": "2 days",
  "ساعة واحدة": "1 hour", "ساعتين": "2 hours", "{n} ساعات": "{n} hours", "{n} ساعة": "{n} hours",
  /* v419: the set's countdown says "3 days left" (left: 1); the offer's "Offer ends in 3 days" has no flag */
  "{n} أيام": function (v: Vars) { return v.n + " days" + (v.left ? " left" : ""); }, "{n} يومًا": "{n} days",
  "{n} يوم": "{n} day left", "{n} يومين": "{n} days left", "{p} للعلبة": "{p} a box",
  "الأكثر توفيرًا": "Best value",
  /* v336: the countdown under an hour, ended offers, the sticky bar */
  "دقيقة واحدة": "1 minute", "دقيقتين": "2 minutes", "{n} دقائق": "{n} minutes", "{n} دقيقة": "{n} minutes",
  "انتهى العرض": "Offer ended", "انتهى العرض على هذه المنتجات:": "These offers have ended:",
  "اختر عرضك": "Choose your offer", "اختر حجمك": "Choose your size",
  "اختر روائح": "Choose scents", "جرّب الروائح الثلاث": "Try all three scents", "{n} علب صغيرة · {w} لكل علبة": "{n} small boxes · {w} each", "{s} · {w} لكل علبة": "{s} · {w} each", "{s} · {n} × {w}": "{s} · {n} × {w}", "أدخل رقمًا صحيحًا": "Enter a valid number", "رقم صحيح": "Valid number", "باقة الروائح الثلاث": "The Three-Scent Set",
  "اختر رائحتين": "Choose 2 scents", "اختر {n} روائح": "Choose {n} scents", "{k} من {n}": "{k} of {n}", "{n} عروض": "× {n}",
  "أضف علبتين · {p}": "Add 2 boxes · {p}", "أضف {n} علب · {p}": "Add {n} boxes · {p}",
  "اختر رائحة أخرى": "Choose 1 more scent", "اختر رائحتين أخريين": "Choose 2 more scents",
  "توصيل مجاني للطلبات فوق {p}": "Free delivery on orders over {p}",
  "توصيل مجاني لكل الطلبات": "Free delivery on every order",
  "الشحن {p} للطلبات الأقل من ذلك": "Delivery is {p} on smaller orders",
  "فوق {p}": "over {p}",
  "على جميع الطلبات": "on all orders",
  "أضف {p}": "Add {p}",
  "التوصيل مجاني على هذا الطلب": "Delivery is free on this order",
  "أضف {p} ليصبح التوصيل مجانيًا": "Add {p} for free delivery",
  "العينات لا تُحتسب ضمن التوصيل المجاني": "Samples don't count toward free delivery",
  "التوصيل مجاني ✓": "Free delivery ✓",
  "أضف للسلة ويصير التوصيل مجاني": "Add to basket for free delivery",
  "{p} للتوصيل المجاني": "{p} to free delivery",

  /* ---- order tracking ---- */
  "تأكد من رقم الطلب — يبدأ بـ LM": "Check the order number. It starts with LM",
  "جارٍ البحث…": "Looking…",
  "لم نجد هذا الرقم. تأكد منه أو راسلنا.": "We couldn't find that number. Check it, or message us.",
  "تعذر جلب الحالة. جرب بعد قليل.": "Couldn't get the status. Try again shortly.",
  "تعذر الاتصال. تحقق من الإنترنت.": "Couldn't connect. Check your internet.",
  "تم الاستلام": "Received",
  "لدى شركة الشحن": "With the courier",
  "محاولة تسليم": "Delivery attempted",
  "تم التسليم": "Delivered",
  /* the server's own status lines (netlify/functions/track.js, _ship.js) */
  "بانتظار إتمام الدفع": "Waiting for payment",
  "قيد التحضير": "Being prepared",
  "تم إلغاء الطلب": "Order cancelled",
  "تم استلام الطلب": "Order received",
  "استلمته شركة الشحن": "Picked up by the courier",
  "في الطريق إليك": "On its way to you",
  "تعذر التسليم — سنتواصل معك": "Couldn't be delivered. We'll contact you",
  "أعيدت الشحنة": "Returned",

  /* ---- the basket ---- */
  "السلة": "Basket",
  "إغلاق": "Close",
  "الشحن والضريبة تحسب عند الدفع": "Delivery and tax are worked out at checkout",
  "الدفع": "Checkout",
  "السلة فارغة": "Your basket is empty",
  "غير متوفر في بلدك": "Not available in your country",
  "يُباع ضمن الباقة فقط": "Sold only in the three-scent set",
  "تجربة فريدة للأصالة العمانية": "A unique taste of Omani heritage",
  "احجز علبتك الآن": "Reserve your box now",
  "حذف": "Remove",
  "احذف غير المتوفر": "Remove unavailable items",
  "لا يمكننا شحن هذه المنتجات إلى {c} حاليا:": "We can't ship these to {c} right now:",

  /* ---- checkout ---- */
  "مجاني": "Free",
  "مجانا": "Free",
  "جميع المدفوعات تخصم بالريال العماني": "All payments are charged in Omani rials",
  "المحافظة": "Governorate",
  "اختر المحافظة": "Choose governorate",
  "اكتب اسم المدينة": "Type your city",
  "اختر المدينة": "Choose city",
  "المدينة": "City",
  "جار تأكيد طلبك…": "Confirming your order…",
  "تأكيد الطلب": "Place order", "ادفع الآن": "Pay now",
  "جار تحويلك للدفع…": "Taking you to payment…",
  "بوابة الدفع غير مهيأة بعد. اختر الدفع عند الاستلام أو راسلنا.": "Card payment isn't set up yet. Choose cash on delivery, or message us.",
  "المبلغ أقل من الحد المسموح للدفع بالبطاقة.": "The amount is below the card payment minimum.",
  "تأكد من إكمال بياناتك.": "Please complete your details.",
  "أحد المنتجات في سلتك غير متوفر في بلدك. احذفه وأعد المحاولة.": "An item in your basket isn't available in your country. Remove it and try again.",
  "أحد المنتجات في سلتك لم يعد متاحا. احذفه وأعد المحاولة.": "An item in your basket is no longer available. Remove it and try again.",
  "الدفع عند الاستلام غير متاح في بلدك. اختر الدفع بالبطاقة.": "Cash on delivery isn't available in your country. Choose card.",
  "انتهى عرض الباقة. احذفها من السلة وأعد المحاولة.": "The set offer has ended. Remove it from your basket and try again.",
  "أحد المنتجات في سلتك غير مسعّر لبلدك. احذفه وأعد المحاولة.": "An item in your basket has no price in your country. Remove it and try again.",
  "الكمية أكبر من المسموح لطلب واحد. قلّلها أو راسلنا على واتساب.": "That is more than one order can take. Reduce it or message us on WhatsApp.",
  "الكمية المتوفرة أقل مما في سلتك. قلّل الكمية وأعد المحاولة.": "Fewer are available than your basket asks for. Reduce the quantity and try again.",
  "باقي {n} فقط": "Only {n} left",
  "اختر بلدك من القائمة وأعد المحاولة.": "Choose your country from the list and try again.",
  "تعذر إتمام الطلب. جرب مرة أخرى أو راسلنا على واتساب.": "We couldn't place the order. Try again, or message us on WhatsApp.",
  "تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى أو اختر الدفع عند الاستلام.": "Payment cancelled. Your basket is as you left it. Try again, or choose cash on delivery.",
  "تعذر التحقق من الدفع الآن. إن كان المبلغ قد خُصم فطلبك محفوظ — راسلنا برقم الطلب {id} ولا تدفع مرة أخرى.": "We can't confirm the payment right now. If you were charged, your order is safe. Message us with order number {id} and don't pay again.",
  "هناك اختلاف في المبلغ. راسلنا وسنكمل طلبك يدويا.": "The amount didn't match. Message us and we'll complete your order by hand.",
  "لم يكتمل الدفع. سلتك كما هي، جرب مرة أخرى.": "The payment didn't go through. Your basket is as you left it. Try again.",
  /* (v336) the checkout: phone checks, the shelf, a parked order, and
     the way back from the gateway with no basket in the tab */
  "هذا الرقم بمفتاح +{d}. اختر دولته أو اكتب رقمًا محليًا.": "This number has the +{d} code. Choose its country, or enter a local number.",
  "رقم الجوال هنا من {n} أرقام.": "Mobile numbers here have {n} digits.",
  /* v414: a mobile's first digit, per market */
  "يبدأ رقم الجوال هنا بـ {d}.": "Mobile numbers here start with {d}.",
  "{a} أو {b}": "{a} or {b}",
  "تأكد من رقم الجوال.": "Please check your mobile number.",
  "استلمنا طلبك وسنؤكده قريبًا": "We have your order and will confirm it shortly",
  "محاولات كثيرة الآن. جرب مرة أخرى بعد دقيقة.": "Too many tries just now. Try again in a minute.",
  "بقي {n} فقط من {item}.": "Only {n} left of {item}.",
  "نفدت الكمية من {item}.": "{item} is sold out.",
  "عدّل سلتك وأعد المحاولة.": "Adjust your basket and try again.",
  "اجعلها {n}": "Set to {n}",
  "احذفه من السلة": "Remove it",
  "استخدم الرابط في رسالتك للدفع، أو اختر الدفع عند الاستلام.": "Use the link in your message to pay, or switch to cash on delivery.",
  /* v439: the same three, where cash on delivery is not offered */
  "استخدم الرابط في رسالتك للدفع، أو راسلنا على واتساب.": "Use the link in your message to pay, or message us on WhatsApp.",
  "تم إلغاء الدفع. سلتك كما هي، جرب مرة أخرى.": "Payment cancelled. Your basket is as you left it. Try again.",
  "بوابة الدفع غير مهيأة بعد. راسلنا على واتساب.": "Card payment isn't set up yet. Message us on WhatsApp.",
  "طلبك {id}": "Your order {id}",
  "راسلنا على واتساب": "Message us on WhatsApp",
  "تم إلغاء الدفع.": "Payment cancelled.",
  "تعذر التحقق من الدفع الآن.": "We could not check the payment just now.",
  "إن خُصم المبلغ فطلبك محفوظ. لا تدفع مرة أخرى وراسلنا برقم الطلب.": "If you were charged, your order is safe. Do not pay again; message us with the order number.",
  "طلبك قيد المعالجة بالفعل.": "Your order is already being handled.",
  "لا حاجة لأي إجراء. لأي استفسار راسلنا برقم الطلب.": "Nothing to do. For any question, message us with the order number.",
  "هناك اختلاف في المبلغ.": "The amount did not match.",
  "راسلنا وسنكمل طلبك يدويا.": "Message us and we will complete your order by hand.",
  "لم يكتمل الدفع.": "Payment not completed.",

  /* ---- cities (assets/js/cities.js): the value sent stays Arabic, this is what is shown ---- */
  /* UAE */
  "دبي": "Dubai", "أبوظبي": "Abu Dhabi", "الشارقة": "Sharjah", "العين": "Al Ain",
  "عجمان": "Ajman", "رأس الخيمة": "Ras Al Khaimah", "الفجيرة": "Fujairah", "أم القيوين": "Umm Al Quwain",
  "خورفكان": "Khor Fakkan", "دبا الحصن": "Dibba Al-Hisn", "كلباء": "Kalba", "دبا الفجيرة": "Dibba Al-Fujairah",
  "الذيد": "Al Dhaid", "حتا": "Hatta", "جبل علي": "Jebel Ali", "المدام": "Al Madam",
  "مليحة": "Mleiha", "مصفوت": "Masfout", "الحمرية": "Al Hamriyah", "مدينة زايد": "Madinat Zayed",
  "الرويس": "Ruwais", "غياثي": "Ghayathi", "ليوا": "Liwa", "المرفأ": "Al Mirfa",
  "السلع": "Al Sila", "الشهامة": "Al Shahama", "الرحبة": "Al Rahba", "بني ياس": "Baniyas",
  "مصفح": "Mussafah",
  /* Saudi Arabia */
  "الرياض": "Riyadh", "جدة": "Jeddah", "مكة المكرمة": "Makkah", "المدينة المنورة": "Madinah",
  "الدمام": "Dammam", "الخبر": "Khobar", "الظهران": "Dhahran", "الأحساء": "Al Ahsa",
  "القطيف": "Qatif", "الجبيل": "Jubail", "الطائف": "Taif", "بريدة": "Buraydah",
  "عنيزة": "Unaizah", "تبوك": "Tabuk", "حائل": "Hail", "أبها": "Abha",
  "خميس مشيط": "Khamis Mushait", "نجران": "Najran", "جازان": "Jazan", "ينبع": "Yanbu",
  "الخرج": "Al Kharj", "سكاكا": "Sakaka", "الهفوف": "Al Hofuf", "المبرز": "Al Mubarraz",
  "الدرعية": "Diriyah", "حفر الباطن": "Hafar Al-Batin", "الباحة": "Al Baha", "عرعر": "Arar",
  "القنفذة": "Al Qunfudhah", "رابغ": "Rabigh", "بيشة": "Bisha", "المجمعة": "Al Majmaah",
  "الزلفي": "Az Zulfi", "الدوادمي": "Ad Dawadmi", "القريات": "Al Qurayyat", "الرس": "Ar Rass",
  "شرورة": "Sharurah", "صبيا": "Sabya", "أبو عريش": "Abu Arish", "صامطة": "Samtah",
  "محايل عسير": "Muhayil Asir", "النماص": "Al Namas", "الخفجي": "Al Khafji", "رأس تنورة": "Ras Tanura",
  "بقيق": "Abqaiq", "سيهات": "Saihat", "صفوى": "Safwa", "النعيرية": "An Nuayriyah",
  "الأفلاج": "Al Aflaj", "وادي الدواسر": "Wadi Al-Dawasir", "العلا": "AlUla", "تيماء": "Tayma",
  "الوجه": "Al Wajh", "أملج": "Umluj", "ضباء": "Duba", "طريف": "Turaif",
  "رفحاء": "Rafha", "المذنب": "Al Mithnab", "البكيرية": "Al Bukayriyah", "شقراء": "Shaqra",
  "المزاحمية": "Al Muzahimiyah", "الليث": "Al Lith", "خليص": "Khulais", "الجموم": "Al Jumum",
  "بدر": "Badr", "تربة": "Turabah", "رنية": "Ranyah", "بلجرشي": "Baljurashi",
  "المخواة": "Al Makhwah", "أحد رفيدة": "Ahad Rafidah", "ظهران الجنوب": "Dhahran Al Janub", "فرسان": "Farasan",
  /* Qatar */
  "الدوحة": "Doha", "الريان": "Al Rayyan", "الوكرة": "Al Wakrah", "أم صلال": "Umm Salal",
  "الخور": "Al Khor", "الظعاين": "Al Daayen", "الشحانية": "Al Shahaniya", "مسيعيد": "Mesaieed",
  "دخان": "Dukhan", "الشمال": "Al Shamal", "لوسيل": "Lusail", "الغرافة": "Al Gharrafa",
  "الوكير": "Al Wukair", "الذخيرة": "Al Thakhira", "راس لفان": "Ras Laffan", "أبو سمرة": "Abu Samra",
  "مدينة خليفة": "Madinat Khalifa", "معيذر": "Muaither", "عين خالد": "Ain Khaled", "الخيسة": "Al Kheesa",
  /* Kuwait */
  "مدينة الكويت": "Kuwait City", "حولي": "Hawalli", "السالمية": "Salmiya", "الفروانية": "Farwaniya",
  "الأحمدي": "Ahmadi", "الفحيحيل": "Fahaheel", "الجهراء": "Jahra", "مبارك الكبير": "Mubarak Al-Kabeer",
  "الجابرية": "Jabriya", "صباح السالم": "Sabah Al-Salem", "المنقف": "Mangaf", "الفنطاس": "Fintas",
  "الرميثية": "Rumaithiya", "سلوى": "Salwa", "بيان": "Bayan", "مشرف": "Mishref",
  "خيطان": "Khaitan", "جليب الشيوخ": "Jleeb Al-Shuyoukh", "العارضية": "Ardiya", "الشويخ": "Shuwaikh",
  "كيفان": "Kaifan", "الشامية": "Shamiya", "الدسمة": "Dasma", "المهبولة": "Mahboula",
  "أبو حليفة": "Abu Halifa", "العقيلة": "Egaila", "الصباحية": "Sabahiya", "هدية": "Hadiya",
  "الرقة": "Riqqa", "العدان": "Adan", "القرين": "Qurain", "القصور": "Qusour",
  "صباح الأحمد": "Sabah Al-Ahmad", "الخيران": "Khairan", "الوفرة": "Wafra", "العبدلي": "Abdali",
  "الصليبية": "Sulaibiya", "سعد العبدالله": "Saad Al-Abdullah", "القيروان": "Qairawan",
  /* Bahrain */
  "المنامة": "Manama", "المحرق": "Muharraq", "الرفاع": "Riffa", "مدينة حمد": "Hamad Town",
  "مدينة عيسى": "Isa Town", "سترة": "Sitra", "الحد": "Hidd", "جدحفص": "Jidhafs",
  /* the same name in Bahrain and in the Emirates (line 208), with the
     same English: the repeat is harmless */
  /* "مدينة زايد" is named once, with the Emirates (TypeScript refuses a repeated key) */
  "البديع": "Budaiya", "سار": "Saar", "عالي": "A'ali",
  "الزلاق": "Zallaq", "عسكر": "Askar", "جو": "Jaw", "الدراز": "Diraz",
  "باربار": "Barbar", "كرباباد": "Karbabad", "السنابس": "Sanabis", "الجفير": "Juffair",
  "العدلية": "Adliya", "الحورة": "Hoora", "القضيبية": "Gudaibiya", "السيف": "Seef",
  "توبلي": "Tubli", "سند": "Sanad", "النويدرات": "Nuwaidrat", "المعامير": "Ma'ameer",
  "عراد": "Arad", "قلالي": "Galali", "البسيتين": "Busaiteen", "الدير": "Al Dair",
  "سماهيج": "Samaheej", "عوالي": "Awali", "درة البحرين": "Durrat Al Bahrain", "ديار المحرق": "Diyar Al Muharraq",
  "أمواج": "Amwaj Islands", "الجسرة": "Jasra",
  /* Oman */
  "مسقط": "Muscat", "ظفار": "Dhofar", "مسندم": "Musandam", "البريمي": "Al Buraimi",
  "الداخلية": "Ad Dakhiliyah", "شمال الباطنة": "North Al Batinah", "جنوب الباطنة": "South Al Batinah", "جنوب الشرقية": "South Ash Sharqiyah",
  "شمال الشرقية": "North Ash Sharqiyah", "الظاهرة": "Ad Dhahirah", "الوسطى": "Al Wusta"
};
