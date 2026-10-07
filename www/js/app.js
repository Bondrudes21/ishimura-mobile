import './platform/bridge.js';
import { h, $, icon, btn, toast, popover, plural, fmtAgo, closePopover, esc } from './util.js';
import { state, loadState, on, emit, SECTIONS, MODES, setSetting, applyTheme, allThemes, contentUrl, storyById, sectionTitle, mode, sectionsOf, switchMode, librarySpace, libBooks, libAudio, libUrl } from './state.js';
import { themeVars, normalizeTheme } from './themes.js';
import { sfx } from './sound.js';
import { playBoot, playNeutralBoot } from './boot.js';
import { toggleQuick } from './quick.js';
import { renderStories, renderSeries } from './views/stories.js';
import { openReader } from './views/reader.js';
import { renderGallery } from './views/gallery.js';
import { renderTimeline } from './views/timeline.js';
import { renderCodex } from './views/codex.js';
import { renderMap } from './views/map.js';
import { renderSettings } from './views/settings.js';
import { renderAuthor } from './views/author.js';
import { renderLibrary, reportImport } from './views/library.js';
import { renderAudio } from './views/audio.js';
import { renderWriter } from './views/writer.js';
import { renderCatalogs } from './views/catalogs.js';
import { renderBrowser } from './views/browser.js';
import { renderPdf } from './views/pdf.js';
import { player, refreshPlayerBook, fmtTime } from './audioplayer.js';
import { ensureMeta } from './bookfmt.js';

const VIEWS = {
  stories: renderStories,
  series: renderSeries,
  reader: openReader,
  gallery: renderGallery,
  timeline: renderTimeline,
  codex: renderCodex,
  map: renderMap,
  settings: renderSettings,
  author: renderAuthor,
  library: renderLibrary,
  audio: renderAudio,
  writer: renderWriter,
  catalogs: renderCatalogs,
  browser: renderBrowser,
  pdf: renderPdf,
};
const ORDER = ['stories', 'series', 'library', 'pdf', 'reader', 'audio', 'writer', 'gallery', 'timeline', 'codex', 'map', 'catalogs', 'browser', 'author', 'settings'];

let route = { view: 'stories', params: {} };
let cleanup = null;
// История переходов — для системной кнопки «Назад» на Android
const history = [];

function animationsOn() {
  return state.settings.theme.effects.animations && state.settings.anim.view !== 'none';
}

export function go(view, params = {}, { replace, back } = {}) {
  if (!VIEWS[view]) view = 'stories';
  if (!replace) sfx('click');
  closePopover();
  const prev = route.view;
  if (!replace && !back && (prev !== view || JSON.stringify(params) !== JSON.stringify(route.params))) {
    history.push(route);
    if (history.length > 40) history.shift();
  }
  const swap = () => {
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    route = { view, params };
    document.documentElement.dataset.route = view;
    // На чужих сайтах и в PDF эффекты темы (скан-линии, виньетка) только мешают
    document.documentElement.classList.toggle('no-fx', ['browser', 'pdf'].includes(view));
    const el = $('#view');
    el.innerHTML = '';
    el.scrollTop = 0;
    const wrap = h('div.view-wrap', { style: ['reader', 'pdf'].includes(view) ? { position: 'absolute', inset: '0' } : null });
    el.append(wrap);
    cleanup = VIEWS[view](wrap, params, { go }) || null;
    stagger(wrap);
    renderNav();
    if (document.documentElement.dataset.navPeek !== undefined) delete document.documentElement.dataset.navPeek;
  };
  const root = document.documentElement;
  if (!replace && document.startViewTransition && animationsOn()) {
    root.dataset.vt = 'view';
    root.dataset.vtDir = ORDER.indexOf(view) >= ORDER.indexOf(prev) ? 'fwd' : 'back';
    document.startViewTransition(swap).finished.finally(() => { if (root.dataset.vt === 'view') delete root.dataset.vt; });
  } else {
    swap();
  }
}
window.__go = go;

export const currentRoute = () => route;

// Поочерёдное появление карточек и строк
export function stagger(root) {
  if (!state.settings.theme.effects.animations || state.settings.anim.cards === 'none') return;
  const groups = root.querySelectorAll('.cards, .rows, .masonry, .timeline, .chapters, .a-list, .search-results, .codex-list, .presets-mini, .tl-list');
  for (const g of groups) {
    [...g.children].forEach((c, i) => {
      c.style.setProperty('--i', Math.min(i, 18));
      c.classList.add('stagger');
      const end = (e) => { if (e.target !== c) return; c.classList.remove('stagger'); c.removeEventListener('animationend', end); };
      c.addEventListener('animationend', end);
    });
  }
}
window.__stagger = stagger;

