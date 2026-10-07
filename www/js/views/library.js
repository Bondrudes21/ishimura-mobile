// Библиотека книг (режимы «Вархаммер» и «Свободный»)
import { h, icon, btn, toast, modal, confirmBox, pageHead, emptyState, esc, plural, readMinutes, debounce, fmtDate } from '../util.js';
import { state, mode, libBooks, libUrl, librarySpace, getProgress, setSetting, sectionTitle, headingHtml, on, BROWSER_HOME } from '../state.js';
import { coverSvg } from '../covers.js';
import { ensureMeta } from '../bookfmt.js';
import { sfx } from '../sound.js';

const filters = { q: '', author: '', series: '', genre: '', format: '', status: '' };

const FORMAT_NAMES = { fb2: 'FB2', epub: 'EPUB', pdf: 'PDF', txt: 'TXT', docx: 'DOCX', html: 'HTML', rtf: 'RTF' };

export function bookCover(b) {
  const el = h('div.cover');
  const fallback = () => { el.innerHTML = coverSvg({ id: b.id, title: b.title, subtitle: (b.authors || [])[0] || '', motif: null }, { label: FORMAT_NAMES[b.format] || 'КНИГА' }); };
  if (b.cover) {
    const img = h('img', { src: libUrl(b.cover), alt: '', loading: 'lazy' });
    img.onerror = fallback;
    el.append(img);
  } else fallback();
  return el;
}

function status(b) {
  const p = getProgress(`lib:${b.id}`);
  if (!p) return 'new';
  return p.done ? 'done' : 'reading';
}

export function openBook(b, go) {
  sfx('open');
  if (b.format === 'pdf') go('pdf', { id: b.id });
  else go('reader', { lib: b.id });
}

export async function importBooks() {
  const r = await window.ark.library.pick({ kind: 'books', space: librarySpace() });
  reportImport(r);
}

export function reportImport(r) {
  const books = r.added.filter((a) => a.kind === 'book' && !a.rec.duplicate).length;
  const dups = r.added.filter((a) => a.rec.duplicate).length;
  const audio = r.added.filter((a) => a.kind === 'audio').length;
  if (books || audio) toast('Добавлено в библиотеку', [books && `${books} ${plural(books, 'книга', 'книги', 'книг')}`, audio && `${audio} ${plural(audio, 'аудиокнига', 'аудиокниги', 'аудиокниг')}`].filter(Boolean).join(', '));
  if (dups) toast('Уже в библиотеке', `${dups} ${plural(dups, 'файл', 'файла', 'файлов')} пропущено`);
  if (r.errors.length) toast('Не удалось добавить', r.errors.slice(0, 3).join('\n'), { error: true, ms: 7000 });
}

function editDialog(b) {
  modal((box, close) => {
    const input = (v, ph) => h('input.input', { value: v || '', placeholder: ph || '' });
    const title = input(b.title);
    const authors = input((b.authors || []).join(', '), 'через запятую');
    const series = input(b.series, 'название серии');
    const num = input(b.seriesNum || '', '№');
    num.type = 'number';
    const tags = input((b.tags || []).join(', '), 'через запятую');
    const ann = h('textarea.textarea', {}, b.annotation || '');
    const f = (l, c) => h('div.field', {}, h('label', {}, l), c);
    box.append(h('h2', {}, 'Данные книги'),
      f('Название', title), f('Авторы', authors),
      h('div.grid-2', {}, f('Серия', series), f('Номер в серии', num)),
      f('Метки', tags), f('Аннотация', ann),
      h('div', { style: { display: 'flex', gap: '8px' } },
        btn('Сменить обложку', async () => { await window.ark.library.pickCover('book', b.id); toast('Обложка обновлена'); }, { ico: 'image' }),
        btn('Убрать обложку', () => window.ark.library.update('book', b.id, { cover: null }), { cls: 'ghost' })),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить', async () => {
        await window.ark.library.update('book', b.id, {
          title: title.value.trim() || b.title,
          authors: authors.value.split(',').map((s) => s.trim()).filter(Boolean),
          series: series.value.trim(), seriesNum: Number(num.value) || null,
          tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
          annotation: ann.value.trim(),
        });
        close();
      }, { cls: 'primary', ico: 'check' })));
  });
}

