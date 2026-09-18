/**
 * ذاكرة النبضة — سجلّ الغرف ولقطاتها الحيّة.
 *
 * الغرف كانت تعيش في الذاكرة وحدها: تسقط العملية فتذهب مسابقةٌ في
 * منتصفها، وتنتهي المسابقة فلا يبقى منها خبر. هنا تُكتب على القرص.
 *
 * ولماذا SQLite لا ملفات JSON كالبنوك؟ لأن ما يُطلب منها استعلامات:
 * «الغرف في ستين يوماً»، و«الأكثر بلاغاً» لاحقاً. وnode:sqlite مدمجٌ
 * في Node منذ الرابعة والعشرين — فلا مكتبة جديدة ولا خادم قاعدة.
 *
 * وتبقى بنوك الأسئلة ملفات JSON: نصٌّ يُراجَع ويدخل git. القاعدة
 * للأحداث والقياسات، لا للمحتوى.
 */
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = 60;

const dir = dirname(fileURLToPath(import.meta.url));
const file = process.env.NABDA_DB || join(dir, 'nabda.db');

const db = new DatabaseSync(file);

/*
 * WAL: الكتابة لا تحجب القراءة، والملفّ ينجو من انقطاع الكهرباء.
 * وsynchronous=NORMAL تكفي هنا — نكتب كل ثانيتين، وأسوأ ما يضيع
 * ثانيتان من جولة، وهو ما نقبله أصلاً في تصميم الاستئناف.
 */
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    bank_ids   TEXT NOT NULL,
    status     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    touched_at INTEGER NOT NULL,
    started_at INTEGER,
    ended_at   INTEGER,
    rounds     INTEGER NOT NULL DEFAULT 0,
    players    INTEGER NOT NULL DEFAULT 0,
    questions  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS room_state (
    code     TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
    snapshot TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS question_stats (
    question_id TEXT PRIMARY KEY,
    bank_id     TEXT NOT NULL,
    level       INTEGER NOT NULL,
    text        TEXT NOT NULL,
    shown       INTEGER NOT NULL DEFAULT 0,
    correct     INTEGER NOT NULL DEFAULT 0,
    wrong       INTEGER NOT NULL DEFAULT 0,
    last_at     INTEGER NOT NULL
  );

  /*
    * البلاغات والتعليقات في جدولٍ واحد مصنَّف: كلاهما رأيٌ يُرفع من داخل
    * اللعبة، ويُقرآن معاً في لوحة المالك. وبلاغُ السؤال بلا هويّة عمداً —
    * المهمّ السؤال لا من رآه.
    */
  CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at  INTEGER NOT NULL
  );

  /*
    * أرشيفُ التحرير: نسخةُ السؤال قبل تغييره أو حذفه.
    *
    * تحريرُ السؤال يمحو إحصاءه — فالمقاس كان لنصٍّ غير هذا النصّ — والمحوُ
    * لا رجعة فيه. فتُحفظ النسخة القديمة ثلاثين يوماً: يراجعها المالك، أو
    * يُرجعها إن تبيّن أن التحرير كان خطأ.
    */
  CREATE TABLE IF NOT EXISTS edits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
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
    at          INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS rooms_created ON rooms (created_at DESC);
  CREATE INDEX IF NOT EXISTS edits_at ON edits (at DESC);
  CREATE INDEX IF NOT EXISTS stats_bank ON question_stats (bank_id);
  CREATE INDEX IF NOT EXISTS feedback_kind ON feedback (kind, created_at DESC);
  CREATE INDEX IF NOT EXISTS feedback_question ON feedback (question_id);
