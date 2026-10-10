# Design System: نبضة (Nabda)
Status: APPROVED - extracted from existing code
Last updated: 2026-10-10

Source of truth in code: `client/src/index.css` (`@theme static` tokens, keyframes), `client/src/components/ui.tsx`, `game.tsx`, `icons.tsx`, `art.tsx`, `Shop.tsx`, `client/src/lib/cards.tsx`, `client/src/pages/console/shared.tsx`. Where this file and the older briefs (`DESIGN-BRIEF.md`, `CONSOLE-REDESIGN-BRIEF.md`) disagree, the code wins. The in-code design system is called "المِرقاب" (the monitor).

## Direction and language

- Product: live in-hall team quiz. Metaphor: a patient-monitor (ECG) device. Each team lives in a "lane" (`.lane`) where pulses run right to left; the remaining time is the live part of the lane, the elapsed part is a flat line.
- One identity color (`signal`, cyan). Green/amber/red are functional state colors only, never identity (comment in `index.css` above `--color-safe`).
- Arabic only. `client/index.html`: `<html lang="ar" dir="rtl" data-theme="dark">`. No i18n layer, no LTR UI.
- Two value sets of the same system, not two designs: `data-theme` on `<html>` is `dark` (default) or `light` (`[data-theme='light']` in `index.css`).
- Physical contexts: projector at 3 to 15 m (`/display`), one phone shared by 4 to 5 people (`/play`), laptops for organiser and owner (`/admin`, `/console`).

Confirmed product rules (from the owner, binding):
1. No hint or caption text in any UI screen.
2. No em dashes in any visible text.
3. No prose comments in newly written code.

State of compliance: visible strings contain no em dashes (all `—` found in `client/src` are inside comments). Existing code comments are long Arabic prose; that is legacy, rule 3 applies to new code only. Possible caption-like elements still in the UI are listed under "Decisions to confirm".

## Colors

All colors are semantic tokens in `@theme static` (`index.css`); `static` is required so Tailwind keeps tokens consumed only through `style=` or `color-mix`. Use as Tailwind utilities (`bg-surface`, `text-ink-2`, `border-line`) or `var(--color-*)`. Dark value / light value:

| token | dark | light | use |
|---|---|---|---|
| `--color-ground` | #0f1821 | #f6f8f9 | page background (`body`, `.boot`, wordmark knockout `--cut-bg`) |
| `--color-sunk` | #080e15 | #f0f5f6 | deepest well: lane floor, code input, elapsed portion, `Badge` mute |
| `--color-surface` | #16212c | #ffffff | cards, tiles (`.tile`, `Card`, `.opt`) |
| `--color-surface-2` | #1d2a36 | #fbfcfd | raised/hover surface, `.tile-sunk`, sidebar of console, rank rows |
| `--color-line-soft` / `--color-line` / `--color-line-2` | #182430 / #22303d / #2e4458 | #f2f5f6 / #e3eaec / #d8e0e3 | row divider / border / visible border (`shadow-[inset_0_0_0_1px_var(--color-line-2)]` is the standard outlined control) |
| `--color-ink` | #e4f0f8 | #0c1d21 | primary text |
| `--color-ink-2` | #aec2d0 | #3f5257 | secondary text, icon buttons |
| `--color-muted` | #8ba2b3 | #5b6e73 | tertiary text, labels |
| `--color-faint` | #4a6075 | #8a9aa0 | placeholders, disabled marks, `dead` lane; not for body text |
| `--color-signal` | #4ad5ff | #0891b2 | the one identity color: focus ring, selected, caret, lane in neutral use |
| `--color-signal-2` | #0c2e3d | #e7f3f6 | tint surface behind signal (hover of `MiniAction`, `Badge` signal) |
| `--color-on-signal` | #04222e | #ffffff | text on `bg-signal` (`Segmented` active) |
| `--color-signal-ink` | #8fe3ff | #0e7490 | signal used as text on tinted surface |
| `--color-action` / `--color-on-action` | #4ad5ff / #04222e | #0e7490 / #ffffff | primary button background and its text (darker in light for contrast) |
| `--color-safe` / `-2` / `-ink` | #22c55e / #0a2a19 / #4ade80 | #2e7d46 / #eaf4ee / #256b3a | success, correct answer, time above 10 s |
| `--color-warn` / `-2` / `-ink` | #f5a524 / #2c2008 / #fbbf24 | #92600a / #fbf0dd / #92600a | caution, time 5 to 10 s, medium difficulty |
| `--color-danger` / `-2` / `-ink` | #ff3b30 / #2a0d0c / #ff6b63 | #b3261e / #fbeceb / #b3261e | error, wrong answer, time under 5 s, destructive buttons |
| `--color-frost` | #5fb0ff | #0f5fb0 | freeze card state (status, not identity) |
| `--color-gold` | #e8bf5a | #8a6100 | double-points state (status, not identity) |
| `--color-opt-1..4` | #d4f6ff #6adcff #28a6dc #1878a3 | #7ad0e8 #22a6c9 #0d7490 #084a62 | the four answer slots, four depths of cyan, fixed by position not meaning |

