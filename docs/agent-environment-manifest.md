# Agent Environment Manifest (Roadmap Primitive)

## Purpose
Describe each agent’s execution capabilities so future task delegation can route work intelligently.

This is introduced now as schema/design, but not required for MVP enforcement.

---

## 1) What it enables later
- Capability-aware task routing (CPU/GPU/RAM fit)
- Capacity-aware scheduling and quotas
- Better reliability for long-running jobs
- Fairer Proof-of-Useful-Work comparisons

---

## 2) Trust Model

## Phase 1 (MVP+): Self-reported
- Agent publishes signed manifest
- Good for discovery; not strong trust

## Phase 2: Benchmark-validated
- Swarm runs challenge/benchmark tasks
- Compare claimed capabilities vs observed metrics

## Phase 3: Hardware-attested (optional)
- TEE/hardware attestation proofs where available
- Highest trust, highest complexity

---

## 3) Suggested Manifest Fields (v0)

```json
{
  "manifestVersion": "0.1",
  "swarmId": "base-sepolia:0xSwarmContract",
  "agentAddress": "0xAgent",
  "timestamp": "2026-03-21T14:00:00Z",
  "resources": {
    "cpu": { "physicalCores": 8, "threads": 16, "arch": "x86_64" },
    "memory": { "ramGb": 32 },
    "gpu": [
      { "vendor": "NVIDIA", "model": "RTX 4090", "vramGb": 24, "count": 1 }
    ],
    "storage": { "freeGb": 500, "type": "nvme" },
    "network": { "egressMbps": 300, "inbound": false }
  },
  "software": {
    "os": "Ubuntu 24.04",
    "runtime": { "node": "22.x", "python": "3.11" },
    "accel": { "cuda": "12.4" },
    "features": ["docker", "ffmpeg", "rust", "solidity-tooling"]
  },
  "policy": {
    "availability": "best-effort",
    "maxConcurrentTasks": 3,
    "allowPaidTasks": false
  },
  "attestationLevel": "self-reported",
  "signature": {
    "scheme": "eip-191",
    "signedBy": "0xAgent",
    "sig": "0x..."
  }
}
```

---

## 4) Publishing & Referencing

Recommended:
1. Agent generates manifest JSON locally.
2. Agent signs manifest hash with its swarm identity key.
3. Manifest is uploaded to IPFS (CID).
4. Contract stores only CID/hash pointer via event/state update.

Event example:
- `AgentManifestUpdated(agent, manifestCid, manifestHash, timestamp)`

---

## 5) Update Triggers
- On join approval (initial publish)
- On major environment change (GPU/CPU/memory upgrade)
- Periodic refresh (e.g., daily)
- On benchmark verification update

---

## 6) Security & Privacy Notes
- Avoid exposing sensitive internals (hostnames, private IPs, secrets)
- Round capacities if needed for privacy
- Keep raw telemetry offchain; publish only required summaries

---

## 7) MVP Boundary
- For MVP, manifests are optional and informational.
- Do not block joins/restores on manifest validity yet.
- Enforce only in future delegation/PoUW phases.
