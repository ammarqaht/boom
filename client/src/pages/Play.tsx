import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, onWake, socket, useConnection, useFreshBuild, watchSession } from '../lib/socket';
import {
  clearTeamSession as clearSession,
  deviceId,
  loadTeamSession as loadSession,
  saveTeamSession as saveSession,
} from '../lib/session';
import { projectTeam, teamTicking, useProjected } from '../lib/clock';
import type { CardId, PublicTeam, Question, RoomResult, RoomState, TeamState } from '../lib/types';
import { CARD_LOOK } from '../lib/cards';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  FormPage,
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
  OfflineIcon,
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
import { playBeat, playCorrect, playFlatline, playWrong, unlockAudio } from '../lib/sound';


/** كم يبقى الصواب مُضاءً بعد الخطأ — أقلّ من ثانية فالوقت يجري */
const REVEAL_MS = 900;

type Reveal = { question: Question; right: number; chosen: number };
type ResultPayload = { isCorrect: boolean; questionId: string; answer: number; shielded?: boolean };

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
  const onResult = ({ isCorrect, questionId, answer: right, shielded }: ResultPayload) => {
    if (shielded) {
      const look = CARD_LOOK.shield;
      toast('الدرع صدّ الخصم', { tone: look.tone, icon: <look.Icon size={19} /> });
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
        </Card>
      </FormPage>
    );
  }

  const actions: MenuAction[] = [
    {
      label: 'سجل الجولات',
      icon: <HistoryIcon size={17} />,
      onClick: () => setShowHistory(true),
    },
    {
      label: 'الخروج من اللعبة',
      icon: <ExitIcon size={17} />,
      hold: true,
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
        teams={room?.teams ?? []}
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
            {state.shop.pending.double && (
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
        <div className="text-center leading-none">
          <RollingNumber value={state.score} className="tnum text-2xl font-black text-signal" />
          <div className="mt-0.5 text-[11px] font-medium text-muted">نقطة</div>
        </div>
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
      <StandBy
        state={state}
        teams={teams}
        history={history}
        title="انتظر الجولة القادمة"
      />,
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

  // نهاية الجولة: قراءة واحدة ثم لسان واحد مفتوح
  if (over) {
    return frame(<RoundEnd state={state} teams={teams} reported={reported} onReport={onReport} />);
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
          {state.blackout ? (
            <>
              <div className="tnum leading-[0.85] font-black tracking-[-0.02em] text-[78px] text-faint">
                ؟
              </div>
              <p className="mt-2 text-[13px] font-bold text-muted">
                عتّم عليك {state.blackoutBy}
              </p>
              <div className="mt-2.5 h-14 rounded-card bg-sunk" />
            </>
          ) : (
            <>
              <div
                className={`ink-state tnum leading-[0.85] font-black tracking-[-0.02em] transition-[font-size] duration-300 ${
                  dying ? 'beat-danger text-[86px]' : 'text-[78px]'
                }`}
              >
                {formatTime(shown)}
              </div>
              <p className="mt-2 text-[13px] font-medium text-muted">ثانية من نبضك</p>
              <Lane timeMs={state.timeMs} running size="md" className="mt-2.5 h-14" />
            </>
          )}
          <EffectChips state={state} />
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
    </>,
  );
}

/**
 * نبض بقية اللاعبين بعد انتهاء الجولة: لا تكفي اللاعبَ معرفةُ عدّاده
 * وحده — فالنقاط لمن بقي وقته أطول. اسمٌ ووقتٌ على طرفي سطر، وتحتهما
 * مجراه. أما أثناء السؤال فلا مكان لها: النظر كله للسؤال.
 */
function Pulses({ teams, meId }: { teams: PublicTeam[]; meId: string }) {
  if (teams.length < 2) return null;

  return (
    <section className="mt-4 border-t border-line pt-3.5 pb-1">
      <h3 className="mb-2.5 text-[11px] font-bold tracking-[0.14em] text-muted">نبض اللاعبين</h3>
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
 * نهاية الجولة: النتيجة قراءة من ثلاثة أرقام، ثم لسانان —
 * البطاقات أو المراجعة. وتحت البطاقات نبضُ الجميع، فهو حصيلة الجولة
 * لا لساناً مستقلاً: تُقرأ مع ما ستشتريه، لا في مكانٍ آخر.
 */
function RoundEnd({
  state,
  teams,
  reported,
  onReport,
}: {
  state: TeamState;
  teams: PublicTeam[];
  reported: Set<string>;
  onReport: (questionId: string, reason: string) => void;
}) {
  const [tab, setTab] = useState<'cards' | 'review'>('cards');
  const dead = state.flatlined;
  /*
   * على شاشة اللاعب نفسه يكون السكون أحمر صريحاً لا رمادياً كما على
   * شاشة العرض. ومن صمد فلونه أخضر مهما بقي له — فقد انتهى الخطر، ولا
   * معنى لأن تُقرأ «نبضك مستمر» بلون الإنذار.
   */
  const level = dead ? 'danger' : 'safe';
  const reviewCount = state.review?.length ?? 0;

  /*
   * من أسكن نبضُه الجولة؟ يُسمّى.
   *
   * «صمدت إلى آخر الجولة» خبرٌ عن نفسك تعرفه من العنوان فوقه. والجولة
   * تنتهي على الجميع بتوقّف نبضٍ واحد، فالخبرُ الذي ينقصك: نبضُ مَن.
   * وقد يسكن نبضان في النبضة الواحدة، فالصيغةُ تحتملهما.
   */
  /* من سكن منقطعاً لم يُنهِ الجولة — فلا يُسمّى فيمن أنهاها */
  const stopped = teams.filter((t) => t.flatlined && !t.dropped && !t.waiting && t.id !== state.id);
  const names = stopped.map((t) => t.name);
  const lead = dead
    ? null
    : names.length === 0
      ? null
      : names.length === 1
        ? `${names[0]} توقّف نبضه`
        : names.length === 2
          ? `${names[0]} و${names[1]} توقّف نبضهما`
          : `${names[0]} و${names.length - 1} غيره توقّف نبضهم`;

  /*
   * صفحةٌ واحدة تجري كلها: كان الرأس والتبويبان ثابتين ولا يجري إلا ما
   * تحتهما، فيقرأ اللاعب أسئلته في نافذةٍ ضيّقة بينما نصف الشاشة مشغولٌ
   * بأرقامٍ قرأها. فصار المجرى واحداً من أعلى اللوحة إلى آخر بطاقة.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
      {/* المسافاتُ أوسع: ستُّ بلاطاتٍ متلاصقةٍ تُقرأ كتلةً واحدة لا ستّاً */}
      <section
        className="shrink-0 border-b border-line py-5"
        style={stateStyle(level, state.timeMs)}
      >
        <Lane
          timeMs={state.timeMs}
          flatlined={dead}
          level={level}
          size="md"
          className="mb-4 h-11"
        />
        <h2 className="ink-state text-2xl font-black">{dead ? 'توقف نبضك' : 'نبضك مستمر'}</h2>
        {lead && <p className="mt-1.5 text-sm font-medium text-muted">{lead}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {/* العدّاد لا يغيب وإن سكن النبض: صفرٌ خبرٌ، والشرطة لا تقول شيئاً */}
          <Readout value={formatTime(state.timeMs)} label="ثانية بقيت" danger={dead} />
          <Readout
            value={state.roundPoints === null ? '0' : `+${state.roundPoints}`}
            label="نقاط الجولة"
            signal
            /*
             * المضاعفةُ تُرى في حسابها لا في حصيلتها.
             * من دفع أربع نقاطٍ في بطاقةٍ ثم قرأ «+٨» لا يعرف أربحت له أم
             * لا. والمعادلةُ تقول: هذه ثمرتها.
             */
            note={
              /* أرقامٌ غربية كجيرانها في البلاطة — والمزجُ في سطرٍ واحد يُتعتع */
              state.roundDoubled && state.roundBase !== null
                ? `${state.roundBase} × 2 = ${state.roundPoints}`
                : undefined
            }
          />
          <Readout value={`${state.correct}/${state.answered}`} label="إجابة صحيحة" />
          <Readout value={String(state.score)} label="نقاط" />
        </div>
      </section>

      <div className="grid shrink-0 grid-cols-2 gap-2 py-5">
        <Tab on={tab === 'cards'} onClick={() => setTab('cards')}>
          البطاقات
        </Tab>
        <Tab on={tab === 'review'} onClick={() => setTab('review')}>
          المراجعة <span className="tnum">{reviewCount}</span>
        </Tab>
      </div>

      <div>
        {tab === 'cards' ? (
          <>
            <Shop shop={state.shop} score={state.score} />
            {reviewCount > 0 && (
              <div className="px-3 pt-6 pb-1">
                <Button variant="ghost" className="w-full" onClick={() => setTab('review')}>
                  راجِع أسئلة الجولة
                </Button>
              </div>
            )}
            <Pulses teams={teams} meId={state.id} />
          </>
        ) : (
          <ReviewList review={state.review ?? []} reported={reported} onReport={onReport} />
        )}
      </div>
    </div>
  );
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
  const mine = history
    .map((round) => ({
      round: round.round,
      award: round.awards.find((a) => a.teamId === state.id),
    }))
    .filter((r) => r.award)
    .reverse();

  const ready = [state.shop.pending.time && 'وقت إضافي', state.shop.pending.double && 'مضاعفة ×٢']
    .filter(Boolean)
    .join(' + ');

  const readout = (
    <div className="grid grid-cols-2 gap-2">
      <Readout value={formatTime(state.timeMs)} label="ثانية جاهزة" />
      <Readout value={String(state.score)} label="نقاط" signal />
      <Readout value={String(state.answered)} label="سؤالاً أجبت" />
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

function Readout({
  value,
  label,
  signal,
  danger,
  note,
}: {
  value: string;
  label: string;
  signal?: boolean;
  danger?: boolean;
  /** سطرٌ يشرح الرقم — كمعادلة المضاعفة تحت نقاط الجولة */
  note?: string;
}) {
  return (
    <div className="tile px-3.5 py-3">
      <div
        className={`tnum text-2xl leading-none font-black ${
          danger ? 'text-danger' : signal ? 'text-signal' : ''
        }`}
      >
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

function EffectChips({ state }: { state: TeamState }) {
  const chips: { key: string; card: CardId; label: string }[] = [];
  if ((state.truceMs ?? 0) > 0) {
    chips.push({ key: 'truce', card: 'truce', label: `هدنة ${Math.ceil((state.truceMs ?? 0) / 1000)}` });
  }
  if ((state.shieldLeft ?? 0) > 0) {
    chips.push({ key: 'shield', card: 'shield', label: `درع ×${state.shieldLeft}` });
  }
  if ((state.reviveLeft ?? 0) > 0) chips.push({ key: 'revive', card: 'revive', label: 'صاعق جاهز' });
  if (chips.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
      {chips.map(({ key, card, label }) => {
        const look = CARD_LOOK[card];
        return (
          <span
            key={key}
            className={`tnum flex items-center gap-1.5 rounded-chip bg-surface-2 px-2.5 py-1 text-[12px] font-black ${look.ink}`}
          >
            <look.Icon size={13} />
            {label}
          </span>
        );
      })}
    </div>
  );
}
