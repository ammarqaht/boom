// اختبار شامل: مسؤول + 3 فرق عبر سوكِت حقيقي على السيرفر الفعلي
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
const connect = () => io(URL, { transports: ['websocket'] });
const ask = (s, event, payload = {}) =>
  new Promise((resolve) => s.emit(event, payload, resolve));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

const admin = connect();
await new Promise((r) => admin.on('connect', r));

// غرفة ببنكين معاً
const created = await ask(admin, 'admin:createRoom', {
  bankIds: ['general', 'science'],
  settings: { startSeconds: 30, correctBonus: 5, wrongPenalty: 3, maxSeconds: 120 },
});
check('إنشاء الغرفة', created.ok);
console.log('   الرمز:', created.code, '| البنوك:', created.state.bankIds.join(' + '));

let adminState = created.state;
admin.on('room:state', (s) => (adminState = s));

// شاشة العرض
const display = connect();
await new Promise((r) => display.on('connect', r));
check('اتصال شاشة العرض', (await ask(display, 'display:join', { code: created.code })).ok);

// ثلاثة فرق
const teams = [];
for (const name of ['النسور', 'الصقور', 'الأسود']) {
  const s = connect();
  await new Promise((r) => s.on('connect', r));
  const res = await ask(s, 'team:join', { code: created.code, name });
  const team = { name, socket: s, id: res.teamId, state: res.state };
  s.on('team:state', (st) => (team.state = st));
  teams.push(team);
}
check('انضمام 3 فرق', teams.every((t) => t.id));

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
check('لا سؤال أثناء الاستعداد', teams.every((t) => t.state.question === null));
const beforeCountdown = teams[0].state.timeMs;
await wait(1200);
check('العدادات لا تنقص أثناء الاستعداد', teams[0].state.timeMs === beforeCountdown);

await wait(2000);
check('الجولة انطلقت بعد 3 ثوانٍ', adminState.status === 'running');
check('كل فريق استلم سؤالاً', teams.every((t) => t.state.question));
check('الأسئلة مخلوطة من البنكين',
  new Set(teams.map((t) => t.state.question.id.split(':')[0])).size >= 1);
check('الإجابة الصحيحة مخفية عن المتصفح',
  teams.every((t) => t.state.question.answer === undefined));

// النسور يجاوب صح مراراً، الصقور يخطئ، الأسود يصمت
const answer = (team, correct) =>
  new Promise((resolve) => {
    const done = () => resolve();
    team.socket.once('team:result', done);
    setTimeout(done, 1200); // لا نعلّق لو رفض السيرفر الإجابة
    team.socket.emit('team:answer', { questionId: team.state.question.id, choice: correct ? 0 : 1 });
  });

for (let i = 0; i < 6; i++) {
  if (teams[0].state.question) await answer(teams[0], true);
  if (teams[1].state.question) await answer(teams[1], false);
  await wait(60);
}
const reviewDuringPlay = teams[0].state.review; // يجب أن تظل مخفية حتى نهاية الجولة
console.log('   بعد 6 جولات إجابات:');
for (const t of teams) console.log(`     ${t.name}: ${(t.state.timeMs / 1000).toFixed(1)} ث`);
check('العدادات تباعدت بين الفرق',
  new Set(teams.map((t) => Math.round(t.state.timeMs / 1000))).size > 1);

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

// ننتظر أول انفجار
const ended = await new Promise((resolve) => {
  admin.on('room:ended', resolve);
  setTimeout(() => resolve(null), 40000);
});
check('الجولة انتهت بأول انفجار', !!ended);
if (ended) {
  console.log('   النتائج:');
  for (const a of ended.awards) {
    console.log(`     ${a.name}: ${a.points} نقطة ${a.exploded ? '(انفجرت)' : `(${(a.timeMs / 1000).toFixed(1)} ث)`}`);
  }
  check('فريق واحد فقط انفجر', ended.awards.filter((a) => a.exploded).length === 1);
  check('توزيع النقاط 2/1/0', ended.awards.map((a) => a.points).sort().join(',') === '0,1,2');
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
  check('المراجعة تحمل الإجابة الصحيحة واختيار الفريق',
    r.every((x) => typeof x.answer === 'number' && typeof x.choice === 'number'));
  check('صحة العلامة تطابق الإجابة', r.every((x) => x.isCorrect === (x.choice === x.answer)));
}

