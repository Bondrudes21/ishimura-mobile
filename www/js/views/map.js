import { h, btn, pageHead, esc } from '../util.js';
import { state, contentUrl, sectionTitle, headingHtml } from '../state.js';

export function renderMap(el, params, { go }) {
  const map = state.manifest.map;
  // По умолчанию раздел называется «Карта», но заголовок страницы — имя планеты
  const customName = ((state.settings.texts.sections || {}).map || '').trim();
  const title = customName ? headingHtml(sectionTitle('map'), esc) : 'Тиамат <em>II</em>';
  const page = h('div.page', {}, pageHead('Картография // раздел 05', title, { code: 'GEO-01', stamp: 'Карта' }));
  el.append(page);

  if (!map || !map.image) {
    page.append(h('div.empty', {},
      h('div.radar'),
      h('div.code', {}, 'КАРТОГРАФИЧЕСКИЕ ДАННЫЕ НЕ ПОЛУЧЕНЫ'),
      h('h3', {}, 'Спутниковая съёмка в процессе'),
      h('p', {}, 'Здесь будет карта Тиамата II, когда автор её добавит.')));
    return;
  }

  const img = h('img', { src: contentUrl(map.image), draggable: false });
  const layer = h('div.map-layer', {}, img);
  const wrap = h('div.map-wrap.panel', {}, layer);
  const card = h('div.map-card.panel', { style: { display: 'none' } });
  wrap.append(card);
  page.append(wrap);

  let scale = 1, tx = 0, ty = 0;
  const apply = () => {
    layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    layer.style.setProperty('--inv', 1 / scale);
  };

  img.onload = () => {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    tx = (W - img.naturalWidth * scale) / 2;
    ty = (H - img.naturalHeight * scale) / 2;
    apply();
    for (const m of map.markers || []) {
      const mk = h('div.marker', { 'data-label': m.title, style: { left: `${m.x * img.naturalWidth}px`, top: `${m.y * img.naturalHeight}px` } });
      mk.addEventListener('click', (e) => { e.stopPropagation(); showCard(m); });
      layer.append(mk);
    }
  };

  const entryTitle = (id) => ((state.manifest.codex.entries || []).find((e) => e.id === id) || {}).title;
  function showCard(m) {
    card.innerHTML = '';
    card.style.display = '';
    card.append(h('h3', {}, m.title), m.text ? h('p', {}, m.text) : null,
      h('div', { style: { display: 'flex', gap: '6px' } },
        m.codex && entryTitle(m.codex) ? btn('Открыть в кодексе', () => go('codex', { id: m.codex }), { ico: 'codex', cls: 'primary' }) : null,
        btn('', () => { card.style.display = 'none'; }, { ico: 'close', cls: 'ghost' })));
  }

  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = wrap.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = e.deltaY < 0 ? 1.15 : 0.87;
    const ns = Math.min(8, Math.max(0.1, scale * k));
    tx = mx - (mx - tx) * (ns / scale);
    ty = my - (my - ty) * (ns / scale);
    scale = ns;
    apply();
  }, { passive: false });
  let drag = null;
  wrap.addEventListener('mousedown', (e) => { if (e.target.closest('.map-card, .marker')) return; drag = { x: e.clientX - tx, y: e.clientY - ty }; wrap.classList.add('drag'); });
  const onMove = (e) => { if (!drag) return; tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); };
  const onUp = () => { drag = null; wrap.classList.remove('drag'); };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
}
