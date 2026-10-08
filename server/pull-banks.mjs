/*
 * يسحب البنوك من الموقع الحيّ إلى ملفّات المستودع.
 *
 * ولماذا؟ نصُّ البنوك في PostgreSQL وهو المرجع، والملفّاتُ بذرةٌ ونسخةُ
 * احتياط. فهذا يُنزل ما في القاعدة إلى الملفّات: نصٌّ مقروءٌ في git يُراجَع
 * ويُقارَن.
 *
 * ولا بابَ عكسيّ له في اللوحة: استيرادُ البنوك من الملفّات رُفع، والبنكُ
 * يُنشأ اليوم باسمه ومعرّفه في «إدارة البنوك» ثم تُستورد أسئلتُه لصقاً أو
 * ملفَّ CSV في «الأسئلة المعلّقة». فما يُسحب هنا نسخةُ قراءةٍ في git، وزرعُ
 * قاعدةٍ فارغة أولَ مرّة.
 *
 *   NABDA_URL=https://… NABDA_OWNER_KEY=… node server/pull-banks.mjs --dry
 *   NABDA_URL=https://… NABDA_OWNER_KEY=… node server/pull-banks.mjs
 *
 * --dry            يُخبر ولا يكتب
 * --delete-missing يحذف ملفَّ بنكٍ لم يبقَ في الموقع (بنكٌ حذفتَه هناك)
 * --minus-archive  يُسقط ما يشهد الأرشيف أنك حذفته ثم رجع
 *
 * وأمّا --minus-archive فلحالةٍ بعينها: حذفتَ أسئلةً من اللوحة، ثم محا نشرٌ
 * حذفَك فرجعت (وذاك ما كان يحدث قبل نقل البنوك إلى القاعدة). فسجلُّ التحرير
 * في PostgreSQL نجا ونجت معه شهادةُ كل حذفٍ ثلاثين يوماً — فتُقرأ ويُسقط ما
 * تشهد به، فتعود الملفّاتُ إلى ما كانت عليه بعد تحريرك لا قبله.
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const banksDir = join(dirname(fileURLToPath(import.meta.url)), 'banks');
const url = (process.env.NABDA_URL || 'http://localhost:3000').replace(/\/+$/, '');
const key = process.env.NABDA_OWNER_KEY;
const dry = process.argv.includes('--dry');
const deleteMissing = process.argv.includes('--delete-missing');
const minusArchive = process.argv.includes('--minus-archive');

if (!key) {
  console.error('✖ اضبط NABDA_OWNER_KEY — وهو مفتاح لوحة المالك نفسه');
  process.exit(1);
}

/* الترويسة لا تحمل إلا bytes لاتينية، والمفتاح قد يكون عربياً — فيُرمَّز كما يتوقّعه السيرفر */
const res = await fetch(`${url}/api/console/bank/all`, {
  headers: { 'x-nabda-key': encodeURIComponent(key) },
});
if (!res.ok) {
  console.error(`✖ ردّ الموقع ${res.status} — تأكّد من الرابط والمفتاح`);
  process.exit(1);
}
const live = await res.json();
if (!Array.isArray(live.questions) || live.questions.length === 0) {
  console.error('✖ لم يرجع سؤالٌ واحد — أُوقف قبل أن أكتب ملفّاتٍ فارغة');
  process.exit(1);
}

/*
 * شهادةُ الأرشيف: معرّفاتُ ما حُذف من اللوحة ولم يُرجَع صراحةً.
 *
 * ومعرّفُ السؤال بصمةُ نصّه، فالسؤالُ الذي رجع بنشرٍ رجع بمعرّفه نفسه —
 * فالمطابقةُ به تصيب ما حُذف بعينه.
 */
