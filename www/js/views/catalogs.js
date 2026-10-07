// Каталоги (свободный режим): OPDS-ленты и закладки сайтов для встроенного браузера
import { h, icon, btn, toast, modal, confirmBox, pageHead, emptyState, esc } from '../util.js';
import { state, setSetting } from '../state.js';
import { openBook } from './library.js';
import { sfx } from '../sound.js';

const SUGGESTED = [
  { name: 'Project Gutenberg', url: 'https://www.gutenberg.org/ebooks.opds/', about: 'Больше 70 000 бесплатных книг, есть и на русском' },
];

let tab = 'opds';
let nav = null; // { catalog, stack: [url], entries, … }

const ACQ = 'http://opds-spec.org/acquisition';
const FORMAT_OF = (type, href) => {
  const t = `${type || ''} ${href || ''}`.toLowerCase();
  if (/epub/.test(t)) return 'EPUB';
  if (/fb2\+zip|fb2\.zip|x-zip-compressed-fb2/.test(t)) return 'FB2.ZIP';
  if (/fb2|fictionbook/.test(t)) return 'FB2';
  if (/pdf/.test(t)) return 'PDF';
  if (/text\/plain|\.txt/.test(t)) return 'TXT';
  if (/html/.test(t)) return 'HTML';
  if (/mobi|azw|kindle|djvu/.test(t)) return null;
  return null;
};

function parseFeed(text, baseUrl) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('feed').length) throw new Error('По адресу нет OPDS-каталога (ожидалась лента Atom)');
  const abs = (u) => { try { return new URL(u, baseUrl).href; } catch { return u; } };
  const txt = (el, tag) => { const x = el.getElementsByTagName(tag)[0]; return x ? x.textContent.trim() : ''; };
  const feed = doc.documentElement;
  const linksOf = (el) => [...el.children].filter((c) => c.localName === 'link').map((l) => ({ rel: l.getAttribute('rel') || '', type: l.getAttribute('type') || '', href: abs(l.getAttribute('href') || ''), title: l.getAttribute('title') || '' }));
  const feedLinks = linksOf(feed);
  const entries = [...feed.children].filter((c) => c.localName === 'entry').map((e) => {
    const links = linksOf(e);
    const acq = links.filter((l) => l.rel.startsWith(ACQ)).map((l) => ({ ...l, fmt: FORMAT_OF(l.type, l.href) })).filter((l) => l.fmt);
    const navLink = links.find((l) => /atom\+xml|opds-catalog/.test(l.type) && !l.rel.startsWith(ACQ) && !/image|thumbnail/.test(l.rel));
    const img = links.find((l) => /opds-spec\.org\/image$|\/cover$/.test(l.rel)) || links.find((l) => /thumbnail/.test(l.rel));
    const contentEl = [...e.children].find((c) => c.localName === 'content' || c.localName === 'summary');
    let summary = contentEl ? contentEl.textContent.trim() : '';
    if (/<[a-z]/i.test(summary)) summary = new DOMParser().parseFromString(summary, 'text/html').body.textContent.trim();
    return {
      title: txt(e, 'title'),
      authors: [...e.getElementsByTagName('author')].map((a) => txt(a, 'name')).filter(Boolean),
      summary,
      cover: img ? img.href : null,
      acq: [...new Map(acq.map((a) => [a.fmt, a])).values()],
      nav: acq.length ? null : navLink ? navLink.href : null,
    };
  });
  return {
    title: txt(feed, 'title'),
    entries,
    next: (feedLinks.find((l) => l.rel === 'next') || {}).href || null,
    search: feedLinks.find((l) => l.rel === 'search') || null,
  };
}

async function fetchFeed(url) {
  const r = await window.ark.net.fetchText(url);
  if (!r.ok) throw new Error(`Сервер ответил ${r.status}`);
  return parseFeed(r.text, r.url);
}

