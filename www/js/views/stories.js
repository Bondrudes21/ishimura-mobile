import { h, icon, btn, esc, plural, readMinutes, emptyState, pageHead, hash, fmtDate, debounce } from '../util.js';
import { state, stories, seriesById, getProgress, isUnseen, setSetting, removeMark, storyById, sectionTitle, headingHtml } from '../state.js';
import { coverEl } from '../covers.js';
import { sfx } from '../sound.js';

let query = '';

function storyMeta(s) {
  const p = getProgress(s.id);
  return [
    s.year ? h('span', {}, 'Год ', h('b', {}, s.year)) : null,
    h('span', {}, `${readMinutes(s.words)} мин`),
    p && p.done ? h('span', {}, h('b', {}, '✓ Прочитано')) : p ? h('span', {}, h('b', {}, `${Math.round(p.frac * 100)}%`)) : null,
  ];
}

function progressBar(frac) {
  return h('div.progress', {}, h('i', { style: { width: `${Math.round((frac || 0) * 100)}%` } }));
}

// Элементы верхнего уровня: циклы и одиночные рассказы
function topLevel() {
  const list = stories();
  const items = [];
  const seen = new Set();
  for (const s of list) {
    if (s.series && seriesById(s.series)) {
      if (seen.has(s.series)) continue;
      seen.add(s.series);
      const ser = seriesById(s.series);
      const chapters = list.filter((x) => x.series === s.series).sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
      items.push({ kind: 'series', item: ser, chapters, order: s.order ?? 0, published: chapters.map((c) => c.published).sort().at(-1) });
    } else {
      items.push({ kind: 'story', item: s, order: s.order ?? 0, published: s.published });
    }
  }
  const sort = state.settings.layout.storiesSort;
  if (sort === 'new') items.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  else if (sort === 'title') items.sort((a, b) => a.item.title.localeCompare(b.item.title, 'ru'));
  else items.sort((a, b) => a.order - b.order);
  return items;
}

function seriesProgress(chapters) {
  if (!chapters.length) return 0;
  return chapters.reduce((sum, c) => sum + ((getProgress(c.id) || {}).frac || 0), 0) / chapters.length;
}

function seriesUnseen(chapters) {
  return chapters.filter((c) => isUnseen('stories', c.id)).length;
}

function renderTile(entry, go) {
  if (entry.kind === 'series') {
    const { item, chapters } = entry;
    const cov = coverEl({ ...item, subtitle: `${chapters.length} ${plural(chapters.length, 'глава', 'главы', 'глав')}` }, { label: 'ЦИКЛ' });
    const n = seriesUnseen(chapters);
    if (n) cov.append(h('span.badge.new', {}, `+${n}`));
    return h('button.card.series', { onclick: () => go('series', { id: item.id }), onmouseenter: () => sfx('hover') },
      cov, h('h3', {}, item.title),
      h('div.meta', {}, h('span', {}, h('b', {}, 'Цикл')), h('span', {}, `${chapters.length} ${plural(chapters.length, 'глава', 'главы', 'глав')}`)),
      progressBar(seriesProgress(chapters)));
  }
  const s = entry.item;
  const cov = coverEl(s);
  if (isUnseen('stories', s.id)) cov.append(h('span.badge.new', {}, 'Новое'));
  const p = getProgress(s.id);
  return h('button.card', { onclick: () => go('reader', { id: s.id }), onmouseenter: () => sfx('hover') },
    cov, h('h3', {}, s.title), h('div.meta', {}, storyMeta(s)), p ? progressBar(p.frac) : null);
}

function renderRow(entry, go) {
  const isSer = entry.kind === 'series';
  const it = entry.item;
  const chapters = entry.chapters || [];
  const frac = isSer ? seriesProgress(chapters) : (getProgress(it.id) || {}).frac || 0;
  const unseen = isSer ? seriesUnseen(chapters) : isUnseen('stories', it.id);
  return h('div.row.panel', { onclick: () => go(isSer ? 'series' : 'reader', { id: it.id }), onmouseenter: () => sfx('hover') },
    coverEl(it, isSer ? { label: 'ЦИКЛ' } : {}),
    h('div', {},
      h('h3', {}, it.title, unseen ? h('span.badge.new', { style: { marginLeft: '10px', verticalAlign: '3px' } }, 'Новое') : null),
      h('p', {}, isSer ? (it.description || `${chapters.length} ${plural(chapters.length, 'глава', 'главы', 'глав')}`) : (it.summary || it.subtitle || ''))),
    h('div.right', {},
      h('span', {}, isSer ? `Цикл · ${chapters.length} гл.` : [it.year ? `${it.year} · ` : '', `${readMinutes(it.words)} мин`]),
      progressBar(frac)));
}

