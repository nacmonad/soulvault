# Recording runbook (no new product)

Scott owns the take. This is the path the UI already implements. Do not re-redact after you share a bundle.

## Setup

- Dashboard: `https://soulvault.test/dashboard` (or the Pages/deploy you are using).
- Connect the wallet that owns the org. **Remember** an existing `.eth` — live Sepolia v1 register is off.
- Documents → Redact.

## Note to paste

Synthetic; same as PR 26 fixture:

```
Referral 11 Sep 2026
Patient: Marta Vidal, DOB 1984-03-12
Email: marta.vidal@example.test
Phone: +34 612 345 678
IBAN: ES9121000418450200051332
Card: 4111111111111111
Follow-up with Dr Serra next Tuesday at Hospital del Mar.
```

Presidio-web patterns catch email / phone / IBAN / card. Add author spans for the names if GLiNER is off.

## Order

1. **Redact** — accept slots, encrypt, **download the public bundle once**. Refresh is OK (keys in localStorage). Do not run Redact again on the same note.
2. **Grant** — wait for a request, or **Grant without a request** (recipient address + public key copied from their Rehydrate tab).
3. **Rehydrate** — upload **that** bundle. Only granted slots come back. World Selfie only if the Portal action exists.

Ledger: each grant is clear-signed. Budget time.

## Out of the take

Org/swarm/treasury unless asked. ENSv2. Key-ring. New `.eth` registration on Sepolia v1.
