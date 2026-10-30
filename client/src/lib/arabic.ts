/**
 * العددُ ومعدودُه بالعربية: الواحدُ والاثنان بصيغتيهما بلا رقم، ومن ثلاثةٍ
 * إلى عشرة جمعٌ، ومن أحد عشر فصاعداً مفردٌ منصوب — «لاعب واحد» و«لاعبَين»
 * و«٣ لاعبين» و«١١ لاعباً». والمئاتُ تعود إلى قاعدة آحادها: «١٠٣ لاعبين».
 */
export function countOf(n: number, forms: { one: string; two: string; few: string; many: string }) {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const tail = n % 100;
  if (tail >= 3 && tail <= 10) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}
