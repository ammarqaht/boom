import { useMemo, useState } from 'react';
import { parseTable, type ParsedQuestion } from '../lib/parseTable';
import { Field } from './ui';
import { CheckIcon, CloseIcon } from './icons';

/**
 * لصق جدول أسئلة من Excel أو Google Sheets.
 * يعرض معاينة حيّة بالأسئلة المقروءة والأخطاء، ويبلّغ الأب بالأسئلة الصالحة.
 */
export function CustomBankInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string, questions: ParsedQuestion[]) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const result = useMemo(() => parseTable(value), [value]);

  const update = (text: string) => onChange(text, parseTable(text).questions);

  const fillTemplate = () => {
    const sample = [
      'كم عدد أركان الإسلام؟\t3\t4\t5\t6\t5',
      'ما هي عاصمة السعودية؟\tجدة\tالرياض\tالدمام\tمكة\tالرياض',
      'ما لون السماء صباحاً؟\tأزرق\tأخضر\tأحمر\tأصفر\tأزرق',
    ].join('\n');
    update(sample);
  };

  const hasText = value.trim().length > 0;

  return (
    <Field label="بنك مخصص (اختياري) — الصق جدول أسئلتك">
      <div className="grid gap-2">
        <div className="rounded-xl border border-[#e8e4dd] bg-[#faf9f6] p-3 text-sm text-[#6b6b6b]">
          <p className="font-bold text-[#103f91]">كيف؟</p>
          <p className="mt-1 leading-relaxed">
            في Excel أو Google Sheets رتّب الأعمدة هكذا، ثم حدّد الجدول وانسخه (Ctrl+C) والصقه هنا:
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[26rem] border-collapse text-xs">
              <thead>
                <tr className="text-[#9a968f]">
                  <th className="border border-[#e8e4dd] px-2 py-1 font-bold">السؤال</th>
                  <th className="border border-[#e8e4dd] px-2 py-1 font-bold">خيار ١</th>
                  <th className="border border-[#e8e4dd] px-2 py-1 font-bold">خيار ٢</th>
                  <th className="border border-[#e8e4dd] px-2 py-1 font-bold">خيار ٣</th>
                  <th className="border border-[#e8e4dd] px-2 py-1 font-bold">خيار ٤</th>
                  <th className="border border-[#e8e4dd] bg-[#f1faf3] px-2 py-1 font-bold text-[#22a45d]">
                    الإجابة
                  </th>
                </tr>
              </thead>
              <tbody className="text-[#6b6b6b]">
                <tr>
                  <td className="border border-[#e8e4dd] px-2 py-1">عاصمة السعودية؟</td>
                  <td className="border border-[#e8e4dd] px-2 py-1">جدة</td>
                  <td className="border border-[#e8e4dd] px-2 py-1">الرياض</td>
                  <td className="border border-[#e8e4dd] px-2 py-1">الدمام</td>
                  <td className="border border-[#e8e4dd] px-2 py-1">مكة</td>
                  <td className="border border-[#e8e4dd] bg-[#f1faf3] px-2 py-1 font-bold text-[#22a45d]">
                    الرياض
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 leading-relaxed">
            الإجابة: اكتب <span className="font-bold">نص الخيار الصحيح</span> أو حرفه (أ ب ج د) أو ترتيبه
            (١ ٢ ٣ ٤). الخيارات من ٢ إلى ٤.
          </p>
          <button
            type="button"
            onClick={fillTemplate}
            className="mt-2 font-bold text-[#103f91] underline underline-offset-2"
          >
            جرّب بمثال جاهز
          </button>
        </div>

        <textarea
          value={value}
          onChange={(e) => update(e.target.value)}
          placeholder={'الصق جدولك هنا…\nعاصمة السعودية؟\tجدة\tالرياض\tالدمام\tمكة\tالرياض'}
          rows={5}
          dir="auto"
          className="w-full rounded-xl border border-[#e8e4dd] bg-white px-4 py-3 font-mono text-sm outline-none transition placeholder:text-[#b5b0a7] focus:border-[#ff9f1c]"
        />

        {hasText && (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1faf3] px-3 py-1 text-sm font-bold text-[#22a45d]">
                <CheckIcon size={14} strokeWidth={3} />
                {result.validCount} سؤال جاهز
              </span>
              {result.errorCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fdeae8] px-3 py-1 text-sm font-bold text-[#e52e25]">
                  <CloseIcon size={14} strokeWidth={3} />
                  {result.errorCount} سطر فيه خطأ
                </span>
              )}
              {result.validCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPreview((v) => !v)}
                  className="text-sm font-bold text-[#103f91] underline underline-offset-2"
                >
                  {showPreview ? 'إخفاء المعاينة' : 'معاينة الأسئلة'}
                </button>
              )}
            </div>

            {/* تحذير قلة الأسئلة — لا نمنع، بل ننبّه */}
            {result.validCount > 0 && result.validCount < 20 && (
              <p className="rounded-xl bg-[#fff6e8] px-3 py-2 text-sm font-bold text-[#e68500]">
                عدد قليل من الأسئلة قد يتكرر خلال الجولة — ننصح بـ ٣٠ سؤالاً فأكثر لتجربة أمتع.
              </p>
            )}

            {/* أسطر الأخطاء */}
            {result.errorCount > 0 && (
              <div className="grid gap-1 rounded-xl bg-[#fdeae8] p-3 text-sm text-[#c2231b]">
                {result.rows
                  .filter((r) => !r.ok)
                  .slice(0, 6)
                  .map((r) => (
                    <div key={r.line}>
                      <span className="font-black">سطر {r.line}:</span> {r.error}
                    </div>
                  ))}
                {result.rows.filter((r) => !r.ok).length > 6 && <div>…وأخطاء أخرى</div>}
              </div>
            )}

            {/* معاينة الأسئلة الصحيحة */}
            {showPreview && (
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-xl border border-[#e8e4dd] p-3">
                {result.rows
                  .filter((r) => r.ok && r.question)
                  .map((r, i) => (
                    <div key={r.line} className="rounded-lg bg-[#faf9f6] p-2.5 text-sm">
                      <p className="font-bold">
                        <span className="text-[#9a968f]">{i + 1}. </span>
                        {r.question!.q}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {r.question!.options.map((opt, oi) => (
                          <span
                            key={oi}
                            className={`rounded px-2 py-0.5 text-xs font-bold ${
                              oi === r.question!.answer
                                ? 'bg-[#22a45d] text-white'
                                : 'bg-white text-[#6b6b6b]'
                            }`}
                          >
                            {opt}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}
