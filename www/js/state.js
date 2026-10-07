// Состояние приложения: настройки, пресеты, прогресс чтения, манифест архива, шина событий
import { PRESETS, MODULES, READER_KEYS, applyAppearance, normalizeTheme, builtinModulePresets } from './themes.js';
import { configureSound } from './sound.js';
import { debounce } from './util.js';

export const SECTIONS = [
  { id: 'stories', title: 'Рассказы', icon: 'book', modes: ['ishimura'] },
  { id: 'gallery', title: 'Галерея', icon: 'image', modes: ['ishimura'] },
  { id: 'timeline', title: 'Хроника', icon: 'timeline', modes: ['ishimura'] },
  { id: 'codex', title: 'Кодекс', icon: 'codex', modes: ['ishimura'] },
  { id: 'map', title: 'Карта', icon: 'map', modes: ['ishimura'] },
  { id: 'library', title: 'Библиотека', icon: 'shelf', modes: ['warhammer', 'free'] },
  { id: 'audio', title: 'Аудиокниги', icon: 'headphones', modes: ['warhammer', 'free'] },
  { id: 'writer', title: 'Мои книги', icon: 'pen', modes: ['free'] },
  { id: 'catalogs', title: 'Каталоги', icon: 'globe', modes: ['free'] },
  { id: 'browser', title: 'Браузер', icon: 'compass', modes: ['warhammer', 'free'] },
];

// Режимы приложения: у каждого свой набор разделов, своя тема и своё название
export const MODES = {
  ishimura: { name: 'Ишимура', title: 'Архив «Ишимуры»', theme: 'builtin:terminal', about: 'Рассказы вселенной Тиамата II, галерея, хроника и кодекс' },
  warhammer: { name: 'Вархаммер', title: 'Библиотека', theme: 'builtin:gothic', about: 'Книги и аудиокниги. Что скачаете во встроенном браузере, попадёт на полку' },
  free: { name: 'Свободный', title: 'Библиотека', theme: 'builtin:library', about: 'Любые книги, свои рукописи, онлайн-каталоги и сайты' },
};
export const BROWSER_HOME = {
  warhammer: [
    { title: 'Книги', url: 'https://warhammergames.ru/load/1' },
    { title: 'Аудиокниги', url: 'https://warhammergames.ru/audiobooks' },
  ],
};

export function defaultSections(mode) {
  const own = SECTIONS.filter((s) => s.modes.includes(mode));
  const rest = SECTIONS.filter((s) => !s.modes.includes(mode));
  return [...own.map((s) => ({ id: s.id, visible: true })), ...rest.map((s) => ({ id: s.id, visible: false }))];
}

const clone = (o) => JSON.parse(JSON.stringify(o));

export function defaultSettings(presetId = 'terminal') {
  const p = PRESETS[presetId];
  return {
    version: 3,
    firstRun: true,
    mode: 'ishimura',
    modes: {},
    bookmarks: { free: [] },
    opds: [],
    preset: presetId,
    activeTheme: `builtin:${presetId}`,
    theme: clone(p.theme),
    layout: {
      ...{ nav: 'left', navStyle: 'full', navWidth: 232, density: 'normal', storiesView: 'tiles', cardSize: 210, statusBar: true, clock: true, home: 'stories', storiesSort: 'chrono', timelineView: 'scale' },
      ...clone(p.layout),
      sectionsByMode: { ishimura: defaultSections('ishimura'), warhammer: defaultSections('warhammer'), free: defaultSections('free') },
      libraryView: 'tiles', librarySort: 'added',
    },
    reader: { mode: 'scroll', fontSize: 19, lineHeight: 1.75, width: 720, align: 'left', indent: true, paraSpacing: 0.7, font: null, paper: 'theme', stampStyle: 'terminal', focus: 'off', immersive: true, autoSpeed: 40 },
    anim: { view: 'fade', cards: 'rise', page: 'flip', smoothScroll: true, themeReveal: true },
    texts: { brand: '', name: '', greeting: '', sections: {} },
    applyLayout: false,
    presetAutosave: true,
    sound: { ui: true, uiVolume: 0.35, boot: true },
    system: { closeToTray: true, autostart: true, notifications: true, pollMinutes: 10 },
    customFonts: [],
  };
}

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] ? merge(base[k], v) : v;
  }
  return out;
}

const bus = new EventTarget();
export const on = (type, fn) => { const l = (e) => fn(e.detail); bus.addEventListener(type, l); return () => bus.removeEventListener(type, l); };
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

