import { h, icon, btn, toast, popover, closePopover, readMinutes, fmtAgo, range, toggle, promptBox, $$ } from '../util.js';
import { state, storyById, seriesById, contentUrl, getProgress, setProgress, addBookmark, addQuote, removeMark, setSetting, on, readingOrder, modulePresets, applyModule, saveModulePreset, deleteModulePreset, libBook } from '../state.js';
import { bookHtml } from '../bookfmt.js';
import { writerHtml } from './writer.js';
import { FONTS, PAPERS, moduleData } from '../themes.js';
import { sfx } from '../sound.js';

const FOCUS = [['off', 'Выключен'], ['paragraph', 'Текущий абзац'], ['ruler', 'Линейка']];
const PAGE_ANIM = [['flip', '3D-перелистывание'], ['slide', 'Сдвиг'], ['fade', 'Растворение'], ['none', 'Мгновенно']];

// Описание читаемого документа: рассказ архива или книга из библиотеки
function storyDoc(id, go) {
  const story = storyById(id);
  if (!story) return null;
  window.ark.content.seen('stories', [story.id]);
  const series = story.series ? seriesById(story.series) : null;
  const order = readingOrder();
  const nx = order[order.findIndex((s) => s.id === story.id) + 1];
  return {
    key: story.id,
    title: story.title,
    words: story.words,
    titleSub: [series ? `${series.title}${story.chapter ? ` · глава ${story.chapter}` : ''}` : story.subtitle, story.year && `год ${story.year}`].filter(Boolean).join(' · ') || 'Запись архива',
    eyebrow: series ? `${series.title}${story.chapter ? ` · Глава ${story.chapter}` : ''}` : 'Запись бортового архива',
    sub: [story.subtitle, story.year && `${story.year} год`].filter(Boolean).join(' · '),
    tocLabel: 'Сцены',
    endCode: '— конец передачи —',
    async load() {
      const html = await window.ark.content.read(story.file);
      const dir = story.file.split('/').slice(0, -1).join('/');
      return { html, resolve: (src) => contentUrl(`${dir}/${src}`) };
    },
    next: nx ? { title: `Следующая запись: «${nx.title}»`, open: () => go('reader', { id: nx.id }) } : null,
    lastText: ['Это последняя запись в архиве', 'Когда выйдет новая, архив сообщит.'],
    back: () => (series ? go('series', { id: series.id }) : go('stories')),
  };
}

