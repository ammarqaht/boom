import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Credit, Wordmark, formatTime, prefersReducedMotion, useTheme } from '../components/ui';
import { Curtain, Lane, RollingNumber } from '../components/game';
import { ScreenIcon, SlidersIcon, UsersIcon } from '../components/icons';

/*
 * ══════════════════════════════════════════════════════════════
 * صفحة التعريف — «المِرقاب يعمل»
 *
 * الصفحة لا تتكلّم عن اللعبة، الصفحة تلعب أمام الزائر. كل قاعدة من
 * قواعد النبضة تُعرض بمجرىً حيّ يفعل ما تقوله القاعدة: الوقت ينفد،
 * والصواب يمدّه، والخطّ يستقيم فتنتهي الجولة على الجميع.
 *
 * ولماذا هذا لا الشرح بالحرف؟ لأن اللعبة بصريّة: مخطّطٌ يخفت. وأربعة
 * أعمدة نصّية تصف خفوتاً لا تُغني عن خفوتٍ يُرى، وعلى الجوال تصير
 * أربع فقرات مركومة تُمرَّر ولا تُقرأ.
 *
 * ومن يصل هذه الصفحة أصلاً؟ الماسحُ لرمز QR لا يراها — شاشة العرض
 * توجّهه إلى ‎/play?code=‎ مباشرة. فالذي يصلها من جاءه الرابط مجرّداً
 * من الرمز. ولذلك حقل الرمز في البطل نفسه لا خلف نقلة.
 * ══════════════════════════════════════════════════════════════
 */

/* ════════════ أدوات ════════════ */

/**
 * رجعٌ للإبهام عند الضغط.
 *
 * والاهتزاز لا يعمل على iOS — لا وعدَ فيه ولا كسرَ لو غاب، ولذلك
 * الضغطة البصريّة (‎.tap‎) هي الأصل والاهتزاز زيادةٌ لمن ناله.
 */
function tap() {
  if (prefersReducedMotion()) return;
  if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
}

/**
 * هل العنصر في الشاشة؟
 *
 * ولها وجهان: `once` للكشف عند التمرير — يقع مرّة ولا يُنقض، و«الجاري»
 * للعروض الحيّة فتسكن إذا خرجت من الشاشة. والسكون ليس ترفاً: المجرى
 * يكتب في كل إطار، وأربعة عروضٍ تعمل معاً في جيب صاحبها تُذيب بطّاريته
 * على صفحةٍ يقرؤها.
 */
function useInView<T extends HTMLElement>(once = false) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /* لا مراقب أو لا حركة: يُعرض كل شيء ظاهراً مستقرّاً */
    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) io.disconnect();
      },
      { threshold: 0.25, rootMargin: '-6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return [ref, inView] as const;
}

/**
 * ساعة العرض — نبضةٌ كل ١٠٠ مللي.
 *
 * وهي بعينها وتيرة بثّ السيرفر في الجولة الحقيقية: المجرى مبنيٌّ على
 * أن يصله الوقت متقطّعاً فيُكمل ما بينه بنفسه. فلو كتبنا له في كل إطار
 * لأعدنا بناء شجرة React ستّين مرّة في الثانية بلا أن يزداد شيءٌ نعومة.
 *
 * ولمن طلب تقليل الحركة تقف الساعة عند `still` — لقطةٌ ساكنة اختيرت
 * بعد وقوع الحدث، فيرى القاعدة ولا يرى حركة.
 */
function useScene(active: boolean, period: number, still: number) {
  const [t, setT] = useState(still);

  useEffect(() => {
    if (!active || prefersReducedMotion()) return;
    const start = performance.now();
    const id = window.setInterval(() => setT((performance.now() - start) % period), 100);
    return () => window.clearInterval(id);
  }, [active, period]);

  return t;
}