export const state = {
  settings: defaultSettings(),
  reader: { progress: {}, bookmarks: [], quotes: [], last: null },
  presets: { themes: [], modules: { colors: [], fonts: [], effects: [], background: [], reader: [] } },
  manifest: null,
  status: null,
  info: null,
  author: { enabled: false },
  library: { books: [], audio: [] },
  libInfo: { baseUrl: '' },
  downloads: [],
};

const saveSettings = debounce(() => window.ark.store.set('settings', state.settings), 400);
const saveReader = debounce(() => window.ark.store.set('reader', state.reader), 600);
const savePresets = debounce(() => window.ark.store.set('presets', state.presets), 300);

export async function loadState() {
  const [library, libInfo] = await Promise.all([window.ark.library.list(), window.ark.library.info()]);
  state.library = library;
  state.libInfo = libInfo;
  const [settings, reader, presets, oldThemes, manifest, status, info, author] = await Promise.all([
    window.ark.store.get('settings'),
    window.ark.store.get('reader'),
    window.ark.store.get('presets'),
    window.ark.store.get('themes'),
    window.ark.content.manifest(),
    window.ark.content.status(),
    window.ark.app.info(),
    window.ark.author.status(),
  ]);
  if (settings) {
    state.settings = merge(defaultSettings(settings.preset || 'terminal'), settings);
    state.settings.theme = normalizeTheme(state.settings.theme);
    if (!settings.activeTheme) state.settings.activeTheme = `builtin:${settings.preset || 'terminal'}`;
    // Перенос раскладки разделов из версий 1.x (один список на всё приложение)
    const byMode = state.settings.layout.sectionsByMode;
    if (Array.isArray(settings.layout && settings.layout.sections) && !(settings.layout.sectionsByMode && settings.layout.sectionsByMode.ishimura)) {
      byMode.ishimura = settings.layout.sections;
    }
    delete state.settings.layout.sections;
    for (const mode of Object.keys(MODES)) {
      const list = (byMode[mode] || []).filter((s) => SECTIONS.some((x) => x.id === s.id));
      const ids = new Set(list.map((s) => s.id));
      for (const s of SECTIONS) if (!ids.has(s.id)) list.push({ id: s.id, visible: s.modes.includes(mode) });
      byMode[mode] = list;
    }
    if (!MODES[state.settings.mode]) state.settings.mode = 'ishimura';
  }
  if (reader) state.reader = { ...state.reader, ...reader };
  if (presets) {
    state.presets = merge(state.presets, presets);
  } else if (Array.isArray(oldThemes) && oldThemes.length) {
    // Перенос тем, сохранённых в версии 1.0
    state.presets.themes = oldThemes.map((t) => ({ id: t.id || crypto.randomUUID(), name: t.name, about: '', theme: normalizeTheme(t.theme), layout: t.layout || null }));
    savePresets();
  }
  state.manifest = manifest;
  state.status = status;
  state.info = info;
  state.author = author;
  bindDownloads();
  applySettings();
}

// Статусы загрузок из встроенного браузера (главный процесс шлёт downloads:update)
let downloadsBound = false;
function bindDownloads() {
  if (downloadsBound) return;
  downloadsBound = true;
  window.ark.downloads.onUpdate((d) => {
    const i = state.downloads.findIndex((x) => x.id === d.id);
    if (i >= 0) state.downloads[i] = { ...state.downloads[i], ...d };
    else state.downloads.push(d);
    emit('downloads');
  });
}

export function applySettings() {
  applyAppearance(state.settings);
  configureSound(state.settings.sound, state.settings.theme.sound);
}

// ---------- Плавные переходы ----------
let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);

// Применение изменения внешнего вида с «проявлением» новой темы кругом от точки клика
export function withReveal(fn) {
  const root = document.documentElement;
  if (!document.startViewTransition || !state.settings.anim.themeReveal || !state.settings.theme.effects.animations) { fn(); return; }
  const r = Math.hypot(Math.max(lastPointer.x, innerWidth - lastPointer.x), Math.max(lastPointer.y, innerHeight - lastPointer.y));
  root.style.setProperty('--vt-x', `${lastPointer.x}px`);
  root.style.setProperty('--vt-y', `${lastPointer.y}px`);
  root.style.setProperty('--vt-r', `${r}px`);
  root.dataset.vt = 'theme';
  const t = document.startViewTransition(fn);
  t.finished.finally(() => { delete root.dataset.vt; });
}

// ---------- Настройки ----------
export function setSetting(path, value, { silent } = {}) {
  const keys = path.split('.');
  let o = state.settings;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = value;
  applySettings();
  saveSettings();
  if (path.startsWith('theme')) autosaveTheme();
  if (!silent) emit('settings', path);
}

