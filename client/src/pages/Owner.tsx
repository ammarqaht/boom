import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HoldButton, toast, useTheme } from '../components/ui';
import {
  CardsIcon,
  ChatIcon,
  CheckIcon,
  ExitIcon,
  GridIcon,
  ImportIcon,
  LockIcon,
  PanelIcon,
  PlusIcon,
  PulseIcon,
  ScreenIcon,
  SearchIcon,
  TrashIcon,
} from '../components/icons';
import { type Api, type Range, DateRange, Modal, QuestionEditor, say } from './console/shared';
import Dashboard, { type Alerts } from './console/Dashboard';
import {
  Edits,
  Questions,
  Reports,
  Shelf,
  type BankInfo,
  type Counts,
  type Sift,
} from './console/Banks';
import { Comments, Rooms } from './console/RoomsAndComments';
import PendingPage from './console/Pending';
import Intake from './console/Intake';

/**
 * لوحة المالك — «نبضٌ على ورق».
 *
 * ثلاث نطاقاتٍ من اليمين: رفٌّ مصبوغٌ بحبر الإشارة لا يتجاوز عرضُه أيقونة،
 * ولوحٌ جانبيّ فيه الصفحاتُ وكلُّ التصفية، ثم المحتوى في ترويسةٍ تحمل اسمَ
 * الصفحة وأفعالها.
 *
 * والتصفية في الجانب لا في المحتوى لأنها تصف ما يُعرض ولا تكون جزءاً منه —
 * فتبقى في مكانها وأنت تتنقّل، ولا يهبط المحتوى كلما بدّلت رأيك. ولأنها
 * قائمةٌ رأسية تحتمل العدّ: أحد عشر بنكاً بأعدادها لا تسع في شريطٍ أفقيّ.
 */

const KEY_STORE = 'nabda:owner';

type SectionId = 'home' | 'banks' | 'rooms' | 'comments';
/** مجموعةٌ في الشريط: إما صفوفٌ تُنتقى، وإما عنصرٌ قائمٌ بنفسه كالتقويم */
type Group = { label: string; rows: Choice[]; node?: React.ReactNode };
type Choice = {
  id: string;
  label: string;
  count?: number;
  dot?: string;
  /** بنكٌ أُلغي تفعيلُه — يُرسم قفلاً مكان النقطة */
  lock?: boolean;
  on: boolean;
  go: () => void;
};

const DOORS: {
  id: SectionId;
  label: string;
  icon: (p: { size?: number; className?: string }) => React.ReactElement;
}[] = [
  { id: 'home', label: 'اللوحة', icon: GridIcon },
  { id: 'banks', label: 'البنوك', icon: CardsIcon },
  { id: 'rooms', label: 'الغرف', icon: ScreenIcon },
  { id: 'comments', label: 'التعليقات', icon: ChatIcon },
];

/*
 * اسمُ الصفحة وحده بلا سطرِ وصفٍ تحته.
 *
 * كان لكلِّ صفحةٍ سطرٌ يشرحها — «حالُ المسابقة في نظرةٍ واحدة» — يُقرأ
 * مرّةً في العمر ثم يشغل مكانه في كلِّ فتحة. والصفحةُ تشرح نفسها بما فيها،
 * ومن احتاج شرحاً فالعلّةُ في الصفحة لا في غياب السطر.
 */
const PAGES: Record<string, string> = {
  home: 'النظرة العامة',
  questions: 'الأسئلة',
  pending: 'إضافة سؤال',
  reports: 'البلاغات',
  edits: 'الأسئلة المحرَّرة',
  shelf: 'إدارة البنوك',
  rooms: 'الغرف',
  comments: 'التعليقات',
};

const BANK_PAGES = [
  { id: 'questions', label: 'الأسئلة' },
  /* المعلّقةُ تالي الأسئلة: بابُ الدخول قبل أبواب ما دخل */
  { id: 'pending', label: 'إضافة سؤال' },
  { id: 'reports', label: 'البلاغات' },
  { id: 'edits', label: 'الأسئلة المحرَّرة' },
  { id: 'shelf', label: 'إدارة البنوك' },
];

