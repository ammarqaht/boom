import type { CSSProperties } from 'react';
import type { CardEvent } from '../lib/types';
import { countOf } from '../lib/arabic';
import { DuelIcon } from './icons';

/*
 * نبضةٌ واحدة تُرسم من الحافة إلى القلب: خطٌّ هادئ ثم قفزةُ نبضٍ ثم خطٌّ
 * إلى المركز. نصفان متناظران يلتقيان في الوسط فيكون الالتقاءُ هو الصدام.
 */
const HALF = 'M0 20 H34 L40 20 L45 6 L51 34 L56 20 H100';

/**
 * إعلانُ المبارزة: اسمان وبينهما صدام — ولا شيء غيرهما.
 *
 * يدخل الاسمان من الحافتين، ويجري من كلٍّ منهما خطُّ نبضٍ نحو الوسط، فإذا
 * التقيا ظهر السيفان. المتحدّي يميناً والمتحدّى يساراً، والاتجاهُ يكفي عن
 * أن يُكتب. والبطاقةُ بسطح اللعبة ولون المبارزة وحده، كبطاقات المتجر.
 *
 * size: hall لشاشة القاعة، وcompact لها حين تتعدّد المبارزات، وphone لجوّال
 * أحد الطرفين — وعليه «أنت» مكان اسمه.
 */
export function DuelFaceOff({
  event,
  size,
  me,
  delay = 0,
}: {
  event: CardEvent;
  size: 'hall' | 'compact' | 'phone';
  /** اسمُ صاحب الجوّال إن كان طرفاً */
  me?: string;
  delay?: number;
}) {
  const by = me === event.by ? 'أنت' : event.by;
  const on = me === event.on ? 'أنت' : event.on;
  return (
    <div
      className={`duel duel-${size}`}
      style={{ '--d': `${delay}s` } as CSSProperties}
      role="status"
      aria-label={`مبارزة: ${event.by} يتحدّى ${event.on}`}
    >
      <b className="duel-name duel-name-by">{by}</b>
      <div className="duel-core" aria-hidden="true">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="duel-wire">
          <path
            className="duel-beat duel-beat-by"
            d={HALF}
            transform="translate(200 0) scale(-1 1)"
            pathLength={1}
          />
          <path className="duel-beat duel-beat-on" d={HALF} pathLength={1} />
        </svg>
        <span className="duel-ring" />
        <span className="duel-clash">
          <DuelIcon />
        </span>
      </div>
      <b className="duel-name duel-name-on">{on}</b>
    </div>
  );
}

/** ستٌّ تُعرض، وما زاد عددٌ يُقال: الشاشةُ تُقرأ في ثلاث ثوانٍ */
const MAX_SHOWN = 6;

/**
 * مسرحُ المبارزات في شاشة القاعة: مبارزةٌ واحدة بطاقةٌ في الوسط، وأكثرُ
 * منها عمودان متساويان تدخل بطاقاتُهما تباعاً — يُقرأ كلُّ سطرٍ وحده.
 */
export function DuelStage({ duels }: { duels: CardEvent[] }) {
  if (duels.length === 0) return null;
  const single = duels.length === 1;
  const shown = duels.slice(0, MAX_SHOWN);
  const more = duels.length - shown.length;
  return (
    <div className={`duel-stage ${single ? '' : 'is-many'}`}>
      <div className="duel-grid">
        {shown.map((event, i) => (
          <DuelFaceOff
            key={`${event.by}-${event.on}`}
            event={event}
            size={single ? 'hall' : 'compact'}
            delay={i * 0.12}
          />
        ))}
      </div>
      {more > 0 && (
        <p className="duel-more">
          و
          {countOf(more, {
            one: 'مبارزةٌ أخرى',
            two: 'مبارزتان أخريان',
            few: 'مبارزات أخرى',
            many: 'مبارزةً أخرى',
          })}
        </p>
      )}
    </div>
  );
}
