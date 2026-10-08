import envResult, { announce, watchEnv } from './env.js'; // أوّلَ شيء: ما بعده يقرأ process.env
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import {
  listBanks,
  playableBanks,
  normalizeBankIds,
  allBanks,
  findQuestion,
  saveBank,
  deleteBank,
  writeBank,
  setActive,
  initBanks,
  arabizeDigits,
  flagCode,
  questionKey,
} from './banks.js';
import { auditQuestion, auditAll, normalizeText } from './audit.js';
import { parseIntake, MAX_ROWS } from './intake.js';
import {
  createRoom,
  restoreRoom,
  getRoom,
  allRooms,
  dropRoom,
  sweepIdleRooms,
  normalizeDifficulty,
  DEFAULT_SETTINGS,
  IDLE_ROOM_MS,
  MAX_TEAMS,
} from './game.js';
import * as store from './store.js';

const PORT = process.env.PORT || 3000;
const TICK_MS = 250;
/*
 * دورة الكتابة على القرص. ثانيةٌ لأنها أقصى ما نقبل ضياعه من جولة لو سقط السيرفر فجأة،
 * وهي في الوقت نفسه أبطأ من أن تُتعب القرص: الغرفة الواحدة عشرات
 * الكيلوبايتات، والكتابة لا تحجب القراءة في WAL.
 */
const SAVE_MS = 1000;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const app = express();
app.use(express.json({ limit: '256kb' }));
const http = createServer(app);
/*
 * إعدادُ السوكِت لقاعةٍ مزدحمة على شبكة جوّالٍ ضعيفة.
 *
 * ‎pingTimeout‎ أطول من المعتاد: في الواي فاي المزدحم يتأخّر ردُّ الجوّال
 * ثوانيَ لا لأنه مات بل لأن الشبكة غارقة، والمهلةُ القصيرة تقطع الحيَّ
 * فيعيد اتصاله فيزيد الزحام. ومجموعُهما (٤٥ ث) دون مهلة الوسطاء (٦٠ ث).
 *
 * والضغط لما فوق الكيلوبايت: حالُ الغرفة نصٌّ تتكرّر فيه الأسماء والحقول،
 * فينضغط أضعافاً — وهو أثقلُ ما يعبر إلى شاشة القاعة.
 *
 * وسقفُ الرسالة الواردة صغير: أكبرُ ما يرسله المتصفّح تعليقٌ من ثلاثمئة
 * حرف، فما زاد على هذا ليس من اللعبة.
 */
const io = new Server(http, {
  cors: { origin: '*' },
  pingInterval: 20000,
  pingTimeout: 25000,
  perMessageDeflate: { threshold: 1024 },
  maxHttpBufferSize: 100_000,
});

/*
 * ختمُ البناء الذي يخدمه هذا السيرفر — يُكتب في dist/build.txt عند البناء.
 * يُرسل لكل متصلٍ فيعرف أن حزمته قديمةٌ بعد نشرٍ جديد فيُحدّث نفسه بين
 * الجولات، بدل أن يكلّم سيرفراً جديداً بلغةٍ قديمة. (في التطوير لا ختم.)
 */
const BUILD = (() => {
  try {
    return readFileSync(join(root, 'client', 'dist', 'build.txt'), 'utf8').trim() || null;
  } catch {
    return null;
  }
})();

/*
 * معالجٌ لا متزامن في Express 4 لا يُلتقط رفضُه: الوعد يُرفض بلا مستمع،
 * وNode الحديث يُسقط العملية كلها على ذلك — فتموت جولةٌ جارية لأن استعلاماً
 * تأخّر. ولفُّ كل معالجٍ بيده في كل مسار عملٌ يُنسى منه واحد، فنلفُّها هنا
 * مرّةً عند التسجيل: ما رُفض وعدُه ذهب إلى next فإلى معالج الأخطاء.
 *
 * وما كان طولُه أربعةً يُترك: ذاك معالج أخطاء بذاته لا معالج طلب.
 */
for (const verb of ['get', 'post', 'put', 'delete', 'patch']) {
  const original = app[verb].bind(app);
  app[verb] = (path, ...handlers) =>
    original(
      path,
      ...handlers.map((fn) =>
        typeof fn !== 'function' || fn.length >= 4
          ? fn
          : (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
      ),
    );
}

/*
 * بنوكُ اللعبة — المفعَّلةُ التي فيها سؤال.
 *
 * ومنظّمُ الغرفة يقرأ من هنا، فلا يُعرض له بنكٌ أُلغي تفعيلُه ولا بنكٌ لم
 * يُملأ بعد. ولوحةُ المالك لها بابُها (console/banks) وفيه الكلُّ بوصفه.
 */
app.get('/api/banks', (_req, res) => res.json(playableBanks()));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: [...allRooms()].length }));

/*
 * ══════════════ لوحة المالك ══════════════
 *
 * مفتاحٌ مستقلٌّ عن مفتاح المنظّم: ذاك يُشارَك في رابطٍ مع من يدير غرفة،
 * وهذا لا يُشارَك أبداً. ويعيش في متغيّر بيئة على **السيرفر** لا على
 * الجهاز — فتُفتح اللوحة من أيّ حاسبٍ أو جوّال وتبقى مقصورةً على صاحبها.
 *
 * وإن لم يُضبط وُلّد عند الإقلاع وطُبع في السجلّ: فالافتراضُ مفتاحٌ عشوائي
 * لا بابٌ مفتوح، ومن نسي الضبط لم يفتح لوحته للعالم.
 */
/*
 * مفتاحٌ مؤقّت يُولَّد مرّة، ويُستعمل ما لم يُضبط NABDA_OWNER_KEY.
 *
 * والمفتاح العامل يُقرأ في كل طلب لا يُجمَّد عند الإقلاع: ملفّ .env
 * مراقَب، فمن بدّل مفتاحه وجده عاملاً في حينه — ولو جُمّد لظنّ التبديل
 * فاشلاً وهو إنما لم يُعد التشغيل.
 */
const FALLBACK_KEY = randomBytes(24).toString('base64url');
const ownerKey = () => process.env.NABDA_OWNER_KEY || FALLBACK_KEY;
const usingFallback = () => !process.env.NABDA_OWNER_KEY;

/* مقارنةٌ ثابتة الزمن: المقارنة العادية تُسرّب طول المطابقة لمن يقيس */
function keyMatches(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(ownerKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

/* خمس محاولات في الدقيقة لكل عنوان — تخمين المفتاح يحتاج دهراً */
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const log = (attempts.get(ip) ?? []).filter((t) => now - t < 60_000);
  log.push(now);
  attempts.set(ip, log);
  return log.length > 5;
}

function owner(req, res, next) {
  /*
   * الترويسة تحمل bytes لاتينية فقط، ومفتاحٌ عربيّ لا يمرّ فيها خاماً —
   * وهو مفتاحٌ محتمَل في موقعٍ عربيّ. فيُرسَل مُرمَّزاً ويُفكّ هنا.
   */
  let key = '';
  try {
    key = decodeURIComponent(req.get('x-nabda-key') || '');
  } catch {
    key = ''; // ترميزٌ تالف — كمفتاحٍ خاطئ سواء
  }
  if (keyMatches(key)) return next();
  if (throttled(req.ip)) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة' });
  return res.status(401).json({ error: 'مفتاح غير صحيح' });
}

app.get('/api/console/summary', owner, async (_req, res) => {
  const rooms = await store.listRooms();
  const month = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = rooms.filter((r) => r.createdAt >= month);
  const comments = await store.listFeedback({ kind: 'comment', limit: 1000 });
  const rated = comments.filter((c) => c.stars);
  res.json({
    rooms: recent.length,
    players: recent.reduce((n, r) => n + r.players, 0),
    rounds: recent.reduce((n, r) => n + r.rounds, 0),
    live: [...allRooms()].filter((r) => r.status !== 'finished').length,
    reports: (await store.listFeedback({ kind: 'report', limit: 1000 })).length,
    comments: comments.length,
    stars: rated.length ? rated.reduce((n, c) => n + c.stars, 0) / rated.length : null,
  });
});

/**
 * كلُّ ما تحتاجه اللوحة الرئيسية في نداءٍ واحد.
 *
 * ولا تُجمَع في المتصفّح من أربعة نداءات: كلٌّ منها يمرّ على آلاف الصفوف،
 * وجمعُها هنا مرّةٌ واحدة على بياناتٍ في الذاكرة أرخص من أربع رحلات.
 */
/**
 * ما يحتاج نظرَ المالك — رقمٌ لكل شارة.
 *
 * يُحسب هنا مرّةً ويُقرأ من مسارين: اللوحةُ تعرضه في بطاقاتها، والشريطُ
 * الجانبيّ في شاراته. ولو حسبه كلٌّ لنفسه لاختلفا يوماً — وقد اختلفا:
 * كانت الشارةُ لا تُحسب إلا واللوحةُ معروضة، فيُحرّر المالك سبعةَ أسئلة
 * وشارتُها تقول صفراً حتى يدخل صفحتها.
 *
 * والاستعلاماتُ الخمسة تُرسَل معاً لا واحداً بعد واحد: لا يتوقّف أحدها
 * على جواب الآخر، فانتظارُها بالتتابع خمسُ رحلاتٍ إلى القاعدة مكان واحدة.
 */
async function ownerPulse() {
  const [health, comments, unread, reports, edits, pending] = await Promise.all([
    store.questionHealth({ minShown: 1, limit: 100000 }),
    store.listFeedback({ kind: 'comment', limit: 1000 }),
    store.unreadFeedback(),
    store.listFeedback({ kind: 'report', limit: 5000 }),
    store.listEdits(),
    store.listPending(),
  ]);
  const checked = auditAll(allBanks());

  /*
   * توزيعُ البلاغات والأرشيف على البنوك.
   *
   * لأن الشريط الجانبيّ يبقى فيه بنكٌ مختار وأنت تتنقّل بين صفحاتِ البنوك،
   * فعددُ البلاغات وعددُ المحرَّرة إلى جانب كل صفحة يجب أن يصفا البنك المختار
   * لا مجموعَ البنوك — وإلا قال الشريطُ «البلاغات ٧» والصفحةُ لا تعرض إلا
   * بلاغَ هذا البنك. والبلاغ ينتمي لبنكٍ ببادئة معرّف سؤاله «bankId:…».
   */
  const reportsByBank = {};
  for (const r of reports) {
    const bankId = r.questionId ? String(r.questionId).split(':')[0] : null;
    if (bankId) reportsByBank[bankId] = (reportsByBank[bankId] ?? 0) + 1;
  }
  const editsByBank = {};
  for (const e of edits) editsByBank[e.bank] = (editsByBank[e.bank] ?? 0) + 1;

  /*
   * والمعلّقةُ كذلك: شارةُ صفحتها تصف البنك المختار. والمعلَّقُ بلا بنكٍ
   * يُعَدّ في المجموع ولا يُنسب — فهو ناقصٌ من هذه الجهة بعينها، ويُقرأ
   * في «كل البنوك» حيث يُسنَد إلى بنكه.
   */
  const pendingByBank = {};
  for (const row of pending) {
    if (row.bank) pendingByBank[row.bank] = (pendingByBank[row.bank] ?? 0) + 1;
  }

  return {
    health,
    comments,
    audit: {
      errors: checked.errors,
      warnings: checked.warnings,
      duplicates: checked.duplicates.length,
    },
    totals: {
      live: [...allRooms()].filter((r) => r.status !== 'finished').length,
      reports: reports.length,
      measured: health.length,
      edits: edits.length,
      weak: health.filter((r) => r.shown >= 3 && r.rate !== null && r.rate < 30).length,
      lowStars: comments.filter((c) => c.stars && c.stars <= 2).length,
      unreadComments: unread.comment,
      unreadReports: unread.report,
      reportsByBank,
      editsByBank,
      pending: pending.length,
      pendingReady: pending.filter((row) => readyPending(row)).length,
      pendingByBank,
    },
  };
}

/**
 * جاهزٌ للاعتماد — ويُقاس هنا كما يُقاس في بابه.
 *
 * والشرطُ واحدٌ في الموضعين: بنكٌ وثلاثةُ أخطاءٍ ومستوى. ولا يُنادى
 * missingOf من هنا لأنها تبني جملةً عربية لتُقرأ، وهذه تريد نعم أو لا.
 */
function readyPending(row) {
  return (
    Boolean(row.bank) &&
    (row.wrongs ?? []).filter((text) => String(text ?? '').trim()).length >= 3 &&
    [1, 2, 3].includes(row.level)
  );
}

/** الشارات وحدها — تُقرأ بعد كل حفظٍ بلا حمل اللوحة كلّها */
app.get('/api/console/alerts', owner, async (_req, res) => {
  const pulse = await ownerPulse();
  res.json({
    ...pulse.totals,
    issues: pulse.audit.errors + pulse.audit.warnings,
    duplicates: pulse.audit.duplicates,
  });
});

app.get('/api/console/dashboard', owner, async (_req, res) => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rooms = await store.listRooms();
  const played = rooms.filter((r) => r.playedMs !== null);

  /* نشاطٌ يوميّ لأربعة عشر يوماً — العمود الفارغ خبرٌ كالعامر */
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const from = new Date(now - i * DAY).setHours(0, 0, 0, 0);
    const to = from + DAY;
    const mine = rooms.filter((r) => r.createdAt >= from && r.createdAt < to);
    days.push({
      at: from,
      rooms: mine.length,
      players: mine.reduce((n, r) => n + r.players, 0),
    });
  }

  /* صحّة كل بنك: كم سؤالاً فيه، وكم عُرض منه، وما نسبة صوابه، وكم بلاغاً */
  const [pulse, reports] = await Promise.all([ownerPulse(), store.reportCounts()]);
  const health = pulse.health;
  const byBank = new Map();
  for (const bank of allBanks()) {
    byBank.set(bank.id, {
      id: bank.id,
      name: bank.name,
      total: bank.questions.length,
      levels: [1, 2, 3].map((n) => bank.questions.filter((q) => q.level === n).length),
      seen: 0,
      correct: 0,
      answered: 0,
      reports: 0,
    });
  }
  for (const row of health) {
    const bank = byBank.get(row.bank);
    if (!bank) continue;
    bank.seen++;
    bank.correct += row.correct;
    bank.answered += row.correct + row.wrong;
    bank.reports += reports.get(row.id) ?? 0;
  }

  const comments = pulse.comments;
  const rated = comments.filter((c) => c.stars);

  res.json({
    /* فحصُ البنوك كلها: ما يقوله «npm test» يُقال هنا بلا طرفيّة */
    audit: pulse.audit,
    totals: {
      rooms: rooms.length,
      players: rooms.reduce((n, r) => n + r.players, 0),
      rounds: rooms.reduce((n, r) => n + r.rounds, 0),
      questions: rooms.reduce((n, r) => n + r.questions, 0),
      bank: allBanks().reduce((n, b) => n + b.questions.length, 0),
      comments: comments.length,
      stars: rated.length ? rated.reduce((n, c) => n + c.stars, 0) / rated.length : null,
      medianPlayedMs: median(played.map((r) => r.playedMs)),
      /* الشاراتُ نفسها التي يقرؤها الشريط — من الحساب نفسه */
      ...pulse.totals,
    },
    days,
    banks: [...byBank.values()].map((b) => ({
      ...b,
      rate: b.answered ? Math.round((b.correct / b.answered) * 100) : null,
    })),
    /* الأولى بالنظر: ما اجتمع فيه ضعفُ الصواب وكثرةُ البلاغ */
    worst: health
      .filter((row) => row.shown >= 3)
      .map((row) => ({
        ...row,
        bankName: byBank.get(row.bank)?.name ?? row.bank,
        reports: reports.get(row.id) ?? 0,
      }))
      .sort((a, b) => b.reports - a.reports || (a.rate ?? 100) - (b.rate ?? 100))
      .slice(0, 6),
    recentRooms: rooms.slice(0, 5),
    recentComments: comments.slice(0, 4),
  });
});

