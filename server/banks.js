import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const banksDir = join(dirname(fileURLToPath(import.meta.url)), 'banks');

/** @type {Map<string, {id: string, name: string, questions: {q: string, options: string[], answer: number}[]}>} */
const banks = new Map();

for (const file of readdirSync(banksDir).filter((f) => f.endsWith('.json'))) {
  const bank = JSON.parse(readFileSync(join(banksDir, file), 'utf8'));
  bank.questions.forEach((question, i) => {
    question.id = `${bank.id}:${i}`;
  });
  banks.set(bank.id, bank);
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

/** يبقي المعرّفات الصالحة فقط دون فرض بنك افتراضي (قد يعيد مصفوفة فارغة) */
export function validBankIds(ids) {
  return [...new Set(Array.isArray(ids) ? ids : [ids])].filter((id) => banks.has(id));
}

/** يبقي المعرّفات الصالحة فقط، ويرجع لأول بنك إن لم يبق شيء */
export function normalizeBankIds(ids) {
  const valid = validBankIds(ids);
  return valid.length ? valid : [banks.keys().next().value];
}

/** أسئلة البنوك المختارة دون فرض بنك افتراضي — للدمج مع بنك مخصص */
export function questionsFor(ids) {
  return validBankIds(ids).flatMap((id) => banks.get(id).questions);
}

/** أسئلة كل البنوك المختارة مدموجة في مجموعة واحدة تُخلط لاحقاً */
export function poolFor(ids) {
  return normalizeBankIds(ids).flatMap((id) => banks.get(id).questions);
}

/**
 * يُنقّي أسئلة مخصصة قادمة من الواجهة — لا نثق بما يصل من المتصفح.
 * يشترط نصّ سؤال، من خيارين إلى أربعة، وإجابة ضمن المدى.
 */
export function sanitizeQuestions(raw, max = 300) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item.q !== 'string') continue;
    const q = item.q.trim().slice(0, 300);
    const options = Array.isArray(item.options)
      ? item.options.map((o) => String(o ?? '').trim().slice(0, 140)).filter(Boolean)
      : [];
    const answer = Number(item.answer);
    if (!q || options.length < 2 || options.length > 4) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;
    out.push({ q, options, answer });
    if (out.length >= max) break;
  }
  return out;
}
