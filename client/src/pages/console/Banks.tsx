import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type Api,
  type Col,
  Badge,
  Cell,
  Dot,
  Empty,
  Grid,
  Loading,
  Panel,
  Rate,
  Row,
  Stat,
  StatRow,
  levelOf,
  say,
  stamp,
  unit,
} from './shared';

/**
 * بابُ البنوك — ثلاث صفحات على بيانٍ واحد.
 *
 *   الأسئلة   · ما في البنك وما قاسه اللعب، في جدولٍ واحد يُرتَّب بالضغط
 *   البلاغات  · ما شكا منه الناس، مجموعاً بالسؤال
 *   المحرَّرة  · ما بُدِّل أو حُذف، يُراجَع ويُرجَع ثلاثين يوماً
 *
 * وثلاثتها تفتح المحرّر نفسه، فما يُصلَح في إحداها يظهر في أختيها.
 */

export type BankInfo = { id: string; name: string; count: number };
export type Counts = Record<string, number>;

export type Sift = {
  bank: string;
  level: number;
  view: string;
  search: string;
};

type Shared = {
  api: Api;
  sift: Sift;
  banks: BankInfo[];
  onEdit: (id: string) => void;
  onCounts: (counts: Counts) => void;
  reloadKey: number;
};

/* ══════════════ الأسئلة ══════════════ */

type Q = {
  id: string;
  bank: string;
  bankName: string;
  q: string;
  options: string[];
  level: number;
  shown: number;
  correct: number;
  wrong: number;
  rate: number | null;
  reports: number;
  issues: { severity: string; message: string }[];
};

/**
 * «ضعيف الصواب» تعريفٌ واحد في اللوحة كلها: دون ثلاثين بالمئة بعد ثلاث
 * عرضاتٍ فأكثر. وعبارةٌ واحدةٌ تعني شيئين في شاشةٍ واحدة تُفسد الثقة في
 * الرقمين معاً.
 */
const isWeak = (row: { rate: number | null; shown: number }) =>
  row.rate !== null && row.rate < 30 && row.shown >= 3;

const COLS: Col[] = [
  { key: 'bank', label: 'البنك', w: '0.95fr' },
  { key: 'q', label: 'السؤال', w: '1.9fr' },
  { label: 'الخيارات', w: '1.8fr' },
  { key: 'shown', label: 'عُرض', w: '0.5fr', align: 'center' },
  { key: 'correct', label: 'صح', w: '0.45fr', align: 'center', tint: 'var(--color-safe)' },
  { key: 'wrong', label: 'خطأ', w: '0.45fr', align: 'center', tint: 'var(--color-danger)' },
  { key: 'rate', label: 'النسبة', w: '0.7fr', align: 'center' },
  { key: 'reports', label: 'بلاغ', w: '0.5fr', align: 'center' },
];

