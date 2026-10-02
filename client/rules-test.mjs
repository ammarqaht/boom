// اختبار قاعدتين تُصانان بالفحص لا بالانتباه: ترتيب البنوك، وسقف نقاط المركز
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const serverDir = join(process.cwd(), '..', 'server');
const { createRoom, DIFFICULTY } = await import(pathToFileURL(join(serverDir, 'game.js')).href);

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

// ══ البنوك: الصواب أوّلاً دائماً ═══════════════════════════════
// الخلط يقع عند التوزيع لا في الملف، فموضع الصواب المحفوظ لا يراه لاعب.
// وثباتُه على الصفر يُسقط فرصة أن يُعاد ترتيب الخيارات يدوياً فيبقى
// المؤشّر على ما كان — وهو خطأٌ صامت لا يظهر إلا في وجه لاعب.
const banksDir = join(serverDir, 'banks');
const banks = readdirSync(banksDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(banksDir, f), 'utf8')));

const all = banks.flatMap((b) => b.questions.map((q) => ({ ...q, bank: b.id })));
console.log(`   ${banks.length} بنكاً · ${all.length} سؤالاً`);

/*
 * الفحص بقواعد server/audit.js نفسها التي تعمل في لوحة المالك وعند كل
 * إعادة قراءة — قاعدةٌ واحدة لا نسخةٌ ثانية هنا تتخلّف عن أختها.
 */
const { auditAll } = await import(pathToFileURL(join(serverDir, 'audit.js')).href);
const audit = auditAll(banks);
const errors = audit.issues.filter((row) => row.issues.some((i) => i.severity === 'error'));
const warnings = audit.issues.filter((row) => row.issues.every((i) => i.severity === 'warn'));

check('لا خطأ يكسر سؤالاً في أيّ بنك', errors.length === 0);
if (errors.length) {
  for (const row of errors.slice(0, 3)) {
    console.log(
      '   ✖',
      row.bank,
      row.issues.map((i) => i.message).join(' · '),
      '→',
      row.q.slice(0, 40),
    );
  }
}
check('ولا ملقّن يدلّ على الصواب', warnings.length === 0);
if (warnings.length) {
  for (const row of warnings.slice(0, 5)) {
    console.log('   ⚠', row.issues[0].message, '→', row.q.slice(0, 44));
  }
}
check('لا سؤال مكرّر بين البنوك', audit.duplicates.length === 0);
if (audit.duplicates.length) {
  for (const d of audit.duplicates.slice(0, 3))
    console.log('   ', d.banks.join('/'), d.q.slice(0, 44));
}

// ══ المستويات ═════════════════════════════════════════════════
check('أربعة مستويات: ابتدائي ومتوسط وثانوي وجامعي', Object.keys(DIFFICULTY).length === 4);
check(
  'كل خلطة مجموعها مئة',
  Object.values(DIFFICULTY).every((d) => d.mix.reduce((a, b) => a + b, 0) === 100),
);

const mix = (key) => DIFFICULTY[key].mix;
check(
  'الابتدائي: أكثره سهل وشيءٌ من المتوسط ولا صعب',
  mix('primary')[0] > 50 && mix('primary')[2] === 0,
);
check(
  'المتوسط: يجمع السهل والمتوسط وقليلاً من الصعب',
  mix('middle')[0] + mix('middle')[1] >= 85 && mix('middle')[2] > 0 && mix('middle')[2] <= 15,
);
check(
  'الثانوي: أغلبه متوسط وفيه من السهل والصعب',
  mix('secondary')[1] >= 50 && mix('secondary')[0] > 0 && mix('secondary')[2] > 0,
);
check(
  'الجامعي: بين المتوسط والصعب وفيه سهلٌ قليل',
  mix('university')[1] + mix('university')[2] >= 85 &&
    mix('university')[0] > 0 &&
    mix('university')[0] <= 15,
);

/*
 * السلّم يرتفع درجةً درجة: مركزُ ثقل الخلطة (متوسّطُ الطبقة الموزون) يزيد
 * عند كل مرحلة. فلو بُدّلت نسبةٌ سهواً فجاءت مرحلةٌ أصعبَ من تاليتها كُشف
 * ذلك هنا، لا في قاعةٍ أمام ابتدائيّين.
 */
const weight = (key) => mix(key).reduce((sum, pct, i) => sum + pct * (i + 1), 0) / 100;
const ladderOfLevels = ['primary', 'middle', 'secondary', 'university'].map(weight);
console.log('   مركز ثقل المراحل:', ladderOfLevels.map((w) => w.toFixed(2)).join(' < '));
check(
  'المراحل ترتفع صعوبةً بالترتيب',
  ladderOfLevels.every((w, i) => i === 0 || w > ladderOfLevels[i - 1]),
);

// ══ سقف نقاط المركز ═══════════════════════════════════════════
/** يُجري جولةً على n فريقاً، آخرهم يتوقّف نبضه، ويُرجع نقاط المركز بالترتيب */
function ladder(n) {
  const room = createRoom(['quran']);
  const teams = Array.from({ length: n }, (_, i) => room.addTeam(`فريق ${i + 1}`));
  room.start();
  const now = room.countdownEndsAt;
  room.tick(now);
  // أوقاتٌ متباعدة تُثبّت الترتيب، وآخرهم يسقط
  teams.forEach((t, i) => (t.timeMs = (n - i) * 1000));
  teams[n - 1].timeMs = 0;
  room.tick(now + 100);
  return room.result.awards.map((a) => a.points); // لا إجابات، فالنقاط هي نقاط المركز
}

