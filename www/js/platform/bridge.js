// window.ark для телефона: тот же API, что preload.js в ПК-версии, но без Electron.
// Интерфейс (js/app.js и разделы) не знает, где он запущен, — всё различие спрятано здесь.
import { isNative, Ark, APP_VERSION, platform } from './env.js';
import { vfs, vfsDevMode } from './vfs.js';
import { Emitter } from './emitter.js';
import { ContentService } from './content.js';
import { LibraryService } from './library.js';
import { WriterService } from './writer.js';
import { pickFiles, pickFolder, saveFile, readPickedText } from './files.js';
import { CapacitorHttp, App } from '../../vendor/capacitor.js';

const bus = new Emitter();
const on = (ch) => (fn) => bus.on(ch, fn);

const content = new ContentService();
const library = new LibraryService();
const writer = new WriterService();
content.on('status', (s) => bus.emit('content:status', s));
content.on('updated', (p) => bus.emit('content:updated', p));
library.on('changed', (idx) => bus.emit('library:changed', idx));

// ---------- Настройки (JSON в vfs, как store.js на ПК) ----------
const STORES = new Set(['settings', 'reader', 'themes', 'presets']);
let settingsCache = null;
const store = {
  async get(name) {
    if (!STORES.has(name)) throw new Error(`Неизвестное хранилище: ${name}`);
    const v = await vfs.readJson(`store/${name}.json`);
    if (name === 'settings') settingsCache = v;
    return v;
  },
  async set(name, data) {
    if (!STORES.has(name)) throw new Error(`Неизвестное хранилище: ${name}`);
    if (name === 'settings') { settingsCache = data; schedulePolling(); }
    await vfs.writeJson(`store/${name}.json`, data);
  },
};
const currentMode = () => (settingsCache && settingsCache.mode) || 'ishimura';
const currentSpace = () => (currentMode() === 'warhammer' ? 'warhammer' : 'free');

// Проверка новых рассказов, пока приложение открыто
let pollTimer = null;
function schedulePolling() {
  clearInterval(pollTimer);
  const minutes = Math.max(2, Number(settingsCache && settingsCache.system && settingsCache.system.pollMinutes) || 10);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') content.sync(); }, minutes * 60 * 1000);
}
document.addEventListener('visibilitychange', () => {
  // Вернулись в приложение после перерыва — сразу сверяемся с архивом
  if (document.visibilityState === 'visible' && content.state && Date.now() - new Date(content.state.lastSync || 0).getTime() > 5 * 60 * 1000) content.sync();
});

// ---------- Импорт в библиотеку ----------
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

async function importSources(sources, space, source = 'file') {
  await library.ready;
  const added = [], errors = [];
  const audio = sources.filter((s) => library.isAudio(s.name || s.path || ''));
  for (const s of sources) {
    if (audio.includes(s)) continue;
    try {
      const res = await library.importIncoming(s, space, { source });
      if (res) added.push(...res); else errors.push(`${s.name}: ни книг, ни аудио внутри`);
    } catch (e) { errors.push(`${s.name}: ${e.message}`); }
  }
  if (audio.length) {
    try {
      const id = newId();
      // С сайта файлы ещё не в хранилище — library.importAudio сама их туда положит;
      // на Android переносим выбранное из «входящих» в папку аудиокниги
      const files = [];
      for (const s of audio) {
        if (!s.path) { files.push(s); continue; }
        const dest = `library/audio/${id}/${s.name.replace(/[\\/:*?"<>|]/g, '_')}`;
        await vfs.move(s.path, dest);
        files.push({ path: dest, name: s.name });
      }
      added.push({ kind: 'audio', rec: await library.importAudio(files, space, { id }) });
    } catch (e) { errors.push(e.message); }
  }
  return { added, errors };
}

async function pickToLibrary({ kind, space }) {
  if (kind === 'audioFolder' || kind === 'audioFiles') {
    const id = newId();
    const dest = `library/audio/${id}`;
    const files = kind === 'audioFolder' ? await pickFolder({ dest }) : await pickFiles({ kind: 'audio', multiple: true, dest });
    if (!files.length) return { added: [], errors: [] };
    try {
      await library.ready;
      const rec = await library.importAudio(files, space, { id, folder: files[0].folder });
      return { added: [{ kind: 'audio', rec }], errors: [] };
    } catch (e) {
      vfs.removeDir(dest);
      return { added: [], errors: [e.message] };
    }
  }
  const files = await pickFiles({ kind: 'books', multiple: true, dest: `library/incoming/p-${newId()}` });
  if (!files.length) return { added: [], errors: [] };
  return importSources(files, space, 'file');
}

