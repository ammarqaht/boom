import { useEffect, useState } from 'react';
import {
  type Api,
  type Col,
  Badge,
  Cell,
  Dot,
  Empty,
  Grid,
  Loading,
  Modal,
  More,
  Panel,
  Rate,
  Row,
  Stat,
  StatRow,
  day,
  say,
  span,
  stamp,
  unit,
} from './shared';
import { StarIcon } from '../../components/icons';

/**
 * اللوحة الرئيسية — ما يُعرف بلمحة بصر.
 *
 * وترتيبها مقصود: تحيّةٌ تقول ما حال المسابقة اليوم، ثم أربعةُ أرقامٍ تُقرأ
 * بنظرة، ثم نداءٌ واحدٌ لأقرب عملٍ ينتظر، ثم النشاط اليوميّ لأنه يقول
 * «هل تُلعب؟»، ثم ما يحتاج إصلاحاً، ثم ما جرى أخيراً.
 *
 * من أعلى إلى أسفل: حالٌ، ثم عملٌ، ثم اتجاهٌ، ثم سجلّ.
 */

type Day = { at: number; rooms: number; players: number };

type BankRow = {
  id: string;
  name: string;
  total: number;
  levels: number[];
  seen: number;
  reports: number;
  rate: number | null;
};

type Worst = {
  id: string;
  bank: string;
  bankName?: string;
  level: number;
  text: string;
  shown: number;
  rate: number | null;
  reports: number;
};

type Room = {
  code: string;
  name: string;
  createdAt: number;
  players: number;
  rounds: number;
  playedMs: number | null;
  status: string;
};

type Comment = {
  id: number;
  stars: number | null;
  note: string | null;
  byRole: string | null;
  byName: string | null;
  roomName: string | null;
  createdAt: number;
};

export type Alerts = {
  reports: number;
  measured: number;
  edits: number;
  weak: number;
  issues: number;
  duplicates: number;
  live: number;
  lowStars: number;
  unreadComments: number;
  unreadReports: number;
};

type Data = {
  audit: { errors: number; warnings: number; duplicates: number };
  totals: {
    rooms: number;
    players: number;
    rounds: number;
    questions: number;
    live: number;
    bank: number;
    reports: number;
    comments: number;
    stars: number | null;
    medianPlayedMs: number | null;
    measured: number;
    edits: number;
    weak: number;
    lowStars: number;
    unreadComments: number;
    unreadReports: number;
  };
  days: Day[];
  banks: BankRow[];
  worst: Worst[];
  recentRooms: Room[];
  recentComments: Comment[];
};

/*
 * التاريخ الهجريّ من المتصفّح نفسه — لا مكتبة ولا جدول تحويل.
 * وأرقامه لاتينية بالطلب: بقيّةُ اللوحة أرقامُها لاتينية، ونظاما ترقيمٍ
 * في شاشةٍ واحدة يُقرآن كخطأٍ مطبعيّ.
 */
const HIJRI = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-latn', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** خطُّ النبض الذي يوقّع به المنتج نفسه */
const SIGNATURE = '0,23 62,23 76,23 86,7 98,40 110,23 142,23 152,14 160,23 230,23';

const STATUS: Record<string, { label: string; tone: 'safe' | 'mute' | 'signal' }> = {
  lobby: { label: 'بانتظار', tone: 'signal' },
  countdown: { label: 'استعداد', tone: 'signal' },
  running: { label: 'جارية', tone: 'safe' },
  paused: { label: 'موقوفة', tone: 'signal' },
  ended: { label: 'بين جولتين', tone: 'signal' },
  finished: { label: 'انتهت', tone: 'mute' },
};

const BANK_COLS: Col[] = [
  { label: 'البنك', w: '1.7fr' },
  { label: 'سهل', w: '0.6fr', align: 'center', tint: 'var(--color-safe)' },
  { label: 'متوسط', w: '0.7fr', align: 'center', tint: 'var(--color-warn)' },
  { label: 'صعب', w: '0.6fr', align: 'center', tint: 'var(--color-danger)' },
  { label: 'الأسئلة', w: '0.8fr', align: 'center' },
  { label: 'عُرض', w: '0.8fr', align: 'center' },
  { label: 'نسبة الصواب', w: '1fr', align: 'center' },
  { label: 'بلاغات', w: '0.8fr', align: 'center' },
];

