import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Lane, RollingNumber } from '../../components/game';
import { Button, dangerLevel, formatTime, levelVar } from '../../components/ui';
import { FlatlineIcon, PlayIcon, RestartIcon, TrophyIcon } from '../../components/icons';
import { BOTS, DEMO, ME, QUESTIONS, arabic, rankPoints } from './demo';
import { tap, useInView, usePageVisible } from './hooks';

type Phase = 'idle' | 'count' | 'live' | 'over';

type Team = {
  id: string;
  name: string;
  me: boolean;
  ms: number;
  flat: boolean;
  correct: number;
  turn: number;
  next: number;
  jolt: { at: number; up: boolean; key: number } | null;
};

type Asking = { q: string; options: string[]; right: number };
type Reveal = { chosen: number; right: number };
type Result = { id: string; name: string; me: boolean; points: number; ms: number; flat: boolean };

function shuffle<T>(list: T[]) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function freshTeams(): Team[] {
  return [
    { id: 'me', name: ME, me: true },
    ...BOTS.map((b, i) => ({ id: `bot${i}`, name: b.name, me: false })),
  ].map((t, i) => ({
    ...t,
    ms: DEMO.startMs,
    flat: false,
    correct: 0,
    turn: 0,
    next: i === 0 ? Infinity : BOTS[i - 1].every,
    jolt: null,
  }));
}

function score(teams: Team[]): Result[] {
  const alive = teams.filter((t) => !t.flat).sort((a, b) => b.ms - a.ms);
  const rows = [
    ...alive.map((t, i) => ({ ...t, points: rankPoints(i, teams.length) + t.correct })),
    ...teams.filter((t) => t.flat).map((t) => ({ ...t, points: t.correct })),
  ];
  return rows
    .map(({ id, name, me, points, ms, flat }) => ({ id, name, me, points, ms, flat }))
    .sort((a, b) => b.points - a.points || b.ms - a.ms);
}

