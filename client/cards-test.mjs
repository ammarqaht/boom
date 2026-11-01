// اختبار الشرارات وبطاقات الشراء عبر منطق اللعبة مباشرة (ساعة محكومة)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const gamePath = join(process.cwd(), '..', 'server', 'game.js');
const { createRoom, CARDS } = await import(pathToFileURL(gamePath).href);

let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✅' : '❌'} ${label}`);
  if (!ok) failed++;
};

const room = createRoom(['quran']);
const a = room.addTeam('النسور');
const b = room.addTeam('الصقور');
const c = room.addTeam('الأسود');

// يبدأ الجولة ويتجاوز العد التنازلي ثم يُسكِن «الخاسر» بتصفير وقته
function finishWith(loser, times = [], now = room.lastTickAt) {
  for (const [team, ms] of times) team.timeMs = ms;
  loser.timeMs = 0;
  loser.dyingAt = 0; // مهلةُ السكون انقضت — الاختبار عن البطاقات لا عن المهلة
  room.tick(now + 100);
}
function begin() {
  room.start();
  room.tick(room.countdownEndsAt);
}
const award = (team) => room.result.awards.find((x) => x.teamId === team.id);

check(
  'ثماني بطاقات: وقت · صاعق · مضاعفة · تجميد · سرقة · مبارزة · درع · مرآة',
  Object.keys(CARDS).join() === 'time,revive,double,freeze,steal,duel,shield,mirror',
);
check(
  'الأسعار بالشرارات: وقت 4 · تجميد 5 · مضاعفة 7 · مبارزة 7 · درع 3',
  CARDS.time.price === 4 && CARDS.freeze.price === 5 && CARDS.double.price === 7 && CARDS.duel.price === 7 && CARDS.shield.price === 3,
);
check('لا شراء في اللوبي', room.buyCard(a.id, 'time').ok === false);

// الجولة الأولى: النسور يصيب ثلاثاً متتالية والأسود يسكن
begin();
for (let i = 0; i < 3; i++) {
  const r = room.answer(a.id, a.current.id, a.current.answer);
  if (i === 2) check('الثالثة المتتالية تُعلن السلسلة', r.streaked === true && r.streak === 3);
}
const wrong = room.answer(b.id, b.current.id, (b.current.answer + 1) % b.current.options.length);
check('الخطأ يصفّر السلسلة', wrong.streak === 0);
finishWith(c, [[a, 25000], [b, 15000]]);
check('الجولة انتهت', room.status === 'ended');
check(
  `الشرارات: ٣ للمشاركة + ٢ للسلسلة = ٥ (لا شيء للإجابة المفردة) — ${award(a).sparks}`,
  award(a).sparks === 5 && a.sparks === 5,
);
check('ومن سكن نبضه يأخذ شرارات المشاركة الثلاث', award(c).sparks === 3 && c.sparks === 3);
check('ونقاط الفوز من الجولة لا من الشرارات', a.score === award(a).points && award(a).base === award(a).correct + 2);

// الشراء بالشرارات لا بنقاط الفوز
a.sparks = 40;
const scoreBefore = a.score;
check('شراء وقت إضافي', room.buyCard(a.id, 'time').ok && a.sparks === 40 - CARDS.time.price);
check('ونقاط الفوز لم تُمسّ', a.score === scoreBefore);
const rest = [2, 3, 4, 5].map(() => room.buyCard(a.id, 'time').ok);
check('تُشترى حتى الحدّ — خمساً', rest.every(Boolean) && a.cardUses.get('time') === CARDS.time.limit);
check('لا سادسة بعد الحدّ', room.buyCard(a.id, 'time').ok === false);
c.sparks = 1;
check('رفض الشراء لقلّة الشرارات', room.buyCard(c.id, 'double').ok === false);
check('والنقضُ يردّ الشرارات', room.refundCard(a.id, 'time').ok && a.sparks === 40 - 4 * CARDS.time.price);
room.buyCard(a.id, 'time');

