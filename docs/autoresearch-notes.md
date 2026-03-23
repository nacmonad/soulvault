# Autoresearch Notes for SoulVault

## 1) What Karpathy's `autoresearch` does (coordination style)

`autoresearch` uses a lightweight autonomous loop rather than formal swarm governance.

Core coordination primitives:
- **Policy in markdown** (`program.md`) as the behavioral contract
- **Branch state progression** (advance on success, reset on failure)
- **Single mutable surface** (`train.py`) to control complexity
- **External experiment ledger** (`results.tsv`) for run history
- **Deterministic keep/discard loop** based on measured metrics

It is closer to "single-agent autonomous lab workflow" than a multi-agent protocol network.

---

## 2) What SoulVault should borrow

1. **Tiny, explicit control loop**
   - Keep main protocol paths minimal and deterministic.

2. **Narrow mutable surfaces**
   - Restrict where agents can write/modify by role and task type.

3. **Clear acceptance criteria**
   - Prefer machine-checkable pass/fail gates where possible.

4. **Append-only result history**
   - Keep auditable log/event timelines for decisions and outcomes.

5. **Policy-as-code/docs**
   - Let operators evolve swarm behavior via explicit policy files.

---

## 3) What SoulVault adds beyond autoresearch

1. **Membership governance**
   - Owner-gated first join, quorum-ready roadmap.

2. **Security and continuity**
   - Encrypted state with epoch key rotation (`K_epoch`) and wrapped-key bundles.

3. **Multi-agent coordination substrate**
   - Onchain event bus + encrypted payload references.

4. **Portable restore on new infra**
   - Join approval + decrypt + restore lifecycle for fresh VPS nodes.

5. **Multi-swarm operations**
   - One contract per swarm, switchable in CLI/TUI.

---

## 4) Judge-friendly framing

- **Autoresearch showed how autonomous experiment loops can create useful progress.**
- **SoulVault extends this into secure, governable, multi-agent infrastructure.**
- Instead of one local autonomous loop, SoulVault enables shared continuity and coordination across distributed agents with auditable governance.

---

## 5) Practical integration idea (post-MVP)

Use autoresearch-style workflows as a task type inside SoulVault:
- create task spec
- run experiment loops on approved agents
- submit artifact + verification report
- accept/reject via swarm policy

This becomes a concrete bridge toward Proof-of-Useful-Work.
