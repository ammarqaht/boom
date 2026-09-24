/**
 * ذاكرة النبضة — سجلّ الغرف ولقطاتها الحيّة.
 *
 * الغرف كانت تعيش في الذاكرة وحدها: تسقط العملية فتذهب مسابقةٌ في
 * منتصفها، وتنتهي المسابقة فلا يبقى منها خبر. هنا تُكتب في قاعدة.
 *
 * ولماذا PostgreSQL لا ملفٌّ كما كانت؟ لأن التطبيق يعمل في حاويةٍ تُبنى
 * من جديد عند كل نشر، ولا أقراصَ دائمة في المنصّة — فملفُّ SQLite يُمحى
 * مع كل دفعة. والقاعدة المُدارة تعيش خارج الحاوية فتبقى.
 *
 * وتبقى بنوك الأسئلة ملفات JSON: نصٌّ يُراجَع ويدخل git. القاعدة
 * للأحداث والقياسات، لا للمحتوى.
 *
 * ⚠ كل دالّةٍ هنا لا متزامنة — بخلاف ما كانت عليه مع node:sqlite. من
 * ناداها بلا await أخذ وعداً وحسبه بيانات، فكتب فراغاً بلا خطأ يظهر.
 */
import pg from 'pg';

const { Pool, types } = pg;

/*
 * BIGINT يعود نصّاً لا رقماً.
 *
 * وهذا أخطر ما في النقل: أزمنتنا كلها مللي منذ الحقبة، فلو عادت سلاسل
 * لصار `ended_at - started_at` عمليةً على نصّين، ولخرجت الأزمنة إلى
 * الواجهة مقتبسة فانكسر كل ترتيبٍ وحساب — بلا استثناءٍ واحد يُنبّه.
 *
 * والتحويل آمن: أكبر ما نخزّنه زمنٌ بالمللي، وهو دون 2^53 بقرونٍ طويلة.
 */
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 60;

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.PG_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL غير مضبوط — النبضة تحفظ سجلّها في PostgreSQL.\n' +
      '  محلياً: DATABASE_URL=postgres://localhost/nabda npm start\n' +
      '  على المنصّة: أنشئ قاعدة مُدارة واربطها بالتطبيق فتُحقن من نفسها.',
  );
}

/*
 * التعمية: مطلوبةٌ على الشبكة، ومرفوضةٌ على الجهاز.
 *
 * والقواعد المُدارة تقدّم شهاداتٍ موقّعةً من سلطتها هي، فالتحقّق منها
 * بجذور النظام يفشل. ونحن نثق بالمضيف الذي أعطتنا المنصّة عنوانه، فيبقى
 * السرّ محمياً في الطريق وإن لم تُتحقَّق الشهادة.
 */
function sslFor(connectionString) {
  if (process.env.PGSSL === 'off') return false;
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get('sslmode') === 'disable') return false;
    if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return false;
  } catch {
    /* رابطٌ لا يُحلَّل — نُبقي التعمية، وهي الأسلم */
  }
  return { rejectUnauthorized: false };
}

/*
 * مجمّعٌ واحد للعملية كلها. وفتحُ اتصالٍ لكل استعلام يقتل الأداء ويستنفد
 * حصّة القاعدة؛ وعشرةٌ تكفي: نحن عمليةٌ واحدة تكتب كل ثانيتين.
 */
const pool = new Pool({ connectionString: url, ssl: sslFor(url), max: 10 });

/*
 * خطأٌ في عميلٍ خاملٍ داخل المجمّع لا مستدعيَ له، فإن تُرك بلا مستمع
 * أسقط العملية كلها. القاعدة تُعيد الاتصال بنفسها — فنسجّل ونمضي.
 */
pool.on('error', (err) => console.warn('⚠ اتصالٌ خاملٌ سقط من المجمّع:', err.message));

const q = (text, params) => pool.query(text, params);

