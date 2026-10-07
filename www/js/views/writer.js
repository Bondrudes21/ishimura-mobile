// «Мои книги»: редактор рукописей с главами, форматированием и экспортом
import { h, icon, btn, toast, modal, confirmBox, promptBox, pageHead, emptyState, esc, plural, fmtAgo, debounce, popover } from '../util.js';
import { coverSvg } from '../covers.js';
import { countWords, toCoverData } from '../bookfmt.js';
import { sfx } from '../sound.js';

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const SAFE = { ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'h2', 'h3', 'blockquote', 'hr', 'img'], ALLOWED_ATTR: ['src', 'class', 'alt'] };

function blankBook() {
  const now = new Date().toISOString();
  return { id: newId(), title: 'Новая книга', author: '', annotation: '', genre: '', cover: null, created: now, updated: now, chapters: [{ id: newId(), title: 'Глава 1', html: '<p><br></p>', words: 0, status: 'draft' }] };
}

function cover(meta) {
  const el = h('div.cover');
  if (meta.cover) el.append(h('img', { src: meta.cover, alt: '' }));
  else el.innerHTML = coverSvg({ id: meta.id, title: meta.title, subtitle: meta.author || '', motif: 'orb' }, { label: 'РУКОПИСЬ' });
  return el;
}

// ---------- Список рукописей ----------
async function renderList(el, go) {
  const page = h('div.page', {}, pageHead('Мастерская', 'Мои <em>книги</em>', {
    code: 'WRT', stamp: 'Рукописи',
    tools: [btn('Новая книга', async () => { const b = blankBook(); await window.ark.writer.save(b); go('writer', { id: b.id }); }, { cls: 'primary', ico: 'plus' })],
  }));
  el.append(page);
  const list = await window.ark.writer.list();
  if (!list.length) {
    page.append(emptyState('ЧИСТЫЙ ЛИСТ', 'Здесь будут ваши книги', 'Пишите по главам. Готовую книгу можно прочитать здесь же или сохранить в FB2, EPUB или DOCX.',
      btn('Начать книгу', async () => { const b = blankBook(); await window.ark.writer.save(b); go('writer', { id: b.id }); }, { cls: 'primary', ico: 'feather' })));
    return;
  }
  page.append(h('h2.sec', {}, 'Рукописи ', h('span.count', {}, list.length)),
    h('div.cards', {}, list.map((b) => h('button.card', { onclick: () => go('writer', { id: b.id }) },
      cover(b), h('h3', {}, b.title),
      h('div.meta', {}, h('span', {}, `${b.chapters} ${plural(b.chapters, 'глава', 'главы', 'глав')}`), h('span', {}, h('b', {}, `${b.words} сл.`))),
      h('div.meta', {}, h('span', {}, `изменено ${fmtAgo(b.updated)}`))))));
  window.__stagger && window.__stagger(page);
}

// ---------- Экспорт ----------
function parseBlocks(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const runs = (node, fmt = {}) => [...node.childNodes].flatMap((n) => {
    if (n.nodeType === 3) return n.textContent ? [{ text: n.textContent, ...fmt }] : [];
    if (n.nodeType !== 1) return [];
    const t = n.localName;
    if (t === 'br') return [{ text: '\n', ...fmt }];
    const f = { ...fmt, ...(t === 'b' || t === 'strong' ? { b: true } : {}), ...(t === 'i' || t === 'em' ? { i: true } : {}), ...(t === 'u' ? { u: true } : {}), ...(t === 's' ? { s: true } : {}) };
    return runs(n, f);
  });
  const blocks = [];
  for (const n of doc.body.children) {
    const t = n.localName;
    if (t === 'hr') blocks.push({ type: 'scene' });
    else if (t === 'h2' || t === 'h3') blocks.push({ type: t, runs: runs(n) });
    else if (t === 'blockquote') blocks.push({ type: 'quote', runs: runs(n) });
    else if (n.querySelector && n.querySelector('img') && !n.textContent.trim()) {
      const img = n.localName === 'img' ? n : n.querySelector('img');
      const m = (img.getAttribute('src') || '').match(/^data:image\/(\w+);base64,(.+)$/);
      if (m) blocks.push({ type: 'image', ext: m[1] === 'jpeg' ? 'jpg' : m[1], base64: m[2], w: Math.min(480, img.naturalWidth || 480), h: Math.round(Math.min(480, img.naturalWidth || 480) * ((img.naturalHeight || 320) / (img.naturalWidth || 480))) });
    } else if (n.classList && n.classList.contains('stamp')) blocks.push({ type: 'stamp', runs: runs(n) });
    else if (n.textContent.trim()) blocks.push({ type: 'p', runs: runs(n) });
  }
  return blocks;
}

