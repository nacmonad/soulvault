#!/usr/bin/env bash
# Pull the Ledger Ethereum app ELF out of the speculos docker image.
#
# Usage:
#   ./fetch-app.sh              # defaults: model=nanox, app=ethereum
#   MODEL=nanosp ./fetch-app.sh
#
# The speculos image ships a set of reference app ELFs under /speculos/apps/.
# This is the fastest way to get a working binary for local testing — for
# production-matching tests, replace with the ELF from the app's GitHub
# release artifacts.

set -euo pipefail

MODEL="${MODEL:-nanox}"
APP="${APP:-ethereum}"
IMAGE="${IMAGE:-ghcr.io/ledgerhq/speculos:latest}"

cd "$(dirname "$0")"
mkdir -p apps

# Try a few known paths inside the image — layout has shifted across versions.
CANDIDATES=(
  "/speculos/apps/${APP}_${MODEL}.elf"
  "/speculos/apps/${MODEL}-${APP}.elf"
  "/speculos/apps/${APP}.elf"
)

CID="$(docker create "$IMAGE")"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

found=""
for src in "${CANDIDATES[@]}"; do
  if docker cp "$CID:$src" "apps/${MODEL}-${APP}.elf" 2>/dev/null; then
    found="$src"
    break
  fi
done

if [[ -z "$found" ]]; then
  echo "Could not locate ${APP} ELF for model ${MODEL} inside ${IMAGE}."
  echo "Tried: ${CANDIDATES[*]}"
  echo "Inspect the image layout with:"
  echo "  docker run --rm ${IMAGE} ls /speculos/apps/"
  exit 1
fi

echo "Extracted ${found} -> apps/${MODEL}-${APP}.elf"
ls -lh "apps/${MODEL}-${APP}.elf"
