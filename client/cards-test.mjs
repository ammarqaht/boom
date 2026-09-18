// اختبار بطاقات الشراء عبر منطق اللعبة مباشرة (ساعة محكومة)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const gamePath = join(process.cwd(), '..', 'server', 'game.js');
const { createRoom, CARDS, CARD_LIMIT } = await import(pathToFileURL(gamePath).href);

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

const room = createRoom(['quran']);
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

check('الأسعار: وقت 10 · تجميد 14 · مضاعفة 20',
  CARDS.time.price === 10 && CARDS.freeze.price === 14 && CARDS.double.price === 20);
check('حدّ البطاقة مرّتان', CARD_LIMIT === 2);
check('لا شراء في اللوبي', room.buyCard(a.id, 'time').ok === false);

// الجولة الأولى: الأسود يخسر
playRoundEndingWith(c, [[a, 25000], [b, 15000]]);
check('الجولة انتهت', room.status === 'ended');
console.log('   نقاط الجولة 1:', room.result.awards.map((x) => `${x.name}:${x.points}`).join(' · '));

const aPoints = a.score;
check('النسور كسب نقاطاً', aPoints > 0);

// نقطةٌ عن كل إجابة صحيحة، تُصرف عند انتهاء الجولة لا قبله
a.score = 0;
room.start();
let mid = room.countdownEndsAt;
room.tick(mid); // إلى running
a.correct = 4; // كأنه أصاب أربعاً
const during = a.score;
a.timeMs = 25000;
b.timeMs = 15000;
c.timeMs = 0;
mid += 100;
room.tick(mid);
check('الإجابات الصحيحة لم تُضف أثناء الجولة', during === 0);
check('نقطةٌ لكل إجابة صحيحة تُضاف بعد الجولة', a.score >= 4);

// شراء وقت إضافي
a.score = 20;
const aBefore = a.score;
check('شراء وقت إضافي', room.buyCard(a.id, 'time').ok && a.score === aBefore - CARDS.time.price);
check('تسجيل استخدام البطاقة', a.cardUses.get('time') === 1);
check('تُشترى مرة ثانية', room.buyCard(a.id, 'time').ok === true);
check('لا ثالثة بعد الحدّ', room.buyCard(a.id, 'time').ok === false);
c.score = 1;
check('رفض الشراء لعدم كفاية النقاط', room.buyCard(c.id, 'double').ok === false);

// تجميد ومضاعفة
a.score = 40; // رصيد كافٍ لبقية المشتريات
check('شراء تجميد على خصم', room.buyCard(a.id, 'freeze', b.id).ok && b.pendingFreezeBy === 'النسور');
check('لا تجميد للنفس', room.buyCard(b.id, 'freeze', b.id).ok === false);
b.score = 40;
check('شراء مضاعفة', room.buyCard(b.id, 'double').ok && b.pendingMultiplier === 2);

// متجر الفريق يعكس الحالة
const shopA = room.teamState(a.id).shop;
check('المتجر مفتوح بين الجولات', shopA.open === true);
check('المتجر يعلّم الوقت مستنفَداً', shopA.cards.find((x) => x.id === 'time').used === true);
check('المتجر يعرض المتبقي', shopA.cards.find((x) => x.id === 'freeze').left === CARD_LIMIT - 1);
check('المتجر يعرض الخصوم للتجميد', shopA.rivals.length === 2);

// الجولة الثانية: تطبيق الآثار عند البدء
const base = room.settings.startSeconds * 1000;
room.start();
check('وقت النسور +10 ثوانٍ عند البدء (بطاقتان)', a.timeMs === base + 10000);
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
check('نقاط الصقور تضاعفت ×2', bAward.doubled === true && bAward.points % 2 === 0);
console.log('   نتائج الجولة 2:', room.result.awards.map((x) => `${x.name}:${x.points}${x.doubled ? '(×2)' : ''}`).join(' · '));
check('استُهلك المضاعِف', b.pendingMultiplier === 1);

// المضاعفة تسقط عمّن سكن نبضه
c.score = 0;
c.pendingMultiplier = 2;
room.start();
let t3 = room.countdownEndsAt;
room.tick(t3);
c.correct = 3;
a.timeMs = 30000;
b.timeMs = 20000;
c.timeMs = 0;
t3 += 100;
room.tick(t3);
const cAward = room.result.awards.find((x) => x.teamId === c.id);
check('المتوقّف يأخذ نقاط إجاباته', cAward.points === 3);
check('المضاعفة تسقط عن المتوقّف', cAward.doubled === false);

// الحالة العامة تعكس التجميد والمضاعفة للشاشات
b.pendingMultiplier = 3;
b.lockedMs = 4200;
const pubTeams = room.publicState().teams;
const pubB = pubTeams.find((x) => x.id === b.id);
check('الحالة العامة تحمل عدّاد التجميد', pubB.lockedMs === 4200 && pubB.locked === true);
check('الحالة العامة تحمل علامة المضاعفة', pubB.doubled === true);
b.pendingMultiplier = 1;
b.lockedMs = 0;

// فتح البطاقات من جديد — الشراء يصير متاحاً مرة أخرى
check('البطاقات مستخدمة قبل الفتح', a.cardUses.size > 0);
room.reopenCards();
check('فتح البطاقات أفرغ المستخدَم', [...room.teams.values()].every((t) => t.cardUses.size === 0));
a.score = 20;
check('يمكن الشراء بعد الفتح', room.buyCard(a.id, 'time').ok === true);

// إعادة اللعبة تُعيد البطاقات
room.resetAll();
check('إعادة اللعبة تُتيح البطاقات', a.cardUses.size === 0 && b.pendingMultiplier === 1);

process.exit(0);
