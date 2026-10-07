# Архив Ишимуры — мобильная версия

Телефонная версия «Архива Ишимуры»: рассказы Тиамата II, библиотека книг и аудиокниг, «Мои книги».
Рассказы приходят из репозитория [ishimura-archive](https://github.com/Bondrudes21/ishimura-archive).

## Как поставить

**Android:** скачайте APK со страницы
[Releases](https://github.com/Bondrudes21/ishimura-mobile/releases/latest) и откройте его на телефоне.
Если Android спросит, разрешите установку из этого источника.

**iPhone:** откройте в Safari https://bondrudes21.github.io/ishimura-mobile/,
затем нажмите «Поделиться» → «На экран „Домой“».

## Что умеет

| | Android (APK) | iPhone (сайт) |
|---|---|---|
| Рассказы, галерея, хроника, кодекс, карта, офлайн | да | да |
| Библиотека FB2/EPUB/PDF/TXT/DOCX/RTF, архивы ZIP/7z/RAR | да | да |
| Аудиокниги в фоне, кнопки на экране блокировки | да (нативный плеер) | да (пока Safari не выгрузит страницу) |
| «Открыть в…» / «Поделиться» → книга на полке | да | нет (добавлять кнопкой) |
| Встроенный браузер со скачиванием на полку | да | нет (сайты открываются в Safari) |
| OPDS-каталоги | да | только каталоги, разрешающие доступ с сайтов |
| Мои книги, экспорт FB2/EPUB/DOCX | да | да |

## Как выпустить новую версию

1. Поменяйте `"version"` в `package.json` и `APP_VERSION` в `www/js/platform/env.js`.
2. Закоммитьте и отправьте тег: `git tag v1.0.1` → `git push origin main --tags`.
3. GitHub Actions соберёт APK и выложит его в Releases. Сайт для iPhone обновляется сам при каждом push в `main`.

## Разработка

```
npm install
npm run vendor      # собрать библиотеки в www/vendor
npm run serve       # проверить в браузере: http://localhost:5173
npm run icons       # пересобрать иконки из build/icon.png
npx cap sync android
```

| Путь | Что там |
|---|---|
| `www/` | Интерфейс (копия renderer из ПК-версии + мобильная вёрстка `css/mobile.css`) |
| `www/js/platform/` | Замена Electron: хранилище файлов, синхронизация, библиотека, рукописи, `window.ark` |
| `android/app/src/main/java/…/` | Нативная часть: файлы, браузер, распаковка 7z/rar, плеер аудиокниг |
| `.github/workflows/` | Сборка APK и публикация сайта |
