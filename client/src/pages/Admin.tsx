import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, onWake, socket, useFreshBuild, watchSession } from '../lib/socket';
import { clearAdminSession, loadAdminSession, saveAdminSession } from '../lib/session';
import { projectRoom, roomTicking, useCountdown, useProjected } from '../lib/clock';
import type { Bank, FeedItem, PublicTeam, RoomState } from '../lib/types';
import {
  Button,
  CHIP_BTN,
  ErrorNote,
  HomeLink,
  ConfirmButton,
  IconButton,
  Menu,
  MiniAction,
  PulseMark,
  formatTime,
  stateStyle,
  teamLevel,
  useTheme,
  useWide,
  type MenuAction,
  Wordmark,
  Flag,
  toast,
} from '../components/ui';
import {
  ArrowIcon,
  CardsIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  MinusIcon,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  RestartIcon,
  ScreenIcon,
  FlatlineIcon,
  HourglassIcon,
  SnowflakeIcon,
  SparkIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/icons';
import { BankArt, LevelArt } from '../components/art';
import { CARD_LOOK } from '../lib/cards';
import { EffectBadges } from '../components/effects';
import { LivesBar, livesFor } from '../components/lives';
import { Tour, tourSeen, type TourStep } from '../components/Tour';
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
import { countOf } from '../lib/arabic';

const SESSION_KEY = 'nabda:admin';

/**
 * بطاقةٌ مصوّرة تُنتقى — للبنوك والمراحل.
 *
 * كانت أقراصاً نصّيةً بجانب كلٍّ منها عددُ أسئلته، والمنظّم لا يختار
 * بالعدد: يختار «الفقه» أو «العلوم» بما يناسب جمهوره. فصارت لوحاتٍ
 * تُعرف بالنظر — كفئات «سين جيم» — والاسمُ على شريطٍ في ذيلها يتّقد
 * سماوياً إذا اختيرت، وتخبو لوحةُ ما لم يُختر فيتقدّم المختار.
 */
function ArtTile({
  on,
  label,
  art,
  onClick,
  compact,
}: {
  on: boolean;
  label: string;
  art: ReactNode;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`art-tile tap ${on ? 'is-on' : ''} ${compact ? 'is-compact' : ''}`}
    >
      <span className="art-stage">{art}</span>
      <span className="art-label">{label}</span>
      <span className="art-check" aria-hidden="true">
        <CheckIcon size={12} strokeWidth={4} />
      </span>
    </button>
  );
}

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
  return (
    <>
      <div className="mb-3 flex justify-end">
        <MiniAction onClick={onAll}>
          {chosen.length === banks.length ? 'إلغاء الكل' : 'تحديد الكل'}
        </MiniAction>
      </div>
      <div className="art-grid">
        {banks.map((bank) => (
          <ArtTile
            key={bank.id}
            on={chosen.includes(bank.id)}
            label={bank.name}
            art={<BankArt id={bank.id} />}
            onClick={() => onToggle(bank.id)}
          />
        ))}
      </div>
    </>
  );
}