`);

const upsertRoom = db.prepare(`
  INSERT INTO rooms (code, name, difficulty, bank_ids, status,
                     created_at, started_at, touched_at, ended_at, rounds, players, questions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    name = excluded.name, difficulty = excluded.difficulty, bank_ids = excluded.bank_ids,
    status = excluded.status, started_at = excluded.started_at,
    touched_at = excluded.touched_at, ended_at = excluded.ended_at,
    rounds = excluded.rounds, players = excluded.players, questions = excluded.questions
`);

const upsertState = db.prepare(`
  INSERT INTO room_state (code, snapshot, saved_at) VALUES (?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET snapshot = excluded.snapshot, saved_at = excluded.saved_at
`);

const selectResumable = db.prepare(`
  SELECT s.snapshot FROM room_state s
  JOIN rooms r ON r.code = s.code
  WHERE r.touched_at >= ? AND r.status != 'finished'
  ORDER BY r.touched_at ASC
`);

const deleteState = db.prepare('DELETE FROM room_state WHERE code = ?');
const deleteOld = db.prepare('DELETE FROM rooms WHERE created_at < ?');

/*
 * يُجمع على ما في القرص لا يُستبدل به: الوارد فروقٌ منذ آخر صرف.
 * والنصّ والمستوى يُحدَّثان دائماً فيتبعان آخر تحريرٍ للسؤال.
 */
const bumpStat = db.prepare(`
  INSERT INTO question_stats (question_id, bank_id, level, text, shown, correct, wrong, last_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(question_id) DO UPDATE SET
    shown = shown + excluded.shown,
    correct = correct + excluded.correct,
    wrong = wrong + excluded.wrong,
    level = excluded.level,
    text = CASE WHEN excluded.text != '' THEN excluded.text ELSE text END,
    last_at = excluded.last_at
`);

const selectHealth = db.prepare(`
  SELECT question_id, bank_id, level, text, shown, correct, wrong, last_at
  FROM question_stats
  WHERE shown >= ?
  ORDER BY (CAST(correct AS REAL) / MAX(correct + wrong, 1)) ASC, shown DESC
  LIMIT ?
`);

const selectOneStat = db.prepare(`
  SELECT shown, correct, wrong, last_at FROM question_stats WHERE question_id = ?
`);

const insertFeedback = db.prepare(`
  INSERT INTO feedback (kind, question_id, question, room_code, room_name,
                        reason, note, stars, by_role, by_name, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectFeedback = db.prepare(`
  SELECT id, kind, question_id, question, room_code, room_name,
         reason, note, stars, by_role, by_name, created_at
  FROM feedback
  WHERE (? IS NULL OR kind = ?)
  ORDER BY created_at DESC LIMIT ?
`);

const countByQuestion = db.prepare(`
  SELECT question_id, COUNT(*) n FROM feedback
  WHERE kind = 'report' GROUP BY question_id
`);

const selectRooms = db.prepare(`
  SELECT code, name, difficulty, bank_ids, status, created_at, started_at,
         touched_at, ended_at, rounds, players, questions
  FROM rooms WHERE created_at >= ? ORDER BY created_at DESC
`);

/** يكتب الغرفة وسجلّها ولقطتها في معاملةٍ واحدة — إما الاثنان أو لا شيء */
export function saveRoom(room) {
  const snap = room.snapshot();
  const now = Date.now();
  db.exec('BEGIN');
  try {
    upsertRoom.run(
      snap.code,
      snap.name,
      snap.difficulty,
      JSON.stringify(snap.bankIds),
      snap.status,
      snap.createdAt,
      snap.startedAt ?? null,
      snap.touchedAt,
      snap.status === 'finished' ? now : null,
      snap.history.length,
      snap.teams.length,
      snap.served.length,
    );
    upsertState.run(snap.code, JSON.stringify(snap), now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * لقطات الغرف التي ما زال يُرجى استئنافها.
 *
 * ما تجاوز حدَّ الخمول يُترك في السجلّ ولا يُبعث: من ترك غرفته ساعتين
 * لن يعود إليها، وإحياؤها يملأ الذاكرة بأشباح.
 */
export function loadSnapshots(maxIdleMs) {
  const since = Date.now() - maxIdleMs;
  const out = [];
  for (const row of selectResumable.all(since)) {
    try {
      out.push(JSON.parse(row.snapshot));
    } catch (err) {
      console.warn('⚠ لقطة غرفة تالفة — أُهملت:', err.message);
    }
  }
  return out;
}

/** تُنسى اللقطة ويبقى السجلّ: الغرفة لم تعد تُستأنف، لكنها حدثت */
export function forgetState(code) {
  deleteState.run(code);
}

/** يصرف فروق الإحصاء إلى القرص — دفعةً واحدة في معاملة واحدة */
export function recordStats(entries) {
  if (!entries.length) return 0;
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const e of entries) {
      bumpStat.run(e.id, e.bank, e.level, e.text, e.shown, e.correct, e.wrong, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return entries.length;
}

/**
 * صحّة الأسئلة: الأضعف صواباً أولاً، فهي أولى بالنظر.
 *
 * وminShown شرطٌ لا زينة: سؤالٌ عُرض مرّةً فأُخطئ فيه نسبتُه صفر، وهو
 * لا يدلّ على شيء. النسبة لا تُقرأ إلا بعد عدّة عروض.
 */
export function questionHealth({ minShown = 5, limit = 200 } = {}) {
  return selectHealth.all(minShown, limit).map((r) => {
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
export function addFeedback(entry) {
  const info = insertFeedback.run(
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
  );
  return Number(info.lastInsertRowid);
}

/** الملاحظات كما تُقرأ في اللوحة — أحدثها أولاً */
export function listFeedback({ kind = null, limit = 200 } = {}) {
  return selectFeedback.all(kind, kind, limit).map((r) => ({
    id: r.id,
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
  }));
}

/** إحصاء سؤالٍ واحد — يُقرأ في المحرّر فتُحرّر وأنت ترى ما قاسه اللعب */
export function questionStat(id) {
  const row = selectOneStat.get(id);
  if (!row) return null;
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
export function reportCounts() {
  return new Map(countByQuestion.all().map((r) => [r.question_id, r.n]));
}

/** سجلّ الغرف لعرضه في لوحة المالك */
export function listRooms(days = RETENTION_DAYS) {
  return selectRooms.all(Date.now() - days * DAY_MS).map((r) => ({
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

const insertEdit = db.prepare(`
  INSERT INTO edits (kind, bank_id, old_id, new_id, old_q, old_options, old_level,
                     new_q, new_options, new_level, shown, correct, wrong, reports, at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectEdits = db.prepare('SELECT * FROM edits WHERE at >= ? ORDER BY at DESC LIMIT 300');
const selectEdit = db.prepare('SELECT * FROM edits WHERE id = ?');
const deleteEdit = db.prepare('DELETE FROM edits WHERE id = ?');
const deleteOldEdits = db.prepare('DELETE FROM edits WHERE at < ?');
const deleteStat = db.prepare('DELETE FROM question_stats WHERE question_id = ?');
const deleteReports = db.prepare("DELETE FROM feedback WHERE question_id = ? AND kind = 'report'");

/**
 * يمحو ما قِيس على سؤال: إحصاؤه وبلاغاته.
 *
 * ويُنادى عند التحرير والحذف: السؤال بعد تغيير نصّه أو خياراته سؤالٌ آخر،
 * ونسبةُ صوابٍ قيست على نصٍّ لم يعد موجوداً كذبٌ مرتّب. ويُرجع ما محاه
 * ليُحفظ في الأرشيف — فالرقم يبقى مقروءاً وإن لم يبقَ محسوباً.
 */
export function clearQuestion(id) {
  const stat = questionStat(id);
  const gone = deleteReports.run(id).changes;
  deleteStat.run(id);
  return {
    shown: stat?.shown ?? 0,
    correct: stat?.correct ?? 0,
    wrong: stat?.wrong ?? 0,
    reports: gone,
  };
}

/** يُسجّل تحريراً أو حذفاً في الأرشيف */
export function recordEdit(entry) {
  insertEdit.run(
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
  );
}

const readEdit = (r) => ({
  id: r.id,
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

export function listEdits(days = EDIT_DAYS) {
  return selectEdits.all(Date.now() - days * DAY_MS).map(readEdit);
}

export function getEdit(id) {
  const row = selectEdit.get(Number(id));
  return row ? readEdit(row) : null;
}

export function forgetEdit(id) {
  return deleteEdit.run(Number(id)).changes;
}

/** ما تجاوز مدّة الحفظ يُحذف — واللقطات تتبعه بـON DELETE CASCADE */
export function sweepOld(days = RETENTION_DAYS) {
  const { changes } = deleteOld.run(Date.now() - days * DAY_MS);
  if (changes) console.log(`🧹 حُذفت ${changes} غرفة تجاوزت ${days} يوماً`);
  const edits = deleteOldEdits.run(Date.now() - EDIT_DAYS * DAY_MS).changes;
  if (edits) console.log(`🧹 نُسيت ${edits} نسخةً محرَّرة تجاوزت ${EDIT_DAYS} يوماً`);
  return changes;
}

export function close() {
  db.close();
}
