#!/usr/bin/env bash
# Renders the brand SVGs to the PNG sizes the app and the store need.
#
# Chrome does the rasterising: it is already installed, it renders exactly what
# a browser renders, and it needs no extra packages. Every size is produced
# from the same source file, so the mark can never drift between places.
set -euo pipefail

CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
BRAND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$BRAND/out"
mkdir -p "$OUT"

shot() {
  local source="$1" size="$2" target="$3" background="${4:-}"
  local wrapper="$OUT/.wrap.html"
  cat > "$wrapper" <<HTML
<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${background:-transparent};}
  img{width:${size}px;height:${size}px;display:block;}
</style>
<img src="$(basename "$source")">
HTML
  cp "$source" "$OUT/$(basename "$source")"
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --screenshot="$(cygpath -w "$OUT/$target")" \
    --window-size="$size,$size" \
    "$(cygpath -w "$wrapper")" >/dev/null 2>&1
  echo "  $target  ${size}x${size}"
}

echo "app icons"
shot "$BRAND/icon.svg" 1024 "icon.png"
shot "$BRAND/adaptive-foreground.svg" 1024 "adaptive-icon.png"
shot "$BRAND/icon.svg" 512 "icon-512.png"
shot "$BRAND/icon.svg" 256 "mark-256.png"
shot "$BRAND/icon.svg" 192 "splash-icon.png"
shot "$BRAND/icon.svg" 64 "favicon-64.png"

rm -f "$OUT/.wrap.html" "$OUT/icon.svg" "$OUT/adaptive-foreground.svg"
echo "done -> $OUT"
