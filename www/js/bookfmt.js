// Форматы книг: извлечение метаданных и превращение содержимого в поток абзацев для читалки
const XLINK = 'http://www.w3.org/1999/xlink';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textOf = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// ---------- Общее ----------
function parseXml(text) {
  let doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
}
const byTag = (root, name) => [...root.getElementsByTagName(name)];
const first = (root, name) => root.getElementsByTagName(name)[0] || null;
const hrefOf = (el) => el.getAttributeNS(XLINK, 'href') || el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || [...el.attributes].find((a) => /href$/i.test(a.name))?.value || '';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

// Уменьшенная обложка в JPEG — экономит место и ускоряет списки
export async function toCoverData(src, maxW = 420) {
  const img = await loadImage(src);
  const k = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}

export const countWords = (html) => (html.replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;

// ---------- FB2 ----------
function fb2Meta(doc) {
  const ti = first(doc, 'title-info') || doc;
  const authors = byTag(ti, 'author').map((a) => {
    const name = ['first-name', 'middle-name', 'last-name'].map((t) => textOf(first(a, t))).filter(Boolean).join(' ');
    return name || textOf(first(a, 'nickname'));
  }).filter(Boolean);
  const seq = first(ti, 'sequence');
  const ann = first(ti, 'annotation');
  const cover = first(first(ti, 'coverpage') || doc.createElement('x'), 'image');
  let coverData = null;
  if (cover) {
    const id = hrefOf(cover).replace(/^#/, '');
    const bin = byTag(doc, 'binary').find((b) => b.getAttribute('id') === id);
    if (bin) coverData = `data:${bin.getAttribute('content-type') || 'image/jpeg'};base64,${bin.textContent.replace(/\s+/g, '')}`;
  }
  return {
    title: textOf(first(ti, 'book-title')),
    authors,
    series: seq ? seq.getAttribute('name') || '' : '',
    seriesNum: seq && seq.getAttribute('number') ? Number(seq.getAttribute('number')) || null : null,
    annotation: ann ? [...ann.children].map(textOf).filter(Boolean).join('\n\n') || textOf(ann) : '',
    genres: byTag(ti, 'genre').map(textOf).filter(Boolean),
    lang: textOf(first(ti, 'lang')),
    year: textOf(first(ti, 'date')).slice(0, 4),
    coverData,
  };
}

function fb2Html(doc) {
  const binaries = {};
  for (const b of byTag(doc, 'binary')) binaries[b.getAttribute('id')] = `data:${b.getAttribute('content-type') || 'image/jpeg'};base64,${b.textContent.replace(/\s+/g, '')}`;
  const bodies = byTag(doc, 'body');
  const main = bodies.find((b) => !b.getAttribute('name')) || bodies[0];
  const noteBodies = bodies.filter((b) => b !== main);
  const notes = {};
  for (const nb of noteBodies) for (const s of byTag(nb, 'section')) if (s.getAttribute('id')) notes[s.getAttribute('id')] = textOf(s).replace(/^\S+\s*/, '');

  const inline = (node) => [...node.childNodes].map((n) => {
    if (n.nodeType === 3) return esc(n.textContent);
    if (n.nodeType !== 1) return '';
    const t = n.localName;
    const inner = inline(n);
    if (t === 'emphasis') return `<em>${inner}</em>`;
    if (t === 'strong') return `<strong>${inner}</strong>`;
    if (t === 'strikethrough') return `<s>${inner}</s>`;
    if (t === 'sub' || t === 'sup') return `<${t}>${inner}</${t}>`;
    if (t === 'code') return `<code>${inner}</code>`;
    if (t === 'a') {
      const ref = hrefOf(n).replace(/^#/, '');
      if (notes[ref]) return `<sup class="note" title="${esc(notes[ref])}">${inner}</sup>`;
      return inner;
    }
    if (t === 'image') { const src = binaries[hrefOf(n).replace(/^#/, '')]; return src ? `<img src="${src}" alt="">` : ''; }
    return inner;
  }).join('');

  const out = [];
  const walk = (node, depth) => {
    for (const n of node.children) {
      const t = n.localName;
      if (t === 'section') walk(n, depth + 1);
      else if (t === 'title') {
        const lines = [...n.children].map((p) => inline(p)).filter(Boolean);
        if (lines.length) out.push(`<${depth <= 1 ? 'h2' : 'h3'}>${lines.join('<br>')}</${depth <= 1 ? 'h2' : 'h3'}>`);
      } else if (t === 'subtitle') out.push(`<h4>${inline(n)}</h4>`);
      else if (t === 'p') out.push(`<p>${inline(n)}</p>`);
      else if (t === 'empty-line') out.push('<div class="gap"></div>');
      else if (t === 'image') { const src = binaries[hrefOf(n).replace(/^#/, '')]; if (src) out.push(`<p class="pic"><img src="${src}" alt=""></p>`); }
      else if (t === 'epigraph' || t === 'cite') {
        const parts = [...n.children].map((c) => (c.localName === 'text-author' ? `<p class="author">${inline(c)}</p>` : c.localName === 'poem' ? poem(c) : `<p>${inline(c)}</p>`));
        out.push(`<blockquote class="${t}">${parts.join('')}</blockquote>`);
      } else if (t === 'poem') out.push(poem(n));
      else if (t === 'table') out.push(`<table>${[...n.children].map((tr) => `<tr>${[...tr.children].map((td) => `<td>${inline(td)}</td>`).join('')}</tr>`).join('')}</table>`);
      else if (t === 'annotation') continue;
      else if (n.children.length) walk(n, depth);
    }
  };
  const poem = (p) => `<div class="poem">${[...p.children].map((c) => {
    if (c.localName === 'stanza') return `<div class="stanza">${[...c.children].map((v) => `<p class="v">${inline(v)}</p>`).join('')}</div>`;
    if (c.localName === 'title') return `<h4>${textOf(c)}</h4>`;
    if (c.localName === 'text-author') return `<p class="author">${inline(c)}</p>`;
    return `<p class="v">${inline(c)}</p>`;
  }).join('')}</div>`;
  if (main) walk(main, 0);
  return out.join('\n');
}

// ---------- EPUB ----------
async function epubPackage(id) {
  const container = parseXml(await window.ark.library.epubFile(id, 'META-INF/container.xml'));
  const opfPath = (first(container, 'rootfile') || { getAttribute: () => '' }).getAttribute('full-path');
  if (!opfPath) throw new Error('Повреждённый EPUB: нет описания книги');
  const opf = parseXml(await window.ark.library.epubFile(id, opfPath));
  const dir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const manifest = {};
  for (const it of byTag(opf, 'item')) manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type'), props: it.getAttribute('properties') || '' };
  const spine = byTag(opf, 'itemref').map((r) => manifest[r.getAttribute('idref')]).filter(Boolean);
  return { opf, dir, manifest, spine };
}

async function epubMeta(id, base) {
  const { opf, dir, manifest } = await epubPackage(id);
  const dc = (n) => byTag(opf, `dc:${n}`).concat(byTag(opf, n)).map(textOf).filter(Boolean);
  const metas = byTag(opf, 'meta');
  const metaVal = (name) => (metas.find((m) => m.getAttribute('name') === name) || { getAttribute: () => '' }).getAttribute('content');
  const seriesEl = metas.find((m) => m.getAttribute('property') === 'belongs-to-collection');
  let coverItem = Object.values(manifest).find((m) => /cover-image/.test(m.props));
  if (!coverItem && metaVal('cover')) coverItem = manifest[metaVal('cover')];
  if (!coverItem) coverItem = Object.values(manifest).find((m) => /^image\//.test(m.type || '') && /cover/i.test(m.href));
  const desc = dc('description')[0] || '';
  return {
    title: dc('title')[0] || '',
    authors: [...new Set(dc('creator'))],
    annotation: new DOMParser().parseFromString(desc, 'text/html').body.textContent.trim(),
    lang: dc('language')[0] || '',
    genres: dc('subject').slice(0, 6),
    year: (dc('date')[0] || '').slice(0, 4),
    series: metaVal('calibre:series') || (seriesEl ? textOf(seriesEl) : ''),
    seriesNum: Number(metaVal('calibre:series_index')) || null,
    coverSrc: coverItem ? base + encodeURI(dir + coverItem.href) : null,
  };
}

// Разворачиваем вложенные обёртки (div, section…) в плоский поток блоков
const WRAPPERS = new Set(['div', 'section', 'article', 'main', 'body', 'header', 'footer', 'aside', 'nav', 'figure', 'span']);
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'pre', 'table', 'hr', 'img', 'svg', 'dl', 'figure']);
function flatten(container, out) {
  for (const n of [...container.childNodes]) {
    if (n.nodeType === 3) {
      if (n.textContent.trim()) out.push(`<p>${esc(n.textContent.trim())}</p>`);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const t = n.localName.toLowerCase();
    const hasBlocks = [...n.children].some((c) => BLOCKS.has(c.localName.toLowerCase()) || WRAPPERS.has(c.localName.toLowerCase()));
    if (WRAPPERS.has(t) && hasBlocks) flatten(n, out);
    else if (t === 'img' || t === 'svg') out.push(`<p class="pic">${n.outerHTML}</p>`);
    else if (WRAPPERS.has(t)) { if (n.textContent.trim() || n.querySelector('img')) out.push(`<p>${n.innerHTML}</p>`); }
    else if (t === 'h1') out.push(`<h2>${n.innerHTML}</h2>`);
    else out.push(n.outerHTML);
  }
}

async function epubHtml(id, base) {
  const { dir, spine } = await epubPackage(id);
  const out = [];
  for (const item of spine) {
    if (!/x?html|xml/.test(item.type || 'html')) continue;
    const rel = dir + item.href;
    let text;
    try { text = await window.ark.library.epubFile(id, rel.split('#')[0]); } catch { continue; }
    const doc = new DOMParser().parseFromString(text, /xhtml|xml/.test(item.type) ? 'application/xhtml+xml' : 'text/html');
    const body = doc.body || doc.getElementsByTagName('body')[0];
    if (!body) continue;
    const docDir = rel.includes('/') ? rel.replace(/[^/]+$/, '') : '';
    // Картинки — абсолютные file:// ссылки на распакованную книгу
    for (const img of body.querySelectorAll('img, image')) {
      const attr = img.localName === 'image' ? hrefOf(img) : img.getAttribute('src');
      if (!attr || /^(data|https?|file):/.test(attr)) continue;
      const abs = new URL(attr, `${base}${encodeURI(docDir)}`).href;
      if (img.localName === 'image') { img.setAttributeNS(XLINK, 'href', abs); img.setAttribute('href', abs); } else img.setAttribute('src', abs);
    }
    for (const s of body.querySelectorAll('script, style, link')) s.remove();
    const blocks = [];
    flatten(body, blocks);
    if (blocks.length) { if (out.length) out.push('<hr class="chapter">'); out.push(...blocks); }
  }
  return out.join('\n');
}

// ---------- Текст, HTML, RTF ----------
function txtHtml(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let blank = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { blank++; continue; }
    if (blank >= 2 && out.length) out.push('<hr class="scene">');
    blank = 0;
    if (/^(глава|часть|chapter|part|пролог|эпилог|prologue|epilogue)\b/i.test(line) && line.length < 80) out.push(`<h2>${esc(line)}</h2>`);
    else if (/^(\*\s*){3}$|^[-—=]{3,}$/.test(line)) out.push('<hr class="scene">');
    else out.push(`<p>${esc(line)}</p>`);
  }
  return out.join('\n');
}

function htmlBody(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  for (const s of doc.querySelectorAll('script, style, link')) s.remove();
  const out = [];
  flatten(doc.body, out);
  return { html: out.join('\n'), title: textOf(doc.querySelector('title')) };
}

export function rtfToText(rtf) {
  const dec = new TextDecoder('windows-1251');
  let out = '', i = 0, bytes = [];
  const flush = () => { if (bytes.length) { out += dec.decode(new Uint8Array(bytes)); bytes = []; } };
  const skipStack = [false];
  let uc = 1;
  while (i < rtf.length) {
    const c = rtf[i];
    const skipping = skipStack[skipStack.length - 1];
    if (c === '{') { skipStack.push(skipping); i++; continue; }
    if (c === '}') { flush(); skipStack.pop(); if (!skipStack.length) skipStack.push(false); i++; continue; }
    if (c === '\\') {
      const n = rtf[i + 1];
      if (n === "'") { if (!skipping) bytes.push(parseInt(rtf.substr(i + 2, 2), 16)); i += 4; continue; }
      if (n === '\\' || n === '{' || n === '}') { flush(); if (!skipping) out += n; i += 2; continue; }
      if (n === '*') { skipStack[skipStack.length - 1] = true; i += 2; continue; }
      const m = rtf.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?/i);
      if (!m) { i += 2; continue; }
      const [all, word, num] = m;
      i += 1 + all.length;
      flush();
      if (['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore'].includes(word)) skipStack[skipStack.length - 1] = true;
      if (skipping) continue;
      if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += '\t';
      else if (word === 'uc') uc = Number(num) || 1;
      else if (word === 'u') { let code = Number(num); if (code < 0) code += 65536; out += String.fromCharCode(code); i += uc; }
      else if (word === 'emdash') out += '—';
      else if (word === 'endash') out += '–';
      else if (word === 'lquote' || word === 'rquote') out += '’';
      else if (word === 'ldblquote') out += '«';
      else if (word === 'rdblquote') out += '»';
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    flush();
    if (!skipping) out += c;
    i++;
  }
  flush();
  return out;
}

// ---------- PDF ----------
let pdfjs = null;
export async function getPdfjs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  }
  return pdfjs;
}

async function pdfMeta(url) {
  const lib = await getPdfjs();
  const task = lib.getDocument({ url, isEvalSupported: false });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => ({ info: {} }));
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: 420 / vp0.width });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
  const info = meta.info || {};
  const r = { title: info.Title || '', authors: info.Author ? [info.Author] : [], pages: doc.numPages, coverData: c.toDataURL('image/jpeg', 0.85) };
  task.destroy();
  return r;
}

// ---------- Публичное API ----------
export async function extractMeta(rec) {
  const c = await window.ark.library.content(rec.id);
  let m = {};
  if (c.format === 'fb2') m = fb2Meta(parseXml(c.text));
  else if (c.format === 'epub') m = await epubMeta(rec.id, c.base);
  else if (c.format === 'pdf') m = await pdfMeta(c.url);
  else if (c.format === 'html') m = { title: htmlBody(c.text).title };
  const patch = { needsMeta: false };
  for (const k of ['title', 'authors', 'series', 'seriesNum', 'annotation', 'genres', 'lang', 'year', 'pages']) {
    const v = m[k];
    if (v && (!Array.isArray(v) || v.length)) patch[k] = v;
  }
  let cover = null;
  try {
    if (m.coverData) cover = await toCoverData(m.coverData);
    else if (m.coverSrc) cover = await toCoverData(m.coverSrc);
  } catch { /* без обложки — нарисуем заглушку */ }
  return { patch, cover };
}

export async function bookHtml(rec) {
  const c = await window.ark.library.content(rec.id);
  let html = '';
  if (c.format === 'fb2') html = fb2Html(parseXml(c.text));
  else if (c.format === 'epub') html = await epubHtml(rec.id, c.base);
  else if (c.format === 'txt') html = txtHtml(c.text);
  else if (c.format === 'rtf') html = txtHtml(rtfToText(c.text));
  else if (c.format === 'html') html = htmlBody(c.text).html;
  else if (c.format === 'docx') { const out = []; const d = new DOMParser().parseFromString(`<body>${c.html}</body>`, 'text/html'); flatten(d.body, out); html = out.join('\n'); }
  return { html, words: countWords(html) };
}

// Фоновая очередь: дочитываем метаданные у свежеимпортированных книг
let queue = Promise.resolve();
const queued = new Set();
export function ensureMeta(books) {
  for (const b of books) {
    if (!b.needsMeta || queued.has(b.id)) continue;
    queued.add(b.id);
    queue = queue.then(async () => {
      try {
        const { patch, cover } = await Promise.race([
          extractMeta(b),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Разбор файла занял слишком много времени')), 20000)),
        ]);
        await window.ark.library.update('book', b.id, patch);
        if (cover) await window.ark.library.setCover('book', b.id, cover);
      } catch (e) {
        await window.ark.library.update('book', b.id, { needsMeta: false, metaError: String(e.message || e) });
      } finally { queued.delete(b.id); }
    });
  }
}