Rules:
- The `-2` token is the dim surface for a state, `-ink` is the readable text color on it. Use `bg-danger-2 text-danger-ink`, not `text-danger` on `bg-danger-2` (contrast drops to about 3.7:1; this is documented in `index.css`).
- Team colors: there are none. Teams are distinguished by name and rank, not by hue. Do not introduce per-team colors without a decision.
- Pulse states: `Level = 'safe' | 'warn' | 'danger' | 'dead'` in `ui.tsx`. Thresholds in seconds, not percent: `WARN_MS = 10000`, `DANGER_MS = 5000` (`dangerLevel`). `dead` (flatline) maps to `--color-faint`. `levelVar` maps level to token; `stateStyle(level, ms)` sets `--state` and `--beat` on an element, and `.ink-state`, `.bg-state`, `.lane-*` read `--state`.
- Freeze and double are row-surface states (`.frosted`, `.gilded`), never lane colors, because the lane must not lie about time.
- Tones for toasts and card chips: `Tone = 'signal' | 'safe' | 'danger' | 'frost' | 'gold'` (`ui.tsx`). Console badges use a separate `Tone = 'safe' | 'warn' | 'danger' | 'signal' | 'mute'` (`console/shared.tsx`, `Badge`).
- Difficulty colors: level 1 safe, 2 warn, 3 danger (`LEVELS` in `console/shared.tsx`).
- Answer reveal: `.opt-right` uses safe border and glow; `.opt-wrong` and `.opt-mute` fade the rest.
- Console exception: the owner rail `.rail` is the literal `#0e7490` with white text (see Inconsistencies).
- Contrast: the code states these measured values in comments: light `signal-ink` on light is 5.4:1; white on light cyan would be 3.7:1 (hence `--color-action` is darker in light mode). No automated contrast test exists.

## Typography

- Font: Thmanyah (خط ثمانية), local, five weights 300/400/500/700/900 via `@font-face` in `index.css`, files `client/public/fonts/thmanyahsans-*.otf`, `font-display: swap`. Token `--font-sans: 'Thmanyah', system-ui, sans-serif`. No web fonts from the network (the hall may block them).
- Weights in use (counts in `client/src`): `font-black` 125, `font-bold` 113, `font-medium` 71, `font-light` 8. Black (900) is the default for buttons, numbers, headings, and the wordmark; `font-normal`/`semibold` are not used.
- Digits: Western digits with `tabular-nums`, via `.tnum` (`index.css`) on every changing number (clock, score, counts). Time format `formatTime` in `ui.tsx`: one decimal under 100 s, integer from 100 s. `arabizeDigits` in `console/shared.tsx` converts digits for question text in the owner console. Copy that mentions numbers (e.g. in `lib/cards.tsx`) uses Arabic-Indic digits (`×٢`).
- Code input: `.gate-code` 1.375rem black with `letter-spacing: 0.4em` and a compensating `text-indent`.
- LTR islands inside RTL text carry `dir="ltr"` (e.g. `console/Banks.tsx` bank ids with `font-mono`).
- Line height: wordmark `line-height: 1`; hero 1.25; body copy 1.7 to 1.85. Arabic body never below 1.7.
- Scale (what is actually used; most frequent first, Tailwind arbitrary pixel values dominate):
  - Dense UI text: `text-[13px]` (38), `text-[12.5px]` (33), `text-[14px]` (32), `text-[13.5px]` (24), `text-sm` (23), `text-[11px]` (20), `text-xs` (18), `text-[15px]` (18), `text-[12px]` (16).
  - Headings and numbers: `text-[17px]`, `text-[19px]`, `text-2xl`, `text-[28px]`, `text-[34px]`, `text-5xl`, `text-[50px]`.
  - Projector/hero: `text-[84px]`, `text-[132px]`, `text-[150px]` on `/display` (`Display.tsx` lines 398, 602, 740), `.hero-line` `clamp(1.75rem, 7vw, 2.75rem)`, `.scene-readout` `clamp(2rem, 9vw, 2.75rem)`, toasts on display `clamp(18px, 2.4vw, 42px)`.
  - There is no fixed type scale; see Inconsistencies.
