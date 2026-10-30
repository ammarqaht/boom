import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Credit, Wordmark, prefersReducedMotion, useTheme } from '../components/ui';
import { Lane } from '../components/game';
import { ScreenIcon, SlidersIcon, UsersIcon } from '../components/icons';
import { Practice } from './home/Practice';
import { CardLab } from './home/CardLab';
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

          {/*
           * بابان لا أربعة: من جاء ليلعب ينضمّ، ومن جاء ليدير يُنشئ. والانضمامُ
           * أوّلُهما وأبرزُهما، فأكثرُ الداخلين لاعبون. وشاشةُ العرض رابطُها في
           * لوحة المنظّم، فلا تُزاحم هنا.
           */}
          <div className="doors">
            <Link to="/play" className="tap door door-make" onClick={tap}>
              <UsersIcon size={22} />
              انضمّ إلى غرفة
            </Link>
            <Link to="/admin" className="tap door door-show" onClick={tap}>
              <SlidersIcon size={22} />
              أنشئ غرفة
            </Link>
          </div>
        </section>

        <section id="try" className="home-sec mx-auto max-w-6xl">
          <Head n="٠١" title="جرّب جولة" />
          <Practice startKey={0} />
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
    </div>
  );
}
