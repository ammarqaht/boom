import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, onWake, socket, useConnection, useFreshBuild, watchSession } from '../lib/socket';
import {
  clearTeamSession as clearSession,
  deviceId,
  loadTeamSession as loadSession,
  saveTeamSession as saveSession,
} from '../lib/session';
import {
  projectRoom,
  projectTeam,
  roomTicking,
  teamTicking,
  useCountdown,
  useProjected,
} from '../lib/clock';
import type { PublicTeam, Question, RoomResult, RoomState, TeamState } from '../lib/types';
import { CARD_GROUPS, CARD_LOOK, sparksWord } from '../lib/cards';
import { EffectBadges } from '../components/effects';
import { LivesBar, livesFor, playersWord } from '../components/lives';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  FormPage,
  HomeLink,
  Input,
  Menu,
  MuteButton,
  PulseMark,
  beatSeconds,
  dangerLevel,
  Flag,
  formatTime,
  stateStyle,
  teamLevel,
  toast,
  useTheme,
  type MenuAction,
} from '../components/ui';
import {
  ExitIcon,
  HistoryIcon,
  CardsIcon,
  CheckIcon,
  CrownIcon,
  DuelIcon,
  FlatlineIcon,
  HeartIcon,
  HourglassIcon,
  OfflineIcon,
  ReviveIcon,
  SoundOffIcon,
  SoundOnIcon,
  SparkIcon,
  TrophyIcon,
} from '../components/icons';
import {
  CommentCard,
  CountdownGate,
  Curtain,
  CURTAIN_OUT_MS,
  HistoryModal,
  Lane,
  PausedMark,
  ReviewList,
  RollingNumber,
  Standings,
  TheEnd,
} from '../components/game';
import { Shop, FreezeOverlay } from '../components/Shop';
import { Tour, tourSeen, type TourStep } from '../components/Tour';
import {
  isMuted,
  playBeat,
  playCorrect,
  playFlatline,
  playWrong,
  setMuted,
  unlockAudio,
} from '../lib/sound';
import { countOf } from '../lib/arabic';

/** كم يبقى الصواب مُضاءً بعد الخطأ — أقلّ من ثانية فالوقت يجري */
const REVEAL_MS = 900;

type Reveal = { question: Question; right: number; chosen: number };
type ResultPayload = {
  isCorrect: boolean;
  questionId: string;
  answer: number;
  shielded?: boolean;
  /* وكم بقي من الدرع بعد أن صدّ خطأً */
  streaked?: boolean;
  shieldLeft?: number;
};

