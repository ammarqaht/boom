import { Link } from 'react-router-dom';
import { Credit, Wordmark, useTheme } from '../components/ui';
import { ScreenIcon, SlidersIcon, UsersIcon } from '../components/icons';

/*
 * صفحة التعريف — مرحلة أولى.
 * أُعيد بناؤها لاحقاً بمعالجة مختلفة؛ ما يهمّ الآن أن تحمل الهوية الجديدة
 * وألّا يبقى فيها أثر لهوية قديمة.
 */

const steps = [
  {
    n: '٠١',
    title: 'ثلاثون ثانية تعدّ',
    desc: 'لكل لاعب مجراه الخاص، ونبضاته تقلّ أمام القاعة ثانية بثانية.',
  },
  {
    n: '٠٢',
    title: 'الصواب يُطيل النبض',
    desc: 'أصبتَ فخمس ثوانٍ تُضاف فوراً، أخطأتَ فثلاث تُقتطع بلا رحمة.',
  },
  {
    n: '٠٣',
    title: 'أول من يبلغ الصفر',
    desc: 'يستقيم خطّه، وتنتهي الجولة على الجميع في اللحظة نفسها.',
  },
  {
    n: '٠٤',
    title: 'من طال نبضه تصدّر',
    desc: 'النقاط تُوزَّع على ما بقي من الوقت، والمتوقّف يخرج صفر اليدين.',
  },
];

const roles = [
  {
    to: '/play',
    Icon: UsersIcon,
    title: 'انضمّ كلاعب',
    desc: 'افتحها على جهازك، أدخل الرمز، واستعدّ للضغط',
  },
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

  return (
    <div className="flex min-h-full flex-col px-5 sm:px-10">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-line">
        <Wordmark className="text-2xl" />
        <Link
          to="/play"
          className="rounded-chip bg-signal px-5 py-2.5 font-black text-on-signal transition hover:brightness-110 active:scale-[0.97]"
        >
          ابدأ اللعب
        </Link>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1">
        {/* البطل: الاسم يقطع مخطّطاً يجري بعرض الشاشة */}
        <section className="border-b border-line py-12 sm:py-16">
          <div className="lane lane-bare relative mb-10 flex h-40 items-center justify-center sm:h-52">
            <span
              className="lane-run lane-drift opacity-90"
              style={
                {
                  '--state': 'var(--color-signal)',
                  '--tile': '300px',
                  '--amp': '120px',
                  '--drift': '3.6s',
                } as React.CSSProperties
              }
            />
            <Wordmark className="word-beat relative z-10 text-6xl sm:text-8xl" />
          </div>

          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="max-w-[19ch] text-3xl leading-snug font-black sm:text-4xl">
              ثلاثون ثانية… والنبض بين يديك
            </h1>
            <p className="max-w-[44ch] leading-relaxed text-muted">
              كل لاعب يصارع نبضه وحده: الإجابة الصحيحة تعيد إليه ثوانيه، والخطأ يقرّبه من السكون.
              وأول نبض يسكن يُنهي الجولة على الجميع — لا على صاحبه وحده.
            </p>
          </div>
        </section>

        <section className="grid border-b border-line sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <div
              key={step.n}
              className={`py-6 sm:px-6 ${i === 0 ? 'sm:pr-0' : 'sm:border-r sm:border-line'}`}
            >
              <div className="tnum text-xs font-black tracking-[0.14em] text-signal">{step.n}</div>
              <b className="mt-2 block text-lg font-black">{step.title}</b>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.desc}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-3 py-8 lg:grid-cols-3">
          {roles.map(({ to, Icon, title, desc }) => (
            <Link
              key={to}
              to={to}
              className="tile group relative flex items-center gap-4 overflow-hidden p-5 transition hover:shadow-[inset_0_0_0_1px_var(--color-line-2)]"
            >
              <span
                className="absolute inset-y-0 start-0 w-1 bg-signal opacity-60 transition group-hover:opacity-100"
                aria-hidden="true"
              />
              <span className="flex size-11 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-signal">
                <Icon size={22} />
              </span>
              <span>
                <b className="block text-lg font-black">{title}</b>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">{desc}</span>
              </span>
            </Link>
          ))}
        </section>
      </main>

      <footer className="flex h-14 shrink-0 items-center justify-between border-t border-line">
        <Credit />
        <span className="tnum text-xs font-medium text-faint">
          نبضة · {new Date().getFullYear()}
        </span>
      </footer>
    </div>
  );
}
