import type { CardId } from '../../lib/types';

export const DEMO = {
  startMs: 30000,
  bonusMs: 5000,
  penaltyMs: 3000,
  maxMs: 120000,
  countdownMs: 3000,
  revealMs: 520,
  joltMs: 1250,
  tickMs: 100,
} as const;

export type DemoQuestion = { q: string; options: [string, string, string, string] };

export const QUESTIONS: DemoQuestion[] = [
  { q: 'ما عاصمة اليابان؟', options: ['طوكيو', 'بكين', 'سيول', 'بانكوك'] },
  { q: 'كم عدد سور القرآن الكريم؟', options: ['١١٤', '١١٠', '١٢٠', '١٠٤'] },
  { q: 'ما أكبر كواكب المجموعة الشمسية؟', options: ['المشتري', 'زحل', 'الأرض', 'المريخ'] },
  { q: 'ما أسرع حيوان برّي؟', options: ['الفهد', 'الأسد', 'الحصان', 'الغزال'] },
  { q: 'كم لاعباً لكل فريق في ملعب كرة القدم؟', options: ['١١', '١٠', '٩', '١٢'] },
  { q: 'ما عاصمة المملكة العربية السعودية؟', options: ['الرياض', 'جدة', 'الدمام', 'أبها'] },
  { q: 'ما الغاز الذي تأخذه النباتات لصنع غذائها؟', options: ['ثاني أكسيد الكربون', 'الأكسجين', 'النيتروجين', 'الهيليوم'] },
  { q: 'كم عدد قارات العالم؟', options: ['٧', '٥', '٦', '٨'] },
  { q: 'في أي قارة تقع مصر؟', options: ['أفريقيا', 'آسيا', 'أوروبا', 'أستراليا'] },
  { q: 'كم دقيقة في الساعة الواحدة؟', options: ['٦٠', '١٠٠', '٥٠', '٣٠'] },
  { q: 'في أي مدينة تقع الكعبة المشرّفة؟', options: ['مكة المكرمة', 'المدينة المنورة', 'الطائف', 'جدة'] },
  { q: 'ما لون الزمرّد؟', options: ['أخضر', 'أحمر', 'أزرق', 'أصفر'] },
  { q: 'كم ضلعاً للمثلث؟', options: ['٣', '٤', '٥', '٦'] },
  { q: 'ما أكبر محيطات العالم؟', options: ['الهادئ', 'الأطلسي', 'الهندي', 'المتجمد الشمالي'] },
  { q: 'كم عدد أيام السنة الميلادية البسيطة؟', options: ['٣٦٥', '٣٦٠', '٣٥٤', '٣٦٦'] },
];

export type Bot = { name: string; every: number; hits: boolean[] };

export const BOTS: Bot[] = [
  { name: 'الصقور', every: 2300, hits: [true, true, false, true, true, true, false, true] },
  { name: 'النجوم', every: 2700, hits: [true, false, true, true, false, true, true, false] },
  { name: 'البرق', every: 2100, hits: [false, false, true, false, false, false, true, false] },
];

export const ME = 'أنت';

export function rankPoints(index: number, teams: number) {
  const cap = Math.min(5, teams - 1);
  return Math.max(cap > 0 ? 1 : 0, cap - index);
}

const PLURAL = new Intl.PluralRules('ar');

export function countWord(n: number, one: string, two: string, few: string) {
  const pick = PLURAL.select(n);
  return pick === 'two' ? two : pick === 'few' ? few : one;
}

export const arabic = (n: number) => n.toLocaleString('ar-EG');

export const CATALOG: { id: CardId; name: string; price: number; limit: number }[] = [
  { id: 'time', name: 'وقت إضافي', price: 6, limit: 4 },
  { id: 'truce', name: 'هدنة', price: 3, limit: 2 },
  { id: 'shield', name: 'درع', price: 2, limit: 3 },
  { id: 'revive', name: 'صاعق القلب', price: 7, limit: 1 },
  { id: 'fort', name: 'حصن', price: 5, limit: 3 },
  { id: 'mirror', name: 'مرآة', price: 5, limit: 2 },
  { id: 'blackout', name: 'تعتيم', price: 4, limit: 3 },
  { id: 'freeze', name: 'تجميد', price: 3, limit: 3 },
  { id: 'steal', name: 'سرقة نبض', price: 4, limit: 2 },
  { id: 'double', name: 'مضاعفة', price: 6, limit: 2 },
];