// المبارزة تصعد ولا تنزل
a.score = 10;
b.score = 4;
c.score = 4;
b.sparks = 40;
c.sparks = 40;
check('لا يُبارز المتصدّرُ من دونه', room.buyCard(a.id, 'duel', b.id).ok === false);
check('ولا من يساويه', room.buyCard(b.id, 'duel', c.id).ok === false);
check('ويُبارز من فوقه', room.buyCard(b.id, 'duel', a.id).ok === true);
c.score = 3;
check('ولا يُتحدّى اللاعب مرّتين في الجولة', room.buyCard(c.id, 'duel', a.id).ok === false);
check('والمتجر يعلّمه محجوزاً', room.teamState(c.id).shop.rivals.find((r) => r.id === a.id).dueled === true);
c.score = 4;
const shopB = room.teamState(b.id).shop;
check('المتجر يعلّم من يجوز تحدّيه', shopB.rivals.find((r) => r.id === a.id).above === true);

check('شراء تجميد على خصم', room.buyCard(a.id, 'freeze', c.id).ok);
check('شراء مضاعفة', room.buyCard(c.id, 'double').ok);

// الجولة الثانية: الآثار عند البدء
const base = room.settings.startSeconds * 1000;
room.start();
check('وقت النسور +٧٥ ثانية عند البدء (خمس بطاقات ×١٥ث)', a.timeMs === Math.min(120000, base + 75000));
check('الأسود مقفل ثماني ثوانٍ (تجميد)', c.lockedMs === 8000 && c.frozenBy === 'النسور');
check('المبارزة قائمة بين الطرفين', a.duels.includes(b.id) && b.duels.includes(a.id));
check('وشارتها في الحال العامة', room.publicState().teams.find((t) => t.id === b.id).effects.some((fx) => fx.card === 'duel' && fx.who === 'النسور'));
check('والقاعة تُخبَر بها', room.cardEvents.some((e) => e.kind === 'duel' && e.by === 'الصقور'));
check('وإشعارٌ لكل طرف', b.notices.some((n) => n.includes('تبارز')) && a.notices.some((n) => n.includes('يبارزك')));
check('وبطاقاتُ النفس تُقال عند البدء', a.notices.some((n) => n.includes('وقتك الإضافي')));

let now = room.countdownEndsAt;
room.tick(now);
// الصقور يصيب ثلاثاً والنسور واحدة: الصقور يغلب
for (let i = 0; i < 3; i++) room.answer(b.id, b.current.id, b.current.answer);
room.answer(a.id, a.current.id, a.current.answer);
check('النتيجة الحيّة في شارة المبارزة', room.teamState(a.id).effects.find((fx) => fx.card === 'duel').theirs === 3);
check('وخصمُه يُبلَّغ بإصابته', room.changedTeams.has(a.id));

// الأسود مضاعِفٌ ويسكن: يخسر نقاط جولته
c.correct = 2;
finishWith(c, [[a, 40000], [b, 30000]], now);
check(`المتحدّي الغالب يسرق سبعاً — ${award(b).duelPoints}`, award(b).duelPoints === 7 && award(b).duels[0].won === true);
check('والخصمُ تُسرق منه السبع', award(a).duelPoints === -7 && award(a).duels[0].won === false);
check('من سكن نبضه لا يأخذ نقاطاً ولو أصاب', award(c).points === 0 && award(c).correct === 2);
check('وشراراته باقية', award(c).sparks === 3);
check('استُهلك المضاعِف', c.pendingMultiplier === 1);

// المتحدّي إن لم يغلب فلا شيء على أحد
{
  const r2 = createRoom(['quran']);
  const [x, y] = ['س', 'ص'].map((n) => r2.addTeam(n));
  r2.start(); r2.tick(r2.countdownEndsAt); r2.endRound();
  x.score = 2; y.score = 9; x.sparks = 9;
  r2.buyCard(x.id, 'duel', y.id);
  r2.start(); const t = r2.countdownEndsAt; r2.tick(t);
  r2.answer(y.id, y.current.id, y.current.answer);
  y.timeMs = 60000; x.timeMs = 0; x.dyingAt = 0; r2.tick(t + 100);
  const ax = r2.result.awards.find((q) => q.teamId === x.id);
  const ay = r2.result.awards.find((q) => q.teamId === y.id);
  check('المتحدّي المغلوب لا يخسر نقاطاً', (ax.duelPoints ?? 0) === 0 && ax.duels[0].won === false);
  check('والخصمُ صدّ التحدّي', (ay.duelPoints ?? 0) === 0 && ay.duels[0].won === true);
}