function LevelPicker({
  value,
  onPick,
  large,
}: {
  value: Level;
  onPick: (level: Level) => void;
  large?: boolean;
}) {
  return (
    /* الكبيرةُ بمقاس لوحات البنوك نفسه: أربعٌ في صفٍّ بعرض الشاشة كانت تبتلع الصفحة */
    <div className={large ? 'art-grid is-large is-levels' : 'grid grid-cols-4 gap-2 sm:gap-2.5'}>
      {LEVELS.map((level) => (
        <ArtTile
          key={level.id}
          compact={!large}
          on={level.id === value}
          label={level.label}
          art={<LevelArt id={level.id} />}
          onClick={() => onPick(level.id)}
        />
      ))}
    </div>
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
    /*
     * المفتاح يُرسل مع الاتصال نفسه (lib/socket.ts) — من الرابط أولاً ثم
     * من الجلسة المحفوظة — والسيرفر يردّ: عادت لوحتك، أو المفتاح لا يصلح.
     * ولا تُمحى الجلسة إلا بالثاني: كانت تُمحى إذا أبطأ الردّ، فيجد
     * المنظّم نفسه أمام «غرفة جديدة» وغرفتُه تجري.
     */
    const stop = watchSession('admin', {
      resumed: (payload) => {
        saveAdminSession({
          code: payload.code as string,
          adminKey: params.get('key') ?? loadAdminSession()?.adminKey ?? '',
        });
        setRoom(payload.state as RoomState);
      },
      invalid: () => {
        if (!params.get('code')) clearAdminSession();
      },
    });
    const offWake = onWake(async () => {
      const res = await ask<{ state: RoomState }>('session:sync');
      if (res.ok) setRoom(res.state);
    });

    const onConnect = () => setLive(true);
    const onDrop = () => setLive(false);
    setLive(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDrop);
    socket.on('admin:feed', setFeed);
    return () => {
      stop();
      offWake();
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
    saveAdminSession({ code: res.code, adminKey: res.adminKey });
    setRoom(res.state);
  };

  /* الوقتُ يُعدّ هنا بين رسائل السيرفر (lib/clock.ts) */
  const shown = useProjected(room, projectRoom, roomTicking);
  useFreshBuild(!room || !roomTicking(room));

  if (!room) {
    const toggle = (id: string) =>
      setBankIds((current) =>
        current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
      );

    return (
      /*
       * صفحةٌ كاملة لا بابٌ ضيّق.
       *
       * كانت نموذجاً في بطاقةٍ عرضُها ٤٢ريماً وسط فراغٍ واسع، فتصغر
       * لوحاتُ البنوك حتى لا تُرى. والإنشاءُ قرارٌ بصريّ — أيُّ الفئات
       * يناسب جمهوري؟ — فتأخذ اللوحاتُ عرضَ الشاشة، والاسمُ عنوانُ الصفحة،
       * وزرُّ الإنشاء مثبّتٌ في ذيلها يُرى من أيّ موضعٍ فيها.
       */
      <div className="create">
        <header className="create-head">
          <Wordmark className="text-4xl sm:text-5xl" />
          <span className="create-kicker">غرفة جديدة</span>
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="اسم الغرفة"
            aria-label="اسم الغرفة"
            maxLength={40}
            autoFocus
            className="create-name"
          />
        </header>

        <section className="create-section">
          <div className="create-section-head">
            <h2>بنوك الأسئلة</h2>
            <MiniAction
              onClick={() =>
                setBankIds(bankIds.length === banks.length ? [banks[0].id] : banks.map((b) => b.id))
              }
            >
              {bankIds.length === banks.length ? 'إلغاء الكل' : 'تحديد الكل'}
            </MiniAction>
          </div>
          <div className="art-grid is-large">
            {banks.map((bank) => (
              <ArtTile
                key={bank.id}
                on={bankIds.includes(bank.id)}
                label={bank.name}
                art={<BankArt id={bank.id} />}
                onClick={() => toggle(bank.id)}
              />
            ))}
          </div>
        </section>

        <section className="create-section">
          <div className="create-section-head">
            <h2>المرحلة</h2>
          </div>
          <LevelPicker value={difficulty} onPick={setDifficulty} large />
        </section>

        <footer className="create-dock">
          <ErrorNote>{error}</ErrorNote>
          <Button
            size="lg"
            className="w-full"
            onClick={createRoom}
            disabled={bankIds.length === 0 || !roomName.trim()}
          >
            أنشئ الغرفة
          </Button>
          <HomeLink />
        </footer>
      </div>
    );
  }

  return <Console room={shown ?? room} banks={banks} feed={feed} live={live} />;
}

/* «من ١١ بنكاً» و«من ١٠ بنوك» — يتبع عددَ البنوك أيّاً صار */
const BANKS = { one: 'بنك واحد', two: 'بنكين', few: 'بنوك', many: 'بنكاً' };

/** مستويات المسابقة كما يراها المنظّم — والنسب في السيرفر */
type Level = 'primary' | 'middle' | 'secondary' | 'university';

const LEVELS: { id: Level; label: string }[] = [
  {
    id: 'primary',
    label: 'ابتدائي',
  },
  {
    id: 'middle',
    label: 'متوسط',
  },
  {
    id: 'secondary',
    label: 'ثانوي',
  },
  {
    id: 'university',
    label: 'جامعي',
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
  const [showCards, setShowCards] = useState(false);
  /* نافذةُ تأكيد الإنهاء — آخرُ فعلٍ في الجلسة، فيُقرأ قبل أن يقع */
  const [confirmEnd, setConfirmEnd] = useState(false);
  /* أوّلُ مرّةٍ يفتح فيها المنظّم لوحته: جولةٌ تعريفية قصيرة فوقها */
  const [touring, setTouring] = useState(() => !tourSeen('console'));

  const key = (JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as Partial<Session>).adminKey;
  const playUrl = `${location.origin}/play?code=${room.code}`;
  const displayUrl = `${location.origin}/display?code=${room.code}`;
  const adminUrl = `${location.origin}/admin?code=${room.code}&key=${key ?? ''}`;

  const idle = room.status === 'lobby' || room.status === 'ended' || room.status === 'finished';
  const live = room.status === 'running';
  const over = room.status === 'finished' && room.standings;
  const last = room.history[room.history.length - 1] ?? null;
  const wide = useWide();
  useRoundEndToast(room);

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

  /* الأفعال الخطرة لا تظهر على الشاشة: مكانها القائمة، وتحتاج ضغطاً مستمراً */
  const actions: MenuAction[] = [
    { label: 'سجل الجولات', icon: <HistoryIcon size={17} />, onClick: () => setShowHistory(true) },
    {
      label: room.displayBlurred ? 'إظهار الترتيب' : 'تغبيش شاشة العرض',
      icon: room.displayBlurred ? <EyeIcon size={17} /> : <EyeOffIcon size={17} />,
      onClick: () => send('admin:toggleBlur'),
    },
    /* ما بقي لكل لاعبٍ من بطاقاته: يُسأل عنه أحياناً، فمكانُه القائمة لا العمود */
    { label: 'بطاقات اللاعبين', icon: <SparkIcon size={17} />, onClick: () => setShowCards(true) },
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
                انقطع الاتصال، يُعاد الوصل
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
              <span data-tour="finish" className="flex">
                <Button
                  variant="danger"
                  size="sm"
                  className={CHIP_BTN}
                  onClick={() => setConfirmEnd(true)}
                >
                  <TrophyIcon size={15} />
                  إنهاء
                </Button>
              </span>
            )}

            <span data-tour="menu" className="flex">
              <Menu actions={actions} />
            </span>
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
              onBanks={() => setShowBanks(true)}
            />
          </div>

          <main data-tour="teams" className="grid content-start gap-2.5">
            {over ? (
              <>
                <section className="tile px-4 py-6 sm:px-6">
                  <Standings compact standings={room.standings!} />
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
                <LivesPanel room={room} />
                <div className="flex items-baseline justify-between gap-3">
                  <b className="text-[15px] font-black sm:text-[16px]">
                    اللاعبون <span className="font-bold text-faint">({room.teams.length})</span>
                  </b>
                  <span className="tnum text-[12px] font-medium text-faint sm:text-[12.5px]">
                    {countOf(room.teams.filter((t) => !t.flatlined).length, {
                      one: 'نبضة حيّة واحدة',
                      two: 'نبضتان حيّتان',
                      few: 'نبضات حيّة',
                      many: 'نبضة حيّة',
                    })}
                  </span>
                </div>

                {room.status === 'paused' && (
                  <div className="flex items-center justify-center gap-2.5 rounded-chip bg-signal-2 px-3 py-2 text-center text-sm font-black text-signal">
                    <PauseIcon size={15} />
                    الجولة موقوفة
                  </div>
                )}

                {room.teams.length === 0 ? (
                  <div className="tile flex flex-col items-center gap-2.5 px-3 py-7 text-center sm:gap-3 sm:px-4 sm:py-10">
                    <PulseMark size={26} className="text-faint" />
                    <p className="text-muted">لم ينضم أحد بعد</p>
                  </div>
                ) : (
                  <div ref={board} className="grid content-start gap-2.5">
                    {ranked.map((team, i) => (
                      <TeamRow
                        key={team.id}
                        team={team}
                        rank={i + 1}
                        running={live}
                        inRound={live || room.status === 'countdown' || room.status === 'paused'}
                        wide={wide}
                        onAdjust={(seconds) =>
                          send('admin:adjustTime', { teamId: team.id, seconds })
                        }
                        onRemove={() => send('admin:removeTeam', { teamId: team.id })}
                      />
                    ))}
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
                onBanks={() => setShowBanks(true)}
              />
            </div>

            <Panel title="روابط الغرفة" tour="links">
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
              <StandingsPanel
                teams={room.teams}
                last={last}
                rounds={room.history.length}
                onAdjust={(teamId, points) => send('admin:adjustScore', { teamId, points })}
              />
            )}

            {feed.length > 0 && (
              <QuestionFeed feed={feed} onReport={(payload) => send('admin:report', payload)} />
            )}

            {/*
             * آخر جولة تبقى معروضة حتى بعد أن تبدأ التالية: المنظّم يُعلن
             * النتيجة وهو يدير الجولة الجديدة، فلا تُسحب من تحت يده.
             */}
            <Panel title="تفاصيل آخر جولة">
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
      {touring && <Tour name="console" steps={CONSOLE_TOUR} onDone={() => setTouring(false)} />}
      {showHistory && <HistoryModal history={room.history} onClose={() => setShowHistory(false)} />}

      {/*
        تأكيدُ الإنهاء: سطرٌ واحدٌ يقول ما يقع، لا «هل أنت متأكّد؟».
        فالسؤالُ المجرّد لا يُضيف علماً، والفقرتان كانتا تقولان الشيء نفسه
        مرّتين — والزرُّ تحتهما يقول ثالثةً «أنهِ واعرض الأوائل».
      */}
      {confirmEnd && (
        <FinishDialog
          room={room}
          onConfirm={() => {
            send('admin:finishGame');
            setConfirmEnd(false);
          }}
          onClose={() => setConfirmEnd(false)}
        />
      )}

      {showCards && (
        <Modal title="بطاقات اللاعبين" onClose={() => setShowCards(false)}>
          <CardsPanel
            teams={byJoin}
            cards={room.cards}
            onReset={() => {
              send('admin:reopenCards');
              flash('صُفّرت عدّادات البطاقات');
            }}
          />
        </Modal>
      )}

      {showBanks && (
        <BanksDialog
          banks={banks}
          bankIds={room.bankIds}
          difficulty={room.difficulty as Level}
          onApply={(bankIds, difficulty) => {
            send('admin:setBanks', { bankIds, difficulty });
            setShowBanks(false);
            toast('اعتُمدت البنوك', {
              tone: 'safe',
              icon: <CheckIcon size={19} />,
              note: `${bankIds.length} من ${countOf(banks.length, BANKS)} · ${LEVELS.find((l) => l.id === difficulty)?.label}`,
            });
          }}
          onClose={() => setShowBanks(false)}
        />
      )}
    </div>
  );
}

/**
 * نافذةُ البنوك والمستوى: مسودّةٌ لا تقع حتى تُعتمد.
 *
 * كان كلُّ نقرٍ على بنكٍ يُرسَل فوراً، فلا يعرف المنظّم أثبت التعديلُ أم لا،
 * ولا كيف يخرج. فصار ما يختاره هنا مسودّةً تُرى، وزرُّ «اعتماد» يُرسلها كلّها
 * ويُغلق النافذة بتوستٍ يقول ما اعتُمد — و«إلغاء» يخرج بلا تغيير.
 */
function BanksDialog({
  banks,
  bankIds,
  difficulty,
  onApply,
  onClose,
}: {
  banks: Bank[];
  bankIds: string[];
  difficulty: Level;
  onApply: (bankIds: string[], difficulty: Level) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState(bankIds);
  const [level, setLevel] = useState(difficulty);
  const changed =
    level !== difficulty ||
    chosen.length !== bankIds.length ||
    chosen.some((id) => !bankIds.includes(id));

  return (
    <Modal title="بنوك الأسئلة ومستواها" onClose={onClose}>
      <div className="mb-4">
        <span className="mb-2 block text-sm font-bold tracking-[0.08em] text-muted">المرحلة</span>
        <LevelPicker value={level} onPick={setLevel} />
      </div>

      <BankPicker
        banks={banks}
        chosen={chosen}
        onToggle={(id) =>
          setChosen((now) =>
            now.includes(id) ? (now.length > 1 ? now.filter((x) => x !== id) : now) : [...now, id],
          )
        }
        onAll={() =>
          setChosen(chosen.length === banks.length ? [banks[0].id] : banks.map((b) => b.id))
        }
      />

      {/* زرّا النافذة ثابتان في أسفلها: الاعتمادُ يُرسل ويُغلق، والإلغاءُ يُغلق فقط */}
      <div className="sticky bottom-0 -mx-1 mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 bg-surface px-1 pt-3 pb-1">
        <Button size="lg" onClick={() => onApply(chosen, level)}>
          <CheckIcon size={16} strokeWidth={3} />
          {changed ? 'اعتماد' : 'اعتماد بلا تغيير'}
        </Button>
        <Button size="lg" variant="ghost" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
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

  const send = (item: FeedItem, reason: string) => {
    onReport({ questionId: item.id, reason, note: note.trim() });
    setReporting(null);
    setNote('');
  };

  return (
    <Panel title="أسئلة الغرفة">
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
                    {item.flag && (
                      <Flag
                        code={item.flag}
                        className="ms-1.5 inline-block h-[14px] align-[-2px]"
                      />
                    )}
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
                    {answered === 0 ? '-' : `${item.right}/${answered}`}
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
      </div>
    </Panel>
  );
}

/** لوحة الجولة: فعلٌ واحد كبير، وإلى جانبه رقم الجولة وكم اكتمل منها */
/** ما بقي من وقت الشراء — يُعدّ محلياً من آخر قيمةٍ أرسلها السيرفر */
function BreakLeft({ ms }: { ms: number }) {
  const left = useCountdown(ms);
  return (
    <span
      className={`tnum flex items-center gap-1.5 font-bold ${left > 0 ? 'text-warn' : 'text-muted'}`}
    >
      <HourglassIcon size={13} />
      {left > 0 ? `وقت الشراء ${Math.ceil(left / 1000)} ث` : 'انتهى وقت الشراء'}
    </span>
  );
}

/*
 * خطواتُ جولة المنظّم — عنوانٌ وسطر، بترتيب ما يفعله في المسابقة: يجمع
 * اللاعبين، ويبدأ، ويراقب، ويعدّل، ثم يُنهي. وما لم يُرسم بعد (الترتيب قبل
 * انضمام أحد) يُطوى.
 */
const CONSOLE_TOUR: TourStep[] = [
  {
    target: 'links',
    title: 'روابط الغرفة',
    body: 'انسخ رابط شاشة العرض للبروجكتر، ورابط اللاعبين إن لم يمسحوا الرمز.',
  },
  {
    target: 'round',
    title: 'لوحة الجولة',
    body: 'منها تبدأ كل جولة. بين الجولات تعدّل البنوك، وأثناءها توقف أو تعيد بضغطتين.',
  },
  {
    target: 'lives',
    title: 'نبضات الجولة',
    body: 'تنتهي الجولة حين يتوقف ثُمن اللاعبين. كل مربّعٍ نبضة، ينكسر باسم من توقف.',
  },
  {
    target: 'teams',
    title: 'نبض اللاعبين',
    body: 'وقت كل لاعب لحظةً بلحظة: ± تعدّل وقته خمس ثوانٍ، والطرد بضغطتين.',
  },
  {
    target: 'standings',
    title: 'ترتيب الفوز',
    body: 'يتحدّث بعد كل جولة. ومنه تزيد نقطة أو تنقصها لمن تشاء.',
  },
  {
    target: 'menu',
    title: 'الخيارات',
    body: 'سجل الجولات، وإخفاء الترتيب عن شاشة العرض، وبطاقات كل لاعب.',
  },
  { target: 'finish', title: 'إنهاء المسابقة', body: 'حين تكتفي: يُعلَن الأوائل على كل الشاشات.' },
];

/**
 * نبضاتُ الجولة عند المنظّم: كم لاعباً يسكن فتنتهي الجولة، ومن كسر كلَّ
 * نبضةٍ باسمه — فيُعلن للقاعة «بقيت نبضتان» وهو يرى. وقبل الجولة يُرى
 * العددُ بحسب من انضمّ الآن. ومن كانوا ثمانيةً فأقلّ فالقاعدةُ كما كانت:
 * أوّلُ من يسكن يُنهيها، فلا لوح.
 */
function LivesPanel({ room }: { room: RoomState }) {
  const inRound =
    room.status === 'countdown' || room.status === 'running' || room.status === 'paused';
  const lives =
    inRound || room.status === 'ended' ? (room.lives ?? 1) : livesFor(room.teams.length);
  if (lives <= 1) return null;
  const fallen = inRound || room.status === 'ended' ? (room.fallen ?? []) : [];
  return (
    <section
      data-tour="lives"
      className="tile flex flex-wrap items-center gap-x-4 gap-y-2.5 px-3.5 py-3"
      style={{
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-safe) 25%, var(--color-line))',
      }}
    >
      <b className="text-[14px] font-black">نبضات الجولة</b>
      <LivesBar lives={lives} fallen={fallen} size="md" names className="mr-auto" />
    </section>
  );
}

/**
 * نافذةُ الإنهاء: لحظةُ ختامٍ لا سؤالُ تأكيد.
 *
 * كأسٌ يتوهّج، ثم منصّةُ الأوائل كما ستُعلَن — الثاني والأول والثالث بأطوالٍ
 * ذهبيةٍ وفضيةٍ وبرونزية — فيرى المنظّم ما سيراه الجميع قبل أن يُعلنه. وزرُّ
 * الإعلان بضغطتين: ختامُ المسابقة لا يقع بلمسةٍ عابرة. وإن كانت
 * جولةٌ قائمة قيل إنها لن تُحتسب.
 */
function FinishDialog({
  room,
  onConfirm,
  onClose,
}: {
  room: RoomState;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const top = [...room.teams].sort((a, b) => b.score - a.score).slice(0, 3);
  /* المنصّة: الثاني يميناً والأول في الوسط والثالث يساراً */
  const podium = [top[1], top[0], top[2]];
  const medal = ['#c3ccd6', 'var(--color-gold)', '#d08a52'];
  const height = ['h-16', 'h-24', 'h-12'];
  const place = [2, 1, 3];
  const midRound =
    room.status === 'running' || room.status === 'paused' || room.status === 'countdown';

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="veil-in absolute inset-0 bg-ground/85 backdrop-blur-[3px]"
      />
      <div className="finish-card rise-in relative w-full max-w-[440px] overflow-hidden rounded-[28px] px-6 pt-7 pb-5 text-center">
        <span className="finish-glow" aria-hidden="true" />
        <span className="relative mx-auto flex size-[72px] items-center justify-center rounded-full bg-gold/15 text-gold shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-gold)_45%,transparent),0_0_40px_-6px_var(--color-gold)]">
          <TrophyIcon size={34} />
        </span>
        <h2 className="relative mt-4 text-2xl font-black">ختام المسابقة</h2>

        {top.length > 0 && (
          <div
            className="relative mt-6 grid grid-cols-3 items-end gap-2.5"
            aria-label="الأوائل حتى الآن"
          >
            {podium.map((team, i) =>
              team ? (
                <div key={team.id} className="flex min-w-0 flex-col items-center gap-1.5">
                  <b className="w-full truncate text-[15px] font-black">{team.name}</b>
                  <span className="tnum text-[13px] font-black" style={{ color: medal[i] }}>
                    {team.score}
                  </span>
                  <span
                    className={`flex w-full items-start justify-center rounded-t-[14px] pt-1.5 ${height[i]}`}
                    style={{
                      background: `linear-gradient(180deg, color-mix(in srgb, ${medal[i]} 38%, transparent), color-mix(in srgb, ${medal[i]} 8%, transparent))`,
                      boxShadow: `inset 0 1.5px 0 ${medal[i]}`,
                    }}
                  >
                    <span className="tnum text-xl font-black" style={{ color: medal[i] }}>
                      {place[i]}
                    </span>
                  </span>
                </div>
              ) : (
                <span key={i} />
              ),
            )}
          </div>
        )}

        {midRound && (
          <p className="relative mt-4 rounded-chip bg-warn/12 px-3 py-2 text-[13px] font-bold text-warn">
            الجولة الجارية لن تُحتسب
          </p>
        )}

        <div className="relative mt-5 grid gap-2">
          <ConfirmButton
            bare
            tone="action"
            label="أعلن الأوائل"
            glyph={
              <>
                <TrophyIcon size={17} />
                أعلن الأوائل
              </>
            }
            onConfirm={onConfirm}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-chip py-2.5 text-[14px] font-bold text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            ليس الآن
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * توستٌ للمنظّم حين تنتهي الجولة: «انتهت الجولة ٣ · توقف نبض فلان».
 *
 * المنظّم ينظر إلى القاعة لا إلى الشاشة، والصفوفُ تنزلق فلا يُعرف منها
 * من أنهى الجولة. فيُقال له في أعلى اللوحة ليُعلنه. ومن سكن منقطعاً لم
 * يُنهِ الجولة — فلا يُسمّى.
 */
function useRoundEndToast(room: RoomState) {
  const was = useRef(room.status);
  useEffect(() => {
    const before = was.current;
    was.current = room.status;
    if (before !== 'running' || room.status !== 'ended') return;
    const names = room.teams
      .filter((t) => t.flatlined && !t.dropped && !t.waiting)
      .map((t) => t.name);
    toast(`انتهت الجولة ${room.round}`, {
      tone: 'danger',
      icon: <FlatlineIcon size={19} />,
      note: names.length ? `توقف نبض ${names.join(' و')}` : undefined,
    });
  }, [room.status, room.round, room.teams]);
}

function RoundPanel({
  room,
  banks,
  live,
  idle,
  onStart,
  onSend,
  onBanks,
}: {
  room: RoomState;
  banks: Bank[];
  live: boolean;
  idle: boolean;
  onStart: () => void;
  onSend: (event: string, payload?: unknown) => void;
  /** يفتح نافذة البنوك والمستوى — بين الجولات */
  onBanks: () => void;
}) {
  const done = room.status === 'finished';
  const onRestart = () => onSend('admin:resetAll');

  return (
    <section data-tour="round" className="tile p-3 sm:p-4">
      {/*
       * اللعبة المنتهية لا تُستأنف: بابُها الوحيد «بدء من جديد» بضغطٍ
       * مطوّل — يُصفّر النقاط والجولات ويردّ الحال إلى انتظارٍ، ثم يظهر
       * زرّ البدء فيُضغط عن قصد. وإحصاءُ الغرفة عند المالك لا يُصفَّر.
       */}
      {done ? (
        <ConfirmButton bare tone="action" label="بدء من جديد" onConfirm={onRestart} />
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
           * بين الجولات: تعديلُ البنوك والمستوى — هو ما يُغيَّر في الاستراحة.
           * وفي الجولة: إعادتُها بضغطتين. كانت الإعادةُ معطّلةً إلا والجولة
           * موقوفة، فتبدو للمنظّم زرّاً لا يعمل؛ فصار الزرُّ يوقفها ثم يعيدها
           * بنفسه — والضغطةُ الثانية تحرس جولةً تُمحى بضغطةٍ خاطئة.
           */}
          {idle ? (
            <Button size="lg" variant="ghost" className="min-w-0 flex-1" onClick={onBanks}>
              <CardsIcon size={15} />
              تعديل البنوك
            </Button>
          ) : (
            <ConfirmButton
              bare
              tone="ghost"
              className="min-w-0 flex-1"
              label="أعِد الجولة"
              glyph={
                <>
                  <RestartIcon size={15} />
                  أعِد الجولة
                </>
              }
              onConfirm={() => {
                if (room.status === 'running') onSend('admin:pause');
                onSend('admin:restartRound');
              }}
            />
          )}
        </div>
      )}

      {/*
        عددُ البنوك وحده في القاع.
        وكان معه المستوى وعددُ أسئلة المجموعة: المستوى مكتوبٌ في مكانٍ آخر
        من اللوحة، وعددُ الأسئلة رقمٌ لا يُبنى عليه قرار — فذهبا.
      */}
      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-xs font-medium text-muted sm:mt-3 sm:pt-3">
        <span className="tnum">
          {room.bankIds.length} من {countOf(banks.length, BANKS)}
        </span>
        {/* المنظّم يرى ما يراه اللاعبون: كم بقي من وقت الشراء قبل أن يُغلق المتجر */}
        {room.status === 'ended' && <BreakLeft ms={room.breakMs ?? 0} />}
      </div>

      {/*
       * الاختصار لا يُخمَّن: من لم يُخبَر به لن يجده — لكنه خبرٌ لمن له
       * لوحةُ مفاتيح. وعلى الجوال سطرٌ يشغل ولا يُفيد، فيُطوى دون sm.
       */}
    </section>
  );
}

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
    <>
      <div className="grid">
        {teams.map((team) => (
          <div key={team.id} className="grid gap-2 border-b border-line-soft py-2.5 last:border-0">
            <b className="truncate text-[13.5px] font-bold">{team.name}</b>
            <div className="grid grid-cols-4 gap-1.5">
              {cards.map((card) => {
                const left = team.cardsLeft?.[card.id] ?? card.limit;
                const look = CARD_LOOK[card.id];
                return (
                  <span
                    key={card.id}
                    title={`${card.name}: بقيت ${left} من ${card.limit}`}
                    aria-label={`${card.name} ${left}`}
                    className={`flex h-9 items-center justify-center gap-1.5 rounded-chip text-[13px] font-black ${
                      left === 0
                        ? 'text-faint opacity-45 shadow-[inset_0_0_0_1px_var(--color-line)]'
                        : 'text-ink shadow-[inset_0_0_0_1px_var(--color-line-2)]'
                    }`}
                  >
                    <look.Icon size={16} className={left === 0 ? '' : look.ink} />
                    <b className="tnum">{left}</b>
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
      <Button variant="ghost" className="mt-2.5 w-full" disabled={!spent} onClick={onReset}>
        <RefreshIcon size={15} />
        تصفير عدّادات البطاقات
      </Button>
    </>
  );
}

/**
 * ترتيبُ الفوز وتعديلُه في لوحٍ واحد: من الأول إلى الأخير بنقاط الفوز،
 * وما كسبه كلٌّ في آخر جولة، وشراراته، وزرّا الزيادة والخصم.
 *
 * والترتيبُ لا يتحدّث إلا بنهاية الجولة: نقطةٌ يضيفها المنظّم تزيد الرقم ولا
 * تحرّك الصفّ ولا مركزه — وإلا قفز الصفُّ من تحت إصبعه فأضاف الثانية إلى
 * غير صاحبها. ويُعاد الفرزُ كذلك إذا دخل لاعبٌ أو خرج.
 */
function StandingsPanel({
  teams,
  last,
  rounds,
  onAdjust,
}: {
  teams: PublicTeam[];
  last: RoomState['result'] | null;
  /** عددُ الجولات المنتهية — به وحده (ومع تبدّل اللاعبين) يُعاد الفرز */
  rounds: number;
  onAdjust: (teamId: string, points: number) => void;
}) {
  /* المعرّفاتُ مفروزةً: الحالُ تصل مرتّبةً بالنقاط، فترتيبُها يتبدّل بكل نقطة */
  const roster = teams
    .map((t) => t.id)
    .sort()
    .join(',');
  /* لقطةُ الترتيب بنقاط نهاية الجولة: المركزُ منها، والمتساويان في مركزٍ واحد */
  const frozen = useMemo(() => {
    const tc = (t: PublicTeam) => t.totalCorrect ?? 0;
    const ahead = (o: PublicTeam, t: PublicTeam) =>
      o.score > t.score || (o.score === t.score && tc(o) > tc(t));
    const snap = [...teams].sort((a, b) => b.score - a.score || tc(b) - tc(a));
    const rank = new Map(snap.map((t) => [t.id, 1 + snap.filter((o) => ahead(o, t)).length]));
    return { order: snap.map((t) => t.id), rank };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, roster]);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const sorted = frozen.order.map((id) => byId.get(id)).filter((t) => !!t);

  return (
    <Panel title="ترتيب الفوز" tour="standings">
      <div className="grid">
        {sorted.map((team) => {
          const rank = frozen.rank.get(team.id) ?? 1;
          const award = last?.awards.find((a) => a.teamId === team.id);
          return (
            <div
              key={team.id}
              className="grid grid-cols-[22px_minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-line-soft py-1.5 last:border-0"
            >
              <span
                className={`tnum text-center text-[14px] ${rank === 1 ? 'font-black text-gold' : 'font-light text-faint'}`}
              >
                {rank}
              </span>
              <b className="min-w-0 truncate text-[13.5px] font-bold">{team.name}</b>
              <span
                className={`tnum text-[11.5px] font-bold ${award?.burned || (award?.points ?? 0) < 0 ? 'text-danger' : 'text-safe'}`}
                title={award?.burned ? 'احترقت مضاعفته' : undefined}
              >
                {award?.points ? (award.points < 0 ? `−${-award.points}` : `+${award.points}`) : ''}
              </span>
              <span className="tnum flex w-8 items-center justify-end gap-0.5 text-[11.5px] font-black text-warn">
                <SparkIcon size={10} />
                {team.sparks ?? 0}
              </span>
              {/*
               * النقاط لا تنزل تحت الصفر — والزرُّ يقول ذلك بنفسه: المعطَّلُ
               * الظاهرُ أصدقُ من العاملِ الصامت.
               */}
              <span className="flex items-center gap-1">
                <IconButton
                  title={
                    team.score === 0
                      ? `${team.name} عند الصفر، لا نقطة تُخصم`
                      : `اخصم نقطة من ${team.name}`
                  }
                  size={8}
                  disabled={team.score === 0}
                  onClick={() => onAdjust(team.id, -1)}
                >
                  <MinusIcon size={13} strokeWidth={2.6} />
                </IconButton>
                <RollingNumber
                  value={team.score}
                  className="tnum w-8 text-center text-[16px] font-black text-signal"
                />
                <IconButton
                  title={`أضف نقطة إلى ${team.name}`}
                  size={8}
                  onClick={() => onAdjust(team.id, 1)}
                >
                  <PlusIcon size={13} strokeWidth={2.6} />
                </IconButton>
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Panel({
  title,
  hint,
  tour,
  children,
}: {
  title: string;
  hint?: string;
  /** اسمُه في الجولة التعريفية */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <section data-tour={tour} className="tile px-3 py-3 sm:px-[18px] sm:py-4">
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
  inRound,
  wide,
  onAdjust,
  onRemove,
}: {
  team: PublicTeam;
  rank: number;
  running: boolean;
  /** جولةٌ قائمة (استعداد أو جريان أو إيقاف) — فيها تُقرأ شارات البطاقات */
  inRound: boolean;
  wide: boolean;
  onAdjust: (seconds: number) => void;
  onRemove: () => void;
}) {
  const frozen = team.locked && !team.flatlined;
  const gilded = team.doubled && !team.flatlined && !frozen;
  const level = teamLevel(team.timeMs, team.flatlined);
  const skin = frozen ? 'frosted' : gilded ? 'gilded' : 'tile';
  /* شاراتُ البطاقات تُقرأ ما دامت الجولة قائمة — وبعدها خبرٌ قديم */
  const effects = inRound ? team.effects : undefined;

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
      {effects && effects.length > 0 && <EffectBadges effects={effects} className="mt-1" />}
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
        {team.waiting ? '-' : formatTime(team.timeMs)}
      </b>
      <span className="mt-0.5 block text-[10.5px] font-medium text-muted sm:mt-1 sm:text-[11px]">
        {team.waiting ? 'ينتظر' : team.flatlined ? 'توقف' : 'ثانية'}
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
      <ConfirmButton
        bare
        tone="icon"
        label={`اطرد ${team.name}`}
        glyph={<CloseIcon size={14} strokeWidth={2.6} />}
        onConfirm={onRemove}
      />
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
        className={`relative grid min-h-[74px] shrink-0 py-2 grid-cols-[30px_minmax(120px,230px)_104px_minmax(0,1fr)_auto] items-center gap-3.5 overflow-hidden px-3.5 ${skin}`}
      >
        <span className="bg-state absolute inset-y-0 start-0 z-[1] w-1" aria-hidden="true" />
        <div className="tnum relative text-center text-[17px] font-light text-faint">{rank}</div>
        <div className="relative">{name}</div>
        <div className="relative">{time}</div>
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
      </div>
      <div className="relative mt-2 flex items-center gap-2 ps-1.5">
        <div className="min-w-0 flex-1">{lane}</div>
        {buttons}
      </div>
    </div>
  );
}