function renderShelf(items, go) {
  const shelf = h('div.shelf');
  for (const entry of items) {
    const list = entry.kind === 'series' ? entry.chapters : [entry.item];
    for (const s of list) {
      const p = getProgress(s.id);
      const k = hash(s.id);
      const mix = 25 + (k % 50);
      const sp = h(`button.spine${p && p.done ? '.read' : ''}`, {
        style: { '--sp': `color-mix(in srgb, var(--accent) ${mix}%, var(--bg-3))`, '--h': `${200 + (k % 50)}px` },
        title: `${s.title}${s.subtitle ? ' — ' + s.subtitle : ''}`,
        onclick: () => go('reader', { id: s.id }),
        onmouseenter: () => sfx('hover'),
      }, h('span.y', {}, s.year || ''), h('span.t', {}, s.title), h('span.y', {}, isUnseen('stories', s.id) ? '●' : ''));
      shelf.append(sp);
    }
  }
  return shelf;
}

function continueCard(go) {
  const id = state.reader.last;
  const s = id && storyById(id);
  const p = s && getProgress(id);
  if (!s || !p || p.done) return null;
  const left = Math.max(1, Math.round(readMinutes(s.words) * (1 - p.frac)));
  return h('div.continue.panel', { onclick: () => go('reader', { id }) },
    coverEl(s),
    h('div', {},
      h('div.eyebrow', {}, 'Последний сеанс чтения'),
      h('h3', {}, s.title),
      h('p', {}, `Остановились на ${Math.round(p.frac * 100)}% · осталось ≈ ${left} мин`),
      progressBar(p.frac),
      h('div', { style: { marginTop: '16px' } }, btn('Продолжить', () => go('reader', { id }), { cls: 'primary', ico: 'play' }))));
}

function marksBlock(go) {
  const marks = [...state.reader.bookmarks.map((b) => ({ ...b, kind: 'bookmarks' })), ...state.reader.quotes.map((q) => ({ ...q, kind: 'quotes' }))]
    .filter((m) => storyById(m.story))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 6);
  if (!marks.length) return null;
  return [
    h('h2.sec', {}, 'Закладки и цитаты ', h('span.count', {}, marks.length)),
    h('div.search-results', {}, marks.map((m) => h('div.search-hit.panel', { onclick: () => go('reader', { id: m.story, para: m.para }) },
      h('h4', {}, `${m.kind === 'quotes' ? '❝ Цитата' : '▍Закладка'} · ${storyById(m.story).title}`),
      h('p', {}, m.text || m.excerpt || ''),
      h('div', { style: { textAlign: 'right', marginTop: '6px' } }, btn('', (e) => { e.stopPropagation(); removeMark(m.kind, m.id); go('stories', {}, { replace: true }); }, { ico: 'trash', cls: 'ghost', title: 'Удалить' }))))),
  ];
}

// Полнотекстовый поиск по всем рассказам
const textCache = new Map();
async function searchTexts(q, box, go) {
  box.innerHTML = '';
  box.append(h('p', { style: { color: 'var(--dim)' } }, 'Сканирование архива…'));
  const ql = q.toLowerCase();
  const hits = [];
  for (const s of stories()) {
    if (!textCache.has(s.id)) {
      try {
        const html = await window.ark.content.read(s.file);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        textCache.set(s.id, [...doc.body.children].map((el) => el.textContent));
      } catch { textCache.set(s.id, []); }
    }
    textCache.get(s.id).forEach((t, i) => {
      const idx = t.toLowerCase().indexOf(ql);
      if (idx >= 0) hits.push({ s, para: i, text: t, idx });
    });
  }
  box.innerHTML = '';
  if (!hits.length) { box.append(h('p', { style: { color: 'var(--dim)' } }, 'В текстах совпадений нет.')); return; }
  box.append(h('h2.sec', {}, 'Совпадения в текстах ', h('span.count', {}, hits.length)));
  const list = h('div.search-results');
  for (const hit of hits.slice(0, 80)) {
    const from = Math.max(0, hit.idx - 90);
    const snip = (from ? '…' : '') + esc(hit.text.slice(from, hit.idx)) + '<mark>' + esc(hit.text.slice(hit.idx, hit.idx + q.length)) + '</mark>' + esc(hit.text.slice(hit.idx + q.length, hit.idx + q.length + 160)) + '…';
    list.append(h('div.search-hit.panel', { onclick: () => go('reader', { id: hit.s.id, para: hit.para, q }) }, h('h4', {}, hit.s.title), h('p', { html: snip })));
  }
  box.append(list);
}

