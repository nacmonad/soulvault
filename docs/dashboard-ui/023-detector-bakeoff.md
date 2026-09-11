# Detector bakeoff (what we actually ran)

SoulVault’s product is grant/rehydrate, not a detector leaderboard. The default scan **is** `presidio-web` (pattern recognizers in `packages/presidio-adapter`). OpenAI Privacy Filter is a different product: a 1.5B token classifier (~3 GB weights). We did not download or run it here.

## Same note

`packages/presidio-adapter/test/fixtures/demo-referral.txt` — synthetic referral (fake name, email, ES phone, IBAN, test card). Safe to paste in the Redact tab for the recording.

## What `presidio-web` flags on that note

Vitest: `packages/presidio-adapter/test/demo-fixture.test.ts` (green).

| Entity | Caught by pattern engine |
|---|---|
| EMAIL_ADDRESS | yes |
| PHONE_NUMBER | yes |
| IBAN_CODE | yes |
| CREDIT_CARD | yes |
| PERSON (`Marta Vidal`, `Dr Serra`) | **no** — no PERSON recognizer in this registry |
| Location (`Hospital del Mar`) | **no** |

Names/places need GLiNER (optional in the worker) or an author span. That is the gap a 1.5B contextual model advertises; it is also why SoulVault keeps a human review step before encrypt.

## OpenRedaction vs `presidio-web` (same fixture)

Vitest: `packages/presidio-adapter/test/demo-fixture-openredaction.test.ts` (green). Test-only `openredaction` dep; not imported from `apps/web`. Default `detect()` (NER off, no OPF weights).

| Entity | presidio-web | OpenRedaction `detect()` |
|---|---|---|
| EMAIL | yes | **no** — EMAIL regex matches `marta.vidal@example.test`, then the built-in validator rejects it |
| PHONE | yes (`+34 612 345 678`) | **no** |
| IBAN | yes | yes (`IBAN`) |
| CREDIT_CARD | yes | yes |
| PERSON (`Marta Vidal`, `Dr Serra`) | **no** | **no** (`NAME` does not fire) |
| extras | — | `DATE`; `INSTAGRAM_USERNAME` false positives (`Card`, `Follow`, …) |

Same note, two regex engines: structured IBAN/card overlap; OpenRedaction’s default filter drops the email and the Spanish phone. PERSON still needs GLiNER/author on both.

## Published numbers (not re-run)

| System | What it is | Claimed / typical |
|---|---|---|
| Presidio (Python / this WASM port) | Regex + optional NER | Strong on structured PII; weak on untitled names |
| OpenAI Privacy Filter | 1.5B bidirectional classifier, Apache 2.0 | 96% F1 on PII-Masking-300k (OpenAI, Apr 2026); Tonic and arXiv:2608.02616 show sharp drops off that set |
| GLiNER2-PII | 300M schema-flexible NER | Competitive recall vs OPF on SPY legal/medical (May 2026) |

## What the prize is not

None of the three **grant**. Masked text is not a capability. SoulVault is detect → encrypt slots → wallet grant → rehydrate only granted fields. Swapping the detector for OPF would not change that, and would change Scott’s presidio-web + GLiNER path — out of scope.

Talking-points table for the deck lives in PR 25 / `slides/EthOnline2026/OUTLINE.md`. This note is the evidence we ran `presidio-web` and OpenRedaction on a checked-in fixture.
