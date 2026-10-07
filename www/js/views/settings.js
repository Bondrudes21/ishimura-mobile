import { h, icon, btn, toast, range, toggle, confirmBox, promptBox, modal, pageHead, debounce } from '../util.js';
import {
  state, setSetting, getSetting, replaceSettings, defaultSettings, SECTIONS, MODES, emit, on, mode, sectionsOf, switchMode,
  allThemes, themeById, applyTheme, themeDirty, activeTheme, createTheme, updateUserTheme, deleteTheme, importTheme, saveCurrentToActive,
  modulePresets, applyModule, saveModulePreset, deleteModulePreset, withReveal,
} from '../state.js';
import { COLOR_KEYS, FONTS, PAPERS, MODULES, moduleData, normalizeTheme } from '../themes.js';
import { sfx, SOUND_EVENTS, SOUND_PACKS } from '../sound.js';
import { presetCard } from '../app.js';

const TABS = [
  ['themes', 'Темы', 'palette'],
  ['colors', 'Цвета', 'sparkle'],
  ['fonts', 'Шрифты', 'type'],
  ['effects', 'Эффекты', 'eye'],
  ['background', 'Фон', 'wallpaper'],
  ['motion', 'Анимации', 'sync'],
  ['layout', 'Интерфейс', 'layout'],
  ['texts', 'Тексты', 'edit'],
  ['reader', 'Чтение', 'book'],
  ['sound', 'Звук и курсор', 'volume'],
  ['css', 'Свой CSS', 'file'],
  ['system', 'Система', 'cpu'],
];

let tab = 'themes';

// ---------- Элементы управления ----------
function row(label, ctl, hint) {
  return h('div.s-row', {}, h('label', {}, label, hint ? h('div', { style: { fontSize: '11px', color: 'var(--dim)' } }, hint) : null), h('div.ctl', {}, ctl));
}
function rRange(label, path, min, max, step, fmt = (v) => v, hint) {
  const val = h('span.val', {}, fmt(getSetting(path)));
  return row(label, [range({ min, max, step, value: getSetting(path), onInput: (v) => { val.textContent = fmt(v); setSetting(path, v); } }), val], hint);
}
function rToggle(label, path, hint, after) {
  return row(label, toggle(!!getSetting(path), (v) => { setSetting(path, v); after && after(v); }), hint);
}
function rSelect(label, path, options, after, hint) {
  const s = h('select.select', {}, options.map(([v, t]) => h('option', { value: v, selected: String(getSetting(path)) === String(v) }, t)));
  s.addEventListener('change', () => { setSetting(path, s.value === 'null' ? null : s.value); after && after(s.value); });
  return row(label, s, hint);
}
function rText(label, path, placeholder, hint) {
  const i = h('input.input', { value: getSetting(path) || '', placeholder });
  const save = debounce(() => setSetting(path, i.value), 350);
  i.addEventListener('input', save);
  return row(label, i, hint);
}
function fontOptions(withTheme) {
  const opts = withTheme ? [['null', 'Как в теме']] : [];
  for (const [n, kind] of FONTS) opts.push([n, `${n}  ·  ${{ mono: 'моноширинный', display: 'акцидентный', sans: 'гротеск', serif: 'с засечками' }[kind]}`]);
  for (const f of state.settings.customFonts) opts.push([f.family, `${f.family}  ·  свой`]);
  return opts;
}
const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;

// Полоса модульных пресетов над вкладкой
function moduleBar(mod, redraw) {
  const chips = h('div.chips');
  for (const p of modulePresets(mod)) {
    const c = h('button.chip', { onclick: () => { sfx('click'); applyModule(mod, p); setTimeout(redraw, 50); }, title: p.builtin ? 'Встроенный пресет' : 'Ваш пресет' }, p.name);
    if (!p.builtin) c.append(h('span.chip-x', { title: 'Удалить', onclick: (e) => { e.stopPropagation(); deleteModulePreset(mod, p.id); redraw(); } }, '×'));
    chips.append(c);
  }
  chips.append(h('button.chip.add', {
    onclick: async () => {
      const name = await promptBox(`Сохранить: ${MODULES[mod].label.toLowerCase()}`, { value: `Мой пресет ${(state.presets.modules[mod] || []).length + 1}` });
      if (!name) return;
      saveModulePreset(mod, name, moduleData(state.settings, mod));
      toast('Пресет сохранён', `Его можно применить к любой теме`);
      redraw();
    },
  }, '+ сохранить текущее'));
  return h('div.mod-bar', {}, h('span.lbl', {}, `Пресеты · ${MODULES[mod].label}`), chips);
}