function median(list) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

app.get('/api/console/rooms', owner, async (req, res) => {
  /*
   * ثلاث صيغ: مدًى صريح (from/to بالمللي)، أو days، أو all=1 للسجلّ كلّه.
   * والمدى يُقدَّم لأنه أخصُّ — ومن أرسل الاثنين أراد ما اختاره بالتقويم.
   */
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (Number.isFinite(from) && from > 0) {
    return res.json(
      await store.listRooms(undefined, {
        from,
        to: Number.isFinite(to) && to > 0 ? to : Number.MAX_SAFE_INTEGER,
      }),
    );
  }
  if (req.query.all === '1') return res.json(await store.listRooms(null));
  res.json(await store.listRooms(Number(req.query.days) || undefined));
});

/** الغرفةُ الواحدة بتفاصيلها — تُقرأ قبل الحذف ليرى المالك ما سيمحو */
app.get('/api/console/room/:code', owner, async (req, res) => {
  const room = await store.roomDetail(String(req.params.code).toUpperCase());
  if (!room) return res.status(404).json({ error: 'غرفة غير موجودة' });
  const live = getRoom(room.code);
  const stats = await store.roomStatShare(room.code);
  res.json({ ...room, stats, live: Boolean(live) && live.status !== 'finished' });
});

/*
 * حذفُ الغرفة — ولا تُحذف غرفةٌ تعمل الآن.
 *
 * فاللاعبون فيها متّصلون، ومحوُ سجلّها من تحتهم يقطعهم بلا خبر. تُنهى
 * أولاً — وذاك شيءٌ يرونه — ثم تُحذف، وهذا لا يرونه.
 */
app.delete('/api/console/room/:code', owner, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const live = getRoom(code);
  if (live && live.status !== 'finished') {
    return res.status(409).json({ error: 'الغرفة تعمل الآن، أنهِ المسابقة ثم احذفها' });
  }
  const gone = await store.forgetRoom(code);
  if (!gone) return res.status(404).json({ error: 'غرفة غير موجودة' });
  /* من الذاكرة أيضاً، وإلا أعادتها دورةُ الحفظ بعد ثانيتين */
  dropRoom(code);
  res.json({ ok: true, room: gone });
});

app.get('/api/console/health', owner, async (req, res) => {
  const counts = await store.reportCounts();
  const names = new Map(allBanks().map((b) => [b.id, b.name]));
  const rows = await store.questionHealth({
    minShown: Number(req.query.minShown) || 1,
    limit: Number(req.query.limit) || 400,
  });
  /* اسمُ البنك لا معرّفه: الجدول يُقرأ بالعربية، وlugha ليست كلمةً عربية */
  res.json(
    rows.map((r) => ({
      ...r,
      bankName: names.get(r.bank) ?? r.bank,
      reports: counts.get(r.id) ?? 0,
    })),
  );
});

app.get('/api/console/feedback', owner, async (req, res) => {
  res.json(await store.listFeedback({ kind: req.query.kind || null, limit: 400 }));
});

/* «قراءة الكل»: صنفٌ بعينه أو الملاحظات جميعاً */
app.post('/api/console/feedback/read', owner, async (req, res) => {
  const kind = req.body?.kind || null;
  const changes = await store.readFeedback(kind === 'report' || kind === 'comment' ? kind : null);
  res.json({ ok: true, changed: changes, unread: await store.unreadFeedback() });
});

/* ── تحرير البنوك ── */

/**
 * أسئلة بنكٍ مقرونةً بإحصائها وبلاغاتها وما فيها من ملاحظات الفاحص.
 *
 * و«all» تجمع البنوك كلها في نداءٍ واحد: كانت الصفحة تقول «كل البنوك»
 * وتُري أوّلَ بنكٍ وحده — وذاك أسوأ من ألّا تعرض شيئاً، لأن الناقص لا
 * يُرى. وجمعُها هنا مرّةٌ واحدة أرخص من تسعة نداءات يمرّ كلٌّ منها على
 * جدول الإحصاء كاملاً.
 */
app.get('/api/console/bank/:id', owner, async (req, res) => {
  const wanted = req.params.id;
  const banks = wanted === 'all' ? allBanks() : allBanks().filter((b) => b.id === wanted);
  if (banks.length === 0) return res.status(404).json({ error: 'بنك غير معروف' });

  const stats = new Map(
    (await store.questionHealth({ minShown: 1, limit: 100000 })).map((row) => [row.id, row]),
  );
  const reports = await store.reportCounts();

  const questions = [];
  for (const bank of banks) {
    for (const q of bank.questions) {
      const stat = stats.get(q.id);
      questions.push({
        id: q.id,
        bank: bank.id,
        bankName: bank.name,
        q: q.q,
        options: q.options,
        answer: q.answer,
        level: q.level,
        flag: q.flag ?? null,
        shown: stat?.shown ?? 0,
        /* صح وخطأ: كانا في الإحصاء ولا يُرسلان، فيقرأ الجدول شرطةً أبداً */
        correct: stat?.correct ?? 0,
        wrong: stat?.wrong ?? 0,
        rate: stat?.rate ?? null,
        reports: reports.get(q.id) ?? 0,
        issues: auditQuestion(q),
      });
    }
  }

  res.json({
    id: wanted,
    name: banks.length === 1 ? banks[0].name : 'كل البنوك',
    questions,
  });
});

/**
 * بنوكُ اللوحة — كلُّها، المفعَّلُ منها والمُلغى والفارغ.
 *
 * ولا تُقرأ من /api/banks: ذاك بابُ اللعبة وهو يحجب المُلغى والفارغ، ولو
 * قرأت اللوحةُ منه لاختفى من شريطها بنكٌ أُلغي تفعيلُه — فلا يُعاد تفعيله
 * إلا بقاعدةٍ تُفتح بيد.
 *
 * و`playable` تُقال لكل بنك: به تُرسم أيقونةُ القفل في الشريط، ويُعرف
 * الفارغُ الذي لا يراه لاعبٌ بعد.
 */
app.get('/api/console/banks', owner, (_req, res) => {
  res.json(listBanks().map((bank) => ({ ...bank, playable: bank.active && bank.count > 0 })));
});

/** سؤالٌ واحد بتمامه — تفتح به صفحاتُ الصحّة والبلاغات المحرّرَ نفسه */
app.get('/api/console/question/:id', owner, async (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });
  const { bank, question } = found;
  /* ما قاسه اللعب يُقرأ في المحرّر: تُحرّر السؤال وأنت ترى لماذا تُحرّره */
  const stat = await store.questionStat(question.id);
  res.json({
    id: question.id,
    bankId: bank.id,
    bankName: bank.name,
    q: question.q,
    options: question.options,
    answer: question.answer,
    level: question.level,
    flag: question.flag ?? null,
    shown: stat?.shown ?? 0,
    correct: stat?.correct ?? 0,
    wrong: stat?.wrong ?? 0,
    rate: stat?.rate ?? null,
    reports: (await store.reportCounts()).get(question.id) ?? 0,
    issues: auditQuestion(question),
  });
});

