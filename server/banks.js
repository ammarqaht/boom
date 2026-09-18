import { readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAll } from './audit.js';

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

function readAll() {
  const next = new Map();
  for (const file of readdirSync(banksDir).filter((f) => f.endsWith('.json'))) {
    try {
      const bank = JSON.parse(readFileSync(join(banksDir, file), 'utf8'));
      for (const question of bank.questions) {
        question.id = idFor(bank.id, question.q);
        question.level = question.level ?? 2;
      }
      next.set(bank.id, bank);
    } catch (err) {
      console.warn(`⚠ تعذّرت قراءة بنك ${file}: ${err.message}`);
    }
  }
  return next;
}

function total(map) {
  return [...map.values()].reduce((n, b) => n + b.questions.length, 0);
}

banks = readAll();
report(banks);

/** ينبّه على ما في البنوك من خلل عند كل قراءة — ولا يمنع الإقلاع */
function report(map) {
  const { errors, warnings, duplicates } = auditAll(map.values());
  if (errors || warnings || duplicates.length) {
    console.warn(`⚠ الفاحص: ${errors} خطأً · ${warnings} تنبيهاً · ${duplicates.length} مكرّراً`);
  }
}

/*
 * إعادة القراءة عند تغيّر الملفات: من يحرّر ألف سؤال لا يليق به أن يُعيد
 * تشغيل السيرفر بعد كل تصحيح. والتأخير يجمع الكتابات المتتابعة في قراءة
 * واحدة، فمحرّرات النصوص تكتب على دفعات. وإن خرج الملف تالفاً أثناء
 * الحفظ أُبقيت النسخة السابقة ولم تُفقد البنوك.
 */
let pending = null;
try {
  watch(banksDir, () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const next = readAll();
      if (next.size === 0) return console.warn('⚠ لم يُقرأ أي بنك — أُبقيت النسخة السابقة');
      banks = next;
      console.log(`↻ أُعيدت قراءة البنوك — ${total(banks)} سؤالاً`);
      report(banks);
    }, 300);
  });
} catch {
  // أنظمة لا تدعم مراقبة المجلدات: تبقى القراءة عند الإقلاع وحدها
}

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

/**
 * كتابة بنكٍ إلى القرص، ونسخةٌ احتياطية قبلها.
 *
 * التحرير بلا تراجعٍ مخاطرة: من حذف سؤالاً بالخطأ لا يملك إلا أن يكتبه من
 * جديد. فتُحفظ النسخة السابقة قبل كل كتابة، ويُبقى منها عشرون — أكثر من
 * ذلك تملأ المجلد بلا فائدة، فمن أراد أقدمَ منها فله git.
 */
const BACKUPS = 20;
const backupDir = join(banksDir, '.backup');

function backup(file) {
  try {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(backupDir, `${file}-${stamp}`), readFileSync(join(banksDir, file)));

    const mine = readdirSync(backupDir)
      .filter((name) => name.startsWith(`${file}-`))
      .sort();
    for (const stale of mine.slice(0, Math.max(0, mine.length - BACKUPS))) {
      unlinkSync(join(backupDir, stale));
    }
  } catch (err) {
    console.warn(`⚠ تعذّرت النسخة الاحتياطية لـ${file}: ${err.message}`);
  }
}

/**
 * يكتب البنك ويعيد قراءته فوراً.
 *
 * ولا ننتظر fs.watch: هو يعمل بتأخير، والمحرّر يريد الجواب في حينه. وإعادةُ
 * القراءة هنا تُعطي السؤالَ الجديد معرّفه المشتقّ من نصّه.
 */
export function saveBank(bankId, questions) {
  const bank = banks.get(bankId);
  if (!bank) throw new Error('بنك غير معروف');
  const file = `${bankId}.json`;
  backup(file);

  const payload = {
    id: bank.id,
    name: bank.name,
    questions: questions.map((q) => ({
      q: String(q.q).trim(),
      options: q.options.map((option) => String(option).trim()),
      answer: 0, // الصواب أوّل الخيارات دائماً
      level: Number(q.level) || 2,
    })),
  };
  writeFileSync(join(banksDir, file), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  banks = readAll();
  report(banks);
  return banks.get(bankId);
}

/** أسئلة كل البنوك المختارة مدموجة في مجموعة واحدة تُخلط لاحقاً */
export function poolFor(ids) {
  return normalizeBankIds(ids).flatMap((id) => banks.get(id).questions);
}
