import { useState } from 'react';
import type { CardId, Shop as ShopData } from '../lib/types';
import { ask } from '../lib/socket';
import { Button, toast } from './ui';
import { CheckIcon, RestoreIcon, SnowflakeIcon } from './icons';
import { ATTACK_DONE, CARD_LOOK, PICK_LABEL } from '../lib/cards';

/*
 * صيغةُ المعدود: «نقطة» و«نقطتان» و«3 نقاط» و«14 نقطة». والقاعدة في
 * المتصفّح أصلاً — Intl.PluralRules يعرف أصناف العربية — فلا جدولَ يُكتب
 * باليد. ولم تكن تلزمنا حين كانت الأسعار كلّها فوق العشر.
 */
const PLURAL = new Intl.PluralRules('ar');

const pointsWord = (n: number) => {
  const pick = PLURAL.select(n);
  return pick === 'two' ? 'نقطتان' : pick === 'few' ? 'نقاط' : 'نقطة';
};

/**
 * متجر البطاقات — صفوف لا صناديق، ويظهر بين الجولات فقط.
 * لكل بطاقةٍ حدُّها من المرّات طوال اللعبة، وتُطبّق في الجولة التالية.
 */
export function Shop({ shop, score }: { shop: ShopData; score: number }) {
  const [busy, setBusy] = useState<CardId | null>(null);
  const [note, setNote] = useState('');
  const [pickTarget, setPickTarget] = useState<CardId | null>(null);
  // التجميد يقع على لاعبٍ بعينه ولا رجعة فيه، فالاختيار خطوة والتأكيد أخرى
  const [target, setTarget] = useState<string | null>(null);

  if (!shop.open) {
    return null;
  }

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 2500);
  };

  /*
   * الشراء يُخبَر عنه بتوستٍ أعلى الشاشة.
   *
   * لأن أثرَه مؤجَّل: الوقتُ يُضاف في الجولة القادمة والمضاعفةُ تُحسب في
   * آخرها. فلو لم يُقل شيءٌ ظنّ اللاعبُ أن الضغطة لم تقع — وفي المتجر
   * الطويل قد ينزل سطرُ البطاقة خارج نظره عند الضغط.
   */
  const buy = async (card: CardId, targetId?: string) => {
    const meta = shop.cards.find((c) => c.id === card);
    const look = CARD_LOOK[card];
    const victim = targetId ? shop.rivals.find((r) => r.id === targetId)?.name : null;
    setBusy(card);
    const res = await ask('team:buyCard', { card, targetId });
    setBusy(null);
    setPickTarget(null);
    setTarget(null);
    if (!res.ok) return flash(res.error);
    const done = victim ? ATTACK_DONE[card]?.(victim) : null;
    toast(done ?? `اشتريتَ «${meta?.name ?? 'البطاقة'}»`, {
      tone: look.tone,
      icon: <look.Icon size={19} />,
    });
  };

  /*
   * نقضُ الشراء — ما دامت الجولة لم تبدأ.
   *
   * الضغطةُ تُخطئ على هاتفٍ في قاعةٍ مظلمة، وستُّ نقاطٍ ثمنُ جولةٍ كاملة
   * للاعبٍ متوسّط: فمن دفعها سهواً خسر جولةً بلا لعب. والسيرفرُ يحرس
   * الباب — يفتحه ما دام الأثرُ مؤجَّلاً ويغلقه ببدء الجولة.
   */
  const undo = async (card: CardId) => {
    const meta = shop.cards.find((c) => c.id === card);
    setBusy(card);
    const res = await ask('team:refundCard', { card });
    setBusy(null);
    if (!res.ok) return flash(res.error);
    toast(`نُقض شراء «${meta?.name ?? 'البطاقة'}»`, {
      tone: 'signal',
      icon: <RestoreIcon size={19} />,
      note: `رُدّت إليك ${meta ? `${meta.price} ${pointsWord(meta.price)}` : 'نقاطُك'}`,
    });
  };

  const pendingNames = shop.cards.filter((c) => shop.pending?.[c.id]).map((c) => c.name);

  return (
    <div className="grid gap-2">
      {note && (
        <p className="rounded-chip bg-danger-2 px-4 py-2 text-center text-sm font-bold text-danger">
          {note}
        </p>
      )}

      {shop.cards.map((card) => {
        const meta = CARD_LOOK[card.id];
        const picking = pickTarget === card.id;
        const taken = shop.chosen?.[card.id] ?? [];
        const disabled = card.used || !card.affordable || busy !== null;

        const owned = card.bought > 0;

        return (
          <div key={card.id} className={`tile p-3 ${card.used && !owned ? 'opacity-50' : ''}`}>
            <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3">
              {/* المربّعُ يحمل ملمسَ البطاقة — فتُعرف قبل أن تُقرأ */}
              <span
                className={`flex size-10 items-center justify-center rounded-chip bg-surface-2 ${meta.skin} ${meta.ink}`}
              >
                <meta.Icon size={22} />
              </span>

              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-black">{card.name}</span>
                  {!card.used && (
                    /* بلونِ الإشارة: رصيدٌ باقٍ لا تعليقٌ خافت — يُقرأ قبل الشراء */
                    <span className="shrink-0 text-[11px] font-bold text-signal">
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

              {/*
                زرُّ النقض يحلّ محلّ زرّ الشراء ما دام الشراءُ قابلاً للنقض.
                ولا يُزاد زرٌّ ثالث: الصفُّ ضيّقٌ على هاتف، وزرّان في موضعٍ
                واحد يُضغط أحدُهما بالخطأ.
              */}
              {owned ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void undo(card.id)}
                  disabled={busy !== null}
                  className="shrink-0 text-muted"
                >
                  {busy === card.id ? 'جارٍ…' : 'تراجع'}
                </Button>
              ) : card.used ? (
                <span className="flex items-center gap-1.5 rounded-chip px-3 py-1.5 text-[13px] font-bold text-safe shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-safe)_35%,transparent)]">
                  <CheckIcon size={12} strokeWidth={3.5} />
                  استُنفدت
                </span>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    card.target ? (setTarget(null), setPickTarget(card.id)) : buy(card.id)
                  }
                  disabled={disabled}
                  variant={card.affordable ? 'primary' : 'ghost'}
                  className="tnum shrink-0"
                >
                  {/*
                    الثمنُ على الأزرار الثلاثة سواء.
                    كان زرُّ التجميد يقول «اختر هدفاً» فيبقى ثمنُه مجهولاً حتى
                    يُضغط — ويُقارَن اللاعبُ بين ثلاثٍ أثمانُ اثنتين ظاهرةٌ
                    والثالثةِ خفيّة. واختيارُ الهدف خطوةٌ تالية تُقال في لوحها.
                  */}
                  {busy === card.id ? 'جارٍ…' : `${card.price} ${pointsWord(card.price)}`}
                </Button>
              )}
            </div>

            {picking && (
              <div className="rise-in mt-3 grid gap-1.5 border-t border-line pt-3">
                <p className="text-center text-sm font-bold text-muted">
                  اختر لاعباً لـ{PICK_LABEL[card.id]}
                </p>
                {shop.rivals.map((r) => {
                  const on = target === r.id;
                  const already = taken.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={already}
                      onClick={() => setTarget(r.id)}
                      className={`flex items-center gap-3 rounded-chip px-3 py-2.5 text-right font-bold transition ${
                        on
                          ? 'bg-signal-2 text-ink shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                          : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:bg-surface-2'
                      } ${already ? 'opacity-40' : ''}`}
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
                    size="sm"
                    onClick={() => target && buy(card.id, target)}
                    disabled={!target || busy !== null}
                  >
                    <meta.Icon size={14} />
                    {busy === card.id
                      ? 'جارٍ…'
                      : target
                        ? `أكّد ${PICK_LABEL[card.id]} ${shop.rivals.find((r) => r.id === target)?.name}`
                        : 'اختر لاعباً أولاً'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPickTarget(null)}>
                    إلغاء
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-xs font-medium text-muted">
        رصيدك <b className="tnum text-ink">{score}</b> {pointsWord(score)} · نقطةٌ لك عن كل إجابة
        صحيحة
        {pendingNames.length > 0 && (
          <>
            {' '}
            · جاهز للجولة القادمة: <b className="text-signal">{pendingNames.join(' + ')}</b>
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
      {/*
       * من جمّدك يُسمّى صريحاً وبارزاً: التجميد يُفقد ثوانٍ ويُربك، فإن لم
       * يُعرف صاحبُه ظُنّ عطباً في اللعبة — ومعرفتُه نصفُ المتعة.
       */}
      {frozenBy && (
        <p className="relative text-lg font-black text-ink">
          تم تجميدك من قبل <span className="text-frost">{frozenBy}</span>
        </p>
      )}
      <p className="tnum relative text-sm font-medium text-muted">
        يذوب الجليد بعد <b className="text-frost">{meltIn(seconds)}</b>
      </p>
    </div>
  );
}

export { SnowflakeIcon };