async function searchUrl(link, q) {
  if (/opensearchdescription/.test(link.type)) {
    const r = await window.ark.net.fetchText(link.href);
    const doc = new DOMParser().parseFromString(r.text, 'application/xml');
    const urls = [...doc.getElementsByTagName('Url')];
    const u = urls.find((x) => /atom/.test(x.getAttribute('type') || '')) || urls[0];
    if (!u) throw new Error('Каталог не поддерживает поиск');
    return new URL(u.getAttribute('template').replace('{searchTerms}', encodeURIComponent(q)).replace(/\{[^}]+\?\}/g, ''), link.href).href;
  }
  return link.href.replace('{searchTerms}', encodeURIComponent(q));
}

function addCatalogDialog(redraw, preset) {
  modal((box, close) => {
    const name = h('input.input', { value: preset ? preset.name : '', placeholder: 'Например: Моя библиотека' });
    const url = h('input.input', { value: preset ? preset.url : '', placeholder: 'https://…/opds' });
    const status = h('p.sub', {}, 'OPDS это формат каталогов, его поддерживают многие онлайн-библиотеки. Ссылку обычно можно найти на сайте библиотеки по слову «OPDS».');
    box.append(h('h2', {}, 'Новый каталог'), status,
      h('div.field', {}, h('label', {}, 'Название'), name),
      h('div.field', {}, h('label', {}, 'Адрес OPDS'), url),
      h('div.actions', {}, btn('Отмена', close), btn('Проверить и добавить', async () => {
        const u = url.value.trim();
        if (!/^https?:\/\//.test(u)) return toast('Нужен адрес http(s)', '', { error: true });
        status.textContent = 'Проверяю каталог…';
        try {
          const f = await fetchFeed(u);
          setSetting('opds', [...(state.settings.opds || []), { id: crypto.randomUUID().slice(0, 8), name: name.value.trim() || f.title || u, url: u }]);
          toast('Каталог добавлен', f.title || u);
          close(); redraw();
        } catch (e) { status.textContent = `Не получилось: ${e.message}`; }
      }, { cls: 'primary', ico: 'check' })));
  });
}

function addSiteDialog(redraw) {
  modal((box, close) => {
    const title = h('input.input', { placeholder: 'Название' });
    const url = h('input.input', { placeholder: 'https://…' });
    box.append(h('h2', {}, 'Новый сайт'), h('p.sub', {}, 'Сайт откроется во встроенном браузере. Скачанные там книги и аудио сами попадут в библиотеку.'),
      h('div.field', {}, h('label', {}, 'Название'), title), h('div.field', {}, h('label', {}, 'Адрес'), url),
      h('div.actions', {}, btn('Отмена', close), btn('Добавить', () => {
        let u = url.value.trim();
        if (!u) return;
        if (!/^https?:\/\//.test(u)) u = `https://${u}`;
        const list = (state.settings.bookmarks && state.settings.bookmarks.free) || [];
        setSetting('bookmarks.free', [...list, { title: title.value.trim() || new URL(u).hostname, url: u }]);
        close(); redraw();
      }, { cls: 'primary' })));
  });
}

function renderFeed(body, go, redraw) {
  const view = h('div');
  body.append(view);
  const search = h('input.input', { placeholder: 'Поиск по каталогу…' });
  const crumbs = h('div.opds-crumbs');
  const list = h('div.opds-list');
  const more = h('div', { style: { textAlign: 'center', margin: '20px 0' } });

  const load = async (url, { append = false, push = true } = {}) => {
    if (push && !append) nav.stack.push({ url, title: '…' });
    if (!append) list.innerHTML = '';
    more.innerHTML = '';
    list.append(h('p.opds-loading', {}, 'Загрузка каталога…'));
    try {
      const f = await fetchFeed(url);
      list.querySelector('.opds-loading')?.remove();
      if (!append) nav.stack[nav.stack.length - 1].title = f.title || nav.catalog.name;
      nav.search = f.search || nav.search;
      search.disabled = !nav.search;
      drawCrumbs();
      drawEntries(f.entries);
      more.innerHTML = '';
      if (f.next) more.append(btn('Показать ещё', () => load(f.next, { append: true, push: false }), { cls: 'ghost', ico: 'download' }));
      if (!f.entries.length && !append) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Здесь пусто.'));
    } catch (e) {
      list.querySelector('.opds-loading')?.remove();
      list.append(h('div.empty', {}, h('h3', {}, 'Каталог не отвечает'), h('p', {}, e.message)));
    }
  };

  const drawCrumbs = () => {
    crumbs.innerHTML = '';
    crumbs.append(btn('Каталоги', () => { nav = null; redraw(); }, { ico: 'back', cls: 'ghost' }));
    nav.stack.forEach((s, i) => {
      crumbs.append(h('span.sep', {}, '/'), h('button.crumb', { onclick: () => { nav.stack = nav.stack.slice(0, i + 1); load(s.url, { push: false }); } }, s.title));
    });
  };

  const drawEntries = (entries) => {
    for (const e of entries) {
      // Многие каталоги (например, Gutenberg) отдают книгу ссылкой на её страницу — показываем как книгу
      if (e.nav && e.authors.length) {
        const cov = h('div.cover');
        if (e.cover) { const img = h('img', { src: e.cover, loading: 'lazy', alt: '' }); img.onerror = () => img.remove(); cov.append(img); }
        list.append(h('div.opds-book.panel', {}, cov,
          h('div', {},
            h('h3', {}, e.title),
            e.authors.length ? h('div.bd-authors', {}, e.authors.join(', ')) : null,
            e.summary ? h('p', {}, e.summary.slice(0, 400)) : null,
            h('div.opds-fmts', {}, btn('Открыть', () => { sfx('click'); load(e.nav); }, { ico: 'right', cls: 'ghost' })))));
      } else if (e.nav) {
        list.append(h('button.opds-nav.panel', { onclick: () => { sfx('click'); load(e.nav); } }, e.cover ? h('img.opds-thumb', { src: e.cover, alt: '', loading: 'lazy' }) : icon('folder'), h('div', {}, h('b', {}, e.title), e.summary ? h('span', {}, e.summary.slice(0, 160)) : null), icon('right')));
      } else if (e.acq.length) {
        const cov = h('div.cover');
        if (e.cover) { const img = h('img', { src: e.cover, loading: 'lazy', alt: '' }); img.onerror = () => img.remove(); cov.append(img); }
        list.append(h('div.opds-book.panel', {}, cov,
          h('div', {},
            h('h3', {}, e.title),
            e.authors.length ? h('div.bd-authors', {}, e.authors.join(', ')) : null,
            e.summary ? h('p', {}, e.summary.slice(0, 400)) : null,
            h('div.opds-fmts', {}, e.acq.map((a) => {
              let saved = null; // после скачивания та же кнопка открывает книгу
              return btn(a.fmt, async (ev) => {
              const b = ev.currentTarget;
              if (saved) { openBook(saved, go); return; }
              b.disabled = true;
              b.querySelector('span').textContent = 'Загрузка…';
              try {
                saved = await window.ark.library.download(a.href, 'free', { title: e.title, authors: e.authors, annotation: e.summary, coverUrl: e.cover, source: a.href });
                toast(saved.duplicate ? 'Уже в библиотеке' : 'Книга добавлена', e.title);
                b.disabled = false;
                b.querySelector('svg').replaceWith(icon('book'));
                b.querySelector('span').textContent = 'Читать';
              } catch (err) {
                b.disabled = false;
                b.querySelector('span').textContent = a.fmt;
                toast('Не удалось скачать', err.message, { error: true });
              }
              }, { ico: 'download', cls: 'ghost' });
            })))));
      }
    }
  };

  search.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !search.value.trim() || !nav.search) return;
    try {
      const u = await searchUrl(nav.search, search.value.trim());
      nav.stack.push({ url: u, title: `Поиск: ${search.value.trim()}` });
      load(u, { push: false });
    } catch (err) { toast('Поиск не удался', err.message, { error: true }); }
  });

  view.append(h('div.opds-head', {}, crumbs, h('div.search', {}, icon('search'), search)), list, more);
  const start = nav.stack.length ? nav.stack.pop().url : nav.catalog.url;
  load(start);
}