/** غلافُ الكشف: يرتفع العنصر قليلاً حين يدخل الشاشة، ويُرتَّب بالتأخير */
function Reveal({
  delay = 0,
  className = '',
  children,
}: {
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const [ref, seen] = useInView<HTMLDivElement>(true);
  return (
    <div
      ref={ref}
      className={`reveal ${seen ? 'is-in' : ''} ${className}`}
      style={{ '--d': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/* ════════════ الافتتاحية ════════════ */

const BOOT_KEY = 'nabdah:boot';

/**
 * الجهاز يُقلع: خطٌّ يُرسم، ثم ينبض الاسم، ثم تنكشف الصفحة.
 *
 * مرّةً واحدة في الجلسة: افتتاحيةٌ تُرى في كل رجوعٍ إلى الرئيسية تصير
 * حاجزاً بين اللاعب وبين الرمز الذي جاء يكتبه. ومن منع التخزين رآها
 * مرّة في كل فتح — وهذا أهون من أن تُمنع الصفحة من العمل.
 */
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
    try {
      sessionStorage.setItem(BOOT_KEY, '1');
    } catch {
      /* نافذةٌ خاصّة تمنع التخزين — والافتتاحية تمضي على كل حال */
    }
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

/* ════════════ العروض الحيّة ════════════ */

/** ٠١ — الوقت ينفد وحده: مجرىً يجري وعدّادٌ ينزل معه */
function SceneCount({ active }: { active: boolean }) {
  const t = useScene(active, 6400, 3200);
  const ms = Math.max(0, 30000 - (t / 7200) * 30000);

  return (
    <div className="scene">
      <Lane timeMs={ms} running size="md" className="h-20 w-full" />
      <div className="scene-foot">
        <span className="scene-readout tnum">{formatTime(ms)}</span>
        <span className="scene-tag">ثانية</span>
      </div>
    </div>
  );
}

/** ٠٢ — الصواب يمدّ والخطأ يقصّ: نفس المجرى، ولكن يُنتزع منه ويُزاد فيه */
const RIGHT_AT = 1200;
const WRONG_AT = 3600;

function SceneSwing({ active }: { active: boolean }) {
  const t = useScene(active, 7200, 2000);

  let ms = 22000 - t * 2;
  if (t > RIGHT_AT) ms += 5000;
  if (t > WRONG_AT) ms -= 3000;
  ms = Math.max(0, ms);

  /* الشارة تُرى ثانيةً وربعاً بعد الحدث ثم تمضي — بقدر ما يُقرأ لا أكثر */
  const right = t > RIGHT_AT && t < RIGHT_AT + 1250;
  const wrong = t > WRONG_AT && t < WRONG_AT + 1250;

  return (
    <div className="scene">
      <div className="relative w-full">
        <Lane timeMs={ms} running size="md" className="h-20 w-full" />
        {right && <span className="scene-jolt is-up tnum">‎+٥</span>}
        {wrong && <span className="scene-jolt is-down tnum">‎−٣</span>}
      </div>
      <div className="scene-foot">
        <span className="scene-readout tnum">{formatTime(ms)}</span>
        <span className="scene-tag">ثانية</span>
      </div>
    </div>
  );
}

/** ٠٣ — أوّل نبضٍ يسكن يُنهي الجولة على الجميع، لا على صاحبه وحده */
const CUT_AT = 2400;
const THREE = [
  { name: 'الأولى', from: 9500, rate: 2.5 },
  { name: 'الثانية', from: 21000, rate: 1 },
  { name: 'الثالثة', from: 26500, rate: 1.35 },
];

function SceneCut({ active }: { active: boolean }) {
  const t = useScene(active, 6600, 4000);
  const cut = t > CUT_AT;

  return (
    <div className="scene">
      <div className="flex w-full flex-col gap-2.5">
        {THREE.map((team, i) => {
          const ms = Math.max(0, team.from - Math.min(t, CUT_AT) * team.rate);
          return (
            <div key={team.name} className="flex items-center gap-3">
              <span className="scene-name">{team.name}</span>
              <Lane
                timeMs={ms}
                running={!cut}
                flatlined={cut && i === 0}
                size="sm"
                className="h-9 flex-1"
              />
              <span className="scene-mini tnum">{formatTime(ms)}</span>
            </div>
          );
        })}
      </div>
      <div className="scene-foot">
        <span className={`scene-verdict ${cut ? 'is-on' : ''}`}>
          {cut ? 'سكن نبضٌ واحد — فانتهت الجولة على الثلاث' : 'الجولة جارية'}
        </span>
      </div>
    </div>
  );
}

/** ٠٤ — النقاط على ما بقي من الوقت، والصفوف تعيد ترتيب نفسها */
const SORT_AT = 1000;
/* يُعرضن بترتيب القاعة، ثم ينتقلن إلى ترتيب النتيجة — والمتوقّف يذيَّل */
const RANKS = [
  { name: 'الأولى', pts: 120, to: 2 },
  { name: 'الرابعة', pts: 0, to: 3 },
  { name: 'الثانية', pts: 420, to: 0 },
  { name: 'الثالثة', pts: 260, to: 1 },
];

function SceneRank({ active }: { active: boolean }) {
  const t = useScene(active, 6800, 3000);
  const sorted = t > SORT_AT;

  return (
    <div className="scene">
      <div className="rank-box">
        {RANKS.map((team, i) => (
          <div
            key={team.name}
            className={`rank-row ${sorted && team.to === 0 ? 'is-top' : ''}`}
            style={{ transform: `translateY(calc(var(--row) * ${sorted ? team.to - i : 0}))` }}
          >
            <span className="rank-pos tnum">{sorted ? team.to + 1 : i + 1}</span>
            <span className="rank-name">{team.name}</span>
            <RollingNumber value={sorted ? team.pts : 0} className="rank-pts tnum" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════ القواعد الأربع ════════════ */

const RULES = [
  {
    n: '٠١',
    title: 'ثلاثون ثانية تعدّ',
    desc: 'لكل فريق مجراه الخاص، ونبضاته تقلّ أمام القاعة ثانية بثانية حتى يستقيم الخطّ.',
    Scene: SceneCount,
  },
  {
    n: '٠٢',
    title: 'الصواب يُطيل النبض',
    desc: 'أصبتَ فخمس ثوانٍ تُضاف فوراً، أخطأتَ فثلاث تُقتطع بلا رحمة. الإجابة وقتٌ لا نقطة.',
    Scene: SceneSwing,
  },
  {
    n: '٠٣',
    title: 'أول من يبلغ الصفر',
    desc: 'يستقيم خطّه، وتنتهي الجولة على الجميع في اللحظة نفسها — لا على صاحبه وحده.',
    Scene: SceneCut,
  },
  {
    n: '٠٤',
    title: 'من طال نبضه تصدّر',
    desc: 'النقاط تُوزَّع على ما بقي من الوقت، والمتوقّف يخرج صفر اليدين.',
    Scene: SceneRank,
  },
] as const;

function Rule({ rule, flip }: { rule: (typeof RULES)[number]; flip: boolean }) {
  const [ref, inView] = useInView<HTMLElement>();
  const { Scene } = rule;

  return (
    <section ref={ref} className="rule">
      <Reveal className={`rule-art ${flip ? 'lg:order-2' : ''}`}>
        <Scene active={inView} />
      </Reveal>
      <Reveal delay={120} className="rule-say">
        <span className="rule-n tnum">{rule.n}</span>
        <h3 className="rule-title">{rule.title}</h3>
        <p className="rule-desc">{rule.desc}</p>
      </Reveal>
    </section>
  );
}

/* ════════════ الصفحة ════════════ */

const ROLES = [
  {
    to: '/display',
    Icon: ScreenIcon,
    title: 'شاشة العرض',
    desc: 'على البروجكتر — القاعة تتابع النبضات وهي تخفت',
  },
  {
    to: '/admin',
    Icon: SlidersIcon,
    title: 'لوحة المنظّم',
    desc: 'أنشئ الغرفة، أطلق الجولات، وتحكّم في المصير',
  },
];

export default function Home() {
  useTheme('dark');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [going, setGoing] = useState(false);

  const ready = code.length >= 4;

  /*
   * الدخول: الستارة تنزل ثم ننتقل.
   *
   * ونزولها ٦٢٠ مللي، فننتقل بعدها بقليل: لو سبقناها لانكشف ما تحتها
   * قبل أن تسترّه، ولو تأخّرنا لوقف اللاعب أمام ستارةٍ ساكنة.
   */
  function enter() {
    if (!ready || going) return;
    tap();
    setGoing(true);
    window.setTimeout(() => navigate(`/play?code=${code}`), 640);
  }

  return (
    <div className="flex min-h-full flex-col px-5 sm:px-10">
      <Boot />

      <header className="flex h-20 shrink-0 items-center justify-between border-b border-line">
        <Wordmark className="text-2xl" />
        <a href="#rules" className="tap rounded-chip px-4 py-2 text-sm font-bold text-muted">
          كيف تُلعب؟
        </a>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1">
        {/* ══ البطل: الاسم يقطع مخطّطاً يجري، وتحته بابُ الدخول ══ */}
        <section className="hero">
          <div className="lane lane-bare relative flex h-40 items-center justify-center sm:h-52">
            <span
              className="lane-run lane-drift opacity-90"
              style={
                {
                  '--state': 'var(--color-signal)',
                  '--tile': '300px',
                  '--amp': '120px',
                  '--drift': '3.6s',
                } as CSSProperties
              }
            />
            <Wordmark className="word-beat relative z-10 text-7xl sm:text-8xl" />
          </div>

          <h1 className="hero-line">ثلاثون ثانية… والنبض بين يديك</h1>

          <form
            className="gate"
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

          <p className="gate-note">
            الرمز عند منظّم الجلسة، أو امسح الرمز المعروض على الشاشة الكبيرة.
          </p>

          <a href="#rules" className="hero-cue" aria-label="كيف تُلعب">
            <span className="hero-cue-rail" aria-hidden="true">
              <span className="hero-cue-dot" />
            </span>
            كيف تُلعب
          </a>
        </section>

        {/* ══ القواعد الأربع — كلٌّ منها تعمل أمامك ══ */}
        <div id="rules" className="scroll-mt-24 border-t border-line">
          {RULES.map((rule, i) => (
            <Rule key={rule.n} rule={rule} flip={i % 2 === 1} />
          ))}
        </div>

        {/* ══ المكان: اللاعب أوّلاً، وما سواه لمن معه شاشة ══ */}
        <section className="py-14">
          <Reveal>
            <Link to="/play" className="tap seat-main" onClick={tap}>
              <span className="seat-icon">
                <UsersIcon size={24} />
              </span>
              <span>
                <b className="block text-xl font-black">انضمّ كلاعب</b>
                <span className="mt-1 block text-sm leading-relaxed text-muted">
                  افتحها على جهازك، أدخل الرمز، واستعدّ للضغط
                </span>
              </span>
            </Link>
          </Reveal>

          <Reveal delay={100}>
            <p className="seat-aside">تنظّم الجلسة؟ هاتان الشاشتان مكانهما اللابتوب والبروجكتر.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROLES.map(({ to, Icon, title, desc }) => (
                <Link key={to} to={to} className="tap seat-side" onClick={tap}>
                  <span className="seat-side-icon">
                    <Icon size={20} />
                  </span>
                  <span>
                    <b className="block font-black">{title}</b>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted">{desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="flex h-14 shrink-0 items-center justify-between border-t border-line">
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
