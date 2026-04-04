# Story 00 — Bootstrap a SoulVault organization and swarm

This story walks through the first end-to-end bootstrap flow for SoulVault.

Goal:
- create a local organization profile
- register the organization ENS root on Sepolia
- create a swarm under that organization
- deploy the swarm contract on 0G Galileo
- derive and bind the swarm ENS subdomain
- have the agent request to join the swarm
- approve the join request as the admin/owner

This is a foundational story because it proves the split between:
- **public namespace/discovery** on Sepolia (ENS)
- **private operational coordination** on 0G Galileo (SoulVault swarm contract)

---

## 1) Create the organization profile
```bash
soulvault organization create --name soulvault --ens-name soulvault.eth --public
```

Creates the local organization profile under `~/.soulvault/organizations/`.
At this point the ENS name is just the intended root name unless separately registered.

---

## 2) Register the organization ENS root on Sepolia
```bash
soulvault organization register-ens --organization soulvault.eth
```

Behavior:
- checks availability first
- fails loudly if the name is already taken
- commits and registers the `.eth` name on Sepolia
- updates the local organization profile only after confirmed success

---

## 3) Create the swarm under the organization
```bash
soulvault swarm create --organization soulvault.eth --name ops
```

Behavior:
- deploys the SoulVault swarm contract on 0G Galileo
- stores the local swarm profile under `~/.soulvault/swarms/`
- derives the ENS swarm subdomain as `ops.soulvault.eth`
- binds ENS records on Sepolia that point to the live 0G swarm contract

---

## 4) Select the swarm as the active context
```bash
soulvault swarm use ops
```

This makes subsequent swarm commands simpler by defaulting to the `ops` swarm profile.

---

## 5) Agent submits a join request
```bash
soulvault swarm join-request --swarm ops
```

Behavior:
- uses the local agent wallet/public key
- submits the join request to the live 0G swarm contract
- includes the local agent public key and metadata reference

---

## 6) Check the join request status
```bash
soulvault swarm join-status --swarm ops --request-id 1
```

Expected initial result:
- pending / awaiting approval

---

## 7) Admin approves the join request
```bash
soulvault swarm approve-join --swarm ops --request-id 1
```

Behavior:
- approves the request onchain
- activates the member in the swarm contract
- increments membership version

---

## 8) Check join status again
```bash
soulvault swarm join-status --swarm ops --request-id 1
```

Expected result:
- approved

---

## Notes
- In the current test flow, the same hot wallet may be wearing multiple hats:
  - organization owner
  - swarm owner
  - agent runtime
- Later, privileged actions should move behind the **admin signer** model, ideally Ledger-backed.
- Epoch rotation and historical key distribution are intentionally treated as a separate, more advanced stream.
