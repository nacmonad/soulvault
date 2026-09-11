# Presentation — G0 and the document path

For Scott’s deck today. Center of the program is **Documents**, not org/swarm/treasury.

## One line

Redact on your machine. Authorized wallets rehydrate only the fields they were granted.

## What to show (order)

1. **Redact** — paste a clinic note, local Presidio/GLiNER scan, classify slots, publish hash.
2. **Grants** — requester asks; author signs which slots. Ledger HITL if connected.
3. **Rehydrate** — paste the public bundle; only granted slots come back. World Selfie optional on READ.

Org ENS is how the registry is discovered. Do not lead with org/swarm/treasury unless asked.

## Honest limits

- World action still owner-side; IDKit widget may not be live.
- ENSv2 is a parallel branch — not this screen.
- A READ grant is permanent. No revoke.

## Redaction landscape (slide)

| | Detect | Where it runs | What you get back | Access control |
|---|---|---|---|---|
| Regex / dictionaries | Structured PII | Anywhere | Masked text | None |
| Microsoft Presidio | Regex + NER + custom recognizers | Self-hosted | Masked text + entity types | None |
| OpenAI Privacy Filter (1.5B, Apr 2026) | Contextual PII, 8–33 types | Local weights or API | Masked spans | None — detect/mask only |
| GLiNER2-PII | Schema-flexible NER | Local | Spans | None |
| **SoulVault** | Presidio (+ optional GLiNER) **on the author’s machine** | Author laptop | Encrypted **slots** + on-chain hash | **Wallet grant** per slot; optional World Selfie on READ |

OpenAI Privacy Filter is a detector. SoulVault is detect → encrypt slots → grant from a wallet → rehydrate only what was granted. The benchmark that matters for the prize is not F1 vs Privacy Filter; it is that the plaintext never leaves the author machine and the consumer cannot see ungated fields.

Sources: OpenAI Privacy Filter announcement (Apr 2026); arXiv:2608.02616; Presidio docs; GLiNER2-PII (May 2026).

## Entry points in the UI

- Overview leads with the one-liner and a Documents link.
- Documents index is the three steps, not a redirect into Redact.
- Nav: Documents first after Overview.
