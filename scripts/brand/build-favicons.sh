#!/usr/bin/env bash
# Rasterises the EXISTING VarLens logo (src/renderer/public/favicon.svg) into
# the modern minimal favicon / app-icon set. This only resizes + reformats the
# logo — the artwork is never altered. Source of truth stays favicon.svg.
#
# Set (per evilmartians "How to Favicon"): favicon.ico, apple-touch-icon.png,
# icon-192/512.png, a maskable icon, and manifest.webmanifest. The SVG favicon
# is the logo itself (favicon.svg), already linked.
#
# Requires: rsvg-convert (librsvg), ImageMagick (magick), icotool (icoutils).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/src/renderer/public"
LOGO="$OUT/favicon.svg"           # the real logo, unchanged
BG="#FFFFFF"                      # opaque tile for iOS/maskable (logo has dark ink)

command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (librsvg)"; exit 1; }
command -v magick       >/dev/null || { echo "need ImageMagick (magick)"; exit 1; }
command -v icotool      >/dev/null || { echo "need icotool (icoutils)"; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
r() { rsvg-convert -w "$2" -h "$2" "$LOGO" -o "$3"; }   # render logo at NxN

# favicon.ico — 16/32/48, transparent.
for s in 16 32 48; do r "$LOGO" "$s" "$tmp/f-$s.png"; done
icotool -c -o "$OUT/favicon.ico" "$tmp/f-16.png" "$tmp/f-32.png" "$tmp/f-48.png"

# PWA "any" icons — transparent.
r "$LOGO" 192 "$OUT/icon-192.png"
r "$LOGO" 512 "$OUT/icon-512.png"

# apple-touch — 180, opaque white tile, ~16px padding (content 148).
r "$LOGO" 148 "$tmp/at.png"
magick -size 180x180 "xc:$BG" \( "$tmp/at.png" \) -gravity center -composite "$OUT/apple-touch-icon.png"

# Maskable — 512, opaque tile, content within the 80% safe zone (~384).
r "$LOGO" 384 "$tmp/mask.png"
magick -size 512x512 "xc:$BG" \( "$tmp/mask.png" \) -gravity center -composite "$OUT/icon-maskable-512.png"

echo "Wrote favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, icon-maskable-512.png"
ls -la "$OUT"/favicon.ico "$OUT"/apple-touch-icon.png "$OUT"/icon-*.png
