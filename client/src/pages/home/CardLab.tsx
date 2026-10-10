import { useState } from 'react';
import type { CardId } from '../../lib/types';
import { CARD_LOOK } from '../../lib/cards';
import { Lane } from '../../components/game';
import { formatTime } from '../../components/ui';
import { CATALOG, arabic, countWord } from './demo';
import { tap, useInView, useLoop, usePageVisible } from './hooks';

const SPEED = 2.5;
const PERIOD = 6800;
const JOLT_G = 3000;

type Side = {
  ms: number;
  flat?: boolean;
  frost?: boolean;
  gold?: boolean;
  dark?: boolean;
  mark?: CardId;
  pts?: string;
};
type Hit = { side: 'you' | 'rival'; at: number; tone: 'up' | 'down' | 'hold'; text?: string; icon?: CardId };
type Scene = { you: Side; rival: Side; hits: Hit[] };

const sec = (n: number) => arabic(n);

const SCENES: Record<CardId, { still: number; at: (g: number) => Scene }> = {
  time: {
    still: 6000,
    at: (g) => ({
      you: { ms: 18000 - g + (g >= 1500 ? 10000 : 0), mark: 'time' },
      rival: { ms: 18000 - g },
      hits: [{ side: 'you', at: 1500, tone: 'up', text: `+${sec(10)}` }],
    }),
  },
  truce: {
    still: 6000,
    at: (g) => ({
      you: { ms: g < 10000 ? 20000 : 30000 - g, mark: g < 10000 ? 'truce' : undefined },
      rival: { ms: 20000 - g },
      hits: [],
    }),
  },
  shield: {
    still: 7500,
    at: (g) => ({
      you: { ms: 22000 - g - (g >= 10000 ? 3000 : 0), mark: g < 10000 ? 'shield' : undefined },
      rival: { ms: 20000 - g },
      hits: [
        { side: 'you', at: 3000, tone: 'hold', text: sec(0) },
        { side: 'you', at: 6500, tone: 'hold', text: sec(0) },
        { side: 'you', at: 10000, tone: 'down', text: `−${sec(3)}` },
      ],
    }),
  },
  revive: {
    still: 10500,
    at: (g) => ({
      you:
        g < 7000
          ? { ms: 7000 - g, mark: 'revive' }
          : g < 8500
            ? { ms: 0, flat: true, mark: 'revive' }
            : { ms: 10000 - (g - 8500) },
      rival: { ms: 22000 - g },
      hits: [{ side: 'you', at: 8500, tone: 'up', text: `+${sec(10)}` }],
    }),
  },
  fort: {
    still: 5000,
    at: (g) => ({
      you: { ms: 20000 - g, mark: 'fort' },
      rival: { ms: 21000 - g },
      hits: [{ side: 'you', at: 4000, tone: 'hold', icon: 'freeze' }],
    }),
  },
  mirror: {
    still: 6000,
    at: (g) => ({
      you: { ms: 20000 - g, mark: g < 4000 ? 'mirror' : undefined },
      rival: { ms: 21000 - g, frost: g >= 4000 && g < 9000 },
      hits: [
        { side: 'you', at: 4000, tone: 'hold', icon: 'freeze' },
        { side: 'rival', at: 4000, tone: 'down', icon: 'freeze' },
      ],
    }),
  },
  blackout: {
    still: 6000,
    at: (g) => ({
      you: { ms: 20000 - g },
      rival: { ms: 21000 - g, dark: g >= 2500 },
      hits: [{ side: 'rival', at: 2500, tone: 'down', icon: 'blackout' }],
    }),
  },
  freeze: {
    still: 5000,
    at: (g) => ({
      you: { ms: 20000 - g },
      rival: { ms: 21000 - g, frost: g >= 2500 && g < 7500 },
      hits: [{ side: 'rival', at: 2500, tone: 'down', icon: 'freeze' }],
    }),
  },
  steal: {
    still: 6000,
    at: (g) => ({
      you: { ms: 18000 - g + (g >= 4000 ? 5000 : 0) },
      rival: { ms: 22000 - g - (g >= 4000 ? 5000 : 0) },
      hits: [
        { side: 'you', at: 4000, tone: 'up', text: `+${sec(5)}` },
        { side: 'rival', at: 4000, tone: 'down', text: `−${sec(5)}` },
      ],
    }),
  },
  double: {
    still: 13000,
    at: (g) => ({
      you: { ms: 22000 - g, gold: true, pts: g >= 11000 ? `${sec(4)} × ${sec(2)} = ${sec(8)}` : undefined },
      rival: { ms: 20000 - g, pts: g >= 11000 ? sec(3) : undefined },
      hits: [],
    }),
  },
};