- Wordmark: `Wordmark` in `ui.tsx` (`.word`, `.word-txt`, `.word-sig`): text "نبضة" black with a knocked-out stroke in `--cut-bg`, the ECG trace is the baseline and only the R-peak rises above the letters. Short mark: `PulseMark`. Both animate via `.word-beat` (lub-dub, 1.6 s default, uses `--beat` when present).

## Spacing

No custom spacing tokens; Tailwind v4 default 4 px step is used (`gap-1.5`, `gap-2.5`, `px-3.5`, `py-2.5`, `p-5`, `px-6`). Fixed sizes seen repeatedly:
- Touch targets: primary phone buttons `h-14` (56 px), code input and go button `4rem` (64 px, `.gate-code`, `.gate-go`), `IconButton` `size-9` or `size-8`, menu chips `CHIP_BTN = h-9`.
- Answer card minimum on phone `min-h-[118px]` (`Play.tsx` line 762).
- Page paddings on organiser: `px-3 py-3 sm:px-6 sm:py-4`, grid gap `gap-2.5 sm:gap-4`.
- Projector uses viewport units for spacing (`px-[2vw]`, `gap-[1vw]`, `bottom-[6vh]`) and fixed pixel columns for rows.
- Safe areas: `env(safe-area-inset-bottom)` in the Home sections (`.home-hero`, `.home-sec`).

## Shape

- Radius: exactly two tokens. `--radius-chip: 8px` (`rounded-chip`, 102 uses: buttons, inputs, badges, lane) and `--radius-card: 14px` (`rounded-card`, 27 uses: tiles, answer cards, modals, toasts). `rounded-full` only for dots, avatars, scroll thumb.
- Borders are drawn as inset shadows, not `border`, so layout does not shift: `shadow-[inset_0_0_0_1px_var(--color-line-2)]` (26), `...var(--color-line)` (22), `...1.5px var(--color-signal)` focus/selected (14). `.tile` = surface + inset 1 px `line`; `.tile-sunk` = surface-2 + same.
- Answer cards `.opt`: 2 px inset border in the slot color at 85 percent; selected `.opt-on` adds a 14 percent tint.
- Elevation: flat by design. The only real drop shadows are on floating layers (menu `0_18px_40px_-16px`, Play toast `0_10px_30px_-12px`, `.modal-card`, owner sidebar `shadow-2xl` when floating). Glow is used for state only (`.opt-right`, `.alarm`, lane head `--glow`, `.gate-code:focus`).
- Ambient light: `body::before` fixed radial cyan glow at 7 percent at the top in dark mode; hidden in light mode.
- Focus: global `:focus-visible { outline: 2px solid var(--color-signal); outline-offset: 2px }`.
- Selection color: signal at 30 percent.

## Motion and the heartbeat

Rule: periodic motion takes its tempo from the pulse. Motion must carry information; decorative motion appears only in hero and entry screens. `prefers-reduced-motion: reduce` disables the whole list at the end of `index.css`; JS reads it through `prefersReducedMotion()` in `ui.tsx`.

- `--beat`: seconds per heartbeat, `beatSeconds(ms) = 0.42 + 1.78 * clamp(ms/30000)`, continuous from about 2.2 s at round start to 0.42 s at zero. `stateStyle` rounds it to 0.25 s and floors at 0.5 s so CSS animations are not re-timed 60 times a second. `BAR_FULL_MS = 30000` must match server `startSeconds`.
- Lane (`Lane` in `game.tsx`, `.lane`, `.lane-run`, `.lane-cover`, `.lane-line`, `.lane-flat`): trace mask `client/public/trace.svg` repeated; the elapsed part is a cover moved with `transform` (never `width`) so eight live lanes hold 60 fps. `--tile`, `--amp`, `--glow`, `--line` tune size. `.lane-drift` is constant-speed decorative flow for hero only.
- Danger: `.alarm` (red vignette on screen edges, per `--beat`), `.alarm-channel` (per-channel on display), `.beat` (scale 1.04), `.beat-danger` (double lub-dub, up to 1.13, ends in rest). `.blink` live indicator (stepped).
- Entrances: `.rise-in` (0.56 s, translateY 10), `.thump`, `.veil-in`, `.veil-out`, `.float-up`, `.rise-bar`, `.bar` and `.bar-fill` (clip-path growth), `.ecg-draw`, `.boot` (1.6 s once per session).
- Home practice and lab: `.demo-jolt` (`is-up`, `is-down`, `is-hold`; score change floating from the practice lane), `.home-try-dot::after` with `@keyframes try-ping` (2.2 s ping on the practice call-to-action dot). Both are in the reduced-motion list.
- Timing vars: `--t-tap: 0.16s`, `--t-state: 0.32s`, `--t-enter: 0.56s`; easing `--ease-monitor: cubic-bezier(0.2, 0.7, 0.3, 1)`.
- Press feedback: `.tap` (scale 0.97, `touch-action: manipulation`); `Button` `active:scale-[0.97]`; `IconButton` `active:scale-90`. Vibration is never relied on (not on iOS).
- Curtain (`Curtain` in `game.tsx`, `.curtain-*`): full-screen result panel. Enter styles `drop` (display) and `bloom` (phone, with `.curtain-flash` in `--tone`). Exit is always the same: a trace wave (`.curtain-cut`) cuts the panel in two halves that slide away. Constants `CURTAIN_OUT_MS = 1480`, `CURTAIN_OPEN_MS = 820`. Stacking: `.curtain-set` z 60, `.curtain-front` z 70, `.boot` z 80.
- Answer reveal: `.opt-right` nudge twice plus a green trace across the card; `.opt-wrong` shrink; others `.opt-mute`.
- Card state skins: `.frost`/`.frosted` (ice growth and breathing), `.gilded`/`.halo` (gold), `.skin-frost`, `.skin-gold` (sweep), `.skin-time` (wave).
- Toasts: `.toast-note` drops in, lifts out, with `.toast-bar` draining as lifetime indicator; tone color injected via `--tint`.
- Z-index layers in use: lane content below; scroll thumb `z-40`; menu `z-50`; curtain 60/70; Display toasts `z-[60]`; Play toasts `z-[70]`; boot 80.

