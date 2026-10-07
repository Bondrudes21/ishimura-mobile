// Аудиокниги: список и страница книги с большим плеером
import { h, icon, btn, toast, modal, confirmBox, pageHead, emptyState, esc, plural, debounce, popover } from '../util.js';
import { state, mode, libAudio, libAudioById, libUrl, librarySpace, sectionTitle, headingHtml, on, BROWSER_HOME } from '../state.js';
import { coverSvg } from '../covers.js';
import { player, fmtTime } from '../audioplayer.js';
import { reportImport } from './library.js';
import { sfx } from '../sound.js';
import { isIOS } from '../platform/env.js';

const SPEEDS = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2, 2.5, 3];
let query = '';

export function audioCover(a) {
  const el = h('div.cover.square');
  const fallback = () => { el.innerHTML = coverSvg({ id: a.id, title: a.title, subtitle: a.author || '', motif: 'signal' }, { label: 'АУДИО' }); };
  if (a.cover) {
    const img = h('img', { src: libUrl(a.cover), alt: '', loading: 'lazy' });
    img.onerror = fallback;
    el.append(img);
  } else fallback();
  return el;
}

function progressOf(a) {
  const tr = a.tracks || [];
  if (!tr.length) return 0;
  if (a.finished) return 1;
  const p = a.position || { track: 0, time: 0 };
  if (tr.every((t) => t.duration)) {
    const total = tr.reduce((s, t) => s + t.duration, 0);
    let pos = p.time || 0;
    for (let i = 0; i < p.track; i++) pos += tr[i].duration;
    return total ? pos / total : 0;
  }
  return p.track / tr.length;
}

async function importAudio(kind) {
  const r = await window.ark.library.pick({ kind, space: librarySpace() });
  reportImport(r);
}

function editDialog(a) {
  modal((box, close) => {
    const inp = (v) => h('input.input', { value: v || '' });
    const title = inp(a.title), author = inp(a.author), narrator = inp(a.narrator);
    const ann = h('textarea.textarea', {}, a.annotation || '');
    const f = (l, c) => h('div.field', {}, h('label', {}, l), c);
    box.append(h('h2', {}, 'Данные аудиокниги'), f('Название', title), h('div.grid-2', {}, f('Автор', author), f('Чтец', narrator)), f('Описание', ann),
      btn('Сменить обложку', () => window.ark.library.pickCover('audio', a.id), { ico: 'image' }),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить', async () => {
        await window.ark.library.update('audio', a.id, { title: title.value.trim() || a.title, author: author.value.trim(), narrator: narrator.value.trim(), annotation: ann.value.trim() });
        close();
      }, { cls: 'primary' })));
  });
}

export function sleepMenu(anchor) {
  popover(anchor, (pop, close) => {
    const cur = player.sleep;
    const item = (val, label) => h(`button.menu-item${(cur.mode === 'time' && false) || (val === 'off' && cur.mode === 'off') || (val === 'chapter' && cur.mode === 'chapter') ? '.on' : ''}`, { onclick: () => { player.setSleep(val); close(); if (val !== 'off') toast('Таймер сна', label); } }, icon('moon'), h('span', {}, label));
    pop.append(item('off', 'Выключен'), item('15', 'Через 15 минут'), item('30', 'Через 30 минут'), item('45', 'Через 45 минут'), item('60', 'Через час'), item('chapter', 'В конце главы'));
  });
}

export function speedMenu(anchor) {
  popover(anchor, (pop, close) => {
    for (const s of SPEEDS) pop.append(h(`button.menu-item${Math.abs(player.speed - s) < 0.01 ? '.on' : ''}`, { onclick: () => { player.setSpeed(s); close(); } }, h('span', {}, `${s}×`)));
  });
}

function sleepLabel() {
  const s = player.sleep;
  if (s.mode === 'chapter') return 'до конца главы';
  if (s.mode === 'time') return `${Math.max(1, Math.ceil((s.until - Date.now()) / 60000))} мин`;
  return '';
}

