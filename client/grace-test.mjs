/*
 * اختبار المهل: المنقطع لا يُنهي الجولة، والإجابةُ التي أخّرتها الشبكة
 * تُحسب، والمتأخّرةُ بعد النهاية تُحسب نقطتُها.
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
const ready = (socket) => new Promise((r) => (socket.connected ? r() : socket.once('connect', r)));
const ask = (socket, event, payload = {}) =>
  new Promise((resolve) =>
    socket.timeout(5000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)),
  );
/* يسأل عن الحال حتى يصدق الشرط — كل ١٥٠ms، فلا يبلغ حارسَ السيل */
async function until(socket, test, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await ask(socket, 'session:sync');
    if (res.ok && test(res)) return res;
    await wait(150);
  }
  return null;
}

const banks = await (await fetch(`${URL}/api/banks`)).json();

/** غرفةٌ بثوانٍ قليلة، ولاعبون بأسمائهم */
async function setup(names, startSeconds = 4) {
  const admin = connect();
  await ready(admin);
  const room = await ask(admin, 'admin:createRoom', { bankIds: [banks[0].id], name: 'مهل' });
  await ask(admin, 'admin:updateSettings', { settings: { startSeconds, maxSeconds: 120 } });
  const players = {};
  for (const name of names) {
    const socket = connect();
    await ready(socket);
    const res = await ask(socket, 'team:join', { code: room.code, name, device: `${name}-${room.code}` });
    players[name] = { socket, id: res.teamId, token: res.token };
  }
  return { admin, code: room.code, players };
}
const close = (...sockets) => sockets.forEach((s) => s.close());

/* ── ١: المنقطع يسكن وحده ولا يُنهي الجولة على غيره ── */
{
  const { admin, players } = await setup(['حاضر', 'غائب']);
  await ask(admin, 'admin:start');
  admin.emit('admin:adjustTime', { teamId: players['حاضر'].id, seconds: 60 });
  players['غائب'].socket.close(); // انقطع نتّه مع البدء
  await wait(3000 + 4000 + 3500); // الاستعداد + وقته + مهلة الانقطاع
  const view = await until(admin, () => true);
  const gone = view.state.teams.find((t) => t.id === players['غائب'].id);
  check(gone?.flatlined && gone?.dropped, 'المنقطع نفد وقته فسكن نبضُه وعُلّم «انقطع»');
  check(view.state.status === 'running', 'والجولة مستمرّة للحاضرين — لم تنتهِ بسكونه');
  close(admin, players['حاضر'].socket);
}

/* ── ٢: إجابةٌ ضُغطت قبل الصفر ووصلت بعده تُحسب، والتي بعده لا ── */
{
  const { admin, players } = await setup(['متأخر', 'بعد الصفر']);
  await ask(admin, 'admin:start');
  const late = players['متأخر'].socket;
  const after = players['بعد الصفر'].socket;
  const atZero = await until(late, (r) => r.state.status === 'running' && r.state.timeMs === 0 && !r.state.flatlined);
  check(Boolean(atZero), 'بلغ الصفر ولم يُسكَّن في الحال — مهلة السكون');
  const q2 = (await ask(after, 'session:sync')).state.question;
  const rejected = await ask(after, 'team:answer', { questionId: q2.id, choice: 0, left: 0 });
  check(!rejected.ok, 'إجابةٌ ضُغطت والشاشة تقول صفراً لا تُقبل في المهلة');
  const accepted = await ask(late, 'team:answer', { questionId: atZero.state.question.id, choice: 0, left: 300 });
  check(accepted.ok, 'إجابةٌ ضُغطت وشاشتها تقول «بقي ٠٫٣ ث» وأخّرتها الشبكة: حُسبت');
  close(admin, late, after);
}