function detail(b, go) {
  modal((box, close) => {
    const p = getProgress(`lib:${b.id}`);
    box.classList.add('wide');
    box.append(h('div.book-detail', {},
      bookCover(b),
      h('div', {},
        h('div.bd-meta', {}, [FORMAT_NAMES[b.format], b.year, b.lang && b.lang.toUpperCase(), b.pages && `${b.pages} стр.`, b.words && `≈ ${readMinutes(b.words)} мин`].filter(Boolean).join(' · ')),
        h('h2', {}, b.title),
        (b.authors || []).length ? h('div.bd-authors', {}, b.authors.join(', ')) : null,
        b.series ? h('div.bd-series', {}, icon('list'), `${b.series}${b.seriesNum ? ` · книга ${b.seriesNum}` : ''}`) : null,
        b.annotation ? h('p.bd-ann', {}, b.annotation) : h('p.bd-ann', { style: { color: 'var(--dim)' } }, 'Аннотации нет.'),
        (b.genres || []).length || (b.tags || []).length ? h('div.chips', {}, [...(b.genres || []), ...(b.tags || [])].map((t) => h('span.tag', {}, t))) : null,
        p ? h('div', { style: { margin: '14px 0 4px', display: 'grid', gap: '6px' } }, h('span', { style: { fontSize: '12px', color: 'var(--dim)' } }, p.done ? 'Прочитано' : `Прочитано ${Math.round((p.frac || 0) * 100)}%`), h('div.progress', {}, h('i', { style: { width: `${Math.round((p.frac || 0) * 100)}%` } }))) : null,
        h('div.bd-acts', {},
          btn(p && !p.done ? 'Продолжить' : 'Читать', () => { close(); openBook(b, go); }, { cls: 'primary', ico: 'book' }),
          btn('Изменить', () => { close(); editDialog(b); }, { ico: 'edit' }),
          btn('Сохранить файл', () => window.ark.library.showFile('book', b.id), { ico: 'download', cls: 'ghost' }),
          btn('', async () => {
            if (!(await confirmBox('Удалить книгу?', `«${b.title}» будет удалена из библиотеки вместе с файлом.`, { ok: 'Удалить', danger: true }))) return;
            await window.ark.library.remove('book', b.id);
            close();
          }, { ico: 'trash', cls: 'ghost danger', title: 'Удалить' })),
        h('div.bd-foot', {}, `Добавлено ${fmtDate(b.added)}${b.source === 'browser' ? ' · скачано во встроенном браузере' : b.source && /^https?:/.test(b.source) ? ' · из каталога' : ''}`))));
  }, { wide: true });
}

