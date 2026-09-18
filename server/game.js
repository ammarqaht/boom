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
const FREEZE_MS = 5000; // مدة قفل الإجابة عند التجميد
const TIME_CARD_MS = 5000; // الوقت الإضافي من بطاقة «وقت إضافي»
const DOUBLE_FACTOR = 2; // مضاعِف بطاقة «مضاعفة»

/**
 * تعريفات البطاقات — المرجع الوحيد للأسعار والأنواع.
 *
 * موازنة السعر: اللاعب يصيب في الجولة ستاً إلى عشر، ويأخذ نصيبه من
 * الترتيب فوقها، فمتوسّط الجولة ثمانٍ إلى ثلاث عشرة. واللعبة تبلغ عشر
 * جولات، فالحصيلة تقارب المئة. فجُعل «وقت إضافي» بجولة، و«تجميد»
 * بجولة ونصف، و«مضاعفة» بجولتين — وكلها مرّتان، فأقصى الإنفاق ثمانٍ
 * وثمانون: ميزانيةٌ تُدار لا مصروفٌ يُنفَق أول جولة.
 */
export const CARDS = {
  time: { price: 10, name: 'وقت إضافي' },
  freeze: { price: 14, name: 'تجميد' },
  double: { price: 20, name: 'مضاعفة' },
};

/** كم مرة تُشترى البطاقة الواحدة طوال اللعبة */
export const CARD_LIMIT = 2;

/**
 * مستويات المسابقة — ونسبةُ كل طبقة من الأسئلة المعروضة.
 * الطبقات: [١] سهل  [٢] متوسط  [٣] صعب.
 *
 * ليست تصفيةً بل ترجيح: كل الأسئلة تبقى في البِركة، وإنما يتغيّر ترتيب
 * ظهورها. فاللاعب لا يرى في الجولة إلا بضعة أسئلة من ألفٍ ومئة، والمهم
 * ما يتصدّر الطابور لا ما يُحذف منه — وبهذا لا يضيع سؤالٌ ولا يُحرَم
 * فريقٌ ابتدائيّ من سؤالٍ صعبٍ يُطربه أن يعرفه.
 */
