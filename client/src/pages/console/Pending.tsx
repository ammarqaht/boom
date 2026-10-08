import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AutoTextarea, Flag, Select, toast } from '../../components/ui';
import { CheckIcon, PenIcon, PlusIcon, TrashIcon } from '../../components/icons';
import {
  type Api,
  type Issue,
  Badge,
  Dot,
  Empty,
  LEVELS,
  Loading,
  Modal,
  MoreRows,
  Panel,
  Stat,
  StatRow,
  arabizeDigits,
  say,
  unit,
  useFeed,
  usePaged,
} from './shared';
import type { BankInfo, Counts, Sift } from './Banks';

/**
 * إضافةُ سؤال — البابُ الذي يدخل منه السؤال، وغرفةُ انتظارٍ قبل البنك.
 *
 * كان محرّرُ السؤال يطلب كلَّ شيءٍ في جلسةٍ واحدة ويأبى الحفظ بالنقص. ومن
 * يقرأ فيمرّ به سؤالٌ حسنٌ لا يملك إلا أن يجلس فيكتبه كاملاً أو يَدَعه —
 * فيَدَعه.
 *
 * فهذا نموذجٌ فيه كلُّ الحقول ولا يُلزمك إلا باثنين: السؤال وإجابته
 * الصحيحة. وما كتبتَه من خياراتٍ ومستوًى وبنكٍ حُفظ معه، وما تركتَه يُكمَل
 * لاحقاً. ولا يرى لاعبٌ شيئاً من ذلك حتى يُعتمد.
 *
 *   ناقص          · ينقصه بنكٌ أو خيارٌ خاطئ أو مستوى
 *   ينتظر الاعتماد · تمَّت تفاصيلُه، والقرارُ للمالك
 */

export type Pending = {
  id: number;
  bank: string | null;
  bankName: string | null;
  q: string;
  answer: string;
  wrongs: string[];
  level: number | null;
  flag?: string | null;
  source: string;
  at: number;
  missing: string[];
  ready: boolean;
  issues: Issue[];
  duplicate: { bank: string; bankName: string; id: string } | null;
  twin: number | null;
};

type Props = {
  api: Api;
  sift: Sift;
  banks: BankInfo[];
  onCounts: (counts: Counts) => void;
  reloadKey: number;
  onChanged: () => void;
};

const blocked = (row: Pending) => row.issues.some((i) => i.severity === 'error');

const EMPTY = { q: '', answer: '', wrongs: ['', '', ''], level: null as number | null };