function Row({ name, side, hits, g }: { name: string; side: Side; hits: Hit[]; g: number }) {
  const Mark = side.mark ? CARD_LOOK[side.mark].Icon : null;
  const shown = hits.filter((h) => g >= h.at && g - h.at < JOLT_G);

  return (
    <div className={`lab-row ${side.frost ? 'frosted' : ''} ${side.gold ? 'gilded' : ''}`}>
      <span className="lab-name">{name}</span>
      <div className="relative min-w-0 flex-1">
        {side.dark ? (
          <div className="lab-dark h-14" />
        ) : (
          <Lane timeMs={side.ms} flatlined={side.flat} size="md" className="h-14 w-full" />
        )}
        {shown.map((h) => {
          const Icon = h.icon ? CARD_LOOK[h.icon].Icon : null;
          return (
            <span key={`${h.at}${h.side}`} className={`demo-jolt tnum is-${h.tone}`}>
              {Icon ? <Icon size={22} /> : h.text}
            </span>
          );
        })}
      </div>
      <span className="lab-side">
        {Mark && (
          <span className={`lab-mark ${CARD_LOOK[side.mark!].ink}`}>
            <Mark size={16} />
          </span>
        )}
        <span className="lab-time tnum">
          {side.pts ?? (side.dark ? '؟' : side.flat ? sec(0) : formatTime(side.ms))}
        </span>
      </span>
    </div>
  );
}

export function CardLab() {
  const [card, setCard] = useState<CardId>('time');
  const [box, inView] = useInView<HTMLDivElement>();
  const visible = usePageVisible();
  const scene = SCENES[card];
  const t = useLoop(inView && visible, PERIOD, scene.still / SPEED, card);
  const g = t * SPEED;
  const now = scene.at(g);
  const meta = CATALOG.find((c) => c.id === card)!;
  const look = CARD_LOOK[card];

  return (
    <div ref={box} className="lab">
      <div className="lab-stage">
        <div className="flex flex-col gap-2">
          <Row name="أنت" side={now.you} hits={now.hits.filter((h) => h.side === 'you')} g={g} />
          <Row name="الخصم" side={now.rival} hits={now.hits.filter((h) => h.side === 'rival')} g={g} />
        </div>
        <div key={card} className="lab-read rise-in" aria-live="polite">
          <span className={`lab-big ${look.ink}`}>
            <look.Icon size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-black">{meta.name}</h3>
            <p className="mt-1 font-bold text-ink-2">{look.effect}</p>
          </div>
          <div className="lab-stats">
            <span>
              <b className="tnum">{arabic(meta.price)}</b>
              {countWord(meta.price, 'نقطة', 'نقطتان', 'نقاط')}
            </span>
            <span>
              <b className="tnum">{arabic(meta.limit)}</b>
              {countWord(meta.limit, 'مرّة', 'مرّتان', 'مرّات')}
            </span>
          </div>
        </div>
      </div>

      <div className="lab-deck" role="group" aria-label="البطاقات">
        {CATALOG.map((c) => {
          const l = CARD_LOOK[c.id];
          const on = c.id === card;
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                tap();
                setCard(c.id);
              }}
              className={`tap lab-card ${l.skin} ${on ? 'is-on' : ''}`}
            >
              <span className={l.ink}>
                <l.Icon size={24} />
              </span>
              <span className="lab-card-name">{c.name}</span>
              <span className="lab-card-price tnum">{arabic(c.price)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