// ---------- Загрузки встроенного браузера (Android) и файлы «Открыть в…» ----------
let dlSeq = 0;
const nativeDl = new Map();
async function handleIncoming({ path, name, id, source = 'browser' }) {
  const dlId = id || `in-${++dlSeq}`;
  const report = (extra) => bus.emit('downloads:update', { id: dlId, name, ...extra });
  report({ state: 'extracting' });
  try {
    const res = await library.importIncoming({ path, name }, currentSpace(), { source });
    if (!res) return report({ state: 'error', error: 'ни книг, ни аудио внутри' });
    const first = res[0];
    report({ state: 'imported', kind: first.kind, title: res.length > 1 ? `${first.rec.title} (+${res.length - 1})` : first.rec.title, recId: first.rec.id });
  } catch (e) {
    report({ state: 'error', error: e.message });
  }
}

if (isNative) {
  Ark.addListener('download', (d) => {
    // d: { id, name, state: progressing|completed|saved|error|cancelled, received, total, path, error }
    if (d.state === 'completed') {
      nativeDl.delete(d.id);
      handleIncoming({ path: d.path, name: d.name, id: d.id, source: 'browser' });
    } else if (d.state === 'saved') {
      bus.emit('downloads:update', { id: d.id, name: d.name, state: 'archive', path: null });
    } else {
      nativeDl.set(d.id, d);
      bus.emit('downloads:update', { id: d.id, name: d.name, received: d.received, total: d.total, state: d.state, error: d.error });
    }
  });
  Ark.addListener('incoming', (f) => handleIncoming({ path: f.path, name: f.name, source: 'file' }));
  // Файлы, открытые через «Открыть в…» до запуска интерфейса
  library.ready.then(async () => {
    try {
      const r = await Ark.takeIncoming();
      for (const f of (r && r.files) || []) handleIncoming({ path: f.path, name: f.name, source: 'file' });
    } catch {}
  });
}

// ---------- Полноэкранный режим ----------
let fullscreen = false;
async function setFullscreen(v) {
  fullscreen = v === undefined ? !fullscreen : !!v;
  if (isNative) { try { await Ark.setImmersive({ on: fullscreen }); } catch {} }
  else if (fullscreen && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  else if (!fullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  bus.emit('win:state', { fullscreen });
}

function openExternal(url) {
  if (!/^https?:\/\//.test(url)) return;
  if (isNative) Ark.openExternal({ url });
  else window.open(url, '_blank', 'noopener');
}

const unavailable = () => { throw new Error('Недоступно в мобильной версии'); };

// Сайт: файлы из хранилища раздаёт сервис-воркер — ждём, пока он возьмёт страницу под контроль
async function serviceWorkerReady() {
  if (isNative || vfsDevMode || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 8000);
    });
  } catch (e) { console.warn('Сервис-воркер не запустился', e); }
}
const ready = Promise.all([serviceWorkerReady(), content.ready, library.ready]);

