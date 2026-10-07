// Иконки из build/icon.png: для сайта/iPhone (www/icons) и для Android (mipmap, адаптивная иконка, заставка)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'build', 'icon.png');
const BG = '#050a08';

async function onBg(size, scale, out) {
  const inner = Math.round(size * scale);
  const icon = await sharp(src).resize(inner, inner).toBuffer();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: icon, gravity: 'center' }]).png().toFile(out);
}

const web = path.join(root, 'www', 'icons');
fs.mkdirSync(web, { recursive: true });
await sharp(src).resize(192, 192).png().toFile(path.join(web, 'icon-192.png'));
await sharp(src).resize(512, 512).png().toFile(path.join(web, 'icon-512.png'));
await onBg(512, 0.72, path.join(web, 'icon-maskable-512.png'));
await onBg(180, 0.86, path.join(web, 'apple-touch-icon.png'));

// Android
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(D)) {
    const dir = path.join(res, `mipmap-${d}`);
    await onBg(Math.round(48 * k), 0.86, path.join(dir, 'ic_launcher.png'));
    await onBg(Math.round(48 * k), 0.86, path.join(dir, 'ic_launcher_round.png'));
    // Передний слой адаптивной иконки: 108dp, видимая зона — центральные 72dp
    const fg = Math.round(108 * k);
    const inner = Math.round(fg * 0.6);
    const icon = await sharp(src).resize(inner, inner).toBuffer();
    await sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: icon, gravity: 'center' }]).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
  // Заставка при запуске (Android 12+ рисует иконку сама; для старых — картинка)
  for (const dir of fs.readdirSync(res).filter((n) => /^drawable/.test(n))) {
    const f = path.join(res, dir, 'splash.png');
    if (!fs.existsSync(f)) continue;
    const { width, height } = await sharp(f).metadata();
    const s = Math.round(Math.min(width, height) * 0.35);
    const icon = await sharp(src).resize(s, s).toBuffer();
    await sharp({ create: { width, height, channels: 4, background: BG } }).composite([{ input: icon, gravity: 'center' }]).png().toFile(f + '.tmp');
    fs.renameSync(f + '.tmp', f);
  }
  console.log('Иконки Android обновлены');
}
console.log('Иконки сайта готовы');