/** فحصٌ فوريّ لسؤالٍ قيد الكتابة — قبل أن يُحفظ */
app.post('/api/console/check', owner, (req, res) => {
  res.json({ issues: auditQuestion(req.body ?? {}) });
});

/** ما لا يُرى إلا بالنظر إلى البنوك مجتمعة */
app.get('/api/console/duplicates', owner, (_req, res) => {
  res.json(auditAll(allBanks()).duplicates);
});

function readQuestion(body) {
  const options = (Array.isArray(body?.options) ? body.options : []).map((o) =>
    String(o ?? '').trim(),
  );
  const flag = flagCode(body?.flag);
  return {
    q: String(body?.q ?? '').trim(),
    options,
    answer: 0, // الصواب أوّل الخيارات — والخلط يقع عند التوزيع
    level: Number(body?.level) || 2,
    ...(flag ? { flag } : {}),
  };
}

/** إضافة سؤال — يُرفض إن كان فيه خطأٌ يكسر اللعبة، ويمرّ مع التنبيهات */
app.post('/api/console/bank/:id/question', owner, async (req, res) => {
  const bank = allBanks().find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });

  const question = readQuestion(req.body);
  const issues = auditQuestion(question);
  if (issues.some((i) => i.severity === 'error')) return res.status(400).json({ issues });

  await saveBank(bank.id, [...bank.questions, question]);
  res.json({ ok: true, issues });
});

/**
 * تحرير سؤال.
 *
 * وتغييرُ النصّ أو الخيارات يمحو الإحصاء والبلاغات: ما قِيس إنما قِيس على
 * سؤالٍ آخر، ونسبةُ صوابٍ محسوبةٌ على نصٍّ لم يعد موجوداً كذبٌ مرتّب. فهو
 * بعد التحرير سؤالٌ جديدٌ بلا تاريخ.
 *
 * والنسخةُ القديمة تُحفظ ثلاثين يوماً في صفحة «الأسئلة المحرَّرة»: تُراجَع
 * أو تُرجَع. فالمحوُ لا رجعة فيه، وما لا رجعة فيه يحتاج بابَ رجوع.
 *
 * وتغييرُ المستوى وحده لا يمحو شيئاً: المستوى وصفٌ للسؤال لا سؤالٌ آخر،
 * وما قِيس من صوابٍ وخطأ يصفه كما هو.
 */
app.put('/api/console/question/:id', owner, async (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });

  const question = readQuestion(req.body);
  const issues = auditQuestion(question);
  if (issues.some((i) => i.severity === 'error')) return res.status(400).json({ issues });

  const before = found.question;
  /* المحرّرُ لا يعرف العلم بعد: ما لم يُرسَل علمٌ بقي علمُ السؤال كما كان */
  if (!('flag' in (req.body ?? {})) && before.flag) question.flag = before.flag;
  const fromBank = found.bank;

  /* بنكُ الوجهة: إن لم يُرسَل أو كان مجهولاً بقي السؤال في مكانه */
  const wantBank = typeof req.body?.bank === 'string' ? req.body.bank : fromBank.id;
  const toBank = allBanks().find((b) => b.id === wantBank) ?? fromBank;

  const changed = question.q !== before.q || question.options.join(' ') !== before.options.join(' ');
  const moving = toBank.id !== fromBank.id;

  /* لا يُترك البنكُ الأصل فارغاً بنقلِ آخر سؤالٍ فيه */
  if (moving && fromBank.questions.length <= 1) {
    return res.status(400).json({ error: 'لا يُترك البنك فارغاً' });
  }
  /* ولا يُنقل سؤالٌ إلى بنكٍ فيه نصُّه ذاته — فيلتبس معرّفاه */
  if (
    moving &&
    toBank.questions.some((q) => q.q === question.q && (q.flag ?? null) === (question.flag ?? null))
  ) {
    return res.status(400).json({ error: 'في البنك الهدف سؤالٌ بالنصّ نفسه' });
  }

  const next = moving
    ? fromBank.questions.filter((q) => q.id !== req.params.id)
    : fromBank.questions.map((q) => (q.id === req.params.id ? question : q));
  await saveBank(fromBank.id, next);

  /*
   * نقلٌ إلى بنكٍ آخر: يُنزَع من الأصل ويُضاف إلى الهدف. فإن لم يتغيّر نصُّه
   * فهو السؤالُ نفسه أُعيد تصنيفُه — تُنقل إحصاؤه وبلاغاته معه إلى معرّفه
   * الجديد. وإن غُيّر نصُّه مع النقل فهو سؤالٌ جديدٌ يُمحى إحصاؤه ويُؤرشَف.
   */
  if (moving) {
    const toFresh = allBanks().find((b) => b.id === toBank.id);
    await saveBank(toBank.id, [...toFresh.questions, question]);
    const newId = newIdOf(toBank.id, question.q, question.flag);
    if (!changed) {
      if (newId) await store.moveQuestionStats(before.id, newId, toBank.id);
      return res.json({ ok: true, issues, statsReset: false, moved: true });
    }
    const clearedMove = await store.clearQuestion(before.id);
    await store.recordEdit({
      kind: 'edit',
      bankId: fromBank.id,
      oldId: before.id,
      newId,
      oldQ: before.q,
      oldOptions: before.options,
      oldLevel: before.level,
      newQ: question.q,
      newOptions: question.options,
      newLevel: question.level,
      cleared: clearedMove,
    });
    return res.json({ ok: true, issues, statsReset: true, moved: true, cleared: clearedMove });
  }

  let cleared = null;
  if (changed) {
    cleared = await store.clearQuestion(before.id);
    /* المعرّف بصمةُ النصّ، فتحريرُ النصّ يلده جديداً — ونقرؤه من المحفوظ */
    const after = findQuestion(before.id) ? before.id : null;
    await store.recordEdit({
      kind: 'edit',
      bankId: fromBank.id,
      oldId: before.id,
      newId: after ?? newIdOf(fromBank.id, question.q),
      oldQ: before.q,
      oldOptions: before.options,
      oldLevel: before.level,
      newQ: question.q,
      newOptions: question.options,
      newLevel: question.level,
      cleared,
    });
  }

  res.json({ ok: true, issues, statsReset: changed, cleared });
});

/** معرّفُ السؤال بعد الحفظ — يُقرأ من البنك لا يُحسب هنا */
function newIdOf(bankId, text, flag) {
  const bank = allBanks().find((b) => b.id === bankId);
  return bank?.questions.find((q) => q.q === text && (q.flag ?? null) === (flag ?? null))?.id ?? null;
}

/** الحذف كالتحرير: يمحو ما قِيس، ويُحفظ في الأرشيف ليُرجَع إن نُدم عليه */
app.delete('/api/console/question/:id', owner, async (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });

  /*
   * ويُترك البنك فارغاً اليوم — إلا أن تلعب به غرفةٌ قائمة.
   *
   * كان المنعُ مطلقاً لأن البنك الفارغ يُعطي `poolFor` مجموعةً خاوية فتُسحب
   * جولةٌ بلا سؤال. وقد صار الفارغُ محجوباً عن اللعبة أصلاً (playableBanks)،
   * فلا يُختار لغرفةٍ جديدة — فبقي أن يُحرس من غرفةٍ اختارته قبل أن يفرغ،
   * وهي وحدها التي تُكسر. ومن أراد إخلاءه ليبدأ من جديد فله ذلك.
   */
  const busy = [...allRooms()].filter((room) => room.bankIds.includes(found.bank.id));
  if (found.bank.questions.length <= 1 && busy.length) {
    const codes = busy.map((room) => room.code).join('، ');
    return res.status(400).json({ error: `آخرُ سؤالٍ في بنكٍ تستعمله غرفة: ${codes}` });
  }
  const before = found.question;
  await saveBank(
    found.bank.id,
    found.bank.questions.filter((q) => q.id !== req.params.id),
  );
  const cleared = await store.clearQuestion(before.id);
  await store.recordEdit({
    kind: 'delete',
    bankId: found.bank.id,
    oldId: before.id,
    newId: null,
    oldQ: before.q,
    oldOptions: before.options,
    oldLevel: before.level,
    cleared,
  });
  res.json({ ok: true, cleared });
});

/* ── الأسئلة المحرَّرة: أرشيفُ ثلاثين يوماً ── */

/**
 * حذفُ بنكٍ كاملاً — ويُؤرشَف بأسئلته فيُرجَع.
 *
 * ثلاثُ بواباتٍ قبل الحذف: لا يُحذف آخر بنك (اللعبة بلا سؤالٍ لا تقوم)،
 * ولا بنكٌ تستعمله غرفةٌ في الذاكرة (أسئلةُ لاعبٍ تُسحب من تحته وهو يلعب —
 * والغرفةُ تُحذف من لوحة الغرف إن أراد)، والمعرّفُ يجب أن يكون معروفاً.
 */
app.delete('/api/console/bank/:id', owner, async (req, res) => {
  const bank = allBanks().find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });

  const busy = [...allRooms()].filter((room) => room.bankIds.includes(bank.id));
  if (busy.length) {
    const codes = busy.map((room) => room.code).join('، ');
    return res.status(400).json({ error: `البنك مستعملٌ في غرفة: ${codes}` });
  }

  /* يُؤرشَف أولاً ثم يُحذف: لو سقط الحذف بقي أرشيفٌ زائد — ولو سقط الأرشيف لم يُمحَ شيء */
  const trashId = await store.trashBank({
    bankId: bank.id,
    name: bank.name,
    questions: bank.questions.map((item) => ({
      q: item.q,
      options: item.options,
      level: item.level,
    })),
  });
  try {
    await deleteBank(bank.id);
  } catch (err) {
    await store.forgetTrashedBank(trashId);
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true, trashId, questions: bank.questions.length });
});

/**
 * إنشاءُ بنكٍ — اسمٌ ومعرّف، ويُولد فارغاً.
 *
 * فالبنكُ لم يكن له بابٌ قبل اليوم: لا يُولد إلا زرعاً من ملفّات المستودع
 * عند أوّل إقلاع أو إرجاعاً من السلّة. ومن أراد بنكاً جديداً لم يملك إلا
 * أن يكتب ملفَّ JSON ويرفعه إلى git وينشر.
 *
 * ويُولد فارغاً بلا حرج: playableBanks يحجبه عن اللعبة حتى يدخله سؤال.
 */
