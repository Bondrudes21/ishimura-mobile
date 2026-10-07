// Режим автора: черновик изменений архива → публикация одним коммитом в GitHub
import { h, icon, btn, toast, modal, confirmBox, promptBox, pageHead, slug, uniqueId, plural, readMinutes, fmtDate, esc } from '../util.js';
import { state, contentUrl, emit, on } from '../state.js';
import { coverSvg } from '../covers.js';
import { sfx } from '../sound.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
let draft = null;
let tab = 'stories';
let rerender = () => {};

function ensureDraft() {
  if (draft) return draft;
  const m = clone(state.manifest);
  delete m.files;
  m.series ||= []; m.stories ||= []; m.music ||= []; m.timeline ||= [];
  m.gallery ||= { albums: [], items: [] }; m.gallery.albums ||= []; m.gallery.items ||= [];
  m.codex ||= { categories: [], entries: [] }; m.codex.categories ||= []; m.codex.entries ||= [];
  m.periods ||= []; m.terms ||= {};
  draft = { m, adds: new Map(), deletes: new Set(), previews: new Map(), log: [] };
  return draft;
}

on('manifest', () => { if (draft && !draft.log.length) draft = null; });

const log = (op, text) => { draft.log.push({ op, text }); };
function addFile(path, src, previewUrl) {
  draft.deletes.delete(path);
  draft.adds.set(path, src);
  if (previewUrl) draft.previews.set(path, previewUrl);
}
function existingFiles() { return Object.keys(state.manifest.files || {}); }
function removeFile(path) {
  if (!path) return;
  draft.adds.delete(path);
  draft.previews.delete(path);
  if (existingFiles().includes(path)) draft.deletes.add(path);
}
function removePrefix(prefix, except = []) {
  for (const p of [...existingFiles(), ...draft.adds.keys()]) if (p.startsWith(prefix) && !except.includes(p)) removeFile(p);
}
const preview = (path) => (path ? draft.previews.get(path) || contentUrl(path) : '');
const ext = (name) => (name.split('.').pop() || 'bin').toLowerCase();

// ---------- Поля форм ----------
const field = (label, ctl, hint) => h('div.field', {}, h('label', {}, label), ctl, hint ? h('div.hint', {}, hint) : null);
const input = (value = '', attrs = {}) => h('input.input', { value: value ?? '', ...attrs });
const area = (value = '', attrs = {}) => h('textarea.textarea', { ...attrs }, value ?? '');
function select(options, value) {
  const s = h('select.select', {}, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, t)));
  return s;
}
function storyChecks(selected = []) {
  const box = h('div.check-list');
  const list = [...draft.m.stories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!list.length) box.append(h('span', { style: { color: 'var(--dim)' } }, 'Рассказов пока нет'));
  for (const s of list) box.append(h('label', {}, h('input', { type: 'checkbox', value: s.id, checked: selected.includes(s.id) }), s.title));
  box.values = () => [...box.querySelectorAll('input:checked')].map((i) => i.value);
  return box;
}
const tagsOf = (str) => str.split(',').map((t) => t.trim()).filter(Boolean);

async function pick(kind, multi = false) {
  try {
    return await window.ark.author.pick({ kind, multi });
  } catch (e) {
    toast('Не удалось открыть файл', e.message, { error: true });
    return [];
  }
}

// Блок выбора изображения (обложка, картинка статьи и т. п.)
function imagePicker(currentPath, { label = 'Изображение', placeholder } = {}) {
  const state_ = { file: null, remove: false };
  const box = h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center' } });
  const draw = () => {
    box.innerHTML = '';
    const url = state_.file ? state_.file.url : !state_.remove && currentPath ? preview(currentPath) : null;
    const thumb = h('div.cover', { style: { width: '90px', flex: 'none' } });
    if (url) thumb.append(h('img', { src: url }));
    else thumb.innerHTML = placeholder ? placeholder() : '';
    box.append(thumb, h('div', { style: { display: 'grid', gap: '6px' } },
      btn(url ? 'Заменить' : 'Загрузить', async () => { const [f] = await pick('image'); if (f) { state_.file = f; state_.remove = false; draw(); } }, { ico: 'upload' }),
      url ? btn('Убрать', () => { state_.file = null; state_.remove = true; draw(); }, { ico: 'trash', cls: 'ghost' }) : null));
  };
  draw();
  box.result = state_;
  return field(label, box);
}

// Применить результат imagePicker: вернуть новый путь (или null/прежний)
function commitImage(picker, currentPath, basePath) {
  const r = picker.children[1].result;
  if (r.file) {
    const path = `${basePath}.${r.file.ext}`;
    if (currentPath && currentPath !== path) removeFile(currentPath);
    addFile(path, { stageId: r.file.id }, r.file.url);
    return path;
  }
  if (r.remove) { removeFile(currentPath); return null; }
  return currentPath || null;
}

