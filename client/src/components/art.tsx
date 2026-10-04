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

/*
 * لونُ هالةِ كلِّ صورة — مأخوذٌ من الصورة نفسها، فتتوهّج اللوحةُ بلون
 * ما فيها: ذهبُ المصباح، وبنفسجُ المسجد، وخضرةُ الكتاب. والإطارُ يبقى
 * من نظام المِرقاب؛ اللونُ في الهالة وحدها.
 */
const TINTS: Record<string, string> = {
  amma: '#ffc531',
  anbiya: '#b48cff',
  hadith: '#f0b46a',
  ibadat: '#e8bf5a',
  lugha: '#5fb0ff',
  quran: '#4ad5ff',
  sahaba: '#6fd66a',
  science: '#9be15d',
  seerah: '#e3a06b',
  tarikh: '#ff6b9a',
  ulum: '#a879ff',
  other: '#ffb547',
  primary: '#ff8a4c',
  middle: '#ff4f9a',
  secondary: '#b0b8ff',
  university: '#9b7bff',
};

export const bankTint = (id: string) => TINTS[BANKS.has(id) ? id : 'other'];
export const levelTint = (id: string) => TINTS[id] ?? TINTS.other;

function Picture({ name }: { name: string }) {
  return <img src={`/art/${name}.png`} alt="" draggable={false} loading="lazy" decoding="async" />;
}

export function BankArt({ id }: { id: string }) {
  return <Picture name={BANKS.has(id) ? id : 'other'} />;
}

export function LevelArt({ id }: { id: string }) {
  return <Picture name={id} />;
}