export const DIFFICULTY = {
  primary: { name: 'ابتدائي', mix: [45, 45, 10] },
  middle: { name: 'متوسط', mix: [20, 60, 20] },
  secondary: { name: 'ثانوي', mix: [10, 40, 50] },
  university: { name: 'جامعي', mix: [0, 25, 75] },
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

class Team {
  constructor(name, settings) {
    this.id = randomUUID();
    this.token = randomUUID(); // يسمح للفريق بالرجوع بعد انقطاع الاتصال
    this.name = name;
    this.score = 0;
    this.connected = true;
    // يبقى عبر الجولات: لا يُعاد سؤال على الفريق حتى ينفد البنك كله
    this.seen = new Set();
    // عدد مرات شراء كل بطاقة — الحدّ CARD_LIMIT لكل نوع طوال اللعبة
    this.cardUses = new Map();
    // آثار مؤجّلة تُطبّق في الجولة التالية
    this.pendingBonusMs = 0; // وقت إضافي يُضاف عند بدء الجولة
    this.pendingMultiplier = 1; // مضاعِف نقاط الجولة القادمة
    this.pendingFreezeBy = null; // اسم من جمّدك، يُطبّق قفلاً عند البدء
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
    /* عليها تُبنى الكتابة على القرص: تتبدّل الحالة فتُكتب، وإلا فلا */
    this.dirty = true;
    this.result = null;
    this.history = []; // نتائج كل الجولات السابقة
    this.standings = null; // الترتيب النهائي بعد إنهاء اللعبة
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
        bank: id.includes(':') ? id.slice(0, id.indexOf(':')) : '؟',
        level: record?.level ?? 2,
        text: record?.q ?? '',
        ...tally,
      });
    }
    this.stats.clear();
    return out;
  }

  addTeam(name) {
    const team = new Team(name, this.settings);
    this.teams.set(team.id, team);
    this.touch();
    return team;
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
    this.startedAt ??= Date.now();
    // البدء بعد نهاية جولة يعني جولة جديدة — بلا خطوة تجهيز منفصلة
    if (this.status === 'ended' || this.status === 'finished') this.round++;
    for (const team of this.teams.values()) {
      team.resetForRound(this.settings);
      // تطبيق البطاقات المؤجّلة عند بدء الجولة
      if (team.pendingBonusMs) {
        team.timeMs = this.clampTime(team.timeMs + team.pendingBonusMs);
        team.pendingBonusMs = 0;
      }
      if (team.pendingFreezeBy) {
        team.lockedMs = FREEZE_MS;
        team.frozenBy = team.pendingFreezeBy;
        team.pendingFreezeBy = null;
      }
      // pendingMultiplier يبقى حتى احتساب النقاط في نهاية الجولة
      this.nextQuestion(team);
    }
    this.result = null;
    // ثلاث ثوانٍ استعداد قبل أن تبدأ العدادات فعلياً
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
  answer(teamId, questionId, choice) {
    const team = this.teams.get(teamId);
    if (this.status !== 'running' || !team || team.flatlined) return null;
    if (team.lockedMs > 0) return null; // مقفلة عن الإجابة (تجميد)
    if (!team.current || team.current.id !== questionId) return null; // إجابة متأخرة أو مكررة

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
      choice,
      isCorrect,
    });
    if (isCorrect) {
      team.correct++;
      team.timeMs = this.clampTime(team.timeMs + this.settings.correctBonus * 1000);
    } else {
      team.timeMs = this.clampTime(team.timeMs - this.settings.wrongPenalty * 1000);
    }
    team.lastResult = isCorrect ? 'correct' : 'wrong';
    this.touch();

    /*
     * الكشف عن موضع الصواب يُرسل مع النتيجة لا قبلها: اللاعب أجاب فعلاً،
     * فلم يعد في إخفائه فائدة — وفي كشفه تعليمٌ يُذكَر. ونحفظه قبل سحب
     * السؤال التالي لأن team.current يتبدّل بعد سطرين.
     */
    const reveal = { questionId: team.current.id, answer: team.current.answer };

    if (team.timeMs === 0) {
      this.flatline(team);
      return { isCorrect, flatlined: true, ...reveal };
    }

    this.nextQuestion(team);
    return { isCorrect, flatlined: false, ...reveal };
  }

  flatline(team) {
    if (team.flatlined) return;
    team.flatlined = true;
    team.flatlinedAt = Date.now();
    team.current = null;
    this.endRound();
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

    let firstFlatlined = null;
    for (const team of this.teams.values()) {
      if (team.flatlined) continue;
      // فترة التجميد: العدّاد ينزل لكن الإجابة مقفلة
      if (team.lockedMs > 0) {
        team.lockedMs = Math.max(0, team.lockedMs - elapsed);
        if (team.lockedMs === 0) team.frozenBy = null;
      }
      team.timeMs = Math.max(0, team.timeMs - elapsed);
      if (team.timeMs === 0 && !firstFlatlined) firstFlatlined = team;
    }
    if (firstFlatlined) this.flatline(firstFlatlined);
    return true;
  }

  /**
   * توقف أول نبض ينهي الجولة للجميع.
   *
   * حصيلة اللاعب = نقطةٌ عن كل إجابة صحيحة + نصيبُه من الترتيب
   * (مع N لاعبين: الأول N-1، ثم N-2 … والمتوقّف صفر) ثم يُضرب الكل في
   * مضاعِفه إن كان اشترى المضاعفة.
   *
   * ولا تُضاف هذه النقاط إلى الرصيد إلا هنا — عند انتهاء الجولة — فلا
   * يرى اللاعب رصيده يتضخّم وهو يجيب، ولا ينفق ما لم يُحصّله بعد.
   */
  endRound() {
    this.status = 'ended';
    const teams = [...this.teams.values()];
    const survivors = teams.filter((t) => !t.flatlined).sort((a, b) => b.timeMs - a.timeMs);

    /*
     * المضاعفة رهانٌ على الصمود: من سكن نبضه يأخذ نقاط إجاباته الصحيحة
     * كاملةً، لكن مضاعِفه يسقط عنه — وإلا صار الخروج المبكر مربحاً.
     */
    const credit = (team, base, extra, alive = true) => {
      const raw = base + team.correct;
      const factor = alive ? team.pendingMultiplier : 1;
      const points = raw * factor;
      team.score += points;
      return {
        teamId: team.id,
        name: team.name,
        points,
        correct: team.correct, // كم منها جاء من الإجابات — يُقرأ في المراجعة
        doubled: factor > 1 && raw > 0,
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

    this.result = { round: this.round, awards };
    this.history.push(this.result);
    this.touch();
  }

  /** إنهاء اللعبة كلياً وإعلان الأوائل حسب مجموع النقاط */
  finish() {
    this.status = 'finished';
    this.standings = [...this.teams.values()]
      .sort((a, b) => b.score - a.score || b.timeMs - a.timeMs)
      .map((team, index) => ({
        teamId: team.id,
        name: team.name,
        score: team.score,
        rank: index + 1,
      }));
    this.touch();
  }

  newRound() {
    this.round++;
    this.status = 'lobby';
    this.result = null;
    for (const team of this.teams.values()) team.resetForRound(this.settings);
    this.touch();
  }

  /** إعادة ضبط كاملة: النقاط تعود صفراً */
  resetAll() {
    this.round = 1;
    this.status = 'lobby';
    this.result = null;
    this.history = [];
    this.standings = null;
    for (const team of this.teams.values()) {
      team.score = 0;
      team.seen.clear(); // لعبة جديدة تماماً — كل الأسئلة متاحة من جديد
      team.cardUses.clear(); // البطاقات تعود متاحة
      team.pendingBonusMs = 0;
      team.pendingMultiplier = 1;
      team.pendingFreezeBy = null;
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
    const card = CARDS[cardId];
    if (!card) return { ok: false, error: 'بطاقة غير معروفة' };
    if ((team.cardUses.get(cardId) ?? 0) >= CARD_LIMIT) {
      return { ok: false, error: 'استنفدت هذه البطاقة' };
    }
    if (team.score < card.price) return { ok: false, error: 'نقاطك لا تكفي' };

    if (cardId === 'freeze') {
      const target = this.teams.get(targetId);
      if (!target || target.id === team.id) {
        return { ok: false, error: 'اختر لاعباً آخر للتجميد' };
      }
      target.pendingFreezeBy = team.name;
    } else if (cardId === 'time') {
      team.pendingBonusMs += TIME_CARD_MS;
    } else if (cardId === 'double') {
      team.pendingMultiplier = DOUBLE_FACTOR;
    }

    team.score -= card.price;
    team.cardUses.set(cardId, (team.cardUses.get(cardId) ?? 0) + 1);
    this.touch();
    return { ok: true };
  }

  /** يفتح البطاقات من جديد لكل المجموعات — يستطيعون شراءها مرة أخرى */
  reopenCards() {
    for (const team of this.teams.values()) team.cardUses.clear();
    this.touch();
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
      result: this.result,
      history: this.history,
      standings: this.standings,
      displayBlurred: this.displayBlurred,
      countdownMs: this.countdownRemaining(),
      teams: [...this.teams.values()]
        .map((t) => ({
          id: t.id,
          name: t.name,
          timeMs: Math.round(t.timeMs),
          score: t.score,
          flatlined: t.flatlined,
          connected: t.connected,
          answered: t.answered,
          correct: t.correct,
          locked: t.lockedMs > 0, // مجمّدة حالياً — تظهر ❄️ على شاشة العرض
          lockedMs: Math.round(t.lockedMs), // المتبقي من التجميد — لعدّاد الشاشات
          doubled: t.pendingMultiplier > 1, // مضاعفة فعّالة هذه الجولة — بطاقة ذهبية
        }))
        .sort((a, b) => b.score - a.score || b.timeMs - a.timeMs),
    };
  }

  /** ما يراه فريق واحد — السؤال بلا حقل answer */
  teamState(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    return {
      id: team.id,
      name: team.name,
      timeMs: Math.round(team.timeMs),
      score: team.score,
      flatlined: team.flatlined,
      lastResult: team.lastResult,
      status: this.status,
      round: this.round,
      bonus: this.settings.correctBonus,
      penalty: this.settings.wrongPenalty,
      countdownMs: this.countdownRemaining(),
      standings: this.standings,
      answered: team.answered,
      correct: team.correct,
      // نقاط هذه الجولة تحديداً — تُعرض في رسالة نهاية الجولة
      roundPoints: this.result?.awards.find((a) => a.teamId === team.id)?.points ?? null,
      question:
        this.status === 'running' && team.current
          ? { id: team.current.id, q: team.current.q, options: team.current.options }
          : null,
      // المراجعة تحمل الإجابات الصحيحة — لا تُرسل إلا بعد انتهاء الجولة
      review: this.status === 'ended' ? team.review : null,
      // حالة القفل الحالية (تجميد)
      lockedMs: Math.round(team.lockedMs),
      frozenBy: team.frozenBy,
      // متجر البطاقات: متاح بين الجولات فقط
      shop: this.shopFor(team),
    };
  }

  /** حالة متجر البطاقات لفريق: ما اشتراه، وما يقدر عليه، ومن يجمّد */
  shopFor(team) {
    const open = this.status === 'ended'; // بين الجولات فقط
    const cards = Object.entries(CARDS).map(([id, card]) => ({
      id,
      name: card.name,
      price: card.price,
      used: (team.cardUses.get(id) ?? 0) >= CARD_LIMIT,
      left: CARD_LIMIT - (team.cardUses.get(id) ?? 0),
      affordable: team.score >= card.price,
    }));
    // الآثار المؤجّلة الجاهزة للجولة القادمة — لتذكير الفريق
    const pending = {
      time: team.pendingBonusMs > 0,
      double: team.pendingMultiplier > 1,
    };
    // خصوم يمكن تجميدهم (كل الفرق عداه)
    const rivals = [...this.teams.values()]
      .filter((t) => t.id !== team.id)
      .map((t) => ({ id: t.id, name: t.name }));
    return { open, cards, pending, rivals };
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
    standings: this.standings,
    displayBlurred: this.displayBlurred,
    served: [...this.served.values()],
    reported: [...this.reported],
    teams: [...this.teams.values()].map((t) => ({
      id: t.id,
      token: t.token,
      name: t.name,
      score: t.score,
      seen: [...t.seen],
      cardUses: [...t.cardUses],
      pendingBonusMs: t.pendingBonusMs,
      pendingMultiplier: t.pendingMultiplier,
      pendingFreezeBy: t.pendingFreezeBy,
      timeMs: Math.round(t.timeMs),
      flatlined: t.flatlined,
      flatlinedAt: t.flatlinedAt,
      current: t.current,
      answered: t.answered,
      correct: t.correct,
      lastResult: t.lastResult,
      review: t.review,
      lockedMs: Math.round(t.lockedMs),
      frozenBy: t.frozenBy,
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
  room.standings = snap.standings ?? null;
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
    team.score = t.score;
    team.connected = false; // حتى يعود بجهازه فعلاً
    team.seen = new Set(t.seen ?? []);
    team.cardUses = new Map(t.cardUses ?? []);
    team.pendingBonusMs = t.pendingBonusMs ?? 0;
    team.pendingMultiplier = t.pendingMultiplier ?? 1;
    team.pendingFreezeBy = t.pendingFreezeBy ?? null;
    team.timeMs = t.timeMs;
    team.flatlined = Boolean(t.flatlined);
    team.flatlinedAt = t.flatlinedAt ?? null;
    team.queue = []; // يُبنى عند أول حاجة
    team.current = t.current ?? null;
    team.answered = t.answered ?? 0;
    team.correct = t.correct ?? 0;
    team.lastResult = t.lastResult ?? null;
    team.review = t.review ?? [];
    team.lockedMs = t.lockedMs ?? 0;
    team.frozenBy = t.frozenBy ?? null;
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
      rooms.delete(code);
      gone.push(code);
    }
  }
  return gone;
}

export { IDLE_ROOM_MS };
