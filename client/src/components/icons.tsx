import type { SVGProps } from 'react';

/** أيقونات فيكتور بخط موحّد — ترث لون النص وتقبل أي حجم */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 4.5v15l13-7.5L6 4.5z" fill="currentColor" stroke="none" /></Icon>
);

export const PauseIcon = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></Icon>
);

export const MenuIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>
);

export const SettingsIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 8.9a1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.33H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.33 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47 1z" />
  </Icon>
);

export const RestartIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Icon>
);

export const ExitIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2" /></Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}><path d="M20 6L9 17l-5-5" /></Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}><path d="M18 6L6 18M6 6l12 12" /></Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Icon>
);

export const ScreenIcon = (p: IconProps) => (
  <Icon {...p}><rect x="2" y="3" width="20" height="14" rx="2.5" /><path d="M8 21h8M12 17v4" /></Icon>
);

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></Icon>
);

export const TrophyIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4h12v5a6 6 0 0 1-12 0V4z" />
    <path d="M6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2" />
    <path d="M9 20h6M12 15v5" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>
);

export const MinusIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 12h14" /></Icon>
);

export const ClockIcon = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
);

export const OfflineIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2 2l20 20" /><path d="M5 12.5a11 11 0 0 1 4-2.6M2 8.8a16 16 0 0 1 5-3.2M17 10a11 11 0 0 1 2 2.5M12 5c3.3 0 6.4 1.2 8.8 3.2" /><path d="M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="20" r="0.6" fill="currentColor" /></Icon>
);

export const SoundOnIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
);

export const SoundOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M22 9l-6 6M16 9l6 6" />
  </Icon>
);

export const CrownIcon = ({ size = 20, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M3 8l4 3.5L12 4l5 7.5L21 8l-1.6 10.4a1 1 0 0 1-1 .85H5.6a1 1 0 0 1-1-.85L3 8z" />
  </svg>
);

export const HourglassIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 2h12M6 22h12" />
    <path d="M7 2c0 4 3 5 5 7 2-2 5-3 5-7M7 22c0-4 3-5 5-7 2 2 5 3 5 7" />
  </Icon>
);

export const SnowflakeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2v20M2 12h20" />
    <path d="M12 2l-2.5 2.5M12 2l2.5 2.5M12 22l-2.5-2.5M12 22l2.5-2.5" />
    <path d="M2 12l2.5-2.5M2 12l2.5 2.5M22 12l-2.5-2.5M22 12l2.5 2.5" />
    <path d="M5 5l3.5 3.5M19 5l-3.5 3.5M5 19l3.5-3.5M19 19l-3.5-3.5" />
  </Icon>
);

export const MultiplyIcon = ({ size = 20, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
    <text x="12" y="10" fontSize="7" fontWeight="900" textAnchor="middle" fill="currentColor">
      ×
    </text>
  </svg>
);

export const CardsIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="6" width="12" height="15" rx="2" transform="rotate(-8 9 13)" />
    <rect x="9" y="4" width="12" height="15" rx="2" transform="rotate(6 15 11)" />
  </Icon>
);

export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}><path d="M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4" /><path d="M12 8v4.5l3 1.8" /></Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 2l20 20" />
    <path d="M10.6 5.2A9.6 9.6 0 0 1 12 5c5.5 0 9.5 5.2 9.5 7 0 .8-.8 2.3-2.2 3.7M6.3 6.9C3.9 8.5 2.5 10.8 2.5 12c0 1.8 4 7 9.5 7 1.6 0 3.1-.5 4.4-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}><path d="M2.5 12c0-1.8 4-7 9.5-7s9.5 5.2 9.5 7-4 7-9.5 7-9.5-5.2-9.5-7z" /><circle cx="12" cy="12" r="3" /></Icon>
);

/** القنبلة — أيقونة اللعبة الأساسية */
export const BombIcon = ({ size = 20, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
    <circle cx="10.5" cy="15" r="6.5" fill="currentColor" />
    <path
      d="M15.2 9.6l2-2M17.5 6.6c1.2-1.2 3-1.2 4 0"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    />
    <circle cx="21.6" cy="3.4" r="1.6" fill="currentColor" opacity="0.55" />
  </svg>
);

export const BoomIcon = ({ size = 20, ...props }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 1.5l2.1 4.3 4.4-2-1.3 4.7 4.8.4-3.6 3.1 3.6 3.1-4.8.4 1.3 4.7-4.4-2L12 22.5l-2.1-4.3-4.4 2 1.3-4.7-4.8-.4 3.6-3.1L2 8.9l4.8-.4-1.3-4.7 4.4 2L12 1.5z" />
  </svg>
);
