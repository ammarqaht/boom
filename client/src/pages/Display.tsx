import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { socket, ask } from '../lib/socket';
import type { PublicTeam, RoomState } from '../lib/types';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  Logo,
  MiniFooter,
  Page,
  dangerLevel,
  formatTime,
  levelColor,
} from '../components/ui';
import {
  BombIcon,
  BoomIcon,
  CrownIcon,
  EyeOffIcon,
  OfflineIcon,
  PauseIcon,
  ScreenIcon,
  SnowflakeIcon,
} from '../components/icons';
import { Countdown, Podium, RollingNumber, TimeBar } from '../components/game';
import { playExplosion, unlockAudio } from '../lib/sound';

export default function Display() {
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
    const res = await ask<{ state: RoomState }>('display:join', { code: target });
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
      <Page>
        <div className="mx-auto max-w-md">
          <div className="text-center">
            <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-[#eef3fa] text-[#103f91]">
              <ScreenIcon size={34} />
            </span>
            <h1 className="mt-4 text-3xl font-black text-[#103f91]">شاشة العرض</h1>
          </div>
          <Card className="mt-5 grid gap-4">
            <Field label="رمز الغرفة">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={4}
                placeholder="A7K2"
                className="text-center text-2xl font-black tracking-[0.4em]"
                onKeyDown={(e) => e.key === 'Enter' && void connect(code)}
              />
            </Field>
            <ErrorNote>{error}</ErrorNote>
            <Button
              onClick={() => {
                unlockAudio();
                void connect(code);
              }}
              disabled={code.length < 4}
            >
              اعرض
            </Button>
          </Card>
        </div>
      </Page>
    );
  }

  return <Board room={room} />;
}

