// Локальная библиотека: книги (fb2, epub, pdf, txt, docx, html, rtf) и аудиокниги.
// Перенос main/library.js из ПК-версии. Файлы лежат в vfs: library/books/<id>/…, library/audio/<id>/…, library/covers/…
import { vfs, toBytes } from './vfs.js';
import { isNative, Ark } from './env.js';
import { Emitter } from './emitter.js';
import JSZip from '../../vendor/jszip.js';

export const BOOK_EXT = ['fb2', 'epub', 'pdf', 'txt', 'docx', 'html', 'htm', 'rtf'];
export const AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'ogg', 'opus', 'flac', 'wav', 'aac'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];
const ARCHIVE_EXT = ['7z', 'rar'];
const MAIN_BOOK_PRIORITY = ['fb2', 'epub', 'pdf', 'docx'];
const WEAK_BOOK_EXT = ['txt', 'rtf', 'html', 'htm'];

const ROOT = 'library';
const INDEX = `${ROOT}/library.json`;

export const ext = (p) => ((String(p).split('?')[0].match(/\.([^./]+)$/) || [])[1] || '').toLowerCase();
const basename = (p) => String(p).split('/').pop();
const dirname = (p) => String(p).split('/').slice(0, -1).join('/');
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const natural = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' }).compare;
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim() || 'file';

export function decodeBuffer(buf, hint) {
  buf = toBytes(buf);
  const dec = (label, b) => { try { return new TextDecoder(label).decode(b); } catch { return null; } };
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return dec('utf-8', buf.subarray(3));
  if (buf[0] === 0xff && buf[1] === 0xfe) return dec('utf-16le', buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return dec('utf-16be', buf.subarray(2));
  const head = dec('latin1', buf.subarray(0, 1024)) || '';
  const m = head.match(/encoding=["']([\w-]+)["']/i) || head.match(/charset=["']?([\w-]+)/i) || (hint ? [null, hint] : null);
  if (m && !/utf-?8/i.test(m[1])) { const r = dec(m[1].toLowerCase(), buf); if (r != null) return r; }
  const utf = dec('utf-8', buf);
  // Нет объявления и UTF-8 «ломается» — почти наверняка windows-1251
  if (!m && (utf.match(/�/g) || []).length > 3) return dec('windows-1251', buf);
  return utf;
}

async function sha1(bytes) {
  try {
    const d = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Без защищённого контекста — простой хэш по размеру и краям файла
    let h = 2166136261;
    const step = Math.max(1, Math.floor(bytes.length / 65536));
    for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    return `${bytes.length.toString(16)}-${(h >>> 0).toString(16)}`;
  }
}

// Первые байты файла — для тегов аудио (не грузим в память весь файл)
async function headBytes(src, n = 768 * 1024) {
  if (src.file) return new Uint8Array(await src.file.slice(0, n).arrayBuffer());
  if (!isNative) return new Uint8Array(await (await vfs.readBlob(src.path)).slice(0, n).arrayBuffer());
  const res = await fetch(vfs.url(src.path));
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  while (got < n) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(got, n));
  let o = 0;
  for (const p of parts) { const take = Math.min(p.length, out.length - o); out.set(p.subarray(0, take), o); o += take; if (o >= out.length) break; }
  return out;
}

let mm = null;
async function audioTags(src) {
  try {
    mm ||= await import('../../vendor/music-metadata.js');
    const bytes = await headBytes(src);
    const md = await mm.parseBuffer(bytes, { mimeType: undefined, path: src.name }, { duration: false, skipPostHeaders: true, skipCovers: false });
    return md.common || {};
  } catch { return {}; }
}

let sevenZip = null;

export class LibraryService extends Emitter {
  constructor() {
    super();
    this.index = { books: [], audio: [] };
    this.ready = this.init();
    this.saveT = null;
  }

  async init() {
    const idx = await vfs.readJson(INDEX);
    if (idx) this.index = idx;
    this.index.books ||= [];
    this.index.audio ||= [];
    this.refreshUrls();
  }

