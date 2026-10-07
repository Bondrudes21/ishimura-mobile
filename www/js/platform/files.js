// Выбор файлов и сохранение файлов наружу.
// Android: системные диалоги через нативный плагин (файлы сразу копируются в память приложения).
// Сайт/PWA: <input type="file"> и «Поделиться»/скачивание.
import { isNative, isIOS, Ark } from './env.js';
import { vfs } from './vfs.js';

const ACCEPT = {
  books: { ext: ['fb2', 'epub', 'pdf', 'txt', 'docx', 'html', 'htm', 'rtf', 'zip', '7z', 'rar'], mime: ['*/*'] },
  audio: { ext: ['mp3', 'm4a', 'm4b', 'ogg', 'opus', 'flac', 'wav', 'aac'], mime: ['audio/*'] },
  image: { ext: ['jpg', 'jpeg', 'png', 'webp', 'gif'], mime: ['image/*'] },
  background: { ext: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'], mime: ['image/*', 'video/*'] },
  font: { ext: ['ttf', 'otf', 'woff', 'woff2'], mime: ['*/*'] },
  sound: { ext: ['mp3', 'ogg', 'wav', 'm4a'], mime: ['audio/*'] },
  cursor: { ext: ['png', 'cur', 'svg', 'gif'], mime: ['image/*'] },
  json: { ext: ['json'], mime: ['*/*'] },
};

// Сайт: обычный выбор файлов. Обязательно вызывается синхронно из обработчика нажатия.
function webPick({ kind, multiple, directory }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!multiple;
    const a = ACCEPT[kind];
    // На iPhone фильтр по расширениям прячет fb2/epub, поэтому для книг разрешаем всё
    if (a && !(isIOS && kind === 'books')) input.accept = [...a.ext.map((e) => `.${e}`), ...a.mime].join(',');
    if (directory && 'webkitdirectory' in input && !isIOS) input.webkitdirectory = true;
    input.style.display = 'none';
    document.body.append(input);
    let done = false;
    const finish = (files) => { if (done) return; done = true; input.remove(); resolve(files); };
    input.addEventListener('change', () => finish([...input.files].map((f) => ({ file: f, name: f.name, rel: f.webkitRelativePath || f.name }))));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

// kind: books | audio | image | background | font | sound | cursor | json
// dest — папка vfs, куда Android скопирует выбранное
export async function pickFiles({ kind, multiple = false, dest = 'tmp/picked' }) {
  if (!isNative) return webPick({ kind, multiple });
  const a = ACCEPT[kind] || { ext: [], mime: ['*/*'] };
  try {
    const r = await Ark.pickFiles({ mime: a.mime, ext: a.ext, multiple, dest: vfs.abs(dest) });
    return (r.files || []).map((f) => ({ path: `${dest}/${f.name}`, name: f.name, size: f.size }));
  } catch (e) {
    if (/cancel/i.test(String(e.message))) return [];
    throw e;
  }
}

// Папка целиком (аудиокнига). На iPhone выбрать папку нельзя — выбираются файлы.
export async function pickFolder({ dest }) {
  if (!isNative) return webPick({ kind: 'audio', multiple: true, directory: true });
  try {
    const r = await Ark.pickFolder({ dest: vfs.abs(dest), ext: [...ACCEPT.audio.ext, ...ACCEPT.image.ext] });
    return (r.files || []).map((f) => ({ path: `${dest}/${f.rel}`, rel: f.rel, name: f.rel.split('/').pop(), folder: r.folder }));
  } catch (e) {
    if (/cancel/i.test(String(e.message))) return [];
    throw e;
  }
}

// Отдать файл пользователю: Android — системный «Сохранить как…», сайт — «Поделиться» или скачивание
export async function saveFile(data, name, mime = 'application/octet-stream') {
  if (isNative) {
    const tmp = `tmp/export/${name.replace(/[\\/:*?"<>|]/g, '_')}`;
    await vfs.write(tmp, data);
    try {
      const r = await Ark.saveFile({ src: vfs.abs(tmp), name, mime });
      return r && r.saved ? name : false;
    } catch (e) {
      if (/cancel/i.test(String(e.message))) return false;
      throw e;
    } finally { vfs.remove(tmp); }
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const file = new File([blob], name, { type: mime });
  if (isIOS && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return name; } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return name;
}

export async function readPicked(src) {
  if (src.file) return new Uint8Array(await src.file.arrayBuffer());
  return vfs.readBytes(src.path);
}
export async function readPickedText(src) {
  if (src.file) return src.file.text();
  return vfs.readText(src.path);
}
