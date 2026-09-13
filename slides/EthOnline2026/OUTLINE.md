## SoulVault ##

Partner rooms (ENS + Ledger together): after the documents take, the **agent continuity** beat below. Do not lead the 4-min with it.

#### Background ####

###### Cannes 2026 #####

Originally was the Smart contract primitives and CLI + agent skills to help facilitate the recovery of a harness's memory system, but ended up establishing a communication and coordination channel.  The communication layer enabled public, swarm (encryption by K_epoch), and direct private messages (ephemeral ECDH + AES256).

Ledger brought human-in-the-loop for administrative actions, 0G storage for ECDH+AEC256 encrypted memory bundles. ENS was primarily used at this point only for organization discovery.

[437a0da04231d8aae4c9825e4ff74df693674858](https://github.com/nacmonad/soulvault/commit/437a0da04231d8aae4c9825e4ff74df693674858)

###### In Between ######

Clean up, adding integration + e2e testing using ens-v3-app and speculos.  Filling gaps from project feedback, learning more about the tech (i.e ENSIP-11 multichain, CBOR, EIP712 + ERC7730).  

This brings us to where we are for EthOnline 2026.

###### Idea for EthOnline 2026 ######

General interest in privacy + LLMs.  Ported Microsoft's Presidio PII detector system from Python to completely run in the browser. SaaS companies were offering PII detection, but what's the point if you have to send your documents over the wire ?  "Verify, don't trust"

https://nacmonad.github.io/presidio-web-demo/

This got me to thinkin, SoulVault's Events and our messaging system already had the primitives to provide grant's for revealing redacted items in text...

###### EthOnline 2026 ######

Redact/grant/rehydrate essentially is an audit trail of who has seen a redacted field.  The PII redaction runs entirely browser side (nacmonad/presidio-web), enables human review.  Grants are human reviewed and can require proof-of-human on rehydrate requests. This may aid in highly regulated environments as there is a proveable auditability trail of which entity has seen what about a sensitive document.  It also allows professionals to share completely redacted documents to an LLM, agent, or even grant USE access in a TEE environment such that questions may be asked that consume the redacted information, but never reveal it to the outer-world (PLAN_2.md).  Soulvault has no servers to hack, no middleman to compromise.  This process is completely web3 backed and transparent.  This is in line with the privacy mantra "Verify, don't trust" -- recall what the T in TEE stands for...

#### Agent continuity — ENSv2 EAC + Ledger wallet-cli (partner rooms) ####

**Then (Cannes `K_epoch`):**
- Swarm members had to **store `K_epoch`** so a dead agent could recover
- Any member could therefore **peek** at another agent's backup
- Identity was the wallet — lose the keypair, lose the name binding

**Now (`feature/epoch-key-ring`):**
- Org owner's **Ledger + Key Ring** derives an **agent-specific** key at any epoch: `soulvault:epoch-recovery:<agent-ens>:epoch-<n>`
- Other agents in the swarm **cannot** see another agent's memories (they never held the key)
- Identity is the **ENSv2 name**, not the wallet

**Three beats (say them in this order):**

1. **EAC — agents register their own sub-sub-domains.** Org root grants `ROLE_REGISTRAR` on the swarm subregistry (`ops.<org>.eth`). Charlie self-registers `charlie.ops.<org>.eth` and holds `SET_RESOLVER` on *that name only*. Not the org Ledger on every record write.
2. **Burn when the agent is lost.** Owner `ens burn --name charlie.ops.<org>.eth` (`ROLE_UNREGISTER` at org root). Label is free. Successor join-requests, owner approves, grants registrar on the swarm, Charlie v2 **re-registers the same label**. Name continuity; wallet is new; old ERC-8004 record stays frozen (correct).
3. **Restore via `wallet-cli ring`.** Successor calls `requestEpochKey(keyName)`. Owner's device/ring derives the epoch key (never stored, never on members), ECDH-wraps the escrow plaintext to v2's published pubkey, posts `sv:epoch-grant:v1` as a DM. Charlie v2 opens it with its new key — byte-identical memories, no peer ever saw them.

Pitch line: *The name is who the agent is. The ring is how the key exists without being stored. The swarm only emits events — it never sees a key.*

Do **not** enroll peer agents into the org Key Ring. Isolation holds because only the owner's ring can derive; the successor receives an ECDH grant, not ring membership.

Spec: `docs/epoch-key-grant-protocol.md` on `feature/epoch-key-ring`.

#### Sponsor Technologies and how they fit in ####

ENS: Since Soulvault was initially a node CLI + skills, it relied on its own internal json configurations.  If this were to ever be a Web UI we would have to use a different approach.  While LocalStorage, IndexedDB may have worked, ENS/ENSv2 actually became core to the app for eliminating any need for local configs or stores.  Using metadata of the org name, we can specify 1:M treasuries, swarms, document registries as well as their respective chainIds.  For the UI app and our CLI, this tells us what smart contract events to listen to and essentially persists the configs across devices/browser sessions.

**ENSv2 EAC (this event, not cosmetic):** hierarchical registries turn agents into real sub-sub-names (`<agent>.<swarm>.<org>.eth`). Scoped roles let the agent write its own records. `ROLE_UNREGISTER` lets the owner **burn** a dead agent's name and re-issue the label to a successor. Without EAC this is either "every write needs the org Ledger" or "the name dies with the wallet."

Ledger:
Guarantees human-in-the-loop for adminstrative actions (this was accomplished @Cannes2026 for the CLI).  We've extended this into the browser UI now.  Added a package/dmk-speculos-transport that allows Playwright automations to use the speculos emulator during e2e tests.  Type-2 device signing is proven by the existing Speculos integration test in packages/dmk-speculos-browser, which signs a real 1559 payload on an emulated device.

**`wallet-cli ring` (this event):** the missing custody layer. `ring init` is the one device tap (enrollment). After that, named keys are **derived**, not stored — `wallet-cli ring encrypt/decrypt --key soulvault:epoch-recovery:<agent-ens>:epoch-<n>`. Owner can recompute any agent's epoch key from the device + trustchain. Swarm members no longer hold `K_epoch`. That is what makes "peek at another agent's backup" impossible.

###### DMK notes & challenges ####### 
- device timeouts, parameter signing tediousness.  Can there be a callback device event on parameter signs so timeout management is less hacky (explain how we did it here, open a github issue and reference it here).  
- CAL + Clear-signing -- Right now, Soulvault is a cli/app for deploying user's contracts.  For CAL approval + clear-signing, would a Factory deployer contract satisfy the audibility constraints such that clear-signing can come to Soulvault ?

World:
-A very practical usecase would be professionals in highly regulated atmospheres (*cough* EU) to share documents to get second opinions safely from another professional.  Proof-of-selfie offers a practical and important gate on the rehydrate flow.