## Components

Shared atoms live in `client/src/components/ui.tsx`; game pieces in `game.tsx`; owner console pieces in `client/src/pages/console/shared.tsx`.

| name | path | variants | when to use |
|---|---|---|---|
| `Button` | `components/ui.tsx` | `variant`: primary (bg-action), ghost (outlined), danger (red outline); `size`: sm, md, lg | every text action; disabled is opacity 40 |
| `IconButton` | `components/ui.tsx` | `size` 8 or 9; `danger` | icon-only actions; explicit `size-*` classes (do not pass size via className) |
| `Card` | `components/ui.tsx` | none (`.tile p-5`) | generic container |
| `.tile`, `.tile-sunk` | `index.css` | surface / surface-2 | any numeric or content block |
| `Input`, `AutoTextarea`, `Field` | `components/ui.tsx` | none | forms |
| `Select`, `Segmented`, `CheckOption`, `CheckAll`, `MiniAction` | `components/ui.tsx` | `Segmented` columns follow option count, 2 columns on phone | choice controls |
| `Chip` | `components/ui.tsx` | `signal` (letter-spaced signal value) | label+value data pill |
| `ErrorNote` | `components/ui.tsx` | none | inline error (danger-2 surface) |
| `Menu` | `components/ui.tsx` | `MenuAction[]`; trigger uses `CHIP_BTN` | overflow actions on organiser |
| `HoldButton` | `components/ui.tsx` | press-and-hold with `.hold-fill` | destructive or irreversible actions |
| `toast()` / `Toasts` | `components/ui.tsx` | `Tone` signal, safe, danger, frost, gold; optional icon and note | transient notices; single mount in `App.tsx` |
| `Scrollbar`, `.no-bar`, `.scroll-thumb` | `components/ui.tsx`, `index.css` | page or box | replaces native scrollbar with a floating thread on the left edge |
| `MuteButton`, `ThemeButton` | `components/ui.tsx` | n/a | sound toggle; theme toggle (currently not mounted anywhere, see Inconsistencies) |
| `Wordmark`, `PulseMark` | `components/ui.tsx` | `className` sets size | brand |
| `Flag` | `components/ui.tsx` | local SVG from `/flags/{code}.svg` | flag questions and country banks |
| `FormPage`, `Credit`, `useQr` | `components/ui.tsx` | n/a | form shell, footer credit, QR in theme colors |
| `Lane` | `components/game.tsx` | level safe/warn/danger/dead; bare; drift | the time bar of every entity |
| `Curtain`, `useLinger`, `CountdownGate`, `Countdown`, `PausedMark` | `components/game.tsx` | drop, bloom | round transitions and states |
| `ResultBars`, `Standings`, `RoundHistory`, `HistoryModal`, `TheEnd`, `Confetti`, `RollingNumber`, `useReorderSlide` | `components/game.tsx` | n/a | results, podium, rank animation |
| `Modal` | `components/game.tsx` and `pages/console/shared.tsx` | two separate implementations | dialogs (see Inconsistencies) |
| `CommentCard`, `ReviewList` | `components/game.tsx` | n/a | player feedback and question review |
| `Shop`, `FreezeOverlay` | `components/Shop.tsx` | per card `CARD_LOOK` | between-round card store |
| `CARD_LOOK`, `ATTACK_DONE`, `PICK_LABEL` | `lib/cards.tsx` | ten cards: time, truce, shield, revive, fort, mirror, blackout, freeze, steal, double; each has Icon, `skin`, `ink`, `tone` | single source for card appearance |
| `BankArt`, `LevelArt` | `components/art.tsx` | `.art-grid`, `.art-tile`, `.is-on`, `.is-large`, `.is-compact` | picture cards for banks and stages |
| `Badge`, `Dot`, `Rate`, `Stat`, `StatRow`, `Panel`, `Grid`, `Row`, `Cell`, `Empty`, `Loading`, `More`, `DateRange`, `QuestionEditor` | `pages/console/shared.tsx` | `Badge` tones safe, warn, danger, signal, mute | owner console pages |
| `.opt` answer card | `index.css` | `--opt` slot color; `.opt-on`, `.opt-right`, `.opt-wrong`, `.opt-mute` | the four answers on `/play` |
| `.gate`, `.gate-code`, `.gate-go` | `index.css` | n/a | room code entry on Home |
| `.home-bar`, `.home-link`, `.home-ghost`, `.home-make` | `index.css`, `pages/Home.tsx` | n/a | sticky header on `/`; always shows «أنشئ غرفة» |
| `.doors`, `.door-join`, `.door-make` (primary), `.door-show`, `.home-try`, `.home-try-dot` | `index.css`, `pages/Home.tsx` | `.door-make` primary; the join door holds the `.gate` code field | three entry doors in the hero plus the «جرّب جولة» button |
| `.demo-*` (board, row, clock, opt, q, flash, jolt, result, medal, start...) | `index.css`, `pages/home/Practice.tsx`, `pages/home/demo.ts` | n/a | section ٠١ «جرّب جولة»: client-only practice round, no socket |
| `.lab-*` (stage, deck, card, side, stats, read, time...) | `index.css`, `pages/home/CardLab.tsx` | `.lab-dark` | section ٠٢ «مختبر البطاقات»: card demo using `CARD_LOOK` |
| `.hall-*` (screen, phone, opt, code, slider, art, n) | `index.css`, `pages/Home.tsx` | n/a | section ٠٣ «القاعة»: projector and phone mock |
| `RouteBoundary`, lazy routes | `App.tsx` | n/a | recovery screen (Wordmark plus «أعد المحاولة» `Button`); Play, Display, Admin, Owner are `lazy()` with one reload retry (`reloadOnce`, key `nabda:chunk-reload`); Home is eager |
| Removed | n/a | n/a | `.hero`, `.hero-cue`, `.reveal`, `.rule`, `.scene`, `.rank-box`, `.seat`, `.gate-note` no longer exist |
| `.rail`, `.rail-item`, `.rail-mark`, `.side-row`, `.console-body`, `.modal-veil`, `.modal-card`, `.create-*` | `index.css` | `data-on='true'` for selected | owner console shell and create-room flow |

