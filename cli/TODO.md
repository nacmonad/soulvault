# SoulVault CLI TODO

## A) Agent identity create flow (ERC-8004 / OpenClaw agent)
- [ ] Implement the real `soulvault identity create-agent` onchain transaction flow against the configured ERC-8004 registry.
- [ ] Accept and validate required registry inputs from config/flags:
  - [ ] `SOULVAULT_ERC8004_REGISTRY_ADDRESS`
  - [ ] optional swarm contract address
  - [ ] agent name / description / image
  - [ ] repeatable service entries
- [ ] Build the agent registration payload with SoulVault/OpenClaw metadata:
  - [ ] `memberAddress`
  - [ ] `harness=openclaw`
  - [ ] `backupHarnessCommand=soulvault-harness-openclaw backup`
  - [ ] optional swarm contract pointer
  - [ ] portable base64 `agentURI`
- [ ] Persist the created identity details locally in `~/.soulvault/agent.json` and/or `~/.soulvault/config.json`.
- [ ] Add `identity show` / update-path improvements so the local agent can inspect and refresh its onchain identity.
- [ ] Verify the created agent clearly identifies itself as an OpenClaw-backed agent.

## B) Backup publish flow (archive, encrypt, upload)
- [ ] Keep the local agent backup flow working end-to-end:
  - [ ] gather workspace content via trusted harness adapter command
  - [ ] produce deterministic tar/tar.gz bundle
  - [ ] encrypt with shared test `K_epoch`
  - [ ] emit manifest with hashes and metadata
- [ ] Replace the current test-only encryption scaffold with the intended production crypto path (libsodium / XChaCha20-Poly1305) once the module/runtime issue is resolved.
- [ ] Wire `backup push` to actual 0G upload using the TS SDK pattern:
  - [ ] signer from local hot wallet
  - [ ] Galileo RPC
  - [ ] 0G storage indexer
  - [ ] capture returned root hash / tx hash
- [ ] Define the publication record shape SoulVault should retain after upload:
  - [ ] storage locator/root hash
  - [ ] publish tx hash
  - [ ] manifest hash
  - [ ] merkle/archive hash
  - [ ] epoch indicator (`TEST_K_EPOCH` for now)
- [ ] Prepare for later swarm contract publication of member file mappings.

## C) Download, decrypt, and verify restore contents
- [ ] Add a fetch path that can retrieve the uploaded encrypted artifact from 0G using the stored locator/root hash.
- [ ] Decrypt the fetched artifact using the same shared test `K_epoch`.
- [ ] Unpack or inspect the restored archive locally.
- [ ] Compare restored contents against the current OpenClaw setup.
- [ ] For now, skip writing a destructive full restore over the live workspace.
- [ ] Instead, verify that the restored contents match expected OpenClaw files such as:
  - [ ] `SOUL.md`
  - [ ] `USER.md`
  - [ ] `AGENTS.md`
  - [ ] relevant `memory/` files
  - [ ] other selected workspace files included by the backup adapter
- [ ] Output a verification summary showing whether the backup/restore roundtrip preserved contents exactly.

## Notes
- Current funded agent address: `0x33764cD26F5884BFf194D38ED00DBB249C130B10`
- Current runtime identity: `RustyBot` / `openclaw`
- Current shared test key path: `SOULVAULT_TEST_K_EPOCH`
- Do not overwrite the live OpenClaw workspace during overnight verification work; use temp/output directories and compare hashes/contents first.
