// اختبار الذاكرة: تُكتب الغرفة على القرص، وتُبعث كما كانت — موقوفة
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
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
  listed[0].players === 2 && listed[0].questions === before.served,
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

// ══ اللقطة تذهب والسجلّ يبقى ══════════════════════════════════
await store.forgetState(before.code);
check('ما عادت تُبعث', (await store.loadSnapshots(IDLE_ROOM_MS)).length === 0);
check('وبقيت في السجلّ', (await store.listRooms()).length === 1);

await store.close();
process.exit(0);
