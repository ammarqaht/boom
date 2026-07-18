import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, ask } from '../lib/socket';
import type { RoomState, TeamState } from '../lib/types';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Page,
  dangerLevel,
  formatTime,
  levelColor,
  type MenuAction,
} from '../components/ui';
import { BombIcon, BoomIcon, ClockIcon, ExitIcon, HistoryIcon, TrophyIcon } from '../components/icons';
import {
  Countdown,
  HistoryModal,
  Podium,
  ReviewList,
  RollingNumber,
  optionGradient,
} from '../components/game';
import { playCorrect, playExplosion, playTick, playWrong, unlockAudio } from '../lib/sound';

const SESSION_KEY = 'qunbula:team';

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
  const [state, setState] = useState<TeamState | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [name, setName] = useState('');
  const [flash, setFlash] = useState<{ key: number; correct: boolean } | null>(null);
  const [locked, setLocked] = useState(false); // يمنع الضغط المزدوج على نفس السؤال
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const onState = (next: TeamState) => setState(next);
    const onRoom = (next: RoomState) => setRoom(next);
    const onRemoved = () => {
      localStorage.removeItem(SESSION_KEY);
      setState(null);
      setError('أزالك المسؤول من الغرفة');
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
  useEffect(() => {
    const session = loadSession();
    if (!session) return;
    const rejoin = async () => {
      const res = await ask<{ state: TeamState }>('team:rejoin', session);
      if (res.ok) setState(res.state);
      else localStorage.removeItem(SESSION_KEY);
    };
    void rejoin();
    socket.on('connect', rejoin);
    return () => {
      socket.off('connect', rejoin);
    };
  }, []);

  // صوت النتيجة + وميض الشاشة
  useEffect(() => {
    const onResult = ({ isCorrect }: { isCorrect: boolean }) => {
      setFlash({ key: Date.now(), correct: isCorrect });
      setLocked(false);
      (isCorrect ? playCorrect : playWrong)();
    };
    socket.on('team:result', onResult);
    return () => {
      socket.off('team:result', onResult);
    };
  }, []);

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
      JSON.stringify({ code: code.trim().toUpperCase(), teamId: res.teamId, token: res.token }),
    );
    setState(res.state);
  };

  const answer = (choice: number) => {
    if (!state?.question || locked) return;
    setLocked(true);
    socket.emit('team:answer', { questionId: state.question.id, choice });
  };

  if (!state) {
    return (
      <Page width="narrow">
        <div className="mx-auto max-w-md">
          <div className="text-center">
            <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-[#e7f7fb] text-[#12b3d5]">
              <BombIcon size={36} />
            </span>
            <h1 className="mt-4 text-3xl font-black text-[#103f91]">انضم كفريق</h1>
          </div>
          <Card className="mt-5 grid gap-4">
            <Field label="رمز الغرفة">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="A7K2"
                maxLength={4}
                autoCapitalize="characters"
                className="text-center text-2xl font-black tracking-[0.4em]"
              />
            </Field>
            <Field label="اسم الفريق">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="النسور"
                maxLength={24}
                onKeyDown={(e) => e.key === 'Enter' && void join()}
              />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button onClick={join} disabled={busy || code.length < 4 || !name.trim()}>
              {busy ? 'جارٍ الانضمام…' : 'انضم'}
            </Button>
          </Card>
        </div>
      </Page>
    );
  }

  const actions: MenuAction[] = [
    { label: 'سجل الجولات', icon: <HistoryIcon size={18} />, onClick: () => setShowHistory(true) },
    {
      label: 'الخروج من اللعبة',
      icon: <ExitIcon size={18} />,
      danger: true,
      onClick: () => {
        if (!confirm('الخروج من اللعبة؟')) return;
        localStorage.removeItem(SESSION_KEY);
        location.href = '/';
      },
    },
  ];

  return (
    <>
      <TeamScreen state={state} flash={flash} locked={locked} onAnswer={answer} actions={actions} />
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

/** بطاقة الفريق — تظهر طوال اللعبة: الاسم والنقاط ورقم الجولة */
function TeamBadge({ state }: { state: TeamState }) {
  return (
    <div className="mb-5 flex items-center justify-between rounded-2xl bg-gradient-to-l from-[#0a2a63] via-[#103f91] to-[#1a5fc4] px-6 py-5 text-white shadow-lg shadow-[#103f91]/20">
      <div>
        <div className="text-3xl font-black lg:text-4xl">{state.name}</div>
        <div className="mt-1 text-sm font-bold text-white/60">الجولة {state.round}</div>
      </div>
      <div className="text-center">
        <RollingNumber
          value={state.score}
          className="block text-4xl font-black text-[#ffb703] lg:text-5xl"
        />
        <div className="text-sm font-bold text-white/60">نقطة</div>
      </div>
    </div>
  );
}

function TeamScreen({
  state,
  flash,
  locked,
  onAnswer,
  actions,
}: {
  state: TeamState;
  flash: { key: number; correct: boolean } | null;
  locked: boolean;
  onAnswer: (choice: number) => void;
  actions: MenuAction[];
}) {
  const shown = useSmoothTime(state.timeMs, state.status === 'running' && !state.exploded);
  const level = dangerLevel(shown);
  const running = state.status === 'running' && !state.exploded;
  const over = state.status === 'ended' || state.exploded;
  const phase = useEndPhase(over);

  useTicking(shown, running);
  useExplosionSound(state.exploded);

  /*
   * انتقال نهاية الجولة: بدل أن يختفي المؤقت فجأة وتقفز المراجعة،
   * تتلاشى شاشة اللعب ثم تظهر لوحة النتيجة ثم تنساب بطاقات المراجعة.
   */
  if (over && phase === 'fading') {
    return (
      <Page actions={actions} sound>
        <div className="mx-auto max-w-3xl">
          <div className="fade-out">
            <TeamBadge state={state} />
            <div className="my-6 text-center">
              <div
                className="text-[5.5rem] font-black leading-none tabular-nums"
                style={{ color: levelColor[level] }}
              >
                {formatTime(state.timeMs)}
              </div>
              <div className="mt-1 text-sm font-bold text-[#9a968f]">ثانية متبقية</div>
            </div>
          </div>
        </div>
        {/* الطبقة تحمل مصير المجموعة بلونها ونصها */}
        <div
          className="veil-in fixed inset-0 z-40 flex flex-col items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: state.exploded ? 'rgba(229,46,37,0.92)' : 'rgba(34,164,93,0.92)' }}
        >
          <span className="boom text-white">
            {state.exploded ? <BoomIcon size={78} /> : <TrophyIcon size={70} />}
          </span>
          <p className="boom mt-4 text-5xl font-black text-white lg:text-6xl">
            {state.exploded ? 'انفجرت القنبلة' : 'نجوت'}
          </p>
        </div>
      </Page>
    );
  }

  // انتهت اللعبة كلياً — الأوائل على المدرّج
  if (state.status === 'finished' && state.standings) {
    return (
      <Page actions={actions} sound>
        <div className="mx-auto max-w-3xl py-4">
          <Podium standings={state.standings} />
        </div>
      </Page>
    );
  }

  // شاشة الاستعداد قبل انطلاق العدادات
  if (state.status === 'countdown') {
    return (
      <Page actions={actions} sound>
        <div className="mx-auto max-w-3xl">
          <TeamBadge state={state} />
        </div>
        <Countdown ms={state.countdownMs} />
      </Page>
    );
  }

  if (state.status === 'lobby') {
    return (
      <Page actions={actions} sound>
        <div className="mx-auto max-w-3xl">
          <TeamBadge state={state} />
          <Centered>
            <div className="text-center">
              <span className="inline-flex size-20 items-center justify-center rounded-3xl bg-[#eef3fa] text-[#103f91]">
                <ClockIcon size={40} />
              </span>
              <p className="mt-5 text-lg font-bold">بانتظار بدء المسؤول للجولة {state.round}</p>
              <p className="mt-2 text-sm text-[#9a968f]">أبقِ هذه الصفحة مفتوحة</p>
            </div>
          </Centered>
        </div>
      </Page>
    );
  }

  // نهاية الجولة — سواء نجا الفريق أو انفجرت قنبلته، يراجع أسئلته
  if (state.status === 'ended' || state.exploded) {
    return (
      <Page actions={actions} sound>
        <div className="mx-auto max-w-3xl">
          <TeamBadge state={state} />

          {state.exploded ? (
            <div className="boom mb-6 rounded-2xl bg-gradient-to-bl from-[#f4564d] via-[#e52e25] to-[#a81a13] p-8 text-center text-white shadow-lg shadow-[#e52e25]/25">
              <span className="inline-flex size-20 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                <BoomIcon size={46} />
              </span>
              <h1 className="mt-4 text-4xl font-black">انفجرت قنبلتكم!</h1>
              <p className="mt-3 text-xl font-bold text-white/80">شد حيلك في الجولة القادمة</p>
            </div>
          ) : (
            <div className="boom mb-6 rounded-2xl bg-gradient-to-bl from-[#34c26f] via-[#22a45d] to-[#137a41] p-8 text-center text-white shadow-lg shadow-[#22a45d]/25">
              <span className="inline-flex size-20 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                <TrophyIcon size={44} />
              </span>
              <h1 className="mt-4 text-4xl font-black">نجوتم!</h1>
              <p className="mt-3 text-xl leading-relaxed text-white/90">
                نجوتم بـ <span className="font-black text-white">{formatTime(state.timeMs)}</span> ثانية
                {state.roundPoints !== null && (
                  <>
                    {' '}وحصلتم على{' '}
                    <span className="font-black text-[#ffd88a]">{state.roundPoints}</span> نقطة
                  </>
                )}
              </p>
            </div>
          )}

          {state.review && (
            <>
              <h2 className="mb-3 text-lg font-black text-[#103f91]">مراجعة أسئلة الجولة</h2>
              <ReviewList review={state.review} />
            </>
          )}
        </div>
      </Page>
    );
  }

  return (
    <Page actions={actions} sound>
      {/* الثواني الأخيرة: إطار أحمر ينبض على حواف الشاشة */}
      {running && shown <= 5000 && (
        <div className="danger-frame pointer-events-none fixed inset-0 z-10" aria-hidden="true" />
      )}

      {flash && (
        <div
          key={flash.key}
          className="flash pointer-events-none fixed inset-0 z-20"
          style={{ backgroundColor: flash.correct ? '#12b3d5' : '#e52e25' }}
        />
      )}
      {flash && (
        <div
          key={`n${flash.key}`}
          className="float-up pointer-events-none fixed left-1/2 top-1/3 z-30 -translate-x-1/2 text-5xl font-black"
          style={{ color: flash.correct ? '#0e92af' : '#c2231b' }}
        >
          {flash.correct ? `+${state.bonus}` : `−${state.penalty}`}
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <TeamBadge state={state} />

        <div className={`my-8 text-center ${level === 'danger' ? 'shake' : ''}`}>
          <div
            className={`text-[6rem] font-black leading-none tabular-nums lg:text-[8rem] ${
              level === 'danger' ? 'beat-fast' : level === 'warn' ? 'beat-slow' : ''
            }`}
            style={{ color: levelColor[level] }}
          >
            {formatTime(shown)}
          </div>
          <div className="mt-2 font-bold text-[#9a968f]">ثانية متبقية</div>
        </div>

        <Card className="mb-5 py-7">
          <p className="text-center text-2xl font-bold leading-relaxed lg:text-3xl">
            {state.question?.q}
          </p>
        </Card>

        {/* الخيارات في شبكة 2×2 بتدرّجات ألوان الشعار */}
        <div className="grid grid-cols-2 gap-4">
          {state.question?.options.map((option, i) => (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              disabled={locked}
              style={{ backgroundImage: optionGradient(i) }}
              className="flex min-h-28 items-center justify-center rounded-2xl px-5 py-6 text-center text-2xl font-black leading-snug text-white shadow-md transition hover:brightness-110 active:scale-[0.96] disabled:opacity-50 lg:min-h-36 lg:text-3xl"
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    </Page>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[50vh] items-center justify-center px-6">{children}</div>;
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
    const loop = () => {
      const { ms, at } = anchor.current;
      setShown(Math.max(0, ms - (performance.now() - at)));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return shown;
}

/** تكتكة تتسارع مع اقتراب الصفر */
function useTicking(shown: number, running: boolean) {
  const last = useRef(0);
  useEffect(() => {
    if (!running) return;
    const interval = shown > 15000 ? 1000 : shown > 7000 ? 550 : 300;
    const now = performance.now();
    if (now - last.current >= interval) {
      last.current = now;
      playTick();
    }
  }, [shown, running]);
}

/**
 * مرحلتان بعد انتهاء الجولة: تلاشٍ قصير ثم عرض النتيجة والمراجعة.
 * يمنع القفزة المفاجئة من المؤقت إلى بطاقات المراجعة.
 */
function useEndPhase(over: boolean) {
  const [phase, setPhase] = useState<'live' | 'fading' | 'done'>('live');

  useEffect(() => {
    if (!over) return setPhase('live');
    setPhase('fading');
    const timer = setTimeout(() => setPhase('done'), 1100);
    return () => clearTimeout(timer);
  }, [over]);

  return phase;
}

function useExplosionSound(exploded: boolean) {
  const played = useRef(false);
  useEffect(() => {
    if (exploded && !played.current) {
      played.current = true;
      playExplosion();
      navigator.vibrate?.([200, 80, 400]);
    }
  }, [exploded]);
}
