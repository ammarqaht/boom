// اختبار قاعدتين تُصانان بالفحص لا بالانتباه: ترتيب البنوك، وسقف نقاط المركز
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const serverDir = join(process.cwd(), '..', 'server');
const { createRoom, DIFFICULTY } = await import(pathToFileURL(join(serverDir, 'game.js')).href);

const check = (label, ok) => console.log(`${ok ? '✅' : '❌'} ${label}`);

// ══ البنوك: الصواب أوّلاً دائماً ═══════════════════════════════
// الخلط يقع عند التوزيع لا في الملف، فموضع الصواب المحفوظ لا يراه لاعب.
// وثباتُه على الصفر يُسقط فرصة أن يُعاد ترتيب الخيارات يدوياً فيبقى
// المؤشّر على ما كان — وهو خطأٌ صامت لا يظهر إلا في وجه لاعب.
const banksDir = join(serverDir, 'banks');
const banks = readdirSync(banksDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(banksDir, f), 'utf8')));

const all = banks.flatMap((b) => b.questions.map((q) => ({ ...q, bank: b.id })));
console.log(`   ${banks.length} بنكاً · ${all.length} سؤالاً`);

/*
 * الفحص بقواعد server/audit.js نفسها التي تعمل في لوحة المالك وعند كل
 * إعادة قراءة — قاعدةٌ واحدة لا نسخةٌ ثانية هنا تتخلّف عن أختها.
 */
const { auditAll } = await import(pathToFileURL(join(serverDir, 'audit.js')).href);
const audit = auditAll(banks);
const errors = audit.issues.filter((row) => row.issues.some((i) => i.severity === 'error'));
const warnings = audit.issues.filter((row) => row.issues.every((i) => i.severity === 'warn'));

check('لا خطأ يكسر سؤالاً في أيّ بنك', errors.length === 0);
if (errors.length) {
  for (const row of errors.slice(0, 3)) {
    console.log(
      '   ✖',
      row.bank,
      row.issues.map((i) => i.message).join(' · '),
      '→',
      row.q.slice(0, 40),
    );
  }
}
check('ولا ملقّن يدلّ على الصواب', warnings.length === 0);
if (warnings.length) {
  for (const row of warnings.slice(0, 5)) {
    console.log('   ⚠', row.issues[0].message, '→', row.q.slice(0, 44));
  }
}
check('لا سؤال مكرّر بين البنوك', audit.duplicates.length === 0);
if (audit.duplicates.length) {
  for (const d of audit.duplicates.slice(0, 3))
    console.log('   ', d.banks.join('/'), d.q.slice(0, 44));
}

// ══ المستويات ═════════════════════════════════════════════════
check('أربعة مستويات: ابتدائي ومتوسط وثانوي وجامعي', Object.keys(DIFFICULTY).length === 4);
check(
  'الجامعي بلا سهل وأغلبه صعب',
  DIFFICULTY.university.mix[0] === 0 && DIFFICULTY.university.mix[2] >= 70,
);
check(
  'كل خلطة مجموعها مئة',
  Object.values(DIFFICULTY).every((d) => d.mix.reduce((a, b) => a + b, 0) === 100),
);

// ══ سقف نقاط المركز ═══════════════════════════════════════════
/** يُجري جولةً على n فريقاً، آخرهم يتوقّف نبضه، ويُرجع نقاط المركز بالترتيب */
function ladder(n) {
  const room = createRoom(['quran']);
  const teams = Array.from({ length: n }, (_, i) => room.addTeam(`فريق ${i + 1}`));
  room.start();
  const now = room.countdownEndsAt;
  room.tick(now);
  // أوقاتٌ متباعدة تُثبّت الترتيب، وآخرهم يسقط
  teams.forEach((t, i) => (t.timeMs = (n - i) * 1000));
  teams[n - 1].timeMs = 0;
  room.tick(now + 100);
  return room.result.awards.map((a) => a.points); // لا إجابات، فالنقاط هي نقاط المركز
}

console.log('   السلالم:', [2, 4, 6, 7, 20].map((n) => `${n}→${ladder(n).join('-')}`).join('  '));
check(
  'عشرون فريقاً: 5-4-3-2-1…-1-0',
  ladder(20).join('-') === '5-4-3-2-1-1-1-1-1-1-1-1-1-1-1-1-1-1-1-0',
);
check('سبعة فرق: 5-4-3-2-1-1-0', ladder(7).join('-') === '5-4-3-2-1-1-0');
check('ستّة فرق تبلغ السقف تماماً', ladder(6).join('-') === '5-4-3-2-1-0');
check('أقلّ من ستّة: الأول يأخذ عددهم ناقص واحد', ladder(4)[0] === 3 && ladder(2)[0] === 1);
check('من توقّف نبضه لا يأخذ نقطة مركز', ladder(20).at(-1) === 0);

process.exit(0);
