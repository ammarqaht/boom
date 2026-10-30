import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';

export type TourStep = {
  /** قيمة data-tour على العنصر المشروح */
  target: string;
  title: string;
  body: string;
};

/*
 * كلُّ جولةٍ تعريفية تُرى مرّةً في الجهاز (جولةُ اللاعب وجولةُ المنظّم كلٌّ
 * باسمها): من رآها لا تُعاد عليه في الغرفة التالية. والتخزين قد يُرفض
 * (تصفّحٌ خاص) — فتُرى مرّةً في الجلسة على الأقل.
 */
export type TourName = 'between-rounds' | 'console';
const seenThisSession = new Set<TourName>();
const keyOf = (name: TourName) => `nabda:tour:${name}`;

export function tourSeen(name: TourName = 'between-rounds') {
  if (seenThisSession.has(name)) return true;
  try {
    return localStorage.getItem(keyOf(name)) === '1';
  } catch {
    return false;
  }
}

function markSeen(name: TourName) {
  seenThisSession.add(name);
  try {
    localStorage.setItem(keyOf(name), '1');
  } catch {
    /* التخزين مرفوض — تكفي ذاكرةُ الجلسة */
  }
}

/*
 * العنصرُ المشروح الظاهرُ لا أوّلُ ما يُوجد: لوحةُ المنظّم ترسم لوحةَ الجولة
 * مرّتين (للجوال وللحاسب) وتُخفي إحداهما — فيُختار ما له مكانٌ على الشاشة.
 */
function visible(target: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)].find(
    (el) => el.getClientRects().length > 0,
  );
}

type Box = { top: number; left: number; width: number; height: number };

const PAD = 8;

/**
 * جولةٌ تعريفية فوق الواجهة نفسها: تُطفأ الشاشة إلا العنصرَ المشروح، فيُضاء
 * بإطارٍ نابض، وفوقه أو تحته فقاعةٌ قصيرة بسهمٍ يشير إليه — عنوانٌ وسطر،
 * ونقاطُ الخطوات، وزرّا «تخطّ» و«التالي».
 *
 * لا تُغلق بلمس الخلفية: لمسةٌ عابرة كانت ستُضيعها على من لم يقرأ. والتخطّي
 * زرٌّ ظاهرٌ لمن لا يريدها.
 */
export function Tour({
  steps: all,
  onDone,
  name = 'between-rounds',
}: {
  steps: TourStep[];
  onDone: () => void;
  name?: TourName;
}) {
  /*
   * خطوةٌ عنصرُها غير موجود (لوحةٌ لا تُرسم بعد) تُطوى — لا فقاعةَ تشير إلى
   * فراغ. ويُفرز بعد أن تُرسم الصفحة: الجولةُ تُركَّب مع الواجهة في الدفعة
   * نفسها، فلو فُرزت قبلها لما وُجد شيء.
   */
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    setSteps(all.filter((s) => visible(s.target)));
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = steps[index];
  /* لا شيء يُشرح: تُطوى الجولة */
  useEffect(() => {
    if (ready && steps.length === 0) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /*
   * العنصر يُمرَّر إلى الشاشة ثم يُتبَع إطاراً بإطار: التمريرُ الناعم يتحرّك
   * بعد القياس الأول، فلو قيس مرّةً لبقي الإطارُ حيث كان العنصر. والطويلُ
   * (شبكة البطاقات) يُمرَّر إلى أعلى الشاشة لتجد الفقاعةُ مكاناً تحته.
   */
  useLayoutEffect(() => {
    if (!step) return;
    const el = visible(step.target);
    if (!el) return;
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.4;
    el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' });
    let frame = 0;
    let last = '';
    const follow = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
      if (key !== last) {
        last = key;
        setBox({
          top: r.top - PAD,
          left: r.left - PAD,
          width: r.width + PAD * 2,
          height: r.height + PAD * 2,
        });
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step?.target]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      if (e.key === 'Enter') next();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const finish = () => {
    markSeen(name);
    onDone();
  };
  const next = () => (index + 1 < steps.length ? setIndex(index + 1) : finish());
  const last = index + 1 === steps.length;

  if (!step || !box) return null;

  /* الفقاعة في الجهة الأوسع: تحت العنصر أو فوقه — فلا تغطّي ما تشرحه */
  const below = window.innerHeight - (box.top + box.height) >= box.top;
  const bubbleW = Math.min(340, window.innerWidth - 32);
  const centre = box.left + box.width / 2;
  const left = Math.max(16, Math.min(window.innerWidth - bubbleW - 16, centre - bubbleW / 2));
  const arrow = Math.max(22, Math.min(bubbleW - 22, centre - left));
  const bubble: CSSProperties = below
    ? { top: box.top + box.height + 14, left, width: bubbleW }
    : { bottom: window.innerHeight - box.top + 14, left, width: bubbleW };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* الإطفاءُ ظلٌّ لا نهائي حول الإطار — فيبقى العنصر مضاءً بلا قصّ */}
      <span
        className="tour-spot pointer-events-none fixed rounded-[22px]"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        aria-hidden="true"
      />
      {/* حاجزُ اللمس: لا يُضغط ما تحت الجولة وهي قائمة */}
      <span className="absolute inset-0" aria-hidden="true" />

      <div key={index} className="tour-bubble fixed rounded-[20px] bg-surface p-4" style={bubble}>
        <span
          className={`absolute size-3.5 rotate-45 bg-surface ${below ? '-top-[7px]' : '-bottom-[7px]'}`}
          style={{ left: arrow - 7 }}
          aria-hidden="true"
        />
        <b className="relative block text-[17px] font-black">{step.title}</b>
        <p className="relative mt-1 text-[14px] leading-relaxed text-ink-2">{step.body}</p>

        <div className="relative mt-3.5 flex items-center gap-3">
          <span
            className="flex flex-1 items-center gap-1.5"
            aria-label={`الخطوة ${index + 1} من ${steps.length}`}
          >
            {steps.map((_, i) => (
              <i
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-signal' : 'w-1.5 bg-line-2'}`}
              />
            ))}
          </span>
          {!last && (
            <button
              type="button"
              onClick={finish}
              className="px-2 py-2 text-[14px] font-bold text-muted"
            >
              تخطّ
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="rounded-[12px] bg-signal px-4 py-2 text-[14px] font-black text-on-signal active:scale-95"
          >
            {last ? 'فهمت' : 'التالي'}
          </button>
        </div>
      </div>
    </div>
  );
}
