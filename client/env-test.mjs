// اختبار قارئ .env — بلا مكتبة، فحدوده تُحرَس بالفحص
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const { loadEnv, readEnvFile } = await import(
  pathToFileURL(join(process.cwd(), '..', 'server', 'env.js')).href
);

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

const dir = mkdtempSync(join(tmpdir(), 'nabda-env-'));
const file = join(dir, '.env');

// ما كان في البيئة قبل القراءة — يجب ألّا يُنقض عليه
process.env.NABDA_TEST_EXISTING = 'من-الأمر';

writeFileSync(
  file,
  '﻿' +
    [
      '# تعليق يُتجاهل',
      '',
      'NABDA_TEST_PLAIN=قيمة-عربية',
      '  NABDA_TEST_SPACED  =  حولها فراغ  ',
      'NABDA_TEST_QUOTED="  بين علامتين  "',
      "NABDA_TEST_SINGLE='مفتاح-فردي'",
      'NABDA_TEST_EQUALS=a=b=c',
      'export NABDA_TEST_EXPORT=بادئة-export',
      'NABDA_TEST_EXISTING=من-الملفّ',
      'NABDA_TEST_EMPTY=',
      'سطر-بلا-مساواة',
      '12BAD=مفتاح لا يبدأ بحرف',
      '=بلا مفتاح',
    ].join('\n'),
  'utf8',
);

const loaded = loadEnv(file);
console.log(`   قُرئ ${loaded} متغيّراً`);

check('قيمة عربية عادية', process.env.NABDA_TEST_PLAIN === 'قيمة-عربية');
check('الفراغ حول المفتاح والقيمة يُقشر', process.env.NABDA_TEST_SPACED === 'حولها فراغ');
check('ما بين علامتي اقتباس يُحفظ كما هو', process.env.NABDA_TEST_QUOTED === '  بين علامتين  ');
check('والاقتباس الفردي كذلك', process.env.NABDA_TEST_SINGLE === 'مفتاح-فردي');
check('علامة المساواة داخل القيمة تبقى', process.env.NABDA_TEST_EQUALS === 'a=b=c');
check('بادئة export تُقشر', process.env.NABDA_TEST_EXPORT === 'بادئة-export');
check('قيمةٌ فارغة تُقبل', process.env.NABDA_TEST_EMPTY === '');
check('البيئة تغلب الملفّ', process.env.NABDA_TEST_EXISTING === 'من-الأمر');
check('BOM لا يُفسد أول مفتاح', 'NABDA_TEST_PLAIN' in process.env);
check('سطرٌ بلا مساواة يُتجاهل', !('سطر-بلا-مساواة' in process.env));
check('مفتاحٌ يبدأ برقم يُرفض', !('12BAD' in process.env));
check('سطرٌ بلا مفتاح يُتجاهل', !('' in process.env));
check('ملفٌّ غير موجود لا يرمي', loadEnv(join(dir, 'لا-وجود-له')) === 0);

// ══ يتكلّم: يقول ما حمّل وما تخطّى ولماذا ══════════════════════
const told = readEnvFile(file);
check('يُخبر أن الملفّ وُجد', told.found === true);
check('ولا يُخبر عن ملفٍّ مفقود', readEnvFile(join(dir, 'لا-شيء')).found === false);
check('يُسمّي ما حُمِّل', told.loaded.includes('NABDA_TEST_PLAIN'));
check('ويُسمّي ما غلبته البيئة', told.shadowed.includes('NABDA_TEST_EXISTING'));

const bad = told.skipped;
check('ويشتكي من السطر المشوَّه برقمه', bad.length === 3 && bad.every((b) => b.line > 0));
check(
  'ويقول إن السطر بلا مساواة',
  bad.some((b) => b.why.includes('مساواة')),
);
check(
  'ويقول إن الاسم غير صالح',
  bad.some((b) => b.why.includes('غير صالح')),
);

// مفتاحٌ عربيّ — وهذا خطأٌ شائع في ملفٍّ عربيّ، فلا يُبتلع صامتاً
const arabicKeyFile = join(dir, '.env-arabic');
writeFileSync(arabicKeyFile, 'المفتاح=12345', 'utf8');
const arabic = readEnvFile(arabicKeyFile);
check(
  'اسمٌ عربيّ للمفتاح يُرفض ويُشتكى منه',
  arabic.loaded.length === 0 && arabic.skipped.length === 1,
);
check('ولا يُقبل صامتاً', arabic.skipped[0].why.includes('غير صالح'));

// ولا تُذكر القيم في شيءٍ ممّا يُعلَن — المفاتيح لا تُكتب في سجلّ
const said = JSON.stringify(told) + JSON.stringify(arabic);
check('ولا تُسرَّب قيمةٌ في ما يُعلَن', !said.includes('قيمة-عربية') && !said.includes('12345'));

rmSync(dir, { recursive: true, force: true });
process.exit(0);
