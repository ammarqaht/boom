/** تدرّجات الخيارات الأربعة — مأخوذة من ألوان شعار نادي نبراس */
export const OPTION_GRADIENTS = [
  'linear-gradient(135deg, #1a5fc4 0%, #103f91 100%)',
  'linear-gradient(135deg, #3fc9e6 0%, #0e92af 100%)',
  'linear-gradient(135deg, #ffb703 0%, #e68500 100%)',
  'linear-gradient(135deg, #f4564d 0%, #c2231b 100%)',
] as const;

/**
 * ترتيب ألوان مخلوط لكل سؤال على حدة.
 * البذرة من معرّف السؤال: الترتيب ثابت ما دام السؤال معروضاً (لا يرمش مع كل تحديث)
 * لكنه يختلف بين سؤال وآخر — فلا يحفظ اللاعب نمطاً لونياً.
 */
export function gradientsFor(seed: string, count: number): string[] {
  // تجزئة FNV-1a لتحويل المعرّف إلى بذرة رقمية
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // مولّد خطي مبذور — نتيجته متكرّرة لنفس البذرة
  let state = hash >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const pool = [...OPTION_GRADIENTS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
