import { useState } from 'react';
import type { CardId, Shop as ShopData } from '../lib/types';
import { ask } from '../lib/socket';
import { Button } from './ui';
import { CheckIcon, HourglassIcon, MultiplyIcon, SnowflakeIcon } from './icons';

const CARD_META: Record<CardId, { Icon: typeof HourglassIcon; effect: string }> = {
  time: { Icon: HourglassIcon, effect: 'تبدأ الجولة القادمة بخمس ثوانٍ زيادة' },
  freeze: {
    Icon: SnowflakeIcon,
    effect: 'تقفل لاعباً عن الإجابة خمس ثوانٍ في بداية الجولة',
  },
  double: { Icon: MultiplyIcon, effect: 'نقاط جولتك القادمة ×٢ — تسقط إن توقف نبضك' },
};

/**
 * متجر البطاقات — صفوف لا صناديق، ويظهر بين الجولات فقط.
 * كل بطاقة مرة واحدة لكل لاعب، وتُطبّق في الجولة التالية.
 */
export function Shop({ shop, score }: { shop: ShopData; score: number }) {
  const [busy, setBusy] = useState<CardId | null>(null);
  const [note, setNote] = useState('');
  const [pickTarget, setPickTarget] = useState(false);
  // التجميد يقع على لاعبٍ بعينه ولا رجعة فيه، فالاختيار خطوة والتأكيد أخرى
  const [target, setTarget] = useState<string | null>(null);

  if (!shop.open) {
    return <p className="py-10 text-center text-muted">البطاقات تُفتح بين الجولات</p>;
  }

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 2500);
  };

  const buy = async (card: CardId, targetId?: string) => {
    setBusy(card);
    const res = await ask('team:buyCard', { card, targetId });
    setBusy(null);
    setPickTarget(false);
    setTarget(null);
    if (!res.ok) flash(res.error);
  };

  return (
    <div className="grid gap-2">
      {note && (
        <p className="rounded-chip bg-danger-2 px-4 py-2 text-center text-sm font-bold text-danger">
          {note}
        </p>
      )}

      {shop.cards.map((card) => {
        const meta = CARD_META[card.id];
        const picking = card.id === 'freeze' && pickTarget;
        const disabled = card.used || !card.affordable || busy !== null;

        return (
          <div key={card.id} className={`tile p-3 ${card.used ? 'opacity-50' : ''}`}>
            <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-chip bg-surface-2 text-signal">
                <meta.Icon size={22} />
              </span>

              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-black">{card.name}</span>
                  {!card.used && (
                    <span className="shrink-0 text-[11px] font-bold text-muted">
                      {/* العربية تعدّ الاثنين بصيغتهما لا برقمٍ وجمع */}
                      {card.left === 1
                        ? 'مرّة واحدة متبقية'
                        : card.left === 2
                          ? 'مرّتان متبقيتان'
                          : `${card.left} مرّات متبقية`}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{meta.effect}</p>
              </div>

              {card.used ? (
                <span className="flex items-center gap-1.5 rounded-chip px-3 py-2 text-sm font-bold text-safe shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-safe)_35%,transparent)]">
                  <CheckIcon size={13} strokeWidth={3.5} />
                  استُنفدت
                </span>
              ) : (
                <Button
                  onClick={() =>
                    card.id === 'freeze' ? (setTarget(null), setPickTarget(true)) : buy(card.id)
                  }
                  disabled={disabled}
                  variant={card.affordable ? 'primary' : 'ghost'}
                  className="tnum shrink-0"
                >
                  {busy === card.id
                    ? 'جارٍ…'
                    : !card.affordable
                      ? `${card.price} نقطة`
                      : card.id === 'freeze'
                        ? 'اختر هدفاً'
                        : `${card.price} نقطة`}
                </Button>
              )}
            </div>

            {picking && (
              <div className="rise-in mt-3 grid gap-1.5 border-t border-line pt-3">
                <p className="text-center text-sm font-bold text-muted">اختر لاعباً لتجميده</p>
                {shop.rivals.map((r) => {
                  const on = target === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setTarget(r.id)}
                      className={`flex items-center gap-3 rounded-chip px-3 py-2.5 text-right font-bold transition ${
                        on
                          ? 'bg-signal-2 text-ink shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                          : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:bg-surface-2'
                      }`}
                    >
                      <span
                        className={`flex size-[18px] shrink-0 items-center justify-center rounded-full ${
                          on
                            ? 'bg-signal text-on-signal'
                            : 'text-transparent shadow-[inset_0_0_0_1.5px_var(--color-line-2)]'
                        }`}
                      >
                        <CheckIcon size={11} strokeWidth={4} />
                      </span>
                      {r.name}
                    </button>
                  );
                })}

                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
                  <Button
                    onClick={() => target && buy('freeze', target)}
                    disabled={!target || busy !== null}
                  >
                    <SnowflakeIcon size={16} />
                    {busy === 'freeze'
                      ? 'جارٍ…'
                      : target
                        ? `أكّد تجميد ${shop.rivals.find((r) => r.id === target)?.name}`
                        : 'اختر لاعباً أولاً'}
                  </Button>
                  <Button variant="ghost" onClick={() => setPickTarget(false)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-xs font-medium text-muted">
        رصيدك <b className="tnum text-ink">{score}</b> نقطة · نقطةٌ لك عن كل إجابة صحيحة
        {(shop.pending.time || shop.pending.double) && (
          <>
            {' '}
            · جاهز للجولة القادمة:{' '}
            <b className="text-signal">
              {[shop.pending.time && 'وقت إضافي', shop.pending.double && 'مضاعفة ×٣']
                .filter(Boolean)
                .join(' + ')}
            </b>
          </>
        )}
      </p>
    </div>
  );
}

/*
 * ورقة صقيع: هكذا ينمو الجليد على الزجاج فعلاً — ساقٌ قُطريّة تتفرّع
 * عنها أشواك متناوبة، وعلى كل شوكة شويكتان أصغر، وتقصر كلما ابتعدت عن
 * الركن. تُرسم زحفاً لا تظهر دفعةً واحدة، فالجليد يتكوّن ولا يُلصق.
 */
const CRYSTAL = (() => {
  const r = (n: number) => Math.round(n * 10) / 10;
  const d = ['M3 3 45 45'];
  for (let i = 1; i <= 7; i++) {
    const t = i / 8;
    const x = 3 + 42 * t;
    const y = 3 + 42 * t;
    const len = 12 * (1 - t * 0.5);
    d.push(`M${r(x)} ${r(y)} ${r(x + len)} ${r(y - len * 0.45)}`);
    d.push(`M${r(x)} ${r(y)} ${r(x - len * 0.45)} ${r(y + len)}`);
    d.push(`M${r(x + len * 0.5)} ${r(y - len * 0.22)} ${r(x + len * 0.78)} ${r(y - len * 0.62)}`);
    d.push(`M${r(x - len * 0.22)} ${r(y + len * 0.5)} ${r(x - len * 0.62)} ${r(y + len * 0.78)}`);
  }
  return d.join(' ');
})();

/* عنقودان في كل ركن: كبيرٌ يزحف أولاً وصغيرٌ يتبعه، فيبدو تكوّناً لا زخرفة */
const CRYSTALS = [
  { at: 'top-0 right-0', spin: 90, size: 'size-32', fade: 0.4, delay: 0 },
  { at: 'top-0 left-0', spin: 0, size: 'size-28', fade: 0.34, delay: 0.1 },
  {
    at: 'bottom-0 right-0',
    spin: 180,
    size: 'size-28',
    fade: 0.34,
    delay: 0.18,
  },
  { at: 'bottom-0 left-0', spin: 270, size: 'size-32', fade: 0.4, delay: 0.26 },
  { at: 'top-0 right-1/3', spin: 90, size: 'size-20', fade: 0.22, delay: 0.34 },
  { at: 'top-0 left-1/4', spin: 0, size: 'size-16', fade: 0.18, delay: 0.42 },
  {
    at: 'bottom-0 right-1/4',
    spin: 180,
    size: 'size-16',
    fade: 0.18,
    delay: 0.5,
  },
  {
    at: 'bottom-0 left-1/3',
    spin: 270,
    size: 'size-20',
    fade: 0.22,
    delay: 0.58,
  },
];

/** العربية تعدّ الواحد والاثنين بصيغتيهما، لا برقمٍ وجمع */
const meltIn = (seconds: number) =>
  seconds === 1 ? 'ثانية واحدة' : seconds === 2 ? 'ثانيتين' : `${seconds} ثوانٍ`;

/**
 * ستارة التجميد: الزجاج يضبب، ويزحف الصقيع من الأركان الأربعة،
 * ويقول العدّاد متى يذوب — فالانتظار الذي يُعرف مداه أهون.
 */
export function FreezeOverlay({
  frozenBy,
  lockedMs,
}: {
  frozenBy: string | null;
  lockedMs: number;
}) {
  const seconds = Math.max(1, Math.ceil(lockedMs / 1000));

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 px-8 text-center">
      <span
        className="veil-in absolute inset-0 bg-ground/88 backdrop-blur-[7px]"
        aria-hidden="true"
      />
      <span className="frost absolute inset-0" aria-hidden="true" />

      {CRYSTALS.map((crystal) => (
        <svg
          key={crystal.at}
          viewBox="0 0 48 48"
          className={`pointer-events-none absolute ${crystal.size} ${crystal.at}`}
          style={{ transform: `rotate(${crystal.spin}deg)` }}
          aria-hidden="true"
        >
          <path
            d={CRYSTAL}
            className="frost-draw"
            style={{ animationDelay: `${crystal.delay}s` }}
            pathLength={100}
            fill="none"
            stroke="var(--color-frost)"
            strokeWidth={0.9}
            strokeLinecap="round"
            opacity={crystal.fade}
          />
        </svg>
      ))}

      <SnowflakeIcon size={64} className="relative text-frost" />
      <p className="relative text-3xl font-black">تجمّد نبضك</p>
      {frozenBy && <p className="relative font-bold text-ink-2">جمّدك اللاعب {frozenBy}</p>}
      <p className="tnum relative text-sm font-medium text-muted">
        يذوب الجليد بعد <b className="text-frost">{meltIn(seconds)}</b>
      </p>
    </div>
  );
}

export { SnowflakeIcon };
