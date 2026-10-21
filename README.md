# TeleDrive Local

Локальный клиент Telegram, который показывает «Избранное» (Saved Messages) как сетевой диск Windows (`Z:`) и как веб-интерфейс. Один EXE, без установки.

## Что умеет

- вход в Telegram по номеру телефона, коду и паролю 2FA (ключи `api_id`/`api_hash` регистрировать не нужно — используются публичные учётные данные веб-клиента);
- список файлов «Избранного», скачивание, загрузка, переименование, удаление, виртуальные папки;
- сетевой диск через WebDAV: Windows-клиент или `rclone`;
- режим без кеша: ошибки передачи видны сразу, а не «через минуту»;
- при сбое фоновой загрузки в папке появляется заметка `<имя>.upload-failed.txt` с причиной;
- трафик Telegram идёт через SOCKS5-прокси (по умолчанию `127.0.0.1:10808`).

## Состав

```
app/    Node.js-сервер: WebDAV, Telegram (GramJS), веб-интерфейс
tray/   Go-лаунчер: значок в трее, меню «Консоль» / «Выход», встроенный Node
```

## Сборка

Сервер:

```powershell
cd app
npm install
node server.js
```

Интерфейс: http://127.0.0.1:4100

EXE (нужны Go 1.21+ и Node.js 18 для упаковки):

```powershell
cd tray
python make_icon.py
# положите в assets: node.exe.gz (gzip от node.exe) и app.zip (server.js, public, node_modules)
go build -ldflags "-H windowsgui -s -w" -o "TeleDrive Local.exe" .
```

## Настройки

`%APPDATA%\TeleDriveLocal\data\.env` (или `data/.env` при запуске из исходников):

```
PORT=4100
SOCKS_IP=127.0.0.1
SOCKS_PORT=10808
DAV_USER=teledrive
DAV_PASS=teledrive
MOUNT_MODE=webdav
```

## Windows и WebDAV

Для штатного WebDAV-клиента один раз нужны (от администратора):

```
HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters
  BasicAuthLevel       = 2
  FileSizeLimitInBytes = 4294967295
```

## Ограничения

- Telegram: 2 ГБ на файл, 4 ГБ с Premium; клиент Windows не передаёт файлы больше 4 ГБ.
- «Избранное» не поддерживает папки — они виртуальные и хранятся в `data/tree.json`.
- `data/session.txt` даёт полный доступ к аккаунту: не публикуйте его.

## Благодарности

Идея и API-подход вдохновлены проектом [mgilangjanuar/teledrive](https://github.com/mgilangjanuar/teledrive) (MIT). Код этого репозитория написан заново.

## Лицензия

MIT, см. [LICENSE](LICENSE).