await pool.query(`
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    bank_ids   TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    touched_at BIGINT NOT NULL,
    started_at BIGINT,
    ended_at   BIGINT,
    rounds     INTEGER NOT NULL DEFAULT 0,
    players    INTEGER NOT NULL DEFAULT 0,
    questions  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS room_state (
    code     TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,
    saved_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS question_stats (
    question_id TEXT PRIMARY KEY,
    bank_id     TEXT NOT NULL,
    level       INTEGER NOT NULL,
    text        TEXT NOT NULL,
    shown       INTEGER NOT NULL DEFAULT 0,
    correct     INTEGER NOT NULL DEFAULT 0,
    wrong       INTEGER NOT NULL DEFAULT 0,
    last_at     BIGINT NOT NULL
  );

  /*
    * البلاغات والتعليقات في جدولٍ واحد مصنَّف: كلاهما رأيٌ يُرفع من داخل
    * اللعبة، ويُقرآن معاً في لوحة المالك. وبلاغُ السؤال بلا هويّة عمداً —
    * المهمّ السؤال لا من رآه.
    */
  CREATE TABLE IF NOT EXISTS feedback (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        TEXT NOT NULL,
    question_id TEXT,
    question    TEXT,
    room_code   TEXT,
    room_name   TEXT,
    reason      TEXT,
    note        TEXT,
    stars       INTEGER,
    by_role     TEXT,
    by_name     TEXT,
    created_at  BIGINT NOT NULL,
    read_at     BIGINT
  );

  /*
    * أرشيفُ التحرير: نسخةُ السؤال قبل تغييره أو حذفه.
    *
    * تحريرُ السؤال يمحو إحصاءه — فالمقاس كان لنصٍّ غير هذا النصّ — والمحوُ
    * لا رجعة فيه. فتُحفظ النسخة القديمة ثلاثين يوماً: يراجعها المالك، أو
    * يُرجعها إن تبيّن أن التحرير كان خطأ.
    */
  CREATE TABLE IF NOT EXISTS edits (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        TEXT NOT NULL,
    bank_id     TEXT NOT NULL,
    old_id      TEXT NOT NULL,
    new_id      TEXT,
    old_q       TEXT NOT NULL,
    old_options TEXT NOT NULL,
    old_level   INTEGER NOT NULL,
    new_q       TEXT,
    new_options TEXT,
    new_level   INTEGER,
    shown       INTEGER NOT NULL DEFAULT 0,
    correct     INTEGER NOT NULL DEFAULT 0,
    wrong       INTEGER NOT NULL DEFAULT 0,
    reports     INTEGER NOT NULL DEFAULT 0,
    at          BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS rooms_created ON rooms (created_at DESC);
  CREATE INDEX IF NOT EXISTS edits_at ON edits (at DESC);
  CREATE INDEX IF NOT EXISTS stats_bank ON question_stats (bank_id);
  CREATE INDEX IF NOT EXISTS feedback_kind ON feedback (kind, created_at DESC);
  CREATE INDEX IF NOT EXISTS feedback_question ON feedback (question_id);
`);

/*
 * ترقيةٌ في مكانها: «متى قُرئ».
 *
 * القواعد التي أُنشئت قبل العمود لا تعرفه. وبوستجرس يحتمل ADD COLUMN IF
 * NOT EXISTS، لكنّا نسأل أولاً لنعرف: أضفناه الآن فما قبله يُحسب مقروءاً —
 * تاريخٌ كامل يظهر فجأةً غيرَ مقروء إنذارٌ كاذب، والمالك لم يُقصّر في شيء.
 */
{
  const { rows } = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'feedback' AND column_name = 'read_at'",
  );
  if (!rows.length) {
    await pool.query('ALTER TABLE feedback ADD COLUMN read_at BIGINT');
    await pool.query('UPDATE feedback SET read_at = created_at');
    console.log('↑ رُقِّي جدول الملاحظات: عمود «متى قُرئ»');
  }
  /* والفهرس بعده لا قبله: لا يُفهرس عمودٌ لم يُضف بعد */
  await pool.query('CREATE INDEX IF NOT EXISTS feedback_unread ON feedback (read_at)');
}

const UPSERT_ROOM = `
  INSERT INTO rooms (code, name, difficulty, bank_ids, status,
                     created_at, started_at, touched_at, ended_at, rounds, players, questions)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (code) DO UPDATE SET
    name = excluded.name, difficulty = excluded.difficulty, bank_ids = excluded.bank_ids,
    status = excluded.status, started_at = excluded.started_at,
    touched_at = excluded.touched_at, ended_at = excluded.ended_at,
    rounds = excluded.rounds, players = excluded.players, questions = excluded.questions
`;