export default function PendingPage({ api, sift, banks, onCounts, reloadKey, onChanged }: Props) {
  const load = useCallback(() => api.get<Pending[]>('pending'), [api]);
  const [rows] = useFeed(load, reloadKey);
  const [editing, setEditing] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const mine = useMemo(
    () => (rows ?? []).filter((row) => !sift.bank || row.bank === sift.bank),
    [rows, sift.bank],
  );

  useEffect(() => {
    if (!rows) return;
    onCounts({
      all: mine.length,
      short: mine.filter((row) => !row.ready).length,
      ready: mine.filter((row) => row.ready).length,
      twinned: mine.filter((row) => row.duplicate || row.twin).length,
      nobank: mine.filter((row) => !row.bank).length,
    });
  }, [rows, mine, onCounts]);

  const text = sift.search.trim();
  const shown = useMemo(
    () =>
      mine.filter((row) => {
        if (sift.level && row.level !== sift.level) return false;
        if (text && !row.q.includes(text) && !row.answer.includes(text)) return false;
        if (sift.view === 'short') return !row.ready;
        if (sift.view === 'ready') return row.ready;
        if (sift.view === 'twinned') return Boolean(row.duplicate || row.twin);
        if (sift.view === 'nobank') return !row.bank;
        return true;
      }),
    [mine, sift, text],
  );

  const paged = usePaged(shown);

  const drop = async (row: Pending) => {
    setBusy(row.id);
    const res = await api.send<{ error?: string }>('DELETE', `pending/${row.id}`);
    setBusy(null);
    if (!res.ok) return toast(res.data?.error ?? 'تعذّر الحذف', { tone: 'danger' });
    onChanged();
  };

  if (!rows) return <Loading />;

  const ready = mine.filter((row) => row.ready).length;
  const twins = mine.filter((row) => row.duplicate || row.twin).length;

  return (
    <div className="grid gap-4">
      <StatRow>
        <Stat lead label="معلّقة" value={mine.length} unit={unit(mine.length, 'question')} />
        <Stat label="تنتظر الاعتماد" value={ready} />
        <Stat
          label="ناقصة"
          value={mine.length - ready}
          tone={mine.length > ready ? 'warn' : undefined}
        />
        <Stat label="مكرّرة" value={twins} tone={twins > 0 ? 'warn' : undefined} />
      </StatRow>

      <Composer api={api} banks={banks} bank={sift.bank} onAdded={onChanged} />

      <Panel
        title={
          shown.length === mine.length
            ? say(mine.length, 'question')
            : `${shown.length} من ${say(mine.length, 'question')}`
        }
        flush
      >
        {shown.length === 0 ? (
          <Empty
            title={mine.length === 0 ? 'لا سؤال معلَّق' : 'لا سؤال يطابق التصفية'}
          />
        ) : (
          paged.slice.map((row) => (
            <Line
              key={row.id}
              row={row}
              busy={busy === row.id}
              onOpen={() => setEditing(row)}
              onDrop={() => void drop(row)}
            />
          ))
        )}
        <MoreRows
          hidden={paged.hidden}
          onMore={paged.showMore}
          onAll={paged.showAll}
          kind="question"
        />
      </Panel>

      {editing && (
        <PendingEditor
          api={api}
          row={editing}
          banks={banks}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

/* ══════════════ صفُّ المعلَّق ══════════════ */

/**
 * سطرٌ واحد: السؤال، وإجابته، وحاله، وقلمٌ وسلّة.
 *
 * وكان ثلاثة أسطر تحمل الخيارات والبنك وتاريخَ الكتابة وشاراتِ التكرار —
 * فصار الصفُّ الواحد يشغل ما تشغله ثلاثة، وعشرون معلَّقاً صفحةً تُمرَّر.
 * وهذه قائمةُ عملٍ تُمسَح بالعين لا سجلٌّ يُدرَس: ما وراء السطر يُقرأ في
 * المحرّر، والقلمُ يفتحه.
 */
function Line({
  row,
  busy,
  onOpen,
  onDrop,
}: {
  row: Pending;
  busy: boolean;
  onOpen: () => void;
  onDrop: () => void;
}) {
  const bad = blocked(row);
  /* تفصيلُ الحال في tooltip السطر — لا في سطرٍ ثالثٍ تحته */
  const why = bad
    ? row.issues.find((i) => i.severity === 'error')?.message
    : row.missing.length > 0
      ? `ينقصه: ${row.missing.join(' و')}`
      : row.duplicate
        ? `نصُّه في بنك ${row.duplicate.bankName}`
        : undefined;

  return (
    <div className="flex items-center gap-x-3 border-b border-line-soft px-5 py-2.5 last:border-0">
      <button
        type="button"
        onClick={onOpen}
        title={why}
        className="flex min-w-0 flex-1 items-center gap-x-3 text-right transition hover:opacity-75"
      >
        {row.level ? <Dot level={row.level} /> : null}
        <b className="min-w-0 flex-1 truncate text-[14px] font-bold">{row.q}</b>
        {row.flag && <Flag code={row.flag} className="h-[16px]" />}
        <span className="min-w-0 max-w-[14rem] truncate text-[13px] font-black text-signal-ink">
          {row.answer}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* شارةٌ واحدةٌ تصف الحال — والأخطرُ يتقدّم */}
        {bad ? (
          <Badge tone="danger">خطأ</Badge>
        ) : row.duplicate || row.twin ? (
          <Badge tone="warn">مكرّر</Badge>
        ) : (
          <Badge tone={row.ready ? 'signal' : 'warn'}>
            {row.ready ? 'ينتظر الاعتماد' : 'ناقص'}
          </Badge>
        )}

        <button
          type="button"
          onClick={onOpen}
          title={row.ready ? 'راجِعه واعتمدْه' : 'أكمِل تفاصيله'}
          aria-label={row.ready ? 'راجِعه واعتمدْه' : 'أكمِل تفاصيله'}
          className="flex size-8 items-center justify-center rounded-chip text-muted transition hover:bg-surface-2 hover:text-ink"
        >
          <PenIcon size={15} />
        </button>
        <button
          type="button"
          onClick={onDrop}
          disabled={busy}
          title="احذفه"
          aria-label="احذفه"
          className="flex size-8 items-center justify-center rounded-chip text-danger transition hover:bg-danger-2 disabled:opacity-50"
        >
          <TrashIcon size={15} />
        </button>
      </div>
    </div>
  );
}

/* ══════════════ نموذجُ الإضافة ══════════════ */

/**
 * كلُّ الحقول حاضرة، واثنان منها وحدهما يُلزمان.
 *
 * فالحقلان وحدهما كانا يُخفيان الباقي، فمن عنده السؤالُ تامّاً اضطرّ أن
 * يكتبه ثم يفتح المحرّر ليُكمله — خطوتان لما هو خطوة. ومن ليس عنده إلا
 * السؤالُ وجوابُه كتبهما ومضى، والباقي فارغٌ يُكمَل عند المراجعة.
 *
 * وEnter يحفظ من أيّ حقل، ويعود التركيزُ إلى أوّل الحقول للسؤال الذي
 * بعده — فثلاثون سؤالاً تُكتب بلا أن تمسّ يدُك فأرة.
 */
function Composer({
  api,
  banks,
  bank,
  onAdded,
}: {
  api: Api;
  banks: BankInfo[];
  bank: string;
  onAdded: () => void;
}) {
  const [draft, setDraft] = useState(EMPTY);
  /* بنكُ الشريط يُورَّث إن كان مختاراً، ويبقى بين سؤالٍ وآخر */
  const [target, setTarget] = useState(bank);
  const [busy, setBusy] = useState(false);
  /*
   * التركيزُ يُستعاد من الصندوق لا بمرجعٍ على الحقل: AutoTextarea تُثبّت
   * مرجعَها هي على textarea لتقيس ارتفاعه، فلا يصل إليها مرجعٌ من خارج.
   */
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setTarget(bank), [bank]);

  const bare = !draft.q.trim() || !draft.answer.trim();

  const add = async () => {
    if (bare || busy) return;
    setBusy(true);
    const res = await api.send<{ error?: string }>('POST', 'pending', {
      q: draft.q.trim(),
      answer: draft.answer.trim(),
      wrongs: draft.wrongs.map((w) => w.trim()).filter(Boolean),
      level: draft.level,
      bank: target || null,
    });
    setBusy(false);
    if (!res.ok) return toast(res.data?.error ?? 'تعذّر الحفظ', { tone: 'danger' });
    /* البنكُ والمستوى يبقيان: دفعةٌ من بنكٍ واحدٍ بمستوًى واحد هي الغالب */
    setDraft({ ...EMPTY, level: draft.level });
    box.current?.querySelector('textarea')?.focus();
    onAdded();
  };

  /* Enter يحفظ، وShift+Enter يُنزل سطراً: السؤال قد يكون من سطرين */
  const key = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void add();
    }
  };

  const wrong = (i: number, value: string) =>
    setDraft({
      ...draft,
      wrongs: draft.wrongs.map((w, j) => (j === i ? arabizeDigits(value) : w)),
    });

  return (
    <Panel title="أضف سؤالاً">
      <div ref={box} className="grid gap-2.5">
        <div className="grid gap-2.5 lg:grid-cols-[1fr_minmax(0,20rem)]">
          <AutoTextarea
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: arabizeDigits(event.target.value) })}
            onKeyDown={key}
            placeholder="نصّ السؤال"
            maxRows={4}
            className="rounded-chip bg-surface px-4 py-3 text-[15px] leading-relaxed font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
          />
          <AutoTextarea
            value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: arabizeDigits(event.target.value) })}
            onKeyDown={key}
            placeholder="الإجابة الصحيحة"
            maxRows={4}
            className="rounded-chip bg-signal-2 px-4 py-3 text-[15px] leading-relaxed font-black text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_35%,transparent)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
          />
        </div>

        {/*
          بقيّةُ الحقول بلا نجمةٍ ولا كلمةِ «اختياريّ»: الزرُّ يعمل بدونها
          فتُعرف اختياريّتُها من أوّل سؤالٍ يُضاف، وسطرٌ يقولها سطرٌ يُقرأ
          مرّةً ثم يشغل مكانه أبداً.
        */}
        <div className="grid gap-2.5 sm:grid-cols-3">
          {draft.wrongs.map((value, i) => (
            <input
              key={i}
              value={value}
              onChange={(event) => wrong(i, event.target.value)}
              onKeyDown={key}
              placeholder={`خطأ ${i + 1}`}
              className="h-11 rounded-chip bg-surface px-4 text-[14px] font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="min-w-[12rem] flex-1">
            <Select
              value={target}
              onChange={setTarget}
              choices={[
                { value: '', label: 'بلا بنك' },
                ...banks.map((b) => ({
                  value: b.id,
                  label: b.active ? b.name : `${b.name} (مُلغى)`,
                  hint: String(b.count),
                })),
              ]}
            />
          </div>

          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDraft({ ...draft, level: draft.level === n ? null : n })}
                className={`flex h-11 items-center gap-2 rounded-chip px-4 text-[13.5px] font-bold transition ${
                  draft.level === n
                    ? LEVEL_SKIN[n]
                    : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
                }`}
              >
                {draft.level !== n && <Dot level={n} />}
                {LEVELS[n].label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void add()}
            disabled={bare || busy}
            title="أضِفه إلى المعلّقة"
            aria-label="أضِفه إلى المعلّقة"
            className={`flex size-11 shrink-0 items-center justify-center rounded-chip transition ${
              bare || busy
                ? 'cursor-not-allowed bg-line-2 text-white'
                : 'bg-signal-ink text-white hover:brightness-110'
            }`}
          >
            <PlusIcon size={17} />
          </button>
        </div>
      </div>
    </Panel>
  );
}