// Изменения внешнего вида сразу записываются в активную пользовательскую тему
const autosaveTheme = debounce(() => {
  if (state.settings.presetAutosave === false) return;
  if (!String(state.settings.activeTheme).startsWith('user:')) return;
  saveCurrentToActive();
}, 500);

export function getSetting(path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state.settings);
}

export function replaceSettings(next, { reveal = false, after } = {}) {
  // Перерисовка подписчиков происходит внутри перехода — так новое состояние попадает в «снимок»
  const apply = () => { state.settings = next; applySettings(); saveSettings(); autosaveTheme(); emit('settings', '*'); if (after) after(); };
  if (reveal) withReveal(apply); else apply();
}

// ---------- Режимы ----------
export const mode = () => state.settings.mode || 'ishimura';
export const sectionsOf = (m = mode()) => state.settings.layout.sectionsByMode[m] || defaultSections(m);
export const librarySpace = () => (mode() === 'warhammer' ? 'warhammer' : 'free');

export function switchMode(next) {
  if (!MODES[next] || next === mode()) return;
  const s = clone(state.settings);
  s.modes ||= {};
  s.modes[s.mode] = { theme: s.theme, activeTheme: s.activeTheme };
  const saved = s.modes[next];
  if (saved && saved.theme) {
    s.theme = normalizeTheme(saved.theme);
    s.activeTheme = saved.activeTheme;
  } else {
    const t = themeById(MODES[next].theme);
    s.theme = normalizeTheme(clone(t.theme));
    s.activeTheme = t.id;
  }
  s.mode = next;
  // Событие режима — только после того, как новые настройки реально применены
  replaceSettings(s, { reveal: true, after: () => emit('mode', next) });
}

// ---------- Темы (встроенные и пользовательские) ----------
export function allThemes() {
  return [
    ...Object.entries(PRESETS).map(([id, p]) => ({ id: `builtin:${id}`, builtin: true, name: p.name, about: p.about, theme: p.theme, layout: p.layout, stripe: p.stripe })),
    ...state.presets.themes.map((t) => ({ ...t, id: `user:${t.id}`, builtin: false })),
  ];
}

export function themeById(id) {
  return allThemes().find((t) => t.id === id) || null;
}

export function activeTheme() {
  return themeById(state.settings.activeTheme);
}

export function themeDirty() {
  const t = activeTheme();
  if (!t) return true;
  return JSON.stringify(normalizeTheme(t.theme)) !== JSON.stringify(normalizeTheme(state.settings.theme));
}

export function applyTheme(id, { withLayout = false } = {}) {
  const t = themeById(id);
  if (!t) return;
  const s = clone(state.settings);
  s.theme = normalizeTheme(clone(t.theme));
  s.activeTheme = id;
  if (t.builtin) s.preset = id.slice(8);
  if (withLayout && t.layout) Object.assign(s.layout, clone(t.layout));
  replaceSettings(s, { reveal: true });
}

// Совместимость со старым вызовом
export function applyPreset(id, opts) {
  applyTheme(`builtin:${id}`, opts);
}

export function createTheme({ name, about = '', from = null, withLayout = true }) {
  const src = from ? themeById(from) : null;
  const t = {
    id: crypto.randomUUID().slice(0, 12),
    name,
    about,
    theme: normalizeTheme(clone(src ? src.theme : state.settings.theme)),
    layout: withLayout ? clone(src && src.layout ? src.layout : pickLayout(state.settings.layout)) : null,
    created: new Date().toISOString(),
  };
  state.presets.themes.push(t);
  savePresets();
  emit('presets');
  return `user:${t.id}`;
}

function pickLayout(l) {
  const { nav, navStyle, navWidth, density, storiesView, cardSize } = l;
  return { nav, navStyle, navWidth, density, storiesView, cardSize };
}

export function updateUserTheme(id, patch) {
  const t = state.presets.themes.find((x) => `user:${x.id}` === id);
  if (!t) return;
  Object.assign(t, patch);
  savePresets();
  emit('presets');
}

export function saveCurrentToActive() {
  const id = state.settings.activeTheme;
  if (!id.startsWith('user:')) return false;
  updateUserTheme(id, { theme: normalizeTheme(clone(state.settings.theme)), layout: pickLayout(state.settings.layout) });
  return true;
}

export function deleteTheme(id) {
  state.presets.themes = state.presets.themes.filter((x) => `user:${x.id}` !== id);
  if (state.settings.activeTheme === id) { state.settings.activeTheme = `builtin:${state.settings.preset || 'terminal'}`; saveSettings(); }
  savePresets();
  emit('presets');
}

