import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Credit, Wordmark, prefersReducedMotion, useTheme } from '../components/ui';
import { Curtain, Lane } from '../components/game';
import {
  ClockIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  ScreenIcon,
  SlidersIcon,
  UsersIcon,
} from '../components/icons';
import { Practice } from './home/Practice';
import { CardLab } from './home/CardLab';
import { DEMO, arabic } from './home/demo';
import { tap } from './home/hooks';

const BOOT_KEY = 'nabdah:boot';

function remember() {
  try {
    sessionStorage.setItem(BOOT_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

function Boot() {
  const [on, setOn] = useState(() => {
    if (prefersReducedMotion()) return false;
    try {
      return sessionStorage.getItem(BOOT_KEY) === null;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!on) return;
    remember();
    const id = window.setTimeout(() => setOn(false), 1600);
    return () => window.clearTimeout(id);
  }, [on]);

  if (!on) return null;

  return (
    <div className="boot" aria-hidden="true">
      <span className="boot-trace" />
      <Wordmark className="boot-mark text-5xl" />
    </div>
  );
}

function Head({ n, title, children }: { n: string; title: string; children?: ReactNode }) {
  return (
    <div className="home-head">
      <span className="home-n tnum">{n}</span>
      <h2 className="home-title">{title}</h2>
      {children}
    </div>
  );
}

const HALL = [
  { n: '١', to: '/admin', title: 'أنشئ غرفة', Icon: SlidersIcon, art: 'make' },
  { n: '٢', to: '/display', title: 'اعرضها على الشاشة', Icon: ScreenIcon, art: 'show' },
  { n: '٣', to: '/play', title: 'الفرق تدخل بالرمز', Icon: UsersIcon, art: 'join' },
] as const;

function HallArt({ kind }: { kind: (typeof HALL)[number]['art'] }) {
  if (kind === 'make') {
    return (
      <div className="hall-art">
        {[72, 46, 88].map((w, i) => (
          <span key={i} className="hall-slider">
            <span style={{ width: `${w}%` }} />
          </span>
        ))}
      </div>
    );
  }
  if (kind === 'show') {
    return (
      <div className="hall-art hall-screen">
        <span className="hall-code tnum" dir="ltr">
          NB7Q
        </span>
      </div>
    );
  }
  return (
    <div className="hall-art hall-phone">
      <Lane timeMs={21000} size="sm" className="h-8 w-full" />
      <div className="grid grid-cols-2 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="hall-opt"
            style={{ '--opt': `var(--color-opt-${i})` } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  useTheme('dark');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [going, setGoing] = useState(false);
  const [startKey, setStartKey] = useState(0);

  const ready = code.length >= 4;

  useEffect(() => {
    if (!going) return;
    const id = window.setTimeout(() => navigate(`/play?code=${code}`), 640);
    return () => window.clearTimeout(id);
  }, [going, code, navigate]);

  function enter() {
    if (!ready || going) return;
    tap();
    setGoing(true);
  }

  function tryRound() {
    tap();
    document.getElementById('try')?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    setStartKey((k) => k + 1);
  }

  return (
    <div className="flex min-h-full flex-col">
      <Boot />

      <header className="home-bar">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-10">
          <a href="#top" aria-label="نبضة" className="me-auto inline-flex min-h-11 items-center">
            <Wordmark className="text-2xl" />
          </a>
          <nav className="hidden items-center gap-1 md:flex">
            <a href="#try" className="home-link">
              جرّب
            </a>
            <a href="#cards" className="home-link">
              البطاقات
            </a>
            <a href="#hall" className="home-link">
              القاعة
            </a>
          </nav>
          <Link to="/display" className="tap home-ghost" aria-label="اعرض الغرفة">
            <ScreenIcon size={18} />
            <span className="hidden sm:inline">اعرض</span>
          </Link>
          <Link to="/admin" className="tap home-make" onClick={tap}>
            <SlidersIcon size={18} />
            أنشئ غرفة
          </Link>
        </div>
      </header>

      <main id="top" className="w-full flex-1 px-4 sm:px-10">
        <section className="home-hero mx-auto max-w-6xl">
          <div className="hero-rail relative flex h-28 items-center justify-center sm:h-44">
            <span
              className="lane-run lane-drift opacity-90"
              style={
                {
                  '--state': 'var(--color-signal)',
                  '--tile': '300px',
                  '--amp': '110px',
                  '--drift': '3.6s',
                  '--trace': "url('/trace.svg')",
                } as CSSProperties
              }
            />
            <Wordmark className="word-beat relative z-10 text-6xl sm:text-8xl" />
          </div>

          <h1 className="hero-line">
            ثلاثون ثانية… <br className="sm:hidden" />
            والنبض بين يديك
          </h1>

          <div className="doors">
            <form
              className="door door-join"
              onSubmit={(e) => {
                e.preventDefault();
                enter();
              }}
            >
              <input
                dir="ltr"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, '')
                      .slice(0, 6),
                  )
                }
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="رمز الغرفة"
                aria-label="رمز الغرفة"
                className="gate-code"
              />
              <button type="submit" disabled={!ready} className="tap gate-go">
                ادخل
              </button>
            </form>

            <Link to="/admin" className="tap door door-make" onClick={tap}>
              <SlidersIcon size={22} />
              أنشئ غرفة
            </Link>
            <Link to="/display" className="tap door door-show" onClick={tap}>
              <ScreenIcon size={22} />
              اعرض الغرفة
            </Link>
          </div>

          <button type="button" className="tap home-try" onClick={tryRound}>
            <span className="home-try-dot">
              <PlayIcon size={16} />
            </span>
            جرّب جولة الآن
          </button>
        </section>

        <section id="try" className="home-sec mx-auto max-w-6xl">
          <Head n="٠١" title="جرّب جولة">
            <div className="home-rules tnum">
              <span>
                <ClockIcon size={16} />
                {arabic(DEMO.startMs / 1000)}
              </span>
              <span className="text-safe">
                <PlusIcon size={16} />
                {arabic(DEMO.bonusMs / 1000)}
              </span>
              <span className="text-danger">
                <MinusIcon size={16} />
                {arabic(DEMO.penaltyMs / 1000)}
              </span>
            </div>
          </Head>
          <Practice startKey={startKey} />
        </section>

        <section id="cards" className="home-sec mx-auto max-w-6xl">
          <Head n="٠٢" title="مختبر البطاقات" />
          <CardLab />
        </section>

        <section id="hall" className="home-sec mx-auto max-w-6xl">
          <Head n="٠٣" title="القاعة" />
          <div className="grid gap-3 md:grid-cols-3">
            {HALL.map(({ n, to, title, Icon, art }) => (
              <Link key={to} to={to} className="tap hall" onClick={tap}>
                <HallArt kind={art} />
                <div className="flex items-center gap-3">
                  <span className="hall-n tnum">{n}</span>
                  <b className="flex-1 text-lg font-black">{title}</b>
                  <Icon size={20} className="text-muted" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex h-14 w-full max-w-6xl shrink-0 items-center justify-between border-t border-line px-4 sm:px-10">
        <Credit />
        <span className="tnum text-xs font-medium text-faint">
          نبضة · {new Date().getFullYear()}
        </span>
      </footer>

      {going && (
        <Curtain mode="drop" tone="var(--color-signal)" cut={false} leaving={false}>
          <div className="flex flex-col items-center gap-4 px-8 text-center">
            <Wordmark className="word-beat text-5xl" />
            <span className="tnum text-sm font-black tracking-[0.35em] text-signal">{code}</span>
          </div>
        </Curtain>
      )}
    </div>
  );
}
