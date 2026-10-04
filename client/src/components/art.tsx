import { useId, type ReactNode } from 'react';

/*
 * ══════════════════════════════════════════════════════════════
 * رسومُ البنوك والمراحل
 *
 * لكل بنكٍ لوحةٌ تُعرف بالنظر قبل أن يُقرأ اسمُها — كما تُعرض فئاتُ
 * «سين جيم» بطاقاتٍ مصوّرة لا قائمةَ أسماء. والرسمُ من نظام المِرقاب
 * نفسه: سماويُّ الإشارة على كحليٍّ غائر، بتدرّجٍ يُضيء من أعلى وهالةٍ
 * خلفه، لا ألوانٌ غريبةٌ عن الشاشة.
 *
 * ولا وجوهَ ولا أشخاص: البنوكُ دينيةٌ في أغلبها، فالرمزُ هو الشيء —
 * سفينةٌ وقبّةٌ ورحْلٌ ونخلة — لا من حمله.
 *
 * والبنكُ الذي يُضاف لاحقاً من لوحة المالك يأخذ النجمةَ الثُّمانية حتى
 * يُرسم له.
 * ══════════════════════════════════════════════════════════════
 */

type Paint = {
  /** التدرّجُ المُضيء: من حبر الإشارة إلى عمقها */
  lit: string;
  /** الكحليُّ الغائر: أجسامٌ يُرسم حدُّها بالمُضيء */
  deep: string;
};

const INK = '#e4f0f8';
const SIGNAL = '#4ad5ff';

/** النجمةُ الثُّمانية — مربّعان أحدهما مُدارٌ ربعَ قائمة */
function star8(cx: number, cy: number, r: number) {
  const d = r * Math.SQRT1_2;
  const square = `M${cx - d} ${cy - d}h${2 * d}v${2 * d}h${-2 * d}z`;
  const diamond = `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}z`;
  return `${square}${diamond}`;
}

function Canvas({ children }: { children: (paint: Paint) => ReactNode }) {
  const id = useId().replace(/:/g, '');
  const paint = { lit: `url(#${id}-lit)`, deep: `url(#${id}-deep)` };
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-lit`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b5efff" />
          <stop offset="0.45" stopColor={SIGNAL} />
          <stop offset="1" stopColor="#168fbd" />
        </linearGradient>
        <linearGradient id={`${id}-deep`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14465f" />
          <stop offset="1" stopColor="#081d2a" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor={SIGNAL} stopOpacity="0.34" />
          <stop offset="1" stopColor={SIGNAL} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="56" fill={`url(#${id}-halo)`} />
      {children(paint)}
    </svg>
  );
}

