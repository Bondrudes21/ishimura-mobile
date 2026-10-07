import { h, icon, btn, emptyState, pageHead, plural, esc } from '../util.js';
import { state, contentUrl, isUnseen, storyById, sectionTitle, headingHtml } from '../state.js';
import { sfx } from '../sound.js';

let filter = { album: null, tag: null };

export function renderGallery(el, params, { go }) {
  const g = state.manifest.gallery || { albums: [], items: [] };
  const items = g.items || [];
  el.append(h('div.page', {}, pageHead('Визуальный архив // раздел 02', headingHtml(sectionTitle('gallery'), esc), { code: `IMG-${String(items.length).padStart(3, '0')}`, stamp: 'Фото' })));
  const page = el.firstChild;

  if (!items.length) {
    page.append(emptyState('ВИЗУАЛЬНЫХ ДАННЫХ НЕТ', 'Галерея пока пуста', 'Здесь появятся арты, когда автор их загрузит.'));
    return;
  }

  // Новинки помечаем увиденными, пока пользователь смотрит
  const unseen = items.filter((i) => isUnseen('gallery', i.id)).map((i) => i.id);
  const seenT = unseen.length ? setTimeout(() => window.ark.content.seen('gallery', unseen), 3000) : null;

  const albums = g.albums || [];
  const tags = [...new Set(items.flatMap((i) => i.tags || []))].sort((a, b) => a.localeCompare(b, 'ru'));

  const chips = h('div', { style: { display: 'grid', gap: '10px', marginBottom: 'var(--gap)' } });
  const grid = h('div.masonry');
  page.append(chips, grid);

  const visible = () => items.filter((i) => (!filter.album || i.album === filter.album) && (!filter.tag || (i.tags || []).includes(filter.tag)));

  const draw = () => {
    chips.innerHTML = '';
    if (albums.length) {
      chips.append(h('div.chips', {},
        h(`button.chip${!filter.album ? '.on' : ''}`, { onclick: () => { filter.album = null; draw(); } }, `Все · ${items.length}`),
        albums.map((a) => {
          const n = items.filter((i) => i.album === a.id).length;
          return h(`button.chip${filter.album === a.id ? '.on' : ''}`, { onclick: () => { filter.album = a.id; draw(); }, title: a.description || '' }, `${a.title} · ${n}`);
        })));
    }
    if (tags.length) {
      chips.append(h('div.chips', {}, tags.map((t) => h(`button.chip${filter.tag === t ? '.on' : ''}`, { onclick: () => { filter.tag = filter.tag === t ? null : t; draw(); } }, `#${t}`))));
    }
    grid.innerHTML = '';
    const list = visible();
    if (!list.length) grid.append(h('p', { style: { color: 'var(--dim)' } }, 'Под фильтр ничего не попало.'));
    list.forEach((it, idx) => {
      grid.append(h('div.g-item', { onclick: () => { sfx('open'); lightbox(list, idx, go); } },
        h('img', { src: contentUrl(it.file), loading: 'lazy', alt: it.title || '' }),
        unseen.includes(it.id) ? h('span.badge.new', {}, 'Новое') : null,
        h('div.cap', {}, h('b', {}, it.title || 'Без названия'), h('span', {}, (it.tags || []).map((t) => `#${t}`).join(' ')))));
    });
  };
  draw();
  return () => clearTimeout(seenT);
}

export function lightbox(list, index, go, { info = true } = {}) {
  let i = index, scale = 1, tx = 0, ty = 0;
  const img = h('img', { draggable: false });
  const stage = h('div.lb-stage', {}, img);
  const infoBox = h('div.lb-info');
  const box = h(`div.lightbox${info ? '' : '.noinfo'}`, {}, stage, infoBox);

  const apply = () => { img.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale})`; };
  const show = () => {
    const it = list[i];
    scale = 1; tx = 0; ty = 0;
    img.src = contentUrl(it.file);
    apply();
    infoBox.innerHTML = '';
    const stories = (it.stories || []).map(storyById).filter(Boolean);
    const album = (state.manifest.gallery.albums || []).find((a) => a.id === it.album);
    infoBox.append(
      h('div.lb-counter', {}, `${String(i + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}${album ? ` · ${album.title.toUpperCase()}` : ''}`),
      h('h2', {}, it.title || 'Без названия'),
      it.description ? h('p', {}, it.description) : null,
      (it.tags || []).length ? h('div.chips', { style: { marginBottom: '18px' } }, it.tags.map((t) => h('span.tag', {}, `#${t}`))) : null,
      stories.length ? h('div', {}, h('div.lb-counter', {}, 'СВЯЗАННЫЕ ЗАПИСИ'), ...stories.map((s) => btn(s.title, () => { close(); go('reader', { id: s.id }); }, { ico: 'book', cls: 'ghost' }))) : null);
  };
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    sfx('close');
  };
  const nav = (d) => { i = (i + d + list.length) % list.length; sfx('click'); show(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowRight') nav(1);
    if (e.key === 'ArrowLeft') nav(-1);
  };
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.min(8, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 0.87)));
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  let drag = null;
  stage.addEventListener('mousedown', (e) => { if (e.target.closest('.btn')) return; drag = { x: e.clientX - tx, y: e.clientY - ty, moved: false }; stage.classList.add('drag'); });
  const onMove = (e) => { if (!drag) return; drag.moved = true; tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); };
  const onUp = () => { drag = null; stage.classList.remove('drag'); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  stage.addEventListener('dblclick', () => { scale = scale > 1 ? 1 : 2.5; tx = ty = 0; apply(); });

  stage.append(
    h('div.lb-tools', {},
      btn('', () => { scale = Math.min(8, scale * 1.3); apply(); }, { ico: 'zoomIn', title: 'Приблизить' }),
      btn('', () => { scale = Math.max(1, scale / 1.3); if (scale === 1) tx = ty = 0; apply(); }, { ico: 'zoomOut', title: 'Отдалить' }),
      btn('', () => box.classList.toggle('noinfo'), { ico: 'info', title: 'Описание' }),
      btn('', close, { ico: 'close', title: 'Закрыть (Esc)' })));
  if (list.length > 1) {
    stage.append(btn('', () => nav(-1), { ico: 'left', cls: 'lb-nav prev' }), btn('', () => nav(1), { ico: 'right', cls: 'lb-nav next' }));
  }
  document.addEventListener('keydown', onKey, true);
  document.getElementById('layers').append(box);
  show();
}