export function renderLibrary(el, params, { go }) {
  const view = state.settings.layout.libraryView;
  const sort = state.settings.layout.librarySort;
  const isWh = mode() === 'warhammer';

  const search = h('input.input', { placeholder: 'Название, автор, серия…', value: filters.q });
  const sortSel = h('select.select', { style: { width: '170px' } }, ...[['added', 'Недавно добавленные'], ['opened', 'Недавно открытые'], ['title', 'По названию'], ['author', 'По автору'], ['series', 'По сериям']].map(([v, t]) => h('option', { value: v, selected: sort === v }, t)));
  sortSel.addEventListener('change', () => { setSetting('layout.librarySort', sortSel.value, { silent: true }); draw(); });
  const views = h('div.btn-group', {}, ...[['tiles', 'grid', 'Плитки'], ['list', 'list', 'Список']].map(([v, ico, t]) =>
    btn('', () => { setSetting('layout.libraryView', v, { silent: true }); go('library', {}, { replace: true }); }, { ico, title: t, cls: v === view ? 'on' : '' })));
  const tools = [h('div.search', {}, icon('search'), search), sortSel, views, btn('Добавить книги', importBooks, { cls: 'primary', ico: 'plus' })];

  const page = h('div.page', {},
    pageHead(isWh ? 'Полка // книги' : 'Личная полка', headingHtml(sectionTitle('library'), esc), { code: 'LIB', stamp: 'Библиотека', tools }),
    h('div', { id: 'lib-filters' }),
    h('div', { id: 'lib-body' }));
  el.append(page);
  const filterBox = page.querySelector('#lib-filters');
  const body = page.querySelector('#lib-body');

  const draw = () => {
    const all = libBooks();
    ensureMeta(all);
    filterBox.innerHTML = '';
    body.innerHTML = '';
    if (!all.length) {
      body.append(emptyState('ПОЛКА ПУСТА', 'В библиотеке пока нет книг',
        isWh ? 'Откройте вкладку «Браузер» и скачайте книги, они появятся здесь сами. Или нажмите «Добавить файлы», или откройте книгу из другого приложения через «Открыть в…».'
          : 'Нажмите «Добавить файлы» или откройте книгу из другого приложения через «Открыть в…». Подходят FB2, EPUB, PDF, TXT, DOCX, HTML, RTF и архивы.',
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center' } },
          isWh ? btn('Открыть сайт с книгами', () => go('browser', { url: BROWSER_HOME.warhammer[0].url }), { cls: 'primary', ico: 'compass' }) : btn('Каталоги', () => go('catalogs'), { ico: 'globe' }),
          btn('Добавить файлы', importBooks, { ico: 'upload' }))));
      return;
    }

    // Фильтры
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
    const authors = uniq(all.flatMap((b) => b.authors || []));
    const series = uniq(all.map((b) => b.series));
    const genres = uniq(all.flatMap((b) => [...(b.genres || []), ...(b.tags || [])]));
    const formats = uniq(all.map((b) => b.format));
    const sel = (key, label, opts) => {
      const s = h('select.select', {}, h('option', { value: '' }, label), opts.map((o) => h('option', { value: o, selected: filters[key] === o }, FORMAT_NAMES[o] && key === 'format' ? FORMAT_NAMES[o] : o)));
      s.addEventListener('change', () => { filters[key] = s.value; draw(); });
      return s;
    };
    const statusChips = h('div.chips', {}, ...[['', 'Все'], ['new', 'Не начаты'], ['reading', 'Читаю'], ['done', 'Прочитаны']].map(([v, t]) =>
      h(`button.chip${filters.status === v ? '.on' : ''}`, { onclick: () => { filters.status = v; draw(); } }, t)));
    const active = Object.entries(filters).some(([k, v]) => k !== 'q' && v);
    filterBox.append(h('div.lib-filters.panel', {},
      icon('filter'),
      authors.length > 1 ? sel('author', `Все авторы · ${authors.length}`, authors) : null,
      series.length ? sel('series', `Все серии · ${series.length}`, series) : null,
      genres.length ? sel('genre', 'Все жанры и метки', genres) : null,
      formats.length > 1 ? sel('format', 'Все форматы', formats) : null,
      statusChips,
      active ? btn('Сбросить', () => { Object.assign(filters, { author: '', series: '', genre: '', format: '', status: '' }); draw(); }, { cls: 'ghost' }) : null));

    // Отбор и сортировка
    const q = filters.q.trim().toLowerCase();
    let list = all.filter((b) => (!q || [b.title, ...(b.authors || []), b.series, ...(b.tags || [])].join(' ').toLowerCase().includes(q))
      && (!filters.author || (b.authors || []).includes(filters.author))
      && (!filters.series || b.series === filters.series)
      && (!filters.genre || [...(b.genres || []), ...(b.tags || [])].includes(filters.genre))
      && (!filters.format || b.format === filters.format)
      && (!filters.status || status(b) === filters.status));
    const cmp = {
      added: (a, b) => String(b.added).localeCompare(String(a.added)),
      opened: (a, b) => String(b.lastOpened || '').localeCompare(String(a.lastOpened || '')),
      title: (a, b) => a.title.localeCompare(b.title, 'ru'),
      author: (a, b) => ((a.authors || [])[0] || '').localeCompare((b.authors || [])[0] || '', 'ru') || a.title.localeCompare(b.title, 'ru'),
      series: (a, b) => (a.series || '￿').localeCompare(b.series || '￿', 'ru') || (a.seriesNum || 0) - (b.seriesNum || 0),
    }[sort] || (() => 0);
    list = list.sort(cmp);

    body.append(h('h2.sec', {}, list.length === all.length ? 'Все книги ' : 'Найдено ', h('span.count', {}, list.length), list.length !== all.length ? h('span', { style: { color: 'var(--dim)' } }, ` из ${all.length}`) : null));
    if (!list.length) { body.append(h('p', { style: { color: 'var(--dim)' } }, 'Под фильтры ничего не попало.')); return; }

    const card = (b) => {
      const p = getProgress(`lib:${b.id}`);
      const cov = bookCover(b);
      if (b.needsMeta) cov.append(h('span.badge.new', {}, '…'));
      else if (!p) cov.append(h('span.cover-fmt', {}, FORMAT_NAMES[b.format]));
      return h('button.card', { onclick: () => detail(b, go), ondblclick: (e) => { e.stopPropagation(); openBook(b, go); }, onmouseenter: () => sfx('hover'), title: b.annotation ? b.annotation.slice(0, 300) : b.title },
        cov,
        h('h3', {}, b.title),
        h('div.meta', {}, (b.authors || []).length ? h('span', {}, b.authors[0]) : null, b.series ? h('span', {}, h('b', {}, `${b.series}${b.seriesNum ? ` #${b.seriesNum}` : ''}`)) : null),
        p ? h('div.progress', {}, h('i', { style: { width: `${Math.round((p.frac || 0) * 100)}%` } })) : null);
    };
    const row = (b) => {
      const p = getProgress(`lib:${b.id}`);
      return h('div.row.panel', { onclick: () => detail(b, go), ondblclick: () => openBook(b, go) },
        bookCover(b),
        h('div', {}, h('h3', {}, b.title), h('p', {}, [(b.authors || []).join(', '), b.series && `${b.series}${b.seriesNum ? ` #${b.seriesNum}` : ''}`].filter(Boolean).join(' · ') || b.annotation)),
        h('div.right', {}, h('span', {}, [FORMAT_NAMES[b.format], b.words && `${readMinutes(b.words)} мин`].filter(Boolean).join(' · ')), h('div.progress', {}, h('i', { style: { width: `${Math.round(((p && p.frac) || 0) * 100)}%` } }))));
    };
    body.append(view === 'list' ? h('div.rows', {}, list.map(row)) : h('div.cards', {}, list.map(card)));
    window.__stagger && window.__stagger(body);
  };

  search.addEventListener('input', debounce(() => { filters.q = search.value; draw(); }, 200));
  draw();
  const off = on('library', () => draw());
  return () => off();
}