console.log('   السلالم:', [2, 4, 6, 7, 20].map((n) => `${n}→${ladder(n).join('-')}`).join('  '));
check(
  'عشرون فريقاً: 5-4-3-2-1…-1-0',
  ladder(20).join('-') === '5-4-3-2-1-1-1-1-1-1-1-1-1-1-1-1-1-1-1-0',
);
check('سبعة فرق: 5-4-3-2-1-1-0', ladder(7).join('-') === '5-4-3-2-1-1-0');
check('ستّة فرق تبلغ السقف تماماً', ladder(6).join('-') === '5-4-3-2-1-0');
check('أقلّ من ستّة: الأول يأخذ عددهم ناقص واحد', ladder(4)[0] === 3 && ladder(2)[0] === 1);
check('من توقّف نبضه لا يأخذ نقطة مركز', ladder(20).at(-1) === 0);

// ══ قواعد الجولة ══════════════════════════════════════════════
/** يُهيّئ غرفةً بفرقٍ مسمّاة، ويُرجعها مع فرقها */
function room3() {
  const room = createRoom(['quran']);
  const teams = ['أ', 'ب', 'ج'].map((n) => room.addTeam(n));
  return { room, teams };
}

/* ① من نفد وقته في النبضة نفسها يسكن نبضُه — ولو كان الثاني */
{
  const {
    room,
    teams: [a, b, c],
  } = room3();
  room.start();
  const now = room.countdownEndsAt;
  room.tick(now);
  a.timeMs = 40;
  b.timeMs = 40; // كلاهما ينفد في نبضةٍ واحدة
  c.timeMs = 30000;
  room.tick(now + 100);
  const award = (t) => room.result.awards.find((x) => x.teamId === t.id);
  check('نَفادان في نبضةٍ واحدة: كلاهما توقّف', a.flatlined && b.flatlined);
  check('ولا نقطةَ مركزٍ لمن وقته صفر', award(a).points === 0 && award(b).points === 0);
  check('والجولة تُحتسب مرّةً واحدة', room.history.length === 1 && room.playedRounds === 1);
}

/* ② لا يُبتدأ على جولةٍ قائمة */
{
  const {
    room,
    teams: [a],
  } = room3();
  room.start();
  room.tick(room.countdownEndsAt);
  room.answer(a.id, a.current.id, a.current.answer);
  const correct = a.correct;
  check('البدء مرفوضٌ أثناء الجريان', room.start() === false);
  check('ولم تُمسح إجابات الجولة', a.correct === correct);
  room.pause();
  check('ومرفوضٌ وهي موقوفة — بابُها الإعادة', room.start() === false);
}

/* ③ إعادة الجولة: من الإيقاف وحده، بلا رقمٍ جديد ولا سجلّ، وتردّ البطاقات */
{
  const {
    room,
    teams: [a, b],
  } = room3();
  room.start();
  let now = room.countdownEndsAt;
  room.tick(now);
  b.timeMs = 0;
  room.tick(now + 100); // انتهت الجولة الأولى
  a.score = 40;
  room.buyCard(a.id, 'time'); // وقتٌ إضافي للجولة الثانية
  room.start(); // الجولة الثانية
  const base = room.settings.startSeconds * 1000;
  const withCard = a.timeMs;
  check('بطاقةُ الوقت طُبّقت عند البدء', withCard > base);
  now = room.countdownEndsAt;
  room.tick(now);
  room.answer(a.id, a.current.id, a.current.answer);
  const round = room.round;
  const historyBefore = room.history.length;

  check('الإعادة مرفوضةٌ والجولة تجري', room.restartRound() === false);
  room.pause();
  check('الإعادة تُقبل والجولة موقوفة', room.restartRound() === true);
  check('رقم الجولة لم يتقدّم', room.round === round);
  check('ولم يُكتب لها سطرٌ في السجلّ', room.history.length === historyBefore);
  check('العدّادات عادت إلى أولها', a.timeMs === withCard && a.correct === 0);
  check('وبطاقةُ الوقت رُدّت في الإعادة', a.timeMs > base);
  check('والحال استعدادٌ من جديد', room.status === 'countdown');
}

/* ④ من دخل والجولة جارية ينتظر القادمة */
{
  const {
    room,
    teams: [a],
  } = room3();
  room.start();
  let now = room.countdownEndsAt;
  room.tick(now);
  const late = room.addTeam('متأخر');
  check('الداخل أثناء الجولة منتظِر', late.waiting === true);
  check('ولا سؤال عنده', late.current === null);
  const timeBefore = late.timeMs;
  now += 5000;
  room.tick(now);
  check('وعدّاده لا ينزل', late.timeMs === timeBefore);
  a.timeMs = 0;
  room.tick(now + 100);
  check('ولا جائزةَ له في جولةٍ لم يلعبها', !room.result.awards.find((x) => x.teamId === late.id));
  check('ولا يُعدّ في مراكز غيره', room.result.awards.length === 3);
  room.start();
  check('وتزول صفةُ الانتظار ببدء التالية', late.waiting === false && !!late.current);
}

/* ⑤ سجلّ الجولات يعرض الحاضرين وحدهم */
{
  const {
    room,
    teams: [a, b, c],
  } = room3();
  room.start();
  const now = room.countdownEndsAt;
  room.tick(now);
  c.timeMs = 0;
  room.tick(now + 100);
  check('السجلّ قبل الإزالة ثلاثة', room.publicState().history[0].awards.length === 3);
  room.removeTeam(b.id);
  const after = room.publicState();
  check('وبعدها اثنان — بلا من خرج', after.history[0].awards.length === 2);
  check('ولا يظهر اسمُ من خرج', !after.history[0].awards.some((x) => x.name === 'ب'));
  check('وآخرُ جولةٍ تُصفّى كذلك', after.result.awards.length === 2);
  check('والسجلّ في الذاكرة لم يُمحَ', room.history[0].awards.length === 3);
  void a;
}

process.exit(0);