export function renderCatalogs(el, params, { go }) {
  const page = h('div.page');
  el.append(page);
  const redraw = () => {
    page.innerHTML = '';
    page.append(pageHead('Источники книг', 'Катал<em>оги</em>', {
      code: 'SRC', stamp: 'Каталоги',
      tools: [h('div.btn-group', {},
        btn('OPDS-каталоги', () => { tab = 'opds'; nav = null; redraw(); }, { ico: 'globe', cls: tab === 'opds' ? 'on' : '' }),
        btn('Мои сайты', () => { tab = 'sites'; redraw(); }, { ico: 'compass', cls: tab === 'sites' ? 'on' : '' }))],
    }));
    const body = h('div');
    page.append(body);

    if (tab === 'sites') {
      const sites = (state.settings.bookmarks && state.settings.bookmarks.free) || [];
      body.append(h('p.desc', { style: { color: 'var(--dim)', marginTop: 0, maxWidth: '760px', lineHeight: 1.6 } }, 'Сайты открываются во встроенном браузере. Скачанные там книги сами попадут в библиотеку.'),
        h('div', { style: { marginBottom: '16px' } }, btn('Добавить сайт', () => addSiteDialog(redraw), { cls: 'primary', ico: 'plus' })));
      if (!sites.length) body.append(emptyState('ЗАКЛАДОК НЕТ', 'Добавьте свои сайты', 'Например, сайт библиотеки, где вы обычно берёте книги.'));
      else body.append(h('div.site-list', {}, sites.map((s, i) => h('div.opds-nav.panel', { onclick: () => go('browser', { url: s.url }) },
        icon('compass'), h('div', {}, h('b', {}, s.title), h('span', {}, s.url)),
        btn('', async (e) => { e.stopPropagation(); if (await confirmBox('Убрать сайт?', s.title, { ok: 'Убрать', danger: true })) { setSetting('bookmarks.free', sites.filter((_, j) => j !== i)); redraw(); } }, { ico: 'trash', cls: 'ghost' })))));
      return;
    }

    if (nav) { renderFeed(body, go, redraw); return; }

    const cats = state.settings.opds || [];
    body.append(h('div', { style: { marginBottom: '16px' } }, btn('Добавить каталог', () => addCatalogDialog(redraw), { cls: 'primary', ico: 'plus' })));
    if (cats.length) {
      body.append(h('h2.sec', {}, 'Мои каталоги'), h('div.site-list', {}, cats.map((c) => h('div.opds-nav.panel', { onclick: () => { nav = { catalog: c, stack: [] }; redraw(); } },
        icon('globe'), h('div', {}, h('b', {}, c.name), h('span', {}, c.url)),
        btn('', async (e) => { e.stopPropagation(); if (await confirmBox('Удалить каталог?', c.name, { ok: 'Удалить', danger: true })) { setSetting('opds', cats.filter((x) => x.id !== c.id)); redraw(); } }, { ico: 'trash', cls: 'ghost' })))));
    }
    const left = SUGGESTED.filter((s) => !cats.some((c) => c.url === s.url));
    if (left.length) {
      body.append(h('h2.sec', {}, 'Открытые библиотеки'), h('div.site-list', {}, left.map((s) => h('div.opds-nav.panel', { onclick: () => addCatalogDialog(redraw, s) },
        icon('plus'), h('div', {}, h('b', {}, s.name), h('span', {}, s.about))))));
    }
  };
  redraw();
}
