import type { CSSProperties } from 'react';
import { countOf } from '../lib/arabic';

/**
 * نبضاتُ الجولة: مربّعٌ لكل لاعبٍ يسكن فتنتهي الجولة. الحيُّ ينبض بخطٍّ
 * أخضر، والمكسورُ خطٌّ أحمرُ مستقيم — وعليه اسمُ من كسره حيث يتّسع المكان
 * (لوحة المنظّم وشاشة العرض). وحين تنكسر الأخيرة تنتهي الجولة.
 *
 * والعددُ الكبير (أكثر من اثنتي عشرة) يُختصر في قرصٍ واحدٍ برقمه: صفٌّ من
 * عشرين مربّعاً في ترويسةٍ ضيّقة لا يُقرأ.
 */
export function LivesBar({
  lives,
  fallen,
  size = 'sm',
  names = false,
  className = '',
}: {
  lives: number;
  fallen: string[];
  size?: 'sm' | 'md' | 'lg';
  /** يُكتب اسمُ الساقط على مربّعه */
  names?: boolean;
  className?: string;
}) {
  const left = Math.max(0, lives - fallen.length);
  const dims = {
    sm: { box: 'h-5 min-w-5 rounded-[6px] px-1', text: 'text-[10px]', ecg: 12 },
    md: { box: 'h-8 min-w-8 rounded-[9px] px-1.5', text: 'text-[12px]', ecg: 18 },
    lg: { box: 'h-11 min-w-11 rounded-[12px] px-2.5', text: 'text-[19px]', ecg: 26 },
  }[size];

  if (lives > 12) {
    return (
      <span
        className={`tnum flex items-center gap-1.5 font-black ${dims.text} ${className}`}
        aria-label={`بقي ${countOf(left, LIVES)} من ${lives}`}
      >
        <Beat size={dims.ecg} alive />
        <span className="text-safe">{left}</span>
        <span className="text-muted">/ {lives}</span>
      </span>
    );
  }

  return (
    <span
      className={`flex flex-wrap items-center gap-1 ${className}`}
      role="img"
      aria-label={`بقي ${countOf(left, LIVES)} من ${lives}`}
    >
      {Array.from({ length: lives }, (_, i) => {
        const broken = i < fallen.length;
        return (
          <span
            key={i}
            title={broken ? `توقف نبض ${fallen[i]}` : 'نبضة باقية'}
            className={`life-box flex items-center justify-center gap-1 font-black ${dims.box} ${dims.text} ${
              broken ? 'is-broken' : ''
            }`}
            style={{ '--d': `${i * 0.08}s` } as CSSProperties}
          >
            <Beat size={dims.ecg} alive={!broken} />
            {broken && names && <span className="max-w-[9ch] truncate">{fallen[i]}</span>}
          </span>
        );
      })}
    </span>
  );
}

/** خطُّ النبضة: موجةٌ للحيّ ومستقيمٌ للساكن */
function Beat({ size, alive }: { size: number; alive: boolean }) {
  return (
    <svg
      width={size}
      height={size * 0.6}
      viewBox="0 0 20 12"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d={alive ? 'M0 6H6L8 1.5L11 10.5L13 6H20' : 'M0 6H20'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** «لاعب واحد» و«لاعبَين» و«٣ لاعبين» و«١١ لاعباً» */
export function playersWord(n: number) {
  return countOf(n, { one: 'لاعب واحد', two: 'لاعبَين', few: 'لاعبين', many: 'لاعباً' });
}

const LIVES = { one: 'نبضة واحدة', two: 'نبضتان', few: 'نبضات', many: 'نبضة' };

/** نبضاتُ جولةٍ بهذا العدد من اللاعبين — كما يحسبها السيرفر */
export const livesFor = (players: number) => Math.max(1, Math.ceil(players / 8));