const UPSERT_STATE = `
  INSERT INTO room_state (code, snapshot, saved_at) VALUES ($1, $2, $3)
  ON CONFLICT (code) DO UPDATE SET snapshot = excluded.snapshot, saved_at = excluded.saved_at
`;

const SELECT_RESUMABLE = `
  SELECT s.snapshot FROM room_state s
  JOIN rooms r ON r.code = s.code
  WHERE r.touched_at >= $1 AND r.status != 'finished'
  ORDER BY r.touched_at ASC
`;

/*
 * يُجمع على ما في القاعدة لا يُستبدل به: الوارد فروقٌ منذ آخر صرف.
 * والنصّ والمستوى يُحدَّثان دائماً فيتبعان آخر تحريرٍ للسؤال.
 *
 * والأعمدة تُنسب إلى جدولها في طرف الجمع: `shown` وحده في الطرف الأيمن
 * يحتمل أن يُقرأ عمودَ الوارد، والنسبة تقطع الاحتمال.
 */
const BUMP_STAT = `
  INSERT INTO question_stats (question_id, bank_id, level, text, shown, correct, wrong, last_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (question_id) DO UPDATE SET
    shown = question_stats.shown + excluded.shown,
    correct = question_stats.correct + excluded.correct,
    wrong = question_stats.wrong + excluded.wrong,
    level = excluded.level,
    text = CASE WHEN excluded.text != '' THEN excluded.text ELSE question_stats.text END,
    last_at = excluded.last_at
`;

/*
 * ⚠ GREATEST لا MAX: الثانية في بوستجرس دالّةُ تجميعٍ على صفوف، لا
 * دالّةُ قيمتين كما في SQLite — ولو تُركت لانهار الاستعلام.
 */
const SELECT_HEALTH = `
  SELECT question_id, bank_id, level, text, shown, correct, wrong, last_at
  FROM question_stats
  WHERE shown >= $1
  ORDER BY (CAST(correct AS REAL) / GREATEST(correct + wrong, 1)) ASC, shown DESC
  LIMIT $2
`;

const SELECT_ONE_STAT = `
  SELECT shown, correct, wrong, last_at FROM question_stats WHERE question_id = $1
`;

const INSERT_FEEDBACK = `
  INSERT INTO feedback (kind, question_id, question, room_code, room_name,
                        reason, note, stars, by_role, by_name, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  RETURNING id
`;

/*
 * معاملٌ واحد يُقرأ مرّتين — والقولبة لازمة: بوستجرس لا يستنتج نوع
 * معاملٍ يقف وحده أمام IS NULL فيرفض الاستعلام قبل أن يقرأ صفّاً.
 */
const SELECT_FEEDBACK = `
  SELECT id, kind, question_id, question, room_code, room_name,
         reason, note, stars, by_role, by_name, created_at, read_at
  FROM feedback
  WHERE ($1::text IS NULL OR kind = $1)
  ORDER BY created_at DESC LIMIT $2
`;

const MARK_READ = `
  UPDATE feedback SET read_at = $1
  WHERE read_at IS NULL AND ($2::text IS NULL OR kind = $2)
`;

const COUNT_UNREAD = `
  SELECT kind, COUNT(*) AS n FROM feedback WHERE read_at IS NULL GROUP BY kind
`;

const COUNT_BY_QUESTION = `
  SELECT question_id, COUNT(*) AS n FROM feedback
  WHERE kind = 'report' GROUP BY question_id
`;

/*
 * مدًى مفتوح الطرفين: النهاية غير المحدودة تُمرَّر أكبر من كل وقت، فيبقى
 * الاستعلام واحداً — ولا يُبنى SQL بالسلاسل عند كل طلب.
 */
const SELECT_ROOMS = `
  SELECT code, name, difficulty, bank_ids, status, created_at, started_at,
         touched_at, ended_at, rounds, players, questions
  FROM rooms WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC
`;