app.post('/api/console/bank', owner, async (req, res) => {
  try {
    const bank = await writeBank({ id: req.body?.id, name: req.body?.name, questions: [] });
    res.json({ ok: true, id: bank.id, name: bank.name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * تفعيلُ بنكٍ وإلغاؤه — حجبٌ عن اللعبة لا حذف.
 *
 * الموسمُ ينتهي فلا يُراد بنكُه في قائمة المنظّم، ولا يُراد حذفُ ما بُني
 * في شهر. فيُلغى تفعيلُه: يبقى في اللوحة بأسئلته وإحصائه وبلاغاته، ويُقرأ
 * ويُحرَّر، ولا يُعرض لمن يُنشئ غرفة.
 *
 * ولا يُلغى تفعيلُ بنكٍ تلعب به غرفةٌ قائمة — كما لا يُحذف: اللعبةُ تسحب
 * مجموعتها كلَّ جولة، فالإلغاءُ في منتصف اللعب يُقلّص ما يُسحب من تحت لاعب.
 */
app.post('/api/console/bank/:id/active', owner, async (req, res) => {
  const bank = allBanks().find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });

  const want = req.body?.active === true;
  if (!want) {
    const busy = [...allRooms()].filter((room) => room.bankIds.includes(bank.id));
    if (busy.length) {
      const codes = busy.map((room) => room.code).join('، ');
      return res.status(400).json({ error: `البنك مستعملٌ في غرفة: ${codes}` });
    }
  }

  await setActive(bank.id, want);
  res.json({ ok: true, active: want });
});

/* ── الأسئلة المعلّقة ── */

/**
 * ما ينقص المعلَّق ليُعتمد: بنكٌ، وثلاثةُ أخطاءٍ، ومستوى.
 *
 * والمستوى من المطلوب صريحاً ولا يُفترض «متوسطاً»: البابُ كلُّه إنما فُتح
 * ليُكتب السؤالُ ناقصاً ويُراجَع — فافتراضُ وصفٍ لم يقرأه أحدٌ يُمرّر مئةَ
 * سؤالٍ بمستوًى لم يُنظر فيه، وهو عين ما يُراد تجنّبه.
 */
function missingOf(row) {
  const gaps = [];
  if (!row.bank) gaps.push('البنك');
  const wrongs = (row.wrongs ?? []).filter((text) => String(text ?? '').trim());
  if (wrongs.length < 3) gaps.push(`${3 - wrongs.length} من الخيارات الخاطئة`);
  if (![1, 2, 3].includes(row.level)) gaps.push('المستوى');
  return gaps;
}

/** السؤالُ كما يصير في البنك: الصوابُ أوّلَ الخيارات، والخلطُ عند التوزيع */
function asQuestion(row) {
  return {
    q: row.q,
    options: [row.answer, ...(row.wrongs ?? []).filter((text) => String(text ?? '').trim())],
    answer: 0,
    level: row.level ?? 2,
    ...(row.flag ? { flag: row.flag } : {}),
  };
}

/**
 * المعلّقة بحالِها: ما ينقصها، وما فيها من ملاحظات الفاحص، وأصلُ المكرّر.
 *
 * والتكرارُ يُقاس بـnormalizeText: فروقُ التشكيل والترقيم لا تصنع سؤالاً
 * جديداً، ومن لصق دفعةً فيها ما في البنك أراد أن يُقال له «هذا عندك» لا
 * أن يُضاف صامتاً فيراه لاعبٌ مرّتين في جولةٍ واحدة.
 *
 * ولا يُرفض المكرّر: ربّما كانت الصيغةُ الملصوقة أحسنَ من صيغة البنك،
 * فيُعتمد هذا ويُحذف ذاك. والحكمُ للمالك، والشارةُ تكفي لتنبيهه.
 */
function describePending(rows, banks) {
  const names = new Map(banks.map((b) => [b.id, b.name]));

  /* فهرسُ البنوك يُبنى مرّةً: خمسمئةُ معلَّقٍ في ألفِ سؤالٍ لا تُقارن بالتداخل */
  const inBanks = new Map();
  for (const bank of banks) {
    for (const question of bank.questions) {
      const key = questionKey(question.q, question.flag);
      if (key && !inBanks.has(key)) {
        inBanks.set(key, { bank: bank.id, bankName: bank.name, id: question.id });
      }
    }
  }

  /* والمعلَّقُ يُقارن بأخيه أيضاً: الأقدمُ أصلٌ والأحدثُ مكرّر */
  const seen = new Map();
  const twinOf = new Map();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const key = questionKey(row.q, row.flag);
    if (!key) continue;
    if (seen.has(key)) twinOf.set(row.id, seen.get(key));
    else seen.set(key, row.id);
  }

  return rows.map((row) => {
    const missing = missingOf(row);
    const key = questionKey(row.q, row.flag);
    return {
      ...row,
      bankName: row.bank ? (names.get(row.bank) ?? row.bank) : null,
      missing,
      ready: missing.length === 0,
      /* الفاحصُ لا يُستدعى على ناقصٍ: «الخيارات ٢ والمطلوب أربعة» ليس خبراً */
      issues: missing.length === 0 ? auditQuestion(asQuestion(row)) : [],
      duplicate: key ? (inBanks.get(key) ?? null) : null,
      twin: twinOf.get(row.id) ?? null,
    };
  });
}

app.get('/api/console/pending', owner, async (_req, res) => {
  res.json(describePending(await store.listPending(), allBanks()));
});

function readPendingBody(body) {
  const wrongs = (Array.isArray(body?.wrongs) ? body.wrongs : [])
    .map((text) => arabizeDigits(String(text ?? '').trim()))
    .filter(Boolean)
    .slice(0, 3);
  const level = Number(body?.level);
  return {
    bank: typeof body?.bank === 'string' && body.bank ? body.bank : null,
    q: arabizeDigits(String(body?.q ?? '').trim()),
    answer: arabizeDigits(String(body?.answer ?? '').trim()),
    wrongs,
    level: [1, 2, 3].includes(level) ? level : null,
    /* العلمُ إن أُرسل — وما لم يُرسَل يبقى undefined فيُبقي التحديثُ العلمَ القائم */
    ...('flag' in (body ?? {}) ? { flag: flagCode(body.flag) } : {}),
  };
}

/** إضافةُ معلَّقٍ واحد — سؤالٌ وجوابٌ يكفيان، وما زاد قُبل */
app.post('/api/console/pending', owner, async (req, res) => {
  const row = readPendingBody(req.body);
  if (!row.q) return res.status(400).json({ error: 'نصّ السؤال فارغ' });
  if (!row.answer) return res.status(400).json({ error: 'الإجابة الصحيحة فارغة' });
  if (row.bank && !allBanks().some((b) => b.id === row.bank)) {
    return res.status(400).json({ error: 'بنك غير معروف' });
  }
  const [id] = await store.addPending([{ ...row, source: 'manual' }]);
  res.json({ ok: true, id });
});

/**
 * استيرادُ دفعة — لصقاً أو ملفَّ CSV، والنصُّ واحدٌ في الحالين.
 *
 * و`dry` يقرأ ولا يكتب: تُعرض الحصيلةُ على المالك قبل أن تدخل — كم سطراً
 * فُهم، وكم سقط ولماذا، وأيُّها مكرّر. فمن لصق عموداً خطأً رآه قبل أن
 * يُدخل ثلاثمئةَ صفٍّ مقلوب.
 */
app.post('/api/console/pending/import', owner, async (req, res) => {
  const { rows, skipped } = parseIntake(req.body?.text);
  const wanted = typeof req.body?.bank === 'string' ? req.body.bank : '';
  const bank = wanted && allBanks().some((b) => b.id === wanted) ? wanted : null;
  const source = req.body?.source === 'csv' ? 'csv' : 'paste';
  const staged = rows.map((row) => ({ ...row, bank, source }));

  if (req.body?.dry === true) {
    /*
     * المعاينةُ تُوصف مع المحفوظ لا وحدَها.
     *
     * فالتكرارُ يُقاس في describePending على ما يُمرَّر إليها: لو مُرِّرت
     * الدفعةُ وحدها كُشف تكرارُها في نفسها وفي البنوك، وخفي أن سؤالاً منها
     * معلَّقٌ أصلاً من لصقةٍ قبلها — فيُقال «نظيف» ثم يظهر مكرّراً بعد أن
     * دخل. فتُوصف الدفعةُ في ذيل المحفوظ ثم يُقتطع ذيلُها.
     *
     * ومعرّفاتُها فوق أكبر محفوظ: الترتيبُ في describePending بالمعرّف،
     * والأقدمُ أصلٌ والأحدثُ مكرّر — فلو أُعطيت أرقاماً سالبة لصارت هي
     * الأصلَ وعُلِّم المحفوظُ مكرّراً، وهو مقلوب.
     */
    const kept = await store.listPending();
    const base = kept.reduce((top, row) => Math.max(top, row.id), 0) + 1;
    const described = describePending(
      [...kept, ...staged.map((row, i) => ({ ...row, id: base + i, at: Date.now() }))],
      allBanks(),
    );
    const preview = described.slice(kept.length);
    return res.json({ ok: true, dry: true, added: 0, rows: preview, skipped, max: MAX_ROWS });
  }

  const ids = await store.addPending(staged);
  res.json({ ok: true, added: ids.length, skipped, max: MAX_ROWS });
});

/** تحريرُ معلَّق: يُكمله المالك على مراحل، فكلُّ حفظٍ يُرسل الحالَ كلَّه */
app.put('/api/console/pending/:id', owner, async (req, res) => {
  const have = await store.getPending(req.params.id);
  if (!have) return res.status(404).json({ error: 'لا سؤال معلَّقٌ بهذا الرقم' });

  const row = readPendingBody(req.body);
  if (!row.q) return res.status(400).json({ error: 'نصّ السؤال فارغ' });
  if (!row.answer) return res.status(400).json({ error: 'الإجابة الصحيحة فارغة' });
  if (row.bank && !allBanks().some((b) => b.id === row.bank)) {
    return res.status(400).json({ error: 'بنك غير معروف' });
  }

  if (row.flag === undefined) row.flag = have.flag;
  await store.updatePending(have.id, row);
  res.json({ ok: true });
});

app.delete('/api/console/pending/:id', owner, async (req, res) => {
  const gone = await store.forgetPending(req.params.id);
  if (!gone) return res.status(404).json({ error: 'لا سؤال معلَّقٌ بهذا الرقم' });
  res.json({ ok: true });
});

/**
 * اعتمادُ معلَّق — ينتقل إلى بنكه ويخرج من الانتظار.
 *
 * ولا يُعتمد ناقصٌ ولا سؤالٌ فيه خطأٌ يكسر اللعبة: البابان يُحرسان في
 * الخادم لا في الواجهة وحدها، فطلبٌ يُرسل من غيرها لا يمرّ.
 *
 * والترتيبُ: يُكتب في البنك أولاً ثم يُنسى من المعلّقة. فلو سقط الحفظُ بقي
 * معلَّقاً يُعاد اعتمادُه، ولو سقط النسيانُ بقي معلَّقاً ودخل البنك — وهذا
 * يُرى فيُحذف، أما سؤالٌ ذهب من الجهتين فلا يُرى ولا يُستدرك.
 */
async function approveOne(row, banks) {
  const [described] = describePending([row], banks);
  if (!described.ready) return { error: `ناقص: ${described.missing.join(' و')}` };

  const bank = banks.find((b) => b.id === row.bank);
  if (!bank) return { error: 'بنك غير معروف' };

  const question = asQuestion(row);
  const bad = auditQuestion(question).find((i) => i.severity === 'error');
  if (bad) return { error: bad.message };

  await saveBank(bank.id, [...bank.questions, question]);
  await store.forgetPending(row.id);
  return { ok: true };
}

app.post('/api/console/pending/:id/approve', owner, async (req, res) => {
  const row = await store.getPending(req.params.id);
  if (!row) return res.status(404).json({ error: 'لا سؤال معلَّقٌ بهذا الرقم' });
  const done = await approveOne(row, allBanks());
  if (done.error) return res.status(400).json({ error: done.error });
  res.json({ ok: true });
});

/**
 * اعتمادُ الجاهز كلِّه — ومراجعةُ خمسين سؤالاً واحداً واحداً تُتعب.
 *
 * ويُعتمد ما كان جاهزاً لحظةَ الضغط: الناقصُ يبقى، وما فيه خطأٌ يبقى ويُقال
 * خبرُه. ومرشّحُ البنك يضيّق الفعل كما يضيّق النظر — فمن كان في بنكٍ بعينه
 * اعتُمد جاهزُه وحده، وذاك ما يُرسله في `bank`.
 */
app.post('/api/console/pending/approve', owner, async (req, res) => {
  const only = typeof req.body?.bank === 'string' && req.body.bank ? req.body.bank : null;
  const rows = await store.listPending();
  let approved = 0;
  const failed = [];
  for (const row of rows) {
    if (only && row.bank !== only) continue;
    if (missingOf(row).length > 0) continue;
    /* البنوكُ تُقرأ في كل دورة: saveBank بدّلها في الدورة التي قبلها */
    const out = await approveOne(row, allBanks());
    if (out.ok) approved++;
    else failed.push({ q: row.q, why: out.error });
  }
  res.json({ ok: true, approved, failed });
});

/** البنوك المحذوفة — تُعرض ثلاثين يوماً ثم تُنسى */
app.get('/api/console/trash', owner, async (_req, res) => {
  const live = new Set(allBanks().map((b) => b.id));
  res.json(
    (await store.listTrashedBanks()).map((row) => ({
      id: row.id,
      bank: row.bank,
      name: row.name,
      count: row.questions.length,
      at: row.at,
      /* أُرجِع فعلاً؟ يُقرأ من البنوك الحيّة لا من السلّة */
      restorable: !live.has(row.bank),
    })),
  );
});

/** إرجاعُ بنكٍ من السلّة بأسئلته كما كان */
app.post('/api/console/trash/:id/restore', owner, async (req, res) => {
  const row = await store.getTrashedBank(req.params.id);
  if (!row) return res.status(404).json({ error: 'لا بنك بهذا الرقم' });
  try {
    await writeBank({ id: row.bank, name: row.name, questions: row.questions });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  await store.forgetTrashedBank(row.id);
  res.json({ ok: true, count: row.questions.length });
});

/** نسيانُ بنكٍ من السلّة قبل الثلاثين — ولا رجعة بعده */
app.delete('/api/console/trash/:id', owner, async (req, res) => {
  const gone = await store.forgetTrashedBank(req.params.id);
  if (!gone) return res.status(404).json({ error: 'لا بنك بهذا الرقم' });
  res.json({ ok: true });
});

app.get('/api/console/edits', owner, async (_req, res) => {
  const names = new Map(allBanks().map((b) => [b.id, b.name]));
  res.json(
    (await store.listEdits()).map((row) => ({
      ...row,
      bankName: names.get(row.bank) ?? row.bank,
      /* أُرجِع فعلاً؟ يُقرأ من البنك لا من الأرشيف — والبنك هو الحقيقة */
      restorable: !findQuestion(row.oldId),
    })),
  );
});

/**
 * إرجاعُ نسخةٍ محفوظة.
 *
 * ويُرجع النسخة القديمة مكان الجديدة إن كانت تحريراً، ويُعيدها إلى البنك
 * إن كانت حذفاً. وإحصاؤها لا يعود — فقد مُحي حين حُرِّرت، وإرجاعُ النصّ
 * لا يُرجع ما قيس عليه. تبدأ من جديد.
 */
app.post('/api/console/edit/:id/restore', owner, async (req, res) => {
  const edit = await store.getEdit(req.params.id);
  if (!edit) return res.status(404).json({ error: 'لا نسخة بهذا الرقم' });

  const bank = allBanks().find((b) => b.id === edit.bank);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });
  if (findQuestion(edit.oldId)) return res.status(400).json({ error: 'السؤال موجودٌ أصلاً' });

  const old = { q: edit.oldQ, options: edit.oldOptions, answer: 0, level: edit.oldLevel };
  const questions =
    edit.kind === 'edit' && edit.newId && bank.questions.some((q) => q.id === edit.newId)
      ? bank.questions.map((q) => (q.id === edit.newId ? old : q))
      : [...bank.questions, old];

  await saveBank(bank.id, questions);
  await store.forgetEdit(edit.id);
  res.json({ ok: true });
});

/**
 * حذفُ سجلٍّ من الأرشيف — نسيانٌ مبكّر قبل تمام الثلاثين يوماً.
 *
 * السجلُّ نسخةٌ للتراجع لا غير، فحذفُه لا يمسّ البنك ولا يُرجع شيئاً: إنما
 * يُخلي الأرشيف ممّا لم يعد المالكُ يريد الاحتفاظ به. ومن حذف سجلّ حذفٍ فقد
 * تخلّى عن بابِ إرجاعه.
 */
app.delete('/api/console/edit/:id', owner, async (req, res) => {
  const gone = await store.forgetEdit(req.params.id);
  if (!gone) return res.status(404).json({ error: 'لا نسخة بهذا الرقم' });
  res.json({ ok: true });
});

/**
 * محوُ السجلّ كلّه — لا ما يعرضه المرشّح.
 *
 * مرشّحُ البنك والبحث يضيّق النظر لا الأرشيف، فـ«كلّه» كلُّه: نسخُ البنوك
 * جميعاً. ويبقى هذا نسخَ تراجعٍ وحدها: لا بنكاً يُمسّ ولا سؤالاً قائماً.
 */
app.delete('/api/console/edits', owner, async (_req, res) => {
  const gone = await store.forgetAllEdits();
  res.json({ ok: true, gone });
});

// الواجهة المبنية — يخدمها نفس السيرفر حتى يكون النشر بعملية واحدة
/* ══════════════ بطاقةُ الرابط ══════════════ */

const INDEX = join(root, 'client', 'dist', 'index.html');
let shell = { at: 0, html: '' };

/** الصفحةُ من القرص، وتُعاد قراءتها إن تغيّرت — فالبناء يحدث والخادم يعمل */
function page() {
  const at = statSync(INDEX).mtimeMs;
  if (at !== shell.at) shell = { at, html: readFileSync(INDEX, 'utf8') };
  return shell.html;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/* اسمُ الغرفة يكتبه المنظّم، ويُدسّ في HTML — فلا يدخل إلا مهروباً */
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

const meta = (html, key, value) =>
  html.replace(new RegExp(`(property="og:${key}" content=")[^"]*`), `$1${value}`);

/**
 * تُركَّب البطاقة عند الطلب لا عند البناء.
 *
 * فزاحفُ واتساب وتويتر لا يشغّل JS: ما ليس في HTML المُرسَل لا يُرى.
 * وعنوانُ الصورة لا بدّ أن يكون مطلقاً، والنطاقُ لا يُعرف وقت البناء —
 * فيُقرأ من ترويسة الطلب. ورابطُ الغرفة يأخذ بطاقته باسمها.
 */
async function serve(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  const origin = `${proto}://${req.headers.host}`;
  const code = String(req.query.code || '').toUpperCase();
  let html = page();
  let card = '/og.png';
  /*
   * الرمزُ وحده يُعاد في og:url. ورابطُ المنظّم يحمل المفتاح في استعلامه،
   * ولو أُعيد العنوان كاملاً لنُشر المفتاح في بطاقةٍ تُقرأ من كل مكان.
   */
  let path = req.path;

  if (req.path === '/play' && /^[A-Z0-9]{4,6}$/.test(code)) {
    /*
     * الحيّةُ من الذاكرة، والمنقضيةُ من القاعدة — والثانيةُ وعدٌ يُنتظر.
     * ولو نُسي انتظارُه لخرجت البطاقة تدعو إلى غرفة «undefined».
     */
    const room = getRoom(code) ?? (await store.roomDetail(code));
    if (room) {
      const name = esc(room.name);
      card = '/og-play.png';
      path = `/play?code=${code}`;
      html = html.replace('<title>نبضة</title>', `<title>انضمّ إلى «${name}»، نبضة</title>`);
      html = meta(html, 'title', `انضمّ إلى «${name}» · نبضة`);
      html = meta(html, 'description', `رمز الغرفة ${code} · افتح الرابط واكتب اسم فريقك`);
      html = meta(html, 'image:alt', `دعوةٌ للانضمام إلى مسابقة ${name}`);
    }
  }

  html = meta(html, 'image', origin + card).replace(
    'property="og:url" content="/"',
    `property="og:url" content="${origin}${path}"`,
  );
  res.type('html').send(html);
}

/*
 * الخبز والتخزين.
 *
 * ملفاتُ assets مبصومةٌ بمحتواها: اسمُها يتغيّر إن تغيّر بايتٌ فيها، فلا
 * ضير أن تُخزَّن سنة. أما index.html فاسمُه ثابتٌ وهو الذي يدلّ عليها —
 * فلو خُزِّن بقي المتصفّح يطلب حزمةَ الأمس وإن بُنيت اليوم، ويرى المالك
 * عللاً أُصلحت. فيُطلب التحقّق منه في كل مرّة، والـETag يمنع إعادة
 * الإرسال إن لم يتبدّل.
 *
 * وما بينهما — الأيقونات والخطوط وصور النشر — ساعةٌ تكفي.
 */
const YEAR = 60 * 60 * 24 * 365;

/*
 * هل في القاعات أحدٌ الآن؟ كلُّ دفعٍ إلى main ينشر فوراً ويعيد تشغيل
 * السيرفر، فتتوقّف كلُّ جولةٍ جارية. فيُسأل هذا قبل الدفع: ‎npm run live‎.
 * أعدادٌ لا أسماء — لا يكشف شيئاً عن أحد.
 */
app.get('/api/live', (_req, res) => {
  let rooms = 0;
  let players = 0;
  let connected = 0;
  for (const room of allRooms()) {
    let here = 0;
    for (const team of room.teams.values()) if (team.connected) here++;
    connected += here;
    /* جولةٌ موقوفة هجرها أهلها (بعد إعادة تشغيلٍ مثلاً) ليست جولةً جارية */
    if (room.midRound() && here > 0) {
      rooms++;
      players += here;
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ live: rooms > 0, rooms, players, connected, instance: INSTANCE });
});

app.use(
  express.static(join(root, 'client', 'dist'), {
    index: false, // ليمرّ الجذرُ على بانية البطاقة بدل أن يُرسَل ملفاً خاماً
    setHeaders(res, file) {
      const stamped = file.includes(`${sep}assets${sep}`);
      res.setHeader(
        'Cache-Control',
        stamped ? `public, max-age=${YEAR}, immutable` : 'public, max-age=3600',
      );
    },
  }),
);

app.get('*', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache');
  /* الصفحةُ تُقرأ من القاعدة الآن، فسقوطُها يُسلَّم لمعالج الأخطاء لا للعدم */
  serve(req, res).catch(next);
});

/*
 * آخرُ ما يُسجَّل: ما سقط من معالجٍ — أو رُفض وعدُه — ينتهي هنا.
 *
 * ولا يُعاد نصُّ الخطأ إلى الطالب: رسائل القاعدة تحمل أسماء جداولها
 * وأعمدتها، وهي خريطةٌ لمن يبحث عن ثغرة. السجلُّ للمالك والرقمُ للطالب.
 */
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('✖ خطأٌ في طلب:', err?.message ?? err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'تعذّر تنفيذ الطلب' });
});

