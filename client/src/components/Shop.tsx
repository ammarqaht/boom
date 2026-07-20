import { useState } from 'react';
import type { CardId, Shop as ShopData } from '../lib/types';
import { ask } from '../lib/socket';
import { Button } from './ui';
import {
  CardsIcon,
  CheckIcon,
  HourglassIcon,
  MultiplyIcon,
  SnowflakeIcon,
} from './icons';

const CARD_META: Record<
  CardId,
  { Icon: typeof HourglassIcon; color: string; effect: string }
> = {
  time: { Icon: HourglassIcon, color: '#22a45d', effect: 'تبدأ الجولة القادمة بـ +٥ ثوانٍ' },
  freeze: {
    Icon: SnowflakeIcon,
    color: '#12b3d5',
    effect: 'تقفل مجموعة عن الإجابة ٥ ثوانٍ في بداية الجولة',
  },
  double: { Icon: MultiplyIcon, color: '#ff9f1c', effect: 'نقاط جولتك القادمة ×٣' },
};

/**
 * متجر البطاقات — يظهر بين الجولات فقط.
 * كل بطاقة مرة واحدة لكل مجموعة، وتُطبّق في الجولة التالية.
 */
export function Shop({ shop, score }: { shop: ShopData; score: number }) {
  const [busy, setBusy] = useState<CardId | null>(null);
  const [note, setNote] = useState('');
  const [pickTarget, setPickTarget] = useState(false);

  if (!shop.open) return null;

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(''), 2500);
  };

  const buy = async (card: CardId, targetId?: string) => {
    setBusy(card);
    const res = await ask('team:buyCard', { card, targetId });
    setBusy(null);
    setPickTarget(false);
    if (!res.ok) flash(res.error);
  };

  return (
    <div className="mb-6 rounded-2xl border border-[#e8e4dd] bg-white p-5 shadow-[0_1px_3px_rgba(26,26,26,0.04)]">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-black text-[#103f91]">
          <CardsIcon size={22} className="text-[#ff9f1c]" />
          متجر البطاقات
        </h2>
        <span className="text-sm font-bold text-[#9a968f]">رصيدك {score} نقطة</span>
      </div>
      <p className="mb-4 text-sm text-[#9a968f]">
        كل بطاقة مرة واحدة، تُطبّق في الجولة القادمة
      </p>

      {note && (
        <p className="mb-3 rounded-xl bg-[#fdeae8] px-4 py-2 text-center text-sm font-bold text-[#c2231b]">
          {note}
        </p>
      )}

      <div className="grid gap-3">
        {shop.cards.map((card) => {
          const meta = CARD_META[card.id];
          const isFreezePicking = card.id === 'freeze' && pickTarget;
          const disabled = card.used || !card.affordable || busy !== null;

          return (
            <div
              key={card.id}
              className="flex flex-col gap-3 rounded-xl border border-[#e8e4dd] p-3"
              style={card.used ? { opacity: 0.55 } : undefined}
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                >
                  <meta.Icon size={24} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-black">
                    {card.name}
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-black text-white"
                      style={{ backgroundColor: meta.color }}
                    >
                      {card.price} نقطة
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[#6b6b6b]">{meta.effect}</p>
                </div>
              </div>

              {card.used ? (
                <span className="flex items-center justify-center gap-1.5 rounded-lg bg-[#f1faf3] py-2 text-sm font-bold text-[#22a45d]">
                  <CheckIcon size={14} strokeWidth={3} />
                  استُخدمت
                </span>
              ) : isFreezePicking ? (
                <div className="grid gap-1.5">
                  <p className="text-center text-sm font-bold text-[#6b6b6b]">اختر مجموعة لتجميدها:</p>
                  <div className="grid gap-1.5">
                    {shop.rivals.map((r) => (
                      <Button
                        key={r.id}
                        variant="ghost"
                        onClick={() => buy('freeze', r.id)}
                        disabled={busy !== null}
                      >
                        {r.name}
                      </Button>
                    ))}
                    <button
                      onClick={() => setPickTarget(false)}
                      className="text-sm font-bold text-[#9a968f]"
                    >
                      إلغاء
                    </button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => (card.id === 'freeze' ? setPickTarget(true) : buy(card.id))}
                  disabled={disabled}
                  style={{ backgroundColor: card.affordable ? meta.color : undefined }}
                  className={card.affordable ? 'text-white' : ''}
                >
                  {busy === card.id
                    ? 'جارٍ…'
                    : !card.affordable
                      ? 'نقاطك لا تكفي'
                      : card.id === 'freeze'
                        ? 'اختر هدفاً'
                        : 'اشترِ'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {(shop.pending.time || shop.pending.double) && (
        <p className="mt-3 rounded-xl bg-[#fff6e8] px-4 py-2 text-center text-sm font-bold text-[#e68500]">
          جاهز للجولة القادمة:
          {shop.pending.time && ' وقت إضافي'}
          {shop.pending.time && shop.pending.double && ' +'}
          {shop.pending.double && ' مضاعفة ×٣'}
        </p>
      )}
    </div>
  );
}

/** لوحة التجميد التي تغطّي شاشة المجموعة أثناء القفل */
export function FreezeOverlay({ frozenBy }: { frozenBy: string | null }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-[#0e92af]/92 backdrop-blur-sm">
      <span className="boom text-white">
        <SnowflakeIcon size={80} />
      </span>
      <p className="boom mt-4 text-4xl font-black text-white">جُمّدتم!</p>
      {frozenBy && <p className="mt-2 text-xl font-bold text-white/80">جمّدتكم مجموعة {frozenBy}</p>}
      <p className="mt-4 text-white/70">انتظروا لحظات… لا يمكنكم الإجابة الآن</p>
    </div>
  );
}

// نُبقي مرجعاً للأيقونة كي تُستعمل في صفحات أخرى بسهولة
export { SnowflakeIcon };