/* ── ٢ب: من لم يُجب في المهلة يسكن بعدها وتنتهي الجولة ── */
{
  const { admin, players } = await setup(['ساكت', 'آخر']);
  await ask(admin, 'admin:start');
  admin.emit('admin:adjustTime', { teamId: players['آخر'].id, seconds: 60 });
  const ended = await until(admin, (r) => r.state.status === 'ended');
  const quiet = ended?.state.teams.find((t) => t.id === players['ساكت'].id);
  check(quiet?.flatlined && !quiet?.dropped, 'الحاضر الذي بلغ الصفر ولم يُجب سكن بعد المهلة وأنهى الجولة');
  close(admin, players['ساكت'].socket, players['آخر'].socket);
}

/* ── ٣: إجابةٌ في الطريق والجولة انتهت بسكون غيره: نقطتها تُحسب ── */
{
  const { admin, players } = await setup(['صامد', 'ساكن']);
  await ask(admin, 'admin:start');
  admin.emit('admin:adjustTime', { teamId: players['صامد'].id, seconds: 60 });
  const steady = players['صامد'].socket;
  const before = await until(steady, (r) => r.state.status === 'running');
  const question = before.state.question;
  const ended = await until(steady, (r) => r.state.status === 'ended');
  check(Boolean(ended), 'انتهت الجولة بسكون الآخر');
  const scoreBefore = ended.state.score;
  /* نجرّب الخيارات الأربعة؟ لا — مرّةً واحدة في الجولة. فنقبل أيَّ نتيجةٍ ونتحقّق من الحساب */
  const res = await ask(steady, 'team:answer', { questionId: question.id, choice: 0, left: 5000 });
  check(res.ok && res.late, 'إجابةٌ وصلت بعد النهاية بأقلّ من ثانية: قُبلت متأخرة');
  const afterState = (await ask(steady, 'session:sync')).state;
  check(
    afterState.score === scoreBefore + (res.isCorrect ? 1 : 0) &&
      afterState.roundPoints === ended.state.roundPoints + (res.isCorrect ? 1 : 0),
    `ونقطتُها في رصيده وجائزة الجولة (${res.isCorrect ? 'صحيحة: +١' : 'خاطئة: لا شيء'})`,
  );
  const twice = await ask(steady, 'team:answer', { questionId: question.id, choice: 1, left: 5000 });
  check(!twice.ok, 'ومرّةً واحدة — الثانية تُردّ');
  await wait(1200);
  close(admin, steady, players['ساكن'].socket);
}

/* ── ٣ب: المتأخّرة الصحيحة — مباشرةً على منطق اللعبة، والجواب معروف ── */
{
  const g = await import('../server/game.js');
  for (const factor of [1, 2]) {
    const room = g.createRoom([banks[0].id], { startSeconds: 30 }, undefined, 'وحدة');
    const steady = room.addTeam('صامد');
    const other = room.addTeam('ساكن');
    for (const t of [steady, other]) t.connected = true;
    room.start();
    const t0 = room.countdownEndsAt + 1;
    room.tick(t0);
    steady.pendingMultiplier = factor;
    steady.current = { id: 'late-q', q: 'س', options: ['أ', 'ب', 'ج', 'د'], answer: 2 };
    other.timeMs = 1;
    room.tick(t0 + 10); // بلغ الصفر: مهلة السكون
    room.tick(t0 + 10 + 1600); // انقضت: سكن وانتهت الجولة
    const award = room.result?.awards.find((a) => a.teamId === steady.id);
    const before = { score: steady.score, points: award?.points };
    const res = room.answer(steady.id, 'late-q', 2);
    check(
      room.status === 'ended' && res?.late && res.isCorrect &&
        steady.score === before.score + factor && award.points === before.points + factor,
      `المتأخّرة الصحيحة تُضيف ${factor === 1 ? 'نقطةً' : 'نقطتين (مضاعفة ×٢)'} إلى الرصيد والجائزة`,
    );
    g.dropRoom(room.code);
  }
}

console.log(failed ? `\n❌ فشل ${failed}` : '\n✅ اختبار المهل كله نجح');
process.exit(failed ? 1 : 0);
