/**
 * قارئُ الأسئلة الملصوقة — سطرٌ لكل سؤال، عمودان فأكثر.
 *
 * والعمودان هما العهد: سؤالٌ ثم جوابُه الصحيح. وما زاد عليهما قُرئ ولم
 * يُطلب — ثلاثةُ أخطاءٍ ثم مستوًى ثم علمُ دولةٍ يُعرض مع السؤال (رمزُها
 * بحرفين: jp) — فمن لصق سطرين دخل سؤالُه ناقصاً
 * يُكمَل في اللوحة، ومن لصق ملفّاً كاملاً دخل سؤالُه جاهزاً للاعتماد.
 *
 * وقارئٌ واحدٌ للطريقين: اللصقُ في الصندوق وملفُّ CSV كلاهما نصٌّ يُرسل
 * في الحقل نفسه، فلا يختلف الفهمُ بينهما ولا تُكتب قاعدةٌ مرّتين.
 */

import { arabizeDigits, flagCode } from './banks.js';

/** حدٌّ للدفعة: مئةُ ألف حرفٍ تُقرأ، وما زاد يُقطع فلا تُخنق دورةُ الحدث */
export const MAX_TEXT = 100_000;
export const MAX_ROWS = 500;

/**
 * أسماءُ ترويسةٍ تُعرف فتُتجاوَز.
 *
 * من صدَّر من جدولٍ لصق معه سطرَ العنوان، ولو قُرئ سؤالاً لدخل «السؤال»
 * سؤالاً جوابُه «الإجابة». ولا يُتجاوَز إلا سطرٌ أول عمودُه وثانيه كلاهما
 * من هذه الأسماء — فجملةٌ تبدأ بكلمة «سؤال» لا تُبتلع.
 */
const HEAD_Q = new Set(['سؤال', 'السؤال', 'نص السؤال', 'نصّ السؤال', 'question', 'q']);
const HEAD_A = new Set([
  'جواب',
  'الجواب',
  'إجابة',
  'الإجابة',
  'الاجابة',
  'الإجابة الصحيحة',
  'الاجابة الصحيحة',
  'صواب',
  'الصواب',
  'answer',
  'correct',
]);

const LEVELS = new Map([
  ['1', 1],
  ['١', 1],
  ['سهل', 1],
  ['2', 2],
  ['٢', 2],
  ['متوسط', 2],
  ['وسط', 2],
  ['3', 3],
  ['٣', 3],
  ['صعب', 3],
]);

/** المستوى يُقرأ رقماً أو اسماً — وما لم يُفهم يُترك فارغاً لا يُفترض */
export function readLevel(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;
  return LEVELS.get(text) ?? null;
}

/**
 * يُقسم سطراً إلى خلايا.
 *
 * والفاصلُ يُستنبط من السطر نفسه لا يُسأل عنه المالك: الجدولةُ أولاً (وهي
 * ما يُلصق من جدول)، ثم العمودُ القائم، ثم الفاصلةُ — وآخرُها وحدها تحتمل
 * الاقتباسَ لأنها وحدها تقع في نصٍّ عربيّ. والفاصلةُ العربية «،» معها:
 * لوحةُ المفاتيح العربية لا تُخرج غيرها.
 */
function cells(line) {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes('|')) return line.split('|');
  return csvCells(line);
}

/**
 * فاصلةٌ باقتباس: "سؤالٌ، فيه فاصلة","جوابُه".
 *
 * والاقتباسُ المزدوج داخل المقتبس حرفٌ واحد ("" ← ") كما في CSV. ومن لم
 * يقتبس شيئاً مرّ سطرُه كما هو — فأكثرُ اللصق بلا اقتباس.
 */
function csvCells(line) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (ch === ',' || ch === '،') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/**
 * يقرأ النصَّ كلَّه: ما صلح صفوفاً، وما سقط بسببه.
 *
 * والساقطُ يُقال لا يُسكت عنه: من لصق أربعين سطراً فدخل سبعةٌ وثلاثون
 * يحتاج أن يعرف أيَّ ثلاثةٍ سقطت ولماذا — وإلا بحث عنها في البنك فلم
 * يجدها ولم يدرِ هل كتبها أصلاً.
 */
export function parseIntake(text) {
  const raw = String(text ?? '').slice(0, MAX_TEXT);
  const lines = raw.split(/\r\n|\r|\n/);
  const rows = [];
  const skipped = [];

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line.trim()) continue;

    const parts = cells(line).map((cell) => cell.trim());

    /* سطرُ الترويسة يُتجاوَز مرّةً: أوّلُ سطرٍ عمودُه الأول والثاني عنوانان */
    if (
      rows.length === 0 &&
      skipped.length === 0 &&
      HEAD_Q.has((parts[0] ?? '').toLowerCase()) &&
      HEAD_A.has((parts[1] ?? '').toLowerCase())
    ) {
      continue;
    }

    const q = arabizeDigits(parts[0] ?? '');
    const answer = arabizeDigits(parts[1] ?? '');

    if (!q) {
      skipped.push({ line: n + 1, text: line.slice(0, 80), why: 'لا نصَّ للسؤال' });
      continue;
    }
    if (!answer) {
      skipped.push({ line: n + 1, text: q.slice(0, 80), why: 'لا إجابةَ صحيحة' });
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      skipped.push({ line: n + 1, text: q.slice(0, 80), why: `تجاوز ${MAX_ROWS} سؤالاً في الدفعة` });
      continue;
    }

    /* الأخطاءُ الثلاثة إن لُصقت، والفارغُ منها يُسقَط لا يُحفظ خلاءً */
    const wrongs = parts
      .slice(2, 5)
      .map((cell) => arabizeDigits(cell))
      .filter(Boolean);

    rows.push({ q, answer, wrongs, level: readLevel(parts[5]), flag: flagCode(parts[6]) });
  }

  return { rows, skipped };
}
