# Story 02 — Create a local agent profile and register on-chain identity

This story walks through agent bootstrapping: creating a local profile and then minting a public ERC-8004 identity on Sepolia.

Goal:
- create a local agent profile with wallet, public key, and harness config
- preview the agentURI payload before committing on-chain
- register the agent identity on the ERC-8004 registry (Sepolia)
- read back the on-chain identity to confirm

Prerequisite: **Story 00** (organization, swarm, and membership must exist).

This story proves the **public identity layer** — any external system can resolve an agent's capabilities, swarm membership, and service endpoints from a single on-chain URI.

---

## 1) Create the local agent profile
```bash
soulvault agent create --name RustyBot --harness openclaw
```

Behavior:
- derives the agent wallet address and public key from the active signer
- writes the profile to `~/.soulvault/agent.json`
- stores harness/runtime metadata and the resolved backup command

If a profile already exists, the command returns the existing one without overwriting.

On a **Ledger**, this step requires the device to be unlocked with the Ethereum app open (it calls `getAddress` to derive the agent wallet).

---

## 2) Check the local agent profile
```bash
soulvault agent status
```

Expected output includes:
- `name`, `address`, `publicKey`
- `harness`, `backupCommand`
- `identity` will be empty/missing until step 4

---

## 3) Preview the agentURI payload
```bash
soulvault agent render-agenturi --swarm ops
```

This renders the full `agentURI` JSON payload **without** submitting anything on-chain. Useful to inspect before committing.

The payload includes:
- `type: "SoulVaultAgent"`
- `name`, `description`, `services`
- `soulvault.swarmContract` — the 0G Galileo contract address from the swarm profile
- `soulvault.memberAddress` — the agent's wallet
- `soulvault.harness` — runtime type

The URI is a `data:application/json;base64,...` string that gets stored on-chain.

---

## 4) Register the agent identity on-chain (Sepolia)
```bash
soulvault agent register --swarm ops --name RustyBot
```

Behavior:
- calls `registerAgent(agentWallet, agentURI)` on the ERC-8004 adapter contract on **Sepolia**
- the adapter mints an agent identity and emits `AgentRegistered(agentId, agentWallet, agentURI)`
- writes `identity.agentId`, `identity.txHash`, and `identity.lastAgentURI` back to `~/.soulvault/agent.json`

On a **Ledger**, expect a signing prompt for the Sepolia transaction.

### After success

The CLI prints JSON including:
- `registry` — the ERC-8004 adapter address
- `agentId` — the minted identity token ID
- `txHash` — Sepolia transaction hash (look it up on a Sepolia explorer)
- `payload` — the decoded agentURI content

---

## 5) Read back the on-chain identity
```bash
soulvault agent show
```

Reads both the local profile and on-chain state:
- `agentId`, `registry`
- `onchainWallet` — the wallet stored on-chain (should match your signer)
- `onchainURI` — the full agentURI as stored on-chain
- `localProfile` — the local `~/.soulvault/agent.json` snapshot

---

## 6) (Optional) Update the agent identity
```bash
soulvault agent update --agent-id <id> --name RustyBot-v2 --swarm ops
```

Calls `updateAgentURI(agentId, newAgentURI)` on-chain. Use this after changing services, swarm membership, or capabilities.

---

## Notes
- `agent create` is **local only** — no on-chain transaction until `agent register`.
- `agent register` hits **Sepolia** (the identity/ENS lane), not 0G Galileo.
- The `--swarm` flag resolves the active swarm's contract address to embed in the agentURI. If you already ran `soulvault swarm use ops`, it's picked up automatically.
- The same wallet can register multiple agent identities (different `agentId` tokens).
- `agent create` also calls `describeSigner()`, so the same Ledger-readiness requirements from Story 00 apply.