const VIEWS: Record<string, { id: string; label: string }[]> = {
  questions: [
    { id: 'all', label: 'الكل' },
    { id: 'measured', label: 'ما قِيس' },
    { id: 'unseen', label: 'لم تُعرض بعد' },
    { id: 'weak', label: 'ضعيفة الصواب' },
    { id: 'reported', label: 'مُبلَّغ عنها' },
    { id: 'issues', label: 'عليها ملاحظات' },
  ],
  pending: [
    { id: 'all', label: 'الكل' },
    { id: 'ready', label: 'تنتظر الاعتماد' },
    { id: 'short', label: 'ناقصة' },
    { id: 'nobank', label: 'بلا بنك' },
    { id: 'twinned', label: 'مكرّرة' },
  ],
  reports: [
    { id: 'all', label: 'الكل' },
    { id: 'player', label: 'من اللاعبين' },
    { id: 'admin', label: 'من المنظّمين' },
  ],
  edits: [
    { id: 'all', label: 'الكل' },
    { id: 'edited', label: 'ما حُرِّر' },
    { id: 'deleted', label: 'ما حُذف' },
  ],
  rooms: [
    { id: 'all', label: 'الكل' },
    { id: 'live', label: 'قائمة الآن' },
    { id: 'done', label: 'انتهت' },
    { id: 'unplayed', label: 'لم تبدأ' },
  ],
  comments: [
    { id: 'all', label: 'الكل' },
    { id: 'unread', label: 'لم يُقرأ' },
    { id: 'text', label: 'فيها نصّ' },
    { id: 'low', label: 'تقييمٌ منخفض' },
    { id: 'player', label: 'من اللاعبين' },
    { id: 'admin', label: 'من المنظّمين' },
  ],
};

const LEVELS = [
  { id: 0, label: 'كل المستويات', dot: '' },
  { id: 1, label: 'سهل', dot: 'var(--color-safe)' },
  { id: 2, label: 'متوسط', dot: 'var(--color-warn)' },
  { id: 3, label: 'صعب', dot: 'var(--color-danger)' },
];

const SEARCH: Record<string, string> = {
  questions: 'ابحث في نصّ السؤال',
  pending: 'ابحث في المعلّقة',
  reports: 'ابحث في البلاغات',
  edits: 'ابحث في المحرَّرة',
  rooms: 'ابحث باسم الغرفة أو رمزها',
  comments: 'ابحث في نصّ التعليق',
};

