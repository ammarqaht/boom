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
  const { live, rooms, players, connected, instance } = await res.json();

  /*
   * والمنصّة تشغّل نسخةً واحدة؟ الغرفُ في ذاكرة السيرفر، فلو شغّلت
   * نسختين لوصل نصفُ اللاعبين إلى نسخةٍ ليست فيها غرفتُهم. فيُسأل مرّات:
   * إن اختلفت هويّةُ المُجيب فهما اثنتان.
   */
  const seen = new Set([instance]);
  for (let i = 0; i < 6; i++) {
    const again = await (await fetch(`${URL}/api/live`, { signal: AbortSignal.timeout(6000) })).json();
    seen.add(again.instance);
  }
  if (seen.size > 1) {
    console.log(`⛔ المنصّة تشغّل ${seen.size} نسخ من السيرفر — اجعلها نسخةً واحدة في إعدادات Cranl، وإلا تفرّقت الغرف.`);
  }

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
