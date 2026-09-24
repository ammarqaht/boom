# مهمّتان للنشر على CranL

> ملفُّ تسليم. اقرأه كاملاً قبل أن تبدأ — المهمّة الثانية فيها فخٌّ واحدٌ كبير
> إن لم تنتبه له كسرتَ حفظ البيانات وأنت تظنّ أنك أصلحته.

## ما هو المشروع

«نبضة» — لعبة مسابقة جماعية. ثلاث بوابات على سيرفرٍ واحد:

| المسار | لمن |
|---|---|
| `/admin` | المنظّم — يفتح الغرفة ويدير الجولات |
| `/play` | اللاعب — على جواله |
| `/display` | شاشة العرض — بروجكتر القاعة |
| `/console` | المالك — لوحة إدارة محميّة بمفتاح |

**التقنية:** Node ≥ 24 · Express · Socket.IO · React 19 + Vite + Tailwind 4 ·
وقاعدة `node:sqlite` المدمجة.

**البنية:** السيرفر في `server/`، والواجهة في `client/`. الغرفة الجارية في ذاكرة
العملية (`server/game.js`)، والسجلُّ الدائم في `server/store.js`.

```bash
npm install
npm start            # السيرفر على 3000 (يخدم client/dist)
npm run dev:client   # واجهة التطوير على 5173
npm test             # مجموعة الاختبارات — يجب أن تمرّ كلها
```

---

# المهمّة ١ — مفتاح لوحة المالك

**الحالة:** لا تحتاج كوداً. ضبطُ متغيّر بيئة في CranL.

لوحة المالك على `/console` محميّة بمفتاحٍ يُقرأ من `NABDA_OWNER_KEY`.
وإن لم يُضبط، يُولّد السيرفر مفتاحاً عشوائياً عند كل إقلاع ويطبعه في السجلّ —
أي أنه **يتبدّل مع كل نشر** فلا يصلح للإنتاج.

### الخطوات

1. لوحة CranL ← التطبيق ← **Environment Variables**
   (التوثيق: `docs.cranl.com/platform/environment-variables.html`)
