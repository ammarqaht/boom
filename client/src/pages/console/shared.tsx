import { useEffect, useRef, useState } from 'react';
import { Scrollbar, Select } from '../../components/ui';
import { CloseIcon } from '../../components/icons';

/**
 * قطعُ لوحة المالك — ومحرّرُ السؤال الواحد.
 *
 * اللغة: «نبضٌ على ورق». ورقةٌ سريرية هادئة، وتراتبٌ بالحبر لا بالحدود —
 * فلا ظلال ولا حشوٌ زائد، والحدُّ خيطٌ واحدٌ باهت. واللون لا يُنفق إلا على
 * معنى: الإشارة للفعل، والحالات الثلاث للمستوى والصواب والبلاغ.
 *
 * والمقاس لا يُكتب في الصفحات بل هنا مرّةً واحدة:
 *
 *   بلاطةُ رقم    p-4    · الرقم ٣٠px
 *   لوحُ قسم      p-5    · عنوانه ١٥px
 *   خليّةُ جدول   px-5 py-4 · نصّها ١٤px
 *   صفُّ قائمة    px-5 py-3.5 · مثلها سواء
 *   شارة          12.5px
 *
 * وما بين الأقسام ‎gap-4‎ في كل صفحة بلا استثناء.
 */

export type Api = {
  get: <T>(path: string) => Promise<T | null>;
  send: <T>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ ok: boolean; data: T | null }>;
};

export type Issue = { severity: 'error' | 'warn'; message: string };

export type Loaded = {
  id: string;
  bankId: string;
  bankName: string;
  q: string;
  options: string[];
  answer: number;
  level: number;
  shown: number;
  correct: number;
  wrong: number;
  rate: number | null;
  reports: number;
};

export const LEVELS: Record<number, { label: string; tint: string; ink: string }> = {
  1: { label: 'سهل', tint: 'var(--color-safe)', ink: 'text-safe' },
  2: { label: 'متوسط', tint: 'var(--color-warn)', ink: 'text-warn' },
  3: { label: 'صعب', tint: 'var(--color-danger)', ink: 'text-danger' },
};
export const levelOf = (n: number) => LEVELS[n] ?? LEVELS[2];

export const REASONS = ['الإجابة خاطئة', 'السؤال غامض', 'مكرّر', 'صعب جداً', 'خطأ إملائي'];

/* ── تنسيقات ── */
export const day = (ms: number) =>
  new Date(ms).toLocaleDateString('ar', { day: 'numeric', month: 'short' });

