// Список файлов для офлайн-кэша PWA и версия сервис-воркера → www/sw-version.js
// Запускается при сборке сайта (GitHub Pages) после npm run vendor.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const www = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const files = [];
const hash = crypto.createHash('sha1');
const walk = (dir) => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    const rel = path.relative(www, full).split(path.sep).join('/');
    if (d.isDirectory()) { walk(full); continue; }
    if (['sw.js', 'sw-version.js'].includes(rel) || /\.map$/.test(rel)) continue;
    hash.update(rel).update(fs.readFileSync(full));
    // Тяжёлое (шрифты, pdf.js, 7-Zip, docx) кэшируется при первом использовании, чтобы установка была быстрой
    if (/^vendor\/(fonts|pdfjs|7z)\/|^vendor\/(docx|mammoth|music-metadata)\.js$/.test(rel)) continue;
    files.push(rel);
  }
};
walk(www);
files.sort();
const version = hash.digest('hex').slice(0, 12);
fs.writeFileSync(path.join(www, 'sw-version.js'), `self.SW_VERSION = '${version}';\nself.PRECACHE = ${JSON.stringify(['./', ...files])};\n`);
console.log(`sw-version.js: ${files.length} файлов, версия ${version}`);