function renderDetail(el, a, go) {
  const page = h('div.page.au-page');
  el.append(page);
  const draw = () => {
    const isCur = player.book && player.book.id === a.id;
    const playing = isCur && player.playing;
    const tr = isCur ? player.track : (a.position || {}).track || 0;
    const time = isCur ? player.time : (a.position || {}).time || 0;
    const dur = isCur ? player.duration : (a.tracks[tr] || {}).duration || 0;
    const tot = isCur ? player.totals() : null;

    const scrub = h('input', { type: 'range', min: 0, max: Math.max(1, dur), step: 1, value: time, class: 'au-scrub' });
    scrub.style.setProperty('--fill', `${dur ? (time / dur) * 100 : 0}%`);
    scrub.addEventListener('input', () => { scrub.style.setProperty('--fill', `${(scrub.value / dur) * 100}%`); });
    scrub.addEventListener('change', () => { if (!isCur) player.load(a.id, { autoplay: false }); player.seek(Number(scrub.value)); });

    page.innerHTML = '';
    page.append(...[
      h('div', { style: { marginBottom: '18px' } }, btn('К аудиокнигам', () => go('audio'), { ico: 'back', cls: 'ghost' })),
      h('div.au-hero', {},
        h('div.au-cover-wrap', {}, audioCover(a), playing ? h('div.au-wave', {}, h('i'), h('i'), h('i'), h('i'), h('i')) : null),
        h('div.au-main', {},
          h('div.bd-meta', {}, [`${a.tracks.length} ${plural(a.tracks.length, 'глава', 'главы', 'глав')}`, a.duration && fmtTime(a.duration), a.narrator && `читает ${a.narrator}`].filter(Boolean).join(' · ')),
          h('h1', {}, a.title),
          a.author ? h('div.bd-authors', {}, a.author) : null,
          h('div.au-chapter', {}, (a.tracks[tr] || {}).title || ''),
          h('div.au-time', {}, h('span', {}, fmtTime(time)), scrub, h('span', {}, dur ? `−${fmtTime(dur - time)}` : '')),
          tot && tot.total ? h('div.au-total', {}, `Прослушано ${fmtTime(tot.pos)} из ${fmtTime(tot.total)}, осталось ${fmtTime((tot.total - tot.pos) / (player.speed || 1))}`) : null,
          h('div.au-controls', {},
            btn('', () => { if (!isCur) player.load(a.id, { autoplay: false }); player.prev(); }, { ico: 'skipBack', cls: 'ghost', title: 'Предыдущая глава' }),
            btn('', () => { if (!isCur) player.load(a.id, { autoplay: false }); player.skip(-30); }, { ico: 'back30', cls: 'ghost', title: 'Назад 30 с' }),
            h('button.au-play', { onclick: () => { sfx('click'); if (isCur) player.toggle(); else player.load(a.id); }, title: playing ? 'Пауза' : 'Слушать' }, icon(playing ? 'pause' : 'play')),
            btn('', () => { if (!isCur) player.load(a.id, { autoplay: false }); player.skip(30); }, { ico: 'fwd30', cls: 'ghost', title: 'Вперёд 30 с' }),
            btn('', () => { if (!isCur) player.load(a.id, { autoplay: false }); player.next(); }, { ico: 'skipFwd', cls: 'ghost', title: 'Следующая глава' })),
          h('div.au-extra', {},
            btn(`${isCur ? player.speed : a.speed || 1}×`, (e) => { if (!isCur) player.load(a.id, { autoplay: false }); speedMenu(e.currentTarget); }, { cls: 'ghost', title: 'Скорость' }),
            btn(isCur && player.sleep.mode !== 'off' ? sleepLabel() : 'Таймер сна', (e) => sleepMenu(e.currentTarget), { ico: 'moon', cls: isCur && player.sleep.mode !== 'off' ? 'on' : 'ghost' }),
            btn('Закладка', () => { if (!isCur) player.load(a.id, { autoplay: false }); const bm = player.addBookmark(); if (bm) toast('Закладка', `${fmtTime(bm.time)} · глава ${bm.track + 1}`); }, { ico: 'bookmark', cls: 'ghost' }),
            btn('', () => editDialog(a), { ico: 'edit', cls: 'ghost', title: 'Изменить данные' }),
            btn('', async () => {
              if (!(await confirmBox('Убрать аудиокнигу?', 'Её файлы будут удалены из памяти приложения.', { ok: 'Убрать', danger: true }))) return;
              if (isCur) player.close();
              await window.ark.library.remove('audio', a.id);
              go('audio');
            }, { ico: 'trash', cls: 'ghost danger', title: 'Убрать' })),
          a.annotation ? h('p.bd-ann', {}, a.annotation) : null)),
      (a.bookmarks || []).length ? h('div', {}, h('h2.sec', {}, 'Закладки ', h('span.count', {}, a.bookmarks.length)),
        h('div.au-marks', {}, a.bookmarks.map((bm) => h('div.au-mark.panel', { onclick: () => player.load(a.id, { track: bm.track, time: bm.time }) },
          icon('bookmark'), h('span', {}, `Глава ${bm.track + 1} · ${fmtTime(bm.time)}`),
          btn('', (e) => { e.stopPropagation(); if (!isCur) player.load(a.id, { autoplay: false }); player.removeBookmark(bm.id); }, { ico: 'trash', cls: 'ghost' }))))) : null,
      h('h2.sec', {}, 'Главы ', h('span.count', {}, a.tracks.length)),
      h('div.au-tracks', {}, a.tracks.map((t, i) => h(`div.au-track${i === tr ? '.on' : ''}`, { onclick: () => player.load(a.id, { track: i, time: 0 }) },
        h('span.n', {}, String(i + 1).padStart(2, '0')),
        h('span.t', {}, t.title),
        i === tr && playing ? h('div.eq', {}, h('i'), h('i'), h('i')) : null,
        h('span.d', {}, t.duration ? fmtTime(t.duration) : '')))),
    ].filter(Boolean));
  };
  draw();
  let last = 0;
  const off = player.on(() => {
    const now = Date.now();
    if (document.activeElement && document.activeElement.classList.contains('au-scrub')) return;
    if (now - last > 900) { last = now; draw(); }
  });
  return () => off();
}