export const stamp = (ms: number) =>
  new Date(ms).toLocaleString('ar', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * صيغةُ المعدود.
 *
 * العربية تُغيّر صيغة المعدود بعدده: «٨ غرف» لا «٨ غرفة»، و«١٢ غرفة» لا
 * «١٢ غرف». والقاعدة في المتصفّح أصلاً — Intl.PluralRules يعرف أصناف
 * العربية الستّة — فلا حاجة إلى مكتبةٍ ولا إلى جدولٍ مكتوبٍ باليد.
 */
const PLURAL = new Intl.PluralRules('ar');

const UNITS = {
  question: { one: 'سؤال', two: 'سؤالان', few: 'أسئلة', many: 'سؤالاً' },
  room: { one: 'غرفة', two: 'غرفتان', few: 'غرف', many: 'غرفة' },
  player: { one: 'لاعب', two: 'لاعبان', few: 'لاعبين', many: 'لاعباً' },
  round: { one: 'جولة', two: 'جولتان', few: 'جولات', many: 'جولة' },
  report: { one: 'بلاغ', two: 'بلاغان', few: 'بلاغات', many: 'بلاغاً' },
  comment: { one: 'تعليق', two: 'تعليقان', few: 'تعليقات', many: 'تعليقاً' },
  bank: { one: 'بنك', two: 'بنكان', few: 'بنوك', many: 'بنكاً' },
  rating: { one: 'تقييم', two: 'تقييمان', few: 'تقييمات', many: 'تقييماً' },
} as const;

export type Unit = keyof typeof UNITS;

export function unit(n: number, kind: Unit) {
  const forms = UNITS[kind];
  const pick = PLURAL.select(n);
  if (pick === 'one') return forms.one;
  if (pick === 'two') return forms.two;
  if (pick === 'few') return forms.few;
  return forms.many;
}

/** «٨ غرف» — العدد ومعدودُه بصيغته */
export const say = (n: number, kind: Unit) => `${n} ${unit(n, kind)}`;

/** مدّةٌ تُقرأ بلمحة: «٢٤ د» لا «١٤٤٠ ثانية» */
export function span(ms: number | null) {
  if (ms === null || ms === undefined) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'أقلّ من دقيقة';
  if (minutes < 60) return `${minutes} د`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} س ${rest} د` : `${hours} س`;
}

/* ══════════════ قطعٌ صغيرة ══════════════ */

export const Loading = () => (
  <p className="animate-pulse py-16 text-center text-[15px] font-bold text-muted motion-reduce:animate-none">
    يُقرأ…
  </p>
);

/** الفراغُ يقول ما الحال وما العمل — لا كلمةً واحدة معلّقة في بياض */
export function Empty({
  title,
  lead,
  action,
}: {
  title: string;
  lead?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="px-6 py-14 text-center">
      <p className="text-[15px] font-black text-ink">{title}</p>
      {lead && <p className="mt-1.5 text-[13.5px] font-medium text-muted">{lead}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Dot({ level }: { level: number }) {
  const l = levelOf(level);
  return (
    <i
      className="block size-2 shrink-0 rounded-full"
      style={{ background: l.tint }}
      title={`مستوى ${l.label}`}
      aria-hidden="true"
    />
  );
}

type Tone = 'safe' | 'warn' | 'danger' | 'signal' | 'mute';

const TONES: Record<Tone, string> = {
  safe: 'bg-safe-2 text-safe-ink',
  warn: 'bg-warn-2 text-warn-ink',
  danger: 'bg-danger-2 text-danger-ink',
  signal: 'bg-signal-2 text-signal-ink',
  mute: 'bg-sunk text-muted',
};

export function Badge({
  tone = 'mute',
  children,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`tnum inline-flex shrink-0 items-center rounded-chip px-2.5 py-1 text-[12.5px] leading-none font-bold whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** نسبةُ الصواب: حمراءُ إن كان السؤال يكسر، كهرمانيةٌ إن كان لا يُسأل */
export const rateTone = (value: number | null): Tone =>
  value === null ? 'mute' : value < 40 ? 'danger' : value > 90 ? 'warn' : 'safe';

export function Rate({ value, plain }: { value: number | null; plain?: boolean }) {
  if (value === null) return <span className="text-faint">—</span>;
  if (plain) {
    const ink =
      value < 40
        ? 'text-danger'
        : value > 90
          ? 'text-warn'
          : value >= 70
            ? 'text-safe'
            : 'text-ink';
    return <span className={`tnum text-[14px] font-bold ${ink}`}>{value}%</span>;
  }
  return <Badge tone={rateTone(value)}>{value}%</Badge>;
}

/* ══════════════ صدرُ كل صفحة: أربعةُ أرقام ══════════════ */

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">{children}</div>;
}

/** خطُّ نبضٍ رفيع يُرسم في زاوية البلاطة الرئيسة — توقيعُ المنتج لا زينة */
const TRACE = 'M0,15 40,15 48,4 58,26 66,15 130,15';

/**
 * بلاطةُ رقم.
 *
 * والأولى في كل صفحة «رئيسة» (lead): مصبوغةٌ بحبر الإشارة كاملاً فتقع عينُك
 * عليها أولاً. وثبات موقعها من صفحةٍ إلى صفحة هو ما يجعل الصفحات تبدو واحدة.
 */
