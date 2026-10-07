// Готовит www/vendor: собирает npm-библиотеки в ES-модули для браузера и копирует шрифты, pdf.js, 7-Zip.
// Запуск: npm run vendor (делается и в GitHub Actions перед сборкой APK и сайта)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'www', 'vendor');
const nm = (...p) => path.join(root, 'node_modules', ...p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const entries = {
  capacitor: `export { Capacitor, registerPlugin, CapacitorHttp, WebView } from '@capacitor/core';
export { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
export { App } from '@capacitor/app';`,
  jszip: `import JSZip from 'jszip'; export default JSZip;`,
  mammoth: `import mammoth from 'mammoth/mammoth.browser.js'; export default mammoth;`,
  docx: `export * from 'docx';`,
  'music-metadata': `export { parseBuffer, parseBlob } from 'music-metadata';`,
};

for (const [name, code] of Object.entries(entries)) {
  await build({
    stdin: { contents: code, resolveDir: root, sourcefile: `${name}.entry.js` },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome100', 'safari15'],
    minify: true,
    outfile: path.join(out, `${name}.js`),
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'warning',
  });
}

const copy = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
};

// DOMPurify (подключается обычным <script>)
copy(nm('dompurify', 'dist', 'purify.min.js'), path.join(out, 'purify.min.js'));

// pdf.js: модуль и воркер
copy(nm('pdfjs-dist', 'build', 'pdf.min.mjs'), path.join(out, 'pdfjs', 'pdf.mjs'));
copy(nm('pdfjs-dist', 'build', 'pdf.worker.min.mjs'), path.join(out, 'pdfjs', 'pdf.worker.mjs'));

// 7-Zip (WASM) — распаковка 7z/rar в версии для iPhone
copy(nm('7z-wasm', '7zz.es6.js'), path.join(out, '7z', '7zz.es6.js'));
copy(nm('7z-wasm', '7zz.wasm'), path.join(out, '7z', '7zz.wasm'));

// Шрифты: только кириллица и латиница нужных начертаний, без лишних подмножеств
const FONTS = {
  'jetbrains-mono': ['400', '700'], 'ibm-plex-mono': ['400', '600'], 'ibm-plex-sans': ['400', '600'],
  'pt-serif': ['400', '400-italic', '700'], literata: ['400', '400-italic', '700'], spectral: ['400', '400-italic', '600'],
  'exo-2': ['400', '700'], oswald: ['400', '600'], 'russo-one': ['400'], unbounded: ['400', '700'],
  rubik: ['400', '600'], play: ['400', '700'], 'pt-mono': ['400'],
};
const css = [];
for (const [font, weights] of Object.entries(FONTS)) {
  for (const w of weights) {
    const src = fs.readFileSync(nm('@fontsource', font, `${w}.css`), 'utf8');
    // Оставляем только подмножества cyrillic, cyrillic-ext и latin в woff2; файлы копируем рядом
    for (const m of src.matchAll(/\/\* ([\w-]+) \*\/\s*(@font-face\s*\{[^}]+\})/g)) {
      if (!/-(cyrillic|cyrillic-ext|latin)-\d/.test(m[1])) continue;
      const block = m[2]
        .replace(/,\s*url\([^)]+\.woff\) format\('woff'\)/, '')
        .replace(/url\(\.\/files\/([^)]+)\)/g, (x, f) => {
          copy(nm('@fontsource', font, 'files', f), path.join(out, 'fonts', f));
          return `url(./fonts/${f})`;
        });
      css.push(block);
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css.join('\n'));

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((a, d) => a + (d.isDirectory() ? size(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log(`www/vendor готов: ${(size(out) / 1e6).toFixed(1)} МБ`);
