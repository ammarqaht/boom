import { randomUUID } from 'node:crypto';
import { normalizeBankIds, poolFor } from './banks.js';

export const DEFAULT_SETTINGS = {
  startSeconds: 30,
  correctBonus: 5,
  wrongPenalty: 3,
  maxSeconds: 120,
};

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون الأحرف والأرقام المتشابهة
const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;
const COUNTDOWN_MS = 3000;
const FREEZE_MS = 8000; // مدة قفل الإجابة عند التجميد
/*
 * سقفُ المجموعات في الغرفة الواحدة. القاعةُ الحقيقية دونه بكثير، وهو حرزٌ
 * من رابطٍ يتسرّب فيدخل منه مئات فيثقل البثُّ على القاعة كلّها.
 */
export const MAX_TEAMS = 200;

/*
 * ثلاث مهلٍ تحمي الحسابَ من تأخّر الشبكة — والعرضُ قد يتأخّر، أما الحساب فلا.
 *
 * مهلةُ السكون: من بلغ عدّادُه الصفر لا يُسكَّن في الحال. إجابتُه قد تكون
 * في الطريق — ضغطها وشاشتُه تقول «بقي نصف ثانية» — والشبكةُ المزدحمة
 * تؤخّرها. فيُنتظر قليلاً: إن وصلت إجابةٌ ضُغطت قبل الصفر حُسبت.
 *
 * مهلةُ المتأخّرة: الجولة انتهت بسكون غيره وإجابتُه الصحيحة في الطريق —
 * تُحسب نقطتُها إن وصلت في ثانيةٍ من النهاية.
 *
 * مهلةُ الانقطاع: «منقطع» من غاب أكثر من ثلاث ثوانٍ، لا من رمشت شبكتُه.
 */
export const FLATLINE_GRACE_MS = 1500;
const LATE_ANSWER_MS = 1000;
const OFFLINE_AFTER_MS = 3000;
const TIME_CARD_MS = 15000;
const DOUBLE_FACTOR = 2;
const FREEZE_CAP_MS = 16000;
const STEAL_MS = 8000;
const STEAL_FLOOR_MS = 10000;
const SHIELD_HITS = 3;
const REVIVE_MS = 20000;
const DUEL_POINTS = 7;

/*
 * الشرارات: عملةُ الشراء، منفصلةٌ عن نقاط الفوز.
 *
 * كانت البطاقات تُشترى بنقاط الفوز نفسها، فكلُّ بطاقةٍ خسارةٌ في الترتيب:
 * قيست في محاكاةٍ على هذا الملف فلم تردّ واحدةٌ منها ثمنَها، وأقربُها
 * المضاعفة بخسارة خُمس نقطة. فلم يشترِ اللاعبون — وكانوا محقّين.
 *
 * فصارت للشراء عملةٌ لا تُحسب في الترتيب، تُكسب من اللعب نفسه: ثلاث شرارات
 * لكل من لعب الجولة ولو توقّف نبضه (فلا يبقى أحدٌ مفلساً)، وشرارتان لكل
 * ثلاث صحيحاتٍ متتالية. ولا شيء للإجابة المفردة ولا للمركز: كانت شرارةٌ
 * لكل صحيحة فكثرت الشرارات حتى صار الشراء بلا قرار. فالسلسلة وحدها تُغني،
 * والخطأ يقطعها — فيكسب الأقوى نحو سبع والأضعف نحو ثلاث.
 */
const SPARK_BASE = 3;
const STREAK_EVERY = 3;
const STREAK_SPARKS = 2;

/**
 * تعريفات البطاقات — المرجع الوحيد للأسعار والحدود والأنواع.
 *
 * الأسعار بالشرارات لا بنقاط الفوز، ودخلُ اللاعب الوسط نحو أربعٍ في الجولة:
 * فبطاقةٌ بخمسٍ قرارُ جولة أو جولتين، والمضاعفة والمبارزة بسبعٍ رهانٌ يُدّخر
 * له. ورُفع كلُّ سعرٍ وكلُّ حدٍّ واحداً معاً: بطاقاتٌ أكثر في اللعبة، وكلٌّ
 * منها أغلى قليلاً، فلا يغرق المتجر ولا يُحرم منه أحد.
 *
 * والبطاقات ثمانٍ لكلٍّ منها أثرٌ لا يشاركها فيه غيرها:
 *   دعم:  وقت إضافي (+١٥ ث) · صاعق القلب (يعود النبض بعشرين ثانية) ·
 *         مضاعفة (×٢ إن نجوت، وتسقط وحدها إن سكنت)
 *   هجوم: تجميد (قفل ثماني ثوانٍ) · سرقة نبض (ثماني ثوانٍ إليك) ·
 *         مبارزة (تتحدّى من فوقك، فإن أصبت أكثر سرقت منه سبع نقاط)
 *   دفاع: درع (ثلاثة أخطاء بلا خصم) · مرآة (تردّ كل تجميدٍ وسرقة)
 *
 * دُمجت الهدنة في الوقت الإضافي (كان أثرهما في النقاط واحداً)، والحصن في
 * المرآة، وأُسقط التعتيم: لاعبٌ سريعٌ لا ينظر إلى عدّاده أصلاً.
 */
export const CARDS = {
  time: { price: 4, name: 'وقت إضافي', limit: 5, stack: true },
  revive: { price: 5, name: 'صاعق القلب', limit: 2 },
  double: { price: 7, name: 'مضاعفة', limit: 3 },
  freeze: { price: 5, name: 'تجميد', limit: 4, target: true },
  steal: { price: 5, name: 'سرقة نبض', limit: 3, target: true },
  duel: { price: 7, name: 'مبارزة', limit: 3, target: true, upward: true },
  shield: { price: 3, name: 'درع', limit: 4 },
  mirror: { price: 5, name: 'مرآة', limit: 3 },
};

/*
 * وقتُ الشراء بين الجولتين: دقيقةٌ ونصف من نهاية الجولة، يراها
 * اللاعب عدّاداً تحت بطاقته. فإذا انقضت أُغلق المتجر حتى تبدأ الجولة —
 * فلا يبقى قرارٌ معلّقاً إلى ما لا نهاية، ولا تبدأ جولةٌ بلا إذن المنظّم.
 */
const BREAK_MS = 90000;

/*
 * نبضاتُ الجولة: لا تنتهي الجولةُ بأول من يسكن نبضُه، بل حين يسكن ثُمنُ
 * القاعة. قيست بمحاكاةٍ فيها مستعجلٌ يضغط بلا قراءةٍ من كل خمسة عشر: بستين
 * لاعباً كانت الجولةُ تنتهي في أربع عشرة ثانية، وأكثرُ من نصف القاعة لم
 * يُجب ثلاثة أسئلة. وبالثُّمن تطول إلى سبعٍ وعشرين ويكاد لا يُحرم أحد.
 * ومن كانوا ثمانيةً فأقلّ فنبضتُهم واحدة — القاعدةُ كما عرفها الناس.
 */
const livesFor = (players) => Math.max(1, Math.ceil(players / 8));

const ATTACK_VERB = { freeze: 'تجميد', steal: 'سرقة' };
/* «سرقة» تُضاف فتصير «سرقتك» — التاء المربوطة تنفتح مع الضمير */
const own = (verb, suffix) => verb.replace(/ة$/, 'ت') + suffix;

const toArabic = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

/**
 * مستويات المسابقة — ونسبةُ كل طبقة من الأسئلة المعروضة.
 * الطبقات: [١] سهل  [٢] متوسط  [٣] صعب.
 *
 * ليست تصفيةً بل ترجيح: كل الأسئلة تبقى في البِركة، وإنما يتغيّر ترتيب
 * ظهورها. فاللاعب لا يرى في الجولة إلا بضعة أسئلة من ألفٍ ومئة، والمهم
 * ما يتصدّر الطابور لا ما يُحذف منه — وبهذا لا يضيع سؤالٌ ولا يُحرَم
 * فريقٌ ابتدائيّ من سؤالٍ صعبٍ يُطربه أن يعرفه (والصفرُ تأخيرٌ لا حذف:
 * طبقةٌ بلا نصيبٍ لا تُسحب حتى تنفد أخواتها).
 *
 * والسلّم يرتفع درجةً درجة: الابتدائيّ سهلٌ في أكثره وفيه من المتوسط،
 * والمتوسطُ يجمع السهل والمتوسط وقليلاً من الصعب، والثانويُّ أغلبه متوسط
 * وفيه من السهل والصعب شيء، والجامعيُّ بين المتوسط والصعب وفيه سهلٌ قليل
 * — فلا مرحلةٌ تُسأل ما ليس لها، ولا مرحلةٌ يُحرَم أهلُها من طبقةٍ كلها.
 */
export const DIFFICULTY = {
  primary: { name: 'ابتدائي', mix: [70, 30, 0] },
  middle: { name: 'متوسط', mix: [45, 45, 10] },
  secondary: { name: 'ثانوي', mix: [20, 60, 20] },
  university: { name: 'جامعي', mix: [10, 40, 50] },
};

export const DEFAULT_DIFFICULTY = 'middle';

export function normalizeDifficulty(key) {
  return DIFFICULTY[key] ? key : DEFAULT_DIFFICULTY;
}

/**
 * يرتّب البِركة على نسب المستوى المختار.
 *
 * نظامُ أرصدة لا قرعة: كل طبقة تكسب نصيبها من الرصيد في كل خطوة، ويُسحب
 * من صاحبة أكبر رصيد ثم يُخصم منها واحد. فتخرج النسب مضبوطة على المدى،
 * ولا تتكتّل ثلاثة أسئلة صعبة متتالية كما تفعل القرعة العمياء.
 */
