/*
 * ══════════════════════════════════════════════════════════════
 * صورُ البنوك والمراحل
 *
 * لكل بنكٍ صورةٌ تُعرف بالنظر قبل أن يُقرأ اسمُها — كما تُعرض فئاتُ
 * «سين جيم» بطاقاتٍ مصوّرة لا قائمةَ أسماء. والشرطُ أن تقول الصورةُ
 * فئتَها بلا شرح: مسجدٌ للأنبياء، وكعبةٌ للعبادات، وجملُ الهجرة للسيرة.
 *
 * والصورُ من Fluent Emoji 3D لمايكروسوفت (رخصة MIT — الملفّ معها في
 * public/art). تُخدم من موقعنا لا من شبكةٍ خارجية: القاعةُ قد تحجبها.
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

function Picture({ name }: { name: string }) {
  return <img src={`/art/${name}.png`} alt="" draggable={false} loading="lazy" decoding="async" />;
}

export function BankArt({ id }: { id: string }) {
  return <Picture name={BANKS.has(id) ? id : 'other'} />;
}

export function LevelArt({ id }: { id: string }) {
  return <Picture name={id} />;
}