export default function Owner() {
  useTheme('light');
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORE) ?? '');
  const [ready, setReady] = useState(false);

  /*
   * موضعُك في الرابط لا في الذاكرة وحدها.
   *
   * كانت الحالُ كلّها useState مجرّدة، فكلُّ تحديثٍ للصفحة يردّك إلى
   * «النظرة العامة» — وأنت في الأسئلة المحرَّرة ببنكٍ ومرشّحٍ اخترتهما.
   * وفي الرابط لا في localStorage: لأن زرَّ الرجوع يعمل عندها، ولأن
   * الموضع يُنسخ ويُرسل.
   */
  const [params, setParams] = useSearchParams();

  const [door, setDoor] = useState<SectionId>(
    () => (params.get('d') as SectionId) || 'home',
  );
  const [page, setPage] = useState(() => params.get('p') || 'questions');
  const [bank, setBank] = useState(() => params.get('b') || '');
  const [level, setLevel] = useState(() => Number(params.get('l')) || 0);
  const [view, setView] = useState(() => params.get('v') || 'all');
  const [search, setSearch] = useState(() => params.get('q') || '');
  /* مدى صفحة الغرف: null = السجلّ كلّه، وهو الافتراض */
  const [range, setRange] = useState<Range>(null);
  const [preset, setPreset] = useState('all');

  const [banks, setBanks] = useState<BankInfo[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; bankId?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [panel, setPanel] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  );

  const api: Api = useMemo(
    () => ({
      get: async <T,>(path: string) => {
        const res = await fetch(`/api/console/${path}`, {
          headers: { 'x-nabda-key': encodeURIComponent(key) },
        });
        return res.ok ? ((await res.json()) as T) : null;
      },
      send: async <T,>(method: string, path: string, body?: unknown) => {
        const res = await fetch(`/api/console/${path}`, {
          method,
          headers: {
            'x-nabda-key': encodeURIComponent(key),
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { ok: res.ok, data: (await res.json().catch(() => null)) as T | null };
      },
    }),
    [key],
  );

  useEffect(() => {
    if (!key) return;
    void api.get<unknown>('summary').then((data) => data && setReady(true));
  }, [key, api]);

  /*
   * الشاراتُ تُجلب هنا لا في اللوحة.
   *
   * كانت اللوحةُ هي من يرسلها، فلا تتحدّث إلا وهي معروضة: يُحرّر المالك
   * سبعةَ أسئلة وشارتُها تقول صفراً حتى يدخل صفحتها. وهنا تُقرأ بعد كل
   * حفظٍ أياً كانت الصفحة المفتوحة.
   */
  useEffect(() => {
    if (!ready) return;
    void api.get<Alerts>('alerts').then((data) => data && setAlerts(data));
  }, [api, ready, reloadKey]);

  /*
   * أعدادُ البنوك تُقرأ بعد كل حفظٍ لا مرّةً عند الدخول.
   *
   * كانت تُجلب عند الجهوز وحده، فيضيف المالك سؤالاً أو يحذفه أو ينقله بين
   * بنكين وأعدادُ الشريط — كلُّ بنكٍ ومجموعُها والعنوانُ فوقها — على حالها
   * حتى يُعاد تحميل الصفحة. فرُبطت بـreloadKey كالشارات، فتتبع التغيير.
   *
   * ومن console/banks لا من /api/banks: ذاك بابُ اللعبة وهو يحجب المُلغى
   * والفارغ — ولو قُرئ منه لاختفى من شريط المالك بنكٌ أُلغي تفعيلُه، فلا
   * يُعاد تفعيلُه إلا بقاعدةٍ تُفتح بيد.
   */
  useEffect(() => {
    if (!ready) return;
    void api.get<BankInfo[]>('banks').then((data) => data && setBanks(data));
  }, [api, ready, reloadKey]);

  /*
   * الكتابةُ بـreplace لا push: تبديلُ مرشّحٍ ليس نقلةً في التاريخ، ولو
   * كُتبت لصار زرُّ الرجوع يتراجع حرفاً حرفاً في حقل البحث. والمقارنةُ
   * قبل الكتابة تمنع دورةً لا تنتهي.
   */
  useEffect(() => {
    const next = new URLSearchParams();
    if (door !== 'home') next.set('d', door);
    if (door === 'banks' && page !== 'questions') next.set('p', page);
    if (bank) next.set('b', bank);
    if (level) next.set('l', String(level));
    if (view !== 'all') next.set('v', view);
    if (search) next.set('q', search);
    if (next.toString() !== window.location.search.replace(/^\?/, '')) {
      setParams(next, { replace: true });
    }
  }, [door, page, bank, level, view, search, setParams]);

  const route = door === 'banks' ? page : door;
  const heading = PAGES[route] ?? PAGES.home;
  const atPending = door === 'banks' && page === 'pending';

  /* تبديلُ الباب يُعيد التصفية إلى أولها: تصفيةٌ لا تخصّ الصفحة تُربك */
  const go = useCallback((next: SectionId, nextPage?: string, nextView?: string) => {
    setDoor(next);
    if (next === 'banks') setPage(nextPage ?? 'questions');
    setView(nextView ?? 'all');
    setLevel(0);
    setSearch('');
    setCounts({});
  }, []);

  const openQuestion = useCallback((id: string) => setEditing({ id }), []);
  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);
  const sift: Sift = { bank, level, view, search, range };

  /* محوُ سجلّ المحرَّرة كلّه — الأرشيف أجمع لا ما يعرضه المرشّح */
  const wipeEdits = async () => {
    const res = await api.send<{ gone?: number }>('DELETE', 'edits');
    if (!res.ok) return toast('تعذّر محو السجلّ', { tone: 'danger' });
    toast('مُحي سجلّ المحرَّرة', {
      tone: 'safe',
      note: `${say(res.data?.gone ?? 0, 'question')} ذهبت نسخُها`,
    });
    refresh();
  };

  /*
   * ولا استيرادَ للبنوك من ملفّات المستودع بعد اليوم.
   *
   * كان زرٌّ يُدخل بنكاً له ملفٌّ في المستودع وليس في القاعدة — وهو من زمن
   * كان الملفُّ مرجعاً. والبنكُ يُنشأ اليوم باسمه ومعرّفه في صفحة إدارة
   * البنوك، وأسئلتُه تُستورد لصقاً أو ملفَّ CSV في صفحة المعلّقة.
   */
  const [intake, setIntake] = useState(false);
  const [newBank, setNewBank] = useState(false);

  /* اعتمادُ الجاهز كلِّه — ومرشّحُ البنك يضيّق الفعل كما يضيّق النظر */
  const [approving, setApproving] = useState(false);
  const approveReady = async () => {
    setApproving(true);
    const res = await api.send<{ approved?: number; failed?: { why: string }[] }>(
      'POST',
      'pending/approve',
      { bank: bank || null },
    );
    setApproving(false);
    if (!res.ok) return toast('تعذّر الاعتماد', { tone: 'danger' });
    const done = res.data?.approved ?? 0;
    const failed = res.data?.failed?.length ?? 0;
    toast(done ? `اعتُمد ${say(done, 'question')}` : 'لا سؤالَ جاهزاً', {
      tone: done ? 'safe' : 'signal',
      note: failed
        ? `وبقي ${say(failed, 'question')} فيها خطأٌ يمنع`
        : done
          ? 'دخلت بنوكها وخرجت من الانتظار'
          : 'أكمِل تفاصيل المعلّقة أولاً',
    });
    refresh();
  };

  if (!ready) return <Gate current={key} onKey={setKey} />;

  const total = banks.reduce((n, b) => n + b.count, 0);
  const groups: Group[] = [];

  if (door === 'banks') {
    groups.push({
      label: 'الصفحات',
      rows: BANK_PAGES.map((item) => ({
        id: item.id,
        label: item.label,
        on: page === item.id,
        /*
         * عددٌ واحدٌ للصفحة لا يتبدّل معناه بين نشِطةٍ وخاملة.
         *
         * كان يعرض counts.all وهي نشِطة (مقيّدةٌ بالبنك) وalerts وهي خاملة
         * (مجموعُ البنوك)، فيقفز الرقمُ حين تدخل الصفحة. وكلُّها الآن مقيّدةٌ
         * بالبنك المختار: الأسئلةُ من عدّ البنك، والبلاغاتُ والمحرَّرةُ من
         * توزيعهما على البنوك — فيطابق الرقمُ ما تعرضه الصفحة بعينها.
         */
        count:
          item.id === 'questions'
            ? bank
              ? banks.find((b) => b.id === bank)?.count
              : total
            : item.id === 'pending'
              ? bank
                ? (alerts?.pendingByBank?.[bank] ?? 0)
                : alerts?.pending
              : item.id === 'reports'
                ? bank
                  ? (alerts?.reportsByBank?.[bank] ?? 0)
                  : alerts?.reports
                : item.id === 'edits'
                  ? bank
                    ? (alerts?.editsByBank?.[bank] ?? 0)
                    : alerts?.edits
                  : undefined,
        go: () => {
          setPage(item.id);
          setView('all');
          setLevel(0);
          setCounts({});
        },
      })),
    });

    groups.push({
      label: 'البنك',
      rows: [
        { id: '', label: 'كل البنوك', count: total, on: bank === '', go: () => setBank('') },
        ...banks.map((b) => ({
          id: b.id,
          label: b.name,
          count: b.count,
          /* قفلٌ بدل النقطة: البنكُ المُلغى يُعرف في الشريط بلا كلمة */
          lock: !b.active,
          on: bank === b.id,
          go: () => setBank(b.id),
        })),
      ],
    });

    if (page === 'questions') {
      groups.push({
        label: 'المستوى',
        rows: LEVELS.map((l) => ({
          id: String(l.id),
          label: l.label,
          dot: l.dot || undefined,
          count: counts[`lvl${l.id}`],
          on: level === l.id,
          go: () => setLevel(l.id),
        })),
      });
    }
  }

  if (door === 'home') {
    groups.push({
      label: 'ما يحتاج نظرك',
      rows: [
        {
          id: 'a1',
          label: 'بلاغات تنتظر',
          count: alerts?.reports,
          dot: 'var(--color-danger)',
          on: false,
          go: () => go('banks', 'reports'),
        },
        {
          id: 'a2',
          label: 'أسئلة ضعيفة',
          count: alerts?.weak,
          dot: 'var(--color-warn)',
          on: false,
          go: () => go('banks', 'questions', 'weak'),
        },
        {
          id: 'a3',
          label: 'عليها ملاحظات',
          count: alerts?.issues,
          dot: 'var(--color-warn)',
          on: false,
          go: () => go('banks', 'questions', 'issues'),
        },
        {
          id: 'a4',
          label: 'غرف قائمة الآن',
          count: alerts?.live,
          dot: 'var(--color-safe)',
          on: false,
          go: () => go('rooms', undefined, 'live'),
        },
        {
          id: 'a5',
          label: 'تقييمٌ منخفض',
          count: alerts?.lowStars,
          dot: 'var(--color-warn)',
          on: false,
          go: () => go('comments', undefined, 'low'),
        },
        {
          id: 'a6',
          label: 'تعليقات لم تُقرأ',
          count: alerts?.unreadComments,
          dot: 'var(--color-signal)',
          on: false,
          go: () => go('comments', undefined, 'unread'),
        },
      ],
    });
    groups.push({
      label: 'اختصارات',
      rows: [
        {
          id: 's1',
          label: 'أضف سؤالاً',
          count: alerts?.pending,
          on: false,
          /* إلى المعلّقة لا إلى المحرّر: حقلان أسرعُ من ستّة */
          go: () => go('banks', 'pending'),
        },
        {
          id: 's2',
          label: 'الأسئلة المحرَّرة',
          count: alerts?.edits,
          on: false,
          go: () => go('banks', 'edits'),
        },
        { id: 's3', label: 'سجلّ الغرف', on: false, go: () => go('rooms') },
      ],
    });
  }

  /* الغرف وحدها لها مدًى: البنوك والتعليقات تُقرأ كاملةً بلا تأريخ */
  if (door === 'rooms') {
    groups.push({
      label: 'الفترة',
      rows: [],
      node: (
        <DateRange value={range} onPick={setRange} preset={preset} onPreset={setPreset} />
      ),
    });
  }

  const views = VIEWS[route];
  if (views) {
    groups.push({
      label: 'العرض',
      rows: views.map((item) => ({
        id: item.id,
        label: item.label,
        count: counts[item.id],
        on: view === item.id,
        go: () => setView(item.id),
      })),
    });
  }

  const doorIndex = DOORS.findIndex((d) => d.id === door);

  return (
    <div className="flex min-h-screen bg-ground">
      {/* ══ الرفّ ══ */}
      <nav className="rail sticky top-0 z-40 flex h-screen w-16 shrink-0 flex-col items-center gap-1.5 py-3.5">
        <span
          className="rail-mark"
          style={{ transform: `translateY(${doorIndex * 46}px)` }}
          aria-hidden="true"
        />
        <span className="mb-3 flex size-9 items-center justify-center rounded-chip bg-white/20 text-white">
          <PulseIcon size={19} />
        </span>

        {DOORS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              data-on={door === item.id}
              aria-label={item.label}
              className="rail-item group relative flex size-10 items-center justify-center rounded-chip"
            >
              <Icon size={19} />
              <Tip>{item.label}</Tip>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(KEY_STORE);
            location.reload();
          }}
          aria-label="خروج"
          className="rail-item group relative mt-auto flex size-10 items-center justify-center rounded-chip"
        >
          <ExitIcon size={18} />
          <Tip>خروج</Tip>
        </button>
      </nav>

      {/* ══ الشريط الجانبيّ ══ */}
      {panel && (
        <>
          <aside className="no-bar sticky top-0 z-30 flex h-screen w-[264px] shrink-0 flex-col overflow-y-auto border-e border-line bg-surface-2 px-3.5 py-4 max-lg:fixed max-lg:inset-y-0 max-lg:start-16 max-lg:shadow-2xl">
            <div className="flex items-start justify-between gap-2 px-2 pb-3">
              <div className="min-w-0">
                <b className="block text-[16px] leading-tight font-black">
                  {DOORS[doorIndex]?.label}
                </b>
                {door === 'banks' && (
                  <p className="mt-1 text-[12.5px] leading-snug font-medium text-muted">
                    {say(total, 'question')} في {say(banks.length, 'bank')}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPanel(false)}
                aria-label="اطوِ الشريط"
                title="اطوِ الشريط"
                className="flex size-8 shrink-0 items-center justify-center rounded-chip text-faint transition hover:bg-surface hover:text-ink"
              >
                <PanelIcon size={16} />
              </button>
            </div>

            {groups.map((group) => (
              <div key={group.label} className="pt-3">
                <p className="px-2 pb-1.5 text-[11.5px] font-bold text-faint">{group.label}</p>
                {group.node}
                {group.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={row.go}
                    data-on={row.on}
                    className="side-row flex h-9 w-full items-center gap-2.5 rounded-chip px-2.5 text-right"
                  >
                    {row.lock ? (
                      <LockIcon
                        size={13}
                        className="shrink-0 text-warn-ink"
                        aria-label="مُلغى التفعيل"
                      />
                    ) : (
                      row.dot && (
                        <i
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: row.dot }}
                          aria-hidden="true"
                        />
                      )
                    )}
                    <span
                      className={`min-w-0 flex-1 truncate text-[13.5px] ${
                        row.on ? 'font-bold text-signal-ink' : 'font-medium text-ink-2'
                      }`}
                    >
                      {row.label}
                    </span>
                    {row.count !== undefined && (
                      <span
                        className={`tnum shrink-0 text-[12.5px] ${
                          row.on ? 'font-bold text-signal-ink' : 'font-medium text-faint'
                        }`}
                      >
                        {row.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/*
              ختمُ البناء — سطرٌ واحدٌ خافتٌ في القاع.
              لأن المتصفّح يخزّن الصفحة فيعرض حزمةَ الأمس، ولا يُعرف أيُّ
              نسخةٍ تعمل إلا أن تقولها النسخةُ نفسها. فإن شككتَ فاقرأ هنا.
            */}
            <div
              className="mt-auto px-2 pt-4 text-[11px] font-medium text-faint"
              title="وقتُ بناء هذه النسخة — اضغط Ctrl+Shift+R إن كان قديماً"
            >
              نسخة {__BUILD__}
            </div>
          </aside>

          {/* على الشاشات الضيّقة يطفو الشريط، فيُغلق بالضغط خلفه */}
          <button
            type="button"
            aria-label="أغلق الشريط"
            onClick={() => setPanel(false)}
            className="fixed inset-0 z-20 bg-black/25 lg:hidden"
          />
        </>
      )}

      {/* ══ المحتوى ══ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
          {!panel && (
            <button
              type="button"
              onClick={() => setPanel(true)}
              aria-label="أظهر الشريط"
              title="أظهر الشريط"
              className="flex size-9 shrink-0 items-center justify-center rounded-chip text-muted transition hover:bg-surface-2 hover:text-ink"
            >
              <PanelIcon size={18} />
            </button>
          )}

          <h1 className="min-w-0 flex-1 truncate text-[20px] leading-tight font-black">
            {heading}
          </h1>

          {SEARCH[route] && (
            <label className="relative shrink-0">
              <SearchIcon
                size={15}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={SEARCH[route]}
                className="h-10 w-56 rounded-chip bg-surface-2 pe-3 ps-9 text-[13.5px] font-medium shadow-[inset_0_0_0_1px_var(--color-line)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] xl:w-64"
              />
            </label>
          )}

          {/*
            «سؤال جديد» ينقل إلى صفحته لا يفتح نافذة.
            فنموذجُها فيه ما في النافذة وزيادة: يبقى مفتوحاً للسؤال الذي
            بعده، ولا يُلزمك إتمامَ ما لم يحضرك.
          */}
          {door === 'banks' && page !== 'shelf' && !atPending && (
            <Act
              icon={PlusIcon}
              label="أضف سؤالاً"
              tone="solid"
              onClick={() => go('banks', 'pending')}
            />
          )}

          {/* اعتمادُ الجاهز: لا يظهر إلا وفيه ما يُعتمد */}
          {atPending && (counts.ready ?? 0) > 0 && (
            <Act
              icon={CheckIcon}
              label={approving ? 'يُعتمد…' : 'اعتمد الجاهز'}
              title={`اعتمد ${say(counts.ready ?? 0, 'question')} تمَّت تفاصيلُها — والناقصُ يبقى`}
              tone="solid"
              count={counts.ready}
              disabled={approving}
              onClick={() => void approveReady()}
            />
          )}

          {atPending && (
            <Act
              icon={ImportIcon}
              label="استيراد"
              title="لصقٌ أو ملفُّ CSV: سؤالٌ وجوابُه في كل سطر"
              onClick={() => setIntake(true)}
            />
          )}

          {/* بنكٌ جديد: فعلُ الصفحة، فمكانُه ترويستُها كبقيّة الأفعال */}
          {door === 'banks' && page === 'shelf' && (
            <Act icon={PlusIcon} label="بنك جديد" tone="solid" onClick={() => setNewBank(true)} />
          )}

          {/*
            محوُ السجلّ كلّه بضغطٍ مطوّل — كحذف البنك.
            ولا يظهر إلا وفي السجلّ ما يُمحى.
          */}
          {door === 'banks' && page === 'edits' && (alerts?.edits ?? 0) > 0 && (
            <HoldButton
              bare
              tone="chip"
              className="shrink-0"
              glyph={<TrashIcon size={15} />}
              label={`احذف السجلّ كلّه (${alerts?.edits})`}
              onConfirm={() => void wipeEdits()}
            />
          )}

          {/* لا يظهر إلا وله عمل: زرٌّ لا أثر له يُضغط مرّةً ثم يُهمَل */}
          {door === 'comments' && (counts.unread ?? 0) > 0 && (
            <Act
              icon={CheckIcon}
              label="قراءة الكل"
              title="علّم التعليقات كلَّها مقروءة"
              count={counts.unread}
              onClick={() => {
                void api.send('POST', 'feedback/read', { kind: 'comment' }).then(refresh);
              }}
            />
          )}
        </header>

        <main className="min-h-0 flex-1 px-6 py-6">
          <div className="mx-auto w-full max-w-[1180px]">
            {door === 'home' && (
              <Dashboard
                api={api}
                reloadKey={reloadKey}
                onOpenQuestion={openQuestion}
                onGo={(s, p, v) => go(s as SectionId, p, v)}
              />
            )}

            {door === 'banks' && page === 'questions' && (
              <Questions
                api={api}
                sift={sift}
                banks={banks}
                onEdit={openQuestion}
                onCounts={setCounts}
                reloadKey={reloadKey}
              />
            )}
            {door === 'banks' && page === 'pending' && (
              <PendingPage
                api={api}
                sift={sift}
                banks={banks}
                onCounts={setCounts}
                reloadKey={reloadKey}
                onChanged={refresh}
              />
            )}
            {door === 'banks' && page === 'reports' && (
              <Reports
                api={api}
                sift={sift}
                banks={banks}
                onEdit={openQuestion}
                onCounts={setCounts}
                reloadKey={reloadKey}
              />
            )}
            {door === 'banks' && page === 'edits' && (
              <Edits
                api={api}
                sift={sift}
                banks={banks}
                onCounts={setCounts}
                reloadKey={reloadKey}
                onChanged={refresh}
              />
            )}
            {door === 'banks' && page === 'shelf' && (
              <Shelf
                api={api}
                banks={banks}
                onCounts={setCounts}
                reloadKey={reloadKey}
                onChanged={refresh}
              />
            )}

            {door === 'rooms' && (
              <Rooms api={api} sift={sift} onCounts={setCounts} reloadKey={reloadKey} />
            )}
            {door === 'comments' && (
              <Comments api={api} sift={sift} onCounts={setCounts} reloadKey={reloadKey} />
            )}
          </div>
        </main>
      </div>

      {newBank && (
        <NewBank api={api} onClose={() => setNewBank(false)} onAdded={refresh} />
      )}

      {intake && (
        <Intake
          api={api}
          banks={banks}
          bank={bank}
          onClose={() => setIntake(false)}
          onDone={refresh}
        />
      )}

      {editing && (
        <QuestionEditor
          api={api}
          questionId={editing.id}
          bankId={editing.bankId ?? bank ?? banks[0]?.id}
          banks={banks}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

/**
 * فعلُ الترويسة — أيقونةٌ واسمٌ بقالبٍ واحد.
 *
 * كانت أزرارُ الترويسة أشكالاً شتّى: «+ سؤال جديد» مصبوغٌ بلا أيقونة،
 * و«استيراد» مُحاطٌ بأيقونة، و«قراءة الكل» بلونٍ ثالث — ثلاثةُ قوالب في
 * صفٍّ واحد، وكلُّ صفحةٍ تعرض غيرَ ما تعرضه أختُها فلا تستقرّ عينُك.
 *
 * فصارت قالباً واحداً: أيقونةٌ ثم اسمٌ ثم عددٌ إن كان له عدد، والأبرزُ
 * مصبوغٌ والباقي مُحاط. والاسمُ يُطوى دون sm — على اللوح الضيّق تبقى
 * الأيقونةُ وحدها ومعها `title`، فالعرضُ هناك لا يحتمل أربع كلمات.
 */
function Act({
  icon: Icon,
  label,
  title,
  onClick,
  tone,
  count,
  disabled,
}: {
  icon: (p: { size?: number }) => React.ReactElement;
  label: string;
  title?: string;
  onClick: () => void;
  tone?: 'solid';
  count?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={label}
      className={`flex h-10 shrink-0 items-center justify-center gap-2 rounded-chip px-3.5 text-[13.5px] font-bold transition disabled:opacity-50 ${
        tone === 'solid'
          ? 'bg-signal-ink text-white hover:brightness-110'
          : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
      }`}
    >
      <Icon size={16} />
      <span className="max-sm:hidden">{label}</span>
      {count !== undefined && <span className="tnum">{count}</span>}
    </button>
  );
}

/**
 * بنكٌ جديد: اسمٌ ومعرّف.
 *
 * والمعرّفُ لاتينيٌّ لأنه يدخل في معرّف كل سؤال («quran:1a2b») وفي الرابط
 * وفي اسم ملفّ صورته. والحقلُ يأبى غيرَ اللاتينيّ وأنت تكتب، فلا تُكتب
 * كلمةٌ عربية ثم تُردّ عند الحفظ.
 */
function NewBank({
  api,
  onClose,
  onAdded,
}: {
  api: Api;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const bare = !name.trim() || !id.trim();

  const add = async () => {
    if (bare || busy) return;
    setBusy(true);
    setError('');
    const res = await api.send<{ error?: string }>('POST', 'bank', {
      id: id.trim(),
      name: name.trim(),
    });
    setBusy(false);
    if (!res.ok) return setError(res.data?.error ?? 'تعذّر الإنشاء');
    toast(`أُنشئ بنك «${name.trim()}»`, { tone: 'safe' });
    onAdded();
    onClose();
  };

  return (
    <Modal
      title="بنك جديد"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => void add()}
            disabled={bare || busy}
            className={`h-10 rounded-chip px-6 text-[14px] font-black transition ${
              bare || busy
                ? 'cursor-not-allowed bg-line-2 text-white'
                : 'bg-signal-ink text-white hover:brightness-110'
            }`}
          >
            {busy ? 'يُنشأ…' : 'أنشِئ'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-chip px-4 text-[14px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2"
          >
            إلغاء
          </button>
        </>
      }
    >
      <span className="mb-2 block text-[12.5px] font-bold text-ink-2">الاسم</span>
      <input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setError('');
        }}
        onKeyDown={(event) => event.key === 'Enter' && void add()}
        placeholder="السيرة النبوية"
        autoFocus
        className="mb-5 h-11 w-full rounded-chip bg-surface px-4 text-[14px] font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
      />

      <span className="mb-2 block text-[12.5px] font-bold text-ink-2">المعرّف</span>
      <input
        value={id}
        onChange={(event) => {
          /* يُقصّ غيرُ اللاتينيّ عند الكتابة: ردٌّ فوريٌّ أوضحُ من خطأٍ بعد الضغط */
          setId(
            event.target.value
              .toLowerCase()
              .replace(/[^a-z0-9_-]/g, ''),
          );
          setError('');
        }}
        onKeyDown={(event) => event.key === 'Enter' && void add()}
        placeholder="seerah"
        dir="ltr"
        className="h-11 w-full rounded-chip bg-surface px-4 text-right font-mono text-[14px] font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
      />

      {error && <p className="mt-3 text-[13.5px] font-bold text-danger">{error}</p>}
    </Modal>
  );
}

/**
 * اسمُ الأيقونة يظهر عند المرور — الرفّ أضيقُ من أن يحمل الأسماء.
 *
 * وجهتُه start-full لا end-full: الرفّ ملتصقٌ بحافّة الشاشة اليمنى، وفي
 * RTL تعني ‎inset-inline-end: 100%‎ أن يُدفع العنصر يميناً — أي خارج
 * الشاشة. و‎inset-inline-start‎ يدفعه يساراً إلى داخل الصفحة.
 */
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="pointer-events-none absolute start-full top-1/2 z-50 ms-3.5 -translate-y-1/2 rounded-chip px-3 py-1.5 text-[12px] font-bold whitespace-nowrap text-white opacity-0 group-hover:opacity-100"
      style={{ background: '#0c1d21' }}
    >
      {children}
    </span>
  );
}

/** باب الدخول: مفتاحٌ واحد، ورسالةٌ لا تقول أكثر مما يجب */
function Gate({ current, onKey }: { current: string; onKey: (key: string) => void }) {
  useTheme('light');
  const [value, setValue] = useState('');
  const [error, setError] = useState(current ? 'انتهت الجلسة — أدخل المفتاح' : '');

  const submit = async () => {
    const key = value.trim();
    if (!key) return setError('أدخل المفتاح');
    const res = await fetch('/api/console/summary', {
      headers: { 'x-nabda-key': encodeURIComponent(key) },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setError(body.error ?? 'مفتاح غير صحيح');
    }
    localStorage.setItem(KEY_STORE, key);
    onKey(key);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ground px-5">
      <svg
        viewBox="0 0 900 80"
        className="pointer-events-none absolute top-16 w-[900px] max-w-none opacity-25"
        fill="none"
        aria-hidden="true"
      >
        <polyline
          points="0,40 350,40 380,40 400,10 425,70 450,40 530,40 550,24 565,40 900,40"
          stroke="var(--color-signal)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div className="tile relative w-[380px] max-w-full px-8 py-9">
        <span className="mx-auto flex size-11 items-center justify-center rounded-chip bg-signal-ink text-white">
          <PulseIcon size={24} />
        </span>
        <h1 className="mt-4 text-center text-[19px] font-black">نبضة — لوحة المالك</h1>
        <p className="mt-1 text-center text-[13px] font-medium text-muted">هذا الباب للمالك وحده</p>

        <label className="mt-6 block text-[12.5px] font-bold text-ink-2">المفتاح السرّي</label>
        <input
          type="password"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
          placeholder="••••••••••••"
          autoFocus
          className="mt-2 h-11 w-full rounded-chip bg-surface-2 px-3.5 text-[14px] font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
        />
        {error && <p className="mt-2.5 text-[13px] font-bold text-danger">{error}</p>}
        <button
          type="button"
          onClick={submit}
          className="mt-3.5 h-11 w-full rounded-chip bg-signal-ink text-[14px] font-bold text-white transition hover:brightness-110"
        >
          دخول
        </button>
      </div>
    </div>
  );
}