function byDifficulty(pool, key) {
  const { mix } = DIFFICULTY[normalizeDifficulty(key)];
  const tiers = [1, 2, 3].map((level) => shuffled(pool.filter((q) => (q.level ?? 2) === level)));
  const credit = [0, 0, 0];
  const out = [];

  while (out.length < pool.length) {
    for (let i = 0; i < 3; i++) credit[i] += mix[i] / 100;

    let pick = -1;
    for (let i = 0; i < 3; i++) {
      if (!tiers[i].length) continue;
      if (pick === -1 || credit[i] > credit[pick]) pick = i;
    }
    if (pick === -1) break; // نفدت الطبقات كلها

    credit[pick] -= 1;
    out.push(tiers[pick].pop());
  }
  return out;
}

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = Array.from(
      { length: 4 },
      () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function shuffled(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * نسخةٌ من السؤال بخياراتٍ مخلوطة.
 *
 * موقع الإجابة في الملف ثابت، فلاعبٌ يعيد اللعب مرّات يحفظ «هذا السؤال
 * إجابته الثانية» ولو تبدّل ترتيب الأسئلة. فنخلط الخيارات عند كل توزيعة
 * ونُصحّح رقم الإجابة معها: السؤال نفسه يأتي في كل مرة بترتيبٍ آخر،
 * فلا يبقى ما يُحفَظ إلا المعرفة.
 */
function dealt(question) {
  const order = shuffled(question.options.map((_, i) => i));
  return {
    ...question,
    options: order.map((i) => question.options[i]),
    answer: order.indexOf(question.answer),
  };
}

/**
 * يوزّع الأسئلة بحيث لا يتكرر موقع الإجابة الصحيحة في أسئلة متتالية.
 * الخلط وحده لا يمنع التتابع: قد تأتي خمسة أسئلة إجابتها كلها الخيار الثاني.
 * نوزّعها على دلاء حسب موقع الإجابة، ثم نسحب في كل خطوة من أكبر دلو
 * يختلف عن الموقع السابق — فيتباعد التكرار ولا يلمح اللاعب نمطاً.
 */
export function spreadAnswers(questions) {
  const buckets = new Map();
  for (const question of questions) {
    if (!buckets.has(question.answer)) buckets.set(question.answer, []);
    buckets.get(question.answer).push(question);
  }

  const out = [];
  let last = null;
  let remaining = questions.length;

  while (remaining > 0) {
    const eligible = [...buckets].filter(([position, list]) => position !== last && list.length);

    let pick = null;
    if (eligible.length === 0) {
      // لم يبق إلا الموقع السابق نفسه — نضطر لتكراره
      pick = [...buckets].find(([, list]) => list.length)?.[0] ?? null;
    } else {
      // دلو أكبر من كل ما تبقّى مجتمعاً يجب سحبه الآن وإلا تتابع في النهاية
      const forced = eligible.find(([, list]) => list.length * 2 > remaining);
      if (forced) {
        pick = forced[0];
      } else {
        // اختيار عشوائي مرجّح بحجم الدلو: يمنع التتابع دون أن ينتج دورة منتظمة
        const total = eligible.reduce((sum, [, list]) => sum + list.length, 0);
        let ticket = Math.random() * total;
        for (const [position, list] of eligible) {
          ticket -= list.length;
          if (ticket <= 0) {
            pick = position;
            break;
          }
        }
        if (pick === null) pick = eligible[eligible.length - 1][0];
      }
    }

    if (pick === null) break;
    out.push(buckets.get(pick).shift());
    remaining--;
    last = pick;
  }
  return out;
}

/** أيُّهما أمام: النقاطُ أولاً، ثم مجموعُ الصحيحات عند التساوي */
const ahead = (a, b) => a.score > b.score || (a.score === b.score && a.totalCorrect > b.totalCorrect);

class Team {
  constructor(name, settings) {
    this.id = randomUUID();
    this.token = randomUUID(); // يسمح للفريق بالرجوع بعد انقطاع الاتصال
    this.name = name; // الاسمُ في اللعبة: مستعارٌ يراه الجميع
    /*
     * الاسمُ الحقيقي: للمنظّم وحده حتى يكشفه بعد الأوائل. يُعامَل كالإجابة
     * الصحيحة — لا يمرّ في حالٍ عامة قبل وقته، فلا يقرؤه لاعبٌ من الشبكة.
     */
    this.realName = '';
    this.score = 0; // نقاط الفوز — عليها الترتيب
    this.totalCorrect = 0; // صحيحاتُ اللعبة كلها — بها يُكسر تعادلُ النقاط
    this.sparks = 0; // عملة الشراء — لا تدخل في الترتيب
    this.connected = true;
    /*
     * بصمةُ الجهاز الذي انضمّ منه. بها يعود اللاعب إلى مجموعته باسمه نفسه
     * لو ضاعت جلسته (خرج ثم دخل، أو مُسحت الجلسة) — كما «Resume as» في
     * كاهوت — ولا ينتحل اسمَه جهازٌ آخر.
     */
    this.deviceId = null;
    /*
     * السوكِتات الحيّة لهذا الفريق — لا تُحفظ على القرص.
     *
     * «متصل» كان رايةً تُنزلها أيُّ قطيعة: يعود الجهاز بسوكِتٍ جديد ثم
     * يصل خبرُ موت القديم متأخراً فيُعلَّم الحاضرُ غائباً. فصار العدُّ هو
     * الحَكَم: متصلٌ ما بقي له سوكِتٌ واحد.
     */
    this.sockets = new Set();
    /* متى انقطع آخرُ سوكِتٍ له — به يُعرف المنقطع حقاً من الرامش */
    this.disconnectedAt = null;
    // يبقى عبر الجولات: لا يُعاد سؤال على الفريق حتى ينفد البنك كله
    this.seen = new Set();
    // عدد مرات شراء كل بطاقة — والحدّ في CARDS[id].limit لكل نوع طوال اللعبة
    this.cardUses = new Map();
    this.pendingMultiplier = 1;
    this.pendingBuys = [];
    /*
     * منتظِرٌ للجولة القادمة: دخل والجولة جارية. لا يُسأل ولا ينزل عدّاده
     * ولا يُحتسب في نقاط الجولة الجارية — ويزول انتظاره عند بدء التالية.
     */
    this.waiting = false;
    this.resetForRound(settings);
  }

  resetForRound(settings) {
    this.timeMs = settings.startSeconds * 1000;
    this.flatlined = false;
    this.flatlinedAt = null;
    this.queue = [];
    this.current = null;
    this.answered = 0;
    this.correct = 0;
    this.lastResult = null; // 'correct' | 'wrong' — لوميض الشاشة
    this.review = []; // أسئلة الجولة بترتيب ظهورها — للمراجعة بعد الانتهاء
    this.lockedMs = 0; // قفل الإجابة المتبقي (تجميد) — يُطبّق عند بدء الجولة
    this.frozenBy = null; // اسم من جمّدك أثناء فترة القفل
    this.dyingAt = null; // بلغ الصفر هنا — وينتظر مهلةَ السكون
    this.dropped = false; // سكن نبضُه وهو منقطع — فلم يُنهِ الجولة على غيره
    this.lateUsed = false; // استُعملت له مهلةُ المتأخّرة في هذه الجولة
    this.streak = 0; // صحيحاتٌ متتالية الآن — والخطأ يصفّرها
    this.streaks = 0; // كم مرّةً بلغت السلسلةُ ثلاثاً — بكلٍّ منها شرارة
    this.shieldLeft = 0;
    this.reviveLeft = 0;
    this.revivedAt = null;
    this.mirror = false;
    this.timeBonusMs = 0; // ما أضافه الوقتُ الإضافي في بدء الجولة — يُعرض شارةً
    this.robbed = []; // من سرق منه هذه الجولة: [{ name, ms }]
    this.robbing = []; // ومن سرق هو منه
    this.duels = []; // معرّفات من يبارزهم في هذه الجولة — تحدّاهم أو تحدّوه
    this.notices = [];
  }
}

export class Room {
  constructor(bankIds, settings = {}, difficulty = DEFAULT_DIFFICULTY, name = '') {
    this.difficulty = normalizeDifficulty(difficulty);
    this.code = makeRoomCode();
    this.name = String(name).trim().slice(0, 40) || this.code;
    this.adminKey = randomUUID();
    this.bankIds = normalizeBankIds(bankIds);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.status = 'lobby'; // lobby | countdown | running | paused | ended | finished
    this.round = 1;
    this.teams = new Map();
    this.lastTickAt = null;
    this.countdownEndsAt = null;
    this.createdAt = Date.now();
    /*
     * لحظةُ انطلاق أول جولة — لا لحظةُ إنشاء الغرفة.
     *
     * بينهما قد تمضي عشرون دقيقة والمنظّم يجمع الناس ويشرح القواعد، وتلك
     * ليست من زمن اللعب. فمدّة الغرفة تُقاس من أول نبضةٍ إلى آخر حركة.
     */
    this.startedAt = null;
    this.touchedAt = Date.now();
    /*
     * كل سؤالٍ عرضته هذه الغرفة، ولو على فريقٍ واحد — بنصّه وخياراته.
     * وهو غير team.seen: ذاك يُمسح إذا نفد البنك على الفريق، وهذا لا
     * ينقص — فهو خبرٌ عن الغرفة لا أداةٌ لمنع التكرار.
     *
     * ونحفظ النصّ لا المعرّف وحده: team.review يُمسح مع كل جولة، فلو لم
     * نحتفظ بها هنا لما استطاع المنظّم أن يراجع أسئلة الجولات الماضية.
     * والترتيب المحفوظ هو ترتيب أول توزيع — فكل فريق يراها بخلطٍ آخر،
     * ولا معنى لأن نحفظ الخلطات كلها.
     */
    this.served = new Map();
    /*
     * فروقٌ تُصرَف إلى القرص كل دورة ثم تُصفَّر: كم عُرض السؤال وكم أُصيب.
     * تُجمع هنا لا تُكتب فوراً، فإجابةٌ واحدة لا تستحقّ لمسةَ قرص.
     */
    this.stats = new Map();
    /* أسئلةٌ بُلّغ عنها في هذه الغرفة — كي لا يُبلّغ المنظّم مرّتين */
    this.reported = new Set();
    /*
     * رقمٌ يتقدّم كلما تبدّل سجلّ الأسئلة. السيرفر يبثّه للمنظّم وحده،
     * ولا يبثّه إلا إذا تقدّم — فلا يُرسل ستّين سطراً أربع مرات في الثانية.
     */
    this.feedVersion = 0;
    this.changedTeams = new Set();
    this.roundBuys = [];
    this.cardEvents = [];
    /* عليها تُبنى الكتابة على القرص: تتبدّل الحالة فتُكتب، وإلا فلا */
    this.dirty = true;
    this.result = null;
    this.breakEndsAt = null; // نهايةُ وقت الشراء بعد كل جولة
    this.lives = 1; // كم نبضاً يسكن فتنتهي الجولة
    this.fallen = []; // أسماءُ من سكن في الجولة الجارية بترتيب سكونهم
    this.history = []; // نتائج كل الجولات السابقة
    /*
     * عدّادٌ لا يرجع: history يُفرَغ عند «البدء من جديد» لأن اللعبة الجديدة
     * لا تعرض جولات سابقة — وسجلّ المالك لا يُفرَّغ معه. فما لُعب في هذه
     * الغرفة يُعدّ هنا مرّةً واحدة ويبقى، وعليه تُكتب rounds في القرص.
     */
    this.playedRounds = 0;
    this.standings = null; // الترتيب النهائي بعد إنهاء اللعبة
    this.revealStep = 0; // كم خطوةً كُشفت من الأسماء الحقيقية بعد الأوائل
    this.displayBlurred = false; // تغبيش الترتيب على شاشة العرض
  }

  touch() {
    this.touchedAt = Date.now();
    this.dirty = true;
  }

  /** يُثبت السؤال في سجلّ الغرفة ويزيد عدّاد عرضه */
  remember(question) {
    if (!this.served.has(question.id)) {
      this.served.set(question.id, {
        id: question.id,
        q: question.q,
        options: question.options,
        answer: question.answer,
        level: question.level,
        ...(question.flag ? { flag: question.flag } : {}),
        at: Date.now(), // أول عرضٍ له — عليه يُرتَّب السجلّ
        shown: 0,
        right: 0,
        wrong: 0,
      });
    }
    this.served.get(question.id).shown++;
    this.bump(question.id, 'shown');
    this.feedVersion++;
  }

  /**
   * سجلّ أسئلة الغرفة كما يراه المنظّم — وحده.
   *
   * لا يمرّ هذا أبداً في publicState: تلك تُبثّ إلى اللاعبين وشاشة القاعة،
   * وفيها هنا موضع الإجابة الصحيحة. قناةُ المنظّم منفصلة لهذا السبب.
   *
   * والصفّ سؤالٌ متمايز لا إجابةُ فريق: ثمانية فرق ترى السؤال نفسه فتصير
   * ثمانية أسطر تُغرق القائمة، بينما «أصابه اثنان من ثمانية» أدلّ على
   * سؤالٍ معطوب من ثمانية أسطر متفرّقة.
   */
  feedState(limit = 60) {
    return [...this.served.values()]
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        q: r.q,
        options: r.options,
        answer: r.answer,
        level: r.level,
        flag: r.flag ?? null,
        shown: r.shown ?? 0,
        right: r.right ?? 0,
        wrong: r.wrong ?? 0,
        reported: this.reported.has(r.id),
      }));
  }

  /** يُعلّم سؤالاً بأنه بُلّغ عنه — والتبليغ لا يُسقطه عن أحد */
  markReported(questionId) {
    if (!this.served.has(questionId)) return false;
    this.reported.add(questionId);
    this.feedVersion++;
    this.touch();
    return true;
  }

  bump(id, field) {
    const tally = this.stats.get(id) ?? { shown: 0, correct: 0, wrong: 0 };
    tally[field]++;
    this.stats.set(id, tally);
  }

  /**
   * يسلّم ما تجمّع من فروق ويُصفّرها.
   *
   * فروقٌ لا أرصدة: القرص يجمعها على ما عنده، فلو كُتبت مرتين لم يتضاعف
   * شيء ولو سقط السيرفر قبل الصرف لم يضِع إلا ثانيتان من العدّ.
   */
  drainStats() {
    if (this.stats.size === 0) return [];
    const out = [];
    for (const [id, tally] of this.stats) {
      const record = this.served.get(id);
      out.push({
        id,
        /* باسم غرفته: به يُطرح نصيبُها يوم تُحذف */
        room: this.code,
        bank: id.includes(':') ? id.slice(0, id.indexOf(':')) : '؟',
        level: record?.level ?? 2,
        text: record?.q ?? '',
        ...tally,
      });
    }
    this.stats.clear();
    return out;
  }

  addTeam(name, deviceId = null, realName = '') {
    const team = new Team(name, this.settings);
    team.deviceId = deviceId;
    team.realName = realName;
    /*
     * من جاء والجولة جارية ينتظر القادمة: لا يُردّ على الباب كما كان —
     * فالمنظّم لا يملك أن يفتح له، واللاعب يقف بلا شاشةٍ ولا خبر — ولا
     * يُدخَل في جولةٍ نصفُها مضى فيأخذ مركزاً بعدّادٍ ممتلئ لم يُنفقه.
     */
    team.waiting = this.midRound();
    this.teams.set(team.id, team);
    this.touch();
    return team;
  }

  /** جولةٌ قائمة: استعدادٌ أو جريانٌ أو إيقاف */
  midRound() {
    return this.status === 'countdown' || this.status === 'running' || this.status === 'paused';
  }

  /**
   * يسحب السؤال التالي للفريق من الأسئلة التي لم يرها بعد.
   * حين ينفد البنك كله يُمسح سجل المرئي ويُعاد الخلط من جديد.
   */
  nextQuestion(team) {
    if (team.queue.length === 0) {
      const pool = poolFor(this.bankIds);
      let fresh = pool.filter((q) => !team.seen.has(q.id));
      if (fresh.length === 0) {
        team.seen.clear();
        fresh = pool;
      }
      team.queue = spreadAnswers(byDifficulty(fresh, this.difficulty).map(dealt));
    }
    team.current = team.queue.shift();
    if (team.current) {
      team.seen.add(team.current.id);
      this.remember(team.current);
    }
    return team.current;
  }

  start() {
    if (this.teams.size === 0) return false;
    /*
     * لعبةٌ أُعلن ترتيبُها لا تُستأنف بجولةٍ سادسة: الأوائل قيلوا والقاعة
     * صفّقت. الطريق الوحيد من finished هو «البدء من جديد» — يُصفّر النقاط
     * صراحةً ويردّ الحال إلى lobby، ثم يُضغط زرُّ البدء.
     */
    if (this.status === 'finished') return false;
    /*
     * ولا يُبتدأ على جولةٍ قائمة: كان البدء وهي تجري يمحو إجاباتها
     * ويردّ العدادات إلى أولها بلا نقاطٍ ولا سجلّ — جولةٌ تتبخّر بضغطة.
     * وإعادةُ الجولة بابها restartRound، وهي تشترط الإيقاف.
     */
    if (this.status === 'countdown' || this.status === 'running' || this.status === 'paused') {
      return false;
    }
    this.startedAt ??= Date.now();
    // البدء بعد نهاية جولة يعني جولة جديدة — بلا خطوة تجهيز منفصلة
    if (this.status === 'ended') this.round++;
    for (const team of this.teams.values()) {
      team.resetForRound(this.settings);
      team.waiting = false;
    }
    this.roundBuys = [];
    for (const team of this.teams.values()) {
      for (const buy of team.pendingBuys) this.roundBuys.push({ ...buy, by: team.id });
      team.pendingBuys = [];
    }
    /* النبضاتُ تُعدّ عند البدء وتثبت: من انضمّ أو خرج أثناءها لا يغيّرها */
    this.lives = livesFor(this.teams.size);
    this.fallen = [];
    this.applyCards(this.roundBuys);
    for (const team of this.teams.values()) this.nextQuestion(team);
    this.result = null;
    // ثلاث ثوانٍ استعداد قبل أن تبدأ العدادات فعلياً
    this.status = 'countdown';
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.lastTickAt = this.countdownEndsAt;
    this.touch();
    return true;
  }

  /**
   * إعادةُ الجولة الحالية من أوّلها — بابُها الإيقاف.
   *
   * عطبٌ يصيب اللعب: جهازُ لاعبٍ يعلّق، أو شبكةٌ تنقطع عن القاعة، أو
   * سؤالٌ يُقرأ بصوتٍ عالٍ سهواً. فيوقف المنظّم الجولة ثم يعيدها: العدادات
   * تعود إلى أولها، والنقاط لم تُحتسب بعد (الاحتساب في نهاية الجولة)،
   * ورقمُ الجولة لا يتقدّم وسجلُّها لا يُكتب — فهي الجولة نفسها تُلعب ثانية.
   *
   * وآثارُ البطاقات التي استُهلكت عند بدء الجولة المُلغاة تُردّ كما كانت:
   * من دفع نقاطه في وقتٍ إضافي يأخذه في الإعادة، ومن جُمّد يُجمَّد.
   */
  restartRound() {
    if (this.status !== 'paused') return false;
    for (const team of this.teams.values()) {
      team.resetForRound(this.settings);
      team.waiting = false;
    }
    this.applyCards(this.roundBuys ?? []);
    for (const team of this.teams.values()) this.nextQuestion(team);
    this.result = null;
    this.lives = livesFor(this.teams.size);
    this.fallen = [];
    this.status = 'countdown';
    this.countdownEndsAt = Date.now() + COUNTDOWN_MS;
    this.lastTickAt = this.countdownEndsAt;
    this.touch();
    return true;
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.touch();
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.lastTickAt = Date.now(); // نتجاهل الوقت المنقضي أثناء الإيقاف
    /* ومهلةُ السكون تُستأنف من أولها: الإيقافُ ليس من وقت أحد */
    for (const team of this.teams.values()) if (team.dyingAt) team.dyingAt = this.lastTickAt;
    this.touch();
  }

  /** يعدّل وقت فريق يدوياً (تدخل المسؤول) */
  adjustTime(teamId, deltaSeconds) {
    const team = this.teams.get(teamId);
    if (!team || team.flatlined) return;
    team.timeMs = this.clampTime(team.timeMs + deltaSeconds * 1000);
    this.touch();
  }

  /** يعدّل نقاط لاعب يدوياً (تدخل المنظّم) */
  adjustScore(teamId, delta) {
    const team = this.teams.get(teamId);
    if (!team) return;
    team.score = Math.max(0, team.score + delta);
    this.touch();
  }

  clampTime(ms) {
    return Math.max(0, Math.min(this.settings.maxSeconds * 1000, ms));
  }

  /**
   * يتحقق من إجابة الفريق ويعدّل وقته. التحقق يتم هنا فقط —
   * الخيار الصحيح لا يغادر السيرفر أبداً.
   */
  answer(teamId, questionId, choice, left = null) {
    const team = this.teams.get(teamId);
    if (this.status === 'ended') return this.lateAnswer(team, questionId, choice);
    if (this.status !== 'running' || !team || team.flatlined) return null;
    if (team.lockedMs > 0) return null; // مقفلة عن الإجابة (تجميد)
    if (!team.current || team.current.id !== questionId) return null; // إجابة متأخرة أو مكررة
    /*
     * في مهلة السكون: لا تُقبل إلا إجابةٌ ضُغطت وشاشةُ صاحبها تقول إن له
     * وقتاً (left: ما كان باقياً على شاشته لحظةَ الضغط). فالإجابةُ التي
     * سبقت الصفر وأخّرتها الشبكة تُحسب، والتي جاءت بعده لا.
     */
    if (team.timeMs === 0 && !(Number(left) > 0)) return null;

    const isCorrect = choice === team.current.answer;
    this.bump(team.current.id, isCorrect ? 'correct' : 'wrong');
    const record = this.served.get(team.current.id);
    if (record) record[isCorrect ? 'right' : 'wrong']++;
    this.feedVersion++;
    team.answered++;
    // نحفظ السؤال بترتيب ظهوره ليراجعه الفريق بعد نهاية الجولة
    team.review.push({
      id: team.current.id,
      q: team.current.q,
      options: team.current.options,
      answer: team.current.answer,
      flag: team.current.flag ?? null,
      choice,
      isCorrect,
    });
    let shielded = false;
    /* السلسلة: كل ثالثةٍ متتالية شرارة — والدرعُ يقي الوقتَ لا السلسلة */
    let streaked = false;
    if (isCorrect) {
      team.correct++;
      /* خصمُه في المبارزة يرى العدّاد يتحرّك — حالُه تُبعث إليه في النبضة القادمة */
      for (const id of team.duels) this.changedTeams.add(id);
      team.streak++;
      if (team.streak % STREAK_EVERY === 0) {
        team.streaks++;
        streaked = true;
      }
      team.timeMs = this.clampTime(team.timeMs + this.settings.correctBonus * 1000);
    } else {
      team.streak = 0;
      if (team.shieldLeft > 0) {
        team.shieldLeft--;
        shielded = true;
      } else {
        team.timeMs = this.clampTime(team.timeMs - this.settings.wrongPenalty * 1000);
      }
    }
    team.lastResult = isCorrect ? 'correct' : 'wrong';
    if (team.timeMs > 0) team.dyingAt = null; // نجا من مهلة السكون
    this.touch();

    /*
     * الكشف عن موضع الصواب يُرسل مع النتيجة لا قبلها: اللاعب أجاب فعلاً،
     * فلم يعد في إخفائه فائدة — وفي كشفه تعليمٌ يُذكَر. ونحفظه قبل سحب
     * السؤال التالي لأن team.current يتبدّل بعد سطرين.
     */
    const reveal = { questionId: team.current.id, answer: team.current.answer };

    const streak = { streak: team.streak, streaked, shieldLeft: team.shieldLeft };

    let revived = false;
    if (team.timeMs === 0) {
      revived = this.revive(team);
      if (!revived) {
        this.flatline(team);
        return { isCorrect, flatlined: true, shielded, ...streak, ...reveal };
      }
    }

    this.nextQuestion(team);
    return { isCorrect, flatlined: false, shielded, revived, ...streak, ...reveal };
  }

  /**
   * إجابةٌ وصلت بعد نهاية الجولة بأقلّ من مهلة المتأخّرة.
   *
   * الجولة انتهت بسكون غيره وإجابتُه في الطريق. لا وقتَ يُعدَّل — الجولة
   * انتهت — وإنما نقطةُ الصواب تُضاف إلى جائزته ورصيده، مضروبةً في مضاعِفه
   * كما لو وصلت قبل النهاية. ومرّةً واحدة في الجولة.
   */
  lateAnswer(team, questionId, choice) {
    if (!team || team.flatlined || team.waiting || team.lateUsed) return null;
    if (!this.endedAt || Date.now() - this.endedAt > LATE_ANSWER_MS) return null;
    if (!team.current || team.current.id !== questionId) return null;
    team.lateUsed = true;

    const isCorrect = choice === team.current.answer;
    this.bump(team.current.id, isCorrect ? 'correct' : 'wrong');
    const record = this.served.get(team.current.id);
    if (record) record[isCorrect ? 'right' : 'wrong']++;
    this.feedVersion++;
    team.answered++;
    team.review.push({
      id: team.current.id,
      q: team.current.q,
      options: team.current.options,
      answer: team.current.answer,
      flag: team.current.flag ?? null,
      choice,
      isCorrect,
    });
    if (isCorrect) {
      team.correct++;
      const award = this.result?.awards.find((a) => a.teamId === team.id);
      if (award) {
        const factor = award.factor ?? 1;
        award.points += factor;
        award.base += 1;
        award.correct = (award.correct ?? 0) + 1;
        award.doubled = factor > 1;
        team.score += factor;
      }
    }
    team.lastResult = isCorrect ? 'correct' : 'wrong';
    const reveal = { questionId: team.current.id, answer: team.current.answer };
    team.current = null;
    this.touch();
    return { isCorrect, flatlined: false, late: true, ...reveal };
  }

  flatline(team) {
    if (team.flatlined) return;
    this.fall(team);
    if (this.fallen.length >= this.lives) this.endRound();
  }

  /**
   * سكونٌ يُحسب من نبضات الجولة: يُسكَن الفريق ويُكتب اسمُه في الساقطين —
   * فتنكسر نبضةٌ على كل شاشة. ومن بقي يُبعث إليه الخبر كذلك، فمربّعاتُ
   * ترويسته تنقص معه.
   */
  fall(team) {
    this.stop(team);
    this.fallen.push(team.name);
    for (const t of this.teams.values()) this.changedTeams.add(t.id);
  }

  /** يُسكِن نبض فريقٍ بلا إنهاء الجولة — تُنهيها الدالةُ المستدعية مرّةً واحدة */
  stop(team) {
    this.changedTeams.add(team.id);
    team.flatlined = true;
    team.flatlinedAt = Date.now();
    team.current = null;
  }

  /** نبضة السيرفر: هي المرجع الوحيد للوقت — المتصفح يعرض فقط */
  tick(now = Date.now()) {
    // مرحلة الاستعداد: نبثّ العد التنازلي دون أن تنقص عدادات الفرق
    if (this.status === 'countdown') {
      if (now >= this.countdownEndsAt) {
        this.status = 'running';
        this.lastTickAt = now;
      }
      return true;
    }
    if (this.status !== 'running') return false;
    const elapsed = now - this.lastTickAt;
    this.lastTickAt = now;

    /*
     * من نفد وقته في هذه النبضة سكن نبضه — كلُّهم لا أوّلُهم.
     *
     * كان يُسكَّن أولُ من يُصادَف في الطابور ويُنهى الجولة، فيبقى الآخر
     * الذي نفد وقته في النبضة نفسها «حيّاً» بوقتٍ صفر: فيُحسب في الناجين
     * وينال نقاط مركزٍ ويحتفظ بمضاعِفه. وإنهاءُ الجولة يبقى مرّةً واحدة
     * بعد الحلقة، فلا تُحتسب النقاط ولا يُكتب السجلّ مرّتين.
     */
    for (const team of this.teams.values()) {
      if (team.flatlined || team.waiting) continue;
      // فترة التجميد: العدّاد ينزل لكن الإجابة مقفلة
      if (team.lockedMs > 0) {
        team.lockedMs = Math.max(0, team.lockedMs - elapsed);
        if (team.lockedMs === 0) team.frozenBy = null;
      }
      team.timeMs = Math.max(0, team.timeMs - elapsed);
      if (team.timeMs > 0) continue;
      if (this.revive(team, now)) continue;

      /*
       * المنقطعُ يسكن ولا يُنهي الجولة على غيره.
       *
       * «أوّلُ نبضٍ يسكن يُنهي الجولة» قاعدةٌ عن اللعب لا عن الشبكة: بمئة
       * جوّالٍ على واي فاي القاعة يكفي أن ينقطع نتُّ واحدٍ عشرين ثانية
       * فتنتهي الجولةُ على تسعةٍ وتسعين يلعبون. فمن نفد وقتُه وهو غائبٌ
       * خرج من الجولة وحده — ولا يُوقَف عدّادُه وهو غائب، وإلا صار
       * إطفاءُ النت حيلةً لحبس الوقت.
       */
      if (this.isOffline(team, now)) {
        this.stop(team);
        team.dropped = true;
        continue;
      }
      team.dyingAt ??= now;
      if (now - team.dyingAt >= FLATLINE_GRACE_MS) this.fall(team);
    }
    if (this.fallen.length >= this.lives || this.noneAlive()) this.endRound();
    return true;
  }

  /** غائبٌ حقاً: لا سوكِت له منذ أكثر من مهلة الانقطاع */
  isOffline(team, now = Date.now()) {
    return !team.connected && team.disconnectedAt !== null && now - team.disconnectedAt > OFFLINE_AFTER_MS;
  }

  /* لم يبق في الجولة نبضٌ حيّ — سكنوا كلُّهم منقطعين — فلا جولةَ تُنتظر */
  noneAlive() {
    for (const team of this.teams.values()) {
      if (!team.waiting && !team.flatlined) return false;
    }
    return true;
  }

  /**
   * توقف أول نبض ينهي الجولة للجميع.
   *
   * حصيلة اللاعب = نقطةٌ عن كل إجابة صحيحة + نصيبُه من الترتيب
   * (مع N لاعبين: الأول N-1، ثم N-2 …) ثم يُضرب الكل في
   * مضاعِفه إن كان اشترى المضاعفة. ومن توقّف نبضه صفرٌ كلُّه.
   *
   * ولا تُضاف هذه النقاط إلى الرصيد إلا هنا — عند انتهاء الجولة — فلا
   * يرى اللاعب رصيده يتضخّم وهو يجيب، ولا ينفق ما لم يُحصّله بعد.
   */
  endRound() {
    /*
     * حرزٌ: جولةٌ انتهت لا تنتهي مرّتين. لو استُدعيت ثانيةً لأُضيفت
     * النقاط إلى الأرصدة من جديد وكُتب السجلّ سطرين.
     */
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endedAt = Date.now(); // تبدأ منها مهلةُ المتأخّرة
    this.breakEndsAt = this.endedAt + BREAK_MS;
    /* المنتظِرون لم يلعبوا هذه الجولة: لا جائزةَ لهم ولا يُعدّون في المراكز */
    const teams = [...this.teams.values()].filter((t) => !t.waiting);
    const survivors = teams.filter((t) => !t.flatlined).sort((a, b) => b.timeMs - a.timeMs);

    /*
     * نقاط الفوز للصامدين وحدهم: من سكن نبضه لا يأخذ شيئاً ولا عن إجاباته
     * الصحيحة — فالجولة تُكسب بالبقاء حتى آخرها، لا بما أُصيب قبل السقوط.
     * والمضاعفةُ تضرب نقاط الصامد، وتسقط مع من سكن.
     *
     * والشرارات لا يمسّها السكون: شرارات المشاركة والسلاسل لمن لعب.
     */
    const credit = (team, base, extra, alive = true) => {
      const raw = alive ? base + team.correct : 0;
      const betting = team.pendingMultiplier > 1;
      const factor = alive ? team.pendingMultiplier : 1;
      const points = raw * factor;
      team.score += points;
      team.totalCorrect += team.correct;
      const sparks = SPARK_BASE + STREAK_SPARKS * team.streaks;
      team.sparks += sparks;
      return {
        teamId: team.id,
        name: team.name,
        points,
        /* الأصلُ قبل الضرب: به تُقرأ المعادلة «٤ × ٢ = ٨» على شاشة اللاعب */
        base: raw,
        correct: team.correct, // كم منها جاء من الإجابات — يُقرأ في المراجعة
        doubled: factor > 1 && raw > 0,
        burned: (betting && !alive) || undefined, // سقطت مضاعفته بسكون نبضه
        factor, // تُضرب فيه نقطةُ إجابةٍ وصلت متأخرة
        sparks,
        streaks: team.streaks,
        dropped: team.dropped || undefined, // سكن وهو منقطع — لم يُنهِ الجولة
        ...extra,
      };
    };

    /*
     * نقاط المركز لها سقف: بعشرين فريقاً كان الأول يأخذ تسع عشرة نقطة
     * والتاسع عشر نقطةً واحدة، فتغلب المصادفةُ الإجابةَ ويصير ترتيبُ
     * الوقت هو اللعبة كلها. فالسقف خمس، وما دونها ينزل واحدةً واحدةً
     * حتى الواحدة ويستقرّ عندها: 5-4-3-2-1-1-…-1، ومن توقّف نبضه صفر.
     *
     * وإن كانوا أقلّ من ستّة فالأول يأخذ «عددهم ناقص واحد» كما كان.
     */
    const cap = Math.min(5, teams.length - 1);
    const rankPoints = (index) => Math.max(cap > 0 ? 1 : 0, cap - index);

    const awards = [];
    survivors.forEach((team, index) => {
      awards.push(
        credit(team, rankPoints(index), {
          timeMs: Math.round(team.timeMs),
          top: index === 0, // صاحب أعلى وقت — يُميَّز بالأخضر
        }),
      );
    });
    for (const team of teams.filter((t) => t.flatlined)) {
      awards.push(credit(team, 0, { timeMs: 0, flatlined: true }, false));
    }
    // المضاعِف يُستهلك بانتهاء الجولة
    for (const team of teams) team.pendingMultiplier = 1;
    this.settleDuels(awards);

    this.result = { round: this.round, awards };
    this.history.push(this.result);
    this.playedRounds++;
    this.touch();
  }

  /**
   * المبارزات تُحسم بنهاية الجولة: إن أصاب المتحدّي أكثر سرق من خصمه خمس
   * نقاط (أو ما بقي له إن كان دونها). وإن لم يغلبه فلا شيء على أحد: الخصمُ
   * صدّ التحدّي، والمتحدّي خسر ثمن البطاقة وحده. ونقاطُها بعد المضاعفة —
   * فالمبارزة لا تُضاعَف ولا يُحرقها سكونُ النبض.
   */
  settleDuels(awards) {
    const awardOf = (team) => awards.find((a) => a.teamId === team.id);
    for (const buy of this.roundBuys ?? []) {
      if (buy.card !== 'duel') continue;
      const a = this.teams.get(buy.by);
      const b = this.teams.get(buy.targetId);
      if (!a || !b || a.waiting || b.waiting) continue;
      const won = a.correct > b.correct;
      const take = won ? Math.min(DUEL_POINTS, b.score) : 0;
      const tie = a.correct === b.correct;
      for (const [me, rival, delta] of [
        [a, b, take],
        [b, a, -take],
      ]) {
        me.score += delta;
        const award = awardOf(me);
        if (!award) continue;
        award.points += delta;
        award.duelPoints = (award.duelPoints ?? 0) + delta;
        award.duels = [
          ...(award.duels ?? []),
          {
            rival: rival.name,
            mine: me.correct,
            theirs: rival.correct,
            /* للمتحدّي: غلب أو لم يغلب. وللخصم: صدّ أو سُرق منه */
            won: tie ? null : me === a ? won : !won,
            challenger: me === a,
            points: delta,
          },
        ];
      }
    }
  }

  /** إنهاء اللعبة كلياً وإعلان الأوائل حسب مجموع النقاط */
  finish() {
    this.status = 'finished';
    this.standings = [...this.teams.values()]
      .sort((a, b) => b.score - a.score || b.totalCorrect - a.totalCorrect)
      .map((team) => ({
        teamId: team.id,
        name: team.name,
        score: team.score,
        rank: this.rankOf(team),
      }));
    this.revealStep = 0;
    this.touch();
  }

  /**
   * كشفُ الأسماء على مراحل يقودها المنظّم: الثالثُ ثم الثاني ثم الأول —
   * كلٌّ بضغطة، فيصعد الترقّب إلى البطل — ثم البقيّةُ دفعةً واحدة. ستون
   * اسماً واحداً واحداً تُملّ القاعة.
   */
  revealPlan() {
    const ids = (this.standings ?? []).map((s) => s.teamId);
    const top = Math.min(3, ids.length);
    const steps = [];
    for (let i = top - 1; i >= 0; i--) steps.push([ids[i]]);
    if (ids.length > 3) steps.push(ids.slice(3));
    return steps;
  }

  revealNext() {
    if (this.status !== 'finished') return false;
    if (this.revealStep >= this.revealPlan().length) return false;
    this.revealStep++;
    this.touch();
    return true;
  }

  /** ما كُشف وحده يُرسل: اسمُ من لم يُكشف بعد لا يغادر السيرفر */
  revealState() {
    if (this.status !== 'finished' || !this.standings) return null;
    const plan = this.revealPlan();
    const names = {};
    for (const id of plan.slice(0, this.revealStep).flat()) {
      names[id] = this.teams.get(id)?.realName ?? '';
    }
    const latest = this.revealStep > 0 ? plan[this.revealStep - 1] : [];
    return { step: this.revealStep, total: plan.length, names, latest };
  }

  /** الأسماءُ الحقيقية كلها — لقناة المنظّم وحدها */
  realNames() {
    return Object.fromEntries([...this.teams.values()].map((t) => [t.id, t.realName]));
  }

  newRound() {
    this.round++;
    this.status = 'lobby';
    this.result = null;
    for (const team of this.teams.values()) team.resetForRound(this.settings);
    this.touch();
  }

  /**
   * بدءٌ من جديد: اللعبة تعود إلى أولها في الغرفة نفسها.
   *
   * النقاط والجولات وبطاقات اللاعبين تعود صفراً — أما playedRounds وserved
   * فيبقيان: هما سجلُّ المالك عن هذه الغرفة، وما لُعب فيها قد لُعب. ولا
   * تبدأ الجولة هنا: الحالة تصير lobby وينتظر زرَّ المنظّم.
   */
  resetAll() {
    this.round = 1;
    this.status = 'lobby';
    this.result = null;
    this.history = [];
    this.standings = null;
    this.revealStep = 0;
    for (const team of this.teams.values()) {
      team.score = 0;
      team.totalCorrect = 0;
      team.sparks = 0;
      team.seen.clear(); // لعبة جديدة تماماً — كل الأسئلة متاحة من جديد
      team.cardUses.clear(); // البطاقات تعود متاحة
      team.pendingMultiplier = 1;
      team.pendingBuys = [];
      team.resetForRound(this.settings);
    }
    this.touch();
  }

  /**
   * شراء بطاقة بين الجولات. تُخصم النقاط فوراً، ويُطبَّق أثرها في الجولة التالية.
   * لكل نوعٍ حدٌّ من المرات طوال اللعبة.
   */
  buyCard(teamId, cardId, targetId) {
    const team = this.teams.get(teamId);
    if (!team) return { ok: false, error: 'اللاعب غير موجود' };
    if (this.status !== 'ended') {
      return { ok: false, error: 'الشراء متاح بين الجولات فقط' };
    }
    if (this.breakEndsAt && this.breakRemaining() === 0) {
      return { ok: false, error: 'انتهى وقت الشراء' };
    }
    const card = CARDS[cardId];
    if (!card) return { ok: false, error: 'بطاقة غير معروفة' };
    if ((team.cardUses.get(cardId) ?? 0) >= card.limit) {
      return { ok: false, error: 'استنفدت هذه البطاقة' };
    }
    if (team.sparks < card.price) return { ok: false, error: 'شراراتك لا تكفي' };

    if (card.target) {
      const target = this.teams.get(targetId);
      if (!target || target.id === team.id) return { ok: false, error: 'اختر لاعباً آخر' };
      /* المبارزة تصعد ولا تنزل: لا يستقوي المتقدّم على من خلفه */
      if (card.upward && target.score <= team.score) {
        return { ok: false, error: 'تُبارز من هو أعلى منك في النقاط فقط' };
      }
      if (cardId === 'duel' && this.duelOn(target.id, team.id)) {
        return { ok: false, error: `${target.name} تحدّاه غيرك لهذه الجولة` };
      }
      if (team.pendingBuys.some((buy) => buy.card === cardId && buy.targetId === targetId)) {
        return { ok: false, error: `اخترتَ ${target.name} لهذه البطاقة` };
      }
    } else if (!card.stack && team.pendingBuys.some((buy) => buy.card === cardId)) {
      return { ok: false, error: 'اشتريتها للجولة القادمة' };
    }

    team.sparks -= card.price;
    team.cardUses.set(cardId, (team.cardUses.get(cardId) ?? 0) + 1);
    team.pendingBuys.push({
      card: cardId,
      price: card.price,
      targetId: card.target ? targetId : null,
    });
    this.touch();
    return { ok: true };
  }

  /**
   * هل تحدّى أحدٌ (غيرُ هذا) هذا اللاعبَ للجولة القادمة؟
   *
   * لاعبٌ واحد يُتحدّى مرّةً في الجولة: كانت المبارزة تُسرق بها خمسٌ لكل
   * متحدٍّ غالب، فيتكالب على المتصدّر ثلاثةٌ أو أربعة فيخسر عشرين نقطةً
   * في جولة. فأوّلُ من يتحدّاه يحجزه، ومن بعده يرى اسمه محجوزاً.
   */
  duelOn(targetId, exceptId = null) {
    for (const team of this.teams.values()) {
      if (team.id === exceptId) continue;
      if (team.pendingBuys.some((buy) => buy.card === 'duel' && buy.targetId === targetId)) return true;
    }
    return false;
  }

  /** ما بقي من وقت الشراء — صفرٌ خارج الاستراحة أو بعد انقضائها */
  breakRemaining(now = Date.now()) {
    if (this.status !== 'ended' || !this.breakEndsAt) return 0;
    return Math.max(0, this.breakEndsAt - now);
  }

  applyCards(buys) {
    const mine = (team, card) => buys.filter((buy) => buy.by === team.id && buy.card === card).length;
    /*
     * بطاقاتُ اللاعب على نفسه تُقال له عند البدء — في شاشة الاستعداد مع
     * ما وقع عليه من غيره — فيعرف بماذا يدخل الجولة.
     */
    for (const team of this.teams.values()) {
      const extra = mine(team, 'time') * TIME_CARD_MS;
      team.timeBonusMs = extra;
      if (extra) {
        team.timeMs = this.clampTime(team.timeMs + extra);
        team.notices.push(`وقتك الإضافي: +${toArabic(extra / 1000)} ث`);
      }
      team.shieldLeft = mine(team, 'shield') ? SHIELD_HITS : 0;
      if (team.shieldLeft) team.notices.push(`درعك يقيك ${toArabic(SHIELD_HITS)} أخطاء`);
      team.reviveLeft = mine(team, 'revive') ? 1 : 0;
      if (team.reviveLeft) team.notices.push('صاعق القلب جاهز إن توقّف نبضك');
      team.pendingMultiplier = mine(team, 'double') ? DOUBLE_FACTOR : 1;
      if (team.pendingMultiplier > 1) team.notices.push('المضاعفة فعّالة: اصمد تتضاعف نقاطك');
      team.mirror = mine(team, 'mirror') > 0;
      team.duels = [];
    }

    const events = [];
    const freezers = new Map();

    /* المبارزة لا تُردّ بمرآة: هي تحدٍّ يلعبه الاثنان، لا ضربةٌ تقع على أحدهما */
    for (const buy of buys) {
      if (buy.card !== 'duel') continue;
      const challenger = this.teams.get(buy.by);
      const rival = this.teams.get(buy.targetId);
      if (!challenger || !rival) continue;
      challenger.duels.push(rival.id);
      rival.duels.push(challenger.id);
      const stake = toArabic(DUEL_POINTS);
      challenger.notices.push(`تبارز ${rival.name}: أصب أكثر منه تسرق ${stake} نقاط`);
      rival.notices.push(`${challenger.name} يبارزك: لا تدعه يُصب أكثر منك`);
      events.push({ kind: 'duel', card: 'duel', by: challenger.name, on: rival.name });
    }

    for (const buy of buys) {
      if (!ATTACK_VERB[buy.card]) continue;
      const attacker = this.teams.get(buy.by);
      const target = this.teams.get(buy.targetId);
      if (!attacker || !target) continue;
      const verb = ATTACK_VERB[buy.card];

      let source = attacker;
      let victim = target;
      if (target.mirror) {
        /* مرآتان متقابلتان: الضربة تتردّد بينهما ثم تضيع */
        if (attacker.mirror) {
          target.notices.push(`مرآتك ومرآةُ ${attacker.name} تقابلتا، فضاع ${own(verb, 'ه')}`);
          attacker.notices.push(`مرآتك ومرآةُ ${target.name} تقابلتا، فضاع ${own(verb, 'ك')}`);
          events.push({ kind: 'blocked', card: buy.card, by: attacker.name, on: target.name });
          continue;
        }
        target.notices.push(`مرآتك ردّت ${verb} ${attacker.name} عليه`);
        attacker.notices.push(`مرآةُ ${target.name} ردّت ${own(verb, 'ك')} عليك`);
        events.push({ kind: 'reflected', card: buy.card, by: attacker.name, on: target.name });
        source = target;
        victim = attacker;
      }

      if (buy.card === 'freeze') {
        victim.lockedMs = Math.min(FREEZE_CAP_MS, victim.lockedMs + FREEZE_MS);
        const names = freezers.get(victim.id) ?? [];
        if (!names.includes(source.name)) names.push(source.name);
        freezers.set(victim.id, names);
        victim.frozenBy = names.join(' و');
        if (source === attacker) attacker.notices.push(`جمّدتَ ${victim.name}`);
        events.push({ kind: 'hit', card: 'freeze', by: source.name, on: victim.name });
      } else if (buy.card === 'steal') {
        const take = Math.max(0, Math.min(STEAL_MS, victim.timeMs - STEAL_FLOOR_MS));
        if (take === 0) {
          source.notices.push(`لم يبقَ عند ${victim.name} ما يُسرق`);
          continue;
        }
        victim.timeMs -= take;
        source.timeMs = this.clampTime(source.timeMs + take);
        victim.robbed.push({ name: source.name, ms: take });
        source.robbing.push({ name: victim.name, ms: take });
        const secs = toArabic(Math.round(take / 1000));
        victim.notices.push(`سرق ${source.name} ${secs} ث من نبضك`);
        source.notices.push(`سرقتَ ${secs} ث من ${victim.name}`);
        events.push({ kind: 'hit', card: 'steal', by: source.name, on: victim.name, secs });
      }
    }
    this.cardEvents = events;
    for (const [teamId, names] of freezers) {
      const victim = this.teams.get(teamId);
      if (victim) victim.notices.push(`جمّدك ${names.join(' و')}`);
    }
  }

  revive(team, now = Date.now()) {
    if (team.reviveLeft <= 0) return false;
    team.reviveLeft = 0;
    team.timeMs = REVIVE_MS;
    team.dyingAt = null;
    team.revivedAt = now;
    team.notices.push('صاعق القلب أعاد نبضك');
    this.changedTeams.add(team.id);
    this.touch();
    return true;
  }

  /** يفتح البطاقات من جديد لكل المجموعات — يستطيعون شراءها مرة أخرى */
  reopenCards() {
    for (const team of this.teams.values()) team.cardUses.clear();
    this.touch();
  }

  /** فريقٌ بهذا الاسم انضمّ من هذا الجهاز نفسه — فيُعاد إليه لا يُرفض */
  teamOfDevice(name, deviceId) {
    if (!deviceId) return null;
    for (const team of this.teams.values()) {
      if (team.name === name && team.deviceId === deviceId) return team;
    }
    return null;
  }

  removeTeam(teamId) {
    this.teams.delete(teamId);
    this.touch();
  }

  countdownRemaining() {
    if (this.status !== 'countdown') return 0;
    return Math.max(0, this.countdownEndsAt - Date.now());
  }

  /** اللقطة العامة — تذهب للمسؤول وشاشة العرض. بلا أسئلة أو إجابات. */
  publicState() {
    return {
      code: this.code,
      name: this.name,
      status: this.status,
      round: this.round,
      bankIds: this.bankIds,
      difficulty: this.difficulty,
      settings: this.settings,
      /* روستر البطاقات: اسمها وحدّها — تقرؤه لوحةُ المنظّم فلا تُكرّر الأسماء */
      cards: Object.entries(CARDS).map(([id, card]) => ({
        id,
        name: card.name,
        limit: card.limit,
      })),
      result: this.present(this.result),
      history: this.history.map((round) => this.present(round)),
      cardEvents: this.status === 'countdown' || this.status === 'running' ? (this.cardEvents ?? []) : [],
      standings: this.standings,
      reveal: this.revealState(),
      displayBlurred: this.displayBlurred,
      countdownMs: this.countdownRemaining(),
      breakMs: this.breakRemaining(),
      teams: [...this.teams.values()]
        .map((t) => ({
          id: t.id,
          name: t.name,
          timeMs: Math.round(t.timeMs),
          score: t.score,
          flatlined: t.flatlined,
          dropped: t.dropped, // سكن وهو منقطع — لا يُسمّى فيمن أنهى الجولة
          connected: t.connected,
          answered: t.answered,
          correct: t.correct,
          locked: t.lockedMs > 0, // مجمّدة حالياً — تظهر ❄️ على شاشة العرض
          lockedMs: Math.round(t.lockedMs), // المتبقي من التجميد — لعدّاد الشاشات
          frozenBy: t.lockedMs > 0 ? t.frozenBy : null, // من جمّدها — تذكره القاعة والمنظّم
          doubled: t.pendingMultiplier > 1, // مضاعفة فعّالة هذه الجولة — بطاقة ذهبية
          shieldLeft: t.shieldLeft,
          reviveLeft: t.reviveLeft,
          revivedAt: t.revivedAt,
          sparks: t.sparks,
          rank: this.rankOf(t),
          totalCorrect: t.totalCorrect,
          effects: this.effectsOf(t), // شاراتُ البطاقات الفاعلة — تُرسم على كل شاشة بالشكل نفسه
          waiting: t.waiting, // دخل والجولة جارية — ينتظر القادمة
          cardsLeft: this.cardsLeftFor(t), // ما بقي له من كل بطاقة — للوحة المنظّم
        }))
        .sort((a, b) => b.score - a.score || b.totalCorrect - a.totalCorrect),
      lives: this.lives,
      fallen: this.fallen,
    };
  }

  /**
   * مركزُ الفريق في نقاط الفوز، والتعادلُ يُكسر بمجموع الإجابات الصحيحة —
   * ومن تساويا فيهما معاً ففي المركز نفسه.
   */
  rankOf(team) {
    let above = 0;
    for (const t of this.teams.values()) if (ahead(t, team)) above++;
    return above + 1;
  }

  /**
   * شاراتُ ما يحمله الفريق من بطاقاتٍ في الجولة الجارية.
   *
   * قائمةٌ واحدة تقرؤها الشاشات الثلاث (اللاعب والمنظّم والعرض) فلا يحسب
   * كلٌّ منها أثرَ البطاقات بطريقته. والتجميد والمضاعفة لهما زيّهما
   * الخاص على الصفّ (صقيعٌ وذهب)، فلا يُكرَّران هنا.
   */
  effectsOf(team) {
    const fx = [];
    if (team.timeBonusMs) fx.push({ card: 'time', n: Math.round(team.timeBonusMs / 1000) });
    if (team.shieldLeft) fx.push({ card: 'shield', n: team.shieldLeft });
    if (team.reviveLeft) fx.push({ card: 'revive' });
    if (team.mirror) fx.push({ card: 'mirror' });
    for (const r of team.robbed) fx.push({ card: 'steal', n: -Math.round(r.ms / 1000), who: r.name });
    for (const r of team.robbing) fx.push({ card: 'steal', n: Math.round(r.ms / 1000), who: r.name });
    for (const id of team.duels) {
      const rival = this.teams.get(id);
      if (rival) fx.push({ card: 'duel', who: rival.name, mine: team.correct, theirs: rival.correct });
    }
    return fx;
  }

  /**
   * جوائزُ جولةٍ مقصورةً على الحاضرين.
   *
   * المجموعة التي دخلت وخرجت لا مكان لها في السجلّ: المنظّم يقرأ السجلّ
   * ليعلن ويقارن، فسطرُ من ليس في القاعة ضجيجٌ يُشغل ويُربك. ولا يُمحى من
   * التاريخ شيء — history على حاله في الذاكرة والقرص، وإنما يُصفّى عند
   * البثّ، فمن رجع رجع سطرُه معه.
   */
  present(round) {
    if (!round) return null;
    return { ...round, awards: round.awards.filter((a) => this.teams.has(a.teamId)) };
  }

  /** ما بقي لفريقٍ من كل بطاقة — عدداً لا أسماء، فاللوحة تُبثّ أربع مرّات في الثانية */
  cardsLeftFor(team) {
    const left = {};
    for (const [id, card] of Object.entries(CARDS)) {
      left[id] = card.limit - (team.cardUses.get(id) ?? 0);
    }
    return left;
  }

  /**
   * نقضُ شراءٍ ما دامت الجولة لم تبدأ.
   *
   * الضغطةُ على هاتفٍ في قاعةٍ مظلمة تُخطئ، وستُّ شراراتٍ دخلُ جولةٍ كاملة
   * للاعبٍ متوسّط — فمن دفعها بالخطأ خسر جولةً بلا لعب. والبابُ مفتوحٌ
   * ما دام الأثرُ مؤجَّلاً: فإذا بدأت الجولةُ وقع الأثرُ وأُغلق الباب.
   *
   * ويُنقض الأحدثُ فالأحدث: من اشترى «وقتاً إضافياً» مرّتين يستردّ واحدة.
   */
  refundCard(teamId, cardId) {
    const team = this.teams.get(teamId);
    if (!team) return { ok: false, error: 'اللاعب غير موجود' };
    if (this.status !== 'ended') {
      return { ok: false, error: 'النقض متاح بين الجولات فقط' };
    }
    if (this.breakEndsAt && this.breakRemaining() === 0) {
      return { ok: false, error: 'انتهى وقت الشراء' };
    }
    const at = team.pendingBuys.findLastIndex((buy) => buy.card === cardId);
    if (at === -1) return { ok: false, error: 'لم تشترِ هذه البطاقة في هذه الفترة' };

    const [buy] = team.pendingBuys.splice(at, 1);

    team.sparks += buy.price;
    const used = team.cardUses.get(cardId) ?? 0;
    team.cardUses.set(cardId, Math.max(0, used - 1));
    this.touch();
    return { ok: true, card: cardId, price: buy.price };
  }

  /** ما يراه فريق واحد — السؤال بلا حقل answer */
  teamState(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    const award = this.result?.awards.find((a) => a.teamId === teamId);
    return {
      id: team.id,
      name: team.name,
      timeMs: Math.round(team.timeMs),
      score: team.score,
      sparks: team.sparks,
      /* مركزُه في نقاط الفوز ومن كم — «الثالث من اثني عشر» يُقرأ في ترويسته */
      rank: this.rankOf(team),
      teamsCount: this.teams.size,
      lives: this.lives,
      fallen: this.fallen,
      streak: team.streak,
      flatlined: team.flatlined,
      dropped: team.dropped,
      waiting: team.waiting, // دخل والجولة جارية — شاشتُه «انتظر الجولة القادمة»
      lastResult: team.lastResult,
      status: this.status,
      round: this.round,
      bonus: this.settings.correctBonus,
      penalty: this.settings.wrongPenalty,
      countdownMs: this.countdownRemaining(),
      breakMs: this.breakRemaining(),
      standings: this.standings,
      answered: team.answered,
      correct: team.correct,
      // نقاط هذه الجولة تحديداً — تُعرض في رسالة نهاية الجولة
      roundPoints: award?.points ?? null,
      /* وأصلُها ومضاعِفُها: تُقرأ المعادلة لا الحصيلةُ وحدها */
      roundBase: award?.base ?? null,
      roundDoubled: Boolean(award?.doubled),
      roundBurned: Boolean(award?.burned),
      roundSparks: award?.sparks ?? null,
      roundStreaks: award?.streaks ?? 0,
      roundDuelPoints: award?.duelPoints ?? 0,
      roundDuels: award?.duels ?? [],
      question:
        this.status === 'running' && team.current
          ? {
              id: team.current.id,
              q: team.current.q,
              options: team.current.options,
              flag: team.current.flag ?? null,
            }
          : null,
      // المراجعة تحمل الإجابات الصحيحة — لا تُرسل إلا بعد انتهاء الجولة
      review: this.status === 'ended' ? team.review : null,
      // حالة القفل الحالية (تجميد)
      lockedMs: Math.round(team.lockedMs),
      frozenBy: team.frozenBy,
      shieldLeft: team.shieldLeft,
      reviveLeft: team.reviveLeft,
      revivedAt: team.revivedAt,
      effects: this.effectsOf(team),
      doubled: team.pendingMultiplier > 1, // مضاعفةٌ فعّالة في الجولة الجارية
      notices: team.notices,
      // متجر البطاقات: متاح بين الجولات فقط
      shop: this.shopFor(team),
    };
  }

  /** حالة متجر البطاقات لفريق: ما اشتراه، وما يقدر عليه، ومن يجمّد */
  shopFor(team) {
    const open = this.status === 'ended'; // بين الجولات فقط — وبعد انقضاء وقته يُرى مقفلاً
    const cards = Object.entries(CARDS).map(([id, card]) => ({
      id,
      name: card.name,
      price: card.price,
      used: (team.cardUses.get(id) ?? 0) >= card.limit,
      left: card.limit - (team.cardUses.get(id) ?? 0),
      affordable: team.sparks >= card.price,
      target: Boolean(card.target),
      upward: Boolean(card.upward), // لا يُختار لها إلا من هو أعلى في النقاط
      /* كم مرّةً اشتُريت في هذه الفترة — وبها وحدها يظهر زرُّ النقض */
      bought: team.pendingBuys.filter((buy) => buy.card === id).length,
    }));
    const pending = Object.fromEntries(
      Object.keys(CARDS).map((id) => [id, team.pendingBuys.some((buy) => buy.card === id)]),
    );
    const chosen = Object.fromEntries(
      Object.keys(CARDS)
        .filter((id) => CARDS[id].target)
        .map((id) => [
          id,
          team.pendingBuys.filter((buy) => buy.card === id).map((buy) => buy.targetId),
        ]),
    );
    // خصوم يمكن تجميدهم (كل الفرق عداه)
    /* قائمةُ الخصوم لا تُقرأ إلا والمتجر مفتوح — فلا تُحمل في كل بثٍّ أثناء اللعب */
    const rivals = open
      ? [...this.teams.values()]
          .filter((t) => t.id !== team.id)
          .sort((a, b) => b.score - a.score)
          .map((t) => ({
            id: t.id,
            name: t.name,
            score: t.score,
            above: t.score > team.score,
            /* تحدّاه غيرُك لهذه الجولة — فلا يُتحدّى ثانيةً */
            dueled: this.duelOn(t.id, team.id),
          }))
      : [];
    /* closed: الاستراحة قائمة ووقتُ الشراء انقضى — المتجر يُرى ولا يُشترى منه */
    const closed = open && !!this.breakEndsAt && this.breakRemaining() === 0;
    return { open, closed, cards, pending, chosen, rivals };
  }
}

