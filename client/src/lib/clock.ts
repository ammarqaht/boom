import { useEffect, useReducer, useRef } from 'react';
import type { RoomState, TeamState } from './types';

/*
 * الساعةُ المحلية.
 *
 * كان السيرفر يبثّ الحالَ كاملةً كل ربع ثانية لأن الوقت ينزل. والوقتُ
 * ينزل عند الجميع بالسرعة نفسها، فلا خبر فيه: آخرُ قيمةٍ وصلت ولحظةُ
 * وصولها تكفيان ليُعرف ما بقي الآن. فصار السيرفر يرسل ما تغيّر وحده
 * (إجابة، تجميد، نهاية)، والمتصفّح يُنزل العدّادات بنفسه بين رسالتين.
 *
 * والسيرفر يبقى الحَكَم: هو من يُسكن النبض ويُنهي الجولة، وما يُرسله
 * يُصحّح ما هنا. فالمحليُّ يعرض ولا يقرّر — ولذلك لا يُسكن أحداً عند
 * الصفر، يقف عنده وينتظر خبر السيرفر.
 *
 * وتُقاس المدّة من لحظة الوصول على ساعة الجهاز نفسه (performance.now)،
 * لا من ساعة السيرفر: ساعةُ الجوّال قد تزلّ دقائق، والفرقُ بين وصولين
 * لا يزلّ.
 */

const STEP_MS = 250; // كوتيرة البثّ القديمة — فالمجرى يُكمل ما بينها كما كان

const less = (ms: number, by: number) => Math.max(0, ms - by);

export function projectTeam(state: TeamState, elapsed: number): TeamState {
  if (state.status === 'countdown') {
    return { ...state, countdownMs: less(state.countdownMs, elapsed) };
  }
  const lockedMs = less(state.lockedMs, elapsed);
  return {
    ...state,
    timeMs: less(state.timeMs, elapsed),
    lockedMs,
    frozenBy: lockedMs > 0 ? state.frozenBy : null,
  };
}

export const teamTicking = (state: TeamState) =>
  state.status === 'countdown' || (state.status === 'running' && !state.flatlined && !state.waiting);

export function projectRoom(room: RoomState, elapsed: number): RoomState {
  if (room.status === 'countdown') {
    return { ...room, countdownMs: less(room.countdownMs, elapsed) };
  }
  return {
    ...room,
    teams: room.teams.map((team) => {
      if (team.flatlined || team.waiting) return team;
      const lockedMs = less(team.lockedMs, elapsed);
      return {
        ...team,
        timeMs: less(team.timeMs, elapsed),
        lockedMs,
        locked: lockedMs > 0,
        frozenBy: lockedMs > 0 ? team.frozenBy : null,
      };
    }),
  };
}

export const roomTicking = (room: RoomState) =>
  room.status === 'countdown' || room.status === 'running';

/**
 * القيمةُ كما هي الآن: آخرُ ما وصل من السيرفر، مُنزَلةً بما مضى منذ وصوله.
 * تُعاد كل ربع ثانية ما دامت الساعة تجري، وتُعاد كما هي إن سكنت.
 */
export function useProjected<T>(
  value: T | null,
  project: (value: T, elapsed: number) => T,
  ticking: (value: T) => boolean,
): T | null {
  /* المرساة تُثبَّت عند وصول قيمةٍ جديدة — في العرض نفسه، فلا يُعرض إطارٌ بمرساةٍ قديمة */
  const anchor = useRef<{ value: T | null; at: number }>({ value: null, at: 0 });
  if (anchor.current.value !== value) anchor.current = { value, at: performance.now() };

  const running = value !== null && ticking(value);
  const [, step] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(step, STEP_MS);
    return () => clearInterval(timer);
  }, [running]);

  if (value === null || !running) return value;
  return project(value, performance.now() - anchor.current.at);
}
