import { h, btn, emptyState, pageHead, esc, plural } from '../util.js';
import { state, storyById, isUnseen, setSetting, term, sectionTitle, headingHtml } from '../state.js';
import { sfx } from '../sound.js';

const PERIOD_COLORS = ['var(--accent)', 'var(--warn)', 'var(--danger)', 'var(--accent-2)'];

function data() {
  const events = [...(state.manifest.timeline || [])]
    .map((e) => ({ ...e, y: Number(e.year) || 0, title: term(e.title), text: term(e.text), era: term(e.era) }))
    .sort((a, b) => a.y - b.y);
  const periods = [...(state.manifest.periods || [])]
    .map((p, i) => ({ ...p, from: Number(p.from), to: Number(p.to), title: term(p.title), note: term(p.note), color: p.color || PERIOD_COLORS[i % PERIOD_COLORS.length] }))
    .sort((a, b) => a.from - b.from);
  return { events, periods };
}

const years = (n) => `${n} ${plural(n, 'год', 'года', 'лет')}`;

export function renderTimeline(el, params, { go }) {
  const { events, periods } = data();
  const mode = state.settings.layout.timelineView;
  const switcher = h('div.btn-group', {},
    btn('Шкала', () => { setSetting('layout.timelineView', 'scale', { silent: true }); go('timeline', {}, { replace: true }); }, { ico: 'timeline', cls: mode === 'scale' ? 'on' : '' }),
    btn('Список', () => { setSetting('layout.timelineView', 'list', { silent: true }); go('timeline', {}, { replace: true }); }, { ico: 'list', cls: mode === 'list' ? 'on' : '' }));
  const page = h('div.page', {}, pageHead('Летопись колонии // раздел 03', headingHtml(sectionTitle('timeline'), esc), { code: `TL-${String(events.length).padStart(3, '0')}`, stamp: 'Летопись', tools: events.length ? [switcher] : [] }));
  el.append(page);

  if (!events.length) {
    page.append(emptyState('ЛЕТОПИСЬ НЕ ЗАПОЛНЕНА', 'Хроника пока пуста', 'Здесь появятся события истории Тиамата II.'));
    return;
  }
  const unseen = events.filter((e) => isUnseen('timeline', e.id)).map((e) => e.id);
  if (unseen.length) setTimeout(() => window.ark.content.seen('timeline', unseen), 2500);

  if (mode === 'list') return renderList(page, events, periods, unseen, go);
  return renderScale(page, events, periods, unseen, go);
}

// ---------- Список ----------
function renderList(page, events, periods, unseen, go) {
  const items = [
    ...periods.map((p) => ({ kind: 'period', y: p.from, p })),
    ...events.map((e) => ({ kind: 'event', y: e.y, e })),
  ].sort((a, b) => a.y - b.y || (a.kind === 'period' ? -1 : 1));
  const list = h('div.timeline.tl-list');
  for (const it of items) {
    if (it.kind === 'period') {
      const p = it.p;
      list.append(h('div.tl-period', { style: { '--pc': p.color } },
        h('div.tl-period-years', {}, `${p.from} — ${p.to}`),
        h('div', {}, h('h3', {}, p.title), h('p', {}, p.note || years(p.to - p.from)))));
      continue;
    }
    const ev = it.e;
    const story = ev.story && storyById(ev.story);
    list.append(h('div.t-event.panel', { id: `ev-${ev.id}` },
      h('div.t-year', {}, ev.year || '?'),
      ev.date ? h('div.date', {}, ev.date) : null,
      h('h3', {}, ev.title, unseen.includes(ev.id) ? h('span.badge.new', { style: { marginLeft: '10px', verticalAlign: '3px' } }, 'Новое') : null),
      ev.text ? h('p', {}, ev.text) : null,
      story ? btn(`Читать: ${story.title}`, () => go('reader', { id: story.id }), { ico: 'book', cls: 'ghost' }) : null));
  }
  page.append(list);
}