/**
 * معاملةٌ على عميلٍ واحد.
 *
 * ولا تجري على المجمّع: كل استعلامٍ فيه قد يأخذ اتصالاً غير الذي قبله،
 * فيذهب BEGIN إلى واحدٍ والكتابةُ إلى آخر والالتزامُ إلى ثالث — فلا
 * معاملةَ أصلاً وإن بدا كلُّ شيءٍ ناجحاً.
 *
 * والإعادة في finally لا في نهاية المحاولة: عميلٌ لا يعود يبقى محجوزاً،
 * وعشرةٌ منه تستنفد المجمّع فيتجمّد التطبيق بعد ساعةٍ بلا خطأ يُفسّره.
 */
async function inTransaction(run) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await run(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    /* والتراجع قد يسقط بدوره على اتصالٍ ميّت — فلا يحجب الخطأ الأصلي */
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** يكتب الغرفة وسجلّها ولقطتها في معاملةٍ واحدة — إما الاثنان أو لا شيء */
export async function saveRoom(room) {
  const snap = room.snapshot();
  const now = Date.now();
  await inTransaction(async (client) => {
    await client.query(UPSERT_ROOM, [
      snap.code,
      snap.name,
      snap.difficulty,
      JSON.stringify(snap.bankIds),
      snap.status,
      snap.createdAt,
      snap.startedAt ?? null,
      snap.touchedAt,
      snap.status === 'finished' ? now : null,
      /*
       * جولاتُ الغرفة لا جولاتُ اللعبة الحالية: history يُفرَغ عند «البدء
       * من جديد»، وسجلُّ المالك لا يُفرَّغ معه. والقديم بلا عدّاد يُقاس
       * بطوله كما كان.
       */
      snap.playedRounds ?? snap.history.length,
      snap.teams.length,
      snap.served.length,
    ]);
    await client.query(UPSERT_STATE, [snap.code, JSON.stringify(snap), now]);
  });
}

/**
 * لقطات الغرف التي ما زال يُرجى استئنافها.
 *
 * ما تجاوز حدَّ الخمول يُترك في السجلّ ولا يُبعث: من ترك غرفته ساعتين
 * لن يعود إليها، وإحياؤها يملأ الذاكرة بأشباح.
 */
export async function loadSnapshots(maxIdleMs) {
  const since = Date.now() - maxIdleMs;
  const { rows } = await q(SELECT_RESUMABLE, [since]);
  const out = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.snapshot));
    } catch (err) {
      console.warn('⚠ لقطة غرفة تالفة — أُهملت:', err.message);
    }
  }
  return out;
}

/** تُنسى اللقطة ويبقى السجلّ: الغرفة لم تعد تُستأنف، لكنها حدثت */
export async function forgetState(code) {
  await q('DELETE FROM room_state WHERE code = $1', [code]);
}

/** يصرف فروق الإحصاء إلى القاعدة — دفعةً واحدة في معاملة واحدة */
export async function recordStats(entries) {
  if (!entries.length) return 0;
  const now = Date.now();
  await inTransaction(async (client) => {
    for (const e of entries) {
      await client.query(BUMP_STAT, [
        e.id,
        e.bank,
        e.level,
        e.text,
        e.shown,
        e.correct,
        e.wrong,
        now,
      ]);
    }
  });
  return entries.length;
}

/**
 * صحّة الأسئلة: الأضعف صواباً أولاً، فهي أولى بالنظر.
 *
 * وminShown شرطٌ لا زينة: سؤالٌ عُرض مرّةً فأُخطئ فيه نسبتُه صفر، وهو
 * لا يدلّ على شيء. النسبة لا تُقرأ إلا بعد عدّة عروض.
 */
export async function questionHealth({ minShown = 5, limit = 200 } = {}) {
  const { rows } = await q(SELECT_HEALTH, [minShown, limit]);
  return rows.map((r) => {
    const answered = r.correct + r.wrong;
    return {
      id: r.question_id,
      bank: r.bank_id,
      level: r.level,
      text: r.text,
      shown: r.shown,
      correct: r.correct,
      wrong: r.wrong,
      rate: answered ? Math.round((r.correct / answered) * 100) : null,
      lastAt: r.last_at,
    };
  });
}