  // Ссылки на дорожки зависят от устройства — пересчитываем при каждом запуске
  refreshUrls() {
    for (const a of this.index.audio) for (const t of a.tracks || []) if (t.file) t.url = vfs.url(`${ROOT}/${t.file}`);
  }

  save() {
    clearTimeout(this.saveT);
    this.saveT = setTimeout(() => vfs.writeJson(INDEX, this.index), 200);
  }

  changed() {
    this.save();
    this.emit('changed', this.index);
  }

  get root() { return ROOT; }
  info() { return { baseUrl: vfs.url(`${ROOT}/`) }; }
  rel(p) { return `${ROOT}/${p}`; }

  book(id) {
    const b = this.index.books.find((x) => x.id === id);
    if (!b) throw new Error('Книга не найдена в библиотеке');
    return b;
  }

  isBook(p) { return BOOK_EXT.includes(ext(p)) || /\.fb2\.zip$/i.test(p) || ext(p) === 'zip'; }
  isAudio(p) { return AUDIO_EXT.includes(ext(p)); }
  isArchive(p) { return ARCHIVE_EXT.includes(ext(p)); }
  isImage(p) { return IMAGE_EXT.includes(ext(p)); }

  // ---------- Книги ----------
  async importBookBuffer(buf, name, space, meta = {}) {
    buf = toBytes(buf);
    let format = ext(name);
    if (format === 'zip') {
      const zip = await JSZip.loadAsync(buf);
      const inner = Object.values(zip.files).find((f) => !f.dir && /\.(fb2|epub)$/i.test(f.name));
      if (!inner) return null;
      buf = await inner.async('uint8array');
      name = basename(inner.name);
      format = ext(name);
    }
    if (format === 'htm') format = 'html';
    if (!BOOK_EXT.includes(format)) return null;
    const hash = await sha1(buf);
    const dup = this.index.books.find((b) => b.hash === hash);
    if (dup) return { ...dup, duplicate: true };

    const id = newId();
    const file = `books/${id}/book.${format}`;
    await vfs.write(this.rel(file), buf);
    if (format === 'epub') await this.unpackEpub(buf, this.rel(`books/${id}/x`));

    const rec = {
      id, space, format, hash, file,
      name, size: buf.length,
      title: meta.title || name.replace(/(\.fb2)?\.[^.]+$/i, '').replace(/[_]+/g, ' '),
      authors: meta.authors || [], series: meta.series || '', seriesNum: meta.seriesNum || null,
      annotation: meta.annotation || '', genres: meta.genres || [], tags: meta.tags || [], lang: meta.lang || '', year: meta.year || '',
      cover: null, source: meta.source || null,
      added: new Date().toISOString(), needsMeta: true,
    };
    this.index.books.unshift(rec);
    if (meta.coverUrl) await this.fetchCover(id, meta.coverUrl).catch(() => {});
    this.changed();
    return rec;
  }

  async unpackEpub(buf, out) {
    const zip = await JSZip.loadAsync(buf);
    for (const f of Object.values(zip.files)) {
      if (f.dir) continue;
      const name = f.name.split('/').filter((p) => p && p !== '..' && p !== '.').join('/');
      if (!name) continue;
      await vfs.write(`${out}/${name}`, await f.async('uint8array'));
    }
  }