window.ark = {
  mobile: true,
  platform,
  win: {
    minimize: async () => { if (isNative) App.minimizeApp(); },
    maximize: async () => {},
    close: async () => { if (isNative) App.minimizeApp(); },
    fullscreen: setFullscreen,
    state: async () => ({ maximized: false, fullscreen }),
    onState: on('win:state'),
  },
  app: {
    info: async () => { await ready; return { version: APP_VERSION, packaged: true, mobile: true, platform, contentUrl: content.dirUrl, userData: '' }; },
    quit: async () => { if (isNative) App.exitApp(); },
    openExternal: async (url) => openExternal(url),
    onNavigate: on('nav:open'),
    // Системная кнопка «Назад» Android
    onBack: (fn) => { if (isNative) App.addListener('backButton', () => fn()); },
  },
  store,
  content: {
    manifest: async () => { await content.ready; return content.manifest; },
    status: async () => { await content.ready; return content.status(); },
    sync: () => content.sync(),
    read: async (rel) => { await content.ready; return content.readText(rel); },
    seen: async (kind, ids) => { await content.ready; return content.markSeen(kind, ids); },
    onUpdated: on('content:updated'),
    onStatus: on('content:status'),
  },
  user: {
    // Свои шрифты, фоны, звуки, курсоры
    pick: async (kind) => {
      const files = await pickFiles({ kind, dest: `user/${kind}/tmp` });
      if (!files.length) return null;
      const f = files[0];
      const dest = `user/${kind}/${Date.now()}-${f.name.replace(/[\\/:*?"<>|]/g, '_')}`;
      if (f.file) await vfs.write(dest, f.file); else await vfs.move(f.path, dest);
      return { url: vfs.url(dest), name: f.name };
    },
    exportTheme: async (name, json) => !!(await saveFile(json, `${name.replace(/[\\/:*?"<>|]/g, '_')}.ishimura-theme.json`, 'application/json')),
    importTheme: async () => {
      const files = await pickFiles({ kind: 'json', dest: 'tmp/theme' });
      if (!files.length) return null;
      const text = await readPickedText(files[0]);
      if (files[0].path) vfs.remove(files[0].path);
      return text;
    },
  },
  sys: { autostart: async () => false },
  update: {
    status: async () => ({ status: 'idle' }),
    check: async () => null,
    install: async () => {},
    onStatus: on('update:status'),
  },
  library: {
    list: async () => { await library.ready; return library.index; },
    info: async () => library.info(),
    pick: (opts) => pickToLibrary(opts),
    // Перетаскивание файлов (только сайт): вместо путей приходят сами File
    importPaths: (files, space) => importSources(files.map((f) => ({ file: f, name: f.name })), space, 'file'),
    pathOf: (file) => file,
    content: async (id) => { await library.ready; return library.content(id); },
    epubFile: async (id, rel) => { await library.ready; return library.readEpubFile(id, rel); },
    update: async (kind, id, patch) => { await library.ready; return library.update(kind, id, patch); },
    setCover: async (kind, id, dataUrl) => { await library.ready; return library.setCover(kind, id, dataUrl); },
    pickCover: async (kind, id) => {
      const files = await pickFiles({ kind: 'image', dest: 'library/incoming/cover' });
      if (!files.length) return null;
      const r = await library.setCoverFromSource(kind, id, files[0]);
      if (files[0].path) vfs.remove(files[0].path);
      return r;
    },
    remove: async (kind, id) => { await library.ready; return library.remove(kind, id); },
    // На телефоне «Показать файл» = сохранить копию книги в «Загрузки» / «Файлы»
    showFile: async (kind, id) => {
      if (kind !== 'book') return;
      const b = library.book(id);
      const bytes = await vfs.readBytes(library.bookFile(id));
      const name = `${(b.title || 'book').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)}.${b.format}`;
      return saveFile(bytes, name);
    },
    download: async (url, space, meta) => { await library.ready; return library.download(url, space, meta); },
    onChanged: on('library:changed'),
  },
  downloads: {
    onUpdate: on('downloads:update'),
    open: async () => {},
  },
  net: {
    // Текст по http(s) для OPDS-каталогов. На Android запрос идёт из нативного кода — без ограничений CORS
    fetchText: async (url) => {
      if (!/^https?:\/\//i.test(url)) throw new Error('Нужен адрес http(s)');
      const headers = { Accept: 'application/atom+xml, application/xml, text/xml, */*' };
      if (isNative) {
        try {
          const r = await CapacitorHttp.get({ url, headers, responseType: 'text', connectTimeout: 30000, readTimeout: 30000 });
          const ct = Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
          return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || url, contentType: ct ? ct[1] : '', text: typeof r.data === 'string' ? r.data : JSON.stringify(r.data) };
        } catch (e) {
          throw new Error(/timeout/i.test(String(e.message)) ? 'Каталог не ответил за 30 секунд, попробуйте позже' : 'Нет связи с каталогом');
        }
      }
      let res;
      try {
        res = await fetch(url, { headers, signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined });
      } catch (e) {
        throw new Error(e && e.name === 'TimeoutError' ? 'Каталог не ответил за 30 секунд, попробуйте позже' : 'Каталог не пускает веб-версию (ограничение браузера). На Android-версии он будет работать');
      }
      return { ok: res.ok, status: res.status, url: res.url || url, contentType: res.headers.get('content-type') || '', text: await res.text() };
    },
  },
  writer: {
    list: () => writer.list(),
    get: (id) => writer.get(id),
    save: (book) => writer.save(book),
    remove: (id) => writer.remove(id),
    exportFile: async (format, data, name) => {
      const buf = await writer.build(format, data);
      const mime = { fb2: 'application/x-fictionbook+xml', epub: 'application/epub+zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[format];
      return saveFile(buf, `${String(name || 'Книга').replace(/[\\/:*?"<>|]/g, '_')}.${format}`, mime);
    },
    toLibrary: async (data, name) => {
      const buf = await writer.build('epub', data);
      await library.ready;
      return library.importBookBuffer(buf, `${name || 'Книга'}.epub`, 'free', { source: 'writer' });
    },
  },
  author: {
    status: async () => ({ enabled: false }),
    setToken: unavailable, clearToken: async () => {}, pick: unavailable, importDocx: unavailable, publish: unavailable,
  },
};

// Первая сверка с архивом после старта
setTimeout(() => content.sync(), 1500);
schedulePolling();
