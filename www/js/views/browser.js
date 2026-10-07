// Встроенный браузер (мобильная версия).
// Android: сайт открывается в нативном браузере приложения (BrowserActivity), скачанные там книги,
// аудио и архивы сами попадают на полку. iPhone (сайт/PWA): встраивать чужие сайты нельзя —
// открываем их в Safari и подсказываем, как добавить скачанный файл.
import { h, icon, btn, toast, pageHead, esc } from '../util.js';
import { state, mode, on, setSetting, BROWSER_HOME, sectionTitle, headingHtml } from '../state.js';
import { sfx } from '../sound.js';
import { isNative, Ark } from '../platform/env.js';
import { importBooks } from './library.js';

let lastUrl = '';
let bound = false;

function bindNative() {
  if (bound || !isNative) return;
  bound = true;
  Ark.addListener('browser', (e) => {
    if (e.type === 'closed') lastUrl = e.url || lastUrl;
    if (e.type === 'bookmark' && e.url) {
      const list = (state.settings.bookmarks && state.settings.bookmarks.free) || [];
      if (list.some((b) => b.url === e.url)) return;
      let title = (e.title || '').trim();
      try { title ||= new URL(e.url).hostname; } catch {}
      setSetting('bookmarks.free', [...list, { title: title.slice(0, 40), url: e.url }]);
    }
  });
}

function homeLinks() {
  const own = (state.settings.bookmarks && state.settings.bookmarks.free) || [];
  if (mode() === 'warhammer') return [...BROWSER_HOME.warhammer, ...own.filter((b) => !BROWSER_HOME.warhammer.some((x) => x.url === b.url))];
  return own;
}

function normalize(input) {
  let u = String(input || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = /\.\w{2,}/.test(u) && !/\s/.test(u) ? `https://${u}` : `https://duckduckgo.com/?q=${encodeURIComponent(u)}`;
  return u;
}

export function openSite(url) {
  const u = normalize(url);
  if (!u) return;
  sfx('open');
  if (isNative) { lastUrl = u; Ark.openBrowser({ url: u }); }
  else window.open(u, '_blank', 'noopener');
}

function fmtSize(n) {
  if (!n) return '';
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} ГБ`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} МБ`;
  return `${Math.round(n / 1e3)} КБ`;
}

export function updateDownloadsBadge() {}

export function renderBrowser(el, params, { go }) {
  bindNative();
  // Перерисовка раздела (например, после синхронизации) не должна открывать сайт повторно
  if (params.url && !params.opened) { params.opened = true; openSite(params.url); }

  const addr = h('input.input', { placeholder: 'Адрес сайта или поиск', spellcheck: false, inputmode: 'url', enterkeyhint: 'go' });
  addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') { openSite(addr.value); addr.blur(); } });
  const list = h('div.site-list');
  const dl = h('div', { id: 'wb-downloads' });

  const removeBookmark = (url) => {
    const own = (state.settings.bookmarks && state.settings.bookmarks.free) || [];
    setSetting('bookmarks.free', own.filter((b) => b.url !== url));
    draw();
  };

  const draw = () => {
    list.innerHTML = '';
    const links = homeLinks();
    if (lastUrl) list.append(h('button.opds-nav.panel', { onclick: () => openSite(lastUrl) }, icon('right'), h('div', {}, h('b', {}, 'Продолжить'), h('span', {}, lastUrl))));
    for (const l of links) {
      const builtin = mode() === 'warhammer' && BROWSER_HOME.warhammer.some((x) => x.url === l.url);
      list.append(h('div.opds-nav.panel', { onclick: () => openSite(l.url) },
        icon('compass'), h('div', {}, h('b', {}, l.title), h('span', {}, l.url)),
        builtin ? null : btn('', (e) => { e.stopPropagation(); removeBookmark(l.url); }, { ico: 'trash', cls: 'ghost', title: 'Убрать из закладок' })));
    }
    if (!links.length && !lastUrl) list.append(h('p', { style: { color: 'var(--dim)' } }, isNative ? 'Закладок пока нет. Откройте сайт и нажмите ☆ в браузере — он появится здесь.' : 'Закладок пока нет.'));
    drawDownloads();
  };

  const drawDownloads = () => {
    dl.innerHTML = '';
    const items = [...(state.downloads || [])].reverse().slice(0, 12);
    if (!items.length) return;
    dl.append(h('h2.sec', {}, 'Загрузки'));
    for (const d of items) {
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      const label = { progressing: `${fmtSize(d.received)}${d.total ? ` из ${fmtSize(d.total)}` : ''}`, extracting: 'Добавляю на полку…', imported: d.kind === 'audio' ? 'В аудиокнигах ✓' : 'В библиотеке ✓', archive: 'Сохранено в «Загрузки» телефона', error: `Ошибка: ${d.error || ''}` }[d.state] || d.state;
      dl.append(h('div.wb-dl-item', {},
        h('b', {}, d.title || d.name),
        h('span', {}, label),
        d.state === 'progressing' ? h('div.progress', {}, h('i', { style: { width: `${pct}%` } })) : null,
        d.state === 'imported' ? btn('Открыть', () => go(d.kind === 'audio' ? 'audio' : 'library', d.kind === 'audio' ? { id: d.recId } : {}), { cls: 'ghost', ico: 'right' }) : null));
    }
  };

  const intro = isNative
    ? 'Книги (FB2, EPUB, PDF, TXT, DOCX), аудио и архивы ZIP, 7z, RAR, скачанные во встроенном браузере, сами попадут на полку. Если ссылка не срабатывает — удержите на ней палец и выберите «Скачать по ссылке».'
    : 'В веб-версии (iPhone) сайты открываются в Safari. Скачайте книгу там, затем нажмите «Добавить скачанные книги» и выберите файл в «Загрузках». Архивы ZIP, 7z и RAR с книгами распакуются сами.';

  el.append(h('div.page', {},
    pageHead('Сеть // сайты', headingHtml(sectionTitle('browser'), esc), { code: 'WEB', stamp: 'Браузер' }),
    h('div.wb-start-inner', { style: { justifyItems: 'stretch', textAlign: 'left', margin: '0 auto' } },
      h('div.search', {}, icon('search'), addr),
      h('p', { style: { color: 'var(--dim)', lineHeight: 1.6 } }, intro),
      isNative ? null : btn('Добавить скачанные книги', () => importBooks(), { cls: 'primary', ico: 'upload' }),
      h('h2.sec', {}, isNative ? 'Сайты и закладки' : 'Сайты'),
      list,
      dl)));
  draw();
  const offs = [on('downloads', drawDownloads), on('settings', (p) => { if (p === '*' || String(p).startsWith('bookmarks')) draw(); }), on('mode', draw)];
  return () => offs.forEach((f) => f());
}