/*
 * البنوك أوّلاً: المرجعُ جدولُ banks في القاعدة، والملفّاتُ بذرةٌ تُزرع إن
 * كانت فارغة. وتقع قبل بعث الغرف — فالغرفةُ المبعوثة تُطابق بنوكَها على
 * الموجود، ولو تأخّرت التهيئةُ عنها لرُدّت بنوكُها إلى أوّل بنك.
 */
await initBanks();

/*
 * بعثُ ما كان: الغرف التي لم تخمل تعود كما تركها السيرفر — لكن موقوفة.
 * وتقع قبل أي اتصال، فأول لاعبٍ يفتح صفحته يجد غرفته مكانها.
 */
const revived = await store.loadSnapshots(IDLE_ROOM_MS);
for (const snap of revived) {
  try {
    restoreRoom(snap);
  } catch (err) {
    console.warn(`⚠ تعذّر بعث الغرفة ${snap?.code}: ${err.message}`);
  }
}
if (revived.length) console.log(`↺ عادت ${revived.length} غرفة من القرص، كلّها موقوفة`);
await store.sweepOld();

const channel = (code) => `room:${code}`;
/*
 * قناةٌ للمنظّم وحده. سجلّ الأسئلة يحمل مواضع الإجابات الصحيحة، وقناة
 * الغرفة يسمعها اللاعبون وشاشة القاعة — فلو مرّ فيها لقرأ اللاعب الجواب
 * من الشبكة قبل أن يجيب.
 */
