// Распаковка zip/7z/rar в версии для сайта (iPhone): 7-Zip, собранный в WASM.
// Архив подключается через WORKERFS — читается кусками, без копии в памяти.
import SevenZip from '../../vendor/7z/7zz.es6.js';

const MAX_OUT = 900 * 1024 * 1024;

self.onmessage = async (e) => {
  const { blob, name } = e.data;
  try {
    const errors = [];
    const sz = await SevenZip({
      locateFile: (p) => new URL(`../../vendor/7z/${p}`, import.meta.url).href,
      print: () => {},
      printErr: (m) => errors.push(String(m)),
    });
    const archive = `a.${(name.match(/\.(\w+)$/) || [])[1] || 'bin'}`;
    sz.FS.mkdir('/src');
    sz.FS.mount(sz.WORKERFS, { blobs: [{ name: archive, data: blob }] }, '/src');
    sz.FS.mkdir('/out');
    sz.FS.chdir('/out');
    let code;
    try { code = sz.callMain(['x', `/src/${archive}`, '-o/out', '-y', '-aoa']); } catch (err) { code = err && typeof err.status === 'number' ? err.status : 2; }
    if (code > 1) throw new Error(errors.filter(Boolean).slice(-2).join(' ').trim() || `код ${code}`);
    const files = [];
    let total = 0;
    const walk = (dir, rel) => {
      for (const n of sz.FS.readdir(dir)) {
        if (n === '.' || n === '..') continue;
        const full = `${dir}/${n}`;
        const r = rel ? `${rel}/${n}` : n;
        const st = sz.FS.stat(full);
        if (sz.FS.isDir(st.mode)) walk(full, r);
        else {
          total += st.size;
          if (total > MAX_OUT) throw new Error('архив слишком большой для веб-версии');
          files.push({ path: r, data: sz.FS.readFile(full) });
        }
      }
    };
    walk('/out', '');
    self.postMessage({ files }, files.map((f) => f.data.buffer));
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
