// Локальный сервер для проверки версии-сайта: npm run serve → http://localhost:5173
// Встроенный браузер Claude не поддерживает сервис-воркеры, поэтому на этом порту хранилище vfs
// работает через сам сервер (папка .devvfs): PUT/GET/DELETE /vfs/…, GET /__vfs-list?prefix=…
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');
const store = path.join(root, '.devvfs');
const port = Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.m4b': 'audio/mp4', '.pdf': 'application/pdf',
  '.xhtml': 'application/xhtml+xml', '.html5': 'text/html',
};

function sendFile(req, res, file) {
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)])) : []);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/__vfs-list') {
    const prefix = url.searchParams.get('prefix') || '';
    const base = path.join(store, prefix);
    const list = walk(base).map((f) => path.relative(base, f).split(path.sep).join('/'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return;
  }
  if (p.startsWith('/vfs/')) {
    const file = path.join(store, p.slice(5));
    if (!file.startsWith(store)) { res.writeHead(403); res.end(); return; }
    if (req.method === 'PUT') {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const out = fs.createWriteStream(file);
      req.pipe(out);
      out.on('finish', () => { res.writeHead(204); res.end(); });
      return;
    }
    if (req.method === 'DELETE') {
      fs.rmSync(file, { recursive: true, force: true });
      res.writeHead(204); res.end();
      return;
    }
    if (req.method === 'POST' && url.searchParams.get('moveTo')) {
      const to = path.join(store, url.searchParams.get('moveTo'));
      if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(file, to);
      res.writeHead(204); res.end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    sendFile(req, res, file);
    return;
  }
  let f = p.endsWith('/') ? `${p}index.html` : p;
  const file = path.join(www, f);
  if (!file.startsWith(www) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  sendFile(req, res, file);
}).listen(port, () => console.log(`http://localhost:${port}`));
