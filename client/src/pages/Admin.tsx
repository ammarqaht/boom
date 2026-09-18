import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, ask } from '../lib/socket';
import type { Bank, FeedItem, PublicTeam, RoomState } from '../lib/types';
import {
  Button,
  Card,
  CheckOption,
  ErrorNote,
  Field,
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
  CloseIcon,
  CopyIcon,
  ExitIcon,
  EyeIcon,
  EyeOffIcon,
  HistoryIcon,
  MinusIcon,
  OfflineIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  ScreenIcon,
  SnowflakeIcon,
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

type Session = { code: string; adminKey: string };

export default function Admin() {
  // المنظّم يجلس في ضوء ويحتاج قراءة سريعة لا دراما — هذه اللوحة فاتحة دائماً
  useTheme('light');
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
    const total = banks.filter((b) => bankIds.includes(b.id)).reduce((sum, b) => sum + b.count, 0);

    return (
      <FormPage
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

          <Field label="بنوك الأسئلة — واحد أو أكثر">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="tnum text-xs font-medium text-muted">
                {bankIds.length} من {banks.length}
              </span>
              <MiniAction
                onClick={() =>
                  setBankIds(
                    bankIds.length === banks.length ? [banks[0].id] : banks.map((b) => b.id),
                  )
                }
              >
                {bankIds.length === banks.length ? 'إلغاء التحديد' : 'تحديد الكل'}
              </MiniAction>
            </div>
            {/* عمودان على الحاسب: أحد عشر بنكاً في عمودٍ واحد تُطيل البطاقة
                حتى تخرج عن الشاشة، والعين تمسح صفّين أسرع من عمودٍ طويل */}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {banks.map((bank) => (
                <CheckOption
                  key={bank.id}
                  checked={bankIds.includes(bank.id)}
                  onToggle={() => toggle(bank.id)}
                  title={bank.name}
                  hint={`${bank.count}`}
                />
              ))}
            </div>
            <p className="tnum mt-2 text-sm text-muted">
              تُخلط أسئلة البنوك المختارة وتُعرض عشوائياً — المجموع {total} سؤال
            </p>
          </Field>

          <Field label="مستوى الأسئلة">
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
    {
      label: 'فتح البطاقات من جديد',
      icon: <CardsIcon size={17} />,
      onClick: () => {
        send('admin:reopenCards');
        flash('فُتحت البطاقات من جديد');
      },
    },
    {
      label: 'إنهاء اللعبة وعرض الأوائل',
      icon: <TrophyIcon size={17} />,
      hold: 'تنتهي اللعبة ويظهر الترتيب النهائي على كل الشاشات.',
      onClick: () => send('admin:finishGame'),
    },
    {
      label: 'إعادة اللعبة',
      icon: <ExitIcon size={17} />,
      hold: 'تُصفَّر كل النقاط والجولات. لا يمكن التراجع.',
      onClick: () => send('admin:resetAll'),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      {/*
       * ترويسة نحيلة: الهوية والرمز والحال. أما أزرار الجولة وعدّادها
       * فمكانها لوحةُ الجولة — فالترويسة تُعرِّف ولا تُدير.
       */}
      <header className="shrink-0 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-chip bg-signal-ink text-white">
            <PulseMark size={20} />
          </span>
          <b className="text-[16px] font-black">نبضة</b>

          {/* الرمز شارةٌ لا رقمٌ عائم: يُقرأ من بعيد ويُملى على القاعة */}
          <b
            dir="ltr"
            className="tnum rounded-chip bg-signal-2 px-3 py-1 text-[15px] font-black tracking-[0.25em] text-signal-ink"
          >
            {room.code}
          </b>
          {/* الاسم يُذكّر المنظّم أيّ نشاطٍ هذا حين يفتح غرفتين معاً */}
          <span
            className="max-w-[18ch] truncate text-[13px] font-medium text-muted"
            title={room.name}
          >
            {room.name}
          </span>

          <span className="flex items-center gap-2 text-[13px] font-bold text-muted">
            <i
              className={`size-2 rounded-full ${
                live ? 'blink bg-safe' : room.status === 'paused' ? 'blink bg-warn' : 'bg-faint'
              }`}
              aria-hidden="true"
            />
            {STATUS[room.status]}
          </span>

          {/*
           * الانقطاع يُقال صراحةً: لوحةٌ مقطوعة تبدو سليمةً تماماً — تُضغط
           * أزرارها فلا يحدث شيء ولا خبر يقول لماذا. فتُعلن الحال.
           */}
          {!online && (
            <span className="flex items-center gap-2 rounded-chip bg-danger-2 px-2.5 py-1 text-[12.5px] font-bold text-danger">
              <OfflineIcon size={14} />
              انقطع الاتصال — يُعاد الوصل
            </span>
          )}

          <div className="ms-auto flex items-center gap-2.5">
            {note && (
              <span className="hidden text-[13px] font-bold text-signal-ink sm:block">{note}</span>
            )}
            <Menu actions={actions} />
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1560px] gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_432px] xl:items-start">
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
                  <Standings standings={room.standings!} rounds={room.history.length} />
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
                  <b className="text-[16px] font-black">
                    اللاعبون <span className="font-bold text-faint">({room.teams.length})</span>
                  </b>
                  <span className="tnum text-[12.5px] font-medium text-faint">
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
                  <div className="tile flex flex-col items-center gap-3 px-4 py-10 text-center">
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

                {idle && room.teams.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-card border-[1.5px] border-dashed border-line-2 px-4 py-5 text-center text-[13.5px] font-medium text-muted">
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
                  hint="يحمل مفتاح التحكم — لا تشاركه مع لاعب"
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

      {showBanks && (
        <Modal title="بنوك الأسئلة ومستواها" onClose={() => setShowBanks(false)}>
          <div className="mb-4">
            <span className="mb-2 block text-sm font-bold tracking-[0.08em] text-muted">
              مستوى الأسئلة
            </span>
            <Segmented value={room.difficulty as Level} options={LEVELS} onPick={setLevel} />
          </div>

          <div className="mb-1.5 flex items-center justify-between">
            <span className="tnum text-xs font-medium text-muted">
              {room.bankIds.length} من {banks.length}
            </span>
            <MiniAction
              onClick={() =>
                send('admin:setBanks', {
                  bankIds:
                    room.bankIds.length === banks.length ? [banks[0].id] : banks.map((b) => b.id),
                })
              }
            >
              {room.bankIds.length === banks.length ? 'إلغاء التحديد' : 'تحديد الكل'}
            </MiniAction>
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            {banks.map((bank) => (
              <CheckOption
                key={bank.id}
                checked={room.bankIds.includes(bank.id)}
                onToggle={() => toggleBank(bank.id)}
                title={bank.name}
                hint={`${bank.count} سؤال`}
              />
            ))}
          </div>
          <p className="tnum mt-3 text-sm text-muted">
            المختار الآن{' '}
            {banks.filter((b) => room.bankIds.includes(b.id)).reduce((n, b) => n + b.count, 0)} سؤال
            — تُخلط وتُعرض عشوائياً
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

  return (
    <section className="tile p-4">
      {/* items-stretch: البلاطة والزرّ بطولٍ واحد مهما اختلف محتواهما */}
      <div className="flex items-stretch gap-3">
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

        <div className="flex w-[92px] shrink-0 flex-col items-center justify-center rounded-chip text-center shadow-[inset_0_0_0_1px_var(--color-line)]">
          <div className="tnum text-[20px] leading-none font-black">{room.round}</div>
          <div className="mt-1 text-[11px] font-medium text-muted">
            الجولة · {room.history.length} مكتملة
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-3 text-xs font-medium text-muted">
        <span>
          المستوى <b className="font-black text-ink">{level}</b>
        </span>
        <span className="tnum">
          {room.bankIds.length} من {banks.length} بنكاً · {pool} سؤال
        </span>
      </div>

      {/* الاختصار لا يُخمَّن: من لم يُخبَر به لن يجده */}
      <p className="mt-1.5 text-[11px] font-medium text-faint">
        <b className="font-black">مسافة</b> إيقاف واستئناف · <b className="font-black">Enter</b> بدء
        الجولة
      </p>
    </section>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="tile px-[18px] py-4">
      <h3 className="mb-3 flex items-baseline justify-between gap-3 text-[14px] font-black">
        {title}
        {hint && <span className="tnum shrink-0 text-[12px] font-medium text-faint">{hint}</span>}
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
  return (
    <button
      type="button"
      onClick={onCopy}
      className="flex w-full items-center gap-2.5 rounded-chip px-2 py-2.5 text-right transition hover:bg-surface-2"
    >
      <span className="shrink-0 text-signal-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold">{label}</span>
        {hint && <span className="block text-[11.5px] font-medium text-danger">{hint}</span>}
      </span>
      <CopyIcon size={15} className="shrink-0 text-faint" />
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
      <div className="flex items-center gap-1.5 text-[17px] leading-tight font-black">
        <span className="truncate">{team.name}</span>
        {frozen && <SnowflakeIcon size={14} className="shrink-0 text-frost" />}
        {team.doubled && !team.flatlined && (
          <span className="shrink-0 text-xs font-black text-gold">×٢</span>
        )}
        {!team.connected && <OfflineIcon size={13} className="shrink-0 text-faint" />}
      </div>
      <div className="tnum text-[11px] font-medium text-muted">
        {team.correct} من {team.answered} صحيحة
      </div>
    </div>
  );

  const time = (
    <div className="leading-none">
      <b className={`tnum text-2xl font-black ${team.flatlined ? 'text-danger' : 'ink-state'}`}>
        {formatTime(team.timeMs)}
      </b>
      <span className="mt-1 block text-[11px] font-medium text-muted">
        {team.flatlined ? 'توقف' : 'ثانية'}
      </span>
    </div>
  );

  const score = (
    <div className="leading-none">
      <RollingNumber value={team.score} className="tnum text-2xl font-black text-signal" />
      <span className="mt-1 block text-[11px] font-medium text-muted">نقطة</span>
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
      className="relative h-[38px]"
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
      className={`relative overflow-hidden p-3 ${skin}`}
    >
      <span className="bg-state absolute inset-y-0 start-0 z-[1] w-1" aria-hidden="true" />
      <div className="relative flex items-center gap-2.5 ps-1.5">
        <span className="tnum w-4 shrink-0 text-center text-sm font-light text-faint">{rank}</span>
        <div className="min-w-0 flex-1">{name}</div>
        <div className="shrink-0 text-center">{time}</div>
        <div className="shrink-0 text-center">{score}</div>
      </div>
      <div className="relative mt-2.5 flex items-center gap-2.5 ps-1.5">
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
