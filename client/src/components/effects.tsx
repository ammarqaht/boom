import type { Effect } from '../lib/types';
import { CARD_LOOK, effectText } from '../lib/cards';

/**
 * شاراتُ البطاقات الفاعلة على صفّ لاعب — في شاشة العرض ولوحة المنظّم
 * وقائمة النبض عند اللاعب، بالشكل نفسه في الثلاث: أيقونةُ البطاقة بلونها
 * وبجانبها ما يلزم من رقم. فالقاعة تعرف لماذا قفز عدّادٌ أو لم ينزل.
 *
 * المبارزةُ شارتُها حمراء ونتيجتُها حيّة، وهي أعلى ما يُقرأ منها: سباقٌ
 * داخل السباق.
 */
export function EffectBadges({
  effects,
  size = 'sm',
  className = '',
}: {
  effects?: Effect[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  if (!effects?.length) return null;
  const box =
    size === 'lg'
      ? 'gap-2 px-3 py-1 text-[22px]'
      : size === 'md'
        ? 'gap-1.5 px-2.5 py-1 text-[13px]'
        : 'gap-1 px-1.5 py-0.5 text-[11px]';
  const icon = size === 'lg' ? 20 : size === 'md' ? 14 : 12;

  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {effects.map((fx, i) => {
        const look = CARD_LOOK[fx.card];
        if (!look) return null;
        const { short, long } = effectText(fx);
        const lead = fx.card === 'duel' && (fx.mine ?? 0) > (fx.theirs ?? 0);
        return (
          <span
            key={`${fx.card}${i}`}
            title={long}
            aria-label={long}
            className={`tnum flex max-w-full shrink-0 items-center rounded-chip font-black whitespace-nowrap ${box} ${look.ink} ${
              fx.card === 'duel'
                ? `bg-danger-2 ${lead ? 'shadow-[inset_0_0_0_1.5px_var(--color-danger)]' : ''}`
                : 'bg-surface-2'
            }`}
          >
            <look.Icon size={icon} className="shrink-0" />
            {short && <span className="truncate">{short}</span>}
          </span>
        );
      })}
    </span>
  );
}
