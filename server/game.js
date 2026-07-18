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

  /** يسحب السؤال التالي للفريق، ويعيد خلط البنك عند نفاده */
  nextQuestion(team) {
    if (team.queue.length === 0) {
      team.queue = shuffled(poolFor(this.bankIds));
    }
    team.current = team.queue.shift();
    return team.current;
  }

  start() {
    if (this.teams.size === 0) return false;
    // البدء بعد نهاية جولة يعني جولة جديدة — بلا خطوة تجهيز منفصلة
    if (this.status === 'ended' || this.status === 'finished') this.round++;
    for (const team of this.teams.values()) {
      team.resetForRound(this.settings);
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
      const points = Math.max(0, teams.length - 1 - index);
      team.score += points;
      awards.push({
        teamId: team.id,
        name: team.name,
        points,
        timeMs: Math.round(team.timeMs),
        top: index === 0, // صاحب أعلى وقت — يُميَّز بالأخضر
      });
    });
    for (const team of teams.filter((t) => t.exploded)) {
      awards.push({ teamId: team.id, name: team.name, points: 0, timeMs: 0, exploded: true });
    }

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
      team.resetForRound(this.settings);
    }
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
    };
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
