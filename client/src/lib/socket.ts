import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Ack } from './types';
import { loadAdminSession, loadTeamSession } from './session';

/*
 * الهويّة مع الاتصال نفسه.
 *
 * تُقرأ عند كل اتصالٍ وإعادة اتصال، بحسب الصفحة: صفحةُ اللعب تحمل جلسة
 * الفريق، ولوحةُ المنظّم مفتاحَه، وشاشةُ العرض رمزَ الغرفة. فيعرف السيرفر
 * الجهازَ قبل أن يقرأ منه حدثاً واحداً — فلا طلبَ «رجّعني» يُنتظر ويُمهَل
 * ثم يُحسب فشلاً، ولا إجابةَ تسبقه فتُرمى بلا فريق.
 */
function handshake(): Record<string, unknown> {
  const path = location.pathname;
  const query = new URLSearchParams(location.search);
  if (path.startsWith('/play')) {
    const team = loadTeamSession();
    /*
     * رابطٌ إلى غرفةٍ أخرى يغلب الجلسة المحفوظة: من لعب أمس في غرفة ثم
     * فتح اليوم رابطَ غرفةٍ جديدة كان يُعاد إلى نتائج الأمس بدل باب اليوم.
     */
    const wanted = query.get('code')?.toUpperCase();
    if (team && wanted && wanted !== team.code) return {};
    return team ? { team } : {};
  }
  if (path.startsWith('/admin')) {
    const code = query.get('code');
    const key = query.get('key');
    if (code && key) return { admin: { code: code.toUpperCase(), adminKey: key } };
    const admin = loadAdminSession();
    return admin ? { admin } : {};
  }
  if (path.startsWith('/display')) {
    const code = query.get('code');
    return code ? { display: { code: code.toUpperCase() } } : {};
  }
  return {};
}

/*
 * نفس الأصل في الإنتاج؛ في التطوير يمرره vite proxy إلى 3000.
 *
 * websocket أولاً: يوفّر جولةَ مصافحةٍ بالاستطلاع تأخذ ثوانيَ عبر الشبكة
 * الموزّعة. وإن حجبته شبكةُ القاعة (جدرانٌ نارية في المدارس والمساجد)
 * رجع إلى الاستطلاع بنفسه (tryAllTransports).
 *
 * والتأخير بين المحاولات يتباعد إلى أربع ثوانٍ وبعشوائيةٍ واسعة: لو سقط
 * السيرفر وعاد، فمئةُ جوّالٍ تعود في اللحظة نفسها تُغرقه من جديد.
 */
export const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  randomizationFactor: 0.5,
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  auth: (cb) => cb(handshake()),
});

/** إرسال حدث وانتظار رد السيرفر كوعد */
export function ask<T = object>(
  event: string,
  payload?: unknown,
  timeout = 8000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket.timeout(timeout).emit(event, payload ?? {}, (err: unknown, res: Ack<T>) => {
      if (err) return resolve({ ok: false, error: 'انقطع الاتصال بالسيرفر', offline: true } as Ack<T>);
      resolve(res ?? { ok: false, error: 'لا يوجد رد من السيرفر' });
    });
  });
}

/* ══════════════ الجلسة: عادت أم انتهت ══════════════ */

export type Role = 'team' | 'admin' | 'display';
type SessionPayload = { role: Role; [key: string]: unknown };
type SessionHandlers = {
  resumed?: (payload: SessionPayload) => void;
  invalid?: (payload: SessionPayload & { error: string }) => void;
};

/*
 * آخرُ خبرٍ وصل قبل أن تُركَّب الصفحة. السوكِت يتّصل عند تحميل الوحدة،
 * فقد يصل «عادت جلستك» قبل أن يستمع أحد — فيُحفظ ويُسلَّم لأول من يسأل.
 */
let early: { kind: keyof SessionHandlers; payload: SessionPayload } | null = null;
socket.on('session:resumed', (payload: SessionPayload) => {
  early = { kind: 'resumed', payload };
});
socket.on('session:invalid', (payload: SessionPayload) => {
  early = { kind: 'invalid', payload };
});