export function Questions({ api, sift, onEdit, onCounts, reloadKey }: Shared) {
  const [rows, setRows] = useState<Q[] | null>(null);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'bank', dir: 1 });

  /*
   * تُقرأ البنوك كلها مرّةً واحدة، وكلُّ تصفيةٍ بعدها فرزٌ في المتصفّح.
   * فتبديلُ البنك أو المستوى يقع في الإطار نفسه، ولا تومض القائمة ولا
   * تعود من أولها.
   */
  const load = useCallback(async () => {
    const data = await api.get<{ questions: Q[] }>('bank/all');
    setRows(data?.questions ?? []);
  }, [api]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load, reloadKey]);

  /* الأعداد تصف البنك المختار: ما يُقرأ في الشريط هو ما يُعدّ في المتن */
  const mine = useMemo(
    () => (rows ?? []).filter((row) => !sift.bank || row.bank === sift.bank),
    [rows, sift.bank],
  );

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: mine.length,
      lvl0: mine.length,
      lvl1: mine.filter((r) => r.level === 1).length,
      lvl2: mine.filter((r) => r.level === 2).length,
      lvl3: mine.filter((r) => r.level === 3).length,
      measured: mine.filter((r) => r.shown >= 3).length,
      unseen: mine.filter((r) => r.shown === 0).length,
      weak: mine.filter(isWeak).length,
      reported: mine.filter((r) => r.reports > 0).length,
      issues: mine.filter((r) => r.issues.length > 0).length,
    });
  }, [rows, mine, onCounts]);

  const shown = useMemo(() => {
    const text = sift.search.trim();
    const keep = mine.filter((row) => {
      if (sift.level && row.level !== sift.level) return false;
      if (text && !row.q.includes(text) && !row.options.some((o) => o.includes(text))) return false;
      if (sift.view === 'measured') return row.shown >= 3;
      if (sift.view === 'unseen') return row.shown === 0;
      if (sift.view === 'weak') return isWeak(row);
      if (sift.view === 'reported') return row.reports > 0;
      if (sift.view === 'issues') return row.issues.length > 0;
      return true;
    });

    const pick = (row: Q) => {
      switch (sort.key) {
        case 'q':
          return row.q;
        case 'shown':
          return row.shown;
        case 'correct':
          return row.correct;
        case 'wrong':
          return row.wrong;
        case 'rate':
          return row.rate ?? -1;
        case 'reports':
          return row.reports;
        default:
          return row.bankName;
      }
    };
    /* الترتيب لا يُبعثر المتساوين: الأصل هو ترتيب البنك، وإليه تعود */
    return [...keep].sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
      if (x === y) return 0;
      const cmp =
        typeof x === 'string' ? String(x).localeCompare(String(y), 'ar') : Number(x) - Number(y);
      return cmp * sort.dir;
    });
  }, [mine, sift, sort]);

  if (!rows) return <Loading />;

  const flip = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'q' || key === 'bank' ? 1 : -1 },
    );

  const measured = mine.filter((r) => r.shown >= 3).length;
  const weak = mine.filter(isWeak).length;
  const reported = mine.filter((r) => r.reports > 0).length;
  const rated = mine.filter((r) => r.rate !== null && r.shown >= 3).map((r) => r.rate as number);
  const middle = rated.length
    ? [...rated].sort((a, b) => a - b)[Math.floor(rated.length / 2)]
    : null;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label={sift.bank ? 'أسئلة البنك' : 'أسئلة البنوك'}
          value={mine.length}
          unit={unit(mine.length, 'question')}
          hint={`${measured} منها قِيست في اللعب`}
        />
        <Stat
          label="وسيط الصواب"
          value={middle === null ? '—' : `${middle}%`}
          hint="نصفُ المقيس فوقه ونصفُه دونه"
        />
        <Stat
          label="ضعيفة الصواب"
          value={weak}
          tone={weak > 0 ? 'warn' : undefined}
          hint="دون 30% بعد ثلاث عرضات"
        />
        <Stat
          label="مُبلَّغ عنها"
          value={reported}
          tone={reported > 0 ? 'danger' : undefined}
          hint="شكا منها لاعبٌ أو منظّم"
        />
      </StatRow>

      <Panel
        title={
          shown.length === mine.length
            ? say(mine.length, 'question')
            : `${shown.length} من ${say(mine.length, 'question')}`
        }
        hint="اضغط رأس عمودٍ للترتيب · اضغط صفّاً لفتح المحرّر"
        flush
      >
        {shown.length === 0 ? (
          <Empty
            title="لا سؤال يطابق التصفية الحالية"
            lead="وسّع التصفية من الشريط الجانبيّ، أو امسح البحث."
          />
        ) : (
          <Grid cols={COLS} sort={sort} onSort={flip}>
            {shown.map((row) => (
              <Row key={row.id} cols={COLS} onClick={() => onEdit(row.id)}>
                <Cell>
                  <span className="inline-block max-w-full truncate rounded-chip bg-sunk px-2.5 py-1 text-[12.5px] font-medium text-muted">
                    {row.bankName}
                  </span>
                </Cell>
                <Cell className="flex items-center gap-2.5 font-bold">
                  <Dot level={row.level} />
                  <span className="truncate">{row.q}</span>
                  {row.issues.length > 0 && (
                    <Badge
                      tone={row.issues.some((i) => i.severity === 'error') ? 'danger' : 'warn'}
                      title={row.issues.map((i) => i.message).join(' · ')}
                    >
                      {row.issues.length}
                    </Badge>
                  )}
                </Cell>
                <Cell className="text-[13px] text-faint">
                  <b className="font-bold text-signal-ink">{row.options[0]}</b>
                  {row.options.slice(1).map((o) => ` · ${o}`)}
                </Cell>
                <Cell align="center" className="tnum text-[13.5px] text-ink-2">
                  {row.shown || '—'}
                </Cell>
                <Cell align="center" className="tnum text-[13.5px] font-bold text-safe">
                  {row.correct || '—'}
                </Cell>
                <Cell align="center" className="tnum text-[13.5px] font-bold text-danger">
                  {row.wrong || '—'}
                </Cell>
                <Cell align="center">
                  <Rate value={row.shown >= 3 ? row.rate : null} plain />
                </Cell>
                <Cell align="center">
                  {row.reports > 0 ? (
                    <span className="tnum text-[13.5px] font-black text-danger">{row.reports}</span>
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
  );
}

/* ══════════════ بلاغات الأسئلة ══════════════ */

type Report = {
  id: number;
  questionId: string | null;
  question: string | null;
  roomCode: string | null;
  roomName: string | null;
  reason: string | null;
  note: string | null;
  byRole: string | null;
  createdAt: number;
};

export function Reports({ api, sift, banks, onEdit, onCounts, reloadKey }: Shared) {
  const [rows, setRows] = useState<Report[] | null>(null);

  useEffect(() => {
    setRows(null);
    void api.get<Report[]>('feedback?kind=report').then(setRows);
  }, [api, reloadKey]);

  const bankOf = useCallback(
    (id: string | null) => banks.find((b) => id?.startsWith(`${b.id}:`))?.name ?? '—',
    [banks],
  );

  const mine = useMemo(
    () => (rows ?? []).filter((r) => !sift.bank || r.questionId?.startsWith(`${sift.bank}:`)),
    [rows, sift.bank],
  );

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: mine.length,
      player: mine.filter((r) => r.byRole === 'player').length,
      admin: mine.filter((r) => r.byRole === 'admin').length,
    });
  }, [rows, mine, onCounts]);

  if (!rows) return <Loading />;

  const text = sift.search.trim();
  const shown = mine.filter((row) => {
    if (text && !(row.question ?? '').includes(text) && !(row.note ?? '').includes(text)) {
      return false;
    }
    if (sift.view === 'admin') return row.byRole === 'admin';
    if (sift.view === 'player') return row.byRole === 'player';
    return true;
  });

  /* تجميعٌ بالسؤال: ستّةُ بلاغاتٍ على سؤالٍ واحد إشارةٌ أقوى من ستّة متفرّقة */
  const groups = new Map<string, { question: string; rows: Report[] }>();
  for (const row of shown) {
    const key = row.questionId ?? `~${row.id}`;
    if (!groups.has(key)) groups.set(key, { question: row.question ?? '—', rows: [] });
    groups.get(key)!.rows.push(row);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length);

  const byPlayer = mine.filter((r) => r.byRole === 'player').length;
  const questions = new Set(mine.map((r) => r.questionId ?? `~${r.id}`)).size;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="البلاغات"
          value={mine.length}
          unit={unit(mine.length, 'report')}
          hint="بلا هوية — تُحفظ الصفة لا الاسم"
        />
        <Stat label="أسئلةٌ شُكي منها" value={questions} hint="الأكثرُ بلاغاً أولاً" />
        <Stat label="من اللاعبين" value={byPlayer} hint="لا تظهر لمنظّم الغرفة" />
        <Stat
          label="من المنظّمين"
          value={mine.length - byPlayer}
          hint="من سجلّ الغرفة أثناء اللعب"
        />
      </StatRow>

      {ordered.length === 0 ? (
        <Panel>
          <Empty title="لا بلاغات" lead="لم يشكُ أحدٌ من سؤالٍ بعد — وهذا خبرٌ جيّد." />
        </Panel>
      ) : (
        ordered.map(([key, group]) => (
          <section key={key} className="tile p-5">
            <div className="flex items-start gap-3.5">
              <Badge tone="danger">{group.rows.length}</Badge>
              <div className="min-w-0 flex-1">
                <b className="block text-[15px] leading-snug font-black">{group.question}</b>
                <span className="mt-1 block text-[12.5px] font-medium text-faint">
                  {bankOf(key.startsWith('~') ? null : key)}
                </span>
              </div>
              {!key.startsWith('~') && (
                <button
                  type="button"
                  onClick={() => onEdit(key)}
                  className="shrink-0 text-[13px] font-bold text-signal-ink transition hover:underline"
                >
                  افتح في المحرّر
                </button>
              )}
            </div>

            <div className="mt-3 border-t border-line-soft">
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start gap-3 border-b border-line-soft py-3 last:border-0"
                >
                  <Badge tone="warn">{row.reason || 'بلاغ'}</Badge>
                  <div className="min-w-0 flex-1">
                    {row.note && <p className="text-[14px] leading-relaxed text-ink">{row.note}</p>}
                    <span className="mt-1 block text-[12px] font-medium text-faint">
                      {row.roomName ? `غرفة ${row.roomName} · ` : ''}
                      {row.byRole === 'admin' ? 'من منظّم' : 'من لاعب'} · {stamp(row.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/* ══════════════ الأسئلة المحرَّرة ══════════════ */

type Edit = {
  id: number;
  kind: 'edit' | 'delete';
  bank: string;
  bankName: string;
  oldId: string;
  newId: string | null;
  oldQ: string;
  oldOptions: string[];
  oldLevel: number;
  newQ: string | null;
  newOptions: string[] | null;
  newLevel: number | null;
  shown: number;
  correct: number;
  wrong: number;
  reports: number;
  restorable: boolean;
  at: number;
};

/**
 * أرشيفُ ثلاثين يوماً.
 *
 * تحريرُ السؤال يمحو ما قِيس عليه — وهو الصواب، فالمقاس كان لنصٍّ آخر —
 * لكن المحوَ لا رجعة فيه، وقد يتبيّن بعد يومٍ أن الصواب كان في القديم.
 */
export function Edits({
  api,
  sift,
  onCounts,
  reloadKey,
  onChanged,
}: Omit<Shared, 'onEdit'> & { onChanged: () => void }) {
  const [rows, setRows] = useState<Edit[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [ask, setAsk] = useState<number | null>(null);

  useEffect(() => {
    setRows(null);
    void api.get<Edit[]>('edits').then(setRows);
  }, [api, reloadKey]);

  const mine = useMemo(
    () => (rows ?? []).filter((r) => !sift.bank || r.bank === sift.bank),
    [rows, sift.bank],
  );

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: mine.length,
      edited: mine.filter((r) => r.kind === 'edit').length,
      deleted: mine.filter((r) => r.kind === 'delete').length,
    });
  }, [rows, mine, onCounts]);

  if (!rows) return <Loading />;

  const text = sift.search.trim();
  const shown = mine.filter((row) => {
    if (text && !row.oldQ.includes(text) && !(row.newQ ?? '').includes(text)) return false;
    if (sift.view === 'edited') return row.kind === 'edit';
    if (sift.view === 'deleted') return row.kind === 'delete';
    return true;
  });

  const restore = async (id: number) => {
    setBusy(id);
    const res = await api.send('POST', `edit/${id}/restore`);
    setBusy(null);
    setAsk(null);
    if (res.ok) onChanged();
  };

  const deleted = mine.filter((r) => r.kind === 'delete').length;
  const wiped = mine.reduce((n, r) => n + r.shown, 0);

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat
          lead
          label="نسخٌ محفوظة"
          value={mine.length}
          unit={unit(mine.length, 'question')}
          hint="تُحفظ ثلاثين يوماً ثم تُنسى"
        />
        <Stat label="حُرِّرت" value={mine.length - deleted} hint="بُدِّل نصُّها أو خياراتها" />
        <Stat
          label="حُذِفت"
          value={deleted}
          tone={deleted > 0 ? 'warn' : undefined}
          hint="خرجت من البنك — وتُرجَع من هنا"
        />
        <Stat label="إحصاءٌ مُحي" value={wiped} hint="عرضاتٌ ذهبت مع النصّ القديم" />
      </StatRow>

      {shown.length === 0 ? (
        <Panel>
          <Empty
            title="لم يُحرَّر سؤالٌ في الثلاثين يوماً الماضية"
            lead="كلُّ تحريرٍ أو حذفٍ يُحفظ هنا نسخةً يمكن إرجاعها."
          />
        </Panel>
      ) : (
        shown.map((row) => (
          <section key={row.id} className="tile p-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone={row.kind === 'delete' ? 'danger' : 'signal'}>
                {row.kind === 'delete' ? 'حُذف' : 'حُرِّر'}
              </Badge>
              <Badge>{row.bankName}</Badge>
              <span className="tnum text-[12.5px] font-medium text-faint">{stamp(row.at)}</span>
              <span className="flex-1" />
              {row.restorable ? (
                ask === row.id ? (
                  <>
                    <span className="text-[12.5px] font-medium text-muted">
                      {row.kind === 'delete'
                        ? 'يعود إلى البنك بلا إحصاء —'
                        : 'يحلّ القديم محلّ الجديد —'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void restore(row.id)}
                      disabled={busy === row.id}
                      className="h-8 rounded-chip bg-signal-ink px-4 text-[12.5px] font-bold text-white transition hover:brightness-110"
                    >
                      {busy === row.id ? 'يُرجَع…' : 'تأكيد'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsk(null)}
                      className="h-8 rounded-chip px-3 text-[12.5px] font-bold text-muted transition hover:text-ink"
                    >
                      تراجع
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAsk(row.id)}
                    className="h-8 rounded-chip px-3.5 text-[12.5px] font-bold text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_30%,transparent)] transition hover:bg-signal-2"
                  >
                    إرجاع القديم
                  </button>
                )
              ) : (
                <Badge tone="signal">أُرجع القديم</Badge>
              )}
            </div>

            <div className="mt-3.5 grid gap-3 lg:grid-cols-2">
              <Version
                label="القديم"
                text={row.oldQ}
                options={row.oldOptions}
                level={row.oldLevel}
              />
              {row.newQ ? (
                <Version
                  label="الجديد"
                  text={row.newQ}
                  options={row.newOptions ?? []}
                  level={row.newLevel ?? 2}
                  fresh
                />
              ) : (
                <div className="flex items-center rounded-chip bg-danger-2 px-4 py-3 text-[13.5px] font-bold text-danger-ink">
                  لم يعد في البنك
                </div>
              )}
            </div>

            <p className="mt-3 text-[12.5px] font-medium text-faint">
              ما مُحي من إحصاء: عُرض {row.shown} · صح {row.correct} · خطأ {row.wrong}
              {row.reports > 0 && ` · أُغلق ${say(row.reports, 'report')}`}
            </p>
          </section>
        ))
      )}
    </div>
  );
}

function Version({
  label,
  text,
  options,
  level,
  fresh,
}: {
  label: string;
  text: string;
  options: string[];
  level: number;
  fresh?: boolean;
}) {
  return (
    <div
      className={`rounded-chip px-4 py-3 ${
        fresh
          ? 'bg-signal-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_25%,transparent)]'
          : 'bg-surface-2 shadow-[inset_0_0_0_1px_var(--color-line)]'
      }`}
    >
      <span
        className={`mb-1.5 flex items-center gap-2 text-[11.5px] font-black ${
          fresh ? 'text-signal-ink' : 'text-faint'
        }`}
      >
        {label}
        <Dot level={level} />
        <span className="font-medium">{levelOf(level).label}</span>
      </span>
      <b className="block text-[14px] leading-relaxed font-bold text-ink">{text}</b>
      <span className="mt-1 block truncate text-[12.5px] text-muted">{options.join(' · ')}</span>
    </div>
  );
}
