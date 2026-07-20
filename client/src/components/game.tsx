import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ReviewItem, RoomResult, Standing } from '../lib/types';
import { barPercent, dangerLevel, formatTime, levelColor } from './ui';
import { BoomIcon, CheckIcon, CloseIcon, HistoryIcon, TrophyIcon } from './icons';

/**
 * شريط الوقت المشترك بين لوحة المسؤول وشاشة العرض:
 * ممتلئ عند 30 ثانية فأكثر، أخضر ثم أصفر عند الربع ثم أحمر.
 */
export function TimeBar({
  timeMs,
  exploded,
  size = 'md',
}: {
  timeMs: number;
  exploded?: boolean;
  size?: 'md' | 'lg';
}) {
  const color = exploded ? '#e52e25' : levelColor[dangerLevel(timeMs)];
  const width = exploded ? 100 : barPercent(timeMs);
  const label = exploded ? 'انفجرت' : `${formatTime(timeMs)} ث`;
  const box = size === 'lg' ? 'h-14 text-2xl' : 'h-10 text-lg';

  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-[#f2efe9] ${box}`}>
      {/* النص على الخلفية الفاتحة — أزرق */}
      <span className="absolute right-4 top-1/2 -translate-y-1/2 font-black tabular-nums text-[#103f91]">
        {label}
      </span>

      {/* الجزء الممتلئ ونسخة بيضاء من النص مقصوصة عليه تماماً */}
      <div
        className="fuse-bar absolute inset-y-0 right-0 overflow-hidden rounded-full"
        style={{ width: `${width}%`, backgroundColor: color }}
      >
        <span className="absolute right-4 top-1/2 -translate-y-1/2 whitespace-nowrap font-black tabular-nums text-white">
          {label}
        </span>
      </div>
    </div>
  );
}

/** تدرّجات الخيارات الأربعة — مأخوذة من ألوان الشعار، ثابتة بحسب الموقع */
export const OPTION_GRADIENTS = [
  'linear-gradient(135deg, #1a5fc4 0%, #103f91 100%)',
  'linear-gradient(135deg, #3fc9e6 0%, #0e92af 100%)',
  'linear-gradient(135deg, #ffb703 0%, #e68500 100%)',
  'linear-gradient(135deg, #f4564d 0%, #c2231b 100%)',
] as const;

export const optionGradient = (i: number) => OPTION_GRADIENTS[i % OPTION_GRADIENTS.length];

/** شاشة الاستعداد: 3 · 2 · 1 قبل انطلاق العدادات */
export function Countdown({ ms }: { ms: number }) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/95">
      <p className="text-2xl font-bold text-[#6b6b6b]">استعدوا…</p>
      <div key={seconds} className="boom mt-4 text-[9rem] font-black leading-none text-[#ff9f1c]">
        {seconds}
      </div>
      <p className="mt-4 text-lg font-bold text-[#9a968f]">الجولة على وشك أن تبدأ</p>
    </div>
  );
}

