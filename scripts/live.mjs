/*
 * هل في القاعات أحدٌ الآن؟
 *
 * كلُّ دفعٍ إلى main ينشره Cranl فوراً ويعيد تشغيل السيرفر — فتتوقّف كلُّ
 * جولةٍ جارية، وينقطع كلُّ جوّال ثوانيَ ثم يعود إلى جولةٍ موقوفة ينتظر
 * المنظّمَ أن يستأنفها. فيُسأل هذا قبل الدفع:  npm run live
 *
 * ويُستعمل حارساً قبل الدفع (.githooks/pre-push، يُفعَّل بـ npm run hooks):
 * يرفض الدفع والجولةُ جارية، ويمرّ إن تعذّر السؤال — فانقطاعُ النت عندك
 * لا يحبس عملك. ولمن أراد الدفع رغم ذلك: git push --no-verify
 */
const URL = process.env.NABDA_URL || 'https://nabdah-st0gi3.cranl.net';
const guard = process.argv.includes('--guard');

try {
  const res = await fetch(`${URL}/api/live`, { signal: AbortSignal.timeout(6000) });
  const { live, rooms, players, connected } = await res.json();
  if (live) {
    console.log(`🔴 جولةٌ جارية الآن: ${rooms} غرفة، ${players} لاعباً متصلاً.`);
    console.log('   الدفع إلى main ينشر فوراً ويوقف جولاتهم — انتظر حتى تنتهي.');
    if (guard) {
      console.log('   (للدفع رغم ذلك: git push --no-verify)');
      process.exit(1);
    }
  } else if (connected > 0) {
    console.log(`🟡 لا جولة جارية، و${connected} لاعباً في غرف الانتظار — سينقطعون ثوانيَ ويعودون.`);
  } else {
    console.log('🟢 لا أحد يلعب الآن — الدفع آمن.');
  }
} catch (err) {
  console.log(`⚪ تعذّر سؤال ${URL}: ${err.message} — لا نحبس الدفع.`);
}
