#!/bin/sh
# Build apps/web as a static export and publish it to the `gh-pages` branch
# (GitHub Pages: Settings → Pages → Source: "Deploy from a branch" → gh-pages).
#
# The site lives at the project-page path /soulvault/ (see next.config.ts
# basePath), so the branch root must contain the export output directly.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT/apps/web"

pnpm build:export

OUT="$REPO_ROOT/apps/web/out"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

REMOTE="$(git -C "$REPO_ROOT" remote get-url origin)"

# Rebuild the branch from scratch each time: exactly one commit, the artifact.
cd "$WORK"
git init -q -b gh-pages
git config user.name "soulvault-pages"
git config user.email "pages@soulvault.local"
cp -R "$OUT"/* .
git add -A
git commit -qm "web: publish static export ($(date -u '+%Y-%m-%d %H:%M %Z'))"
git remote add origin "$REMOTE"
git push -q --force origin gh-pages

echo "Published to gh-pages. Pages serves it at /soulvault/ once"
echo "Settings → Pages → Source is 'Deploy from a branch' (gh-pages, / (root))."
