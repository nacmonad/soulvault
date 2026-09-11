# World Selfie Check — grant-from-request gate

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

Branch: `feature/world-proof-of-selfie` (docs-first on `otto/world-proof-of-selfie-docs`).

## What this is

A **policy flag on publish**, a **proof blob on the rehydrate request**, and a
**fail-closed Grant button** on Alice’s Grants tab. It is **not** a gate on
redact or on the publish transaction. Alice publishes as today; she may set
`selfieRequired` so that later `grantToRequest` waits on a verified World
Selfie Check (credential 11, `selfieCheckLegacy`).

Browser path first. No native World App / Sandbox-phone work in this ticket.
IDKit’s web widget still *can* QR to a phone — that is World’s handoff, not
a SoulVault mobile surface. Staging + the existing mock verifier are the
dev loop.

## Flow

```
Alice redact → publishDocument(docHash, slotIds, selfieRequired)
Charlie Rehydrate tab: IDKit widget (browser) → proof in his tab
Charlie requestRehydration(docHash, pubkey, selfieProof)
Alice Grants: evaluateRehydrateRequest → then grantSlotKeys
Charlie unwrap (no second selfie)
```

- `selfieRequired=false` (default): request/grant unchanged. Ledger demo
  survives if World Sandbox is down.
- `selfieRequired=true`: `requestRehydration` with empty `selfieProof`
  reverts. Alice’s Grant-to-request stays disabled until Portal verify
  succeeds. Pre-request grants on that document fail closed (no proof
  rides the request event).
- Chain does **not** verify the ZK. It stores the flag and carries the
  proof string. Alice’s browser (via a tiny RP worker) is the verifier.

## Contract delta

```solidity
function publishDocument(bytes32 docHash, string[] calldata slotIds, bool selfieRequired) external;
event DocumentPublished(bytes32 indexed docHash, address indexed author, string[] slotIds, bool selfieRequired);

function requestRehydration(bytes32 docHash, string calldata rehydrationPublicKey, string calldata selfieProof) external;
event RehydrationRequested(bytes32 indexed docHash, address indexed recipient, string rehydrationPublicKey, string selfieProof);
```

Old events without the new fields decode as `selfieRequired=false` and
empty proof. Registries already on Sepolia need a redeploy for the flag.

`selfieProof` is the IDKit result JSON (World ID 3.0 / identifier `"selfie"`).
Do not put PII on chain; the proof is a ZK payload + nullifier.

## Browser vs RP worker

The selfie **occurs in Charlie’s tab** (`@worldcoin/idkit` widget). World ID 4
forbids `RP_SIGNING_KEY` in the client, and the static Pages export cannot
host API routes. A tiny worker (library: `packages/node/src/world-identity.ts`)
does only:

1. `GET /rp-signature` — `signRequest` for action `soulvault-request-rehydrate`
2. `POST /verify` — forward IDKit JSON as-is to
   `https://developer.world.org/api/v4/verify/{rp_id}`

No documents, no slot keys. Signal: `lower(charlieWallet):docHash`.

## Surfaces

| Tab | Change |
|---|---|
| Redact / publish | Checkbox **Require Selfie Check for grants-from-request**. Publish tx always proceeds. |
| Rehydrate | If the published doc has `selfieRequired`, IDKit widget before **Request rehydration**. Drop paste-JSON as the *gate* (keep as a staging fixture if needed). Unwrap itself is not gated. |
| Grants | `grantToRequest` disabled until verify returns approved. Chip on the request row: missing / verified / rejected. Pre-request panel refuses `selfieRequired` docs. |

Protocol stays World-free. Widget in `apps/web`; verify in `@soulvault/node`.

## Acceptance (docs + later code)

- [ ] Publish with `selfieRequired=false` is identical to today.
- [ ] Publish with `selfieRequired=true` does not require Alice to selfie.
- [ ] Request without proof on a flagged doc reverts / UI blocks the tx.
- [ ] Alice cannot `grantToRequest` until verify + nullifier check pass.
- [ ] Pre-request grant on a flagged doc fails closed.
- [ ] Unwrap of an already-granted slot does not ask for a second selfie.
- [ ] Mock verifier keeps CI green without World Portal.
- [ ] `feedback.md` stub for the Selfie Check qualifier (flag gating, RP key
      once, owner-only actions, widget-vs-phone).

## Blocked by (code, not this docs PR)

- Portal owner creates staging action `soulvault-request-rehydrate`
  (credential Selfie Check). App
  `app_99dc82c37d167284ef081f8cdbe20222` / RP `rp_301afe7f18a97891`.
- Selfie Check (Beta) feature flag on that app.
- `WORLD_RP_SIGNING_KEY` in a **server-only** env file. Never `NEXT_PUBLIC_*`.
  Do not rotate the live signer.

## Out of scope

- AgentKit / AgentBook / x402 (installed; not this gate).
- Orb / `proofOfHuman`.
- Native mobile / Sandbox App E2E (later; widget is the browser example).
- `feature/ensv2-integration`.
- Speculos / reducers except Grants/Rehydrate wiring above.
