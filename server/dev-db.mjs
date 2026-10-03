/**
 * قاعدةُ تجربةٍ على الجهاز — PostgreSQL بلا تثبيت.
 *
 * السيرفر لا يُقلع بلا DATABASE_URL، وتثبيتُ بوستجرس على ويندوز مُنصِّبٌ
 * رسوميّ يطلب صلاحيةَ مدير. فهذا يُنزل محرّكاً مستقلاً ويشغّله على منفذٍ
 * غير المعتاد، فلا يزاحم قاعدةً مثبَّتة إن وُجدت.
 *
 *   npm run db     ← يُقلع ويبقى، فاتركه في نافذته
 *   npm start      ← في نافذةٍ أخرى
 *
 * ولا يدخل package.json: بناءُ المنصّة لا شأن له به، وقرصُ البنّاء سقط
 * مرّةً لامتلائه — فثلاثون ميغابايتاً من ثنائيّاتٍ لا تُستعمل هناك عبث.
 *
 * ══ ولماذا المحرّكُ والبياناتُ خارج مجلّد المشروع؟ ══
 *
 * لسببين، كلاهما عمليّ لا تنظيميّ:
 *
 *   • ثنائيّاتُ بوستجرس لا تقرأ مساراً فيه حرفٌ غير لاتينيّ. ومسارُ هذا
 *     المشروع عربيٌّ كلُّه، فـinitdb يراه «?????» ويقول «لا ملفّ بهذا
 *     الاسم». فيُنزَّل المحرّك في مسارٍ لاتينيّ خالص تحت LOCALAPPDATA.
 *
 *   • والمشروع في OneDrive، ومزامنةُ ملفّات قاعدةٍ مفتوحةٍ تُفسدها.
 */
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require_ = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PORT = Number(process.env.NABDA_DB_PORT || 55432);
const USER = 'nabda';
const PASSWORD = 'nabda';

/* بيتُ القاعدة: لاتينيٌّ خالص، وخارج المشروع وOneDrive معاً */
const HOME = process.env.NABDA_DB_HOME || join(process.env.LOCALAPPDATA || homedir(), 'nabda-pg');
const ENGINE = join(HOME, 'engine');
const DATA = join(HOME, 'data');

const URL_FOR = (db) => `postgres://${USER}:${PASSWORD}@localhost:${PORT}/${db}`;
/* ثلاثُ قواعد: واحدةٌ للّعب، واثنتان للفحوص — memory وe2e تمحوان ما فيهما */
const DATABASES = ['nabda', 'nabda_test', 'nabda_e2e'];

/** يُنزل المحرّك في بيته اللاتينيّ، مرّةً واحدة */
function fetchEngine() {
  console.log(`⏳ أوّلُ تشغيل — يُنزَّل محرّك PostgreSQL في ${ENGINE}`);
  console.log('   (مرّةٌ واحدة، نحو ٣٠ ميغابايت — ولا يدخل المشروع)\n');
  mkdirSync(ENGINE, { recursive: true });
  const manifest = join(ENGINE, 'package.json');
  if (!existsSync(manifest)) {
    writeFileSync(manifest, JSON.stringify({ name: 'nabda-pg-engine', private: true }, null, 2));
  }
  const done = spawnSync('npm', ['install', 'embedded-postgres', '--no-audit', '--no-fund'], {
    cwd: ENGINE,
    stdio: 'inherit',
    shell: true,
  });
  if (done.status !== 0) {
    console.error('\n✖ تعذّر تنزيل المحرّك. جرّب يدوياً:');
    console.error(`    cd "${ENGINE}" && npm install embedded-postgres`);
    process.exit(1);
  }
}

const engineEntry = join(ENGINE, 'node_modules', 'embedded-postgres');
if (!existsSync(engineEntry)) fetchEngine();

const loaded = await import(pathToFileURL(join(engineEntry, 'dist', 'index.js')).href);
const EmbeddedPostgres = loaded.default ?? loaded;

const fresh = !existsSync(join(DATA, 'PG_VERSION'));
const pg = new EmbeddedPostgres({
  databaseDir: DATA,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
});

if (fresh) {
  console.log(`⏳ تُهيَّأ القاعدة في ${DATA}`);
  await pg.initialise();
}
await pg.start();

/*
 * الترميزُ يُفرض من template0.
 *
 * initdb يأخذ ترميزه من لغة ويندوز، وعلى جهازٍ عربيّ تخرج القاعدة
 * WIN1252 — فأوّلُ سؤالٍ عربيّ يُكتب فيها يسقط بـ«لا مقابل لهذا الحرف في
 * الترميز». وtemplate0 وحده يقبل ترميزاً يخالف ترميزَ العنقود.
 */
const { Client } = require_(join(root, 'node_modules', 'pg'));
const admin = new Client({ connectionString: URL_FOR('postgres'), ssl: false });
await admin.connect();
for (const name of DATABASES) {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (rowCount) continue;
  await admin.query(
    `CREATE DATABASE ${name} WITH ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`,
  );
  console.log(`  ✓ أُنشئت ${name}`);
}
await admin.end();

/*
 * ويُكتب الرابطُ في .env إن لم يكن فيه رابط.
 *
 * فمن أقلع القاعدة يريد أن يلعب لا أن ينسخ رابطاً. وما كتبه بيده لا
 * يُدهس: لو كان ثَمّ رابطٌ لقاعدةٍ أخرى بقي على حاله.
 */
const envFile = join(root, '.env');
const url = URL_FOR('nabda');
let wrote = false;
try {
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  if (!/^\s*DATABASE_URL\s*=\s*\S/m.test(text)) {
    const next = /^\s*DATABASE_URL\s*=\s*$/m.test(text)
      ? text.replace(/^\s*DATABASE_URL\s*=\s*$/m, `DATABASE_URL=${url}`)
      : `${text}${!text || text.endsWith('\n') ? '' : '\n'}DATABASE_URL=${url}\n`;
    writeFileSync(envFile, next, 'utf8');
    wrote = true;
  }
} catch (err) {
  console.warn(`⚠ تعذّرت الكتابة في .env: ${err.message}`);
}

console.log(`
  ✅ القاعدة تعمل على المنفذ ${PORT}

     ${url}
     ${wrote ? '← كُتب في .env، فلا تحتاج شيئاً' : '← اكتبه في .env إن لم يكن فيه'}

     وللفحوص:  NABDA_TEST_DB=${URL_FOR('nabda_test')}

  اتركْ هذه النافذة، وافتح أخرى:  npm start
  وللإيقاف: Ctrl+C   ·   وللمحو: احذف ${HOME}
`);

const stop = async () => {
  console.log('\n⏹ تُوقَف القاعدة…');
  try {
    await pg.stop();
  } catch {
    /* أُوقفت أصلاً */
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
