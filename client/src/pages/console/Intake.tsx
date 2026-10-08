import { useRef, useState } from 'react';
import { Flag, Select, toast } from '../../components/ui';
import { ImportIcon } from '../../components/icons';
import { type Api, Badge, Dot, LEVELS, Modal, say, unit } from './shared';
import type { BankInfo } from './Banks';
import type { Pending } from './Pending';

/**
 * استيرادُ دفعة — لصقاً أو ملفَّ CSV.
 *
 * والطريقان نصٌّ واحد: ملفُّ CSV يُقرأ في المتصفّح ويُسكب في الصندوق نفسه،
 * فيراه المالكُ قبل أن يُرسل، ويُصحّح فيه سطراً إن شاء. ولا قارئَ ثانياً
 * على الخادم ولا رفعَ ملفٍّ بصيغةٍ أخرى.
 *
 * وما يدخل يدخل معلَّقاً: لا يراه لاعبٌ حتى يُعتمد. فمئةُ سطرٍ ملصوقةٍ
 * لا تُفسد بنكاً — إنما تنتظر في قائمةٍ تُراجَع.
 */

const SAMPLE = `ما أطولُ سورةٍ في القرآن؟\tالبقرة
كم عدد أركان الإسلام؟\tخمسة\tأربعة\tستة\tسبعة\tسهل`;

type Report = {
  rows: Pending[];
  skipped: { line: number; text: string; why: string }[];
  max: number;
};