const adminChannel = (code) => `admin:${code}`;
/* المراقبون — المنظّم وشاشة القاعة: وحدهم يرون مجاري الجميع حيّةً أثناء الجولة */
const watchChannel = (code) => `watch:${code}`;
/* اللاعبون: تصلهم حالُ الغرفة العامة بين الجولات، لا مع كل إجابة */
const playersChannel = (code) => `players:${code}`;

/**
 * يحفظ رأياً ويقول: أَحُفِظ؟
 *
 * والكتابة صارت تعبر الشبكة فقد تتعذّر، والمتّصل ينتظر رداً. فلو تركنا
 * الاستثناء يصعد من معالجٍ لا متزامن لسقط بلا مستمع فأسقط العملية —
 * وجولةُ قاعةٍ كاملة تموت لأن تعليقاً لم يُكتب. ونردّ بالفشل صريحاً:
 * صمتٌ يظنّه صاحبه نجاحاً أسوأ من خبرٍ سيّئ.
 */
async function keepFeedback(entry, reply) {
  try {
    await store.addFeedback(entry);
    return true;
  } catch (err) {
    console.warn('⚠ تعذّر حفظ الرأي:', err.message);
    reply?.({ ok: false, error: 'تعذّر الحفظ، حاول مرّة أخرى' });
    return false;
  }
}

/** آخر نسخةٍ من سجلّ الأسئلة أُرسلت لكل غرفة — فلا يُعاد إرسال ما لم يتغيّر */
const feedSent = new Map();

function pushFeed(room, force = false) {
  if (!force && feedSent.get(room.code) === room.feedVersion) return;
  feedSent.set(room.code, room.feedVersion);
  io.to(adminChannel(room.code)).emit('admin:feed', room.feedState());
}

/*
 * ══════════════ البثّ ══════════════
 *
 * كان السيرفر يبثّ كل ربع ثانية حالَ الغرفة كاملةً (كل الفرق وسجلّ
 * الجولات) إلى كل جهاز، وحالَ كل فريقٍ إلى صاحبه — والجولة تجري أو لا.
 * فالحِمل يكبر بمربّع العدد: ثلاثون لاعباً ١٫٤ ميغا في الثانية، ومئةٌ
 * ١٣٫٦ ميغا. وفي واي فاي القاعة تتكدّس الرسائل فتتأخّر نبضاتُ الاطمئنان
 * فيُقطع الجوّال وهو حيّ.
 *
 * والوقتُ لا يحتاج بثّاً: ينزل عند الجميع بالسرعة نفسها، والمتصفّح يعدّه
 * بنفسه من آخر قيمةٍ وصلته (lib/clock.ts). فلا يُرسل إلا ما تغيّر فعلاً:
 *
 *  - حالُ الفريق إلى صاحبه فور أن تتغيّر (إجابته، شراؤه…).
 *  - حالُ الغرفة إلى المراقبين، مجموعةً في دفعةٍ كل ربع ثانية على الأكثر.
 *  - وإلى اللاعبين بين الجولات وحدها، دفعةً كل ثانية على الأكثر — فأثناء
 *    السؤال لا يُعرض عليهم غيرُ سؤالهم.
 *  - وتحوّلاتُ الجولة (بدءٌ، نهاية، إيقاف) تُرسل للجميع فوراً.
 *  - ومزامنةٌ احتياطية كل خمس ثوانٍ أثناء الجولة، لرسالةٍ ضاعت أو ساعةٍ زلّت.
 */
const WATCH_MS = 250;
const PLAYERS_MS = 1000;
const RESYNC_MS = 5000;

/* ما ينتظر الإرسال لكل غرفة: code → { watch, players, playersAt, teams } */
const pending = new Map();

function slot(room) {
  let entry = pending.get(room.code);
  if (!entry) {
    entry = { watch: false, players: false, playersAt: 0, teams: new Set() };
    pending.set(room.code, entry);
  }
  return entry;
}

/* اللاعبون يقرؤون قائمة الفرق بين الجولات — والمنتظِرُ منهم يراها أثناءها */
function playersNeedPublic(room) {
  if (room.status !== 'running' && room.status !== 'countdown') return true;
  for (const team of room.teams.values()) if (team.waiting) return true;
  return false;
}

/** يُعلّم ما تغيّر في الغرفة — فيُرسل في الدفعة القادمة مجموعاً */
function changed(room, { teams = [], players = false } = {}) {
  const entry = slot(room);
  entry.watch = true;
  if (players || playersNeedPublic(room)) entry.players = true;
  for (const id of teams === 'all' ? room.teams.keys() : teams) if (id) entry.teams.add(id);
}

function pushTeam(room, teamId) {
  const state = room.teamState(teamId);
  if (state) io.to(`team:${teamId}`).emit('team:state', state);
}

/** كلُّ شيءٍ للجميع الآن — لتحوّلات الجولة وأفعال المنظّم، وهي نادرة */
function pushAll(room) {
  const state = room.publicState();
  io.to(watchChannel(room.code)).emit('room:state', state);
  io.to(playersChannel(room.code)).emit('room:state', state);
  for (const teamId of room.teams.keys()) pushTeam(room, teamId);
  const entry = pending.get(room.code);
  if (entry) {
    entry.watch = false;
    entry.players = false;
    entry.playersAt = Date.now();
    entry.teams.clear();
  }
}

/** الدفعة: ما تراكم منذ السابقة يُرسل مرّةً واحدة */
function flushPending(now = Date.now()) {
  for (const [code, entry] of pending) {
    const room = getRoom(code);
    if (!room) {
      pending.delete(code);
      continue;
    }
    let state = null;
    const current = () => (state ??= room.publicState());
    if (entry.watch) {
      io.to(watchChannel(code)).emit('room:state', current());
      entry.watch = false;
    }
    if (entry.players && now - entry.playersAt >= PLAYERS_MS) {
      io.to(playersChannel(code)).emit('room:state', current());
      entry.players = false;
      entry.playersAt = now;
    }
    for (const teamId of entry.teams) pushTeam(room, teamId);
    entry.teams.clear();
  }
}

/*
 * حارسُ السيل: لكل اتصالٍ دلوٌ من عشرين حدثاً يمتلئ بعشرةٍ في الثانية.
 * لا يبلغه لاعبٌ ولا منظّم بيده — وإنما سكربتٌ أو جهازٌ علِق في حلقة،
 * فيُسقَط ما زاد قبل أن يُثقل السيرفر على القاعة كلّها.
 */
/* هويّةُ هذه العملية: تظهر في ‎/api/live‎ — فإن تعدّدت بين طلبين فالمنصّة تشغّل نسختين */
const INSTANCE = randomBytes(4).toString('hex');

const BURST = 20;
const REFILL_PER_SEC = 10;