// ---------- Вкладки ----------
const BUILD = {
  themes(body, redraw) {
    body.append(h('h3', {}, 'Темы оформления'), h('p.desc', {}, 'В теме хранятся цвета, шрифты, эффекты, фон, звуки, курсор и CSS. Можно сделать свою или скопировать готовую.'));
    const act = activeTheme();
    if (themeDirty()) {
      const isUser = act && !act.builtin;
      body.append(h('div.dirty-banner', {},
        icon('info'),
        h('span', {}, act ? `Текущий вид отличается от темы «${act.name}».` : 'Текущий вид не сохранён ни в одну тему.'),
        isUser ? btn(`Сохранить в «${act.name}»`, () => { saveCurrentToActive(); toast('Тема обновлена'); redraw(); }, { cls: 'primary', ico: 'save' }) : null,
        btn('Сохранить как новую', () => newThemeDialog(redraw, { fromCurrent: true }), { ico: 'plus' }),
        act ? btn('Отменить изменения', () => { applyTheme(act.id); setTimeout(redraw, 50); }, { cls: 'ghost' }) : null));
    }
    body.append(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' } },
      btn('Создать тему', () => newThemeDialog(redraw), { cls: 'primary', ico: 'plus' }),
      btn('Импорт из файла', async () => {
        const text = await window.ark.user.importTheme();
        if (!text) return;
        try { const id = importTheme(JSON.parse(text)); applyTheme(id); toast('Тема импортирована'); setTimeout(redraw, 50); } catch (e) { toast('Не удалось импортировать', e.message, { error: true }); }
      }, { ico: 'upload' })),
      row('Применять и раскладку темы', toggle(!!state.settings.applyLayout, (v) => setSetting('applyLayout', v)), 'Положение меню, плотность и вид списков'),
      row('Автосохранение в мою тему', toggle(state.settings.presetAutosave !== false, (v) => setSetting('presetAutosave', v)), 'Изменения сразу сохраняются в вашу тему'));

    const themes = allThemes();
    const card = (t) => {
      const active = state.settings.activeTheme === t.id;
      const item = h('div.theme-item', {},
        presetCard(t, { selected: active, badge: active ? 'АКТИВНА' : t.builtin ? null : 'МОЯ', onClick: () => { sfx('click'); applyTheme(t.id, { withLayout: !!state.settings.applyLayout }); setTimeout(redraw, 60); } }),
        h('div.acts', {},
          btn('Дублировать', async () => {
            const name = await promptBox('Название копии', { value: `${t.name} (копия)` });
            if (!name) return;
            const id = createTheme({ name, about: t.about || '', from: t.id });
            applyTheme(id);
            toast('Копия создана', 'Меняйте как хотите, оригинал останется прежним');
            setTimeout(redraw, 60);
          }, { ico: 'plus', cls: 'ghost' }),
          btn('Экспорт', () => exportTheme(t), { ico: 'download', cls: 'ghost' }),
          t.builtin ? null : btn('Изменить', () => editThemeDialog(t, redraw), { ico: 'edit', cls: 'ghost' }),
          t.builtin ? null : btn('', async () => {
            if (!(await confirmBox('Удалить тему?', `«${t.name}» будет удалена.`, { ok: 'Удалить', danger: true }))) return;
            deleteTheme(t.id); redraw();
          }, { ico: 'trash', cls: 'ghost danger', title: 'Удалить' })));
      return item;
    };
    body.append(h('div.s-group', {}, h('h4', {}, 'Встроенные'), h('div.theme-grid', {}, themes.filter((t) => t.builtin).map(card))));
    const mine = themes.filter((t) => !t.builtin);
    body.append(h('div.s-group', {}, h('h4', {}, `Мои темы · ${mine.length}`),
      mine.length ? h('div.theme-grid', {}, mine.map(card))
        : h('p', { style: { color: 'var(--dim)', lineHeight: 1.6 } }, 'Своих тем пока нет. Нажмите «Создать тему» или «Дублировать» у готовой.')));
  },

  colors(body, redraw) {
    body.append(h('h3', {}, 'Цвета'), h('p.desc', {}, 'Цвета интерфейса. Палитру можно сохранить и потом применить к другой теме.'));
    body.append(moduleBar('colors', redraw));
    const grid = h('div.color-grid');
    for (const [k, label] of COLOR_KEYS) {
      const path = `theme.colors.${k}`;
      const code = h('code', {}, getSetting(path));
      const inp = h('input', { type: 'color', value: getSetting(path) });
      inp.addEventListener('input', () => { code.textContent = inp.value; setSetting(path, inp.value); });
      grid.append(h('label.color-cell', {}, inp, h('span', {}, label), code));
    }
    body.append(h('div.s-group', {}, grid));
    body.append(h('div.s-group', {}, h('h4', {}, 'Генераторы'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        btn('Подобрать по акценту', () => { withReveal(() => harmonize(getSetting('theme.colors.accent'))); setTimeout(redraw, 60); }, { ico: 'sparkle' }),
        btn('Случайная палитра', () => { withReveal(() => harmonize(randomColor())); setTimeout(redraw, 60); }, { ico: 'sync' }),
        btn('Светлый вариант', () => { withReveal(lightVariant); setTimeout(redraw, 60); }, { ico: 'eye' }))));
  },

  fonts(body, redraw) {
    body.append(h('h3', {}, 'Шрифты'), h('p.desc', {}, 'Шрифт меню, заголовков и текста настраивается отдельно. Можно загрузить свой (TTF, OTF, WOFF).'));
    body.append(moduleBar('fonts', redraw));
    body.append(h('div.s-group', {},
      rSelect('Шрифт интерфейса', 'theme.fonts.ui', fontOptions(false)),
      rSelect('Шрифт заголовков', 'theme.fonts.head', fontOptions(false)),
      rSelect('Шрифт текста (по умолчанию)', 'theme.fonts.read', fontOptions(false)),
      rRange('Размер интерфейса', 'theme.fonts.uiSize', 11, 18, 1, px),
      rSelect('Регистр заголовков', 'theme.fonts.headCase', [['upper', 'ЗАГЛАВНЫЕ'], ['none', 'Как написано']]),
      rRange('Разрядка заголовков', 'theme.fonts.headSpacing', 0, 0.3, 0.01, (v) => `${v}em`)));
    const list = h('div', { style: { display: 'grid', gap: '6px' } });
    for (const f of state.settings.customFonts) {
      list.append(h('div.saved-theme.panel', {}, h('span.name', { style: { fontFamily: `'${f.family}'`, fontSize: '18px' } }, `${f.family} — Тиамат II, 3110 год`),
        btn('', () => { setSetting('customFonts', state.settings.customFonts.filter((x) => x !== f)); redraw(); }, { ico: 'trash', cls: 'danger' })));
    }
    body.append(h('div.s-group', {}, h('h4', {}, 'Свои шрифты'), list, h('div', { style: { marginTop: '10px' } },
      btn('Загрузить шрифт', async () => {
        const f = await window.ark.user.pick('font');
        if (!f) return;
        const family = await promptBox('Как назвать шрифт?', { value: f.name.replace(/\.[^.]+$/, '') });
        if (!family) return;
        setSetting('customFonts', [...state.settings.customFonts, { family, url: f.url, name: f.name }]);
        toast('Шрифт добавлен', 'Выберите его в списках выше');
        redraw();
      }, { ico: 'upload', cls: 'primary' }))));
  },

  effects(body, redraw) {
    body.append(h('h3', {}, 'Эффекты'), h('p.desc', {}, 'Скан-линии, свечение, зерно и другие эффекты экрана.'));
    body.append(moduleBar('effects', redraw));
    body.append(h('div.s-group', {}, h('h4', {}, 'Экран'),
      rRange('Скан-линии', 'theme.effects.scanlines', 0, 1, 0.01, pct),
      rRange('Свечение', 'theme.effects.glow', 0, 2, 0.05, pct),
      rRange('Зерно', 'theme.effects.grain', 0, 0.6, 0.01, pct),
      rRange('Виньетка', 'theme.effects.vignette', 0, 1, 0.01, pct),
      rToggle('Мерцание', 'theme.effects.flicker', 'Редкие провалы яркости, как у старого монитора'),
      rToggle('Хроматическая аберрация', 'theme.effects.chroma', 'Цветная окантовка заголовков')));
    body.append(h('div.s-group', {}, h('h4', {}, 'Форма'),
      rSelect('Декор', 'theme.effects.deco', [['brackets', 'Скобки терминала'], ['hazard', 'Предупреждающие полосы'], ['stamps', 'Грифы секретности'], ['none', 'Без декора']]),
      rRange('Скругление углов', 'theme.effects.radius', 0, 20, 1, px),
      rRange('Толщина рамок', 'theme.effects.border', 0, 4, 1, px),
      rRange('Непрозрачность панелей', 'theme.effects.panelAlpha', 20, 100, 1, (v) => `${v}%`),
      rRange('Размытие под панелями', 'theme.effects.panelBlur', 0, 30, 1, px)));
  },

  background(body, redraw) {
    body.append(h('h3', {}, 'Фон'), h('p.desc', {}, 'Готовый фон, своя картинка или видео.'));
    body.append(moduleBar('background', redraw));
    const bg = state.settings.theme.background;
    body.append(h('div.s-group', {},
      rSelect('Тип фона', 'theme.background.type', [['none', 'Без фона'], ['grid', 'Сетка терминала'], ['stars', 'Орбита Тиамата'], ['radar', 'Радар'], ['image', 'Своя картинка'], ['video', 'Своё видео']], () => redraw()),
      ['image', 'video'].includes(bg.type) ? row('Файл', [
        btn(bg.url ? 'Заменить файл' : 'Выбрать файл', async () => {
          const f = await window.ark.user.pick('background');
          if (!f) return;
          setSetting('theme.background.url', f.url);
          setSetting('theme.background.type', /\.(mp4|webm)$/i.test(f.name) ? 'video' : 'image');
          redraw();
        }, { ico: 'upload', cls: 'primary' }),
        bg.url ? h('span', { style: { color: 'var(--dim)', fontSize: '12px' } }, decodeURIComponent(bg.url.split('/').pop()).replace(/^\d+-/, '')) : null]) : null,
      rRange('Непрозрачность', 'theme.background.opacity', 0, 1, 0.01, pct),
      ['image', 'video'].includes(bg.type) ? rRange('Размытие', 'theme.background.blur', 0, 40, 1, px) : null,
      ['image', 'video'].includes(bg.type) ? rRange('Затемнение', 'theme.background.dim', 0, 1, 0.01, pct) : null));
  },

  motion(body) {
    body.append(h('h3', {}, 'Анимации'), h('p.desc', {}, 'Переходы между разделами, появление карточек, перелистывание и смена темы.'));
    body.append(h('div.s-group', {}, h('h4', {}, 'Общее'),
      rToggle('Анимации включены', 'theme.effects.animations', 'Если выключить, всё будет без анимации'),
      rRange('Скорость анимаций', 'theme.effects.speed', 0.25, 3, 0.05, (v) => `×${v}`, 'Чем меньше, тем медленнее')));
    body.append(h('div.s-group', {}, h('h4', {}, 'Движение'),
      rSelect('Переход между разделами', 'anim.view', [['fade', 'Растворение с подъёмом'], ['slide', 'Сдвиг в сторону'], ['zoom', 'Приближение'], ['glitch', 'Глитч-помехи'], ['none', 'Мгновенно']]),
      row('Проверить переход', h('div.anim-demo', {}, ...[['stories', 'Рассказы'], ['timeline', 'Хроника'], ['settings', 'Сюда']].map(([v, t]) => btn(t, () => window.__go(v, v === 'settings' ? { tab: 'motion' } : {}), { cls: 'ghost' })))),
      rSelect('Появление карточек', 'anim.cards', [['rise', 'Всплытие'], ['fade', 'Проявление'], ['scale', 'Увеличение'], ['blur', 'Из размытия'], ['none', 'Без анимации']]),
      rSelect('Перелистывание страниц', 'anim.page', [['flip', '3D-перелистывание книги'], ['slide', 'Сдвиг'], ['fade', 'Растворение'], ['none', 'Мгновенно']], null, 'Для режимов «Страницы» и «Разворот»'),
      rToggle('Плавная прокрутка текста', 'anim.smoothScroll', 'Текст прокручивается мягко, без рывков'),
      rToggle('Смена темы «волной»', 'anim.themeReveal', 'Новая тема расходится кругом от места клика'),
      rToggle('Заставка «Пробуждение» при запуске', 'sound.boot')));
  },

  layout(body, redraw) {
    body.append(h('h3', {}, 'Интерфейс'), h('p.desc', {}, 'Режим, положение меню, разделы и вид списков.'));
    body.append(h('div.s-group', {}, h('h4', {}, 'Режим приложения'), h('div.mode-cards', {}, Object.entries(MODES).map(([id, m]) => h(`button.mode-card${mode() === id ? '.on' : ''}`, { onclick: () => { if (id !== mode()) { switchMode(id); setTimeout(() => window.__go('settings', { tab: 'layout' }, { replace: true }), 80); } } }, icon({ ishimura: 'signal', warhammer: 'sword', free: 'feather' }[id]), h('div', {}, h('b', {}, m.name), h('span', {}, m.about)))))));
    body.append(h('div.s-group', {}, h('h4', {}, 'Меню'),
      rSelect('Положение меню', 'layout.nav', [['left', 'Слева'], ['right', 'Справа'], ['top', 'Сверху'], ['bottom', 'Снизу'], ['hidden', 'Скрыто (Ctrl+B)']]),
      rSelect('Вид пунктов', 'layout.navStyle', [['full', 'Иконки и подписи'], ['icons', 'Только иконки'], ['labels', 'Только подписи']]),
      rRange('Ширина бокового меню', 'layout.navWidth', 170, 360, 2, px),
      rSelect('Плотность', 'layout.density', [['compact', 'Компактно'], ['normal', 'Обычно'], ['spacious', 'Просторно']]),
      rToggle('Строка состояния', 'layout.statusBar'),
      rToggle('Часы в строке состояния', 'layout.clock')));

    const secList = h('div.sec-list');
    const drawSecs = () => {
      secList.innerHTML = '';
      const secs = sectionsOf();
      secs.forEach((s, idx) => {
        const def = SECTIONS.find((x) => x.id === s.id);
        const r = h(`div.sec-row${s.visible ? '' : '.off'}`, { draggable: true },
          h('span.grip', {}, icon('grip')), icon(def.icon), h('span.name', {}, (mode() === 'ishimura' && (state.settings.texts.sections || {})[s.id]) || def.title, def.modes.includes(mode()) ? null : h('small', { style: { color: 'var(--dim)', marginLeft: '8px' } }, `из режима «${MODES[def.modes[0]].name}»`)),
          btn('', () => move(idx, -1), { ico: 'left', cls: 'ghost', title: 'Выше', disabled: idx === 0 }),
          btn('', () => move(idx, 1), { ico: 'right', cls: 'ghost', title: 'Ниже', disabled: idx === secs.length - 1 }),
          btn('', () => { const next = secs.map((x) => (x.id === s.id ? { ...x, visible: !x.visible } : x)); setSetting(`layout.sectionsByMode.${mode()}`, next); drawSecs(); }, { ico: s.visible ? 'eye' : 'eyeOff', cls: 'ghost', title: s.visible ? 'Скрыть' : 'Показать' }));
        r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(idx)); r.classList.add('dragging'); });
        r.addEventListener('dragend', () => r.classList.remove('dragging'));
        r.addEventListener('dragover', (e) => { e.preventDefault(); r.classList.add('over'); });
        r.addEventListener('dragleave', () => r.classList.remove('over'));
        r.addEventListener('drop', (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          const next = [...secs];
          const [it] = next.splice(from, 1);
          next.splice(idx, 0, it);
          setSetting(`layout.sectionsByMode.${mode()}`, next);
          drawSecs();
        });
        secList.append(r);
      });
    };
    const move = (idx, d) => {
      const next = [...sectionsOf()];
      const [it] = next.splice(idx, 1);
      next.splice(idx + d, 0, it);
      setSetting(`layout.sectionsByMode.${mode()}`, next);
      drawSecs();
    };
    drawSecs();
    body.append(h('div.s-group', {}, h('h4', {}, `Разделы режима «${MODES[mode()].name}» (перетаскивайте)`), secList, mode() === 'ishimura' ? h('div', { style: { marginTop: '12px' } },
      rSelect('Стартовый раздел', 'layout.home', SECTIONS.filter((s) => s.modes.includes('ishimura')).map((s) => [s.id, s.title]))) : null));

    body.append(h('div.s-group', {}, h('h4', {}, 'Списки'),
      rSelect('Вид рассказов', 'layout.storiesView', [['tiles', 'Плитки с обложками'], ['list', 'Список'], ['shelf', 'Книжная полка']]),
      rSelect('Сортировка', 'layout.storiesSort', [['chrono', 'По хронологии вселенной'], ['new', 'Сначала новые'], ['title', 'По названию']]),
      rSelect('Вид хроники', 'layout.timelineView', [['scale', 'Шкала времени'], ['list', 'Список']]),
      rRange('Размер карточек', 'layout.cardSize', 140, 360, 5, px)));
  },

  texts(body) {
    body.append(h('h3', {}, 'Тексты интерфейса'), h('p.desc', {}, 'Название архива и разделов, ваше имя и приветствие Мируаны. Работает только в режиме «Ишимура».'));
    body.append(h('div.s-group', {}, h('h4', {}, 'Архив'),
      rText('Название в заголовке окна', 'texts.brand', 'Архив «Ишимуры»'),
      rText('Ваше имя', 'texts.name', 'например, Артём', 'Мируана будет обращаться к вам по имени'),
      rText('Приветствие при запуске', 'texts.greeting', 'Пробуждение завершено. Здравствуй, {name}.', '{name} заменится на ваше имя')));
    const secs = h('div.s-group', {}, h('h4', {}, 'Названия разделов'));
    for (const s of SECTIONS.filter((x) => x.modes.includes('ishimura'))) {
      const i = h('input.input', { value: (state.settings.texts.sections || {})[s.id] || '', placeholder: s.title });
      const save = debounce(() => setSetting('texts.sections', { ...(state.settings.texts.sections || {}), [s.id]: i.value }), 350);
      i.addEventListener('input', save);
      secs.append(row(s.title, i));
    }
    body.append(secs);
  },

  reader(body, redraw) {
    body.append(h('h3', {}, 'Чтение'), h('p.desc', {}, 'То же самое есть в читалке под кнопкой «Aa».'));
    body.append(moduleBar('reader', redraw));
    body.append(h('div.s-group', {}, h('h4', {}, 'Режим'),
      rSelect('Режим чтения', 'reader.mode', [['scroll', 'Лента (прокрутка)'], ['paged', 'Страницы'], ['spread', 'Разворот книги']]),
      rSelect('Режим фокуса', 'reader.focus', [['off', 'Выключен'], ['paragraph', 'Подсвечивать текущий абзац'], ['ruler', 'Линейка под курсором']], null, 'Клавиша F в читалке'),
      rRange('Скорость автопрокрутки', 'reader.autoSpeed', 5, 300, 5, (v) => `${v} px/с`, 'Клавиша A в читалке, + и − меняют скорость'),
      rToggle('Скрывать панели при чтении', 'reader.immersive', 'Панели появляются, если подвести мышь к краю')));
    body.append(h('div.s-group', {}, h('h4', {}, 'Текст'),
      rSelect('Шрифт', 'reader.font', fontOptions(true)),
      rRange('Размер', 'reader.fontSize', 13, 32, 1, px),
      rRange('Межстрочный интервал', 'reader.lineHeight', 1.2, 2.4, 0.05, (v) => Number(v).toFixed(2)),
      rRange('Ширина колонки', 'reader.width', 460, 1200, 10, px),
      rRange('Отступ между абзацами', 'reader.paraSpacing', 0, 2, 0.1, (v) => `${Number(v).toFixed(1)}em`),
      rToggle('Красная строка', 'reader.indent'),
      rSelect('Выравнивание', 'reader.align', [['left', 'По левому краю'], ['justify', 'По ширине']]),
      rSelect('Бумага', 'reader.paper', Object.entries(PAPERS).map(([k, p]) => [k, p.name])),
      rSelect('Штампы сцен', 'reader.stampStyle', [['terminal', 'Запись бортового журнала'], ['plain', 'Простой жирный текст']])));
  },

  sound(body, redraw) {
    body.append(h('h3', {}, 'Звук и курсор'), h('p.desc', {}, 'Звуки и курсор сохраняются вместе с темой.'));
    body.append(h('div.s-group', {}, h('h4', {}, 'Громкость'),
      rToggle('Звуки интерфейса', 'sound.ui'),
      rRange('Громкость интерфейса', 'sound.uiVolume', 0, 1, 0.01, pct)));

    const custom = state.settings.theme.sound.custom || {};
    const rows = SOUND_EVENTS.map(([ev, label]) => h('div.sound-row', {},
      h('span', {}, label),
      h('span.file', {}, custom[ev] ? decodeURIComponent(custom[ev].split('/').pop()).replace(/^\d+-/, '') : 'из набора'),
      btn('', () => sfx(ev), { ico: 'play', cls: 'ghost', title: 'Прослушать' }),
      custom[ev]
        ? btn('', () => { const c = { ...custom }; delete c[ev]; setSetting('theme.sound.custom', c); redraw(); }, { ico: 'trash', cls: 'ghost', title: 'Вернуть звук набора' })
        : btn('', async () => { const f = await window.ark.user.pick('sound'); if (!f) return; setSetting('theme.sound.custom', { ...custom, [ev]: f.url }); redraw(); }, { ico: 'upload', cls: 'ghost', title: 'Загрузить свой звук' })));
    body.append(h('div.s-group', {}, h('h4', {}, 'Звуки интерфейса'),
      rSelect('Набор звуков', 'theme.sound.pack', SOUND_PACKS, () => { setTimeout(() => sfx('notify'), 50); }),
      h('div', { style: { marginTop: '10px' } }, rows)));

    const cur = state.settings.theme.cursor;
    body.append(h('div.s-group', {}, h('h4', {}, 'Курсор'),
      rSelect('Стиль курсора', 'theme.cursor.type', [['system', 'Системный'], ['arrow', 'Стрелка терминала'], ['crosshair', 'Прицел'], ['block', 'Блок-курсор'], ['glow', 'Светящаяся точка (плавная)'], ['custom', 'Своя картинка']], () => redraw()),
      cur.type === 'custom' ? row('Файл курсора', btn(cur.url ? 'Заменить' : 'Выбрать файл', async () => {
        const f = await window.ark.user.pick('cursor');
        if (!f) return;
        setSetting('theme.cursor.url', f.url);
        redraw();
      }, { ico: 'upload', cls: 'primary' }), 'PNG до 128×128, остриё в левом верхнем углу') : null));
  },

  css(body) {
    body.append(h('h3', {}, 'Свой CSS'), h('p.desc', {}, 'Своим CSS можно поменять что угодно. Он хранится в теме и экспортируется вместе с ней.'));
    const ta = h('textarea.textarea.css-editor', { spellcheck: false, placeholder: '/* Например: */\n.card h3 { color: var(--accent-2); }' }, state.settings.theme.css || '');
    const save = debounce(() => setSetting('theme.css', ta.value), 400);
    ta.addEventListener('input', save);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); save(); }
    });
    const snippets = [
      ['Неоновые заголовки', '.page-head h1 { text-shadow: 0 0 12px var(--accent), 0 0 40px var(--accent); }'],
      ['Круглые обложки-карточки', '.cover { border-radius: 18px; }\n.card .cover { box-shadow: 0 10px 30px #0008; }'],
      ['Широкое меню с крупным текстом', '.nav-item { font-size: 16px; padding: 12px 16px; }'],
      ['Текст рассказа с тенью', '.rd-article { text-shadow: 0 1px 2px #0009; }'],
      ['Без рамок у панелей', '.panel { border-color: transparent !important; }'],
    ];
    body.append(h('div.s-group', {}, ta, h('div.chips', { style: { marginTop: '10px' } },
      h('span', { style: { color: 'var(--dim)', fontSize: '12px', alignSelf: 'center' } }, 'Вставить пример:'),
      snippets.map(([t, code]) => h('button.chip', { onclick: () => { ta.value = `${ta.value}${ta.value ? '\n\n' : ''}/* ${t} */\n${code}`; save(); } }, t)),
      h('button.chip', { onclick: async () => { if (await confirmBox('Очистить CSS?', 'Весь свой CSS этой темы будет удалён.', { ok: 'Очистить', danger: true })) { ta.value = ''; save(); } } }, 'Очистить'))));
    body.append(h('div.s-group', {}, h('h4', {}, 'Шпаргалка'), h('div.cheat', { html: [
      '<b>Переменные</b>', '<code>--bg --bg-2 --bg-3</code> фоны', '<code>--text --dim</code> текст', '<code>--accent --accent-2</code> акценты', '<code>--line</code> рамки', '<code>--f-ui --f-head --f-read</code> шрифты', '<code>--r</code> скругление', '<code>--glow</code> свечение', '<code>--speed</code> скорость анимаций',
      '<b>Элементы</b>', '<code>.titlebar .nav .nav-item</code>', '<code>.page-head h1</code> заголовок раздела', '<code>.card .cover .row</code> рассказы', '<code>.reader .rd-article</code> текст', '<code>.rd-article .stamp</code> штампы сцен', '<code>.tl-band .tl-label</code> хроника', '<code>.panel .btn .chip</code>',
    ].join('<br>') })));
  },

  system(body, redraw) {
    body.append(h('h3', {}, 'Система'), h('p.desc', {}, 'Проверка архива, версия и сброс настроек.'));
    const sys = (k) => `system.${k}`;
    body.append(h('div.s-group', {}, h('h4', {}, 'Архив'),
      rRange('Проверять архив каждые', sys('pollMinutes'), 2, 120, 1, (v) => `${v} мин`),
      h('p', { style: { color: 'var(--dim)', fontSize: '12px', margin: '8px 0 0', lineHeight: 1.5 } }, 'Пока приложение открыто. При каждом возвращении в приложение архив тоже сверяется.')));

    const st = state.status || {};
    body.append(h('div.s-group', {}, h('h4', {}, 'Связь'),
      row('Источник архива', h('span', {}, `github.com/${st.source || ''}`)),
      row('Ревизия архива', h('span', {}, String(st.revision ?? 0))),
      row('Синхронизация', btn('Проверить связь', async () => {
        const r = await window.ark.content.sync();
        if (r.error) toast('Нет связи', r.error, { error: true }); else toast('Связь стабильна', r.changed ? 'Архив обновлён' : 'Новых передач нет');
      }, { ico: 'sync' })),
      row(`Версия программы ${state.info.version}`, h('span', { style: { color: 'var(--dim)' } },
        state.info.platform === 'android' ? 'Новые версии — на github.com/Bondrudes21/ishimura-mobile/releases' : 'Сайт обновляется сам'))));

    body.append(h('div.s-group', {}, h('h4', {}, 'Сброс'),
      row('Вернуть всё как было', btn('Сбросить настройки', async () => {
        if (!(await confirmBox('Сбросить все настройки?', 'Внешний вид, раскладка и параметры чтения вернутся к теме «Терминал Ишимуры». Прогресс чтения, закладки и ваши пресеты останутся.', { ok: 'Сбросить', danger: true }))) return;
        const d = defaultSettings('terminal');
        d.firstRun = false;
        replaceSettings(d, { reveal: true });
        setTimeout(redraw, 60);
      }, { ico: 'sync', cls: 'danger' }))));
  },
};

