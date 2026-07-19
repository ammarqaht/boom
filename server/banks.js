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

/** يبقي المعرّفات الصالحة فقط، ويرجع لأول بنك إن لم يبق شيء */
export function normalizeBankIds(ids) {
  const valid = [...new Set(Array.isArray(ids) ? ids : [ids])].filter((id) => banks.has(id));
  return valid.length ? valid : [banks.keys().next().value];
}

/** أسئلة كل البنوك المختارة مدموجة في مجموعة واحدة تُخلط لاحقاً */
export function poolFor(ids) {
  return normalizeBankIds(ids).flatMap((id) => banks.get(id).questions);
}
