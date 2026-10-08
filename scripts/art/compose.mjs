/*
 * يصنع صور البنوك والمراحل في client/public/art:
 *   ١) tint.py لوّن صور Fluent بألوان نبضة في out/
 *   ٢) هنا: ما يكفيه صورةٌ واحدة يُنسخ، وما يُركَّب يُصوَّر من compose.html
 *      بكروم بلا واجهة وخلفيةٍ شفّافة.
 *
 *   python3 scripts/art/tint.py && node scripts/art/compose.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = join(here, '..', '..', 'client', 'public', 'art');

const single = {
  amma: 'light_bulb',
  anbiya: 'mosque',
  ibadat: 'kaaba',
  hadith: 'scroll',
  science: 'test_tube',
  ulum: 'books',
  capitals: 'globe_with_meridians',
  other: 'sparkles',
  primary: 'pencil',
  middle: 'backpack',
  secondary: 'triangular_ruler',
  university: 'graduation_cap',
};
const composed = ['quran', 'lugha', 'sahaba', 'tarikh', 'seerah', 'football-world', 'football-saudi'];

for (const [id, file] of Object.entries(single)) copyFileSync(join(here, 'out', `${file}.png`), join(dest, `${id}.png`));
copyFileSync(join(here, 'src', 'LICENSE-fluentui-emoji.txt'), join(dest, 'LICENSE-fluentui-emoji.txt'));

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(here, '.chrome')}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore', detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json()).find((t) => t.type === 'page' && t.url === 'about:blank');
    if (page) {
      /* يُستمع للفتح فور الإنشاء: لو انتظرنا قبله لفاتنا الحدث فعلقنا للأبد */
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener('open', r));
      break;
    }
  } catch {}
  await sleep(250);
}
if (!ws) throw new Error('لم يُعثر على تبويب كروم');
console.log('… متصل بكروم');
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d.result); waiting.delete(d.id); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
await send('Emulation.setDeviceMetricsOverride', { width: 256, height: 256, deviceScaleFactor: 2, mobile: false });
for (const name of composed) {
  console.log('…', name);
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: `${pathToFileURL(join(here, 'compose.html')).href}#${name}` });
  await sleep(900);
  await Promise.race([send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true }), sleep(3000)]);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 256, height: 256, scale: 1 } });
  writeFileSync(join(dest, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
try { process.kill(-chrome.pid); } catch {}
console.log(`✓ ${Object.keys(single).length + composed.length} صورة في client/public/art`);
process.exit(0);
