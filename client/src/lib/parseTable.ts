/**
 * يحوّل جدولاً ملصوقاً من Excel أو Google Sheets إلى أسئلة.
 * عند نسخ خلايا من جدول، تُفصل الأعمدة بـ Tab والصفوف بسطر جديد.
 *
 * التخطيط: أول خلية = السؤال، آخر خلية = الإجابة الصحيحة،
 * والخلايا بينهما = الخيارات (من 2 إلى 4).
 * الإجابة تُقبل كرقم (1-4) أو حرف (أ ب ج د / a b c d) أو نص الخيار الصحيح.
 */

export interface ParsedQuestion {
  q: string;
  options: string[];
  answer: number;
}

export interface ParsedRow {
  line: number;
  ok: boolean;
  question?: ParsedQuestion;
  error?: string;
  raw: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  questions: ParsedQuestion[];
  validCount: number;
  errorCount: number;
}

const LETTER_INDEX: Record<string, number> = {
  أ: 0, ا: 0, ب: 1, ج: 2, د: 3,
  a: 0, b: 1, c: 2, d: 3,
};

const HEADER_HINT = /^(#|رقم|م|السؤال|سؤال|question|q)$/i;
const ANSWER_HEADER_HINT = /(الإجاب|الاجاب|الصحيح|answer|correct)/i;

/** يحوّل خلية الإجابة إلى فهرس (يبدأ من الصفر) أو -1 إن تعذّر */
function resolveAnswer(cell: string, options: string[]): number {
  const t = cell.trim();
  if (!t) return -1;

  // مطابقة نص أحد الخيارات حرفياً
  const byText = options.findIndex((o) => o === t);
  if (byText >= 0) return byText;

  const key = t.toLowerCase();
  if (key in LETTER_INDEX && LETTER_INDEX[key] < options.length) return LETTER_INDEX[key];

  const num = Number(t);
  if (Number.isInteger(num) && num >= 1 && num <= options.length) return num - 1;

  return -1;
}

function splitCells(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : line.includes('|') ? '|' : '\t';
  return line.split(delimiter).map((c) => c.trim());
}

/** يبدو صف عناوين: أعمدة كافية وكلمات دالة في الطرفين */
function looksLikeHeader(cells: string[]): boolean {
  return (
    cells.length >= 3 &&
    (HEADER_HINT.test(cells[0]) || ANSWER_HEADER_HINT.test(cells[cells.length - 1]))
  );
}

type CellResult = { ok: true; question: ParsedQuestion } | { ok: false; error: string };

function parseCells(cells: string[]): CellResult {
  if (cells.length < 4) {
    return { ok: false, error: 'أعمدة ناقصة — تحتاج: سؤال + خيارين على الأقل + الإجابة' };
  }
  const q = cells[0];
  const answerCell = cells[cells.length - 1];
  const options = cells.slice(1, -1);

  if (!q) return { ok: false, error: 'السؤال فارغ' };
  if (options.length > 4) return { ok: false, error: 'الخيارات أكثر من أربعة' };
  if (options.some((o) => !o)) return { ok: false, error: 'أحد الخيارات فارغ' };

  const answer = resolveAnswer(answerCell, options);
  if (answer < 0) {
    return { ok: false, error: `الإجابة «${answerCell}» غير مطابقة — اكتب نص الخيار الصحيح أو حرفه` };
  }
  return { ok: true, question: { q, options, answer } };
}

export function parseTable(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const rows: ParsedRow[] = [];

  lines.forEach((raw, i) => {
    const cells = splitCells(raw);
    const result = parseCells(cells);

    // نتخطّى الصف الأول بصمت فقط إن فشل كسؤال وبدا عنواناً
    if (!result.ok && i === 0 && looksLikeHeader(cells)) return;

    rows.push({ line: i + 1, raw, ...result });
  });

  const questions = rows.filter((r) => r.ok && r.question).map((r) => r.question!);
  return {
    rows,
    questions,
    validCount: questions.length,
    errorCount: rows.filter((r) => !r.ok).length,
  };
}

/** قالب جاهز يوضّح ترتيب الأعمدة — ينسخه المسؤول ويملؤه */
export const TEMPLATE_ROWS = [
  ['كم عدد أركان الإسلام؟', '3', '4', '5', '6', '5'],
  ['ما هي عاصمة السعودية؟', 'جدة', 'الرياض', 'الدمام', 'مكة', 'الرياض'],
];
