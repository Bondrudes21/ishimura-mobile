// Сервис-воркер версии для сайта (iPhone/PWA):
//  1) держит приложение в кэше — открывается без интернета;
//  2) отдаёт файлы библиотеки и архива по ссылкам ./vfs/… из Cache Storage (с поддержкой Range для аудио).
importScripts('sw-version.js'); // self.SW_VERSION и self.PRECACHE — генерирует scripts/precache.mjs

const SHELL = `ark-shell-${self.SW_VERSION}`;
const VFS = 'ark-vfs';
const scope = new URL(self.registration.scope);
const VFS_PREFIX = new URL('vfs/', scope).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    const list = (self.PRECACHE || []).map((p) => new URL(p, scope).href);
    // Кэшируем пачками, чтобы один упавший файл не сорвал установку
    for (let i = 0; i < list.length; i += 20) {
      await Promise.all(list.slice(i, i + 20).map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ark-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const canon = (pathname) => {
  const rest = pathname.slice(VFS_PREFIX.length);
  return new URL('vfs/', scope).href + rest.split('/').map((s) => { try { return encodeURIComponent(decodeURIComponent(s)); } catch { return s; } }).join('/');
};

async function serveVfs(req) {
  const url = new URL(req.url);
  const cache = await caches.open(VFS);
  const res = await cache.match(canon(url.pathname));
  if (!res) return new Response('Not found', { status: 404 });
  const range = req.headers.get('range');
  const type = res.headers.get('content-type') || 'application/octet-stream';
  if (!range) {
    return new Response(res.body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': res.headers.get('content-length') || '', 'Accept-Ranges': 'bytes' } });
  }
  const blob = await res.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? Number(m[1]) : 0;
  let end = m[2] ? Number(m[2]) : blob.size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, blob.size - Number(m[2])); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start > end || start >= blob.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Accept-Ranges': 'bytes' },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin) return;
  if (url.pathname.startsWith(VFS_PREFIX)) { e.respondWith(serveVfs(req)); return; }
  // Встроенный архив рассказов всегда берём свежим, если есть сеть
  const fresh = url.pathname.includes('/content/');
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit && !fresh) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match(new URL('index.html', scope).href)) || Response.error();
      throw err;
    }
  })());
});
