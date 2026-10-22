#!/usr/bin/env bash
# Собирает AppImage из готового бинарника (запускать после build.sh на Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
APPDIR="$DIST/AppDir"
OUT="$DIST/TGDrive-Easy-x86_64.AppImage"

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons/hicolor/256x256/apps"
cp "$DIST/tgdrive-easy" "$APPDIR/usr/bin/tgdrive-easy"
cp "$ROOT/assets/icon.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/tgdrive-easy.png"
cp "$ROOT/assets/icon.png" "$APPDIR/tgdrive-easy.png"

cat > "$APPDIR/tgdrive-easy.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=TGDrive-Easy
Comment=Telegram Saved Messages as a drive
Exec=tgdrive-easy
Icon=tgdrive-easy
Terminal=false
Categories=Utility;
DESK

cat > "$APPDIR/AppRun" <<'RUN'
#!/bin/sh
HERE=$(dirname "$(readlink -f "$0")")
exec "$HERE/usr/bin/tgdrive-easy" "$@"
RUN
chmod +x "$APPDIR/AppRun"

TOOL="$DIST/appimagetool"
if [ ! -x "$TOOL" ]; then
  curl -fsSL -o "$TOOL" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
  chmod +x "$TOOL"
fi

ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" "$APPDIR" "$OUT"
echo "appimage: $OUT"
ls -lh "$OUT"