export function renderAudio(el, params, { go }) {
  if (params.id) {
    const a = libAudioById(params.id);
    if (a) return renderDetail(el, a, go);
  }
  const isWh = mode() === 'warhammer';
  const search = h('input.input', { placeholder: 'Название, автор, чтец…', value: query });
  const page = h('div.page', {},
    pageHead(isWh ? 'Полка // аудио' : 'Слушать', headingHtml(sectionTitle('audio'), esc), {
      code: 'AUD', stamp: 'Аудио',
      tools: [h('div.search', {}, icon('search'), search), isIOS ? null : btn('Добавить папку', () => importAudio('audioFolder'), { cls: 'primary', ico: 'folder' }), btn(isIOS ? 'Добавить файлы' : 'Файлы', () => importAudio('audioFiles'), { ico: 'upload', cls: isIOS ? 'primary' : '' })].filter(Boolean),
    }),
    h('div', { id: 'au-body' }));
  el.append(page);
  const body = page.querySelector('#au-body');

  const draw = () => {
    body.innerHTML = '';
    const all = libAudio();
    if (!all.length) {
      body.append(emptyState('ЗАПИСЕЙ НЕТ', 'Аудиокниг пока нет',
        (isIOS ? 'Нажмите «Добавить файлы» и выберите все главы книги (mp3 или m4b) — они станут одной аудиокнигой.'
          : 'Добавьте папку с mp3 или m4b. Каждая папка станет отдельной книгой, а файлы в ней главами.')
          + (isWh ? ' Архивы с аудиокнигами, скачанные во встроенном браузере, распакуются сами.' : ''),
        h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } },
          isIOS ? btn('Добавить файлы', () => importAudio('audioFiles'), { cls: 'primary', ico: 'upload' }) : btn('Добавить папку', () => importAudio('audioFolder'), { cls: 'primary', ico: 'folder' }),
          isWh ? btn('Открыть аудиокниги на сайте', () => go('browser', { url: BROWSER_HOME.warhammer[1].url }), { ico: 'compass' }) : null)));
      return;
    }
    const q = query.trim().toLowerCase();
    const list = all.filter((a) => !q || [a.title, a.author, a.narrator].join(' ').toLowerCase().includes(q))
      .sort((a, b) => String(b.lastPlayed || b.added).localeCompare(String(a.lastPlayed || a.added)));
    body.append(h('h2.sec', {}, 'Аудиокниги ', h('span.count', {}, list.length)));
    body.append(h('div.cards.au-grid', {}, list.map((a) => {
      const prog = progressOf(a);
      const isCur = player.book && player.book.id === a.id;
      const cov = audioCover(a);
      cov.append(h('button.au-card-play', { title: 'Слушать', onclick: (e) => { e.stopPropagation(); sfx('click'); if (isCur) player.toggle(); else player.load(a.id); } }, icon(isCur && player.playing ? 'pause' : 'play')));
      return h('div.card', { onclick: () => go('audio', { id: a.id }), onmouseenter: () => sfx('hover') },
        cov,
        h('h3', {}, a.title),
        h('div.meta', {}, a.author ? h('span', {}, a.author) : null, h('span', {}, a.duration ? fmtTime(a.duration) : `${a.tracks.length} гл.`)),
        h('div.progress', {}, h('i', { style: { width: `${Math.round(prog * 100)}%` } })));
    })));
    window.__stagger && window.__stagger(body);
  };
  search.addEventListener('input', debounce(() => { query = search.value; draw(); }, 200));
  draw();
  // Перерисовываем список только при смене книги или паузе, а не на каждый тик времени
  let sig = '';
  const offs = [on('library', draw), player.on(() => {
    const s = `${player.book ? player.book.id : ''}|${player.playing}`;
    if (s !== sig) { sig = s; draw(); }
  })];
  return () => offs.forEach((f) => f());
}