function updText(u) {
  return { idle: 'Не проверялось', checking: 'Проверка…', latest: 'Установлена последняя версия', downloading: `Загрузка ${u.percent || 0}%`, ready: `Обновление ${u.version} скачано, перезапустите приложение`, error: `Ошибка: ${u.error}` }[u.status] || '';
}

// ---------- Диалоги тем ----------
function newThemeDialog(redraw, { fromCurrent = false } = {}) {
  modal((box, close) => {
    const name = h('input.input', { value: `Моя тема ${state.presets.themes.length + 1}` });
    const about = h('textarea.textarea', { style: { minHeight: '70px' }, placeholder: 'Описание (необязательно)' });
    const base = h('select.select', {},
      h('option', { value: '' }, 'Текущий вид (со всеми изменениями)'),
      allThemes().map((t) => h('option', { value: t.id }, t.name)));
    let withLayout = true;
    box.append(h('h2', {}, 'Новая тема'), h('p.sub', {}, 'Тема появится в списке. Всё, что вы поменяете, сохранится в неё само.'),
      h('div.field', {}, h('label', {}, 'Название'), name),
      h('div.field', {}, h('label', {}, 'Описание'), about),
      h('div.field', {}, h('label', {}, 'Взять за основу'), base),
      row('Сохранить и раскладку интерфейса', toggle(true, (v) => { withLayout = v; })),
      h('div.actions', {}, btn('Отмена', close), btn('Создать', () => {
        if (!name.value.trim()) return;
        const id = createTheme({ name: name.value.trim(), about: about.value.trim(), from: base.value || null, withLayout });
        close();
        if (base.value) applyTheme(id); else setSetting('activeTheme', id);
        toast('Тема создана', `«${name.value.trim()}». Настройте её на вкладках «Цвета», «Шрифты» и «Эффекты».`);
        setTimeout(redraw, 60);
      }, { cls: 'primary', ico: 'check' })));
    setTimeout(() => name.select(), 30);
  });
}

