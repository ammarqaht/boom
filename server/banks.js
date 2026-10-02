import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAll } from './audit.js';

/*
 * طبقةُ القاعدة تُستورَد عند الحاجة لا عند التحميل.
 *
 * store.js يأبى الإقلاع بلا DATABASE_URL ويفتح مجمّعَ اتصالٍ عند استيراده،
 * وهذه الوحدةُ تُقرأ في اختباراتٍ لا قاعدةَ لها — قواعدُ الجولة والبطاقات
 * تُفحص على ملفّات البنوك وحدها. فالقراءةُ لا تحتاج قاعدة، والكتابةُ تحتاجها
 * فتُستورَد عندها مرّةً وتُحفظ.
 */
let loaded = null;

async function db() {
  loaded ??= await import('./store.js');
  return loaded;
}

const banksDir = join(dirname(fileURLToPath(import.meta.url)), 'banks');

/** @type {Map<string, {id: string, name: string, questions: {q: string, options: string[], answer: number, level: number, id: string}[]}>} */
let banks = new Map();

/**
 * معرّفٌ مشتقٌّ من نصّ السؤال لا من ترتيبه في الملف.
 *
 * الترتيب يتبدّل مع كل حذفٍ أو إدراج، ولو بُني المعرّف عليه لضاع على
 * اللاعب سجلّ ما رآه كلما حُرِّر البنك. أما النصّ فثابت ما دام السؤال
 * هو هو. (FNV-1a — قصيرٌ وسريع، ولا يُراد به أمان.)
 */
