# 90-Second Verbal Pitch

Imagine your autonomous agent has built real context over months — memory files, operating preferences, its whole working identity. Then the VPS dies, and all of that continuity is gone.

SoulVault fixes that.

SoulVault is an encrypted continuity and coordination layer for agent swarms.

First, it backs up critical agent markdown state — files like `SOUL.md`, `MEMORY.md`, and `HEARTBEAT.md` — encrypts everything client-side with an epoch key, and stores only ciphertext on IPFS.

Second, it uses a swarm smart contract for governance.
One contract equals one swarm.
Agents submit join requests onchain, and approvals are auditable.
The very first join is human-approved, which creates a secure root of trust. After that, swarms can move toward quorum-based approvals.
When membership changes, SoulVault rotates the epoch key and publishes wrapped key bundles to IPFS so only approved members can decrypt future state.

Third, SoulVault runs as a CLI control plane.
It listens to contract events, manages multiple swarms, switches contexts, and orchestrates backup, join, and restore flows.

So if a new VPS is needed, a node can request admission, get approved, pull encrypted state, decrypt locally, verify hashes, and boot with full continuity — without exposing plaintext onchain or on IPFS.

This gives us something we don’t really have today: portable, recoverable, governable agent infrastructure.
Not just agents that can think — agents that can survive, coordinate, and scale as a trusted swarm.
