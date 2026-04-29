#!/usr/bin/env bash
# Bundle the extension folder into riff-extension.zip and place it at
# backend/public/riff-extension.zip so Vercel serves it as a downloadable
# at https://riff-sandy.vercel.app/riff-extension.zip.
#
# Run this any time you change anything in extension/ before pushing.
#
# Usage: bash scripts/build-extension.sh

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

EXT_DIR="$REPO_ROOT/extension"
OUT_FILE="$REPO_ROOT/backend/public/riff-extension.zip"

if [[ ! -d "$EXT_DIR" ]]; then
  echo "Extension folder not found: $EXT_DIR" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/backend/public"
rm -f "$OUT_FILE"

# Only ship runtime files (skip README and any dev artifacts).
# If you add icons/ later, include them here.
cd "$EXT_DIR"
zip -r "$OUT_FILE" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.css \
  popup.js

echo ""
echo "Built: $OUT_FILE"
ls -la "$OUT_FILE"