## Layout and breakpoints

Tailwind default breakpoints in use (counts of prefixed utilities): `sm:` 91 (640 px, the main phone/desktop switch), `lg:` 15 (1024 px, console floating drawer), `md:` 6, `xl:` 7 (1280 px). `index.css` media queries at 640, 1024, and max 640 / 1240. `useWide('(min-width: 640px)')` in `ui.tsx` switches structure (not size) in JS so hidden duplicates do not keep animating.

- `/` Home (`pages/Home.tsx`, parts in `pages/home/`): content max `max-w-6xl`. Sticky `.home-bar` header always shows «أنشئ غرفة». `.home-hero` holds three `.doors`: join code gate (`.gate`), `.door-make` (primary), `.door-show`; plus the `.home-try` button. Then sections ٠١ «جرّب جولة» (`#try`, `.demo-*`, client-only practice round), ٠٢ «مختبر البطاقات» (`#cards`, `.lab-*`), ٠٣ «القاعة» (`#hall`, `.hall-*`); footer `h-14`. `.hero-rail` and `.hero-line` still exist in `index.css`. Always dark.
- `/play` team phone (`pages/Play.tsx`): single column, one hand, target width 375 px, viewport locked (`maximum-scale=1, user-scalable=no`). Buttons `h-14`, answer cards min 118 px, four answers laid out per option count (2 columns on phone). Toasts `max-w-md` at bottom. Always dark in code.
- `/display` projector (`pages/Display.tsx`): target 1920x1080, nothing under 28 px for key content in the original brief; rows are a fixed grid `grid-cols-[64px_340px_minmax(0,1fr)_168px_148px]`, height 86 to 128 px, up to 8 teams with live lanes; type up to 150 px; spacing in `vw`/`vh`. Always dark. Has a phone branch (`phone ? 'text-[56px]' : 'text-[132px]'`, line 602).
- `/admin` organiser (`pages/Admin.tsx`): laptop first but phone usable; container `max-w-[1560px]`, from `xl` a two-column grid `minmax(0,1fr) 432px`; team rows are grid `30px minmax(120px,210px) 104px 88px minmax(0,1fr) auto`; dense text 12 to 14 px. Dark in code.
- `/console` owner (`pages/Owner.tsx`, `pages/console/*`): light theme. Three vertical bands from the right in RTL: rail (about 64 px, `.rail`, teal `#0e7490`), sidebar `w-[264px]` (`bg-surface-2`, sticky, becomes a floating drawer under `lg` at `start-16`), content `.console-body` `max-w-[1180px]`. Each page starts with a row of four stat tiles (`StatRow`, `Stat`), then content panels. Login card `w-[380px]`.

