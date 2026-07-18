import { Link } from 'react-router-dom';
import { Button, Footer, NavBar } from '../components/ui';
import {
  BombIcon,
  BoomIcon,
  ClockIcon,
  PlayIcon,
  PlusIcon,
  ScreenIcon,
  SlidersIcon,
  TrophyIcon,
  UsersIcon,
} from '../components/icons';

const steps = [
  {
    Icon: ClockIcon,
    color: '#103f91',
    title: 'ثلاثون ثانية… وتبدأ التكتكة',
    desc: 'كل مجموعة تحمل قنبلتها، وعدّادها ينزل ثانية بثانية. لا أحد ينتظر أحداً.',
  },
  {
    Icon: PlusIcon,
    color: '#22a45d',
    title: 'كل إجابة صحيحة تشتري لك عمراً',
    desc: 'أصبتم؟ خمس ثوانٍ تُضاف فوراً. أخطأتم؟ ثلاث تُقتطع بلا رحمة.',
  },
  {
    Icon: BoomIcon,
    color: '#e52e25',
    title: 'أول من يصل الصفر… ينفجر',
    desc: 'لحظة الانفجار تتجمد اللعبة على الجميع، ويظهر من صمد ومن سقط.',
  },
  {
    Icon: TrophyIcon,
    color: '#ff9f1c',
    title: 'من بقي له وقت أكثر… تصدّر',
    desc: 'النقاط تُوزَّع حسب الوقت المتبقي، والمنفجرة تخرج صفر اليدين.',
  },
];

const roles = [
  {
    to: '/play',
    Icon: UsersIcon,
    title: 'انضم كفريق',
    desc: 'اجمع مجموعتك حول جهاز واحد، أدخل رمز الغرفة، واستعد للضغط',
    color: '#12b3d5',
  },
  {
    to: '/display',
    Icon: ScreenIcon,
    title: 'شاشة العرض',
    desc: 'اعرضها على البروجكتر ليتابع الجميع العدادات وهي تنهار',
    color: '#103f91',
  },
  {
    to: '/admin',
    Icon: SlidersIcon,
    title: 'لوحة المسؤول',
    desc: 'أنشئ الغرفة، أطلق الجولات، وتحكّم في مصير المجموعات',
    color: '#ff9f1c',
  },
];