// المضاعفة لمن صمد
c.sparks = 40;
room.buyCard(c.id, 'double');
begin();
c.correct = 3;
finishWith(a, [[b, 20000], [c, 30000]]);
check('نقاط الصامد المضاعِف ×٢', award(c).doubled === true && award(c).points === award(c).base * 2);

// الحال العامة تعكس التجميد والمضاعفة للشاشات
b.pendingMultiplier = 2;
b.lockedMs = 4200;
const pubB = room.publicState().teams.find((x) => x.id === b.id);
check('الحالة العامة تحمل عدّاد التجميد', pubB.lockedMs === 4200 && pubB.locked === true);
check('الحالة العامة تحمل علامة المضاعفة', pubB.doubled === true);
check('والشرارات والمركز', typeof pubB.sparks === 'number' && pubB.rank >= 1);
b.pendingMultiplier = 1;
b.lockedMs = 0;

// المركز: المتساويان في مركزٍ واحد
a.score = 9;
b.score = 9;
c.score = 3;
a.totalCorrect = 5;
b.totalCorrect = 5;
check('المتساويان في النقاط والصحيحات في المركز الأول', room.rankOf(a) === 1 && room.rankOf(b) === 1 && room.rankOf(c) === 3);
b.totalCorrect = 6;
check('والتعادلُ في النقاط يكسره مجموعُ الصحيحات', room.rankOf(b) === 1 && room.rankOf(a) === 2);

// فتح البطاقات من جديد، وإعادة اللعبة تصفّر الشرارات
room.reopenCards();
check('فتح البطاقات أفرغ المستخدَم', [...room.teams.values()].every((t) => t.cardUses.size === 0));
room.resetAll();
check('إعادة اللعبة تصفّر النقاط والشرارات', a.score === 0 && a.sparks === 0 && a.cardUses.size === 0);

// اللقطة تحفظ الشرارات
const { restoreRoom } = await import(pathToFileURL(gamePath).href);
a.sparks = 7;
const back = restoreRoom(JSON.parse(JSON.stringify(room.snapshot())));
check('اللقطة تحفظ الشرارات', back.teams.get(a.id).sparks === 7);

// الأسماءُ الحقيقية: لا تمرّ في الحال العامة قبل الكشف، وتُكشف الثالثُ فالثاني فالأول فالبقيّة
a.realName = 'خالد';
b.realName = 'سارة';
c.realName = 'يوسف';
const d = room.addTeam('الفهود', null, 'نورة');
check('addTeam يحفظ الاسم الحقيقي', d.realName === 'نورة');
a.score = 9; b.score = 7; c.score = 5; d.score = 3;
room.finish();
const clean = JSON.stringify(room.publicState());
check('لا اسم حقيقي في الحال العامة قبل الكشف', !['خالد', 'سارة', 'يوسف', 'نورة'].some((n) => clean.includes(n)));
check('خطط الكشف أربع: ثلاثة أوائل ثم البقيّة', room.revealState().total === 4);
room.revealNext();
check('الأولى تكشف الثالث', JSON.stringify(room.revealState().names) === JSON.stringify({ [c.id]: 'يوسف' }));
room.revealNext();
room.revealNext();
check('الثالثة تكشف البطل', room.revealState().latest[0] === a.id && Object.keys(room.revealState().names).length === 3);
room.revealNext();
check('والأخيرة البقيّة', room.revealState().names[d.id] === 'نورة');
check('ولا خطوة بعدها', room.revealNext() === false);
const back2 = restoreRoom(JSON.parse(JSON.stringify(room.snapshot())));
check('اللقطة تحفظ الأسماء الحقيقية وخطوة الكشف', back2.teams.get(d.id).realName === 'نورة' && back2.revealStep === 4);
room.resetAll();
check('إعادة اللعبة تطوي الكشف', room.revealStep === 0 && room.revealState() === null);

process.exit(failed ? 1 : 0);
