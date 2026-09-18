import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { socket, ask } from '../lib/socket';
import type { PublicTeam, RoomState } from '../lib/types';
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  Field,
  FormPage,
  Input,
  Wordmark,
  formatTime,
  stateStyle,
  teamLevel,
  useQr,
  useTheme,
} from '../components/ui';
import {
  CrownIcon,
  EyeOffIcon,
  FlatlineIcon,
  OfflineIcon,
  SnowflakeIcon,
} from '../components/icons';
import {
  CURTAIN_OPEN_MS,
  CURTAIN_OUT_MS,
  CountdownGate,
  Curtain,
  Lane,
  PausedMark,
  ResultBars,
  RollingNumber,
  Standings,
  useReorderSlide,
} from '../components/game';
import { playFlatline, unlockAudio } from '../lib/sound';

export default function Display() {
  // القاعة مظلمة والبروجكتر يغسل الفاتح — هذه الشاشة غامقة دائماً
  useTheme('dark');
  const [params, setParams] = useSearchParams();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');

  useEffect(() => {
    const onState = (next: RoomState) => setRoom(next);
    socket.on('room:state', onState);
    return () => {
      socket.off('room:state', onState);
    };
  }, []);

  const connect = async (target: string) => {
    setError('');
    const res = await ask<{ state: RoomState }>('display:join', {
      code: target,
    });
    if (!res.ok) return setError(res.error);
    setRoom(res.state);
    setParams({ code: target }, { replace: true });
  };

  // إعادة الاتصال تلقائياً لو انقطع نت شاشة العرض أثناء المسابقة
  useEffect(() => {
    if (!room) return;
    const rejoin = () => void ask('display:join', { code: room.code });
    socket.on('connect', rejoin);
    return () => {
      socket.off('connect', rejoin);
    };
  }, [room]);

  useEffect(() => {
    const initial = params.get('code');
    if (initial) void connect(initial.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!room) {
    return (
      <FormPage
        title="شاشة العرض"
        lead="افتحها على البروجكتر وأدخل رمز الغرفة. تتابع القاعة من هنا نبض كل لاعب، ولحظة سكون أول نبض."
      >
        <Card className="grid gap-4">
          <Field label="رمز الغرفة">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={4}
              placeholder="A7K2"
              className="tnum text-center text-3xl tracking-[0.4em]"
              onKeyDown={(e) => e.key === 'Enter' && void connect(code)}
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button
            size="lg"
            onClick={() => {
              unlockAudio();
              void connect(code);
            }}
            disabled={code.length < 4}
          >
            اعرض
          </Button>
        </Card>
      </FormPage>
    );
  }

  return <Board room={room} />;
}

/** شاشة العرض تملأ البروجكتر — لا شيء فيها أصغر من ٢٨px */
function Board({ room }: { room: RoomState }) {
  const joinUrl = `${location.origin}/play?code=${room.code}`;
  const qr = useQr(joinUrl, '#060b12ff', '#e4f0f8ff');
  /*
   * مشهد نهاية الجولة في القاعة على ثلاث لقطات:
   *   ١) ستارةُ السكون تنزل باسم من توقّف نبضه.
   *   ٢) تنفرج نصفين — بلا نبضةٍ قاصّة — فتكشف تحتها نتائجَ الجولة.
   *   ٣) فإذا بدأت الجولة التالية عبرت النبضةُ الزرقاء فقصّت النتائج
   *      ونزاحت، فتُسلّم الشاشة إلى الجولة الجديدة.
   * ولذلك تُركَّب الستارتان معاً: الثانية جاهزة تحت الأولى قبل انفراجها.
   */
  const stopped = useFlatlineMoment(room.teams, room.round);
  const curtain = useLingering(room.status === 'ended' ? room.result : null, CURTAIN_OUT_MS);

  const alive = room.teams.filter((t) => !t.flatlined).length;

  /*
   * القاعة تقرأ سباقاً لا جدولاً: الترتيب هنا بما بقي من الوقت لحظةً
   * بلحظة، والساكنون في الذيل. فإذا سبق أحدٌ أحداً رأت القاعةَ التجاوزَ
   * يحدث، لا نتيجتَه بعد أن حدث.
   */
  const ranked = [...room.teams].sort((a, b) => {
    if (a.flatlined !== b.flatlined) return a.flatlined ? 1 : -1;
    return b.timeMs - a.timeMs || b.score - a.score;
  });
  const leaderId = ranked.find((t) => !t.flatlined)?.id;

  const board = useRef<HTMLDivElement>(null);
  useReorderSlide(board, ranked.map((t) => t.id).join(','));

  return (
    <div className="flex h-full flex-col px-14">
      {/* الترويسة على سطحٍ لا على الأرضية: أبيضُ في الفاتح وأسودُ في الغامق */}
      <header className="-mx-14 flex h-24 shrink-0 items-center justify-between border-b-2 border-line-2 bg-surface px-14">
        <Wordmark className="text-[40px]" />
        <div className="flex items-center gap-3 text-[26px]">
          <Chip label="الجولة" value={room.round} />
          <Chip label="الغرفة" value={room.code} signal />
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={`flex min-h-0 flex-1 flex-col transition duration-500 ${
            room.displayBlurred ? 'pointer-events-none blur-lg select-none' : ''
          }`}
        >
          {room.status === 'lobby' ? (
            <Lobby code={room.code} qr={qr} teams={room.teams} />
          ) : room.status === 'finished' && room.standings ? (
            <div className="flex min-h-0 flex-1 items-center overflow-y-auto py-6">
              <Standings standings={room.standings} rounds={room.history.length} />
            </div>
          ) : (
            <div ref={board} className="flex min-h-0 flex-1 flex-col justify-center gap-2.5 py-4">
              {ranked.map((team, index) => (
                <Channel
                  key={team.id}
                  team={team}
                  rank={index + 1}
                  status={room.status}
                  leader={team.id === leaderId}
                />
              ))}
            </div>
          )}
        </div>

        {room.displayBlurred && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-4 rounded-card bg-surface px-9 py-6 shadow-[inset_0_0_0_1px_var(--color-line-2)]">
              <EyeOffIcon size={30} className="text-muted" />
              <span className="text-3xl font-black">الترتيب مخفي</span>
            </div>
          </div>
        )}
      </div>

      <footer className="flex h-20 shrink-0 items-center justify-between border-t-2 border-line-2 text-[28px] font-medium text-muted">
        <div className="flex items-center gap-9">
          <Legend color="var(--color-safe)" label="نبض قوي" />
          <Legend color="var(--color-warn)" label="يضعف" />
          <Legend color="var(--color-danger)" label="على وشك السكون" />
        </div>
        <div className="tnum flex items-center gap-4">
          <span>
            {alive} نبضة حيّة من {room.teams.length}
          </span>
          <span className="text-faint">·</span>
          <span className="font-black text-ink">{location.host}/play</span>
        </div>
      </footer>

      <CountdownGate ms={room.countdownMs} on={room.status === 'countdown'} />

      {room.status === 'paused' && (
        <div className="veil-in fixed inset-0 z-40 flex items-center justify-center bg-ground/92">
          <PausedMark note="سيستأنف المنظّم بعد لحظات — أبقِ جهازك كما هو" />
        </div>
      )}

      {curtain.value && <Results result={curtain.value} leaving={curtain.leaving} />}

      {/* فوق النتائج: إعلانُ السكون، ينفرج عنها بعد لحظتين */}
      {stopped.name && <FlatlineMoment name={stopped.name} leaving={stopped.leaving} />}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <i className="size-5 rounded-[3px]" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * شاشة الانتظار: وظيفتها الوحيدة أن ينضمّ الناس.
 * فلا عدادات ولا مجارٍ — رمز كبير يُقرأ من آخر صفّ، وأسماء من انضمّ.
 */
function Lobby({ code, qr, teams }: { code: string; qr: string; teams: PublicTeam[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-12 py-8">
      <div className="flex items-center justify-center gap-16">
        {qr && (
          <div className="rounded-card bg-ink p-4">
            <img src={qr} alt="امسح للانضمام" className="size-60" />
          </div>
        )}
        <div>
          <p className="text-[34px] font-medium text-muted">
            امسح الرمز أو افتح <span className="font-black text-ink">{location.host}/play</span>
          </p>
          <p className="mt-4 text-[34px] font-medium text-muted">ثم أدخل رمز الغرفة</p>
          <div className="tnum mt-2 text-[150px] leading-none font-black tracking-[0.1em] text-signal">
            {code}
          </div>
        </div>
      </div>

      <div className="border-t-2 border-line-2 pt-8">
        <p className="tnum mb-5 text-[28px] font-bold tracking-[0.14em] text-muted">
          {teams.length === 0 ? 'بانتظار انضمام اللاعبين…' : `انضمّ ${teams.length} لاعباً`}
        </p>
        <div className="flex flex-wrap gap-3">
          {teams.map((team) => (
            <span
              key={team.id}
              className="rise-in rounded-card bg-surface px-7 py-3.5 text-[34px] font-black shadow-[inset_0_0_0_1px_var(--color-line-2)]"
            >
              {team.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * القناة: لاعب واحد على سطح الجهاز.
 * الشريط الملوّن على الطرف، والمخطّط في الوسط، والأرقام على اليسار.
 */
function Channel({
  team,
  rank,
  status,
  leader,
}: {
  team: PublicTeam;
  rank: number;
  status: RoomState['status'];
  leader?: boolean;
}) {
  const frozen = team.locked && !team.flatlined;
  const gilded = team.doubled && !team.flatlined && !frozen;
  const level = teamLevel(team.timeMs, team.flatlined);
  const dying = level === 'danger' && status === 'running' && !frozen;

  return (
    <div
      data-row={team.id}
      style={stateStyle(level, team.timeMs)}
      className={`relative grid max-h-[128px] min-h-[86px] flex-1 grid-cols-[64px_340px_minmax(0,1fr)_168px_148px] items-center gap-6 overflow-hidden rounded-card px-6 ${
        frozen
          ? 'frosted'
          : gilded
            ? 'gilded'
            : team.flatlined
              ? 'bg-transparent shadow-[inset_0_0_0_1px_var(--color-line)]'
              : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]'
      } ${dying ? 'alarm-channel' : ''}`}
    >
      <span className="bg-state absolute inset-y-0 start-0 z-[1] w-1" aria-hidden="true" />

      <div
        className={`tnum relative text-center text-[36px] font-light ${
          leader && !team.flatlined ? 'font-black text-signal' : 'text-faint'
        }`}
      >
        {rank}
      </div>

      <div className="relative">
        <div
          className={`flex items-center gap-2.5 text-[38px] leading-tight font-black ${
            team.flatlined ? 'text-faint' : ''
          }`}
        >
          {leader && !team.flatlined && <CrownIcon size={24} className="shrink-0 text-signal" />}
          <span className="truncate">{team.name}</span>
          {frozen && (
            <span className="tnum flex shrink-0 items-center gap-2 rounded-chip px-3 py-0.5 text-[26px] font-black text-frost shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-frost)_55%,transparent)]">
              <SnowflakeIcon size={18} />
              {Math.ceil(team.lockedMs / 1000)}
            </span>
          )}
          {team.doubled && !team.flatlined && (
            <span className="shrink-0 rounded-chip px-3 py-0.5 text-[26px] font-black text-gold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-gold)_55%,transparent)]">
              ×٢
            </span>
          )}
          {!team.connected && <OfflineIcon size={22} className="shrink-0 text-faint" />}
        </div>
        <div
          className={`tnum text-[28px] font-medium ${team.flatlined ? 'text-faint' : 'text-muted'}`}
        >
          {team.correct}/{team.answered} إجابة صحيحة
        </div>
      </div>

      <Lane
        timeMs={team.timeMs}
        running={status === 'running'}
        flatlined={team.flatlined}
        size="lg"
        className="relative h-[58px]"
      />

      {/* العدّاد لا يغيب وإن سكن النبض: الصفر خبرٌ يُقرأ، والكلمة تحته تفسّره */}
      <div className="relative text-center">
        {team.flatlined ? (
          <>
            <b className="tnum block text-[50px] leading-none font-black text-danger">
              {formatTime(team.timeMs)}
            </b>
            <span className="mt-1 flex items-center justify-center gap-2 text-[26px] font-black text-danger">
              <FlatlineIcon size={20} />
              توقف النبض
            </span>
          </>
        ) : (
          <>
            <b className="ink-state tnum block text-[50px] leading-none font-black">
              {formatTime(team.timeMs)}
            </b>
            <span className="mt-1 block text-[28px] font-medium text-muted">ثانية</span>
          </>
        )}
      </div>

      <div className="relative border-r border-line-2 pr-5 text-center">
        <RollingNumber
          value={team.score}
          className={`tnum block text-[44px] leading-none font-black ${
            team.flatlined ? 'text-faint' : 'text-signal'
          }`}
        />
        <span className="mt-1 block text-[28px] font-medium text-muted">نقطة</span>
      </div>
    </div>
  );
}

/**
 * أول نبض يسكن يُنهي الجولة على الجميع — فليكن حدثاً: ستارةٌ حمراء
 * تنزل باسمه، ثم تنفرج نصفين عن نتائج الجولة تحتها.
 */
function FlatlineMoment({ name, leaving }: { name: string; leaving: boolean }) {
  return (
    <Curtain mode="drop" tone="var(--color-danger)" cut={false} front leaving={leaving}>
      <div className="relative flex flex-col items-center gap-8 px-20">
        <div
          className="alarm pointer-events-none absolute inset-x-[-80px] inset-y-[-60px]"
          style={{ '--beat': '0.62s' } as React.CSSProperties}
          aria-hidden="true"
        />
        <span className="relative block h-1.5 w-full rounded-full bg-danger" aria-hidden="true" />
        <div className="relative text-center">
          <p className="text-[34px] font-bold tracking-[0.2em] text-danger">توقف النبض</p>
          <h2 className="thump mt-3 text-[132px] leading-none font-black">{name}</h2>
          <p className="mt-5 text-[32px] font-medium text-muted">وانتهت الجولة على الجميع</p>
        </div>
        <span className="relative block h-1.5 w-full rounded-full bg-danger" aria-hidden="true" />
      </div>
    </Curtain>
  );
}

/** ستارة النتائج: مصراعان يُطبقان، ثم تقصّهما نبضة فينفرجان */
function Results({
  result,
  leaving,
}: {
  result: NonNullable<RoomState['result']>;
  leaving: boolean;
}) {
  return (
    <Curtain mode="drop" tone="var(--color-signal)" leaving={leaving}>
      <div className="px-20">
        <h2 className="mb-9 text-[48px] font-black">
          نتائج الجولة <span className="tnum text-signal">{result.round}</span>
        </h2>
        <ResultBars awards={result.awards} big />
      </div>
    </Curtain>
  );
}

/** يُبقي القيمة مرسومة بعد اختفائها ريثما تنتهي حركة الخروج */
function useLingering<T>(value: T | null, ms: number) {
  const [shown, setShown] = useState<T | null>(value);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (value) {
      setShown(value);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, ms);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);

  return { value: shown, leaving };
}

/**
 * صفير توقف النبض على مكبر القاعة عند خروج أول لاعب،
 * ومعه اسمها على الشاشة لثلاث ثوانٍ.
 */
const FLATLINE_HOLD_MS = 2300;

function useFlatlineMoment(teams: PublicTeam[], round: number) {
  const seen = useRef(new Set<string>());
  const [name, setName] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // كل جولة جديدة تبدأ بصفحة بيضاء: من توقف نبضه أمس قد يتوقف اليوم أيضاً
  useEffect(() => {
    seen.current.clear();
    setName(null);
    setLeaving(false);
  }, [round]);

  useEffect(() => {
    for (const team of teams) {
      if (team.flatlined && !seen.current.has(team.id)) {
        seen.current.add(team.id);
        playFlatline();
        setName(team.name);
        setLeaving(false);
      }
    }
  }, [teams]);

  // تمهل، ثم تنفرج، ثم تُرفع — فتظهر النتائج التي كانت تحتها
  useEffect(() => {
    if (!name) return;
    const open = setTimeout(() => setLeaving(true), FLATLINE_HOLD_MS);
    const gone = setTimeout(() => {
      setName(null);
      setLeaving(false);
    }, FLATLINE_HOLD_MS + CURTAIN_OPEN_MS);
    return () => {
      clearTimeout(open);
      clearTimeout(gone);
    };
  }, [name]);

  return { name, leaving };
}
