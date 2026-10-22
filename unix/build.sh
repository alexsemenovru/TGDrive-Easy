#!/usr/bin/env bash
# Сборка Unix-версии TGDrive-Easy (Linux/macOS): готовит assets и бинарник.
# Требуется: bash, curl, python3, go 1.21+, npm, gcc/pkg-config + GTK/AppIndicator (Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
APP_SRC="$REPO/app"
ASSETS="$ROOT/assets"
DIST="$ROOT/dist"
NODE_VERSION="${NODE_VERSION:-18.16.0}"

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) NARCH=x64 ;;
  aarch64|arm64) NARCH=arm64 ;;
  *) echo "unsupported arch: $ARCH"; exit 1 ;;
esac
case "$OS" in
  linux) NOS=linux ;;
  darwin) NOS=darwin ;;
  *) echo "unsupported OS: $OS"; exit 1 ;;
esac

mkdir -p "$ASSETS" "$DIST"

echo "1/4 node v$NODE_VERSION ($NOS-$NARCH)"
TMP="$(mktemp -d)"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$NOS-$NARCH.tar.gz" -o "$TMP/node.tar.gz"
tar -xzf "$TMP/node.tar.gz" -C "$TMP" --strip-components=1 "node-v$NODE_VERSION-$NOS-$NARCH/bin/node"
tar -czf "$ASSETS/node.tar.gz" -C "$TMP" bin/node
rm -rf "$TMP"

echo "2/4 app.zip"
if [ ! -d "$APP_SRC/node_modules" ]; then
  (cd "$APP_SRC" && npm install --omit=dev --no-audit --no-fund)
fi
python3 - "$APP_SRC" "$ASSETS/app.zip" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
files = ["server.js", "dav.js", "store.js", "package.json"]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(src, f), f)
    for base in ("public", "platform", "node_modules"):
        for root, _, names in os.walk(os.path.join(src, base)):
            for n in names:
                p = os.path.join(root, n)
                z.write(p, os.path.relpath(p, src))
PY

echo "3/4 icon"
if [ ! -f "$ASSETS/icon.png" ]; then
  echo "assets/icon.png is required"; exit 1
fi

echo "4/4 go build"
cd "$ROOT"
CGO_ENABLED=1 go build -trimpath -ldflags "-s -w" -o "$DIST/tgdrive-easy" .

cat > "$DIST/tgdrive-easy.sh" <<'SH'
#!/usr/bin/env bash
# Запускает TGDrive-Easy и переиспользует уже запущенный экземпляр.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/tgdrive-easy" "$@"
SH
chmod +x "$DIST/tgdrive-easy.sh"

cat > "$DIST/tgdrive-easy.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=TGDrive-Easy
Comment=Telegram Saved Messages as a drive
Exec=$DIST/tgdrive-easy
Icon=$ASSETS/icon.png
Terminal=false
Categories=Utility;
DESK

echo "built: $DIST/tgdrive-easy"
