/*
 * ══════════════════════════════════════════════════════════════
 * صورُ البنوك والمراحل
 *
 * لكل بنكٍ صورةٌ تُعرف بالنظر قبل أن يُقرأ اسمُها — كما تُعرض فئاتُ
 * «سين جيم» بطاقاتٍ مصوّرة لا قائمةَ أسماء. والشرطُ أن تقول الصورةُ
 * فئتَها بلا شرح: مسجدٌ للأنبياء، وكعبةٌ للعبادات، وليلةُ الهجرة للسيرة.
 *
 * والصورُ من Fluent Emoji 3D لمايكروسوفت (رخصة MIT — الملفّ معها في
 * public/art)، ملوّنةً بألوان نبضة مع بقاء تجسيمها، وبعضُها مركّب: غلافُ
 * المصحف، والكلمةُ تحت العدسة، والمسجدُ بعلامته. تُصنع كلّها من جديد بـ
 *   python3 scripts/art/tint.py && node scripts/art/compose.mjs
 * وتُخدم من موقعنا لا من شبكةٍ خارجية: القاعةُ قد تحجبها.
 *
 * والبنكُ الذي يُضاف لاحقاً من لوحة المالك يأخذ «other» حتى تُختار له
 * صورة: يُنسخ ملفُّها إلى public/art باسم معرّف البنك.
 * ══════════════════════════════════════════════════════════════
 */

const BANKS = new Set([
  'amma',
  'anbiya',
  'hadith',
  'ibadat',
  'lugha',
  'quran',
  'sahaba',
  'science',
  'seerah',
  'tarikh',
  'ulum',
]);

/*
 * رقمُ نسخة الصور: يُرفع كلما أُعيد صنعُها. ملفاتُ public تُخزَّن ساعةً
 * عند المتصفّح، فلو بقي الاسمُ نفسه لرأى من فتح الصفحة قبلُ الصورَ القديمة.
 */
const ART_VERSION = 4;

function Picture({ name }: { name: string }) {
  return (
    <img
      src={`/art/${name}.png?v=${ART_VERSION}`}
      alt=""
      width={256}
      height={256}
      draggable={false}
      loading="lazy"
      decoding="async"
    />
  );
}

export function BankArt({ id }: { id: string }) {
  return <Picture name={BANKS.has(id) ? id : 'other'} />;
}

export function LevelArt({ id }: { id: string }) {
  return <Picture name={id} />;
}
