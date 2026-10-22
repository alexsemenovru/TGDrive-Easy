# TGDrive-Easy

[Русский](README.md) | [English](README.en.md)

**TGDrive-Easy** is a local Telegram client that shows **Saved Messages** as a network drive and as a web interface. It runs on Windows, Linux and macOS.

## Download

All files are in [Releases](https://github.com/alexsemenovru/TGDrive-Easy/releases).

| Platform | File | Status |
|---|---|---|
| Windows | `TGDrive-Easy.exe` | stable **v1.2.5** |
| Linux | `TGDrive-Easy-x86_64-beta.AppImage` | **beta** — not tested on real Linux |
| macOS | `TGDrive-Easy-macos-beta.zip` (contains `.app`) | **beta** — not tested on a real Mac |

The Windows build is a full release. Linux and macOS are marked `beta` only because we have no devices to test them on: the code and builds are ready, but the first run on real hardware may reveal rough edges. If something goes wrong, please send `app.log` and `tray.log`.

## What it does

- Sign in to Telegram with a phone number, code and 2FA password — no need to register `api_id`/`api_hash` (public web-client credentials are used).
- List files from Saved Messages, download, upload, rename, delete; virtual folders.
- Network drive over WebDAV: the built-in Windows client, GVFS on Linux, Finder on macOS, or `rclone`.
- No-cache mode: transfer errors are visible immediately instead of "a minute later".
- If a background upload fails, a `<name>.upload-failed.txt` note with the reason appears in the same folder.
- Tray menu: **Console**, **Drive** (check mark when mounted, click to mount/unmount), **Exit**.
- Mount the drive at startup (configurable) and Mount/Unmount buttons in the web console.
- Start at login (off by default): registry on Windows, `.desktop` on Linux, a LaunchAgent on macOS.
- Telegram traffic goes through SOCKS5 or MTProto proxy; configure it in the web console before and after sign-in, and paste a `tg://proxy` link as-is.

- English and Russian interface: switch the language in Settings; by default it follows the system locale (Russian locale means Russian, otherwise English);

## Windows

1. Download `TGDrive-Easy.exe` and run it — the tray icon appears and drive `Z:` mounts automatically.
2. Right-click the icon → **Console** → sign in to Telegram.

One-time setup (as administrator) for the built-in Windows WebDAV client:

```
HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters
  BasicAuthLevel       = 2
  FileSizeLimitInBytes = 4294967295
```

Data: `%APPDATA%\TGDrive-Easy\data`. Extracted components: `%LOCALAPPDATA%\TGDrive-Easy\runtime`.

## Linux

```bash
chmod +x TGDrive-Easy-x86_64.AppImage
./TGDrive-Easy-x86_64.AppImage
```

- Requires `libayatana-appindicator3` (usually present on Ubuntu; otherwise `sudo apt install libayatana-appindicator3-1`).
- If the AppImage does not start because of FUSE: `./TGDrive-Easy-x86_64.AppImage --appimage-extract-and-run`.
- The drive is mounted through GVFS and shows up in the file manager; if mounting fails, the app keeps running and opens the console.
- Data: `~/.local/share/TGDrive-Easy/data`.

## macOS

1. Unzip `TGDrive-Easy-macos.zip` and move `TGDrive-Easy.app` to Applications.
2. First launch: right-click `TGDrive-Easy.app` → **Open** → **Open**. The build is not signed with an Apple Developer ID; alternatively run `xattr -dr com.apple.quarantine TGDrive-Easy.app`.
3. The icon appears in the **menu bar** (there is no Dock icon — it is a background app). Menu: **Console / Drive / Exit**.
4. The drive is mounted by Finder as volume `dav`.

Data and logs: `~/.local/share/TGDrive-Easy/data` (`app.log`, `tray.log`).

## Settings

`data/.env` (next to the application data):

```
PORT=4100
SOCKS_IP=127.0.0.1
SOCKS_PORT=10808
DAV_USER=teledrive
DAV_PASS=<generated automatically on first run>
MOUNT_MODE=webdav
```

The default WebDAV password is not used: if `DAV_PASS` is empty or equals `teledrive`, the server generates a random password and stores it in `.env` (only a warning is written to the log, never the password itself). That password is required for manual mounting.

Auto-mount, autostart and proxy settings live in `settings.json` next to it and are changed from the web console (**⚙ Settings**).

## Building from source

Server:

```bash
cd app
npm install
node server.js
```

Web interface: http://127.0.0.1:4100

Windows EXE (Go 1.21+, Node.js 18, Python with Pillow):

```powershell
cd tray
.\build.ps1
```

Unix tray launcher (Go 1.21+, Node.js 18; on Linux also GTK3 and libayatana-appindicator3):

```bash
cd unix
./build.sh
```

Packaging: `unix/package-appimage.sh` (Linux) and `unix/package-macos.sh` (macOS). CI builds all three platforms automatically.

## Security

- The Telegram session is encrypted with OS facilities: DPAPI on Windows, Keychain or `secret-tool` on Unix; the old `session.txt` is migrated and deleted.
- The WebDAV password is generated randomly on first run and stored in `.env`; the `teledrive` default is not used.
- Archive extraction is protected against Zip Slip: every path must stay inside the application directory.
- rclone RC requires a username and password; `--rc-no-auth` is not used.
- WebDAV locks (`LOCK`) expire by TTL, so the lock map cannot grow forever.

See [SECURITY.md](SECURITY.md) for details.

## Limitations

- Telegram: 2 GB per file, 4 GB with Premium; the Windows client does not transfer files over 4 GB.
- Saved Messages has no folders — they are virtual and stored in `data/tree.json`.
- Builds are unsigned: SmartScreen on Windows and Gatekeeper on macOS will warn.
- The Telegram session is encrypted at rest: DPAPI on Windows, Keychain or `secret-tool` on Unix. Software running as the same user can still decrypt it.
- Public web-client Telegram credentials are used. This works technically, but formally it is a third-party client; for long-term use it is safer to provide your own `api_id`/`api_hash` in `.env`.

## Inspiration and origin

The project is inspired by [mgilangjanuar/teledrive](https://github.com/mgilangjanuar/teledrive), an open-source Telegram Drive client. The code here was written from scratch, but the idea and the approach to Saved Messages grew out of that project.

The whole project is made with **vibe coding**: a human set the tasks and checked the result, an AI agent wrote the code.

## License

MIT, see [LICENSE](LICENSE).