export default function Intake({
  api,
  banks,
  bank,
  onClose,
  onDone,
}: {
  api: Api;
  banks: BankInfo[];
  bank: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [target, setTarget] = useState(bank);
  const [source, setSource] = useState<'paste' | 'csv'>('paste');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);

  /* كلُّ تبديلٍ في النصّ يُبطل المعاينة: معاينةٌ لنصٍّ آخر كذبٌ مرتّب */
  const write = (next: string) => {
    setText(next);
    setReport(null);
    setError('');
  };

  const pick = async (chosen: File | undefined) => {
    if (!chosen) return;
    if (chosen.size > 2_000_000) return setError('الملفُّ أكبرُ من ميغابايتين');
    write(await chosen.text());
    setSource('csv');
  };

  const look = async () => {
    setBusy(true);
    setError('');
    const res = await api.send<Report & { error?: string }>('POST', 'pending/import', {
      text,
      bank: target || null,
      source,
      dry: true,
    });
    setBusy(false);
    if (!res.ok || !res.data) return setError(res.data?.error ?? 'تعذّرت القراءة');
    setReport(res.data);
  };

  const commit = async () => {
    setBusy(true);
    setError('');
    const res = await api.send<{ added?: number; error?: string }>('POST', 'pending/import', {
      text,
      bank: target || null,
      source,
    });
    setBusy(false);
    if (!res.ok) return setError(res.data?.error ?? 'تعذّر الاستيراد');
    const added = res.data?.added ?? 0;
    toast(added ? `أُدخل ${say(added, 'question')}` : 'لا سؤالَ صالحاً في النصّ', {
      tone: added ? 'safe' : 'danger',
      note: added ? 'في قائمة المعلّقة — تنتظر المراجعة' : 'راجع الفواصل بين العمودين',
    });
    onDone();
    onClose();
  };

  const bankName = banks.find((b) => b.id === target)?.name;
  const ready = report?.rows.filter((row) => row.ready).length ?? 0;
  const twins = report?.rows.filter((row) => row.duplicate || row.twin).length ?? 0;

  return (
    <Modal
      title="استيرادُ أسئلة"
      onClose={onClose}
      wide
      footer={
        <>
          {report ? (
            <button
              type="button"
              onClick={() => void commit()}
              disabled={busy || report.rows.length === 0}
              className={`flex h-10 items-center gap-2 rounded-chip px-5 text-[14px] font-black transition ${
                busy || report.rows.length === 0
                  ? 'cursor-not-allowed bg-line-2 text-white'
                  : 'bg-signal-ink text-white hover:brightness-110'
              }`}
            >
              <ImportIcon size={15} />
              {busy ? 'يُستورد…' : `أدخِل ${say(report.rows.length, 'question')} معلَّقةً`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void look()}
              disabled={busy || !text.trim()}
              className={`h-10 rounded-chip px-5 text-[14px] font-black transition ${
                busy || !text.trim()
                  ? 'cursor-not-allowed bg-line-2 text-white'
                  : 'bg-signal-ink text-white hover:brightness-110'
              }`}
            >
              {busy ? 'يُقرأ…' : 'اقرأ النصّ'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-chip px-4 text-[14px] font-bold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:bg-surface-2"
          >
            إلغاء
          </button>
        </>
      }
    >
      <Label>البنك — يُسنَد إليه ما يُستورَد</Label>
      <Select
        value={target}
        onChange={(next) => {
          setTarget(next);
          setReport(null);
        }}
        choices={[
          { value: '', label: 'بلا بنك — يُختار لكلٍّ عند المراجعة' },
          ...banks.map((b) => ({
            value: b.id,
            label: b.active ? b.name : `${b.name} (مُلغى)`,
            hint: String(b.count),
          })),
        ]}
        className="mb-5"
      />

      {/*
        الصيغةُ في سطر العنوان لا في فقرةٍ تحت الصندوق.
        وهي من الكابشنز التي تبقى: صيغةُ إدخالٍ لا تُخمَّن، ومن لم يُخبَر
        بترتيب الأعمدة لصق دفعةً مقلوبة.
      */}
      <Label>
        سطرٌ لكل سؤال: السؤال · الإجابة · ثلاثة أخطاء · المستوى — يفصلها Tab أو فاصلة أو |
      </Label>
      <textarea
        value={text}
        onChange={(event) => write(event.target.value)}
        dir="auto"
        placeholder={SAMPLE}
        spellCheck={false}
        className="no-bar mb-2 h-56 w-full resize-y rounded-chip bg-surface px-4 py-3 text-[14px] leading-relaxed font-medium shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={(event) => void pick(event.target.files?.[0])}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="flex h-9 items-center gap-2 rounded-chip px-3.5 text-[13px] font-bold text-signal-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-signal)_30%,transparent)] transition hover:bg-signal-2"
        >
          <ImportIcon size={14} />
          اقرأ ملفَّ CSV
        </button>
      </div>

      {error && <p className="mb-4 text-[14px] font-bold text-danger">{error}</p>}

      {report && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-chip bg-surface-2 px-4 py-3 text-[13.5px] font-medium text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
            <span>
              فُهم <b className="tnum text-ink">{report.rows.length}</b>{' '}
              {unit(report.rows.length, 'question')}
            </span>
            <span>
              منها <b className="tnum text-signal-ink">{ready}</b> كاملة
            </span>
            {twins > 0 && (
              <span>
                و<b className="tnum text-warn-ink">{twins}</b> مكرّرة
              </span>
            )}
            {report.skipped.length > 0 && (
              <span>
                وسقط <b className="tnum text-danger">{report.skipped.length}</b>{' '}
                {unit(report.skipped.length, 'line')}
              </span>
            )}
            {bankName && <span>إلى بنك {bankName}</span>}
          </div>

          {report.skipped.length > 0 && (
            <div className="mb-4 rounded-card bg-danger-2 px-4 py-3">
              <b className="block text-[13px] font-black text-danger-ink">
                سطورٌ لم تُفهم — ولن تدخل
              </b>
              <ul className="mt-2 grid gap-1">
                {report.skipped.slice(0, 12).map((row) => (
                  <li key={row.line} className="text-[12.5px] leading-snug font-medium text-danger-ink">
                    <span className="tnum">سطر {row.line}</span> · {row.why}
                    {row.text && <span className="text-faint"> — {row.text}</span>}
                  </li>
                ))}
                {report.skipped.length > 12 && (
                  <li className="text-[12.5px] font-bold text-danger-ink">
                    و{report.skipped.length - 12} غيرها
                  </li>
                )}
              </ul>
            </div>
          )}

          {report.rows.length > 0 && (
            <div className="rounded-card shadow-[inset_0_0_0_1px_var(--color-line)]">
              {report.rows.slice(0, 40).map((row, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-soft px-4 py-2.5 last:border-0"
                >
                  {row.level ? <Dot level={row.level} /> : null}
                  <b className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{row.q}</b>
                  {row.flag && <Flag code={row.flag} className="h-[15px]" />}
                  <span className="shrink-0 text-[13px] font-black text-signal-ink">
                    {row.answer}
                  </span>
                  {row.wrongs.length > 0 && (
                    <span className="shrink-0 text-[12px] text-faint">
                      +{row.wrongs.length} خطأ
                    </span>
                  )}
                  {row.level ? (
                    <Badge>{LEVELS[row.level].label}</Badge>
                  ) : null}
                  {row.duplicate ? (
                    <Badge tone="warn">مكرّر · {row.duplicate.bankName}</Badge>
                  ) : row.twin ? (
                    /* قد يكون توأمُه في هذه الدفعة أو معلَّقاً من لصقةٍ قبلها */
                    <Badge tone="warn">مكرّر في المعلّقة</Badge>
                  ) : null}
                  {/* القرصان نفسُهما اللذان في قائمة المعلّقة — لا اسمان لحالٍ واحدة */}
                  <Badge tone={row.ready ? 'signal' : 'warn'}>
                    {row.ready ? 'ينتظر الاعتماد' : 'ناقص'}
                  </Badge>
                </div>
              ))}
              {report.rows.length > 40 && (
                <p className="px-4 py-2.5 text-[12.5px] font-bold text-faint">
                  و{report.rows.length - 40} سؤالاً غيرها تدخل كما تدخل هذه
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-2 block text-[12.5px] font-bold text-ink-2">{children}</span>;
}
