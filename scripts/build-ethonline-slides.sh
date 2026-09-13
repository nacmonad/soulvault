#!/bin/sh
# Build the ETHOnline 2026 Marp deck into the Next static-export tree so
# GitHub Pages serves it next to the app at /soulvault/slides/.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/slides/EthOnline2026"
PUBLIC="$REPO_ROOT/apps/web/public/slides"
OUT="$REPO_ROOT/apps/web/out/slides"

MARP=""
for candidate in \
  "$REPO_ROOT/node_modules/@marp-team/marp-cli/marp-cli.js" \
  "$REPO_ROOT/node_modules/.bin/marp"
do
  if [ -f "$candidate" ]; then
    MARP="$candidate"
    break
  fi
done
if [ -z "$MARP" ]; then
  echo "marp-cli not found — run pnpm install at repo root (@marp-team/marp-cli)." >&2
  exit 1
fi

mkdir -p "$PUBLIC/media"
cp -R "$SRC/media/." "$PUBLIC/media/"

if [ "$(basename "$MARP")" = "marp" ]; then
  "$MARP" "$SRC/DECK.md" --html --allow-local-files --output "$PUBLIC/index.html"
else
  node "$MARP" "$SRC/DECK.md" --html --allow-local-files --output "$PUBLIC/index.html"
fi

# Pages workflow publishes the committed apps/web/out artifact. Keep the
# deck in sync there so a slides-only change does not require a full Next export.
if [ -d "$REPO_ROOT/apps/web/out" ]; then
  mkdir -p "$OUT/media"
  cp -R "$PUBLIC/." "$OUT/"
fi

echo "Wrote $PUBLIC/index.html"
if [ -d "$OUT" ]; then
  echo "Copied to $OUT (gh-pages /soulvault/slides/)"
fi