export function Stat({
  label,
  value,
  unit: unitText,
  hint,
  tone,
  lead,
  onClick,
}: {
  label: string;
  value: number | string;
  unit?: string;
  hint?: React.ReactNode;
  tone?: 'safe' | 'danger' | 'warn';
  lead?: boolean;
  onClick?: () => void;
}) {
  const ink = lead
    ? 'text-white'
    : tone === 'safe'
      ? 'text-safe'
      : tone === 'danger'
        ? 'text-danger'
        : tone === 'warn'
          ? 'text-warn'
          : 'text-ink';

  const Box = onClick ? 'button' : 'div';

  return (
    <Box
      onClick={onClick}
      className={`relative block w-full overflow-hidden rounded-card p-4 text-right transition ${
        lead ? 'bg-signal-ink' : 'tile'
      } ${onClick ? 'hover:brightness-[0.98]' : ''}`}
    >
      {lead && (
        <svg
          viewBox="0 0 130 30"
          className="pointer-events-none absolute end-3 bottom-2.5 h-7 w-32 opacity-40"
          fill="none"
          aria-hidden="true"
        >
          <polyline points={TRACE.replace(/M/g, '')} stroke="#fff" strokeWidth="1.5" />
        </svg>
      )}
      <span className={`block text-[13px] font-medium ${lead ? 'text-white/75' : 'text-muted'}`}>
        {label}
      </span>
      <span className="mt-1.5 flex items-baseline gap-1.5">
        <b className={`tnum text-[30px] leading-none font-black ${ink}`}>{value}</b>
        {unitText && (
          <span className={`text-[13px] font-bold ${lead ? 'text-white/70' : 'text-muted'}`}>
            {unitText}
          </span>
        )}
      </span>
      <span
        className={`mt-1.5 block text-[12.5px] leading-snug font-medium ${
          lead ? 'text-white/70' : 'text-faint'
        }`}
      >
        {hint ?? ' '}
      </span>
    </Box>
  );
}

/* ══════════════ لوحُ قسم ══════════════ */

