import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ReviewItem, RoomResult, Standing } from '../lib/types';
import {
  Button,
  barPercent,
  beatSeconds,
  formatTime,
  levelVar,
  prefersReducedMotion,
  teamLevel,
  type Level,
} from './ui';
import {
  CheckIcon,
  CloseIcon,
  CrownIcon,
  FlatlineIcon,
  HistoryIcon,
  PauseIcon,
  PulseIcon,
  TrophyIcon,
} from './icons';

/**
 * ══════════════ المجرى ══════════════
 * العنصر الأساسي في الهوية، ومشترك بين الشاشات الثلاث.
 *
 * يمينه — حيث يبدأ القارئ — ما بقي من الوقت، تجري فيه النبضات من اليمين
 * إلى اليسار حتى تبلغ رأس الكاتب المضيء. ويساره خطّ مستقيم: ما انقضى.
 * المسافة بين نبضة وأخرى ثابتة بالبكسل، فعدد النبضات الظاهرة ينقص مع
 * الوقت وحده حتى يستقيم المجرى كله.
 *
 * لماذا حلقة إطارات بدل حركة CSS؟ لأن زمن النبضة يتغيّر باستمرار مع تناقص
 * الوقت، وتغيير animation-duration يُعيد مواءمة الحركة في كل مرة فتتقطّع.
 * هنا نجمع الطور بأنفسنا: phase += السرعة × زمن الإطار — فيتسارع الجريان
 * تسارعاً متّصلاً بلا قفزة واحدة. والسيرفر يبثّ كل ٢٥٠ مللي، فنُكمل بينها
 * محلياً حتى ينحسر المجرى بسلاسة لا كل ربع ثانية.
 *
 * الكتابة تتم على العنصر مباشرةً (transform وwidth) بلا إعادة رسم لشجرة
 * React في كل إطار — فثمانية مجارٍ على شاشة العرض تبقى عند ٦٠ إطاراً.
 */
type LaneSize = 'sm' | 'md' | 'lg';
const LANE_TILE = { sm: 78, md: 100, lg: 116 } as const;
const LANE_AMP = { sm: 22, md: 44, lg: 54 } as const;
/* وهج رأس الكاتب بقدر المجرى: ما يليق بالقاعة يصير لطخةً في صفّ المنظّم */
const LANE_GLOW = { sm: 7, md: 14, lg: 20 } as const;
/*
 * لكل مقاسٍ رسمُه وقلمُه: القناع يُحجَّم إلى ارتفاع المجرى، فقلمُ المقاس
 * الكبير يخرج عند الصغير أرقّ من بكسل ونصف فيذوب خطّ الأساس الأفقيّ
 * وتُقرأ النبضات متقطّعة. انظر التعليق في trace-sm.svg.
 */
const LANE_TRACE = {
  sm: "url('/trace-sm.svg')",
  md: "url('/trace.svg')",
  lg: "url('/trace.svg')",
} as const;
const LANE_PEN = { sm: 3, md: 2.4, lg: 2.4 } as const;

/*
 * سُمك الخطّ المستقيم = سُمك الموجة بعد التحجيم. الرسم بارتفاع ٤٢،
 * فالنسبة ثابتة ومنها يُشتقّ الخطّ — وإلا ظهر خطّان متجاوران لا واحد.
 *
 * ولا يُرسم هذا الخطّ خلف الموجة الجارية أبداً، إنما لما انقضى من الوقت
 * وللنبض الساكن — انظر .lane-run في index.css.
 */
const laneLine = (size: LaneSize) => `${((LANE_PEN[size] * LANE_AMP[size]) / 42).toFixed(2)}px`;

