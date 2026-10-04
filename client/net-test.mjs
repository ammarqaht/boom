/*
 * اختبار الشبكة: الرجوع بعد الانقطاع، والإجابة أثناءه، والعودة بالجهاز،
 * وحجمُ ما يعبر إلى الجوّال أثناء الجولة.
 *
 * يحتاج سيرفراً يعمل على 3000 — كما e2e.mjs.
 */
import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';
let failed = 0;
const check = (ok, label) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (auth = {}) => io(URL, { transports: ['websocket'], auth, forceNew: true });
const once = (socket, event, ms = 4000) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload ?? true);
    });
  });
const ask = (socket, event, payload = {}) =>
  new Promise((resolve) =>
    socket.timeout(5000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)),
  );

const banks = await (await fetch(`${URL}/api/banks`)).json();
const admin = connect();
await once(admin, 'connect');
const created = await ask(admin, 'admin:createRoom', { bankIds: [banks[0].id], name: 'اختبار الشبكة' });
check(created.ok, 'إنشاء غرفة');
const { code, adminKey } = created;

/* ── الانضمام والرجوع بالهويّة مع الاتصال ── */
const device = 'device-test-1';
const p1 = connect();
await once(p1, 'connect');
const joined = await ask(p1, 'team:join', { code, name: 'الصقور', device });
check(joined.ok, 'انضمام لاعب');
const session = { code, teamId: joined.teamId, token: joined.token };

p1.disconnect();
const back = connect({ team: session });
const resumed = await once(back, 'session:resumed');
check(resumed?.state?.id === session.teamId, 'الرجوع: السيرفر يعيده بالهويّة مع الاتصال نفسه، بلا طلب');
check(Array.isArray(resumed?.room?.teams), 'ومعها حالُ الغرفة');

const bad = connect({ team: { ...session, token: 'x' } });
const invalid = await once(bad, 'session:invalid');
check(Boolean(invalid?.error), 'رمزٌ خاطئ: يُقال صراحةً إن الجلسة انتهت');
bad.close();

/* ── العودة بالجهاز نفسه بالاسم نفسه ── */
const p2 = connect();
await once(p2, 'connect');
const again = await ask(p2, 'team:join', { code, name: 'الصقور', device });
check(again.ok && again.teamId === session.teamId && again.resumed, 'الجهاز نفسه بالاسم نفسه يعود إلى مجموعته');
const thief = await ask(p2, 'team:join', { code, name: 'الصقور', device: 'another' });
check(!thief.ok, 'وجهازٌ آخر لا ينتحل الاسم');
p2.close();

/* ── حاضرٌ ما بقي له سوكِت ── */
const twin = connect({ team: session });
await once(twin, 'session:resumed');
twin.close();
await wait(300);
const watch = connect({ admin: { code, adminKey } });
const adminBack = await once(watch, 'session:resumed');
const me = adminBack?.state?.teams.find((t) => t.id === session.teamId);
check(me?.connected === true, 'إغلاقُ تبويبٍ ثانٍ لا يُعلّم اللاعب غائباً وتبويبه الأول حيّ');

/* ── ثلاثون لاعباً وجولة ── */
const crowd = [];
for (let i = 0; i < 29; i++) {
  const s = connect();
  await once(s, 'connect');
  const r = await ask(s, 'team:join', { code, name: `فريق ${i}`, device: `d${i}` });
  crowd.push({ socket: s, id: r.teamId });
}
check(crowd.length === 29, 'انضمّ تسعةٌ وعشرون آخرون');

const started = await ask(watch, 'admin:start');
check(started.ok, 'بدء الجولة');
await wait(3400); // الاستعداد

const live = await (await fetch(`${URL}/api/live`)).json();
check(live.live && live.players >= 30, `‎/api/live‎ يرى الجولة: ${live.players} لاعباً`);

/* حجمُ ما يصل جوّالاً واحداً لا يجيب، وشاشةَ المنظّم، خلال ثلاث ثوانٍ يجيب فيها الآخرون */
const meter = (socket) => {
  const tally = { messages: 0, bytes: 0 };
  socket.onAny((_event, ...args) => {
    tally.messages++;
    tally.bytes += JSON.stringify(args).length;
  });
  return tally;
};
const quiet = meter(crowd[0].socket);
const board = meter(watch);
const answering = crowd.slice(1, 15);
const timer = setInterval(() => {
  for (const { socket } of answering) {
    socket.emit('team:answer', { questionId: 'x', choice: 0 }); // قديمة عمداً: تُردّ ولا تُنقص الوقت
  }
}, 500);
await wait(3000);
clearInterval(timer);
console.log(`   جوّالٌ ساكن: ${quiet.messages} رسالة، ${(quiet.bytes / 1024).toFixed(1)}KB في ٣ ثوانٍ`);
console.log(`   لوحة المنظّم: ${board.messages} رسالة، ${(board.bytes / 1024).toFixed(1)}KB في ٣ ثوانٍ`);
check(quiet.bytes < 8 * 1024, 'الجوّال الساكن لا يُغرق بحال الغرفة أثناء الجولة (كان ~١٣٠KB)');
check(board.messages <= 16, 'ولوحة المنظّم تصلها دفعاتٌ لا سيل (≤ ٤ في الثانية)');

/* ── الإجابة بإقرار، والمكرّرة تُردّ قديمة ── */
const state = await ask(back, 'session:sync');
const q = state.state?.question;
check(Boolean(q), 'للاعب سؤالٌ جارٍ');
const first = await ask(back, 'team:answer', { questionId: q.id, choice: 0 });
check(first.ok && typeof first.isCorrect === 'boolean', 'الإجابة تُقَرّ بنتيجتها');
const dup = await ask(back, 'team:answer', { questionId: q.id, choice: 0 });
check(!dup.ok && dup.stale, 'وإعادتها بعد انقطاع تُردّ «قديمة» لا تُحسب مرّتين');

/* ── إجابةٌ تُضغط والاتصال مقطوع: تُرسل عند عودته ولا تُرمى ── */
const now = (await ask(back, 'session:sync')).state.question;
back.disconnect();
const result = new Promise((resolve) =>
  back.timeout(8000).emit('team:answer', { questionId: now.id, choice: 1 }, (err, res) => resolve(err ? null : res)),
);
await wait(500);
back.connect(); // الهويّة في auth — تُرسل مع الاتصال
const late = await result;
check(late?.ok === true, 'إجابةٌ ضُغطت أثناء الانقطاع وصلت بعد العودة وحُسبت');

/* ── حارس السيل ── */
let answered = 0;
await Promise.all(
  Array.from({ length: 80 }, () => ask(crowd[1].socket, 'session:sync').then((r) => r.ok && answered++)),
);
check(answered <= 30, `حارس السيل يُسقط ما زاد: أُجيب ${answered} من ٨٠ طلباً متتالياً`);
const alive = await (await fetch(`${URL}/api/live`)).json();
check(alive.rooms >= 1, 'والسيرفر سليمٌ بعده');

for (const { socket } of crowd) socket.close();
back.close();
watch.close();
admin.close();
console.log(failed ? `\n❌ فشل ${failed}` : '\n✅ اختبار الشبكة كله نجح');
process.exit(failed ? 1 : 0);