function idFor(bankId, text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${bankId}:${hash.toString(36)}`;
}

/**
 * البنوك من ملفّات المستودع — بذرةٌ ونسخةُ احتياط، لا مرجعاً.
 *
 * المرجعُ جدولُ banks في PostgreSQL: الملفُّ يعيش في الحاوية والحاوية تُبنى
 * من المستودع عند كل نشر، فما حُرِّر على القرص يُمحى. وهذه تُقرأ في موضعين:
 * زرعِ قاعدةٍ فارغة أول مرّة، واستيرادٍ يطلبه المالك من اللوحة.
 */
function fromFiles() {
  const next = new Map();
  for (const file of readdirSync(banksDir).filter((f) => f.endsWith('.json'))) {
    try {
      const bank = JSON.parse(readFileSync(join(banksDir, file), 'utf8'));
      next.set(bank.id, dress(bank));
    } catch (err) {
      console.warn(`⚠ تعذّرت قراءة بنك ${file}: ${err.message}`);
    }
  }
  return next;
}

/**
 * يُلبس البنكَ ما يُشتقّ منه: معرّفُ كل سؤالٍ ومستواه.
 *
 * والمعرّف من نصّ السؤال كما كان — فنقلُ البنوك إلى القاعدة لا يبدّل معرّفاً
 * واحداً، ويبقى إحصاءُ كل سؤالٍ وبلاغاته ونسخُ تحريره موصولةً به.
 */
function dress(bank) {
  return {
    id: bank.id,
    name: bank.name,
    questions: bank.questions.map((item) => ({
      q: item.q,
      options: item.options,
      answer: item.answer ?? 0,
      level: item.level ?? 2,
      id: idFor(bank.id, item.q),
    })),
  };
}

/**
 * البنكُ كما يُكتب في القاعدة: نصٌّ وخياراتٌ ومستوى، بلا ما يُشتقّ.
 *
 * والصوابُ يُقدَّم إلى أوّل الخيارات ويُثبَّت موضعُه على الصفر — ولا يُكتفى
 * بتثبيت الرقم: ملفٌّ قديمٌ صوابُه في الموضع الثاني (وبنوكُ تمّوز كانت كذلك،
 * مواضعُها موزّعةٌ عشوائياً) كان يُكتب بخياراته كما هي وبرقمٍ يقول «الأول» —
 * فيصير الخطأُ صواباً في كل سؤال، صامتاً لا يظهر إلا في وجه لاعب. والخلطُ
 * يقع عند التوزيع لا في الملفّ، فتقديمُ الصواب لا يُفقد شيئاً.
 */
function bare(bank) {
  return {
    id: bank.id,
    name: bank.name,
    questions: bank.questions.map((item) => {
      const at = Number(item.answer) || 0;
      return {
        q: item.q,
        options: [item.options[at], ...item.options.filter((_, i) => i !== at)],
        answer: 0,
        level: item.level ?? 2,
      };
    }),
  };
}

/** يُثبّت بنكاً في الذاكرة بعد كتابته في القاعدة */
function remember(payload) {
  const bank = dress(payload);
  banks.set(bank.id, bank);
  return bank;
}

/** يُنظّف ما جاء من اللوحة: أرقامٌ عربية، والصوابُ أوّلاً، ومستوى صالح */
function clean(item) {
  return {
    q: arabizeDigits(String(item.q).trim()),
    options: item.options.map((option) => arabizeDigits(String(option).trim())),
    answer: 0,
    level: Number(item.level) || 2,
  };
}

function total(map) {
  return [...map.values()].reduce((n, b) => n + b.questions.length, 0);
}

/*
 * عند الاستيراد: تُقرأ الملفّات لتكون الوحدة صالحةً بلا قاعدة (الاختبارات
 * تستعملها كذلك). ثم يُنادي السيرفر initBanks فتُستبدل الذاكرةُ بما في
 * القاعدة — وهي المرجع.
 */
banks = fromFiles();
report(banks);

/**
 * تهيئةُ البنوك عند الإقلاع: من القاعدة، أو زرعاً من الملفّات إن كانت فارغة.
 *
 * وتُنادى قبل بعث الغرف: الغرفةُ المبعوثة تمرّ على normalizeBankIds فتقرأ
 * هذه الخريطة — فلو تأخّرت التهيئةُ عنها لرُدّت بنوكُ غرفةٍ قائمةٍ إلى أوّلها.
 */
export async function initBanks() {
  const store = await db();
  const rows = await store.allBankRows();
  if (rows.length === 0) {
    const files = fromFiles();
    if (files.size === 0) throw new Error('لا بنوك في القاعدة ولا في الملفّات');
    for (const bank of files.values()) await store.putBank(bare(bank));
    banks = files;
    console.log(`🌱 زُرعت ${banks.size} بنكاً من الملفّات — ${total(banks)} سؤالاً`);
  } else {
    banks = new Map(rows.map((row) => [row.id, dress(row)]));
    console.log(`📚 ${banks.size} بنكاً من القاعدة — ${total(banks)} سؤالاً`);
  }
  report(banks);
  return banks.size;
}

/**
 * استيرادُ ملفّات المستودع إلى القاعدة — الحلقةُ المقابلة لـpull-banks.
 *
 * فالقاعدةُ صارت المرجع، ومن أراد أن يُضيف مئةَ سؤالٍ في محرّرٍ ويرفعها إلى
 * git لم يبقَ له طريق. فهذا بابُه: «الناقصَ وحده» يُدخل بنكاً ليس في القاعدة
 * ولا يمسّ قائماً، و«استبدالاً» يُحلّ ملفَّ المستودع محلّ ما في القاعدة —
 * وهو يمحو تحريراً جرى من اللوحة، فلا يُضغط إلا بقصد.
 */
export async function importFiles({ replace = false } = {}) {
  const store = await db();
  const files = fromFiles();
  const done = [];
  for (const bank of files.values()) {
    const payload = bare(bank);
    const have = banks.get(bank.id);
    if (!have) {
      await store.putBank(payload);
      remember(payload);
      done.push({ id: bank.id, name: bank.name, action: 'added', count: payload.questions.length });
    } else if (!replace) {
      done.push({ id: bank.id, name: bank.name, action: 'kept', count: have.questions.length });
    } else if (JSON.stringify(bare(have)) === JSON.stringify(payload)) {
      done.push({ id: bank.id, name: bank.name, action: 'same', count: payload.questions.length });
    } else {
      await store.putBank(payload);
      remember(payload);
      done.push({
        id: bank.id,
        name: bank.name,
        action: 'replaced',
        from: have.questions.length,
        count: payload.questions.length,
      });
    }
  }
  report(banks);
  return done;
}

/** ينبّه على ما في البنوك من خلل عند كل قراءة — ولا يمنع الإقلاع */
function report(map) {
  const { errors, warnings, duplicates } = auditAll(map.values());
  if (errors || warnings || duplicates.length) {
    console.warn(`⚠ الفاحص: ${errors} خطأً · ${warnings} تنبيهاً · ${duplicates.length} مكرّراً`);
  }
}

/*
 * ولا مراقبَ للمجلّد بعد اليوم: كان تغيُّرُ الملفّ يُعيد قراءة البنوك، وذاك
 * صوابٌ حين كان الملفُّ هو المرجع. والمرجعُ الآن القاعدة، فإعادةُ القراءة
 * تمحو ما حُرِّر من اللوحة بملفٍّ قديم. ومن أراد الملفّات فبابُها importFiles.
 */

export function listBanks() {
  return [...banks.values()].map((b) => ({
    id: b.id,
    name: b.name,
    count: b.questions.length,
  }));
}

export function getBank(id) {
  return banks.get(id) ?? banks.values().next().value;
}

/** يبقي المعرّفات الصالحة فقط، ويرجع لأول بنك إن لم يبق شيء */
export function normalizeBankIds(ids) {
  const valid = [...new Set(Array.isArray(ids) ? ids : [ids])].filter((id) => banks.has(id));
  return valid.length ? valid : [banks.keys().next().value];
}

/** نسخةٌ حيّة من البنوك — للفحص والتحرير في لوحة المالك */
export function allBanks() {
  return [...banks.values()];
}

export function findQuestion(questionId) {
  for (const bank of banks.values()) {
    const question = bank.questions.find((q) => q.id === questionId);
    if (question) return { bank, question };
  }
  return null;
}

/*
 * ولا نسخَ احتياطيّ على القرص: كان يُحفظ عشرون نسخةً من الملفّ قبل كل كتابة،
 * وكانت تذهب مع الحاوية كما يذهب الملفّ. والتراجعُ اليوم في القاعدة: نسخةُ
 * كل سؤالٍ حُرِّر في جدول edits، والبنكُ المحذوف كاملاً في bank_trash.
 */

/*
 * أرقامُ السؤال عربية دائماً.
 *
 * بنك «نبضة» كلُّه بالأرقام العربية — ألفٌ وأربعةٌ وخمسون سؤالاً، لا
 * واحدَ فيها بالرقم اللاتينيّ. فلو دخل سؤالٌ بـ1445 بين إخوته ٧٨٦ لظهر
 * الفرقُ على الشاشة سطراً أعرجَ بخطّين مختلفين.
 *
 * ويُستثنى الرقمُ الملتصق بحرفٍ لاتينيّ: «MP3» رمزٌ لا عدد، وتعريبُ رقمه
 * يُفسده.
 */
const EASTERN = '٠١٢٣٤٥٦٧٨٩';

export function arabizeDigits(text) {
  return String(text).replace(/[0-9]+/g, (run, at, whole) => {
    const around = (whole[at - 1] ?? '') + (whole[at + run.length] ?? '');
    if (/[A-Za-z]/.test(around)) return run;
    return run.replace(/[0-9]/g, (d) => EASTERN[Number(d)]);
  });
}

/**
 * يكتب أسئلة البنك في القاعدة ويُثبّتها في الذاكرة فوراً.
 *
 * والمحرّرُ يريد الجواب في حينه: الكتابةُ في القاعدة ثم في الذاكرة، فالقراءةُ
 * التالية ترى الجديد بمعرّفه المشتقّ من نصّه بلا دورةِ إقلاع.
 */
export async function saveBank(bankId, questions) {
  const bank = banks.get(bankId);
  if (!bank) throw new Error('بنك غير معروف');
  const payload = { id: bank.id, name: bank.name, questions: questions.map(clean) };
  await (await db()).putBank(payload);
  const next = remember(payload);
  report(banks);
  return next;
}

/**
 * حذفُ بنكٍ كاملاً: ملفُّه يذهب من القرص بعد نسخةٍ احتياطية.
 *
 * ولا يُحذف آخرُ بنك: اللعبة بلا سؤالٍ لا تقوم، وnormalizeBankIds يرجع إلى
 * أول بنكٍ موجود — فإن لم يبقَ شيءٌ انكسر كلُّ شيء. والأرشفةُ في PostgreSQL
 * لا هنا: المجلّدُ يُبنى من جديد عند كل نشر، والقاعدة تبقى.
 */
export async function deleteBank(bankId) {
  const bank = banks.get(bankId);
  if (!bank) return null;
  if (banks.size <= 1) throw new Error('لا يُحذف آخر بنك');
  await (await db()).dropBank(bankId);
  banks.delete(bankId);
  report(banks);
  return bank;
}

/**
 * كتابةُ بنكٍ جديد — ولإرجاع محذوفٍ من السلّة.
 *
 * ويُرفض المعرّف المأخوذ: ملفٌّ يُكتب فوق ملفٍّ قائم يمحو بنكاً حيّاً بلا خبر.
 */
export async function writeBank({ id, name, questions }) {
  const slug = String(id)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!slug) throw new Error('معرّف البنك غير صالح');
  if (banks.has(slug)) throw new Error('المعرّف مأخوذ');

  const payload = {
    id: slug,
    name: String(name).trim().slice(0, 40) || slug,
    questions: (questions ?? []).map(clean),
  };
  await (await db()).putBank(payload);
  const bank = remember(payload);
  report(banks);
  return bank;
}

/** أسئلة كل البنوك المختارة مدموجة في مجموعة واحدة تُخلط لاحقاً */
export function poolFor(ids) {
  return normalizeBankIds(ids).flatMap((id) => banks.get(id).questions);
}