export function Lane({
  timeMs,
  running,
  flatlined,
  level: forced,
  size = 'md',
  className = '',
  style,
}: {
  timeMs: number;
  /** الجولة جارية: المجرى ينحسر مع الوقت */
  running?: boolean;
  flatlined?: boolean;
  /** حالة مفروضة: بعد انتهاء الجولة لا معنى لقراءة الخطر من الوقت */
  level?: Level;
  /** lg لشاشة العرض، md للجوال، sm لصفوف لوحة المنظّم */
  size?: LaneSize;
  className?: string;
  style?: CSSProperties;
}) {
  const level = forced ?? teamLevel(timeMs, flatlined);
  const tile = LANE_TILE[size];
  const coverRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef<HTMLSpanElement>(null);
  const anchor = useRef({ ms: timeMs, at: performance.now() });
  const phase = useRef(0);

  // كل بثّ من السيرفر يعيد ضبط المرساة، وحلقة الإطارات تُكمل بينها
  useEffect(() => {
    anchor.current = { ms: timeMs, at: performance.now() };
  }, [timeMs]);

  // ساكن: نضع الغطاء مرة واحدة
  useEffect(() => {
    if (running && !flatlined) return;
    if (coverRef.current) coverRef.current.style.transform = coverShift(timeMs);
  }, [timeMs, running, flatlined]);

  /*
   * حلقة واحدة تكتب إزاحتين لا غير — بلا تخطيط ولا إعادة رسم.
   * النبضات لا تسكن أبداً ما دام النبض حيّاً: الجهاز يعمل في الانتظار
   * وفي الإيقاف كما يعمل في الجولة، وهذا ما يجعله جهازاً لا صورةً لجهاز.
   * والفرق أن الانحسار وحده موقوف حتى تجري الجولة.
   */
  useEffect(() => {
    if (flatlined || prefersReducedMotion()) return;
    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const ms = running
        ? Math.max(0, anchor.current.ms - (now - anchor.current.at))
        : anchor.current.ms;
      phase.current = (phase.current + (tile / beatSeconds(ms)) * dt) % tile;
      if (runRef.current) runRef.current.style.transform = `translateX(${-phase.current}px)`;
      if (running && coverRef.current) coverRef.current.style.transform = coverShift(ms);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [running, flatlined, tile]);

  return (
    <div
      className={`lane ${className}`}
      style={
        {
          '--state': levelVar[level],
          '--tile': `${tile}px`,
          '--amp': `${LANE_AMP[size]}px`,
          '--glow': `${LANE_GLOW[size]}px`,
          '--line': laneLine(size),
          '--trace': LANE_TRACE[size],
          ...style,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {flatlined ? (
        <span className="lane-flat" />
      ) : (
        <>
          {/* الشريط الواصل للمقاس الصغير وحده — انظر .lane-line في index.css */}
          {size === 'sm' && <span className="lane-line" />}
          <span ref={runRef} className="lane-run" />
          <span ref={coverRef} className="lane-cover" style={{ transform: coverShift(timeMs) }} />
        </>
      )}
    </div>
  );
}

/** الغطاء يُزاح يساراً بمقدار ما بقي من الوقت، فينكشف المجرى من اليمين */
const coverShift = (ms: number) => `translateX(${-barPercent(ms)}%)`;

/*
 * ══════════════ الستارة ══════════════
 * لوحةٌ تملأ الشاشة وتُسلّم المشهد التالي.
 *
 * drop  — تنزل من أعلى كلوحة واحدة: حركةٌ واحدة كبيرة تُقرأ من آخر القاعة.
 * bloom — وميضٌ بلون المصير ثم تتفتّح التفاصيل من خطّ المنتصف إلى الأطراف:
 *         على جهاز اللاعب يصل الخبرُ قبل تفصيله.
 *
 * والخروج واحد: نبضةٌ تعبر المنتصف من اليمين — موجةٌ بالقناع نفسه لا خطاً
 * مستقيماً — فتقصّ اللوحة نصفين ينزاحان صاعداً وهابطاً.
 */
export const CURTAIN_OUT_MS = 1480;
/** الانفراج وحده، بلا انتظار النبضة القاصّة */
export const CURTAIN_OPEN_MS = 820;

export function Curtain({
  mode = 'drop',
  tone = 'var(--color-signal)',
  cut = true,
  front,
  leaving,
  children,
}: {
  mode?: 'drop' | 'bloom';
  /** لون الوميض والنبضة القاصّة */
  tone?: string;
  /** هل تقصّها نبضة عند الخروج؟ ستارةُ السكون تنفرج بلا نبضة */
  cut?: boolean;
  /** طبقةٌ فوق ستارةٍ أخرى — فتكشفها حين تنفرج */
  front?: boolean;
  leaving: boolean;
  children: ReactNode;
}) {
  const body = (
    <div className="curtain-body flex flex-col justify-center bg-ground">{children}</div>
  );

  return (
    <div
      className={`curtain-set ${mode === 'drop' ? 'curtain-drop' : 'curtain-bloom'} ${
        cut ? '' : 'curtain-nocut'
      } ${front ? 'curtain-front' : ''} ${leaving ? 'curtain-set-out' : ''}`}
      style={{ '--tone': tone } as CSSProperties}
    >
      <div className="curtain-half curtain-top">{body}</div>
      <div className="curtain-half curtain-bottom" aria-hidden="true">
        {body}
      </div>

      {mode === 'bloom' && !leaving && <span className="curtain-flash" aria-hidden="true" />}

      {leaving && cut && (
        <span className="curtain-cut" aria-hidden="true">
          <span className="curtain-cut-wave" />
          <span className="curtain-cut-head" />
        </span>
      )}
    </div>
  );
}

/** يُبقي شيئاً مرسوماً بعد انتهاء دوره ريثما تنتهي حركة خروجه */
export function useLinger(on: boolean, ms: number) {
  const [shown, setShown] = useState(on);
  const [leaving, setLeaving] = useState(false);
  const wasOn = useRef(on);

  useEffect(() => {
    if (on) {
      wasOn.current = true;
      setShown(true);
      setLeaving(false);
      return;
    }
    if (!wasOn.current) return;
    wasOn.current = false;
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(false);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(timer);
  }, [on, ms]);

  return { shown, leaving };
}

/** شاشة الاستعداد لا تُقطع: تخبو وتتباعد قبل أن تُسلّم الجولة */
export function CountdownGate({ ms, on }: { ms: number; on: boolean }) {
  const { shown, leaving } = useLinger(on, 500);
  return shown ? <Countdown ms={ms} leaving={leaving} /> : null;
}

/**
 * انزلاق الترتيب: حين يسبق لاعبٌ لاعباً لا يقفز الصفّان مكانَيهما —
 * نقيس أين كانا، ونضعهما هناك بإزاحة، ثم نُفلتها فينزلقان. إزاحةٌ
 * وحدها لا تخطيط، فثمانية صفوف تتجاوز بعضها عند ستين إطاراً.
 */
export function useReorderSlide(box: React.RefObject<HTMLDivElement | null>, order: string) {
  const seen = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-row]')];
    const next = new Map<string, number>();
    const quiet = prefersReducedMotion();

    for (const row of rows) {
      const id = row.dataset.row!;
      const top = row.getBoundingClientRect().top;
      next.set(id, top);
      const was = seen.current.get(id);
      if (quiet || was === undefined || Math.abs(was - top) < 1) continue;

      row.style.transition = 'none';
      row.style.transform = `translateY(${was - top}px)`;
      requestAnimationFrame(() => {
        row.style.transition = 'transform 0.5s var(--ease-monitor)';
        row.style.transform = '';
      });
    }
    seen.current = next;
  }, [order, box]);
}

