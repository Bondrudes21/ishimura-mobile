// Звуки интерфейса. Всё синтезируется через WebAudio, внешние файлы не нужны.

let ctx = null;
let master = null;
const cfg = { ui: true, uiVolume: 0.4 };
let pack = 'terminal';
let custom = {};

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function configureSound(s, themeSound) {
  Object.assign(cfg, s);
  if (themeSound) { pack = themeSound.pack || 'terminal'; custom = themeSound.custom || {}; }
}

// ---------- Интерфейсные звуки: наборы ----------
export const SOUND_EVENTS = [['click', 'Нажатие'], ['hover', 'Наведение'], ['open', 'Открытие окна'], ['close', 'Закрытие'], ['page', 'Перелистывание'], ['notify', 'Уведомление'], ['error', 'Ошибка']];
export const SOUND_PACKS = [['terminal', 'Терминал (электронные сигналы)'], ['mechanical', 'Механика (щелчки, пневматика)'], ['soft', 'Мягкий (приглушённые тона)'], ['none', 'Без звуков']];

const PACKS = {
  terminal: {
    click: [{ f: 1400, to: 900, d: 0.03, type: 'square', v: 0.12 }],
    hover: [{ f: 2600, d: 0.012, type: 'sine', v: 0.04 }],
    open: [{ f: 420, to: 980, d: 0.09, type: 'sine', v: 0.18 }],
    close: [{ f: 900, to: 380, d: 0.08, type: 'sine', v: 0.15 }],
    page: [{ noise: true, d: 0.07, v: 0.12, hp: 2000 }],
    notify: [{ f: 880, d: 0.08, type: 'sine', v: 0.2 }, { f: 1320, d: 0.12, type: 'sine', v: 0.2, at: 0.1 }],
    error: [{ f: 160, d: 0.18, type: 'sawtooth', v: 0.12 }],
  },
  mechanical: {
    click: [{ noise: true, d: 0.035, v: 0.35, lp: 1800 }, { f: 120, to: 60, d: 0.05, type: 'sine', v: 0.25 }],
    hover: [{ noise: true, d: 0.012, v: 0.08, bp: 3000, q: 4 }],
    open: [{ noise: true, d: 0.22, v: 0.16, hp: 1500, sweep: 6000 }, { f: 90, to: 50, d: 0.12, type: 'sine', v: 0.25 }],
    close: [{ f: 140, to: 50, d: 0.12, type: 'sine', v: 0.3 }, { noise: true, d: 0.05, v: 0.2, lp: 900 }],
    page: [{ noise: true, d: 0.12, v: 0.18, bp: 1400, q: 1.2 }],
    notify: [{ noise: true, d: 0.5, v: 0.4, bp: 2400, q: 30 }, { noise: true, d: 0.6, v: 0.35, bp: 3200, q: 30, at: 0.14 }],
    error: [{ f: 70, d: 0.25, type: 'square', v: 0.12 }],
  },
  soft: {
    click: [{ f: 660, d: 0.06, type: 'sine', v: 0.1 }],
    hover: [{ f: 1320, d: 0.025, type: 'sine', v: 0.025 }],
    open: [{ f: 520, to: 720, d: 0.16, type: 'sine', v: 0.12 }],
    close: [{ f: 720, to: 520, d: 0.14, type: 'sine', v: 0.1 }],
    page: [{ noise: true, d: 0.16, v: 0.07, lp: 2500 }],
    notify: [{ f: 784, d: 0.5, type: 'sine', v: 0.14 }, { f: 1175, d: 0.7, type: 'sine', v: 0.1, at: 0.12 }],
    error: [{ f: 220, d: 0.3, type: 'triangle', v: 0.12 }],
  },
};

// Звуки заставки «Пробуждение» — не зависят от набора
const BOOT = {
  heartbeat: [{ f: 62, to: 38, d: 0.16, type: 'sine', v: 0.55 }, { f: 55, to: 34, d: 0.2, type: 'sine', v: 0.4, at: 0.24 }],
  thaw: [{ noise: true, d: 2.2, v: 0.12, lp: 300, sweep: 4200, attack: 0.8 }],
  chime: [{ f: 659, d: 1.8, type: 'sine', v: 0.12 }, { f: 988, d: 2.2, type: 'sine', v: 0.08, at: 0.05 }, { f: 1319, d: 1.4, type: 'sine', v: 0.04, at: 0.1 }],
  breath: [{ noise: true, d: 1.4, v: 0.06, bp: 700, q: 0.8, attack: 0.6 }],
};

const customCache = new Map();
function playCustom(url) {
  try {
    let a = customCache.get(url);
    if (!a) { a = new Audio(url); customCache.set(url, a); }
    const p = a.cloneNode();
    p.volume = Math.min(1, cfg.uiVolume * 1.6);
    p.play().catch(() => {});
  } catch {}
}

export function sfx(name) {
  if (!cfg.ui || !cfg.uiVolume) return;
  if (custom[name]) { playCustom(custom[name]); return; }
  const spec = BOOT[name] || (pack !== 'none' && (PACKS[pack] || PACKS.terminal)[name]);
  if (!spec) return;
  try {
    const c = ac();
    const t0 = c.currentTime + 0.005;
    for (const s of spec) {
      const t = t0 + (s.at || 0);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(s.v * cfg.uiVolume, t + (s.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t + s.d);
      g.connect(master);
      let src;
      if (s.noise) {
        src = c.createBufferSource();
        src.buffer = noiseBuffer(c, 'white', Math.max(0.3, s.d + 0.1));
        const f = c.createBiquadFilter();
        f.type = s.hp ? 'highpass' : s.lp ? 'lowpass' : 'bandpass';
        f.frequency.setValueAtTime(s.hp || s.lp || s.bp, t);
        if (s.sweep) f.frequency.exponentialRampToValueAtTime(s.sweep, t + s.d);
        if (s.q) f.Q.value = s.q;
        src.connect(f).connect(g);
      } else {
        src = c.createOscillator();
        src.type = s.type;
        src.frequency.setValueAtTime(s.f, t);
        if (s.to) src.frequency.exponentialRampToValueAtTime(s.to, t + s.d);
        src.connect(g);
      }
      src.start(t);
      src.stop(t + s.d + 0.02);
    }
  } catch { /* звук не критичен */ }
}

const noiseCache = {};
function noiseBuffer(c, kind, seconds = 4) {
  const key = `${kind}-${seconds}`;
  if (noiseCache[key]) return noiseCache[key];
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === 'pink') { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.02) * 2.2; }
    else d[i] = w;
  }
  noiseCache[key] = buf;
  return buf;
}
