// Встроенные темы, модульные пресеты и применение внешнего вида к документу
export const COLOR_KEYS = [
  ['bg', 'Фон'],
  ['bg2', 'Панели'],
  ['bg3', 'Приподнятые элементы'],
  ['line', 'Линии и рамки'],
  ['text', 'Основной текст'],
  ['dim', 'Приглушённый текст'],
  ['accent', 'Акцент'],
  ['accent2', 'Второй акцент'],
  ['warn', 'Предупреждение'],
  ['danger', 'Тревога'],
];

export const FONTS = [
  ['JetBrains Mono', 'mono'], ['IBM Plex Mono', 'mono'], ['PT Mono', 'mono'], ['Consolas', 'mono'],
  ['Unbounded', 'display'], ['Russo One', 'display'], ['Oswald', 'display'], ['Exo 2', 'display'], ['Play', 'display'],
  ['IBM Plex Sans', 'sans'], ['Rubik', 'sans'], ['Segoe UI', 'sans'], ['Arial', 'sans'],
  ['Literata', 'serif'], ['PT Serif', 'serif'], ['Spectral', 'serif'], ['Georgia', 'serif'], ['Times New Roman', 'serif'],
];
const FALLBACK = { mono: 'Consolas, monospace', display: 'sans-serif', sans: 'sans-serif', serif: 'Georgia, serif' };

export function fontStack(name) {
  if (!name) return 'sans-serif';
  const known = FONTS.find(([n]) => n === name);
  return `'${name}', ${known ? FALLBACK[known[1]] : 'sans-serif'}`;
}