const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const runsXml = (runs, tags) => (runs || []).map((r) => {
  let t = r.text === '\n' ? (tags.br || ' ') : xml(r.text);
  if (r.i) t = `<${tags.i}>${t}</${tags.i}>`;
  if (r.b) t = `<${tags.b}>${t}</${tags.b}>`;
  if (r.s && tags.s) t = `<${tags.s}>${t}</${tags.s}>`;
  return t;
}).join('');

function toFb2(book) {
  const [first, ...rest] = (book.author || 'Неизвестный автор').split(/\s+/);
  const binaries = [];
  const addBin = (ext, b64) => { const id = `img${binaries.length + 1}.${ext}`; binaries.push(`<binary id="${id}" content-type="image/${ext === 'jpg' ? 'jpeg' : ext}">${b64}</binary>`); return id; };
  const coverM = (book.cover || '').match(/^data:image\/(\w+);base64,(.+)$/);
  const coverId = coverM ? addBin(coverM[1] === 'jpeg' ? 'jpg' : coverM[1], coverM[2]) : null;
  const tags = { i: 'emphasis', b: 'strong', s: 'strikethrough' };
  const sections = book.chapters.map((ch) => {
    const body = parseBlocks(ch.html).map((b) => {
      if (b.type === 'scene') return '<empty-line/><subtitle>* * *</subtitle><empty-line/>';
      if (b.type === 'h2' || b.type === 'h3') return `<subtitle>${runsXml(b.runs, tags)}</subtitle>`;
      if (b.type === 'quote') return `<cite><p>${runsXml(b.runs, tags)}</p></cite>`;
      if (b.type === 'stamp') return `<p><strong>${runsXml(b.runs, { ...tags, b: 'emphasis' })}</strong></p>`;
      if (b.type === 'image') return `<image l:href="#${addBin(b.ext, b.base64)}"/>`;
      return `<p>${runsXml(b.runs, tags)}</p>`;
    }).join('\n');
    return `<section><title><p>${xml(ch.title)}</p></title>\n${body}\n</section>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info><genre>${xml(book.genre || 'prose')}</genre><author><first-name>${xml(first)}</first-name><last-name>${xml(rest.join(' '))}</last-name></author><book-title>${xml(book.title)}</book-title>${book.annotation ? `<annotation>${book.annotation.split(/\n+/).map((p) => `<p>${xml(p)}</p>`).join('')}</annotation>` : ''}${coverId ? `<coverpage><image l:href="#${coverId}"/></coverpage>` : ''}<lang>ru</lang></title-info>
<document-info><author><nickname>${xml(book.author || 'автор')}</nickname></author><program-used>Архив Ишимуры</program-used><date>${new Date().toISOString().slice(0, 10)}</date><id>${book.id}</id><version>1.0</version></document-info>
</description>
<body><title><p>${xml(book.title)}</p></title>
${sections}
</body>
${binaries.join('\n')}
</FictionBook>`;
}

function toEpub(book) {
  const files = [];
  const images = [];
  const tags = { i: 'em', b: 'strong', s: 's', br: '<br/>' };
  const coverM = (book.cover || '').match(/^data:image\/(\w+);base64,(.+)$/);
  if (coverM) { const ext = coverM[1] === 'jpeg' ? 'jpg' : coverM[1]; files.push({ path: `OEBPS/images/cover.${ext}`, base64: coverM[2] }); images.push({ id: 'cover-img', href: `images/cover.${ext}`, type: `image/${ext === 'jpg' ? 'jpeg' : ext}`, props: 'cover-image' }); }
  const page = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ru"><head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;
  const chapters = book.chapters.map((ch, i) => {
    const body = parseBlocks(ch.html).map((b) => {
      if (b.type === 'scene') return '<hr class="scene"/>';
      if (b.type === 'h2' || b.type === 'h3') return `<${b.type}>${runsXml(b.runs, tags)}</${b.type}>`;
      if (b.type === 'quote') return `<blockquote><p>${runsXml(b.runs, tags)}</p></blockquote>`;
      if (b.type === 'stamp') return `<p class="stamp">${runsXml(b.runs, tags)}</p>`;
      if (b.type === 'image') { const n = images.length + 1; const href = `images/img${n}.${b.ext}`; files.push({ path: `OEBPS/${href}`, base64: b.base64 }); images.push({ id: `img${n}`, href, type: `image/${b.ext === 'jpg' ? 'jpeg' : b.ext}` }); return `<p class="pic"><img src="${href}" alt=""/></p>`; }
      return `<p>${runsXml(b.runs, tags)}</p>`;
    }).join('\n');
    files.push({ path: `OEBPS/ch${i + 1}.xhtml`, text: page(ch.title, `<h1>${xml(ch.title)}</h1>\n${body}`) });
    return { id: `ch${i + 1}`, href: `ch${i + 1}.xhtml`, title: ch.title };
  });
  files.push({ path: 'OEBPS/title.xhtml', text: page(book.title, `<div class="title-page"><h1>${xml(book.title)}</h1><p class="author">${xml(book.author)}</p>${book.annotation ? `<p class="ann">${xml(book.annotation)}</p>` : ''}</div>`) });
  files.push({ path: 'OEBPS/nav.xhtml', text: page('Оглавление', `<nav epub:type="toc"><h1>Оглавление</h1><ol>${chapters.map((c) => `<li><a href="${c.href}">${xml(c.title)}</a></li>`).join('')}</ol></nav>`) });
  files.push({ path: 'OEBPS/style.css', text: 'body{font-family:serif;line-height:1.6;margin:0 5%}p{text-indent:1.5em;margin:0 0 .4em}h1{text-align:center;margin:2em 0 1em}hr.scene{border:0;text-align:center}hr.scene:after{content:"* * *"}.stamp{text-indent:0;font-weight:bold}.pic{text-align:center;text-indent:0}.pic img{max-width:100%}.title-page{text-align:center;margin-top:30%}blockquote{margin:1em 2em;font-style:italic}' });
  files.push({ path: 'META-INF/container.xml', text: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' });
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    ...images.map((im) => `<item id="${im.id}" href="${im.href}" media-type="${im.type}"${im.props ? ` properties="${im.props}"` : ''}/>`),
  ].join('');
  files.push({ path: 'OEBPS/content.opf', text: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${book.id}</dc:identifier><dc:title>${xml(book.title)}</dc:title><dc:creator>${xml(book.author || 'Неизвестный автор')}</dc:creator><dc:language>ru</dc:language>${book.annotation ? `<dc:description>${xml(book.annotation)}</dc:description>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>${coverM ? '<meta name="cover" content="cover-img"/>' : ''}</metadata><manifest>${manifest}</manifest><spine><itemref idref="title"/>${chapters.map((c) => `<itemref idref="${c.id}"/>`).join('')}</spine></package>` });
  return { files };
}

function toDocx(book) {
  return { title: book.title, author: book.author, annotation: book.annotation, chapters: book.chapters.map((ch) => ({ title: ch.title, blocks: parseBlocks(ch.html) })) };
}

async function exportBook(book, format) {
  try {
    const data = format === 'fb2' ? { xml: toFb2(book) } : format === 'epub' ? toEpub(book) : toDocx(book);
    const p = await window.ark.writer.exportFile(format, data, book.title);
    if (p) toast('Книга сохранена', p);
  } catch (e) { toast('Не удалось сохранить', e.message, { error: true }); }
}

// Предпросмотр рукописи в читалке — через временную EPUB-копию в свободной полке не нужен:
// читалка умеет открывать рукопись напрямую
export async function writerHtml(id) {
  const book = await window.ark.writer.get(id);
  const html = book.chapters.map((ch) => `<h2>${esc(ch.title)}</h2>\n${window.DOMPurify.sanitize(ch.html, SAFE)}`).join('\n<hr class="chapter">\n');
  return { book, html };
}

// ---------- Редактор ----------
function renderEditor(el, id, go) {
  let book = null;
  let chIdx = -1;   // -1 — глава ещё не загружена в редактор, сохранять нечего
  let dirty = false;
  const savedLbl = h('span.wr-saved', {}, 'Загрузка…');
  const wordsLbl = h('span.wr-words');
  const chList = h('div.wr-chapters');
  const editor = h('div.wr-page.rd-article', { contenteditable: 'true', spellcheck: 'true' });
  const chTitle = h('input.wr-ch-title', { placeholder: 'Название главы' });
  const titleIn = h('input.wr-book-title', { placeholder: 'Название книги' });

  const exec = (cmd, val = null) => { editor.focus(); document.execCommand(cmd, false, val); onInput(); };
  const blockOf = () => {
    const sel = getSelection();
    let n = sel && sel.anchorNode;
    while (n && n.parentNode !== editor) n = n.parentNode;
    return n && n.nodeType === 1 ? n : null;
  };
  const tool = (ico, title, fn) => btn('', (e) => { e.preventDefault(); fn(); }, { ico, cls: 'ghost', title });
  const textTool = (label, title, fn) => h('button.btn.ghost.wr-tt', { title, onmousedown: (e) => e.preventDefault(), onclick: () => { sfx('click'); fn(); } }, label);

  const insertImage = () => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const data = await toCoverData(url, 1200);
      editor.focus();
      document.execCommand('insertHTML', false, `<p class="pic"><img src="${data}" alt=""></p><p><br></p>`);
      onInput();
    };
    inp.click();
  };

  const toolbar = h('div.wr-toolbar.panel', {},
    tool('bold', 'Жирный (Ctrl+B)', () => exec('bold')),
    tool('italic', 'Курсив (Ctrl+I)', () => exec('italic')),
    tool('underline', 'Подчёркнутый (Ctrl+U)', () => exec('underline')),
    h('span.wr-sep'),
    textTool('Абзац', 'Обычный абзац', () => exec('formatBlock', 'p')),
    textTool('H2', 'Заголовок', () => exec('formatBlock', 'h2')),
    textTool('H3', 'Подзаголовок', () => exec('formatBlock', 'h3')),
    textTool('❝', 'Цитата', () => exec('formatBlock', 'blockquote')),
    textTool('Штамп', 'Штамп сцены: «дата, время, место»', () => {
      exec('formatBlock', 'p');
      const b = blockOf();
      if (b) { b.classList.toggle('stamp'); onInput(); }
    }),
    textTool('◆ ◆ ◆', 'Смена сцены', () => exec('insertHTML', '<hr class="scene"><p><br></p>')),
    tool('image', 'Вставить картинку', insertImage),
    h('span.wr-sep'),
    tool('undo', 'Отменить (Ctrl+Z)', () => exec('undo')),
    tool('redo', 'Повторить (Ctrl+Y)', () => exec('redo')),
    h('span', { style: { flex: 1 } }),
    wordsLbl, savedLbl);

  const save = debounce(async () => {
    if (!book || !dirty) return;
    dirty = false;
    savedLbl.textContent = 'Сохранение…';
    await window.ark.writer.save(book);
    savedLbl.textContent = 'Сохранено';
  }, 700);

  function onInput() {
    if (!book) return;
    const ch = book.chapters[chIdx];
    ch.html = editor.innerHTML;
    ch.words = countWords(ch.html);
    dirty = true;
    savedLbl.textContent = 'Изменено';
    drawWords();
    const w = chList.querySelector('.wr-ch.on .w');
    if (w) w.textContent = `${ch.words} сл.`;
    save();
  }

  function drawWords() {
    const total = book.chapters.reduce((a, c) => a + (c.words || 0), 0);
    wordsLbl.textContent = `Глава: ${book.chapters[chIdx].words || 0} · Всего: ${total} ${plural(total, 'слово', 'слова', 'слов')}`;
  }

  function openChapter(i) {
    if (book.chapters[chIdx]) book.chapters[chIdx].html = editor.innerHTML;
    chIdx = i;
    const ch = book.chapters[i];
    editor.innerHTML = window.DOMPurify.sanitize(ch.html || '<p><br></p>', SAFE) || '<p><br></p>';
    chTitle.value = ch.title;
    drawChapters();
    drawWords();
    editor.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
  }

  function drawChapters() {
    chList.innerHTML = '';
    book.chapters.forEach((ch, i) => {
      const row = h(`div.wr-ch${i === chIdx ? '.on' : ''}`, { draggable: true, onclick: () => { if (i !== chIdx) openChapter(i); } },
        h('span.n', {}, String(i + 1).padStart(2, '0')),
        h('div', {}, h('b', {}, ch.title || 'Без названия'), h('span.w', {}, `${ch.words || 0} сл.`)),
        h(`span.st.${ch.status}`, { title: 'Статус: щёлкните, чтобы переключить', onclick: (e) => { e.stopPropagation(); ch.status = ch.status === 'done' ? 'draft' : 'done'; dirty = true; save(); drawChapters(); } }, ch.status === 'done' ? 'готово' : 'черновик'));
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        book.chapters[chIdx].html = editor.innerHTML;
        const curId = book.chapters[chIdx].id;
        const [moved] = book.chapters.splice(from, 1);
        book.chapters.splice(i, 0, moved);
        chIdx = book.chapters.findIndex((c) => c.id === curId);
        dirty = true; save(); drawChapters();
      });
      chList.append(row);
    });
  }

  const metaDialog = () => modal((box, close) => {
    const author = h('input.input', { value: book.author || '', placeholder: 'Имя автора' });
    const genre = h('input.input', { value: book.genre || '', placeholder: 'фантастика, драма…' });
    const ann = h('textarea.textarea', { placeholder: 'О чём книга' }, book.annotation || '');
    let coverData = book.cover;
    const prev = h('div', { style: { width: '110px' } }, cover(book));
    const f = (l, c) => h('div.field', {}, h('label', {}, l), c);
    box.append(h('h2', {}, 'О книге'),
      h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '18px' } },
        h('div', { style: { display: 'grid', gap: '8px', alignContent: 'start' } }, prev,
          btn('Обложка', () => {
            const inp = h('input', { type: 'file', accept: 'image/*' });
            inp.onchange = async () => {
              const fl = inp.files[0]; if (!fl) return;
              const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(fl); });
              coverData = await toCoverData(url, 600);
              prev.replaceChildren(cover({ ...book, cover: coverData }));
            };
            inp.click();
          }, { ico: 'image', cls: 'ghost' })),
        h('div', {}, f('Автор', author), f('Жанр', genre), f('Аннотация', ann))),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить', () => {
        Object.assign(book, { author: author.value.trim(), genre: genre.value.trim(), annotation: ann.value.trim(), cover: coverData });
        dirty = true; save(); close();
      }, { cls: 'primary' })));
  });

  const exportMenu = (anchor) => popover(anchor, (pop, close) => {
    const item = (label, fmt) => h('button.menu-item', { onclick: async () => { close(); book.chapters[chIdx].html = editor.innerHTML; await exportBook(book, fmt); } }, icon('download'), h('span', {}, label));
    pop.append(item('FB2 (для читалок)', 'fb2'), item('EPUB', 'epub'), item('DOCX (Word)', 'docx'),
      h('button.menu-item', {
        onclick: async () => {
          close();
          book.chapters[chIdx].html = editor.innerHTML;
          await window.ark.writer.save(book);
          const rec = await window.ark.writer.toLibrary(toEpub(book), book.title);
          toast('Добавлено в библиотеку', rec && rec.duplicate ? 'Эта версия уже есть на полке' : `«${book.title}» теперь на полке`);
        },
      }, icon('shelf'), h('span', {}, 'Положить копию в библиотеку')));
  }, { align: 'right' });

  const side = h('aside.wr-side.panel', {},
    h('div.wr-side-head', {}, h('b', {}, 'Главы'), btn('', async () => {
      book.chapters[chIdx].html = editor.innerHTML;
      book.chapters.push({ id: newId(), title: `Глава ${book.chapters.length + 1}`, html: '<p><br></p>', words: 0, status: 'draft' });
      dirty = true; save();
      openChapter(book.chapters.length - 1);
      chTitle.focus(); chTitle.select();
    }, { ico: 'plus', cls: 'ghost', title: 'Новая глава' })),
    chList,
    h('div.wr-side-foot', {},
      btn('Удалить главу', async () => {
        if (book.chapters.length < 2) return toast('Последнюю главу удалить нельзя');
        if (!(await confirmBox('Удалить главу?', `«${book.chapters[chIdx].title}» будет удалена.`, { ok: 'Удалить', danger: true }))) return;
        book.chapters.splice(chIdx, 1);
        chIdx = Math.max(0, chIdx - 1);
        dirty = true; save();
        const i = chIdx; chIdx = -1; openChapter(i);
      }, { ico: 'trash', cls: 'ghost danger' })));

  const top = h('div.wr-top', {},
    btn('', () => go('writer'), { ico: 'back', cls: 'ghost', title: 'К списку книг' }),
    titleIn,
    btn('О книге', metaDialog, { ico: 'info', cls: 'ghost' }),
    btn('Читать', async () => { book.chapters[chIdx].html = editor.innerHTML; await window.ark.writer.save(book); go('reader', { writer: book.id }); }, { ico: 'book', cls: 'ghost' }),
    btn('Экспорт', (e) => exportMenu(e.currentTarget), { ico: 'download', cls: 'primary' }),
    btn('', async () => {
      if (!(await confirmBox('Удалить книгу?', `«${book.title}» и все её главы будут удалены безвозвратно.`, { ok: 'Удалить', danger: true }))) return;
      await window.ark.writer.remove(book.id);
      go('writer');
    }, { ico: 'trash', cls: 'ghost danger', title: 'Удалить книгу' }));

  el.append(h('div.wr', {}, top, h('div.wr-body', {}, side, h('div.wr-main', {}, toolbar, h('div.wr-scroll', {}, h('div.wr-sheet', {}, chTitle, editor))))));

  editor.addEventListener('input', onInput);
  editor.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const clean = html ? window.DOMPurify.sanitize(html, SAFE) : text.split(/\r?\n/).map((l) => `<p>${esc(l) || '<br>'}</p>`).join('');
    document.execCommand('insertHTML', false, clean);
    onInput();
  });
  chTitle.addEventListener('input', () => { book.chapters[chIdx].title = chTitle.value; dirty = true; save(); const b = chList.querySelector('.wr-ch.on b'); if (b) b.textContent = chTitle.value || 'Без названия'; });
  titleIn.addEventListener('input', () => { book.title = titleIn.value; dirty = true; save(); });
  const onKey = (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); dirty = true; save(); }
  };
  document.addEventListener('keydown', onKey);

  (async () => {
    try { book = await window.ark.writer.get(id); } catch { toast('Книга не найдена', '', { error: true }); go('writer'); return; }
    document.execCommand('defaultParagraphSeparator', false, 'p');
    titleIn.value = book.title;
    savedLbl.textContent = 'Сохранено';
    openChapter(0);
    editor.focus();
  })();

  return () => {
    document.removeEventListener('keydown', onKey);
    if (book) { book.chapters[chIdx] && (book.chapters[chIdx].html = editor.innerHTML); if (dirty) window.ark.writer.save(book); }
  };
}

export function renderWriter(el, params, { go }) {
  if (params.id) return renderEditor(el, params.id, go);
  renderList(el, go);
}