// ---------- Шкала ----------
function renderScale(page, events, periods, unseen, go) {
  const all = [...events.map((e) => e.y), ...periods.flatMap((p) => [p.from, p.to])];
  const minY = Math.min(...all), maxY = Math.max(...all);
  const span = Math.max(10, maxY - minY);

  const vp = h('div.tl-viewport');
  const axis = h('div.tl-axis');
  const ticksLayer = h('div.tl-ticks');
  const bandsLayer = h('div.tl-bands');
  const evLayer = h('div.tl-events');
  vp.append(ticksLayer, axis, bandsLayer, evLayer);
  const detail = h('div.tl-detail.panel');
  const zoomLbl = h('span.tl-zoom-lbl');
  const box = h('div.tl-scale.panel', {}, vp,
    h('div.tl-tools', {},
      btn('', () => zoomBy(1 / 1.5), { ico: 'zoomOut', title: 'Отдалить' }),
      btn('', () => zoomBy(1.5), { ico: 'zoomIn', title: 'Приблизить' }),
      btn('Вся история', fit, { ico: 'fullscreen' }),
      zoomLbl),
    h('div.tl-hint', {}, 'Колесо мыши меняет масштаб, перетаскивание двигает шкалу, стрелки листают события'));
  page.append(box, detail);

  // Полосы эпох
  const bandEls = periods.map((p) => {
    const b = h('button.tl-band', { style: { '--pc': p.color }, title: `${p.title} · ${p.from}–${p.to}`, onclick: () => focusRange(p.from, p.to) },
      h('span', {}, p.title), h('small', {}, p.note || years(p.to - p.from)));
    bandsLayer.append(b);
    return { p, b };
  });

  // События
  let selected = Math.max(0, events.findIndex((e) => unseen.includes(e.id)));
  const evEls = events.map((ev, i) => {
    const label = h('button.tl-label', { onclick: (e) => { e.stopPropagation(); select(i, true); } },
      h('b', {}, ev.year), h('span', {}, ev.title), unseen.includes(ev.id) ? h('i.tl-new') : null);
    const stem = h('div.tl-stem');
    const dot = h('button.tl-dot', { onclick: (e) => { e.stopPropagation(); select(i, true); }, title: `${ev.year} — ${ev.title}` });
    evLayer.append(stem, label, dot);
    return { ev, label, stem, dot, w: 0 };
  });

  // Пул делений шкалы
  const tickPool = [];

  let W = 0, start = 0, ppy = 1, tStart = 0, tPpy = 1, raf = null;
  const AXIS_Y = 0.47;

  function clampView(s, p) {
    const minP = (W * 0.5) / (span + 60), maxP = 60;
    p = Math.min(maxP, Math.max(minP, p));
    const visible = W / p;
    const lo = minY - 40 - visible * 0.4, hi = maxY + 40 - visible * 0.6;
    s = Math.min(Math.max(s, lo), Math.max(lo, hi));
    return [s, p];
  }
  function setTarget(s, p, instant) {
    [tStart, tPpy] = clampView(s, p);
    if (instant) { start = tStart; ppy = tPpy; }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = null;
    const k = state.settings.theme.effects.animations ? 0.18 : 1;
    start += (tStart - start) * k;
    ppy *= Math.pow(tPpy / ppy, k);
    const doneMove = Math.abs(tStart - start) * ppy < 0.3 && Math.abs(tPpy / ppy - 1) < 0.002;
    if (doneMove) { start = tStart; ppy = tPpy; }
    layout();
    if (!doneMove) raf = requestAnimationFrame(tick);
  }

  const X = (y) => (y - start) * ppy;

  function layout() {
    const H = vp.clientHeight;
    const ay = Math.round(H * AXIS_Y);
    axis.style.top = `${ay}px`;
    bandsLayer.style.top = `${ay + 10}px`;
    zoomLbl.textContent = `${Math.round(W / ppy)} лет в окне`;

    // Деления
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
    const step = steps.find((s) => s * ppy >= 72) || 1000;
    const first = Math.ceil(start / step) * step;
    let n = 0;
    for (let y = first; X(y) <= W; y += step, n++) {
      let t = tickPool[n];
      if (!t) { t = h('div.tl-tick', {}, h('span')); ticksLayer.append(t); tickPool.push(t); }
      t.style.display = '';
      t.style.transform = `translateX(${X(y)}px)`;
      t.style.top = `${ay}px`;
      t.classList.toggle('major', y % (step * 5) === 0);
      t.firstChild.textContent = y;
    }
    for (let i = n; i < tickPool.length; i++) tickPool[i].style.display = 'none';

    // Эпохи
    for (const { p, b } of bandEls) {
      const x1 = X(p.from), x2 = X(p.to);
      b.style.transform = `translateX(${x1}px)`;
      b.style.width = `${Math.max(4, x2 - x1)}px`;
      b.classList.toggle('narrow', x2 - x1 < 120);
    }

    // События: подписи раскладываются по уровням; если места нет — сворачиваются в «чип» с годом.
    // Выбранное событие раскладывается первым, чтобы его подпись всегда была полной.
    const LEVELS = [-178, -102, 52, 128];      // смещение верха подписи от оси
    const FULL_H = 68, MINI_W = 58;
    const spans = LEVELS.map(() => []);
    const fits = (li, a, b) => spans[li].every(([s, e]) => b < s - 8 || a > e + 8);
    const order = evEls.map((o, i) => i).sort((a, b) => (a === selected ? -1 : b === selected ? 1 : a - b));
    for (const i of order) {
      const o = evEls[i];
      if (!o.w) { o.label.classList.remove('mini'); o.w = o.label.offsetWidth || 190; }
      const x = X(o.ev.y);
      const place = (w) => {
        const a = Math.min(Math.max(6, x - w / 2), W - w - 6);
        return [a, a + w];
      };
      let mini = false, lvl = -1, [a, b] = place(o.w);
      for (let li = 0; li < LEVELS.length && lvl < 0; li++) if (fits(li, a, b)) lvl = li;
      if (lvl < 0) {
        mini = true;
        [a, b] = place(MINI_W);
        for (let li = 0; li < LEVELS.length && lvl < 0; li++) if (fits(li, a, b)) lvl = li;
      }
      const hidden = lvl < 0;
      if (hidden) lvl = 0;
      else spans[lvl].push([a, b]);
      o.label.classList.toggle('mini', mini);
      const ly = ay + LEVELS[lvl] + (mini && LEVELS[lvl] < 0 ? FULL_H - 30 : 0);
      o.dot.style.transform = `translate(${x}px, ${ay}px)`;
      o.label.style.transform = `translate(${a}px, ${ly}px)`;
      const labelBottom = ly + (mini ? 30 : FULL_H);
      const top = LEVELS[lvl] < 0 ? labelBottom : ay, bottom = LEVELS[lvl] < 0 ? ay : ly;
      o.stem.style.transform = `translate(${x}px, ${top}px)`;
      o.stem.style.height = `${Math.max(0, bottom - top)}px`;
      const on = i === selected;
      o.label.classList.toggle('on', on);
      o.dot.classList.toggle('on', on);
      o.stem.classList.toggle('on', on);
      const visible = x > -40 && x < W + 40;
      o.dot.style.visibility = visible ? '' : 'hidden';
      o.label.style.visibility = o.stem.style.visibility = visible && !hidden ? '' : 'hidden';
    }
  }

  function fit() {
    const p = (W - 120) / (span + 20);
    setTarget(minY - 10 - 60 / p, p);
  }
  function focusRange(a, b) {
    sfx('click');
    const p = (W - 200) / Math.max(5, b - a);
    setTarget(a - 100 / p, p);
  }
  function zoomBy(f, cx = W / 2) {
    const yAt = start + cx / ppy;
    const np = tPpy * f;
    setTarget(yAt - cx / clampView(0, np)[1], np);
  }
  function select(i, center) {
    selected = Math.max(0, Math.min(events.length - 1, i));
    sfx('click');
    drawDetail();
    if (center) {
      const x = X(events[selected].y);
      if (x < W * 0.15 || x > W * 0.85) setTarget(events[selected].y - (W / 2) / tPpy, tPpy);
    }
    layout();
  }

  function drawDetail() {
    const ev = events[selected];
    const story = ev.story && storyById(ev.story);
    const inPeriods = periods.filter((p) => ev.y >= p.from && ev.y <= p.to);
    detail.innerHTML = '';
    detail.append(
      h('div.tl-d-year', {}, ev.year),
      h('div.tl-d-body', {},
        h('div.tl-d-meta', {}, [ev.date, ...inPeriods.map((p) => p.title)].filter(Boolean).join(' · ') || 'Хроника Тиамата II'),
        h('h3', {}, ev.title),
        ev.text ? h('p', {}, ev.text) : null,
        story ? btn(`Читать: ${story.title}`, () => go('reader', { id: story.id }), { ico: 'book', cls: 'primary' }) : null),
      h('div.tl-d-nav', {},
        btn('', () => select(selected - 1, true), { ico: 'left', title: 'Предыдущее (←)', disabled: selected === 0 }),
        h('span', {}, `${selected + 1} / ${events.length}`),
        btn('', () => select(selected + 1, true), { ico: 'right', title: 'Следующее (→)', disabled: selected === events.length - 1 })));
    detail.classList.remove('swap'); void detail.offsetWidth; detail.classList.add('swap');
  }

  // Взаимодействие
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) { setTarget(tStart + (e.deltaX || e.deltaY) / tPpy, tPpy); return; }
    zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left);
  }, { passive: false });
  let drag = null;
  vp.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, s: tStart };
    vp.setPointerCapture(e.pointerId);
    vp.classList.add('drag');
  });
  vp.addEventListener('pointermove', (e) => { if (drag) setTarget(drag.s - (e.clientX - drag.x) / tPpy, tPpy, true); });
  vp.addEventListener('pointerup', () => { drag = null; vp.classList.remove('drag'); });
  const onKey = (e) => {
    if (e.target instanceof Element && e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowRight') select(selected + 1, true);
    if (e.key === 'ArrowLeft') select(selected - 1, true);
  };
  document.addEventListener('keydown', onKey);

  const ro = new ResizeObserver(() => {
    const first = !W;
    W = vp.clientWidth;
    if (first) { fit(); start = tStart; ppy = tPpy; }
    layout();
  });
  ro.observe(vp);
  drawDetail();

  return () => { ro.disconnect(); document.removeEventListener('keydown', onKey); if (raf) cancelAnimationFrame(raf); };
}