export default function Play() {
  const [params] = useSearchParams();
  /*
   * اللاعبُ غامقٌ دائماً، ولا خيار.
   *
   * شاشتُه تُقرأ في قاعةٍ مُطفأةٍ بجانب بروجكتر، وهي أختُ شاشة العرض
   * ولوحة المنظّم في المجلس نفسه. والمجرى — وهو اللعبةُ كلّها — مبنيٌّ
   * على سوادٍ يُضيء عليه الخطّ. فخيارُ الفاتح بابٌ إلى شاشةٍ أسوأ، ومن
   * فتحه في القاعة أضرّ بنفسه ولم ينفع.
   */
  useTheme('dark');
  const [state, setState] = useState<TeamState | null>(null);
  /* حالُ الوصل: شاشةٌ مقطوعة لا تلعب، فلا تُترك تبدو سليمة */
  const { live, restarting } = useConnection();
  /*
   * جلسةٌ محفوظة ولم تصل حالُها بعد: «نُعيدك إلى غرفتك» لا باب الدخول.
   * كان الباب يظهر فيظنّ اللاعب أنه طُرد فيدخل من جديد — فيُقال له
   * «الاسم مستخدم» أو يصير له في القائمة اسمان.
   */
  const [returning, setReturning] = useState(() => {
    const saved = loadSession();
    if (!saved) return false;
    /* رابطٌ إلى غرفةٍ أخرى: تُطوى جلسةُ القديمة ويُفتح بابُ الجديدة (lib/socket.ts) */
    const wanted = params.get('code')?.toUpperCase();
    if (wanted && wanted !== saved.code) {
      clearSession();
      return false;
    }
    return true;
  });
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [name, setName] = useState('');
  const [flash, setFlash] = useState<{ key: number; correct: boolean } | null>(null);
  // القفل مرتبط بمعرّف السؤال لا بقيمة منطقية:
  // وصول سؤال جديد يفكّه تلقائياً حتى لو ضاع ردّ السيرفر.
  const [lockedFor, setLockedFor] = useState<string | null>(null);
  /*
   * كشف الصواب: حين يخطئ اللاعب نُجمّد السؤال الذي أجاب عنه أقل من ثانية
   * ونُضيء الصواب. والسيرفر قد سحب السؤال التالي فعلاً، فنحتفظ بالمعروض
   * هنا ونعرضه بدلاً منه حتى ينقضي الكشف.
   */
  const [reveal, setReveal] = useState<Reveal | null>(null);
  /* ما بلّغ عنه هذا اللاعب — ليُشكر عليه ولا يُبلّغ مرّتين */
  const [reported, setReported] = useState<Set<string>>(new Set());
  const asked = useRef<{ question: Question; choice: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [muted, setMute] = useState(isMuted);
  /* جهازٌ لا يخزّن: الجلسة في الذاكرة وحدها، فتحديثُ الصفحة يُخرجه */
  const [volatile, setVolatile] = useState(false);

  const locked = !!lockedFor && lockedFor === state?.question?.id;

  // شبكة أمان: لو رفض السيرفر الإجابة ولم يرسل ردّاً، نفكّ القفل بعد لحظة
  useEffect(() => {
    if (!lockedFor) return;
    const timer = setTimeout(() => setLockedFor(null), 1500);
    return () => clearTimeout(timer);
  }, [lockedFor]);

  /*
   * الوميض يُمسح بعد أن ينتهي — وإلا بقي في الحالة إلى ما لا نهاية، فإذا
   * غادرت الشاشةُ شجرةَ اللعب (نهاية جولة أو إيقاف) ثم عادت، رُكّب من
   * جديد فأعاد تشغيل حركته: يرى اللاعب «−٣» عند بدء الجولة بلا سبب.
   */
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const onState = (next: TeamState) => setState(next);
    const onRoom = (next: RoomState) => setRoom(next);
    const onRemoved = () => {
      clearSession();
      setState(null);
      setError('أزالك المنظّم من الغرفة');
    };
    socket.on('team:state', onState);
    socket.on('room:state', onRoom);
    socket.on('team:removed', onRemoved);
    return () => {
      socket.off('team:state', onState);
      socket.off('room:state', onRoom);
      socket.off('team:removed', onRemoved);
    };
  }, []);

  /*
   * الرجوع بعد انقطاعٍ أو تحديثٍ للصفحة.
   *
   * الهويّة تُرسل مع الاتصال نفسه (lib/socket.ts)، والسيرفر يردّ بأحد
   * خبرين: عادت جلستك بحالها، أو انتهت. ولا تُمحى الجلسة إلا بالثاني —
   * كانت تُمحى إذا أبطأ ردُّ «رجّعني» ست ثوانٍ، فيُطرد اللاعب وهو لم يُطرد.
   */
  useEffect(() => {
    const stop = watchSession('team', {
      resumed: (payload) => {
        const next = payload.state as TeamState;
        setReturning(false);
        /* لعبةٌ انتهت لا يُعاد إليها: الجلسة تُطوى ويبدأ اللاعب من الباب */
        if (next.status === 'finished') {
          clearSession();
          setState(null);
          return;
        }
        setState(next);
        setRoom(payload.room as RoomState);
      },
      invalid: (payload) => {
        clearSession();
        setReturning(false);
        setState(null);
        setError(payload.error);
      },
    });
    /*
     * عاد من قفل الشاشة والسوكِت حيّ: قد فاته في نومه ما فاته، فيُسأل عن
     * حاله كاملة. ومن أزاله المنظّم في غيبته يُقال له ذلك.
     */
    const offWake = onWake(async () => {
      if (!loadSession()) return;
      const res = await ask<{ state: TeamState; room: RoomState; gone?: boolean }>('session:sync');
      if (res.ok) {
        setState(res.state);
        setRoom(res.room);
      } else if ('gone' in res && res.gone) {
        clearSession();
        setState(null);
        setError('أزالك المنظّم من الغرفة');
      }
    });
    return () => {
      stop();
      offWake();
    };
  }, []);

  // صوت النتيجة + وميض الشاشة — يُنادى من إقرار الإجابة
  const onResult = ({
    isCorrect,
    questionId,
    answer: right,
    shielded,
    shieldLeft,
  }: ResultPayload) => {
    if (shielded) {
      const look = CARD_LOOK.shield;
      toast('الدرع حفظ وقتك', {
        tone: look.tone,
        icon: <look.Icon size={19} />,
        note: shieldLeft
          ? `بقي له ${countOf(shieldLeft, { one: 'خطأٌ واحد', two: 'خطآن', few: 'أخطاء', many: 'خطأً' })}`
          : 'انكسر الدرع',
      });
    }
    setFlash({ key: Date.now(), correct: isCorrect });
    setLockedFor(null);
    (isCorrect ? playCorrect : playWrong)();

    // الصواب يُكشف عند الخطأ وحده: الإصابة تُكافأ بالمضيّ لا بالانتظار
    const last = asked.current;
    if (!isCorrect && last && last.question.id === questionId) {
      setReveal({ question: last.question, right, chosen: last.choice });
    }
  };

  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setReveal(null), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  const join = async () => {
    setError('');
    setBusy(true);
    unlockAudio();
    const res = await ask<{ teamId: string; token: string; state: TeamState }>('team:join', {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      device: deviceId(),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    /* الشاشة أولاً: الانضمام نجح فعلاً، فلا يقف اللاعب على الباب لأجل تخزين */
    setState(res.state);
    const stored = saveSession({
      code: code.trim().toUpperCase(),
      teamId: res.teamId,
      token: res.token,
    });
    setVolatile(!stored);
  };

  /*
   * البلاغ من المراجعة بعد الجولة. ونُعلّمه محليّاً فور الإرسال: السيرفر
   * لا يُعيد إلى اللاعب سجلّ المُبلَّغ عنه — ذاك للمنظّم — وهو لا يحتاج
   * إلا أن يعرف أن ملاحظته وصلت.
   */
  const onReport = (questionId: string, reason: string) => {
    setReported((current) => new Set(current).add(questionId));
    void ask('team:report', { questionId, reason });
  };

  const answer = (choice: number) => {
    if (!state?.question || locked || reveal) return;
    asked.current = { question: state.question, choice };
    setLockedFor(state.question.id);
    /*
     * بإقرار: إن انقطع الاتصال لحظةَ الضغط بقيت الإجابة في طابور السوكِت
     * وتُرسل عند عودته — والسيرفر يعرف الجهاز من الاتصال نفسه فلا يرميها.
     * وإن وصلت متأخرةً بعد أن تبدّل السؤال رُدّت «قديمة» وصُحّحت الشاشة.
     */
    socket
      .timeout(8000)
      .emit(
        'team:answer',
        { questionId: state.question.id, choice, left: leftNow() },
        (err: unknown, res?: { ok: boolean } & Partial<ResultPayload>) => {
          if (err || !res) return; // شبكةُ الأمان تفكّ القفل، وحالُ السيرفر تصل عند العودة
          if (res.ok) onResult(res as ResultPayload);
          else setLockedFor(null);
        },
      );
  };

  /*
   * ما بقي على شاشته الآن — يُرسل مع الإجابة. إن وصلت والسيرفر قد بلغ
   * عنده الصفر (الشبكة أخّرتها) حُسبت ما دامت ضُغطت والشاشة تقول إن له وقتاً.
   */
  const clock = useRef({ ms: 0, at: 0 });
  useEffect(() => {
    if (state) clock.current = { ms: state.timeMs, at: performance.now() };
  }, [state]);
  const leftNow = () => Math.max(0, clock.current.ms - (performance.now() - clock.current.at));

  /*
   * الشاشةُ لا تنطفئ أثناء الجولة. قفلُ الجوّال الآلي بعد ثلاثين ثانية
   * يجمّد الصفحة والوقتُ يجري — فيسكن نبضُ لاعبٍ لم يفعل شيئاً.
   */
  useWakeLock(state?.status === 'running' || state?.status === 'countdown');

  const heard = useRef({ round: 0, count: 0 });
  useEffect(() => {
    if (!state) return;
    const notices = state.notices ?? [];
    if (heard.current.round !== state.round) heard.current = { round: state.round, count: 0 };
    if (state.status !== 'running') {
      heard.current.count = notices.length;
      return;
    }
    for (const notice of notices.slice(heard.current.count)) {
      const look = notice.includes('صاعق') ? CARD_LOOK.revive : CARD_LOOK.mirror;
      toast(notice, { tone: look.tone, icon: <look.Icon size={19} /> });
    }
    heard.current.count = notices.length;
  }, [state]);

  /* حزمةٌ أقدم من السيرفر تُحدَّث بين الجولات — والجلسة تعيده إلى مكانه */
  useFreshBuild(!state || (state.status !== 'running' && state.status !== 'countdown'));
  const shown = useProjected(state, projectTeam, teamTicking);
  /* حالُ الغرفة تُنزَل محلياً بين رسالتين — فمن يشاهد الجولة يرى العدّادات تجري */
  const liveRoom = useProjected(room, projectRoom, roomTicking);

  /*
   * جلسةٌ محفوظة والحالُ في الطريق: يُطمأن اللاعب أنه عائدٌ إلى غرفته.
   * وبابٌ لمن أراد غيرها — فلا يُحبس على غرفةٍ لا يريدها.
   */
  if (!state && returning) {
    return (
      <FormPage title="نُعيدك إلى غرفتك">
        <Card className="grid gap-4 text-center">
          <p className="text-sm font-medium text-muted">
            {live ? 'جارٍ استرجاع مكانك…' : 'ننتظر الشبكة، نعود فور اتصالها'}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              clearSession();
              setReturning(false);
            }}
          >
            انضمّ إلى غرفة أخرى
          </Button>
        </Card>
      </FormPage>
    );
  }

  if (!state) {
    return (
      <FormPage title="انضمام لاعب">
        <Card className="grid gap-4">
          <Field label="رمز الغرفة">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A7K2"
              maxLength={4}
              autoCapitalize="characters"
              className="tnum text-center text-3xl tracking-[0.4em]"
            />
          </Field>
          <Field label="اسمك">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="أبو محمد"
              maxLength={24}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button size="lg" onClick={join} disabled={busy || code.length < 4 || !name.trim()}>
            {busy ? 'جارٍ الانضمام…' : 'انضمّ'}
          </Button>
          <HomeLink />
        </Card>
      </FormPage>
    );
  }

  const actions: MenuAction[] = [
    /* زرُّ الصوت في الترويسة، والترويسةُ لا تُرسم بين الجولتين — فله سطرٌ هنا */
    {
      label: muted ? 'تشغيل الصوت' : 'كتم الصوت',
      icon: muted ? <SoundOffIcon size={17} /> : <SoundOnIcon size={17} />,
      onClick: () => {
        setMuted(!muted);
        setMute(!muted);
      },
    },
    {
      label: 'سجل الجولات',
      icon: <HistoryIcon size={17} />,
      onClick: () => setShowHistory(true),
    },
    {
      label: 'الخروج من اللعبة',
      icon: <ExitIcon size={17} />,
      confirm: true,
      onClick: () => {
        clearSession();
        location.href = '/';
      },
    },
  ];

  return (
    <>
      <TeamScreen
        state={shown ?? state}
        teams={(liveRoom ?? room)?.teams ?? []}
        history={room?.history ?? []}
        flash={flash}
        reveal={reveal}
        reported={reported}
        onReport={onReport}
        locked={locked}
        onAnswer={answer}
        actions={actions}
        live={live}
        restarting={restarting}
        volatile={volatile}
      />
      {showHistory && (
        <HistoryModal
          history={room?.history ?? []}
          teamId={state.id}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
}

/** الشريط العلوي: من نحن، وكم لنا — في ٥٦ بكسل */
function TopBar({
  state,
  actions,
  live,
  restarting,
  volatile: unsaved,
}: {
  state: TeamState;
  actions: MenuAction[];
  live: boolean;
  /** السيرفر قال إنه يتجدّد — نشرٌ جديد، لا عطبٌ في شبكة اللاعب */
  restarting?: boolean;
  /** جهازٌ رفض حفظ الجلسة — تحديثُ الصفحة يُخرج اللاعب */
  volatile?: boolean;
}) {
  return (
    /* الترويسة على سطحٍ لا على الأرضية: أبيضُ في الفاتح وأسودُ في الغامق */
    <header className="-mx-3.5 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <PulseMark size={24} className="shrink-0 text-signal" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[17px] leading-tight font-black">{state.name}</span>
            {/* المضاعفة فعّالة: يراها صاحبها في ترويسته كما تراها القاعة على شريطه */}
            {/* نبضاتُ الجولة: تنقص مع كل لاعبٍ يسكن — ومن كانوا ثمانيةً فأقلّ لا تُرسم */}
            {(state.lives ?? 1) > 1 &&
              (state.status === 'running' || state.status === 'countdown') && (
                <LivesBar
                  lives={state.lives ?? 1}
                  fallen={state.fallen ?? []}
                  className="shrink-0"
                />
              )}
            {(state.shop.pending.double || state.doubled) && (
              <span className="shrink-0 rounded-chip px-1.5 py-px text-[11px] font-black text-gold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-gold)_55%,transparent)]">
                ×٢
              </span>
            )}
          </div>
          {/* الانقطاع يُقال صراحةً: شاشةٌ مقطوعة تبدو سليمة، وإجاباتُها تذهب سُدىً */}
          {!live ? (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-danger">
              <OfflineIcon size={12} />
              {restarting ? 'السيرفر يتجدّد، ثوانٍ ونعود' : 'انقطع الاتصال، يُعاد الوصل'}
            </div>
          ) : unsaved ? (
            /*
             * جهازٌ لا يخزّن (تصفّحٌ خاصّ غالباً): الوصلُ قائمٌ والجلسةُ في
             * الذاكرة، فانقطاعُ الشبكة لا يضرّ — وتحديثُ الصفحة يُخرجه. فيُقال
             * له ما يملك أن يتجنّبه، لا ما لا يفهمه.
             */
            <div className="text-[11px] font-bold text-warn">
              لا تُحدّث الصفحة، جهازك لا يحفظ الجلسة
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        <MuteButton />
        <Menu actions={actions} />
      </div>
    </header>
  );
}

function TeamScreen({
  state,
  teams,
  history,
  flash,
  reveal,
  reported,
  onReport,
  locked,
  onAnswer,
  actions,
  live,
  restarting,
  volatile: unsaved,
}: {
  state: TeamState;
  teams: PublicTeam[];
  history: RoomResult[];
  flash: { key: number; correct: boolean } | null;
  reveal: Reveal | null;
  reported: Set<string>;
  onReport: (questionId: string, reason: string) => void;
  locked: boolean;
  onAnswer: (choice: number) => void;
  actions: MenuAction[];
  live: boolean;
  restarting?: boolean;
  volatile?: boolean;
}) {
  const shown = useSmoothTime(state.timeMs, state.status === 'running' && !state.flatlined);
  const level = dangerLevel(shown);
  const running = state.status === 'running' && !state.flatlined;
  const frozen = running && state.lockedMs > 0;
  const over = state.status === 'ended' || state.flatlined;
  const phase = useEndPhase(over);
  const dying = running && shown <= 5000;

  useHeartbeat(shown, running);
  useFlatlineSound(state.flatlined);

  /*
   * الخروج من شاشة النهاية يمحو الجلسة: اللعبةُ انتهت، فلا معنى لأن
   * تُعيدك الصفحةُ إلى ترتيبٍ لا يتغيّر. وتحميلٌ كاملٌ لا تنقّلٌ داخليّ —
   * فتُطوى الحالة كلها طيّاً نظيفاً.
   */
  const leave = (to: string) => {
    clearSession();
    location.href = to;
  };

  const frame = (children: React.ReactNode) => (
    <div className="relative flex h-full flex-col px-3.5 pb-4">
      <TopBar
        state={state}
        actions={actions}
        live={live}
        restarting={restarting}
        volatile={unsaved}
      />
      {children}
    </div>
  );

  // انتهت اللعبة كلياً — الأوائل على المدرّج
  if (state.status === 'finished' && state.standings) {
    return frame(
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-5">
        {/* m-auto يوسّط اللوحة حين تقصر، ولا يقصّ أعلاها حين تطول */}
        <div className="m-auto w-full">
          <Standings standings={state.standings} meId={state.id} />
          <CommentCard onSend={(payload) => ask('feedback:comment', payload)} />
          <TheEnd
            primary="العب من جديد"
            onPrimary={() => leave('/play')}
            onHome={() => leave('/')}
          />
        </div>
      </div>,
    );
  }

  /*
   * دخل والجولة جارية: ينتظر القادمة.
   *
   * قبل هذا كان الباب يُغلق في وجهه: «الجولة بدأت — انتظر القادمة» رسالةُ
   * خطأٍ على شاشة الدخول، فيظلّ يضغط «انضمّ» كلما مرّت دقيقة. والآن مجموعته
   * مسجّلةٌ يراها المنظّم، وشاشته تقول له إنه داخلٌ وإنما ينتظر — وهذا
   * الفرعُ قبل فرع الاستعداد، فعدّادُ جولةٍ ليست له لا يُعرض عليه.
   */
  if (state.waiting) {
    return frame(
      <StandBy state={state} teams={teams} history={history} title="انتظر الجولة القادمة" />,
    );
  }

  if (state.status === 'countdown') {
    return frame(
      <>
        <Centered>
          <p className="font-medium text-muted">استعدّ…</p>
        </Centered>
        <CountdownGate ms={state.countdownMs} on />
        {(state.notices?.length ?? 0) > 0 && (
          <ul className="fixed inset-x-0 bottom-6 z-[70] mx-auto grid w-full max-w-md gap-2 px-4">
            {state.notices!.map((notice, i) => (
              <li
                key={i}
                className="rise-in rounded-card bg-surface px-4 py-3 text-center text-[15px] font-black text-ink shadow-[inset_0_0_0_1px_var(--color-line-2),0_10px_30px_-12px_#000]"
                style={{ animationDelay: `${i * 0.1}s` }}
              >
                {notice}
              </li>
            ))}
          </ul>
        )}
      </>,
    );
  }

  if (state.status === 'lobby' || state.status === 'paused') {
    return frame(
      <StandBy
        state={state}
        teams={teams}
        history={history}
        paused={state.status === 'paused'}
        title="بانتظار بدء الجولة"
      />,
    );
  }

  /*
   * انتقال نهاية الجولة: ستارة قصيرة تحمل المصير بلونها ونصّها،
   * ثم تُستبدل بلوحة النتيجة — بدل أن تقفز المراجعة فجأة.
   */
  if (over && phase !== 'done') {
    const dead = state.flatlined;
    return frame(
      <>
        <Centered>
          <div className="tnum text-6xl font-black opacity-40">{formatTime(state.timeMs)}</div>
        </Centered>
        <Curtain
          mode="bloom"
          tone={dead ? 'var(--color-danger)' : 'var(--color-safe)'}
          leaving={phase === 'leaving'}
        >
          <div className="flex flex-col items-center gap-5 px-8">
            <Lane
              timeMs={state.timeMs}
              flatlined={dead}
              size="md"
              className="h-14 w-full max-w-sm"
            />
            <p
              className="thump text-4xl font-black"
              style={{
                color: dead ? 'var(--color-danger)' : 'var(--color-safe)',
              }}
            >
              {dead ? 'توقف نبضك' : 'نبضك مستمر'}
            </p>
          </div>
        </Curtain>
      </>,
    );
  }

  /*
   * سكن نبضُك والجولةُ قائمة (نبضاتُها لم تنكسر كلها): تُشاهَد حيّة —
   * من بقي ونبضُهم، وما بقي من نبضات الجولة — حتى تنتهي فتأتي النتيجة.
   */
  if (state.flatlined && state.status !== 'ended') {
    return frame(<Spectate state={state} teams={teams} />);
  }

  // نهاية الجولة: قراءة واحدة ثم لسان واحد مفتوح
  if (over) {
    /* بين الجولتين لا ترويسة: بطاقةُ اللاعب رأسُ الصفحة، وفيها خياراته */
    return (
      <div className="relative flex h-full flex-col px-3.5 pb-4">
        <RoundEnd
          state={state}
          teams={teams}
          last={history[history.length - 1] ?? null}
          reported={reported}
          onReport={onReport}
          actions={actions}
          live={live}
          restarting={restarting}
        />
      </div>
    );
  }

  const beat = `${beatSeconds(shown).toFixed(2)}s`;
  // أثناء الكشف يبقى السؤال المُجاب عنه معروضاً، والجديد ينتظر دوره
  const asking = reveal?.question ?? state.question;
  const mark = (i: number) => {
    if (!reveal) return '';
    if (i === reveal.right) return 'opt-right';
    if (i === reveal.chosen) return 'opt-wrong';
    return 'opt-mute';
  };

  return frame(
    <>
      {/* الثواني الأخيرة: الشاشة كلها تُنذر — والنصّ يبقى بكامل وضوحه */}
      {dying && (
        <div
          className="alarm pointer-events-none fixed inset-0 z-20"
          style={{ '--beat': beat } as CSSProperties}
          aria-hidden="true"
        />
      )}

      {flash && (
        <div
          key={flash.key}
          className="flash pointer-events-none fixed inset-0 z-20"
          style={{
            backgroundColor: flash.correct ? 'var(--color-safe)' : 'var(--color-danger)',
          }}
          aria-hidden="true"
        />
      )}
      {flash && (
        <div
          key={`n${flash.key}`}
          className="float-up tnum pointer-events-none fixed inset-x-0 top-1/3 z-30 text-center text-5xl font-black"
          style={{
            color: flash.correct ? 'var(--color-safe)' : 'var(--color-danger)',
          }}
        >
          {flash.correct ? `+${state.bonus}` : `−${state.penalty}`}
        </div>
      )}

      {/*
       * توازن الشاشة: المِرقاب أعلاها، والإجابات ملتصقةٌ بأسفلها حيث
       * يقع الإبهام، والسؤال يأخذ كل ما بينهما فيستقرّ في بصر القارئ
       * لا في أعلى الشاشة — ولا يبقى تحت البطاقات فراغ.
       */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/*
         * المؤقّت فوق المجرى لا إلى جانبه: الرقم والمجرى شيءٌ واحد —
         * كلاهما يقول ما بقي — فيُقرآن عموداً واحداً في وسط الشاشة، ولا
         * يُشتّت البصرَ سطرٌ جانبيّ.
         */}
        <section className="shrink-0 pt-4 pb-3 text-center" style={stateStyle(level, shown)}>
          {/*
           * الرقم يكبر قليلاً مع الخطر لا بالحركة وحدها: المستوى الأحمر
           * خبرٌ يُقرأ من بُعد، والعينُ في تلك اللحظة على الخيارات لا عليه.
           */}
          <div
            className={`ink-state tnum leading-[0.85] font-black tracking-[-0.02em] transition-[font-size] duration-300 ${
              dying ? 'beat-danger text-[86px]' : 'text-[78px]'
            }`}
          >
            {formatTime(shown)}
          </div>
          <p className="mt-2 text-[13px] font-medium text-muted">ثانية من نبضك</p>
          <Lane timeMs={state.timeMs} running size="md" className="mt-2.5 h-14" />
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
            <StreakMeter streak={state.streak} />
            <EffectBadges effects={state.effects} size="md" className="justify-center" />
          </div>
        </section>

        {/*
         * السؤال وخياراته كتلةٌ واحدة في وسط ما تبقّى من الشاشة: صندوق
         * السؤال بقدر ثلاثة أسطر (يتمدّد للأطول ولا ينكمش للأقصر، فلا
         * يقفز التخطيط بين سؤالٍ وآخر)، وتحته البطاقات الأربع.
         */}
        {/* pb يرفع الكتلة فوق المنتصف قليلاً: البصر يستقرّ أعلى من مركز الشاشة */}
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2.5 pt-10 pb-8">
          <div className="tile flex min-h-[7.5rem] shrink-0 flex-col items-center justify-center gap-3 px-4 py-4">
            {/* سؤالُ العلم: العلمُ هو السؤال — كبيرٌ فوق نصّه */}
            {asking?.flag && <Flag key={asking.flag} code={asking.flag} className="h-[92px]" />}
            <p className="text-center text-[19px] leading-relaxed font-bold text-balance">
              {asking?.q}
            </p>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2.5">
            {asking?.options.map((option, i) => (
              <button
                key={i}
                onClick={() => onAnswer(i)}
                disabled={locked || frozen || !!reveal}
                style={{ '--opt': `var(--color-opt-${(i % 4) + 1})` } as CSSProperties}
                className={`opt min-h-[118px] px-3.5 py-3 text-[17px] leading-snug font-black ${mark(i)}`}
              >
                {option}
                <span className="tnum absolute bottom-2 left-3 text-[13px] font-bold text-faint">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>

          {/* قاعدةُ اللعبة في سطر: من لم يقرأ الشرح يعرفها من أول إجابة */}
          <p className="tnum shrink-0 text-center text-[12.5px] font-medium text-faint">
            الصواب <b className="font-bold text-safe">+{state.bonus}</b> ثوانٍ · الخطأ{' '}
            <b className="font-bold text-danger">−{state.penalty}</b> ثوانٍ
          </p>
        </div>
      </div>

      {/* التجميد يقفل الشاشة حتى ينقضي */}
      {frozen && <FreezeOverlay frozenBy={state.frozenBy} lockedMs={state.lockedMs} />}
      <RevivePulse at={state.revivedAt ?? null} />
    </>,
  );
}

/**
 * عدّادُ السلسلة: ثلاث نقاطٍ تمتلئ بالصحيحات المتتالية، فإذا امتلأت
 * كسب شرارة وعادت فارغة. يُرى بطرف العين فيُغري بالإصابة الثالثة —
 * والخطأُ يُفرغه فيُعرف ثمنُه.
 */
function StreakMeter({ streak }: { streak: number }) {
  const filled = streak % 3;
  return (
    <span
      title="ثلاث صحيحات متتالية = شرارة"
      className="flex items-center gap-1 rounded-chip bg-surface-2 px-2.5 py-1 text-warn"
    >
      <SparkIcon size={13} />
      {[0, 1, 2].map((i) => (
        <i
          key={i}
          className={`size-2 rounded-full transition ${i < filled ? 'bg-warn' : 'bg-line-2'}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * صاعقُ القلب حين يعمل: وميضٌ أحمر وقلبٌ ينبض وسط الشاشة لحظةً، فيعرف
 * اللاعب أن نبضه عاد ولم تنتهِ جولته. ويُرسم مرّةً لكل صعقة (at).
 */
function RevivePulse({ at }: { at: number | null }) {
  const [shown, setShown] = useState<number | null>(null);
  const seen = useRef(at);
  useEffect(() => {
    if (!at || at === seen.current) return;
    seen.current = at;
    setShown(at);
    navigator.vibrate?.([80, 60, 80]);
    const timer = setTimeout(() => setShown(null), 1600);
    return () => clearTimeout(timer);
  }, [at]);
  if (!shown) return null;
  return (
    <div
      key={shown}
      className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-3"
    >
      <span className="flash absolute inset-0 bg-danger" aria-hidden="true" />
      <ReviveIcon size={96} className="thump relative text-danger" />
      <p className="thump relative text-3xl font-black">عاد نبضك</p>
    </div>
  );
}

/**
 * نبض بقية اللاعبين بعد انتهاء الجولة: لا تكفي اللاعبَ معرفةُ عدّاده
 * وحده — فالنقاط لمن بقي وقته أطول. اسمٌ ووقتٌ على طرفي سطر، وتحتهما
 * مجراه. أما أثناء السؤال فلا مكان لها: النظر كله للسؤال.
 */
/**
 * مشاهدةُ الجولة بعد السكون: لوحُ نبضات الجولة بأسماء من كسرها، ثم الصامدون
 * بعدّاداتهم تجري — الأطولُ نبضاً أولاً. والشاشةُ لا تُطفأ: ما زال في الجولة
 * ما يُرى.
 */
function Spectate({ state, teams }: { state: TeamState; teams: PublicTeam[] }) {
  const alive = teams.filter((t) => !t.flatlined && !t.waiting).sort((a, b) => b.timeMs - a.timeMs);
  const lives = state.lives ?? 1;
  const fallen = state.fallen ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 pb-2">
      <section
        className="hero-card shrink-0 px-5 py-4"
        style={{ '--tone': 'var(--color-danger)' } as CSSProperties}
      >
        <div className="relative flex items-center gap-2.5">
          <FlatlineIcon size={20} className="shrink-0 text-danger" />
          <b className="flex-1 text-lg font-black">توقف نبضك</b>
        </div>
        {lives > 1 && (
          <div className="relative mt-3.5">
            <LivesBar lives={lives} fallen={fallen} size="md" names />
          </div>
        )}
      </section>
      <Pulses teams={alive} meId={state.id} title={`الصامدون (${alive.length})`} />
    </div>
  );
}

function Pulses({
  teams,
  meId,
  title = 'نبض اللاعبين',
}: {
  teams: PublicTeam[];
  meId: string;
  title?: string;
}) {
  if (teams.length < 1) return null;

  return (
    <section className="mt-4 border-t border-line pt-3.5 pb-1">
      <h3 className="mb-2.5 text-[11px] font-bold tracking-[0.14em] text-muted">{title}</h3>
      <div className="grid gap-2">
        {teams.map((team) => {
          const mine = team.id === meId;
          return (
            <div
              key={team.id}
              style={stateStyle(teamLevel(team.timeMs, team.flatlined), team.timeMs)}
              className={`px-3 py-2.5 ${
                team.locked && !team.flatlined
                  ? 'frosted'
                  : mine
                    ? 'rounded-card bg-surface shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-signal)_50%,transparent)]'
                    : 'tile'
              }`}
            >
              <div className="relative mb-1.5 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <b className="truncate text-[15px] font-black">{team.name}</b>
                  {mine && <span className="shrink-0 text-[11px] font-bold text-signal">أنت</span>}
                </span>
                <span className="ink-state tnum shrink-0 text-[15px] font-black">
                  {formatTime(team.timeMs)} ث
                </span>
              </div>
              <Lane
                timeMs={team.timeMs}
                flatlined={team.flatlined}
                size="sm"
                className="relative h-7"
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * بين الجولتين: بطاقةُ اللاعب أعلى الصفحة بدل الترويسة، ثم الألسنة —
 * البطاقات (وتحتها نبضُ الجميع) أو الترتيب أو المراجعة. ولا يُكرَّر رقمٌ
 * في موضعين: ما في بطاقة اللاعب لا يُعاد تحتها.
 */
function RoundEnd({
  state,
  teams,
  last,
  reported,
  onReport,
  actions,
  live,
  restarting,
}: {
  state: TeamState;
  teams: PublicTeam[];
  last: RoomResult | null;
  reported: Set<string>;
  onReport: (questionId: string, reason: string) => void;
  actions: MenuAction[];
  live: boolean;
  restarting?: boolean;
}) {
  const [tab, setTab] = useState<'cards' | 'ranking' | 'review'>('cards');
  const reviewCount = state.review?.length ?? 0;
  /* أوّلُ استراحةٍ يراها اللاعب: جولةٌ تعريفية قصيرة فوق الواجهة نفسها */
  const [touring, setTouring] = useState(() => !tourSeen() && state.shop.open);

  /*
   * صفحةٌ واحدة تجري كلها: كان الرأس والتبويبان ثابتين ولا يجري إلا ما
   * تحتهما، فيقرأ اللاعب أسئلته في نافذةٍ ضيّقة. فصار المجرى واحداً من
   * أعلى البطاقة إلى آخر صفّ.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-3.5 pb-4">
      <PlayerCard state={state} actions={actions} live={live} restarting={restarting} />
      <BreakTimer ms={state.breakMs ?? 0} />

      <div data-tour="tabs" className="grid shrink-0 grid-cols-3 gap-2 py-4">
        <Tab on={tab === 'cards'} onClick={() => setTab('cards')}>
          البطاقات
        </Tab>
        <Tab on={tab === 'ranking'} onClick={() => setTab('ranking')}>
          الترتيب
        </Tab>
        <Tab on={tab === 'review'} onClick={() => setTab('review')}>
          المراجعة <span className="tnum">{reviewCount}</span>
        </Tab>
      </div>

      <div>
        {tab === 'ranking' ? (
          <Ranking teams={teams} meId={state.id} last={last} />
        ) : tab === 'cards' ? (
          <>
            <Shop shop={state.shop} />
            <Pulses teams={teams} meId={state.id} />
          </>
        ) : (
          <ReviewList review={state.review ?? []} reported={reported} onReport={onReport} />
        )}
      </div>

      {touring && (
        <Tour
          steps={TOUR}
          onDone={() => {
            setTouring(false);
            setTab('cards');
          }}
        />
      )}
    </div>
  );
}

/*
 * خطواتُ الجولة التعريفية — عنوانٌ وسطرٌ لكلٍّ منها، فتُقرأ في ثانيتين.
 */
const TOUR: TourStep[] = [
  { target: 'card', title: 'بطاقتك', body: 'نقاطك ومركزك وما كسبته في هذه الجولة.' },
  {
    target: 'score',
    title: 'نقاط الفوز',
    body: 'عليها الترتيب. تكسبها بالإجابة الصحيحة وبالصمود أطول من غيرك، ومن توقف نبضه لا يأخذ شيئاً.',
  },
  {
    target: 'sparks',
    title: 'الشرارات',
    body: 'عملة الشراء: ٣ لكل جولة تلعبها، و٢ لكل ٣ إجابات صحيحة متتالية.',
  },
  {
    target: 'shop',
    title: 'البطاقات',
    body: 'لمسة تشتري، ولمسة ثانية تتراجع، والضغط المطوّل يشرح البطاقة.',
  },
  { target: 'tabs', title: 'الترتيب والمراجعة', body: 'شاهد مكانك بين اللاعبين، وراجع إجاباتك.' },
];

/**
 * بطاقةُ اللاعب: اسمُه وحالُه، ومجموعُ نقاطه كبيراً وبجانبه ما كسبه في
 * الجولة صغيراً، ومركزُه وساماً في الجهة المقابلة، ثم شريطٌ واحد بشراراته
 * وإصاباته. سطحُها يتوهّج خفيفاً بلون مصيره، وخلفها مجرى نبضه — ساكناً لمن
 * توقّف وجارياً لمن صمد — فيُقرأ الحالُ قبل الرقم.
 *
 * والخياراتُ (السجلّ والصوت والخروج) في ركنها: الترويسةُ لا تُرسم بين
 * الجولتين، فالبطاقةُ هي رأسُ الصفحة.
 */
function PlayerCard({
  state,
  actions,
  live,
  restarting,
}: {
  state: TeamState;
  actions: MenuAction[];
  live: boolean;
  restarting?: boolean;
}) {
  const dead = state.flatlined;
  const tone = dead ? 'var(--color-danger)' : 'var(--color-safe)';
  const gained = state.roundPoints ?? 0;
  const note = roundNote(state);

  return (
    <section
      data-tour="card"
      className="hero-card shrink-0 px-5 pt-4 pb-4"
      style={{ '--tone': tone } as CSSProperties}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-[30%] opacity-[0.16]"
        aria-hidden="true"
      >
        <Lane
          timeMs={state.timeMs}
          flatlined={dead}
          level={dead ? 'danger' : 'safe'}
          size="md"
          className="lane-bare h-16"
        />
      </span>

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[22px] leading-tight font-black">{state.name}</h2>
          {/* الانقطاع يُقال صراحةً: شاشةٌ مقطوعة تبدو سليمة، وشراؤها يذهب سُدىً */}
          {!live ? (
            <span className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-danger">
              <OfflineIcon size={12} />
              {restarting ? 'السيرفر يتجدّد، ثوانٍ ونعود' : 'انقطع الاتصال، يُعاد الوصل'}
            </span>
          ) : (
            <span
              className="mt-1 flex items-center gap-1.5 text-[12px] font-bold"
              style={{ color: tone }}
            >
              <i
                className="size-1.5 rounded-full"
                style={{ background: tone }}
                aria-hidden="true"
              />
              {dead ? 'توقف نبضك' : 'صمدت'}
            </span>
          )}
        </div>
        <Menu actions={actions} />
      </div>

      <div className="relative mt-4 flex items-end justify-between gap-3">
        <div data-tour="score" className="flex items-end gap-2.5">
          <RollingNumber
            value={state.score}
            className="tnum text-[76px] leading-[0.82] font-black text-signal"
          />
          {/* ما كسبه في الجولة — والصفرُ لا يُكتب: لا خبرَ فيه */}
          {gained !== 0 && (
            <span
              className={`tnum pb-1.5 text-lg font-black ${gained < 0 ? 'text-danger' : 'text-safe'}`}
            >
              {gained > 0 ? `+${gained}` : `−${-gained}`}
            </span>
          )}
        </div>
        {state.teamsCount > 1 && <RankMedal rank={state.rank} of={state.teamsCount} />}
      </div>

      {(note || state.roundDuels.length > 0) && (
        <div className="relative mt-3 grid gap-1">
          {note && <p className="tnum text-[12px] font-black text-gold">{note}</p>}
          {/* المبارزة تُحسم هنا: من أصاب أكثر، وكم سُرق */}
          {state.roundDuels.map((duel, i) => (
            <p key={i} className="flex items-center gap-1.5 text-[12.5px] font-bold text-ink-2">
              <DuelIcon size={13} className="shrink-0 text-danger" />
              <span className="min-w-0 flex-1 truncate">{duelLine(duel)}</span>
              <span className="tnum shrink-0 text-muted">
                {duel.mine}:{duel.theirs}
              </span>
            </p>
          ))}
        </div>
      )}

      {/*
       * شريطٌ واحد بخانتين متساويتين، لكلٍّ أيقونتُه ورقمُه وكلمتُه في سطر،
       * على سطحٍ مصمت يُقرأ فوق التوهّج — لا حبّتان طافيتان بلا محاذاة.
       */}
      <div className="relative mt-4 grid grid-cols-2 overflow-hidden rounded-[16px] bg-ground/25 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <div data-tour="sparks" className="flex items-center justify-center gap-2 py-3">
          <SparkIcon size={18} className="shrink-0 text-warn" />
          <b className="tnum text-[22px] leading-none font-black text-warn">{state.sparks}</b>
          <span className="text-[12.5px] font-bold text-muted">{sparksWord(state.sparks)}</span>
          {(state.roundSparks ?? 0) > 0 && (
            <span className="tnum rounded-full bg-warn/15 px-1.5 py-px text-[11px] font-black text-warn">
              +{state.roundSparks}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-2 border-r border-line py-3">
          <CheckIcon size={17} strokeWidth={3} className="shrink-0 text-safe" />
          <b className="tnum text-[22px] leading-none font-black">
            {state.correct}/{state.answered}
          </b>
          <span className="text-[12.5px] font-bold text-muted">صحيحة</span>
        </div>
      </div>
    </section>
  );
}

/**
 * وسامُ المركز: الأول ذهبيٌّ بتاج، والثاني فضّي، والثالث برونزي، ومن بعدهم
 * بلون الإشارة. رقمٌ كبير في وسطه ومن كم تحته — يُقرأ بنظرة كما يُقرأ المجموع.
 */
function RankMedal({ rank, of }: { rank: number; of: number }) {
  const color =
    rank === 1
      ? 'var(--color-gold)'
      : rank === 2
        ? '#c3ccd6'
        : rank === 3
          ? '#d08a52'
          : 'var(--color-signal)';
  return (
    <div
      className="flex w-[76px] shrink-0 flex-col items-center rounded-[18px] px-2 pt-1.5 pb-2"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${color} 20%, transparent), color-mix(in srgb, ${color} 6%, transparent))`,
        boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 50%, transparent)`,
      }}
      aria-label={`المركز ${rank} من ${of}`}
    >
      {rank === 1 ? (
        <CrownIcon size={16} style={{ color }} />
      ) : (
        <span className="text-[10.5px] font-bold text-muted">المركز</span>
      )}
      <b className="tnum text-[34px] leading-none font-black" style={{ color }}>
        {rank}
      </b>
      <span className="tnum mt-0.5 text-[11px] font-bold text-muted">من {of}</span>
    </div>
  );
}

/**
 * وقتُ الشراء: كبسولةٌ تحت بطاقة اللاعب، فيها الثواني الباقية رقماً كبيراً
 * وشريطٌ رفيعٌ ينحسر معها. هادئةٌ بلون الإشارة، ثم كهرمانيّة في العشر
 * الأخيرة، ثم حمراءُ في الخمس — فيُحسّ الاستعجال قبل أن يُقرأ الرقم.
 * فإذا انقضت قالت إن المتجر أُغلق حتى تبدأ الجولة.
 */
const BREAK_TOTAL_MS = 90000;

function BreakTimer({ ms }: { ms: number }) {
  const left = useCountdown(ms);
  const secs = Math.ceil(left / 1000);
  const color =
    left === 0
      ? 'var(--color-muted)'
      : secs <= 5
        ? 'var(--color-danger)'
        : secs <= 10
          ? 'var(--color-warn)'
          : 'var(--color-signal)';
  const share = Math.min(1, left / BREAK_TOTAL_MS);

  return (
    <div
      className="relative mt-3 shrink-0 overflow-hidden rounded-[18px] bg-surface px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
      style={{ '--c': color } as CSSProperties}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[12px]"
          style={{ color: 'var(--c)', background: 'color-mix(in srgb, var(--c) 15%, transparent)' }}
        >
          <HourglassIcon size={18} />
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-bold text-ink-2">
          {left > 0 ? 'وقت الشراء' : 'انتهى وقت الشراء، الجولة تبدأ قريباً'}
        </span>
        {left > 0 && (
          <b className="tnum text-[26px] leading-none font-black" style={{ color: 'var(--c)' }}>
            {secs}
            <span className="mr-0.5 text-[13px] font-bold text-muted">ث</span>
          </b>
        )}
      </div>
      {/* الشريطُ ينحسر من اليسار إلى اليمين، كما تُقرأ الثواني تنقص */}
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-line" aria-hidden="true">
        <span
          className="absolute inset-y-0 right-0 transition-[width] duration-200 ease-linear"
          style={{ width: `${share * 100}%`, background: 'var(--c)' }}
        />
      </span>
    </div>
  );
}

/* ما سُرق في المبارزة: «نقطة» و«نقطتين» و«٥ نقاط» */
const STOLEN = { one: 'نقطة', two: 'نقطتين', few: 'نقاط', many: 'نقطة' };

/** سطرُ المبارزة كما يقرؤه طرفُه: المتحدّي غلب أو لم يغلب، والخصمُ صدّ أو سُرق منه */
function duelLine(duel: TeamState['roundDuels'][number]) {
  const pts = Math.abs(duel.points ?? 0);
  if (duel.challenger) {
    if (duel.won) return `غلبتَ ${duel.rival} وسرقت ${countOf(pts, STOLEN)}`;
    return duel.won === null ? `تعادلتَ مع ${duel.rival}، لا سرقة` : `لم تغلب ${duel.rival}`;
  }
  if (duel.won === false) return `${duel.rival} غلبك وسرق ${countOf(pts, STOLEN)}`;
  return `صددتَ مبارزة ${duel.rival}`;
}

/**
 * شاشة الانتظار وبين الجولات: الشاشة لا تُترك فارغة.
 * قراءة لحال اللاعب، ثم سجلّ جولاته أو تذكير بالقواعد في الجولة الأولى.
 */
function StandBy({
  state,
  teams,
  history,
  title,
  paused,
}: {
  state: TeamState;
  teams: PublicTeam[];
  history: RoomResult[];
  title: string;
  /** الجولة موقوفة: العلامة تتصدّر منتصف الشاشة والسجلّ يتنحّى */
  paused?: boolean;
}) {
  /*
   * قبل أول جولة لا رقمَ يُقرأ: الأرقام كلها أصفار، والعدّادات كلها ثلاثون.
   * فالانتظارُ وقتُ تعلّم — كيف تكسب، وبماذا تشتري، وماذا تشتري.
   */
  if (!paused && history.length === 0) {
    return <LobbyGuide state={state} teams={teams} title={title} />;
  }

  const mine = history
    .map((round) => ({
      round: round.round,
      award: round.awards.find((a) => a.teamId === state.id),
    }))
    .filter((r) => r.award)
    .reverse();

  /* كل ما اشتراه للجولة القادمة — لا الوقتُ والمضاعفة وحدهما */
  const ready = state.shop.cards
    .filter((c) => state.shop.pending[c.id])
    .map((c) => c.name)
    .join(' + ');

  const readout = (
    <div className="grid grid-cols-2 gap-2">
      <Readout
        value={String(state.score)}
        label={state.teamsCount > 1 ? `نقاط الفوز · المركز ${state.rank}` : 'نقاط الفوز'}
        signal
      />
      <Readout value={String(state.sparks)} label={sparksWord(state.sparks)} spark />
      <Readout value={formatTime(state.timeMs)} label="ثانية جاهزة" />
      <Readout value={String(state.correct)} label="إجابة صحيحة" />
    </div>
  );

  // الإيقاف: العلامة في منتصف الشاشة، والمجرى فوقها لا يزال يجري
  if (paused) {
    return (
      <>
        <section className="shrink-0 pt-5" style={stateStyle('safe', state.timeMs)}>
          <Lane timeMs={state.timeMs} size="md" className="h-14" />
        </section>
        <div className="flex flex-1 items-center justify-center py-8">
          <PausedMark />
        </div>
        <div className="shrink-0 pb-1">{readout}</div>
      </>
    );
  }

  return (
    <>
      <section className="shrink-0 pt-5" style={stateStyle('safe', state.timeMs)}>
        <div className="mb-3 flex items-center gap-2.5">
          <i className="blink size-2 rounded-full bg-signal" aria-hidden="true" />
          <h2 className="text-lg font-black">{title}</h2>
        </div>
        <Lane timeMs={state.timeMs} size="md" className="h-14" />
        <div className="mt-3.5">{readout}</div>
      </section>

      <div className="mt-5 flex-1 overflow-y-auto">
        {mine.length > 0 ? (
          <>
            <h3 className="mb-2 text-xs font-bold tracking-[0.14em] text-muted">سجلّ جولاتك</h3>
            <div className="grid">
              {mine.map(({ round, award }) => (
                <div
                  key={round}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2.5 last:border-0"
                >
                  <span className="tnum w-6 text-center font-light text-faint">{round}</span>
                  <span className={`text-sm ${award!.flatlined ? 'text-danger' : 'text-muted'}`}>
                    {award!.flatlined
                      ? award!.dropped
                        ? 'انقطع اتصالك'
                        : 'توقف نبضك'
                      : `صمدت ${formatTime(award!.timeMs)} ث`}
                  </span>
                  <span className="tnum font-black text-signal">+{award!.points}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {history.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-bold tracking-[0.14em] text-muted">الترتيب</h3>
            <Ranking teams={teams} meId={state.id} />
          </div>
        )}

        <Pulses teams={teams} meId={state.id} />
      </div>

      {ready && (
        <p className="shrink-0 pt-3 text-center text-xs font-medium text-muted">
          جاهزٌ لجولتك القادمة: <b className="text-signal">{ready}</b>
        </p>
      )}
    </>
  );
}

/**
 * سطرُ الحساب تحت نقاط الجولة: «٤ × ٢ = ٨» للمضاعفة، و«+٥ مبارزة» لمن
 * غلب، و«المضاعفة احترقت» لمن راهن وسكن نبضه — فيعرف لماذا صفر.
 * أرقامٌ غربية كجيرانها في البلاطة — والمزجُ في سطرٍ واحد يُتعتع.
 */
function roundNote(state: TeamState) {
  const d = state.roundDuelPoints;
  const duel = d > 0 ? ` + ${d}` : d < 0 ? ` − ${-d}` : '';
  if (state.roundDoubled && state.roundBase !== null) {
    return `${state.roundBase} × 2${duel} = ${state.roundPoints}`;
  }
  if (duel && state.roundPoints !== null) {
    return `${state.roundPoints - d}${duel} مبارزة`;
  }
  return undefined;
}

/**
 * شاشةُ الانتظار قبل أول جولة: ثلاثةُ مفاتيح للعبة في ثلاث بطاقات —
 * نقاطُ الفوز (بلون الإشارة) والشرارات (بلون البرق) والبطاقات (شريطٌ
 * يُسحب بألوانها). كلُّ قاعدةٍ سطرٌ ونتيجتُه في قرصٍ على طرفه، فتُقرأ
 * القاعدةُ بالعين قبل الكلمات. وتحتها من انضمّ — يتكاثرون والقاعةُ تمتلئ.
 */
function LobbyGuide({
  state,
  teams,
  title,
}: {
  state: TeamState;
  teams: PublicTeam[];
  title: string;
}) {
  const byId = new Map(state.shop.cards.map((c) => [c.id, c]));
  const order = CARD_GROUPS.flatMap((g) => g.cards);
  const cards = order
    .map((id) => byId.get(id))
    .filter((c) => !!c)
    .sort((a, b) => b.price - a.price || order.indexOf(a.id) - order.indexOf(b.id));
  const others = teams.filter((t) => t.id !== state.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-5 pb-2">
      <div className="mb-4 flex shrink-0 items-center gap-2.5">
        <i className="blink size-2 rounded-full bg-signal" aria-hidden="true" />
        <h2 className="flex-1 text-lg font-black">{title}</h2>
      </div>

      <GuideTitle />

      <section className="guide-card" style={{ '--g': 'var(--color-signal)' } as CSSProperties}>
        <GuideHead icon={<TrophyIcon size={20} />} title="نقاط الفوز" />
        <GuideRule
          icon={<CheckIcon size={15} strokeWidth={3} />}
          text="كل إجابة صحيحة"
          value="+١"
        />
        <GuideRule icon={<HeartIcon size={15} />} text="اصمد أطول من غيرك" value="حتى +٥" />
        <GuideRule icon={<FlatlineIcon size={15} />} text="إن توقف نبضك" value="٠" dim />
      </section>

      <section className="guide-card mt-3" style={{ '--g': 'var(--color-warn)' } as CSSProperties}>
        <GuideHead icon={<SparkIcon size={20} />} title="الشرارات" />
        <GuideRule icon={<PulseMark size={15} />} text="كل جولة تلعبها" value="⚡٣" />
        <GuideRule
          icon={
            <span className="flex gap-0.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <i key={i} className="size-1.5 rounded-full bg-[var(--g)]" />
              ))}
            </span>
          }
          text="٣ إجابات صحيحة متتالية"
          value="⚡٢"
        />
      </section>

      <section className="guide-card mt-3" style={{ '--g': 'var(--color-safe)' } as CSSProperties}>
        <GuideHead icon={<CardsIcon size={20} />} title="البطاقات" />
        <CardStrip count={cards.length}>
          {cards.map((card) => {
            const look = CARD_LOOK[card.id];
            return (
              <div
                key={card.id}
                data-strip-card
                className="shop-tile flex w-[64%] max-w-[230px] shrink-0 snap-start flex-col gap-1.5 p-3.5"
                style={{ '--c': look.color } as CSSProperties}
              >
                <look.Icon
                  size={64}
                  className="pointer-events-none absolute -bottom-3 -left-3 -rotate-12 opacity-[0.12]"
                  style={{ color: 'var(--c)' }}
                />
                <span className="flex items-center justify-between">
                  <span
                    className="flex size-8 items-center justify-center rounded-[10px]"
                    style={{
                      color: 'var(--c)',
                      background: 'color-mix(in srgb, var(--c) 18%, transparent)',
                    }}
                  >
                    <look.Icon size={17} />
                  </span>
                  <span
                    className="tnum flex items-center gap-0.5 text-[13px] font-black"
                    style={{ color: 'var(--c)' }}
                  >
                    <SparkIcon size={11} />
                    {card.price}
                  </span>
                </span>
                <b className="relative text-[14px] font-black">{card.name}</b>
                <span className="relative text-[12.5px] leading-snug text-ink-2">
                  {look.effect}
                </span>
              </div>
            );
          })}
        </CardStrip>
      </section>

      <RoundEndsCard players={teams.filter((t) => !t.waiting).length} />

      {others.length > 0 && (
        <section className="mt-5 shrink-0">
          <h3 className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted">في القاعة</h3>
          <div className="flex flex-wrap gap-1.5">
            {others.map((t) => (
              <span
                key={t.id}
                className="rise-in rounded-full bg-surface-2 px-3 py-1 text-[13px] font-bold"
              >
                {t.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * «متى تنتهي الجولة؟» — سؤالٌ وجوابُه صورة: مربّعاتُ نبضات الجولة كما
 * ستراها في ترويستك، وتحتها الجملة بالعدد كما هو الآن. والعددُ يتبع
 * القاعة: ثُمنُ من انضمّ، فإن كانوا ثمانيةً فأقلّ فهو أوّلُ من يتوقّف.
 */
function RoundEndsCard({ players }: { players: number }) {
  const lives = livesFor(players);
  return (
    <section
      className="guide-card mt-3 flex items-center gap-3 !pb-3.5"
      style={{ '--g': 'var(--color-signal)' } as CSSProperties}
    >
      <div className="min-w-0 flex-1">
        <b className="block text-[15px] font-black">متى تنتهي الجولة؟</b>
        <span className="tnum mt-0.5 block text-[13.5px] font-bold text-ink-2">
          {lives === 1 ? 'إذا توقف نبض أول لاعب' : `إذا توقف نبض ${playersWord(lives)}`}
        </span>
      </div>
      <LivesBar lives={lives} fallen={[]} size="sm" className="shrink-0" />
    </section>
  );
}

/**
 * عنوانُ التوجيهات: نبضتان على طرفيه تخفقان نحو الكلمة — لافتةٌ من جنس
 * اللعبة لا خطٌّ فاصل. والطرفُ الأيسر مرآةُ الأيمن.
 */
function GuideTitle() {
  const beat = (flip: boolean) => (
    <svg
      viewBox="0 0 120 20"
      preserveAspectRatio="none"
      className={`h-5 min-w-0 flex-1 text-signal ${flip ? '-scale-x-100' : ''}`}
      aria-hidden="true"
    >
      <path
        d="M0 10H70L76 3L82 17L88 10H120"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.75"
      />
    </svg>
  );
  return (
    <div className="mb-3 flex shrink-0 items-center gap-3">
      {beat(false)}
      <span className="shrink-0 text-[13px] font-black tracking-[0.18em] text-signal">
        توجيهات اللعبة
      </span>
      {beat(true)}
    </div>
  );
}

/**
 * شريطُ البطاقات يُسحب أفقياً بلا شريط تمرير: البطاقةُ أعرضُ من نصف الشاشة
 * فتطلّ التاليةُ من الطرف — وهو ما يقول «اسحب» بلا كلمة — والأولى مبتعدةٌ
 * عن الحافّة بقدر هامش البطاقة. وتحته نقاطٌ تتبع موضعك في الشريط.
 */
function CardStrip({ count, children }: { count: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const onScroll = () => {
    const el = box.current;
    const card = el?.querySelector<HTMLElement>('[data-strip-card]');
    if (!el || !card) return;
    /* البطاقةُ الأخيرة لا تبلغ أوّل الشريط: فبلوغُ آخره هو موضعُها */
    const end = Math.abs(el.scrollLeft) >= el.scrollWidth - el.clientWidth - 4;
    setAt(
      end
        ? count - 1
        : Math.min(count - 1, Math.round(Math.abs(el.scrollLeft) / (card.offsetWidth + 10))),
    );
  };
  const go = (i: number) => {
    const cards = box.current?.querySelectorAll<HTMLElement>('[data-strip-card]');
    cards?.[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    setAt(i);
  };
  return (
    <>
      <div
        ref={box}
        onScroll={onScroll}
        className="-mx-4 mt-1 flex scroll-px-4 snap-x snap-mandatory gap-2.5 no-scrollbar overflow-x-auto px-4 pb-1"
      >
        {children}
      </div>
      <div className="flex justify-center gap-0.5 pt-1.5 pb-0.5">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => go(i)}
            aria-label={`البطاقة ${i + 1}`}
            className="flex h-6 items-center px-1"
          >
            <i
              className={`block h-1.5 rounded-full transition-all ${i === at ? 'w-4 bg-[var(--g)]' : 'w-1.5 bg-line-2'}`}
            />
          </button>
        ))}
      </div>
    </>
  );
}

function GuideHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span
        className="flex size-9 items-center justify-center rounded-[12px]"
        style={{ color: 'var(--g)', background: 'color-mix(in srgb, var(--g) 16%, transparent)' }}
      >
        {icon}
      </span>
      <b className="flex-1 text-[17px] font-black">{title}</b>
    </div>
  );
}

function GuideRule({
  icon,
  text,
  value,
  dim,
}: {
  icon: React.ReactNode;
  text: string;
  value: string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-2.5">
      <span className="flex w-6 justify-center text-muted">{icon}</span>
      <span className="flex-1 text-[14px] font-bold text-ink-2">{text}</span>
      <span
        className="tnum min-w-12 rounded-full px-2.5 py-1 text-center text-[14px] font-black"
        style={
          dim
            ? { color: 'var(--color-muted)', background: 'var(--color-surface-2)' }
            : { color: 'var(--g)', background: 'color-mix(in srgb, var(--g) 14%, transparent)' }
        }
      >
        {value}
      </span>
    </div>
  );
}

function Readout({
  value,
  label,
  signal,
  danger,
  spark,
  note,
}: {
  value: string;
  label: string;
  signal?: boolean;
  danger?: boolean;
  /** بلون الشرارة — عملة الشراء */
  spark?: boolean;
  /** سطرٌ يشرح الرقم — كمعادلة المضاعفة تحت نقاط الجولة */
  note?: string;
}) {
  return (
    <div className="tile px-3.5 py-3">
      <div
        className={`tnum flex items-center gap-1 text-2xl leading-none font-black ${
          danger ? 'text-danger' : signal ? 'text-signal' : spark ? 'text-warn' : ''
        }`}
      >
        {spark && <SparkIcon size={18} />}
        {value}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        {note && <span className="tnum text-[11px] font-black text-gold">{note}</span>}
      </div>
    </div>
  );
}

function Tab({
  on,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-chip py-2.5 text-center text-[15px] font-black transition disabled:opacity-40 ${
        on
          ? 'bg-signal-2 text-signal shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_45%,transparent)]'
          : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)]'
      }`}
    >
      {children}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center px-6">{children}</div>;
}

/**
 * السيرفر يبثّ كل 250 مللي — نُكمل بينها محلياً حتى يبدو العداد سلساً،
 * مع تصحيح فوري كلما وصلت قيمة جديدة من السيرفر.
 */
function useSmoothTime(serverMs: number, running: boolean) {
  const [shown, setShown] = useState(serverMs);
  const anchor = useRef({ ms: serverMs, at: performance.now() });

  useEffect(() => {
    anchor.current = { ms: serverMs, at: performance.now() };
  }, [serverMs]);

  useEffect(() => {
    if (!running) return setShown(serverMs);
    let frame = 0;
    // العدّاد يعرض أعشار الثانية، فإعادة الرسم عشر مرات في الثانية تكفي —
    // والمجرى يتولّى سلاسته بنفسه على مستوى الإطار
    const loop = () => {
      const { ms, at } = anchor.current;
      const next = Math.max(0, ms - (performance.now() - at));
      setShown((prev) => (Math.round(prev / 100) === Math.round(next / 100) ? prev : next));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return shown;
}

/** نبضة مسموعة تتبع الإيقاع نفسه الذي يجري به المخطّط */
function useHeartbeat(shown: number, running: boolean) {
  const last = useRef(0);
  useEffect(() => {
    if (!running) return;
    const interval = beatSeconds(shown) * 1000;
    const now = performance.now();
    if (now - last.current >= interval) {
      last.current = now;
      playBeat();
    }
  }, [shown, running]);
}

/** ثلاث مراحل بعد انتهاء الجولة: الستارة تُطبق، ثم تُقصّ وتنفرج، ثم النتيجة */
const CURTAIN_HOLD_MS = 900;

function useEndPhase(over: boolean) {
  const [phase, setPhase] = useState<'live' | 'fading' | 'leaving' | 'done'>('live');

  useEffect(() => {
    if (!over) return setPhase('live');
    setPhase('fading');
    const cut = setTimeout(() => setPhase('leaving'), CURTAIN_HOLD_MS);
    const done = setTimeout(() => setPhase('done'), CURTAIN_HOLD_MS + CURTAIN_OUT_MS);
    return () => {
      clearTimeout(cut);
      clearTimeout(done);
    };
  }, [over]);

  return phase;
}

/*
 * صوتُ السكون يُقال مرّةً في كل جولة لا مرّةً في العمر.
 *
 * كانت الرايةُ تُرفع عند أول توقّفٍ ولا تُنزَّل أبداً، فيسمع اللاعب الصفير
 * في جولته الأولى ثم لا يسمعه بقيّة المسابقة — والغياب يُقرأ عطلاً. وهي
 * تُنزَّل حين يعود النبض: بدءُ الجولة يردّ flatlined إلى false.
 */
function useFlatlineSound(flatlined: boolean) {
  const played = useRef(false);
  useEffect(() => {
    if (!flatlined) {
      played.current = false;
      return;
    }
    if (played.current) return;
    played.current = true;
    playFlatline();
    navigator.vibrate?.([200, 80, 400]);
  }, [flatlined]);
}

/**
 * يُبقي الشاشة مضاءةً ما دام on (Screen Wake Lock).
 *
 * والقفلُ يسقط وحده إذا غابت الصفحة، فيُطلب من جديد عند عودتها. وعلى
 * جهازٍ لا يدعمه (iOS قبل 16.4) لا شيء يُكسر — يبقى التنبيه المكتوب.
 */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const take = async () => {
      if (done || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (done) void lock.release();
      } catch {
        /* رفضه المتصفح (بطّاريةٌ منخفضة مثلاً) — فالتنبيه وحده */
      }
    };
    void take();
    document.addEventListener('visibilitychange', take);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [on]);
}

/**
 * ترتيبُ نقاط الفوز: من الأول إلى الأخير، والمتساويان في مركزٍ واحد،
 * وصفُّك مُضاءٌ فيه. هو الجواب الواضح عن «أين أنا؟» — والعدّادات تقول
 * من صمد في الجولة، أما هذا فيقول من يتقدّم في اللعبة.
 */
function Ranking({
  teams,
  meId,
  last,
}: {
  teams: PublicTeam[];
  meId: string;
  last?: RoomResult | null;
}) {
  const sorted = [...teams]
    .filter((t) => !t.waiting)
    .sort((a, b) => b.score - a.score || (b.totalCorrect ?? 0) - (a.totalCorrect ?? 0));
  if (sorted.length === 0) return null;
  return (
    <section className="grid gap-1.5">
      {sorted.map((team, i) => {
        const mine = team.id === meId;
        const rank = team.rank ?? i + 1;
        const gained = last?.awards.find((a) => a.teamId === team.id)?.points;
        return (
          <div
            key={team.id}
            className={`grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-2.5 ${
              mine
                ? 'rounded-card bg-surface shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-signal)_50%,transparent)]'
                : 'tile'
            }`}
          >
            <span
              className={`tnum text-center text-lg ${rank === 1 ? 'font-black text-gold' : 'font-light text-faint'}`}
            >
              {rank}
            </span>
            <span className="flex min-w-0 items-baseline gap-1.5">
              <b className="truncate text-[15px] font-black">{team.name}</b>
              {mine && <span className="shrink-0 text-[11px] font-bold text-signal">أنت</span>}
            </span>
            <span className="tnum text-xs font-bold text-safe">{gained ? `+${gained}` : ''}</span>
            <b className="tnum min-w-8 text-left text-lg font-black text-signal">{team.score}</b>
          </div>
        );
      })}
    </section>
  );
}
