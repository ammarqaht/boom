import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ask, onWake, useFreshBuild, watchSession, socket } from '../lib/socket';
import { projectRoom, roomTicking, useProjected } from '../lib/clock';
import type { CardEvent, CardId, PublicTeam, RoomState } from '../lib/types';
import { CARD_LOOK } from '../lib/cards';
import { EffectBadges } from '../components/effects';
import { DuelStage } from '../components/duel';
import { LivesBar, playersWord } from '../components/lives';
import {
  Button,
  Card,
  Chip,
  Credit,
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
  ReviveIcon,
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

  /*
   * إعادة الاتصال لو انقطع نت شاشة العرض أثناء المسابقة: الرمزُ في
   * الرابط يُرسل مع الاتصال نفسه، والسيرفر يعيدها إلى غرفتها بحالها.
   */
  useEffect(() => {
    const stop = watchSession('display', {
      resumed: (payload) => setRoom(payload.state as RoomState),
    });
    const offWake = onWake(async () => {
      const res = await ask<{ state: RoomState }>('session:sync');
      if (res.ok) setRoom(res.state);
    });
    return () => {
      stop();
      offWake();
    };
  }, []);

  useEffect(() => {
    const initial = params.get('code');
    if (initial) void connect(initial.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* الوقتُ يُعدّ هنا بين رسائل السيرفر (lib/clock.ts) */
  const shown = useProjected(room, projectRoom, roomTicking);
  useFreshBuild(!room || !roomTicking(room));

  if (!room) {
    return (
      <FormPage title="شاشة العرض">
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

  return <Board room={shown ?? room} />;
}

/**
 * مقياسُ الشاشة: الشاشةُ كلُّها تكبر، لا الخطُّ وحده.
 *
 * الشاشةُ مبنيّةٌ بمقاساتٍ ثابتةٍ بالبكسل — وهو الصواب في شاشةٍ تُقرأ من
 * آخر القاعة، فالمقاسُ عندها قرارٌ لا نسبة. لكنّ البروجكترات تختلف: ما
 * بُني لـ١٤٤٠ يبدو ضائعاً في ٢٥٦٠، وتُقرأ النبضاتُ خيطاً في وسط فراغ.
 *
 * فتُقاس الشاشةُ إلى تصميمها وتُزوَّم كلُّها: الخطُّ والهوامشُ والمجاري
 * والرمزُ معاً، بنسبةٍ واحدة. وبالأصغر من بُعدَيها — فشاشةٌ عريضةٌ قصيرة
 * لو قيست بعرضها وحده لفاض طولُها.
 *
 * ولماذا ‎transform‎ لا ‎zoom‎؟ جُرِّب ‎zoom‎ أولاً فاضطربت النِّسب تحته:
 * ‎width: 140%‎ خرجت ألفاً وأربعَ مئةٍ على نافذةٍ عرضها ألفٌ وأربعةٌ
 * وعشرون، ففاضت الشاشة أفقياً. والتحويلُ تُحسب نِسبُه قبله فلا تلتبس.
 *
 * وحاويةُ الثوابت التي يُنشئها ليست ضرراً هنا بل مرادٌ: الصندوقُ المحوَّل
 * يملأ النافذة بالضبط، فالستائرُ الثابتة فيه تملؤها وتكبر معها.
 */
const BOARD_W = 1440;
const BOARD_H = 900;

const PHONE_W = 460;
const isPhone = () => window.innerWidth < 760;

function useBoardScale() {
  const [fit, setFit] = useState({ scale: 1, phone: false });
  useEffect(() => {
    const fit = () => {
      if (isPhone()) {
        setFit({
          scale: Math.round(Math.min(1.4, window.innerWidth / PHONE_W) * 100) / 100,
          phone: true,
        });
        return;
      }
      const by = Math.min(window.innerWidth / BOARD_W, window.innerHeight / BOARD_H);
      /* حدٌّ أدنى لئلا تصغر عن القراءة، وأعلى لئلا تتضخّم على جدارٍ كامل */
      setFit({ scale: Math.round(Math.max(0.68, Math.min(2.4, by)) * 100) / 100, phone: false });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return fit;
}

/** شاشة العرض تملأ البروجكتر — لا شيء فيها أصغر من ٢٨px */
function Board({ room }: { room: RoomState }) {
  const joinUrl = `${location.origin}/play?code=${room.code}`;
  /* لونا الرمز من أرضية الوضع الغامق وحبره — فيُمسح من آخر القاعة */
  const qr = useQr(joinUrl, '#0f1821ff', '#e4f0f8ff');
  const { scale, phone } = useBoardScale();
  /*
   * مشهد نهاية الجولة في القاعة على ثلاث لقطات:
   *   ١) ستارةُ السكون تنزل باسم من توقّف نبضه.
   *   ٢) تنفرج نصفين — بلا نبضةٍ قاصّة — فتكشف تحتها نتائجَ الجولة.
   *   ٣) فإذا بدأت الجولة التالية عبرت النبضةُ الزرقاء فقصّت النتائج
   *      ونزاحت، فتُسلّم الشاشة إلى الجولة الجديدة.
   * ولذلك تُركَّب الستارتان معاً: الثانية جاهزة تحت الأولى قبل انفراجها.
   */
  const lives = room.lives ?? 1;
  const stopped = useFlatlineMoment(room.teams, room.round, lives, room.status, room.fallen ?? []);
  const racing =
    room.status === 'countdown' || room.status === 'running' || room.status === 'paused';
  const curtain = useLingering(room.status === 'ended' ? room.result : null, CURTAIN_OUT_MS);

  /*
   * القاعة تقرأ سباقاً لا جدولاً: الترتيب هنا بما بقي من الوقت لحظةً
   * بلحظة، والساكنون في الذيل. فإذا سبق أحدٌ أحداً رأت القاعةَ التجاوزَ
   * يحدث، لا نتيجتَه بعد أن حدث.
   */
  const live = [...room.teams].sort((a, b) => {
    /* من دخل والجولة جارية يُذيَّل: ليس متسابقاً، وعدّادُه الممتلئ ليس تصدّراً */
    if (a.waiting !== b.waiting) return a.waiting ? 1 : -1;
    if (a.flatlined !== b.flatlined) return a.flatlined ? 1 : -1;
    return b.timeMs - a.timeMs || b.score - a.score;
  });
  const dense = denseLayout(live.length);
  /*
   * في القاعة الكبيرة يُعاد الترتيبُ كل ثانيةٍ ونصف لا مع كل إجابة: ثلاثون
   * صفّاً في أعمدةٍ تتبادل أماكنها أربع مرّاتٍ في الثانية تصير زحاماً لا
   * يُقرأ فيه اسم. والمتوقّفُ يُذيَّل فوراً — ذاك خبرٌ لا يُؤجَّل.
   */
  const order = useSteadyOrder(
    live.map((t) => t.id),
    dense ? 1500 : 0,
    live.filter((t) => t.flatlined).length + ':' + room.status,
  );
  const ranked = [...live].sort((a, b) => order(a.id) - order(b.id));
  const leaderId = ranked.find((t) => !t.flatlined && !t.waiting)?.id;
  const strikes = (room.cardEvents ?? []).filter((event) => event.kind !== 'duel');

  const board = useRef<HTMLDivElement>(null);
  useReorderSlide(board, ranked.map((t) => t.id).join(','));

  /*
   * المقاسُ يُقسَّم عليه قبل أن يُضرب فيه.
   *
   * ‎zoom‎ يضرب المقاسَ المستعمَل، و‎100%‎ تُحسب من الأب قبل الضرب — فلو
   * تُركت ‎h-full‎ لخرج الطولُ عن الشاشة بنسبة الزوم. فيُعطى البعدان
   * مقلوبَ النسبة، فيعود الحاصلُ ملءَ الشاشة بالضبط.
   */
  return (
    <div className="h-full w-full overflow-hidden">
      <div
        className={`flex flex-col ${phone ? 'px-4' : 'px-14'}`}
        style={{
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
          /* يمينُ الأعلى: الأصلُ في اتجاه القراءة، وإلا انزاح اللوحُ كلُّه */
          transformOrigin: 'top right',
        }}
      >
        {/*
         * الترويسة على سطحٍ لا على الأرضية: أبيضُ في الفاتح وأسودُ في الغامق.
         *
         * ومقاسُها أُنزل: كانت ٩٦ ارتفاعاً بعلامةٍ في أربعين وشاراتٍ في ستٍّ
         * وعشرين، فتأخذ من المجاري — وهي المقصودةُ من الشاشة — عُشرَ الطول.
         * الترويسةُ تقول أين أنت، والمجاري تقول ما يجري: للثانية الأولوية.
         */}
        <header
          className={`flex shrink-0 items-center justify-between border-b-2 border-line-2 bg-surface ${
            phone ? '-mx-4 h-[60px] px-4' : '-mx-14 h-[68px] px-14'
          }`}
        >
          <Wordmark className={phone ? 'text-[24px]' : 'text-[28px]'} />
          {/*
           * نبضاتُ الجولة في وسط الترويسة: تنكسر نبضةٌ باسم كل من يسكن —
           * فالقاعةُ ترى كم بقي قبل أن تنتهي. وبثمانيةٍ فأقلّ لا تُرسم.
           */}
          {lives > 1 && racing && (
            <LivesBar
              lives={lives}
              fallen={room.fallen ?? []}
              size={phone ? 'sm' : 'lg'}
              names={!phone}
            />
          )}
          <div className={`flex items-center gap-3 ${phone ? 'text-[15px]' : 'text-[19px]'}`}>
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
              phone ? (
                <PhoneLobby code={room.code} qr={qr} teams={room.teams} />
              ) : (
                <Lobby code={room.code} qr={qr} teams={room.teams} />
              )
            ) : room.status === 'finished' && room.standings ? (
              /*
               * m-auto لا items-center: الوسطُ بالفلكس يقصّ أعلى ما طال عن الشاشة
               * فيضيع البطل. وفوق ثمانيةٍ تبقى المنصّةُ أشرطةً والبقيّةُ شبكةً صغيرة.
               */
              <FitScreen on={!phone} watch={`${room.standings.length}:${room.reveal?.step ?? 0}`}>
                {/* الأسماءُ الحقيقية تحت المستعارة، تُملأ بكل ضغطةِ كشفٍ من المنظّم */}
                <Standings
                  standings={room.standings}
                  names={room.reveal?.names}
                  bars={room.standings.length > 8 ? 2 : undefined}
                />
              </FitScreen>
            ) : (
              <div
                ref={board}
                className={`min-h-0 flex-1 py-4 ${
                  phone
                    ? 'flex flex-col justify-start gap-2.5 overflow-y-auto'
                    : dense
                      ? 'grid content-center'
                      : 'flex flex-col justify-center gap-2.5'
                }`}
                style={
                  !phone && dense
                    ? {
                        /* ينزل العمودُ قبل أن يعبر: الأولُ أعلى اليمين والترتيبُ يُقرأ عموداً عموداً */
                        gridAutoFlow: 'column',
                        gridTemplateColumns: `repeat(${dense.cols}, minmax(0, 1fr))`,
                        gridTemplateRows: `repeat(${dense.rows}, ${dense.row}px)`,
                        gap: `${dense.gap}px ${Math.round(dense.gap * 2.4)}px`,
                      }
                    : undefined
                }
              >
                {ranked.map((team, index) =>
                  !phone && dense ? (
                    <CompactChannel
                      key={team.id}
                      team={team}
                      rank={index + 1}
                      status={room.status}
                      leader={team.id === leaderId}
                      font={dense.font}
                    />
                  ) : phone ? (
                    <PhoneChannel
                      key={team.id}
                      team={team}
                      rank={index + 1}
                      status={room.status}
                      leader={team.id === leaderId}
                    />
                  ) : (
                    <Channel
                      key={team.id}
                      team={team}
                      rank={index + 1}
                      status={room.status}
                      leader={team.id === leaderId}
                    />
                  ),
                )}
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

        <CountdownGate ms={room.countdownMs} on={room.status === 'countdown'} />
        {/* المبارزاتُ مواجهةٌ أعلى الشاشة، وسائرُ البطاقات شاراتٌ في أسفلها */}
        {room.status === 'countdown' && (
          <DuelStage duels={(room.cardEvents ?? []).filter((event) => event.kind === 'duel')} />
        )}
        {room.status === 'countdown' && strikes.length > 0 && (
          <div className="pointer-events-none fixed inset-x-0 bottom-[6vh] z-[60] flex flex-wrap items-center justify-center gap-[1vw] px-[4vw]">
            {strikes.map((event, i) => {
              const look = CARD_LOOK[event.kind === 'hit' ? event.card : 'mirror'];
              return (
                <div
                  key={i}
                  className="rise-in flex items-center gap-[0.6vw] rounded-card bg-surface/95 px-[1.4vw] py-[1vh] text-[clamp(16px,1.8vw,32px)] font-black shadow-[inset_0_0_0_1px_var(--color-line-2)]"
                  style={{ animationDelay: `${i * 0.12}s` }}
                >
                  <look.Icon className={look.ink} style={{ width: '1.1em', height: '1.1em' }} />
                  {describe(event)}
                </div>
              );
            })}
          </div>
        )}

        {room.status === 'paused' && (
          <div className="veil-in fixed inset-0 z-40 flex items-center justify-center bg-ground/92">
            <PausedMark />
          </div>
        )}

        {curtain.value && (
          <Results phone={phone} result={curtain.value} leaving={curtain.leaving} />
        )}

        {/* فوق النتائج: إعلانُ السكون، ينفرج عنها بعد لحظتين */}
        {stopped.name && (
          <FlatlineMoment name={stopped.name} leaving={stopped.leaving} phone={phone} />
        )}
      </div>
    </div>
  );
}

/**
 * لوحةٌ تسعها الشاشةُ كلُّها: البروجكتر لا يُمرَّر.
 *
 * الأسماءُ الحقيقية سطرٌ ثانٍ تحت كل مستعار، فتطول لوحةُ الأوائل مع كل
 * كشف، وفي القاعة الكبيرة تتجاوز الشاشة فيضيع آخرُها. فإن طالت صُغّرت
 * كلُّها معاً (scale) حتى تسعها، ووُسّطت فيما بقي. والتصغيرُ رسمٌ لا تخطيط:
 * لو صُغّرت بـzoom لضاقت الحاوية فكبُر خطُّها المقيس بها (cqw) — دورٌ لا ينتهي.
 * وفي الجوّال (on=false) تُمرَّر كما كانت.
 */
function FitScreen({ on, watch, children }: { on: boolean; watch: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, top: 0 });

  useLayoutEffect(() => {
    const outer = box.current;
    const inner = body.current;
    if (!on || !outer || !inner) return setFit({ scale: 1, top: 0 });
    const measure = () => {
      const room = outer.clientHeight;
      const need = inner.offsetHeight;
      const scale = need > room ? room / need : 1;
      setFit({ scale, top: Math.max(0, (room - need * scale) / 2) });
    };
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(outer);
    watcher.observe(inner);
    return () => watcher.disconnect();
  }, [on, watch]);

  if (!on) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto py-6">
        <div className="m-auto w-full">{children}</div>
      </div>
    );
  }
  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-hidden my-6">
      <div
        ref={body}
        className="absolute inset-x-0 top-0 origin-top"
        style={{ transform: `translateY(${fit.top}px) scale(${fit.scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * ترتيبٌ يتبدّل على مهل: يُؤخذ الترتيبُ الجديد إذا مضت المهلة أو تبدّل
 * المفتاح (سكن نبضٌ، تبدّلت الحال)، وإلا بقي السابق. ومن جاء جديداً يُلحق
 * بآخره حتى يُعاد الترتيب.
 */
function useSteadyOrder(ids: string[], ms: number, key: string) {
  const kept = useRef<{ ids: string[]; at: number; key: string }>({ ids, at: 0, key });
  const now = Date.now();
  if (ms === 0 || kept.current.key !== key || now - kept.current.at >= ms) {
    kept.current = { ids, at: now, key };
  }
  const index = new Map(kept.current.ids.map((id, i) => [id, i]));
  return (id: string) => index.get(id) ?? ids.length + ids.indexOf(id);
}

/**
 * شاشة الانتظار: وظيفتها الوحيدة أن ينضمّ الناس.
 * فلا عدادات ولا مجارٍ — رمز كبير يُقرأ من آخر صفّ، وأسماء من انضمّ.
 */
function Lobby({ code, qr, teams }: { code: string; qr: string; teams: PublicTeam[] }) {
  /*
   * القاعةُ الكبيرة تملأ الشاشة أسماءً: فكلما كثروا صغرت الأسماءُ والرمزُ
   * معاً، وغاب التوقيع — وإلا دفعت الأسماءُ الرمزَ إلى الترويسة وركب
   * التوقيعُ الذيل. والرمزُ يبقى أكبرَ ما في الشاشة مهما كثروا.
   */
  const crowd = teams.length > 40 ? 'xl' : teams.length > 18 ? 'lg' : '';
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col justify-center py-8 ${crowd ? 'gap-7' : 'gap-12'}`}
    >
      <div className="flex items-center justify-center gap-16">
        {qr && (
          <div className="rounded-card bg-ink p-4">
            <img src={qr} alt="امسح للانضمام" className={crowd ? 'size-44' : 'size-60'} />
          </div>
        )}
        <div>
          <p className="text-[34px] font-medium text-muted">
            <span className="font-black text-ink">{location.host}/play</span>
          </p>
          <div
            className={`tnum leading-none font-black tracking-[0.1em] text-signal ${
              crowd ? 'mt-4 text-[112px]' : 'mt-6 text-[150px]'
            }`}
          >
            {code}
          </div>
        </div>
      </div>

      <div className="border-t-2 border-line-2 pt-8">
        <p className="tnum mb-5 text-[28px] font-bold tracking-[0.14em] text-muted">
          {teams.length === 0 ? 'بانتظار انضمام اللاعبين…' : `انضمّ ${playersWord(teams.length)}`}
        </p>
        <div className="flex flex-wrap gap-3">
          {teams.map((team) => (
            <span
              key={team.id}
              className={`rise-in rounded-card bg-surface font-black shadow-[inset_0_0_0_1px_var(--color-line-2)] ${
                crowd === 'xl'
                  ? 'px-3.5 py-1.5 text-[19px]'
                  : crowd === 'lg'
                    ? 'px-5 py-2.5 text-[25px]'
                    : 'px-7 py-3.5 text-[34px]'
              }`}
            >
              {team.name}
            </span>
          ))}
        </div>
      </div>

      {/*
       * التوقيع على شاشة الانتظار وحدها: القاعةُ تقرؤها دقائقَ وهي تنضمّ،
       * فهو موضعُه. ولا يظهر والجولة تجري — لا يُزاحم عدّاداً.
       * والقياسُ مكبَّرٌ لأن بينه وبين العين عرضُ القاعة.
       */}
      {!crowd && <Credit className="text-center !text-[20px]" />}
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
  const effects = inRound(status) ? team.effects : undefined;

  return (
    <div
      data-row={team.id}
      style={stateStyle(level, team.timeMs)}
      className={`relative grid max-h-[128px] min-h-[86px] flex-1 grid-cols-[64px_minmax(0,380px)_minmax(0,1fr)_168px] items-center gap-6 overflow-hidden rounded-card px-6 ${
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
          {team.waiting ? (
            'ينتظر الجولة القادمة'
          ) : frozen && team.frozenBy ? (
            /* القاعة تحبّ أن تعرف من جمّد من — والمجمَّد يُقرأ له عذرُه */
            <span className="text-frost">جمّده {team.frozenBy}</span>
          ) : effects?.length ? (
            /* شاراتُ البطاقات تحلّ محلّ عدد الصحيحات: هي الخبرُ الأجدّ في الجولة */
            <EffectBadges effects={effects} size="lg" className="flex-nowrap overflow-hidden" />
          ) : (
            `${team.correct}/${team.answered} إجابة صحيحة`
          )}
        </div>
      </div>

      <Lane
        timeMs={team.timeMs}
        running={status === 'running'}
        flatlined={team.flatlined}
        size="lg"
        className="relative h-[58px]"
      />
      <RevivedFlash at={team.revivedAt} className="text-[38px]" />

      {/* العدّاد لا يغيب وإن سكن النبض: الصفر خبرٌ يُقرأ، والكلمة تحته تفسّره */}
      <div className="relative text-center">
        {team.waiting ? (
          /* عدّادٌ لم يبدأ لا يُعرض رقماً — الشرطةُ أصدق من ثلاثين ثانيةً لم تُنفَق */
          <>
            <b className="tnum block text-[50px] leading-none font-black text-faint">-</b>
            <span className="mt-1 block text-[28px] font-medium text-muted">ينتظر</span>
          </>
        ) : team.flatlined ? (
          <>
            <b className="tnum block text-[50px] leading-none font-black text-danger">
              {formatTime(team.timeMs)}
            </b>
            <span className="mt-1 flex items-center justify-center gap-2 text-[26px] font-black text-danger">
              <FlatlineIcon size={20} />
              {team.dropped ? 'انقطع اتصاله' : 'توقف النبض'}
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
    </div>
  );
}

/**
 * أول نبض يسكن يُنهي الجولة على الجميع — فليكن حدثاً: ستارةٌ حمراء
 * تنزل باسمه، ثم تنفرج نصفين عن نتائج الجولة تحتها.
 */
function FlatlineMoment({
  name,
  leaving,
  phone,
}: {
  name: string;
  leaving: boolean;
  phone: boolean;
}) {
  return (
    <Curtain mode="drop" tone="var(--color-danger)" cut={false} front leaving={leaving}>
      <div
        className={`relative flex w-full flex-col items-center ${phone ? 'gap-5 px-6' : 'gap-8 px-20'}`}
      >
        <div
          className="alarm pointer-events-none absolute inset-x-[-80px] inset-y-[-60px]"
          style={{ '--beat': '0.62s' } as React.CSSProperties}
          aria-hidden="true"
        />
        <span className="relative block h-1.5 w-full rounded-full bg-danger" aria-hidden="true" />
        <div className="relative text-center">
          <p
            className={`font-bold tracking-[0.2em] text-danger ${phone ? 'text-[22px]' : 'text-[34px]'}`}
          >
            توقف النبض
          </p>
          <h2
            className={`thump mt-3 font-black text-balance break-words ${
              name.includes('، ')
                ? phone
                  ? 'text-[34px] leading-[1.3]'
                  : 'text-[72px] leading-[1.15]'
                : phone
                  ? 'text-[56px] leading-[1.15]'
                  : 'text-[132px] leading-none'
            }`}
          >
            {name}
          </h2>
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
  phone,
}: {
  result: NonNullable<RoomState['result']>;
  leaving: boolean;
  phone: boolean;
}) {
  return (
    <Curtain mode="drop" tone="var(--color-signal)" leaving={leaving}>
      <div className={phone ? 'w-full px-5' : 'px-20'}>
        <h2 className={`font-black ${phone ? 'mb-5 text-[30px]' : 'mb-9 text-[48px]'}`}>
          نتائج الجولة
        </h2>
        <ResultBars awards={result.awards} big={!phone} />
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

function useFlatlineMoment(
  teams: PublicTeam[],
  round: number,
  lives: number,
  status: RoomState['status'],
  fallen: string[],
) {
  const seen = useRef(new Set<string>());
  const [name, setName] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // كل جولة جديدة تبدأ بصفحة بيضاء: من توقف نبضه أمس قد يتوقف اليوم أيضاً
  useEffect(() => {
    seen.current.clear();
    setName(null);
    setLeaving(false);
  }, [round]);

  /*
   * شاشةٌ فُتحت (أو أُعيد تحميلها) والجولةُ قد انتهت: من سكن قبل فتحها
   * خبرٌ قديم، فلا تُعاد ستارتُه ولا صفيرُه — يُعلَّم مرئياً في أول حالٍ تصل.
   */
  const primed = useRef(false);
  useEffect(() => {
    if (!primed.current) {
      primed.current = true;
      for (const team of teams) if (team.flatlined) seen.current.add(team.id);
      return;
    }
    for (const team of teams) {
      if (team.flatlined && !seen.current.has(team.id)) {
        seen.current.add(team.id);
        /* من سكن وهو منقطع لم يُنهِ الجولة — فلا صفيرَ ولا ستارةَ تقول «انتهت» */
        if (team.dropped) continue;
        /* وبنبضاتٍ كثيرة لا يُنهيها كلُّ من يسكن: مربّعُه ينكسر في الترويسة، والستارةُ لآخرهم */
        if (lives > 1) continue;
        playFlatline();
        setName(team.name);
        setLeaving(false);
      }
    }
  }, [teams]);

  /* انكسرت آخرُ نبضة: الستارةُ باسم من كسرها — هو من أنهى الجولة */
  const was = useRef(status);
  useEffect(() => {
    const before = was.current;
    was.current = status;
    if (lives > 1 && before === 'running' && status === 'ended' && fallen.length) {
      playFlatline();
      /* الجولةُ انتهت بانكسار النبضات كلها: تُسمّى كلُّها لا آخرُها وحده */
      setName(fallen.join('، '));
      setLeaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

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

const VERB: Partial<Record<CardId, string>> = { freeze: 'تجميد', steal: 'سرقة' };

function describe(event: CardEvent) {
  if (event.kind === 'duel') return `${event.by} يبارز ${event.on}`;
  if (event.kind === 'blocked') {
    return `مرآتا ${event.by} و${event.on} تقابلتا فضاع ${VERB[event.card]}`;
  }
  if (event.kind === 'reflected') return `مرآة ${event.on} ردّت ${VERB[event.card]} ${event.by}`;
  if (event.card === 'freeze') return `${event.by} جمّد ${event.on}`;
  return `${event.by} سرق ${event.secs ?? ''} ث من ${event.on}`;
}

/* الشارات خبرُ جولةٍ قائمة — وبعد نهايتها تُخفى حتى تبدأ التالية */
const inRound = (status: RoomState['status']) =>
  status === 'countdown' || status === 'running' || status === 'paused';

/**
 * كم عموداً تحتاج القاعة: سبعةٌ فأقلّ صفوفٌ كاملة كما هي، وما زاد يُصفّ
 * أعمدةً بصفوفٍ أقصر حتى يظهر الجميع في الشاشة — لا يُقصّ آخرُهم. والطولُ
 * المتاح للصفوف نحو ٧٩٠ بكسلاً من لوح ٩٠٠ بعد الترويسة.
 */
function denseLayout(count: number) {
  if (count <= 7) return null;
  const cols = count <= 16 ? 2 : count <= 30 ? 3 : count <= 52 ? 4 : 5;
  const rows = Math.ceil(count / cols);
  const gap = rows > 12 ? 4 : 8;
  const row = Math.max(26, Math.min(96, Math.floor((790 - gap * (rows - 1)) / rows)));
  /*
   * والخطُّ بالأضيق من البُعدين: ارتفاعُ الصفّ وعرضُ العمود. كان بالارتفاع
   * وحده، فبأربعة أعمدة يكبر الرقمُ والوقتُ حتى لا يبقى للاسم إلا حرف.
   * والصفُّ يحتاج نحو عشرة أضعافٍ من الخطّ: مركزٌ ووقتٌ واسم.
   */
  const width = (1328 - Math.round(gap * 2.4) * (cols - 1)) / cols;
  const font = Math.max(14, Math.min(34, Math.round(row * 0.42), Math.floor(width / 10)));
  return { cols, rows, row, gap, font };
}

/**
 * ومضةُ صاعق القلب على صفّ من عاد نبضه: القاعة ترى العدّاد يقفز من
 * الصفر إلى عشرين فتعرف ما حدث.
 */
function RevivedFlash({ at, className = '' }: { at?: number | null; className?: string }) {
  const [on, setOn] = useState(false);
  const seen = useRef(at);
  useEffect(() => {
    if (!at || at === seen.current) return;
    seen.current = at;
    setOn(true);
    const timer = setTimeout(() => setOn(false), 2200);
    return () => clearTimeout(timer);
  }, [at]);
  if (!on) return null;
  return (
    <span
      className={`pointer-events-none absolute inset-0 z-[2] flex items-center justify-center gap-[0.4em] bg-danger/25 ${className}`}
    >
      <ReviveIcon size={36} className="thump text-danger" />
      <b className="thump font-black">عاد نبضه</b>
    </span>
  );
}

/**
 * صفٌّ مضغوط للقاعة الكبيرة: المجرى خلفيةٌ خافتة على طول الصفّ، وفوقه
 * المركز والاسم وشارات البطاقات أيقوناتٍ بلا نصّ، ثم الوقت والنقاط.
 * الخطُّ يتبع ارتفاع الصفّ، فيبقى مقروءاً من آخر القاعة ما أمكن.
 */
function CompactChannel({
  team,
  rank,
  status,
  leader,
  font,
}: {
  team: PublicTeam;
  rank: number;
  status: RoomState['status'];
  leader?: boolean;
  font: number;
}) {
  const frozen = team.locked && !team.flatlined;
  const gilded = team.doubled && !team.flatlined && !frozen;
  const level = teamLevel(team.timeMs, team.flatlined);
  const dying = level === 'danger' && status === 'running' && !frozen;
  const icon = Math.round(font * 0.8);
  const effects = inRound(status) ? (team.effects ?? []) : [];

  return (
    <div
      data-row={team.id}
      style={{ ...stateStyle(level, team.timeMs), fontSize: font }}
      className={`relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[0.5em] overflow-hidden rounded-card px-[0.6em] ${
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
      {/* المجرى خلفيةٌ في غلافٍ مطلق: ‎.lane‎ تفرض موضعها النسبيّ فلا يُطلَق هو نفسه */}
      {!team.waiting && (
        <span className="pointer-events-none absolute inset-0 opacity-30" aria-hidden="true">
          <Lane
            timeMs={team.timeMs}
            running={status === 'running'}
            flatlined={team.flatlined}
            size="sm"
            className="h-full w-full"
          />
        </span>
      )}

      <span
        className={`tnum relative w-[1.6em] text-center ${
          leader && !team.flatlined ? 'font-black text-signal' : 'font-light text-faint'
        }`}
      >
        {rank}
      </span>

      <span
        className={`relative flex min-w-0 items-center gap-[0.3em] font-black ${team.flatlined ? 'text-faint' : ''}`}
      >
        {leader && !team.flatlined && <CrownIcon size={icon} className="shrink-0 text-signal" />}
        {/* الاسمُ أولى بالمكان من الشارات: هي تُقصّ قبله */}
        <span className="max-w-[82%] shrink-0 truncate">{team.name}</span>
        <span className="flex min-w-0 items-center gap-[0.25em] overflow-hidden">
          {frozen && <SnowflakeIcon size={icon} className="shrink-0 text-frost" />}
          {gilded && <span className="shrink-0 text-gold">×٢</span>}
          {effects.map((fx, i) => {
            const look = CARD_LOOK[fx.card];
            return look ? (
              <look.Icon key={i} size={icon} className={`shrink-0 ${look.ink}`} />
            ) : null;
          })}
          {!team.connected && <OfflineIcon size={icon} className="shrink-0 text-faint" />}
        </span>
      </span>

      <b
        className={`tnum relative font-black ${
          team.waiting ? 'text-faint' : team.flatlined ? 'text-danger' : 'ink-state'
        }`}
      >
        {team.waiting ? '-' : formatTime(team.timeMs)}
      </b>

      <RevivedFlash at={team.revivedAt} />
    </div>
  );
}

function PhoneLobby({ code, qr, teams }: { code: string; qr: string; teams: PublicTeam[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-6 overflow-y-auto py-8 text-center">
      {qr && (
        <div className="rounded-card bg-ink p-3">
          <img src={qr} alt="امسح للانضمام" className="size-44" />
        </div>
      )}
      <div>
        <p className="text-[17px] font-medium text-muted">
          <span className="font-black text-ink">{location.host}/play</span>
        </p>
        <div className="tnum mt-2 text-[84px] leading-none font-black tracking-[0.1em] text-signal">
          {code}
        </div>
      </div>
      <div className="w-full border-t-2 border-line-2 pt-5">
        <p className="tnum mb-3 text-[17px] font-bold tracking-[0.1em] text-muted">
          {teams.length === 0 ? 'بانتظار انضمام اللاعبين…' : `انضمّ ${playersWord(teams.length)}`}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {teams.map((team) => (
            <span
              key={team.id}
              className="rise-in rounded-card bg-surface px-4 py-2 text-[19px] font-black shadow-[inset_0_0_0_1px_var(--color-line-2)]"
            >
              {team.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhoneChannel({
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
  const effects = inRound(status) ? team.effects : undefined;

  return (
    <div
      data-row={team.id}
      style={stateStyle(level, team.timeMs)}
      className={`relative grid shrink-0 grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 overflow-hidden rounded-card px-4 py-3.5 ${
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
        className={`tnum relative text-center text-[24px] ${
          leader && !team.flatlined ? 'font-black text-signal' : 'font-light text-faint'
        }`}
      >
        {rank}
      </div>

      <div className="relative min-w-0">
        <div
          className={`flex items-center gap-1.5 text-[24px] leading-tight font-black ${
            team.flatlined ? 'text-faint' : ''
          }`}
        >
          {leader && !team.flatlined && <CrownIcon size={17} className="shrink-0 text-signal" />}
          <span className="truncate">{team.name}</span>
          {frozen && <SnowflakeIcon size={17} className="shrink-0 text-frost" />}
          {team.doubled && !team.flatlined && (
            <span className="shrink-0 text-[17px] font-black text-gold">×٢</span>
          )}
          {!team.connected && <OfflineIcon size={16} className="shrink-0 text-faint" />}
        </div>
        <div className="tnum mt-0.5 truncate text-[15px] font-medium text-muted">
          {team.waiting ? (
            'ينتظر الجولة القادمة'
          ) : frozen && team.frozenBy ? (
            <span className="text-frost">جمّده {team.frozenBy}</span>
          ) : team.flatlined ? (
            <span className="font-bold text-danger">
              {team.dropped ? 'انقطع اتصاله' : 'توقف النبض'}
            </span>
          ) : (
            <>
              {team.correct}/{team.answered} صحيحة
            </>
          )}
        </div>
      </div>

      <b
        className={`tnum relative text-[34px] leading-none font-black ${
          team.waiting ? 'text-faint' : team.flatlined ? 'text-danger' : 'ink-state'
        }`}
      >
        {team.waiting ? '-' : formatTime(team.timeMs)}
      </b>

      {effects && effects.length > 0 && (
        <EffectBadges effects={effects} size="md" className="relative col-span-3" />
      )}
      <Lane
        timeMs={team.timeMs}
        running={status === 'running'}
        flatlined={team.flatlined}
        size="md"
        className="relative col-span-3 h-[38px]"
      />
      <RevivedFlash at={team.revivedAt} className="text-[22px]" />
    </div>
  );
}