  async content(id) {
    const b = this.book(id);
    const path = this.rel(b.file);
    if (['fb2', 'txt', 'html', 'rtf'].includes(b.format)) {
      const buf = await vfs.readBytes(path);
      return { format: b.format, text: b.format === 'rtf' ? new TextDecoder('latin1').decode(buf) : decodeBuffer(buf) };
    }
    if (b.format === 'docx') {
      const { default: mammoth } = await import('../../vendor/mammoth.js');
      const buf = await vfs.readBytes(path);
      const r = await mammoth.convertToHtml({ arrayBuffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
      return { format: 'docx', html: r.value };
    }
    if (b.format === 'epub') return { format: 'epub', base: vfs.url(this.rel(`books/${id}/x/`)) };
    return { format: b.format, url: vfs.url(path) };
  }

  async readEpubFile(id, rel) {
    this.book(id);
    const clean = decodeURIComponent(rel).split('/').filter((p) => p && p !== '.');
    if (clean.includes('..')) throw new Error('Недопустимый путь');
    return decodeBuffer(await vfs.readBytes(this.rel(`books/${id}/x/${clean.join('/')}`)));
  }

  update(kind, id, patch) {
    const list = kind === 'audio' ? this.index.audio : this.index.books;
    const it = list.find((x) => x.id === id);
    if (!it) return null;
    Object.assign(it, patch);
    if (kind === 'audio') this.refreshUrls();
    this.changed();
    return it;
  }

  async setCover(kind, id, dataUrl) {
    const m = String(dataUrl).match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return null;
    const e = m[1] === 'jpeg' ? 'jpg' : m[1];
    const rel = `covers/${id}.${e}`;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await vfs.write(this.rel(rel), bytes);
    return this.update(kind, id, { cover: `${rel}?v=${Date.now()}` });
  }

  // src: { path } (файл в vfs) или { file } (File из выбора файлов на сайте)
  async setCoverFromSource(kind, id, src) {
    const e = ext(src.name || src.path || '') === 'jpeg' ? 'jpg' : (ext(src.name || src.path || '') || 'jpg');
    const rel = `covers/${id}.${e}`;
    const bytes = src.file ? new Uint8Array(await src.file.arrayBuffer()) : await vfs.readBytes(src.path);
    await vfs.write(this.rel(rel), bytes);
    return this.update(kind, id, { cover: `${rel}?v=${Date.now()}` });
  }

  async fetchCover(id, url) {
    let bytes, type = '';
    if (isNative) {
      const r = await Ark.download({ url, dest: this.rel('incoming') });
      bytes = await vfs.readBytes(r.path);
      type = r.mime || '';
      vfs.remove(r.path);
    } else {
      const res = await fetch(url);
      if (!res.ok) return;
      type = res.headers.get('content-type') || '';
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const e = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
    const rel = `covers/${id}.${e}`;
    await vfs.write(this.rel(rel), bytes);
    const b = this.index.books.find((x) => x.id === id);
    if (b) b.cover = `${rel}?v=${Date.now()}`;
  }

  async remove(kind, id) {
    if (kind === 'audio') {
      await vfs.removeDir(this.rel(`audio/${id}`));
      this.index.audio = this.index.audio.filter((x) => x.id !== id);
    } else {
      await vfs.removeDir(this.rel(`books/${id}`));
      this.index.books = this.index.books.filter((x) => x.id !== id);
    }
    for (const e of IMAGE_EXT) vfs.remove(this.rel(`covers/${id}.${e}`));
    this.changed();
  }

  bookFile(id) { return this.rel(this.book(id).file); }

  // Загрузка книги по ссылке (OPDS-каталоги)
  async download(url, space, meta = {}) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Можно скачивать только по http(s)');
    let buf, name, type = '';
    if (isNative) {
      const r = await Ark.download({ url, dest: this.rel('incoming') });
      buf = await vfs.readBytes(r.path);
      name = r.name;
      type = r.mime || '';
      vfs.remove(r.path);
    } else {
      let res;
      try { res = await fetch(url); } catch { throw new Error('Сайт каталога не разрешает скачивание из веб-версии. Скачайте файл в Safari и добавьте его кнопкой «Добавить книги»'); }
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      buf = new Uint8Array(await res.arrayBuffer());
      const cd = res.headers.get('content-disposition') || '';
      type = res.headers.get('content-type') || '';
      name = (cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1];
      name = name ? decodeURIComponent(name) : (cd.match(/filename="?([^";]+)"?/i) || [])[1];
      if (!name) name = decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || 'book');
    }
    if (!/\.\w{2,4}$/.test(name)) {
      const byType = { 'application/epub+zip': 'epub', 'application/x-fictionbook+xml': 'fb2', 'application/fb2+zip': 'zip', 'application/x-zip-compressed-fb2': 'zip', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html' };
      const found = Object.entries(byType).find(([t]) => type.includes(t));
      name += `.${found ? found[1] : meta.ext || 'bin'}`;
    }
    const rec = await this.importBookBuffer(buf, name, space, meta);
    if (!rec) throw new Error('Формат файла не поддерживается');
    return rec;
  }

  // ---------- Аудиокниги ----------
  // files: [{ path }] — уже лежат в library/audio/<id>/… (Android) или [{ file, rel }] — File с сайта
  async importAudio(files, space, { id = newId(), title, folder } = {}) {
    const list = files.filter((f) => this.isAudio(f.name || f.path || ''));
    if (!list.length) throw new Error('В выбранном нет аудиофайлов');
    const images = files.filter((f) => this.isImage(f.name || f.path || ''));
    const key = (f) => f.rel || f.path || f.name;
    list.sort((a, b) => natural(key(a), key(b)));
    const tracks = [];
    let common = {};
    let picture = null;
    for (const f of list) {
      let path = f.path;
      if (f.file) {
        path = this.rel(`audio/${id}/${(f.rel || f.file.name).split('/').map(safeName).join('/')}`);
        await vfs.write(path, f.file);
      }
      const name = basename(path);
      const tag = await audioTags({ ...f, path, name });
      if (!picture && tag.picture && tag.picture[0]) picture = tag.picture[0];
      if (!common.album && tag.album) common = tag;
      const file = path.slice(ROOT.length + 1);
      tracks.push({ file, url: vfs.url(path), title: tag.title || name.replace(/\.[^.]+$/, ''), duration: null });
    }
    const rec = {
      id, space, kind: 'audio', owned: true,
      title: title || common.album || folder || dirname(list[0].rel || '').split('/').pop() || tracks[0].title,
      author: common.albumartist || common.artist || '',
      narrator: (common.composer && common.composer[0]) || '',
      annotation: (common.comment && common.comment[0] && (common.comment[0].text || common.comment[0])) || '',
      cover: null, tracks, duration: null,
      position: { track: 0, time: 0 }, speed: 1, bookmarks: [], finished: false,
      added: new Date().toISOString(), lastPlayed: null,
    };
    if (typeof rec.annotation !== 'string') rec.annotation = '';
    this.index.audio.unshift(rec);
    if (picture) {
      const e = /png/.test(picture.format) ? 'png' : 'jpg';
      await vfs.write(this.rel(`covers/${id}.${e}`), picture.data);
      rec.cover = `covers/${id}.${e}?v=${Date.now()}`;
    } else if (images.length) {
      const img = images.sort((a, b) => (/cover|folder|front|обложк/i.test(key(b)) ? 1 : 0) - (/cover|folder|front|обложк/i.test(key(a)) ? 1 : 0))[0];
      await this.setCoverFromSource('audio', id, { ...img, name: img.name || img.path });
    }
    // Картинки из папки аудиокниги больше не нужны
    for (const img of images) if (img.path && img.path.startsWith(this.rel(`audio/${id}/`))) vfs.remove(img.path);
    this.changed();
    return rec;
  }

  // ---------- Импорт файлов, пришедших извне (скачано, «Открыть в…», выбрано) ----------
  // src: { path, name } в vfs или { file, name } с сайта. Возвращает [{ kind, rec }] или null
  async importIncoming(src, space, { source = 'browser' } = {}) {
    const name = src.name || basename(src.path);
    if (this.isAudio(name)) {
      const id = newId();
      let path = src.path;
      if (path) {
        const dest = this.rel(`audio/${id}/${safeName(name)}`);
        await vfs.move(path, dest);
        path = dest;
      }
      const rec = await this.importAudio([{ ...src, path, name }], space, { id });
      return [{ kind: 'audio', rec }];
    }
    const lower = name.toLowerCase();
    if (this.isArchive(lower) || (/\.zip$/i.test(lower) && !(await this.zipHasBook(src)))) {
      return this.importArchive(src, space);
    }
    if (!this.isBook(lower)) throw new Error(`${name}: формат не поддерживается`);
    const bytes = src.file ? new Uint8Array(await src.file.arrayBuffer()) : await vfs.readBytes(src.path);
    const rec = await this.importBookBuffer(bytes, name, space, { source });
    if (src.path) vfs.remove(src.path);
    return rec ? [{ kind: 'book', rec }] : null;
  }

  async zipHasBook(src) {
    try {
      const size = src.file ? src.file.size : ((await vfs.stat(src.path)) || {}).size || 0;
      if (size > 60 * 1024 * 1024) return false;
      const bytes = src.file ? new Uint8Array(await src.file.arrayBuffer()) : await vfs.readBytes(src.path);
      const zip = await JSZip.loadAsync(bytes);
      return Object.values(zip.files).some((f) => /\.(fb2|epub)$/i.test(f.name));
    } catch { return false; }
  }

  pickBooks(files, hasAudio) {
    const prio = (p) => MAIN_BOOK_PRIORITY.indexOf(ext(p) === 'htm' ? 'html' : ext(p));
    let cand = files.filter((p) => MAIN_BOOK_PRIORITY.includes(ext(p)));
    if (!cand.length && !hasAudio) cand = files.filter((p) => WEAK_BOOK_EXT.includes(ext(p)));
    const byName = new Map();
    for (const p of cand) {
      const k = p.replace(/\.[^.]+$/, '').toLowerCase();
      const cur = byName.get(k);
      if (!cur || (prio(p) !== -1 && prio(p) < prio(cur))) byName.set(k, p);
    }
    return [...byName.values()].sort(natural);
  }

  // Архив zip/7z/rar: книги и аудио попадают в библиотеку, пустой архив — null
  async importArchive(src, space) {
    const name = src.name || basename(src.path);
    const tmp = this.rel(`incoming/_x-${newId()}`);
    try {
      await this.extract(src, tmp);
      const all = await vfs.list(tmp);
      const audio = all.filter((p) => this.isAudio(p));
      const results = [];
      for (const p of this.pickBooks(all, audio.length > 0)) {
        try {
          const rec = await this.importBookBuffer(await vfs.readBytes(`${tmp}/${p}`), basename(p), space, { source: 'browser' });
          if (rec) results.push({ kind: 'book', rec });
        } catch { /* битая книга внутри не должна ронять весь архив */ }
      }
      if (audio.length) {
        const id = newId();
        const folder = name.replace(/\.[^.]+$/, '');
        const files = [];
        for (const p of [...audio, ...all.filter((x) => this.isImage(x))]) {
          const dest = this.rel(`audio/${id}/${p}`);
          await vfs.move(`${tmp}/${p}`, dest);
          files.push({ path: dest, rel: p, name: basename(p) });
        }
        results.push({ kind: 'audio', rec: await this.importAudio(files, space, { id, folder }) });
      }
      if (results.length && src.path) vfs.remove(src.path);
      return results.length ? results : null;
    } finally {
      vfs.removeDir(tmp);
    }
  }

  async extract(src, dest) {
    if (isNative) {
      await vfs.mkdir(dest);
      await Ark.extract({ archive: vfs.abs(src.path), dest: vfs.abs(dest) });
      return;
    }
    // Сайт: 7-Zip (WASM) в отдельном потоке; архив читается частями прямо из файла
    const blob = src.file || await vfs.readBlob(src.path);
    const files = await new Promise((resolve, reject) => {
      const w = new Worker(new URL('./unpack.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => { if (e.data.error) reject(new Error(`Не удалось распаковать архив: ${e.data.error}`)); else resolve(e.data.files); w.terminate(); };
      w.onerror = (e) => { reject(new Error(`Не удалось распаковать архив: ${e.message}`)); w.terminate(); };
      w.postMessage({ blob, name: src.name || basename(src.path) });
    });
    for (const f of files) await vfs.write(`${dest}/${f.path}`, f.data);
  }
}