function libraryDoc(id, go) {
  const b = libBook(id);
  if (!b) return null;
  window.ark.library.update('book', id, { lastOpened: new Date().toISOString() });
  return {
    key: `lib:${b.id}`,
    title: b.title,
    words: b.words || 0,
    titleSub: [(b.authors || []).join(', '), b.series && `${b.series}${b.seriesNum ? ` #${b.seriesNum}` : ''}`].filter(Boolean).join(' · ') || b.format.toUpperCase(),
    eyebrow: b.series ? `${b.series}${b.seriesNum ? ` · книга ${b.seriesNum}` : ''}` : (b.authors || []).join(', ') || 'Библиотека',
    sub: b.series ? (b.authors || []).join(', ') : '',
    tocLabel: 'Главы',
    endCode: '— конец книги —',
    async load() {
      const r = await bookHtml(b);
      if (!b.words || b.words !== r.words) window.ark.library.update('book', id, { words: r.words });
      this.words = r.words;
      return { html: r.html, resolve: (src) => src };
    },
    next: null,
    lastText: ['Книга дочитана', 'Вернитесь в библиотеку, чтобы выбрать следующую.'],
    back: () => go('library'),
  };
}

function writerDoc(id, go) {
  return {
    key: `wr:${id}`,
    title: 'Рукопись',
    words: 0,
    titleSub: 'Предпросмотр рукописи',
    eyebrow: 'Рукопись',
    sub: '',
    tocLabel: 'Главы',
    endCode: '— конец рукописи —',
    async load() {
      const { book, html } = await writerHtml(id);
      this.title = book.title;
      this.sub = book.author || '';
      this.words = (book.chapters || []).reduce((a, c) => a + (c.words || 0), 0);
      return { html, resolve: (src) => src };
    },
    next: { title: 'Вернуться к редактированию', open: () => go('writer', { id }) },
    lastText: ['', ''],
    back: () => go('writer', { id }),
  };
}

export function openReader(root, params, { go }) {
  const doc = params.lib ? libraryDoc(params.lib, go) : params.writer ? writerDoc(params.writer, go) : storyDoc(params.id, go);
  if (!doc) { go(params.lib ? 'library' : 'stories', {}, { replace: true }); return; }
  const story = { id: doc.key, title: doc.title };

  const cfg = () => state.settings.reader;
  const anim = () => state.settings.anim;
  const animOn = () => state.settings.theme.effects.animations;

  let mode = cfg().mode;
  let blocks = [];
  let cur = 0;
  let frac = 0;
  let paged = null;       // { page, pages, perView, step, colW, gap, colOf }
  let sideOpen = null;
  let flipping = false;
  const disposers = [];

  // ---------- Каркас ----------
  const titleSub = doc.titleSub;
  const modeGroup = h('div.btn-group');
  const autoBtn = btn('', () => toggleAuto(), { ico: 'play', cls: 'ghost', title: 'Автопрокрутка (A)' });
  const focusBtn = btn('', () => cycleFocus(), { ico: 'eye', cls: 'ghost', title: 'Режим фокуса (F)' });
  const bar = h('div.reader-bar', {},
    btn('', back, { ico: 'back', cls: 'ghost', title: 'Назад (Esc)' }),
    h('div.title', {}, h('b', {}, story.title), h('span', {}, titleSub || 'Запись архива')),
    btn('', () => toggleSide('toc'), { ico: 'list', cls: 'ghost', title: 'Сцены, закладки и цитаты' }),
    btn('', () => openSearch(), { ico: 'search', cls: 'ghost', title: 'Поиск по тексту (Ctrl+F)' }),
    btn('', bookmarkHere, { ico: 'bookmark', cls: 'ghost', title: 'Закладка (B)' }),
    focusBtn,
    autoBtn,
    btn('', (e) => typoMenu(e.currentTarget), { ico: 'type', cls: 'ghost', title: 'Оформление и пресеты чтения' }),
    modeGroup,
    btn('', () => window.ark.win.fullscreen(), { ico: 'fullscreen', cls: 'ghost', title: 'Полный экран (F11)' }));
  const body = h('div.reader-body');
  const pct = h('span', {}, '0%');
  const track = h('div.track', { title: 'Перейти' });
  const trackFill = h('i');
  track.append(trackFill);
  const pageInfo = h('span');
  const timeLeft = h('span');
  const autoInfo = h('span.rd-auto-info');
  const foot = h('div.reader-foot', {}, pct, track, autoInfo, pageInfo, timeLeft);
  const ruler = h('div.rd-ruler');
  const reader = h('div.reader', {}, bar, body, foot);
  root.append(reader);

  function drawModeGroup() {
    modeGroup.innerHTML = '';
    for (const [m, label] of [['scroll', 'Лента'], ['paged', 'Страницы'], ['spread', 'Разворот']]) {
      modeGroup.append(btn(label, () => setSetting('reader.mode', m), { cls: m === mode ? 'on' : '' }));
    }
    autoBtn.disabled = mode !== 'scroll';
    autoBtn.title = mode === 'scroll' ? 'Автопрокрутка (A)' : 'Автопрокрутка доступна в режиме «Лента»';
  }
  drawModeGroup();

  // ---------- Текст ----------
  const article = h('article.rd-article');
  let contentReady = false;

  async function load() {
    let loaded;
    body.append(h('div.rd-loading', {}, h('span.orb'), h('span', {}, 'Загрузка текста…')));
    try {
      loaded = await doc.load();
    } catch (e) {
      body.innerHTML = '';
      body.append(h('div.empty', {}, h('h3', {}, 'Не удалось открыть текст'), h('p', {}, e && e.message ? e.message : 'Файл не найден или повреждён.')));
      return;
    }
    if (!root.isConnected) return;
    bar.querySelector('.title b').textContent = doc.title;
    const clean = window.DOMPurify.sanitize(loaded.html, { FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed'], FORBID_ATTR: ['style'], ALLOWED_URI_REGEXP: /^(?:(?:https?|file|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i });
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    for (const img of tpl.content.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (!/^(data|file|https?):/.test(src)) img.src = loaded.resolve(src);
      img.loading = 'lazy';
    }
    for (const a of tpl.content.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^https?:/.test(href)) a.addEventListener('click', (e) => { e.preventDefault(); window.ark.app.openExternal(href); });
      else a.removeAttribute('href');
    }
    article.append(h('header.rd-head', {},
      h('div.eyebrow', {}, doc.eyebrow),
      h('h1', {}, doc.title),
      h('div.sub', {}, doc.sub),
      h('div.line')));
    blocks = [...tpl.content.children];
    blocks.forEach((b, i) => { b.dataset.i = i; });
    body.innerHTML = '';
    article.append(...blocks);
    article.append(endBlock());
    contentReady = true;
    mount();
    applyFocus();
    const p = getProgress(story.id);
    const target = params.para != null ? Number(params.para) : p ? p.para || 0 : 0;
    requestAnimationFrame(() => {
      gotoPara(target, { flash: params.para != null, instant: true });
      if (params.q) openSearch(params.q);
      article.classList.add('rd-in');
    });
  }

  function endBlock() {
    return h('div.rd-end', {},
      h('div.code', {}, doc.endCode),
      doc.next ? h('h3', {}, doc.next.title) : h('h3', {}, doc.lastText[0]),
      doc.next ? btn('Читать дальше', doc.next.open, { cls: 'primary', ico: 'right' })
        : h('p', { style: { color: 'var(--dim)' } }, doc.lastText[1]));
  }

  // ---------- Режимы ----------
  let scroller = null;
  let clip = null;

  function mount() {
    stopAuto();
    body.innerHTML = '';
    article.style.cssText = '';
    paged = null;
    if (mode === 'scroll') {
      scroller = h('div.rd-scroll', {}, article);
      scroller.addEventListener('scroll', onScroll, { passive: true });
      scroller.addEventListener('wheel', onSmoothWheel, { passive: false });
      body.append(scroller);
      smooth.target = 0;
    } else {
      scroller = null;
      clip = h('div.rd-clip', {}, article);
      const wrap = h(`div.rd-paged${mode === 'spread' ? '.spread' : ''}`, {},
        h('div.rd-zone.prev', { onclick: () => turn(-1) }),
        clip,
        h('div.rd-zone.next', { onclick: () => turn(1) }));
      wrap.addEventListener('wheel', onWheel, { passive: true });
      body.append(wrap);
      layoutPages();
    }
    body.append(ruler);
    drawMarks();
    drawModeGroup();
  }

  function layoutPages() {
    // На телефоне поля уже, а разворот в две страницы включается только на широком экране
    const narrow = body.clientWidth < 700;
    const perView = mode === 'spread' && !narrow ? 2 : 1;
    const gap = narrow ? 36 : 64;
    const W = body.clientWidth - (narrow ? 36 : 140);
    const colW = Math.floor(Math.max(narrow ? 200 : 260, perView === 2 ? Math.min((W - gap) / 2, cfg().width) : Math.min(W, cfg().width)));
    const width = perView * colW + (perView - 1) * gap;
    clip.style.width = `${width}px`;
    Object.assign(article.style, { width: `${width}px`, columnCount: perView, columnGap: `${gap}px`, position: 'relative', transform: 'translateX(0)' });
    const step = colW + gap;
    const cols = Math.max(1, Math.round((article.scrollWidth + gap) / step));
    const pages = Math.max(1, Math.ceil(cols / perView));
    const colOf = blocks.map((b) => Math.floor((b.offsetLeft + 2) / step));
    paged = { page: 0, pages, perView, step, colW, gap, colOf };
  }

  function setPageTransform(p, how) {
    const x = -p * paged.perView * paged.step;
    article.style.transition = how === 'slide' && animOn() ? '' : 'none';
    article.style.transform = `translateX(${x}px)`;
  }

  function showPage(p, { save = true, how = 'none' } = {}) {
    if (!paged) return;
    paged.page = Math.max(0, Math.min(paged.pages - 1, p));
    setPageTransform(paged.page, how);
    const firstCol = paged.page * paged.perView;
    const idx = paged.colOf.findIndex((c) => c >= firstCol);
    cur = idx < 0 ? blocks.length - 1 : idx;
    frac = paged.pages > 1 ? paged.page / (paged.pages - 1) : 1;
    updateFoot();
    if (save) saveProgress();
  }

  function turn(d) {
    if (!paged || flipping) return;
    const target = Math.max(0, Math.min(paged.pages - 1, paged.page + d));
    if (target === paged.page) return;
    sfx('page');
    const how = animOn() ? anim().page : 'none';
    if (how === 'flip') flipTurn(d, target);
    else if (how === 'fade') fadeTurn(target);
    else showPage(target, { how });
  }

  function fadeTurn(target) {
    flipping = true;
    const out = article.animate([{ opacity: 1 }, { opacity: 0, filter: 'blur(2px)' }], { duration: 140 / speed(), easing: 'ease-in' });
    out.onfinish = () => {
      showPage(target);
      article.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 260 / speed(), easing: 'ease-out' });
      flipping = false;
    };
  }

  const speed = () => Number(state.settings.theme.effects.speed) || 1;

  // Копия страницы (колонки) для анимации перелистывания
  function pageClip(col, x) {
    const wrap = h('div.rd-pageclip', { style: { left: `${x}px`, width: `${paged.colW}px` } });
    const clone = article.cloneNode(true);
    clone.style.transition = 'none';
    clone.style.transform = `translateX(${-col * paged.step}px)`;
    clone.classList.remove('rd-in');
    wrap.append(clone, h('div.rd-shade'));
    return wrap;
  }

  function flipTurn(d, target) {
    flipping = true;
    const { perView, colW, gap, step, page } = paged;
    const dur = 720 / speed();
    const easing = 'cubic-bezier(.45,.05,.25,1)';
    const temp = [];
    const done = () => { temp.forEach((t) => t.remove()); flipping = false; };

    if (perView === 1) {
      if (d > 0) {
        const sheet = pageClip(page, 0);
        sheet.classList.add('rd-sheet', 'single');
        clip.append(sheet); temp.push(sheet);
        showPage(target);
        const a = sheet.animate([
          { transform: 'perspective(2000px) rotateY(0deg)', opacity: 1 },
          { transform: 'perspective(2000px) rotateY(-70deg)', opacity: 1, offset: 0.7 },
          { transform: 'perspective(2000px) rotateY(-95deg)', opacity: 0 },
        ], { duration: dur, easing });
        sheet.querySelector('.rd-shade').animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: dur, easing });
        a.onfinish = done;
      } else {
        const sheet = pageClip(target, 0);
        sheet.classList.add('rd-sheet', 'single');
        clip.append(sheet); temp.push(sheet);
        const a = sheet.animate([
          { transform: 'perspective(2000px) rotateY(-95deg)', opacity: 0 },
          { transform: 'perspective(2000px) rotateY(-70deg)', opacity: 1, offset: 0.3 },
          { transform: 'perspective(2000px) rotateY(0deg)', opacity: 1 },
        ], { duration: dur, easing });
        sheet.querySelector('.rd-shade').animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: dur, easing });
        a.onfinish = () => { showPage(target); done(); };
      }
      return;
    }

    // Разворот: лист переворачивается вокруг корешка
    const leftCol = page * 2, rightCol = page * 2 + 1;
    const sheet = h('div.rd-sheet.spread');
    let front, backFace, cover;
    if (d > 0) {
      cover = pageClip(leftCol, 0);                       // текущая левая остаётся, пока лист не ляжет
      front = pageClip(rightCol, 0);
      backFace = pageClip(target * 2, 0);
      Object.assign(sheet.style, { left: `${step}px`, width: `${colW}px`, transformOrigin: `${-gap / 2}px 50%` });
    } else {
      cover = pageClip(rightCol, step);
      front = pageClip(leftCol, 0);
      backFace = pageClip(target * 2 + 1, 0);
      Object.assign(sheet.style, { left: '0px', width: `${colW}px`, transformOrigin: `${colW + gap / 2}px 50%` });
    }
    front.classList.add('face', 'front');
    backFace.classList.add('face', 'back');
    sheet.append(front, backFace);
    clip.append(cover, sheet);
    temp.push(cover, sheet);
    showPage(target);
    const to = d > 0 ? -180 : 180;
    const a = sheet.animate([
      { transform: 'perspective(2200px) rotateY(0deg)' },
      { transform: `perspective(2200px) rotateY(${to / 2}deg) translateZ(40px)`, offset: 0.5 },
      { transform: `perspective(2200px) rotateY(${to}deg)` },
    ], { duration: dur * 1.1, easing });
    front.querySelector('.rd-shade').animate([{ opacity: 0 }, { opacity: 0.6, offset: 0.5 }, { opacity: 0.6 }], { duration: dur * 1.1, easing });
    backFace.querySelector('.rd-shade').animate([{ opacity: 0.6 }, { opacity: 0.6, offset: 0.5 }, { opacity: 0 }], { duration: dur * 1.1, easing });
    a.onfinish = done;
  }

  let wheelLock = 0;
  function onWheel(e) {
    const now = Date.now();
    if (now - wheelLock < 300 || Math.abs(e.deltaY) < 8) return;
    wheelLock = now;
    turn(e.deltaY > 0 ? 1 : -1);
  }

  // ---------- Плавная прокрутка и автопрокрутка ----------
  const smooth = { target: 0, raf: null, last: 0 };
  let auto = false;

  function maxScroll() { return scroller ? scroller.scrollHeight - scroller.clientHeight : 0; }
  function smoothTo(y) {
    if (!scroller) return;
    smooth.target = Math.max(0, Math.min(maxScroll(), y));
    if (!anim().smoothScroll || !animOn()) { scroller.scrollTop = smooth.target; return; }
    if (!smooth.raf) { smooth.last = performance.now(); smooth.raf = requestAnimationFrame(smoothLoop); }
  }
  function smoothLoop(now) {
    smooth.raf = null;
    if (!scroller) return;
    const dt = Math.min(0.05, (now - smooth.last) / 1000);
    smooth.last = now;
    if (auto) {
      smooth.target = Math.min(maxScroll(), smooth.target + cfg().autoSpeed * dt);
      if (smooth.target >= maxScroll()) stopAuto();
    }
    const diff = smooth.target - scroller.scrollTop;
    if (Math.abs(diff) > 0.5) scroller.scrollTop += auto ? diff : diff * Math.min(1, dt * 11);
    if (Math.abs(diff) > 0.5 || auto) smooth.raf = requestAnimationFrame(smoothLoop);
  }
  function onSmoothWheel(e) {
    if (!anim().smoothScroll || !animOn() || e.ctrlKey) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? scroller.clientHeight : 1;
    const base = smooth.raf ? smooth.target : scroller.scrollTop;
    smoothTo(base + e.deltaY * k * 1.1);
  }
  function toggleAuto() {
    if (mode !== 'scroll') return;
    if (auto) stopAuto(); else startAuto();
  }
  function startAuto() {
    auto = true;
    autoBtn.classList.add('on');
    autoBtn.replaceChildren(icon('pause'));
    smooth.target = scroller.scrollTop;
    smooth.last = performance.now();
    if (!smooth.raf) smooth.raf = requestAnimationFrame(smoothLoop);
    drawAutoInfo();
  }
  function stopAuto() {
    if (!auto) return;
    auto = false;
    autoBtn.classList.remove('on');
    autoBtn.replaceChildren(icon('play'));
    drawAutoInfo();
  }
  function drawAutoInfo() {
    autoInfo.innerHTML = '';
    if (!auto) return;
    autoInfo.append('Автопрокрутка ',
      h('button', { onclick: () => setSetting('reader.autoSpeed', Math.max(5, cfg().autoSpeed - 5)) }, '−'),
      h('b', {}, ` ${cfg().autoSpeed} `),
      h('button', { onclick: () => setSetting('reader.autoSpeed', Math.min(300, cfg().autoSpeed + 5)) }, '+'));
  }

  function onScroll() {
    if (!scroller) return;
    if (!smooth.raf) smooth.target = scroller.scrollTop;
    const max = maxScroll();
    frac = max > 0 ? scroller.scrollTop / max : 1;
    const top = scroller.scrollTop + scroller.clientHeight * 0.35;
    let lo = 0, hi = blocks.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].offsetTop <= top) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans !== cur) { cur = ans; markFocus(); } else cur = ans;
    updateFoot();
    saveProgress();
  }

  function gotoPara(i, { flash = false, instant = false } = {}) {
    if (!contentReady) return;
    i = Math.max(0, Math.min(blocks.length - 1, i || 0));
    const el = blocks[i];
    if (!el) return;
    if (mode === 'scroll') {
      const y = i === 0 ? 0 : el.offsetTop - scroller.clientHeight * 0.3;
      if (instant) { scroller.scrollTop = y; smooth.target = scroller.scrollTop; onScroll(); } else smoothTo(y);
      cur = i;
      markFocus();
    } else {
      showPage(Math.floor(paged.colOf[i] / paged.perView), { how: instant ? 'none' : 'slide' });
    }
    if (flash) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  function seekFrac(f) {
    if (mode === 'scroll') smoothTo(f * maxScroll());
    else showPage(Math.round(f * (paged.pages - 1)), { how: 'slide' });
  }
  track.addEventListener('click', (e) => {
    const r = track.getBoundingClientRect();
    seekFrac((e.clientX - r.left) / r.width);
  });

  let saveT;
  function saveProgress() {
    clearTimeout(saveT);
    saveT = setTimeout(() => setProgress(story.id, { frac, para: cur }), 400);
  }

  function updateFoot() {
    pct.textContent = `${Math.round(frac * 100)}%`;
    trackFill.style.width = `${frac * 100}%`;
    pageInfo.textContent = paged ? `стр. ${paged.page + 1} / ${paged.pages}` : '';
    const left = Math.round(readMinutes(doc.words) * (1 - frac));
    timeLeft.textContent = frac >= 0.99 ? 'Прочитано' : `≈ ${left} мин до конца`;
  }

  function drawMarks() {
    $$('b', track).forEach((b) => b.remove());
    for (const m of state.reader.bookmarks.filter((b) => b.story === story.id)) {
      track.append(h('b', { style: { left: `${(m.frac || 0) * 100}%` }, title: m.excerpt }));
    }
  }

  // ---------- Режим фокуса ----------
  function applyFocus() {
    const f = cfg().focus;
    article.classList.toggle('focus-para', f === 'paragraph');
    reader.classList.toggle('focus-ruler', f === 'ruler');
    focusBtn.classList.toggle('on', f !== 'off');
    markFocus();
  }
  function markFocus() {
    if (cfg().focus !== 'paragraph') return;
    for (const b of article.querySelectorAll('.cur')) b.classList.remove('cur');
    if (blocks[cur]) blocks[cur].classList.add('cur');
  }
  function cycleFocus() {
    const i = FOCUS.findIndex(([k]) => k === cfg().focus);
    const nextF = FOCUS[(i + 1) % FOCUS.length];
    setSetting('reader.focus', nextF[0]);
    toast('Режим фокуса', nextF[1], { ms: 1600 });
  }
  // В страничных режимах фокус следует за мышью
  article.addEventListener('mouseover', (e) => {
    if (cfg().focus !== 'paragraph' || mode === 'scroll') return;
    const b = e.target.closest('[data-i]');
    if (b && article.contains(b)) { cur = Number(b.dataset.i); markFocus(); }
  });
  body.addEventListener('mousemove', (e) => {
    if (cfg().focus !== 'ruler') return;
    const r = body.getBoundingClientRect();
    const lh = cfg().fontSize * cfg().lineHeight;
    ruler.style.height = `${lh * 2.2}px`;
    ruler.style.transform = `translateY(${e.clientY - r.top - lh * 1.1}px)`;
  });

  // ---------- Закладки и цитаты ----------
  function bookmarkHere() {
    const el = blocks[cur];
    addBookmark({ story: story.id, para: cur, frac, excerpt: (el ? el.textContent : '').slice(0, 160) });
    drawMarks();
    if (sideOpen) drawSide();
    toast('Закладка сохранена', `${Math.round(frac * 100)}% — «${story.title}»`);
  }

  const quotePop = h('div.quote-pop.panel', { style: { display: 'none' } });
  document.getElementById('layers').append(quotePop);
  disposers.push(() => quotePop.remove());

  function onSelect() {
    const sel = getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 3 || !article.contains(sel.anchorNode)) { quotePop.style.display = 'none'; return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    const para = Number((node.closest('[data-i]') || {}).dataset?.i ?? cur);
    quotePop.innerHTML = '';
    quotePop.append(
      btn('Цитата', () => { addQuote({ story: story.id, para, text }); quotePop.style.display = 'none'; sel.removeAllRanges(); if (sideOpen) drawSide(); toast('Цитата сохранена', text.slice(0, 90)); }, { ico: 'quote' }),
      btn('', () => { navigator.clipboard.writeText(text); quotePop.style.display = 'none'; toast('Скопировано'); }, { ico: 'file', title: 'Копировать' }));
    quotePop.style.display = 'flex';
    const pr = quotePop.getBoundingClientRect();
    quotePop.style.left = `${Math.min(innerWidth - pr.width - 10, Math.max(10, rect.left + rect.width / 2 - pr.width / 2))}px`;
    quotePop.style.top = `${Math.max(10, rect.top - pr.height - 8)}px`;
  }
  article.addEventListener('mouseup', () => setTimeout(onSelect, 0));
  // Выделение пальцем: ждём, пока пользователь перестанет двигать маркеры выделения
  let selT;
  const onSelChange = () => { clearTimeout(selT); selT = setTimeout(onSelect, 450); };
  document.addEventListener('selectionchange', onSelChange);
  disposers.push(() => { document.removeEventListener('selectionchange', onSelChange); clearTimeout(selT); });
  const hidePop = (e) => { if (!quotePop.contains(e.target)) quotePop.style.display = 'none'; };
  document.addEventListener('pointerdown', hidePop);
  disposers.push(() => document.removeEventListener('pointerdown', hidePop));

  // ---------- Боковая панель ----------
  let side = null;
  function toggleSide(tab) {
    if (side && sideOpen === tab) {
      const s = side; side = null; sideOpen = null;
      s.classList.add('out');
      setTimeout(() => s.remove(), 280);
      reader.classList.remove('peek');
      return;
    }
    sideOpen = tab;
    drawSide();
  }
  function drawSide() {
    const existed = !!side;
    if (side) side.remove();
    const tabs = [['toc', doc.tocLabel], ['bookmarks', 'Закладки'], ['quotes', 'Цитаты']];
    const list = h('div.list');
    side = h(`aside.rd-side${existed ? '.no-anim' : ''}`, {},
      h('header', {}, h('b', {}, story.title), btn('', () => toggleSide(sideOpen), { ico: 'close', cls: 'ghost' })),
      h('div.tabs', {}, tabs.map(([t, label]) => btn(label, () => { sideOpen = t; drawSide(); }, { cls: t === sideOpen ? 'on' : 'ghost' }))),
      list);
    if (sideOpen === 'toc') {
      const scenes = blocks.filter((b) => b.matches('.stamp, h2, h3, h4') && b.textContent.trim());
      if (!scenes.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'В этой записи нет размеченных сцен.'));
      scenes.forEach((s, k) => {
        const i = Number(s.dataset.i);
        const nextI = scenes[k + 1] ? Number(scenes[k + 1].dataset.i) : Infinity;
        list.append(h(`div.toc-item${i <= cur && cur < nextI ? '.on' : ''}`, { onclick: () => gotoPara(i, { flash: true }) }, s.textContent));
      });
    } else {
      const items = state.reader[sideOpen].filter((m) => m.story === story.id);
      if (!items.length) list.append(h('p', { style: { color: 'var(--dim)', lineHeight: 1.6 } }, sideOpen === 'quotes' ? 'Выделите фрагмент текста, чтобы сохранить цитату.' : 'Нажмите «Закладка» на панели.'));
      for (const m of items) {
        list.append(h('div.entry', { onclick: () => gotoPara(m.para, { flash: true }) },
          h('small', {}, `${sideOpen === 'quotes' ? 'Цитата' : `${Math.round((m.frac || 0) * 100)}%`} · ${fmtAgo(m.at)}`),
          h('p', {}, m.text || m.excerpt),
          btn('', (e) => { e.stopPropagation(); removeMark(sideOpen, m.id); drawMarks(); drawSide(); }, { ico: 'trash', cls: 'ghost del', title: 'Удалить' })));
      }
    }
    reader.append(side);
    reader.classList.add('peek');
  }

  // ---------- Поиск ----------
  let searchBox = null;
  let searchState = null;
  function clearHits() {
    for (const m of $$('mark.hit', article)) m.replaceWith(document.createTextNode(m.textContent));
    article.normalize();
  }
  function openSearch(initial = '') {
    if (searchBox) { searchBox.querySelector('input').focus(); return; }
    const input = h('input.input', { placeholder: 'Найти в тексте…', value: initial });
    const cnt = h('span.cnt');
    searchState = { hits: [], i: -1 };
    const run = () => {
      clearHits();
      searchState = { hits: [], i: -1 };
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { cnt.textContent = ''; return; }
      for (const b of blocks) {
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (const node of nodes) {
          let t = node.textContent, idx, n = node;
          while ((idx = t.toLowerCase().indexOf(q)) >= 0) {
            const after = n.splitText(idx);
            n = after.splitText(q.length);
            const mark = h('mark.hit', {}, after.textContent);
            after.replaceWith(mark);
            searchState.hits.push(mark);
            t = n.textContent;
          }
        }
      }
      if (mode !== 'scroll') layoutPages();
      step(1);
    };
    const step = (d) => {
      const hs = searchState.hits;
      cnt.textContent = hs.length ? '' : 'нет';
      if (!hs.length) return;
      if (searchState.i >= 0) hs[searchState.i].classList.remove('cur');
      searchState.i = (searchState.i + d + hs.length) % hs.length;
      const m = hs[searchState.i];
      m.classList.add('cur');
      cnt.textContent = `${searchState.i + 1} / ${hs.length}`;
      if (mode === 'scroll') {
        let y = 0, n = m;
        while (n && n !== article) { y += n.offsetTop; n = n.offsetParent; }
        smoothTo(y - scroller.clientHeight / 2);
      } else {
        const col = Math.floor(m.offsetLeft / paged.step);
        showPage(Math.floor(col / paged.perView), { how: 'slide' });
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
    });
    let t;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
    searchBox = h('div.rd-search.panel', {}, input, cnt,
      btn('', () => step(-1), { ico: 'left', cls: 'ghost', title: 'Назад (Shift+Enter)' }),
      btn('', () => step(1), { ico: 'right', cls: 'ghost', title: 'Далее (Enter)' }),
      btn('', closeSearch, { ico: 'close', cls: 'ghost' }));
    body.append(searchBox);
    reader.classList.add('peek');
    setTimeout(() => input.focus(), 20);
    if (initial) run();
  }
  function closeSearch() {
    if (!searchBox) return;
    searchBox.remove();
    searchBox = null;
    const keep = cur;
    clearHits();
    if (mode !== 'scroll') { layoutPages(); gotoPara(keep, { instant: true }); }
  }

  // ---------- Оформление и пресеты чтения ----------
  function typoMenu(anchor) {
    popover(anchor, (pop, close) => {
      pop.classList.add('typo');
      const r = cfg();
      const row = (label, ctl) => h('div.s-row', {}, h('label', {}, label), h('div.ctl', {}, ctl));
      const sel = (path, opts, value) => {
        const s = h('select.select', {}, opts.map(([v, t]) => h('option', { value: v, selected: String(value) === String(v) }, t)));
        s.addEventListener('change', () => setSetting(path, s.value === '' ? null : s.value));
        return s;
      };
      const presets = h('div.chips.typo-presets');
      const drawPresets = () => {
        presets.innerHTML = '';
        for (const p of modulePresets('reader')) {
          const chip = h('button.chip', { onclick: () => { sfx('click'); applyModule('reader', p); close(); } }, p.name);
          if (!p.builtin) chip.append(h('span.chip-x', { title: 'Удалить пресет', onclick: (e) => { e.stopPropagation(); deleteModulePreset('reader', p.id); drawPresets(); } }, '×'));
          presets.append(chip);
        }
        presets.append(h('button.chip.add', {
          onclick: async () => {
            const name = await promptBox('Название пресета чтения', { value: `Мой пресет ${(state.presets.modules.reader || []).length + 1}` });
            if (!name) return;
            saveModulePreset('reader', name, moduleData(state.settings, 'reader'));
            toast('Пресет сохранён', name);
          },
        }, '+ сохранить текущее'));
      };
      drawPresets();
      pop.append(
        h('div.typo-title', {}, 'Пресеты чтения'), presets,
        h('div.typo-title', {}, 'Текст'),
        row('Шрифт', sel('reader.font', [['', 'Как в теме'], ...[...FONTS.map(([n]) => n), ...state.settings.customFonts.map((f) => f.family)].map((n) => [n, n])], r.font || '')),
        row('Размер', range({ min: 13, max: 32, step: 1, value: r.fontSize, onInput: (v) => setSetting('reader.fontSize', v) })),
        row('Интервал', range({ min: 1.2, max: 2.4, step: 0.05, value: r.lineHeight, onInput: (v) => setSetting('reader.lineHeight', v) })),
        row('Ширина', range({ min: 460, max: 1200, step: 10, value: r.width, onInput: (v) => setSetting('reader.width', v) })),
        row('Абзацы', range({ min: 0, max: 2, step: 0.1, value: r.paraSpacing, onInput: (v) => setSetting('reader.paraSpacing', v) })),
        row('Красная строка', toggle(r.indent, (v) => setSetting('reader.indent', v))),
        row('Выравнивание', sel('reader.align', [['left', 'По левому краю'], ['justify', 'По ширине']], r.align)),
        row('Бумага', sel('reader.paper', Object.entries(PAPERS).map(([k, p]) => [k, p.name]), r.paper)),
        row('Штампы сцен', sel('reader.stampStyle', [['terminal', 'Журнал терминала'], ['plain', 'Простой жирный']], r.stampStyle)),
        h('div.typo-title', {}, 'Комфорт'),
        row('Фокус', sel('reader.focus', FOCUS, r.focus)),
        row('Перелистывание', sel('anim.page', PAGE_ANIM, anim().page)),
        row('Плавная прокрутка', toggle(anim().smoothScroll, (v) => setSetting('anim.smoothScroll', v))),
        row('Скорость суфлёра', range({ min: 5, max: 300, step: 5, value: r.autoSpeed, onInput: (v) => setSetting('reader.autoSpeed', v) })),
        row('Скрывать панели', toggle(r.immersive, (v) => setSetting('reader.immersive', v))));
    }, { align: 'right' });
  }

  // ---------- Иммерсивность ----------
  let idleT;
  reader.addEventListener('mousemove', (e) => {
    if (!cfg().immersive) { reader.classList.remove('immersive'); return; }
    const r = reader.getBoundingClientRect();
    const near = e.clientY - r.top < 70 || r.bottom - e.clientY < 50;
    reader.classList.toggle('peek', near || !!side || !!searchBox || auto);
  });
  if (cfg().immersive) {
    reader.classList.add('immersive', 'peek');
    idleT = setTimeout(() => { if (!side && !searchBox) reader.classList.remove('peek'); }, 2500);
  }

  // ---------- Сенсорный экран: свайп листает, касание в центре показывает панели ----------
  let touch = null;
  body.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    touch = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  body.addEventListener('pointercancel', () => { touch = null; });
  body.addEventListener('pointerup', (e) => {
    if (!touch || e.pointerType === 'mouse') return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y, dt = Date.now() - touch.t;
    touch = null;
    const sel = getSelection();
    if (sel && sel.toString().trim()) return;
    if (mode !== 'scroll' && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && dt < 700) { turn(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || dt > 450) return;
    if (e.target.closest('.rd-zone, a, button, .rd-end')) return;
    if (!cfg().immersive) return;
    clearTimeout(idleT);
    reader.classList.toggle('peek', !reader.classList.contains('peek') || !!side || !!searchBox);
  });

  // ---------- Клавиши ----------
  function onKey(e) {
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return;
    if (document.querySelector('.modal-back')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'f') { e.preventDefault(); openSearch(); return; }
    if (e.ctrlKey) return;
    if (e.key === 'Escape') { if (searchBox) closeSearch(); else if (side) toggleSide(sideOpen); else back(); return; }
    if (k === 'b' || k === 'и') { bookmarkHere(); return; }
    if (k === 'a' || k === 'ф') { toggleAuto(); return; }
    if (k === 'f' || k === 'а') { cycleFocus(); return; }
    if (mode !== 'scroll') {
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); turn(1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); turn(-1); }
      if (e.key === 'Home') showPage(0, { how: 'slide' });
      if (e.key === 'End') showPage(paged.pages - 1, { how: 'slide' });
    } else if (scroller) {
      const base = smooth.raf ? smooth.target : scroller.scrollTop;
      const pageH = scroller.clientHeight * 0.85;
      const map = { ArrowDown: 90, ArrowUp: -90, PageDown: pageH, PageUp: -pageH, ' ': e.shiftKey ? -pageH : pageH };
      if (e.key in map) { e.preventDefault(); smoothTo(base + map[e.key]); }
      if (e.key === 'Home') { e.preventDefault(); smoothTo(0); }
      if (e.key === 'End') { e.preventDefault(); smoothTo(maxScroll()); }
      if (auto && (e.key === '+' || e.key === '=')) setSetting('reader.autoSpeed', Math.min(300, cfg().autoSpeed + 5));
      if (auto && e.key === '-') setSetting('reader.autoSpeed', Math.max(5, cfg().autoSpeed - 5));
    }
  }
  document.addEventListener('keydown', onKey);

  // ---------- Реакция на настройки и размер окна ----------
  const relayout = () => {
    if (!contentReady) return;
    const keep = cur;
    if (mode !== 'scroll') layoutPages();
    gotoPara(keep, { instant: true });
  };
  let rT;
  const ro = new ResizeObserver(() => { clearTimeout(rT); rT = setTimeout(relayout, 120); });
  ro.observe(body);
  disposers.push(() => ro.disconnect());
  disposers.push(on('settings', (path) => {
    if (path === 'reader.mode' || (path === '*' && cfg().mode !== mode)) {
      const keep = cur;
      mode = cfg().mode;
      if (searchBox) closeSearch();
      mount();
      requestAnimationFrame(() => gotoPara(keep, { instant: true }));
      if (path !== '*') return;
    }
    if (path === 'reader.focus' || path === '*') applyFocus();
    if (path === 'reader.autoSpeed') drawAutoInfo();
    if (path === 'reader.immersive' || path === '*') {
      reader.classList.toggle('immersive', !!cfg().immersive);
      if (cfg().immersive) reader.classList.add('peek');
    }
    if (/^(reader\.(fontSize|lineHeight|width|paraSpacing|indent|align|font|paper|stampStyle)|theme\.fonts|theme\.effects)/.test(path) || path === '*') {
      clearTimeout(rT);
      rT = setTimeout(relayout, 60);
    }
  }));

  function back() {
    sfx('close');
    doc.back();
  }

  load();

  return () => {
    clearTimeout(saveT);
    clearTimeout(idleT);
    stopAuto();
    if (smooth.raf) cancelAnimationFrame(smooth.raf);
    if (contentReady) setProgress(story.id, { frac, para: cur });
    document.removeEventListener('keydown', onKey);
    disposers.forEach((d) => d());
    closePopover();
  };
}