/**
 * وصفٌ كاملٌ للغرفة يُكتب على القرص ويُبعث منه.
 *
 * ولا يُحفظ طابور الأسئلة (team.queue): هو مئاتُ الأسئلة لكل فريق،
 * فيُثقل كل كتابة بلا طائل — وnextQuestion يبنيه من جديد عند أول
 * حاجة، إذ المحفوظ هو ما رآه الفريق (seen) وهو مناط عدم التكرار.
 * أما السؤال المعروض الآن (current) فيُحفظ، فاللاعب يعود إليه بعينه.
 */
Room.prototype.snapshot = function snapshot() {
  return {
    v: 1,
    code: this.code,
    name: this.name,
    adminKey: this.adminKey,
    bankIds: this.bankIds,
    settings: this.settings,
    difficulty: this.difficulty,
    status: this.status,
    round: this.round,
    createdAt: this.createdAt,
    startedAt: this.startedAt,
    touchedAt: this.touchedAt,
    result: this.result,
    history: this.history,
    roundBuys: this.roundBuys ?? [],
    cardEvents: this.cardEvents ?? [],
    playedRounds: this.playedRounds,
    breakEndsAt: this.breakEndsAt ?? null,
    lives: this.lives,
    fallen: this.fallen,
    standings: this.standings,
    revealStep: this.revealStep,
    displayBlurred: this.displayBlurred,
    served: [...this.served.values()],
    reported: [...this.reported],
    teams: [...this.teams.values()].map((t) => ({
      id: t.id,
      token: t.token,
      deviceId: t.deviceId,
      name: t.name,
      realName: t.realName,
      score: t.score,
      totalCorrect: t.totalCorrect,
      sparks: t.sparks,
      seen: [...t.seen],
      cardUses: [...t.cardUses],
      pendingMultiplier: t.pendingMultiplier,
      pendingBuys: t.pendingBuys,
      waiting: t.waiting,
      timeMs: Math.round(t.timeMs),
      flatlined: t.flatlined,
      dropped: t.dropped,
      flatlinedAt: t.flatlinedAt,
      current: t.current,
      answered: t.answered,
      correct: t.correct,
      lastResult: t.lastResult,
      review: t.review,
      lockedMs: Math.round(t.lockedMs),
      frozenBy: t.frozenBy,
      streak: t.streak,
      streaks: t.streaks,
      shieldLeft: t.shieldLeft,
      reviveLeft: t.reviveLeft,
      revivedAt: t.revivedAt,
      mirror: t.mirror,
      timeBonusMs: t.timeBonusMs,
      robbed: t.robbed,
      robbing: t.robbing,
      duels: t.duels,
      notices: t.notices,
    })),
  };
};

