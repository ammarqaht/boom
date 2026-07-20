// اختبار بطاقات الشراء عبر منطق اللعبة مباشرة (ساعة محكومة)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const gamePath = join(process.cwd(), '..', 'server', 'game.js');
const { createRoom, CARDS } = await import(pathToFileURL(gamePath).href);

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

const room = createRoom(['general']);
const a = room.addTeam('النسور');
const b = room.addTeam('الصقور');
const c = room.addTeam('الأسود');

// يبدأ الجولة ويتجاوز العد التنازلي ثم يُفجّر «الخاسر» بتصفير وقته
function playRoundEndingWith(loser, times = []) {
  room.start();
  let now = room.countdownEndsAt;
  room.tick(now); // ينتقل إلى running
  for (const [team, ms] of times) team.timeMs = ms;
  loser.timeMs = 0;
  now += 100;
  room.tick(now);
  return now;
}

check('الأسعار: وقت 2 · تجميد 3 · مضاعفة 4',
  CARDS.time.price === 2 && CARDS.freeze.price === 3 && CARDS.double.price === 4);
check('لا شراء في اللوبي', room.buyCard(a.id, 'time').ok === false);

// الجولة الأولى: الأسود يخسر
playRoundEndingWith(c, [[a, 25000], [b, 15000]]);
check('الجولة انتهت', room.status === 'ended');
console.log('   نقاط الجولة 1:', room.result.awards.map((x) => `${x.name}:${x.points}`).join(' · '));

const aPoints = a.score;
check('النسور كسب نقاطاً', aPoints > 0);

// شراء وقت إضافي
check('شراء وقت إضافي', room.buyCard(a.id, 'time').ok && a.score === aPoints - 2);
check('تسجيل استخدام البطاقة', a.usedCards.has('time'));
check('لا يُعاد شراء نفس البطاقة', room.buyCard(a.id, 'time').ok === false);
check('رفض الشراء لعدم كفاية النقاط', room.buyCard(c.id, 'double').ok === false);

// تجميد ومضاعفة
a.score = 10; // رصيد كافٍ لبقية المشتريات
check('شراء تجميد على خصم', room.buyCard(a.id, 'freeze', b.id).ok && b.pendingFreezeBy === 'النسور');
check('لا تجميد للنفس', room.buyCard(b.id, 'freeze', b.id).ok === false);
b.score = 10;
check('شراء مضاعفة', room.buyCard(b.id, 'double').ok && b.pendingMultiplier === 3);

// متجر الفريق يعكس الحالة
const shopA = room.teamState(a.id).shop;
check('المتجر مفتوح بين الجولات', shopA.open === true);
check('المتجر يعلّم الوقت مستخدماً', shopA.cards.find((x) => x.id === 'time').used === true);
check('المتجر يعرض الخصوم للتجميد', shopA.rivals.length === 2);

// الجولة الثانية: تطبيق الآثار عند البدء
const base = room.settings.startSeconds * 1000;
room.start();
check('وقت النسور +5 ثوانٍ عند البدء', a.timeMs === base + 5000);
check('الصقور مقفلة 5 ثوانٍ (تجميد)', b.lockedMs === 5000 && b.frozenBy === 'النسور');
check('استُهلك وقت النسور المؤجّل', a.pendingBonusMs === 0);

let now = room.countdownEndsAt;
room.tick(now); // إلى running
b.current = { id: 'x', q: '?', options: ['1', '2'], answer: 0 };
check('إجابة مرفوضة أثناء التجميد', room.answer(b.id, 'x', 0) === null);

now += 5200;
room.tick(now);
check('انتهى القفل بعد 5 ثوانٍ', b.lockedMs === 0 && b.frozenBy === null);

// المضاعفة على نقاط الجولة الثانية — الأسود يخسر
a.timeMs = 30000;
b.timeMs = 20000;
c.timeMs = 0;
now += 100;
room.tick(now);
const bAward = room.result.awards.find((x) => x.teamId === b.id);
check('نقاط الصقور تضاعفت ×3', bAward.doubled === true && bAward.points % 3 === 0);
console.log('   نتائج الجولة 2:', room.result.awards.map((x) => `${x.name}:${x.points}${x.doubled ? '(×3)' : ''}`).join(' · '));
check('استُهلك المضاعِف', b.pendingMultiplier === 1);

// إعادة اللعبة تُعيد البطاقات
room.resetAll();
check('إعادة اللعبة تُتيح البطاقات', a.usedCards.size === 0 && b.pendingMultiplier === 1);

process.exit(0);