/** شاشة العرض تملأ البروجكتر — بلا نافبار ولا فوتر مزدحم */
function Board({ room }: { room: RoomState }) {
  const joinUrl = `${location.origin}/play?code=${room.code}`;
  const qr = useQr(joinUrl);
  useExplosionAlert(room.teams);

  // المتصدر = أعلى وقت متبقٍ بين الفرق الصامدة
  const leaderId = room.teams
    .filter((t) => !t.exploded)
    .reduce<PublicTeam | null>((best, t) => (!best || t.timeMs > best.timeMs ? t : best), null)?.id;

  return (
    <div className="flex min-h-full flex-col">
      {/* نافبار ثابت: الشعار يميناً، ورمز الغرفة والجولة بخط صغير يساراً */}
      <header className="sticky top-0 z-30 border-b border-[#e8e4dd] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <Logo className="h-9" />
            <span className="flex items-center gap-1.5 border-r border-[#e8e4dd] pr-3 text-lg font-black text-[#103f91]">
              <BombIcon size={18} className="text-[#ff9f1c]" />
              القنبلة
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-[#f2efe9] px-3 py-1 font-bold text-[#6b6b6b]">
              الجولة {room.round}
            </span>
            <span className="rounded-full bg-[#fff6e8] px-3 py-1 font-black tracking-[0.15em] text-[#e68500]">
              {room.code}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 p-5 sm:p-8">
        {room.status === 'lobby' && (
          <div className="flex flex-wrap items-center justify-center gap-6 rounded-2xl border border-[#e8e4dd] bg-white p-6">
            {qr && (
              <div className="rounded-xl border border-[#e8e4dd] bg-white p-2">
                <img src={qr} alt="امسح للانضمام" className="size-32" />
              </div>
            )}
            <div className="text-center sm:text-right">
              <p className="text-xl font-bold text-[#6b6b6b]">
                امسح الرمز أو افتح{' '}
                <span className="font-black text-[#103f91]">{location.host}/play</span>
              </p>
              <p className="mt-2 text-lg text-[#9a968f]">
                وأدخل رمز الغرفة{' '}
                <span className="text-3xl font-black tracking-[0.15em] text-[#ff9f1c]">
                  {room.code}
                </span>
              </p>
            </div>
          </div>
        )}

      {/* التغبيش يخفي الترتيب والعدادات عن الجمهور لزيادة التشويق */}
      <div className="relative flex-1">
        <div
          className={`transition duration-500 ${
            room.displayBlurred ? 'pointer-events-none blur-lg select-none' : ''
          }`}
        >
          {room.status === 'finished' && room.standings ? (
            <Podium standings={room.standings} />
          ) : (
            <>
              {room.teams.length === 0 && (
                <p className="mt-20 text-center text-2xl text-[#9a968f]">بانتظار انضمام الفرق…</p>
              )}
              {/* عمودان على الشاشات العريضة، عمود واحد على الضيقة */}
              <div className="grid content-start gap-4 xl:grid-cols-2">
                {room.teams.map((team, index) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    rank={index + 1}
                    status={room.status}
                    leader={team.id === leaderId}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {room.displayBlurred && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-[#e8e4dd] bg-white/95 px-8 py-5 shadow-lg">
              <EyeOffIcon size={28} className="text-[#103f91]" />
              <span className="text-2xl font-black text-[#103f91]">الترتيب مخفي</span>
            </div>
          </div>
        )}
      </div>

        {room.status === 'countdown' && <Countdown ms={room.countdownMs} />}

        {/* نتائج الجولة تظهر كبوب أب فوق خلفية مغبّشة، وتختفي مع بدء الجولة التالية */}
        {room.status === 'ended' && room.result && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-6 backdrop-blur-md">
            <div className="boom w-full max-w-3xl">
              <Results result={room.result} />
            </div>
          </div>
        )}
      </div>

      <MiniFooter />
    </div>
  );
}

function TeamRow({
  team,
  rank,
  status,
  leader,
}: {
  team: PublicTeam;
  rank: number;
  status: RoomState['status'];
  /** صاحب أعلى وقت متبقٍ حالياً */
  leader?: boolean;
}) {
  const color = team.exploded ? '#e52e25' : levelColor[dangerLevel(team.timeMs)];

  return (
    <div
      className={`flex overflow-hidden rounded-2xl border transition ${
        team.exploded ? 'border-[#f5c9c6] bg-[#fdeae8]' : 'border-[#e8e4dd] bg-white'
      }`}
    >
      <div className="w-3 shrink-0 transition-colors duration-500" style={{ backgroundColor: color }} />

      <div className="flex flex-1 flex-col gap-4 p-6">
        <div className="flex items-center gap-4">
          <div className="w-10 text-center text-3xl font-black text-[#c9c4bb]">{rank}</div>

          <div className="flex-1">
            <div className="flex items-center gap-2 text-3xl font-black">
              {/* تاج يطفو فوق المتصدر ما دامت اللعبة جارية */}
              {leader && !team.exploded && (
                <CrownIcon size={26} className="crown-bob shrink-0 text-[#ff9f1c]" />
              )}
              {team.name}
              {team.locked && (
                <SnowflakeIcon size={22} className="shrink-0 animate-pulse text-[#12b3d5]" />
              )}
              {!team.connected && <OfflineIcon size={19} className="text-[#9a968f]" />}
            </div>
            <div className="text-base text-[#9a968f]">
              {team.correct}/{team.answered} إجابة صحيحة
            </div>
          </div>

          <div className="text-center">
            <RollingNumber value={team.score} className="text-4xl font-black text-[#ff9f1c]" />
            <div className="text-xs text-[#9a968f]">نقطة</div>
          </div>

          <div className="flex w-12 justify-center">
            {team.exploded ? (
              <BoomIcon size={34} className="text-[#e52e25]" />
            ) : status === 'running' ? (
              <BombIcon size={32} className="text-[#103f91]" />
            ) : (
              <PauseIcon size={26} className="text-[#c9c4bb]" />
            )}
          </div>
        </div>

        <TimeBar timeMs={team.timeMs} exploded={team.exploded} size="lg" />
      </div>
    </div>
  );
}

function Results({ result }: { result: NonNullable<RoomState['result']> }) {
  const rankColors = ['#ff9f1c', '#103f91', '#12b3d5'];
  return (
    <Card className="boom">
      <h2 className="mb-4 text-center text-3xl font-black text-[#103f91]">
        نتائج الجولة {result.round}
      </h2>
      <div className="grid gap-2">
        {result.awards.map((award, i) => (
          <div
            key={award.teamId}
            className="flex items-center justify-between rounded-xl bg-[#faf9f6] px-5 py-3 text-xl"
          >
            <span className="flex items-center gap-3 font-black">
              <span
                className="flex size-8 items-center justify-center rounded-full text-sm text-white"
                style={{ backgroundColor: award.exploded ? '#e52e25' : (rankColors[i] ?? '#9a968f') }}
              >
                {award.exploded ? <BoomIcon size={16} /> : i + 1}
              </span>
              {award.name}
            </span>
            <span className="text-[#6b6b6b]">
              {award.exploded ? 'انفجرت' : `${formatTime(award.timeMs)} ث`}
            </span>
            <span className="font-black text-[#ff9f1c]">+{award.points}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function useQr(url: string) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 0, width: 200, color: { dark: '#103f91ff', light: '#ffffffff' } })
      .then(setSrc)
      .catch(() => setSrc(''));
  }, [url]);
  return src;
}

/** دوي الانفجار على مكبر القاعة عند خروج أول فريق */
function useExplosionAlert(teams: PublicTeam[]) {
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const team of teams) {
      if (team.exploded && !seen.current.has(team.id)) {
        seen.current.add(team.id);
        playExplosion();
      }
    }
  }, [teams]);
}
