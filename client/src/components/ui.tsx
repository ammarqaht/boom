import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  CheckIcon,
  ChevronIcon,
  MenuIcon,
  MoonIcon,
  SoundOffIcon,
  SoundOnIcon,
  SunIcon,
} from './icons';
import QRCode from 'qrcode';
import { isMuted, setMuted } from '../lib/sound';

/* ════════════ الوقت والحالة ════════════ */

export function formatTime(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  return seconds >= 100 ? seconds.toFixed(0) : seconds.toFixed(1);
}

/**
 * المجرى يمتلئ عند بداية الجولة ثم ينحسر مع الوقت.
 *
 * والقيمة تتبع startSeconds في السيرفر: لو خالفتها لبدأ المجرى ممتلئاً
 * زمناً لا يتحرّك فيه، أو ناقصاً وهو في أوّله.
 */
export const BAR_FULL_MS = 30000;

export const barPercent = (ms: number) => Math.max(0, Math.min(100, (ms / BAR_FULL_MS) * 100));

export type Level = 'safe' | 'warn' | 'danger' | 'dead';

/*
 * عتبتان بالثواني لا بالنِّسَب: اللاعب يعدّ الثواني ولا يحسب نِسَباً،
 * والمنظّم ينادي «بقيت عشر» لا «بقي الثلث». وثباتهما بالثواني يجعل
 * لونَ الشاشة يعني الشيءَ نفسه مهما اختلف ما بدأ به اللاعب.
 */
export const WARN_MS = 10000;
export const DANGER_MS = 5000;

/** أخضر فوق العشر، كهرماني تحتها، أحمر تحت الخمس */
export function dangerLevel(ms: number): Level {
  if (ms > WARN_MS) return 'safe';
  if (ms > DANGER_MS) return 'warn';
  return 'danger';
}

export const levelVar: Record<Level, string> = {
  safe: 'var(--color-safe)',
  warn: 'var(--color-warn)',
  danger: 'var(--color-danger)',
  dead: 'var(--color-faint)',
};

/**
 * حالة اللاعب كما تُقرأ من طرف واحد: السكون يسبق كل شيء، ثم ما بقي من
 * الوقت. والتجميد ليس منها: هو حالةُ اللاعب لا حالةُ نبضه، فلونه على
 * سطح صفّه لا على مخطّطه — والمخطّط لا يكذب في قراءة الوقت.
 */
export function teamLevel(ms: number, flatlined?: boolean): Level {
  return flatlined ? 'dead' : dangerLevel(ms);
}

/**
 * زمن النبضة الواحدة بالثواني، متّصل لا متدرّج:
 * يقترب من 2.2ث عند بداية الجولة ومن 0.42ث عند الصفر،
 * فيُحسّ التسارع كتصاعد لا كقفزة بين ثلاث درجات.
 */
export function beatSeconds(ms: number) {
  const t = Math.max(0, Math.min(1, ms / BAR_FULL_MS));
  return 0.42 + 1.78 * t;
}

/**
 * متغيّرات الحالة التي ترثها العناصر: لون الحالة وزمن النبضة.
 *
 * الزمن هنا مُقرَّب إلى ربع ثانية عمداً: حركات CSS (إنذار الإطار ونبض
 * العدّاد) تُعاد مواءمتها كلما تغيّرت مدّتها، فلو مرّرنا القيمة المتّصلة
 * لتقطّعت ستين مرة في الثانية. أما المخطّط نفسه فيقرأ القيمة المتّصلة
 * داخل حلقة الإطارات ولا يمرّ من هنا.
 */
export function stateStyle(level: Level, ms: number, extra?: CSSProperties) {
  const beat = Math.max(0.5, Math.round(beatSeconds(ms) * 4) / 4);
  return {
    '--state': levelVar[level],
    '--beat': `${beat}s`,
    ...extra,
  } as CSSProperties;
}

/**
 * هل الشاشة واسعة؟ بعض التخطيطات تختلف بنيةً لا مقاساً — صفٌّ واحد على
 * الحاسب وبطاقةٌ من صفّين على الجوال — ولا يصحّ فيها ازدواج الشجرة:
 * مخطّطٌ مخفيّ بـdisplay:none يبقى يستهلك إطاراته.
 */
export function useWide(query = '(min-width: 640px)') {
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setWide(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);
  return wide;
}

