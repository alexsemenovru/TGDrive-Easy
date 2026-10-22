#!/usr/bin/env bash
# Собирает TGDrive-Easy.app из готового бинарника (запускать после build.sh на macOS).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"
APP="$DIST/TGDrive-Easy.app"
ICONSET="$DIST/icon.iconset"

rm -rf "$APP" "$ICONSET"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ICONSET"
cp "$DIST/tgdrive-easy" "$APP/Contents/MacOS/tgdrive-easy"
chmod +x "$APP/Contents/MacOS/tgdrive-easy"

for s in 16 32 64 128 256 512; do
  sips -z "$s" "$s" "$ROOT/assets/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$ROOT/assets/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>TGDrive-Easy</string>
  <key>CFBundleDisplayName</key><string>TGDrive-Easy</string>
  <key>CFBundleIdentifier</key><string>com.tgdrive.easy</string>
  <key>CFBundleVersion</key><string>1.2.0</string>
  <key>CFBundleShortVersionString</key><string>1.2.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>tgdrive-easy</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# ad-hoc подпись: без неё macOS ругается сильнее, но и с ней нужен «Открыть» из контекстного меню
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

ditto -c -k --sequesterRsrc --keepParent "$APP" "$DIST/TGDrive-Easy-macos.zip"
echo "app bundle: $APP"
ls -lh "$DIST/TGDrive-Easy-macos.zip"