/**
 * أشرطة النتائج: الطول هو الخبر. نصيب كل لاعب من أعلى نقاط الجولة
 * يُقرأ من آخر القاعة قبل أن يُقرأ الرقم — ولذلك شريط لا صفّ جدول.
 */
export function ResultBars({
  awards,
  big,
}: {
  awards: RoomResult['awards'];
  /** مقاس القاعة: شاشة العرض */
  big?: boolean;
}) {
  const top = Math.max(1, ...awards.map((a) => a.points));

  return (
    <div className={big ? 'grid gap-3.5' : 'grid gap-2'}>
      {awards.map((award, i) => {
        const share = Math.max(award.points / top, award.points > 0 ? 0.18 : 0.08);
        return (
          <div key={award.teamId} className={`flex items-center ${big ? 'gap-5' : 'gap-3'}`}>
            {/* الترتيب خارج المجرى: داخله يصطدم بالحافّة المضيئة فلا يُقرأ */}
            <span
              className={`tnum shrink-0 text-center font-light ${
                big ? 'w-10 text-[34px] text-muted' : 'w-4 text-sm text-faint'
              }`}
            >
              {i + 1}
            </span>

            <div
              className={`bar flex min-w-0 flex-1 items-center gap-4 ${
                big ? 'h-[84px] px-7' : 'h-11 px-3.5'
              }`}
              style={
                {
                  '--bar': award.flatlined ? 'var(--color-danger)' : 'var(--color-signal)',
                  '--cut': `${(1 - share) * 100}%`,
                } as CSSProperties
              }
            >
              <span
                className="bar-fill"
                style={{ animationDelay: `${i * 0.08}s` }}
                aria-hidden="true"
              />
              <b className={`relative truncate font-black ${big ? 'text-[44px]' : 'text-[15px]'}`}>
                {award.name}
              </b>
              <span
                className={`tnum relative mr-auto shrink-0 font-medium ${
                  award.flatlined ? 'text-danger' : 'text-muted'
                } ${big ? 'text-[28px]' : 'text-xs'}`}
              >
                {award.flatlined ? 'توقف النبض' : `${formatTime(award.timeMs)} ث`}
              </span>
              <span
                className={`tnum relative shrink-0 text-left font-black text-signal ${
                  big ? 'w-[130px] text-[44px]' : 'w-9 text-base'
                }`}
              >
                +{award.points}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * الإيقاف المؤقت: علامةٌ في منتصف الشاشة تقول ما يحدث بلا نصّ طويل.
 * المقاسات تتمدّد مع العرض فيصلح المكوّن الواحد للجوال وللبروجكتر.
 */
export function PausedMark({ note }: { note?: string }) {
  return (
    <div className="thump flex flex-col items-center gap-4 text-center">
      <span
        className="halo relative flex items-center justify-center rounded-full text-signal"
        style={{
          width: 'clamp(74px, 8.5vw, 140px)',
          height: 'clamp(74px, 8.5vw, 140px)',
          boxShadow: 'inset 0 0 0 2px color-mix(in srgb, var(--color-signal) 40%, transparent)',
        }}
      >
        <PauseIcon size={34} style={{ width: '38%', height: '38%' }} />
      </span>
      <h2 className="font-black" style={{ fontSize: 'clamp(26px, 3.4vw, 62px)', lineHeight: 1.1 }}>
        الجولة موقوفة مؤقتاً
      </h2>
      {note && (
        <p className="font-medium text-muted" style={{ fontSize: 'clamp(14px, 1.7vw, 30px)' }}>
          {note}
        </p>
      )}
    </div>
  );
}

/** شاشة الاستعداد: 3 · 2 · 1 قبل انطلاق العدادات */
export function Countdown({ ms, leaving }: { ms: number; leaving?: boolean }) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-ground/95 ${
        leaving ? 'veil-out' : ''
      }`}
    >
      <p className="text-lg font-bold tracking-[0.2em] text-muted">استعدّ</p>
      <div
        key={seconds}
        className="thump tnum mt-4 text-[7rem] leading-none font-black text-signal"
      >
        {seconds}
      </div>
      <p className="mt-4 font-medium text-muted">الجولة على وشك أن تبدأ</p>
    </div>
  );
}

/** نافذة عامة */
export function Modal({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // الضغط خارج النافذة يغلقها — وداخلها لا يصعد إلى الخلفية
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className="rise-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-card bg-surface shadow-[inset_0_0_0_1px_var(--color-line-2)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="flex items-center gap-2 text-xl font-black">
            {icon}
            {title}
          </h2>
          <button
            onClick={onClose}
            title="إغلاق"
            className="flex size-8 items-center justify-center rounded-chip text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)] transition hover:bg-surface-2 active:scale-90"
          >
            <CloseIcon size={15} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/** سجل الجولات: المجموع أولاً ثم كل جولة */
export function RoundHistory({
  history,
  teamId,
}: {
  history: RoomResult[];
  /** عند تمريره تُعرض نتائج هذا اللاعب وحده */
  teamId?: string;
}) {
  if (history.length === 0) {
    return <p className="py-10 text-center text-muted">لم تُلعب أي جولة بعد</p>;
  }

  const rounds = teamId
    ? history
        .map((round) => ({
          ...round,
          awards: round.awards.filter((a) => a.teamId === teamId),
        }))
        .filter((round) => round.awards.length > 0)
    : history;

  if (rounds.length === 0) {
    return <p className="py-10 text-center text-muted">لم تشارك في أي جولة بعد</p>;
  }

  const totals = new Map<string, { name: string; points: number }>();
  for (const round of rounds) {
    for (const award of round.awards) {
      const entry = totals.get(award.teamId) ?? { name: award.name, points: 0 };
      entry.points += award.points;
      totals.set(award.teamId, entry);
    }
  }
  const ranking = [...totals.values()].sort((a, b) => b.points - a.points);

  return (
    <div className="grid gap-6">
      <div>
        <h3 className="mb-2 text-sm font-bold tracking-[0.14em] text-muted">
          {teamId ? 'مجموع نقاطك' : 'المجموع الكلي'}
        </h3>
        <div className="grid">
          {ranking.map((team, i) => (
            <div
              key={team.name}
              className="flex items-center justify-between border-b border-line py-2.5 last:border-0"
            >
              <span className="flex items-center gap-3 font-bold">
                {!teamId && (
                  <span className="tnum w-5 text-center font-light text-faint">{i + 1}</span>
                )}
                {team.name}
              </span>
              <span className="tnum font-black text-signal">{team.points}</span>
            </div>
          ))}
        </div>
      </div>

      {[...rounds].reverse().map((round) => (
        <div key={round.round}>
          <h3 className="mb-2 text-sm font-bold tracking-[0.14em] text-muted">
            الجولة {round.round}
          </h3>
          <div className="grid">
            {round.awards.map((award) => (
              <div
                key={award.teamId}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 border-b border-line py-2.5 last:border-0"
              >
                <span className="font-bold">{award.name}</span>
                <span className={`tnum text-sm ${award.flatlined ? 'text-danger' : 'text-muted'}`}>
                  {award.flatlined ? 'توقف النبض' : `${formatTime(award.timeMs)} ث`}
                </span>
                <span className="tnum w-10 text-left font-black text-signal">+{award.points}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryModal({
  history,
  teamId,
  onClose,
}: {
  history: RoomResult[];
  teamId?: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={teamId ? 'سجلّك' : 'سجل الجولات'}
      icon={<HistoryIcon size={19} className="text-muted" />}
      onClose={onClose}
    >
      <RoundHistory history={history} teamId={teamId} />
    </Modal>
  );
}

/** رقم يتدحرج نحو قيمته الجديدة بدل أن يقفز */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  /*
   * الرقم يتدحرج إلى القيمة، ثم يستقرّ عليها مهما جرى.
   *
   * وكان المنطلَق لا يُحدَّث إلا عند اكتمال الحركة: فمن بدّل القيمة مرّتين
   * متلاحقتين أُلغيت حركتُه الأولى في منتصفها وبقي المنطلَق قديماً — فإن
   * عادت القيمة إليه حُسب الفرق صفراً فلم يُرسم شيء، وعلق الرقم على
   * منزلةٍ وسطى لا تساوي الحقيقة. وrAF لا ينبض أصلاً والصفحة مخفيّة،
   * فلولا الضبط النهائيّ لبقي الرقم قديماً حتى يعود الناظر.
   */
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    const diff = value - origin;
    if (diff === 0) {
      setShown(value);
      return;
    }

    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + diff * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      /* انقطعت الحركة: تُحسم القيمة ويصير المنطلَق هو ما استقرّ عليه */
      from.current = value;
      setShown(value);
    };
  }, [value]);

  return <span className={className}>{shown}</span>;
}

/**
 * بابُ الخروج بعد أن تنتهي اللعبة.
 *
 * شاشةُ الترتيب نهايةٌ لا حالةٌ مستقرّة: تُقرأ، ويُكتب الرأي، ثم يُخرج
 * منها. وكانت بابَ مصيدة — لا زرَّ فيها إلا «أرسل رأيك» — فمن انتهى
 * وقف ينظر إلى ترتيبٍ لا يتغيّر ولا يعرف كيف يبدأ جديداً.
 */
export function TheEnd({
  primary,
  onPrimary,
  onHome,
}: {
  primary: string;
  onPrimary: () => void;
  onHome: () => void;
}) {
  return (
    <div className="mx-auto mt-4 flex w-full max-w-md gap-2.5">
      <Button className="min-w-0 flex-1" onClick={onPrimary}>
        {primary}
      </Button>
      <Button variant="ghost" className="min-w-0 flex-1" onClick={onHome}>
        العودة للرئيسية
      </Button>
    </div>
  );
}

/** قصاصات التتويج — لحظة النهاية وحدها، لا أثناء اللعب */
export function Confetti({ count = 60 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2,
        duration: 2.6 + Math.random() * 2,
        color: ['var(--color-signal)', 'var(--color-ink)', 'var(--color-safe)'][i % 3],
      })),
    [count],
  );

  /*
   * تنصرف القصاصات بعد أن تقع.
   *
   * كانت ستّون قطعةً ثابتةَ الموضع تبقى في الشجرة إلى أن تُغلق الصفحة —
   * شفّافةً لا تُرى، لكن كلٌّ منها طبقةُ تركيبٍ عند المُركِّب. فتثقل لوحةَ
   * المنظّم بعد إعلان النتائج وهي أطولُ ما يبقى مفتوحاً. وأطولُ قطعةٍ
   * تأخذ تأخيرَها ومدّتها، فبعدها لا يبقى ما يُعرض.
   */
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const longest = Math.max(...pieces.map((p) => p.delay + p.duration)) * 1000 + 200;
    const t = setTimeout(() => setGone(true), longest);
    return () => clearTimeout(t);
  }, [pieces]);

  if (gone || prefersReducedMotion()) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 h-4 w-2.5 rounded-[2px]"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            // both: تُطبَّق لقطة البداية أثناء التأخير، فتنتظر القصاصة
            // فوق حافّة الشاشة بدل أن تقف صفّاً ظاهراً في أعلاها
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s both`,
          }}
        />
      ))}
      <style>{`@keyframes confetti-fall{0%{transform:translateY(-12vh) rotate(0)}100%{transform:translateY(105vh) rotate(540deg);opacity:0}}`}</style>
    </div>
  );
}

