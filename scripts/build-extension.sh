#!/usr/bin/env bash
# Bundle the extension folder into dist/riff-extension.zip at the repo root.
#
# IMPORTANT: this no longer writes to backend/public/. The zip is for
# uploading to the Chrome Web Store dev console (https://chrome.google.com/webstore/devconsole/) — it must NEVER be served from a public URL,
# because anyone with the link can grab the source and clone the product.
#
# Usage:
#   bash scripts/build-extension.sh        → builds dist/riff-extension.zip
#
# Then go to the Chrome Web Store dev console, click your item → Package →
# Upload new package, and choose dist/riff-extension.zip.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

EXT_DIR="$REPO_ROOT/extension"
DIST_DIR="$REPO_ROOT/dist"
OUT_FILE="$DIST_DIR/riff-extension.zip"

if [[ ! -d "$EXT_DIR" ]]; then
  echo "Extension folder not found: $EXT_DIR" >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
rm -f "$OUT_FILE"

# Only ship runtime files (skip README and any dev artifacts).
# If you add icons/ later, include them here.
cd "$EXT_DIR"
zip -r "$OUT_FILE" \
  manifest.json \
  background.js \
  content.js \
  dashboard-bridge.js \
  popup.html \
  popup.css \
  popup.js

echo ""
echo "Built: $OUT_FILE"
ls -la "$OUT_FILE"
echo ""
echo "Next step: upload this zip at https://chrome.google.com/webstore/devconsole/"
echo "(Do NOT put it in backend/public/ — that would serve it at a public URL.)"
