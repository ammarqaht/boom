import type { CardId, Effect } from './types';
import type { Tone } from '../components/ui';
import {
  DoubleIcon,
  DuelIcon,
  MirrorIcon,
  ReviveIcon,
  ShieldIcon,
  SnowflakeIcon,
  StealIcon,
  TimePlusIcon,
} from '../components/icons';
import { countOf } from './arabic';

export type CardLook = {
  Icon: typeof TimePlusIcon;
  effect: string;
  skin: string;
  ink: string;
  /** لون البطاقة متغيّراً — تُصبغ به مربّعاتُ المتجر */
  color: string;
  tone: Tone;
};

export const CARD_LOOK: Record<CardId, CardLook> = {
  time: {
    Icon: TimePlusIcon,
    effect: 'تبدأ الجولة القادمة بـ١٥ ثانية إضافية',
    skin: 'skin-time',
    ink: 'text-safe',
    color: 'var(--color-safe)',
    tone: 'safe',
  },
  shield: {
    Icon: ShieldIcon,
    effect: 'أول ٣ إجابات خاطئة لا يُخصم عليها وقت',
    skin: '',
    ink: 'text-signal',
    color: 'var(--color-signal)',
    tone: 'signal',
  },
  revive: {
    Icon: ReviveIcon,
    effect: '٢٠ ثانية إضافية في حال توقف نبضك',
    skin: '',
    ink: 'text-danger',
    color: 'var(--color-danger)',
    tone: 'danger',
  },
  double: {
    Icon: DoubleIcon,
    effect: 'نقاط مضاعفة للجولة القادمة في حال لم يتوقف نبضك',
    skin: 'skin-gold',
    ink: 'text-gold',
    color: 'var(--color-gold)',
    tone: 'gold',
  },
  freeze: {
    Icon: SnowflakeIcon,
    effect: 'تقفل لاعباً عن الإجابة ٨ ثوانٍ في بداية الجولة',
    skin: 'skin-frost',
    ink: 'text-frost',
    color: 'var(--color-frost)',
    tone: 'frost',
  },
  steal: {
    Icon: StealIcon,
    effect: 'تأخذ ٨ ثوانٍ من لاعبٍ وتضيفها إلى نبضك',
    skin: '',
    ink: 'text-warn',
    color: 'var(--color-warn)',
    tone: 'gold',
  },
  duel: {
    Icon: DuelIcon,
    effect: 'تتحدى لاعباً أعلى منك نقاطاً، إذا أصبت أكثر تسرق منه ٧ نقاط',
    skin: '',
    ink: 'text-danger',
    color: 'var(--color-danger)',
    tone: 'danger',
  },
  mirror: {
    Icon: MirrorIcon,
    effect: 'تردّ التجميد والسرقة على من أرسلها',
    skin: '',
    ink: 'text-signal',
    color: 'var(--color-signal)',
    tone: 'signal',
  },
};

/** البطاقات في المتجر ثلاثُ زمر: ما تعين به نفسك، وما تضرب به غيرك، وما تصدّ به */
export const CARD_GROUPS: { title: string; cards: CardId[] }[] = [
  { title: 'دعم', cards: ['time', 'revive', 'double'] },
  { title: 'هجوم', cards: ['freeze', 'steal', 'duel'] },
  { title: 'دفاع', cards: ['shield', 'mirror'] },
];

export const ATTACK_DONE: Partial<Record<CardId, (name: string) => string>> = {
  freeze: (name) => `جمّدتَ ${name}`,
  steal: (name) => `ستسرق من ${name}`,
  duel: (name) => `تحدّيتَ ${name}`,
};

export const PICK_LABEL: Partial<Record<CardId, string>> = {
  freeze: 'تجميد',
  steal: 'سرقة',
  duel: 'مبارزة',
};

const PLURAL = new Intl.PluralRules('ar');

/** «شرارة» و«شرارتان» و«٣ شرارات» و«١٤ شرارة» */
export const sparksWord = (n: number) => {
  const pick = PLURAL.select(n);
  return pick === 'two' ? 'شرارتان' : pick === 'few' ? 'شرارات' : 'شرارة';
};

export const pointsWord = (n: number) => {
  const pick = PLURAL.select(n);
  return pick === 'two' ? 'نقطتان' : pick === 'few' ? 'نقاط' : 'نقطة';
};

/**
 * نصُّ الشارة — قصيرٌ يُقرأ على شريطٍ ضيّق، ومعه وصفٌ أطول للتلميح.
 * المبارزة تُقرأ نتيجتُها الحيّة: «٣:٢ النسور».
 */
export function effectText(fx: Effect): { short: string; long: string } {
  switch (fx.card) {
    case 'time':
      return { short: `+${fx.n}`, long: `بدأ بوقتٍ إضافي +${fx.n} ث` };
    case 'shield':
      return {
        short: `×${fx.n}`,
        long: `درعٌ يقي ${countOf(fx.n ?? 0, { one: 'خطأً واحداً', two: 'خطأين', few: 'أخطاء', many: 'خطأً' })}`,
      };
    case 'revive':
      return { short: 'جاهز', long: 'صاعق القلب جاهز' };
    case 'mirror':
      return { short: 'مرآة', long: 'مرآةٌ تردّ الهجوم' };
    case 'steal':
      return (fx.n ?? 0) < 0
        ? { short: `${fx.n} ${fx.who}`, long: `سرق منه ${fx.who} ${-(fx.n ?? 0)} ث` }
        : { short: `+${fx.n} ${fx.who}`, long: `سرق ${fx.n} ث من ${fx.who}` };
    case 'duel':
      return {
        short: `${fx.mine ?? 0}:${fx.theirs ?? 0} ${fx.who}`,
        long: `يبارز ${fx.who}: ${fx.mine ?? 0} مقابل ${fx.theirs ?? 0}`,
      };
    default:
      return { short: '', long: '' };
  }
}