export function Panel({
  title,
  hint,
  action,
  children,
  flush,
  className = '',
}: {
  title?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`tile ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-black">{title}</h2>
            {hint && (
              <p className="mt-1 text-[12.5px] leading-snug font-medium text-muted">{hint}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? 'overflow-hidden rounded-b-card' : 'px-5 pt-1 pb-5'}>{children}</div>
    </section>
  );
}

/** رابطُ «افتح ما وراء هذا اللوح» — واحدٌ في كل الألواح */
export function More({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-chip text-[13px] font-bold text-signal-ink transition hover:underline"
    >
      {children}
    </button>
  );
}

/* ══════════════ الجداول ══════════════ */

export type Col = {
  /** مفتاحُ الترتيب — وغيابه يعني عموداً لا يُرتَّب به */
  key?: string;
  label: string;
  /** عرضُ العمود في شبكة الجدول، مثل «1.6fr» أو «90px» */
  w: string;
  align?: 'start' | 'center' | 'end';
  tint?: string;
};

const ALIGN = { start: 'text-right', center: 'text-center', end: 'text-left' } as const;

/**
 * جدولٌ بشبكة CSS لا بـ<table>.
 *
 * لأن الصفّ هنا عنصرٌ واحد يُضغط ويُمرَّر عليه، ولأن `content-visibility`
 * لا تعمل على صفوف الجداول الحقيقية — وألفُ صفٍّ بلا ذلك تُثقل التخطيط.
 */
export function Grid({
  cols,
  sort,
  onSort,
  children,
  head = true,
  min = 860,
}: {
  cols: Col[];
  sort?: { key: string; dir: 1 | -1 };
  onSort?: (key: string) => void;
  children: React.ReactNode;
  head?: boolean;
  /* العرضُ الأدنى قبل أن يُمرَّر الجدول أفقياً — واللوحُ الضيّق يحتاج صفراً */
  min?: number;
}) {
  const template = cols.map((c) => c.w).join(' ');
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: min || undefined }}>
        {head && (
          <div
            className="grid items-center gap-3 border-b border-line bg-surface-2 px-5 py-3"
            style={{ gridTemplateColumns: template }}
          >
            {cols.map((col, i) => {
              const on = sort && col.key === sort.key;
              const body = (
                <>
                  <span>{col.label}</span>
                  {on && (
                    <span className="text-[10px] text-signal-ink">
                      {sort.dir === 1 ? '▲' : '▼'}
                    </span>
                  )}
                </>
              );
              const klass = `flex items-center gap-1 text-[12.5px] font-bold whitespace-nowrap ${
                on ? 'text-signal-ink' : 'text-faint'
              } ${
                col.align === 'center'
                  ? 'justify-center'
                  : col.align === 'end'
                    ? 'justify-end'
                    : 'justify-start'
              }`;
              return col.key && onSort ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSort(col.key!)}
                  className={`${klass} transition select-none hover:text-ink`}
                  style={col.tint ? { color: on ? undefined : col.tint } : undefined}
                >
                  {body}
                </button>
              ) : (
                <span key={i} className={klass} style={col.tint ? { color: col.tint } : undefined}>
                  {body}
                </span>
              );
            })}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** صفُّ الجدول — يُضغط إن كان له فعل، ويُبقي ارتفاعه محجوزاً إن خرج */
export function Row({
  cols,
  onClick,
  children,
  tall,
  className = '',
}: {
  cols: Col[];
  onClick?: () => void;
  children: React.ReactNode;
  tall?: boolean;
  className?: string;
}) {
  const Box = onClick ? 'button' : 'div';
  return (
    <Box
      onClick={onClick}
      style={{ gridTemplateColumns: cols.map((c) => c.w).join(' ') }}
      className={`row-cv grid w-full items-center gap-3 border-b border-line-soft px-5 text-right last:border-0 ${
        tall ? 'py-3.5' : 'py-3'
      } ${onClick ? 'cursor-pointer transition hover:bg-surface-2' : ''} ${className}`}
    >
      {children}
    </Box>
  );
}

export function Cell({
  children,
  align = 'start',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <span className={`min-w-0 truncate text-[14px] ${ALIGN[align]} ${className}`}>{children}</span>
  );
}

/* ══════════════ النافذة ══════════════ */

export function Modal({
  title,
  hint,
  onClose,
  footer,
  children,
  wide,
}: {
  title: string;
  hint?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    const before = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.documentElement.style.overflow = before;
    };
  }, [onClose]);

  return (
    <div
      className="modal-veil fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(12,29,33,.45)' }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        className={`modal-card flex max-h-[90vh] w-full flex-col overflow-hidden rounded-card bg-surface ${
          wide ? 'max-w-[900px]' : 'max-w-[760px]'
        }`}
        style={{ boxShadow: '0 20px 60px rgba(12,29,33,.25)' }}
      >
        <header className="flex shrink-0 items-start gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <b className="block text-[17px] font-black">{title}</b>
            {hint && <span className="mt-1 block text-[13px] font-medium text-muted">{hint}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex size-9 shrink-0 items-center justify-center rounded-chip text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2 hover:text-ink"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        {/*
         * المتنُ يبقى في مجرى التخطيط: ارتفاعُ النافذة يُحسب من محتواها،
         * فلو رُفع المتن إلى absolute لم يبقَ ما يُحسب منه فتنكمش النافذة.
         * وسلسلةُ flex متّصلة وmin-h-0 في كل حلقة هي ما يجعلها تنكمش عند
         * الحاجة لا تنفجر.
         */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={body} className="no-bar min-h-0 flex-1 overflow-y-auto">
            <div className="px-6 pb-5">{children}</div>
          </div>
          <Scrollbar box={body} />
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2.5 border-t border-line px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ══════════════ محرّر السؤال ══════════════ */

type Draft = { q: string; options: string[]; level: number };

const LEVEL_SKIN: Record<number, string> = {
  1: 'bg-safe-2 text-safe-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-safe)_35%,transparent)]',
  2: 'bg-warn-2 text-warn-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_30%,transparent)]',
  3: 'bg-danger-2 text-danger-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]',
};

export function QuestionEditor({
  api,
  questionId,
  bankId,
  banks,
  onClose,
  onSaved,
}: {
  api: Api;
  questionId: string | null;
  bankId?: string;
  banks: { id: string; name: string; count: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Draft>({ q: '', options: ['', '', '', ''], level: 2 });
  const [target, setTarget] = useState(bankId ?? '');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!questionId) return;
    void api.get<Loaded>(`question/${questionId}`).then((data) => {
      if (!data) return setError('لم يُعثر على السؤال — لعلّه حُرِّر أو حُذف');
      setLoaded(data);
      setTarget(data.bankId);
      setDraft({ q: data.q, options: [...data.options], level: data.level });
    });
  }, [api, questionId]);

  /* الفحص وأنت تكتب: تحذيرٌ قبل الحفظ لا بعده */
  useEffect(() => {
    const timer = setTimeout(() => {
      void api
        .send<{ issues: Issue[] }>('POST', 'check', { ...draft, answer: 0 })
        .then((res) => setIssues(res.data?.issues ?? []));
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, api]);

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  const blocked = errors.length > 0;
  const textChanged = Boolean(
    loaded && (loaded.q !== draft.q || loaded.options.join(' ') !== draft.options.join(' ')),
  );

  const submit = async () => {
    setBusy(true);
    setError('');
    const res = questionId
      ? await api.send('PUT', `question/${questionId}`, draft)
      : await api.send('POST', `bank/${target}/question`, draft);
    setBusy(false);
    if (!res.ok) return setError('لم يُحفظ — راجع الملاحظات أعلاه');
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!questionId) return;
    setBusy(true);
    const res = await api.send('DELETE', `question/${questionId}`);
    setBusy(false);
    if (!res.ok) return setError('تعذّر الحذف');
    onSaved();
    onClose();
  };

  const bankName = loaded?.bankName ?? banks.find((b) => b.id === target)?.name;

  return (
    <Modal
      title={questionId ? 'تحرير سؤال' : 'سؤال جديد'}
      hint={bankName ? `بنك ${bankName} · يُفحص وأنت تكتب` : 'يُفحص وأنت تكتب'}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={submit}
            disabled={busy || blocked || !target}
            className={`h-10 rounded-chip px-6 text-[14px] font-black transition ${
              busy || blocked || !target
                ? 'cursor-not-allowed bg-line-2 text-white'
                : 'bg-signal-ink text-white hover:brightness-110'
            }`}
          >
            {busy ? 'يُحفظ…' : questionId ? 'احفظ' : 'أضِف'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-chip px-4 text-[14px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2"
          >
            إلغاء
          </button>
          <span className="flex-1" />
          {questionId &&
            (confirmDelete ? (
              <>
                <span className="text-[13px] font-bold text-danger">يُحذف نهائياً مع إحصائه —</span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="h-10 rounded-chip bg-danger px-4 text-[14px] font-black text-white transition hover:brightness-110"
                >
                  احذف نهائياً
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-10 rounded-chip px-3 text-[14px] font-bold text-muted transition hover:text-ink"
                >
                  تراجع
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="h-10 rounded-chip px-4 text-[14px] font-bold text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_28%,transparent)] transition hover:bg-danger-2"
              >
                حذف السؤال
              </button>
            ))}
        </>
      }
    >
      {questionId && !loaded && !error ? (
        <Loading />
      ) : (
        <>
          {/* ما قاسه اللعب: تُحرّر السؤال وأنت ترى لماذا تُحرّره */}
          {loaded && (
            <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-chip bg-surface-2 px-4 py-2.5 text-[13px] font-medium text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
              <span>
                عُرض <b className="tnum text-ink">{loaded.shown}</b>
              </span>
              <span>
                صواب{' '}
                <b className="tnum text-ink">{loaded.rate === null ? '—' : `${loaded.rate}%`}</b>
              </span>
              <span>
                صح <b className="tnum text-safe">{loaded.correct}</b> · خطأ{' '}
                <b className="tnum text-danger">{loaded.wrong}</b>
              </span>
              {loaded.reports > 0 && <Badge tone="danger">{say(loaded.reports, 'report')}</Badge>}
            </div>
          )}

          {!questionId && banks.length > 0 && (
            <>
              <Label>البنك</Label>
              <Select
                value={target}
                onChange={setTarget}
                choices={banks.map((b) => ({ value: b.id, label: b.name, hint: String(b.count) }))}
                className="mb-5"
              />
            </>
          )}

          <Label>نصّ السؤال</Label>
          <textarea
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            rows={2}
            className="mb-5 w-full resize-y rounded-chip bg-surface px-4 py-3 text-[15px] leading-relaxed font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
            autoFocus
          />

          <Label>الخيارات — الأول هو الصواب، والخلط يقع عند التوزيع</Label>
          <div className="mb-5 grid gap-2.5 sm:grid-cols-2">
            {draft.options.map((option, i) => (
              <div
                key={i}
                className={`flex h-11 items-center gap-2.5 rounded-chip px-3 ${
                  i === 0
                    ? 'bg-signal-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_35%,transparent)]'
                    : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-2)]'
                }`}
              >
                <span
                  className={`shrink-0 text-[11px] font-black ${
                    i === 0 ? 'text-signal-ink' : 'text-faint'
                  }`}
                >
                  {i === 0 ? 'الصواب' : i}
                </span>
                <input
                  value={option}
                  onChange={(event) => {
                    const options = [...draft.options];
                    options[i] = event.target.value;
                    setDraft({ ...draft, options });
                  }}
                  placeholder={i === 0 ? 'الإجابة الصحيحة' : `خطأ ${i}`}
                  className={`min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint ${
                    i === 0 ? 'font-black text-signal-ink' : 'font-bold text-ink'
                  }`}
                />
              </div>
            ))}
          </div>

          <Label>المستوى</Label>
          <div className="mb-5 flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDraft({ ...draft, level: n })}
                className={`flex h-9 items-center gap-2 rounded-chip px-5 text-[13.5px] font-bold transition ${
                  draft.level === n
                    ? LEVEL_SKIN[n]
                    : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
                }`}
              >
                {draft.level !== n && <Dot level={n} />}
                {LEVELS[n].label}
              </button>
            ))}
          </div>

          {issues.length > 0 && (
            <ul className="mb-3 grid gap-2">
              {errors.map((issue, i) => (
                <li
                  key={`e${i}`}
                  className="flex items-center gap-2.5 rounded-chip bg-danger-2 px-3.5 py-2.5 text-[13.5px] leading-snug font-bold text-danger-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_22%,transparent)]"
                >
                  <b className="shrink-0">✖</b>
                  <span>{issue.message} — يمنع الحفظ</span>
                </li>
              ))}
              {warns.map((issue, i) => (
                <li
                  key={`w${i}`}
                  className="flex items-center gap-2.5 rounded-chip bg-warn-2 px-3.5 py-2.5 text-[13.5px] leading-snug font-medium text-warn-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_25%,transparent)]"
                >
                  <b className="shrink-0">⚠</b>
                  <span>{issue.message} — تنبيهٌ يمرّ</span>
                </li>
              ))}
            </ul>
          )}

          {textChanged && (
            <p className="rounded-chip bg-signal-2 px-3.5 py-2.5 text-[13px] leading-relaxed font-medium text-signal-ink">
              بدّلتَ نصّ السؤال أو خياراته — فيُمحى إحصاؤه ويبدأ من جديد، وتُحفظ نسخته القديمة
              ثلاثين يوماً في «الأسئلة المحرَّرة».
            </p>
          )}

          {error && <p className="mt-3 text-[14px] font-bold text-danger">{error}</p>}
        </>
      )}
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-[12.5px] font-bold text-ink-2">{children}</span>;
}
