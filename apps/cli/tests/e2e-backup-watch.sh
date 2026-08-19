#!/usr/bin/env bash
set -euo pipefail

SWARM_NAME="${1:-ops}"
REASON="${REASON:-e2e backup watch test}"
RECENT_BLOCKS="${RECENT_BLOCKS:-80}"
LAST_BACKUP_JSON="${HOME}/.soulvault/last-backup.json"
ARTIFACT_PATH="/tmp/soulvault-openclaw-backup.tar.gz"
ENCRYPTED_PATH="${ARTIFACT_PATH}.enc"

log() {
  printf '\n== %s ==\n' "$1"
}

fail() {
  printf '\n[FAIL] %s\n' "$1" >&2
  exit 1
}

require_file() {
  local file="$1"
  [[ -f "$file" ]] || fail "missing file: $file"
}

json_get() {
  local file="$1"
  local expr="$2"
  node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const path=process.argv[2].split('.'); let cur=data; for (const p of path) { if (!p) continue; cur=cur?.[p]; } if (cur === undefined || cur === null) process.exit(2); if (typeof cur === 'object') console.log(JSON.stringify(cur)); else console.log(String(cur));" "$file" "$expr"
}

CLI=(npm run dev --)

cd "$(dirname "$0")/.."

log "Phase 1: preflight"
if ! command -v openclaw >/dev/null 2>&1; then
  fail "openclaw CLI not found in PATH"
fi

CURRENT_BLOCK=$(cast block-number --rpc-url https://evmrpc-testnet.0g.ai)
FROM_BLOCK=$(( CURRENT_BLOCK > RECENT_BLOCKS ? CURRENT_BLOCK - RECENT_BLOCKS : 0 ))
echo "Swarm: $SWARM_NAME"
echo "Current 0G block: $CURRENT_BLOCK"
echo "Event scan starts at: $FROM_BLOCK"

log "Phase 2: trigger backup request"
"${CLI[@]}" swarm backup-request --swarm "$SWARM_NAME" --reason "$REASON"

log "Phase 3: inspect recent events baseline"
"${CLI[@]}" swarm events list --swarm "$SWARM_NAME" --from-block "$FROM_BLOCK" | tee /tmp/soulvault-events-before.json

log "Phase 4: run watcher response once"
rm -f "$ARTIFACT_PATH" "$ENCRYPTED_PATH"
"${CLI[@]}" swarm events watch --swarm "$SWARM_NAME" --once --respond-backup | tee /tmp/soulvault-watch-response.log || true

log "Phase 5: verify backup artifact exists"
require_file "$ARTIFACT_PATH"
ls -lh "$ARTIFACT_PATH"
file "$ARTIFACT_PATH" || true

log "Phase 6: verify encrypted artifact + local record"
require_file "$ENCRYPTED_PATH"
require_file "$LAST_BACKUP_JSON"
ls -lh "$ENCRYPTED_PATH"
file "$ENCRYPTED_PATH" || true

echo "last-backup.json:"
cat "$LAST_BACKUP_JSON"

log "Phase 6.5: verify 0G upload result"
ROOT_HASH=$(json_get "$LAST_BACKUP_JSON" rootHash) || fail "last-backup.json missing rootHash"
TX_HASH=$(json_get "$LAST_BACKUP_JSON" txHash) || fail "last-backup.json missing txHash"
EPOCH=$(json_get "$LAST_BACKUP_JSON" epoch) || fail "last-backup.json missing epoch"
MEMBER=$(json_get "$HOME/.soulvault/agent.json" address) || fail "agent.json missing address"

echo "rootHash=$ROOT_HASH"
echo "txHash=$TX_HASH"
echo "epoch=$EPOCH"
echo "member=$MEMBER"

log "Phase 7: verify onchain mapping event"
EVENTS_JSON=$("${CLI[@]}" swarm events list --swarm "$SWARM_NAME" --from-block "$FROM_BLOCK")
echo "$EVENTS_JSON" | tee /tmp/soulvault-events-after.json

HAS_MAPPING=$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const wantMember=(process.argv[1]||'').toLowerCase(); const wantRoot=process.argv[2]||''; const wantEpoch=String(process.argv[3]||''); const ok=(data.events||[]).some(e => e.type==='MemberFileMappingUpdated' && String(e.member||'').toLowerCase()===wantMember && String(e.storageLocator||'')===wantRoot && String(e.epoch||'')===wantEpoch); console.log(ok ? 'yes' : 'no');" "$MEMBER" "$ROOT_HASH" "$EPOCH" <<< "$EVENTS_JSON")

if [[ "$HAS_MAPPING" != "yes" ]]; then
  fail "no matching MemberFileMappingUpdated event found for member=$MEMBER rootHash=$ROOT_HASH epoch=$EPOCH"
fi

log "Success"
echo "Backup watcher/respond flow completed with onchain mapping publication."
