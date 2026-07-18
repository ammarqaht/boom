/**
 * أصوات مولّدة بـ Web Audio — بلا ملفات صوتية، فلا شيء يُحمّل من الشبكة
 * ولا يتأخر الصوت عن الحدث.
 */
const MUTE_KEY = 'qunbula:muted';

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

export const playTick = () => tone(880, 0.05, 'square', 0.05);
export const playCorrect = () => {
  tone(660, 0.12, 'sine', 0.18);
  setTimeout(() => tone(990, 0.18, 'sine', 0.18), 90);
};
export const playWrong = () => tone(160, 0.28, 'sawtooth', 0.16);

export function playExplosion() {
  const ac = audio();
  if (!ac) return;
  // ضجيج أبيض متلاشٍ = دوي انفجار
  const length = ac.sampleRate * 1.1;
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
  }
  const src = ac.createBufferSource();
  const vol = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1600, ac.currentTime);
  filter.frequency.exponentialRampToValueAtTime(90, ac.currentTime + 1);
  vol.gain.setValueAtTime(0.5, ac.currentTime);
  src.buffer = buffer;
  src.connect(filter).connect(vol).connect(ac.destination);
  src.start();
}