export const PRESETS = {
  terminal: {
    name: 'Терминал «Ишимуры»',
    about: 'Как экран бортового ИИ Мируаны: зелёное свечение и скан-линии.',
    theme: {
      colors: { bg: '#040907', bg2: '#08130f', bg3: '#0e1f18', line: '#1a3a2b', text: '#c9f7de', dim: '#5d8a73', accent: '#39ff9a', accent2: '#a6ffd4', warn: '#ffb648', danger: '#ff5050' },
      fonts: { ui: 'JetBrains Mono', head: 'Unbounded', read: 'Literata', uiSize: 14, headCase: 'upper', headSpacing: 0.08 },
      effects: { scanlines: 0.35, glow: 0.8, grain: 0.1, vignette: 0.5, flicker: true, chroma: false, radius: 2, border: 1, speed: 1, deco: 'brackets', panelAlpha: 92, panelBlur: 6, animations: true },
      background: { type: 'grid', url: '', opacity: 1, blur: 0, dim: 0.5 },
      css: '',
      cursor: { type: 'system', url: '' },
      sound: { pack: 'terminal', custom: {} },
    },
    layout: { nav: 'left', navStyle: 'full', density: 'normal', storiesView: 'tiles' },
    stripe: 'linear-gradient(90deg, #39ff9a, transparent)',
  },
  dock: {
    name: 'Индустриальный док',
    about: 'Ангар B62: оранжевый, жёлто-чёрные полосы, грубый металл.',
    theme: {
      colors: { bg: '#0f0f0e', bg2: '#181715', bg3: '#23211d', line: '#3a342b', text: '#ece4d6', dim: '#8f8473', accent: '#ff7a1a', accent2: '#ffc21a', warn: '#ffc21a', danger: '#ff2e2e' },
      fonts: { ui: 'Rubik', head: 'Russo One', read: 'PT Serif', uiSize: 14, headCase: 'upper', headSpacing: 0.04 },
      effects: { scanlines: 0, glow: 0.25, grain: 0.22, vignette: 0.6, flicker: false, chroma: false, radius: 0, border: 2, speed: 1, deco: 'hazard', panelAlpha: 100, panelBlur: 0, animations: true },
      background: { type: 'none', url: '', opacity: 1, blur: 0, dim: 0.5 },
      css: '',
      cursor: { type: 'system', url: '' },
      sound: { pack: 'mechanical', custom: {} },
    },
    layout: { nav: 'top', navStyle: 'full', density: 'normal', storiesView: 'tiles' },
    stripe: 'repeating-linear-gradient(-45deg, #ffc21a 0 10px, #0f0f0e 10px 20px)',
  },
  bunker: {
    name: 'Командный бункер',
    about: 'Штаб гвардии в Прочеллиуне: тёмно-синий, латунь, грифы «секретно».',
    theme: {
      colors: { bg: '#090c12', bg2: '#0f141d', bg3: '#161d2a', line: '#253044', text: '#dae3f2', dim: '#7c89a3', accent: '#6fa8ff', accent2: '#d1a93a', warn: '#e0b341', danger: '#e5484d' },
      fonts: { ui: 'IBM Plex Sans', head: 'Oswald', read: 'Spectral', uiSize: 14, headCase: 'upper', headSpacing: 0.12 },
      effects: { scanlines: 0.08, glow: 0.35, grain: 0.06, vignette: 0.55, flicker: false, chroma: false, radius: 3, border: 1, speed: 1, deco: 'stamps', panelAlpha: 88, panelBlur: 10, animations: true },
      background: { type: 'stars', url: '', opacity: 1, blur: 0, dim: 0.5 },
      css: '',
      cursor: { type: 'system', url: '' },
      sound: { pack: 'soft', custom: {} },
    },
    layout: { nav: 'left', navStyle: 'full', density: 'spacious', storiesView: 'list' },
    stripe: 'linear-gradient(90deg, #d1a93a, #6fa8ff)',
  },
  gothic: {
    name: 'Готика',
    about: 'Тёмное золото, бордо и пергамент.',
    theme: {
      colors: { bg: '#0c0907', bg2: '#15100c', bg3: '#201812', line: '#3b2b1d', text: '#ecdcc0', dim: '#9b8463', accent: '#c9a046', accent2: '#e9d08f', warn: '#d9a21b', danger: '#a3201f' },
      fonts: { ui: 'IBM Plex Sans', head: 'Spectral', read: 'Literata', uiSize: 14, headCase: 'upper', headSpacing: 0.14 },
      effects: { scanlines: 0, glow: 0.3, grain: 0.22, vignette: 0.75, flicker: false, chroma: false, radius: 2, border: 1, speed: 1, deco: 'ornate', panelAlpha: 94, panelBlur: 4, animations: true },
      background: { type: 'none', url: '', opacity: 1, blur: 0, dim: 0.5 },
      css: '',
      cursor: { type: 'system', url: '' },
      sound: { pack: 'soft', custom: {} },
    },
    layout: { nav: 'left', navStyle: 'full', density: 'normal', storiesView: 'tiles' },
    stripe: 'linear-gradient(90deg, #a3201f, #c9a046, #a3201f)',
  },
  library: {
    name: 'Библиотека',
    about: 'Спокойные цвета и скруглённые карточки.',
    theme: {
      colors: { bg: '#131518', bg2: '#1a1d21', bg3: '#23272d', line: '#2e333a', text: '#e5e7ea', dim: '#8a919b', accent: '#86b2f2', accent2: '#c7b3ff', warn: '#e6b35a', danger: '#e26d6d' },
      fonts: { ui: 'IBM Plex Sans', head: 'Literata', read: 'Literata', uiSize: 14, headCase: 'none', headSpacing: 0 },
      effects: { scanlines: 0, glow: 0.1, grain: 0, vignette: 0.15, flicker: false, chroma: false, radius: 10, border: 1, speed: 1, deco: 'none', panelAlpha: 100, panelBlur: 0, animations: true },
      background: { type: 'none', url: '', opacity: 1, blur: 0, dim: 0.5 },
      css: '',
      cursor: { type: 'system', url: '' },
      sound: { pack: 'soft', custom: {} },
    },
    layout: { nav: 'left', navStyle: 'full', density: 'normal', storiesView: 'tiles' },
    stripe: 'linear-gradient(90deg, #86b2f2, #c7b3ff)',
  },
};

// Полная тема с подстановкой недостающих полей (старые сохранённые темы могли их не иметь)
export function normalizeTheme(t) {
  const base = PRESETS.terminal.theme;
  return {
    colors: { ...base.colors, ...(t.colors || {}) },
    fonts: { ...base.fonts, ...(t.fonts || {}) },
    effects: { ...base.effects, ...(t.effects || {}) },
    background: { ...base.background, ...(t.background || {}) },
    css: t.css || '',
    cursor: { ...base.cursor, ...(t.cursor || {}) },
    sound: { pack: 'terminal', custom: {}, ...(t.sound || {}) },
  };
}

// ---------- Модули для смешивания ----------
export const READER_KEYS = ['mode', 'font', 'fontSize', 'lineHeight', 'width', 'align', 'indent', 'paraSpacing', 'paper', 'stampStyle', 'focus'];

export const MODULES = {
  colors: { label: 'Палитра', path: 'theme.colors' },
  fonts: { label: 'Шрифты', path: 'theme.fonts' },
  effects: { label: 'Эффекты', path: 'theme.effects' },
  background: { label: 'Фон', path: 'theme.background' },
  reader: { label: 'Чтение', path: 'reader', keys: READER_KEYS },
};