2. أضف متغيّراً باسم `NABDA_OWNER_KEY`
3. القيمة — ولّد مفتاحاً قويّاً:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
   ```

4. احفظ ثم **أعد النشر** — المتغيّرات لا تُقرأ إلا عند إقلاع العملية.

### التحقّق

في سجلّ الإقلاع يجب أن تجد:

```
🔑 لوحة المالك على /console — المفتاح من NABDA_OWNER_KEY
```

وإن وجدت بدلاً منها `🔑 مفتاح لوحة المالك (مؤقّت …)` فالمتغيّر لم يصل.

> **ملاحظة:** المشروع يقرأ `.env` محليّاً أيضاً، و`process.env` **يغلب** الملفّ.
> فإن ضبطتَ المتغيّر في أمر التشغيل تجاهَل السيرفرُ ما في `.env` وطبع تنبيهاً بذلك.

### متغيّرات البيئة كلها

| المتغيّر | الوصف | مطلوب؟ |
|---|---|---|
| `NABDA_OWNER_KEY` | مفتاح `/console` | **نعم** في الإنتاج |
| `PORT` | منفذ السيرفر | تضبطه المنصّة عادةً |
| `NABDA_DB` | مسار ملفّ SQLite | اختياري — افتراضه `server/nabda.db` |

---

# المهمّة ٢ — نقل السجلّ من SQLite إلى PostgreSQL

## لماذا

تطبيقات CranL تعمل في حاويات تُبنى من جديد عند كل نشر، و**لم نجد في توثيق
المنصّة ميزةَ أقراصٍ دائمة (Volumes) تُركَّب على التطبيق**. الموجود عندهم:

- **Storage** — دِلاء S3 (تخزين كائنات، لا نظام ملفات — SQLite لا يعمل عليها)
- **Managed databases** — PostgreSQL · MySQL · MariaDB · MongoDB · Redis

وقاعدتنا ملفٌّ يكتبه التطبيق في `server/nabda.db` — فبلا قرصٍ دائم يبدأ
السجلُّ من الصفر مع كل نشر.

**الذي يضيع:** سجلّ الغرف وإحصاؤها · قياس الأسئلة (عُرض/صح/خطأ) · البلاغات ·
التعليقات وحالة «مقروء» · استئناف غرفةٍ جارية بعد إعادة تشغيل.

**الذي لا يضيع:** بنوك الأسئلة — ملفات JSON في `server/banks/` داخل المستودع.

> **قبل أن تبدأ:** اسأل دعم CranL إن كانت **Volumes** موجودة وغير موثّقة بعد.
> المنصّة جديدة وقد تسبق ميزاتُها وثائقَها. لو كانت موجودة فالحلّ دقيقتان —
> تركّب قرصاً على `server/` (أو توجّه `NABDA_DB` إلى داخله) وتُلغى هذه المهمّة كلّها.

## النطاق

**ملفٌّ واحد: `server/store.js`.** بقيّة المشروع لا تعرف ما تحته — تستورد دوالَّ
وتستدعيها. أبقِ **أسماء الدوالّ ومعاملاتها وشكل ما تُرجعه كما هي بالضبط**،
فيبقى `server/index.js` على حاله إلا فيما يخصّ `await` (انظر الفخّ أدناه).

### صادرات `store.js` التي يجب أن تبقى

```
RETENTION_DAYS   EDIT_DAYS
saveRoom(room)                      loadSnapshots(maxIdleMs)    forgetState(code)
recordStats(entries)                questionHealth({minShown, limit})
questionStat(id)                    reportCounts()              clearQuestion(id)
addFeedback(entry)                  listFeedback({kind, limit})
readFeedback(kind)                  unreadFeedback()
listRooms(days, range)
recordEdit(entry)   listEdits(days)   getEdit(id)   forgetEdit(id)
sweepOld()          close()
```

للتأكّد من القائمة:

```bash
grep -n "^export " server/store.js
grep -aon "store\.[a-zA-Z]*" server/index.js | sort -u
```

---

## ⚠ الفخّ: متزامن ← لا متزامن

هذا **أهمّ ما في المهمّة**.

`node:sqlite` يعمل بـ`DatabaseSync` — كل الاستدعاءات **متزامنة** وترجع بقيمها
فوراً. وأيُّ عميل PostgreSQL في Node **لا متزامن** ويرجع وعوداً.

فتحويلُ `store.js` يجعل كل دوالّه `async`، وكلُّ مستدعٍ لها يحتاج `await`.
ولن يُنبّهك المترجم: ستُرجِع الدالّةُ `Promise` فيُعامَل كأنه بيانات، ويعمل
التطبيق بلا خطأ ظاهر ويكتب بيانات فارغة.

### المواضع التي يجب أن تنتبه لها في `server/index.js`

**١. الإغلاق المقصود — الأخطر:**

```js
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flush();          // صار async
    store.close();
    process.exit(0);  // ← سينفّذ قبل أن تكتمل الكتابة فيضيع آخر ما عندك
  });
}
```

يجب أن يصير:

```js
process.on(signal, async () => {
  await flush();
  await store.close();
  process.exit(0);
});
```

**٢. حلقة الكتابة الدورية `flush()`** — تُنادى من `setInterval` كل بضع ثوانٍ،
وفيها `recordStats` و`saveRoom` داخل `try/catch` يُعيد المحاولة عند الفشل.
اجعلها `async`، و**امنع تداخل الدورات**: لو تأخّرت دورةٌ عن المهلة بدأت التي
بعدها فوقها. استعمل رايةً:

```js
let flushing = false;
setInterval(async () => {
  if (flushing) return;
  flushing = true;
  try { await flush(); } finally { flushing = false; }
}, SAVE_MS);
```

**٣. الإقلاع:** `store.loadSnapshots(...)` و`store.sweepOld()` يُستدعيان في
أعلى الوحدة عند بدء التشغيل لبعث الغرف من القرص — قبل أن يبدأ السيرفر في
الاستماع. والمشروع ESM (`"type": "module"`)، فـ`await` في أعلى الوحدة يعمل
مباشرةً ولا يحتاج التفافاً في دالّة:

```js
const revived = await store.loadSnapshots(IDLE_ROOM_MS);
…
await store.sweepOld();
```

**٤. `store.listRooms()` داخل `http.listen(...)`** في سطر الطباعة.

**٥. مسارات Express** — اجعل المعالج `async` وأضف `await`. وانتبه: الاستثناء
داخل معالجٍ async في Express 4 **لا يُلتقط تلقائياً** — لُفّ بـ`try/catch`
وأرجع 500، وإلا سقط الطلب صامتاً.

**٦. معالجات Socket.IO** (`addFeedback` في ثلاثة مواضع) — اجعلها async
واحرص أن يُستدعى `reply(...)` **بعد** اكتمال الكتابة.

**٧. `setInterval(() => store.sweepOld(), ...)`** ومعالج الغرف الخاملة.

> **بديلٌ يوفّر كل هذا:** أبقِ الدوالَّ متزامنةً في الظاهر باستعمال ذاكرةٍ
> وسيطة — تُقرأ من الذاكرة وتُكتب في الخلفية. **لا تفعل.** تعقيدٌ أكبر ومخاطرُ
> فقدٍ أعلى. التحويل إلى async هو الطريق المستقيم.

---

## تحويل لهجة SQL

المخطَّط كلّه في أعلى `server/store.js` داخل `db.exec(\`…\`)`. هذه مواضع
الاختلاف — اجمعها بـ:

```bash
grep -n "AUTOINCREMENT\|PRAGMA\|CAST(\|MAX(\|lastInsertRowid\|BEGIN\|IS NULL OR" server/store.js
```

| SQLite | PostgreSQL | ملاحظة |
|---|---|---|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `GENERATED ALWAYS AS IDENTITY` أو `BIGSERIAL` | في جدولَي `feedback` و`edits` |
| `?` للمعاملات | `$1, $2, …` | مرقَّمة لا موضعية |
| `db.prepare(sql).run/get/all(...)` | `pool.query(sql, params)` | والنتائج في `res.rows` |
| `info.lastInsertRowid` | `RETURNING id` ثم `res.rows[0].id` | في `addFeedback` و`recordEdit` |
| `MAX(correct + wrong, 1)` | **`GREATEST(correct + wrong, 1)`** | ⚠ `MAX` في Postgres دالّةُ تجميع لا دالّةَ قيمتين — أكثرُ خطأٍ يقع هنا |
| `CAST(correct AS REAL)` | `correct::real` | أو أبقِ `CAST` فهو قياسيّ |
| `(? IS NULL OR kind = ?)` | `($1::text IS NULL OR kind = $1)` | معاملٌ واحد يُعاد استعماله؛ والقولبة لازمة لمقارنة NULL |
| `PRAGMA journal_mode/synchronous/foreign_keys` | تُحذف | لا مقابل لها |
| `PRAGMA table_info(feedback)` | استعلام `information_schema.columns` | تُستعمل في ترقية عمود `read_at` |
| `db.exec('BEGIN' / 'COMMIT' / 'ROLLBACK')` | احجز عميلاً من المجمّع: `client.query('BEGIN')` … `client.release()` | ⚠ المعاملة يجب أن تجري على **عميلٍ واحد**، لا على المجمّع |
| `TEXT` لأزمنة المللي | `BIGINT` | أرقام JS آمنة حتى 2^53 |
| `snapshot TEXT` (JSON) | أبقِها `TEXT` | `JSONB` تُغري لكنها تغيّرٌ لا حاجة له الآن |

**المعاملات (transactions):** موضعان — `saveRoom` و`recordStats`. كلاهما
يكتب دفعةً واحدة «إما الكلّ أو لا شيء». احجز عميلاً من المجمّع، و`BEGIN`،
ثم `COMMIT` أو `ROLLBACK` في `catch`، و`release()` في `finally` **دائماً**
وإلا سرّبت اتصالات حتى ينفد المجمّع ويتجمّد التطبيق.

**`ON CONFLICT … DO UPDATE SET x = excluded.x`** — تعمل في Postgres كما هي.
لا تغيّرها.

---

## الاتصال والإعداد

استعمل `pg` (`npm i pg`). ولا تفتح اتصالاً لكل استعلام — مجمّعٌ واحد للعملية:

```js
import { Pool } from 'pg';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
  max: 10,
});
```

- في CranL: أنشئ **Managed PostgreSQL** في نفس المنطقة، وخذ رابط الاتصال
  وضعه في متغيّر `DATABASE_URL` بنفس طريقة المهمّة ١.
- أبقِ `NABDA_DB` مذكوراً في `README` أو احذفه — لم يعد له معنى بعد النقل.
- أنشئ الجداول عند الإقلاع بـ`CREATE TABLE IF NOT EXISTS` كما هي الآن، فينشأ
  المخطّط من نفسه في أيّ بيئة جديدة.

---

## نقل البيانات القائمة (اختياري)

إن أردتَ ترحيل ما في `server/nabda.db` عند المالك — اكتب سكربتاً لمرّةٍ واحدة
يقرأ من SQLite بـ`node:sqlite` ويكتب في Postgres جدولاً جدولاً. الجداول:
`rooms` · `room_state` · `question_stats` · `feedback` · `edits`.

وإن لم يكن السجلُّ القديم مهمّاً فابدأ من فارغ — أبسط وأسلم.

---

## ما لا تمسّه

- `server/game.js` — منطق اللعبة كلّه. لا علاقة له بالتخزين.
- `server/banks/` و`server/banks.js` — الأسئلة ملفات JSON عمداً: نصٌّ يُراجَع
  ويدخل git. **لا تنقلها إلى القاعدة.**
- `client/` كلّه — لا يعرف شيئاً عن التخزين.
- أسماء دوالّ `store.js` وشكل ما تُرجعه.

---

## الاختبار والقبول

```bash
npm test
```

المجموعة فيها `memory-test.mjs` يستورد `store.js` مباشرة ويختبره — **سيحتاج
تعديلاً ليُنتظر الوعود** (`await`). عدّله ولا تحذف اختباراً.

واختبر يدويّاً:

- [ ] افتح غرفة، العب جولتين، أنهِ اللعبة
- [ ] **أعد تشغيل السيرفر** — ثم افتح `/console`: الغرفة وإحصاؤها باقيان
- [ ] قياس الأسئلة يتراكم (عُرض/صح/خطأ) بعد إعادة التشغيل
- [ ] أرسل تعليقاً من شاشة النهاية — يظهر في `/console` بنقطة «لم يُقرأ»
- [ ] «قراءة الكل» يعمل، ويبقى الأثر بعد إعادة التشغيل
- [ ] بلاغٌ على سؤال يصل
- [ ] أوقف السيرفر بـ`Ctrl+C` أثناء جولة — ثم شغّله: الغرفة تعود **موقوفة**
      (هذا مقصود: السيرفر لا يعرف كم ضاع من الوقت، فالقرار للمنظّم)
- [ ] صفحة الغرف في `/console`: التقويم والمدى يعملان
- [ ] لا تسريب اتصالات: شغّل نصف ساعة وراقب عدد اتصالات القاعدة — يجب أن يستقرّ

### أعلام حمراء تعني أنك وقعت في الفخّ

- عددُ الغرف يُطبع `0` عند الإقلاع وفي القاعدة غرف
- `[object Promise]` في أيّ سجلّ أو رد
- السجلّ يفقد آخر دقيقةٍ عند كل إيقاف → `flush` لم يُنتظر قبل `process.exit`
- التطبيق يتجمّد بعد ساعة → عميلُ معاملةٍ لم يُعَد إلى المجمّع

---

## ثلاثة أمورٍ أخرى في النشر

**نسخة واحدة فقط** — بلا autoscaling ولا replicas. حالةُ الغرفة الجارية في
ذاكرة العملية، فلو عملت نسختان انضمّ فريقٌ لواحدة وفريقٌ لأخرى ولا يرى
أحدُهما الآخر. (وهذا لا يتغيّر بالنقل إلى Postgres — الغرفة الجارية تبقى
في الذاكرة عمداً: الوقت يُحسب كل ٢٥٠ مللي‑ثانية ولا يحتمل رحلةً إلى القاعدة.)

**Node ≥ 24** — مثبّتٌ في `.node-version` و`engines` في `package.json`.
بعد النقل إلى Postgres لن يبقى `node:sqlite` مطلوباً، فيمكن خفضُ الحدّ —
لكن لا تفعل إلا بعد أن تتأكّد أن الاختبارات تمرّ على النسخة الأدنى.

**المنصّة يجب أن تدعم WebSocket والخوادم الدائمة** — اللعبة على Socket.IO
واتصالٍ دائم، ولا تصلح معها المنصّات الـ serverless.

---

## البناء والتشغيل على المنصّة

| | |
|---|---|
| البناء | `npm run build` |
| التشغيل | `npm start` |
| فحص الصحة | `/api/health` |

`npm run build` يبني الواجهة في `client/dist`، و`npm start` يخدمها مع الـAPI
من عمليةٍ واحدة على `PORT`.
