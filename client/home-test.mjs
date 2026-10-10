import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const root = process.cwd();
const gamePath = join(root, '..', 'server', 'game.js');
const demoPath = join(root, 'src', 'pages', 'home', 'demo.ts');
const homeDir = join(root, 'src', 'pages', 'home');
const homePage = join(root, 'src', 'pages', 'Home.tsx');

const { createRoom, CARDS, DEFAULT_SETTINGS } = await import(pathToFileURL(gamePath).href);
const { DEMO, CATALOG, QUESTIONS, BOTS, rankPoints } = await import(pathToFileURL(demoPath).href);

let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && detail ? `\n   ${detail}` : ''}`);
};

check('DEMO.startMs = DEFAULT_SETTINGS.startSeconds',
  DEMO.startMs === DEFAULT_SETTINGS.startSeconds * 1000, `${DEMO.startMs} vs ${DEFAULT_SETTINGS.startSeconds * 1000}`);
check('DEMO.bonusMs = DEFAULT_SETTINGS.correctBonus',
  DEMO.bonusMs === DEFAULT_SETTINGS.correctBonus * 1000, `${DEMO.bonusMs} vs ${DEFAULT_SETTINGS.correctBonus * 1000}`);
check('DEMO.penaltyMs = DEFAULT_SETTINGS.wrongPenalty',
  DEMO.penaltyMs === DEFAULT_SETTINGS.wrongPenalty * 1000, `${DEMO.penaltyMs} vs ${DEFAULT_SETTINGS.wrongPenalty * 1000}`);
check('DEMO.maxMs = DEFAULT_SETTINGS.maxSeconds',
  DEMO.maxMs === DEFAULT_SETTINGS.maxSeconds * 1000, `${DEMO.maxMs} vs ${DEFAULT_SETTINGS.maxSeconds * 1000}`);

const gameText = readFileSync(gamePath, 'utf8');
const serverConst = (name) => {
  const m = gameText.match(new RegExp(`const ${name} = (\\d+);`));
  return m ? Number(m[1]) : NaN;
};
check('DEMO.countdownMs = COUNTDOWN_MS', DEMO.countdownMs === serverConst('COUNTDOWN_MS'),
  `${DEMO.countdownMs} vs ${serverConst('COUNTDOWN_MS')}`);

const serverIds = Object.keys(CARDS).sort();
const demoIds = CATALOG.map((c) => c.id).sort();
check('CATALOG lists exactly the server cards',
  JSON.stringify(serverIds) === JSON.stringify(demoIds), `${demoIds} vs ${serverIds}`);
check('CATALOG has no duplicate card', new Set(demoIds).size === demoIds.length);
for (const c of CATALOG) {
  const s = CARDS[c.id];
  check(`card ${c.id}: price ${c.price} = ${s?.price}`, !!s && c.price === s.price);
  check(`card ${c.id}: limit ${c.limit} = ${s?.limit}`, !!s && c.limit === s.limit);
  check(`card ${c.id}: name matches server`, !!s && c.name === s.name, `${c.name} vs ${s?.name}`);
}

function serverAwards(n) {
  const room = createRoom(['quran']);
  const teams = Array.from({ length: n }, (_, i) => room.addTeam(`t${i}`));
  room.start();
  let now = room.countdownEndsAt;
  room.tick(now);
  teams.forEach((t, i) => {
    t.correct = 0;
    t.timeMs = 60000 - i * 5000;
  });
  const loser = teams[n - 1];
  loser.timeMs = 0;
  loser.dyingAt = 0;
  now += 100;
  room.tick(now);
  return { status: room.status, awards: room.result?.awards ?? [], teams };
}

for (let n = 2; n <= 8; n++) {
  const { status, awards, teams } = serverAwards(n);
  const server = teams.slice(0, n - 1).map((t) => awards.find((a) => a.teamId === t.id)?.points);
  const demo = teams.slice(0, n - 1).map((_, i) => rankPoints(i, n));
  const flatServer = awards.find((a) => a.teamId === teams[n - 1].id)?.points;
  check(`rankPoints for ${n} teams = server [${server.join(',')}]`,
    status === 'ended' && JSON.stringify(server) === JSON.stringify(demo), `demo [${demo.join(',')}], status ${status}`);
  check(`flatlined team gets 0 rank points with ${n} teams`, flatServer === 0, `server ${flatServer}`);
}

const cardLab = readFileSync(join(homeDir, 'CardLab.tsx'), 'utf8');
const sceneBody = (id) => {
  const start = cardLab.indexOf(`\n  ${id}: {`);
  const next = cardLab.indexOf('\n  },', start);
  return start < 0 ? '' : cardLab.slice(start, next);
};
const sec = (ms) => `sec(${ms / 1000})`;
check('card lab: time shows TIME_CARD_MS', sceneBody('time').includes(sec(serverConst('TIME_CARD_MS'))));
check('card lab: revive shows REVIVE_MS', sceneBody('revive').includes(sec(serverConst('REVIVE_MS'))));
check('card lab: steal moves STEAL_MS', sceneBody('steal').split(sec(serverConst('STEAL_MS'))).length - 1 === 2);
check('card lab: freeze lasts FREEZE_MS', /g >= 2500 && g < 7500/.test(sceneBody('freeze')) && serverConst('FREEZE_MS') === 5000);
check('card lab: truce lasts TRUCE_MS', sceneBody('truce').includes(`g < ${serverConst('TRUCE_MS')}`));
check('card lab: shield absorbs SHIELD_HITS wrong answers',
  (sceneBody('shield').match(/tone: 'hold'/g) ?? []).length === serverConst('SHIELD_HITS'));
check('card lab: shield penalty after it breaks = wrongPenalty',
  sceneBody('shield').includes(sec(DEFAULT_SETTINGS.wrongPenalty * 1000)));

const homeFiles = readdirSync(homeDir).map((f) => join(homeDir, f));
for (const file of [homePage, ...homeFiles]) {
  const text = readFileSync(file, 'utf8');
  const name = file.slice(root.length + 1);
  const lines = text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('—'));
  check(`${name}: no em dash`, lines.length === 0, lines.map(([n, l]) => `${n}: ${l.trim()}`).join('\n   '));
}

for (const file of homeFiles) {
  const text = readFileSync(file, 'utf8');
  const name = file.slice(root.length + 1);
  check(`${name}: does not import lib/socket`, !/lib\/socket/.test(text) && !/socket\.io/i.test(text));
  check(`${name}: does not call fetch`, !/\bfetch\s*\(/.test(text) && !/XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(text));
  check(`${name}: does not reference /api`, !/['"`]\/api/.test(text));
}
const homeText = readFileSync(homePage, 'utf8');
check('Home.tsx: does not import lib/socket', !/lib\/socket/.test(homeText));
check('Home.tsx: does not call fetch or /api', !/\bfetch\s*\(/.test(homeText) && !/['"`]\/api/.test(homeText));

const appText = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
for (const pageName of ['Play', 'Display', 'Admin', 'Owner']) {
  const staticImport = new RegExp(`^\\s*import\\s+[^;]*?from\\s+['"]\\./pages/${pageName}(\\.tsx)?['"]`, 'm');
  const lazyImport = new RegExp(`lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]\\./pages/${pageName}(\\.tsx)?['"]\\s*\\)`);
  check(`App.tsx: does not statically import ./pages/${pageName}`, !staticImport.test(appText));
  check(`App.tsx: lazy-loads ./pages/${pageName}`, lazyImport.test(appText));
}
check('App.tsx: does not import lib/socket', !/lib\/socket/.test(appText));

check(`QUESTIONS has at least 12 entries (${QUESTIONS.length})`, QUESTIONS.length >= 12);
check('QUESTIONS texts are unique', new Set(QUESTIONS.map((q) => q.q)).size === QUESTIONS.length);
for (const [i, q] of QUESTIONS.entries()) {
  const opts = q.options.map((o) => o.trim());
  check(`question ${i + 1}: 4 distinct non-empty options`,
    opts.length === 4 && new Set(opts).size === 4 && opts.every(Boolean) && q.q.trim().length > 0,
    JSON.stringify(q));
}

check('at least 3 bots', BOTS.length >= 3);
const drainsOut = BOTS.some((b) => {
  const hits = b.hits.filter(Boolean).length;
  const net = hits * DEMO.bonusMs - (b.hits.length - hits) * DEMO.penaltyMs - b.hits.length * b.every;
  return net < 0;
});
check('at least one bot loses time over a full script cycle', drainsOut);

console.log(failed ? `\n❌ ${failed} failed` : '\n✅ home parity passed');
process.exit(failed ? 1 : 0);
