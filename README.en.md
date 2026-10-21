# TGDrive-Easy

[Русский](README.md) | [English](README.en.md)

**TGDrive-Easy** is a local Telegram client that shows **Saved Messages** as a Windows network drive (`Z:`) and as a web interface. A single EXE, no installation.

## What it can do

- Sign in to Telegram with a phone number, code and 2FA password — no need to register `api_id`/`api_hash` (the public web-client credentials are used).
- List files from Saved Messages, download, upload, rename, delete; virtual folders.
- Network drive over WebDAV: the built-in Windows client or `rclone`.
- No-cache mode: transfer errors are visible immediately instead of "a minute later".
- If a background upload fails, a `<name>.upload-failed.txt` note with the reason appears in the same folder.
- Tray icon menu: **Console**, **Drive** (check mark when mounted, click to mount/unmount), **Exit**.
- Mount the drive at startup (configurable) and Mount/Unmount buttons in the web console.
- Start with Windows (autostart), toggled in the web console and off by default.
- Telegram traffic goes through SOCKS5 or MTProto proxy; the proxy is configured in the web console before and after sign-in, and a `tg://proxy` link can be pasted as-is.

## Layout

```
app/    Node.js server: WebDAV, Telegram (GramJS), web interface
tray/   Go launcher: tray icon, menu, embedded Node.js
tests/  API and settings checks
```

## Build

Server:

```powershell
cd app
npm install
node server.js
```

Web interface: http://127.0.0.1:4100

EXE (requires Go 1.21+, Node.js 18 and Python with Pillow):

```powershell
cd tray
.\build.ps1
```

The script installs server dependencies, packs `node.exe` and `app.zip`, renders the icon and builds the EXE. If `rsrc` is missing (`go install github.com/akavel/rsrc@latest`), the EXE gets a default icon.

## Settings

`%APPDATA%\TeleDriveLocal\data\.env` (or `data/.env` when running from source):

```
PORT=4100
SOCKS_IP=127.0.0.1
SOCKS_PORT=10808
DAV_USER=teledrive
DAV_PASS=teledrive
MOUNT_MODE=webdav
```

Auto-mount and proxy parameters are stored in `settings.json` next to it and are changed from the web console (**⚙ Settings**).

## Windows and WebDAV

The built-in WebDAV client needs a one-time registry change (administrator):

```
HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters
  BasicAuthLevel       = 2
  FileSizeLimitInBytes = 4294967295
```

## Limitations

- Telegram: 2 GB per file, 4 GB with Premium; the Windows WebDAV client does not transfer files larger than 4 GB.
- Saved Messages has no folders — folders are virtual and stored in `data/tree.json`.
- `data/session.txt` grants full access to the account: never publish it.
- Public Telegram web-client credentials are used. This is not technically prohibited, but it is a third-party client; for permanent use it is safer to specify your own `api_id`/`api_hash` in `.env`.

## Inspiration and origin

The project is inspired by [mgilangjanuar/teledrive](https://github.com/mgilangjanuar/teledrive), an open-source Telegram Drive client. The code here was written from scratch, but the idea, the API layout and the approach to Saved Messages grew out of getting to know that project.

The project was built entirely with **vibe coding**: a human set the tasks and checked the result, an AI agent wrote the code.

## License

MIT, see [LICENSE](LICENSE).