export const READER_PRESETS = [
  { id: 'r-night', name: 'Ночь', builtin: true, data: { mode: 'scroll', font: 'Literata', fontSize: 19, lineHeight: 1.8, width: 700, align: 'left', indent: true, paraSpacing: 0.7, paper: 'dark', stampStyle: 'terminal', focus: 'off' } },
  { id: 'r-day', name: 'День', builtin: true, data: { mode: 'scroll', font: 'PT Serif', fontSize: 19, lineHeight: 1.7, width: 720, align: 'left', indent: true, paraSpacing: 0.6, paper: 'light', stampStyle: 'plain', focus: 'off' } },
  { id: 'r-book', name: 'Книга', builtin: true, data: { mode: 'spread', font: 'Spectral', fontSize: 18, lineHeight: 1.6, width: 640, align: 'justify', indent: true, paraSpacing: 0.15, paper: 'sepia', stampStyle: 'plain', focus: 'off' } },
  { id: 'r-terminal', name: 'Терминал', builtin: true, data: { mode: 'scroll', font: 'JetBrains Mono', fontSize: 16, lineHeight: 1.75, width: 760, align: 'left', indent: false, paraSpacing: 1, paper: 'terminal', stampStyle: 'terminal', focus: 'paragraph' } },
  { id: 'r-focus', name: 'Фокус', builtin: true, data: { mode: 'scroll', font: 'Literata', fontSize: 21, lineHeight: 1.85, width: 640, align: 'left', indent: true, paraSpacing: 0.8, paper: 'theme', stampStyle: 'terminal', focus: 'ruler' } },
];

export function builtinModulePresets(mod) {
  if (mod === 'reader') return READER_PRESETS;
  return Object.entries(PRESETS).map(([id, p]) => ({ id: `${mod}-${id}`, name: p.name, builtin: true, data: JSON.parse(JSON.stringify(p.theme[mod])) }));
}

export function moduleData(settings, mod) {
  if (mod === 'reader') return Object.fromEntries(READER_KEYS.map((k) => [k, settings.reader[k]]));
  return JSON.parse(JSON.stringify(settings.theme[mod]));
}

// ---------- CSS-переменные ----------
export function themeVars(theme) {
  const c = theme.colors, f = theme.fonts, e = theme.effects, b = theme.background;
  return {
    '--bg': c.bg, '--bg-2': c.bg2, '--bg-3': c.bg3, '--line': c.line, '--text': c.text, '--dim': c.dim,
    '--accent': c.accent, '--accent-2': c.accent2, '--warn': c.warn, '--danger': c.danger,
    '--f-ui': fontStack(f.ui), '--f-head': fontStack(f.head), '--f-read': fontStack(f.read),
    '--ui-size': `${f.uiSize}px`, '--head-case': f.headCase === 'upper' ? 'uppercase' : 'none', '--head-ls': `${f.headSpacing}em`,
    '--r': `${e.radius}px`, '--bw': `${e.border}px`, '--glow-k': e.glow, '--speed': e.speed,
    '--scan': e.scanlines, '--grain': e.grain, '--vignette': e.vignette,
    '--panel-alpha': `${e.panelAlpha}%`, '--panel-blur': `${e.panelBlur}px`,
    '--bg-opacity': b.opacity, '--bg-blur': `${b.blur}px`, '--bg-dim': b.dim,
  };
}

export const PAPERS = {
  theme: { name: 'Как в теме' },
  dark: { name: 'Ночь', bg: '#0b0b0b', text: '#d6d6d6' },
  sepia: { name: 'Сепия', bg: '#f1e7d0', text: '#3b2f22' },
  light: { name: 'Бумага', bg: '#fafaf7', text: '#1c1c1c' },
  terminal: { name: 'Терминал', bg: '#020604', text: '#7dffb8' },
};

