/*
 * جلساتُ هذا الجهاز: جلسةُ اللاعب، وجلسةُ المنظّم، وبصمةُ الجهاز.
 *
 * تُقرأ من هنا في موضعين: الصفحاتُ حين تُعرض، والسوكِت حين يتّصل —
 * فالهويّة تُرسل مع الاتصال نفسه (lib/socket.ts) لا في طلبٍ بعده.
 *
 * والحفظ في القرص والذاكرة معاً. localStorage يرمي استثناءً على بعض
 * الأجهزة — تصفّحٌ خاصّ في iOS، أو حظرُ بيانات الموقع، أو تخزينٌ ممتلئ —
 * فالنسخةُ التي في الذاكرة تكفي للرجوع بعد انقطاع الشبكة ما بقيت الصفحة
 * مفتوحة، وذاك أكثرُ ما يحدث في القاعة.
 */

export type TeamSession = { code: string; teamId: string; token: string };
export type AdminSession = { code: string; adminKey: string };

const TEAM_KEY = 'nabda:team';
const ADMIN_KEY = 'nabda:admin';
const DEVICE_KEY = 'nabda:device';

const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* جهازٌ لا يخزّن — فالذاكرة */
  }
  return memory.get(key) ?? null;
}

/** يكتب ويقول: هل ثبت في القرص أم في الذاكرة وحدها؟ */
function write(key: string, value: string | null): boolean {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function parse<T>(raw: string | null): T | null {
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export const loadTeamSession = () => parse<TeamSession>(read(TEAM_KEY));
export const saveTeamSession = (session: TeamSession) => write(TEAM_KEY, JSON.stringify(session));
export const clearTeamSession = () => void write(TEAM_KEY, null);

export const loadAdminSession = () => parse<AdminSession>(read(ADMIN_KEY));
export const saveAdminSession = (session: AdminSession) =>
  write(ADMIN_KEY, JSON.stringify(session));
export const clearAdminSession = () => void write(ADMIN_KEY, null);

/**
 * بصمةُ الجهاز: رقمٌ عشوائيّ يُولد مرّةً ويبقى.
 *
 * بها يعود اللاعب إلى مجموعته باسمه نفسه لو ضاعت جلسته — خرج ثم دخل،
 * أو مُسحت — ولا ينتحل اسمَه جهازٌ آخر. لا تحمل شيئاً عن صاحبها.
 */
export function deviceId(): string {
  let id = read(DEVICE_KEY);
  if (!id) {
    id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    write(DEVICE_KEY, id);
  }
  return id;
}
