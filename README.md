# TGDrive-Easy

[Русский](README.md) | [English](README.en.md)

**TGDrive-Easy** — локальный клиент Telegram, который показывает «Избранное» (Saved Messages) как сетевой диск и как веб-интерфейс. Работает на Windows, Linux и macOS.

## Скачать

Все файлы — в разделе [Releases](https://github.com/alexsemenovru/TGDrive-Easy/releases).

| Платформа | Файл | Статус |
|---|---|---|
| Windows | `TGDrive-Easy.exe` | стабильная **v1.0.1** |
| Windows / Linux / macOS | те же файлы в **v1.2.2-beta.3** | тестовая кроссплатформенная |
| Linux | `TGDrive-Easy-x86_64.AppImage` | в бете |
| macOS | `TGDrive-Easy-macos.zip` (внутри `.app`) | в бете |

## Возможности

- вход в Telegram по номеру телефона, коду и паролю 2FA (ключи `api_id`/`api_hash` регистрировать не нужно — используются публичные учётные данные веб-клиента);
- список файлов «Избранного», скачивание, загрузка, переименование, удаление, виртуальные папки;
- сетевой диск через WebDAV: штатный клиент Windows, GVFS в Linux, Finder в macOS или `rclone`;
- режим без кеша: ошибки передачи видны сразу, а не «через минуту»;
- при сбое фоновой загрузки в папке появляется заметка `<имя>.upload-failed.txt` с причиной;
- значок в трее с меню: **Console**, **Drive** (галочка — смонтирован, щелчок монтирует/снимает), **Exit**;
- автомонтирование диска при запуске и кнопки Mount/Unmount в настройках веб-консоли;
- автозапуск при входе в систему (по умолчанию выключен): реестр в Windows, `.desktop` в Linux, LaunchAgent в macOS;
- трафик Telegram идёт через SOCKS5- или MTProto-прокси; прокси настраивается в веб-консоли до и после входа, ссылку `tg://proxy` можно вставить целиком.

- интерфейс на английском и русском: язык переключается в настройках, по умолчанию определяется по локали системы (русская локаль — русский, иначе английский);

## Windows

1. Скачайте `TGDrive-Easy.exe` и запустите — значок появится в трее, диск `Z:` смонтируется автоматически.
2. Правый клик по значку → **Console** → войдите в Telegram.

Один раз (от администратора) включите штатный WebDAV-клиент Windows:

```
HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters
  BasicAuthLevel       = 2
  FileSizeLimitInBytes = 4294967295
```

Данные: `%APPDATA%\TGDrive-Easy\data`. Распакованные компоненты: `%LOCALAPPDATA%\TGDrive-Easy\runtime`.

## Linux

```bash
chmod +x TGDrive-Easy-x86_64.AppImage
./TGDrive-Easy-x86_64.AppImage
```

- Нужен `libayatana-appindicator3` (в Ubuntu обычно уже установлен; иначе `sudo apt install libayatana-appindicator3-1`).
- Если AppImage не запускается из-за FUSE: `./TGDrive-Easy-x86_64.AppImage --appimage-extract-and-run`.
- Диск монтируется через GVFS и появляется в файловом менеджере; если не удалось, приложение продолжает работать и открывает консоль.
- Данные: `~/.local/share/TGDrive-Easy/data`.

## macOS

1. Распакуйте `TGDrive-Easy-macos.zip` и перетащите `TGDrive-Easy.app` в «Программы».
2. Первый запуск: правый клик по `TGDrive-Easy.app` → **Открыть** → **Открыть**. Сборка не подписана Apple Developer ID; альтернатива — `xattr -dr com.apple.quarantine TGDrive-Easy.app`.
3. Значок появляется **в строке меню** (Dock-иконки нет — это фоновое приложение). Меню: **Console / Drive / Exit**.
4. Диск подключается через Finder как том `dav`.

Данные и журналы: `~/.local/share/TGDrive-Easy/data` (`app.log`, `tray.log`).

## Настройки

`data/.env` (рядом с данными приложения):

```
PORT=4100
SOCKS_IP=127.0.0.1
SOCKS_PORT=10808
DAV_USER=teledrive
DAV_PASS=<генерируется автоматически при первом запуске>
MOUNT_MODE=webdav
```

Пароль WebDAV по умолчанию не используется: если `DAV_PASS` пуст или равен `teledrive`, сервер генерирует случайный пароль и сохраняет его в `.env` (в журнал пишется только предупреждение, без самого пароля). Этот пароль нужен, если подключать диск вручную.

Автомонтирование, автозапуск и параметры прокси хранятся в `settings.json` рядом и меняются из веб-консоли (кнопка **⚙ Settings**).

## Сборка из исходников

Сервер:

```bash
cd app
npm install
node server.js
```

Интерфейс: http://127.0.0.1:4100

Windows EXE (Go 1.21+, Node.js 18, Python с Pillow):

```powershell
cd tray
.\build.ps1
```

Unix-лаунчер с треем (Go 1.21+, Node.js 18; в Linux — GTK3 и libayatana-appindicator3):

```bash
cd unix
./build.sh
```

Упаковка: `unix/package-appimage.sh` (Linux) и `unix/package-macos.sh` (macOS). CI собирает все три платформы автоматически.

## Безопасность

- Пароль WebDAV генерируется случайно при первом запуске и хранится в `.env`; значение по умолчанию `teledrive` не используется.
- Распаковка архивов защищена от Zip Slip: путь обязан оставаться внутри каталога приложения.
- rclone RC требует логин и пароль, флаг `--rc-no-auth` не используется.
- Блокировки WebDAV (`LOCK`) удаляются по TTL, карта блокировок не растёт бесконечно.

Подробнее — в [SECURITY.md](SECURITY.md).

## Ограничения

- Telegram: 2 ГБ на файл, 4 ГБ с Premium; клиент Windows не передаёт файлы больше 4 ГБ.
- «Избранное» не поддерживает папки — они виртуальные и хранятся в `data/tree.json`.
- Сборки не подписаны: SmartScreen в Windows и Gatekeeper в macOS предупреждают.
- `data/session.txt` даёт полный доступ к аккаунту: не публикуйте его.
- Используются публичные учётные данные веб-клиента Telegram. Технически это работает, но формально сторонний клиент: для постоянной работы надёжнее указать свой `api_id`/`api_hash` в `.env`.

## Вдохновение и происхождение

Проект вдохновлён [mgilangjanuar/teledrive](https://github.com/mgilangjanuar/teledrive) — открытым клиентом Telegram Drive. Код здесь написан заново, но идея и подход к работе с «Избранным» выросли из знакомства с этим проектом.

Проект целиком исполнен с помощью **вайб-кодинга** (vibe coding): человек ставил задачи и проверял результат, код писал ИИ-агент.

## Лицензия

MIT, см. [LICENSE](LICENSE).