const ROOM_COLS: Col[] = [
  { label: 'الرمز', w: '0.8fr' },
  { label: 'الاسم', w: '1.7fr' },
  { label: 'الوقت', w: '1fr' },
  { label: 'لاعبون', w: '0.7fr', align: 'center' },
  { label: 'الحال', w: '0.9fr' },
];

const WORST_COLS: Col[] = [
  { label: 'السؤال', w: '1.9fr' },
  { label: 'البنك', w: '0.9fr' },
  { label: 'عُرض', w: '0.5fr', align: 'center' },
  { label: 'الصواب', w: '0.7fr', align: 'center' },
  { label: 'بلاغ', w: '0.6fr', align: 'center' },
];

export default function Dashboard({
  api,
  reloadKey,
  onOpenQuestion,
  onGo,
  onAlerts,
}: {
  api: Api;
  reloadKey: number;
  onOpenQuestion: (id: string) => void;
  onGo: (section: string, page?: string, view?: string) => void;
  onAlerts: (alerts: Alerts) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [dups, setDups] = useState(false);

  useEffect(() => {
    void api.get<Data>('dashboard').then((next) => {
      setData(next);
      if (!next) return;
      onAlerts({
        reports: next.totals.reports,
        measured: next.totals.measured,
        edits: next.totals.edits,
        weak: next.totals.weak,
        issues: next.audit.errors + next.audit.warnings,
        duplicates: next.audit.duplicates,
        live: next.totals.live,
        lowStars: next.totals.lowStars,
        unreadComments: next.totals.unreadComments ?? 0,
        unreadReports: next.totals.unreadReports ?? 0,
      });
    });
  }, [api, reloadKey, onAlerts]);

  if (!data) return <Loading />;
  const { totals, audit } = data;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const clean = audit.errors === 0 && audit.warnings === 0 && audit.duplicates === 0;

  const state = [
    totals.live > 0 && `${say(totals.live, 'room')} قائمة الآن`,
    totals.reports > 0 && `${say(totals.reports, 'report')} على الأسئلة`,
    totals.weak > 0 && `${say(totals.weak, 'question')} تحت 30% صواباً`,
    clean && totals.reports === 0 && 'البنوك سليمة ولا بلاغ عليها',
  ].filter(Boolean) as string[];

  const peak = Math.max(1, ...data.days.map((d) => d.rooms));
  const opened = data.days.reduce((n, d) => n + d.rooms, 0);
  const seen = data.banks.reduce((n, b) => n + b.seen, 0);

  return (
    <div className="grid gap-4">
      {/* ── التحيّة ── */}
      <header className="flex items-end justify-between gap-6 px-0.5 pb-1">
        <div>
          <p className="text-[13px] font-medium text-muted">{HIJRI.format(new Date())}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-black">{greeting}</h1>
          <p className="mt-1.5 text-[14px] font-medium text-ink-2">
            {state.length
              ? state.join(' · ')
              : 'لم تُلعب مسابقةٌ بعد — ابدأ غرفةً وسيمتلئ هذا المكان'}
          </p>
        </div>
        <svg
          viewBox="0 0 230 46"
          className="hidden h-11 w-56 shrink-0 opacity-85 sm:block"
          fill="none"
          aria-hidden="true"
        >
          <polyline
            points={SIGNATURE}
            stroke="var(--color-signal)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </header>

      {/* ── أربعةُ أرقام ── */}
      <StatRow>
        <Stat
          lead
          label="أسئلة البنوك"
          value={totals.bank}
          unit={unit(totals.bank, 'question')}
          hint={`في ${say(data.banks.length, 'bank')}`}
          onClick={() => onGo('banks', 'questions')}
        />
        <Stat
          label="الغرف"
          value={totals.rooms}
          unit={unit(totals.rooms, 'room')}
          hint={
            totals.live > 0 ? (
              <span className="font-bold text-signal-ink">{totals.live} قائمة الآن</span>
            ) : (
              `وسيط اللعب ${span(totals.medianPlayedMs)}`
            )
          }
          onClick={() => onGo('rooms')}
        />
        <Stat
          label="اللاعبون"
          value={totals.players}
          unit={unit(totals.players, 'player')}
          hint={`${say(totals.rounds, 'round')} لُعبت`}
        />
        <Stat
          label="البلاغات"
          value={totals.reports}
          tone={totals.reports > 0 ? 'danger' : undefined}
          hint={totals.reports > 0 ? 'بلا هوية — من لاعبين ومنظّمين' : 'لا شكوى على سؤال'}
          onClick={() => onGo('banks', 'reports')}
        />
      </StatRow>

      {/* ── أقربُ عملٍ ينتظر ── */}
      <Callout data={data} onGo={onGo} onDups={() => setDups(true)} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel title="نشاط أربعة عشر يوماً" hint="غرفٌ افتُتحت في اليوم">
          <Activity days={data.days} peak={peak} />
          <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-line-soft pt-3.5">
            <Figure value={opened} label={`${unit(opened, 'room')} في 14 يوماً`} />
            <Figure value={totals.players} label="لاعباً شاركوا" />
            <Figure value={span(totals.medianPlayedMs)} label="وسيط مدّة الغرفة" />
            <span className="flex-1" />
            <More onClick={() => onGo('rooms')}>افتح الغرف</More>
          </div>
        </Panel>

        <Panel
          title="الأولى بالنظر"
          hint="ما اجتمع فيه ضعفُ الصواب وكثرةُ البلاغ"
          action={<More onClick={() => onGo('banks', 'questions', 'weak')}>افتح في الأسئلة</More>}
          flush
        >
          {data.worst.length === 0 ? (
            <Empty title="لا سؤال بلغ حدّ القياس بعد" lead="تُقاس الأسئلة بعد ثلاث عرضاتٍ فأكثر." />
          ) : (
            <Grid cols={WORST_COLS} min={0}>
              {data.worst.map((row) => (
                <Row key={row.id} cols={WORST_COLS} onClick={() => onOpenQuestion(row.id)}>
                  <Cell className="flex items-center gap-2 font-bold">
                    <Dot level={row.level} />
                    <span className="truncate">{row.text}</span>
                  </Cell>
                  <Cell className="text-[12.5px] text-faint">{row.bankName ?? row.bank}</Cell>
                  <Cell align="center" className="tnum text-[13px] text-muted">
                    {row.shown}
                  </Cell>
                  <Cell align="center">
                    <Rate value={row.rate} />
                  </Cell>
                  <Cell align="center">
                    {row.reports > 0 ? (
                      <Badge tone="danger">{row.reports}</Badge>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </Cell>
                </Row>
              ))}
            </Grid>
          )}
        </Panel>
      </div>

      {/* ── البنوك ── */}
      <Panel
        title="البنوك"
        hint={
          clean ? (
            'الفحص: لا خطأ ولا تنبيه ولا مكرّر'
          ) : (
            <button type="button" onClick={() => setDups(true)} className="font-bold text-warn-ink">
              الفحص: {audit.errors} خطأ · {audit.warnings} تنبيه · {audit.duplicates} مكرّر
            </button>
          )
        }
        action={<More onClick={() => onGo('banks', 'questions')}>إدارة البنوك</More>}
        flush
      >
        <Grid cols={BANK_COLS}>
          {data.banks.map((bank) => (
            <Row key={bank.id} cols={BANK_COLS} onClick={() => onGo('banks', 'questions')}>
              <Cell className="font-bold">{bank.name}</Cell>
              <Cell align="center" className="tnum font-bold text-safe">
                {bank.levels[0]}
              </Cell>
              <Cell align="center" className="tnum font-bold text-warn">
                {bank.levels[1]}
              </Cell>
              <Cell align="center" className="tnum font-bold text-danger">
                {bank.levels[2]}
              </Cell>
              <Cell align="center" className="tnum font-black">
                {bank.total}
              </Cell>
              <Cell align="center" className="tnum text-muted">
                {bank.seen || '—'}
              </Cell>
              <Cell align="center">
                <Rate value={bank.rate} />
              </Cell>
              <Cell align="center">
                {bank.reports > 0 ? (
                  <Badge tone="danger">{bank.reports}</Badge>
                ) : (
                  <span className="text-faint">—</span>
                )}
              </Cell>
            </Row>
          ))}
          <Row cols={BANK_COLS} className="bg-surface-2">
            <Cell className="font-black">المجموع</Cell>
            {[0, 1, 2].map((n) => (
              <Cell key={n} align="center" className="tnum font-black">
                {data.banks.reduce((sum, b) => sum + b.levels[n], 0)}
              </Cell>
            ))}
            <Cell align="center" className="tnum font-black">
              {totals.bank}
            </Cell>
            <Cell align="center" className="tnum font-black">
              {seen}
            </Cell>
            <Cell />
            <Cell align="center" className="tnum font-black text-danger">
              {totals.reports || '—'}
            </Cell>
          </Row>
        </Grid>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel
          title="آخر الغرف"
          hint="أحدثُ خمسٍ في السجلّ"
          action={<More onClick={() => onGo('rooms')}>كل الغرف</More>}
          flush
        >
          {data.recentRooms.length === 0 ? (
            <Empty title="لا غرف بعد" lead="أنشئ غرفةً من شاشة المنظّم وستظهر هنا." />
          ) : (
            <Grid cols={ROOM_COLS} min={0}>
              {data.recentRooms.map((room) => (
                <Row key={room.code} cols={ROOM_COLS}>
                  <Cell className="tnum text-[13px] tracking-[0.12em] text-faint">{room.code}</Cell>
                  <Cell className="font-bold">{room.name}</Cell>
                  <Cell className="text-[13px] text-muted">{day(room.createdAt)}</Cell>
                  <Cell align="center" className="tnum text-[13px] text-muted">
                    {room.players}
                  </Cell>
                  <Cell>
                    <Badge tone={STATUS[room.status]?.tone ?? 'mute'}>
                      {STATUS[room.status]?.label ?? room.status}
                    </Badge>
                  </Cell>
                </Row>
              ))}
            </Grid>
          )}
        </Panel>

        <Panel
          title="آخر التعليقات"
          hint={
            totals.stars === null
              ? 'لا تقييم بعد'
              : `المتوسط ${totals.stars.toFixed(1)} من 5 · ${say(totals.comments, 'comment')}`
          }
          action={<More onClick={() => onGo('comments')}>كل التعليقات</More>}
        >
          {data.recentComments.length === 0 ? (
            <Empty title="لا تعليقات بعد" />
          ) : (
            <div className="-mt-1">
              {data.recentComments.map((comment) => (
                <div key={comment.id} className="border-b border-line-soft py-3 last:border-0">
                  <div className="flex items-center gap-2.5 text-[12.5px]">
                    {comment.stars && <Stars n={comment.stars} />}
                    <span className="font-medium text-muted">
                      {comment.byRole === 'admin' ? 'منظّم' : `لاعب · ${comment.byName ?? '—'}`}
                    </span>
                    <span className="tnum ms-auto font-medium text-faint">
                      {stamp(comment.createdAt)}
                    </span>
                  </div>
                  {comment.note && (
                    <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-ink">
                      {comment.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {dups && (
        <Duplicates
          api={api}
          banks={data.banks}
          onOpen={onOpenQuestion}
          onClose={() => setDups(false)}
        />
      )}
    </div>
  );
}

function Figure({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="block">
      <b className="tnum block text-[18px] leading-none font-black">{value}</b>
      <span className="mt-1 block text-[12px] font-medium text-faint">{label}</span>
    </span>
  );
}

/**
 * النداء: سطرٌ واحدٌ يقول ما أقربُ عملٍ ينتظر، وزرٌّ يذهب إليه.
 * ولا يُعرض إلا وله ما يقول — لوحٌ يقول «كل شيء بخير» كل يومٍ لا يُقرأ.
 */
function Callout({
  data,
  onGo,
  onDups,
}: {
  data: Data;
  onGo: (section: string, page?: string, view?: string) => void;
  onDups: () => void;
}) {
  const { totals, audit } = data;

  if (totals.reports === 0 && audit.errors === 0 && audit.duplicates === 0 && totals.weak === 0) {
    return null;
  }

  const lines = [
    totals.reports > 0 && `${say(totals.reports, 'report')} تنتظر المراجعة`,
    totals.weak > 0 && `${say(totals.weak, 'question')} اجتمع فيها ضعفُ الصواب`,
    audit.errors > 0 && `${audit.errors} خطأً يمنع العمل`,
    audit.duplicates > 0 && `${audit.duplicates} سؤالاً مكرّراً`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card bg-signal-2 px-5 py-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_28%,transparent)]">
      <svg
        viewBox="0 0 24 24"
        className="size-5 shrink-0 text-signal-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3L2 20h20L12 3z" />
        <path d="M12 10v4" />
        <circle cx="12" cy="17" r="0.6" fill="currentColor" />
      </svg>
      <div className="min-w-[16rem] flex-1">
        <b className="block text-[14.5px] font-black">ثمّة ما يستحقّ نظرتك</b>
        <p className="mt-1 text-[13.5px] leading-snug font-medium text-ink-2">
          {lines.join('، و')}.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {totals.reports > 0 ? (
          <Action onClick={() => onGo('banks', 'reports')}>افتح البلاغات</Action>
        ) : (
          <Action onClick={() => onGo('banks', 'questions', 'weak')}>افتح الأسئلة</Action>
        )}
        {audit.duplicates > 0 && (
          <Action ghost onClick={onDups}>
            المكرّرات
          </Action>
        )}
      </div>
    </div>
  );
}

function Action({
  children,
  onClick,
  ghost,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ghost?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-chip px-4 text-[13px] font-bold transition ${
        ghost
          ? 'bg-surface text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_30%,transparent)] hover:bg-signal-2'
          : 'bg-signal-ink text-white hover:brightness-110'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * أعمدةُ النشاط — مرسومةٌ بالـCSS لا بمكتبة.
 *
 * أربعة عشر عموداً لا تستحقّ مئتَي كيلوبايت من رسّامٍ عامّ، والقاعدة في
 * هذا المشروع أن لا تُضاف مكتبةٌ بلا حاجة.
 */
function Activity({ days, peak }: { days: Day[]; peak: number }) {
  return (
    <div>
      <div className="flex h-28 items-end gap-1.5 border-b border-line-soft">
        {days.map((d) => (
          /* h-full على العمود شرط: نسبةُ ارتفاع الشريط تُحسب من أبيه،
             وأبٌ بارتفاعٍ تلقائيّ يجعلها صفراً فلا يُرسم شيء */
          <div
            key={d.at}
            className="group relative flex h-full flex-1 items-end"
            title={`${day(d.at)} · ${d.rooms} ${unit(d.rooms, 'room')} · ${d.players} ${unit(d.players, 'player')}`}
          >
            <div
              className="w-full rounded-t-[4px] bg-signal transition-opacity"
              style={{
                height: `${d.rooms ? Math.max(6, (d.rooms / peak) * 100) : 2}%`,
                opacity: d.rooms ? 0.55 + (d.rooms / peak) * 0.45 : 0.16,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[12px] font-medium text-faint">
        <span>قبل 14 يوماً</span>
        <span className="tnum font-bold text-signal-ink">
          اليوم — {days[days.length - 1].rooms} {unit(days[days.length - 1].rooms, 'room')}
        </span>
      </div>
    </div>
  );
}

type Dup = { q: string; banks: string[]; ids: string[] };

/** المكرّرات لا تُرى إلا بالنظر إلى البنوك مجتمعة — فتُعرض مجتمعة */
function Duplicates({
  api,
  banks,
  onOpen,
  onClose,
}: {
  api: Api;
  banks: BankRow[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Dup[] | null>(null);
  const nameOf = (id: string) => banks.find((b) => b.id === id)?.name ?? id;

  useEffect(() => {
    void api.get<Dup[]>('duplicates').then((data) => setRows(data ?? []));
  }, [api]);

  return (
    <Modal
      title="الأسئلة المكرّرة"
      hint="نصٌّ واحدٌ في موضعين — والخلط قد يجمعهما في جولةٍ واحدة"
      onClose={onClose}
    >
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty title="لا مكرّرات" lead="البنوك نظيفة — لا نصَّ يتكرّر في موضعين." />
      ) : (
        <ul className="grid gap-2.5">
          {rows.map((row, i) => (
            <li key={i} className="rounded-chip bg-surface-2 px-4 py-3.5">
              <b className="block text-[14px] leading-snug font-black">{row.q}</b>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {row.ids.map((id, n) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpen(id);
                    }}
                    className="rounded-chip bg-surface px-3 py-1.5 text-[13px] font-bold text-signal-ink shadow-[inset_0_0_0_1px_var(--color-line-2)] transition hover:bg-signal-2"
                  >
                    {nameOf(row.banks[n])}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/*
 * لونُ النجوم من قَدْرها لا من كونها نجوماً.
 *
 * كانت كلها ذهباً: خمسةٌ وواحدةٌ سواءٌ في اللون، فلا تُقرأ الصفحةُ بلمحة
 * ولا يقع البصر على الشكوى. والتدرّجُ من الأحمر إلى الأخضر هو نفسه تدرّج
 * الحالات في النظام — لا لوناً جديداً يُتعلَّم.
 */
const STAR_TONE: Record<number, string> = {
  1: 'text-danger',
  2: 'text-danger',
  3: 'text-warn',
  4: 'text-safe',
  5: 'text-safe',
};

export function Stars({ n }: { n: number }) {
  const tone = STAR_TONE[n] ?? 'text-faint';
  return (
    <span className="flex shrink-0 items-center gap-[1px]" aria-label={`${n} من 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon
          key={i}
          size={13}
          className={i < n ? tone : 'text-line-2'}
          fill="currentColor"
          stroke="none"
        />
      ))}
    </span>
  );
}