export function renderStories(el, params, { go }) {
  const total = stories().length;
  const viewMode = state.settings.layout.storiesView;

  const search = h('input.input', { placeholder: 'Поиск по архиву…', value: query });
  const sort = h('select.select', { style: { width: '170px' } },
    ...[['chrono', 'По хронологии'], ['new', 'Сначала новые'], ['title', 'По названию']].map(([v, t]) => h('option', { value: v, selected: state.settings.layout.storiesSort === v }, t)));
  sort.addEventListener('change', () => { setSetting('layout.storiesSort', sort.value, { silent: true }); go('stories', {}, { replace: true }); });
  const modes = h('div.btn-group', {}, ...[['tiles', 'grid', 'Плитки'], ['list', 'list', 'Список'], ['shelf', 'shelf', 'Полка']].map(([m, ico, t]) =>
    btn('', () => { setSetting('layout.storiesView', m, { silent: true }); go('stories', {}, { replace: true }); }, { ico, title: t, cls: m === viewMode ? 'on' : '' })));

  el.append(h('div.page', {},
    pageHead('Бортовой архив // раздел 01', headingHtml(sectionTitle('stories'), esc), { code: `REC-${String(total).padStart(3, '0')}`, stamp: 'Архив', tools: [h('div.search', {}, icon('search'), search), sort, modes] }),
    h('div', { id: 'stories-body' })));

  const body = el.querySelector('#stories-body');

  const draw = () => {
    body.innerHTML = '';
    if (!total) {
      body.append(emptyState('АРХИВ ПУСТ', 'Записей пока нет', 'Когда автор опубликует первый рассказ, он появится здесь.'));
      return;
    }
    if (query.trim().length >= 2) {
      const q = query.trim().toLowerCase();
      const byTitle = stories().filter((s) => [s.title, s.subtitle, s.summary, ...(s.tags || [])].join(' ').toLowerCase().includes(q));
      if (byTitle.length) {
        body.append(h('h2.sec', {}, 'Записи ', h('span.count', {}, byTitle.length)), h('div.cards', {}, byTitle.map((s) => renderTile({ kind: 'story', item: s }, go))));
      }
      const textBox = h('div');
      body.append(textBox);
      searchTexts(query.trim(), textBox, go);
      return;
    }
    const cont = continueCard(go);
    if (cont) body.append(cont);
    const items = topLevel();
    body.append(h('h2.sec', {}, 'Все записи ', h('span.count', {}, total)));
    if (viewMode === 'list') body.append(h('div.rows', {}, items.map((e) => renderRow(e, go))));
    else if (viewMode === 'shelf') body.append(renderShelf(items, go));
    else body.append(h('div.cards', {}, items.map((e) => renderTile(e, go))));
    const marks = marksBlock(go);
    if (marks) body.append(...marks);
  };

  search.addEventListener('input', debounce(() => { query = search.value; draw(); }, 250));
  draw();
}

export function renderSeries(el, { id }, { go }) {
  const ser = seriesById(id);
  if (!ser) return go('stories', {}, { replace: true });
  const chapters = stories().filter((s) => s.series === id).sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0));
  const next = chapters.find((c) => !(getProgress(c.id) || {}).done) || chapters[0];
  el.append(h('div.page', {},
    h('div', { style: { marginBottom: '20px' } }, btn('К архиву', () => go('stories'), { ico: 'back', cls: 'ghost' })),
    h('div.series-hero', {},
      coverEl(ser, { label: 'ЦИКЛ' }),
      h('div', {},
        h('span.eyebrow', { style: { color: 'var(--accent)', fontSize: '11px', letterSpacing: '.24em' } }, 'ЦИКЛ ЗАПИСЕЙ'),
        h('h1', {}, ser.title),
        ser.description ? h('p', {}, ser.description) : null,
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '18px' } },
          next ? btn(getProgress(next.id) ? 'Продолжить' : 'Начать чтение', () => go('reader', { id: next.id }), { cls: 'primary', ico: 'play' }) : null,
          h('span', { style: { color: 'var(--dim)' } }, `${chapters.length} ${plural(chapters.length, 'глава', 'главы', 'глав')} · ≈ ${readMinutes(chapters.reduce((a, c) => a + (c.words || 0), 0))} мин`)))),
    h('h2.sec', {}, 'Главы'),
    h('div.chapters', {}, chapters.map((c, i) => {
      const p = getProgress(c.id);
      return h('div.chapter.panel', { onclick: () => go('reader', { id: c.id }), onmouseenter: () => sfx('hover') },
        h('div.num', {}, String(c.chapter ?? i + 1).padStart(2, '0')),
        h('div', {}, h('h3', {}, c.title, isUnseen('stories', c.id) ? h('span.badge.new', { style: { marginLeft: '10px' } }, 'Новое') : null),
          h('p', {}, [c.subtitle, c.year && `год ${c.year}`, `${readMinutes(c.words)} мин`, c.published && `опубликовано ${fmtDate(c.published)}`].filter(Boolean).join(' · '))),
        h('div', { style: { width: '120px' } }, p ? progressBar(p.frac) : h('span', { style: { color: 'var(--dim)', fontSize: '11px' } }, 'НЕ ПРОЧИТАНО')));
    }))));
}