io.on('connection', (socket) => {
  // ما يخص هذا الاتصال: أي غرفة، وبأي دور
  let ctx = null;

  let tokens = BURST;
  let filledAt = Date.now();
  socket.use((_packet, next) => {
    const now = Date.now();
    tokens = Math.min(BURST, tokens + ((now - filledAt) / 1000) * REFILL_PER_SEC);
    filledAt = now;
    if (tokens < 1) return; // يُسقط بصمت — ومن ينتظر رداً تنتهي مهلته عنده
    tokens -= 1;
    next();
  });

  /* يفكّ هذا السوكِت عن فريقٍ كان له — فلا يُعدّ حاضراً فيه بعد اليوم */
  const detach = () => {
    if (ctx?.role !== 'team') return;
    const room = getRoom(ctx.code);
    const team = room?.teams.get(ctx.teamId);
    socket.leave(`team:${ctx.teamId}`);
    if (!team) return;
    team.sockets.delete(socket.id);
    team.connected = team.sockets.size > 0;
    if (!team.connected) team.disconnectedAt = Date.now();
    changed(room);
  };

  const attachTeam = (room, team) => {
    if (ctx?.role === 'team' && ctx.teamId !== team.id) detach();
    ctx = { role: 'team', code: room.code, teamId: team.id };
    socket.join(`team:${team.id}`);
    socket.join(channel(room.code));
    socket.join(playersChannel(room.code));
    team.sockets.add(socket.id);
    team.connected = true;
    team.disconnectedAt = null;
    changed(room);
  };

  const attachAdmin = (room) => {
    detach();
    ctx = { role: 'admin', code: room.code };
    socket.join(channel(room.code));
    socket.join(adminChannel(room.code));
    socket.join(watchChannel(room.code));
  };

  const attachDisplay = (room) => {
    detach();
    ctx = { role: 'display', code: room.code };
    socket.join(channel(room.code));
    socket.join(watchChannel(room.code));
  };

  /*
   * الهويّة تصل مع الاتصال نفسه (handshake.auth) لا في طلبٍ بعده.
   *
   * كان الجوّال يتّصل ثم يطلب «رجّعني لفريقي» ويمهل الردَّ ست ثوانٍ، فإن
   * أبطأ — والوصل عبر الشبكة الموزّعة يأخذ أربعاً وحده — حسب الجلسة منتهيةً
   * فمحاها: فيُطرد اللاعب إلى الباب، أو تبقى شاشتُه بلا سوكِتٍ في الغرفة
   * فتعلق. وإجابةٌ ضُغطت أثناء الانقطاع كانت تصل قبل طلب الرجوع فتُرمى بلا
   * فريق. والآن السيرفر يعرف الجهاز قبل أن يقرأ منه حدثاً واحداً.
   *
   * ولا تُمحى جلسةٌ إلا بقولٍ صريح من هنا (session:invalid) — فالمهلةُ
   * والانقطاع لا يمحوان شيئاً بعد اليوم.
   */
  socket.emit('server:hello', { build: BUILD });
  const auth = socket.handshake.auth ?? {};
  if (auth.team) {
    const { code, teamId, token } = auth.team;
    const room = getRoom(code);
    const team = room?.teams.get(teamId);
    if (room && team && team.token === token) {
      attachTeam(room, team);
      socket.emit('session:resumed', {
        role: 'team',
        state: room.teamState(team.id),
        room: room.publicState(),
      });
    } else {
      socket.emit('session:invalid', {
        role: 'team',
        error: room ? 'انتهت جلستك في هذه الغرفة، انضم من جديد' : 'انتهت هذه الغرفة',
      });
    }
  } else if (auth.admin) {
    const room = getRoom(auth.admin.code);
    if (room && room.adminKey === auth.admin.adminKey) {
      attachAdmin(room);
      socket.emit('session:resumed', { role: 'admin', code: room.code, state: room.publicState() });
      pushFeed(room, true);
    } else {
      socket.emit('session:invalid', { role: 'admin', error: room ? 'مفتاح المسؤول غير صحيح' : 'الغرفة غير موجودة' });
    }
  } else if (auth.display) {
    const room = getRoom(auth.display.code);
    if (room) {
      attachDisplay(room);
      socket.emit('session:resumed', { role: 'display', state: room.publicState() });
    } else {
      socket.emit('session:invalid', { role: 'display', error: 'الغرفة غير موجودة' });
    }
  }

  /*
   * طلبُ مزامنة: يرسله المتصفّح إذا عاد إلى الواجهة بعد أن نام (قفلُ
   * الشاشة يجمّد الصفحة والسوكِت قد يبدو حيّاً)، فتُعاد إليه حالُه كاملة.
   */
  socket.on('session:sync', (_payload, reply) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return reply?.({ ok: false });
    if (ctx.role === 'team') {
      const state = room.teamState(ctx.teamId);
      if (!state) return reply?.({ ok: false, gone: true });
      return reply?.({ ok: true, state, room: room.publicState() });
    }
    reply?.({ ok: true, state: room.publicState() });
  });

  const asAdmin = () => {
    if (ctx?.role !== 'admin') return null;
    return getRoom(ctx.code);
  };

  socket.on('admin:createRoom', ({ bankIds, settings, difficulty, name } = {}, reply) => {
    // الاسم إلزاميّ: هو ما يُميّز الغرفة في السجلّ بعد شهرين من رمزها
    const clean = String(name || '')
      .trim()
      .slice(0, 40);
    if (!clean) return reply?.({ ok: false, error: 'اكتب اسم الغرفة' });
    const room = createRoom(bankIds, settings, difficulty, clean);
    attachAdmin(room);
    reply?.({
      ok: true,
      code: room.code,
      adminKey: room.adminKey,
      state: room.publicState(),
    });
  });

  socket.on('admin:join', ({ code, adminKey } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    if (room.adminKey !== adminKey) return reply?.({ ok: false, error: 'مفتاح المسؤول غير صحيح' });
    attachAdmin(room);
    reply?.({ ok: true, code: room.code, state: room.publicState() });
    pushFeed(room, true); // المنظّم عاد — يستحقّ السجلّ كاملاً ولو لم يتغيّر
  });

  socket.on('admin:updateSettings', ({ settings } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (room.status === 'running') {
      return reply?.({
        ok: false,
        error: 'أوقف الجولة أولاً قبل تعديل الإعدادات',
      });
    }
    room.settings = { ...room.settings, ...settings };
    for (const team of room.teams.values()) team.resetForRound(room.settings);
    pushAll(room);
    reply?.({ ok: true });
  });

  // البنوك والمستوى يُضبطان معاً: كلاهما يصف ما سيُسأل عنه اللاعبون
  socket.on('admin:setBanks', ({ bankIds, difficulty } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (bankIds) room.bankIds = normalizeBankIds(bankIds);
    if (difficulty) room.difficulty = normalizeDifficulty(difficulty);
    changed(room, { players: true });
    reply?.({ ok: true });
  });

  socket.on('admin:start', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (!room.start()) return reply?.({ ok: false, error: 'لا يوجد فرق بعد' });
    io.to(channel(room.code)).emit('room:started');
    pushAll(room);
    pushFeed(room);
    reply?.({ ok: true });
  });

  /*
   * إعادةُ الجولة الحالية. لا تُقبل إلا والجولة موقوفة — فالإعادة قرارٌ
   * يُتّخذ بعد أن تسكن القاعة، لا ضغطةٌ تُفلت أثناء اللعب.
   */
  socket.on('admin:restartRound', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (!room.restartRound()) {
      return reply?.({ ok: false, error: 'أوقف الجولة أولاً ثم أعِدها' });
    }
    io.to(channel(room.code)).emit('room:started');
    pushAll(room);
    pushFeed(room);
    reply?.({ ok: true });
  });

  socket.on('admin:pause', () => {
    const room = asAdmin();
    if (room) (room.pause(), pushAll(room));
  });

  socket.on('admin:resume', () => {
    const room = asAdmin();
    if (room) (room.resume(), pushAll(room));
  });

  socket.on('admin:adjustTime', ({ teamId, seconds } = {}) => {
    const room = asAdmin();
    if (room) (room.adjustTime(teamId, Number(seconds) || 0), changed(room, { teams: [teamId] }));
  });

  socket.on('admin:adjustScore', ({ teamId, points } = {}) => {
    const room = asAdmin();
    if (room) (room.adjustScore(teamId, Number(points) || 0), changed(room, { teams: [teamId] }));
  });

  socket.on('admin:finishGame', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    room.finish();
    io.to(channel(room.code)).emit('room:finished', room.standings);
    pushAll(room);
    reply?.({ ok: true });
  });

  socket.on('admin:reopenCards', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    room.reopenCards();
    pushAll(room);
    reply?.({ ok: true });
  });

  socket.on('admin:toggleBlur', () => {
    const room = asAdmin();
    if (!room) return;
    room.displayBlurred = !room.displayBlurred;
    room.touch();
    changed(room);
  });

  socket.on('admin:newRound', () => {
    const room = asAdmin();
    if (room) (room.newRound(), pushAll(room));
  });

  socket.on('admin:resetAll', () => {
    const room = asAdmin();
    if (room) (room.resetAll(), pushAll(room));
  });

  socket.on('admin:removeTeam', ({ teamId } = {}) => {
    const room = asAdmin();
    if (!room) return;
    io.to(`team:${teamId}`).emit('team:removed');
    room.removeTeam(teamId);
    /* خصومُ الباقين في متجرهم نقصوا واحداً — فتُعاد حالُ كلٍّ منهم */
    changed(room, { teams: 'all', players: true });
  });

  socket.on('display:join', ({ code } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    attachDisplay(room);
    reply?.({ ok: true, state: room.publicState() });
  });

  socket.on('team:join', ({ code, name, device } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'رمز الغرفة غير صحيح' });
    /*
     * الجولةُ الجارية لا تُغلق الباب: كان الانضمام يُرفض فيقف اللاعب بلا
     * شاشةٍ ولا خبر ويعيد المحاولة مراراً. فصار يُقبل منتظِراً — تُسجَّل
     * مجموعته وتظهر للمنظّم، وشاشتُه تقول له متى يبدأ (room.addTeam هو
     * من يُعلّم الانتظار، فالحالُ عنده).
     */
    const clean = String(name || '')
      .trim()
      .slice(0, 24);
    if (!clean) return reply?.({ ok: false, error: 'اكتب اسم الفريق' });
    const deviceId = typeof device === 'string' ? device.slice(0, 64) : null;

    /*
     * الجهازُ نفسه بالاسم نفسه: يعود إلى مجموعته بنقاطها ومكانها — خرج
     * من اللعبة ثم ندم، أو ضاعت جلسته. وكان يُقال له «الاسم مستخدم» وهو
     * صاحبُه، فيدخل باسمٍ آخر من الصفر ويبقى اسمُه الأول شبحاً في القائمة.
     */
    const mine = room.teamOfDevice(clean, deviceId);
    if (mine) {
      attachTeam(room, mine);
      return reply?.({
        ok: true,
        teamId: mine.id,
        token: mine.token,
        resumed: true,
        state: room.teamState(mine.id),
      });
    }

    const taken = [...room.teams.values()].some((t) => t.name === clean);
    if (taken) return reply?.({ ok: false, error: 'الاسم مستخدم، اختر اسماً آخر' });
    if (room.teams.size >= MAX_TEAMS) {
      return reply?.({ ok: false, error: 'الغرفة ممتلئة، راجع المنظّم' });
    }

    const team = room.addTeam(clean, deviceId);
    attachTeam(room, team);
    changed(room, { teams: 'all', players: true }); // قائمةُ الخصوم في متاجر الباقين زادت واحداً
    reply?.({
      ok: true,
      teamId: team.id,
      token: team.token,
      state: room.teamState(team.id),
    });
  });

  // الرجوع بعد انقطاع النت — العداد استمر في السيرفر ولم يتأثر
  socket.on('team:rejoin', ({ code, teamId, token } = {}, reply) => {
    const room = getRoom(code);
    const team = room?.teams.get(teamId);
    if (!room || !team || team.token !== token) {
      return reply?.({ ok: false, error: 'انتهت الجلسة، انضم من جديد' });
    }
    attachTeam(room, team);
    reply?.({ ok: true, teamId, token, state: room.teamState(teamId) });
  });

  /*
   * بلاغٌ على سؤال. لا يُسقط السؤال عن أحد ولا يُوقف شيئاً — إشارةٌ تُسجَّل
   * ويراها المالك لاحقاً. وبلا هويّة: المهمّ السؤال لا من رآه.
   */
  socket.on('admin:report', async ({ questionId, reason, note } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    const record = room.served.get(questionId);
    if (!record) return reply?.({ ok: false, error: 'هذا السؤال لم يُعرض في هذه الغرفة' });
    const saved = await keepFeedback(
      {
        kind: 'report',
        questionId,
        question: record.q,
        roomCode: room.code,
        roomName: room.name,
        reason: String(reason || '').slice(0, 40),
        note: String(note || '')
          .trim()
          .slice(0, 300),
        byRole: 'admin',
      },
      reply,
    );
    /* لا يُعلَن نجاحٌ لم يقع: keepFeedback ردّ بالفشل، ونحن نصمت هنا */
    if (!saved) return;
    room.markReported(questionId);
    pushFeed(room);
    reply?.({ ok: true });
  });

  /*
   * بلاغ اللاعب — من تبويب المراجعة بعد الجولة.
   *
   * ولا يُقبل أثناء الجولة أصلاً: المراجعة لا تصل اللاعب إلا بعد انتهائها،
   * فلا معرّف سؤالٍ بيده يُبلّغ عنه وهو يلعب. والوقت يجري، وشغلُه بالتبليغ
   * يسرق من نبضه.
   */
  socket.on('team:report', async ({ questionId, reason, note } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    const record = room?.served.get(questionId);
    if (!record) return reply?.({ ok: false, error: 'هذا السؤال لم يُعرض في هذه الغرفة' });
    const saved = await keepFeedback(
      {
        kind: 'report',
        questionId,
        question: record.q,
        roomCode: room.code,
        roomName: room.name,
        reason: String(reason || '').slice(0, 40),
        note: String(note || '')
          .trim()
          .slice(0, 300),
        byRole: 'player', // بلا اسم: المهمّ السؤال لا من رآه
      },
      reply,
    );
    /* لا يُعلَن نجاحٌ لم يقع: keepFeedback ردّ بالفشل، ونحن نصمت هنا */
    if (!saved) return;
    /*
     * ولا يُعلَّم السؤال في سجلّ المنظّم ولا يُبثّ إليه.
     *
     * بلاغُ اللاعب وبلاغُ المنظّم يصلان المالك جميعاً، وصفةُ المُبلِّغ محفوظة
     * مع كلٍّ منهما — لكنّ المنظّم لا يُعرَض عليه ما بلّغ به لاعب: هو يدير
     * جولةً لا يُراجع شكاوى، وعلامةٌ حمراء تظهر له من حيث لا يدري تُشغله عمّا
     * بين يديه. وrooms.reported إنما وُضع ليمنعه من التبليغ مرّتين هو.
     */
    reply?.({ ok: true });
  });

  /*
   * التعليق على اللعبة — نجماتٌ ونصٌّ يُرسلان معاً لا صنفين.
   *
   * ويُقبل من المنظّم ومن اللاعب: كلاهما لعب، وكلاهما رأيُه يُبنى عليه.
   * وواحدٌ لكل جلسة، فلا يُغرق أحدٌ الجدول بضغطات.
   */
  socket.on('feedback:comment', async ({ stars, text } = {}, reply) => {
    if (!ctx) return reply?.({ ok: false, error: 'غير مصرح' });
    if (ctx.commented) return reply?.({ ok: false, error: 'وصلنا رأيك، شكراً لك' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });

    const rating = Number(stars);
    const rated = Number.isInteger(rating) && rating >= 1 && rating <= 5;
    const clean = String(text || '')
      .trim()
      .slice(0, 1000);
    if (!rated && !clean) return reply?.({ ok: false, error: 'اختر تقييماً أو اكتب رأيك' });

    const team = ctx.role === 'team' ? room.teams.get(ctx.teamId) : null;
    const saved = await keepFeedback(
      {
        kind: 'comment',
        roomCode: room.code,
        roomName: room.name,
        note: clean || null,
        stars: rated ? rating : null,
        byRole: ctx.role === 'team' ? 'player' : 'admin',
        byName: team?.name ?? null, // الفريق باسمه، والمنظّم باسم غرفته
      },
      reply,
    );
    /* لا يُعلَن نجاحٌ لم يقع: keepFeedback ردّ بالفشل، ونحن نصمت هنا */
    if (!saved) return;
    ctx.commented = true;
    reply?.({ ok: true });
  });

  socket.on('team:buyCard', ({ card, targetId } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    const result = room.buyCard(ctx.teamId, card, targetId);
    if (result.ok) {
      pushTeam(room, ctx.teamId); // متجرُه ونقاطه — فوراً، فهو ينظر إليها
      changed(room, { players: true });
    }
    reply?.(result);
  });

  /* نقضُ الشراء — نظيرُ buyCard، وشرطُه أن الجولة لم تبدأ (يفحصه refundCard) */
  socket.on('team:refundCard', ({ card } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    const result = room.refundCard(ctx.teamId, card);
    if (result.ok) {
      pushTeam(room, ctx.teamId);
      changed(room, { players: true });
    }
    reply?.(result);
  });

  /*
   * الإجابة بإقرار: المتصفّح ينتظر الرد فيعرف أنها وصلت، ولا يبقى زرُّه
   * معلّقاً على إجابةٍ ضاعت. والحزمةُ القديمة لا تطلب إقراراً — فلها
   * team:result كما كان.
   */
  socket.on('team:answer', ({ questionId, choice, left } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    const before = room.status;
    const outcome = room.answer(ctx.teamId, questionId, Number(choice), Number(left));
    if (!outcome) {
      /* متأخرةٌ أو مكرّرة (أُعيد إرسالها بعد انقطاع): تُصحَّح شاشتُه بحاله */
      reply?.({ ok: false, stale: true });
      return pushTeam(room, ctx.teamId);
    }
    if (typeof reply === 'function') reply({ ok: true, ...outcome });
    else socket.emit('team:result', outcome);
    // إجابة خاطئة قد تصفّر العداد وتنهي الجولة قبل أن تصلها النبضة
    if (before !== 'ended' && room.status === 'ended') {
      pushAll(room);
      io.to(channel(room.code)).emit('room:ended', room.result);
    } else if (outcome.late) {
      /* متأخرةٌ بعد النهاية: نقاطُه وجائزتُه تبدّلت — يراها هو والقاعة */
      pushTeam(room, ctx.teamId);
      changed(room, { players: true });
    } else {
      pushTeam(room, ctx.teamId); // سؤالُه التالي — فوراً، فوقته يجري
      changed(room);
    }
    pushFeed(room);
  });

  // نبقيه في اللعبة — عداده يستمر وقد يعود
  socket.on('disconnect', detach);
});