export default function Home() {
  const scrollToRoles = () =>
    document.getElementById('roles')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="flex min-h-full flex-col">
      <NavBar
        cta={
          <Button onClick={scrollToRoles} className="px-5">
            <PlayIcon size={16} />
            ابدأ اللعب
          </Button>
        }
      />

      {/* البطل */}
      <section className="relative overflow-hidden bg-gradient-to-bl from-[#0a2a63] via-[#103f91] to-[#1a5fc4] text-white">
        <div className="drift pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-[#12b3d5]/25 blur-3xl" />
        <div className="drift pointer-events-none absolute -bottom-32 -right-16 size-96 rounded-full bg-[#ff9f1c]/25 blur-3xl" />

        <div className="relative mx-auto max-w-5xl px-5 py-20 text-center sm:py-28">
          <span
            className="fade-up halo inline-flex size-20 items-center justify-center rounded-3xl bg-white/10 backdrop-blur"
            style={{ animationDelay: '0.05s, 1.6s' }}
          >
            <BombIcon size={44} className="text-[#ff9f1c]" />
          </span>

          {/* الفتيل يحترق نحو المركز، ثم ينفجر الاسم */}
          <div className="relative mx-auto mt-8 h-2 w-full max-w-md">
            <div
              className="fuse-burn absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-[#ff9f1c] to-[#e52e25]"
              style={{ animationDelay: '0.25s' }}
            />
            <span
              className="spark-travel absolute top-1/2 size-4 -translate-y-1/2 rounded-full bg-[#ffd88a]"
              style={{ animationDelay: '0.25s', boxShadow: '0 0 18px 7px rgba(255,159,28,0.85)' }}
            />
          </div>

          <div className="blast-shake relative" style={{ animationDelay: '1.35s' }}>
            {/* موجة الضوء لحظة الانفجار */}
            <span
              className="shock-wave pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-[#ff9f1c]"
              style={{ animationDelay: '1.35s' }}
            />
            <h1
              className="title-blast relative mt-6 text-7xl font-black sm:text-9xl"
              style={{ animationDelay: '1.35s' }}
            >
              <span className="sheen">القنبلة</span>
            </h1>
          </div>

          <p
            className="fade-up mx-auto mt-6 max-w-2xl text-2xl font-black leading-relaxed sm:text-3xl"
            style={{ animationDelay: '2.25s' }}
          >
            ثلاثون ثانية تفصلكم عن الانفجار
          </p>

          <p
            className="fade-up mx-auto mt-4 max-w-xl text-lg text-white/70"
            style={{ animationDelay: '2.5s' }}
          >
            أجيبوا بسرعة… كل سؤال صحيح يطيل عمر قنبلتكم، وكل خطأ يقرّبها من الصفر.
            أول قنبلة تنفجر تُخرج أصحابها من السباق.
          </p>

          <p className="fade-up mt-8 text-sm text-white/50" style={{ animationDelay: '2.75s' }}>
            مسابقة جماعية من تنظيم نادي نبراس
          </p>
        </div>
      </section>

      <main className="flex-1">
        {/* فكرة المسابقة */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="fade-up text-center">
            <h2 className="text-4xl font-black text-[#103f91]">كيف تُلعب؟</h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-[#6b6b6b]">
              مجموعات تتسابق في اللحظة نفسها، وكل واحدة تصارع عدّادها وحدها.
              الأسئلة لا تنتهي، والوقت لا يرحم — فمن يجيب أسرع وأدقّ، يعيش أطول.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {steps.map(({ Icon, color, title, desc }, i) => (
              <div
                key={title}
                className="slide-in-right flex gap-5 rounded-2xl border border-[#e8e4dd] bg-white p-6 shadow-[0_1px_3px_rgba(26,26,26,0.04)] transition hover:-translate-y-1 hover:shadow-lg"
                style={{ animationDelay: `${0.1 + i * 0.13}s` }}
              >
                <span
                  className="flex size-14 shrink-0 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: `${color}18`, color }}
                >
                  <Icon size={28} />
                </span>
                <div>
                  <h3 className="text-xl font-black">{title}</h3>
                  <p className="mt-2 leading-relaxed text-[#6b6b6b]">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* خيارات الدخول — ثلاثة بجانب بعض على اللابتوب، فوق بعض على الجوال */}
        <section id="roles" className="scroll-mt-16 border-t border-[#e8e4dd] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <h2 className="fade-up text-center text-4xl font-black text-[#103f91]">
              جاهز؟ اختر مكانك
            </h2>
            <p className="fade-up mt-4 text-center text-lg text-[#6b6b6b]" style={{ animationDelay: '0.1s' }}>
              ثلاثة أدوار… ودور واحد لك
            </p>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {roles.map(({ to, Icon, title, desc, color }, i) => (
                <Link
                  key={to}
                  to={to}
                  className="fade-up group flex flex-col items-center rounded-2xl border-2 border-[#e8e4dd] bg-[#faf9f6] p-8 text-center transition hover:-translate-y-2 hover:shadow-xl active:scale-[0.99]"
                  style={{ animationDelay: `${0.2 + i * 0.14}s` }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = color)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
                >
                  <span
                    className="flex size-16 items-center justify-center rounded-2xl transition duration-300 group-hover:scale-110 group-hover:rotate-6"
                    style={{ backgroundColor: `${color}18`, color }}
                  >
                    <Icon size={30} />
                  </span>
                  <h3 className="mt-5 text-2xl font-black">{title}</h3>
                  <p className="mt-3 leading-relaxed text-[#6b6b6b]">{desc}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