/** هل طلب المستخدم تقليل الحركة؟ */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/* ════════════ الوضع الغامق والفاتح ════════════ */

const THEME_KEY = 'nabda:theme';

type Theme = 'dark' | 'light';

function readTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
}

/**
 * شاشة العرض غامقة دائماً ولوحة المنظّم فاتحة دائماً — لا خيار فيهما.
 * شاشة اللاعب وحدها تتبع اختيار صاحب الجهاز.
 */
export function useTheme(mode: Theme | 'user') {
  const [theme, setTheme] = useState<Theme>(() => (mode === 'user' ? readTheme() : mode));

  useEffect(() => {
    const next = mode === 'user' ? theme : mode;
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', next === 'light' ? '#F6F8F9' : '#060B12');
  }, [mode, theme]);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
  };

  return { theme, toggle };
}

export function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق';
  return (
    <IconButton title={label} onClick={onToggle}>
      {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
    </IconButton>
  );
}

/* ════════════ الذرّات ════════════ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  const skin = {
    primary: 'bg-action text-on-action hover:brightness-110',
    ghost: 'text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:bg-surface-2',
    danger: 'text-danger shadow-[inset_0_0_0_1px_var(--color-danger)]/60 hover:bg-danger-2',
  }[variant];
  const box = size === 'lg' ? 'px-6 py-3 text-lg' : 'px-4 py-2.5';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-chip font-black transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${skin} ${box} ${className}`}
    />
  );
}

/*
 * المقاس بخاصيّةٍ صريحة لا بصنفٍ يُمرّر: size-9 مكتوبٌ في الأساس، وأيّ
 * size-8 يأتي من الخارج يسقط بترتيب المصدر لا بترتيب السلسلة — فكان
 * النداء يطلب ٣٢ ويأخذ ٣٦ صامتاً.
 */
const ICON_SIZE = { 8: 'size-8', 9: 'size-9' } as const;