## RTL rules

- Document is `dir="rtl"`. Reading direction drives motion: pulses and reveals enter from the right (`mask-position: right center`, `clip-path: inset(0 0 0 100%)`, `translateX(-100vw)` for the cut head).
- Prefer logical properties: `inset-inline-*`, `border-e`, `start-16`, `text-start`, `text-end`, `margin-inline`, `padding-inline` (used in `index.css` and console). New code must not add `left-*`, `right-*`, `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`.
- Physical offsets are used where they are intentional and mirror the physical screen: scroll thumb on the left edge (`ui.tsx` line 358), `.lane-cover` head at `right`, `.word-sig`. Everything else is debt (see Inconsistencies).
- Text input of codes, ids, URLs and Latin tokens use `dir="ltr"` locally.
- Icons that imply direction (`ArrowIcon`, `ChevronIcon`) must be checked in RTL when reused.

## Icons and imagery

- Icons: hand-written inline SVG in `components/icons.tsx` (about 55 exports named `XxxIcon`). Base `Icon`: 24x24 viewBox, `stroke="currentColor"`, `strokeWidth 2`, round caps and joins, `aria-hidden`, default `size = 20`, accept `SVGProps`. Color is inherited from text color, never hard-coded. No icon library. No emoji in UI.
- Domain icons: pulse (`PulseIcon`, `FlatlineIcon`, `HeartIcon`), cards (`TimePlusIcon`, `HourglassIcon`, `ShieldIcon`, `ReviveIcon`, `FortIcon`, `MirrorIcon`, `EyeOffIcon`, `SnowflakeIcon`, `StealIcon`, `DoubleIcon`).
- Brand: `public/favicon.svg` (cyan `#4ad5ff` rounded square with dark `#04222e` ECG), `favicon-*.png`, `icon-192/512.png`, `apple-touch-icon.png`, `og.png`, `og-play.png`, `site.webmanifest`. `public/brand/medad-cream.png` and `medad-teal.png` are the Medad footer logo, switched by `.medad-on-dark` / `.medad-on-light` with `data-theme`. `public/trace.svg` and `trace-sm.svg` are the pulse masks used by lane, curtain, boot and answer reveal.
- Art: `public/art/*.png`, 256x256, Fluent Emoji 3D (MIT, `public/art/LICENSE-fluentui-emoji.txt`) tinted to the Nabda palette; rebuilt with `scripts/art/tint.py` and `scripts/art/compose.mjs`. Served locally (hall networks may block external hosts). `art.tsx` bumps `ART_VERSION` (currently 8) as a cache-buster; a bank without an image falls back to `other.png`. Images are decorative (`alt=""`).
- Flags: `public/flags/*.svg` (flag-icons, license file included) rendered by `Flag` at 4:3.
- Fonts: see Typography.

## Accessibility rules

- Contrast: text on state surfaces uses `-ink` tokens, never the raw state color (documented 3.7:1 failure). Text on primary uses `--color-on-action` or `--color-on-signal`. `--color-faint` is not for readable text.
- Lane color is never the only signal: numeric time is always shown next to the lane, and danger adds beat/alarm motion. Answer slots are told apart by position and by depth of one hue; correct/wrong is also shown by motion and border weight, not only color.
- Focus: global `:focus-visible` signal outline; custom controls must keep it (`.rail-item:focus-visible` overrides to white on the teal rail).
- Cursor: pointer for enabled buttons/links/summary, `not-allowed` for disabled (`index.css`).
- Touch: `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`, targets at least 56 px on `/play`.
- Reduced motion: honored globally in CSS and in JS (`prefersReducedMotion`); `Curtain` and `.beat-danger` degrade to static.
- Icon-only buttons carry `title` (see `MuteButton`, `ThemeButton`); decorative SVG and art are `aria-hidden` or `alt=""`.
- Viewport meta forbids pinch zoom (`user-scalable=no`, `maximum-scale=1`); this is deliberate for the game screens but blocks zoom on the owner console too.
- Language: `lang="ar"`.

