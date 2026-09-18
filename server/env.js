/**
 * قارئُ ملفّ `.env` — بلا مكتبة.
 *
 * المفاتيح لا تُكتب في الكود ولا تدخل git، ومتغيّرات النظام تُنسى وتحتاج
 * إعادةَ فتح النافذة. فملفٌّ واحد بجانب المشروع أسهل: تكتب فيه مفتاحك مرّة
 * ويبقى. وما يحتاجه من تحليلٍ عشرةُ أسطر، فلا معنى لإضافة تابعٍ لأجلها.
 *
 * ويُستورد أوّلَ شيء في index.js: ما بعده يقرأ process.env في جسم وحدته،
 * فلو تأخّر لقرأوا قبل أن يُملأ.
 *
 * وهو يتكلّم: يذكر ما قرأ عند الإقلاع، ويصيح على السطر المشوَّه برقمه.
 * ملفٌّ يحرّره إنسانٌ بيده لا يصلح أن يبتلع خطأه صامتاً — فمن كتب مفتاحه
 * ثم لم يدخل، يظنّ العلّة في كل شيءٍ إلا في سطرٍ نُسي فيه علامة مساواة.
 */
import { readFileSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const ENV_FILE = process.env.NABDA_ENV || join(root, '.env');

/* محرفُ ترتيب البايتات: محرّرات ويندوز تضعه في أول الملفّ وهو غير مرئيّ،
   فلو تُرك لالتصق بأول مفتاحٍ فلم يُطابق شيئاً. ويُكتب هروباً لا حرفاً
   لأن الحرف لا يُرى في الكود فيُظنّ الرمزُ خالياً. */
const BOM = '\u{FEFF}';

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * ما وضعه هذا الملفّ بنفسه.
 *
 * عليه تقوم قاعدتان معاً:
 *   • البيئة تغلب الملفّ — فما كان في process.env ولم نضعه نحن لا يُنقَض
 *     عليه، سواء جاء من أمر التشغيل أو وضعه الكود.
 *   • والتحرير يصل — فما وضعناه نحن يجوز لنا تبديله عند إعادة القراءة،
 *     وإلا لما نفع تحريرُ الملفّ إلا بإعادة تشغيل.
 *
 * ولا يكفي التقاطُ البيئة عند الاستيراد: ما يُضبط بعده برمجياً يُظنّ
 * قادماً من الملفّ فيُداس.
 */
const fromFile = new Set();

/** يقشر علامتَي اقتباسٍ محيطتين متطابقتين، ويُبقي ما بينهما كما هو */
function unquote(value) {
  const first = value[0];
  const last = value[value.length - 1];
  const quoted = value.length > 1 && first === last && (first === '"' || first === "'");
  return quoted ? value.slice(1, -1) : value;
}

/**
 * يقرأ الملفّ ويُرجع ما وجد: أسماء ما حُمِّل، وما تُخطّي ولماذا.
 *
 * ولا يُرجع القيم ولا يطبعها: مفتاحٌ يُكتب في سجلٍّ يُرى من وراء الكتف.
 */
export function readEnvFile(file = ENV_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { found: false, loaded: [], skipped: [], shadowed: [] };
  }
  if (text.startsWith(BOM)) text = text.slice(BOM.length);

  const loaded = [];
  const skipped = [];
  const shadowed = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const at = line.indexOf('=');

    if (at < 1) {
      skipped.push({ line: index + 1, why: 'لا علامة مساواة' });
      return;
    }

    const key = line
      .slice(0, at)
      .replace(/^export\s+/, '')
      .trim();

    if (!NAME.test(key)) {
      skipped.push({
        line: index + 1,
        why: `اسمٌ غير صالح «${key}» — الحروف اللاتينية والأرقام والشرطة السفلية فقط`,
      });
      return;
    }

    if (key in process.env && !fromFile.has(key)) {
      shadowed.push(key);
      return;
    }

    process.env[key] = unquote(line.slice(at + 1).trim());
    fromFile.add(key);
    loaded.push(key);
  });

  return { found: true, loaded, skipped, shadowed };
}

/** الشكل القديم: يُرجع العدد وحده — تستعمله الاختبارات وما بُني عليه */
export function loadEnv(file = ENV_FILE) {
  return readEnvFile(file).loaded.length;
}

/**
 * يُنبّه على ما في الملفّ — بالأسماء لا بالقيم.
 *
 * ولو لم يوجد الملفّ لم يقل شيئاً: أكثر التشغيلات بلا ملفّ، ولا معنى
 * لتحذيرٍ يتكرّر عند كل إقلاعٍ سليم.
 */
export function announce(result, label = '.env') {
  if (!result.found) return;
  if (result.loaded.length) {
    console.log(`   📄 ${label}: ${result.loaded.join('، ')}`);
  }
  for (const key of result.shadowed) {
    console.log(`   ↷ ${key} في ${label} لكنّ البيئة تغلبه — القيمة من أمر التشغيل`);
  }
  for (const bad of result.skipped) {
    console.warn(`   ⚠ ${label}:${bad.line} تُخطّي — ${bad.why}`);
  }
}

/**
 * مراقبة الملفّ: تُحرّره فيصل تحريرُك حالاً.
 *
 * وهذا ما كان ينقصه: القراءةُ عند الإقلاع وحدها تجعل من يُبدّل مفتاحه
 * يظنّ التبديلَ فاشلاً وهو إنما لم يُعد التشغيل. والتأخير يجمع كتابات
 * المحرّر المتتابعة في قراءةٍ واحدة.
 *
 * وما جاء من خارج الملفّ يبقى غالباً هنا أيضاً: لا يُبدَّل إلا ما وضعه
 * الملفّ نفسه.
 */
export function watchEnv(onChange, file = ENV_FILE) {
  let pending = null;
  /*
   * بصمةُ ما تُقرأ، لا مجرّد وقوع حدث.
   *
   * ويندوز يُطلق «تغيّر» مرّاتٍ للكتابة الواحدة، ومزامناتُ السحاب تلمس
   * الملفّ بلا أن تبدّل فيه حرفاً. فلو أعلنّا عند كل حدثٍ لقلنا «بُدِّل
   * المفتاح» ثلاثاً وهو لم يُبدَّل إلا مرّة — وخبرٌ كاذبٌ ثلاثاً أسوأ من
   * لا خبر.
   */
  let seen = snapshotOf(file);

  try {
    return watch(file, () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        const now = snapshotOf(file);
        if (now === seen) return; // لمسةٌ بلا تبديل
        seen = now;
        const result = readEnvFile(file);
        announce(result, '.env ↻');
        onChange?.(result);
      }, 200);
    });
  } catch {
    return null; // لا ملفّ أو نظامٌ لا يراقب — القراءة عند الإقلاع تكفي
  }
}

/** بصمةٌ لمحتوى الملفّ — لا تُحفظ القيم، إنما يُقارَن بها */
function snapshotOf(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export default readEnvFile();
