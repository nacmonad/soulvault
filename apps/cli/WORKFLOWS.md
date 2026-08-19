# SoulVault CLI Workflows

## 1) First agent bootstrap
1. `soulvault agent create --harness openclaw --backup-command '<cmd>'`
2. `soulvault swarm use <name>`
3. `soulvault join request`
4. owner runs `soulvault join approve <requestId>`
5. owner runs `soulvault epoch rotate`
6. optional: `soulvault agent register ...`
7. optional: bind or record public ENS swarm/agent metadata
8. `soulvault restore pull`

## 1.1) Organization creation with optional ENS root identity
1. `soulvault organization create --name soulvault --ens-name soulvault.eth`
2. create the local organization profile even if ENS registration/binding is not fully wired yet
3. if enabled, bind/register the ENS root name on Sepolia first for dev/test
4. store organization visibility posture and ETH/ENS config

## 1.2) Swarm creation with optional ENS identity
1. `soulvault swarm create --organization soulvault.eth --name ops --owner <address>`
2. optionally derive `ops.soulvault.eth` automatically or accept an explicit `--ens-name`
3. deploy/configure the swarm contract
4. store the ENS name in the local swarm profile if supplied
5. optionally publish public-safe ENS records pointing to the swarm contract and public metadata

## 1.3) Organization owner funds agents
1. organization owner selects active organization context
2. owner runs `soulvault organization fund-agent --to <agent> --amount <value> --chain <0g|eth>`
3. CLI sends native gas funds using the organization owner signer on the requested chain
4. CLI records the funding action locally for visibility/audit

## 1.4) Organization owner funds a swarm
1. owner runs `soulvault organization fund-swarm --swarm ops --amount <value> --chain <0g|eth>`
2. CLI resolves known agent/member wallets for that swarm
3. CLI previews or executes the set of native gas transfers
4. agents are topped up for join, backup, ENS, or identity operations

ENS terminology for workflows:
- organization root: `acme.eth`
- swarm subdomain: `ops.acme.eth`
- optional agent subdomain: `rusty.ops.acme.eth`

Important:
- ENS is optional
- ENS is public naming/discovery only
- SoulVault contract state still governs membership and authorization
- `.env` supplies defaults, while canonical organization/swarm state should live under `~/.soulvault/`

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

## 4) Update agent public identity after changes
1. change harness / backup command / services
2. run `soulvault agent update`
3. optionally run `soulvault agent render-agenturi` for inspection before submit

## 5) Multi-swarm backup publication
If the same agent belongs to multiple swarms:
1. `soulvault backup push`
2. one encrypted artifact is produced
3. CLI publishes a file mapping into each joined swarm contract
4. each swarm gets its own `MemberFileMappingUpdated` event trail