/**
 * تُبعث الغرفة **موقوفة** دائماً.
 *
 * السيرفر لا يعلم كم ثانية ضاعت على القاعة وهو ساقط، فاستئنافٌ تلقائي
 * يسرق من فريقٍ ويهب لآخر. القرار للمنظّم: يرى الحالة كما كانت ويضغط
 * «استئناف» حين تكون القاعة مستعدّة.
 */
export function restoreRoom(snap) {
  const room = new Room(snap.bankIds, snap.settings, snap.difficulty, snap.name);
  // البانية تُولّد رمزاً ومفتاحاً جديدين — نردّ الأصليين فالروابط قائمة عند الناس
  room.code = snap.code;
  room.adminKey = snap.adminKey;
  room.status = snap.status === 'running' || snap.status === 'countdown' ? 'paused' : snap.status;
  room.round = snap.round;
  room.createdAt = snap.createdAt;
  room.startedAt = snap.startedAt ?? null;
  room.touchedAt = snap.touchedAt;
  room.result = snap.result;
  room.history = snap.history ?? [];
  room.roundBuys = Array.isArray(snap.roundBuys) ? snap.roundBuys : [];
  room.cardEvents = Array.isArray(snap.cardEvents) ? snap.cardEvents : [];
  /* لقطاتٌ قديمة لا تعرف العدّاد — يُبدأ بما في السجلّ فلا يضيع ما مضى */
  room.playedRounds = snap.playedRounds ?? room.history.length;
  room.standings = snap.standings ?? null;
  room.revealStep = snap.revealStep ?? 0;
  room.lives = snap.lives ?? 1;
  room.fallen = Array.isArray(snap.fallen) ? snap.fallen : [];
  /* السيرفر سقط في الاستراحة: يُعطى اللاعبون وقتَ شراءٍ جديداً كاملاً من عودته */
  room.breakEndsAt = snap.breakEndsAt ? Date.now() + BREAK_MS : null;
  room.displayBlurred = Boolean(snap.displayBlurred);
  /*
   * لقطاتٌ قديمة كانت تحفظ المعرّفات وحدها — تُقبل ويُملأ ما نقص فارغاً،
   * فغرفةٌ جاريةٌ ساعةَ الترقية أولى بأن تُستأنف ناقصةً من أن تُفقد.
   */
  room.served = new Map();
  for (const item of snap.served ?? []) {
    if (typeof item === 'string') {
      room.served.set(item, { id: item, q: '', options: [], answer: 0, level: 2 });
    } else if (item?.id) {
      room.served.set(item.id, item);
    }
  }
  room.lastTickAt = null;
  room.countdownEndsAt = null;

  for (const t of snap.teams ?? []) {
    const team = new Team(t.name, room.settings);
    team.id = t.id;
    team.token = t.token;
    team.deviceId = t.deviceId ?? null;
    team.realName = t.realName ?? '';
    team.score = t.score;
    team.totalCorrect = t.totalCorrect ?? 0;
    /* لقطةٌ من قبل الشرارات: يبدأ رصيدُ الشراء صفراً، ونقاطُ فوزه كما هي */
    team.sparks = t.sparks ?? 0;
    team.connected = false; // حتى يعود بجهازه فعلاً
    team.disconnectedAt = Date.now(); // ومهلةُ الانقطاع تبدأ من عودة السيرفر
    team.seen = new Set(t.seen ?? []);
    team.cardUses = new Map(t.cardUses ?? []);
    team.pendingMultiplier = t.pendingMultiplier ?? 1;
    /* لقطةٌ قديمة لا تحمله — ومصفوفةٌ فارغة أسلمُ من undefined تُقرأ بـfilter */
    team.pendingBuys = Array.isArray(t.pendingBuys) ? t.pendingBuys : [];
    team.waiting = Boolean(t.waiting);
    team.timeMs = t.timeMs;
    team.flatlined = Boolean(t.flatlined);
    team.dropped = Boolean(t.dropped);
    team.flatlinedAt = t.flatlinedAt ?? null;
    team.queue = []; // يُبنى عند أول حاجة
    team.current = t.current ?? null;
    team.answered = t.answered ?? 0;
    team.correct = t.correct ?? 0;
    team.lastResult = t.lastResult ?? null;
    team.review = t.review ?? [];
    team.lockedMs = t.lockedMs ?? 0;
    team.frozenBy = t.frozenBy ?? null;
    team.streak = t.streak ?? 0;
    team.streaks = t.streaks ?? 0;
    team.shieldLeft = t.shieldLeft ?? 0;
    team.reviveLeft = t.reviveLeft ?? 0;
    team.revivedAt = t.revivedAt ?? null;
    team.mirror = Boolean(t.mirror);
    team.timeBonusMs = t.timeBonusMs ?? 0;
    team.robbed = Array.isArray(t.robbed) ? t.robbed : [];
    team.robbing = Array.isArray(t.robbing) ? t.robbing : [];
    team.duels = Array.isArray(t.duels) ? t.duels : [];
    team.notices = Array.isArray(t.notices) ? t.notices : [];
    room.teams.set(team.id, team);
  }

  /*
   * نظيفةٌ إلا إن غيّرنا فيها شيئاً: الجولة الجارية تعود موقوفة، فحالتها
   * على القرص لم تعد صادقة وتستحقّ كتابةً أولى. وما عاد كما كان لا يُكتب.
   */
  room.reported = new Set(snap.reported ?? []);
  room.dirty = room.status !== snap.status;
  rooms.set(room.code, room);
  return room;
}

