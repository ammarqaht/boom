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
const DOUBLE_FACTOR = 3; // مضاعِف بطاقة «مضاعفة»

/** تعريفات البطاقات — المرجع الوحيد للأسعار والأنواع */
export const CARDS = {
  time: { price: 2, name: 'وقت إضافي' },
  freeze: { price: 3, name: 'تجميد' },
  double: { price: 4, name: 'مضاعفة' },
};

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

class Team {
  constructor(name, settings) {
    this.id = randomUUID();
    this.token = randomUUID(); // يسمح للفريق بالرجوع بعد انقطاع الاتصال
    this.name = name;
    this.score = 0;
    this.connected = true;
    // يبقى عبر الجولات: لا يُعاد سؤال على الفريق حتى ينفد البنك كله
    this.seen = new Set();
    // البطاقات المستخدمة (مرة واحدة لكل مجموعة طوال اللعبة)
    this.usedCards = new Set();
    // آثار مؤجّلة تُطبّق في الجولة التالية
    this.pendingBonusMs = 0; // وقت إضافي يُضاف عند بدء الجولة
    this.pendingMultiplier = 1; // مضاعِف نقاط الجولة القادمة
    this.pendingFreezeBy = null; // اسم من جمّدك، يُطبّق قفلاً عند البدء
    this.resetForRound(settings);
  }

  resetForRound(settings) {
    this.timeMs = settings.startSeconds * 1000;
    this.exploded = false;
    this.explodedAt = null;
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
  constructor(bankIds, settings = {}) {
    this.code = makeRoomCode();
    this.adminKey = randomUUID();
    this.bankIds = normalizeBankIds(bankIds);
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.status = 'lobby'; // lobby | countdown | running | paused | ended | finished
    this.round = 1;
    this.teams = new Map();
    this.lastTickAt = null;
    this.countdownEndsAt = null;
    this.touchedAt = Date.now();
    this.result = null;
    this.history = []; // نتائج كل الجولات السابقة
    this.standings = null; // الترتيب النهائي بعد إنهاء اللعبة
    this.displayBlurred = false; // تغبيش الترتيب على شاشة العرض
  }

  touch() {
    this.touchedAt = Date.now();
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
      team.queue = shuffled(fresh);
    }
    team.current = team.queue.shift();
    if (team.current) team.seen.add(team.current.id);
    return team.current;
  }

  start() {
    if (this.teams.size === 0) return false;
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
    if (!team || team.exploded) return;
    team.timeMs = this.clampTime(team.timeMs + deltaSeconds * 1000);
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
    if (this.status !== 'running' || !team || team.exploded) return null;
    if (team.lockedMs > 0) return null; // مقفلة عن الإجابة (تجميد)
    if (!team.current || team.current.id !== questionId) return null; // إجابة متأخرة أو مكررة

    const isCorrect = choice === team.current.answer;
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

    if (team.timeMs === 0) {
      this.explode(team);
      return { isCorrect, exploded: true };
    }

    this.nextQuestion(team);
    return { isCorrect, exploded: false };
  }

  explode(team) {
    if (team.exploded) return;
    team.exploded = true;
    team.explodedAt = Date.now();
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

    let firstExploded = null;
    for (const team of this.teams.values()) {
      if (team.exploded) continue;
      // فترة التجميد: العدّاد ينزل لكن الإجابة مقفلة
      if (team.lockedMs > 0) {
        team.lockedMs = Math.max(0, team.lockedMs - elapsed);
        if (team.lockedMs === 0) team.frozenBy = null;
      }
      team.timeMs = Math.max(0, team.timeMs - elapsed);
      if (team.timeMs === 0 && !firstExploded) firstExploded = team;
    }
    if (firstExploded) this.explode(firstExploded);
    return true;
  }

  /**
   * انفجار أول قنبلة ينهي الجولة للجميع.
   * الترتيب حسب الوقت المتبقي، والمنفجر صفر.
   * مع N فرق: الأول N-1 نقطة، ثم N-2 ... وهكذا.
   */
  endRound() {
    this.status = 'ended';
    const teams = [...this.teams.values()];
    const survivors = teams
      .filter((t) => !t.exploded)
      .sort((a, b) => b.timeMs - a.timeMs);

    const awards = [];
    survivors.forEach((team, index) => {
      const base = Math.max(0, teams.length - 1 - index);
      const doubled = team.pendingMultiplier > 1 && base > 0;
      const points = base * team.pendingMultiplier;
      team.score += points;
      awards.push({
        teamId: team.id,
        name: team.name,
        points,
        doubled, // ضوعِفت نقاطه ببطاقة المضاعفة
        timeMs: Math.round(team.timeMs),
        top: index === 0, // صاحب أعلى وقت — يُميَّز بالأخضر
      });
    });
    for (const team of teams.filter((t) => t.exploded)) {
      awards.push({ teamId: team.id, name: team.name, points: 0, timeMs: 0, exploded: true });
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
      team.usedCards.clear(); // البطاقات تعود متاحة
      team.pendingBonusMs = 0;
      team.pendingMultiplier = 1;
      team.pendingFreezeBy = null;
      team.resetForRound(this.settings);
    }
    this.touch();
  }

  /**
   * شراء بطاقة بين الجولات. تُخصم النقاط فوراً، ويُطبَّق أثرها في الجولة التالية.
   * كل بطاقة مرة واحدة لكل مجموعة طوال اللعبة.
   */
  buyCard(teamId, cardId, targetId) {
    const team = this.teams.get(teamId);
    if (!team) return { ok: false, error: 'الفريق غير موجود' };
    if (this.status !== 'ended') {
      return { ok: false, error: 'الشراء متاح بين الجولات فقط' };
    }
    const card = CARDS[cardId];
    if (!card) return { ok: false, error: 'بطاقة غير معروفة' };
    if (team.usedCards.has(cardId)) return { ok: false, error: 'استخدمت هذه البطاقة' };
    if (team.score < card.price) return { ok: false, error: 'نقاطك لا تكفي' };

    if (cardId === 'freeze') {
      const target = this.teams.get(targetId);
      if (!target || target.id === team.id) {
        return { ok: false, error: 'اختر مجموعة أخرى للتجميد' };
      }
      target.pendingFreezeBy = team.name;
    } else if (cardId === 'time') {
      team.pendingBonusMs += TIME_CARD_MS;
    } else if (cardId === 'double') {
      team.pendingMultiplier = DOUBLE_FACTOR;
    }

    team.score -= card.price;
    team.usedCards.add(cardId);
    this.touch();
    return { ok: true };
  }

  /** يفتح البطاقات من جديد لكل المجموعات — يستطيعون شراءها مرة أخرى */
  reopenCards() {
    for (const team of this.teams.values()) team.usedCards.clear();
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
      status: this.status,
      round: this.round,
      bankIds: this.bankIds,
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
          exploded: t.exploded,
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
      exploded: team.exploded,
      lastResult: team.lastResult,
      status: this.status,
      round: this.round,
      bonus: this.settings.correctBonus,
      penalty: this.settings.wrongPenalty,
      countdownMs: this.countdownRemaining(),
      standings: this.standings,
      answered: team.answered,
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
      used: team.usedCards.has(id),
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

export function createRoom(bankIds, settings) {
  const room = new Room(bankIds, settings);
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

export function allRooms() {
  return rooms.values();
}

/** تنظيف الغرف الخاملة حتى لا تتراكم في الذاكرة */
export function sweepIdleRooms(now = Date.now()) {
  for (const [code, room] of rooms) {
    if (now - room.touchedAt > IDLE_ROOM_MS) rooms.delete(code);
  }
}