export function applyAppearance(settings) {
  const root = document.documentElement;
  const { theme, layout, reader, anim } = settings;
  for (const [k, v] of Object.entries(themeVars(theme))) root.style.setProperty(k, v);

  root.dataset.deco = theme.effects.deco;
  root.dataset.flicker = theme.effects.flicker ? 'on' : 'off';
  root.dataset.chroma = theme.effects.chroma ? 'on' : 'off';
  root.dataset.anim = theme.effects.animations ? 'on' : 'off';
  root.dataset.nav = layout.nav;
  root.dataset.navStyle = layout.navStyle;
  root.dataset.density = layout.density;
  root.dataset.statusbar = layout.statusBar ? 'on' : 'off';
  root.dataset.stampStyle = reader.stampStyle;
  root.dataset.viewAnim = anim.view;
  root.dataset.cardAnim = anim.cards;
  root.dataset.cursor = theme.cursor.type;
  root.style.setProperty('--card-w', `${layout.cardSize}px`);
  root.style.setProperty('--nav-w', layout.navStyle === 'icons' ? '64px' : `${layout.navWidth}px`);

  // Читалка
  root.style.setProperty('--rd-size', `${reader.fontSize}px`);
  root.style.setProperty('--rd-lh', reader.lineHeight);
  root.style.setProperty('--rd-width', `${reader.width}px`);
  root.style.setProperty('--rd-para', `${reader.paraSpacing}em`);
  root.style.setProperty('--rd-indent', reader.indent ? '1.6em' : '0');
  root.style.setProperty('--rd-align', reader.align);
  root.style.setProperty('--rd-font', reader.font ? fontStack(reader.font) : 'var(--f-read)');
  const paper = PAPERS[reader.paper] || PAPERS.theme;
  root.style.setProperty('--rd-bg', reader.paper === 'theme' ? 'transparent' : paper.bg);
  root.style.setProperty('--rd-text', reader.paper === 'theme' ? 'var(--text)' : paper.text);
  root.style.setProperty('--rd-sheet', reader.paper === 'theme' ? 'var(--bg)' : paper.bg);

  applyCustomFonts(settings.customFonts);
  applyBackground(theme.background);
  applyCursor(theme.cursor, theme.colors.accent);
  setText('user-css', theme.css || '');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el && el.textContent !== text) el.textContent = text;
}

function applyCustomFonts(list = []) {
  setText('custom-fonts', list
    .map((f) => `@font-face { font-family: '${f.family.replace(/'/g, '')}'; src: url('${f.url}'); font-display: swap; }`)
    .join('\n'));
}

// Курсоры рисуются SVG и окрашиваются в акцент темы
function svgCursor(svg, x, y) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}`;
}
function applyCursor(c, accent) {
  let css = '';
  if (c.type === 'crosshair') {
    const s = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><g stroke='${accent}' stroke-width='2' fill='none'><circle cx='16' cy='16' r='7'/><path d='M16 1v8M16 23v8M1 16h8M23 16h8'/></g><circle cx='16' cy='16' r='1.5' fill='${accent}'/></svg>`;
    css = `body, button, a, .card, input[type=range] { cursor: ${svgCursor(s, 16, 16)}, crosshair !important; }`;
  } else if (c.type === 'arrow') {
    const s = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><path d='M3 2l20 9-8.5 2.5L11 22z' fill='${accent}' fill-opacity='.25' stroke='${accent}' stroke-width='1.6' stroke-linejoin='round'/></svg>`;
    css = `body, button, a, .card { cursor: ${svgCursor(s, 3, 2)}, default !important; }`;
  } else if (c.type === 'block') {
    const s = `<svg xmlns='http://www.w3.org/2000/svg' width='14' height='24'><rect x='1' y='1' width='12' height='22' fill='${accent}' fill-opacity='.85'/></svg>`;
    css = `body, button, a, .card { cursor: ${svgCursor(s, 1, 1)}, default !important; }`;
  } else if (c.type === 'custom' && c.url) {
    css = `body, button, a, .card { cursor: url('${c.url}') 0 0, default !important; }`;
  } else if (c.type === 'glow') {
    css = `body, button, a, .card { cursor: none !important; } input, textarea, .rd-article, [contenteditable] { cursor: text !important; }`;
  }
  setText('cursor-css', css);
}

let bgKey = '';
function applyBackground(bg) {
  const el = document.getElementById('fx-bg');
  const key = `${bg.type}|${bg.url}`;
  if (key === bgKey) return;
  bgKey = key;
  el.dataset.type = bg.type;
  el.innerHTML = '';
  if (bg.type === 'image' && bg.url) {
    const img = document.createElement('img');
    img.className = 'bg-media'; img.src = bg.url;
    el.append(img);
  } else if (bg.type === 'video' && bg.url) {
    const v = document.createElement('video');
    Object.assign(v, { className: 'bg-media', src: bg.url, autoplay: true, loop: true, muted: true, playsInline: true });
    el.append(v);
  } else if (bg.type === 'stars') {
    el.innerHTML = '<div class="stars"></div><div class="planet"></div>';
  } else if (bg.type === 'radar') {
    el.innerHTML = '<div class="sweep"></div>';
  }
}
