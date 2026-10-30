import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');
const { createRoom, dropRoom } = await import(pathToFileURL(join(server, 'game.js')).href);

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed++;
};

function setup(names = ['أ', 'ب', 'ج']) {
  const room = createRoom(['quran']);
  const teams = names.map((n) => room.addTeam(n));
  for (const t of teams) t.connected = true;
  room.start();
  room.tick(room.countdownEndsAt);
  room.endRound();
  for (const t of teams) t.sparks = 50;
  return { room, teams };
}
function begin(room) {
  room.start();
  const now = room.countdownEndsAt;
  room.tick(now);
  return now;
}
const base = (room) => room.settings.startSeconds * 1000;

{
  const { room, teams: [a, b] } = setup();
  const score = a.score;
  check('لا يُشترى سلاحٌ على النفس', !room.buyCard(a.id, 'steal', a.id).ok);
  check('ولا السلاحُ نفسُه على الهدف نفسه مرّتين', room.buyCard(a.id, 'freeze', b.id).ok && !room.buyCard(a.id, 'freeze', b.id).ok);
  check('ولا بطاقةٌ ذاتيةٌ مرّتين للجولة نفسها', room.buyCard(a.id, 'shield').ok && !room.buyCard(a.id, 'shield').ok);
  check('والوقتُ الإضافي يتراكم', room.buyCard(a.id, 'time').ok && room.buyCard(a.id, 'time').ok);
  const before = a.sparks;
  check('النقضُ يردّ الشرارات', room.refundCard(a.id, 'freeze').ok && a.sparks === before + 4);
  check('والشراءُ لا يمسّ نقاط الفوز', a.score === score);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b, c] } = setup();
  room.buyCard(a.id, 'freeze', c.id);
  room.buyCard(b.id, 'freeze', c.id);
  begin(room);
  check('تجميدان على لاعب: ستّ عشرة ثانية', c.lockedMs === 16000);
  check('واسمُ المجمِّدَين معاً', c.frozenBy === 'أ وب');
  check('وإشعارٌ واحدٌ يسمّيهما', c.notices.includes('جمّدك أ وب'));
  check('والمهاجمُ يُخبَر', a.notices.includes('جمّدتَ ج'));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(a.id, 'steal', b.id);
  room.buyCard(b.id, 'mirror');
  begin(room);
  check('المرآة تردّ التجميد على صاحبه', a.lockedMs === 8000 && b.lockedMs === 0);
  check('وتردّ السرقة', b.timeMs === base(room) + 8000 && a.timeMs === base(room) - 8000);
  check('والمجمَّدُ بالمرآة يعرف من ردّها', a.frozenBy === 'ب');
  check('والسرقةُ المردودة تُقال بصيغتها', a.notices.some((n) => n.includes('ردّت سرقتك')));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(b.id, 'freeze', a.id);
  room.buyCard(a.id, 'mirror');
  room.buyCard(b.id, 'mirror');
  begin(room);
  check('مرآتان متقابلتان: يضيع الهجومان', a.lockedMs === 0 && b.lockedMs === 0);
  check('والقاعة تُخبَر', room.cardEvents.filter((e) => e.kind === 'blocked').length === 2);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'steal', b.id);
  begin(room);
  check('السرقة: ثمانٍ تُؤخذ وتُضاف', a.timeMs === base(room) + 8000 && b.timeMs === base(room) - 8000);
  check('والمسروقُ يعرف السارق', b.notices.some((n) => n.includes('سرق أ')));
  const fx = room.publicState().teams.find((t) => t.id === b.id).effects;
  check('وشارةُ السرقة على الصفّين', fx.some((e) => e.card === 'steal' && e.n === -8 && e.who === 'أ'));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b, c] } = setup();
  room.settings.startSeconds = 12;
  room.buyCard(a.id, 'steal', c.id);
  room.buyCard(b.id, 'steal', c.id);
  begin(room);
  check('السرقة لا تُنزل أحداً تحت عشر ثوانٍ', c.timeMs === 10000);
  check('والثانيةُ تجد ما لا يُسرق', a.timeMs + b.timeMs === 12000 * 2 + 2000);
  dropRoom(room.code);
}

{
  const { room, teams: [a] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'shield');
  begin(room);
  const t0 = a.timeMs;
  for (let i = 0; i < 3; i++) room.answer(a.id, a.current.id, (a.current.answer + 1) % 4);
  check('الدرع: ثلاثة أخطاء بلا خصم', a.timeMs === t0 && a.shieldLeft === 0);
  room.answer(a.id, a.current.id, (a.current.answer + 1) % 4);
  check('والرابعُ يُخصم', a.timeMs === t0 - room.settings.wrongPenalty * 1000);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'revive');
  const now = begin(room);
  b.timeMs = 60000;
  a.timeMs = 100;
  room.tick(now + 500);
  check('صاعق القلب: يعود النبض بعشرين ثانية', a.timeMs === 20000 && !a.flatlined);
  check('والجولة لا تنتهي', room.status === 'running');
  a.timeMs = 100;
  room.tick(now + 1000);
  room.tick(now + 1000 + 2000);
  check('ومرّةً واحدة فقط', a.flatlined && room.status === 'ended');
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'revive');
  begin(room);
  b.timeMs = 60000;
  a.timeMs = 1000;
  room.answer(a.id, a.current.id, (a.current.answer + 1) % 4);
  check('وإجابةٌ خاطئة تُصفّر العدّاد يُنقذها الصاعق', a.timeMs === 20000 && room.status === 'running');
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  b.score = 5;
  room.buyCard(a.id, 'duel', b.id);
  room.buyCard(b.id, 'mirror');
  const now = begin(room);
  check('المرآة لا تردّ المبارزة', a.duels.includes(b.id) && b.duels.includes(a.id));
  room.answer(a.id, a.current.id, a.current.answer);
  room.answer(b.id, b.current.id, b.current.answer);
  b.timeMs = 0;
  b.dyingAt = 0;
  room.tick(now + 100);
  const duelOf = (t) => room.result.awards.find((x) => x.teamId === t.id).duels[0];
  check('التعادل في المبارزة لا شيء', duelOf(a).won === null && duelOf(b).won === null);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(a.id, 'time');
  begin(room);
  room.pause();
  check('إعادةُ الجولة تُعيد آثار البطاقات', room.restartRound() && b.lockedMs === 8000 && a.timeMs === base(room) + 15000);
  dropRoom(room.code);
}

console.log(failed ? `\n❌ فشل ${failed}` : '\n✅ قوانين البطاقات كلها نجحت');
process.exit(failed ? 1 : 0);
