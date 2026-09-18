/**
 * فاحص البنوك — قاعدةٌ واحدة بثلاثة مستدعين.
 *
 * كانت هذه القواعد حبيسةَ ملفّ بناءٍ خارج المستودع لا تعمل إلا حين تُبنى
 * البنوك من نصوص. وهي هنا يستدعيها ثلاثة: لوحة المالك وأنت تكتب السؤال،
 * وnpm test على البنوك كلها، وfs.watch عند كل إعادة قراءة. قاعدةٌ واحدة
 * لا ثلاث نسخٍ تتفرّق.
 *
 * وتفرّق بين خطأٍ يمنع وملقّنٍ يُنبَّه عليه: الأول يكسر اللعبة، والثاني
 * يُفسد متعتها — ويبقى الحكم فيه لك.
 */

/**
 * ألفاظُ تحفُّظٍ ينفرد بها خيار.
 *
 * حين يُكتب «عليه السلام» عند النبيّ الصحيح ولا يُكتب عند غيره، لم يعد
 * السؤال عن المعرفة بل عن الفطنة: يلمح اللاعب اللفظ فيختار بلا أن يعرف.
 * والعلاج أن يُكتب عند الجميع أو يُحذف من الجميع.
 */
const TELLS = [
  'فقط',
  'وحده',
  'وحدها',
  'عليه السلام',
  'رضي الله عنه',
  'رضي الله عنها',
  'صلى الله عليه وسلم',
  'تقريباً',
  'مطلقاً',
  'دائماً',
];

/** فرقُ طولٍ يلفت النظر: الصحيح مشروحٌ والخطأ مقتضب */
const LENGTH_GAP = 12;

const err = (message) => ({ severity: 'error', message });
const warn = (message) => ({ severity: 'warn', message });

/** تطبيعٌ للمقارنة: الفروق في التشكيل والترقيم لا تصنع سؤالاً جديداً */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[ً-ٰٟ]/g, '') // التشكيل
    .replace(/[«»"'؟?.,،:؛!ـ\s]+/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

/**
 * يفحص سؤالاً واحداً. يُستدعى على كل ضغطة مفتاحٍ في المحرّر، فلا شيء
 * فيه أثقل من مرورٍ على أربعة خيارات.
 */
export function auditQuestion(question) {
  const issues = [];
  const text = String(question?.q ?? '').trim();
  const options = Array.isArray(question?.options) ? question.options : [];

  if (!text) issues.push(err('السؤال فارغ'));
  else if (text.length < 8) issues.push(warn('السؤال قصيرٌ جداً — أمتأكّد أنه مكتمل؟'));

  if (options.length !== 4) {
    issues.push(err(`الخيارات ${options.length} والمطلوب أربعة`));
  }
  if (options.some((option) => !String(option ?? '').trim())) {
    issues.push(err('خيارٌ فارغ'));
  }

  const clean = options.map((option) => normalizeText(option));
  const seen = new Set();
  for (const option of clean) {
    if (option && seen.has(option)) {
      issues.push(err('خياران متطابقان'));
      break;
    }
    seen.add(option);
  }

  if (question?.answer !== 0) {
    issues.push(err('الصواب يكون أوّل الخيارات دائماً — والخلط يقع عند التوزيع'));
  }

  if (![1, 2, 3].includes(question?.level)) {
    issues.push(err('المستوى يكون ١ أو ٢ أو ٣'));
  }

  // ── الملقّنات ──
  if (options.length === 4) {
    const [right, ...wrong] = options.map((option) => String(option ?? ''));

    for (const tell of TELLS) {
      const inRight = right.includes(tell);
      const inWrong = wrong.filter((option) => option.includes(tell)).length;
      if (inRight && inWrong === 0) {
        issues.push(warn(`«${tell}» في الصواب وحده — يدلّ عليه`));
      } else if (!inRight && inWrong === 1) {
        issues.push(warn(`«${tell}» في خطأٍ واحد — يُستبعَد به`));
      }
    }

    const longestWrong = Math.max(0, ...wrong.map((option) => option.length));
    if (right.length > longestWrong + LENGTH_GAP) {
      issues.push(warn(`الصواب أطول من أطول خطأ بـ${right.length - longestWrong} حرفاً`));
    }

    if (wrong.some((option) => normalizeText(option) === normalizeText(right))) {
      issues.push(err('خطأٌ يطابق الصواب'));
    }
  }

  return issues;
}

/** يفحص بنكاً كاملاً ويُرجع ما فيه من أسئلةٍ عليها ملاحظات */
export function auditBank(bank) {
  const out = [];
  for (const question of bank?.questions ?? []) {
    const issues = auditQuestion(question);
    if (issues.length) out.push({ id: question.id, q: question.q, bank: bank.id, issues });
  }
  return out;
}

/**
 * يفحص البنوك مجتمعة، ويزيد ما لا يُرى إلا بالنظر إليها معاً:
 * سؤالٌ مكرّر بين بنكين يراه لاعبٌ اختار كليهما مرّتين.
 */
export function auditAll(banks) {
  const list = [...banks];
  const flat = list.flatMap((bank) => auditBank(bank));

  const seen = new Map();
  const duplicates = [];
  for (const bank of list) {
    for (const question of bank.questions ?? []) {
      const key = normalizeText(question.q);
      if (!key) continue;
      const first = seen.get(key);
      if (first) {
        duplicates.push({
          q: question.q,
          banks: [first.bank, bank.id],
          ids: [first.id, question.id],
        });
      } else {
        seen.set(key, { bank: bank.id, id: question.id });
      }
    }
  }

  return {
    issues: flat,
    duplicates,
    errors: flat.filter((row) => row.issues.some((i) => i.severity === 'error')).length,
    warnings: flat.filter((row) => row.issues.every((i) => i.severity === 'warn')).length,
  };
}
