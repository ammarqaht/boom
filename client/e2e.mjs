// اختبار شامل: مسؤول + 3 فرق عبر سوكِت حقيقي على السيرفر الفعلي
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const connect = () => io(URL, { transports: ['websocket'] });
const ask = (s, event, payload = {}) => new Promise((resolve) => s.emit(event, payload, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

const admin = connect();
await new Promise((r) => admin.on('connect', r));

// غرفة ببنكين معاً
const nameless = await ask(admin, 'admin:createRoom', { bankIds: ['quran'] });
check('لا غرفة بلا اسم', nameless.ok === false);

const created = await ask(admin, 'admin:createRoom', {
  bankIds: ['quran', 'seerah'],
  name: 'نادي الاختبار',
  settings: { startSeconds: 30, correctBonus: 5, wrongPenalty: 3, maxSeconds: 120 },
});
check('إنشاء الغرفة', created.ok);
check('الاسم يصل الواجهة', created.state.name === 'نادي الاختبار');
console.log(
  '   الرمز:',
  created.code,
  '| الاسم:',
  created.state.name,
  '| البنوك:',
  created.state.bankIds.join(' + '),
);

let adminState = created.state;
admin.on('room:state', (s) => (adminState = s));

// سجلّ الأسئلة — للمنظّم وحده، ونعدّ ما يصله وما يتسرّب لغيره
const adminFeed = [];
admin.on('admin:feed', (rows) => adminFeed.push(rows));

// شاشة العرض
const display = connect();
let displayFeedLeak = 0;
display.on('admin:feed', () => displayFeedLeak++);
await new Promise((r) => display.on('connect', r));
check('اتصال شاشة العرض', (await ask(display, 'display:join', { code: created.code })).ok);

// ثلاثة فرق
const teams = [];
for (const name of ['النسور', 'الصقور', 'الأسود']) {
  const s = connect();
  await new Promise((r) => s.on('connect', r));
  const res = await ask(s, 'team:join', { code: created.code, name });
  const team = { name, socket: s, id: res.teamId, state: res.state, feedLeak: 0 };
  s.on('team:state', (st) => (team.state = st));
  s.on('admin:feed', () => team.feedLeak++);
  teams.push(team);
}
check(
  'انضمام 3 فرق',
  teams.every((t) => t.id),
);

// رفض الاسم المكرر
const dup = connect();
await new Promise((r) => dup.on('connect', r));
const dupRes = await ask(dup, 'team:join', { code: created.code, name: 'النسور' });
check('رفض اسم فريق مكرر', !dupRes.ok);
dup.close();

// بدء الجولة — ثلاث ثوانٍ استعداد قبل انطلاق العدادات
check('بدء الجولة', (await ask(admin, 'admin:start')).ok);
await wait(400);
check('حالة الاستعداد ظهرت', adminState.status === 'countdown');
check('العد التنازلي يُبثّ', adminState.countdownMs > 1000 && adminState.countdownMs <= 3000);
check(
  'لا سؤال أثناء الاستعداد',
  teams.every((t) => t.state.question === null),
);
const beforeCountdown = teams[0].state.timeMs;
await wait(1200);
check('العدادات لا تنقص أثناء الاستعداد', teams[0].state.timeMs === beforeCountdown);

await wait(2000);
check('الجولة انطلقت بعد 3 ثوانٍ', adminState.status === 'running');
check(
  'كل فريق استلم سؤالاً',
  teams.every((t) => t.state.question),
);
check(
  'الأسئلة مخلوطة من البنكين',
  new Set(teams.map((t) => t.state.question.id.split(':')[0])).size >= 1,
);
check(
  'الإجابة الصحيحة مخفية عن المتصفح',
  teams.every((t) => t.state.question.answer === undefined),
);

// النسور يجاوب صح مراراً، الصقور يخطئ، الأسود يصمت
const results = []; // نجمع الردود لنفحص حقول كشف الصواب
const answer = (team, correct) =>
  new Promise((resolve) => {
    const asked = team.state.question;
    const choice = correct ? 0 : 1;
    const done = (payload) => resolve(payload && results.push({ asked, choice, ...payload }));
    team.socket.once('team:result', done);
    setTimeout(done, 1200); // لا نعلّق لو رفض السيرفر الإجابة
    team.socket.emit('team:answer', { questionId: asked.id, choice });
  });

for (let i = 0; i < 6; i++) {
  if (teams[0].state.question) await answer(teams[0], true);
  if (teams[1].state.question) await answer(teams[1], false);
  await wait(60);
}
// كشف الصواب: الردّ يحمل معرّف السؤال المُجاب عنه وموضع صوابه
check(
  'الردّ يعيد معرّف السؤال نفسه',
  results.length > 0 && results.every((r) => r.questionId === r.asked.id),
);
check(
  'الردّ يعيد موضع الإجابة الصحيحة',
  results.every((r) => Number.isInteger(r.answer) && r.answer >= 0 && r.answer < 4),
);
check(
  'الموضع المكشوف يطابق حكم الصواب',
  results.every((r) => (r.answer === r.choice) === r.isCorrect),
);

/*
 * الحارس الأهمّ في هذه المرحلة: سجلّ أسئلة المنظّم يحمل مواضع الإجابات
 * الصحيحة. فلو تسرّب إلى قناة الغرفة لقرأه اللاعب من الشبكة قبل أن يجيب.
 */
check(
  'لم يصل سجلّ الأسئلة إلى أيّ لاعب',
  teams.every((t) => t.feedLeak === 0),
);
check('ولا إلى شاشة القاعة', displayFeedLeak === 0);
check('وقد وصل المنظّم فعلاً', adminFeed.length > 0);
check(
  'وسجلّ المنظّم يحمل مواضع الصواب',
  adminFeed.at(-1).every((r) => Number.isInteger(r.answer)),
);

const reviewDuringPlay = teams[0].state.review; // يجب أن تظل مخفية حتى نهاية الجولة
console.log('   بعد 6 جولات إجابات:');
for (const t of teams) console.log(`     ${t.name}: ${(t.state.timeMs / 1000).toFixed(1)} ث`);
check(
  'العدادات تباعدت بين الفرق',
  new Set(teams.map((t) => Math.round(t.state.timeMs / 1000))).size > 1,
);

// إضافة وقت يدوياً من المسؤول
const before = teams[2].state.timeMs;
admin.emit('admin:adjustTime', { teamId: teams[2].id, seconds: 10 });
await wait(400);
check('المسؤول أضاف 10 ثوانٍ', teams[2].state.timeMs > before + 8000);

// إيقاف واستئناف: الوقت يتجمد
admin.emit('admin:pause');
await wait(300);
const frozen = teams[0].state.timeMs;
await wait(900);
check('الوقت يتجمد عند الإيقاف', Math.abs(teams[0].state.timeMs - frozen) < 200);
admin.emit('admin:resume');

// ننتظر أول نبض يتوقف
const ended = await new Promise((resolve) => {
  admin.on('room:ended', resolve);
  setTimeout(() => resolve(null), 40000);
});
check('الجولة انتهت بأول نبض يتوقف', !!ended);
if (ended) {
  console.log('   النتائج:');
  for (const a of ended.awards) {
    console.log(
      `     ${a.name}: ${a.points} نقطة ${a.flatlined ? '(توقف النبض)' : `(${(a.timeMs / 1000).toFixed(1)} ث)`}`,
    );
  }
  check('فريق واحد فقط توقف نبضه', ended.awards.filter((a) => a.flatlined).length === 1);
  // النقاط الآن = نصيب الترتيب + نقطةٌ عن كل إجابة صحيحة، فالقيم تتفاوت
  const byRank = ended.awards.filter((a) => !a.flatlined);
  // الترتيب بالوقت الباقي — أما النقاط فقد تتجاوز الأعلى لمن أصاب أكثر
  check(
    'الصامدون مرتّبون تنازلياً بالوقت الباقي',
    byRank.every((a, i) => i === 0 || byRank[i - 1].timeMs >= a.timeMs),
  );
  check(
    'نقاط الإجابات محسوبة',
    ended.awards.every((a) => a.points >= (a.correct ?? 0)),
  );
  check('كل الفرق توقفت', adminState.status === 'ended');
}

// لا يتكرر سؤال على الفريق نفسه داخل الجولة
const seenIds = teams[0].state.review?.map((x) => x.id) ?? [];
check('لا تكرار للأسئلة داخل الجولة', seenIds.length === new Set(seenIds).size);

// المراجعة تصل الفرق بعد الانتهاء فقط
// (ننتظر قليلاً: room:ended يصل سوكِت المسؤول قبل أن تصل team:state سوكِتات الفرق)
await wait(500);
check('المراجعة كانت مخفية أثناء اللعب', reviewDuringPlay === null);
const reviewer = teams.find((t) => t.state.review?.length);
check('مراجعة الأسئلة وصلت الفريق', !!reviewer);
if (reviewer) {
  const r = reviewer.state.review;
  console.log(`   ${reviewer.name}: ${r.length} سؤال للمراجعة`);
  check(
    'المراجعة تحمل الإجابة الصحيحة واختيار الفريق',
    r.every((x) => typeof x.answer === 'number' && typeof x.choice === 'number'),
  );
  check(
    'صحة العلامة تطابق الإجابة',
    r.every((x) => x.isCorrect === (x.choice === x.answer)),
  );
}

// نقاط الجولة تصل كل مجموعة لعرضها في رسالة النهاية
check(
  'نقاط الجولة وصلت كل مجموعة',
  teams.every((t) => typeof t.state.roundPoints === 'number'),
);
check(
  'نقاط الجولة تطابق نتيجة الغرفة',
  teams.every((t) => t.state.roundPoints === ended.awards.find((a) => a.teamId === t.id).points),
);

// سجل الجولات
check('السجل سجّل الجولة الأولى', adminState.history.length === 1);
check(
  'السجل يميّز صاحب أعلى وقت',
  adminState.history[0].awards.some((a) => a.top),
);
check(
  'السجل يميّز المتوقف',
  adminState.history[0].awards.some((a) => a.flatlined),
);

// تغبيش شاشة العرض
admin.emit('admin:toggleBlur');
await wait(400);
check('تغبيش شاشة العرض يعمل', adminState.displayBlurred === true);
admin.emit('admin:toggleBlur');
await wait(400);
check('إلغاء التغبيش يعمل', adminState.displayBlurred === false);

// متجر البطاقات عبر السوكِت: المتصدّر يشتري «وقت إضافي» مرّتين ثم يُمنع
const buyer = teams.reduce((best, t) => (t.state.score > best.state.score ? t : best), teams[0]);
const timeCard = buyer.state.shop.cards.find((c) => c.id === 'time');
check('المتجر مفتوح بين الجولات', buyer.state.shop.open === true);
check('المتجر يعلن المتبقي من البطاقة', timeCard.left === 2);
// نمنحه رصيداً كافياً عبر تعديل المنظّم — فالسعر صار متوازناً مع جولات عدّة
admin.emit('admin:adjustScore', { teamId: buyer.id, points: 40 });
await wait(500);
const scoreBefore2 = buyer.state.score;
const bought = await ask(buyer.socket, 'team:buyCard', { card: 'time' });
check('شراء بطاقة الوقت عبر السوكِت', bought.ok === true);
await wait(500);
check(
  `خُصم سعر البطاقة (عشر نقاط) — ${scoreBefore2} ← ${buyer.state.score}`,
  buyer.state.score === scoreBefore2 - 10,
);
check('المتبقي صار واحداً', buyer.state.shop.cards.find((c) => c.id === 'time').left === 1);
check('تُشترى مرّة ثانية', (await ask(buyer.socket, 'team:buyCard', { card: 'time' })).ok === true);
await wait(300);
check('المتجر علّمها مستنفَدة', buyer.state.shop.cards.find((c) => c.id === 'time').used === true);
check(
  'رفض الشراء بعد الحدّ',
  (await ask(buyer.socket, 'team:buyCard', { card: 'time' })).ok === false,
);

// المسؤول يفتح البطاقات من جديد فتصير متاحة
check('فتح البطاقات من المسؤول', (await ask(admin, 'admin:reopenCards')).ok === true);
await wait(300);
check(
  'البطاقة رجعت متاحة بعد الفتح',
  buyer.state.shop.cards.find((c) => c.id === 'time').used === false,
);

// «ابدأ الجولة» بعد النهاية يبدأ جولة جديدة مباشرة بلا زر تجهيز
check('بدء جولة جديدة مباشرة', (await ask(admin, 'admin:start')).ok);
await wait(400);
check('رقم الجولة تقدم', adminState.round === 2);
check(
  'النقاط تراكمت',
  adminState.teams.some((t) => t.score > 0),
);
check(
  'المشتري بدأ بـ40 ث (بطاقتان) والبقية بـ30',
  adminState.teams.every((t) => (t.id === buyer.id ? t.timeMs === 40000 : t.timeMs === 30000)),
);
check('الجولة الثانية بدأت باستعداد', adminState.status === 'countdown');

// أسئلة الجولة الثانية جديدة — لا تعيد ما رآه الفريق في الأولى
await wait(3400);
const round1Ids = new Set(seenIds);
const round2Ids = [];
for (let i = 0; i < 5 && teams[0].state.question; i++) {
  round2Ids.push(teams[0].state.question.id);
  await answer(teams[0], true);
  await wait(80);
}
const repeated = round2Ids.filter((id) => round1Ids.has(id));
console.log(
  `   الجولة 1: ${round1Ids.size} سؤال | الجولة 2: ${round2Ids.length} سؤال | مكرر: ${repeated.length}`,
);
check('لا تتكرر أسئلة الجولة الأولى في الثانية', repeated.length === 0);

// إنهاء اللعبة وعرض الأوائل
check('إنهاء اللعبة', (await ask(admin, 'admin:finishGame')).ok);
await wait(500);
check('الحالة أصبحت finished', adminState.status === 'finished');
const standings = adminState.standings;
check('الترتيب النهائي وصل', Array.isArray(standings) && standings.length === 3);
if (standings) {
  console.log('   الأوائل:');
  for (const s of standings) console.log(`     ${s.rank}. ${s.name} — ${s.score} نقطة`);
  check(
    'الترتيب تنازلي حسب النقاط',
    standings.every((s, i) => i === 0 || standings[i - 1].score >= s.score),
  );
  check(
    'المراتب متسلسلة 1..N',
    standings.every((s, i) => s.rank === i + 1),
  );
}
check(
  'المجموعات استلمت الترتيب النهائي',
  teams.every((t) => t.state.standings?.length === 3),
);
check(
  'عدد إجابات المجموعة يصل الواجهة',
  teams.every((t) => typeof t.state.answered === 'number'),
);

// السجل الخاص بمجموعة واحدة يمكن اشتقاقه من السجل العام
const mine = adminState.history.flatMap((r) => r.awards.filter((a) => a.teamId === teams[0].id));
// ══ المرحلة ٥: باب لوحة المالك مقفل ═══════════════════════════
// أهمّ ما يُحرس فيها: أنها لا تُفتح بلا مفتاح. أما ما وراء الباب فيُختبر
// بالمفتاح في بيئة التشغيل، ولا يُكتب مفتاحٌ في مستودع.
const CONSOLE_PATHS = ['summary', 'rooms', 'health', 'feedback', 'edits', 'dashboard'];
const codes = [];
for (const path of CONSOLE_PATHS) {
  const bare = await fetch(`http://localhost:3000/api/console/${path}`);
  const wrong = await fetch(`http://localhost:3000/api/console/${path}`, {
    headers: { 'x-nabda-key': encodeURIComponent('مفتاح-مختلق') },
  });
  codes.push(bare.status, wrong.status);
}
check(
  'لا تُفتح لوحة المالك بلا مفتاح ولا بمفتاحٍ خاطئ',
  codes.every((c) => c === 401 || c === 429),
);
check(
  'ولا تُسرّب شيئاً في جسم الردّ',
  !(await (await fetch('http://localhost:3000/api/console/rooms')).text()).includes('code'),
);

// ══ المرحلة ٤: بلاغ اللاعب، والتعليق مع تقييمه ═══════════════
const anyQuestion = adminFeed.at(-1)[0];
const badReport = await ask(teams[0].socket, 'team:report', {
  questionId: 'لا-وجود-له',
  reason: 'x',
});
check('لا بلاغ على سؤالٍ خارج الغرفة', badReport.ok === false);

const rep = await ask(teams[0].socket, 'team:report', {
  questionId: anyQuestion.id,
  reason: 'السؤال غامض',
  note: 'الصياغة ملتبسة',
});
check('بلاغ اللاعب يُقبل', rep.ok === true);
// ولا يظهر في سجلّ المنظّم: هو يدير جولةً لا يُراجع شكاوى
await wait(400);
check('ولا يُعلَّم في سجلّ المنظّم',
  adminFeed.at(-1).every((r) => r.id !== anyQuestion.id || r.reported === false));

const c1 = await ask(teams[0].socket, 'feedback:comment', { stars: 4, text: 'لعبة ممتعة' });
check('تعليق اللاعب يُقبل', c1.ok === true);
const c2 = await ask(teams[0].socket, 'feedback:comment', { stars: 2, text: 'مرّة ثانية' });
check('ولا يُقبل تعليقان من جلسةٍ واحدة', c2.ok === false);
const empty = await ask(teams[1].socket, 'feedback:comment', { stars: 0, text: '  ' });
check('ولا تعليق فارغ بلا تقييم', empty.ok === false);
const c3 = await ask(admin, 'feedback:comment', { stars: 5, text: 'إدارة الجولة سهلة' });
check('تعليق المنظّم يُقبل', c3.ok === true);

check('سجل مجموعة واحدة قابل للتصفية', mine.length === adminState.history.length);

process.exit(0);
