#!/usr/bin/env bash
# Build the macOS app icon (build/icon.png, 1024x1024) from the mascot sticker.
# Apple grid: 824px rounded tile centred on a 1024 canvas, with a baked drop shadow.
# Usage: tools/art/make-icon.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/tools/art/icon-mascot-src.png"
OUT="$ROOT/build/icon.png"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# tile mask (rounded square, ~22.5% radius like Big Sur icons)
magick -size 1024x1024 xc:none -fill white -draw "roundrectangle 100,100 923,923 185,185" "$T/mask.png"

# background: stage violet with a warm spotlight from the top, plus faint confetti dots
magick -size 1024x1024 radial-gradient:'#7a5cf0'-'#2a1580' -distort SRT '512,330 1.25 0 512,330' "$T/bg.png"
magick -size 1024x1024 xc:none \
  -fill '#ffffff22' -draw "circle 250,260 258,260" -draw "circle 790,230 796,230" -draw "circle 820,700 829,700" \
  -fill '#ffd23f55' -draw "circle 220,640 229,640" -draw "circle 760,840 766,840" \
  -fill '#ff7eb655' -draw "circle 300,820 307,820" -draw "circle 840,450 846,450" "$T/dots.png"
magick "$T/bg.png" "$T/dots.png" -composite "$T/bg2.png"

# soft spotlight ellipse behind the mascot
magick -size 1024x1024 xc:none -fill '#ffffff30' -draw "ellipse 512,560 300,260 0,360" -blur 0x60 "$T/spot.png"

# mascot: trim, scale to ~700px, sit slightly low in the tile
# drop the sticker's white border: flood-fill near-white from the outside (enclosed highlights stay),
# then shave the light fringe left on the outline
magick "$SRC" -background white -alpha remove -alpha set -bordercolor white -border 4 \
  -fuzz 22% -fill none -draw "color 0,0 floodfill" -shave 4x4 \
  -channel A -morphology Erode Disk:1.5 -blur 0x0.8 +channel \
  -trim +repage -resize 650x650 "$T/mascot.png"
magick "$T/mascot.png" -background '#12083f' -shadow 45x14+0+16 +repage "$T/mshadow.png"

magick "$T/bg2.png" "$T/spot.png" -composite \
  \( "$T/mshadow.png" \) -gravity center -geometry +0+40 -composite \
  \( "$T/mascot.png" \) -gravity center -geometry +0+28 -composite \
  "$T/mask.png" -alpha off -compose CopyOpacity -composite "$T/tile.png"

# inner rim highlight + outer drop shadow
magick -size 1024x1024 xc:none -fill none -stroke '#ffffff40' -strokewidth 4 -draw "roundrectangle 102,102 921,921 183,183" "$T/rim.png"
magick "$T/tile.png" "$T/rim.png" -compose over -composite "$T/tile2.png"
magick "$T/tile2.png" \( +clone -background black -shadow 35x14+0+12 \) +swap -background none -layers merge +repage \
  -gravity center -crop 1024x1024+0+0 +repage -extent 1024x1024 -depth 8 -strip "$OUT"
echo "wrote $OUT"
