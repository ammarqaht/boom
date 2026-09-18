import envResult, { announce, watchEnv } from './env.js'; // أوّلَ شيء: ما بعده يقرأ process.env
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { listBanks, normalizeBankIds, allBanks, findQuestion, saveBank } from './banks.js';
import { auditQuestion, auditAll } from './audit.js';
import {
  createRoom,
  restoreRoom,
  getRoom,
  allRooms,
  sweepIdleRooms,
  normalizeDifficulty,
  DEFAULT_SETTINGS,
  IDLE_ROOM_MS,
} from './game.js';
import * as store from './store.js';

const PORT = process.env.PORT || 3000;
const TICK_MS = 250;
/*
 * دورة الكتابة على القرص. ثانيتان لأنها أقصى ما نقبل ضياعه من جولة،
 * وهي في الوقت نفسه أبطأ من أن تُتعب القرص: الغرفة الواحدة عشرات
 * الكيلوبايتات، والكتابة لا تحجب القراءة في WAL.
 */
const SAVE_MS = 2000;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const app = express();
app.use(express.json({ limit: '256kb' }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.get('/api/banks', (_req, res) => res.json(listBanks()));
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
  if (throttled(req.ip)) return res.status(429).json({ error: 'محاولات كثيرة — انتظر دقيقة' });
  return res.status(401).json({ error: 'مفتاح غير صحيح' });
}

app.get('/api/console/summary', owner, (_req, res) => {
  const rooms = store.listRooms();
  const month = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = rooms.filter((r) => r.createdAt >= month);
  const comments = store.listFeedback({ kind: 'comment', limit: 1000 });
  const rated = comments.filter((c) => c.stars);
  res.json({
    rooms: recent.length,
    players: recent.reduce((n, r) => n + r.players, 0),
    rounds: recent.reduce((n, r) => n + r.rounds, 0),
    live: [...allRooms()].filter((r) => r.status !== 'finished').length,
    reports: store.listFeedback({ kind: 'report', limit: 1000 }).length,
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
app.get('/api/console/dashboard', owner, (_req, res) => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rooms = store.listRooms();
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
  const health = store.questionHealth({ minShown: 1, limit: 100000 });
  const reports = store.reportCounts();
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

  const comments = store.listFeedback({ kind: 'comment', limit: 1000 });
  const rated = comments.filter((c) => c.stars);
  /* فحصُ البنوك كلها: ما يقوله «npm test» يُقال هنا بلا طرفيّة */
  const checked = auditAll(allBanks());

  res.json({
    audit: {
      errors: checked.errors,
      warnings: checked.warnings,
      duplicates: checked.duplicates.length,
    },
    totals: {
      rooms: rooms.length,
      players: rooms.reduce((n, r) => n + r.players, 0),
      rounds: rooms.reduce((n, r) => n + r.rounds, 0),
      questions: rooms.reduce((n, r) => n + r.questions, 0),
      live: [...allRooms()].filter((r) => r.status !== 'finished').length,
      bank: allBanks().reduce((n, b) => n + b.questions.length, 0),
      reports: store.listFeedback({ kind: 'report', limit: 5000 }).length,
      comments: comments.length,
      stars: rated.length ? rated.reduce((n, c) => n + c.stars, 0) / rated.length : null,
      medianPlayedMs: median(played.map((r) => r.playedMs)),
      /* ما يحتاج نظرَ المالك: أسئلةٌ يكسر فيها اللاعبون، وتقييمٌ منخفض */
      measured: health.length,
      edits: store.listEdits().length,
      weak: health.filter((r) => r.shown >= 3 && r.rate !== null && r.rate < 30).length,
      lowStars: comments.filter((c) => c.stars && c.stars <= 2).length,
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

app.get('/api/console/rooms', owner, (req, res) => {
  res.json(store.listRooms(Number(req.query.days) || undefined));
});

app.get('/api/console/health', owner, (req, res) => {
  const counts = store.reportCounts();
  const names = new Map(allBanks().map((b) => [b.id, b.name]));
  const rows = store.questionHealth({
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

app.get('/api/console/feedback', owner, (req, res) => {
  res.json(store.listFeedback({ kind: req.query.kind || null, limit: 400 }));
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
app.get('/api/console/bank/:id', owner, (req, res) => {
  const wanted = req.params.id;
  const banks = wanted === 'all' ? allBanks() : allBanks().filter((b) => b.id === wanted);
  if (banks.length === 0) return res.status(404).json({ error: 'بنك غير معروف' });

  const stats = new Map(
    store.questionHealth({ minShown: 1, limit: 100000 }).map((row) => [row.id, row]),
  );
  const reports = store.reportCounts();

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
        shown: stat?.shown ?? 0,
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

/** سؤالٌ واحد بتمامه — تفتح به صفحاتُ الصحّة والبلاغات المحرّرَ نفسه */
app.get('/api/console/question/:id', owner, (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });
  const { bank, question } = found;
  /* ما قاسه اللعب يُقرأ في المحرّر: تُحرّر السؤال وأنت ترى لماذا تُحرّره */
  const stat = store.questionStat(question.id);
  res.json({
    id: question.id,
    bankId: bank.id,
    bankName: bank.name,
    q: question.q,
    options: question.options,
    answer: question.answer,
    level: question.level,
    shown: stat?.shown ?? 0,
    correct: stat?.correct ?? 0,
    wrong: stat?.wrong ?? 0,
    rate: stat?.rate ?? null,
    reports: store.reportCounts().get(question.id) ?? 0,
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
  return {
    q: String(body?.q ?? '').trim(),
    options,
    answer: 0, // الصواب أوّل الخيارات — والخلط يقع عند التوزيع
    level: Number(body?.level) || 2,
  };
}

/** إضافة سؤال — يُرفض إن كان فيه خطأٌ يكسر اللعبة، ويمرّ مع التنبيهات */
app.post('/api/console/bank/:id/question', owner, (req, res) => {
  const bank = allBanks().find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });

  const question = readQuestion(req.body);
  const issues = auditQuestion(question);
  if (issues.some((i) => i.severity === 'error')) return res.status(400).json({ issues });

  saveBank(bank.id, [...bank.questions, question]);
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
app.put('/api/console/question/:id', owner, (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });

  const question = readQuestion(req.body);
  const issues = auditQuestion(question);
  if (issues.some((i) => i.severity === 'error')) return res.status(400).json({ issues });

  const before = found.question;
  const changed = question.q !== before.q || question.options.join(' ') !== before.options.join(' ');

  const next = found.bank.questions.map((q) => (q.id === req.params.id ? question : q));
  saveBank(found.bank.id, next);

  let cleared = null;
  if (changed) {
    cleared = store.clearQuestion(before.id);
    /* المعرّف بصمةُ النصّ، فتحريرُ النصّ يلده جديداً — ونقرؤه من المحفوظ */
    const after = findQuestion(before.id) ? before.id : null;
    store.recordEdit({
      kind: 'edit',
      bankId: found.bank.id,
      oldId: before.id,
      newId: after ?? newIdOf(found.bank.id, question.q),
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
function newIdOf(bankId, text) {
  const bank = allBanks().find((b) => b.id === bankId);
  return bank?.questions.find((q) => q.q === text)?.id ?? null;
}

/** الحذف كالتحرير: يمحو ما قِيس، ويُحفظ في الأرشيف ليُرجَع إن نُدم عليه */
app.delete('/api/console/question/:id', owner, (req, res) => {
  const found = findQuestion(req.params.id);
  if (!found) return res.status(404).json({ error: 'سؤال غير موجود' });
  if (found.bank.questions.length <= 1) {
    return res.status(400).json({ error: 'لا يُترك البنك فارغاً' });
  }
  const before = found.question;
  saveBank(
    found.bank.id,
    found.bank.questions.filter((q) => q.id !== req.params.id),
  );
  const cleared = store.clearQuestion(before.id);
  store.recordEdit({
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

app.get('/api/console/edits', owner, (_req, res) => {
  const names = new Map(allBanks().map((b) => [b.id, b.name]));
  res.json(
    store.listEdits().map((row) => ({
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
app.post('/api/console/edit/:id/restore', owner, (req, res) => {
  const edit = store.getEdit(req.params.id);
  if (!edit) return res.status(404).json({ error: 'لا نسخة بهذا الرقم' });

  const bank = allBanks().find((b) => b.id === edit.bank);
  if (!bank) return res.status(404).json({ error: 'بنك غير معروف' });
  if (findQuestion(edit.oldId)) return res.status(400).json({ error: 'السؤال موجودٌ أصلاً' });

  const old = { q: edit.oldQ, options: edit.oldOptions, answer: 0, level: edit.oldLevel };
  const questions =
    edit.kind === 'edit' && edit.newId && bank.questions.some((q) => q.id === edit.newId)
      ? bank.questions.map((q) => (q.id === edit.newId ? old : q))
      : [...bank.questions, old];

  saveBank(bank.id, questions);
  store.forgetEdit(edit.id);
  res.json({ ok: true });
});

// الواجهة المبنية — يخدمها نفس السيرفر حتى يكون النشر بعملية واحدة
app.use(express.static(join(root, 'client', 'dist')));
app.get('*', (_req, res) => res.sendFile(join(root, 'client', 'dist', 'index.html')));

/*
 * بعثُ ما كان: الغرف التي لم تخمل تعود كما تركها السيرفر — لكن موقوفة.
 * وتقع قبل أي اتصال، فأول لاعبٍ يفتح صفحته يجد غرفته مكانها.
 */
const revived = store.loadSnapshots(IDLE_ROOM_MS);
for (const snap of revived) {
  try {
    restoreRoom(snap);
  } catch (err) {
    console.warn(`⚠ تعذّر بعث الغرفة ${snap?.code}: ${err.message}`);
  }
}
if (revived.length) console.log(`↺ عادت ${revived.length} غرفة من القرص — كلّها موقوفة`);
store.sweepOld();

const channel = (code) => `room:${code}`;
/*
 * قناةٌ للمنظّم وحده. سجلّ الأسئلة يحمل مواضع الإجابات الصحيحة، وقناة
 * الغرفة يسمعها اللاعبون وشاشة القاعة — فلو مرّ فيها لقرأ اللاعب الجواب
 * من الشبكة قبل أن يجيب.
 */
const adminChannel = (code) => `admin:${code}`;

/** آخر نسخةٍ من سجلّ الأسئلة أُرسلت لكل غرفة — فلا يُعاد إرسال ما لم يتغيّر */
const feedSent = new Map();

function pushFeed(room, force = false) {
  if (!force && feedSent.get(room.code) === room.feedVersion) return;
  feedSent.set(room.code, room.feedVersion);
  io.to(adminChannel(room.code)).emit('admin:feed', room.feedState());
}

function pushPublic(room) {
  io.to(channel(room.code)).emit('room:state', room.publicState());
}

function pushTeam(room, teamId) {
  const state = room.teamState(teamId);
  if (state) io.to(`team:${teamId}`).emit('team:state', state);
}

function pushAll(room) {
  pushPublic(room);
  for (const teamId of room.teams.keys()) pushTeam(room, teamId);
}

io.on('connection', (socket) => {
  // ما يخص هذا الاتصال: أي غرفة، وبأي دور
  let ctx = null;

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
    ctx = { role: 'admin', code: room.code };
    socket.join(channel(room.code));
    socket.join(adminChannel(room.code));
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
    ctx = { role: 'admin', code: room.code };
    socket.join(channel(room.code));
    socket.join(adminChannel(room.code));
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
    pushPublic(room);
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
    if (room) (room.adjustTime(teamId, Number(seconds) || 0), pushAll(room));
  });

  socket.on('admin:adjustScore', ({ teamId, points } = {}) => {
    const room = asAdmin();
    if (room) (room.adjustScore(teamId, Number(points) || 0), pushAll(room));
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
    pushPublic(room);
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
    pushPublic(room);
  });

  socket.on('display:join', ({ code } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    ctx = { role: 'display', code: room.code };
    socket.join(channel(room.code));
    reply?.({ ok: true, state: room.publicState() });
  });

  socket.on('team:join', ({ code, name } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'رمز الغرفة غير صحيح' });
    if (room.status === 'running') {
      return reply?.({
        ok: false,
        error: 'الجولة بدأت بالفعل — انتظر الجولة القادمة',
      });
    }
    const clean = String(name || '')
      .trim()
      .slice(0, 24);
    if (!clean) return reply?.({ ok: false, error: 'اكتب اسم الفريق' });
    const taken = [...room.teams.values()].some((t) => t.name === clean);
    if (taken) return reply?.({ ok: false, error: 'الاسم مستخدم — اختر اسماً آخر' });

    const team = room.addTeam(clean);
    ctx = { role: 'team', code: room.code, teamId: team.id };
    socket.join(`team:${team.id}`);
    socket.join(channel(room.code));
    pushPublic(room);
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
      return reply?.({ ok: false, error: 'انتهت الجلسة — انضم من جديد' });
    }
    team.connected = true;
    ctx = { role: 'team', code: room.code, teamId };
    socket.join(`team:${teamId}`);
    socket.join(channel(room.code));
    pushPublic(room);
    reply?.({ ok: true, teamId, token, state: room.teamState(teamId) });
  });

  /*
   * بلاغٌ على سؤال. لا يُسقط السؤال عن أحد ولا يُوقف شيئاً — إشارةٌ تُسجَّل
   * ويراها المالك لاحقاً. وبلا هويّة: المهمّ السؤال لا من رآه.
   */
  socket.on('admin:report', ({ questionId, reason, note } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    const record = room.served.get(questionId);
    if (!record) return reply?.({ ok: false, error: 'هذا السؤال لم يُعرض في هذه الغرفة' });
    store.addFeedback({
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
    });
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
  socket.on('team:report', ({ questionId, reason, note } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    const record = room?.served.get(questionId);
    if (!record) return reply?.({ ok: false, error: 'هذا السؤال لم يُعرض في هذه الغرفة' });
    store.addFeedback({
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
    });
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
  socket.on('feedback:comment', ({ stars, text } = {}, reply) => {
    if (!ctx) return reply?.({ ok: false, error: 'غير مصرح' });
    if (ctx.commented) return reply?.({ ok: false, error: 'وصلنا رأيك — شكراً لك' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });

    const rating = Number(stars);
    const rated = Number.isInteger(rating) && rating >= 1 && rating <= 5;
    const clean = String(text || '')
      .trim()
      .slice(0, 1000);
    if (!rated && !clean) return reply?.({ ok: false, error: 'اختر تقييماً أو اكتب رأيك' });

    const team = ctx.role === 'team' ? room.teams.get(ctx.teamId) : null;
    store.addFeedback({
      kind: 'comment',
      roomCode: room.code,
      roomName: room.name,
      note: clean || null,
      stars: rated ? rating : null,
      byRole: ctx.role === 'team' ? 'player' : 'admin',
      byName: team?.name ?? null, // الفريق باسمه، والمنظّم باسم غرفته
    });
    ctx.commented = true;
    reply?.({ ok: true });
  });

  socket.on('team:buyCard', ({ card, targetId } = {}, reply) => {
    if (ctx?.role !== 'team') return reply?.({ ok: false, error: 'غير مصرح' });
    const room = getRoom(ctx.code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    const result = room.buyCard(ctx.teamId, card, targetId);
    if (result.ok) pushAll(room); // النقاط تغيّرت، والهدف قد يُنبَّه لاحقاً
    reply?.(result);
  });

  socket.on('team:answer', ({ questionId, choice } = {}) => {
    if (ctx?.role !== 'team') return;
    const room = getRoom(ctx.code);
    if (!room) return;
    const outcome = room.answer(ctx.teamId, questionId, Number(choice));
    if (!outcome) return;
    socket.emit('team:result', outcome);
    pushAll(room);
    pushFeed(room);
    // إجابة خاطئة قد تصفّر العداد وتنهي الجولة قبل أن تصلها النبضة
    if (room.status === 'ended') io.to(channel(room.code)).emit('room:ended', room.result);
  });

  socket.on('disconnect', () => {
    if (ctx?.role !== 'team') return;
    const room = getRoom(ctx.code);
    const team = room?.teams.get(ctx.teamId);
    if (!team) return;
    team.connected = false; // نبقيه في اللعبة — عداده يستمر وقد يعود
    pushPublic(room);
  });
});

// النبضة العامة: مصدر الحقيقة الوحيد للوقت
setInterval(() => {
  for (const room of allRooms()) {
    const wasRunning = room.status === 'running';
    if (!room.tick()) continue;
    pushPublic(room);
    for (const teamId of room.teams.keys()) pushTeam(room, teamId);
    if (wasRunning && room.status === 'ended') {
      io.to(channel(room.code)).emit('room:ended', room.result);
    }
  }
}, TICK_MS);

/*
 * الكتابة على القرص: ما تبدّلت حالته (dirty يُرفع في room.touch)، وكذلك
 * كل غرفةٍ جولتُها جارية — فالوقت ينزل في كل نبضة بلا «تبدّل حالة»، ولو
 * انتظرنا أول إجابة لعاد الفريق إلى وقتٍ أقدم من وقت جاره فظلمناه.
 */
function flush() {
  // الإحصاء أولاً: فروقٌ تجمّعت في الذاكرة تُصرف دفعةً واحدة لكل الغرف
  const stats = [];
  for (const room of allRooms()) stats.push(...room.drainStats());
  if (stats.length) {
    try {
      store.recordStats(stats);
    } catch (err) {
      console.warn(`⚠ تعذّر حفظ إحصاء ${stats.length} سؤالاً: ${err.message}`);
    }
  }

  for (const room of allRooms()) {
    if (!room.dirty && room.status !== 'running') continue;
    room.dirty = false;
    try {
      store.saveRoom(room);
    } catch (err) {
      room.dirty = true; // نُعيد المحاولة في الدورة القادمة
      console.warn(`⚠ تعذّر حفظ الغرفة ${room.code}: ${err.message}`);
    }
  }
}
setInterval(flush, SAVE_MS);

setInterval(
  () => {
    // اللقطة تذهب مع الغرفة الخاملة، والسجلّ يبقى ستين يوماً
    for (const code of sweepIdleRooms()) {
      store.forgetState(code);
      feedSent.delete(code);
    }
  },
  10 * 60 * 1000,
);

setInterval(() => store.sweepOld(), 24 * 60 * 60 * 1000);

/* إغلاقٌ مقصود: نكتب آخر ما عندنا قبل أن نمضي */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    flush();
    store.close();
    process.exit(0);
  });
}

http.listen(PORT, () => {
  console.log(`💓 نبضة تعمل على http://localhost:${PORT}`);
  console.log(`   الإعدادات الافتراضية:`, DEFAULT_SETTINGS);
  console.log(`   الذاكرة: ${store.listRooms().length} غرفة في السجلّ`);
  announce(envResult);
  if (usingFallback()) {
    console.log(`   🔑 مفتاح لوحة المالك (مؤقّت — اكتب NABDA_OWNER_KEY في .env ليثبت):`);
    console.log(`      ${FALLBACK_KEY}`);
  } else {
    console.log(`   🔑 لوحة المالك على /console — المفتاح من NABDA_OWNER_KEY`);
  }

  /* تحريرُ .env يصل حالاً — بلا إعادة تشغيل */
  watchEnv((result) => {
    if (result.loaded.includes('NABDA_OWNER_KEY')) {
      console.log('   🔑 بُدِّل مفتاح لوحة المالك — الجلسات المفتوحة تُطالَب بالجديد');
    }
  });
});
