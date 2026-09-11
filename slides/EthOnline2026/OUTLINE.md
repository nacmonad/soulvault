## SoulVault ##

**One line:** Redact on your machine. Authorized wallets rehydrate only the fields they were granted.

#### Demo (record today) ####

Order — Documents, not org/swarm/treasury unless they ask:

1. **Redact** — paste a note. Presidio runs in the browser. Classify slots, encrypt, publish the hash.
2. **Grant** — author signs which slots a wallet may see (request first, or grant ahead). Ledger HITL if connected.
3. **Rehydrate** — paste the public bundle. Only granted slots decrypt. World Selfie optional on READ.

Honest: a READ grant is permanent (no revoke). Live Sepolia v1 `.eth` register is off — use an existing org name. ENSv2 is a parallel lane.

#### Redaction landscape (one slide) ####

OpenAI Privacy Filter / Presidio / GLiNER detect and mask. They do not grant. SoulVault is detect → encrypt slots → wallet grant → rehydrate only what was granted. Plaintext never leaves the author machine.

| | Detect | Where | Output | Access control |
|---|---|---|---|---|
| Presidio | Regex + NER | Self-hosted / this browser | Masked text | None |
| OpenAI Privacy Filter (1.5B, Apr 2026) | Contextual PII | Local weights or API | Masked spans | None |
| GLiNER2-PII | Schema-flexible NER | Local | Spans | None |
| **SoulVault** | Presidio (+ optional GLiNER) on the author machine | Author laptop | Encrypted slots + on-chain hash | Wallet grant per slot; optional World Selfie on READ |

Sources: OpenAI Privacy Filter; arXiv:2608.02616; Presidio; GLiNER2-PII (May 2026). Longer note: `docs/dashboard-ui/022-presentation-g0.md`.

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

#### Sponsor Technologies and how they fit in ####

ENS: Since Soulvault was initially a node CLI + skills, it relied on its own internal json configurations.  If this were to ever be a Web UI we would have to use a different approach.  While LocalStorage, IndexedDB may have worked, ENS/ENSv2 actually became core to the app for eliminating any need for local configs or stores.  Using metadata of the org name, we can specify 1:M treasuries, swarms, document registries as well as their respective chainIds.  For the UI app and our CLI, this tells us what smart contract events to listen to and essentially persists the configs across devices/browser sessions.

Ledger:
Guarantees human-in-the-loop for adminstrative actions (this was accomplished @Cannes2026 for the CLI).  We've extended this into the browser UI now.  Added a package/dmk-speculos-transport that allows Playwright automations to use the speculos emulator during e2e tests.  Type-2 device signing is proven by the existing Speculos integration test in packages/dmk-speculos-browser, which signs a real 1559 payload on an emulated device.

###### DMK notes & challenges ####### 
- device timeouts, parameter signing tediousness.  Can there be a callback device event on parameter signs so timeout management is less hacky (explain how we did it here, open a github issue and reference it here).  
- CAL + Clear-signing -- Right now, Soulvault is a cli/app for deploying user's contracts.  For CAL approval + clear-signing, would a Factory deployer contract satisfy the audibility constraints such that clear-signing can come to Soulvault ?

World:
-A very practical usecase would be professionals in highly regulated atmospheres (*cough* EU) to share documents to get second opinions safely from another professional.  Proof-of-selfie offers a practical and important gate on the rehydrate flow.