export function Practice({ startKey }: { startKey: number }) {
  const [box, inView] = useInView<HTMLDivElement>();
  const visible = usePageVisible();
  const paused = !inView || !visible;

  const [phase, setPhase] = useState<Phase>('idle');
  const [, render] = useState(0);
  const [initial] = useState(freshTeams);
  const teams = useRef<Team[]>(initial);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  const revealTimer = useRef(0);
  const [said, setSaid] = useState('');
  const clock = useRef(0);
  const deck = useRef<number[]>([]);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [flash, setFlash] = useState<{ key: number; up: boolean } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const joltKey = useRef(0);

  const draw = useCallback(() => {
    if (!deck.current.length) deck.current = shuffle(QUESTIONS.map((_, i) => i));
    const q = QUESTIONS[deck.current.pop()!];
    const order = shuffle([0, 1, 2, 3]);
    setAsking({ q: q.q, options: order.map((i) => q.options[i]), right: order.indexOf(0) });
  }, []);

  const start = useCallback(() => {
    window.clearTimeout(revealTimer.current);
    teams.current = freshTeams();
    clock.current = 0;
    setReveal(null);
    setResults([]);
    draw();
    setPhase('count');
  }, [draw]);

  useEffect(() => {
    if (startKey > 0 && (phaseRef.current === 'idle' || phaseRef.current === 'over')) start();
  }, [startKey, start]);

  useEffect(() => () => window.clearTimeout(revealTimer.current), []);

  useEffect(() => {
    if (paused || (phase !== 'count' && phase !== 'live')) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(250, now - last);
      last = now;
      clock.current += dt;

      if (phase === 'count') {
        if (clock.current >= DEMO.countdownMs) {
          clock.current = 0;
          setPhase('live');
        }
        render((n) => n + 1);
        return;
      }

      for (const [i, team] of teams.current.entries()) {
        if (team.flat) continue;
        team.ms -= dt;
        if (team.me) continue;
        const bot = BOTS[i - 1];
        if (clock.current >= team.next) {
          const hit = bot.hits[team.turn % bot.hits.length];
          team.ms = Math.min(DEMO.maxMs, team.ms + (hit ? DEMO.bonusMs : -DEMO.penaltyMs));
          if (hit) team.correct += 1;
          team.turn += 1;
          team.next += bot.every;
          team.jolt = { at: clock.current, up: hit, key: ++joltKey.current };
        }
      }

      const gone = teams.current.filter((t) => t.ms <= 0);
      if (gone.length) {
        for (const t of gone) {
          t.ms = 0;
          t.flat = true;
        }
        const final = score(teams.current);
        setResults(final);
        setSaid(final.map((r, i) => `${i + 1} ${r.name} ${r.points}`).join('، '));
        setPhase('over');
      }
      render((n) => n + 1);
    }, DEMO.tickMs);
    return () => window.clearInterval(id);
  }, [paused, phase]);

  function answer(i: number) {
    if (phase !== 'live' || !asking || reveal) return;
    tap();
    const me = teams.current[0];
    const up = i === asking.right;
    me.ms = Math.max(0, Math.min(DEMO.maxMs, me.ms + (up ? DEMO.bonusMs : -DEMO.penaltyMs)));
    if (up) me.correct += 1;
    me.jolt = { at: clock.current, up, key: ++joltKey.current };
    setFlash({ key: joltKey.current, up });
    setReveal({ chosen: i, right: asking.right });
    setSaid(up ? `صحيحة +${arabic(DEMO.bonusMs / 1000)}` : `خاطئة −${arabic(DEMO.penaltyMs / 1000)}`);
    window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => {
      setReveal(null);
      draw();
    }, DEMO.revealMs);
    render((n) => n + 1);
  }

  const live = phase === 'live' && !paused;
  const me = teams.current[0];
  const count = Math.max(1, Math.ceil((DEMO.countdownMs - clock.current) / 1000));
  const meWon = results[0]?.me;

  const mark = (i: number) => {
    if (!reveal) return '';
    if (i === reveal.right) return 'opt-right';
    if (i === reveal.chosen) return 'opt-wrong';
    return 'opt-mute';
  };

  return (
    <div ref={box} className={`demo ${phase === 'over' ? 'is-over' : ''}`}>
      <p className="sr-only" role="status">
        {said}
      </p>
      {flash && (
        <span
          key={flash.key}
          className="flash demo-flash"
          style={{ backgroundColor: flash.up ? 'var(--color-safe)' : 'var(--color-danger)' }}
          aria-hidden="true"
        />
      )}

      <div className="demo-board">
        {teams.current.map((team) => {
          const jolt = team.jolt && clock.current - team.jolt.at < DEMO.joltMs ? team.jolt : null;
          return (
            <div
              key={team.id}
              className={`demo-row ${team.me ? 'is-me' : ''} ${team.flat ? 'is-flat' : ''}`}
            >
              <span className="demo-name">{team.name}</span>
              <div className="relative min-w-0 flex-1">
                <Lane
                  timeMs={team.ms}
                  running={live && !team.flat}
                  flatlined={team.flat}
                  size="sm"
                  className="h-8 w-full lg:h-9"
                />
                {jolt && phase === 'live' && (
                  <span key={jolt.key} className={`demo-jolt tnum ${jolt.up ? 'is-up' : 'is-down'}`}>
                    {jolt.up ? `+${arabic(DEMO.bonusMs / 1000)}` : `−${arabic(DEMO.penaltyMs / 1000)}`}
                  </span>
                )}
              </div>
              <span className="demo-time tnum">
                {team.flat ? <FlatlineIcon size={20} /> : formatTime(team.ms)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="demo-play">
        {phase === 'idle' && (
          <div className="demo-center">
            <button type="button" className="tap demo-start" onClick={start}>
              <PlayIcon size={30} />
            </button>
            <b className="text-xl font-black">ابدأ الجولة</b>
          </div>
        )}

        {phase === 'count' && (
          <div className="demo-center">
            <span key={count} className="demo-count tnum thump">
              {arabic(count)}
            </span>
          </div>
        )}

        {phase === 'live' && asking && (
          <div className="flex flex-col gap-2.5">
            <div
              className="demo-clock ink-state tnum"
              style={{ '--state': levelVar[dangerLevel(me.ms)] } as CSSProperties}
            >
              {formatTime(me.ms)}
            </div>
            <div className="tile demo-q">{asking.q}</div>
            <div className="grid grid-cols-2 gap-2">
              {asking.options.map((option, i) => (
                <button
                  key={`${asking.q}${i}`}
                  type="button"
                  onClick={() => answer(i)}
                  disabled={!!reveal || paused}
                  style={{ '--opt': `var(--color-opt-${i + 1})` } as CSSProperties}
                  className={`opt demo-opt ${mark(i)}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'over' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <span className={`demo-medal ${meWon ? 'is-win' : ''}`}>
                <TrophyIcon size={20} />
              </span>
              <b className="text-xl font-black">{meWon ? 'تصدّرت القاعة' : 'انتهت الجولة'}</b>
            </div>
            <div className="flex flex-col gap-1.5">
              {results.map((row, i) => (
                <div
                  key={row.id}
                  className={`demo-result rise-in ${row.me ? 'is-me' : ''}`}
                  style={{ animationDelay: `${i * 90}ms` }}
                >
                  <span className="demo-pos tnum">{i + 1}</span>
                  <span className="flex-1 truncate font-bold">{row.name}</span>
                  {row.flat && <FlatlineIcon size={18} className="text-danger" />}
                  <RollingNumber value={row.points} className="demo-pts tnum" />
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={start}>
                <RestartIcon size={18} />
                جولة أخرى
              </Button>
              <Link
                to="/admin"
                className="tap inline-flex items-center justify-center rounded-chip bg-action px-4 py-2.5 font-black text-on-action"
              >
                أنشئ غرفة
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