## Architecture constraints

- Stack: React 19, Vite, Tailwind v4 (`@import 'tailwindcss'`, `@theme static`), react-router, socket.io-client. Lint: oxlint. No UI kit, no animation library, no icon library, no chart library (charts are hand-drawn). New libraries need approval.
- Folders: `client/src/pages` (route pages; `console/` for owner sub-pages), `client/src/components` (`ui.tsx` atoms, `game.tsx` game pieces, `icons.tsx`, `art.tsx`, `Shop.tsx`), `client/src/lib` (`socket.ts`, `clock.ts`, `session.ts`, `sound.ts`, `types.ts`, `cards.tsx`), assets in `client/public`.
- Data access: only through `lib/socket.ts` (socket events) and owner REST `/api/console/*`. The browser renders and interpolates; the server owns time and score. `lib/clock.ts` smooths the server clock.
- Styling approach: Tailwind utilities with semantic tokens in JSX, plus named component classes in `index.css` for effects that need pseudo-elements, masks or keyframes. Dynamic values pass through CSS variables (`--state`, `--beat`, `--opt`, `--tone`, `--tint`, `--cols`).
- Performance: animate only `transform` and `opacity`; keep eight live lanes at 60 fps; do not mount hidden duplicates of lane trees (use `useWide`).
- Naming: tokens are semantic (`--color-signal`, not `--color-cyan`); component classes are short nouns (`.lane`, `.opt`, `.tile`, `.curtain-*`); state via `is-on`, `is-in`, `data-on`.
- Theme per surface (from the `useTheme` calls): Home, Play, Display, Admin call `useTheme('dark')`; Owner and its login call `useTheme('light')`. `useTheme('user')` exists but no screen uses it.
- Build: `client/dist`, build stamp `build.txt` makes stale clients reload between rounds.

## Inconsistencies / debt

1. Hard-coded colors bypassing tokens:
   - `client/src/index.css` `.rail` (about line 2000), `.rail-item`, `.rail-mark`: `#0e7490`, `#fff`, `rgb(255 255 255 / x)`; justified in a comment (rail is a tinted surface inside a light page) but it duplicates `--color-action` light value and ignores the theme.
   - `client/src/index.css`: `rgb(255 59 48 / ...)` in `@keyframes alarm-vignette` and `alarm-inset` duplicates `--color-danger` dark; `.skin-gold` sweep uses `rgb(255 255 255 / 0.09)`; shadows use `rgb(0 0 0 / x)` and `#000`.
   - `client/index.html` `theme-color #060B12` and `client/public/site.webmanifest` `background_color`/`theme_color #060B12`, but `--color-ground` dark is `#0f1821` and `useTheme` writes `#0F1821`/`#F6F8F9` at runtime. The old value is a leftover from before the surface was raised.
   - `client/src/pages/Owner.tsx:1016` `style={{ background: '#0c1d21' }}`.
   - `client/src/pages/Display.tsx:181` QR colors `#0f1821ff` / `#e4f0f8ff` duplicate ground and ink dark values (needed as literals for the QR lib).
   - `client/src/pages/Play.tsx:589` shadow `0_10px_30px_-12px_#000`.
   - `client/src/components/ui.tsx:774` menu shadow `rgb(0_0_0/0.5)`; `ui.tsx:1261` Flag shadow `rgb(255_255_255_/_0.14)`.
   - `client/src/pages/console/shared.tsx:261` `stroke="#fff"`, `:492` `rgba(12,29,33,.45)`, `:503` `rgba(12,29,33,.25)` (modal veil and shadow).
   - `text-white` / `bg-white/20` / `bg-black/25` / `bg-black/55`: `Owner.tsx:522,648,892,953,954,1015,1061,1083`, `console/Banks.tsx:852,873`, `console/Pending.tsx:416,417,547,548`, `console/Intake.tsx:114,115,128,129`, `console/RoomsAndComments.tsx:283`, `console/Dashboard.tsx:540`, `Admin.tsx:534`, `components/game.tsx:439`. Should be `text-on-action`/`text-on-signal` or a scrim token.