export function IconButton({
  children,
  danger,
  size = 9,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
  size?: 8 | 9;
}) {
  return (
    <button
      {...props}
      className={`flex ${ICON_SIZE[size]} shrink-0 items-center justify-center rounded-chip transition active:scale-90 disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100 ${
        danger
          ? 'text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_40%,transparent)] hover:bg-danger-2'
          : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:bg-surface-2'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`tile p-5 ${className}`}>{children}</div>;
}

/*
 * ══════════════ شريط التمرير ══════════════
 *
 * شريطُ المتصفّح يقتطع من عرض الصفحة ويُرسم برماد النظام، ولا يُلوَّن إلا
 * قليلاً ولا يُزاح عن مكانه. وهذا بديلُه: خيطٌ يطفو في حافّة الشاشة اليسرى،
 * لا يدخل في التخطيط، ولا يظهر إلا حين تُمرّر أو تقترب منه، ويُسحَب باليد
 * كما يُسحب شريط النظام.
 *
 * ويُمرَّر له الصندوقُ الذي يجري فيه التمرير، أو لا يُمرَّر شيءٌ فيتولّى
 * الصفحة كلها.
 */
export function Scrollbar({ box }: { box?: RefObject<HTMLElement | null> }) {
  const [bar, setBar] = useState<{ top: number; size: number } | null>(null);
  const [awake, setAwake] = useState(false);
  const [held, setHeld] = useState(false);
  const nap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grab = useRef<{ y: number; from: number } | null>(null);

  const node = useCallback(
    () => (box ? box.current : (document.scrollingElement as HTMLElement | null)),
    [box],
  );
  const view = useCallback(
    () => (box?.current ? box.current.clientHeight : window.innerHeight),
    [box],
  );

  const measure = useCallback(() => {
    const el = node();
    if (!el) return setBar(null);
    const seen = view();
    const all = el.scrollHeight;
    if (all <= seen + 2) return setBar(null);
    const size = Math.max(36, (seen / all) * seen);
    setBar({ top: (el.scrollTop / (all - seen)) * (seen - size), size });
  }, [node, view]);

  /* يستيقظ مع التمرير ثم ينام — فلا يبقى خطٌّ معلّقٌ على شاشةٍ ساكنة */
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(nap.current);
    nap.current = setTimeout(() => setAwake(false), 1100);
  }, []);

  useEffect(() => {
    const el = node();
    const target: EventTarget = box?.current ?? window;
    const onScroll = () => {
      measure();
      wake();
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    /* المحتوى يطول ويقصر بلا تمرير — والمراقب يرى ذلك */
    const watch = new ResizeObserver(measure);
    if (el) {
      watch.observe(el);
      if (el.firstElementChild) watch.observe(el.firstElementChild);
    }
    measure();
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      watch.disconnect();
      clearTimeout(nap.current);
    };
  }, [box, node, measure, wake]);

  useEffect(() => {
    if (!held) return;
    const move = (event: PointerEvent) => {
      const el = node();
      const start = grab.current;
      if (!el || !start || !bar) return;
      const seen = view();
      const span = seen - bar.size;
      if (span <= 0) return;
      const ratio = (event.clientY - start.y) / span;
      el.scrollTop = start.from + ratio * (el.scrollHeight - seen);
    };
    const up = () => setHeld(false);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
  }, [held, bar, node, view]);

  if (!bar) return null;

  return (
    <div
      onPointerEnter={wake}
      className={`${box ? 'absolute' : 'fixed'} top-0 bottom-0 left-0 z-40 w-3`}
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <span
        data-held={held}
        onPointerDown={(event) => {
          const el = node();
          if (!el) return;
          grab.current = { y: event.clientY, from: el.scrollTop };
          setHeld(true);
          wake();
        }}
        className="scroll-thumb"
        style={{
          height: bar.size,
          transform: `translateY(${bar.top}px)`,
          /* لا يختفي تماماً: موضعُك في الصفحة خبرٌ يُحتاج ولو سكنت */
          opacity: awake || held ? 1 : 0.45,
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}

/*
 * القائمة المنسدلة — مكتوبةٌ بالكامل لا مأخوذةٌ من النظام.
 *
 * قائمةُ النظام تُرسمها المنصّة لا الصفحة: خطُّها خطُّ ويندوز، وحوافّها
 * حوافّه، وحبرُها أسوده — فتقع في وسط الشاشة كرقعةٍ من برنامجٍ آخر.
 * ولا تُصلَح بالـCSS لأن قائمتها المنسدلة خارج المستند أصلاً.
 *
 * والمكتوبة تكلّف ما تكلّفه لوحةُ المفاتيح: الأسهم تتنقّل، وEnter يختار،
 * وEsc يغلق، والضغط خارجها يغلقها. وبغير ذلك تكون زينةً لا أداة.
 */
export type Choice = { value: string; label: string; hint?: string };

export function Select({
  value,
  choices,
  onChange,
  className = '',
  align = 'start',
}: {
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const current = choices.find((c) => c.value === value);

  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        choices.findIndex((c) => c.value === value),
      ),
    );
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, choices, value]);

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') return setOpen(false);
    if (!open && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown')) {
      event.preventDefault();
      return setOpen(true);
    }
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((n) => (n + step + choices.length) % choices.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onChange(choices[active].value);
      setOpen(false);
    }
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((on) => !on)}
        onKeyDown={keys}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-chip bg-surface px-3 py-2 text-sm font-bold text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] transition outline-none hover:bg-surface-2 ${
          open ? 'shadow-[inset_0_0_0_1.5px_var(--color-signal)]' : ''
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-right">{current?.label ?? '—'}</span>
        <ChevronIcon
          size={15}
          className={`shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className={`tile absolute top-[calc(100%+4px)] z-40 max-h-72 min-w-full overflow-y-auto p-1 shadow-xl ${
            align === 'end' ? 'end-0' : 'start-0'
          }`}
        >
          {choices.map((choice, i) => (
            <li key={choice.value}>
              <button
                type="button"
                role="option"
                aria-selected={choice.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onChange(choice.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-right text-sm whitespace-nowrap transition ${
                  choice.value === value ? 'font-black text-signal-ink' : 'font-bold text-ink-2'
                } ${i === active ? 'bg-surface-2' : ''}`}
              >
                <span className="flex-1">{choice.label}</span>
                {choice.hint && <span className="tnum text-xs text-muted">{choice.hint}</span>}
                {choice.value === value && <CheckIcon size={14} className="text-signal" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold tracking-[0.08em] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-chip bg-sunk px-4 py-3 text-lg font-bold text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none transition placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--color-signal)] ${props.className ?? ''}`}
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-chip bg-danger-2 px-4 py-2.5 text-center font-bold text-danger">
      {children}
    </p>
  );
}

/** شارة بيانات: تسمية خافتة وقيمة سوداء */
export function Chip({
  label,
  value,
  signal,
}: {
  label: string;
  value: ReactNode;
  signal?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-chip px-3.5 py-1.5 font-medium text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)]">
      {label}
      <b className={`tnum font-black ${signal ? 'tracking-[0.14em] text-signal' : 'text-ink'}`}>
        {value}
      </b>
    </span>
  );
}

/* ════════════ الوردمارك ════════════ */

/** المخطّط هو سطر الكتابة، وقمّة R وحدها تنهض فوق الحروف */
const WORD_TRACE = 'M120 34h-22q-5-6-10 0h-6l-2 4l-3.5-30l-3.5 34l-2-8h-7q-6-8-12 0H0';

export function Wordmark({ className = 'text-2xl' }: { className?: string }) {
  return (
    <span className={`word ${className}`}>
      <svg className="word-sig" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true">
        <path d={WORD_TRACE} />
      </svg>
      <span className="word-txt">نبضة</span>
    </span>
  );
}

/** العلامة المختصرة — نفس قمّة الوردمارك، مربّعة */
export function PulseMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M38 22h-8l-2 3l-3.5-16l-4 26l-3-13h-4l-2.5 4H2"
        stroke="currentColor"
        strokeWidth={3.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ════════════ أدوات الشاشات ════════════ */

export function MuteButton() {
  const [muted, setMutedState] = useState(isMuted());
  const label = muted ? 'تشغيل الصوت' : 'كتم الصوت';
  return (
    <IconButton
      title={label}
      aria-label={label}
      danger={muted}
      onClick={() => {
        const next = !muted;
        setMuted(next);
        setMutedState(next);
      }}
    >
      {muted ? <SoundOffIcon size={17} /> : <SoundOnIcon size={17} />}
    </IconButton>
  );
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** فعل لا رجعة فيه: يحتاج ضغطاً مستمراً بدل نقرة */
  hold?: string;
}

/**
 * قائمة الخيارات — ومكان الأفعال الخطرة الوحيد.
 * إخفاؤها عن الشاشة يمنع الضغط بالخطأ، والضغط المستمر يمنعه مرة أخرى.
 */
export function Menu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* على الجوال تكفي الأيقونة: الترويسة ضيّقة والكلمة تُزاحم ما هو أهم */}
      <Button
        variant="ghost"
        className="px-3 sm:px-4"
        aria-label="خيارات"
        title="خيارات"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon size={17} />
        <span className="hidden sm:inline">خيارات</span>
      </Button>

      {open && (
        <div className="rise-in absolute left-0 z-50 mt-2 w-72 rounded-card bg-surface p-1.5 shadow-[inset_0_0_0_1px_var(--color-line-2),0_24px_48px_-18px_rgb(0_0_0/0.55)]">
          {actions.map((action) =>
            action.hold ? (
              <HoldButton
                key={action.label}
                label={action.label}
                hint={action.hold}
                onConfirm={() => {
                  setOpen(false);
                  action.onClick();
                }}
              />
            ) : (
              <button
                key={action.label}
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
                className="flex w-full items-center gap-3 rounded-chip px-3 py-2.5 text-right font-bold text-ink-2 transition hover:bg-surface-2"
              >
                {action.icon && <span className="text-muted">{action.icon}</span>}
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

const HOLD_MS = 900;

/** يُنفَّذ بعد ضغط مستمر، ويملأ نفسه أثناءه ليعرف المستخدم ما يحدث */
export function HoldButton({
  label,
  hint,
  onConfirm,
  className = '',
}: {
  label: string;
  hint?: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [held, setHeld] = useState(0);
  const frame = useRef(0);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    setHeld(0);
  };

  const start = () => {
    const from = performance.now();
    const step = (now: number) => {
      const pct = Math.min(1, (now - from) / HOLD_MS);
      setHeld(pct);
      if (pct >= 1) {
        stop();
        onConfirm();
        return;
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <div className={`mt-1.5 border-t border-line pt-1.5 ${className}`}>
      <button
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        style={{ '--held': held } as CSSProperties}
        className="relative flex w-full items-center gap-3 overflow-hidden rounded-chip px-3 py-2.5 text-right font-black text-danger transition select-none hover:bg-danger-2"
      >
        <span className="hold-fill" aria-hidden="true" />
        <span className="relative">{label} — استمر بالضغط</span>
      </button>
      {hint && <p className="px-3 pt-1.5 pb-1 text-xs font-medium text-muted">{hint}</p>}
    </div>
  );
}

/**
 * مبدّل مقطعي: خيارات قليلة يُنتقى أحدها، ويُشرح المنتقى تحته.
 * أوضح من قائمة منسدلة حين تكون الخيارات قليلة وأثرها كبير.
 *
 * والأعمدة بعدد الخيارات لا برقمٍ ثابت: ثلاثةُ أعمدة مع أربعة خيارات
 * تترك الرابع وحيداً في سطرٍ ثانٍ، فيُقرأ استثناءً لا نظيراً لإخوته.
 * وعلى الجوّال عمودان دائماً — أربعةٌ في عرض الهاتف تُقصّ كلماتها.
 */
export function Segmented<T extends string>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { id: T; label: string; hint: string }[];
  onPick: (id: T) => void;
}) {
  const picked = options.find((o) => o.id === value);
  return (
    <div>
      <div
        className="grid grid-cols-2 gap-1.5 sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
        style={{ '--cols': options.length } as CSSProperties}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPick(option.id)}
            className={`rounded-chip py-2.5 text-center text-sm font-black transition ${
              option.id === value
                ? 'bg-signal text-on-signal'
                : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:bg-surface-2'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {picked && <p className="mt-2 text-xs leading-relaxed text-muted">{picked.hint}</p>}
    </div>
  );
}

/** زرّ نصّي صغير يتصدّر قائمةً — «تحديد الكل» ونحوه */
export function MiniAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-chip px-2.5 py-1 text-xs font-black text-signal transition hover:bg-signal-2"
    >
      {children}
    </button>
  );
}

/** خيار قابل للتحديد المتعدد — لبنوك الأسئلة */
export function CheckOption({
  checked,
  onToggle,
  title,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-3 rounded-chip px-3 py-2.5 text-right font-bold transition ${
        checked
          ? 'text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_45%,transparent)]'
          : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
      }`}
    >
      <span
        className={`flex size-[18px] shrink-0 items-center justify-center rounded-[3px] transition ${
          checked
            ? 'bg-signal text-on-signal'
            : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-2)]'
        }`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      {title}
      {hint && <span className="tnum mr-auto text-xs font-medium text-muted">{hint}</span>}
    </button>
  );
}

/** رمز الانضمام — مشترك بين شاشة العرض ولوحة المسؤول */
export function useQr(url: string, dark: string, light: string) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, {
      margin: 0,
      width: 240,
      color: { dark, light },
    })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url, dark, light]);
  return src;
}

/** سطر الحقوق — الوحيد الذي بقي */
export function Credit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs font-medium text-faint ${className}`}>
      تم إنشاء الموقع بواسطة مشعل الجلال
    </p>
  );
}

/**
 * هيكل شاشات الدخول.
 * على الجوال: عمود واحد يملأ الشاشة. وعلى الحاسب: الهوية والشرح يميناً
 * والنموذج يساراً — فلا تبقى بطاقة صغيرة وحيدة وسط فراغ واسع.
 */
export function FormPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-9 px-5 py-10 lg:flex-row lg:items-center lg:gap-16">
        <div className="lg:flex-1">
          <div className="flex items-baseline justify-between gap-4 lg:block">
            <Wordmark className="text-4xl lg:text-6xl" />
            <span className="text-sm font-bold tracking-[0.14em] text-muted lg:mt-4 lg:block">
              {title}
            </span>
          </div>
          <p className="mt-4 hidden max-w-[40ch] leading-relaxed text-muted lg:block lg:text-lg">
            {lead}
          </p>
          <div
            className="lane lane-bare mt-9 hidden h-20 lg:block"
            style={
              {
                '--state': 'var(--color-signal)',
                '--tile': '116px',
                '--amp': '54px',
              } as CSSProperties
            }
            aria-hidden="true"
          >
            <span className="lane-run lane-drift" style={{ '--drift': '6s' } as CSSProperties} />
          </div>
        </div>

        <div className="w-full lg:max-w-xl lg:flex-1">{children}</div>
      </div>
      <Credit className="px-5 pb-6 text-center" />
    </div>
  );
}
