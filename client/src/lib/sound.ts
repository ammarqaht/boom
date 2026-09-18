/**
 * أصوات مولّدة بـ Web Audio — بلا ملفات صوتية، فلا شيء يُحمّل من الشبكة
 * ولا يتأخر الصوت عن الحدث.
 */
const MUTE_KEY = 'nabda:muted';

let ctx: AudioContext | null = null;
let muted = localStorage.getItem(MUTE_KEY) === '1'; // يبقى الاختيار بعد التحديث

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** المتصفحات تمنع الصوت قبل أول لمسة — نستدعيها عند أول ضغطة زر */
export function unlockAudio() {
  audio();
}

export function setMuted(value: boolean) {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  if (value && ctx) void ctx.suspend();
  if (!value) audio(); // نوقظ السياق فوراً عند إلغاء الكتم
}

export function isMuted() {
  return muted;
}

function tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.15) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(gain, ac.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
  osc.connect(vol).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

/**
 * خفقة القلب: نغمة تهبط بسرعة من ١٥٠ إلى ٥٥ هرتز.
 * نبقي الترددَ مسموعاً على سماعات الجوال الصغيرة بدل دقّة عميقة تضيع.
 */
export function playBeat() {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
  vol.gain.setValueAtTime(0.0001, t0);
  vol.gain.exponentialRampToValueAtTime(0.3, t0 + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
  osc.connect(vol).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + 0.19);
}

export const playCorrect = () => {
  tone(660, 0.12, 'sine', 0.18);
  setTimeout(() => tone(990, 0.18, 'sine', 0.18), 90);
};
export const playWrong = () => tone(160, 0.28, 'sawtooth', 0.16);

/**
 * توقف النبض: خفقة أخيرة واهنة، ثم صفير جهاز المراقبة الثابت
 * الذي يمتد ثانيتين ويخفت — الخط المستقيم مسموعاً.
 */
export function playFlatline() {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;

  // الخفقة الأخيرة
  const beat = ac.createOscillator();
  const beatVol = ac.createGain();
  beat.type = 'sine';
  beat.frequency.setValueAtTime(140, t0);
  beat.frequency.exponentialRampToValueAtTime(48, t0 + 0.16);
  beatVol.gain.setValueAtTime(0.0001, t0);
  beatVol.gain.exponentialRampToValueAtTime(0.34, t0 + 0.015);
  beatVol.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  beat.connect(beatVol).connect(ac.destination);
  beat.start(t0);
  beat.stop(t0 + 0.27);

  // الصفير الثابت — يبدأ مع خفوت الخفقة ويستمر
  const start = t0 + 0.14;
  const beep = ac.createOscillator();
  const beepVol = ac.createGain();
  beep.type = 'sine';
  beep.frequency.value = 988;
  beepVol.gain.setValueAtTime(0.0001, start);
  beepVol.gain.exponentialRampToValueAtTime(0.22, start + 0.05);
  beepVol.gain.setValueAtTime(0.22, start + 1.5);
  beepVol.gain.exponentialRampToValueAtTime(0.0001, start + 2.1);
  beep.connect(beepVol).connect(ac.destination);
  beep.start(start);
  beep.stop(start + 2.15);
}