// ---------- Навигация ----------
function unseenCount(id) {
  const u = (state.status && state.status.unseen) || {};
  return (u[id] || []).length;
}

let indicatorRect = null;
function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = '';
  const rv = route.view;
  const active = rv === 'series' ? 'stories' : rv === 'pdf' ? 'library'
    : rv === 'reader' ? (route.params.lib ? 'library' : route.params.writer ? 'writer' : 'stories') : rv;
  const item = (id, title, ico) => {
    const n = mode() === 'ishimura' ? unseenCount(id) : 0;
    return h(`button.nav-item${active === id ? '.active' : ''}`, { onclick: () => go(id), onmouseenter: () => sfx('hover'), title, 'data-id': id },
      icon(ico), h('span', {}, title), n ? h('span.badge', {}, n) : null);
  };
  nav.append(h('div.nav-label', {}, mode() === 'ishimura' ? 'Архив' : 'Библиотека'));
  for (const s of sectionsOf()) {
    if (!s.visible) continue;
    const def = SECTIONS.find((x) => x.id === s.id);
    if (def) nav.append(item(def.id, sectionTitle(def.id), def.icon));
  }
  nav.append(h('div.nav-spacer'));
  nav.append(h('div.nav-label', {}, 'Система'));
  if (state.author.enabled && mode() === 'ishimura') nav.append(item('author', 'Режим автора', 'pen'));
  nav.append(item('settings', 'Конфигуратор', 'sliders'));
  if (player.book) nav.append(renderAudioMini());

  // Индикатор активного пункта плавно переезжает с прежнего места
  const ind = h('div.nav-indicator');
  nav.append(ind);
  const target = nav.querySelector('.nav-item.active');
  const place = (r) => Object.assign(ind.style, { transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px`, opacity: r.o });
  if (indicatorRect) { ind.style.transition = 'none'; place(indicatorRect); }
  requestAnimationFrame(() => {
    ind.style.transition = '';
    const r = target ? { x: target.offsetLeft, y: target.offsetTop, w: target.offsetWidth, h: target.offsetHeight, o: 1 } : { ...(indicatorRect || { x: 0, y: 0, w: 0, h: 0 }), o: 0 };
    place(r);
    indicatorRect = r;
  });
}

// ---------- Мини-плеер аудиокниги ----------
function renderAudioMini() {
  const box = h('div.player.panel.au-mini');
  const fill = h('i');
  const timeLbl = h('span.au-mini-time');
  const draw = () => {
    const b = player.book;
    if (!b) { box.remove(); return; }
    box.innerHTML = '';
    const cov = h('div.au-mini-cover', { onclick: () => go('audio', { id: b.id }), title: 'Открыть аудиокнигу' });
    if (b.cover) cov.append(h('img', { src: libUrl(b.cover), alt: '' }));
    else cov.append(icon('headphones'));
    box.append(
      h('div.p-top', {}, cov,
        h('div.au-mini-text', { onclick: () => go('audio', { id: b.id }) }, h('b', {}, b.title), h('span', {}, player.cur ? player.cur.title : '')),
        btn('', () => player.close(), { ico: 'close', cls: 'ghost', title: 'Закрыть плеер' })),
      h('div.au-mini-bar', {}, fill),
      h('div.p-top', {},
        btn('', () => player.skip(-30), { ico: 'back30', cls: 'ghost', title: 'Назад 30 с' }),
        btn('', () => player.toggle(), { ico: player.playing ? 'pause' : 'play', title: player.playing ? 'Пауза' : 'Слушать' }),
        btn('', () => player.skip(30), { ico: 'fwd30', cls: 'ghost', title: 'Вперёд 30 с' }),
        timeLbl));
    tick();
  };
  const tick = () => {
    const d = player.duration;
    fill.style.width = `${d ? (player.time / d) * 100 : 0}%`;
    timeLbl.textContent = `${fmtTime(player.time)}${d ? ` / ${fmtTime(d)}` : ''}`;
  };
  draw();
  let sig = '';
  const off = player.on(() => {
    const s = `${player.book && player.book.id}|${player.playing}|${player.track}`;
    if (!player.book) { renderNav(); return; }
    if (s !== sig) { sig = s; draw(); } else tick();
  });
  new MutationObserver((_, obs) => { if (!box.isConnected) { off(); obs.disconnect(); } }).observe($('#nav'), { childList: true });
  return box;
}

// ---------- Переключатель режимов ----------
function renderModeButton() {
  const b = $('#mode-btn');
  const m = MODES[mode()];
  b.innerHTML = '';
  b.append(icon({ ishimura: 'signal', warhammer: 'sword', free: 'feather' }[mode()]), h('span', {}, m.name));
}

function modeMenu(anchor) {
  popover(anchor, (pop, close) => {
    pop.classList.add('mode-menu');
    pop.append(h('div.mode-menu-title', {}, 'Режим приложения'));
    for (const [id, m] of Object.entries(MODES)) {
      pop.append(h(`button.mode-card${mode() === id ? '.on' : ''}`, {
        onclick: () => { close(); if (id !== mode()) { sfx('open'); switchMode(id); } },
      }, icon({ ishimura: 'signal', warhammer: 'sword', free: 'feather' }[id]), h('div', {}, h('b', {}, m.name), h('span', {}, m.about))));
    }
  }, { align: 'right' });
}

function homeView() {
  const vis = sectionsOf().filter((s) => s.visible).map((s) => s.id);
  if (mode() === 'ishimura' && vis.includes(state.settings.layout.home)) return state.settings.layout.home;
  return vis[0] || 'settings';
}

// ---------- Импорт перетаскиванием ----------
function initDrop() {
  const overlay = h('div.drop-overlay', {}, h('div', {}, icon('upload'), h('b', {}, 'Отпустите, чтобы добавить в библиотеку'), h('span', {}, 'FB2, EPUB, PDF, TXT, DOCX, HTML, RTF, аудиофайлы и папки')));
  document.body.append(overlay);
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; overlay.classList.add('on'); });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('on'); });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('on');
    const paths = [...e.dataTransfer.files].map((f) => window.ark.library.pathOf(f)).filter(Boolean);
    if (!paths.length) return;
    toast('Добавляю в библиотеку…', `${paths.length} ${plural(paths.length, 'объект', 'объекта', 'объектов')}`);
    const r = await window.ark.library.importPaths(paths, librarySpace());
    reportImport(r);
    if (mode() === 'ishimura' && r.added.length) toast('Книги добавлены в свободный режим', 'Переключите режим в заголовке, чтобы их увидеть');
  });
}

// ---------- Заголовок окна ----------
function renderBrand() {
  document.documentElement.dataset.mode = mode();
  const custom = mode() === 'ishimura' ? (state.settings.texts.brand || '').trim() : '';
  const text = custom || MODES[mode()].title;
  const words = esc(text).split(' ');
  $('.brand-name').innerHTML = words.length > 1 ? `${words.slice(0, -1).join(' ')} <b>${words.at(-1)}</b>` : `<b>${words[0]}</b>`;
  document.title = text;
}

// ---------- Статус-бар и сигнал ----------
function linkState() {
  const s = state.status || {};
  if (s.syncing) return 'syncing';
  if (s.online === false) return 'offline';
  if (s.online) return 'online';
  return 'syncing';
}

function renderSignal() {
  const el = $('#signal');
  const st = linkState();
  el.dataset.link = st;
  el.innerHTML = '';
  const label = { online: 'Связь стабильна', offline: 'Нет сигнала', syncing: 'Поиск сигнала' }[st];
  el.append(h('span.signal-bars', {}, h('i'), h('i'), h('i'), h('i')), h('span', {}, label));
  el.title = state.status && state.status.lastError ? `Ошибка: ${state.status.lastError}` : `Источник: ${state.status ? state.status.source : ''}`;
}

let updateInfo = { status: 'idle' };
function renderStatusbar() {
  const bar = $('#statusbar');
  const s = state.status || {};
  const st = linkState();
  const total = (state.manifest.stories || []).length;
  bar.innerHTML = '';
  if (mode() !== 'ishimura') {
    const nb = libBooks().length, na = libAudio().length;
    const active = (state.downloads || []).filter((d) => d.state === 'progressing').length;
    bar.append(...[
      h('span.sb-item', {}, h('span.sb-ok', {}, '●'), h('span', {}, `Режим «${MODES[mode()].name}»`)),
      h('span.sb-item', {}, 'Книг: ', h('b', {}, String(nb))),
      h('span.sb-item', {}, 'Аудиокниг: ', h('b', {}, String(na))),
      active ? h('span.sb-item.sb-warn', {}, `Загрузок: ${active}`) : null,
      player.book ? h('span.sb-item', {}, 'Слушаю: ', h('b', {}, player.book.title)) : null,
      h('span.sb-grow')].filter(Boolean));
    if (updateInfo.status === 'ready') bar.append(h('span.sb-item', {}, h('button', { onclick: () => window.ark.update.install() }, `Обновить до ${updateInfo.version} ↻`)));
    if (state.settings.layout.clock) bar.append(h('span.sb-item', { id: 'clock' }));
    bar.append(h('span.sb-item', {}, `v${state.info.version}`));
    tickClock();
    return;
  }
  bar.append(
    h('span.sb-item', {}, h(`span.${st === 'online' ? 'sb-ok' : st === 'offline' ? 'sb-warn' : ''}`, {}, '●'),
      h('span', {}, st === 'online' ? 'Канал с «Ишимурой» стабилен' : st === 'offline' ? 'Нет связи, работаю офлайн' : 'Синхронизация…')),
    h('span.sb-item', {}, 'Сверка: ', h('b', {}, fmtAgo(s.lastSync))),
    h('span.sb-item', {}, 'Ревизия архива: ', h('b', {}, String(s.revision ?? state.manifest.revision ?? 0))),
    h('span.sb-item', {}, 'Записей: ', h('b', {}, `${total} ${plural(total, 'рассказ', 'рассказа', 'рассказов')}`)),
    h('span.sb-grow'),
  );
  if (updateInfo.status === 'downloading') bar.append(h('span.sb-item.sb-warn', {}, `Загрузка обновления ${updateInfo.percent || 0}%`));
  if (updateInfo.status === 'ready') bar.append(h('span.sb-item', {}, h('button', { onclick: () => window.ark.update.install() }, `Обновить до ${updateInfo.version} ↻`)));
  if (state.settings.layout.clock) bar.append(h('span.sb-item', { id: 'clock' }));
  bar.append(h('span.sb-item', {}, `v${state.info.version}`));
  tickClock();
}
function tickClock() {
  const c = $('#clock');
  if (c) c.textContent = `${mode() === 'ishimura' ? 'ТВ ' : ''}${new Date().toLocaleTimeString('ru-RU')}`;
}

// ---------- Курсор-свечение ----------
function initCursorGlow() {
  const dot = h('div', { id: 'cursor-glow' });
  document.body.append(dot);
  let x = -100, y = -100, tx = -100, ty = -100, down = false;
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
  addEventListener('pointerdown', () => { down = true; });
  addEventListener('pointerup', () => { down = false; });
  document.addEventListener('mouseleave', () => { tx = ty = -100; });
  const loop = () => {
    if (document.documentElement.dataset.cursor === 'glow') {
      x += (tx - x) * 0.32; y += (ty - y) * 0.32;
      dot.style.transform = `translate(${x}px, ${y}px) scale(${down ? 0.7 : 1})`;
    }
    requestAnimationFrame(loop);
  };
  loop();
}

// ---------- Первый запуск ----------
export function presetCard(themeObj, { selected, onClick, badge } = {}) {
  const t = normalizeTheme(themeObj.theme);
  const vars = themeVars(t);
  const card = h(`button.preset-card.tokens${selected ? '.on' : ''}`, { onclick: onClick });
  for (const [k, v] of Object.entries(vars)) card.style.setProperty(k, v);
  const stripe = themeObj.stripe || `linear-gradient(90deg, ${t.colors.accent}, ${t.colors.accent2})`;
  card.append(
    h('div.mock', {},
      h('div.m-nav', {}, h('i.on'), h('i'), h('i'), h('i'), h('i')),
      h('div.m-main', {},
        h('div.m-title', { html: 'Архив <b>«Ишимуры»</b>' }),
        h('div.m-cards', {}, h('i'), h('i'), h('i'), h('i')),
        h('div.m-text', {}, 'Капитан ещё долго стоял у окна, глядя на планету…')),
      h('div.m-stripe', { style: { background: stripe } })),
    h('div.preset-meta', {}, h('b', {}, themeObj.name, badge ? h('span.preset-badge', {}, badge) : null), themeObj.about ? h('span', {}, themeObj.about) : null)
  );
  return card;
}

// Первый запуск: сначала режим, потом (для Ишимуры) интерфейс терминала
function chooseMode() {
  return new Promise((resolve) => {
    const el = h('div.firstrun', {}, h('div.firstrun-inner', {},
      h('div', {}, h('span.eyebrow', { style: { color: 'var(--accent)', letterSpacing: '.3em', fontSize: '12px' } }, 'ДОБРО ПОЖАЛОВАТЬ')),
      h('h1', {}, 'Выберите режим'),
      h('p', {}, 'Потом его можно поменять кнопкой вверху экрана.'),
      h('div.mode-cards', {}, Object.entries(MODES).map(([id, m]) => h('button.mode-card.big', {
        onclick: () => {
          sfx('click');
          if (id !== mode()) switchMode(id);
          el.classList.add('out');
          setTimeout(() => { el.remove(); resolve(id); }, 450);
        },
      }, icon({ ishimura: 'signal', warhammer: 'sword', free: 'feather' }[id]), h('div', {}, h('b', {}, m.name), h('span', {}, m.about))))),
    ));
    document.body.append(el);
  });
}

function firstRun() {
  return new Promise((resolve) => {
    const cards = h('div.preset-cards');
    const draw = () => {
      cards.innerHTML = '';
      for (const t of allThemes().filter((x) => x.builtin && ['builtin:terminal', 'builtin:dock', 'builtin:bunker'].includes(x.id))) {
        cards.append(presetCard(t, { selected: state.settings.activeTheme === t.id, onClick: () => { applyTheme(t.id, { withLayout: true }); sfx('click'); setTimeout(draw, 30); } }));
      }
    };
    draw();
    const el = h('div.firstrun', {}, h('div.firstrun-inner', {},
      h('div', {}, h('span.eyebrow', { style: { color: 'var(--accent)', letterSpacing: '.3em', fontSize: '12px' } }, 'ПЕРВЫЙ ДОСТУП К АРХИВУ')),
      h('h1', {}, 'Выберите интерфейс терминала'),
      h('p', {}, 'Потом всё можно поменять в Конфигураторе или в быстрых настройках (значок палитры вверху).'),
      cards,
      h('div', {}, btn('Войти в архив', () => {
        setSetting('firstRun', false);
        el.classList.add('out');
        setTimeout(() => { el.remove(); resolve(); }, 450);
      }, { cls: 'primary', ico: 'right' }))
    ));
    document.body.append(el);
  });
}

// ---------- Горячие клавиши ----------
function keys(e) {
  if (e.ctrlKey && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleNavPeek(); }
  if (e.key === 'F11') { e.preventDefault(); window.ark.win.fullscreen(); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); go('settings'); }
  if (e.ctrlKey && (e.key === '.' || e.code === 'Period')) { e.preventDefault(); toggleQuick(); }
}

// Системная кнопка «Назад» (Android): закрыть верхний слой, затем вернуться по истории, затем свернуть
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
function onBackButton() {
  if (document.querySelector('.popover')) { closePopover(); return; }
  if (document.querySelector('#layers .modal-back, #layers .qs, .lightbox, .firstrun')) {
    if (!document.querySelector('.firstrun')) escape();
    return;
  }
  if (document.querySelector('.cryo, .nboot')) return;
  if (['reader', 'pdf'].includes(route.view)) { escape(); return; }
  const prev = history.pop();
  if (prev) { go(prev.view, prev.params, { back: true }); return; }
  if (route.view !== homeView()) { go(homeView(), {}, { back: true }); return; }
  window.ark.win.minimize();
}

function toggleNavPeek() {
  const root = document.documentElement;
  if (state.settings.layout.nav !== 'hidden') return;
  if (root.dataset.navPeek !== undefined) delete root.dataset.navPeek;
  else root.dataset.navPeek = '';
}

// ---------- Старт ----------
async function start() {
  await loadState();

  $('#nav-toggle').append(icon('menu'));
  $('#nav-toggle').addEventListener('click', () => {
    if (state.settings.layout.nav === 'hidden') toggleNavPeek();
    else go('settings', { tab: 'layout' });
  });
  $('#qs-toggle').append(icon('palette'));
  $('#qs-toggle').addEventListener('click', () => { sfx('click'); toggleQuick(); });
  const wc = { minimize: 'min', maximize: 'max', close: 'close' };
  for (const b of document.querySelectorAll('[data-win]')) {
    b.append(icon(wc[b.dataset.win]));
    b.addEventListener('click', () => window.ark.win[b.dataset.win]());
  }
  window.ark.win.onState((s) => {
    if ('maximized' in s) $('[data-win="maximize"]').replaceChildren(icon(s.maximized ? 'restore' : 'max'));
  });
  $('#signal').addEventListener('click', async () => {
    sfx('click');
    const r = await window.ark.content.sync();
    if (r && r.error) toast('Нет связи с архивом', r.error, { error: true });
    else if (r && r.changed) toast('Архив обновлён', 'Получены новые записи');
    else toast('Связь стабильна', 'Новых передач нет');
  });

  if (!matchMedia('(hover: none)').matches) initCursorGlow();
  if (window.ark.app.onBack) window.ark.app.onBack(onBackButton);
  renderBrand();
  renderSignal();
  renderStatusbar();
  setInterval(tickClock, 1000);
  document.addEventListener('keydown', keys);

  window.ark.content.onStatus((s) => { state.status = s; renderSignal(); renderStatusbar(); renderNav(); });
  window.ark.content.onUpdated(({ manifest, added }) => {
    state.manifest = manifest;
    renderStatusbar();
    const n = (added.stories || []).length;
    if (n) toast('Входящая передача', n === 1 ? `Новый рассказ: «${added.stories[0].title}»` : `Новых рассказов: ${n}`);
    emit('manifest', { added });
    if (route.view !== 'reader' && route.view !== 'author') go(route.view, route.params, { replace: true });
  });
  window.ark.app.onNavigate(({ view, id }) => {
    if (view === 'reader' && id && storyById(id)) go('reader', { id });
    else go(view || 'stories');
  });
  window.ark.update.onStatus((u) => { updateInfo = u; renderStatusbar(); if (u.status === 'ready') toast('Обновление готово', `Версия ${u.version}. Чтобы установить, нажмите кнопку в строке состояния`); });
  updateInfo = await window.ark.update.status();

  on('settings', (path) => {
    if (path === '*' || /^(layout\.(sectionsByMode|statusBar|clock)|sound|texts)/.test(path)) { renderNav(); renderStatusbar(); renderBrand(); }
  });
  on('author', () => renderNav());
  on('mode', () => {
    renderBrand();
    renderModeButton();
    renderStatusbar();
    go(homeView(), {}, { replace: true });
  });

  // Библиотека, аудио и загрузки встроенного браузера
  ensureMeta(state.library.books || []);
  window.ark.library.onChanged((idx) => {
    state.library = idx;
    ensureMeta(idx.books || []);
    refreshPlayerBook();
    emit('library');
    if (mode() !== 'ishimura') renderStatusbar();
  });
  state.downloads = [];
  window.ark.downloads.onUpdate((d) => {
    const i = state.downloads.findIndex((x) => x.id === d.id);
    if (i >= 0) state.downloads[i] = { ...state.downloads[i], ...d }; else state.downloads.push(d);
    emit('downloads');
    if (d.state === 'imported') toast(d.kind === 'audio' ? 'Аудиокнига добавлена' : 'Книга добавлена в библиотеку', d.title || d.name);
    else if (d.state === 'archive') toast('Архив сохранён в «Загрузки»', `${d.name}. Распакуйте его и добавьте папку в «Аудиокниги»`, { ms: 8000 });
    else if (d.state === 'error') toast('Не удалось добавить файл', `${d.name}: ${d.error}`, { error: true });
    else if (i < 0) toast('Загрузка началась', d.name, { ms: 2500 });
    if (i < 0 || d.state !== 'progressing') renderStatusbar();
  });
  let lastBook = null;
  player.on(() => {
    const id = player.book && player.book.id;
    if (id !== lastBook) { lastBook = id; renderNav(); renderStatusbar(); }
  });

  $('#mode-btn').addEventListener('click', (e) => { sfx('click'); modeMenu(e.currentTarget); });
  renderModeButton();
  initDrop();

  // Интерфейс отрисовывается сразу — заставка «проявляет» его из размытия
  go(homeView(), {}, { replace: true });
  const firstTime = state.settings.firstRun;
  if (state.settings.sound.boot) await (mode() === 'ishimura' ? playBoot() : playNeutralBoot(MODES[mode()].title));
  if (firstTime) {
    const chosen = await chooseMode();
    if (chosen === 'ishimura') await firstRun();
    else setSetting('firstRun', false);
  }
}

start().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f55;padding:30px;white-space:pre-wrap">Сбой инициализации архива:\n${e && e.stack || e}</pre>`;
});