/** يستمع لخبر الجلسة لدورٍ واحد — ويُسلَّم ما وصل قبل الاستماع */
export function watchSession(role: Role, handlers: SessionHandlers) {
  if (early?.payload.role === role) {
    const { kind, payload } = early;
    early = null;
    handlers[kind]?.(payload as never);
  }
  const onResumed = (payload: SessionPayload) => {
    if (payload.role !== role) return;
    early = null;
    handlers.resumed?.(payload);
  };
  const onInvalid = (payload: SessionPayload & { error: string }) => {
    if (payload.role !== role) return;
    early = null;
    handlers.invalid?.(payload);
  };
  socket.on('session:resumed', onResumed);
  socket.on('session:invalid', onInvalid);
  return () => {
    socket.off('session:resumed', onResumed);
    socket.off('session:invalid', onInvalid);
  };
}

/* ══════════════ حالُ الاتصال ══════════════ */

/*
 * «السيرفر يتجدّد» غير «انقطع نتّك»: الأول يقوله السيرفر قبل أن يُعاد
 * تشغيله (نشرٌ جديد)، فيُطمأن اللاعب أن العودة بعد ثوانٍ ولا ذنب له.
 */
let restarting = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

socket.on('server:restarting', () => {
  restarting = true;
  notify();
});
socket.on('connect', () => {
  restarting = false;
  notify();
});
socket.on('disconnect', notify);

export function useConnection() {
  const read = () => ({ live: socket.connected, restarting });
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);
  return state;
}

/*
 * الاستيقاظ. قفلُ الشاشة أو الانتقال إلى تطبيقٍ آخر يجمّد الصفحة على
 * الجوّال، والسوكِت يموت ولا يدري — أو يبدو حيّاً وقد فاته ما فاته. فإذا
 * عادت الصفحة إلى الواجهة أو رجعت الشبكة: يُعاد الوصل فوراً بلا انتظار
 * مهلة المحاولة، وإن كان حيّاً طُلبت الحالُ من جديد.
 */
const wakers = new Set<() => void>();

function wake() {
  if (!socket.connected) socket.connect();
  else wakers.forEach((fn) => fn());
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
  window.addEventListener('online', wake);
  window.addEventListener('pageshow', wake);
}

/** ما يُفعل إذا استيقظت الصفحة وسوكِتُها حيّ — طلبُ مزامنة عادةً */
export function onWake(fn: () => void) {
  wakers.add(fn);
  return () => void wakers.delete(fn);
}

/* ══════════════ حزمةٌ قديمة بعد نشرٍ جديد ══════════════ */

let serverBuild: string | null = null;
socket.on('server:hello', ({ build }: { build: string | null }) => {
  serverBuild = build;
  notify();
});

/**
 * يُحدّث الصفحة إن كان السيرفر يخدم بناءً أحدث منها — حين يأمن ذلك فقط.
 *
 * بعد كل نشر تبقى الصفحات المفتوحة على حزمة الأمس وهي تكلّم سيرفر اليوم.
 * فإذا سنحت لحظةٌ آمنة (لا جولة تجري) حُدّثت فعادت بالجلسة نفسها. وتُحدَّث
 * مرّةً واحدة لكل بناء: لو بقي المتصفّح يجد القديم لما دار في حلقة.
 */
export function useFreshBuild(safe: boolean) {
  const [, rerender] = useState(0);
  useEffect(() => {
    const update = () => rerender((n) => n + 1);
    listeners.add(update);
    return () => void listeners.delete(update);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !safe || !serverBuild || serverBuild === __BUILD__) return;
    try {
      if (sessionStorage.getItem('nabda:reloaded-for') === serverBuild) return;
      sessionStorage.setItem('nabda:reloaded-for', serverBuild);
    } catch {
      return; // لا نحفظ أننا حدّثنا — فلا نحدّث، خشية الحلقة
    }
    location.reload();
  });
}