// ---------- Вход ----------
function renderLogin(page) {
  const token = input('', { type: 'password', placeholder: 'github_pat_…', autocomplete: 'off' });
  const go = btn('Активировать режим автора', async () => {
    go.disabled = true;
    try {
      const info = await window.ark.author.setToken(token.value);
      state.author = { enabled: true, login: info.login, repo: info.repo };
      emit('author');
      toast('Доступ автора подтверждён', `Репозиторий ${info.repo}`);
      rerender();
    } catch (e) {
      toast('Ключ не принят', e.message, { error: true });
    } finally { go.disabled = false; }
  }, { cls: 'primary', ico: 'key' });
  page.append(h('div.panel', { style: { padding: '28px 32px', maxWidth: '760px' } },
    h('h3', { style: { margin: '0 0 8px', fontFamily: 'var(--f-head)', textTransform: 'var(--head-case)' } }, 'Вход для автора'),
    h('p', { style: { color: 'var(--text-a70)', lineHeight: 1.6 } }, 'Отсюда можно публиковать рассказы, арты и статьи, у читателей они появятся сами. Нужен ключ GitHub с правом записи в репозиторий архива. Он хранится только на этом компьютере, в зашифрованном виде.'),
    h('ol.token-steps', {},
      h('li', {}, 'Откройте ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.ark.app.openExternal('https://github.com/settings/personal-access-tokens/new'); } }, 'страницу создания ключа на GitHub'), ' (Fine-grained token).'),
      h('li', {}, 'Repository access → ', h('code', {}, 'Only select repositories'), ' → ', h('code', {}, state.status ? state.status.source : 'ishimura-archive'), '.'),
      h('li', {}, 'Permissions → Repository permissions → ', h('code', {}, 'Contents: Read and write'), '.'),
      h('li', {}, 'Срок действия любой, например год. Нажмите Generate и скопируйте ключ.'),
      h('li', {}, 'Вставьте ключ ниже.')),
    field('Ключ доступа', token),
    go));
}

// ---------- Вкладки ----------
const TABS = [['stories', 'Рассказы', 'book'], ['series', 'Циклы', 'folder'], ['gallery', 'Галерея', 'image'], ['codex', 'Кодекс', 'codex'], ['timeline', 'Хроника', 'timeline'], ['terms', 'Термины', 'key'], ['map', 'Карта', 'map']];

function item({ thumb, title, sub, onEdit, onDelete, changed }) {
  return h(`div.a-item.panel${changed ? '.changed' : ''}`, {},
    h('div.thumb', {}, thumb),
    h('div', {}, h('h4', {}, title), sub ? h('p', {}, sub) : null),
    h('div.acts', {}, onEdit ? btn('', onEdit, { ico: 'edit', cls: 'ghost', title: 'Изменить' }) : null, onDelete ? btn('', onDelete, { ico: 'trash', cls: 'ghost danger', title: 'Удалить' }) : null));
}

const imgThumb = (path) => (path ? h('img', { src: preview(path), style: { width: '100%', height: '100%', objectFit: 'cover' } }) : icon('image'));

// ----- Рассказы -----
function storyEditor(story) {
  const isNew = !story;
  const s = story ? clone(story) : { id: '', title: '', subtitle: '', series: null, chapter: null, year: '', order: Math.max(0, ...draft.m.stories.map((x) => x.order || 0)) + 1, summary: '', tags: [], cover: null };
  let docx = null;

  modal((box, close) => {
    const title = input(s.title, { placeholder: 'Например: Тиамат' });
    const id = input(s.id, { placeholder: 'латиницей, например tiamat', disabled: !isNew });
    title.addEventListener('input', () => { if (isNew && !id.dataset.touched) id.value = slug(title.value); });
    id.addEventListener('input', () => { id.dataset.touched = '1'; });
    const subtitle = input(s.subtitle, { placeholder: 'Например: Начало, Часть II…' });
    const seriesOpts = () => [['', '— без цикла (отдельный рассказ) —'], ...draft.m.series.map((x) => [x.id, x.title]), ['__new', '+ Новый цикл…']];
    let seriesSel = select(seriesOpts(), s.series);
    seriesSel.addEventListener('change', async function onCh() {
      if (seriesSel.value !== '__new') return;
      const name = await promptBox('Название нового цикла');
      if (name) {
        const sid = uniqueId(slug(name), new Set(draft.m.series.map((x) => x.id)));
        draft.m.series.push({ id: sid, title: name, description: '', cover: null });
        log('+', `Цикл «${name}»`);
        const ns = select(seriesOpts(), sid);
        ns.addEventListener('change', onCh);
        seriesSel.replaceWith(ns);
        seriesSel = ns;
      } else seriesSel.value = s.series || '';
    });
    const chapter = input(s.chapter ?? '', { type: 'number', min: 0, placeholder: '1' });
    const year = input(s.year, { placeholder: '2871' });
    const order = input(s.order, { type: 'number' });
    const summary = area(s.summary, { placeholder: 'Пара строк без спойлеров, видна в списке и на карточке' });
    const tags = input((s.tags || []).join(', '), { placeholder: 'через запятую' });
    const cover = imagePicker(s.cover, { label: 'Обложка', placeholder: () => coverSvg({ ...s, title: title.value || s.title }) });
    const motif = select([['', 'Автоматически'], ['ship', 'Корабль'], ['planet', 'Планета'], ['orb', 'Орб Мируаны'], ['signal', 'Радиосигнал']], s.motif);

    const docBox = h('div');
    const drawDoc = () => {
      docBox.innerHTML = '';
      if (docx) {
        docBox.append(h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } },
          h('span', { style: { color: 'var(--accent)' } }, `✓ ${docx.name} — ${docx.words} слов, ≈ ${readMinutes(docx.words)} мин${docx.images.length ? `, картинок: ${docx.images.length}` : ''}`),
          btn('Другой файл', chooseDoc, { cls: 'ghost', ico: 'upload' })),
          h('div.docx-preview', { html: window.DOMPurify.sanitize(docx.html.slice(0, 6000)) }));
      } else {
        docBox.append(h('div.dropzone', { onclick: chooseDoc }, icon('file'),
          h('b', {}, isNew ? 'Выберите файл .docx с рассказом' : 'Заменить текст новым .docx (необязательно)'),
          h('span', {}, 'Абзацы, курсив, жирный и картинки сохранятся. Строки целиком жирным («дата, время, место») станут штампами сцен.')));
      }
    };
    async function chooseDoc() {
      const [f] = await pick('docx');
      if (!f) return;
      try {
        const r = await window.ark.author.importDocx(f.id);
        docx = { ...r, name: f.name };
        if (!title.value) { title.value = r.title.replace(/[_]+/g, ' '); title.dispatchEvent(new Event('input')); }
        drawDoc();
      } catch (e) { toast('Не удалось прочитать документ', e.message, { error: true }); }
    }
    drawDoc();

    const save = () => {
      const t = title.value.trim();
      if (!t) return toast('Нужно название', '', { error: true });
      if (isNew && !docx) return toast('Нужен текст', 'Выберите .docx с рассказом', { error: true });
      const sid = isNew ? uniqueId(slug(id.value || t), new Set(draft.m.stories.map((x) => x.id))) : s.id;
      const base = `stories/${sid}`;
      const next = {
        ...s,
        id: sid,
        title: t,
        subtitle: subtitle.value.trim(),
        series: seriesSel.value && seriesSel.value !== '__new' ? seriesSel.value : null,
        chapter: chapter.value === '' ? null : Number(chapter.value),
        year: year.value.trim(),
        order: Number(order.value) || 0,
        summary: summary.value.trim(),
        tags: tagsOf(tags.value),
        motif: motif.value || null,
        file: `${base}/text.html`,
      };
      next.cover = commitImage(cover, s.cover, `${base}/cover`);
      if (docx) {
        removePrefix(`${base}/`, [next.cover]);
        addFile(`${base}/text.html`, { stageId: docx.htmlId });
        for (const img of docx.images) addFile(`${base}/${img.name}`, { stageId: img.id });
        next.words = docx.words;
        if (isNew) next.published = new Date().toISOString(); else next.updated = new Date().toISOString();
      }
      if (isNew) draft.m.stories.push(next);
      else draft.m.stories = draft.m.stories.map((x) => (x.id === s.id ? next : x));
      log(isNew ? '+' : '~', `Рассказ «${t}»${docx && !isNew ? ' (новый текст)' : ''}`);
      close();
      rerender();
    };

    box.classList.add('wide');
    box.append(
      h('h2', {}, isNew ? 'Новый рассказ' : `Рассказ «${s.title}»`),
      h('p.sub', {}, 'Изменения попадут в черновик. Читатели увидят их после кнопки «Опубликовать».'),
      field('Текст', docBox),
      h('div.grid-2', {}, field('Название', title), field('Подзаголовок', subtitle)),
      h('div.grid-3', {}, field('Цикл', h('div', {}, seriesSel)), field('Номер главы', chapter, 'Только для циклов'), field('Год во вселенной', year)),
      h('div.grid-2', {}, field('Порядок в хронологии', order, 'Чем меньше число, тем раньше рассказ. От этого зависит «Читать дальше»'), field('Идентификатор', id, isNew ? 'Нельзя изменить после публикации' : 'Не меняется')),
      field('Аннотация', summary),
      field('Теги', tags),
      h('div.grid-2', {}, cover, field('Рисунок обложки-заглушки', motif, 'Используется, пока не загружена своя обложка')),
      h('div.actions', {}, btn('Отмена', close), btn(isNew ? 'Добавить в черновик' : 'Сохранить в черновик', save, { cls: 'primary', ico: 'check' })));
  }, { wide: true });
}