2. Two different `Modal` components: `components/game.tsx:425` and `pages/console/shared.tsx:461`. Two `Tone` types with different members: `components/ui.tsx:903` and `pages/console/shared.tsx` (about line 156).
3. No type scale: about 45 distinct `text-[Npx]` values including half pixels (`12.5`, `13.5`, `14.5`, `11.5`, `10.5`) mixed with `text-xs/sm/lg`. Dense UI should be consolidated to a small set.
4. Stale comment in `ui.tsx` above `useTheme` says the organiser panel is always light; code calls `useTheme('dark')` in `Admin.tsx:170`. `ThemeButton` and `useTheme('user')` are implemented but unused, so the player theme choice (`nabda:theme` in localStorage) can never be set from the UI.
5. Physical-direction utilities in an RTL app: `components/game.tsx:350` and `:833` `mr-auto`, `game.tsx:1060` `pr-9`, `ui.tsx:774` `left-0`, `ui.tsx:1136` `mr-auto`, `pages/Display.tsx:557` `border-r pr-5`, `pages/Play.tsx:765` `left-3`, `pages/console/Banks.tsx:697` `mr-2`, `:625` `text-right`, `pages/Owner.tsx:997` `text-right`, `pages/console/RoomsAndComments.tsx:456` `right-3`, `components/Shop.tsx:264-284` `left-*`/`right-*` (decorative corners, mirror-insensitive). In RTL `mr-auto` pushes toward the visual left, which is the end side; the result is correct today but fragile.
6. Radius outside the two tokens: `rounded-[2px]` (1), `rounded-[3px]` (4), `rounded-[4px]` (1, Flag), `rounded-[6px]` (1), `rounded-t-[4px]` (1).
7. `font-mono` used in `Owner.tsx:997` and `console/Banks.tsx:625` with no mono font defined in `@theme`; falls back to the system monospace.
8. `index.html` meta viewport disables zoom for the whole app including the owner console.
9. `DESIGN-BRIEF.md` is outdated: it mentions `nibras-logo.png`, `TimeBar`, `.ecg-track` and asks for Nibras branding removal; none exist in code now. Treat it as history. Still valid from it: no new libraries, 60 fps with eight lanes, 375 px and 1920x1080 targets, respect reduced motion, option colors fixed by position, only `client/src` plus `client/public` for design work.
10. `CONSOLE-REDESIGN-BRIEF.md` is partly superseded: content max width is 1180 px (brief says about 1280), rail is teal `#0e7490` (brief only says family of the identity color); still relevant: three vertical bands, four stat tiles at the top of every page, counts not colored bars in tables, content uses real data.
11. The ban on em dashes in visible text holds; existing code comments still contain many em dashes and long Arabic prose (legacy; rule 3 applies to new code).

Total distinct inconsistency items: 11 (items 1 to 3 and 5 contain multiple locations).

## Decisions to confirm

1. Team identity: should teams get per-team colors or icons? Today there are none (identity is name and rank only).
2. Should `ThemeButton` be mounted on `/play` (as the `useTheme('user')` design intends), or should the unused toggle code and the `nabda:theme` key be removed?
3. Is the Admin (organiser) panel dark (current code) or light (older comment)? This file documents dark.
4. Caption/hint rule: the UI has elements that may count as captions: `hint` prop of `CheckOption` (`ui.tsx`), `note` option of `toast()`, `Credit`. Which are allowed? The rule as confirmed bans hint/caption text on any screen, so these should be reviewed screen by screen.
5. Type scale: adopt a fixed scale (suggest consolidating dense text to 12, 13, 14, 16 px plus the heading/projector sizes) and migrate the half-pixel sizes?
6. Replace the hard-coded `#0e7490` rail and `text-white` usages with tokens (suggest `--color-rail`, `--color-on-rail`, `--color-scrim`)?
7. Update `theme-color` in `index.html` and `site.webmanifest` from `#060B12` to `#0f1821`?
8. Allow pinch zoom on `/console` and `/admin` (viewport meta is global today)?
9. Should the two `Modal` implementations be merged into one?
10. Add a mono font token, or remove `font-mono`?
11. Does the card effect line in the card lab (`CARD_LOOK.effect` in `lib/cards.tsx`, shown by `.lab-*`) count as caption text under the no-hint rule?

## Change log

- 2026-10-10 (update): Landing page rewrite recorded (home-bar, three doors, practice `.demo-*`, card lab `.lab-*`, hall `.hall-*`); removed classes listed; App.tsx lazy routes and `RouteBoundary`; motion list gains `.demo-jolt` and `try-ping`; decision 11 added.
- 2026-10-10: First version. Extracted from `client/src/index.css`, `components/*`, `lib/cards.tsx`, `pages/*`, `pages/console/*`, `client/index.html`, `client/public`. Status APPROVED as a description of shipped UI by instruction of the owner; the open items above are not approved changes.