/** نافذة عامة بسيطة */
export function Modal({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="drop-in flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8e4dd] px-5 py-4">
          <h2 className="flex items-center gap-2 text-xl font-black">
            {icon}
            {title}
          </h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg border border-[#e8e4dd] text-[#6b6b6b] transition hover:bg-[#faf9f6] active:scale-90"
            title="إغلاق"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * سجل الجولات: كل جولة ونقاط كل مجموعة.
 * أخضر باهت لصاحب أعلى وقت، أحمر باهت للمجموعة التي انفجرت.
 */
export function RoundHistory({
  history,
  teamId,
}: {
  history: RoomResult[];
  /** عند تمريره تُعرض نتائج هذه المجموعة فقط — سجل المجموعة مقابل سجل المسؤول */
  teamId?: string;
}) {
  if (history.length === 0) {
    return <p className="py-10 text-center text-[#9a968f]">لم تُلعب أي جولة بعد</p>;
  }

  const rounds = teamId
    ? history
        .map((round) => ({ ...round, awards: round.awards.filter((a) => a.teamId === teamId) }))
        .filter((round) => round.awards.length > 0)
    : history;

  if (rounds.length === 0) {
    return <p className="py-10 text-center text-[#9a968f]">لم تشاركوا في أي جولة بعد</p>;
  }

  const totals = new Map<string, { name: string; points: number }>();
  for (const round of rounds) {
    for (const award of round.awards) {
      const entry = totals.get(award.teamId) ?? { name: award.name, points: 0 };
      entry.points += award.points;
      totals.set(award.teamId, entry);
    }
  }
  const ranking = [...totals.values()].sort((a, b) => b.points - a.points);

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="mb-2 font-black text-[#103f91]">
          {teamId ? 'مجموع نقاطكم' : 'المجموع الكلي'}
        </h3>
        <div className="grid gap-1.5">
          {ranking.map((team, i) => (
            <div
              key={team.name}
              className="flex items-center justify-between rounded-xl bg-[#faf9f6] px-4 py-2.5"
            >
              <span className="flex items-center gap-2.5 font-bold">
                {!teamId && (
                  <span className="flex size-6 items-center justify-center rounded-full bg-[#e8e4dd] text-xs font-black text-[#6b6b6b]">
                    {i + 1}
                  </span>
                )}
                {team.name}
              </span>
              <span className="font-black text-[#ff9f1c]">{team.points} نقطة</span>
            </div>
          ))}
        </div>
      </div>

      {[...rounds].reverse().map((round) => (
        <div key={round.round}>
          <h3 className="mb-2 font-black text-[#103f91]">الجولة {round.round}</h3>
          <div className="grid gap-1.5">
            {round.awards.map((award) => (
              <div
                key={award.teamId}
                className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
                  award.exploded
                    ? 'border-[#f7d3d0] bg-[#fdf2f1]'
                    : award.top
                      ? 'border-[#c7e9cf] bg-[#f1faf3]'
                      : 'border-[#e8e4dd] bg-white'
                }`}
              >
                <span className="font-bold">{award.name}</span>
                <span className="text-sm text-[#6b6b6b]">
                  {award.exploded ? 'انفجرت' : `${formatTime(award.timeMs)} ث`}
                </span>
                <span className="font-black text-[#ff9f1c]">+{award.points}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function HistoryModal({
  history,
  teamId,
  onClose,
}: {
  history: RoomResult[];
  teamId?: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={teamId ? 'سجل مجموعتكم' : 'سجل الجولات'}
      icon={<HistoryIcon size={20} className="text-[#103f91]" />}
      onClose={onClose}
    >
      <RoundHistory history={history} teamId={teamId} />
    </Modal>
  );
}

/** رقم يتدحرج نحو قيمته الجديدة بدل أن يقفز */
export function RollingNumber({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    const diff = value - origin;
    if (diff === 0) return;

    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 650);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + diff * eased));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <span className={className}>{shown}</span>;
}

/** قصاصات التتويج — مولّدة مرة واحدة بألوان الشعار */
export function Confetti({ count = 70 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 2.2,
        duration: 2.6 + Math.random() * 2,
        color: ['#ff9f1c', '#103f91', '#12b3d5', '#e52e25', '#22a45d', '#ffb703'][i % 6],
        skew: Math.random() * 40 - 20,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `skewY(${p.skew}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * المدرّج: الثاني ثم الأول ثم الثالث، الأعمدة تنمو من الأسفل
 * والأسماء تظهر بعدها، وباقي المجموعات في قائمة تحته.
 */
export function Podium({ standings }: { standings: Standing[] }) {
  const top = standings.slice(0, 3);
  const rest = standings.slice(3);
  // ترتيب العرض: الفضة يميناً، الذهب وسطاً، البرونز يساراً
  const order = [top[1], top[0], top[2]].filter(Boolean);

  const style = (rank: number) =>
    ({
      1: { height: 'h-44', bg: 'from-[#ffb703] to-[#ff9f1c]', label: 'الأول' },
      2: { height: 'h-32', bg: 'from-[#5b87d0] to-[#103f91]', label: 'الثاني' },
      3: { height: 'h-24', bg: 'from-[#3fc9e6] to-[#12b3d5]', label: 'الثالث' },
    })[rank]!;

  return (
    <div className="grid gap-6">
      <Confetti />
      <div className="zoom-in text-center" style={{ animationDelay: '0.05s' }}>
        <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-[#fff6e8] text-[#ff9f1c]">
          <TrophyIcon size={36} />
        </span>
        <h2 className="mt-3 text-4xl font-black text-[#103f91]">الأوائل</h2>
      </div>

      <div className="flex items-end justify-center gap-3 sm:gap-5">
        {order.map((team, i) => {
          const s = style(team.rank);
          return (
            <div key={team.teamId} className="flex w-24 flex-col items-center sm:w-36">
              <div
                className="pop-in mb-2 text-center"
                style={{ animationDelay: `${0.7 + i * 0.18}s` }}
              >
                <div className="text-lg font-black leading-tight sm:text-xl">{team.name}</div>
                <div className="text-sm font-bold text-[#ff9f1c]">{team.score} نقطة</div>
              </div>
              <div
                className={`rise flex w-full ${s.height} flex-col items-center justify-start rounded-t-2xl bg-gradient-to-b ${s.bg} pt-3 text-white shadow-lg`}
                style={{ animationDelay: `${0.15 + i * 0.18}s` }}
              >
                <span className="text-3xl font-black sm:text-4xl">{team.rank}</span>
                <span className="text-xs font-bold text-white/80">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {rest.length > 0 && (
        <div className="fade-up grid gap-1.5" style={{ animationDelay: '1.3s' }}>
          {rest.map((team) => (
            <div
              key={team.teamId}
              className="flex items-center justify-between rounded-xl border border-[#e8e4dd] bg-white px-4 py-2.5"
            >
              <span className="flex items-center gap-3 font-bold">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#f2efe9] text-sm font-black text-[#6b6b6b]">
                  {team.rank}
                </span>
                {team.name}
              </span>
              <span className="font-black text-[#ff9f1c]">{team.score} نقطة</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * مراجعة أسئلة الجولة بترتيب ظهورها —
 * الإجابة الصحيحة بالأخضر واختيار الفريق الخاطئ بالأحمر.
 */
export function ReviewList({ review }: { review: ReviewItem[] }) {
  if (review.length === 0) {
    return <p className="py-6 text-center text-[#9a968f]">لم تجيبوا على أي سؤال في هذه الجولة</p>;
  }

  return (
    <div className="grid gap-3">
      {review.map((item, index) => (
        <div
          key={`${item.id}-${index}`}
          // تظهر البطاقات تباعاً بدل أن تقفز كلها دفعة واحدة
          className={`fade-up rounded-2xl border p-5 ${
            item.isCorrect ? 'border-[#c7e9cf] bg-[#f1faf3]' : 'border-[#f7d3d0] bg-[#fdf2f1]'
          }`}
          style={{ animationDelay: `${Math.min(index * 0.07, 0.7)}s` }}
        >
          <div className="mb-3 flex items-start gap-3">
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-white ${
                item.isCorrect ? 'bg-[#2e9e51]' : 'bg-[#e52e25]'
              }`}
            >
              {item.isCorrect ? <CheckIcon size={15} strokeWidth={3} /> : <CloseIcon size={15} strokeWidth={3} />}
            </span>
            <p className="flex-1 text-lg font-bold leading-relaxed">
              <span className="text-[#9a968f]">{index + 1}. </span>
              {item.q}
            </p>
          </div>

          <div className="grid gap-1.5 pr-10">
            {item.options.map((option, i) => {
              const isAnswer = i === item.answer;
              const isChoice = i === item.choice;
              if (!isAnswer && !isChoice) {
                return (
                  <div key={i} className="rounded-lg px-3 py-2 text-[#9a968f]">
                    {option}
                  </div>
                );
              }
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 font-bold ${
                    isAnswer ? 'bg-[#2e9e51] text-white' : 'bg-[#e52e25] text-white'
                  }`}
                >
                  <span>{option}</span>
                  <span className="text-sm opacity-90">
                    {isAnswer && isChoice
                      ? 'إجابتكم — صحيحة'
                      : isAnswer
                        ? 'الإجابة الصحيحة'
                        : 'إجابتكم'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export { BoomIcon };