const line = {
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/* ════════════ البنوك ════════════ */

const BANKS: Record<string, (p: Paint) => ReactNode> = {
  /* معلومات عامة — مصباحٌ فتيلُه نبضة */
  amma: ({ lit, deep }) => (
    <>
      <g stroke={SIGNAL} strokeWidth="3" opacity="0.7" {...line}>
        <path d="M60 6v7M28 18l5 5M92 18l-5 5M16 47h7M104 47h-7" />
      </g>
      <path
        d="M60 20c-17 0-29 12.8-29 28.4 0 10.2 5.2 16.6 10.2 22.3 3.2 3.6 5.2 7.3 5.2 11.7V86h27.2v-3.6c0-4.4 2-8.1 5.2-11.7C83.8 65 89 58.6 89 48.4 89 32.8 77 20 60 20Z"
        fill={deep}
        stroke={lit}
        strokeWidth="3"
      />
      <path d="M42 41c2.4-7.6 8.6-12.4 15.6-13" stroke={INK} strokeWidth="3" opacity="0.6" {...line} />
      <path d="M38 57h10l4.2-9.5 6.4 19 5-14.5 3 5.5H82" stroke={SIGNAL} strokeWidth="9" opacity="0.18" {...line} />
      <path d="M38 57h10l4.2-9.5 6.4 19 5-14.5 3 5.5H82" stroke={INK} strokeWidth="3.2" {...line} />
      <rect x="45" y="89" width="30" height="6.5" rx="3.25" fill={lit} />
      <rect x="47.5" y="98" width="25" height="6.5" rx="3.25" fill={lit} opacity="0.8" />
      <path d="M53 107h14l-2.6 5.4a3 3 0 0 1-2.7 1.6h-3.4a3 3 0 0 1-2.7-1.6Z" fill={lit} opacity="0.6" />
    </>
  ),

  /* الأنبياء والرسل — السفينةُ على الموج */
  anbiya: ({ lit, deep }) => (
    <>
      <path d={star8(96, 20, 6)} fill={INK} opacity="0.9" />
      <path d={star8(80, 12, 3)} fill={INK} opacity="0.55" />
      <path
        d="M6 90c9-6.5 18-6.5 27 0s18 6.5 27 0 18-6.5 27 0 18 6.5 27 0"
        stroke={SIGNAL}
        strokeWidth="3"
        opacity="0.45"
        {...line}
      />
      <path d="M34 70V52l26-15 26 15v18Z" fill={deep} stroke={lit} strokeWidth="3" {...line} />
      <path d="M30 54 60 36.5 90 54" stroke={INK} strokeWidth="3" opacity="0.85" {...line} />
      <rect x="53" y="54" width="14" height="11" rx="2.5" fill={lit} />
      <path d="M16 70h88l-10.5 18.5c-2.2 3.8-5.4 5.5-9.5 5.5H36c-4.1 0-7.3-1.7-9.5-5.5Z" fill={lit} />
      <path d="M23 79h74M28 86.5h64" stroke="#0a2534" strokeWidth="2.4" opacity="0.55" {...line} />
      <path
        d="M4 101c9.5-6.5 19-6.5 28.5 0s19 6.5 28.5 0 19-6.5 28.5 0 19 6.5 28.5 0"
        stroke={INK}
        strokeWidth="3"
        opacity="0.85"
        {...line}
      />
    </>
  ),

  /* الحديث الشريف — رقٌّ منشورٌ وختم */
  hadith: ({ lit, deep }) => (
    <>
      <rect x="30" y="30" width="60" height="60" fill={deep} stroke={lit} strokeWidth="2.4" />
      <g stroke={INK} strokeWidth="2.6" opacity="0.75" {...line}>
        <path d="M82 43H46M82 51.5H38M82 60H50M82 68.5H58" />
      </g>
      <rect x="22" y="21" width="76" height="11" rx="5.5" fill={lit} />
      <rect x="22" y="88" width="76" height="11" rx="5.5" fill={lit} />
      <circle cx="20" cy="26.5" r="4.5" fill={INK} />
      <circle cx="100" cy="26.5" r="4.5" fill={INK} />
      <circle cx="20" cy="93.5" r="4.5" fill={INK} />
      <circle cx="100" cy="93.5" r="4.5" fill={INK} />
      <path d={star8(44, 74, 10)} fill={lit} />
      <circle cx="44" cy="74" r="4.6" fill="#0a2534" />
    </>
  ),

  /* العبادات والأحكام — سجّادةٌ في محرابها قنديل */
  ibadat: ({ lit, deep }) => (
    <>
      <g stroke={lit} strokeWidth="2.2" opacity="0.8" {...line}>
        <path d="M36 9v6M43 9v6M50 9v6M57 9v6M64 9v6M71 9v6M78 9v6M85 9v6" />
        <path d="M36 105v6M43 105v6M50 105v6M57 105v6M64 105v6M71 105v6M78 105v6M85 105v6" />
      </g>
      <rect x="30" y="15" width="61" height="90" rx="4" fill={deep} stroke={lit} strokeWidth="3" />
      <rect x="37" y="22" width="47" height="76" rx="2" stroke={lit} strokeWidth="1.5" opacity="0.55" />
      <path
        d="M44.5 92V54c0-12.5 7-21 16-27 9 6 16 14.5 16 27v38Z"
        fill={SIGNAL}
        fillOpacity="0.16"
        stroke={lit}
        strokeWidth="2.6"
      />
      <path d="M60.5 30v9" stroke={INK} strokeWidth="1.8" />
      <path d="M55 39h11l-2.4 8.5h-6.2Z" fill={INK} />
      <circle cx="60.5" cy="51" r="5" fill={SIGNAL} opacity="0.35" />
      <path d={star8(60.5, 74, 8)} fill={lit} />
    </>
  ),

  /* معاني الكلمات — الضادُ وقلمُ القصب */
  lugha: ({ lit, deep }) => (
    <>
      <text
        x="50"
        y="100"
        textAnchor="middle"
        fontFamily="Thmanyah, system-ui, sans-serif"
        fontWeight="900"
        fontSize="70"
        fill={lit}
      >
        ض
      </text>
      <path d="M95 13 107 25 77 55l-16.5 4.5L65 43Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <path d="M65 43l12 12" stroke={lit} strokeWidth="2" opacity="0.7" />
      <path d="M60.5 59.5 68 52" stroke={INK} strokeWidth="1.6" {...line} />
      <path d="M96 84c0-4.4 4.6-10 4.6-10s4.6 5.6 4.6 10a4.6 4.6 0 0 1-9.2 0Z" fill={SIGNAL} />
    </>
  ),

  /* القرآن الكريم — مصحفٌ على رحْل، ونجمةٌ فوقه */
  quran: ({ lit, deep }) => (
    <>
      <path d={star8(60, 13, 7)} fill={INK} opacity="0.9" />
      <path d="M34 105 86 66M86 105 34 66" stroke={lit} strokeWidth="6.5" {...line} />
      <path d="M60 60c-10.5-6-22.5-8-35-6V24c12.5-2 24.5 0 35 6Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <path d="M60 60c10.5-6 22.5-8 35-6V24c-12.5-2-24.5 0-35 6Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <g stroke={INK} strokeWidth="2" opacity="0.6" {...line}>
        <path d="M54 36c-6-2.6-14-3.6-22-3M54 43.5c-6-2.6-14-3.6-22-3M54 51c-6-2.6-14-3.6-22-3" />
        <path d="M66 36c6-2.6 14-3.6 22-3M66 43.5c6-2.6 14-3.6 22-3M66 51c6-2.6 14-3.6 22-3" />
      </g>
      <path d="M60 30v30" stroke={lit} strokeWidth="2.6" />
      <circle cx="60" cy="85.5" r="5" fill={INK} />
    </>
  ),

  /* الصحابة رضي الله عنهم — نخلةٌ على الكثيب، وهلال */
  sahaba: ({ lit, deep }) => (
    <>
      <path d="M100 14a13 13 0 1 0 7 24 10.5 10.5 0 1 1-7-24Z" fill={INK} />
      <path d={star8(86, 22, 3.4)} fill={INK} opacity="0.8" />
      <path d="M0 98c20-12 42-12 62-4s40 7 58-1v27H0Z" fill={deep} />
      <path d="M0 106c22-8 46-8 66-2s38 5 54-1" stroke={lit} strokeWidth="2.4" opacity="0.6" {...line} />
      <path d="M60 99c2.4-19 1.6-37-3.6-53" stroke={lit} strokeWidth="6.5" {...line} />
      <g stroke="#0a2534" strokeWidth="1.6" opacity="0.7" {...line}>
        <path d="M56 90h7M56.5 80h6.5M56.5 70h6M56 60h5.5" />
      </g>
      <path d="M56 46c-10-9-25-9-36-0.5 11-2.2 24-0.5 36 0.5Z" fill={lit} />
      <path d="M56 46c10-10.5 27-10.5 38-2.2-12.5-2-25-1-38 2.2Z" fill={lit} />
      <path d="M56 46c-6-12.5-4-25 6.4-33.5-4.2 10.5-4.2 23-6.4 33.5Z" fill={lit} />
      <path d="M56 46c-14.5 0-25 8.4-29.5 21 6.4-8.4 17-14.7 29.5-21Z" fill={lit} opacity="0.85" />
      <path d="M56 46c14.5 0 25 8.4 29.5 21-6.4-8.4-17-14.7-29.5-21Z" fill={lit} opacity="0.85" />
      <circle cx="53" cy="51" r="2.6" fill={INK} />
      <circle cx="58.5" cy="52" r="2.6" fill={INK} />
      <circle cx="55.5" cy="56" r="2.6" fill={INK} />
    </>
  ),

  /* العلوم — دورقٌ يفور، وذرّةٌ فوقه */
  science: ({ lit, deep }) => (
    <>
      <g stroke={lit} strokeWidth="1.9" opacity="0.85">
        <ellipse cx="92" cy="28" rx="15" ry="5.2" />
        <ellipse cx="92" cy="28" rx="15" ry="5.2" transform="rotate(60 92 28)" />
        <ellipse cx="92" cy="28" rx="15" ry="5.2" transform="rotate(120 92 28)" />
      </g>
      <circle cx="92" cy="28" r="3.4" fill={INK} />
      <path
        d="M53 21h18M56 21v26L35 89c-3.2 7 1 14 9 14h34c8 0 12.2-7 9-14L66 47V21"
        fill={deep}
        stroke={lit}
        strokeWidth="3"
        {...line}
      />
      <path d="M42 75c6-3 12 3 18 0s12-3 18 0l9 17c2 5-1 10-7 10H40c-6 0-9-5-7-10Z" fill={lit} />
      <g fill={INK}>
        <circle cx="51" cy="87" r="3.2" />
        <circle cx="64" cy="93" r="2.6" />
        <circle cx="70" cy="84" r="1.8" />
        <circle cx="58" cy="65" r="2.2" opacity="0.8" />
        <circle cx="64" cy="56" r="1.6" opacity="0.7" />
      </g>
    </>
  ),

  /* السيرة النبوية — قبّةٌ ومئذنة */
  seerah: ({ lit, deep }) => (
    <>
      <path d="M6 106h108" stroke={lit} strokeWidth="2.4" opacity="0.6" {...line} />
      <path d="M54 33.5v-9" stroke={INK} strokeWidth="2" {...line} />
      <path d="M54 12a6 6 0 1 0 3.4 10.6A4.8 4.8 0 1 1 54 12Z" fill={INK} />
      <path d="M33 66c0-17 11-27.5 21-32 10 4.5 21 15 21 32Z" fill={lit} />
      <path d="M42 46c3-5 7-8.5 11-10.5" stroke={INK} strokeWidth="2.4" opacity="0.6" {...line} />
      <rect x="35" y="66" width="38" height="9" fill={deep} stroke={lit} strokeWidth="2.4" />
      <rect x="24" y="75" width="60" height="31" fill={deep} stroke={lit} strokeWidth="2.4" />
      <path d="M47 106V93.5c0-4 3.2-7.4 7-7.4s7 3.4 7 7.4V106Z" fill={SIGNAL} opacity="0.55" />
      <path d="M31 92v-6c0-2.4 1.6-4.2 3.6-4.2s3.6 1.8 3.6 4.2v6ZM70 92v-6c0-2.4 1.6-4.2 3.6-4.2s3.6 1.8 3.6 4.2v6Z" fill={SIGNAL} opacity="0.4" />
      <rect x="89" y="38" width="11" height="68" fill={deep} stroke={lit} strokeWidth="2.4" />
      <rect x="85.5" y="54" width="18" height="5.5" rx="1.5" fill={lit} />
      <path d="M89 38l5.5-13 5.5 13Z" fill={lit} />
      <path d="M94.5 25v-6" stroke={INK} strokeWidth="1.8" {...line} />
    </>
  ),

  /* التاريخ الإسلامي — ساعةٌ رملية بإطارٍ مزخرف */
  tarikh: ({ lit, deep }) => (
    <>
      <path d="M36 24v72M84 24v72" stroke={lit} strokeWidth="3" />
      <path
        d="M43 24c0 18 13.5 26 13.5 36S43 78 43 96h34c0-18-13.5-26-13.5-36S77 42 77 24Z"
        fill={deep}
        stroke={INK}
        strokeWidth="2"
        strokeOpacity="0.55"
      />
      <path d="M47 33h26c-2 8-7.5 14-13 18-5.5-4-11-10-13-18Z" fill={lit} />
      <path d="M60 52v28" stroke={SIGNAL} strokeWidth="1.6" strokeDasharray="2 3" />
      <path d="M45 94c2.2-10.5 8.5-15 15-15s12.8 4.5 15 15Z" fill={lit} />
      <rect x="28" y="15" width="64" height="9" rx="3.5" fill={lit} />
      <rect x="28" y="96" width="64" height="9" rx="3.5" fill={lit} />
      <path d={star8(60, 19.5, 3.2)} fill="#0a2534" />
      <path d={star8(60, 100.5, 3.2)} fill="#0a2534" />
      <circle cx="36" cy="12" r="3" fill={INK} />
      <circle cx="84" cy="12" r="3" fill={INK} />
      <circle cx="36" cy="108" r="3" fill={INK} />
      <circle cx="84" cy="108" r="3" fill={INK} />
    </>
  ),

  /* أعلام وكتب — كتبٌ مرصوصةٌ وريشة */
  ulum: ({ lit, deep }) => (
    <>
      <rect x="20" y="86" width="80" height="15" rx="3" fill={lit} />
      <path d="M30 86v15M90 86v15" stroke="#0a2534" strokeWidth="2.2" opacity="0.5" />
      <rect x="27" y="71" width="68" height="15" rx="3" fill={deep} stroke={lit} strokeWidth="2.4" />
      <path d="M38 71v15M84 71v15" stroke={lit} strokeWidth="1.8" opacity="0.6" />
      <path d="M70 86v10l3.5-3 3.5 3V86" fill={INK} />
      <rect x="23" y="56" width="70" height="15" rx="3" fill={lit} opacity="0.85" />
      <path d="M34 56v15M82 56v15" stroke="#0a2534" strokeWidth="2.2" opacity="0.5" />
      <path d="M86 12c-15 6.5-28 23.5-32 40.5C64.5 46 79.5 33.5 86 12Z" fill={INK} opacity="0.92" />
      <path d="M54 52.5 70 32" stroke="#0a2534" strokeWidth="1.6" opacity="0.6" {...line} />
    </>
  ),
};

/** ما لم يُرسم بعد — النجمةُ الثُّمانية وفي قلبها سؤال */
function fallback({ lit, deep }: Paint) {
  return (
    <>
      <path d={star8(60, 60, 40)} fill={deep} stroke={lit} strokeWidth="3" {...line} />
      <path d={star8(60, 60, 28)} stroke={lit} strokeWidth="1.5" opacity="0.5" {...line} />
      <text
        x="60"
        y="78"
        textAnchor="middle"
        fontFamily="Thmanyah, system-ui, sans-serif"
        fontWeight="900"
        fontSize="46"
        fill={lit}
      >
        ؟
      </text>
    </>
  );
}

export function BankArt({ id }: { id: string }) {
  return <Canvas>{BANKS[id] ?? fallback}</Canvas>;
}

/* ════════════ المراحل ════════════ */

const LEVELS: Record<string, (p: Paint) => ReactNode> = {
  /* ابتدائي — مكعّبا الحروف وقلم */
  primary: ({ lit, deep }) => (
    <>
      <rect x="18" y="56" width="40" height="40" rx="7" fill={lit} />
      <text x="38" y="88" textAnchor="middle" fontFamily="Thmanyah, system-ui, sans-serif" fontWeight="900" fontSize="30" fill="#0a2534">
        أ
      </text>
      <rect x="54" y="30" width="40" height="40" rx="7" fill={deep} stroke={lit} strokeWidth="2.6" />
      <text x="74" y="60" textAnchor="middle" fontFamily="Thmanyah, system-ui, sans-serif" fontWeight="900" fontSize="30" fill={SIGNAL}>
        ب
      </text>
      <path d="M100 74 106 80 82 104l-9 2.6 2.6-9Z" fill={INK} />
      <path d="M100 74 106 80" stroke={SIGNAL} strokeWidth="4" {...line} />
    </>
  ),

  /* متوسط — كتابٌ مفتوحٌ بعلامته */
  middle: ({ lit, deep }) => (
    <>
      <path d="M60 92c-12-7-26-9-41-7V35c15-2 29 0 41 7Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <path d="M60 92c12-7 26-9 41-7V35c-15-2-29 0-41 7Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <path d="M60 42v50" stroke={lit} strokeWidth="2.6" />
      <g stroke={INK} strokeWidth="2.2" opacity="0.6" {...line}>
        <path d="M53 52c-7-3-16-4-26-3.5M53 61c-7-3-16-4-26-3.5M53 70c-7-3-16-4-26-3.5" />
        <path d="M67 52c7-3 16-4 26-3.5M67 61c7-3 16-4 26-3.5" />
      </g>
      <path d="M80 37v24l5-4.5 5 4.5V36" fill={SIGNAL} />
    </>
  ),

  /* ثانوي — مثلّثُ القياس وفرجار */
  secondary: ({ lit, deep }) => (
    <>
      <path d="M18 100V38l62 62Z" fill={deep} stroke={lit} strokeWidth="3" {...line} />
      <path d="M29 89V64.5L53.5 89Z" stroke={lit} strokeWidth="2" opacity="0.6" {...line} />
      <g stroke={INK} strokeWidth="2" opacity="0.7">
        <path d="M18 48h6M18 58h4M18 68h6M18 78h4" />
      </g>
      <path d="M88 26 74 100M88 26 102 100" stroke={lit} strokeWidth="4" {...line} />
      <path d="M79.5 72h17" stroke={lit} strokeWidth="2.4" {...line} />
      <circle cx="88" cy="24" r="6" fill={INK} />
      <path d="M88 18v-6" stroke={INK} strokeWidth="2.6" {...line} />
    </>
  ),

  /* جامعي — قبّعةُ التخرّج */
  university: ({ lit, deep }) => (
    <>
      <path d="M34 60v20c0 6.5 11.6 12.5 26 12.5S86 86.5 86 80V60L60 71.5Z" fill={deep} stroke={lit} strokeWidth="2.6" {...line} />
      <path d="M60 28 12 49l48 21 48-21Z" fill={lit} />
      <path d="M60 28 12 49l48 21" stroke={INK} strokeWidth="1.6" opacity="0.5" {...line} />
      <path d="M60 49 96 56v22" stroke={INK} strokeWidth="2.2" {...line} />
      <path d="M92 78h8l2 13h-12Z" fill={INK} />
      <circle cx="60" cy="49" r="3.4" fill="#0a2534" />
    </>
  ),
};

export function LevelArt({ id }: { id: string }) {
  return <Canvas>{LEVELS[id] ?? fallback}</Canvas>;
}
