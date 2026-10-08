import type { CardId } from './types';
import type { Tone } from '../components/ui';
import {
  DoubleIcon,
  EyeOffIcon,
  FortIcon,
  HourglassIcon,
  MirrorIcon,
  ReviveIcon,
  ShieldIcon,
  SnowflakeIcon,
  StealIcon,
  TimePlusIcon,
} from '../components/icons';

export type CardLook = {
  Icon: typeof TimePlusIcon;
  effect: string;
  skin: string;
  ink: string;
  tone: Tone;
};

export const CARD_LOOK: Record<CardId, CardLook> = {
  time: {
    Icon: TimePlusIcon,
    effect: 'تبدأ الجولة القادمة بعشر ثوانٍ زيادة',
    skin: 'skin-time',
    ink: 'text-safe',
    tone: 'safe',
  },
  truce: {
    Icon: HourglassIcon,
    effect: 'عدّادك لا ينزل أول عشر ثوانٍ من الجولة',
    skin: 'skin-time',
    ink: 'text-safe',
    tone: 'safe',
  },
  shield: {
    Icon: ShieldIcon,
    effect: 'أول إجابتين خاطئتين لا يُخصم عليهما وقت',
    skin: '',
    ink: 'text-signal',
    tone: 'signal',
  },
  revive: {
    Icon: ReviveIcon,
    effect: 'إذا وصل عدّادك صفراً يعود نبضك بعشر ثوانٍ — مرّة واحدة',
    skin: '',
    ink: 'text-danger',
    tone: 'danger',
  },
  fort: {
    Icon: FortIcon,
    effect: 'يصدّ عنك كل تجميدٍ وتعتيمٍ وسرقة في الجولة القادمة',
    skin: '',
    ink: 'text-ink-2',
    tone: 'signal',
  },
  mirror: {
    Icon: MirrorIcon,
    effect: 'يردّ كل تجميدٍ وتعتيمٍ وسرقة على من أرسلها',
    skin: '',
    ink: 'text-signal',
    tone: 'signal',
  },
  blackout: {
    Icon: EyeOffIcon,
    effect: 'يُخفي عدّاد لاعبٍ عن شاشته طوال الجولة القادمة',
    skin: '',
    ink: 'text-muted',
    tone: 'signal',
  },
  freeze: {
    Icon: SnowflakeIcon,
    effect: 'تقفل لاعباً عن الإجابة خمس ثوانٍ في بداية الجولة',
    skin: 'skin-frost',
    ink: 'text-frost',
    tone: 'frost',
  },
  steal: {
    Icon: StealIcon,
    effect: 'تأخذ خمس ثوانٍ من لاعبٍ وتضيفها إلى نبضك',
    skin: '',
    ink: 'text-warn',
    tone: 'gold',
  },
  double: {
    Icon: DoubleIcon,
    effect: 'نقاط جولتك القادمة ×٢ — تسقط إن توقف نبضك',
    skin: 'skin-gold',
    ink: 'text-gold',
    tone: 'gold',
  },
};

export const ATTACK_DONE: Partial<Record<CardId, (name: string) => string>> = {
  freeze: (name) => `جمّدتَ ${name}`,
  blackout: (name) => `عتّمتَ على ${name}`,
  steal: (name) => `ستسرق من ${name}`,
};

export const PICK_LABEL: Partial<Record<CardId, string>> = {
  freeze: 'تجميد',
  blackout: 'تعتيم',
  steal: 'سرقة',
};