export function createRoom(bankIds, settings, difficulty, name) {
  const room = new Room(bankIds, settings, difficulty, name);
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

export function allRooms() {
  return rooms.values();
}

/**
 * تنظيف الغرف الخاملة حتى لا تتراكم في الذاكرة.
 * ويُرجع رموز من رحل ليُسقط المُخزِّن لقطاتهم — فالسجلّ يبقى واللقطة تذهب.
 */
export function sweepIdleRooms(now = Date.now()) {
  const gone = [];
  for (const [code, room] of rooms) {
    if (now - room.touchedAt > IDLE_ROOM_MS) {
      /*
       * وتُختم منتهيةً قبل أن تُنسى.
       *
       * كانت تُحذف من الذاكرة وحالُها في السجلّ «ended» — أي بين جولتين.
       * فيقرأ المالكُ بعد شهرٍ غرفةً تنتظر جولتها القادمة منذ ثلاثين
       * يوماً. ومن ترك غرفته ساعتين فقد انتهت، فيُقال ذلك.
       */
      room.status = 'finished';
      rooms.delete(code);
      gone.push(code);
    }
  }
  return gone;
}

/**
 * تُنسى الغرفة من الذاكرة.
 *
 * ولا بدّ منها مع الحذف: دورةُ الحفظ تمرّ على غرف الذاكرة كل ثانيتين
 * فتكتبها، فلو حُذف سجلُّها وهي باقيةٌ هنا لعادت بعد لحظتين كأن شيئاً
 * لم يكن.
 */
export function dropRoom(code) {
  return rooms.delete(code);
}

export { IDLE_ROOM_MS };
