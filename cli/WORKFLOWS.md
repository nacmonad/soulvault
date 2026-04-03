# SoulVault CLI Workflows

## 1) First agent bootstrap
1. `soulvault agent create --harness openclaw --backup-command '<cmd>'`
2. `soulvault swarm use <name>`
3. `soulvault join request`
4. owner runs `soulvault join approve <requestId>`
5. owner runs `soulvault epoch rotate`
6. optional: `soulvault identity create-agent ...`
7. `soulvault restore pull`

## 2) Event-driven backup flow (preferred)
1. owner/coordinator runs `soulvault backup request --reason checkpoint --deadline <ts>`
2. listening agents observe `BackupRequested`
3. each agent runs `soulvault backup push`
4. CLI runs harness backup command
5. CLI encrypts and uploads to 0G
6. CLI writes `updateMemberFileMapping(...)` to each joined swarm

## 2.1) Scheduled backup flow (fallback)
Triggered by heartbeat logic or system cron:
1. `soulvault backup push`
2. CLI runs harness backup command
3. CLI encrypts and uploads to 0G
4. CLI writes `updateMemberFileMapping(...)` to each joined swarm

## 3) Recover lost VPS
1. recreate local agent
2. `soulvault join request`
3. owner approves
4. owner runs `soulvault keygrant --member <address> --from-epoch 0`
5. `soulvault restore pull --epoch <n>`

## 4) Update ERC-8004 identity after changes
1. change harness / backup command / services
2. run `soulvault identity update`
3. optionally run `soulvault identity render-agenturi` for inspection before submit

## 5) Multi-swarm backup publication
If the same agent belongs to multiple swarms:
1. `soulvault backup push`
2. one encrypted artifact is produced
3. CLI publishes a file mapping into each joined swarm contract
4. each swarm gets its own `MemberFileMappingUpdated` event trail