// النبضة العامة: مصدر الحقيقة الوحيد للوقت
/*
 * والوقتُ وحده لا يُبثّ: كلُّ متصفّحٍ يعدّه بنفسه. فلا يخرج من النبضة إلا
 * تحوّلٌ في حال الغرفة (انتهى الاستعداد، سكن نبضٌ فانتهت الجولة).
 */
let resyncAt = Date.now();
setInterval(() => {
  const now = Date.now();
  const resync = now - resyncAt >= RESYNC_MS;
  if (resync) resyncAt = now;
  for (const room of allRooms()) {
    const before = room.status;
    if (!room.tick(now)) continue;
    if (room.status !== before) {
      pushAll(room);
      if (before === 'running' && room.status === 'ended') {
        io.to(channel(room.code)).emit('room:ended', room.result);
      }
    } else if (resync && room.status === 'running') {
      changed(room, { teams: 'all' });
    }
    if (room.changedTeams.size) {
      changed(room, { teams: [...room.changedTeams] });
      room.changedTeams.clear();
    }
  }
  flushPending(now);
}, TICK_MS);

/*
 * الكتابة على القرص: ما تبدّلت حالته (dirty يُرفع في room.touch)، وكذلك
 * كل غرفةٍ جولتُها جارية — فالوقت ينزل في كل نبضة بلا «تبدّل حالة»، ولو
 * انتظرنا أول إجابة لعاد الفريق إلى وقتٍ أقدم من وقت جاره فظلمناه.
 */
async function flush() {
  // الإحصاء أولاً: فروقٌ تجمّعت في الذاكرة تُصرف دفعةً واحدة لكل الغرف
  const stats = [];
  for (const room of allRooms()) stats.push(...room.drainStats());
  if (stats.length) {
    try {
      await store.recordStats(stats);
    } catch (err) {
      console.warn(`⚠ تعذّر حفظ إحصاء ${stats.length} سؤالاً: ${err.message}`);
    }
  }

  for (const room of allRooms()) {
    if (!room.dirty && room.status !== 'running') continue;
    room.dirty = false;
    try {
      await store.saveRoom(room);
    } catch (err) {
      room.dirty = true; // نُعيد المحاولة في الدورة القادمة
      console.warn(`⚠ تعذّر حفظ الغرفة ${room.code}: ${err.message}`);
    }
  }
}
/*
 * دورةٌ واحدة في وقتٍ واحد.
 *
 * الكتابة صارت تعبر الشبكة، فقد تتجاوز المهلة. ولو بدأت الدورةُ التالية
 * فوق سابقتها لتزاحمتا على المجمّع وكتبتا الغرفةَ نفسها مرّتين بترتيبٍ
 * غير مضمون — والراية أرخص من قفل.
 */
let flushing = false;
setInterval(async () => {
  if (flushing) return;
  flushing = true;
  try {
    await flush();
  } catch (err) {
    console.warn('⚠ تعذّرت دورة الحفظ:', err.message);
  } finally {
    flushing = false;
  }
}, SAVE_MS);

setInterval(
  async () => {
    // اللقطة تذهب مع الغرفة الخاملة، والسجلّ يبقى ستين يوماً
    for (const code of sweepIdleRooms()) {
      try {
        await store.forgetState(code);
      } catch (err) {
        console.warn(`⚠ تعذّر نسيان لقطة ${code}: ${err.message}`);
      }
      feedSent.delete(code);
      pending.delete(code);
    }
    /* وما في السجلّ من خاملاتٍ يُختم منتهياً — ولو كُنست قبل هذا الكود */
    try {
      const closed = await store.closeIdleRooms(IDLE_ROOM_MS);
      if (closed) console.log(`🏁 خُتمت ${closed} غرفةً خاملةً منتهية`);
    } catch (err) {
      console.warn('⚠ تعذّر ختم الخاملات:', err.message);
    }
  },
  10 * 60 * 1000,
);

setInterval(
  () => void store.sweepOld().catch((err) => console.warn('⚠ تعذّر الكنس:', err.message)),
  24 * 60 * 60 * 1000,
);

/* إغلاقٌ مقصود: نكتب آخر ما عندنا قبل أن نمضي */
/*
 * الخروج ينتظر آخر كتابة.
 *
 * وكانت الثلاثة متزامنة فمضت على ترتيبها. وصارت وعوداً: لو خرجنا بلا
 * انتظارٍ لقتلنا العمليةَ والكتابةُ في الطريق، فضاعت آخر دقيقةٍ من الجولة
 * في كل نشر — وهو ضياعٌ صامت، لا أثر له في سجلٍّ ولا شاشة.
 *
 * ومهلةٌ قصوى فوق ذلك: قاعدةٌ لا تستجيب تُعلّق الخروج إلى الأبد، والمنصّة
 * تقتل ما لم يخرج في مهلتها قتلاً — فالخروج بأكثر ما أمكن أولى من انتظارٍ
 * لا ينتهي.
 */
let leaving = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (leaving) return;
    leaving = true;
    /* يُقال للأجهزة إن السيرفر يتجدّد — فتقول لأصحابها «ثوانٍ ونعود» لا «انقطع» */
    io.emit('server:restarting');
    const deadline = new Promise((resolve) => setTimeout(resolve, 8000).unref());
    const drain = async () => {
      await flush();
      await store.close();
    };
    try {
      await Promise.race([drain(), deadline]);
    } catch (err) {
      console.warn('⚠ تعذّر الحفظ عند الخروج:', err.message);
    }
    process.exit(0);
  });
}

http.listen(PORT, async () => {
  console.log(`💓 نبضة تعمل على http://localhost:${PORT}`);
  console.log(`   الإعدادات الافتراضية:`, DEFAULT_SETTINGS);
  console.log(`   الذاكرة: ${(await store.listRooms()).length} غرفة في السجلّ`);
  announce(envResult);
  if (usingFallback()) {
    console.log(`   🔑 مفتاح لوحة المالك (مؤقّت، اكتب NABDA_OWNER_KEY في .env ليثبت):`);
    console.log(`      ${FALLBACK_KEY}`);
  } else {
    console.log(`   🔑 لوحة المالك على /console، المفتاح من NABDA_OWNER_KEY`);
  }

  /* تحريرُ .env يصل حالاً — بلا إعادة تشغيل */
  watchEnv((result) => {
    if (result.loaded.includes('NABDA_OWNER_KEY')) {
      console.log('   🔑 بُدِّل مفتاح لوحة المالك، الجلسات المفتوحة تُطالَب بالجديد');
    }
  });
});