export function importTheme(obj) {
  if (!obj || !obj.theme || !obj.theme.colors) throw new Error('файл не похож на тему архива');
  const t = { id: crypto.randomUUID().slice(0, 12), name: obj.name || 'Импортированная тема', about: obj.about || '', theme: normalizeTheme(obj.theme), layout: obj.layout || null, created: new Date().toISOString() };
  state.presets.themes.push(t);
  savePresets();
  emit('presets');
  return `user:${t.id}`;
}

// ---------- Модульные пресеты ----------
export function modulePresets(mod) {
  return [...builtinModulePresets(mod), ...(state.presets.modules[mod] || []).map((p) => ({ ...p, builtin: false }))];
}

export function applyModule(mod, preset) {
  if (!MODULES[mod]) return;
  const s = clone(state.settings);
  if (mod === 'reader') for (const k of READER_KEYS) { if (k in preset.data) s.reader[k] = preset.data[k]; }
  else s.theme[mod] = { ...s.theme[mod], ...clone(preset.data) };
  replaceSettings(s, { reveal: mod !== 'reader' });
}

export function saveModulePreset(mod, name, data) {
  state.presets.modules[mod] ||= [];
  state.presets.modules[mod].push({ id: crypto.randomUUID().slice(0, 12), name, data: clone(data) });
  savePresets();
  emit('presets');
}

export function deleteModulePreset(mod, id) {
  state.presets.modules[mod] = (state.presets.modules[mod] || []).filter((p) => p.id !== id);
  savePresets();
  emit('presets');
}

// ---------- Тексты интерфейса ----------
export function sectionTitle(id) {
  const custom = mode() === 'ishimura' && (state.settings.texts.sections || {})[id];
  return custom && custom.trim() ? custom.trim() : (SECTIONS.find((s) => s.id === id) || {}).title || id;
}

// Заголовок раздела с выделением последней буквы/слова, как в оформлении по умолчанию
export function headingHtml(text, esc) {
  const t = esc(text);
  const words = t.split(' ');
  if (words.length > 1) return `${words.slice(0, -1).join(' ')} <em>${words.at(-1)}</em>`;
  return `${t.slice(0, -1)}<em>${t.slice(-1)}</em>`;
}

// ---------- Термины архива ({{unifier}}, {{unifier.gen}}) ----------
export function term(text) {
  const terms = (state.manifest && state.manifest.terms) || {};
  return String(text || '').replace(/\{\{\s*([\w-]+)(?:\.(\w+))?\s*\}\}/g, (m, key, form) => {
    const t = terms[key];
    if (!t) return m;
    if (typeof t === 'string') return t;
    return t[form || 'nom'] || t.nom || m;
  });
}

// ---------- Прогресс чтения ----------
export function getProgress(id) {
  return state.reader.progress[id] || null;
}

export function setProgress(id, data) {
  const prev = state.reader.progress[id] || {};
  state.reader.progress[id] = { ...prev, ...data, at: new Date().toISOString(), done: prev.done || data.frac > 0.97 };
  state.reader.last = id;
  saveReader();
}

export function addBookmark(b) {
  state.reader.bookmarks.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...b });
  saveReader();
  emit('marks');
}

export function addQuote(q) {
  state.reader.quotes.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), ...q });
  saveReader();
  emit('marks');
}

export function removeMark(kind, id) {
  state.reader[kind] = state.reader[kind].filter((x) => x.id !== id);
  saveReader();
  emit('marks');
}

// ---------- Манифест ----------
export const contentUrl = (rel) => (rel ? state.info.contentUrl + rel.split('/').map(encodeURIComponent).join('/') : '');

export function stories() {
  return [...(state.manifest.stories || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function storyById(id) {
  return (state.manifest.stories || []).find((s) => s.id === id);
}

export function seriesById(id) {
  return (state.manifest.series || []).find((s) => s.id === id);
}

export function readingOrder() {
  const list = stories();
  return list.sort((a, b) => {
    if (a.series && a.series === b.series) return (a.chapter ?? 0) - (b.chapter ?? 0);
    return (a.order ?? 0) - (b.order ?? 0);
  });
}

// ---------- Библиотека ----------
export const libUrl = (rel) => (rel ? state.libInfo.baseUrl + rel : '');
export const libBooks = () => (state.library.books || []).filter((b) => mode() === 'free' || b.space === librarySpace());
export const libAudio = () => (state.library.audio || []).filter((b) => mode() === 'free' || b.space === librarySpace());
export const libBook = (id) => (state.library.books || []).find((b) => b.id === id);
export const libAudioById = (id) => (state.library.audio || []).find((b) => b.id === id);

export function isUnseen(kind, id) {
  return !!(state.status && state.status.unseen && (state.status.unseen[kind] || []).includes(id));
}
