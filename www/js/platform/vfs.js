// Файловое хранилище приложения с одинаковым API на обеих платформах:
//  • Android — настоящие файлы в памяти приложения (плагин Filesystem), ссылки через локальный сервер Capacitor;
//  • сайт/PWA (iPhone) — Cache Storage, а ссылки ./vfs/… отдаёт сервис-воркер (sw.js).
// Пути относительные, через «/»: 'content/manifest.json', 'library/books/ab12/book.fb2'.
import { isNative, Capacitor } from './env.js';
import { Filesystem, Directory, Encoding } from '../../vendor/capacitor.js';

const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
const clean = (p) => String(p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');

export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new TextEncoder().encode(String(data));
}

export function bytesToBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const MIME = {
  json: 'application/json', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', xhtml: 'application/xhtml+xml', xml: 'application/xml', opf: 'application/xml', ncx: 'application/xml',
  css: 'text/css', txt: 'text/plain; charset=utf-8', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
  mp4: 'video/mp4', webm: 'video/webm', pdf: 'application/pdf', epub: 'application/epub+zip', fb2: 'application/xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
export const mimeOf = (p) => MIME[(String(p).split('?')[0].match(/\.([\w]+)$/) || [])[1]?.toLowerCase()] || 'application/octet-stream';

// ---------- Android ----------
function nativeVfs() {
  let dataUri = '';
  const ready = Filesystem.getUri({ directory: Directory.Data, path: '' }).then((r) => { dataUri = r.uri.replace(/\/+$/, ''); });
  const opts = (path) => ({ directory: Directory.Data, path: clean(path) });
  const api = {
    ready,
    abs: (path) => `${dataUri.replace(/^file:\/\//, '')}/${clean(path)}`,
    fileUri: (path) => `${dataUri}/${clean(path)}`,
    url: (path) => Capacitor.convertFileSrc(`${dataUri}/${enc(clean(path))}`) + (/\/$/.test(path) ? '/' : ''),
    async write(path, data) {
      await ready;
      if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
      if (typeof data === 'string') return Filesystem.writeFile({ ...opts(path), data, encoding: Encoding.UTF8, recursive: true });
      return Filesystem.writeFile({ ...opts(path), data: bytesToBase64(toBytes(data)), recursive: true });
    },
    async readBytes(path) {
      await ready;
      const res = await fetch(api.url(path));
      if (!res.ok) throw new Error(`Файл не найден: ${path}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async readText(path) {
      await ready;
      return (await Filesystem.readFile({ ...opts(path), encoding: Encoding.UTF8 })).data;
    },
    async exists(path) {
      await ready;
      try { await Filesystem.stat(opts(path)); return true; } catch { return false; }
    },
    async stat(path) {
      await ready;
      try { const s = await Filesystem.stat(opts(path)); return { size: s.size, dir: s.type === 'directory' }; } catch { return null; }
    },
    async remove(path) {
      await ready;
      try { await Filesystem.deleteFile(opts(path)); } catch {}
    },
    async removeDir(path) {
      await ready;
      try { await Filesystem.rmdir({ ...opts(path), recursive: true }); } catch {}
    },
    async mkdir(path) {
      await ready;
      try { await Filesystem.mkdir({ ...opts(path), recursive: true }); } catch {}
    },
    async list(dir) {
      await ready;
      const out = [];
      const walk = async (rel) => {
        let r;
        try { r = await Filesystem.readdir(opts(rel)); } catch { return; }
        for (const f of r.files) {
          const p = rel ? `${rel}/${f.name}` : f.name;
          if (f.type === 'directory') await walk(p); else out.push(p);
        }
      };
      await walk(clean(dir));
      const base = clean(dir);
      return out.map((p) => (base ? p.slice(base.length + 1) : p));
    },
    async move(from, to) {
      await ready;
      await Filesystem.rename({ from: clean(from), to: clean(to), directory: Directory.Data, toDirectory: Directory.Data });
    },
  };
  return api;
}

// ---------- Сайт / PWA ----------
function webVfs() {
  const CACHE = 'ark-vfs';
  const base = new URL('vfs/', document.baseURI).href;
  const key = (path) => base + enc(clean(path));
  const open = () => caches.open(CACHE);
  const ready = (async () => {
    if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch {} }
  })();
  const api = {
    ready,
    abs: () => null,
    fileUri: () => null,
    url: (path) => base + enc(clean(path)) + (/\/$/.test(path) && clean(path) ? '/' : ''),
    async write(path, data, mime) {
      const body = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : toBytes(data)]);
      const headers = { 'Content-Type': mime || mimeOf(path), 'Content-Length': String(body.size), 'X-Size': String(body.size) };
      await (await open()).put(key(path), new Response(body, { headers }));
    },
    async readBytes(path) {
      const r = await (await open()).match(key(path));
      if (!r) throw new Error(`Файл не найден: ${path}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async readBlob(path) {
      const r = await (await open()).match(key(path));
      if (!r) throw new Error(`Файл не найден: ${path}`);
      return r.blob();
    },
    async readText(path) {
      return new TextDecoder().decode(await api.readBytes(path));
    },
    async exists(path) {
      return !!(await (await open()).match(key(path)));
    },
    async stat(path) {
      const r = await (await open()).match(key(path));
      return r ? { size: Number(r.headers.get('X-Size')) || 0, dir: false } : null;
    },
    async remove(path) {
      await (await open()).delete(key(path));
    },
    async removeDir(path) {
      const c = await open();
      const prefix = key(path) + '/';
      for (const req of await c.keys()) if (req.url.startsWith(prefix)) await c.delete(req);
    },
    async mkdir() {},
    async list(dir) {
      const prefix = clean(dir) ? key(dir) + '/' : base;
      const out = [];
      for (const req of await (await open()).keys()) {
        if (req.url.startsWith(prefix)) out.push(req.url.slice(prefix.length).split('/').map(decodeURIComponent).join('/'));
      }
      return out;
    },
    async move(from, to) {
      const c = await open();
      const r = await c.match(key(from));
      if (!r) throw new Error(`Файл не найден: ${from}`);
      await c.put(key(to), r);
      await c.delete(key(from));
    },
  };
  return api;
}

// ---------- Локальная проверка (npm run serve, порт 5173): файлы хранит сам сервер ----------
function devVfs() {
  const base = new URL('vfs/', document.baseURI).href;
  const u = (path) => base + enc(clean(path));
  const api = {
    ready: Promise.resolve(),
    abs: () => null,
    fileUri: () => null,
    url: (path) => u(path) + (/\/$/.test(path) && clean(path) ? '/' : ''),
    async write(path, data) {
      const body = data instanceof Blob ? data : typeof data === 'string' ? data : toBytes(data);
      const r = await fetch(u(path), { method: 'PUT', body });
      if (!r.ok) throw new Error(`Не удалось записать ${path}`);
    },
    async readBytes(path) {
      const r = await fetch(u(path), { cache: 'no-store' });
      if (!r.ok) throw new Error(`Файл не найден: ${path}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async readBlob(path) {
      const r = await fetch(u(path), { cache: 'no-store' });
      if (!r.ok) throw new Error(`Файл не найден: ${path}`);
      return r.blob();
    },
    async readText(path) { return new TextDecoder().decode(await api.readBytes(path)); },
    async exists(path) { return (await fetch(u(path), { method: 'HEAD', cache: 'no-store' })).ok; },
    async stat(path) {
      const r = await fetch(u(path), { method: 'HEAD', cache: 'no-store' });
      return r.ok ? { size: Number(r.headers.get('content-length')) || 0, dir: false } : null;
    },
    async remove(path) { await fetch(u(path), { method: 'DELETE' }); },
    async removeDir(path) { await fetch(u(path), { method: 'DELETE' }); },
    async mkdir() {},
    async list(dir) { return (await fetch(`/__vfs-list?prefix=${encodeURIComponent(clean(dir))}`)).json(); },
    async move(from, to) {
      const r = await fetch(`${u(from)}?moveTo=${encodeURIComponent(clean(to))}`, { method: 'POST' });
      if (!r.ok) throw new Error(`Файл не найден: ${from}`);
    },
  };
  return api;
}

const devMode = !isNative && location.hostname === 'localhost' && location.port === '5173';
export const vfs = isNative ? nativeVfs() : devMode ? devVfs() : webVfs();
export const vfsDevMode = devMode;

vfs.readJson = async (path) => { try { return JSON.parse(await vfs.readText(path)); } catch { return null; } };
vfs.writeJson = (path, obj) => vfs.write(path, JSON.stringify(obj), 'application/json');