/**
 * يُسجّل بلاغاً أو تعليقاً.
 *
 * ونحفظ نصّ السؤال معه لا معرّفه وحده: المعرّف بصمةٌ من النصّ، فتحريرُ
 * السؤال — وهو أوّلُ ما يفعله المالك بعد بلاغ — يُغيّر المعرّف فيصير
 * البلاغ يشير إلى لا شيء. النصّ المحفوظ يُبقي البلاغ مقروءاً.
 */
export async function addFeedback(entry) {
  const { rows } = await q(INSERT_FEEDBACK, [
    entry.kind,
    entry.questionId ?? null,
    entry.question ?? null,
    entry.roomCode ?? null,
    entry.roomName ?? null,
    entry.reason ?? null,
    entry.note ?? null,
    entry.stars ?? null,
    entry.byRole ?? null,
    entry.byName ?? null,
    Date.now(),
  ]);
  return Number(rows[0].id);
}

/** الملاحظات كما تُقرأ في اللوحة — أحدثها أولاً */
export async function listFeedback({ kind = null, limit = 200 } = {}) {
  const { rows } = await q(SELECT_FEEDBACK, [kind, limit]);
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    questionId: r.question_id,
    question: r.question,
    roomCode: r.room_code,
    roomName: r.room_name,
    reason: r.reason,
    note: r.note,
    stars: r.stars,
    byRole: r.by_role,
    byName: r.by_name,
    createdAt: r.created_at,
    unread: r.read_at === null,
  }));
}

/** يُعلّم ما لم يُقرأ مقروءاً — صنفاً بعينه أو الكلّ */
export async function readFeedback(kind = null) {
  const { rowCount } = await q(MARK_READ, [Date.now(), kind]);
  return rowCount;
}

/** كم لم يُقرأ من كل صنف — للشارات في الشريط */
export async function unreadFeedback() {
  const out = { report: 0, comment: 0, total: 0 };
  const { rows } = await q(COUNT_UNREAD);
  for (const row of rows) {
    const n = Number(row.n);
    if (row.kind in out) out[row.kind] = n;
    out.total += n;
  }
  return out;
}

/** إحصاء سؤالٍ واحد — يُقرأ في المحرّر فتُحرّر وأنت ترى ما قاسه اللعب */
export async function questionStat(id) {
  const { rows } = await q(SELECT_ONE_STAT, [id]);
  if (!rows.length) return null;
  const row = rows[0];
  const answered = row.correct + row.wrong;
  return {
    shown: row.shown,
    correct: row.correct,
    wrong: row.wrong,
    rate: answered ? Math.round((row.correct / answered) * 100) : null,
    lastAt: row.last_at,
  };
}

/** كم بلاغاً على كل سؤال — يُقرن بجدول الصحّة */
export async function reportCounts() {
  const { rows } = await q(COUNT_BY_QUESTION);
  return new Map(rows.map((r) => [r.question_id, Number(r.n)]));
}

/**
 * سجلّ الغرف لعرضه في لوحة المالك.
 *
 * إما مدّةٌ بالأيام من اليوم (اللوحة الرئيسية: ستون يوماً)، وإما مدًى
 * صريحٌ بين وقتين (صفحة الغرف: ما يختاره المالك من التقويم). و`null`
 * في الأيام تعني السجلّ كلَّه — فالغرف لم تعد تُحذف.
 */
export async function listRooms(days = RETENTION_DAYS, range) {
  const from = range?.from ?? (days === null ? 0 : Date.now() - days * DAY_MS);
  const to = range?.to ?? Number.MAX_SAFE_INTEGER;
  const { rows } = await q(SELECT_ROOMS, [from, to]);
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    difficulty: r.difficulty,
    bankIds: JSON.parse(r.bank_ids),
    status: r.status,
    createdAt: r.created_at,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    rounds: r.rounds,
    players: r.players,
    questions: r.questions,
    /*
     * المدّة: من أول جولة إلى آخر أثرٍ في الغرفة — إما إعلان النتائج وإما
     * آخر حركةٍ قبل أن تخمل. وغرفةٌ لم تبدأ لا مدّة لها، والشرطةُ أصدق من صفر.
     */
    playedMs: r.started_at ? Math.max(0, (r.ended_at ?? r.touched_at) - r.started_at) : null,
  }));
}

