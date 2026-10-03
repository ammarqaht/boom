import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, ask } from '../lib/socket';
import type { Bank, CardId, FeedItem, PublicTeam, RoomState } from '../lib/types';
import {
  Button,
  Card,
  CheckAll,
  ErrorNote,
  Field,
  HoldButton,
  Input,
  FormPage,
  IconButton,
  Menu,
  MiniAction,
  PulseMark,
  Segmented,
  formatTime,
  stateStyle,
  teamLevel,
  useTheme,
  useWide,
  type MenuAction,
} from '../components/ui';
import {
  ArrowIcon,
  CardsIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  DoubleIcon,
  HistoryIcon,
  MinusIcon,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  RestartIcon,
  ScreenIcon,
  SnowflakeIcon,
  TimePlusIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/icons';
import {
  CommentCard,
  CountdownGate,
  HistoryModal,
  Lane,
  Modal,
  ResultBars,
  RollingNumber,
  Standings,
  TheEnd,
  useReorderSlide,
} from '../components/game';

const SESSION_KEY = 'nabda:admin';

/**
 * مُنتقي البنوك — سحابةُ أقراصٍ تلتفّ، لا شبكةٌ ذاتُ عمودين.
 *
 * ولماذا تُركت الشبكة؟ أسماءُ البنوك عربيةٌ مختلفةُ الأطوال: «العلوم»
 * خمسةُ أحرف و«الصحابة رضي الله عنهم» أحدٌ وعشرون. والشبكةُ تفرض على
 * الاثنين خليّةً واحدة: فيُقَصّ الطويلُ على ثلاثة أسطر، ويبقى تحت القصير
 * فراغٌ ميّت — وهذا بعينه ما يُقرأ «تراصّاً». والقرصُ يأخذ قدرَ اسمه
 * ويلتفّ إلى السطر التالي من نفسه، فيستوي الإيقاع.
 *
 * والخزّانُ في صدر اللوح لا في ذيله: هو الرقمُ الذي يُبنى عليه القرار —
 * «أيكفي ما اخترتُ لعشر جولات؟» — فيُرى وهو ينمو مع كل ضغطة، لا بعد أن
 * يفرغ المنظّم من الاختيار.
 */
function BankPicker({
  banks,
  chosen,
  onToggle,
  onAll,
}: {
  banks: Bank[];
  chosen: string[];
  onToggle: (id: string) => void;
  onAll: () => void;
}) {
  const total = banks.filter((b) => chosen.includes(b.id)).reduce((sum, b) => sum + b.count, 0);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
        <span className="tnum text-[13px] font-medium text-muted">
          <b className="font-black text-ink">{chosen.length}</b> من {banks.length} بنكاً ·{' '}
          <b className="font-black text-signal">{total}</b> سؤال في الخزّان
        </span>
        <CheckAll
          label="تحديد الكل"
          checked={chosen.length === banks.length}
          onToggle={onAll}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {banks.map((bank) => {
          const on = chosen.includes(bank.id);
          return (
            <button
              key={bank.id}
              type="button"
              onClick={() => onToggle(bank.id)}
              aria-pressed={on}
              /* أضيقُ على الجوّال: قرصان في السطر خيرٌ من واحدٍ وفراغٍ بجانبه */
              className={`flex items-center gap-2 rounded-chip px-3 py-2 text-[13px] font-bold transition sm:gap-2.5 sm:px-3.5 sm:py-2.5 sm:text-[14px] ${
                on
                  ? 'bg-signal-2 text-ink shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                  : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
              }`}
            >
              <span
                className={`flex size-[17px] shrink-0 items-center justify-center rounded-[3px] transition ${
                  on
                    ? 'bg-signal text-on-signal'
                    : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-2)]'
                }`}
                aria-hidden="true"
              >
                <CheckIcon size={10} strokeWidth={4} />
              </span>
              <span className="whitespace-nowrap">{bank.name}</span>
              <span
                className={`tnum text-[11.5px] font-medium ${on ? 'text-signal-ink' : 'text-faint'}`}
              >
                {bank.count}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

type Session = { code: string; adminKey: string };

export default function Admin() {
  /*
   * غامقةٌ كشاشة اللاعب والعرض.
   *
   * كانت فاتحةً على أن المنظّم «يجلس في ضوء»، وهو يجلس في قاعةٍ مُطفأةٍ
   * بجانب البروجكتر: فلوحٌ أبيضُ هناك مصباحٌ في الوجه، ويُحرق نظرَه كلّما
   * رفعه إلى الشاشة الكبيرة وأعاده. وهو مع العرض واللاعب شاشةٌ واحدة في
   * مجلسٍ واحد، فلا تُخالفهما.
   */
  useTheme('dark');
  const [params] = useSearchParams();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [bankIds, setBankIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Level>('middle');
  const [roomName, setRoomName] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  /* حالُ الوصل: لوحةٌ مقطوعة لا تُدير غرفة، فلا تُترك تبدو سليمة */
  const [live, setLive] = useState(() => socket.connected);

  useEffect(() => {
    void fetch('/api/banks')
      .then((r) => r.json())
      .then((list: Bank[]) => {
        setBanks(list);
        setBankIds(list.length ? [list[0].id] : []);
      })
      .catch(() => setError('تعذّر تحميل بنوك الأسئلة'));
  }, []);

  useEffect(() => {
    const onState = (next: RoomState) => setRoom(next);
    socket.on('room:state', onState);
    return () => {
      socket.off('room:state', onState);
    };
  }, []);

  /*
   * استعادة الغرفة: من الرابط أولاً — فرابط المنظّم يحمل مفتاحه وينقل
   * اللوحة إلى جهاز آخر — ثم من الجلسة المحفوظة على هذا الجهاز.
   */
  /*
   * الوصلُ يُعاد عند كل اتصال، والجلسةُ تُقرأ حينه لا عند التركيب.
   *
   * وكانت تُقرأ مرّةً واحدة: من فتح اللوحة ثم أنشأ غرفةً لم يكن له جلسةٌ
   * وقت التركيب، فلم يُسجَّل مستمعُ الاتصال أصلاً. فإذا انقطع السوكِت
   * لحظةً وعاد، عاد بهويّةٍ جديدة لم تنضمّ إلى الغرفة — فلا تصله حال
   * الغرفة، ولا يصل السيرفرَ شيءٌ من أزراره. اللوحةُ تموت صامتة: تُضغط
   * الأزرار فلا يحدث شيء، ولا خبر يقول لماذا.
   */
  useEffect(() => {
    const readSession = (): Session | null => {
      const code = params.get('code');
      const key = params.get('key');
      if (code && key) return { code: code.toUpperCase(), adminKey: key };
      const saved = localStorage.getItem(SESSION_KEY);
      try {
        return saved ? (JSON.parse(saved) as Session) : null;
      } catch {
        return null;
      }
    };

    const rejoin = async () => {
      const session = readSession();
      if (!session) return;
      const res = await ask<{ state: RoomState }>('admin:join', session);
      if (res.ok) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setRoom(res.state);
      } else if (!params.get('code')) {
        localStorage.removeItem(SESSION_KEY);
      }
    };

    const onConnect = () => {
      setLive(true);
      void rejoin();
    };
    const onDrop = () => setLive(false);

    /*
     * مزامنةٌ عند التركيب: السوكِت يتصل عند تحميل الوحدة، فقد يقع حدث
     * connect قبل أن يُسجَّل المستمع هنا — فتبقى الشارة تقول «انقطع
     * الاتصال» ولوحةٌ تعمل تحتها. والحالة تُقرأ لا تُنتظر.
     */
    setLive(socket.connected);
    void rejoin();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDrop);
    socket.on('admin:feed', setFeed);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDrop);
      socket.off('admin:feed', setFeed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ثوابت الجولة لا تُرسل: السيرفر يطبّق قيمه الافتراضية */
  const createRoom = async () => {
    setError('');
    const res = await ask<{ code: string; adminKey: string; state: RoomState }>(
      'admin:createRoom',
      {
        bankIds,
        difficulty,
        name: roomName.trim(),
      },
    );
    if (!res.ok) return setError(res.error);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ code: res.code, adminKey: res.adminKey }));
    setRoom(res.state);
  };

  if (!room) {
    const toggle = (id: string) =>
      setBankIds((current) =>
        current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      );

    return (
      <FormPage
        wide
        title="غرفة جديدة"
        lead="اختر بنوك الأسئلة الآن — وتُبدَّل لاحقاً من «خيارات». أما ثوابت الجولة فمضبوطة: ثلاثون ثانية، وخمس للصواب، وثلاث للخطأ."
      >
        <Card className="grid gap-4">
          <Field label="اسم الغرفة">
            <Input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="نادي الفجر — الحلقة الثالثة"
              maxLength={40}
              autoFocus
            />
            <span className="mt-1.5 block text-xs font-medium text-muted">
              النشاط أو النادي — به تعرف الغرفة في سجلّك بعد شهر.
            </span>
          </Field>

          <Field group label="بنوك الأسئلة — واحد أو أكثر">
            <BankPicker
              banks={banks}
              chosen={bankIds}
              onToggle={toggle}
              onAll={() =>
                setBankIds(bankIds.length === banks.length ? [banks[0].id] : banks.map((b) => b.id))
              }
            />
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              تُخلط أسئلة البنوك المختارة وتُعرض عشوائياً — ولا يُعاد سؤالٌ على لاعبٍ رآه.
            </p>
          </Field>

          {/* مجموعةٌ لا ‎<label>‎: أربعةُ أزرار، وضغطةٌ في فراغها تُفعّل أوّلها */}
          <Field group label="مستوى الأسئلة">
            <Segmented value={difficulty} options={LEVELS} onPick={setDifficulty} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button
            size="lg"
            onClick={createRoom}
            disabled={bankIds.length === 0 || !roomName.trim()}
          >
            أنشئ الغرفة
          </Button>
        </Card>
      </FormPage>
    );
  }

  return <Console room={room} banks={banks} feed={feed} live={live} />;
}

/** مستويات المسابقة كما يراها المنظّم — والنسب في السيرفر */
type Level = 'primary' | 'middle' | 'secondary' | 'university';

const LEVELS: { id: Level; label: string; hint: string }[] = [
  {
    id: 'primary',
    label: 'ابتدائي',
    hint: 'أسئلة سهلة ومتوسطة بالسويّة، وقليلٌ من الصعب يُطرب من عرفه.',
  },
  {
    id: 'middle',
    label: 'متوسط',
    hint: 'أغلبها متوسط، وحولها قليلٌ من السهل ومثله من الصعب.',
  },
  {
    id: 'secondary',
    label: 'ثانوي',
    hint: 'متوسط وصعب يغلب عليه الصعب، وقليلٌ من السهل يُنفّس عن اللاعب.',
  },
  {
    id: 'university',
    label: 'جامعي',
    hint: 'أغلبها صعب، ومعه ربعٌ من المتوسط — ولا سهل فيه.',
  },
];

const STATUS: Record<RoomState['status'], string> = {
  lobby: 'بانتظار البدء',
  countdown: 'استعداد…',
  running: 'الجولة جارية',
  paused: 'موقوفة مؤقتاً',
  ended: 'انتهت الجولة',
  finished: 'انتهت اللعبة',
};

function Console({
  room,
  banks,
  feed,
  live: online,
}: {
  room: RoomState;
  banks: Bank[];
  feed: FeedItem[];
  live: boolean;
}) {
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showBanks, setShowBanks] = useState(false);
  /* نافذةُ تأكيد الإنهاء — آخرُ فعلٍ في الجلسة، فيُقرأ قبل أن يقع */
  const [confirmEnd, setConfirmEnd] = useState(false);

  const key = (JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as Partial<Session>).adminKey;
  const playUrl = `${location.origin}/play?code=${room.code}`;
  const displayUrl = `${location.origin}/display?code=${room.code}`;
  const adminUrl = `${location.origin}/admin?code=${room.code}&key=${key ?? ''}`;

  const idle = room.status === 'lobby' || room.status === 'ended' || room.status === 'finished';
  const live = room.status === 'running';
  const over = room.status === 'finished' && room.standings;
  const last = room.history[room.history.length - 1] ?? null;
  const wide = useWide();

  /*
   * قائمتان بترتيبين مختلفين عن قصد:
   *   الأشرطة تتبع ما بقي من الوقت وتنزلق عند التجاوز — فهي مرآةُ السباق.
   *   والنقاط تتبع ترتيب الانضمام ولا تتحرّك أبداً — فالمنظّم يضغط فيها
   *   أزراراً، ولو تبدّلت المواضع تحت إصبعه لأضاف النقطة إلى غير صاحبها.
   */
  const ranked = [...room.teams].sort((a, b) => {
    if (a.flatlined !== b.flatlined) return a.flatlined ? 1 : -1;
    return b.timeMs - a.timeMs || b.score - a.score;
  });
  const joined = useRef(new Map<string, number>());
  const byJoin = useMemo(() => {
    for (const t of room.teams) {
      if (!joined.current.has(t.id)) joined.current.set(t.id, joined.current.size);
    }
    return [...room.teams].sort((a, b) => joined.current.get(a.id)! - joined.current.get(b.id)!);
  }, [room.teams]);

  const board = useRef<HTMLDivElement>(null);
  useReorderSlide(board, ranked.map((t) => t.id).join(','));

  const send = (event: string, payload?: unknown) => socket.emit(event, payload ?? {});

  /* الخروج من شاشة النهاية يمحو جلسة الغرفة — والغرفة الجديدة تبدأ نظيفة */
  const leaveRoom = (to: string) => {
    localStorage.removeItem(SESSION_KEY);
    location.href = to;
  };

  const flash = (message: string) => {
    setNote(message);
    setTimeout(() => setNote(''), 2000);
  };

  const copy = (url: string, label: string) => {
    void navigator.clipboard.writeText(url);
    flash(`نُسخ ${label}`);
  };

  const start = async () => {
    const res = await ask('admin:start');
    if (!res.ok) flash(res.error);
  };

  /*
   * اختصارات المنظّم: مسافة توقف وتستأنف، وEnter يبدأ الجولة.
   *
   * أمام قاعةٍ منتظرة، البحث عن الزرّ بالفأرة تأخيرٌ يراه الجميع. ولا
   * تعمل وأنت تكتب في حقل — وإلا ابتلعت المسافةُ كلماتك — ولا مع
   * مُرافِقٍ مضغوط، فتلك اختصارات المتصفّح لا اختصاراتنا.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // ليس كل هدفٍ عنصراً: الحدث قد يأتي على window أو document فلا closest له
      const target = event.target as HTMLElement | null;
      if (typeof target?.closest === 'function') {
        if (target.closest('input, textarea, [contenteditable="true"]')) return;
      }

      if (event.code === 'Space') {
        if (room.status === 'running') {
          event.preventDefault();
          send('admin:pause');
        } else if (room.status === 'paused') {
          event.preventDefault();
          send('admin:resume');
        }
        return;
      }
      if (event.key === 'Enter' && idle) {
        event.preventDefault();
        void start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status, idle]);

  const toggleBank = (id: string) => {
    const next = room.bankIds.includes(id)
      ? room.bankIds.filter((x) => x !== id)
      : [...room.bankIds, id];
    if (next.length === 0) return flash('لا بد من بنك واحد على الأقل');
    send('admin:setBanks', { bankIds: next });
  };

  const setLevel = (difficulty: Level) => {
    send('admin:setBanks', { difficulty });
    flash(`المستوى: ${LEVELS.find((l) => l.id === difficulty)?.label}`);
  };

  /* الأفعال الخطرة لا تظهر على الشاشة: مكانها القائمة، وتحتاج ضغطاً مستمراً */
  const actions: MenuAction[] = [
    { label: 'سجل الجولات', icon: <HistoryIcon size={17} />, onClick: () => setShowHistory(true) },
    {
      label: room.displayBlurred ? 'إظهار الترتيب' : 'تغبيش شاشة العرض',
      icon: room.displayBlurred ? <EyeIcon size={17} /> : <EyeOffIcon size={17} />,
      onClick: () => send('admin:toggleBlur'),
    },
    { label: 'بنوك الأسئلة', icon: <CardsIcon size={17} />, onClick: () => setShowBanks(true) },
  ];

  return (
    <div className="flex h-full flex-col">
      {/*
       * ترويسة نحيلة: الهوية والرمز والحال. أما أزرار الجولة وعدّادها
       * فمكانها لوحةُ الجولة — فالترويسة تُعرِّف ولا تُدير.
       */}
      <header className="shrink-0 border-b border-line bg-surface px-3 py-2 sm:px-6 sm:py-3">
        {/*
         * المعرّفات في مجموعةٍ تنكمش، والقائمة أختٌ لها لا عضوٌ فيها: على
         * الجوال كان زرُّ «خيارات» يُدفع إلى سطرٍ ثانٍ وحده فيأكل ٣٦ بكسلاً
         * من لوحةٍ تُقرأ أثناء الجولة. فصار السطر واحداً على كل عرض.
         */}
        <div className="flex items-center gap-x-2.5 sm:gap-x-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:gap-x-4 sm:gap-y-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-signal-ink text-white sm:size-9">
            <PulseMark size={20} />
          </span>
          <b className="text-[15px] font-black sm:text-[16px]">نبضة</b>

          {/* الرمز شارةٌ لا رقمٌ عائم: يُقرأ من بعيد ويُملى على القاعة */}
          <b
            dir="ltr"
            className="tnum rounded-chip bg-signal-2 px-2 py-0.5 text-[13px] font-black tracking-[0.18em] text-signal-ink sm:px-3 sm:py-1 sm:text-[15px] sm:tracking-[0.25em]"
          >
            {room.code}
          </b>
          {/* الاسم يُذكّر المنظّم أيّ نشاطٍ هذا حين يفتح غرفتين معاً */}
          <span
            className="max-w-[12ch] truncate text-[12px] font-medium text-muted sm:max-w-[18ch] sm:text-[13px]"
            title={room.name}
          >
            {room.name}
          </span>

          <span className="flex items-center gap-1.5 text-[12px] font-bold text-muted sm:gap-2 sm:text-[13px]">
            <i
              className={`size-2 rounded-full ${
                live ? 'blink bg-safe' : room.status === 'paused' ? 'blink bg-warn' : 'bg-faint'
              }`}
              aria-hidden="true"
            />
            {STATUS[room.status]}
          </span>

          {/*
            رقمُ الجولة في الترويسة — حيث تُقرأ هويّةُ الغرفة كلُّها.
            كان بلاطةً في جانب زرّ البدء تحمل معه «كم جولةً اكتملت»، وهو
            عددٌ لا يُتّخذ عليه قرار: المنظّم يسأل «أيُّ جولةٍ نحن فيها؟»
            لا «كم مضى؟». فصار رقماً واحداً حيث ينظر أصلاً.
          */}
          <span className="tnum text-[12px] font-bold text-muted sm:text-[13px]">
            الجولة <b className="font-black text-ink">{room.round}</b>
          </span>

          {/*
           * الانقطاع يُقال صراحةً: لوحةٌ مقطوعة تبدو سليمةً تماماً — تُضغط
           * أزرارها فلا يحدث شيء ولا خبر يقول لماذا. فتُعلن الحال.
           */}
          {!online && (
            <span className="flex items-center gap-1.5 rounded-chip bg-danger-2 px-2 py-0.5 text-[11.5px] font-bold text-danger sm:gap-2 sm:px-2.5 sm:py-1 sm:text-[12.5px]">
              <OfflineIcon size={14} />
              انقطع الاتصال — يُعاد الوصل
            </span>
          )}
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            {note && (
              <span className="hidden text-[13px] font-bold text-signal-ink sm:block">{note}</span>
            )}

            {/*
              الإنهاءُ على الشاشة لا في القائمة.
              كان سطراً فيها بضغطٍ مطوّل، فيُبحث عنه في آخر المسابقة والقاعةُ
              تنتظر. وهو آخرُ فعلٍ في كل جلسة — يُفعل مرّةً ويُقصد قصداً —
              فمكانُه حيث تقع العين. والحراسةُ انتقلت إلى نافذةٍ تُقرأ: أصدقُ
              من ضغطٍ مطوّلٍ لا يقول ماذا سيقع.
            */}
            {room.status !== 'finished' && (
              <button
                type="button"
                onClick={() => setConfirmEnd(true)}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-chip px-2.5 text-[13px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)] transition hover:bg-surface-2 sm:gap-2 sm:px-3.5"
              >
                <TrophyIcon size={15} />
                إنهاء
              </button>
            )}

            <Menu actions={actions} />
          </div>
        </div>
      </header>

      {/*
       * overscroll-contain: التمرير لا يتسلسل إلى الصفحة تحته حين يبلغ
       * المحتوى طرفه — فلا ترتدّ اللوحة على الجوال ولا تُسحب الصفحة كلها.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid max-w-[1560px] gap-2.5 px-3 py-3 sm:gap-4 sm:px-6 sm:py-4 xl:grid-cols-[minmax(0,1fr)_432px] xl:items-start">
          {/* على الجوال تتصدّر لوحة الجولة، فزرّ البدء لا يُبحث عنه بالتمرير */}
          <div className="xl:hidden">
            <RoundPanel
              room={room}
              banks={banks}
              live={live}
              idle={idle}
              onStart={start}
              onSend={send}
            />
          </div>

          <main className="grid content-start gap-2.5">
            {over ? (
              <>
                <section className="tile px-4 py-6 sm:px-6">
                  <Standings compact standings={room.standings!} rounds={room.history.length} />
                </section>
                {/* رأي المنظّم كرأي اللاعب: كلاهما لعب، وأسفلَ الترتيب لا نافذةً تعترض */}
                <div className="mx-auto w-full max-w-md">
                  <CommentCard onSend={(payload) => ask('feedback:comment', payload)} />
                  <TheEnd
                    primary="غرفة جديدة"
                    onPrimary={() => leaveRoom('/admin')}
                    onHome={() => leaveRoom('/')}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <b className="text-[15px] font-black sm:text-[16px]">
                    اللاعبون <span className="font-bold text-faint">({room.teams.length})</span>
                  </b>
                  <span className="tnum text-[12px] font-medium text-faint sm:text-[12.5px]">
                    {room.teams.filter((t) => !t.flatlined).length} نبضة حيّة
                  </span>
                </div>

                {room.status === 'paused' && (
                  <div className="flex items-center justify-center gap-2.5 rounded-chip bg-signal-2 px-3 py-2 text-center text-sm font-black text-signal">
                    <PauseIcon size={15} />
                    الجولة موقوفة مؤقتاً — كل العدّادات ساكنة
                  </div>
                )}

                {room.teams.length === 0 ? (
                  <div className="tile flex flex-col items-center gap-2.5 px-3 py-7 text-center sm:gap-3 sm:px-4 sm:py-10">
                    <PulseMark size={26} className="text-faint" />
                    <p className="text-muted">
                      لم ينضم أحد بعد — شارك الرمز{' '}
                      <b className="tnum font-black tracking-[0.14em] text-signal">{room.code}</b>
                    </p>
                  </div>
                ) : (
                  <div ref={board} className="grid content-start gap-2.5">
                    {ranked.map((team, i) => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        rank={i + 1}
                        running={live}
                        wide={wide}
                        onAdjust={(seconds) =>
                          send('admin:adjustTime', { teamId: team.id, seconds })
                        }
                        onRemove={() => send('admin:removeTeam', { teamId: team.id })}
                      />
                    ))}
                  </div>
                )}

                {/*
                 * الرمزُ دعوةٌ لا لافتة: يُنادى به قبل أن تبدأ اللعبة، فإذا
                 * بدأت صار سطراً يزاحم صفوف اللاعبين بخبرٍ فات أوانه. ومن
                 * أراده بعدها فهو في الترويسة وفي «روابط الغرفة».
                 */}
                {room.status === 'lobby' && room.teams.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-card border-[1.5px] border-dashed border-line-2 px-3 py-3.5 text-center text-[12.5px] font-medium text-muted sm:gap-x-3 sm:px-4 sm:py-5 sm:text-[13.5px]">
                    <span className="flex items-center gap-2">
                      <PulseMark size={18} className="text-signal-ink" />
                      بابُ الانضمام مفتوح — شارك الرمز
                    </span>
                    <b dir="ltr" className="tnum font-black tracking-[0.2em] text-signal-ink">
                      {room.code}
                    </b>
                  </div>
                )}
              </>
            )}
          </main>

          <aside className="grid content-start gap-4">
            <div className="hidden xl:block">
              <RoundPanel
                room={room}
                banks={banks}
                live={live}
                idle={idle}
                onStart={start}
                onSend={send}
              />
            </div>

            <Panel title="روابط الغرفة" hint={`${room.teams.length} لاعباً`}>
              <div className="grid gap-1.5">
                <LinkRow
                  icon={<UsersIcon size={15} />}
                  label="رابط اللاعبين"
                  onCopy={() => copy(playUrl, 'رابط اللاعبين')}
                />
                <LinkRow
                  icon={<ScreenIcon size={15} />}
                  label="رابط شاشة العرض"
                  onCopy={() => copy(displayUrl, 'رابط شاشة العرض')}
                />
                <LinkRow
                  icon={<HistoryIcon size={15} />}
                  label="رابط المنظّم"
                  onCopy={() => copy(adminUrl, 'رابط المنظّم')}
                />
              </div>
            </Panel>

            {room.teams.length > 0 && (
              <Panel title="نقاط اللاعبين" hint="تعديل يدويّ">
                <div className="grid">
                  {byJoin.map((team) => (
                    <div
                      key={team.id}
                      className="flex items-center gap-2 border-b border-line-soft py-2 last:border-0"
                    >
                      <b className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{team.name}</b>
                      <IconButton
                        title={`أضف نقطة إلى ${team.name}`}
                        size={8}
                        onClick={() => send('admin:adjustScore', { teamId: team.id, points: 1 })}
                      >
                        <PlusIcon size={14} strokeWidth={2.6} />
                      </IconButton>
                      <RollingNumber
                        value={team.score}
                        className="tnum w-8 text-center text-[16px] font-black"
                      />
                      {/*
                       * النقاط لا تنزل تحت الصفر — والزرُّ يقول ذلك بنفسه.
                       * كان يُضغط عند الصفر فلا يحدث شيء ولا خبر، فيبدو
                       * معطوباً؛ والمعطَّل الظاهرُ أصدقُ من العاملِ الصامت.
                       */}
                      <IconButton
                        title={
                          team.score === 0
                            ? `${team.name} عند الصفر — لا نقطة تُخصم`
                            : `اخصم نقطة من ${team.name}`
                        }
                        size={8}
                        disabled={team.score === 0}
                        onClick={() => send('admin:adjustScore', { teamId: team.id, points: -1 })}
                      >
                        <MinusIcon size={14} strokeWidth={2.6} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {room.teams.length > 0 && (
              <CardsPanel
                teams={byJoin}
                cards={room.cards}
                onReset={() => {
                  send('admin:reopenCards');
                  flash('صُفّرت عدّادات البطاقات');
                }}
              />
            )}

            {feed.length > 0 && (
              <QuestionFeed feed={feed} onReport={(payload) => send('admin:report', payload)} />
            )}

            {/*
             * آخر جولة تبقى معروضة حتى بعد أن تبدأ التالية: المنظّم يُعلن
             * النتيجة وهو يدير الجولة الجديدة، فلا تُسحب من تحت يده.
             */}
            <Panel
              title={last ? `تفاصيل الجولة ${last.round}` : 'تفاصيل آخر جولة'}
              hint={last ? 'آخر جولة مكتملة' : undefined}
            >
              {last ? (
                <ResultBars awards={last.awards} />
              ) : (
                <p className="py-5 text-center text-sm text-muted">لم تُلعب أي جولة بعد</p>
              )}
            </Panel>
          </aside>
        </div>
      </div>

      <CountdownGate ms={room.countdownMs} on={room.status === 'countdown'} />
      {showHistory && <HistoryModal history={room.history} onClose={() => setShowHistory(false)} />}

      {/*
        تأكيدُ الإنهاء: يُقال ما يقع، لا «هل أنت متأكّد؟».
        فالسؤالُ المجرّد لا يُضيف علماً — والمنظّم يحتاج أن يعرف أن النقاط
        تبقى وأن الشاشات كلَّها ستتبدّل، لا أن يُسأل عن يقينه.
      */}
      {confirmEnd && (
        <Modal
          title="إنهاء المسابقة"
          icon={<TrophyIcon size={20} className="text-signal" />}
          onClose={() => setConfirmEnd(false)}
        >
          <div className="grid gap-4">
            <p className="text-[15px] leading-relaxed text-ink-2">
              تنتهي اللعبة الآن ويظهر الترتيب النهائي على شاشة العرض وعند اللاعبين جميعاً.
            </p>

            <ul className="grid gap-2 rounded-card px-4 py-3.5 text-[13.5px] leading-relaxed font-medium text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
              <li>
                الجولة الحالية تُغلق، ولا جولةَ بعدها —{' '}
                <b className="font-black text-ink-2">إلا ببدءٍ من جديد</b>.
              </li>
              <li>النقاط والسجلّ يبقيان كما هما في سجلّ المالك.</li>
              <li>الغرفة تبقى في السجلّ، ويمكن حذفها بعدها من لوحة المالك.</li>
            </ul>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                onClick={() => {
                  send('admin:finishGame');
                  setConfirmEnd(false);
                }}
              >
                <TrophyIcon size={16} />
                أنهِ واعرض الأوائل
              </Button>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showBanks && (
        <Modal title="بنوك الأسئلة ومستواها" onClose={() => setShowBanks(false)}>
          <div className="mb-4">
            <span className="mb-2 block text-sm font-bold tracking-[0.08em] text-muted">
              مستوى الأسئلة
            </span>
            <Segmented value={room.difficulty as Level} options={LEVELS} onPick={setLevel} />
          </div>

          <BankPicker
            banks={banks}
            chosen={room.bankIds}
            onToggle={toggleBank}
            onAll={() =>
              send('admin:setBanks', {
                bankIds:
                  room.bankIds.length === banks.length ? [banks[0].id] : banks.map((b) => b.id),
              })
            }
          />
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            يُبدَّل الخزّان والجولة جارية — وما أُخذ من أسئلةٍ لا يعود.
          </p>
        </Modal>
      )}
    </div>
  );
}

const REASONS = ['الإجابة خاطئة', 'السؤال غامض', 'مكرّر', 'صعب جداً', 'خطأ إملائي'];

/**
 * المستوى لوناً لا كلمة.
 *
 * ثلاثون صفاً مكتوبٌ على كلٍّ منها «متوسط» ثلاثون كلمةً تُقرأ ولا تُفيد،
 * بينما اللون يُمسح بنظرةٍ واحدة. والدلالة تحت القائمة لمن لم يعرفها بعد.
 */
const FEED_LEVELS: Record<number, { label: string; tint: string }> = {
  1: { label: 'سهل', tint: 'var(--color-safe)' },
  2: { label: 'متوسط', tint: 'var(--color-warn)' },
  3: { label: 'صعب', tint: 'var(--color-danger)' },
};

const levelOf = (n: number) => FEED_LEVELS[n] ?? FEED_LEVELS[2];

/**
 * سجلّ أسئلة الغرفة: يتراكم منذ أول جولة، الأحدث أعلى.
 *
 * ولا وضعان — «مباشر» و«بعد الجولة» — بل سجلٌّ واحد: السؤال يظهر فور
 * عرضه فتلمحه وأنت تدير الجولة، ويبقى بعدها فتراجعه على مهل. والمراجعة
 * بهذا لا تبدأ مهمّةً جديدة بعد الجولة، بل تُكمل ما مرّ أمامك.
 *
 * والصفّ سؤالٌ متمايز لا إجابةُ فريق: ثمانية فرق ترى السؤال نفسه، فثمانية
 * أسطر تُغرق القائمة بينما «أصابه اثنان من ثمانية» أدلّ على سؤالٍ معطوب.
 */
function QuestionFeed({
  feed,
  onReport,
}: {
  feed: FeedItem[];
  onReport: (payload: { questionId: string; reason: string; note: string }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const flagged = feed.filter((f) => f.reported).length;

  const send = (item: FeedItem, reason: string) => {
    onReport({ questionId: item.id, reason, note: note.trim() });
    setReporting(null);
    setNote('');
  };

  return (
    <Panel
      title="أسئلة الغرفة"
      hint={flagged ? `${feed.length} · ${flagged} مُبلَّغ` : `${feed.length} سؤالاً`}
    >
      {/* الصفّ لا يبدو قابلاً للضغط من نفسه: سطرٌ يقول ماذا يحدث إن ضُغط */}
      <p className="-mt-1.5 mb-1 text-[11.5px] font-medium text-faint">
        اضغط أيّ سؤال لترى خياراته وإجابته الصحيحة — ولتُبلّغ عنه.
      </p>

      {/* ارتفاعٌ مقيَّد وتمرير داخلي: القائمة تطول بعشر جولات فتدفع
          ما تحتها خارج الشاشة، والمنظّم يحتاج ما تحتها أثناء الجولة */}
      <div className="-mx-1 max-h-[21rem] overflow-y-auto px-1">
        <div className="grid">
          {feed.map((item) => {
            const answered = item.right + item.wrong;
            const isOpen = open === item.id;
            const level = levelOf(item.level);
            return (
              <div
                key={item.id}
                className={`border-b border-line-soft transition last:border-0 ${
                  item.reported ? 'bg-danger-2' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : item.id)}
                  title={`مستوى ${level.label}`}
                  className="flex w-full items-start gap-2.5 rounded-chip px-2 py-2.5 text-right transition hover:bg-surface-2"
                >
                  {/* نقطةٌ تتصدّر السؤال: تقول المستوى بلا أن تصبغ الصفّ كله،
                      فيبقى لونُ الصفّ للحالة — والمُبلَّغ عنه وحده يُطوَّق */}
                  <i
                    className="mt-[5px] size-2 shrink-0 rounded-full"
                    style={{ background: level.tint }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 text-[13px] leading-snug font-medium">
                    {item.q}
                  </span>
                  {/* النسبة بلونها: الكامل أخضر، والصفر أحمر، وما بينهما حبرٌ عاديّ */}
                  <span
                    className={`tnum shrink-0 pt-px text-[11.5px] font-bold ${
                      answered === 0
                        ? 'text-faint'
                        : item.right === 0
                          ? 'text-danger'
                          : item.right === answered
                            ? 'text-safe'
                            : 'text-ink-2'
                    }`}
                  >
                    {answered === 0 ? '—' : `${item.right}/${answered}`}
                  </span>
                  <ArrowIcon
                    size={13}
                    className={`mt-0.5 shrink-0 text-faint transition-transform duration-200 ${
                      isOpen ? 'rotate-90' : '-rotate-90'
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="px-2 pb-2">
                    {/* عمودان: أربعة خياراتٍ في سطرين أقصرُ من أربعة أسطر،
                        والبلوك ضيّق فطولُ القائمة يدفع ما تحتها */}
                    <div className="grid grid-cols-2 gap-1">
                      {item.options.map((option, i) => (
                        <div
                          key={i}
                          className={`rounded-[6px] px-2 py-1 text-[12px] leading-snug ${
                            i === item.answer
                              ? 'bg-safe-2 font-black text-safe'
                              : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]'
                          }`}
                        >
                          {option}
                        </div>
                      ))}
                    </div>

                    {item.reported ? (
                      <span className="mt-1 border-t border-line pt-1.5 text-[11px] font-black text-danger">
                        بُلِّغ عن هذا السؤال
                      </span>
                    ) : reporting === item.id ? (
                      /* الأسباب أولاً وقد امتدّت إلى آخر البلوك، والملاحظة
                         تحتها سطراً واحداً: هي اختياريةٌ فلا تتصدّر */
                      <div className="mt-1 grid gap-1.5 border-t border-line pt-2">
                        <div className="grid grid-cols-2 gap-1">
                          {REASONS.map((reason, i) => (
                            <button
                              key={reason}
                              type="button"
                              onClick={() => send(item, reason)}
                              className={`rounded-chip px-2 py-1.5 text-[11px] font-black text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_35%,transparent)] transition hover:bg-danger-2 ${
                                i === REASONS.length - 1 && REASONS.length % 2 ? 'col-span-2' : ''
                              }`}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                        <input
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="ملاحظة (اختيارية)"
                          maxLength={300}
                          className="w-full rounded-chip bg-surface px-2 py-1.5 text-[12px] shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
                        />
                        <MiniAction onClick={() => setReporting(null)}>تراجع</MiniAction>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReporting(item.id);
                          setNote('');
                        }}
                        className="mt-1 border-t border-line pt-1.5 text-right text-[11px] font-black text-danger transition hover:opacity-70"
                      >
                        بلّغ عن هذا السؤال
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2">
        {[3, 2, 1].map((n) => (
          <span key={n} className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <i
              className="size-2.5 rounded-[3px]"
              style={{ background: levelOf(n).tint }}
              aria-hidden="true"
            />
            {levelOf(n).label}
          </span>
        ))}
        <span className="ms-auto text-[11px] font-medium text-faint">التبليغ لا يُوقف السؤال</span>
      </div>
    </Panel>
  );
}

/** لوحة الجولة: فعلٌ واحد كبير، وإلى جانبه رقم الجولة وكم اكتمل منها */
function RoundPanel({
  room,
  banks,
  live,
  idle,
  onStart,
  onSend,
}: {
  room: RoomState;
  banks: Bank[];
  live: boolean;
  idle: boolean;
  onStart: () => void;
  onSend: (event: string, payload?: unknown) => void;
}) {
  const level = LEVELS.find((l) => l.id === room.difficulty)?.label ?? '—';
  const pool = banks.filter((b) => room.bankIds.includes(b.id)).reduce((n, b) => n + b.count, 0);
  const done = room.status === 'finished';
  const onRestart = () => onSend('admin:resetAll');

  return (
    <section className="tile p-3 sm:p-4">
      {/*
       * اللعبة المنتهية لا تُستأنف: بابُها الوحيد «بدء من جديد» بضغطٍ
       * مطوّل — يُصفّر النقاط والجولات ويردّ الحال إلى انتظارٍ، ثم يظهر
       * زرّ البدء فيُضغط عن قصد. وإحصاءُ الغرفة عند المالك لا يُصفَّر.
       */}
      {done ? (
        <HoldButton
          bare
          tone="action"
          label="بدء من جديد"
          hint="تُصفَّر نقاط اللاعبين وتعود الجولة إلى الأولى — وسجلّ الغرفة يبقى كما هو."
          onConfirm={onRestart}
        />
      ) : (
      /*
       * فعلا الجولة في صفٍّ واحد: ما يبدؤها وما يُعيدها.
       *
       * كانت الإعادةُ سطراً تحت زرّ البدء وبجانبه بلاطةُ عدّ. وهما فعلٌ
       * واحد في لحظةٍ واحدة — المنظّم ينظر إلى موضعٍ واحدٍ فيجد ما يفعل،
       * لا سطرين وبلاطةَ خبر.
       */
      <div className="flex items-stretch gap-2.5 sm:gap-3">
        {idle && (
          <Button
            size="lg"
            className="min-w-0 flex-1"
            onClick={onStart}
            disabled={room.teams.length === 0}
          >
            <PlayIcon size={16} />
            {room.status === 'lobby' ? 'ابدأ الجولة' : 'جولة جديدة'}
          </Button>
        )}
        {live && (
          <Button
            size="lg"
            variant="ghost"
            className="min-w-0 flex-1"
            onClick={() => onSend('admin:pause')}
          >
            <PauseIcon size={16} />
            إيقاف مؤقت
          </Button>
        )}
        {room.status === 'paused' && (
          <Button size="lg" className="min-w-0 flex-1" onClick={() => onSend('admin:resume')}>
            <PlayIcon size={16} />
            استئناف
          </Button>
        )}

        {/*
         * الإعادةُ تظهر دائماً ولا تعمل إلا والجولة موقوفة: عطبُ جهازٍ أو
         * شبكةٍ لا يُكتشف إلا والجولة تجري، فإن لم يكن الزرُّ معروفاً ضاعت
         * الجولة. وباهتةٌ معطَّلة لأن القرار يُتّخذ بعد أن تسكن القاعة.
         */}
        <Button
          size="lg"
          variant="ghost"
          className="min-w-0 flex-1"
          disabled={room.status !== 'paused'}
          title={
            room.status === 'paused'
              ? 'تعود العدّادات إلى أولها، ورقم الجولة ونقاطها كما هي — وتُردّ آثار البطاقات'
              : 'أوقف الجولة أولاً ثم أعِدها'
          }
          onClick={() => onSend('admin:restartRound')}
        >
          <RestartIcon size={15} />
          أعِد الجولة
        </Button>
      </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5 text-xs font-medium text-muted sm:mt-3 sm:pt-3">
        <span>
          المستوى <b className="font-black text-ink">{level}</b>
        </span>
        <span className="tnum">
          {room.bankIds.length} من {banks.length} بنكاً · {pool} سؤال
        </span>
      </div>

      {/*
       * الاختصار لا يُخمَّن: من لم يُخبَر به لن يجده — لكنه خبرٌ لمن له
       * لوحةُ مفاتيح. وعلى الجوال سطرٌ يشغل ولا يُفيد، فيُطوى دون sm.
       */}
      <p className="mt-1.5 hidden text-[11px] font-medium text-faint sm:block">
        <b className="font-black">مسافة</b> إيقاف واستئناف · <b className="font-black">Enter</b> بدء
        الجولة
      </p>
    </section>
  );
}

/* أيقونةُ كل بطاقة — أسماؤها تأتي من السيرفر، وهذه صورتُها وحدها */
const CARD_ICON: Record<CardId, typeof TimePlusIcon> = {
  time: TimePlusIcon,
  freeze: SnowflakeIcon,
  double: DoubleIcon,
};

/**
 * بطاقات اللاعبين: لكل لاعبٍ سطرٌ وفيه قرصٌ عن كل بطاقة يقول ما بقي له.
 *
 * المنظّم يُسأل في القاعة «هل بقيت لي مضاعفة؟» فلا يملك جواباً: المتجر
 * عند اللاعب وحده. فصار المتبقي معروضاً أمامه، والقرصُ الفارغ يبهت فلا
 * يُقرأ الصفر رقماً بين الأرقام.
 */
function CardsPanel({
  teams,
  cards,
  onReset,
}: {
  teams: PublicTeam[];
  cards: RoomState['cards'];
  onReset: () => void;
}) {
  const spent = teams.some((t) => cards.some((c) => (t.cardsLeft?.[c.id] ?? c.limit) < c.limit));

  return (
    <Panel title="بطاقات اللاعبين" hint="ما بقي لكل لاعب">
      <div className="grid">
        {teams.map((team) => (
          <div
            key={team.id}
            className="flex items-center gap-2 border-b border-line-soft py-2 last:border-0"
          >
            <b className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{team.name}</b>
            {/*
              القرصُ يقول اسمَ البطاقة لا رمزَها وحده.
              كان رمزاً ورقماً في قرصٍ بارتفاع ٢٤px، فيُسأل المنظّم «كم بقي
              له من المضاعفة؟» فيحتاج أن يمرّ بالفأرة ليقرأ التلميح — وهو
              واقفٌ في قاعة. فصار الاسم مكتوباً والعددُ إلى جانبه.
              والاسمُ يُخفى دون ٦٤٠px وحدها حيث لا يسع الصفَّ.
            */}
            <div className="flex shrink-0 items-center gap-1.5">
              {cards.map((card) => {
                const left = team.cardsLeft?.[card.id] ?? card.limit;
                const Glyph = CARD_ICON[card.id];
                return (
                  <span
                    key={card.id}
                    title={`${card.name} — بقيت ${left} من ${card.limit}`}
                    className={`flex h-8 items-center gap-1.5 rounded-chip px-2.5 text-[12px] font-bold ${
                      left === 0
                        ? 'text-faint opacity-55 shadow-[inset_0_0_0_1px_var(--color-line)]'
                        : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)]'
                    }`}
                  >
                    <Glyph size={14} />
                    {/*
                      الاسمُ يظهر على الجوّال أيضاً: كان ‎max-sm:hidden‎ فيعود
                      القرصُ رمزاً ورقماً حيث يُقرأ أكثر — ولوحةُ المنظّم
                      تُدار من هاتفٍ في القاعة قبل أن تُدار من حاسب.
                    */}
                    <span>{card.name}</span>
                    <b className="tnum font-black">{left}</b>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/*
       * التصفير يعيد كل البطاقات متاحةً للجميع — وهو زرٌّ هنا لا سطرٌ في
       * قائمة الخيارات: مكانه حيث يُقرأ أثرُه. ويبهت إن لم يُشترَ شيءٌ بعد،
       * فلا تصفيرَ لعدّادٍ لم يتحرّك.
       */}
      <Button
        variant="ghost"
        className="mt-2.5 w-full"
        disabled={!spent}
        title={spent ? 'تعود كل البطاقات متاحةً للجميع من جديد' : 'لم يشترِ أحدٌ بطاقةً بعد'}
        onClick={onReset}
      >
        <RefreshIcon size={15} />
        تصفير عدّادات البطاقات
      </Button>
    </Panel>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="tile px-3 py-3 sm:px-[18px] sm:py-4">
      <h3 className="mb-2.5 flex items-baseline justify-between gap-3 text-[13px] font-black sm:mb-3 sm:text-[14px]">
        {title}
        {hint && (
          <span className="tnum shrink-0 text-[11.5px] font-medium text-faint sm:text-[12px]">
            {hint}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** سطر رابط: اسمه ونسخه — ولا يُعرض الرابط نفسه فلا يزدحم العمود */
function LinkRow({
  icon,
  label,
  hint,
  onCopy,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onCopy: () => void;
}) {
  /*
   * النسخُ فعلٌ بلا أثرٍ ظاهر: الحافظة لا تُرى، فمن ضغط لا يدري أنُسخ أم
   * لا فيضغط ثانيةً وثالثة. فيُقال له في الزرّ نفسه — لا في ركنٍ بعيد.
   */
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      onClick={() => {
        onCopy();
        setDone(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1600);
      }}
      className={`flex w-full items-center gap-2 rounded-chip px-1.5 py-2.5 text-right transition sm:gap-2.5 sm:px-2 ${
        done ? 'bg-safe-2' : 'hover:bg-surface-2'
      }`}
    >
      <span className={`shrink-0 ${done ? 'text-safe-ink' : 'text-signal-ink'}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold sm:text-[13.5px]">
          {done ? 'نُسخ الرابط' : label}
        </span>
        {hint && !done && (
          <span className="block text-[11px] font-medium text-danger sm:text-[11.5px]">{hint}</span>
        )}
      </span>
      {done ? (
        <CheckIcon size={15} className="shrink-0 text-safe-ink" />
      ) : (
        <CopyIcon size={15} className="shrink-0 text-faint" />
      )}
    </button>
  );
}

/**
 * صفّ اللاعب — تخطيطان لا تنسيقان:
 *   على الحاسب سطرٌ واحد يمسح المنظّم فيه عشرة لاعبين بنظرة.
 *   وعلى الجوال بطاقةٌ من صفّين: الاسم والأرقام والأزرار، ثم المخطّط.
 * والاختيار في JS لا بـdisplay:none — فمخطّطٌ مخفيّ يبقى يستهلك إطاراته.
 */
function TeamRow({
  team,
  rank,
  running,
  wide,
  onAdjust,
  onRemove,
}: {
  team: PublicTeam;
  rank: number;
  running: boolean;
  wide: boolean;
  onAdjust: (seconds: number) => void;
  onRemove: () => void;
}) {
  const frozen = team.locked && !team.flatlined;
  const gilded = team.doubled && !team.flatlined && !frozen;
  const level = teamLevel(team.timeMs, team.flatlined);
  const skin = frozen ? 'frosted' : gilded ? 'gilded' : 'tile';

  const name = (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[15px] leading-tight font-black sm:text-[17px]">
        <span className="truncate">{team.name}</span>
        {frozen && <SnowflakeIcon size={14} className="shrink-0 text-frost" />}
        {team.doubled && !team.flatlined && (
          <span className="shrink-0 text-xs font-black text-gold">×٢</span>
        )}
        {!team.connected && <OfflineIcon size={13} className="shrink-0 text-faint" />}
      </div>
      <div className="tnum text-[10.5px] font-medium text-muted sm:text-[11px]">
        {/* المنتظِر لم يُسأل بعد، فـ«٠ من ٠ صحيحة» خبرٌ كاذبٌ عن مهارته */}
        {team.waiting ? (
          'ينتظر الجولة القادمة'
        ) : frozen && team.frozenBy ? (
          /* المنظّم يُعلن: «النسور جمّدوا الصقور» — فيحتاج الاسم أمامه */
          <span className="text-frost">جمّده {team.frozenBy}</span>
        ) : (
          `${team.correct} من ${team.answered} صحيحة`
        )}
      </div>
    </div>
  );

  const time = (
    <div className="leading-none">
      {/*
       * عدّادُ المنتظِر لا يُعرض رقماً: عدّادُه ممتلئٌ لأنه لم يبدأ، ورقمٌ
       * ممتلئٌ بين العدّادات النازلة يقول إنه المتصدّر وهو لم يلعب.
       */}
      <b
        className={`tnum text-xl font-black sm:text-2xl ${team.flatlined ? 'text-danger' : team.waiting ? 'text-faint' : 'ink-state'}`}
      >
        {team.waiting ? '—' : formatTime(team.timeMs)}
      </b>
      <span className="mt-0.5 block text-[10.5px] font-medium text-muted sm:mt-1 sm:text-[11px]">
        {team.waiting ? 'ينتظر' : team.flatlined ? 'توقف' : 'ثانية'}
      </span>
    </div>
  );

  const score = (
    <div className="leading-none">
      <RollingNumber value={team.score} className="tnum text-xl font-black text-signal sm:text-2xl" />
      <span className="mt-0.5 block text-[10.5px] font-medium text-muted sm:mt-1 sm:text-[11px]">
        نقطة
      </span>
    </div>
  );

  const buttons = (
    <div className="flex shrink-0 items-center gap-1.5">
      <IconButton title="أضف ٥ ثوانٍ" onClick={() => onAdjust(5)}>
        <PlusIcon size={14} strokeWidth={2.6} />
      </IconButton>
      <IconButton title="اخصم ٥ ثوانٍ" onClick={() => onAdjust(-5)}>
        <MinusIcon size={14} strokeWidth={2.6} />
      </IconButton>
      <HoldIconButton title={`اطرد ${team.name} — استمر بالضغط`} onConfirm={onRemove}>
        <CloseIcon size={14} strokeWidth={2.6} />
      </HoldIconButton>
    </div>
  );

  const lane = (
    <Lane
      timeMs={team.timeMs}
      running={running}
      flatlined={team.flatlined}
      size="sm"
      className="relative h-[30px] sm:h-[38px]"
    />
  );

  if (wide) {
    return (
      <div
        data-row={team.id}
        style={stateStyle(level, team.timeMs)}
        className={`relative grid h-[74px] shrink-0 grid-cols-[30px_minmax(120px,210px)_104px_88px_minmax(0,1fr)_auto] items-center gap-3.5 overflow-hidden px-3.5 ${skin}`}
      >
        <span className="bg-state absolute inset-y-0 start-0 z-[1] w-1" aria-hidden="true" />
        <div className="tnum relative text-center text-[17px] font-light text-faint">{rank}</div>
        <div className="relative">{name}</div>
        <div className="relative">{time}</div>
        <div className="relative">{score}</div>
        {lane}
        <div className="relative">{buttons}</div>
      </div>
    );
  }

  return (
    <div
      data-row={team.id}
      style={stateStyle(level, team.timeMs)}
      className={`relative overflow-hidden p-2.5 ${skin}`}
    >
      <span className="bg-state absolute inset-y-0 start-0 z-[1] w-1" aria-hidden="true" />
      <div className="relative flex items-center gap-2 ps-1.5">
        <span className="tnum w-3.5 shrink-0 text-center text-[13px] font-light text-faint">
          {rank}
        </span>
        <div className="min-w-0 flex-1">{name}</div>
        <div className="shrink-0 text-center">{time}</div>
        <div className="shrink-0 text-center">{score}</div>
      </div>
      <div className="relative mt-2 flex items-center gap-2 ps-1.5">
        <div className="min-w-0 flex-1">{lane}</div>
        {buttons}
      </div>
    </div>
  );
}

const HOLD_MS = 900;

/** طرد لاعب لا يُنفَّذ بنقرة — يحتاج ضغطاً مستمراً يملأ الزر */
function HoldIconButton({
  title,
  onConfirm,
  children,
}: {
  title: string;
  onConfirm: () => void;
  children: ReactNode;
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
    <button
      title={title}
      aria-label={title}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      style={{ '--held': held } as CSSProperties}
      className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-chip text-danger shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_40%,transparent)] transition select-none hover:bg-danger-2"
    >
      <span className="hold-fill" aria-hidden="true" />
      <span className="relative">{children}</span>
    </button>
  );
}
