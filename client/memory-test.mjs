// اختبار الذاكرة: تُكتب الغرفة على القرص، وتُبعث كما كانت — موقوفة
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import pg from 'pg';

/*
 * قاعدةٌ للاختبار وحده، تُمسح قبل كل تشغيل.
 *
 * والمسح بالمخطّط كلّه لا بالجداول واحداً واحداً: الجدول الذي يُضاف غداً
 * ينسى أحدٌ إدراجه في قائمة التفريغ، فتتسرّب صفوفُ تشغيلٍ إلى تشغيل
 * ويمرّ اختبارٌ كان يجب أن يسقط. وstore.js يعيد بناء ما يحتاجه عند استيراده.
 *
 * وحارسٌ على الاسم: DATABASE_URL في الطرفية قد يكون قاعدة الإنتاج، وأمرٌ
 * واحدٌ هنا يمحوها كلها. فلا نمسح إلا ما في اسمه «test».
 */
const DB_URL = process.env.NABDA_TEST_DB || 'postgres://localhost/nabda_test';
if (!/test/i.test(new URL(DB_URL).pathname)) {
  console.error('❌ قاعدة الاختبار يجب أن يحوي اسمُها «test» — رُفض المسح');
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

const admin = new pg.Pool({ connectionString: DB_URL });
await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await admin.end();

const serverDir = join(process.cwd(), '..', 'server');
const game = await import(pathToFileURL(join(serverDir, 'game.js')).href);
const store = await import(pathToFileURL(join(serverDir, 'store.js')).href);
const { createRoom, restoreRoom, getRoom, IDLE_ROOM_MS } = game;

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

// ══ جولةٌ تُلعب حتى منتصفها ═══════════════════════════════════
const room = createRoom(['quran', 'hadith'], {}, 'secondary', 'نادي الفجر');
check('اسم الغرفة محفوظ', room.name === 'نادي الفجر');
check('الغرفة تبدأ متّسخة فتُكتب أول مرة', room.dirty === true);

const nour = room.addTeam('النسور');
const saqr = room.addTeam('الصقور');
room.start();
room.tick(room.countdownEndsAt);

// النسور يجيب ثلاثاً، والصقور يشتري بطاقة لاحقاً
for (let i = 0; i < 3; i++) {
  const q = nour.current;
  room.answer(nour.id, q.id, q.answer); // صحيحة
}
nour.timeMs = 18000;
saqr.timeMs = 11000;
/* دخل والجولة جارية: انتظارُه وما طُبّق على غيره عند البدء يجب أن يعبرا القرص */
const late = room.addTeam('المتأخرون');

const before = {
  code: room.code,
  adminKey: room.adminKey,
  round: room.round,
  served: room.served.size,
  nourSeen: nour.seen.size,
  nourCorrect: nour.correct,
  nourReview: nour.review.length,
  nourCurrent: nour.current.id,
  nourToken: nour.token,
  saqrTime: saqr.timeMs,
};
check('عُرضت أسئلةٌ وسُجّلت على مستوى الغرفة', before.served > 0);

// ══ الكتابة ═══════════════════════════════════════════════════
await store.saveRoom(room);
const listed = await store.listRooms();
check('الغرفة دخلت السجلّ', listed.length === 1 && listed[0].code === before.code);
check(
  'السجلّ يحمل الاسم والمستوى',
  listed[0].name === 'نادي الفجر' && listed[0].difficulty === 'secondary',
);
check(
  'السجلّ يحمل عدد اللاعبين والأسئلة المتمايزة',
  listed[0].players === 3 && listed[0].questions === before.served,
);

// ══ سقوط السيرفر: تُمحى الذاكرة ═══════════════════════════════
game.sweepIdleRooms(Date.now() + IDLE_ROOM_MS + 1);
check('ذهبت الغرفة من الذاكرة', getRoom(before.code) === undefined);

// ══ البعث ═════════════════════════════════════════════════════
const snaps = await store.loadSnapshots(IDLE_ROOM_MS);
check('اللقطة على القرص', snaps.length === 1);
const back = restoreRoom(snaps[0]);

check('الرمز نفسه — الروابط عند الناس ما زالت تعمل', back.code === before.code);
check('مفتاح المنظّم نفسه', back.adminKey === before.adminKey);
check('الاسم عاد', back.name === 'نادي الفجر');
check('رقم الجولة عاد', back.round === before.round);
check('الجولة عادت موقوفة لا جارية', back.status === 'paused');
check('لا عدّ تنازلي معلّق', back.countdownEndsAt === null);
check('المبعوثة التي قُلبت إلى موقوفة تُكتب مرّةً لتصدق حالتها', back.dirty === true);
// وغرفةٌ لم تتغيّر حالتها تعود نظيفة فلا تُكتب بلا سبب
const calm = restoreRoom({ ...snaps[0], code: 'CALM', status: 'ended' });
check('المبعوثة التي لم تتغيّر حالتها لا تُكتب', calm.dirty === false);
check(
  'وسجلّ أسئلتها يحمل النصوص لا المعرّفات وحدها',
  [...calm.served.values()].every((r) => typeof r.q === 'string'),
);

const n2 = [...back.teams.values()].find((t) => t.name === 'النسور');
const s2 = [...back.teams.values()].find((t) => t.name === 'الصقور');
check('الفريقان عادا', Boolean(n2 && s2));
check('رمز الفريق السرّي عاد — team:rejoin سيعمل', n2.token === before.nourToken);
check('النقاط الصحيحة عادت', n2.correct === before.nourCorrect);
check('سجلّ ما رآه عاد', n2.seen.size === before.nourSeen);
check('المراجعة عادت', n2.review.length === before.nourReview);
check('السؤال المعروض عاد بعينه', n2.current.id === before.nourCurrent);
check('الوقت عاد', s2.timeMs === before.saqrTime);
const l2 = [...back.teams.values()].find((t) => t.name === 'المتأخرون');
check('والمنتظِر عاد منتظِراً — لا يدخل جولةً نصفُها مضى', l2?.waiting === true);
check('وما طُبّق عند بدء الجولة عاد معه — فالإعادة تردّ البطاقات', n2.roundEntry !== null);
void late;
check('عُدّ ما عرضته الغرفة عاد', back.served.size === before.served);
check('الفريق يعود غير متصل حتى يفتح جهازه', n2.connected === false);

// ══ الطابور يُبنى عند الحاجة لا يُحفظ ═════════════════════════
check('الطابور فارغ بعد البعث', n2.queue.length === 0);
back.status = 'running';
back.lastTickAt = Date.now();
const fresh = back.nextQuestion(n2);
check('السؤال التالي يأتي رغم أن الطابور لم يُحفظ', Boolean(fresh && fresh.id));
check('ولا يُعيد سؤالاً رآه الفريق', !before.nourCurrent || fresh.id !== before.nourCurrent);

// ══ إحصاء الأسئلة ═════════════════════════════════════════════
// جولةٌ جديدة: إجاباتٌ صحيحة وخاطئة على أسئلةٍ معلومة، ثم نقيس
back.status = 'ended';
back.start();
back.tick(back.countdownEndsAt);
const player = [...back.teams.values()][0];

const scored = [];
for (let i = 0; i < 6; i++) {
  const q = player.current;
  const right = i % 2 === 0; // ثلاثٌ صحيحة وثلاثٌ خاطئة بالتناوب
  scored.push({ id: q.id, right });
  back.answer(player.id, q.id, right ? q.answer : (q.answer + 1) % 4);
}

const drained = back.drainStats();
check('الفروق تتجمّع ثم تُسلَّم دفعةً واحدة', drained.length > 0);
check('التسليم يُفرغ ما سُلّم فلا يُحسب مرتين', back.drainStats().length === 0);
check(
  'كل فرقٍ يحمل بنكه ومستواه ونصّه',
  drained.every((d) => d.bank && d.level >= 1 && d.level <= 3 && d.text.length > 0),
);

await store.recordStats(drained);
const health = await store.questionHealth({ minShown: 1, limit: 500 });
const byId = new Map(health.map((h) => [h.id, h]));
check(
  'كل سؤالٍ أُجيب عنه دخل جدول الصحّة',
  scored.every((x) => byId.has(x.id)),
);
check(
  'الصواب يُحسب صواباً والخطأ خطأً',
  scored.every((x) => (byId.get(x.id).correct === 1) === x.right),
);
check(
  'نسبة الصواب تُحسب: صفر أو مئة هنا',
  scored.every((x) => byId.get(x.id).rate === (x.right ? 100 : 0)),
);
check('الأضعف صواباً يتصدّر القائمة', health[0].rate <= health.at(-1).rate);

// الفروق تُجمع لا تُستبدل: نُعيد صرف الفرق نفسه فيتضاعف العدّ
const one = scored[0];
await store.recordStats([
  { id: one.id, bank: 'x', level: 2, text: '', shown: 1, correct: 1, wrong: 0 },
]);
const after = (await store.questionHealth({ minShown: 1, limit: 500 })).find(
  (h) => h.id === one.id,
);
check('الفروق تُجمع على ما في القرص لا تُستبدل به', after.correct === 2);
check('النصّ الفارغ لا يمحو النصّ المحفوظ', after.text.length > 0);

check(
  'حدّ العرض الأدنى يُخفي ما لا يدلّ',
  (await store.questionHealth({ minShown: 99 })).length === 0,
);

// ══ سجلّ أسئلة المنظّم ════════════════════════════════════════
const sheet = back.feedState();
check('السجلّ يعرض ما عُرض في الغرفة', sheet.length > 0);
check(
  'كل سطرٍ يحمل خياراته وموضع صوابه',
  sheet.every((r) => r.options.length === 4 && r.answer >= 0 && r.answer < 4),
);
check('الصفّ سؤالٌ متمايز لا إجابةُ فريق', new Set(sheet.map((r) => r.id)).size === sheet.length);
check(
  'الأحدث عرضاً يتصدّر',
  sheet.length < 2 || back.served.get(sheet[0].id).at >= back.served.get(sheet[1].id).at,
);

const tallied = sheet.find((r) => r.right + r.wrong > 0);
check('العدّ يطابق ما جرى', Boolean(tallied) && tallied.shown >= tallied.right + tallied.wrong);

// ولا يتسرّب موضع الصواب إلى قناة اللاعبين ولا إلى شاشة القاعة
const pub = JSON.stringify(back.publicState());
check('الحالة العامة لا تحمل سجلّ الأسئلة', !pub.includes('"options"'));
const seat = back.teamState(player.id);
check(
  'حالة اللاعب لا تحمل موضع الصواب',
  seat.question === null || seat.question.answer === undefined,
);

// ══ البلاغ ════════════════════════════════════════════════════
const victim = sheet[0];
check('لا بلاغ على سؤالٍ لم يُعرض هنا', back.markReported('لا-وجود-له') === false);
check('البلاغ يُقبل على سؤالٍ عُرض', back.markReported(victim.id) === true);
check(
  'السجلّ يُعلّم ما بلّغ عنه المنظّم', // بلاغ اللاعب لا يمرّ به
  back.feedState().find((r) => r.id === victim.id).reported === true,
);

await store.addFeedback({
  kind: 'report',
  questionId: victim.id,
  question: victim.q,
  roomCode: back.code,
  roomName: back.name,
  reason: 'الإجابة خاطئة',
  note: 'الصواب غير مذكور في الخيارات',
  byRole: 'admin',
});
const reports = await store.listFeedback({ kind: 'report' });
check('البلاغ دخل القاعة', reports.length === 1 && reports[0].questionId === victim.id);
check('ويحمل نصّ السؤال لا معرّفه وحده', reports[0].question === victim.q);
check(
  'ويحمل الغرفة والسبب',
  reports[0].roomCode === back.code && reports[0].reason === 'الإجابة خاطئة',
);
check('ولا هويّة لصاحبه', reports[0].byName === null);
check('عدّ البلاغات لكل سؤال', (await store.reportCounts()).get(victim.id) === 1);
check('تصفية الصنف تعمل', (await store.listFeedback({ kind: 'comment' })).length === 0);

// ══ أرشيف التحرير: يمحو ما قِيس، ويحفظ النسخة ثلاثين يوماً ══════
const edited = {
  kind: 'edit',
  bankId: 'quran',
  oldId: victim.id,
  newId: 'quran:جديد',
  oldQ: victim.q,
  oldOptions: victim.options,
  oldLevel: victim.level,
  newQ: 'نصٌّ جديدٌ للسؤال',
  newOptions: ['صواب', 'خطأ ١', 'خطأ ٢', 'خطأ ٣'],
  newLevel: 2,
};

check('للسؤال إحصاءٌ قبل المحو', (await store.questionStat(victim.id)).shown > 0);
check('وعليه بلاغ', (await store.reportCounts()).get(victim.id) === 1);

const wiped = await store.clearQuestion(victim.id);
check('المحو يُرجع ما كان', wiped.shown > 0 && wiped.reports === 1);
check('الإحصاء ذهب', (await store.questionStat(victim.id)) === null);
check('والبلاغ ذهب معه', (await store.listFeedback({ kind: 'report' })).length === 0);
check(
  'ولا يظهر في جدول الصحّة',
  !(await store.questionHealth({ minShown: 1 })).some((r) => r.id === victim.id),
);

await store.recordEdit({ ...edited, cleared: wiped });
const edits = await store.listEdits();
check('النسخة القديمة محفوظة', edits.length === 1 && edits[0].oldQ === victim.q);
check('ومعها ما مُحي', edits[0].shown === wiped.shown && edits[0].reports === 1);
check(
  'والخيارات تعود مصفوفةً كما كتبت',
  Array.isArray(edits[0].oldOptions) && edits[0].oldOptions.length === 4,
);
check('وتُقرأ بمعرّفها', (await store.getEdit(edits[0].id)).oldQ === victim.q);

await store.recordEdit({
  kind: 'delete',
  bankId: 'hadith',
  oldId: 'hadith:محذوف',
  oldQ: 'سؤالٌ حُذف',
  oldOptions: ['أ', 'ب', 'ج', 'د'],
  oldLevel: 3,
  cleared: { shown: 0, correct: 0, wrong: 0, reports: 0 },
});
check(
  'الحذف يُسجَّل كالتحرير',
  (await store.listEdits()).filter((r) => r.kind === 'delete').length === 1,
);

check(
  'ما نُسي لا يُقرأ',
  (await store.forgetEdit(edits[0].id)) === 1 && (await store.listEdits()).length === 1,
);

// ══ نقاط المنظّم اليدوية: تُزاد وتُنقص ولا تنزل تحت الصفر ═══════
const tally = createRoom(['quran'], {}, 'middle', 'غرفة النقاط');
const solo = tally.addTeam('فريق');
tally.adjustScore(solo.id, 3);
check('الزيادة اليدوية تعمل', tally.teams.get(solo.id).score === 3);
tally.adjustScore(solo.id, -1);
check('والخصم يعمل', tally.teams.get(solo.id).score === 2);
tally.adjustScore(solo.id, -5);
check('ولا تنزل النقاط تحت الصفر', tally.teams.get(solo.id).score === 0);
tally.adjustScore('لا-وجود-له', 5);
check('ولاعبٌ مجهول لا يكسر شيئاً', tally.teams.get(solo.id).score === 0);

// ══ البنوك في القاعدة: تنجو من النشر ═════════════════════════
/*
 * هذا جوهرُ النقل: المرجعُ جدولُ banks لا ملفّات الحاوية. فالفحصُ يُحرّر بنكاً
 * ثم يُعيد التهيئة — وإعادةُ التهيئة هي ما يحدث عند كل إقلاع، أي عند كل نشر.
 * فإن بقي التحرير فقد نجا ممّا كان يمحوه.
 */
const banksMod = await import(pathToFileURL(join(serverDir, 'banks.js')).href);
const {
  initBanks,
  allBanks,
  listBanks,
  playableBanks,
  saveBank,
  deleteBank,
  writeBank,
  setActive,
} = banksMod;
const { parseIntake } = await import(pathToFileURL(join(serverDir, 'intake.js')).href);

/* مجمَّعٌ خامٌّ لتفريغ جدولٍ قبل فحصه — store لا يُصدّر مجمَّعه وهو صواب */
const raw = new pg.Pool({ connectionString: DB_URL });

/* المخطّطُ مُسح في أول الفحص، فالجدول فارغ: تُزرع الملفّات مرّةً */
const seeded = await initBanks();
const fileCount = allBanks().reduce((n, b) => n + b.questions.length, 0);
check('القاعدةُ الفارغة تُزرع من ملفّات المستودع', seeded > 0 && fileCount > 0);
console.log(`   زُرع ${seeded} بنكاً · ${fileCount} سؤالاً`);
check('ولا تُزرع مرّتين', (await initBanks()) === seeded && !!allBanks().length);

/* تحريرٌ ثم «نشر»: التحرير يبقى */
const target = allBanks()[0];
const trimmed = target.questions.slice(1);
const goneId = target.questions[0].id;
await saveBank(target.id, trimmed);
check('الحذفُ نزل عدّادَ البنك', allBanks()[0].questions.length === trimmed.length);
await initBanks(); // ← هذا هو النشر
const revivedBank = allBanks().find((b) => b.id === target.id);
check('وبقي بعد إعادة التهيئة — لا يمحوه نشر', revivedBank.questions.length === trimmed.length);
check('والسؤال المحذوف لم يرجع', !revivedBank.questions.some((q) => q.id === goneId));
check(
  'ومعرّفاتُ الأسئلة كما كانت — فلا يضيع إحصاءٌ ولا بلاغ',
  revivedBank.questions[0].id === target.questions[1].id,
);

/* بنكٌ يُحذف ويُرجَع — عبر القاعدة لا عبر الملفّات */
const count = listBanks().length;
const dropped = await deleteBank(revivedBank.id);
check('حذفُ البنك يُرجع نسخته', dropped?.questions.length === trimmed.length);
check('وقائمةُ البنوك نقصت', listBanks().length === count - 1);
await initBanks();
check('ولم يرجع بإعادة التهيئة', !listBanks().some((b) => b.id === dropped.id));
await writeBank({ id: dropped.id, name: dropped.name, questions: dropped.questions });
check(
  'والإرجاع يردّه بأسئلته',
  allBanks().find((b) => b.id === dropped.id)?.questions.length === trimmed.length,
);
check(
  'ولا يُكتب فوق معرّفٍ مأخوذ',
  await writeBank(dropped)
    .then(() => false)
    .catch(() => true),
);

/*
 * ملفٌّ صوابُه ليس أوّلاً: يُقدَّم عند الزرع ولا يُثبَّت الرقمُ وحده.
 *
 * وهذا الحارسُ غالٍ: بنوكُ تمّوز كانت مواضعُ صوابها موزّعةً عشوائياً، فلو
 * كُتب الرقمُ «صفر» على خياراتٍ لم تُقدَّم لصار الخطأُ صواباً في كل سؤال —
 * صامتاً لا يظهر إلا في وجه لاعب.
 *
 * ويُجرَّب على مسار الزرع نفسه: جدولٌ فارغٌ ثم initBanks. وكان يُجرَّب على
 * importFiles وقد رُفع — والزرعُ هو ما بقي يقرأ الملفّات، وهو يمرّ بـbare
 * كما كان يمرّ ذاك.
 */
{
  const file = join(serverDir, 'banks', 'zz-answer.json');
  writeFileSync(
    file,
    JSON.stringify(
      {
        id: 'zz-answer',
        name: 'موضع الصواب',
        questions: [
          {
            q: 'أيُّها الصواب؟',
            options: ['خطأ أول', 'خطأ ثان', 'الصواب', 'خطأ ثالث'],
            answer: 2,
            level: 2,
          },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  try {
    await raw.query('DELETE FROM banks');
    await initBanks(); // جدولٌ فارغ ← زرعٌ من الملفّات
    const row = (await store.allBankRows()).find((b) => b.id === 'zz-answer');
    const first = row?.questions[0];
    check('الزرعُ يقدّم الصواب إلى أوّل الخيارات', first?.options[first.answer] === 'الصواب');
    check('ويُثبّت موضعه على الصفر', first?.answer === 0);
    const live = allBanks().find((b) => b.id === 'zz-answer');
    check(
      'وفي الذاكرة كذلك — فاللاعب يرى الصواب صواباً',
      live?.questions[0].options[live.questions[0].answer] === 'الصواب',
    );
  } finally {
    unlinkSync(file);
    await raw.query('DELETE FROM banks');
    await initBanks(); // ويُردّ الزرعُ نظيفاً لمن بعده
  }
}

/* ══ بنكٌ يُنشأ فارغاً، ويُفعَّل ويُلغى ══════════════════════════ */

{
  const made = await writeBank({ id: 'zz-new', name: 'بنكٌ وليد', questions: [] });
  check('البنكُ يُنشأ فارغاً', made.questions.length === 0);
  check('ويُولد مُفعَّلاً', made.active === true);
  check(
    'ولا يُعرض في اللعبة وهو فارغ',
    !playableBanks().some((b) => b.id === 'zz-new'),
  );
  check(
    'ويُعرض في اللوحة على كل حال',
    listBanks().some((b) => b.id === 'zz-new'),
  );

  check(
    'ولا يُنشأ بلا اسم',
    await writeBank({ id: 'zz-noname', name: '  ', questions: [] })
      .then(() => false)
      .catch(() => true),
  );
  check(
    'ولا بمعرّفٍ عربيّ',
    await writeBank({ id: 'بنك', name: 'عربيّ', questions: [] })
      .then(() => false)
      .catch(() => true),
  );
  /* الاسمُ المكرَّر يُردّ ولو اختلف معرّفُه — فالاسمُ هو ما يُرى في القائمة */
  check(
    'ولا باسمٍ يحمله بنكٌ آخر',
    await writeBank({ id: 'zz-twin', name: 'بنكٌ وليد', questions: [] })
      .then(() => false)
      .catch(() => true),
  );
  /* والتشكيلُ والهاءُ لا يصنعان اسماً جديداً */
  check(
    'ولا بصيغةٍ منه تختلف بالتشكيل',
    await writeBank({ id: 'zz-twin2', name: 'بنكٌ وليدٌ', questions: [] })
      .then(() => false)
      .catch(() => true),
  );

  /* سؤالٌ يدخله فيُرى في اللعبة */
  await saveBank('zz-new', [
    { q: 'سؤالُ البنك الوليد؟', options: ['صواب', 'خطأ ١', 'خطأ ٢', 'خطأ ٣'], answer: 0, level: 2 },
  ]);
  check('وبسؤالٍ واحدٍ يُعرض', playableBanks().some((b) => b.id === 'zz-new'));

  /* إلغاءُ التفعيل: يُحجب عن اللعبة ويبقى في اللوحة */
  await setActive('zz-new', false);
  check('إلغاءُ التفعيل يحجبه عن اللعبة', !playableBanks().some((b) => b.id === 'zz-new'));
  check(
    'ويبقى في اللوحة مُلغىً',
    listBanks().find((b) => b.id === 'zz-new')?.active === false,
  );
  check(
    'وأسئلتُه على حالها',
    allBanks().find((b) => b.id === 'zz-new')?.questions.length === 1,
  );

  /*
   * وحفظُ سؤالٍ فيه لا يُعيد تفعيله.
   *
   * حارسٌ على زلّةٍ وقعت: saveBank تُعيد بناء البنك في الذاكرة من حمولةٍ
   * تكتبها، فلو سقط منها وصفُ التفعيل عاد المُلغى مُفعَّلاً بمجرّد تحريره —
   * ولا يُرى الخللُ إلا بعد إقلاعٍ يقرأ القاعدة فيردّه مُلغى من جديد.
   */
  await saveBank('zz-new', [
    { q: 'سؤالُ البنك الوليد؟', options: ['صواب', 'خطأ ١', 'خطأ ٢', 'خطأ ٣'], answer: 0, level: 2 },
    { q: 'وسؤالٌ ثانٍ له؟', options: ['صواب', 'خطأ ١', 'خطأ ٢', 'خطأ ٣'], answer: 0, level: 1 },
  ]);
  check(
    'وحفظُ سؤالٍ فيه لا يُعيد تفعيله',
    listBanks().find((b) => b.id === 'zz-new')?.active === false,
  );
  await initBanks();
  check(
    'ويبقى مُلغىً بعد إعادة التهيئة — فالوصفُ في القاعدة',
    listBanks().find((b) => b.id === 'zz-new')?.active === false,
  );

  await setActive('zz-new', true);
  check('والتفعيلُ يردّه إلى اللعبة', playableBanks().some((b) => b.id === 'zz-new'));

  await deleteBank('zz-new');
}

/* ══ الأسئلة المعلّقة ══════════════════════════════════════════ */

{
  await raw.query('DELETE FROM pending');

  const [one] = await store.addPending([
    { bank: null, q: 'ما أطولُ سورةٍ في القرآن؟', answer: 'البقرة', wrongs: [], level: null },
  ]);
  const got = await store.getPending(one);
  check('المعلَّقُ يُحفظ بسؤاله وجوابه', got.q === 'ما أطولُ سورةٍ في القرآن؟');
  check('وبلا بنكٍ ولا مستوى', got.bank === null && got.level === null);
  check('والمعلّقةُ تُعَدّ', (await store.countPending()) === 1);

  await store.updatePending(one, {
    bank: 'quran',
    q: got.q,
    answer: got.answer,
    wrongs: ['آل عمران', 'النساء', 'المائدة'],
    level: 2,
  });
  const done = await store.getPending(one);
  check('والتحريرُ يُكمل تفاصيله', done.wrongs.length === 3 && done.level === 2 && done.bank === 'quran');

  await store.forgetPending(one);
  check('والنسيانُ يُخرجه', (await store.countPending()) === 0);

  /* القارئ: عمودان يكفيان، وما زاد قُرئ */
  const { rows: read, skipped } = parseIntake(
    ['سؤال\tالجواب', 'سؤالٌ بعمودين؟\tجوابه', 'سؤالٌ تامّ؟|صوابه|خطأ ١|خطأ ٢|خطأ ٣|صعب', 'بلا جواب'].join(
      '\n',
    ),
  );
  check('القارئُ يتجاوز سطرَ العنوان', read.length === 2);
  check('ويقبل عمودين', read[0].q === 'سؤالٌ بعمودين؟' && read[0].wrongs.length === 0);
  check(
    'ويقرأ ما زاد عليهما',
    read[1].wrongs.length === 3 && read[1].level === 3,
  );
  check('ويُخبر عن السطر الساقط', skipped.length === 1 && skipped[0].line === 4);
}

// ══ اللقطة تذهب والسجلّ يبقى ══════════════════════════════════
await store.forgetState(before.code);
check('ما عادت تُبعث', (await store.loadSnapshots(IDLE_ROOM_MS)).length === 0);
check('وبقيت في السجلّ', (await store.listRooms()).length === 1);

await store.close();
process.exit(0);

await raw.end();