/**
 * ══════════════ الأوائل ══════════════
 * ثلاث طبقات من الأهمية لا طبقة واحدة:
 *   البطلُ لوحةٌ كاملة ومخطّطه وحده لا يزال ينبض — آخرُ نبضٍ صامد.
 *   الثاني والثالث شريطان بلون الإشارة.
 *   ومن بعدهم أشرطةٌ هادئة بالحبر — حاضرون بلا مزاحمة.
 * وصاحبُ الجهاز مُعلَّمٌ أينما وقع، فأول ما يبحث عنه المرء موضعُه هو.
 *
 * المقاسات كلها clamp: اللوحة نفسها تُقرأ على جوالٍ بعرض ٣٩٠ وعلى
 * بروجكتر بعرض ١٩٢٠ بلا نسختين.
 */
export function Standings({
  standings,
  meId,
  rounds,
  compact = false,
}: {
  standings: Standing[];
  /** صاحب الجهاز — يُعلَّم صفّه */
  meId?: string;
  rounds?: number;
  /** داخل لوحةٍ لا على شاشةٍ: سقوفٌ أقصر تليق بعمودٍ بين لوحاتٍ أخرى */
  compact?: boolean;
}) {
  const top = Math.max(1, standings[0]?.score ?? 1);
  const [champion, ...rest] = standings;
  if (!champion) return null;

  /*
   * المقاس من عرض الحاوية لا من عرض النافذة.
   *
   * كانت الوحدة vw، والمكوّن واحدٌ يعيش في ثلاثة أمكنة: شاشةُ العرض تملأ
   * البروجكتر، ولوحةُ المنظّم عمودٌ في تسعمئة، وصفحةُ اللاعب هاتف. فكان
   * المنظّم يرى اسم البطل بستّين بكسلاً في عمودٍ ضيّق — مقاسُ قاعةٍ في
   * لوحةِ مكتب. وcqw تقيس ما حول العنصر فعلاً.
   *
   * والمعاملات مضروبةٌ في ١٩٢٠/١٤٠٠ لأن الحاوية على البروجكتر ١٤٠٠ لا
   * ١٩٢٠ — فتبقى شاشةُ العرض على حالها تماماً.
   */
  const k = compact ? 0.68 : 1;
  const px = (min: number, cqw: number, max: number) =>
    `clamp(${Math.round(min * (compact ? 0.88 : 1))}px, ${(cqw * 1.371 * k).toFixed(2)}cqw, ${Math.round(max * k)}px)`;

  return (
    <div className="@container mx-auto w-full max-w-[1400px]">
      <div className="grid" style={{ gap: px(8, 0.9, 16) }}>
      <Confetti />

      <header className="thump flex items-center justify-center" style={{ gap: px(10, 0.9, 20) }}>
        <TrophyIcon className="text-signal" style={{ width: px(26, 2.4, 48), height: 'auto' }} />
        <h2 className="font-black" style={{ fontSize: px(28, 3, 60), lineHeight: 1.1 }}>
          الأوائل
        </h2>
        {rounds ? (
          <span className="tnum font-medium text-muted" style={{ fontSize: px(13, 1.2, 26) }}>
            بعد {rounds} جولة
          </span>
        ) : null}
      </header>

      {/* البطل */}
      <div
        className="rise-in relative overflow-hidden rounded-card bg-surface shadow-[inset_0_0_0_2px_var(--color-signal)]"
        style={{ padding: px(14, 1.3, 26), animationDelay: '0.1s' }}
      >
        <span className="absolute inset-y-0 start-0 w-1.5 bg-signal" aria-hidden="true" />
        <div className="flex items-center" style={{ gap: px(10, 1.1, 22) }}>
          <CrownIcon
            className="shrink-0 text-signal"
            style={{ width: px(24, 2.2, 46), height: 'auto' }}
          />
          <div className="min-w-0 flex-1">
            <div
              className="font-bold tracking-[0.2em] text-signal"
              style={{ fontSize: px(11, 0.85, 20) }}
            >
              الأول{champion.teamId === meId ? ' — أنت' : ''}
            </div>
            <div
              className="truncate font-black"
              style={{ fontSize: px(26, 3.2, 64), lineHeight: 1.15 }}
            >
              {champion.name}
            </div>
          </div>
          <div className="shrink-0 text-center">
            <div
              className="tnum font-black text-signal"
              style={{ fontSize: px(30, 3.6, 72), lineHeight: 1 }}
            >
              {champion.score}
            </div>
            <div className="font-medium text-muted" style={{ fontSize: px(11, 1, 22) }}>
              نقطة
            </div>
          </div>
        </div>
        {/* مخطّطٌ لا يزال ينبض: البطل هو النبض الذي لم يسكن */}
        <Lane timeMs={20000} size="lg" className="mt-3" style={{ height: px(30, 3.2, 60) }} />
      </div>

      {rest.map((team, i) => {
        const mine = team.teamId === meId;
        const podium = i < 2; // الثاني والثالث
        return (
          <div
            key={team.teamId}
            className="rise-in flex items-center"
            style={{ gap: px(8, 0.8, 18), animationDelay: `${0.18 + i * 0.07}s` }}
          >
            <span
              className="tnum shrink-0 text-center font-light text-faint"
              style={{ fontSize: px(14, 1.5, 32), width: px(18, 1.8, 42) }}
            >
              {team.rank}
            </span>
            <div
              className={`bar flex min-w-0 flex-1 items-center ${
                mine ? 'shadow-[inset_0_0_0_2px_var(--color-signal)]' : ''
              }`}
              style={
                {
                  // صفُّ صاحب الجهاز بلون الإشارة أينما وقع: أول ما يبحث عنه
                  '--bar': podium || mine ? 'var(--color-signal)' : 'var(--color-ink-2)',
                  '--cut': `${(1 - Math.max(team.score / top, 0.08)) * 100}%`,
                  height: px(42, 4.2, 80),
                  paddingInline: px(12, 1.2, 26),
                  gap: px(8, 0.8, 18),
                } as CSSProperties
              }
            >
              <span className="bar-fill" aria-hidden="true" />
              <b className="relative truncate font-black" style={{ fontSize: px(15, 1.8, 40) }}>
                {team.name}
              </b>
              {mine && (
                <span
                  className="relative shrink-0 font-bold text-signal"
                  style={{ fontSize: px(11, 0.9, 22) }}
                >
                  أنت
                </span>
              )}
              <span
                className="tnum relative mr-auto shrink-0 font-black"
                style={{ fontSize: px(17, 2, 42) }}
              >
                {team.score}
              </span>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/**
 * مراجعة أسئلة الجولة بترتيب ظهورها —
 * الإجابة الصحيحة بالأخضر واختيار اللاعب الخاطئ بالأحمر.
 */
/** أسبابٌ جاهزة: التبليغ بضغطةٍ لا بإنشاء */
const REPORT_REASONS = ['الإجابة خاطئة', 'السؤال غامض', 'مكرّر', 'صعب جداً', 'خطأ إملائي'];

/**
 * بطاقة الرأي: نجماتٌ ونصٌّ يُرسلان معاً.
 *
 * أسفل الترتيب لا نافذةً تعترض: من أراد أن يقول قال، ومن أراد أن يمضي
 * مضى. والاعتراضُ على فرحة النتيجة يشتري تعليقاً ويخسر لحظة.
 */
/** ردُّ الشكر على قدر النبضات — [العنوان، السطر تحته] */
const THANKS: Record<number, [string, string]> = {
  0: ['وصل رأيك — شكراً لك', 'كلُّ ملاحظةٍ تُقرأ، وعليها تُبنى الجولة القادمة.'],
  1: ['سمعناك — وشكراً لصراحتك', 'أخبرتنا بما لم يعجبك، وسنُصلحه.'],
  2: ['شكراً — الرسالة وصلت', 'نعرف أن فيها ما يُحسَّن، وملاحظتك تدلّنا على أوّله.'],
  3: ['شكراً لك — رأيك في مكانه', 'نصفُ الطريق قُطع، وبملاحظتك نُكمل ما بقي.'],
  4: ['يسعدنا هذا — شكراً لك', 'قريبٌ من التمام، وما ذكرتَه يُقرِّبه أكثر.'],
  5: ['نبضةٌ كاملة — شكراً لك', 'سعدنا بلعبك معنا، ونراك في الجولة القادمة.'],
};

export function CommentCard({
  onSend,
}: {
  onSend: (payload: { stars: number; text: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [stars, setStars] = useState(0);
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState('');

  if (state === 'done') {
    /*
     * الشكرُ يُقاس بما قيل: «وصل رأيك» ردُّ إيصالٍ لا ردُّ إنسان. ومن أعطى
     * خمساً يُفرَح معه، ومن أعطى واحدة لا يُهلَّل في وجهه — يُشكر على
     * صراحته ويُوعَد بالإصلاح. ومن كتب بلا تقييم فله شكرٌ محايد.
     */
    const [line, sub] = THANKS[stars] ?? THANKS[0];
    return (
      <div className="tile mt-5 px-5 py-6 text-center">
        <span className="mx-auto mb-2.5 flex size-11 items-center justify-center rounded-full bg-safe-2 text-safe-ink">
          <PulseIcon size={22} strokeWidth={2.6} />
        </span>
        <p className="text-[17px] font-black text-safe-ink">{line}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-muted">{sub}</p>
      </div>
    );
  }

  const submit = async () => {
    if (!stars && !text.trim()) return setError('اختر تقييماً أو اكتب رأيك');
    setState('sending');
    const res = await onSend({ stars, text: text.trim() });
    if (res.ok) return setState('done');
    setError(res.error ?? 'تعذّر الإرسال');
    setState('idle');
  };

  return (
    <div className="tile mt-5 grid gap-3 p-5">
      <p className="text-center text-sm leading-relaxed font-bold text-balance">
        رأيك يهم ويحسّن من مستوى المسابقة — أخبرنا ما أعجبك وما أزعجك.
      </p>

      <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="التقييم">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} من ٥`}
            onClick={() => {
              setStars(n);
              setError('');
            }}
            className={`flex size-11 items-center justify-center rounded-chip transition active:scale-90 ${
              n <= stars
                ? 'bg-signal-2 text-signal shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                : 'text-faint shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:text-muted'
            }`}
          >
            <PulseIcon size={19} strokeWidth={n <= stars ? 2.6 : 2} />
          </button>
        ))}
      </div>

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        rows={3}
        maxLength={1000}
        placeholder="ما الذي أعجبك؟ وما الذي أزعجك؟"
        className="w-full resize-none rounded-chip bg-sunk px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
      />

      {error && <p className="text-center text-sm font-bold text-danger">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={state === 'sending'}
        className="rounded-chip bg-signal py-2.5 text-center font-black text-on-signal transition hover:brightness-110 disabled:opacity-60"
      >
        {state === 'sending' ? 'يُرسل…' : 'أرسل رأيك'}
      </button>
    </div>
  );
}

/** زرّ البلاغ تحت كل سؤال في المراجعة */
function ReportRow({
  reported,
  onReport,
}: {
  reported: boolean;
  onReport: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (reported) {
    return (
      <p className="mt-3 border-t border-line pt-2.5 text-xs font-black text-danger">
        شكراً — وصلت ملاحظتك عن هذا السؤال
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        /* أخفّ من الأحمر الصريح: دعوةٌ لا إنذار — واللاعب لتوّه خرج من جولة */
        className="mt-3 w-full border-t border-line pt-2.5 text-right text-xs font-bold text-muted transition hover:text-danger"
      >
        في هذا السؤال خطأ؟ بلّغ عنه
      </button>
    );
  }

  return (
    <div className="mt-3 grid gap-1.5 border-t border-line pt-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        {REPORT_REASONS.map((reason, i) => (
          <button
            key={reason}
            type="button"
            onClick={() => onReport(reason)}
            className={`rounded-chip px-2 py-2 text-xs font-black text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_35%,transparent)] transition hover:bg-danger-2 ${
              i === REPORT_REASONS.length - 1 && REPORT_REASONS.length % 2 ? 'col-span-2' : ''
            }`}
          >
            {reason}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="justify-self-start rounded-chip px-2 py-1 text-xs font-black text-muted transition hover:text-ink"
      >
        تراجع
      </button>
    </div>
  );
}

export function ReviewList({
  review,
  reported,
  onReport,
}: {
  review: ReviewItem[];
  reported?: Set<string>;
  onReport?: (questionId: string, reason: string) => void;
}) {
  if (review.length === 0) {
    return <p className="py-6 text-center text-muted">لم تُجب عن أي سؤال في هذه الجولة</p>;
  }

  return (
    <div className="grid gap-2.5">
      {review.map((item, index) => (
        <div
          key={`${item.id}-${index}`}
          className="tile rise-in p-4"
          style={{ animationDelay: `${Math.min(index * 0.05, 0.5)}s` }}
        >
          <div className="mb-3 flex items-start gap-3">
            <span
              className={`flex size-6 shrink-0 items-center justify-center rounded-chip ${
                item.isCorrect ? 'bg-safe text-ground' : 'bg-danger text-ground'
              }`}
            >
              {item.isCorrect ? (
                <CheckIcon size={13} strokeWidth={3.5} />
              ) : (
                <CloseIcon size={13} strokeWidth={3.5} />
              )}
            </span>
            <p className="flex-1 leading-relaxed font-bold">
              <span className="tnum text-faint">{index + 1}. </span>
              {item.q}
            </p>
          </div>

          <div className="grid gap-1 pr-9">
            {item.options.map((option, i) => {
              const isAnswer = i === item.answer;
              const isChoice = i === item.choice;
              if (!isAnswer && !isChoice) {
                return (
                  <div key={i} className="px-3 py-1.5 text-sm text-muted">
                    {option}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-3 rounded-chip px-3 py-1.5 text-sm font-bold ${
                    isAnswer ? 'bg-safe/15 text-safe' : 'bg-danger/15 text-danger'
                  }`}
                >
                  <span>{option}</span>
                  <span className="shrink-0 text-xs opacity-80">
                    {isAnswer && isChoice
                      ? 'إجابتك — صحيحة'
                      : isAnswer
                        ? 'الإجابة الصحيحة'
                        : 'إجابتك'}
                  </span>
                </div>
              );
            })}
          </div>

          {onReport && (
            <ReportRow
              reported={reported?.has(item.id) ?? false}
              onReport={(reason) => onReport(item.id, reason)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export { FlatlineIcon };
