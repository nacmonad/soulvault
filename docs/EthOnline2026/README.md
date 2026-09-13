# ETHOnline 2026 — slides & video

Continuity track. Prize picks: **ENS · Ledger · World**.

**G0:** *Redact on your machine; authorized wallets rehydrate only the fields they’re allowed to see.*

| File | What |
|---|---|
| [presentation-outline.md](presentation-outline.md) | Core 4-min deck + optional ENS / Ledger / World overlay packs + pack E (ENSv2 EAC + `wallet-cli ring` agent continuity) |
| [`slides/EthOnline2026/DECK.md`](../../slides/EthOnline2026/DECK.md) | Marp source. Build: `pnpm slides:ethonline` → `/soulvault/slides/` on Pages |
| [`slides/EthOnline2026/OUTLINE.md`](../../slides/EthOnline2026/OUTLINE.md) | Spoken script. Documents take first; partner rooms: then/now `K_epoch` peek → owner ring + burn/re-register |
| [`slides/EthOnline2026/REFERENCES.md`](../../slides/EthOnline2026/REFERENCES.md) | Live Sepolia scan: `soulvault-ensv2.eth`, `demo`/`ops` swarms, charlie v1 |

Cannes 0G / agent-ops deck stays at `slides/DECK.md` and `docs/presentation-outline.md`. Do not present those as this event.

Pages: https://nacmonad.github.io/soulvault/slides/ (next to the Next export). Rebuild HTML with `pnpm slides:ethonline`; the script copies into `apps/web/public/slides/` and `apps/web/out/slides/`.
