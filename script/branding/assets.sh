#!/usr/bin/env bash
# Generate MindScript Studio icons and favicons from the brand mark.
# macOS only: QuickLook (qlmanage) rasterizes the Inkscape SVG faithfully (ImageMagick's
# built-in SVG renderer drops the gradients), ImageMagick resizes, iconutil builds the .icns.
#   script/branding/assets.sh [mark.svg] [logo-full.svg]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_MARK="${1:-$HOME/Desktop/AI_Testing/ai-gateway/public/brand/mark.svg}"
SRC_FULL="${2:-$HOME/Desktop/AI_Testing/ai-gateway/public/brand/logo-full.svg}"
B="$ROOT/branding"
mkdir -p "$B"
command -v magick >/dev/null || { echo "ImageMagick (magick) is required" >&2; exit 1; }

# 1. A square, cropped mark SVG: the source is an A4 page with the art placed at
#    x=126.65 y=120 w=321.69 h=224.56 (page units).
node -e '
const fs = require("fs");
let s = fs.readFileSync(process.argv[1], "utf8");
const x = 126.65, y = 120, w = 321.69, h = 224.56;
const side = Math.max(w, h) * 1.08, cx = x + w / 2, cy = y + h / 2;
const vb = `${(cx - side / 2).toFixed(2)} ${(cy - side / 2).toFixed(2)} ${side.toFixed(2)} ${side.toFixed(2)}`;
const out = s.replace(/width="210mm"\s+height="297mm"\s+viewBox="0 0 210 297"/, `viewBox="${vb}"`);
if (out === s) { console.error("could not find the page-size attributes in the mark SVG"); process.exit(1); }
fs.writeFileSync(process.argv[2], out);
' "$SRC_MARK" "$B/mark.svg"

# 2. Rasterize with QuickLook, then trim/square with ImageMagick.
rm -rf "$B/ql" && mkdir -p "$B/ql"
qlmanage -t -s 2048 -o "$B/ql" "$B/mark.svg" >/dev/null 2>&1 || true
[ -f "$B/ql/mark.svg.png" ] || { echo "qlmanage did not render the mark" >&2; exit 1; }
magick "$B/ql/mark.svg.png" -background none -trim +repage -gravity center -background none -extent '%[fx:max(w,h)]x%[fx:max(w,h)]' -resize 1024x1024 "$B/mark-1024.png"
# App icons get a little breathing room (macOS icon grid), favicons use the tight mark.
magick "$B/mark-1024.png" -background none -gravity center -extent 1180x1180 -resize 1024x1024 "$B/icon-1024.png"

# 3. Desktop icon sets (all three channels look the same for now).
for ch in dev beta prod; do
  D="$ROOT/packages/desktop/icons/$ch"
  mkdir -p "$D"
  for s in 32 64 128; do magick "$B/icon-1024.png" -resize ${s}x${s} "$D/${s}x${s}.png"; done
  magick "$B/icon-1024.png" -resize 256x256 "$D/128x128@2x.png"
  for s in 30 44 71 89 107 142 150 284 310; do magick "$B/icon-1024.png" -resize ${s}x${s} "$D/Square${s}x${s}Logo.png"; done
  magick "$B/icon-1024.png" -resize 50x50 "$D/StoreLogo.png"
  cp "$B/icon-1024.png" "$D/icon.png"
  magick "$B/icon-1024.png" -resize 512x512 "$D/dock.png"
  IS="$B/icon.iconset"; rm -rf "$IS"; mkdir -p "$IS"
  for s in 16 32 128 256 512; do
    magick "$B/icon-1024.png" -resize ${s}x${s} "$IS/icon_${s}x${s}.png"
    magick "$B/icon-1024.png" -resize $((s * 2))x$((s * 2)) "$IS/icon_${s}x${s}@2x.png"
  done
  iconutil -c icns "$IS" -o "$D/icon.icns"
  magick "$B/icon-1024.png" -define icon:auto-resize=256,128,64,48,32,16 "$D/icon.ico"
done

# 4. Web app favicons (both the -v3 names the app references and the plain ones).
A="$ROOT/packages/app/public"
cp "$B/mark.svg" "$A/favicon-v3.svg"; cp "$B/mark.svg" "$A/favicon.svg"
magick "$B/mark-1024.png" -resize 96x96 "$A/favicon-96x96-v3.png"; cp "$A/favicon-96x96-v3.png" "$A/favicon-96x96.png"
magick "$B/mark-1024.png" -resize 180x180 "$A/apple-touch-icon-v3.png"; cp "$A/apple-touch-icon-v3.png" "$A/apple-touch-icon.png"
magick "$B/mark-1024.png" -resize 192x192 "$A/web-app-manifest-192x192.png"
magick "$B/mark-1024.png" -resize 512x512 "$A/web-app-manifest-512x512.png"
magick "$B/mark-1024.png" -define icon:auto-resize=64,48,32,16 "$A/favicon-v3.ico"; cp "$A/favicon-v3.ico" "$A/favicon.ico"
# Social card: full logo on a dark ground.
rm -rf "$B/ql2" && mkdir -p "$B/ql2"
qlmanage -t -s 2048 -o "$B/ql2" "$SRC_FULL" >/dev/null 2>&1 || true
FULL="$B/ql2/$(basename "$SRC_FULL").png"
if [ -f "$FULL" ]; then
  magick "$FULL" -background none -trim +repage -resize 900x420 "$B/logo-full.png"
  magick -size 1200x630 xc:'#0b0b12' "$B/logo-full.png" -gravity center -composite "$A/social-share.png"
fi
node -e '
const fs=require("fs"),p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));
m.name="MindScript Studio";m.short_name="MindScript";fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");
' "$A/site.webmanifest" 2>/dev/null || true
echo "assets written: $B/mark-1024.png, desktop icons (dev/beta/prod), app favicons"