function editThemeDialog(t, redraw) {
  modal((box, close) => {
    const name = h('input.input', { value: t.name });
    const about = h('textarea.textarea', { style: { minHeight: '70px' } }, t.about || '');
    box.append(h('h2', {}, 'Изменить тему'),
      h('div.field', {}, h('label', {}, 'Название'), name),
      h('div.field', {}, h('label', {}, 'Описание'), about),
      h('p.sub', {}, 'Чтобы поменять оформление, примените тему и настройте её на других вкладках.'),
      h('div.actions', {},
        state.settings.activeTheme === t.id ? null : btn('Применить', () => { close(); applyTheme(t.id); setTimeout(redraw, 60); }, { ico: 'check' }),
        btn('Отмена', close),
        btn('Сохранить', () => { updateUserTheme(t.id, { name: name.value.trim() || t.name, about: about.value.trim() }); close(); redraw(); }, { cls: 'primary' })));
  });
}

async function exportTheme(t) {
  const out = { format: 'ishimura-theme/2', name: t.name, about: t.about || '', theme: normalizeTheme(t.id === state.settings.activeTheme ? state.settings.theme : t.theme), layout: t.layout || null };
  if (await window.ark.user.exportTheme(t.name, JSON.stringify(out, null, 2))) toast('Тема сохранена в файл', 'Файл можно отправить другу, он добавит тему через «Импорт из файла»');
}

// ---------- Генерация палитр ----------
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hh = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
  }
  return [hh, s * 100, l * 100];
}
function hsl(hh, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + hh / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
function randomColor() {
  return hsl(Math.random() * 360, 70 + Math.random() * 30, 55 + Math.random() * 10);
}
function harmonize(accent) {
  const [hh, s] = hexToHsl(accent);
  const sat = Math.min(40, s * 0.45);
  setSetting('theme.colors', {
    bg: hsl(hh, sat, 3.5), bg2: hsl(hh, sat, 6.5), bg3: hsl(hh, sat, 10.5), line: hsl(hh, sat, 19),
    text: hsl(hh, Math.min(60, s * 0.6), 89), dim: hsl(hh, sat * 0.7, 52),
    accent, accent2: hsl((hh + 25) % 360, Math.min(100, s), 78),
    warn: getSetting('theme.colors.warn'), danger: getSetting('theme.colors.danger'),
  });
}
function lightVariant() {
  const [hh, s] = hexToHsl(getSetting('theme.colors.accent'));
  setSetting('theme.colors', {
    bg: hsl(hh, 20, 95), bg2: hsl(hh, 20, 98), bg3: hsl(hh, 18, 91), line: hsl(hh, 15, 80),
    text: hsl(hh, 30, 12), dim: hsl(hh, 12, 42), accent: hsl(hh, Math.max(60, s), 38), accent2: hsl((hh + 25) % 360, 60, 45),
    warn: '#b7791f', danger: '#c53030',
  });
}

export function renderSettings(el, params) {
  if (params.tab) tab = params.tab;
  const tabs = h('div.settings-tabs.panel');
  const body = h('div.s-body.panel');
  const draw = () => {
    tabs.innerHTML = '';
    for (const [id, label, ico] of TABS) {
      tabs.append(h(`button.s-tab${tab === id ? '.on' : ''}`, { onclick: () => { tab = id; sfx('click'); draw(); body.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }); } }, icon(ico), h('span', {}, label)));
    }
    const scroll = el.closest('.view') ? el.closest('.view').scrollTop : 0;
    body.innerHTML = '';
    BUILD[tab](body, draw);
    if (el.closest('.view')) el.closest('.view').scrollTop = scroll;
  };
  el.append(h('div.page', {},
    pageHead('Настройка терминала', 'Конфигу<em>ратор</em>', { code: 'CFG', stamp: 'Настройки' }),
    h('div.settings', {}, tabs, body)));
  draw();
  // Темы и пресеты могли поменяться с панели быстрых настроек
  const off = [on('presets', () => { if (tab === 'themes') draw(); })];
  return () => off.forEach((f) => f());
}