const dropped = new Set();
if (minusArchive) {
  const archive = await fetch(`${url}/api/console/edits`, {
    headers: { 'x-nabda-key': encodeURIComponent(key) },
  });
  if (!archive.ok) {
    console.error(`✖ تعذّر قراءة الأرشيف: ${archive.status}`);
    process.exit(1);
  }
  const rows = await archive.json();
  for (const row of rows) if (row.kind === 'delete') dropped.add(row.oldId);
  console.log(`🗃 الأرشيف يشهد بحذف ${dropped.size} سؤالاً\n`);
}

/* تجميعُ الأسئلة ببنوكها، بالترتيب الذي جاءت به */
const grouped = new Map();
const skipped = [];
for (const item of live.questions) {
  if (dropped.has(item.id)) {
    skipped.push(item);
    continue;
  }
  if (!grouped.has(item.bank)) {
    grouped.set(item.bank, { id: item.bank, name: item.bankName, questions: [] });
  }
  /*
   * الصوابُ أوّلَ الخيارات دائماً كما يكتبه saveBank: الخلطُ يقع عند التوزيع
   * لا في الملفّ، وثباتُ الموضع على الصفر يُسقط خطأً صامتاً — أن يُعاد ترتيب
   * الخيارات يدوياً ويبقى المؤشّر على ما كان.
   */
  const right = item.options[item.answer ?? 0];
  const rest = item.options.filter((_, i) => i !== (item.answer ?? 0));
  grouped.get(item.bank).questions.push({
    q: item.q,
    options: [right, ...rest],
    answer: 0,
    level: Number(item.level) || 2,
  });
}

const onDisk = new Map();
for (const file of readdirSync(banksDir).filter((f) => f.endsWith('.json'))) {
  try {
    const bank = JSON.parse(readFileSync(join(banksDir, file), 'utf8'));
    onDisk.set(bank.id, { file, count: bank.questions.length });
  } catch {
    console.warn(`⚠ ملفٌّ لا يُقرأ: ${file}`);
  }
}

console.log(`${dry ? '🔎 فحصٌ بلا كتابة' : '⇣ سحبٌ'} من ${url}\n`);
if (skipped.length) {
  console.log(`أُسقط ${skipped.length} سؤالاً بشهادة الأرشيف، منها:`);
  for (const item of skipped.slice(0, 5)) console.log(`   • ${item.bank}: ${item.q.slice(0, 48)}`);
  if (skipped.length > 5) console.log(`   … و${skipped.length - 5} غيرها`);
  console.log('');
}

let changed = 0;
for (const bank of grouped.values()) {
  const body = JSON.stringify(bank, null, 2) + '\n';
  const path = join(banksDir, `${bank.id}.json`);
  const before = onDisk.get(bank.id);
  const same = before && readFileSync(path, 'utf8') === body;

  const mark = !before ? 'جديد' : same ? 'كما هو' : `${before.count} ← ${bank.questions.length}`;
  console.log(
    `  ${same ? '·' : '✎'} ${bank.id.padEnd(12)} ${String(bank.questions.length).padStart(5)} سؤالاً   ${mark}`,
  );
  if (same) continue;
  changed++;
  if (!dry) writeFileSync(path, body, 'utf8');
}

/* بنكٌ في المستودع ولا أثرَ له في الموقع: حُذف هناك */
for (const [id, info] of onDisk) {
  if (grouped.has(id)) continue;
  changed++;
  if (deleteMissing && !dry) {
    unlinkSync(join(banksDir, info.file));
    console.log(`  ✖ ${id.padEnd(12)} حُذف من الموقع — ومُحي ملفُّه`);
  } else {
    console.log(`  ! ${id.padEnd(12)} حُذف من الموقع — وملفُّه باقٍ (مرّر --delete-missing)`);
  }
}

console.log(
  changed === 0
    ? '\n✅ المستودع مطابقٌ للموقع — لا شيء يضيع بالنشر'
    : dry
      ? `\n${changed} بنكاً يختلف — أعِد التشغيل بلا --dry ليُكتب`
      : `\n✅ كُتب ${changed} بنكاً — راجعها بـgit diff ثم التزمها قبل النشر`,
);
