// Заставка «Пробуждение из криосна».
// Всё рисуется по единой временной шкале (requestAnimationFrame), поэтому анимация плавная и детерминированная.
import { h } from './util.js';
import { sfx } from './sound.js';
import { state } from './state.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

const DURATION = 5.6;          // секунд до полного исчезновения
const BEATS = [0.35, 1.35, 2.2, 2.95, 3.6, 4.2, 4.78];
// Телефон: заставка быстрее (≈3,5 с), меньше частиц и инея, без размытия всего интерфейса
const MOBILE = matchMedia('(max-width: 820px), (pointer: coarse)').matches;
const SPEED = MOBILE ? 1.6 : 1;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#39ff9a';
}

function hexToRgb(hex) {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [57, 255, 154];
}

// ---------- Иней ----------
function makeFrost(W, H, tint) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // Конденсат: плотнее к краям
  const rg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.1, W / 2, H / 2, Math.hypot(W, H) / 2);
  rg.addColorStop(0, 'rgba(210,230,245,0.18)');
  rg.addColorStop(0.6, 'rgba(215,235,250,0.42)');
  rg.addColorStop(1, 'rgba(230,245,255,0.78)');
  g.fillStyle = rg;
  g.fillRect(0, 0, W, H);

  // Кристаллы-«папоротники»
  g.lineCap = 'round';
  const branch = (x, y, ang, len, depth) => {
    if (depth <= 0 || len < 3) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    g.strokeStyle = `rgba(240,250,255,${0.12 + depth * 0.06})`;
    g.lineWidth = Math.max(0.4, depth * 0.35);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 1);
      const bx = x + (x2 - x) * k, by = y + (y2 - y) * k;
      branch(bx, by, ang + 1.05, len * 0.38 * (1 - k * 0.4), depth - 2);
      branch(bx, by, ang - 1.05, len * 0.38 * (1 - k * 0.4), depth - 2);
    }
    branch(x2, y2, ang + (Math.random() - 0.5) * 0.5, len * 0.62, depth - 1);
  };
  for (let i = 0; i < (MOBILE ? 45 : 90); i++) {
    // Точки роста ближе к краям экрана
    const edge = Math.random();
    let x, y;
    if (edge < 0.25) { x = Math.random() * W; y = Math.random() * H * 0.18; }
    else if (edge < 0.5) { x = Math.random() * W; y = H - Math.random() * H * 0.18; }
    else if (edge < 0.75) { x = Math.random() * W * 0.18; y = Math.random() * H; }
    else { x = W - Math.random() * W * 0.18; y = Math.random() * H; }
    const toCenter = Math.atan2(H / 2 - y, W / 2 - x);
    branch(x, y, toCenter + (Math.random() - 0.5) * 1.6, 40 + Math.random() * 110, 6);
  }
  // Мелкая изморозь
  for (let i = 0; i < (MOBILE ? 2200 : 5000); i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const d = Math.hypot(x - W / 2, y - H / 2) / (Math.hypot(W, H) / 2);
    g.fillStyle = `rgba(245,252,255,${Math.random() * 0.35 * d})`;
    g.fillRect(x, y, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  // Лёгкий оттенок цвета темы
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = `rgba(${tint.join(',')},0.1)`;
  g.fillRect(0, 0, W, H);
  return c;
}

// Шумовое поле для неровного края таяния
function makeNoise(w, h) {
  // Две октавы гладкого шума — неровный, но мягкий край таяния
  const octave = (gw, gh) => {
    const grid = Array.from({ length: (gw + 1) * (gh + 1) }, () => Math.random());
    const at = (i, j) => grid[j * (gw + 1) + i];
    return (x, y) => {
      const gx = (x / w) * gw, gy = (y / h) * gh;
      const i = Math.min(gw - 1, Math.floor(gx)), j = Math.min(gh - 1, Math.floor(gy)), fx = gx - i, fy = gy - j;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return lerp(lerp(at(i, j), at(i + 1, j), sx), lerp(at(i, j + 1), at(i + 1, j + 1), sx), sy);
    };
  };
  const o1 = octave(6, 4), o2 = octave(16, 10);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = o1(x, y) * 0.65 + o2(x, y) * 0.35;
  return out;
}

// Кардиограмма: форма одного удара
function beatShape(dt) {
  if (dt < 0 || dt > 0.45) return 0;
  const p = Math.exp(-Math.pow((dt - 0.05) / 0.025, 2)) * 0.15;
  const q = -Math.exp(-Math.pow((dt - 0.12) / 0.008, 2)) * 0.2;
  const r = Math.exp(-Math.pow((dt - 0.14) / 0.01, 2)) * 1;
  const s = -Math.exp(-Math.pow((dt - 0.16) / 0.01, 2)) * 0.35;
  const tw = Math.exp(-Math.pow((dt - 0.32) / 0.045, 2)) * 0.28;
  return p + q + r + s + tw;
}

export function playBoot() {
  return new Promise((resolve) => {
    const W = innerWidth || document.documentElement.clientWidth || 375;
    const H = innerHeight || document.documentElement.clientHeight || 812;
    const accentHex = cssVar('--accent');
    const accent = hexToRgb(accentHex);
    const accent2 = hexToRgb(cssVar('--accent-2'));
    const texts = state.settings.texts || {};
    const name = (texts.name || '').trim();
    const brand = (texts.brand || '').trim() || 'Архив «Ишимуры»';
    const greeting = (texts.greeting || '').trim()
      ? texts.greeting.replace(/\{name\}/g, name || 'колонист')
      : name ? `Пробуждение завершено. Здравствуй, ${name}.` : 'Пробуждение завершено. Показатели в норме.';
    const simple = !state.settings.theme.effects.animations;

    const frostCv = h('canvas.cryo-frost', { width: W, height: H });
    const fx = h('canvas.cryo-fx', { width: W, height: H });
    const ecg = h('canvas.cryo-ecg', { width: 360, height: 56 });
    const lidTop = h('div.cryo-lid.top');
    const lidBot = h('div.cryo-lid.bottom');
    const pulse = h('b', {}, '38');
    const temp = h('b', {}, '33.8');
    const sync = h('i');
    const hud = h('div.cryo-hud', {},
      h('div.cryo-corner.tl', {}, h('span', {}, 'КРИОКАПСУЛА Б-117'), h('span', {}, 'ПРОТОКОЛ «ОКИРО» · ПРОБУЖДЕНИЕ')),
      h('div.cryo-corner.tr', {}, h('span', {}, 'КОЛОНИАЛЬНЫЙ КОРАБЛЬ «ИШИМУРА»'), h('span', {}, 'ОРБИТА ТИАМАТА II')),
      h('div.cryo-vitals', {},
        h('div', {}, h('small', {}, 'ПУЛЬС'), pulse, h('small', {}, 'уд/мин')),
        h('div', {}, h('small', {}, 'ТЕМПЕРАТУРА'), temp, h('small', {}, '°C')),
        ecg,
        h('div.cryo-sync', {}, h('small', {}, 'НЕЙРО-ПЕРЕВОДЧИК · СИНХРОНИЗАЦИЯ'), h('div.cryo-bar', {}, sync))));
    const voice = h('div.cryo-voice', {}, h('small', {}, 'МИРУАНА'), h('p', {}, greeting));
    const logo = h('div.cryo-logo', {}, brand);
    const skip = h('div.cryo-skip', {}, MOBILE ? 'Коснитесь экрана, чтобы пропустить' : 'Щёлкните или нажмите любую клавишу, чтобы пропустить');
    const scrim = h('div.cryo-scrim');
    const el = h('div.cryo', {}, frostCv, scrim, fx, hud, voice, logo, lidTop, lidBot, skip);
    document.body.append(el);

    const app = document.getElementById('app');
    app.classList.add('waking');

    const frostSrc = simple ? null : makeFrost(W, H, accent2);
    const MW = 160, MH = 90;
    const noise = makeNoise(MW, MH);
    const mask = document.createElement('canvas');
    mask.width = MW; mask.height = MH;
    const mctx = mask.getContext('2d');
    const mimg = mctx.createImageData(MW, MH);
    const fctx = frostCv.getContext('2d');
    const g = fx.getContext('2d');
    const ectx = ecg.getContext('2d');

    // Частицы, из которых соберётся орб
    const CX = W / 2, CY = H * 0.42;
    const parts = Array.from({ length: MOBILE ? 120 : 240 }, () => {
      const a = Math.random() * Math.PI * 2;
      const dist = Math.hypot(W, H) * (0.25 + Math.random() * 0.4);
      return { sx: CX + Math.cos(a) * dist, sy: CY + Math.sin(a) * dist * 0.7, a, spin: 2 + Math.random() * 3, delay: Math.random() * 0.55, size: 0.6 + Math.random() * 1.8 };
    });

    // Куда улетит орб в конце — к значку в заголовке
    const brandOrb = document.querySelector('.brand .orb');
    const tr = brandOrb ? brandOrb.getBoundingClientRect() : { left: 20, top: 12, width: 16, height: 16 };
    const TX = tr.left + tr.width / 2, TY = tr.top + tr.height / 2;

    const played = new Set();
    const once = (key, at, t, fn) => { if (t >= at && !played.has(key)) { played.add(key); fn(); } };

    let start = performance.now();
    let skipping = false, done = false, raf;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onSkip, true);
      el.remove();
      app.classList.remove('waking');
      app.style.filter = '';
      app.style.transform = '';
      if (brandOrb) { brandOrb.classList.remove('orb-arrive'); void brandOrb.offsetWidth; brandOrb.classList.add('orb-arrive'); }
      resolve();
    };
    const onSkip = (e) => {
      if (skipping) return;
      if (e && e.type === 'keydown') e.preventDefault();
      skipping = true;
      // Перематываем к финальному перелёту орба
      const now = performance.now();
      const t = ((now - start) / 1000) * SPEED;
      if (t < 4.6) start = now - (4.6 * 1000) / SPEED;
    };
    el.addEventListener('pointerdown', onSkip);
    addEventListener('keydown', onSkip, true);

    const frame = (now) => {
      // window.__bootClock — отладочная «заморозка» времени для скриншотов
      const t = typeof window.__bootClock === 'function' ? window.__bootClock() : ((now - start) / 1000) * SPEED;

      // --- Звуки ---
      once('breath', 0.4, t, () => sfx('breath'));
      BEATS.forEach((b, i) => once(`beat${i}`, b, t, () => sfx('heartbeat')));
      once('thaw', 1.25, t, () => sfx('thaw'));
      once('chime', 3.05, t, () => sfx('chime'));

      // --- Веки: приоткрыть, моргнуть, открыть ---
      let open;
      if (t < 0.45) open = 0;
      else if (t < 0.95) open = easeOut(seg(t, 0.45, 0.95)) * 0.22;
      else if (t < 1.12) open = lerp(0.22, 0.03, easeInOut(seg(t, 0.95, 1.12)));
      else open = lerp(0.03, 1, easeInOut(seg(t, 1.2, 2.1)));
      const lidH = (1 - open) * 52;
      lidTop.style.transform = `translateY(${-100 + lidH * 1.92}%)`;
      lidBot.style.transform = `translateY(${100 - lidH * 1.92}%)`;

      // --- Интерфейс за инеем: из размытия в фокус ---
      // Два этапа: мягкий расфокус под приветствием, затем резкость вместе с полётом орба
      const f1 = easeOut(seg(t, 1.1, 3.0)), f2 = easeInOut(seg(t, 4.45, 5.35));
      const blur = lerp(lerp(22, 7, f1), 0, f2);
      const bright = lerp(lerp(0.3, 0.62, f1), 1, f2);
      // На телефоне размытие всего экрана каждый кадр слишком тяжёлое — только яркость
      app.style.filter = MOBILE ? `brightness(${bright})` : `blur(${blur}px) brightness(${bright}) saturate(${lerp(lerp(0.3, 0.7, f1), 1, f2)})`;
      if (!MOBILE) app.style.transform = `scale(${lerp(lerp(1.05, 1.02, f1), 1, f2)})`;

      // --- Иней тает от центра к краям ---
      const melt = lerp(-0.1, 1.15, easeInOut(seg(t, 1.25, 3.9)));
      if (frostSrc && melt < 1.12) {
        const d = mimg.data;
        for (let y = 0; y < MH; y++) {
          for (let x = 0; x < MW; x++) {
            const nx = x / MW - 0.5, ny = (y / MH - 0.42);
            const dist = Math.min(1, Math.hypot(nx * 1.25, ny * 1.4) * 1.55);
            const v = dist * 0.62 + noise[y * MW + x] * 0.38;
            const a = clamp((v - melt) / 0.22 + 0.5);
            d[(y * MW + x) * 4 + 3] = a * 255;
          }
        }
        mctx.putImageData(mimg, 0, 0);
        fctx.globalCompositeOperation = 'source-over';
        fctx.clearRect(0, 0, W, H);
        fctx.drawImage(frostSrc, 0, 0);
        fctx.globalCompositeOperation = 'destination-in';
        fctx.imageSmoothingQuality = 'high';
        fctx.drawImage(mask, 0, 0, W, H);
      } else if (frostCv.style.display !== 'none') {
        frostCv.style.display = 'none';
      }

      // --- HUD ---
      const hudIn = easeOut(seg(t, 1.0, 1.7)) * (1 - easeInOut(seg(t, 4.4, 5.0)));
      hud.style.opacity = hudIn;
      const vit = easeInOut(seg(t, 1.0, 3.6));
      pulse.textContent = Math.round(lerp(38, 64, vit));
      temp.textContent = lerp(33.8, 36.6, vit).toFixed(1);
      sync.style.width = `${Math.round(easeInOut(seg(t, 1.4, 3.9)) * 100)}%`;

      // Кардиограмма
      ectx.clearRect(0, 0, 360, 56);
      ectx.strokeStyle = accentHex;
      ectx.lineWidth = 1.6;
      ectx.shadowColor = accentHex;
      ectx.shadowBlur = 6;
      ectx.beginPath();
      for (let x = 0; x <= 360; x += 2) {
        const tt = t - (360 - x) / 360 * 2.4;
        let v = 0;
        for (const b of BEATS) v += beatShape(tt - b);
        const y = 34 - v * 24;
        x ? ectx.lineTo(x, y) : ectx.moveTo(x, y);
      }
      ectx.stroke();

      // --- Частицы и орб ---
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      const fly = easeInOut(seg(t, 4.55, 5.25));
      const ox = lerp(CX, TX, fly), oy = lerp(CY, TY, fly);
      for (const p of parts) {
        const k = easeInOut(seg(t, 1.55 + p.delay, 3.05));
        if (k <= 0 || k >= 1) continue;
        const ang = p.a + k * p.spin;
        const rad = (1 - k) * Math.hypot(p.sx - CX, p.sy - CY);
        const x = lerp(p.sx, CX + Math.cos(ang) * rad, k), y = lerp(p.sy, CY + Math.sin(ang) * rad * 0.7, k);
        const alpha = Math.sin(k * Math.PI) * 0.9;
        g.fillStyle = `rgba(${accent.join(',')},${alpha})`;
        g.beginPath(); g.arc(x, y, p.size * (1 + k), 0, Math.PI * 2); g.fill();
      }
      const born = seg(t, 2.85, 3.5);
      if (born > 0) {
        const R = lerp(0, 46, easeOutBack(born)) * lerp(1, 0.18, fly) * (1 + Math.sin(t * 4) * 0.02);
        const flash = Math.max(0, 1 - seg(t, 3.0, 3.8)) * (born > 0.05 ? 1 : 0);
        // Вспышка рождения
        if (flash > 0) {
          const fr = g.createRadialGradient(ox, oy, 0, ox, oy, 260 * (1 - flash * 0.4));
          fr.addColorStop(0, `rgba(${accent2.join(',')},${0.45 * flash})`);
          fr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = fr; g.fillRect(0, 0, W, H);
        }
        const halo = g.createRadialGradient(ox, oy, R * 0.2, ox, oy, R * 3.2);
        halo.addColorStop(0, `rgba(${accent.join(',')},0.55)`);
        halo.addColorStop(1, `rgba(${accent.join(',')},0)`);
        g.fillStyle = halo; g.beginPath(); g.arc(ox, oy, R * 3.2, 0, Math.PI * 2); g.fill();
        g.globalCompositeOperation = 'source-over';
        const core = g.createRadialGradient(ox - R * 0.3, oy - R * 0.35, R * 0.05, ox, oy, R);
        core.addColorStop(0, 'rgba(240,255,248,1)');
        core.addColorStop(0.25, `rgba(${accent2.join(',')},1)`);
        core.addColorStop(0.7, `rgba(${accent.join(',')},0.95)`);
        core.addColorStop(1, `rgba(${accent.join(',')},0)`);
        g.fillStyle = core; g.beginPath(); g.arc(ox, oy, R, 0, Math.PI * 2); g.fill();
        // Кольца
        g.strokeStyle = `rgba(${accent.join(',')},${0.4 * (1 - fly)})`;
        g.lineWidth = 1;
        for (let i = 0; i < 2; i++) {
          const ph = ((t * 0.6 + i * 0.5) % 1);
          g.globalAlpha = (1 - ph) * born * (1 - fly);
          g.beginPath(); g.arc(ox, oy, R * (1.3 + ph * 1.6), 0, Math.PI * 2); g.stroke();
        }
        g.globalAlpha = 1;
      }

      // --- Голос Мируаны и логотип ---
      const vIn = easeOut(seg(t, 3.25, 3.85)), vOut = easeInOut(seg(t, 4.45, 4.9));
      voice.style.opacity = vIn * (1 - vOut);
      voice.style.transform = `translate(-50%, ${lerp(14, 0, vIn) - vOut * 10}px)`;
      voice.style.filter = `blur(${lerp(6, 0, vIn) + vOut * 4}px)`;
      const lIn = easeOut(seg(t, 3.55, 4.3));
      logo.style.opacity = lIn * (1 - vOut);
      logo.style.letterSpacing = `${lerp(0.6, 0.14, lIn)}em`;
      logo.style.filter = `blur(${lerp(10, 0, lIn) + vOut * 6}px)`;
      skip.style.opacity = easeOut(seg(t, 1.5, 2.2)) * (1 - vOut) * 0.6;
      scrim.style.opacity = easeOut(seg(t, 2.9, 3.6)) * (1 - vOut);

      // --- Затухание затемнения ---
      el.style.backgroundColor = `rgba(0,0,0,${lerp(0.55, 0, easeInOut(seg(t, 1.4, 4.2)))})`;
      el.style.opacity = 1 - easeInOut(seg(t, 5.0, DURATION));

      if (t >= DURATION) finish();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
}

// Нейтральная заставка для режимов «Вархаммер» и «Свободный»: название проявляется, интерфейс фокусируется
export function playNeutralBoot(title) {
  return new Promise((resolve) => {
    const app = document.getElementById('app');
    const word = h('div.nb-title', {}, title);
    const line = h('div.nb-line');
    const el = h('div.nboot', {}, h('div.nb-inner', {}, word, line));
    document.body.append(el);
    app.classList.add('waking');
    const simple = !state.settings.theme.effects.animations;
    const D = simple ? 0.4 : MOBILE ? 1.2 : 1.9;
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
      app.classList.remove('waking');
      app.style.filter = '';
      app.style.transform = '';
      removeEventListener('keydown', finish, true);
      resolve();
    };
    el.addEventListener('pointerdown', finish);
    addEventListener('keydown', finish, true);
    const frame = (now) => {
      if (done) return;
      const t = (now - start) / 1000 / (D / 1.9);
      const tIn = easeOut(seg(t, 0.05, 0.7));
      const tOut = easeInOut(seg(t, 1.15, 1.9));
      word.style.opacity = tIn * (1 - tOut);
      word.style.letterSpacing = `${lerp(0.5, 0.18, tIn)}em`;
      word.style.filter = `blur(${lerp(8, 0, tIn) + tOut * 6}px)`;
      line.style.transform = `scaleX(${easeInOut(seg(t, 0.35, 1.1))})`;
      line.style.opacity = 1 - tOut;
      const f = easeInOut(seg(t, 0.9, 1.9));
      app.style.filter = MOBILE ? `brightness(${lerp(0.4, 1, f)})` : `blur(${lerp(14, 0, f)}px) brightness(${lerp(0.4, 1, f)})`;
      if (!MOBILE) app.style.transform = `scale(${lerp(1.03, 1, f)})`;
      el.style.opacity = 1 - tOut;
      if (t >= 1.9) finish(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
