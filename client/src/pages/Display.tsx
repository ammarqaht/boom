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
  Page,
  dangerLevel,
  formatTime,
  levelColor,
} from '../components/ui';
import { BombIcon, BoomIcon, EyeOffIcon, OfflineIcon, PauseIcon, ScreenIcon } from '../components/icons';
import { Countdown, Podium, TimeBar } from '../components/game';
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

  return (
    <div className="flex min-h-full flex-col gap-6 p-8">
      <header className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <Logo className="h-14" />
          <div className="border-r border-[#e8e4dd] pr-4">
            <h1 className="flex items-center gap-2 text-3xl font-black text-[#103f91]">
              <BombIcon size={28} className="text-[#ff9f1c]" />
              القنبلة
            </h1>
            <p className="text-sm font-bold text-[#6b6b6b]">الجولة {room.round}</p>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-center">
            <div className="text-xs font-bold text-[#6b6b6b]">رمز الغرفة</div>
            <div className="text-5xl font-black tracking-[0.15em] text-[#ff9f1c]">{room.code}</div>
          </div>
          {qr && (
            <div className="rounded-xl border border-[#e8e4dd] bg-white p-2">
              <img src={qr} alt="امسح للانضمام" className="size-24" />
            </div>
          )}
        </div>
      </header>

      {room.status === 'lobby' && (
        <p className="rounded-2xl border border-[#e8e4dd] bg-white p-4 text-center text-xl font-bold text-[#6b6b6b]">
          امسح الرمز أو افتح{' '}
          <span className="font-black text-[#103f91]">{location.host}/play</span> وأدخل الرمز
        </p>
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
                  <TeamRow key={team.id} team={team} rank={index + 1} status={room.status} />
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-8 backdrop-blur-md">
          <div className="boom w-full max-w-3xl">
            <Results result={room.result} />
          </div>
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-[#e8e4dd] pt-4 text-sm text-[#9a968f]">
        <span className="font-bold">© {new Date().getFullYear()} نادي نبراس</span>
        <span>تم إنشاء الموقع بواسطة مشعل الجلال</span>
      </footer>
    </div>
  );
}

function TeamRow({
  team,
  rank,
  status,
}: {
  team: PublicTeam;
  rank: number;
  status: RoomState['status'];
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
              {team.name}
              {!team.connected && <OfflineIcon size={19} className="text-[#9a968f]" />}
            </div>
            <div className="text-base text-[#9a968f]">
              {team.correct}/{team.answered} إجابة صحيحة
            </div>
          </div>

          <div className="text-center">
            <div className="text-4xl font-black text-[#ff9f1c]">{team.score}</div>
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
