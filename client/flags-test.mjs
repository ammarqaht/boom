/*
 * اختبار أسئلة الأعلام — بلا سيرفر: القارئ، والرمز، والمعرّف، والتكرار.
 */
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');
const { parseIntake } = await import(pathToFileURL(join(server, 'intake.js')).href);
const { flagCode, questionKey } = await import(pathToFileURL(join(server, 'banks.js')).href);
const { auditAll } = await import(pathToFileURL(join(server, 'audit.js')).href);

let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed++;
};

const text = [
  '"السؤال","الإجابة الصحيحة","خطأ ١","خطأ ٢","خطأ ٣","المستوى","العلم"',
  '"علمُ أيّ دولةٍ هذا؟","اليابان","الصين","كوريا الجنوبية","بنغلاديش","سهل","JP"',
  '"علمُ أيّ دولةٍ هذا؟","قطر","البحرين","الإمارات","عُمان","متوسط","qa"',
  '"علمُ أيّ دولةٍ هذا؟","البرازيل","البرتغال","الأرجنتين","كولومبيا","سهل","xx"',
  '"ما عاصمة فنلندا؟","هلسنكي","تامبيري","توركو","أولو","متوسط"',
].join('\n');
const { rows } = parseIntake(text);
check(rows.length === 4, 'القارئ يقرأ العمود السابع ويتجاوز الترويسة');
check(rows[0].flag === 'jp' && rows[1].flag === 'qa', 'رمز العلم يُقرأ بحروفٍ صغيرة');
check(rows[2].flag === null, 'رمزٌ لا علمَ له (xx) لا يُقبل علماً');
check(rows[3].flag === null, 'سؤالٌ بلا عمود علمٍ يبقى بلا علم');

check(flagCode('sa') === 'sa' && flagCode('SAU') === null && flagCode('') === null, 'flagCode: حرفان لهما صورة فقط');
check(questionKey('علمُ أيّ دولةٍ هذا؟', 'jp') !== questionKey('علمُ أيّ دولةٍ هذا؟', 'qa'), 'النصُّ الواحد بعلمين: سؤالان لا مكرّر');
check(questionKey('ما عاصمة فنلندا؟') === questionKey('ما عاصمةُ فنلندا'), 'وما لا علمَ له يُقارن بنصّه كما كان');

const report = auditAll([
  {
    id: 'demo',
    questions: [
      { id: 'a', q: 'علمُ أيّ دولةٍ هذا؟', options: ['اليابان', 'الصين', 'كوريا', 'بنغلاديش'], answer: 0, level: 1, flag: 'jp' },
      { id: 'b', q: 'علمُ أيّ دولةٍ هذا؟', options: ['قطر', 'البحرين', 'الإمارات', 'عُمان'], answer: 0, level: 2, flag: 'qa' },
    ],
  },
]);
check(report.duplicates.length === 0, 'فاحصُ البنوك لا يعدّ أسئلة الأعلام مكرّرة');

console.log(failed ? `\n❌ فشل ${failed}` : '\n✅ اختبار الأعلام كله نجح');
process.exit(failed ? 1 : 0);
