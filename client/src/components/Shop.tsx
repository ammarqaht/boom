import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardId, Shop as ShopData } from '../lib/types';
import { ask } from '../lib/socket';
import { toast } from './ui';
import { CheckIcon, RestoreIcon, SnowflakeIcon, SparkIcon } from './icons';
import { ATTACK_DONE, CARD_LOOK, sparksWord } from '../lib/cards';

/**
 * متجر البطاقات — شبكةُ مربّعاتٍ بثلاثة أعمدة، كلٌّ بلون ميزته. يظهر بين
 * الجولات فقط، ويُشترى بالشرارات لا بنقاط الفوز. لكل بطاقةٍ حدُّها من المرّات
 * طوال اللعبة، وتُطبّق في الجولة التالية.
 */
export function Shop({ shop }: { shop: ShopData }) {
  const [busy, setBusy] = useState<CardId | null>(null);
  /* البطاقةُ المفتوحة في النافذة السفلية: وصفُها وشراؤها — واختيارُ لاعبٍ إن كانت تقع عليه */
  const [opened, setOpened] = useState<CardId | null>(null);
  const press = useLongPress((id: CardId) => setOpened(id));

  if (!shop.open) {
    return null;
  }

  /*
   * ما يمنع الشراء يُقال توستاً أعلى الشاشة: كان سطراً أحمر فوق الشبكة
   * يظهر ويغيب فيدفع المربّعات تحت الإصبع وهو يضغط.
   */
  const flash = (msg: string) => {
    toast(msg, { tone: 'danger', icon: <SparkIcon size={19} /> });
  };

  /*
   * الشراء يُخبَر عنه بتوستٍ أعلى الشاشة.
   *
   * لأن أثرَه مؤجَّل: الوقتُ يُضاف في الجولة القادمة والمضاعفةُ تُحسب في
   * آخرها. فلو لم يُقل شيءٌ ظنّ اللاعبُ أن الضغطة لم تقع.
   */
  const buy = async (card: CardId, targetId?: string) => {
    const meta = shop.cards.find((c) => c.id === card);
    const look = CARD_LOOK[card];
    const victim = targetId ? shop.rivals.find((r) => r.id === targetId)?.name : null;
    setBusy(card);
    const res = await ask('team:buyCard', { card, targetId });
    setBusy(null);
    setOpened(null);
    if (!res.ok) return flash(res.error);
    const done = victim ? ATTACK_DONE[card]?.(victim) : null;
    toast(done ?? `اشتريتَ «${meta?.name ?? 'البطاقة'}»`, {
      tone: look.tone,
      icon: <look.Icon size={19} />,
      /* وصفُ البطاقة مع كل شراء — وللبطاقة التي تقع على لاعبٍ كذلك */
      note: look.effect,
    });
  };

  /*
   * نقضُ الشراء — ما دامت الجولة لم تبدأ.
   *
   * الضغطةُ تُخطئ على هاتفٍ في قاعةٍ مظلمة، والشرارات قليلة: من دفعها سهواً
   * خسر ادّخار جولتين. والسيرفرُ يحرس الباب — يفتحه ما دام الأثرُ مؤجَّلاً
   * ويغلقه ببدء الجولة.
   */
  const undo = async (card: CardId) => {
    const meta = shop.cards.find((c) => c.id === card);
    setBusy(card);
    const res = await ask('team:refundCard', { card });
    setBusy(null);
    setOpened(null);
    if (!res.ok) return flash(res.error);
    toast(`نُقض شراء «${meta?.name ?? 'البطاقة'}»`, {
      tone: 'signal',
      icon: <RestoreIcon size={19} />,
      note: meta ? `رُدّت إليك ${meta.price} ${sparksWord(meta.price)}` : undefined,
    });
  };

  const byId = new Map(shop.cards.map((c) => [c.id, c]));
  /* الصفوف على الزمر: دعمٌ ثم هجومٌ ثم دفاع — ثلاثةٌ وثلاثةٌ واثنتان */
  /*
   * ثلاثةُ صفوف: الوقتُ والصاعقُ والدرع، ثم التجميدُ والسرقةُ والمرآة، ثم
   * المضاعفةُ والمبارزة ممتدّتين إلى طرف الشاشة — الرهانان الأغليان في
   * صفٍّ وحدهما، بمساحةٍ أعرض تليق بهما.
   */
  const ordered = SHOP_LAYOUT.map((id) => byId.get(id)).filter((c) => !!c);
  const sheet = opened ? byId.get(opened) : null;
  const closed = !!shop.closed;

  /*
   * ضغطةٌ واحدة كالسلّة: على بطاقةٍ لم تُشترَ تشتريها، وعلى المشتراة تنقضها
   * (والنقضُ مجانيٌّ ما دامت الجولة لم تبدأ، فلا حاجة لتأكيد). والوقتُ
   * الإضافي يتراكم: ضغطتُه تزيد واحدة، ونقضُه من الزرّ الصغير في ركنه.
   * والبطاقةُ التي تقع على لاعب تفتح نافذة اختياره. والضغطةُ المطوّلة —
   * على أيّ بطاقة — تفتح وصفها كاملاً.
   */
  const tap = (card: ShopData['cards'][number]) => {
    if (closed || busy) return;
    if (card.target) return setOpened(card.id);
    if (card.bought > 0 && card.id !== 'time') return void undo(card.id);
    if (card.used) return flash('استُنفدت هذه البطاقة');
    if (!card.affordable) return flash('شراراتك لا تكفي');
    void buy(card.id);
  };

  return (
    <>
      {/*
       * المربّعُ يحمل ما يُختار به وحده: أيقونةٌ كبيرة واسمٌ وثمن. والوصفُ
       * في الضغطة المطوّلة وفي توست الشراء — كان في المربّع فضاق عن ثلاثة
       * أسطرٍ بخطٍّ دقيق وتراصّت المربّعات.
       */}
      <div data-tour="shop" className="grid grid-cols-6 gap-3">
        {ordered.map((card) => {
          const look = CARD_LOOK[card.id];
          const owned = card.bought > 0;
          const wide = WIDE.has(card.id);
          return (
            <button
              key={card.id}
              type="button"
              {...press(card.id)}
              onClick={() => (press.fired() ? undefined : tap(card))}
              onContextMenu={(e) => e.preventDefault()}
              className={`shop-tile flex select-none ${
                wide
                  ? 'col-span-3 min-h-[104px] flex-row items-center justify-start gap-3 px-3.5 text-right'
                  : 'col-span-2 aspect-[5/6] flex-col items-center justify-center gap-2 px-1.5'
              } ${owned ? 'is-owned' : ''} ${
                closed && !owned
                  ? 'opacity-40'
                  : card.used && !owned
                    ? 'opacity-40 grayscale'
                    : !card.affordable && !owned
                      ? 'opacity-60'
                      : ''
              }`}
              style={{ '--c': look.color } as CSSProperties}
              aria-label={`${card.name}، ${card.price} ${sparksWord(card.price)}، بقيت ${card.left}`}
            >
              {/* الأيقونةُ علامةٌ مائية كبيرة في الركن — تُعرف بها البطاقة من بُعد */}
              <look.Icon
                size={92}
                className="pointer-events-none absolute -bottom-5 -left-5 -rotate-12 opacity-[0.12]"
                style={{ color: 'var(--c)' }}
              />
              {/* ما بقي من مرّاتها: رقمٌ في الركن لا جملة */}
              <span className="tnum absolute top-2 left-2 flex size-[22px] items-center justify-center rounded-full bg-ground/70 text-[11px] font-black text-ink">
                {card.left}
              </span>
              {owned &&
                (card.id === 'time' ? (
                  <span
                    role="button"
                    aria-label="انقض واحدة"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!closed && !busy) void undo(card.id);
                    }}
                    className="tnum absolute top-2 right-2 flex h-[22px] items-center gap-0.5 rounded-full px-1.5 text-[11px] font-black text-ground"
                    style={{ background: 'var(--c)' }}
                  >
                    ×{card.bought}
                    <RestoreIcon size={10} strokeWidth={3} />
                  </span>
                ) : (
                  <span
                    className="absolute top-2 right-2 flex size-[22px] items-center justify-center rounded-full text-ground"
                    style={{ background: 'var(--c)' }}
                  >
                    <CheckIcon size={12} strokeWidth={3.5} />
                  </span>
                ))}
              <span
                className="flex size-[52px] items-center justify-center rounded-[16px]"
                style={{
                  color: 'var(--c)',
                  background: 'color-mix(in srgb, var(--c) 18%, transparent)',
                }}
              >
                <look.Icon size={28} />
              </span>
              <span className={wide ? 'flex min-w-0 flex-col items-start gap-1' : 'contents'}>
                <b className="text-[15px] leading-tight font-black">{card.name}</b>
                <span
                  className="tnum flex items-center gap-1 text-[14px] font-black"
                  style={{ color: card.affordable || owned ? 'var(--c)' : 'var(--color-muted)' }}
                >
                  {card.used && !owned ? (
                    <span className="text-[12px] font-bold text-muted">استُنفدت</span>
                  ) : (
                    <>
                      <SparkIcon size={13} />
                      {card.price}
                    </>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {sheet && (
        <CardSheet
          closed={closed}
          card={sheet}
          rivals={shop.rivals}
          taken={shop.chosen?.[sheet.id] ?? []}
          busy={busy !== null}
          onBuy={(targetId) => void buy(sheet.id, targetId)}
          onUndo={() => void undo(sheet.id)}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

/**
 * الضغطةُ المطوّلة: نصفُ ثانيةٍ على البطاقة تفتح تفاصيلها، والضغطةُ العادية
 * لا تُطلقها. وfired() تُخبر النقرةَ التي تلي الإفلات أن الضغطة استُهلكت.
 */
function useLongPress(onLong: (id: CardId) => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const done = useRef(false);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => clear, []);
  const bind = (id: CardId) => ({
    onPointerDown: () => {
      done.current = false;
      clear();
      timer.current = setTimeout(() => {
        done.current = true;
        navigator.vibrate?.(20);
        onLong(id);
      }, ms);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  });
  bind.fired = () => {
    const was = done.current;
    done.current = false;
    return was;
  };
  return bind;
}

const SHOP_LAYOUT: CardId[] = [
  'time',
  'revive',
  'shield',
  'freeze',
  'steal',
  'mirror',
  'double',
  'duel',
];
const WIDE = new Set<CardId>(['double', 'duel']);

/**
 * نافذةُ البطاقة: تصعد من أسفل الشاشة حيث الإبهام، فيها وصفُها وما بقي
 * منها، ثم الشراء: زرٌّ واحد للبطاقة على النفس، وقائمةُ الخصوم للبطاقة التي
 * تقع على لاعب — والضغطُ على الاسم هو الشراء.
 *
 * والمبارزةُ لا تُعرض فيها إلا أسماءُ من هم أعلى منك: فإن لم يكن أحدٌ
 * قيل لك إنك المتصدّر.
 */
function CardSheet({
  closed,
  card,
  rivals,
  taken,
  busy,
  onBuy,
  onUndo,
  onClose,
}: {
  closed: boolean;
  card: ShopData['cards'][number];
  rivals: ShopData['rivals'];
  taken: string[];
  busy: boolean;
  onBuy: (targetId?: string) => void;
  onUndo: () => void;
  onClose: () => void;
}) {
  const look = CARD_LOOK[card.id];
  const list = card.upward ? rivals.filter((r) => r.above) : rivals;
  const owned = card.bought > 0;
  /* لماذا لا يُشترى الآن — يُقال على الزرّ نفسه لا في سطرٍ بعيد */
  const blocked = closed
    ? 'انتهى وقت الشراء'
    : card.used
      ? 'استُنفدت'
      : !card.affordable
        ? 'شراراتك لا تكفي'
        : owned && !card.target && card.id !== 'time'
          ? 'اشتريتها للجولة القادمة'
          : null;

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="veil-in absolute inset-0 bg-ground/75 backdrop-blur-[2px]"
      />
      <div
        className="sheet-up relative mx-auto flex max-h-[80vh] w-full max-w-md flex-col rounded-t-[26px] bg-surface pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_-12px_#000]"
        style={{ '--c': look.color } as CSSProperties}
      >
        <span className="mx-auto mt-2.5 h-1.5 w-11 rounded-full bg-line-2" aria-hidden="true" />
        <div className="flex items-start gap-3.5 px-5 pt-4 pb-4">
          <span
            className="flex size-14 shrink-0 items-center justify-center rounded-[18px]"
            style={{
              color: 'var(--c)',
              background: 'color-mix(in srgb, var(--c) 18%, transparent)',
            }}
          >
            <look.Icon size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <b className="text-xl font-black">{card.name}</b>
              <span className="tnum shrink-0 text-[12px] font-bold text-muted">
                {card.left === 1
                  ? 'بقيت مرّة'
                  : card.left === 2
                    ? 'بقيت مرّتان'
                    : `بقيت ${card.left} مرّات`}
              </span>
            </div>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{look.effect}</p>
          </div>
        </div>

        {card.target && !blocked ? (
          <div className="grid gap-1.5 overflow-y-auto border-t border-line px-4 pt-3">
            {list.length === 0 ? (
              <p className="py-6 text-center font-bold text-muted">أنت أعلى واحد نقاطاً</p>
            ) : (
              list.map((r) => {
                const already = taken.includes(r.id);
                /* تحدّاه غيرُك لهذه الجولة: لاعبٌ واحد يُتحدّى مرّةً */
                const held = card.id === 'duel' && r.dueled && !already;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={already || held || busy}
                    onClick={() => onBuy(r.id)}
                    className={`flex items-center gap-3 rounded-[14px] px-4 py-3 text-right font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] transition hover:bg-surface-2 active:scale-[0.98] ${
                      already || held ? 'opacity-40' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[16px]">{r.name}</span>
                    {already ? (
                      <CheckIcon size={15} style={{ color: 'var(--c)' }} />
                    ) : held ? (
                      <span className="shrink-0 text-[12px] font-bold text-muted">تحدّاه غيرك</span>
                    ) : (
                      <span className="tnum shrink-0 text-sm font-black text-signal">
                        {r.score}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="px-4">
            <button
              type="button"
              disabled={!!blocked || busy}
              onClick={() => onBuy()}
              className="tnum flex w-full items-center justify-center gap-2 rounded-[16px] py-3.5 text-[17px] font-black text-ground transition active:scale-[0.98] disabled:bg-surface-2 disabled:text-muted"
              style={blocked ? undefined : { background: 'var(--c)' }}
            >
              {blocked ?? (
                <>
                  اشترِ
                  <SparkIcon size={16} />
                  {card.price}
                </>
              )}
            </button>
          </div>
        )}

        {/* المشتراة في هذه الاستراحة تُنقض من نافذتها — والثمنُ يعود */}
        {owned && !closed && (
          <div className="px-4 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={onUndo}
              className="flex w-full items-center justify-center gap-1.5 rounded-[14px] py-3 text-[14px] font-bold text-muted shadow-[inset_0_0_0_1px_var(--color-line-2)]"
            >
              <RestoreIcon size={15} />
              {card.bought > 1 ? `تراجع عن واحدة (اشتريت ${card.bought})` : 'تراجع عن الشراء'}
            </button>
          </div>
        )}
      </div>
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
