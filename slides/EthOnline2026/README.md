# ETHOnline 2026 deck

Marp source for the event deck. **Not** the Cannes 0G deck (`slides/DECK.md`).

## Build

From repo root:

```bash
pnpm slides:ethonline
```

Writes HTML + media to:

- `apps/web/public/slides/` — picked up by `pnpm --filter soulvault-web build:export`
- `apps/web/out/slides/` — already-committed Pages artifact, so the next `gh-pages` publish includes the deck without a full Next rebuild

## Pages URL

GitHub Pages serves the Next export at `/soulvault/`.

https://nacmonad.github.io/soulvault/slides/

Local (after `pnpm --filter soulvault-web dev`): http://localhost:3000/slides/

## Edit

- `DECK.md` — slides
- `OUTLINE.md` — spoken script
- `REFERENCES.md` — live Sepolia names / contracts from the 2026-09-13 scan
- `docs/EthOnline2026/presentation-outline.md` — core + sponsor packs

`pnpm slides:pdf` still builds the Cannes deck. Event PDF: `pnpm slides:ethonline:pdf`.
