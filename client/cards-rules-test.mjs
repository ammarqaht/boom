import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');
const { createRoom, CARDS, dropRoom } = await import(pathToFileURL(join(server, 'game.js')).href);

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed++;
};

function setup(names = ['أ', 'ب', 'ج']) {
  const room = createRoom(['quran']);
  const teams = names.map((n) => room.addTeam(n));
  for (const t of teams) {
    t.connected = true;
    t.score = 50;
  }
  room.start();
  room.tick(room.countdownEndsAt);
  room.endRound();
  for (const t of teams) t.score = 50;
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
  check('لا يُشترى سلاحٌ على النفس', !room.buyCard(a.id, 'steal', a.id).ok);
  check('ولا السلاحُ نفسُه على الهدف نفسه مرّتين', room.buyCard(a.id, 'freeze', b.id).ok && !room.buyCard(a.id, 'freeze', b.id).ok);
  check('ولا بطاقةٌ ذاتيةٌ مرّتين للجولة نفسها', room.buyCard(a.id, 'shield').ok && !room.buyCard(a.id, 'shield').ok);
  check('والوقتُ الإضافي يتراكم', room.buyCard(a.id, 'time').ok && room.buyCard(a.id, 'time').ok);
  const before = a.score;
  check('النقضُ يردّ الثمن', room.refundCard(a.id, 'freeze').ok && a.score === before + CARDS.freeze.price);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b, c] } = setup();
  room.buyCard(a.id, 'freeze', c.id);
  room.buyCard(b.id, 'freeze', c.id);
  begin(room);
  check('تجميدان على لاعب: ١٠ ثوانٍ', c.lockedMs === 10000);
  check('واسمُ المجمِّدَين معاً', c.frozenBy === 'أ وب');
  check('وإشعارٌ واحدٌ يسمّيهما', c.notices.includes('جمّدك أ وب'));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b, c] } = setup();
  room.buyCard(a.id, 'freeze', c.id);
  room.buyCard(b.id, 'freeze', c.id);
  room.buyCard(b.id, 'steal', c.id);
  room.buyCard(c.id, 'fort');
  begin(room);
  check('الحصن يصدّ كل هجوم', c.lockedMs === 0 && c.timeMs === base(room));
  check('ولا يردّه على أحد', a.lockedMs === 0 && b.lockedMs === 0 && b.timeMs === base(room));
  check('والمهاجمُ يُخبَر', a.notices.some((n) => n.includes('حصنُ ج')));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(a.id, 'blackout', b.id);
  room.buyCard(b.id, 'mirror');
  begin(room);
  check('المرآة تردّ التجميد على صاحبه', a.lockedMs === 5000 && b.lockedMs === 0);
  check('وتردّ التعتيم', a.blackout && !b.blackout);
  check('والمجمَّدُ بالمرآة يعرف من ردّها', a.frozenBy === 'ب');
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(b.id, 'mirror');
  room.buyCard(a.id, 'fort');
  begin(room);
  check('مرآةٌ أمام حصن: لا يقع شيءٌ على أحد', a.lockedMs === 0 && b.lockedMs === 0);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(b.id, 'freeze', a.id);
  room.buyCard(a.id, 'mirror');
  room.buyCard(b.id, 'mirror');
  begin(room);
  check('مرآتان متقابلتان: الارتدادُ مرّةً واحدة ولا حلقة', a.lockedMs === 5000 && b.lockedMs === 5000);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'steal', b.id);
  begin(room);
  check('السرقة: خمسٌ تُؤخذ وتُضاف', a.timeMs === base(room) + 5000 && b.timeMs === base(room) - 5000);
  check('والمسروقُ يعرف السارق', b.notices.some((n) => n.includes('سرق أ')));
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
  const now = begin(room);
  const t0 = a.timeMs;
  const wrong = (a.current.answer + 1) % 4;
  room.answer(a.id, a.current.id, wrong);
  room.answer(a.id, a.current.id, (a.current.answer + 1) % 4);
  check('الدرع: خطآن بلا خصم', a.timeMs === t0 && a.shieldLeft === 0);
  room.answer(a.id, a.current.id, (a.current.answer + 1) % 4);
  check('والثالثُ يُخصم', a.timeMs === t0 - room.settings.wrongPenalty * 1000);
  void now;
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'truce');
  const now = begin(room);
  room.tick(now + 6000);
  check('الهدنة: ستُّ ثوانٍ ولا ينزل العدّاد', a.timeMs === base(room) && b.timeMs === base(room) - 6000);
  room.tick(now + 12000);
  check('وبعد عشرٍ ينزل', a.timeMs === base(room) - 2000);
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'revive');
  const now = begin(room);
  b.timeMs = 60000;
  a.timeMs = 100;
  room.tick(now + 500);
  check('صاعق القلب: يعود النبض بعشر ثوانٍ', a.timeMs === 10000 && !a.flatlined);
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
  check('وإجابةٌ خاطئة تُصفّر العدّاد يُنقذها الصاعق', a.timeMs === 10000 && room.status === 'running');
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'blackout', b.id);
  begin(room);
  const state = room.teamState(b.id);
  check('التعتيم: المعتَّم يعلم ومن فعلها', state.blackout && state.notices.some((n) => n.includes('عتّم أ')));
  const pub = room.publicState();
  check('والقاعةُ ترى الحدث', pub.cardEvents.some((e) => e.card === 'blackout' && e.by === 'أ' && e.on === 'ب'));
  dropRoom(room.code);
}

{
  const { room, teams: [a, b] } = setup(['أ', 'ب']);
  room.buyCard(a.id, 'freeze', b.id);
  room.buyCard(a.id, 'time');
  begin(room);
  room.pause();
  check('إعادةُ الجولة تُعيد آثار البطاقات', room.restartRound() && b.lockedMs === 5000 && a.timeMs === base(room) + 10000);
  dropRoom(room.code);
}

console.log(failed ? `\n❌ فشل ${failed}` : '\n✅ قوانين البطاقات كلها نجحت');
process.exit(failed ? 1 : 0);