/* ══════════════ أرشيف التحرير ══════════════ */

export const EDIT_DAYS = 30;

const INSERT_EDIT = `
  INSERT INTO edits (kind, bank_id, old_id, new_id, old_q, old_options, old_level,
                     new_q, new_options, new_level, shown, correct, wrong, reports, at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  RETURNING id
`;

/**
 * يمحو ما قِيس على سؤال: إحصاؤه وبلاغاته.
 *
 * ويُنادى عند التحرير والحذف: السؤال بعد تغيير نصّه أو خياراته سؤالٌ آخر،
 * ونسبةُ صوابٍ قيست على نصٍّ لم يعد موجوداً كذبٌ مرتّب. ويُرجع ما محاه
 * ليُحفظ في الأرشيف — فالرقم يبقى مقروءاً وإن لم يبقَ محسوباً.
 */
export async function clearQuestion(id) {
  const stat = await questionStat(id);
  const gone = await q("DELETE FROM feedback WHERE question_id = $1 AND kind = 'report'", [id]);
  await q('DELETE FROM question_stats WHERE question_id = $1', [id]);
  return {
    shown: stat?.shown ?? 0,
    correct: stat?.correct ?? 0,
    wrong: stat?.wrong ?? 0,
    reports: gone.rowCount,
  };
}

/** يُسجّل تحريراً أو حذفاً في الأرشيف */
export async function recordEdit(entry) {
  await q(INSERT_EDIT, [
    entry.kind,
    entry.bankId,
    entry.oldId,
    entry.newId ?? null,
    entry.oldQ,
    JSON.stringify(entry.oldOptions ?? []),
    entry.oldLevel ?? 2,
    entry.newQ ?? null,
    entry.newOptions ? JSON.stringify(entry.newOptions) : null,
    entry.newLevel ?? null,
    entry.cleared?.shown ?? 0,
    entry.cleared?.correct ?? 0,
    entry.cleared?.wrong ?? 0,
    entry.cleared?.reports ?? 0,
    Date.now(),
  ]);
}

const readEdit = (r) => ({
  id: Number(r.id),
  kind: r.kind,
  bank: r.bank_id,
  oldId: r.old_id,
  newId: r.new_id,
  oldQ: r.old_q,
  oldOptions: JSON.parse(r.old_options),
  oldLevel: r.old_level,
  newQ: r.new_q,
  newOptions: r.new_options ? JSON.parse(r.new_options) : null,
  newLevel: r.new_level,
  shown: r.shown,
  correct: r.correct,
  wrong: r.wrong,
  reports: r.reports,
  at: r.at,
});

export async function listEdits(days = EDIT_DAYS) {
  const { rows } = await q('SELECT * FROM edits WHERE at >= $1 ORDER BY at DESC LIMIT 300', [
    Date.now() - days * DAY_MS,
  ]);
  return rows.map(readEdit);
}

export async function getEdit(id) {
  const { rows } = await q('SELECT * FROM edits WHERE id = $1', [Number(id)]);
  return rows.length ? readEdit(rows[0]) : null;
}

export async function forgetEdit(id) {
  const { rowCount } = await q('DELETE FROM edits WHERE id = $1', [Number(id)]);
  return rowCount;
}

/**
 * كنسُ الأرشيف — والغرفُ ليست منه.
 *
 * كانت الغرفة تُحذف بعد ستين يوماً فتذهب إحصاؤها معها: كم لُعب فيها، وكم
 * لاعباً مرّ، وكم سؤالاً عُرض. وهذا سجلٌّ يُبنى عليه لا سجلٌّ يُستهلك —
 * فبقي. أما نسخُ التحرير فأرشيفُ تراجعٍ مؤقّت، ومدّته على حالها.
 */
export async function sweepOld() {
  const edits = await q('DELETE FROM edits WHERE at < $1', [Date.now() - EDIT_DAYS * DAY_MS]);
  if (edits.rowCount) {
    console.log(`🧹 نُسيت ${edits.rowCount} نسخةً محرَّرة تجاوزت ${EDIT_DAYS} يوماً`);
  }
  return 0;
}

export async function close() {
  await pool.end();
}
