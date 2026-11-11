#!/usr/bin/env bash
# Generate mockup art with nanobanana.
#   Stickers (manifest.txt): nanobanana JPEG -> remove-bg -> trim -> 512px transparent webp
#   Covers   (covers.txt):   nanobanana JPEG -> 320px square webp
# Usage: tools/art/gen.sh [id ...]   (no args = everything missing)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/mockup/art"
TMP="$ROOT/tools/out/art"
STYLE="glossy bubbly 3D-ish cartoon sticker style, thick clean dark navy outline, bright candy colors, single subject, centered, plain flat white background, no shadow, no text"
mkdir -p "$OUT" "$TMP"

gen() {
  local id="$1" prompt="$2" kind="$3" dir="$TMP/$1"
  rm -rf "$dir" && mkdir -p "$dir"
  if [[ $kind == sticker ]]; then
    nanobanana "$prompt, $STYLE" -o "$dir" >/dev/null 2>&1 || { echo "FAIL gen $id"; return; }
    local jpg; jpg=$(ls "$dir"/*.jpg | head -1)
    remove-bg "$jpg" "$dir/cut.png" >/dev/null 2>&1 || { echo "FAIL cut $id"; return; }
    magick "$dir/cut.png" -trim +repage -resize 480x480 -background none -gravity center -extent 512x512 -quality 88 -define webp:alpha-quality=95 "$OUT/$id.webp"
  else
    nanobanana "$prompt" -o "$dir" >/dev/null 2>&1 || { echo "FAIL gen $id"; return; }
    local jpg; jpg=$(ls "$dir"/*.jpg | head -1)
    magick "$jpg" -resize 320x320^ -gravity center -extent 320x320 -quality 82 "$OUT/$id.webp"
  fi
  echo "ok $id"
}

run() {
  local file="$1" kind="$2"; shift 2
  while IFS='|' read -r id prompt; do
    [[ -z "$id" ]] && continue
    if [[ $# -gt 0 ]]; then [[ " $* " == *" $id "* ]] || continue
    elif [[ -f "$OUT/$id.webp" ]]; then continue; fi
    gen "$id" "$prompt" "$kind" &
    if [[ $(jobs -rp | wc -l) -ge 5 ]]; then wait; fi
  done < "$file"
}
run "$ROOT/tools/art/manifest.txt" sticker "$@"
run "$ROOT/tools/art/covers.txt" cover "$@"
wait
