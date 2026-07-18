import { io } from 'socket.io-client';
import type { Ack } from './types';

// نفس الأصل في الإنتاج؛ في التطوير يمرره vite proxy إلى 3000
export const socket = io({
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 400,
  reconnectionDelayMax: 2000,
});

/** إرسال حدث وانتظار رد السيرفر كوعد */
export function ask<T = object>(event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, payload ?? {}, (err: unknown, res: Ack<T>) => {
      if (err) return resolve({ ok: false, error: 'انقطع الاتصال بالسيرفر' });
      resolve(res ?? { ok: false, error: 'لا يوجد رد من السيرفر' });
    });
  });
}
