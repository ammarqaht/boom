export type RoomStatus =
  | 'lobby'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'ended'
  | 'finished';

/** الترتيب النهائي بعد إنهاء اللعبة */
export interface Standing {
  teamId: string;
  name: string;
  score: number;
  rank: number;
}

export interface Settings {
  startSeconds: number;
  correctBonus: number;
  wrongPenalty: number;
  maxSeconds: number;
}

export interface PublicTeam {
  id: string;
  name: string;
  timeMs: number;
  score: number;
  exploded: boolean;
  connected: boolean;
  answered: number;
  correct: number;
}

export interface Award {
  teamId: string;
  name: string;
  points: number;
  timeMs: number;
  exploded?: boolean;
  /** صاحب أعلى وقت في الجولة */
  top?: boolean;
}

export interface RoomResult {
  round: number;
  awards: Award[];
}

export interface RoomState {
  code: string;
  status: RoomStatus;
  round: number;
  bankIds: string[];
  settings: Settings;
  result: RoomResult | null;
  history: RoomResult[];
  standings: Standing[] | null;
  displayBlurred: boolean;
  countdownMs: number;
  teams: PublicTeam[];
}

/** سؤال بعد انتهاء الجولة — يحمل الإجابة الصحيحة واختيار الفريق */
export interface ReviewItem {
  id: string;
  q: string;
  options: string[];
  answer: number;
  choice: number;
  isCorrect: boolean;
}

/** السؤال كما يصل المتصفح — بلا الخيار الصحيح */
export interface Question {
  id: string;
  q: string;
  options: string[];
}

export interface TeamState {
  id: string;
  name: string;
  timeMs: number;
  score: number;
  exploded: boolean;
  lastResult: 'correct' | 'wrong' | null;
  status: RoomStatus;
  round: number;
  bonus: number;
  penalty: number;
  countdownMs: number;
  standings: Standing[] | null;
  answered: number;
  roundPoints: number | null;
  question: Question | null;
  review: ReviewItem[] | null;
}

export interface Bank {
  id: string;
  name: string;
  count: number;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };
