import { h, icon, esc, emptyState, pageHead, btn } from '../util.js';
import { state, contentUrl, storyById, isUnseen, sectionTitle, headingHtml, term } from '../state.js';
import { lightbox } from './gallery.js';
import { sfx } from '../sound.js';

let currentId = null;
let query = '';

// Простая разметка статей:
//   ## Заголовок, **жирный**, *курсив*, пустая строка — новый абзац
//   [[id]] или [[id|текст]] — ссылка на статью кодекса, [[story:id|текст]] — ссылка на рассказ
export function renderMarkup(src) {
  src = term(src);
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[\[(story:)?([\w-]+)(?:\|([^\]]+))?\]\]/g, (m, st, id, label) => {
      const target = st ? storyById(id) : (state.manifest.codex.entries || []).find((e) => e.id === id);
      const text = label || (target ? target.title : id);
      return `<a data-${st ? 'story' : 'entry'}="${id}">${text}</a>`;
    });
  return String(src || '').split(/\n{2,}/).map((block) => {
    const t = block.trim();
    if (!t) return '';
    if (t.startsWith('### ')) return `<h3>${inline(t.slice(4))}</h3>`;
    if (t.startsWith('## ')) return `<h2>${inline(t.slice(3))}</h2>`;
    if (/^- /m.test(t) && t.split('\n').every((l) => l.startsWith('- '))) return `<ul>${t.split('\n').map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

export function renderCodex(el, params, { go }) {
  const codex = state.manifest.codex || { categories: [], entries: [] };
  const entries = codex.entries || [];
  const page = h('div.page', {}, pageHead('Энциклопедия колонии // раздел 04', headingHtml(sectionTitle('codex'), esc), { code: `CDX-${String(entries.length).padStart(3, '0')}`, stamp: 'Справка' }));
  el.append(page);

  if (!entries.length) {
    page.append(emptyState('СПРАВОЧНЫЕ ДАННЫЕ ОТСУТСТВУЮТ', 'Кодекс пока пуст', 'Здесь появятся статьи о кораблях, городах, фракциях, технологиях и людях.'));
    return;
  }

  if (params.id) currentId = params.id;
  if (!entries.some((e) => e.id === currentId)) currentId = entries[0].id;

  const cats = codex.categories || [];
  const catTitle = (id) => (cats.find((c) => c.id === id) || {}).title || 'Прочее';
  const search = h('input.input', { placeholder: 'Поиск по кодексу…', value: query });
  const list = h('div.codex-list');
  const article = h('div.article.panel');
  page.append(h('div.codex', {}, h('div.codex-side.panel', {}, h('div.search', {}, icon('search'), search), list), article));

  const drawList = () => {
    list.innerHTML = '';
    const q = query.trim().toLowerCase();
    const filtered = entries.filter((e) => !q || [e.title, e.summary, e.body].join(' ').toLowerCase().includes(q));
    const order = [...cats.map((c) => c.id), ...new Set(filtered.map((e) => e.category).filter((c) => !cats.some((x) => x.id === c)))];
    for (const cat of order) {
      const inCat = filtered.filter((e) => e.category === cat).sort((a, b) => a.title.localeCompare(b.title, 'ru'));
      if (!inCat.length) continue;
      list.append(h('div.codex-cat', {}, catTitle(cat)));
      for (const e of inCat) {
        list.append(h(`button.codex-link${e.id === currentId ? '.on' : ''}`, { onclick: () => { currentId = e.id; sfx('click'); drawList(); drawArticle(); } },
          h('span', {}, term(e.title)), isUnseen('codex', e.id) ? h('span.badge.new', {}, '•') : null));
      }
    }
    if (!list.children.length) list.append(h('p', { style: { color: 'var(--dim)', padding: '8px' } }, 'Ничего не найдено'));
  };

  const drawArticle = () => {
    const e = entries.find((x) => x.id === currentId);
    article.innerHTML = '';
    if (!e) return;
    window.ark.content.seen('codex', [e.id]);
    const body = h('div.body', { html: renderMarkup(e.body) });
    body.addEventListener('click', (ev) => {
      const a = ev.target.closest('a');
      if (!a) return;
      if (a.dataset.entry) { currentId = a.dataset.entry; drawList(); drawArticle(); }
      if (a.dataset.story) go('reader', { id: a.dataset.story });
    });
    const related = (e.stories || []).map(storyById).filter(Boolean);
    article.append(
      h('div.cat', {}, catTitle(e.category)),
      h('h1', {}, term(e.title)),
      e.image ? h('figure', {}, h('img', { src: contentUrl(e.image), onclick: () => lightbox([{ file: e.image, title: e.title }], 0, go, { info: false }) })) : null,
      e.summary ? h('div.lead', {}, term(e.summary)) : null,
      body,
      related.length ? h('div', { style: { clear: 'both', marginTop: '28px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('span', { style: { color: 'var(--dim)', fontSize: '11px', letterSpacing: '.2em', alignSelf: 'center' } }, 'УПОМИНАЕТСЯ В:'),
        related.map((s) => btn(s.title, () => go('reader', { id: s.id }), { ico: 'book', cls: 'ghost' }))) : null);
    article.scrollIntoView({ block: 'nearest' });
  };

  search.addEventListener('input', () => { query = search.value; drawList(); });
  drawList();
  drawArticle();
}