function tabStories(body) {
  body.append(h('div', { style: { marginBottom: '14px' } }, btn('Новый рассказ', () => storyEditor(null), { cls: 'primary', ico: 'plus' })));
  const list = h('div.a-list');
  const sorted = [...draft.m.stories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!sorted.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Рассказов пока нет.'));
  for (const s of sorted) {
    const ser = draft.m.series.find((x) => x.id === s.series);
    const t = h('div', { style: { width: '100%', height: '100%' } });
    if (s.cover) t.append(imgThumb(s.cover)); else t.innerHTML = coverSvg(s);
    list.append(item({
      thumb: t,
      title: `${s.order ?? '?'}. ${s.title}`,
      sub: [s.subtitle, ser && `${ser.title}${s.chapter ? `, гл. ${s.chapter}` : ''}`, s.year && `год ${s.year}`, `${s.words || 0} слов`, s.published && fmtDate(s.published)].filter(Boolean).join(' · '),
      onEdit: () => storyEditor(s),
      onDelete: async () => {
        if (!(await confirmBox('Удалить рассказ?', `«${s.title}» исчезнет из архива у всех читателей после публикации.`, { ok: 'Удалить', danger: true }))) return;
        draft.m.stories = draft.m.stories.filter((x) => x.id !== s.id);
        removePrefix(`stories/${s.id}/`);
        draft.m.timeline.forEach((e) => { if (e.story === s.id) e.story = null; });
        log('-', `Рассказ «${s.title}»`);
        rerender();
      },
    }));
  }
  body.append(list);
}

// ----- Циклы -----
function seriesEditor(ser) {
  const isNew = !ser;
  const s = ser ? clone(ser) : { id: '', title: '', description: '', cover: null };
  modal((box, close) => {
    const title = input(s.title);
    const desc = area(s.description, { placeholder: 'О чём цикл' });
    const cover = imagePicker(s.cover, { label: 'Обложка цикла', placeholder: () => coverSvg({ ...s, title: title.value || 'Цикл' }, { label: 'ЦИКЛ' }) });
    box.append(h('h2', {}, isNew ? 'Новый цикл' : `Цикл «${s.title}»`), h('p.sub', {}, 'Цикл объединяет рассказы-главы. Порядок глав задаётся номером главы в рассказе.'),
      field('Название', title), field('Описание', desc), cover,
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        if (!title.value.trim()) return toast('Нужно название', '', { error: true });
        const id = isNew ? uniqueId(slug(title.value), new Set(draft.m.series.map((x) => x.id))) : s.id;
        const next = { ...s, id, title: title.value.trim(), description: desc.value.trim() };
        next.cover = commitImage(cover, s.cover, `series/${id}`);
        if (isNew) draft.m.series.push(next); else draft.m.series = draft.m.series.map((x) => (x.id === id ? next : x));
        log(isNew ? '+' : '~', `Цикл «${next.title}»`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  });
}

function tabSeries(body) {
  body.append(h('div', { style: { marginBottom: '14px' } }, btn('Новый цикл', () => seriesEditor(null), { cls: 'primary', ico: 'plus' })));
  const list = h('div.a-list');
  if (!draft.m.series.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Циклов нет. Рассказы без цикла показываются как отдельные записи.'));
  for (const s of draft.m.series) {
    const n = draft.m.stories.filter((x) => x.series === s.id).length;
    const t = h('div', { style: { width: '100%', height: '100%' } });
    if (s.cover) t.append(imgThumb(s.cover)); else t.innerHTML = coverSvg(s, { label: 'ЦИКЛ' });
    list.append(item({
      thumb: t, title: s.title, sub: `${n} ${plural(n, 'глава', 'главы', 'глав')}`,
      onEdit: () => seriesEditor(s),
      onDelete: async () => {
        if (!(await confirmBox('Удалить цикл?', n ? `Главы (${n}) останутся в архиве как отдельные рассказы.` : 'Цикл пуст.', { ok: 'Удалить', danger: true }))) return;
        draft.m.series = draft.m.series.filter((x) => x.id !== s.id);
        draft.m.stories.forEach((x) => { if (x.series === s.id) { x.series = null; x.chapter = null; } });
        removeFile(s.cover);
        log('-', `Цикл «${s.title}»`);
        rerender();
      },
    }));
  }
  body.append(list);
}

// ----- Галерея -----
function galleryEditor(it) {
  modal((box, close) => {
    const title = input(it.title);
    const desc = area(it.description);
    const album = select([['', '— без альбома —'], ...draft.m.gallery.albums.map((a) => [a.id, a.title])], it.album);
    const tags = input((it.tags || []).join(', '), { placeholder: 'персонажи, Веран, техника…' });
    const stories = storyChecks(it.stories || []);
    box.append(h('h2', {}, 'Изображение'),
      h('img', { src: preview(it.file), style: { maxWidth: '100%', maxHeight: '260px', display: 'block', margin: '0 auto 18px', borderRadius: 'var(--r)' } }),
      field('Название', title), field('Описание', desc),
      h('div.grid-2', {}, field('Альбом', album), field('Теги', tags)),
      field('Связанные рассказы', stories),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        Object.assign(it, { title: title.value.trim(), description: desc.value.trim(), album: album.value || null, tags: tagsOf(tags.value), stories: stories.values() });
        log('~', `Изображение «${it.title || it.id}»`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  }, { wide: true });
}

function tabGallery(body) {
  const albums = h('div.chips', { style: { marginBottom: '16px' } });
  for (const a of draft.m.gallery.albums) {
    albums.append(h('span.chip', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, a.title,
      h('a', { title: 'Переименовать', style: { cursor: 'pointer' }, onclick: async () => { const n = await promptBox('Название альбома', { value: a.title }); if (n) { a.title = n; log('~', `Альбом «${n}»`); rerender(); } } }, '✎'),
      h('a', { title: 'Удалить', style: { cursor: 'pointer', color: 'var(--danger)' }, onclick: () => { draft.m.gallery.albums = draft.m.gallery.albums.filter((x) => x !== a); draft.m.gallery.items.forEach((i) => { if (i.album === a.id) i.album = null; }); log('-', `Альбом «${a.title}»`); rerender(); } }, '×')));
  }
  albums.append(h('button.chip', { onclick: async () => {
    const n = await promptBox('Новый альбом', { placeholder: 'Например: Персонажи' });
    if (!n) return;
    draft.m.gallery.albums.push({ id: uniqueId(slug(n), new Set(draft.m.gallery.albums.map((x) => x.id))), title: n, description: '' });
    log('+', `Альбом «${n}»`); rerender();
  } }, '+ альбом'));
  body.append(h('h2.sec', {}, 'Альбомы'), albums);

  body.append(h('div', { style: { margin: '6px 0 14px' } }, btn('Добавить изображения', async () => {
    const files = await pick('image', true);
    const taken = new Set(draft.m.gallery.items.map((x) => x.id));
    for (const f of files) {
      const id = uniqueId(slug(f.name.replace(/\.[^.]+$/, '')), taken);
      taken.add(id);
      const path = `gallery/${id}.${f.ext}`;
      addFile(path, { stageId: f.id }, f.url);
      draft.m.gallery.items.push({ id, title: f.name.replace(/\.[^.]+$/, ''), description: '', file: path, album: null, tags: [], stories: [], added: new Date().toISOString() });
      log('+', `Изображение ${f.name}`);
    }
    if (files.length) { toast(`Добавлено: ${files.length}`, 'Названия и альбомы задаются кнопкой ✎ у каждой картинки'); rerender(); }
  }, { cls: 'primary', ico: 'plus' })));

  const list = h('div.a-list');
  if (!draft.m.gallery.items.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Галерея пуста.'));
  for (const it of [...draft.m.gallery.items].reverse()) {
    const al = draft.m.gallery.albums.find((a) => a.id === it.album);
    list.append(item({
      thumb: imgThumb(it.file), title: it.title || it.id,
      sub: [al && al.title, (it.tags || []).map((t) => `#${t}`).join(' ')].filter(Boolean).join(' · ') || 'без альбома',
      changed: draft.adds.has(it.file),
      onEdit: () => galleryEditor(it),
      onDelete: () => { draft.m.gallery.items = draft.m.gallery.items.filter((x) => x !== it); removeFile(it.file); log('-', `Изображение «${it.title}»`); rerender(); },
    }));
  }
  body.append(list);
}

// ----- Кодекс -----
function codexEditor(entry) {
  const isNew = !entry;
  const e = entry ? clone(entry) : { id: '', title: '', category: (draft.m.codex.categories[0] || {}).id || '', summary: '', body: '', image: null, stories: [] };
  modal((box, close) => {
    const title = input(e.title, { placeholder: 'Например: Мируана' });
    const cat = select([['', '— без категории —'], ...draft.m.codex.categories.map((c) => [c.id, c.title])], e.category);
    const summary = area(e.summary, { placeholder: 'Одной-двумя фразами', style: { minHeight: '70px' } });
    const bodyTxt = area(e.body, { style: { minHeight: '240px', fontFamily: 'var(--f-ui)', fontSize: '13px' } });
    const img = imagePicker(e.image, { label: 'Иллюстрация' });
    const stories = storyChecks(e.stories || []);
    box.append(h('h2', {}, isNew ? 'Новая статья кодекса' : `Статья «${e.title}»`),
      h('div.grid-2', {}, field('Заголовок', title), field('Категория', cat)),
      field('Кратко', summary),
      field('Текст статьи', bodyTxt, 'Пустая строка начинает новый абзац. ## Заголовок, **жирный**, *курсив*, строки с «- » станут списком. Ссылка на статью: [[id]] или [[id|текст]], на рассказ: [[story:id|текст]].'),
      img,
      field('Упоминается в рассказах', stories),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        if (!title.value.trim()) return toast('Нужен заголовок', '', { error: true });
        const id = isNew ? uniqueId(slug(title.value), new Set(draft.m.codex.entries.map((x) => x.id))) : e.id;
        const next = { ...e, id, title: title.value.trim(), category: cat.value, summary: summary.value.trim(), body: bodyTxt.value, stories: stories.values() };
        next.image = commitImage(img, e.image, `codex/${id}`);
        if (isNew) draft.m.codex.entries.push(next); else draft.m.codex.entries = draft.m.codex.entries.map((x) => (x.id === id ? next : x));
        log(isNew ? '+' : '~', `Статья «${next.title}»`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  }, { wide: true });
}

function tabCodex(body) {
  const cats = h('div.chips', { style: { marginBottom: '16px' } });
  for (const c of draft.m.codex.categories) {
    cats.append(h('span.chip', { style: { display: 'inline-flex', gap: '6px' } }, c.title,
      h('a', { style: { cursor: 'pointer' }, onclick: async () => { const n = await promptBox('Название категории', { value: c.title }); if (n) { c.title = n; log('~', `Категория «${n}»`); rerender(); } } }, '✎'),
      h('a', { style: { cursor: 'pointer', color: 'var(--danger)' }, onclick: () => { draft.m.codex.categories = draft.m.codex.categories.filter((x) => x !== c); log('-', `Категория «${c.title}»`); rerender(); } }, '×')));
  }
  cats.append(h('button.chip', { onclick: async () => {
    const n = await promptBox('Новая категория', { placeholder: 'Корабли, Города, Фракции, Технологии, Персоналии…' });
    if (!n) return;
    draft.m.codex.categories.push({ id: uniqueId(slug(n), new Set(draft.m.codex.categories.map((x) => x.id))), title: n });
    log('+', `Категория «${n}»`); rerender();
  } }, '+ категория'));
  body.append(h('h2.sec', {}, 'Категории'), cats,
    h('div', { style: { margin: '6px 0 14px' } }, btn('Новая статья', () => codexEditor(null), { cls: 'primary', ico: 'plus' })));
  const list = h('div.a-list');
  if (!draft.m.codex.entries.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Статей пока нет.'));
  for (const e of [...draft.m.codex.entries].sort((a, b) => a.title.localeCompare(b.title, 'ru'))) {
    const c = draft.m.codex.categories.find((x) => x.id === e.category);
    list.append(item({
      thumb: e.image ? imgThumb(e.image) : icon('codex'), title: e.title, sub: [c && c.title, e.summary].filter(Boolean).join(' · ').slice(0, 140),
      onEdit: () => codexEditor(e),
      onDelete: async () => {
        if (!(await confirmBox('Удалить статью?', `«${e.title}»`, { ok: 'Удалить', danger: true }))) return;
        draft.m.codex.entries = draft.m.codex.entries.filter((x) => x.id !== e.id); removeFile(e.image); log('-', `Статья «${e.title}»`); rerender();
      },
    }));
  }
  body.append(list);
}

// ----- Хроника -----
function eventEditor(ev) {
  const isNew = !ev;
  const e = ev ? clone(ev) : { id: '', year: '', date: '', title: '', text: '', era: '', story: null };
  const eras = [...new Set(draft.m.timeline.map((x) => x.era).filter(Boolean))];
  modal((box, close) => {
    const year = input(e.year, { placeholder: '2871', type: 'number' });
    const date = input(e.date, { placeholder: '14 марта, 6:00' });
    const title = input(e.title, { placeholder: 'Высадка первой экспедиции' });
    const text = area(e.text);
    const era = input(e.era, { placeholder: 'Эра колонизации', list: 'eras' });
    const dl = h('datalist', { id: 'eras' }, eras.map((x) => h('option', { value: x })));
    const story = select([['', '— нет —'], ...draft.m.stories.map((s) => [s.id, s.title])], e.story);
    box.append(h('h2', {}, isNew ? 'Новое событие' : 'Событие'),
      h('div.grid-3', {}, field('Год', year), field('Дата / уточнение', date), field('Эпоха', h('div', {}, era, dl), 'Группирует события')),
      field('Заголовок', title), field('Описание', text), field('Связанный рассказ', story),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        if (!title.value.trim()) return toast('Нужен заголовок', '', { error: true });
        const id = isNew ? uniqueId(slug(`${year.value}-${title.value}`), new Set(draft.m.timeline.map((x) => x.id))) : e.id;
        const next = { id, year: year.value.trim(), date: date.value.trim(), title: title.value.trim(), text: text.value.trim(), era: era.value.trim(), story: story.value || null };
        if (isNew) draft.m.timeline.push(next); else draft.m.timeline = draft.m.timeline.map((x) => (x.id === id ? next : x));
        log(isNew ? '+' : '~', `Событие ${next.year} «${next.title}»`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  }, { wide: true });
}

function periodEditor(per) {
  const isNew = !per;
  const p = per ? clone(per) : { id: '', from: '', to: '', title: '', note: '', color: '' };
  modal((box, close) => {
    const from = input(p.from, { type: 'number', placeholder: '2871' });
    const to = input(p.to, { type: 'number', placeholder: '3110' });
    const title = input(p.title, { placeholder: 'Колонизация' });
    const note = input(p.note, { placeholder: '≈ 200 лет колонизации' });
    const color = select([['', 'Автоматически'], ['var(--accent)', 'Акцент'], ['var(--accent-2)', 'Второй акцент'], ['var(--warn)', 'Предупреждение (жёлтый)'], ['var(--danger)', 'Тревога (красный)']], p.color);
    box.append(h('h2', {}, isNew ? 'Новая эпоха' : 'Эпоха'), h('p.sub', {}, 'Эпохи видны цветными полосами на шкале Хроники и заголовками в списке.'),
      h('div.grid-2', {}, field('С года', from), field('По год', to)),
      field('Название', title, 'Можно использовать термины: {{unifier}}, {{unifier.gen}}'),
      field('Подпись', note), field('Цвет', color),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        if (!title.value.trim() || !from.value || !to.value) return toast('Нужны название и годы', '', { error: true });
        const id = isNew ? uniqueId(slug(`p-${title.value}`), new Set(draft.m.periods.map((x) => x.id))) : p.id;
        const next = { id, from: Number(from.value), to: Number(to.value), title: title.value.trim(), note: note.value.trim(), ...(color.value ? { color: color.value } : {}) };
        if (isNew) draft.m.periods.push(next); else draft.m.periods = draft.m.periods.map((x) => (x.id === id ? next : x));
        log(isNew ? '+' : '~', `Эпоха «${next.title}»`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  });
}

function tabTerms(body) {
  body.append(h('p', { style: { color: 'var(--dim)', marginTop: 0, lineHeight: 1.6 } },
    'Термин подставляется вместо имени, которое пока скрыто или может поменяться. В Хронике и Кодексе пишите ', h('code', {}, '{{ключ}}'), ' (именительный падеж) или ', h('code', {}, '{{ключ.gen}}'), ' (родительный). Поменяете здесь, и имя обновится везде.'));
  body.append(h('div', { style: { marginBottom: '14px' } }, btn('Новый термин', () => termEditor(null), { cls: 'primary', ico: 'plus' })));
  const list = h('div.a-list');
  const entries = Object.entries(draft.m.terms);
  if (!entries.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Терминов нет.'));
  for (const [key, t] of entries) {
    const v = typeof t === 'string' ? { nom: t } : t;
    list.append(item({
      thumb: icon('key'), title: `{{${key}}} → ${v.nom}`, sub: [v.gen && `род. п.: ${v.gen}`, v.note].filter(Boolean).join(' · '),
      onEdit: () => termEditor(key),
      onDelete: () => { delete draft.m.terms[key]; log('-', `Термин ${key}`); rerender(); },
    }));
  }
  body.append(list);
}

function termEditor(key) {
  const isNew = key == null;
  const t = isNew ? { nom: '', gen: '', note: '' } : (typeof draft.m.terms[key] === 'string' ? { nom: draft.m.terms[key] } : clone(draft.m.terms[key]));
  modal((box, close) => {
    const k = input(key || '', { placeholder: 'латиницей, например unifier', disabled: !isNew });
    const nom = input(t.nom, { placeholder: 'Кто? Что? Например: Вулканис' });
    const gen = input(t.gen, { placeholder: 'Кого? Чего? Например: Вулканиса' });
    const note = input(t.note, { placeholder: 'Пометка для себя' });
    box.append(h('h2', {}, isNew ? 'Новый термин' : `Термин {{${key}}}`),
      field('Ключ', k), h('div.grid-2', {}, field('Именительный падеж', nom), field('Родительный падеж', gen)), field('Заметка', note),
      h('div.actions', {}, btn('Отмена', close), btn('Сохранить в черновик', () => {
        const kk = isNew ? slug(k.value).replace(/-/g, '_') : key;
        if (!kk || !nom.value.trim()) return toast('Нужны ключ и значение', '', { error: true });
        draft.m.terms[kk] = { nom: nom.value.trim(), gen: gen.value.trim() || nom.value.trim(), note: note.value.trim() };
        log(isNew ? '+' : '~', `Термин {{${kk}}} = ${nom.value.trim()}`);
        close(); rerender();
      }, { cls: 'primary', ico: 'check' })));
  });
}

function tabTimeline(body) {
  body.append(h('h2.sec', {}, 'Эпохи'));
  const plist = h('div.a-list', { style: { marginBottom: '20px' } });
  for (const p of [...draft.m.periods].sort((a, b) => a.from - b.from)) {
    plist.append(item({
      thumb: h('b', { style: { fontSize: '10px', color: 'var(--accent)' } }, `${p.from}`), title: p.title, sub: `${p.from} — ${p.to}${p.note ? ` · ${p.note}` : ''}`,
      onEdit: () => periodEditor(p),
      onDelete: () => { draft.m.periods = draft.m.periods.filter((x) => x.id !== p.id); log('-', `Эпоха «${p.title}»`); rerender(); },
    }));
  }
  body.append(btn('Новая эпоха', () => periodEditor(null), { ico: 'plus' }), plist);
  body.append(h('h2.sec', {}, 'События'));
  body.append(h('div', { style: { marginBottom: '14px' } }, btn('Новое событие', () => eventEditor(null), { cls: 'primary', ico: 'plus' })));
  const list = h('div.a-list');
  const sorted = [...draft.m.timeline].sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
  if (!sorted.length) list.append(h('p', { style: { color: 'var(--dim)' } }, 'Событий пока нет.'));
  for (const e of sorted) {
    list.append(item({
      thumb: h('b', { style: { fontSize: '13px', color: 'var(--accent)' } }, e.year || '?'), title: e.title, sub: [e.era, e.date].filter(Boolean).join(' · '),
      onEdit: () => eventEditor(e),
      onDelete: () => { draft.m.timeline = draft.m.timeline.filter((x) => x.id !== e.id); log('-', `Событие «${e.title}»`); rerender(); },
    }));
  }
  body.append(list);
}

// ----- Карта -----
function markerEditor(m, onDone) {
  modal((box, close) => {
    const title = input(m.title, { placeholder: 'Веран' });
    const text = area(m.text, { style: { minHeight: '80px' } });
    const codex = select([['', '— нет —'], ...draft.m.codex.entries.map((e) => [e.id, e.title])], m.codex);
    box.append(h('h2', {}, 'Метка на карте'), field('Название', title), field('Описание', text), field('Статья кодекса', codex),
      h('div.actions', {},
        m.isNew ? null : btn('Удалить метку', () => { onDone(null); close(); }, { cls: 'danger', ico: 'trash' }),
        btn('Отмена', close),
        btn('Сохранить', () => { onDone({ ...m, isNew: undefined, title: title.value.trim() || 'Метка', text: text.value.trim(), codex: codex.value || null }); close(); }, { cls: 'primary' })));
  });
}

function tabMap(body) {
  const map = draft.m.map;
  body.append(h('div', { style: { display: 'flex', gap: '8px', marginBottom: '14px' } }, btn(map ? 'Заменить карту' : 'Загрузить карту', async () => {
    const [f] = await pick('image');
    if (!f) return;
    const path = `map/map.${f.ext}`;
    if (map && map.image !== path) removeFile(map.image);
    addFile(path, { stageId: f.id }, f.url);
    draft.m.map = { image: path, markers: map ? map.markers : [] };
    log(map ? '~' : '+', 'Карта Тиамата II');
    rerender();
  }, { cls: 'primary', ico: 'upload' }),
  map ? btn('Убрать карту', () => { removeFile(map.image); draft.m.map = null; log('-', 'Карта'); rerender(); }, { cls: 'danger', ico: 'trash' }) : null));
  if (!map) { body.append(h('p', { style: { color: 'var(--dim)' } }, 'Загрузите изображение карты (PNG/JPG, лучше крупное). Затем щёлкайте по карте, чтобы ставить метки городов и мест.')); return; }
  body.append(h('p', { style: { color: 'var(--dim)', marginTop: 0 } }, `Щёлкните по карте, чтобы добавить метку. Щёлкните по метке, чтобы изменить. Меток: ${map.markers.length}.`));
  const ed = h('div.map-editor');
  const img = h('img', { src: preview(map.image) });
  ed.append(img);
  for (const m of map.markers) {
    const mk = h('div.marker', { 'data-label': m.title, style: { left: `${m.x * 100}%`, top: `${m.y * 100}%` } });
    mk.addEventListener('click', (e) => { e.stopPropagation(); markerEditor(m, (res) => { map.markers = res ? map.markers.map((x) => (x === m ? res : x)) : map.markers.filter((x) => x !== m); log(res ? '~' : '-', `Метка «${m.title}»`); rerender(); }); });
    ed.append(mk);
  }
  img.addEventListener('click', (e) => {
    const r = img.getBoundingClientRect();
    const m = { id: crypto.randomUUID().slice(0, 8), x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, title: '', text: '', codex: null, isNew: true };
    markerEditor(m, (res) => { if (res) { map.markers.push(res); log('+', `Метка «${res.title}»`); rerender(); } });
  });
  body.append(ed);
}

const TAB_BUILD = { stories: tabStories, series: tabSeries, gallery: tabGallery, codex: tabCodex, timeline: tabTimeline, terms: tabTerms, map: tabMap };

// ---------- Публикация ----------
function publishDialog() {
  modal((box, close) => {
    const msg = input(draft.log.length === 1 ? draft.log[0].text : `Обновление архива: ${draft.log.length} ${plural(draft.log.length, 'изменение', 'изменения', 'изменений')}`);
    const go = btn('Опубликовать для всех', async () => {
      go.disabled = true;
      go.querySelector('span').textContent = 'Передача…';
      try {
        const payload = {
          manifest: draft.m,
          adds: [...draft.adds].map(([path, src]) => ({ path, ...src })),
          deletes: [...draft.deletes],
          message: msg.value.trim() || 'Обновление архива',
        };
        const r = await window.ark.author.publish(payload);
        draft = null;
        close();
        sfx('notify');
        toast('Передача отправлена', `Ревизия ${r.revision}. Читатели получат её при следующей проверке.`);
        rerender();
      } catch (e) {
        toast('Публикация не удалась', e.message, { error: true, ms: 9000 });
        go.disabled = false;
        go.querySelector('span').textContent = 'Опубликовать для всех';
      }
    }, { cls: 'primary', ico: 'upload' });
    box.append(h('h2', {}, 'Публикация'),
      h('p.sub', {}, `Файлов к загрузке: ${draft.adds.size}, к удалению: ${draft.deletes.size}. Всё уйдёт в архив за один раз.`),
      h('div.changes', {}, draft.log.map((l) => h('div', {}, h(`span.op${l.op === '-' ? '.del' : ''}`, {}, l.op), h('span', {}, l.text)))),
      h('div', { style: { height: '16px' } }),
      field('Подпись к изменению', msg),
      h('div.actions', {}, btn('Отмена', close), go));
  });
}

// ---------- Отрисовка ----------
export function renderAuthor(el, params, { go }) {
  const page = h('div.page');
  el.append(page);
  const off = on('manifest', () => rerender());
  rerender = () => {
    page.innerHTML = '';
    page.append(pageHead('Терминал автора', 'Режим <em>автора</em>', { code: 'AUTH', stamp: 'Только автор' }));
    if (!state.author.enabled) { renderLogin(page); return; }
    ensureDraft();
    const n = draft.log.length;
    page.append(h('div.author-bar.panel', {},
      h('span.orb.orb-sm'),
      h('span', {}, `Автор: ${state.author.login || '—'}`),
      h('span', { style: { color: 'var(--dim)' } }, `· ${state.status ? state.status.source : ''}`),
      h('span', { style: { flex: 1 } }),
      n ? h('span.pending', {}, `Черновик: ${n} ${plural(n, 'изменение', 'изменения', 'изменений')}`) : h('span', { style: { color: 'var(--dim)' } }, 'Черновик пуст'),
      n ? btn('Сбросить', async () => {
        if (!(await confirmBox('Сбросить черновик?', 'Все неопубликованные изменения будут потеряны.', { ok: 'Сбросить', danger: true }))) return;
        draft = null; rerender();
      }, { cls: 'ghost' }) : null,
      btn(n ? `Опубликовать (${n})` : 'Опубликовать', publishDialog, { cls: 'primary', ico: 'upload', disabled: !n })));
    const tabs = h('div.chips', { style: { marginBottom: '18px' } }, TABS.map(([id, label]) => h(`button.chip${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; sfx('click'); rerender(); } }, label)));
    const body = h('div');
    page.append(tabs, body);
    TAB_BUILD[tab](body);
  };
  rerender();
  return () => { off(); rerender = () => {}; };
}
