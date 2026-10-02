import { useCallback, useEffect, useMemo, useState } from 'react';
import { HoldButton } from '../../components/ui';
import { TrashIcon } from '../../components/icons';
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
  MoreRows,
  useFeed,
  usePaged,
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
  /** مدى التواريخ في صفحة الغرف — null يعني السجلّ كلّه */
  range?: { from: number; to: number } | null;
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
 * «ضعيف الصواب»: دون ثلاثين بالمئة — ولو من عرضةٍ واحدة.
 *
 * كان يشترط ثلاث عرضاتٍ فأكثر، وكانت النسبةُ تُخفى دونها أيضاً. فيعرض
 * المالكُ سؤالاً مرّتين فيُخطأ فيهما، ويقرأ في عموده شرطةً — والرقمُ
 * محسوبٌ عنده لكنه محجوب. وأسوأُ منه أن الترتيبَ كان يُرتِّب بالرقم
 * المحجوب: تضغط «النسبة» فتتبعثر الصفوفُ بلا سببٍ يُرى.
 *
 * فرُفع الشرط: ما قيس يُعرض كما هو، وقلّةُ العرضات تُقرأ من عمود «عُرض».
 */
const isWeak = (row: { rate: number | null; shown: number }) =>
  row.rate !== null && row.rate < 30;

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
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'bank', dir: 1 });

  /*
   * تُقرأ البنوك كلها مرّةً واحدة، وكلُّ تصفيةٍ بعدها فرزٌ في المتصفّح.
   * فتبديلُ البنك أو المستوى يقع في الإطار نفسه، ولا تومض القائمة ولا
   * تعود من أولها.
   */
  const load = useCallback(
    async () => (await api.get<{ questions: Q[] }>('bank/all'))?.questions ?? [],
    [api],
  );
  const [rows] = useFeed(load, reloadKey);

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
      measured: mine.filter((r) => r.shown > 0).length,
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
      if (sift.view === 'measured') return row.shown > 0;
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
      /*
       * ما لم يُقس يُذيَّل في الاتجاهين.
       *
       * سؤالٌ عُرض ولم يُجَب نسبتُه «لا شيء» لا «صفر»، فلو رُتِّب بينها
       * بقيمةٍ وهمية تصدّر الفرزَ التصاعديّ ودفن الأضعفَ تحته — وهو الذي
       * فُرز من أجله. فيُنحّى إلى الذيل كيفما فُرز.
       */
      if (sort.key === 'rate' && (a.rate === null || b.rate === null)) {
        if (a.rate === b.rate) return 0;
        return a.rate === null ? 1 : -1;
      }
      const x = pick(a);
      const y = pick(b);
      if (x === y) return 0;
      const cmp =
        typeof x === 'string' ? String(x).localeCompare(String(y), 'ar') : Number(x) - Number(y);
      return cmp * sort.dir;
    });
  }, [mine, sift, sort]);

  /* دفعةٌ تُرسم ثم تُطلب أختها — وألفُ صفٍّ لا تُبنى دفعةً واحدة */
  const paged = usePaged(shown);

  if (!rows) return <Loading />;

  const flip = (key: string) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 1 ? -1 : 1 }
        : { key, dir: key === 'q' || key === 'bank' ? 1 : -1 },
    );

  const measured = mine.filter((r) => r.shown > 0).length;
  const weak = mine.filter(isWeak).length;
  const reported = mine.filter((r) => r.reports > 0).length;
  const rated = mine.filter((r) => r.rate !== null).map((r) => r.rate as number);
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
          hint="دون 30% صواباً — ولو من عرضة"
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
            {paged.slice.map((row) => (
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
                  <Rate value={row.rate} plain />
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
        <MoreRows
          hidden={paged.hidden}
          onMore={paged.showMore}
          onAll={paged.showAll}
          kind="question"
        />
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
  const load = useCallback(() => api.get<Report[]>('feedback?kind=report'), [api]);
  const [rows] = useFeed(load, reloadKey);

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

/* ══════════════ البنوك: حذفٌ وإرجاع ══════════════ */

type Trashed = {
  id: number;
  bank: string;
  name: string;
  count: number;
  at: number;
  restorable: boolean;
};

/**
 * إدارةُ البنوك: ما في كلٍّ منها، وحذفُه، وما حُذف.
 *
 * الحذفُ بضغطٍ مطوّل لا بضغطةٍ وتأكيد: البنكُ مئاتُ الأسئلة، والضغطةُ
 * الطائشة في لوحةٍ تُدار بالإبهام تكلّف بنكاً كاملاً. والمطوّلُ لا يُفلت.
 *
 * ولا يذهب المحذوف: يُحفظ بأسئلته كلّها ثلاثين يوماً كأرشيف التحرير،
 * فيُرجَع كما كان أو يُنسى مبكّراً.
 */
export function Shelf({
  api,
  banks,
  onCounts,
  reloadKey,
  onChanged,
}: {
  api: Api;
  banks: BankInfo[];
  onCounts: (counts: Counts) => void;
  reloadKey: number;
  onChanged: () => void;
}) {
  const load = useCallback(() => api.get<Trashed[]>('trash'), [api]);
  const [rows] = useFeed(load, reloadKey);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!rows) return;
    onCounts({ all: banks.length, deleted: rows.length });
  }, [rows, banks.length, onCounts]);

  const flash = (message: string) => {
    setNote(message);
    setTimeout(() => setNote(''), 4000);
  };

  const remove = async (bank: BankInfo) => {
    setBusy(bank.id);
    const res = await api.send<{ error?: string }>('DELETE', `bank/${bank.id}`);
    setBusy(null);
    if (res.ok) {
      flash(`حُذف «${bank.name}» — ويُرجَع من المحذوفة أدناه`);
      onChanged();
    } else flash(res.data?.error ?? 'تعذّر الحذف');
  };

  const restore = async (row: Trashed) => {
    setBusy(String(row.id));
    const res = await api.send<{ error?: string }>('POST', `trash/${row.id}/restore`);
    setBusy(null);
    if (res.ok) {
      flash(`أُرجع «${row.name}» بأسئلته`);
      onChanged();
    } else flash(res.data?.error ?? 'تعذّر الإرجاع');
  };

  /*
   * استيرادُ ملفّات المستودع: الحلقةُ المقابلة لـpull-banks.
   *
   * القاعدةُ هي المرجع، فمن كتب أسئلةً في محرّرٍ ورفعها إلى git احتاج باباً
   * تدخل منه. و«الناقصَ وحده» آمنٌ لا يمسّ قائماً، و«استبدالاً» يمحو ما
   * حُرِّر من اللوحة في البنوك التي لها ملفّات — فهو بضغطٍ مطوّل.
   */
  const bring = async (replace: boolean) => {
    setBusy(replace ? 'import-replace' : 'import-missing');
    const res = await api.send<{ error?: string; banks?: { action: string }[] }>(
      'POST',
      'banks/import',
      { replace },
    );
    setBusy(null);
    if (!res.ok) return flash(res.data?.error ?? 'تعذّر الاستيراد');
    const rows = res.data?.banks ?? [];
    const tally = (name: string) => rows.filter((r) => r.action === name).length;
    const said = [
      tally('added') && `أُضيف ${tally('added')}`,
      tally('replaced') && `استُبدل ${tally('replaced')}`,
      tally('same') && `${tally('same')} مطابق`,
      tally('kept') && `${tally('kept')} بقي كما هو`,
    ]
      .filter(Boolean)
      .join(' · ');
    flash(said || 'لا ملفّات');
    onChanged();
  };

  const forget = async (row: Trashed) => {
    setBusy(String(row.id));
    const res = await api.send<{ error?: string }>('DELETE', `trash/${row.id}`);
    setBusy(null);
    if (res.ok) {
      flash(`نُسي «${row.name}» — ولا رجعة`);
      onChanged();
    } else flash(res.data?.error ?? 'تعذّر النسيان');
  };

  if (!rows) return <Loading />;

  const total = banks.reduce((n, b) => n + b.count, 0);

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat lead label="بنوك" value={banks.length} unit={unit(banks.length, 'bank')} />
        <Stat label="أسئلة" value={total} unit={unit(total, 'question')} />
        <Stat
          label="محذوفة"
          value={rows.length}
          hint="تُحفظ بأسئلتها ثلاثين يوماً ثم تُنسى"
          tone={rows.length ? 'warn' : undefined}
        />
      </StatRow>

      {note && (
        <p className="rounded-card bg-signal-2 px-5 py-3 text-[13.5px] font-bold text-signal-ink">
          {note}
        </p>
      )}

      {/*
        بطاقاتٌ متجاورة لا جدول.
        البنوك أحد عشر بأربعة حقول، والجدولُ يفرض عليها عرضاً أدنى ٧٢٠px
        فيُمرَّر أفقياً على اللوح الضيّق — وثلاثةُ أرباع عرضه كانت تذهب في
        زرِّ حذفٍ بجملةٍ طويلة تُقَصّ. والبطاقةُ تملأ العرض بما يُقرأ، وتصفُّ
        نفسها بعرض الشاشة.
      */}
      <Panel
        title="البنوك"
        hint="الحذف بضغطٍ مطوّل على أيقونة السلّة — ويُحفظ البنك بأسئلته فيُرجَع. ولا يُحذف آخر بنك، ولا بنكٌ تستعمله غرفةٌ قائمة."
      >
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {banks.map((bank) => (
            <article
              key={bank.id}
              className="flex items-center gap-3 rounded-card bg-surface-2 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[14.5px] font-black">{bank.name}</b>
                <span
                  dir="ltr"
                  className="mt-0.5 block truncate text-right font-mono text-[12px] text-faint"
                >
                  {bank.id}
                </span>
              </div>

              <div className="shrink-0 text-center">
                <b className="tnum block text-[19px] leading-none font-black text-signal-ink">
                  {bank.count}
                </b>
                <span className="mt-1 block text-[11.5px] font-medium text-muted">
                  {unit(bank.count, 'question')}
                </span>
              </div>

              {banks.length <= 1 ? (
                <Badge>آخرُ بنك</Badge>
              ) : busy === bank.id ? (
                <span className="shrink-0 text-[12px] font-bold text-muted">يُحذف…</span>
              ) : (
                <HoldButton
                  bare
                  tone="icon"
                  glyph={<TrashIcon size={15} />}
                  label={`احذف «${bank.name}» — ${say(bank.count, 'question')} تُحفظ ثلاثين يوماً`}
                  onConfirm={() => void remove(bank)}
                />
              )}
            </article>
          ))}
        </div>
      </Panel>

      {/*
        واستيرادُ الناقص صعد إلى الترويسة، فلم يبقَ هنا إلا الاستبدال.
        ولا يصعد معه: هو يمحو ما حُرِّر من اللوحة، وزرٌّ بهذا الأثر لا
        يُوضع حيث تقع عليه الضغطةُ مروراً — ويبقى بضغطه المطوّل.
      */}
      <Panel
        title="ملفّات المستودع"
        hint="البنوك تعيش في القاعدة فلا يمحوها نشر، وملفّات server/banks نسخةٌ تُستورد منها — و«استيراد البنوك» في الترويسة يُدخل الناقص منها"
      >
        <HoldButton
          bare
          label="استبدل من الملفّات"
          hint="يمحو ما حُرِّر من اللوحة في البنوك التي لها ملفّات، ويردّها إلى نصّ المستودع"
          onConfirm={() => void bring(true)}
        />
      </Panel>

      {rows.length > 0 && (
        <Panel title="البنوك المحذوفة" hint="تُرجَع بأسئلتها كما كانت، أو تُنسى قبل الثلاثين" flush>
          {rows.map((row) => (
            <div key={row.id} className="border-b border-line-soft px-5 py-3.5 last:border-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <b className="text-[14px] font-black">{row.name}</b>
                  <span className="mr-2 text-[12.5px] font-medium text-muted" dir="ltr">
                    {row.bank}
                  </span>
                  <p className="mt-0.5 text-[12.5px] font-medium text-muted">
                    {say(row.count, 'question')} · حُذف {stamp(row.at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {row.restorable ? (
                    <button
                      type="button"
                      onClick={() => void restore(row)}
                      disabled={busy === String(row.id)}
                      className="h-8 rounded-chip px-3.5 text-[12.5px] font-bold text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_30%,transparent)] transition hover:bg-signal-2"
                    >
                      {busy === String(row.id) ? 'يُرجَع…' : 'إرجاع البنك'}
                    </button>
                  ) : (
                    <Badge tone="signal">أُرجع</Badge>
                  )}
                  <div className="w-[150px]">
                    <HoldButton
                      bare
                      label="انسَ نهائياً"
                      hint="لا رجعة بعده"
                      onConfirm={() => void forget(row)}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

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
  const load = useCallback(() => api.get<Edit[]>('edits'), [api]);
  const [rows] = useFeed(load, reloadKey);
  const [busy, setBusy] = useState<number | null>(null);
  /* سؤالٌ واحدٌ مفتوحٌ للتأكيد: إرجاعٌ أو حذف — لا يجتمعان في صفٍّ واحد */
  const [ask, setAsk] = useState<{ id: number; mode: 'restore' | 'delete' } | null>(null);

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

  /* حذفُ السجلّ من الأرشيف — لا يمسّ البنك، إنما يُخلي نسخةَ التراجع */
  const forget = async (id: number) => {
    setBusy(id);
    const res = await api.send('DELETE', `edit/${id}`);
    setBusy(null);
    setAsk(null);
    if (res.ok) onChanged();
  };

  /*
   * ومحوُ السجلّ كلّه في الترويسة العليا لا هنا.
   *
   * لأنه فعلُ الصفحة لا فعلُ سطرٍ فيها، ومكانُ أفعال الصفحة ترويستُها —
   * حيث «+ سؤال جديد» و«قراءة الكل». وكان لوحاً في القاع يُبلغ إليه
   * بتمرير مئة سجلّ.
   */
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
              {ask?.id === row.id ? (
                ask.mode === 'restore' ? (
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
                  <>
                    <span className="text-[12.5px] font-medium text-danger">
                      يُحذف السجلّ نهائياً — ولا يُرجَع القديم بعده —
                    </span>
                    <button
                      type="button"
                      onClick={() => void forget(row.id)}
                      disabled={busy === row.id}
                      className="h-8 rounded-chip bg-danger px-4 text-[12.5px] font-bold text-white transition hover:brightness-110"
                    >
                      {busy === row.id ? 'يُحذف…' : 'احذف السجلّ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsk(null)}
                      className="h-8 rounded-chip px-3 text-[12.5px] font-bold text-muted transition hover:text-ink"
                    >
                      تراجع
                    </button>
                  </>
                )
              ) : (
                <>
                  {row.restorable ? (
                    <button
                      type="button"
                      onClick={() => setAsk({ id: row.id, mode: 'restore' })}
                      className="h-8 rounded-chip px-3.5 text-[12.5px] font-bold text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_30%,transparent)] transition hover:bg-signal-2"
                    >
                      إرجاع القديم
                    </button>
                  ) : (
                    <Badge tone="signal">أُرجع القديم</Badge>
                  )}
                  {/* أيقونةٌ لا جملة: الصفُّ يحمل شارتين وتاريخاً وزرَّ إرجاع */}
                  <button
                    type="button"
                    onClick={() => setAsk({ id: row.id, mode: 'delete' })}
                    title="حذف هذا السجلّ من الأرشيف"
                    aria-label="حذف هذا السجلّ من الأرشيف"
                    className="flex size-8 shrink-0 items-center justify-center rounded-chip text-danger transition hover:bg-danger-2"
                  >
                    <TrashIcon size={15} />
                  </button>
                </>
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
