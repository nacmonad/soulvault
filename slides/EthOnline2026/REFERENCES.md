# Live Sepolia references (scanned 2026-09-13)

Org is an ENSv2 **island** UserRegistry (VerifiableFactory proxy), not a public `ETHRegistry` 2LD. Public walk of `*.eth` does not see these names. Resolve via the island at `soulvault.ensv2Registry`.

## Org `soulvault-ensv2.eth`

| | |
|---|---|
| Display name | Soulvault ENSv2 Demo |
| Island registry | [`0xE26A271E84d5e0564EDB6eEB9D94F0EFB40B7F24`](https://sepolia.etherscan.io/address/0xE26A271E84d5e0564EDB6eEB9D94F0EFB40B7F24) |
| PermissionedResolver | [`0x684B2C0674B5d86C37b0407B67e10fBb5b74b01c`](https://sepolia.etherscan.io/address/0x684B2C0674B5d86C37b0407B67e10fBb5b74b01c) |
| Owner (Ledger) | [`0x56C528C96D19bd88844fb608035f4c745f25287b`](https://sepolia.etherscan.io/address/0x56C528C96D19bd88844fb608035f4c745f25287b) |
| Status | 2 REGISTERED · expiry 1791720194 |

### Text records (config layer — no backend)

- `class` = `soulvault.organization`
- `soulvault.ensv2Registry` = `{version:2, registry:0xE26A…7F24, owner:0x56C5…287b, deployedAt:2026-09-11T15:35:18Z}`
- `soulvault.swarms` CBOR labels: `demo`, `demo2`, `demo3`, `ops`
- `soulvault.treasuries` = Sepolia `0x4410e3a418FCe2c22dd2564475c51D080ad86A50` · Galileo `0xCF01fB4f6ef3cb9582080817D12811A93D7A5f35`
- `soulvault.documentRegistry` = Sepolia [`0x36f110e685205a63590baa5f1ECCC4DD22E98A59`](https://sepolia.etherscan.io/address/0x36f110e685205a63590baa5f1ECCC4DD22E98A59) · deployedAtBlock 11683378

## Swarms

| Name | Status | Notes |
|---|---|---|
| `demo.soulvault-ensv2.eth` | 2 REGISTERED · expiry 1791843927 | Label exists; no resolver / no `soulvault.swarmContract` text |
| `ops.soulvault-ensv2.eth` | 2 REGISTERED · expiry 1794338475 | Swarm [`0xc0af9C090C7675E5Cf9795B6bEC3Bb2b76ED426C`](https://sepolia.etherscan.io/address/0xc0af9C090C7675E5Cf9795B6bEC3Bb2b76ED426C) · chainId 11155111 |
| `demo2` / `demo3` | registered | no resolver |

## Charlie (v1 live)

| | |
|---|---|
| Name | `charlie.ops.soulvault-ensv2.eth` |
| Status | 2 REGISTERED · expiry 1791841773 |
| Name owner | [`0xe3b4D0e02DBc970175430BbD6973e7F7fC6e3B47`](https://sepolia.etherscan.io/address/0xe3b4D0e02DBc970175430BbD6973e7F7fC6e3B47) (agent, not org Ledger) |
| ERC-8004 | registry [`0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266`](https://sepolia.etherscan.io/address/0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266) · **agentId 5** |

Charlie **v2** is not a second live label. Succession is still the burn (`ROLE_UNREGISTER`) + re-register-same-label beat. v1 has not been burned.

`eth_getLogs` on publicnode over a 200k-block window was rejected (rate/range). Use the addresses above + Etherscan for JoinRequested / JoinApproved / AgentRegistered when recording.

CREATE2 recompute for the island: `apps/web/apps/web/scratch/check-ens.mts`.