/* ══════════════ محرّرُ المعلَّق ══════════════ */

/**
 * إكمالُ التفاصيل — وهو المحرّرُ نفسه إلا أنه لا يمنع الحفظَ بالنقص.
 *
 * فمحرّرُ البنك يأبى حفظَ سؤالٍ ناقص (وذاك صوابٌ: ما في البنك يُلعب به)،
 * وهذا يحفظ النقصَ ويُسمّيه: تكتب خياراً واحداً اليوم وآخرَ غداً. ولا
 * يُعتمد إلا عند التمام — فالبابان مفصولان: «احفظ» و«اعتمد».
 */
function PendingEditor({
  api,
  row,
  banks,
  onClose,
  onSaved,
}: {
  api: Api;
  row: Pending;
  banks: BankInfo[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState(row.q);
  const [answer, setAnswer] = useState(row.answer);
  const [wrongs, setWrongs] = useState<string[]>([
    row.wrongs[0] ?? '',
    row.wrongs[1] ?? '',
    row.wrongs[2] ?? '',
  ]);
  const [bank, setBank] = useState(row.bank ?? '');
  const [level, setLevel] = useState<number | null>(row.level);
  const [issues, setIssues] = useState<Issue[]>(row.issues);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filled = wrongs.filter((text) => text.trim());
  const gaps = [
    !bank && 'البنك',
    filled.length < 3 && `${3 - filled.length} من الخيارات الخاطئة`,
    !level && 'المستوى',
  ].filter(Boolean) as string[];
  const ready = gaps.length === 0;

  /*
   * الفحصُ لا يُستدعى إلا على سؤالٍ تامّ: «الخيارات ٢ والمطلوب أربعة» ليس
   * خبراً في صفحةٍ موضوعُها النقص، ويُغرق ما يُفيد من ملاحظات.
   */
  useEffect(() => {
    if (!ready) return setIssues([]);
    const timer = setTimeout(() => {
      void api
        .send<{ issues: Issue[] }>('POST', 'check', {
          q,
          options: [answer, ...filled],
          answer: 0,
          level,
        })
        .then((res) => setIssues(res.data?.issues ?? []));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, answer, wrongs, level, ready, api]);

  const errors = issues.filter((i) => i.severity === 'error');
  const warns = issues.filter((i) => i.severity === 'warn');
  const bare = !q.trim() || !answer.trim();

  const body = () => ({
    bank: bank || null,
    q: q.trim(),
    answer: answer.trim(),
    wrongs: filled,
    level,
  });

  const save = async () => {
    setBusy(true);
    setError('');
    const res = await api.send<{ error?: string }>('PUT', `pending/${row.id}`, body());
    setBusy(false);
    if (!res.ok) return setError(res.data?.error ?? 'لم يُحفظ');
    onSaved();
    onClose();
  };

  /* الاعتمادُ يحفظ أولاً: ما في الحقول هو ما يُعتمد لا ما في القاعدة */
  const approve = async () => {
    setBusy(true);
    setError('');
    const saved = await api.send<{ error?: string }>('PUT', `pending/${row.id}`, body());
    if (!saved.ok) {
      setBusy(false);
      return setError(saved.data?.error ?? 'لم يُحفظ');
    }
    const res = await api.send<{ error?: string }>('POST', `pending/${row.id}/approve`);
    setBusy(false);
    if (!res.ok) return setError(res.data?.error ?? 'تعذّر الاعتماد');
    toast('اعتُمد السؤال', {
      tone: 'safe',
      note: `دخل بنك ${banks.find((b) => b.id === bank)?.name}`,
    });
    onSaved();
    onClose();
  };

  return (
    <Modal
      title="إكمالُ سؤالٍ معلَّق"
      hint={ready ? undefined : `ينقصه: ${gaps.join(' و')}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={() => void approve()}
            disabled={busy || !ready || errors.length > 0}
            title={ready ? undefined : 'لا يُعتمد ناقصٌ — أكمِل التفاصيل أولاً'}
            className={`flex h-10 items-center gap-2 rounded-chip px-5 text-[14px] font-black transition ${
              busy || !ready || errors.length > 0
                ? 'cursor-not-allowed bg-line-2 text-white'
                : 'bg-signal-ink text-white hover:brightness-110'
            }`}
          >
            <CheckIcon size={15} />
            {busy ? 'يُعتمد…' : 'اعتمد'}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || bare}
            className="h-10 rounded-chip px-4 text-[14px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2 disabled:opacity-50"
          >
            احفظ
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-chip px-3 text-[14px] font-bold text-muted transition hover:text-ink"
          >
            إلغاء
          </button>
        </>
      }
    >
      {row.duplicate && (
        <p className="mb-5 rounded-chip bg-warn-2 px-3.5 py-2.5 text-[13px] leading-relaxed font-medium text-warn-ink">
          نصُّ هذا السؤال في بنك «{row.duplicate.bankName}» — فاعتمادُه يُثنّيه.
        </p>
      )}

      <Label>البنك</Label>
      <Select
        value={bank}
        onChange={setBank}
        choices={[
          { value: '', label: 'لم يُختر بعد' },
          ...banks.map((b) => ({
            value: b.id,
            label: b.active ? b.name : `${b.name} (مُلغى)`,
            hint: String(b.count),
          })),
        ]}
        className="mb-5"
      />

      <Label>نصّ السؤال</Label>
      <AutoTextarea
        value={q}
        onChange={(event) => setQ(arabizeDigits(event.target.value))}
        className="mb-5 rounded-chip bg-surface px-4 py-3 text-[15px] leading-relaxed font-bold shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
        autoFocus
      />

      <Label>الخيارات</Label>
      <div className="mb-5 grid gap-2.5 sm:grid-cols-2">
        <Slot
          value={answer}
          onChange={setAnswer}
          label="الصواب"
          placeholder="الإجابة الصحيحة"
          right
        />
        {wrongs.map((wrong, i) => (
          <Slot
            key={i}
            value={wrong}
            onChange={(next) => setWrongs(wrongs.map((w, j) => (j === i ? next : w)))}
            label={String(i + 1)}
            placeholder={`خطأ ${i + 1}`}
          />
        ))}
      </div>

      <Label>المستوى</Label>
      <div className="mb-5 flex gap-2">
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setLevel(level === n ? null : n)}
            className={`flex h-9 items-center gap-2 rounded-chip px-5 text-[13.5px] font-bold transition ${
              level === n
                ? LEVEL_SKIN[n]
                : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-surface-2'
            }`}
          >
            {level !== n && <Dot level={n} />}
            {LEVELS[n].label}
          </button>
        ))}
      </div>

      {issues.length > 0 && (
        <ul className="mb-3 grid gap-2">
          {errors.map((issue, i) => (
            <li
              key={`e${i}`}
              className="flex items-center gap-2.5 rounded-chip bg-danger-2 px-3.5 py-2.5 text-[13.5px] leading-snug font-bold text-danger-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_22%,transparent)]"
            >
              <b className="shrink-0">✖</b>
              <span>{issue.message}</span>
            </li>
          ))}
          {warns.map((issue, i) => (
            <li
              key={`w${i}`}
              className="flex items-center gap-2.5 rounded-chip bg-warn-2 px-3.5 py-2.5 text-[13.5px] leading-snug font-medium text-warn-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_25%,transparent)]"
            >
              <b className="shrink-0">⚠</b>
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-3 text-[14px] font-bold text-danger">{error}</p>}
    </Modal>
  );
}

const LEVEL_SKIN: Record<number, string> = {
  1: 'bg-safe-2 text-safe-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-safe)_35%,transparent)]',
  2: 'bg-warn-2 text-warn-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-warn)_30%,transparent)]',
  3: 'bg-danger-2 text-danger-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-danger)_30%,transparent)]',
};

function Slot({
  value,
  onChange,
  label,
  placeholder,
  right,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  placeholder: string;
  right?: boolean;
}) {
  return (
    <div
      className={`flex h-11 items-center gap-2.5 rounded-chip px-3 ${
        right
          ? 'bg-signal-2 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_35%,transparent)]'
          : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-2)]'
      }`}
    >
      <span
        className={`shrink-0 text-[11px] font-black ${right ? 'text-signal-ink' : 'text-faint'}`}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(arabizeDigits(event.target.value))}
        placeholder={placeholder}
        className={`min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint ${
          right ? 'font-black text-signal-ink' : 'font-bold text-ink'
        }`}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-[12.5px] font-bold text-ink-2">{children}</span>;
}