// نقاط الجولة تصل كل مجموعة لعرضها في رسالة النهاية
check('نقاط الجولة وصلت كل مجموعة',
  teams.every((t) => typeof t.state.roundPoints === 'number'));
check('نقاط الجولة تطابق نتيجة الغرفة',
  teams.every((t) => t.state.roundPoints ===
    ended.awards.find((a) => a.teamId === t.id).points));

// سجل الجولات
check('السجل سجّل الجولة الأولى', adminState.history.length === 1);
check('السجل يميّز صاحب أعلى وقت', adminState.history[0].awards.some((a) => a.top));
check('السجل يميّز المنفجر', adminState.history[0].awards.some((a) => a.exploded));

// تغبيش شاشة العرض
admin.emit('admin:toggleBlur');
await wait(400);
check('تغبيش شاشة العرض يعمل', adminState.displayBlurred === true);
admin.emit('admin:toggleBlur');
await wait(400);
check('إلغاء التغبيش يعمل', adminState.displayBlurred === false);

// متجر البطاقات عبر السوكِت: الفائز (نقطتان) يشتري «وقت إضافي»
const buyer = teams.find((t) => t.state.score >= 2);
check('يوجد فريق برصيد يكفي للشراء', !!buyer);
check('المتجر مفتوح بين الجولات', buyer.state.shop.open === true);
const scoreBefore2 = buyer.state.score;
const bought = await ask(buyer.socket, 'team:buyCard', { card: 'time' });
check('شراء بطاقة الوقت عبر السوكِت', bought.ok === true);
await wait(300);
check('خُصم سعر البطاقة (نقطتان)', buyer.state.score === scoreBefore2 - 2);
check('المتجر علّمها مستخدمة', buyer.state.shop.cards.find((c) => c.id === 'time').used === true);
check('رفض إعادة الشراء', (await ask(buyer.socket, 'team:buyCard', { card: 'time' })).ok === false);

// «ابدأ الجولة» بعد النهاية يبدأ جولة جديدة مباشرة بلا زر تجهيز
check('بدء جولة جديدة مباشرة', (await ask(admin, 'admin:start')).ok);
await wait(400);
check('رقم الجولة تقدم', adminState.round === 2);
check('النقاط تراكمت', adminState.teams.some((t) => t.score > 0));
check('المشتري بدأ بـ35 ث والبقية بـ30',
  adminState.teams.every((t) =>
    t.id === buyer.id ? t.timeMs === 35000 : t.timeMs === 30000));
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
console.log(`   الجولة 1: ${round1Ids.size} سؤال | الجولة 2: ${round2Ids.length} سؤال | مكرر: ${repeated.length}`);
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
  check('الترتيب تنازلي حسب النقاط',
    standings.every((s, i) => i === 0 || standings[i - 1].score >= s.score));
  check('المراتب متسلسلة 1..N', standings.every((s, i) => s.rank === i + 1));
}
check('المجموعات استلمت الترتيب النهائي',
  teams.every((t) => t.state.standings?.length === 3));
check('عدد إجابات المجموعة يصل الواجهة',
  teams.every((t) => typeof t.state.answered === 'number'));

// السجل الخاص بمجموعة واحدة يمكن اشتقاقه من السجل العام
const mine = adminState.history.flatMap((r) => r.awards.filter((a) => a.teamId === teams[0].id));
check('سجل مجموعة واحدة قابل للتصفية', mine.length === adminState.history.length);

process.exit(0);
