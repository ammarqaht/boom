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
  /** سكن نبضه وهو منقطع — فلم يُنهِ الجولة على غيره */
  dropped?: boolean;
  connected: boolean;
  answered: number;
  correct: number;
  /** مجمّدة حالياً — مقفلة عن الإجابة */
  locked: boolean;
  /** المتبقي من التجميد بالمللي — لعدّاد الشاشات */
  lockedMs: number;
  /** اسمُ من جمّدها — ما دام القفل قائماً */
  frozenBy: string | null;
  /** مضاعفة ×2 فعّالة هذه الجولة — بطاقة ذهبية */
  doubled: boolean;
  /** دخل والجولة جارية — ينتظر القادمة ولا يُحتسب في هذه */
  waiting: boolean;
  /** ما بقي له من كل بطاقة — للوحة المنظّم */
  cardsLeft: Record<CardId, number>;
  shieldLeft?: number;
  truceMs?: number;
  reviveLeft?: number;
  revivedAt?: number | null;
  blackout?: boolean;
}

export interface Award {
  teamId: string;
  name: string;
  points: number;
  /** النقاط قبل المضاعفة — تُقرأ بها المعادلة على شاشة اللاعب */
  base?: number;
  timeMs: number;
  flatlined?: boolean;
  dropped?: boolean;
  /** مضاعِفه في هذه الجولة — تُضرب فيه نقطةُ إجابةٍ وصلت متأخرة */
  factor?: number;
  /** كم من نقاطه جاء من الإجابات الصحيحة */
  correct?: number;
  /** صاحب أعلى وقت في الجولة */
  top?: boolean;
  /** ضوعِفت نقاطه ببطاقة المضاعفة */
  doubled?: boolean;
}

export type CardId =
  | 'time'
  | 'truce'
  | 'shield'
  | 'revive'
  | 'fort'
  | 'mirror'
  | 'blackout'
  | 'freeze'
  | 'steal'
  | 'double';

export interface CardEvent {
  kind: 'hit' | 'blocked' | 'reflected';
  card: CardId;
  by: string;
  on: string;
  secs?: string;
}

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
  /** كم مرّةً اشتُريت في هذه الفترة — وبها وحدها يُنقض الشراء */
  bought: number;
  target: boolean;
}

export interface Shop {
  open: boolean;
  cards: ShopCard[];
  pending: Partial<Record<CardId, boolean>>;
  chosen: Partial<Record<CardId, string[]>>;
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
  /** علمُ دولةٍ يُعرض مع السؤال — رمزُها بحرفين، وصورتُه في public/flags */
  flag?: string | null;
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
  /** البطاقات وحدودها — تُقرأ في لوحة المنظّم */
  cards: { id: CardId; name: string; limit: number }[];
  result: RoomResult | null;
  history: RoomResult[];
  cardEvents?: CardEvent[];
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
  /** علمُ دولةٍ يُعرض مع السؤال — رمزُها بحرفين، وصورتُه في public/flags */
  flag?: string | null;
  answer: number;
  choice: number;
  isCorrect: boolean;
}

/** السؤال كما يصل المتصفح — بلا الخيار الصحيح */
export interface Question {
  id: string;
  q: string;
  options: string[];
  /** علمُ دولةٍ يُعرض مع السؤال — رمزُها بحرفين، وصورتُه في public/flags */
  flag?: string | null;
}

export interface TeamState {
  id: string;
  name: string;
  timeMs: number;
  score: number;
  flatlined: boolean;
  /** سكن نبضه وهو منقطع — فلم يُنهِ الجولة على غيره */
  dropped?: boolean;
  /** دخل والجولة جارية — شاشته «انتظر الجولة القادمة» */
  waiting: boolean;
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
  /** نقاط الجولة قبل المضاعفة، وهل ضُوعفت — لمعادلة «أ × ٢ = ب» */
  roundBase: number | null;
  roundDoubled: boolean;
  question: Question | null;
  review: ReviewItem[] | null;
  /** قفل التجميد المتبقي بالمللي، واسم من جمّدك */
  lockedMs: number;
  frozenBy: string | null;
  shieldLeft?: number;
  truceMs?: number;
  reviveLeft?: number;
  revivedAt?: number | null;
  blackout?: boolean;
  blackoutBy?: string | null;
  notices?: string[];
  shop: Shop;
}

export interface Bank {
  id: string;
  name: string;
  count: number;
}

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string };
