import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { listBanks, normalizeBankIds } from './banks.js';
import { createRoom, getRoom, allRooms, sweepIdleRooms, DEFAULT_SETTINGS } from './game.js';

const PORT = process.env.PORT || 3000;
const TICK_MS = 250;
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

app.get('/api/banks', (_req, res) => res.json(listBanks()));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: [...allRooms()].length }));

// الواجهة المبنية — يخدمها نفس السيرفر حتى يكون النشر بعملية واحدة
app.use(express.static(join(root, 'client', 'dist')));
app.get('*', (_req, res) => res.sendFile(join(root, 'client', 'dist', 'index.html')));

const channel = (code) => `room:${code}`;

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

  socket.on('admin:createRoom', ({ bankIds, settings } = {}, reply) => {
    const room = createRoom(bankIds, settings);
    ctx = { role: 'admin', code: room.code };
    socket.join(channel(room.code));
    reply?.({ ok: true, code: room.code, adminKey: room.adminKey, state: room.publicState() });
  });

  socket.on('admin:join', ({ code, adminKey } = {}, reply) => {
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'الغرفة غير موجودة' });
    if (room.adminKey !== adminKey) return reply?.({ ok: false, error: 'مفتاح المسؤول غير صحيح' });
    ctx = { role: 'admin', code: room.code };
    socket.join(channel(room.code));
    reply?.({ ok: true, code: room.code, state: room.publicState() });
  });

  socket.on('admin:updateSettings', ({ settings } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (room.status === 'running') {
      return reply?.({ ok: false, error: 'أوقف الجولة أولاً قبل تعديل الإعدادات' });
    }
    room.settings = { ...room.settings, ...settings };
    for (const team of room.teams.values()) team.resetForRound(room.settings);
    pushAll(room);
    reply?.({ ok: true });
  });

  socket.on('admin:setBanks', ({ bankIds } = {}, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    room.bankIds = normalizeBankIds(bankIds);
    pushPublic(room);
    reply?.({ ok: true });
  });

  socket.on('admin:start', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    if (!room.start()) return reply?.({ ok: false, error: 'لا يوجد فرق بعد' });
    io.to(channel(room.code)).emit('room:started');
    pushAll(room);
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

  socket.on('admin:finishGame', (_payload, reply) => {
    const room = asAdmin();
    if (!room) return reply?.({ ok: false, error: 'غير مصرح' });
    room.finish();
    io.to(channel(room.code)).emit('room:finished', room.standings);
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
      return reply?.({ ok: false, error: 'الجولة بدأت بالفعل — انتظر الجولة القادمة' });
    }
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) return reply?.({ ok: false, error: 'اكتب اسم الفريق' });
    const taken = [...room.teams.values()].some((t) => t.name === clean);
    if (taken) return reply?.({ ok: false, error: 'الاسم مستخدم — اختر اسماً آخر' });

    const team = room.addTeam(clean);
    ctx = { role: 'team', code: room.code, teamId: team.id };
    socket.join(`team:${team.id}`);
    socket.join(channel(room.code));
    pushPublic(room);
    reply?.({ ok: true, teamId: team.id, token: team.token, state: room.teamState(team.id) });
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

setInterval(() => sweepIdleRooms(), 10 * 60 * 1000);

http.listen(PORT, () => {
  console.log(`💣 القنبلة تعمل على http://localhost:${PORT}`);
  console.log(`   الإعدادات الافتراضية:`, DEFAULT_SETTINGS);
});
