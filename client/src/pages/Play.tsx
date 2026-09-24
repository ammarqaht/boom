import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, ask } from '../lib/socket';
import type { PublicTeam, Question, RoomResult, RoomState, TeamState } from '../lib/types';
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
  formatTime,
  stateStyle,
  teamLevel,
  useTheme,
  type MenuAction,
} from '../components/ui';
import { ExitIcon, HistoryIcon, MoonIcon, OfflineIcon, SunIcon } from '../components/icons';
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

const SESSION_KEY = 'nabda:team';

/** كم يبقى الصواب مُضاءً بعد الخطأ — أقلّ من ثانية فالوقت يجري */
const REVEAL_MS = 900;

type Reveal = { question: Question; right: number; chosen: number };
type ResultPayload = { isCorrect: boolean; questionId: string; answer: number };

type Session = { code: string; teamId: string; token: string };

function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export default function Play() {
  const [params] = useSearchParams();
  const { theme, toggle } = useTheme('user');
  const [state, setState] = useState<TeamState | null>(null);
  /* حالُ الوصل: شاشةٌ مقطوعة لا تلعب، فلا تُترك تبدو سليمة */
  const [live, setLive] = useState(() => socket.connected);
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
      localStorage.removeItem(SESSION_KEY);
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

  // الرجوع التلقائي بعد انقطاع النت أو تحديث الصفحة
  /*
   * الجلسةُ تُقرأ عند كل وصل لا عند التركيب: من انضمّ في هذه الجلسة لم
   * تكن له جلسةٌ محفوظة وقت التركيب، فلم يُسجَّل مستمعُ الاتصال — فإذا
   * انقطع نتُه لحظةً عاد بسوكِتٍ غريب عن الغرفة: لا نبضَ يصله ولا إجابة
   * تصل عنه، والشاشةُ ساكنةٌ لا تقول شيئاً.
   */
  useEffect(() => {
    const rejoin = async () => {
      const session = loadSession();
      if (!session) return;
      const res = await ask<{ state: TeamState }>('team:rejoin', session);
      if (!res.ok) return localStorage.removeItem(SESSION_KEY);
      /* لعبةٌ انتهت لا يُعاد إليها: الجلسة تُطوى ويبدأ اللاعب من الباب */
      if (res.state.status === 'finished') return localStorage.removeItem(SESSION_KEY);
      setState(res.state);
    };
    const onConnect = () => {
      setLive(true);
      void rejoin();
    };
    const onDrop = () => setLive(false);

    /* حدث connect قد يسبق تسجيل المستمع — فتُقرأ الحال لا تُنتظر */
    setLive(socket.connected);
    void rejoin();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDrop);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDrop);
    };
  }, []);

  // صوت النتيجة + وميض الشاشة
  useEffect(() => {
    const onResult = ({ isCorrect, questionId, answer: right }: ResultPayload) => {
      setFlash({ key: Date.now(), correct: isCorrect });
      setLockedFor(null);
      (isCorrect ? playCorrect : playWrong)();

      // الصواب يُكشف عند الخطأ وحده: الإصابة تُكافأ بالمضيّ لا بالانتظار
      const last = asked.current;
      if (!isCorrect && last && last.question.id === questionId) {
        setReveal({ question: last.question, right, chosen: last.choice });
      }
    };
    socket.on('team:result', onResult);
    return () => {
      socket.off('team:result', onResult);
    };
  }, []);

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
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        code: code.trim().toUpperCase(),
        teamId: res.teamId,
        token: res.token,
      }),
    );
    setState(res.state);
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
    socket.emit('team:answer', { questionId: state.question.id, choice });
  };

  if (!state) {
    return (
      <FormPage
        title="انضمام لاعب"
        lead="أدخل رمز الغرفة الظاهر على شاشة القاعة. جولتك ثلاثون ثانية لا أكثر — والإجابة الصحيحة وحدها تُطيلها."
      >
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
      label: theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الغامق',
      icon: theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />,
      onClick: toggle,
    },
    {
      label: 'سجل الجولات',
      icon: <HistoryIcon size={17} />,
      onClick: () => setShowHistory(true),
    },
    {
      label: 'الخروج من اللعبة',
      icon: <ExitIcon size={17} />,
      hold: 'تخرج من الغرفة وتحتاج إلى الانضمام من جديد.',
      onClick: () => {
        localStorage.removeItem(SESSION_KEY);
        location.href = '/';
      },
    },
  ];

  return (
    <>
      <TeamScreen
        state={state}
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
}: {
  state: TeamState;
  actions: MenuAction[];
  live: boolean;
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
                ×٣
              </span>
            )}
          </div>
          {/* الانقطاع يُقال صراحةً: شاشةٌ مقطوعة تبدو سليمة، وإجاباتُها تذهب سُدىً */}
          {live ? (
            <div className="tnum text-[11px] font-medium tracking-[0.08em] text-muted">
              الجولة {state.round}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-danger">
              <OfflineIcon size={12} />
              انقطع الاتصال — يُعاد الوصل
            </div>
          )}
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
    localStorage.removeItem(SESSION_KEY);
    location.href = to;
  };

  const frame = (children: React.ReactNode) => (
    <div className="relative flex h-full flex-col px-3.5 pb-4">
      <TopBar state={state} actions={actions} live={live} />
      {children}
    </div>
  );

  // انتهت اللعبة كلياً — الأوائل على المدرّج
  if (state.status === 'finished' && state.standings) {
    return frame(
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-5">
        {/* m-auto يوسّط اللوحة حين تقصر، ولا يقصّ أعلاها حين تطول */}
        <div className="m-auto w-full">
          <Standings standings={state.standings} meId={state.id} rounds={history.length} />
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

  if (state.status === 'countdown') {
    return frame(
      <>
        <Centered>
          <p className="font-medium text-muted">استعدّ…</p>
        </Centered>
        <CountdownGate ms={state.countdownMs} on />
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
        title={`بانتظار بدء الجولة ${state.round}`}
        note="أبقِ هذه الصفحة مفتوحة ولا تُحدّثها"
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
          <div
            className={`ink-state tnum leading-[0.85] font-black tracking-[-0.02em] transition-[font-size] duration-300 ${
              dying ? 'beat-danger text-[86px]' : 'text-[78px]'
            }`}
          >
            {formatTime(shown)}
          </div>
          <p className="mt-2 text-[13px] font-medium text-muted">ثانية من نبضك</p>
          <Lane timeMs={state.timeMs} running size="md" className="mt-2.5 h-14" />
        </section>

        {/*
         * السؤال وخياراته كتلةٌ واحدة في وسط ما تبقّى من الشاشة: صندوق
         * السؤال بقدر ثلاثة أسطر (يتمدّد للأطول ولا ينكمش للأقصر، فلا
         * يقفز التخطيط بين سؤالٍ وآخر)، وتحته البطاقات الأربع.
         */}
        {/* pb يرفع الكتلة فوق المنتصف قليلاً: البصر يستقرّ أعلى من مركز الشاشة */}
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2.5 pt-10 pb-8">
          <div className="tile flex min-h-[7.5rem] shrink-0 items-center justify-center px-4 py-4">
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
   * صفحةٌ واحدة تجري كلها: كان الرأس والتبويبان ثابتين ولا يجري إلا ما
   * تحتهما، فيقرأ اللاعب أسئلته في نافذةٍ ضيّقة بينما نصف الشاشة مشغولٌ
   * بأرقامٍ قرأها. فصار المجرى واحداً من أعلى اللوحة إلى آخر بطاقة.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
      <section
        className="shrink-0 border-b border-line py-4"
        style={stateStyle(level, state.timeMs)}
      >
        <Lane
          timeMs={state.timeMs}
          flatlined={dead}
          level={level}
          size="md"
          className="mb-3.5 h-11"
        />
        <h2 className="ink-state text-2xl font-black">{dead ? 'توقف نبضك' : 'نبضك مستمر'}</h2>
        <p className="mt-1 text-sm font-medium text-muted">
          {dead ? 'شدّ حيلك في الجولة القادمة' : 'صمدت إلى آخر الجولة'}
        </p>

        <div className="mt-3.5 grid grid-cols-2 gap-2">
          {/* العدّاد لا يغيب وإن سكن النبض: صفرٌ خبرٌ، والشرطة لا تقول شيئاً */}
          <Readout value={formatTime(state.timeMs)} label="ثانية بقيت" danger={dead} />
          <Readout
            value={state.roundPoints === null ? '0' : `+${state.roundPoints}`}
            label="نقاط الجولة"
            signal
          />
          <Readout value={`${state.correct}/${state.answered}`} label="إجابة صحيحة" />
          <Readout value={String(state.score)} label="مجموعك" />
        </div>
      </section>

      <div className="grid shrink-0 grid-cols-2 gap-1.5 py-3.5">
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
              <div className="px-3 pt-4 pb-1">
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
  note,
  paused,
}: {
  state: TeamState;
  teams: PublicTeam[];
  history: RoomResult[];
  title: string;
  note: string;
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

  const ready = [state.shop.pending.time && 'وقت إضافي', state.shop.pending.double && 'مضاعفة ×٣']
    .filter(Boolean)
    .join(' + ');

  const readout = (
    <div className="grid grid-cols-2 gap-2">
      <Readout value={formatTime(state.timeMs)} label="ثانية جاهزة" />
      <Readout value={String(state.score)} label="مجموعك" signal />
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
          <PausedMark note="عدّادك متوقّف تماماً — لا تُغلق الصفحة ولا تُحدّثها" />
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
                    {award!.flatlined ? 'توقف نبضك' : `صمدت ${formatTime(award!.timeMs)} ث`}
                  </span>
                  <span className="tnum font-black text-signal">+{award!.points}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3 className="mb-2 text-xs font-bold tracking-[0.14em] text-muted">تذكير سريع</h3>
            <ul className="grid gap-2.5">
              {[
                'الإجابة الصحيحة تضيف خمس ثوانٍ إلى نبضك، والخطأ يخصم ثلاثاً.',
                'لا تنتظر أحداً: لكل لاعب عدّاده وحده.',
                'أول نبض يسكن يُنهي الجولة على الجميع — والنقاط لمن بقي وقته أطول.',
              ].map((line, i) => (
                <li key={i} className="tile flex gap-3 p-3.5 text-sm leading-relaxed text-ink-2">
                  <span className="tnum shrink-0 font-black text-signal">{i + 1}</span>
                  {line}
                </li>
              ))}
            </ul>
          </>
        )}

        <Pulses teams={teams} meId={state.id} />
      </div>

      <p className="shrink-0 pt-3 text-center text-xs font-medium text-muted">
        {ready ? (
          <>
            جاهزٌ لجولتك القادمة: <b className="text-signal">{ready}</b>
          </>
        ) : (
          note
        )}
      </p>
    </>
  );
}

function Readout({
  value,
  label,
  signal,
  danger,
}: {
  value: string;
  label: string;
  signal?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="tile px-3 py-2.5">
      <div
        className={`tnum text-2xl leading-none font-black ${
          danger ? 'text-danger' : signal ? 'text-signal' : ''
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] font-medium text-muted">{label}</div>
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
