export type RoomStatus = 'lobby' | 'countdown' | 'running' | 'paused' | 'ended' | 'finished';

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
  flatlined: boolean;
  connected: boolean;
  answered: number;
  correct: number;
  /** مجمّدة حالياً — مقفلة عن الإجابة */
  locked: boolean;
  /** المتبقي من التجميد بالمللي — لعدّاد الشاشات */
  lockedMs: number;
  /** مضاعفة ×3 فعّالة هذه الجولة — بطاقة ذهبية */
  doubled: boolean;
}

export interface Award {
  teamId: string;
  name: string;
  points: number;
  timeMs: number;
  flatlined?: boolean;
  /** كم من نقاطه جاء من الإجابات الصحيحة */
  correct?: number;
  /** صاحب أعلى وقت في الجولة */
  top?: boolean;
  /** ضوعِفت نقاطه ببطاقة المضاعفة */
  doubled?: boolean;
}

export type CardId = 'time' | 'freeze' | 'double';

/** بطاقة في متجر اللاعب */
export interface ShopCard {
  id: CardId;
  name: string;
  price: number;
  /** استُنفدت مرّاتها كلها */
  used: boolean;
  /** كم مرة بقيت منها */
  left: number;
  affordable: boolean;
}

export interface Shop {
  open: boolean;
  cards: ShopCard[];
  pending: { time: boolean; double: boolean };
  rivals: { id: string; name: string }[];
}

export interface RoomResult {
  round: number;
  awards: Award[];
}

/**
 * سطرٌ في سجلّ أسئلة الغرفة — للمنظّم وحده.
 * يحمل موضع الإجابة الصحيحة، فلا يصل قناة اللاعبين أبداً.
 */
export interface FeedItem {
  id: string;
  q: string;
  options: string[];
  answer: number;
  level: number;
  shown: number;
  right: number;
  wrong: number;
  reported: boolean;
}

export interface RoomState {
  code: string;
  /** ما كتبه المنظّم: النشاط أو النادي — به تُعرف الغرفة في السجلّ */
  name: string;
  status: RoomStatus;
  round: number;
  bankIds: string[];
  /** مستوى الأسئلة: primary | middle | secondary | university */
  difficulty: string;
  settings: Settings;
  result: RoomResult | null;
  history: RoomResult[];
  standings: Standing[] | null;
  displayBlurred: boolean;
  countdownMs: number;
  teams: PublicTeam[];
}

/** سؤال بعد انتهاء الجولة — يحمل الإجابة الصحيحة واختيار اللاعب */
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
  flatlined: boolean;
  lastResult: 'correct' | 'wrong' | null;
  status: RoomStatus;
  round: number;
  bonus: number;
  penalty: number;
  countdownMs: number;
  standings: Standing[] | null;
  answered: number;
  correct: number;
  roundPoints: number | null;
  question: Question | null;
  review: ReviewItem[] | null;
  /** قفل التجميد المتبقي بالمللي، واسم من جمّدك */
  lockedMs: number;
  frozenBy: string | null;
  shop: Shop;
}

export interface Bank {
  id: string;
  name: string;
  count: number;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };
