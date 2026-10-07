// Быстрые настройки: выезжающая панель поверх любого экрана, изменения видны сразу
import { h, icon, btn, range, toggle, toast, promptBox } from './util.js';
import { state, on, setSetting, getSetting, allThemes, applyTheme, themeDirty, saveCurrentToActive, createTheme, modulePresets, applyModule, withReveal } from './state.js';
import { normalizeTheme } from './themes.js';
import { sfx } from './sound.js';

let panel = null;
let offs = [];

const ACCENTS = ['#39ff9a', '#4de2ff', '#6fa8ff', '#b07cff', '#ff6ad5', '#ff5050', '#ff7a1a', '#ffc21a', '#e8e4d8'];

function lighten(hex, k = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function section(title, ...children) {
  return h('div.qs-sec', {}, h('h4', {}, title), ...children);
}

function swatches(t) {
  const c = normalizeTheme(t.theme).colors;
  return h('span.qs-sw', {}, ['bg', 'accent', 'accent2', 'text'].map((k) => h('i', { style: { background: c[k] } })));
}

function draw() {
  if (!panel) return;
  const body = panel.querySelector('.qs-body');
  const scroll = body.scrollTop;
  body.innerHTML = '';
  const active = state.settings.activeTheme;
  const dirty = themeDirty();

  // Темы
  const themeList = h('div.qs-themes', {}, allThemes().map((t) => h(`button.qs-theme${t.id === active ? '.on' : ''}`, {
    onclick: () => { sfx('click'); applyTheme(t.id); },
    title: t.about || '',
  }, swatches(t), h('span', {}, t.name), t.builtin ? null : h('small', {}, 'моя'))));
  const themeActions = h('div.qs-row', {},
    dirty && active.startsWith('user:') ? btn('Сохранить в тему', () => { saveCurrentToActive(); toast('Тема обновлена'); }, { ico: 'save', cls: 'primary' }) : null,
    btn('Новая тема из текущего вида', async () => {
      const name = await promptBox('Название новой темы', { value: `Моя тема ${state.presets.themes.length + 1}` });
      if (!name) return;
      const id = createTheme({ name });
      setSetting('activeTheme', id);
      toast('Тема создана', `«${name}» появилась в списке тем`);
    }, { ico: 'plus' }));
  body.append(section(dirty ? 'Тема · изменена' : 'Тема', themeList, themeActions));

  // Акцент
  const accRow = h('div.qs-accents', {}, ACCENTS.map((c) => h(`button.qs-acc${getSetting('theme.colors.accent') === c ? '.on' : ''}`, {
    style: { background: c },
    onclick: () => withReveal(() => { setSetting('theme.colors.accent2', lighten(c), { silent: true }); setSetting('theme.colors.accent', c); }),
  })));
  const pick = h('input', { type: 'color', value: getSetting('theme.colors.accent'), title: 'Свой цвет' });
  pick.addEventListener('input', () => setSetting('theme.colors.accent', pick.value, { silent: true }));
  pick.addEventListener('change', () => setSetting('theme.colors.accent2', lighten(pick.value)));
  accRow.append(pick);
  body.append(section('Акцент', accRow));

  // Модули
  for (const [mod, label] of [['colors', 'Палитра'], ['fonts', 'Шрифты'], ['effects', 'Эффекты'], ['reader', 'Чтение']]) {
    body.append(section(label, h('div.chips', {}, modulePresets(mod).map((p) => h('button.chip', { onclick: () => { sfx('click'); applyModule(mod, p); } }, p.name)))));
  }

  // Ползунки
  const sl = (label, path, min, max, step) => h('div.qs-slider', {}, h('span', {}, label), range({ min, max, step, value: getSetting(path), onInput: (v) => setSetting(path, v) }));
  body.append(section('Атмосфера',
    sl('Скан-линии', 'theme.effects.scanlines', 0, 1, 0.01),
    sl('Свечение', 'theme.effects.glow', 0, 2, 0.05),
    sl('Зерно', 'theme.effects.grain', 0, 0.6, 0.01),
    sl('Виньетка', 'theme.effects.vignette', 0, 1, 0.01),
    sl('Прозрачность панелей', 'theme.effects.panelAlpha', 20, 100, 1),
    h('div.qs-row', {}, h('span', {}, 'Мерцание'), toggle(getSetting('theme.effects.flicker'), (v) => setSetting('theme.effects.flicker', v, { silent: true })))));

  body.append(section('Текст',
    sl('Размер текста', 'reader.fontSize', 13, 32, 1),
    sl('Интервал', 'reader.lineHeight', 1.2, 2.4, 0.05),
    sl('Размер интерфейса', 'theme.fonts.uiSize', 11, 18, 1)));

  // Раскладка
  const navs = [['left', 'Слева'], ['top', 'Сверху'], ['right', 'Справа'], ['bottom', 'Снизу'], ['hidden', 'Скрыть']];
  body.append(section('Меню', h('div.chips', {}, navs.map(([v, t]) => h(`button.chip${getSetting('layout.nav') === v ? '.on' : ''}`, { onclick: () => withReveal(() => setSetting('layout.nav', v)) }, t)))));
  const anims = [['fade', 'Растворение'], ['slide', 'Сдвиг'], ['zoom', 'Приближение'], ['glitch', 'Глитч'], ['none', 'Без']];
  body.append(section('Переходы', h('div.chips', {}, anims.map(([v, t]) => h(`button.chip${getSetting('anim.view') === v ? '.on' : ''}`, { onclick: () => setSetting('anim.view', v) }, t)))));

  body.append(h('div.qs-foot', {}, btn('Полный Конфигуратор', () => { closeQuick(); window.__go('settings'); }, { ico: 'sliders' })));
  body.scrollTop = scroll;
}

export function toggleQuick() {
  if (panel) closeQuick(); else openQuick();
}

export function openQuick() {
  if (panel) return;
  sfx('open');
  panel = h('aside.qs', {},
    h('header', {}, icon('palette'), h('b', {}, 'Быстрые настройки'), h('span', { style: { flex: 1 } }), btn('', closeQuick, { ico: 'close', cls: 'ghost', title: 'Закрыть (Esc)' })),
    h('div.qs-body'));
  document.getElementById('layers').append(panel);
  requestAnimationFrame(() => panel.classList.add('open'));
  draw();
  offs = [
    on('settings', (path) => { if (path === '*' || /^(activeTheme|layout\.nav|anim|theme\.colors)/.test(path)) draw(); }),
    on('presets', draw),
  ];
  document.addEventListener('keydown', onKey, true);
}

function onKey(e) {
  if (e.key === 'Escape' && panel) { e.stopPropagation(); closeQuick(); }
}

export function closeQuick() {
  if (!panel) return;
  sfx('close');
  const p = panel;
  panel = null;
  offs.forEach((f) => f());
  offs = [];
  document.removeEventListener('keydown', onKey, true);
  p.classList.remove('open');
  setTimeout(() => p.remove(), 450);
}
